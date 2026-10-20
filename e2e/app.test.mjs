// End-to-end tests: real Chromium at phone size against the static app.
// Run: npm run e2e   (set CHROMIUM_PATH if Chromium is not at /opt/pw-browsers/chromium)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './fixture.mjs';
import { localDate, line, firstSetResult, menuExercises, prefill, weekHeat, clearCount,
  bodyAvg7, feed, mergeFeed, setHistory, weekStart, value, load } from '../logic.js';

const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}/`;
  const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch({ executablePath });
});
after(async () => { await browser?.close(); server?.close(); });

/** Fresh phone-sized page. `data` → kintore:data, `extra` → other localStorage keys. GitHub API is stubbed. */
async function open({ data, extra = {}, github } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const api = { puts: [], fail: false, posts: null, remote: null };
  await context.route('https://api.github.com/**', route => {
    const req = route.request();
    if (api.fail) return route.fulfill({ status: 500, body: '{}' });
    if (req.url().endsWith('posts.json')) {
      return api.posts
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(JSON.stringify(api.posts)).toString('base64') }) })
        : route.fulfill({ status: 404, body: '{}' });
    }
    if (req.method() === 'GET') {
      return api.remote
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'abc', content: api.remote }) })
        : route.fulfill({ status: 404, body: '{}' });
    }
    const body = JSON.parse(req.postData());
    api.puts.push(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')));
    api.remote = body.content;
    return route.fulfill({ status: 200, body: '{}' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(([data, extra, github]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    if (data) localStorage.setItem('kintore:data', typeof data === 'string' ? data : JSON.stringify(data));
    if (github) localStorage.setItem('kintore:github', JSON.stringify(github));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
  }, [data ?? null, extra, github ?? null]);
  await page.goto(base);
  return { page, api, errors, close: () => context.close() };
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('kintore:data')));
const press = (page, text) => page.locator('.press').getByRole('button', { name: text, exact: true });
const complete = page => page.locator('.press .go').filter({ hasText: /^\d+セット目を完了$/ }).click();
const tab = (page, text) => page.locator('.tabs').getByRole('button', { name: text, exact: true });
const sheet = page => page.locator('dialog.sheet[open]').last();
const settings = page => tab(page, '設定').click();
const pill = (page, text) => page.locator('.see .pill').getByText(text, { exact: true });

async function startLight(page) {
  await pill(page, '種目を変える').click();
  const toggle = sheet(page).getByRole('button', { name: '軽めの日（各1セット）', exact: true });
  if (await toggle.getAttribute('aria-pressed') === 'false') await toggle.click();
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await press(page, '始める').click();
}

async function home(page) {
  if (await page.locator('.tabs').isVisible()) await tab(page, 'ホーム').click();
  else await press(page, 'ホーム').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
}

async function leaveTraining(page) {
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: 'トレーニングをやめる', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'summary');
  await principles(page);
  await press(page, 'ホームへ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
}

async function principles(page) {
  assert.deepEqual(await page.$$eval('button, a[href], select, input, textarea, [role=slider]', elements =>
    elements.filter(element => !element.closest('.press, dialog.sheet, .slab, .tabs, #toast button') &&
      !element.closest('.see .ln, .see .rec, .see .ex, .see .pill, .see .back, .see .sets .r.done, .see .hist .r, .see .seg, .see .day, .see .bl, .see .big input'))
      .map(element => element.outerHTML)), []);
  const size = await page.evaluate(() => {
    const tabs = document.querySelector('.tabs');
    const visibleTabs = !tabs.hidden;
    return {
      w: document.scrollingElement.scrollWidth, h: document.scrollingElement.scrollHeight,
      top: document.scrollingElement.scrollTop, iw: innerWidth, ih: innerHeight,
      bottom: document.querySelector('.press').getBoundingClientRect().bottom,
      tabsBottom: visibleTabs ? tabs.getBoundingClientRect().bottom : null,
      buttons: [...document.querySelectorAll('.press .go')].map(button => {
        const rect = button.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      })
    };
  });
  assert.ok(size.w <= size.iw, 'page scrolls sideways');
  assert.ok(size.h <= size.ih && size.top === 0, 'page scrolls vertically');
  assert.ok(size.bottom <= size.ih, 'press is cut off');
  if (size.tabsBottom !== null) assert.equal(size.tabsBottom, size.ih);
  for (const button of size.buttons) {
    assert.ok(button.top >= size.ih / 2, 'main button is above the lower half');
    assert.ok(button.bottom <= size.ih, 'main button is cut off');
  }
}

async function swipe(page, dx, dy = 0, selector = '.see') {
  await page.evaluate(([dx, dy, selector]) => {
    const target = document.querySelector(selector);
    const touch = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
    const start = touch(180, 250);
    const end = touch(180 + dx, 250 + dy);
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [start], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [end], bubbles: true }));
  }, [dx, dy, selector]);
}

async function closeSheet(page) {
  await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
}

async function backTo(page, mode) {
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(mode => document.querySelector('.app').dataset.mode === mode, mode);
}

test('paper/slab principles hold on both phone sizes, modes, editors and open sheets', async () => {
  const { page, errors, close } = await open({ data: fixture(), extra: {
    'kintore:posts': [{ id: 'p1', at: '2099-01-01', kind: 'reading', text: '読み物',
      source: { title: '出典', url: 'https://example.com' } }]
  } });
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
    for (const text of ['種目を変える', '今日は休む', '体重を記録']) {
      await pill(page, text).click();
      await principles(page);
      await closeSheet(page);
    }
    await press(page, '始める').click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
    assert.equal(await page.locator('.tabs').isVisible(), false);
    await principles(page);
    await leaveTraining(page);
    await startLight(page);
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
    await principles(page);
    await leaveTraining(page);
    await tab(page, '記録').click();
    await principles(page);
    await page.locator('.rec').first().click();
    await principles(page);
    await page.getByRole('button', { name: '‹ 記録', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'records');
    await page.locator('.quick .pill').filter({ hasText: /^新着 / }).click();
    await principles(page);
    assert.ok(await sheet(page).getByRole('link', { name: '出典' }).isVisible());
    await closeSheet(page);
    await tab(page, '種目').click();
    await principles(page);
    for (const text of ['＋ 新しい種目', '＋ テンプレート']) {
      await page.getByRole('button', { name: text, exact: true }).click();
      await principles(page);
      assert.equal(await page.locator('.tabs').isVisible(), false);
      await press(page, 'キャンセル').click();
      await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
    }
    await settings(page);
    await principles(page);
    await page.getByRole('button', { name: '＋ バンド', exact: true }).click();
    await principles(page);
    await press(page, 'キャンセル').click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'settings');
    await page.setInputFiles('input[type=file]', {
      name: 'data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture()))
    });
    await sheet(page).waitFor();
    await principles(page);
    await page.locator('#confirm-dialog button[value=cancel]').click();
    await page.waitForFunction(() => !window.history.state?.sheet);
    await home(page);
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'today');
  }
  assert.deepEqual(errors, []);
  await close();
});

test('today lines follow menuExercises and line, including custom and template selection', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  const today = localDate(new Date());
  async function check(menu) {
    const ids = menuExercises(data, menu, today);
    assert.deepEqual(await page.locator('.ln').evaluateAll(rows => rows.map(row => row.dataset.exerciseId)), ids);
    for (const id of ids) {
      const expected = line(data, id, today);
      const ex = data.exercises.find(ex => ex.id === id);
      assert.equal(await page.locator('.ln[data-exercise-id="' + id + '"] .num').textContent(),
        expected.kind === 'base' ? '初回' : expected.kind === 'up' ? expected.next + 'へ' :
          String(expected.value) + (ex.type === 'time' ? '秒' : ''));
    }
  }
  await check({ kind: 'same' });
  await pill(page, '種目を変える').click();
  await sheet(page).getByRole('button', { name: '胸と背中', exact: true }).click();
  assert.deepEqual(await sheet(page).locator('.check.on').evaluateAll(rows =>
    rows.map(row => row.dataset.exerciseId)), ['e1', 'e2', 'e3']);
  assert.equal(await sheet(page).locator('.chips2 .on').textContent(), '胸と背中');
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await check({ kind: 'template', templateId: 't1' });
  assert.match(await page.textContent('.hello'), /胸と背中/);
  await pill(page, '種目を変える').click();
  await sheet(page).locator('.check[data-exercise-id=e1]').click();
  assert.equal(await sheet(page).locator('.chips2 .on').count(), 0);
  await sheet(page).locator('.check[data-exercise-id=e4]').click();
  await sheet(page).getByRole('button', { name: '決定' }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  const menu = { kind: 'custom', exerciseIds: ['e2', 'e3', 'e4'] };
  await check(menu);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:menu'))), menu);
  await page.reload();
  await check(menu);
  assert.deepEqual(errors, []);
  await close();
});

test('picker drafts replace checks, disable empty menus and discard changes when closed', async () => {
  const data = fixture();
  data.exercises[3].archived = true;
  data.templates.push({ id: 't2', name: '体幹の日', exerciseIds: ['e3'], sets: 2 });
  const menu = { kind: 'custom', exerciseIds: ['e2', 'e1'] };
  const { page, errors, close } = await open({ data, extra: { 'kintore:menu': menu } });
  const before = await page.evaluate(() => localStorage.getItem('kintore:menu'));
  await pill(page, '種目を変える').click();
  assert.equal(await sheet(page).getAttribute('aria-label'), '今日の種目');
  assert.deepEqual(await sheet(page).locator('.chips2 button').allTextContents(),
    ['前回と同じ', '胸と背中', '体幹の日']);
  assert.equal(await sheet(page).locator('.chips2 .on').count(), 0);
  assert.deepEqual(await sheet(page).locator('.check').evaluateAll(rows =>
    rows.map(row => row.dataset.exerciseId)), ['e1', 'e2', 'e3']);
  for (const ex of data.exercises.filter(ex => !ex.archived)) {
    const target = line(data, ex.id, localDate(new Date()));
    const row = sheet(page).locator('.check[data-exercise-id="' + ex.id + '"]');
    assert.equal(await row.locator('span small').textContent(), ex.part);
    assert.equal(await row.locator(':scope > small').textContent(),
      target.kind === 'base' ? '初回' : target.kind === 'up' ? target.next + 'へ' :
        'ライン ' + target.value + (ex.type === 'time' ? '秒' : ''));
  }
  await sheet(page).getByRole('button', { name: '体幹の日', exact: true }).click();
  assert.deepEqual(await sheet(page).locator('.check.on').evaluateAll(rows =>
    rows.map(row => row.dataset.exerciseId)), ['e3']);
  await sheet(page).getByRole('button', { name: '前回と同じ', exact: true }).click();
  assert.deepEqual(await sheet(page).locator('.check.on').evaluateAll(rows =>
    rows.map(row => row.dataset.exerciseId)), ['e1', 'e2', 'e3']);
  for (const id of ['e1', 'e2', 'e3']) {
    await sheet(page).locator('.check[data-exercise-id="' + id + '"]').click();
  }
  assert.ok(await sheet(page).getByRole('button', { name: '決定', exact: true }).isDisabled());
  assert.equal(await sheet(page).locator('.chips2 .on').count(), 0);
  await sheet(page).getByRole('button', { name: '軽めの日（各1セット）', exact: true }).click();
  await closeSheet(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:menu')), before);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:light')), null);
  await pill(page, '種目を変える').click();
  assert.deepEqual(await sheet(page).locator('.check.on').evaluateAll(rows =>
    rows.map(row => row.dataset.exerciseId)), ['e1', 'e2']);
  await sheet(page).locator('.check[data-exercise-id=e3]').click();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:menu')), before);
  assert.deepEqual(errors, []);
  await close();
});

test('picker creates an exercise at the end of the home menu and editor cancel changes nothing', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e2', 'e1'] }
  } });
  await pill(page, '種目を変える').click();
  await sheet(page).getByRole('button', { name: '＋ 新しい種目を作る', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercise-editor');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.getByLabel('名前', { exact: true }).fill('スクワット');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  const created = (await stored(page)).exercises.at(-1);
  assert.equal(created.name, 'スクワット');
  assert.deepEqual(await page.locator('.ln').evaluateAll(rows => rows.map(row => row.dataset.exerciseId)),
    ['e2', 'e1', created.id]);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:menu'))),
    { kind: 'custom', exerciseIds: ['e2', 'e1', created.id] });
  assert.match(await page.textContent('.hello'), /種目を選ぶ/);
  const before = await stored(page);
  const menu = await page.evaluate(() => localStorage.getItem('kintore:menu'));
  await pill(page, '種目を変える').click();
  await sheet(page).getByRole('button', { name: '＋ 新しい種目を作る', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercise-editor');
  await press(page, 'キャンセル').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  assert.deepEqual(await stored(page), before);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:menu')), menu);
  assert.deepEqual(errors, []);
  await close();
});

test('home exercise rows open detail and return home through the button and history', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  assert.equal(await page.locator('.head .pill svg[aria-hidden=true]').count(), 1);
  for (const historyBack of [false, true]) {
    await page.locator('.ln[data-exercise-id=e1]').click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'detail');
    assert.equal(await page.textContent('.exname'), '腕立て伏せ');
    assert.equal(await tab(page, '記録').getAttribute('aria-current'), 'page');
    await principles(page);
    if (historyBack) await backTo(page, 'today');
    else {
      await page.getByRole('button', { name: '‹ ホーム', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
    }
  }
  assert.deepEqual(errors, []);
  await close();
});

test('light choice persists today, can be turned off and expires the next day', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  const today = localDate(new Date());
  await page.clock.install({ time: new Date(today + 'T12:00:00') });
  await pill(page, '種目を変える').click();
  await sheet(page).getByRole('button', { name: '軽めの日（各1セット）', exact: true }).click();
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:light'))), today);
  await page.reload();
  await pill(page, '種目を変える').click();
  const toggle = sheet(page).getByRole('button', { name: '軽めの日（各1セット）', exact: true });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await toggle.click();
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await pill(page, '種目を変える').click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await closeSheet(page);
  await startLight(page);
  await complete(page);
  assert.equal((await stored(page)).sessions.at(-1).light, true);
  await leaveTraining(page);
  const tomorrow = new Date(today + 'T12:00:00');
  tomorrow.setDate(tomorrow.getDate() + 1);
  await page.clock.setFixedTime(tomorrow);
  await pill(page, '種目を変える').click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await closeSheet(page);
  await press(page, '始める').click();
  await complete(page);
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.date, localDate(tomorrow));
  assert.equal(session.light, false);
  assert.deepEqual(errors, []);
  await close();
});

test('previous short is vermilion; base and up use the small word treatment', async () => {
  const data = fixture();
  const date = n => localDate(new Date(new Date().setDate(new Date().getDate() - n)));
  data.sessions = [
    { id: 'a', date: date(2), light: false, note: '', sets: [
      { exerciseId: 'e1', reps: 15 }, { exerciseId: 'e2', reps: 20, bandId: 'r' }
    ] },
    { id: 'b', date: date(1), light: false, note: '', sets: [
      { exerciseId: 'e1', reps: 14 }, { exerciseId: 'e2', reps: 20, bandId: 'r' }
    ] }
  ];
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1', 'e2', 'e3'] }
  } });
  assert.equal(await page.locator('.ln[data-exercise-id=e1] .carry').count(), 1);
  assert.match(await page.locator('.ln[data-exercise-id=e1] small').textContent(), /前回 14 ・ あと2/);
  assert.equal(await page.locator('.ln[data-exercise-id=e2] .word').textContent(), '黒へ');
  assert.equal(await page.locator('.ln[data-exercise-id=e3] .word').textContent(), '初回');
  await pill(page, '種目を変える').click();
  assert.equal(await sheet(page).locator('.check[data-exercise-id=e2] > small').textContent(), '黒へ');
  assert.equal(await sheet(page).locator('.check[data-exercise-id=e3] > small').textContent(), '初回');
  await closeSheet(page);
  await close();
});

test('only training responds to horizontal swipes', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  for (const [name, mode] of [['ホーム', 'today'], ['記録', 'records'], ['種目', 'exercises'], ['設定', 'settings']]) {
    await tab(page, name).click();
    for (const dx of [-100, 100]) {
      await swipe(page, dx);
      assert.equal(await page.getAttribute('.app', 'data-mode'), mode);
    }
  }
  await tab(page, '記録').click();
  await page.locator('.rec').first().click();
  const name = await page.textContent('.exname');
  for (const dx of [-100, 100]) {
    await swipe(page, dx);
    assert.equal(await page.textContent('.exname'), name);
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'detail');
  }
  await home(page);
  await press(page, '始める').click();
  await swipe(page, -59);
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  await swipe(page, -80, 50);
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  await swipe(page, 100);
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  await swipe(page, -60);
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  await swipe(page, 60, 0, '.press');
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('training home preserves exercise, set, input and rest for resume', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await page.clock.install();
  await press(page, '始める').click();
  await press(page, '次 ▶').click();
  await complete(page);
  await press(page, 'バンドロウ 1回増やす').click();
  const amount = await page.locator('.counter .num').textContent();
  await home(page);
  await press(page, '続きから').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.match(await page.textContent('.tr-top'), /2 \/ 3 ・ 2セット目へ/);
  assert.equal(await page.locator('.counter .num').textContent(), amount);
  assert.equal(await page.locator('.counter .pm').last().getAttribute('aria-label'), 'バンドロウ 1回増やす');
  assert.equal(await page.locator('.restbar').count(), 1);
  await press(page, '休憩を終える').click();
  await home(page);
  await press(page, '続きから').click();
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  assert.equal(await page.locator('.sets .cur .no').textContent(), '2');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('tabs use one history level and mark the current destination', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  const initial = await page.evaluate(() => window.history.length);
  assert.deepEqual(await page.locator('.tabs button').allTextContents(), ['ホーム', '記録', '種目', '設定']);
  assert.equal(await page.locator('.tabs svg[aria-hidden=true]').count(), 4);
  for (const [name, mode] of [['記録', 'records'], ['種目', 'exercises'], ['設定', 'settings'], ['設定', 'settings'], ['記録', 'records']]) {
    await tab(page, name).click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), mode);
    assert.equal(await page.locator('.tabs [aria-current=page]').textContent(), name);
    assert.equal(await page.evaluate(() => window.history.length), initial + 1);
  }
  await backTo(page, 'today');
  assert.equal(await tab(page, 'ホーム').getAttribute('aria-current'), 'page');
  await press(page, '始める').click();
  await press(page, 'メモ').click();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  await backTo(page, 'today');
  assert.equal(await press(page, '続きから').count(), 1);
  await press(page, '続きから').click();
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: 'トレーニングをやめる', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'summary');
  await backTo(page, 'today');
  assert.equal(await press(page, '続きから').count(), 0);
  assert.equal(await press(page, '始める').count(), 1);
  assert.deepEqual(errors, []);
  await close();
});

test('back first closes a sheet on home, records and settings', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await pill(page, '種目を変える').click();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'today');
  await tab(page, '記録').click();
  await pill(page, '日付から探す').click();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'records');
  await backTo(page, 'today');
  await settings(page);
  await page.setInputFiles('input[type=file]', {
    name: 'data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture()))
  });
  await sheet(page).waitFor();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'settings');
  await backTo(page, 'today');
  assert.deepEqual(errors, []);
  await close();
});

test('home quick actions open their sheets and light start uses one set per exercise', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  assert.equal(await page.locator('.press .sub').count(), 0);
  assert.equal(await page.getByRole('button', { name: '今日の調整', exact: true }).count(), 0);
  for (const name of ['今日は休む', '体重を記録']) {
    await pill(page, name).click();
    assert.equal(await sheet(page).getAttribute('aria-label'), name);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await principles(page);
    await closeSheet(page);
  }
  await startLight(page);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  for (let i = 0; i < 3; i++) {
    await complete(page);
    await press(page, '休憩を終える').click();
    assert.equal(await page.locator('.press .counter').count(), 0);
    if (i < 2) await press(page, '次の種目へ ▶').click();
  }
  await press(page, '◀ 前').click();
  assert.ok(await page.locator('.dots i').last().evaluate(dot => dot.classList.contains('done')));
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.light, true);
  assert.equal(session.sets.length, 3);
  assert.deepEqual(errors, []);
  await close();
});

test('home has seven week cells and miniature lines from eight actual first sets at the current load', async () => {
  const data = fixture();
  const today = localDate(new Date());
  data.sessions.push({ id: 'today', date: today, light: true, note: '', sets: [{ exerciseId: 'e1', reps: 10 }] });
  const { page, errors, close } = await open({ data });
  assert.deepEqual(await page.locator('.week span').allTextContents(), [...'月火水木金土日']);
  const [year, month, day] = weekStart(today).split('-').map(Number);
  const dates = Array.from({ length: 7 }, (_, i) => localDate(new Date(year, month - 1, day + i)));
  assert.deepEqual(await page.locator('.week i').evaluateAll(cells => cells.map(cell => ({
    done: cell.classList.contains('d'), today: cell.classList.contains('t')
  }))), dates.map(date => ({
    done: data.sessions.some(session => session.date === date && session.sets.length > 0),
    today: date === today
  })));
  for (const id of menuExercises(data, { kind: 'same' }, today)) {
    const entries = setHistory(data, id);
    const points = entries.filter(point => point.load === entries.at(-1).load).slice(-8);
    const mini = page.locator('.ln[data-exercise-id="' + id + '"] .mini');
    assert.equal(await mini.getAttribute('viewBox'), '0 0 64 28');
    const min = Math.min(...points.map(point => point.value));
    const max = Math.max(...points.map(point => point.value));
    const y = point => min === max ? 14 : 24 - (point.value - min) / (max - min) * 20;
    const expected = 'M0 ' + y(points[0]) + points.slice(1).map((point, index) =>
      ' L' + (index + 1) / (points.length - 1) * 64 + ' ' + y(point)).join('');
    assert.equal(await mini.locator('path').getAttribute('d'), expected);
    assert.equal(await mini.locator('path').getAttribute('stroke'), 'var(--ai)');
  }
  assert.deepEqual(errors, []);
  await close();
});

test('first use adds an exercise without creating a session; an empty menu opens the picker', async () => {
  const { page, errors, close } = await open();
  assert.match(await page.textContent('.see'), /まず種目を登録しましょう/);
  await press(page, '＋ 新しい種目').click();
  await page.getByLabel('名前', { exact: true }).fill('腕立て伏せ');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  assert.equal(await page.locator('.ln .name').textContent(), '腕立て伏せ初回');
  assert.equal((await stored(page)).sessions.length, 0);
  await page.evaluate(() => localStorage.setItem('kintore:menu',
    JSON.stringify({ kind: 'custom', exerciseIds: [] })));
  await page.reload();
  await press(page, '始める').click();
  assert.equal(await sheet(page).getAttribute('aria-label'), '今日の種目');
  assert.ok(await sheet(page).getByRole('button', { name: '決定' }).isDisabled());
  await sheet(page).locator('.check').click();
  await sheet(page).getByRole('button', { name: '決定' }).click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'train');
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.equal((await stored(page)).sessions.length, 0);
  await leaveTraining(page);
  assert.equal(await page.locator('.ln .word').textContent(), '初回');
  assert.deepEqual(errors, []);
  await close();
});

test('rest day and body weight are recorded once per day', async () => {
  const { page, close } = await open({ data: fixture() });
  for (const reason of ['疲れ', '予定']) {
    await pill(page, '今日は休む').click();
    await sheet(page).getByRole('button', { name: reason, exact: true }).click();
    await page.waitForFunction(() => !window.history.state?.sheet);
  }
  assert.match(await page.textContent('#toast'), /休むのも練習/);
  await pill(page, '体重を記録').click();
  await sheet(page).getByRole('button', { name: '体重を減らす', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await pill(page, '体重を記録').click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  const data = await stored(page);
  const today = localDate(new Date());
  assert.equal(data.skips.filter(s => s.date === today).length, 1);
  assert.equal(data.skips.find(s => s.date === today).reason, '予定');
  const todays = data.body.filter(b => b.date === today);
  assert.equal(todays.length, 1);
  assert.equal(todays[0].kg, Math.round(todays[0].kg * 10) / 10);
  await close();
});

test('first body entry accepts weight with no waist', async () => {
  const data = fixture();
  data.body = [];
  const { page, close } = await open({ data });
  await pill(page, '体重を記録').click();
  await sheet(page).getByLabel('体重 kg', { exact: true }).fill('68.4');
  await sheet(page).getByRole('button', { name: 'ウエストなし', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  assert.deepEqual((await stored(page)).body, [{ date: localDate(new Date()), kg: 68.4, waist: null }]);
  await close();
});

test('settings: add a band; invalid or cancelled import leaves data untouched', async () => {
  const { page, close } = await open({ data: fixture() });
  await settings(page);
  await page.getByRole('button', { name: '＋ バンド', exact: true }).click();
  await page.getByLabel('名前', { exact: true }).fill('青');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'settings');
  assert.deepEqual((await stored(page)).bands.map(b => b.name + b.order), ['黄1', '赤2', '黒3', '青4']);
  const before = await page.evaluate(() => localStorage.getItem('kintore:data'));
  await page.setInputFiles('input[type=file]', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('読み込めないファイルです'));
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:data')), before);
  await page.setInputFiles('input[type=file]', {
    name: 'data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture()))
  });
  await page.locator('#confirm-dialog button[value=cancel]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:data')), before);
  await close();
});

test('corrupt saved data is kept aside, not overwritten', async () => {
  const { page, close } = await open({ data: '{broken' });
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:data:broken')), '{broken');
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:data')), '{broken');
  await close();
});

test('GitHub: changes are pushed, failures retried, coach posts shown', async () => {
  const github = { owner: 'me', repo: 'data', token: 't', lastSyncAt: null, dirty: false };
  const { page, api, close } = await open({ data: fixture(), github });
  api.posts = [{ id: 'r1', at: '2099-01-01T07:30:00+09:00', kind: 'reply',
    quote: '肩が重い', text: '1セット目だけ狙えば十分。' }, { broken: true }];
  await page.reload();
  await page.waitForFunction(() => localStorage.getItem('kintore:posts')?.includes('1セット目だけ狙えば十分'));
  await tab(page, '記録').click();
  await page.locator('.quick .pill').filter({ hasText: /^新着 / }).click();
  assert.match(await sheet(page).textContent(), /1セット目だけ狙えば十分/);
  await closeSheet(page);
  await home(page);
  await pill(page, '今日は休む').click();
  await sheet(page).getByRole('button', { name: '予定', exact: true }).click();
  await page.waitForTimeout(6000);
  assert.ok(api.puts.at(-1)?.skips.some(s => s.reason === '予定'));
  assert.equal(api.puts.at(-1).exercises[0].name, '腕立て伏せ');
  api.fail = true;
  await pill(page, '今日は休む').click();
  await sheet(page).getByRole('button', { name: '風邪', exact: true }).click();
  await page.waitForTimeout(6000);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:github')).dirty), true);
  api.fail = false;
  const count = api.puts.length;
  await page.reload();
  await page.waitForTimeout(1500);
  assert.ok(api.puts.length > count, 'retried on next start');
  await close();
});

test('GitHub restore requires confirmation and preserves the remote data', async () => {
  const github = { owner: 'me', repo: 'data', token: 't' };
  const { page, api, close } = await open({ data: fixture(), github });
  const remote = fixture();
  remote.exercises[0].name = '復元した種目';
  api.remote = Buffer.from(JSON.stringify(remote)).toString('base64');
  await settings(page);
  await page.getByRole('button', { name: 'GitHub から復元', exact: true }).click();
  await page.locator('#confirm-dialog button[value=cancel]').click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).exercises[0].name, '腕立て伏せ');
  await page.getByRole('button', { name: 'GitHub から復元', exact: true }).click();
  await page.locator('#confirm-dialog button[value=confirm]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('kintore:data')).exercises[0].name === '復元した種目');
  assert.equal((await stored(page)).sessions.length, remote.sessions.length);
  await close();
});

test('home leaves news unread; records news puts its label in the text block', async () => {
  const data = fixture();
  const last = data.sessions.at(-1);
  last.sets[0].reps = 19;
  const { page, close } = await open({ data, extra: {
    'kintore:posts': [{ id: 'reply', at: '2099-01-01', kind: 'reply', text: '肩を休める。' }]
  } });
  assert.equal(await page.locator('.feed .post').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:seen')), null);
  await tab(page, '記録').click();
  await page.locator('.quick .pill').filter({ hasText: /^新着 / }).click();
  assert.deepEqual(await sheet(page).locator('.post').first().evaluateAll(posts =>
    posts.map(post => ({
      labels: [...post.querySelectorAll('b')].map(b => b.textContent),
      separate: post.querySelectorAll('.k').length,
      blocks: post.children.length
    }))), [
    { labels: ['コーチ'], separate: 0, blocks: 1 }
  ]);
  assert.equal(await sheet(page).locator('.post').first().textContent(), 'コーチ肩を休める。');
  await close();
});

test('counter starts at the actual previous value, steps, clamps and waits for completion to judge', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await page.evaluate(() => {
    window.vibrations = [];
    navigator.vibrate = value => { window.vibrations.push(value); return true; };
  });
  await press(page, '始める').click();
  const today = localDate(new Date());
  const initial = prefill(data, 'e1', today)[0].reps;
  const target = line(data, 'e1', today).value;
  const number = page.locator('.counter .num');
  const minus = press(page, '腕立て伏せ 1回減らす');
  const plus = press(page, '腕立て伏せ 1回増やす');
  assert.equal(await number.textContent(), String(initial));
  assert.equal(await page.textContent('.prev'), 'ライン ' + target + ' ・ 1セット目');
  assert.equal(await page.textContent('.hint2'), '数字を押すと直接入力');
  assert.equal(await page.locator('.lineon, .counter .over, .sets .cur .over').count(), 0);
  await minus.click();
  assert.equal(await number.textContent(), String(initial - 1));
  await plus.click();
  assert.equal(await number.textContent(), String(initial));
  assert.deepEqual(await page.evaluate(() => window.vibrations), [5, 5]);
  await plus.evaluate(button => { for (let i = 0; i < 210; i++) button.click(); });
  assert.equal(await number.textContent(), '200');
  assert.equal(await page.locator('.lineon, .counter .over, .sets .cur .over, .verdict').count(), 0);
  assert.ok(!(await page.textContent('.see')).includes('突破'));
  await plus.click();
  assert.equal(await number.textContent(), '200');
  await minus.evaluate(button => { for (let i = 0; i < 210; i++) button.click(); });
  assert.equal(await number.textContent(), '0');
  const count = await page.evaluate(() => window.vibrations.length);
  await minus.click();
  assert.equal(await number.textContent(), '0');
  assert.equal(await page.evaluate(() => window.vibrations.length), count);
  await plus.evaluate(button => { for (let i = 0; i < 210; i++) button.click(); });
  await complete(page);
  assert.equal(await page.locator('.verdict b').textContent(), '突破');
  assert.equal(await page.locator('.sets .done .over').count(), 1);
  assert.equal(await page.locator('.lineon, .counter .over').count(), 0);
  assert.equal(await number.textContent(), String(prefill(data, 'e1', today)[1].reps));
  await press(page, '休憩を終える').click();
  assert.equal(await page.locator('.lineon').count(), 0);
  await swipe(page, -100, 0, '.counter');
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  await swipe(page, 100);
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('time counter starts at previous seconds, steps by five and clamps without an early verdict', async () => {
  const data = fixture();
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e3'] }
  } });
  await press(page, '始める').click();
  const number = page.locator('.counter .num');
  const minus = press(page, 'プランク 5秒減らす');
  const plus = press(page, 'プランク 5秒増やす');
  const initial = prefill(data, 'e3', localDate(new Date()))[0].sec;
  assert.equal(await number.textContent(), String(initial));
  assert.equal(await page.locator('.lineon, .counter .over, .sets .cur .over').count(), 0);
  await minus.click();
  assert.equal(await number.textContent(), String(initial - 5));
  await plus.click();
  assert.equal(await number.textContent(), String(initial));
  await plus.click();
  assert.equal(await number.textContent(), String(initial + 5));
  assert.equal(await page.locator('.lineon, .counter .over, .sets .cur .over').count(), 0);
  await minus.evaluate(button => { for (let i = 0; i < 140; i++) button.click(); });
  assert.equal(await number.textContent(), '0');
  await plus.evaluate(button => { for (let i = 0; i < 140; i++) button.click(); });
  assert.equal(await number.textContent(), '600');
  await plus.click();
  assert.equal(await number.textContent(), '600');
  await close();
});

test('counter long press repeats after 400ms and stops on release, exit and cancel', async () => {
  const { page, close } = await open({ data: fixture() });
  await page.clock.install();
  await press(page, '始める').click();
  const number = page.locator('.counter .num');
  const plus = press(page, '腕立て伏せ 1回増やす');
  const initial = Number(await number.textContent());
  const box = await plus.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  assert.equal(await number.textContent(), String(initial + 1));
  await page.clock.runFor(399);
  assert.equal(await number.textContent(), String(initial + 1));
  await page.clock.runFor(401);
  const held = Number(await number.textContent());
  assert.ok(held > initial + 1);
  await page.mouse.up();
  await page.clock.runFor(500);
  assert.equal(await number.textContent(), String(held));
  await page.mouse.down();
  await page.mouse.move(box.x - 10, box.y);
  const left = await number.textContent();
  await page.clock.runFor(800);
  assert.equal(await number.textContent(), left);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await plus.dispatchEvent('pointercancel');
  const cancelled = await number.textContent();
  await page.clock.runFor(800);
  assert.equal(await number.textContent(), cancelled);
  await page.mouse.up();
  await plus.focus();
  await page.keyboard.press('Enter');
  assert.equal(await number.textContent(), String(Number(cancelled) + 1));
  await close();
});

test('a first set without a line keeps its previous prefill and has no line feedback', async () => {
  const data = fixture();
  data.sessions = [];
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1'] }
  } });
  await press(page, '始める').click();
  assert.equal(await page.textContent('.counter .num'), String(prefill(data, 'e1', localDate(new Date()))[0].reps));
  assert.equal(await page.locator('.lineon, .counter .over').count(), 0);
  await close();
});

test('settings has its original sections without exercise, template or bottom navigation controls', async () => {
  const { page, close } = await open({ data: fixture() });
  await page.setViewportSize({ width: 360, height: 640 });
  await settings(page);
  assert.deepEqual(await page.locator('.see > section > h2').allTextContents(),
    ['バンド', '一般', 'GitHub 保存', 'バックアップ', 'AIに相談']);
  assert.equal(await page.locator('.press button').count(), 0);
  assert.equal(await page.locator('.nav').count(), 0);
  assert.equal(await page.getByRole('button', { name: '＋ バンド', exact: true }).count(), 1);
  await principles(page);
  await close();
});

test('exercise rows open editors; saving and cancelling return to exercises', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await tab(page, '種目').click();
  assert.equal(await page.textContent('.h1'), '種目');
  assert.deepEqual(await page.locator('.group').allTextContents(), ['胸', '背中', '体幹', 'テンプレート']);
  assert.equal(await page.locator('.ex[data-exercise-id=e1] small').textContent(), '自重');
  await page.locator('.ex[data-exercise-id=e1]').click();
  assert.equal(await page.getByLabel('名前', { exact: true }).inputValue(), '腕立て伏せ');
  await page.getByLabel('名前', { exact: true }).fill('腕立て');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.match(await page.locator('.ex[data-exercise-id=e1]').textContent(), /腕立て/);
  assert.equal((await stored(page)).exercises[0].name, '腕立て');
  await press(page, '＋ 新しい種目').click();
  assert.equal(await page.getByLabel('名前', { exact: true }).inputValue(), '');
  await page.getByLabel('名前', { exact: true }).fill('スクワット');
  await page.getByRole('button', { name: '脚', exact: true }).click();
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.ok((await stored(page)).exercises.some(ex => ex.name === 'スクワット' && ex.part === '脚'));
  await press(page, '＋ 新しい種目').click();
  await page.getByLabel('名前', { exact: true }).fill('保存しない');
  await backTo(page, 'exercises');
  assert.ok(!(await stored(page)).exercises.some(ex => ex.name === '保存しない'));
  await page.getByRole('button', { name: '＋ テンプレート', exact: true }).click();
  await page.getByLabel('名前', { exact: true }).fill('新しいメニュー');
  await page.getByLabel('種目を追加').selectOption('e1');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  await page.locator('.ex').filter({ hasText: '新しいメニュー' }).click();
  assert.equal(await page.getByLabel('名前', { exact: true }).inputValue(), '新しいメニュー');
  await press(page, 'キャンセル').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.deepEqual(errors, []);
  await close();
});

test('exercise ordering, confirmed deletion and restore preserve past records', async () => {
  const data = fixture();
  data.exercises[3].archived = true;
  const { page, errors, close } = await open({ data });
  await tab(page, '種目').click();
  assert.equal(await page.getByRole('button', { name: 'アーカイブ済みを表示', exact: true }).count(), 0);
  assert.equal(await page.locator('.restore[data-exercise-id=e4]').count(), 1);
  await page.locator('.restore[data-exercise-id=e4] .pill').click();
  assert.equal((await stored(page)).exercises.find(ex => ex.id === 'e4').archived, false);
  assert.equal(await page.locator('.ex[data-exercise-id=e4]').count(), 1);
  await page.locator('.ex[data-exercise-id=e1]').click();
  assert.equal(await press(page, 'アーカイブ').count(), 0);
  await page.getByRole('button', { name: '腕立て伏せを下へ', exact: true }).click();
  assert.deepEqual((await stored(page)).exercises.slice(0, 2).map(ex => ex.id), ['e2', 'e1']);
  await press(page, '削除').click();
  await page.locator('#confirm-dialog button[value=cancel]').click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).exercises.find(ex => ex.id === 'e1').archived, false);
  await press(page, '削除').click();
  await page.locator('#confirm-dialog button[value=confirm]').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.equal((await stored(page)).exercises.find(ex => ex.id === 'e1').archived, true);
  assert.equal(await page.locator('.ex[data-exercise-id=e1]').count(), 0);
  assert.equal(await page.locator('.group').last().textContent(), '削除した種目');
  await principles(page);
  await page.locator('.restore[data-exercise-id=e1] .pill').click();
  assert.equal((await stored(page)).exercises.find(ex => ex.id === 'e1').archived, false);
  assert.equal(await page.locator('.ex[data-exercise-id=e1]').count(), 1);
  assert.deepEqual((await stored(page)).sessions, data.sessions);
  assert.deepEqual(errors, []);
  await close();
});

test('complete immediately saves, shows first-set verdict and rest bar, then summary', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await page.clock.install();
  await page.evaluate(() => {
    window.vibrations = [];
    navigator.vibrate = value => { window.vibrations.push(value); return true; };
  });
  await press(page, '始める').click();
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  const number = page.locator('.counter .num');
  const target = line(data, 'e1', localDate(new Date())).value;
  await press(page, '腕立て伏せ 1回増やす').click();
  const reps = Number(await number.textContent());
  await complete(page);
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.sets[0].reps, reps);
  assert.equal(session.date, localDate(new Date()));
  assert.equal(await page.locator('.verdict b').textContent(), reps >= target ? '突破' : 'あと' + (target - reps));
  assert.equal(await page.locator('.verdict .num').textContent(), String(reps));
  assert.equal(await page.locator('.restbar .num').textContent(), '1:30');
  assert.equal(await page.locator('.sets .r').count(), 3);
  assert.equal(await page.locator('.sets .done').count(), 1);
  const progress = () => page.locator('.restbar .track > div').evaluate(el => parseFloat(el.style.width));
  const initialProgress = await progress();
  await page.clock.runFor(3000);
  assert.equal(await page.locator('.verdict').count(), 0);
  assert.ok(await progress() < initialProgress);
  await press(page, '+15秒').click();
  assert.equal(await page.locator('.restbar .num').textContent(), '1:42');
  await press(page, '休憩を終える').click();
  assert.equal(await page.locator('.restbar').count(), 0);
  assert.equal(await page.locator('.sets .done .td').textContent(), String(reps));
  await complete(page);
  assert.equal(await page.locator('.verdict').count(), 0);
  await page.clock.runFor(90000);
  assert.equal(await page.locator('.restbar').count(), 0);
  assert.ok(await page.evaluate(() => window.vibrations.some(v => JSON.stringify(v) === '[300,100,300]')));
  await complete(page);
  await press(page, '休憩を終える').click();
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 3);
  assert.equal(await page.locator('.press .counter').count(), 0);
  assert.equal(await press(page, '次の種目へ ▶').count(), 1);
  assert.deepEqual(await page.locator('.nav button').allTextContents(), ['ホーム', '◀ 前', 'メモ']);
  await press(page, '＋ もう1セット').click();
  assert.equal(await page.locator('.counter').count(), 1);
  assert.equal(await page.locator('.sets .r').count(), 4);
  assert.equal(await page.locator('.sets .cur .no').textContent(), '4');
  assert.equal(await number.textContent(), String((await stored(page)).sessions.at(-1).sets.at(-1).reps));
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 3);
  await complete(page);
  await press(page, '休憩を終える').click();
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 4);
  await press(page, '次の種目へ ▶').click();
  await press(page, '次 ▶').click();
  await complete(page);
  assert.equal(await press(page, 'トレーニングを終える').count(), 1);
  assert.equal(await press(page, '終了').count(), 0);
  await press(page, 'トレーニングを終える').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'summary');
  assert.match(await page.textContent('.see'), /今日の記録.*ライン突破 [0-2] \/ 2.*合計回数/s);
  await principles(page);
  await press(page, 'ホームへ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:training')), null);
  await press(page, '始める').click();
  assert.equal(await page.locator('.press .counter').count(), 0);
  assert.equal(await press(page, '次の種目へ ▶').count(), 1);
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 5);
  await press(page, '＋ もう1セット').click();
  assert.equal(await page.locator('.sets .cur .no').textContent(), '5');
  await complete(page);
  assert.equal((await stored(page)).sessions.length, data.sessions.length + 1);
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 6);
  assert.equal(await page.locator('.verdict').count(), 0, 'same-day first set is not judged again');
  assert.deepEqual(errors, []);
  await close();
});

test('training sheet keeps notes, coach opt-in, additions and stage switching', async () => {
  const data = fixture();
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1'] }
  } });
  await press(page, '始める').click();
  await press(page, 'メモ').click();
  await principles(page);
  await sheet(page).getByLabel('メモ', { exact: true }).fill('肩が重い');
  await sheet(page).getByRole('button', { name: 'コーチに送る：オフ', exact: true }).click();
  assert.equal(await sheet(page).getByRole('button', { name: 'セットを追加', exact: true }).count(), 0);
  await closeSheet(page);
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  await complete(page);
  let session = (await stored(page)).sessions.at(-1);
  assert.equal(session.note, '肩が重い');
  assert.equal(session.toCoach, true);
  await press(page, '休憩を終える').click();
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: '次の段階へ切り替え', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.textContent('.exname'), '足上げ腕立て');
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: '種目を追加', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'バンドロウ', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  await press(page, '黒').click();
  await complete(page);
  session = (await stored(page)).sessions.at(-1);
  assert.equal(session.sets.at(-1).bandId, 'k');
  await principles(page);
  await leaveTraining(page);
  await close();
});

test('light mode and weight controls fit the small viewport, including rest and summary', async () => {
  const data = fixture();
  data.exercises.push({ id: 'weight', name: 'ダンベル', type: 'weight', part: '腕', nextId: null, archived: false });
  const { page, errors, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['weight'] }
  } });
  await page.setViewportSize({ width: 360, height: 640 });
  await startLight(page);
  await principles(page);
  await press(page, '重さを増やす').click();
  await complete(page);
  await principles(page);
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.light, true);
  assert.equal(session.sets[0].kg, 5.5);
  assert.equal(await page.locator('.verdict b').textContent(), '基準');
  await press(page, 'メモ').click();
  await principles(page);
  await closeSheet(page);
  await press(page, 'トレーニングを終える').click();
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('records list, actual daily chart, stats, load colors and twelve-week heat follow stored sets', async () => {
  const data = fixture();
  data.sessions[2].light = true;
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  assert.equal(await page.textContent('.h1'), '記録');
  const recorded = new Set(data.sessions.flatMap(session => session.sets.map(set => set.exerciseId)));
  assert.deepEqual(await page.locator('.rec').evaluateAll(rows => rows.map(row => row.dataset.exerciseId)),
    [...data.exercises.filter(ex => recorded.has(ex.id)).map(ex => ex.id), 'body']);
  const today = localDate(new Date());
  for (const ex of data.exercises.filter(ex => recorded.has(ex.id))) {
    const row = page.locator('.rec[data-exercise-id="' + ex.id + '"]');
    assert.equal(await row.locator('.num').textContent(), String(line(data, ex.id, today).value ?? '—'));
    const text = await row.locator('b small').textContent();
    assert.ok(text.includes('突破 ' + clearCount(data, ex.id) + '回 ・ 前回 '));
    assert.ok(!text.includes('累計'));
    const sets = data.sessions.at(-1).sets.filter(set => set.exerciseId === ex.id);
    const expected = ex.type === 'band'
      ? '黒 ' + sets.map(set => set.reps).join('・')
      : sets.map(set => ex.type === 'time' ? set.sec : set.reps).join(' ・ ') +
        (ex.type === 'time' ? '秒' : '');
    assert.ok(text.endsWith(expected));
  }
  assert.equal(await page.locator('.heat i').count(), 12);
  assert.deepEqual(await page.locator('.heat i').evaluateAll(cells =>
    cells.map(cell => cell.className)), weekHeat(data, today).map(n => n >= 3 ? 'd' : n ? 'l' : ''));
  assert.equal(await page.locator('.press').evaluate(dock => dock.getBoundingClientRect().height), 0);

  for (const id of ['e1', 'e2', 'e3']) {
    await page.locator('.rec[data-exercise-id="' + id + '"]').click();
    const ex = data.exercises.find(ex => ex.id === id);
    const points = setHistory(data, id);
    const amounts = points.flatMap(point => [point.value, ...point.others]);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const y = amount => min === max ? 87 : 136 - (amount - min) / (max - min) * 98;
    const first = new Date(points[0].date + 'T12:00:00').getTime();
    const last = new Date(points.at(-1).date + 'T12:00:00').getTime();
    const x = point => first === last ? 172 :
      32 + (new Date(point.date + 'T12:00:00').getTime() - first) / (last - first) * 280;
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'detail');
    assert.equal(await page.textContent('.exname'), ex.name);
    assert.equal(await tab(page, '記録').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.chart').getAttribute('viewBox'), '0 0 316 175');
    assert.equal(await page.locator('.heat').count(), 0);
    const circles = await page.locator('.chart circle.first').evaluateAll(nodes =>
      nodes.map(node => ({
        x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')),
        r: Number(node.getAttribute('r')), fill: node.getAttribute('fill')
      })));
    assert.deepEqual(circles, points.map(point => ({
      x: x(point), y: y(point.value), r: 4,
      fill: point.load === points.at(-1).load ? 'var(--shu)' : 'var(--ai)'
    })));
    assert.deepEqual(await page.locator('.chart circle.other').evaluateAll(nodes =>
      nodes.map(node => ({
        x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')),
        r: Number(node.getAttribute('r')), fill: node.getAttribute('fill')
      }))), points.flatMap(point => point.others.map(amount => ({
      x: x(point), y: y(amount), r: 3, fill: '#B5BECC'
    }))));
    const expectedPaths = [];
    for (let start = 0; start < points.length;) {
      let end = start;
      while (end + 1 < points.length && points[end + 1].load === points[start].load) end++;
      if (end > start) {
        expectedPaths.push('M' + x(points[start]) + ' ' + y(points[start].value) +
          points.slice(start + 1, end + 1).map(point => ' L' + x(point) + ' ' + y(point.value)).join(''));
      }
      start = end + 1;
    }
    assert.deepEqual(await page.locator('.chart path').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('d'))), expectedPaths);
    const sameLoad = data.sessions.flatMap(session => session.sets)
      .filter(set => set.exerciseId === id && load(data, ex, set) === points.at(-1).load);
    assert.deepEqual(await page.locator('.stat .num').allTextContents(), [
      String(Math.max(...sameLoad.map(set => value(ex, set)))),
      String(points.at(-1).value), String(line(data, id, today).value ?? '—')
    ]);
    assert.deepEqual(await page.locator('.stat > div > p').allTextContents(),
      ['自己ベスト', '前回', 'ライン']);
    const sessions = [...data.sessions].reverse();
    assert.deepEqual(await page.locator('.hist .r').evaluateAll(rows => rows.map(row => row.dataset.date)),
      sessions.map(session => session.date));
    if (id === 'e1') {
      for (const session of sessions) {
        const sets = session.sets.filter(set => set.exerciseId === id);
        const row = page.locator('.hist .r[data-date="' + session.date + '"]');
        assert.equal(await row.locator('.v').textContent(),
          sets.map(set => set.reps).join(' ・ ') + sets.length + 'セット');
        assert.equal(await row.locator('.v b').count(),
          firstSetResult(data, id, session.date, sets[0]).kind === 'clear' ? 1 : 0);
      }
    }
    if (id === 'e2') {
      assert.ok(await page.locator('.chart path.old').count());
      assert.ok(await page.locator('.chart path.now').count());
      assert.match(await page.locator('.chart').textContent(), /黒へ/);
    }
    await principles(page);
    await page.getByRole('button', { name: '‹ 記録', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'records');
  }
  await backTo(page, 'today');
  assert.deepEqual(errors, []);
  await close();
});

test('body item shows daily points, seven-day average and four-week difference', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  const today = localDate(new Date());
  const previous = new Date(today + 'T12:00:00');
  previous.setDate(previous.getDate() - 28);
  const average = bodyAvg7(data.body, today, 'kg');
  const delta = average - bodyAvg7(data.body, localDate(previous), 'kg');
  const row = page.locator('.rec[data-exercise-id=body]');
  assert.equal(await row.locator('.num').textContent(), data.body.at(-1).kg.toFixed(1));
  assert.equal(await row.locator('small').textContent(), '7日平均 ' + average.toFixed(1) + 'kg');
  assert.match(await row.locator('.mini path').getAttribute('d'), /L/);
  assert.equal((await row.locator('.mini path').getAttribute('d')).match(/L/g).length,
    Math.min(8, data.body.length) - 1);
  await row.click();
  assert.deepEqual(await page.locator('.stat .k').allTextContents(),
    ['最新', '7日平均', '4週間前との差']);
  assert.deepEqual(await page.locator('.stat .num').allTextContents(), [
    data.body.at(-1).kg.toFixed(1), average.toFixed(1),
    (delta > 0 ? '+' : '') + delta.toFixed(1)
  ]);
  assert.equal(await page.locator('.stairs circle').count(), data.body.length);
  assert.equal(await page.locator('.stairs polyline').count(), 1);
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
  }
  assert.deepEqual(errors, []);
  await close();
});

test('one actual first set is drawn as a point and has no miniature line', async () => {
  const data = fixture();
  data.sessions = [data.sessions[0]];
  data.body = [];
  const { page, errors, close } = await open({ data });
  assert.equal(await page.locator('.ln[data-exercise-id=e1] .mini path').count(), 0);
  await tab(page, '記録').click();
  await page.locator('.rec[data-exercise-id=e1]').click();
  assert.equal(await page.locator('.chart circle.first').count(), 1);
  assert.equal(await page.locator('.chart circle.other').count(), 2);
  assert.equal(await page.locator('.chart path').count(), 0);
  assert.equal(await page.locator('.exdots').count(), 0);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('records empty state contains only its explanation and optional unread news', async () => {
  const data = fixture();
  data.sessions = [];
  data.body = [];
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  assert.equal(await page.textContent('.h1'), '記録');
  assert.equal(await page.textContent('.empty b'), 'まだ記録がありません');
  assert.equal(await page.textContent('.empty p'), '1回トレーニングすると、ここに種目ごとの伸びが階段で出ます。');
  assert.equal(await page.locator('.rec, .heat, .stat, .see .pill').count(), 0);
  await page.evaluate(() => localStorage.setItem('kintore:posts', JSON.stringify([
    { id: 'unread', at: '2099-01-01', kind: 'finding', text: '新しい発見' }
  ])));
  await tab(page, '種目').click();
  await tab(page, '記録').click();
  assert.equal(await page.locator('.see .pill').count(), 1);
  assert.equal(await page.locator('.empty .pill').textContent(), '新着 1');
  await pill(page, '新着 1').click();
  assert.match(await sheet(page).textContent(), /新しい発見/);
  await closeSheet(page);
  assert.equal(await page.locator('.see .pill').count(), 0);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('records calendar edits values and notes, deletes sets and confirms day deletion', async () => {
  const data = fixture();
  const date = data.sessions.at(-1).date;
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await pill(page, '日付から探す').click();
    assert.equal(await sheet(page).getAttribute('aria-label'), '日付から探す');
    assert.equal(await sheet(page).locator('.calendar button').count(), 84);
    await principles(page);
    await sheet(page).getByRole('button', { name: date + ' トレーニング', exact: true }).click();
    await principles(page);
    await sheet(page).getByRole('button', { name: '腕立て伏せ 1セットを増やす', exact: true }).click();
    const expected = data.sessions.at(-1).sets[0].reps + 1;
    assert.equal((await stored(page)).sessions.find(s => s.date === date).sets[0].reps, expected);
    data.sessions.at(-1).sets[0].reps = expected;
    await sheet(page).getByLabel('メモ', { exact: true }).fill('今日は軽い');
    await closeSheet(page);
  }
  await pill(page, '日付から探す').click();
  await sheet(page).getByRole('button', { name: date + ' トレーニング', exact: true }).click();
  assert.equal(await sheet(page).getByLabel('メモ', { exact: true }).inputValue(), '今日は軽い');
  const count = (await stored(page)).sessions.find(s => s.date === date).sets.length;
  await sheet(page).getByRole('button', { name: '削除', exact: true }).first().click();
  assert.equal((await stored(page)).sessions.find(s => s.date === date).sets.length, count - 1);
  await sheet(page).getByRole('button', { name: 'この日の記録を削除', exact: true }).click();
  await principles(page);
  await page.locator('#confirm-dialog button[value=cancel]').click();
  await page.waitForFunction(() => document.querySelector('#confirm-dialog').open === false);
  assert.ok((await stored(page)).sessions.some(s => s.date === date));
  await sheet(page).getByRole('button', { name: 'この日の記録を削除', exact: true }).click();
  await page.locator('#confirm-dialog button[value=confirm]').click();
  // The delete is saved after the confirm dialog's promise resolves.
  await page.waitForFunction(d => !JSON.parse(localStorage.getItem('kintore:data')).sessions.some(s => s.date === d), date);
  assert.match(await sheet(page).textContent(), /記録なし/);
  await closeSheet(page);
  await page.reload();
  assert.ok(!(await stored(page)).sessions.some(s => s.date === date));
  assert.deepEqual(errors, []);
  await close();
});

test('records news shows all items in time order and marks them read', async () => {
  const posts = [
    { id: 'older-reply', at: '2098-01-01', kind: 'reply', text: '返事', quote: 'メモ' },
    { id: 'newer', at: '2099-01-01', kind: 'reading', text: '読み物',
      source: { title: '資料', url: 'https://example.com' } },
    { id: 'third', at: '2097-01-01', kind: 'finding', text: '発見' }
  ];
  const data = fixture();
  const { page, errors, close } = await open({ data, extra: { 'kintore:posts': posts } });
  await tab(page, '記録').click();
  await page.locator('.quick .pill').filter({ hasText: /^新着 / }).click();
  const items = mergeFeed(feed(data, localDate(new Date())), posts, [])
    .sort((a, b) => b.at.localeCompare(a.at));
  assert.equal(await sheet(page).locator('.post').count(), items.length);
  assert.match(await sheet(page).locator('.post').first().textContent(), /読み物/);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:seen')));
  assert.ok(items.every(item => seen.includes(item.id)));
  await principles(page);
  await closeSheet(page);
  assert.equal(await pill(page, '新着 0').count(), 1);
  await home(page);
  assert.equal(await page.locator('.feed > .k').textContent(), '今週');
  assert.equal(await page.locator('.feed .post').count(), 0);
  assert.deepEqual(errors, []);
  await close();
});

test('time training table labels seconds and tracks the current value', async () => {
  const data = fixture();
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e3'] }
  } });
  await press(page, '始める').click();
  assert.deepEqual(await page.locator('.sets .hd span').allTextContents(),
    ['セット', '前回(秒)', '今日(秒)', '']);
  assert.equal(await page.locator('.sets .cur .td').textContent(),
    await page.locator('.counter .num').textContent());
  await press(page, 'プランク 5秒増やす').click();
  assert.equal(await page.locator('.sets .cur .td').textContent(),
    await page.locator('.counter .num').textContent());
  const bigGap = await page.locator('.big').evaluate(big =>
    big.querySelector('small').getBoundingClientRect().left -
    big.querySelector('.num').getBoundingClientRect().right);
  assert.ok(Math.abs(bigGap - 4) < 1);
  await close();
});

test('planned table uses the previous set number and only adds an explicit fourth set', async () => {
  const data = fixture();
  const previous = data.sessions.at(-1).sets.filter(set => set.exerciseId === 'e1');
  const { page, errors, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'template', templateId: 't1' }
  } });
  await page.clock.install();
  await press(page, '始める').click();
  assert.deepEqual(await page.locator('.sets .r .pv').allTextContents(),
    previous.map(set => String(set.reps)));
  assert.deepEqual(await page.locator('.sets .r:not(.cur) .td').allTextContents(), ['—', '—']);
  for (let n = 1; n <= 3; n++) {
    assert.equal(await page.locator('.sets .cur .no').textContent(), String(n));
    assert.equal(await press(page, n + 'セット目を完了').count(), 1);
    await complete(page);
    assert.equal(await page.locator('.sets .done').count(), n);
    await press(page, '休憩を終える').click();
  }
  const before = await stored(page);
  assert.equal(before.sessions.at(-1).sets.length, 3);
  assert.equal(await page.locator('.counter, .sets .cur').count(), 0);
  assert.equal(await press(page, '次の種目へ ▶').count(), 1);
  await page.clock.runFor(10000);
  assert.deepEqual((await stored(page)).sessions, before.sessions);
  await principles(page);
  await press(page, '＋ もう1セット').click();
  assert.equal(await page.locator('.sets .cur .no').textContent(), '4');
  assert.equal(await page.locator('.sets .cur .pv').textContent(), '—');
  assert.equal(await page.locator('.counter .num').textContent(),
    String(before.sessions.at(-1).sets.at(-1).reps));
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 3);
  await complete(page);
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 4);
  assert.equal(await press(page, '次の種目へ ▶').count(), 1);
  assert.deepEqual(errors, []);
  await close();
});

test('done rows edit during rest, delete without confirmation and undo in place for four seconds', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await page.clock.install();
  await press(page, '始める').click();
  await complete(page);
  await page.locator('.sets .done').first().click();
  assert.equal(await sheet(page).getAttribute('aria-label'), '1セット目を直す');
  assert.equal(await page.locator('dialog[open]').count(), 1);
  const oldValue = (await stored(page)).sessions.at(-1).sets[0].reps;
  await sheet(page).getByRole('button', { name: '腕立て伏せ 1回減らす', exact: true }).click();
  assert.equal((await stored(page)).sessions.at(-1).sets[0].reps, oldValue);
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).sessions.at(-1).sets[0].reps, oldValue - 1);
  assert.equal(await page.locator('.sets .done .td').textContent(), String(oldValue - 1));
  assert.equal(await page.locator('.restbar').count(), 1);
  await press(page, '休憩を終える').click();
  await complete(page);
  await press(page, '休憩を終える').click();
  await complete(page);
  await press(page, '休憩を終える').click();
  const before = (await stored(page)).sessions.at(-1);
  await page.locator('.sets .done').nth(1).click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.locator('#confirm-dialog[open]').count(), 0);
  assert.match(await page.textContent('#toast'), /2セット目を消しました/);
  assert.deepEqual((await stored(page)).sessions.at(-1).sets,
    before.sets.filter((_, index) => index !== 1));
  await principles(page);
  await page.locator('#toast').getByRole('button', { name: '元に戻す', exact: true }).click();
  assert.deepEqual((await stored(page)).sessions.at(-1).sets, before.sets);
  assert.equal(await page.locator('.press .counter').count(), 0);
  await page.locator('.sets .done').nth(1).click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await page.clock.runFor(3999);
  assert.equal(await page.locator('#toast').isVisible(), true);
  await page.clock.runFor(1);
  assert.equal(await page.locator('#toast').isVisible(), false);
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 2);
  assert.deepEqual(errors, []);
  await close();
});

test('records day rows edit in the same sheet, restore positions and expire inline undo', async () => {
  const data = fixture();
  const date = data.sessions.at(-1).date;
  const { page, errors, close } = await open({ data });
  await page.clock.install();
  await tab(page, '記録').click();
  await page.locator('.rec[data-exercise-id=e1]').click();
  await page.locator('.hist .r[data-date="' + date + '"]').click();
  const token = await page.evaluate(() => window.history.state.sheet);
  assert.equal(await sheet(page).locator('.row').count(), 3);
  assert.match(await sheet(page).locator('.row').first().textContent(), /1セット目.*›/);
  await sheet(page).locator('.row').first().click();
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.evaluate(() => window.history.state.sheet), token);
  assert.equal(await sheet(page).getAttribute('aria-label'), '1セット目を直す');
  const first = data.sessions.at(-1).sets[0].reps;
  await sheet(page).getByRole('button', { name: '腕立て伏せ 1回増やす', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await sheet(page).locator('.row').count(), 3);
  assert.equal((await stored(page)).sessions.at(-1).sets[0].reps, first + 1);
  assert.equal(await page.locator('.hist .r').first().locator('.v b').textContent(), String(first + 1));
  const before = (await stored(page)).sessions.at(-1).sets;
  await sheet(page).locator('.row').nth(1).click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  assert.equal(await sheet(page).locator('.row').count(), 2);
  assert.match(await sheet(page).locator('.restore').textContent(), /2セット目を消しました/);
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.evaluate(() => window.history.state.sheet), token);
  await sheet(page).getByRole('button', { name: '元に戻す', exact: true }).click();
  assert.deepEqual((await stored(page)).sessions.at(-1).sets, before);
  await sheet(page).locator('.row').nth(1).click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  await page.clock.runFor(4000);
  assert.equal(await sheet(page).getByRole('button', { name: '元に戻す', exact: true }).count(), 0);
  await sheet(page).locator('.row').first().click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  assert.equal(await sheet(page).getByRole('button', { name: '元に戻す', exact: true }).count(), 1);
  await sheet(page).locator('.row').first().click();
  assert.equal(await sheet(page).getByRole('button', { name: '元に戻す', exact: true }).count(), 0);
  await closeSheet(page);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'detail');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('deleting the only set removes the empty session and undo restores its position', async () => {
  const data = fixture();
  const date = data.sessions.at(-1).date;
  data.sessions.at(-1).sets = [data.sessions.at(-1).sets[0]];
  const original = structuredClone(data.sessions);
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  await page.locator('.rec[data-exercise-id=e1]').click();
  await page.locator('.hist .r[data-date="' + date + '"]').click();
  await sheet(page).locator('.row').click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  assert.equal((await stored(page)).sessions.some(session => session.date === date), false);
  assert.equal(await sheet(page).locator('.row').count(), 0);
  await sheet(page).getByRole('button', { name: '元に戻す', exact: true }).click();
  assert.deepEqual((await stored(page)).sessions, original);
  assert.equal(await sheet(page).locator('.row').count(), 1);
  await closeSheet(page);
  assert.deepEqual(errors, []);
  await close();
});

test('band and weight edits save loads and history groups values by load', async () => {
  const data = fixture();
  const date = data.sessions.at(-1).date;
  const { page, errors, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e2'] }
  } });
  await press(page, '始める').click();
  assert.equal(await page.locator('.sets .cur .td small').textContent(), '黒');
  assert.equal(await page.locator('.sets .r .pv small').first().textContent(), '黒');
  await complete(page);
  await page.locator('.sets .done').click();
  await sheet(page).getByRole('button', { name: '赤', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).sessions.at(-1).sets[0].bandId, 'r');
  await leaveTraining(page);
  await tab(page, '記録').click();
  await page.locator('.rec[data-exercise-id=e2]').click();
  await page.locator('.hist .r[data-date="' + date + '"]').click();
  await sheet(page).locator('.row').first().click();
  await sheet(page).getByRole('button', { name: '赤', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  const changed = (await stored(page)).sessions.find(session => session.date === date)
    .sets.filter(set => set.exerciseId === 'e2');
  assert.equal(changed[0].bandId, 'r');
  assert.equal(changed[1].bandId, 'k');
  assert.equal(await page.locator('.hist .r[data-date="' + date + '"] .v').textContent(),
    '赤 15 ・ 黒 152セット');
  await closeSheet(page);
  assert.deepEqual(errors, []);
  await close();

  const weightData = fixture();
  weightData.exercises[0].type = 'weight';
  weightData.sessions.forEach(session => {
    session.sets.filter(set => set.exerciseId === 'e1').forEach(set => { set.kg = 5; });
  });
  const weight = await open({ data: weightData, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1'] }
  } });
  await press(weight.page, '始める').click();
  await complete(weight.page);
  await weight.page.locator('.sets .done').click();
  await sheet(weight.page).getByRole('button', { name: '重さを増やす', exact: true }).click();
  await sheet(weight.page).getByRole('button', { name: '保存', exact: true }).click();
  await weight.page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(weight.page)).sessions.at(-1).sets[0].kg, 5.5);
  assert.equal(await weight.page.locator('.sets .done .td small').textContent(), '5.5kg');
  assert.deepEqual(weight.errors, []);
  await weight.close();
});

test('up suggests the next band without changing the load and compares completed values factually', async () => {
  for (const diff of [-1, 0, 1]) {
    const data = fixture();
    const latest = data.sessions.at(-1);
    latest.sets.filter(set => set.exerciseId === 'e2').forEach((set, index) => {
      set.bandId = 'r';
      set.reps = index === 0 ? 20 : 12;
    });
    const { page, errors, close } = await open({ data, extra: {
      'kintore:menu': { kind: 'custom', exerciseIds: ['e2'] }
    } });
    await page.clock.install();
    await press(page, '始める').click();
    assert.equal(await press(page, '赤').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.counter .num').textContent(), '20');
    assert.equal(await page.locator('.prev').textContent(), '前回20回以上。黒を検討');
    assert.equal(await page.locator('.lineon, .counter .over, .sets .cur .over, .verdict').count(), 0);
    if (diff) await press(page, 'バンドロウ 1回' + (diff > 0 ? '増やす' : '減らす')).click();
    const before = clearCount(data, 'e2');
    await complete(page);
    assert.equal((await stored(page)).sessions.at(-1).sets[0].bandId, 'r');
    assert.equal(await page.locator('.verdict .num').textContent(), String(20 + diff));
    assert.equal(await page.locator('.verdict b').textContent(),
      diff > 0 ? '前回より +1' : diff < 0 ? '前回より −1' : '前回と同じ');
    assert.equal(await page.locator('.verdict small').textContent(), '黒を検討');
    const saved = await stored(page);
    assert.equal(clearCount(saved, 'e2'), before);
    assert.equal(feed(saved, localDate(new Date())).some(item => item.kind === 'clear'), false);
    await press(page, '休憩を終える').click();
    assert.equal(await page.locator('.prev').textContent(), '前回20回以上 ・ 黒を検討');
    await leaveTraining(page);
    assert.match(await page.textContent('.see'), /バンドロウ/);
    assert.deepEqual(errors, []);
    await close();
  }
});

test('changing the first-set load gives a new-load result and is excluded from breakthroughs', async () => {
  for (const up of [false, true]) {
    const data = fixture();
    data.sessions.at(-1).sets.filter(set => set.exerciseId === 'e2').forEach(set => {
      set.bandId = 'r';
      set.reps = up ? 20 : 15;
    });
    const previousCount = clearCount(data, 'e2');
    const { page, errors, close } = await open({ data, extra: {
      'kintore:menu': { kind: 'custom', exerciseIds: ['e2'] }
    } });
    await page.clock.install();
    await press(page, '始める').click();
    await press(page, '黒').click();
    await press(page, 'バンドロウ 1回増やす').evaluate(button => {
      for (let i = 0; i < 10; i++) button.click();
    });
    assert.equal(await page.locator('.verdict, .counter .over, .sets .cur .over').count(), 0);
    assert.ok(!(await page.textContent('.see')).includes('突破'));
    await complete(page);
    assert.equal(await page.locator('.verdict b').textContent(), '新しい負荷');
    assert.equal(await page.locator('.verdict small').textContent(), '黒の1本目');
    assert.equal(await page.locator('.sets .done .over').count(), 0);
    const saved = await stored(page);
    assert.equal(clearCount(saved, 'e2'), previousCount);
    assert.equal(feed(saved, localDate(new Date())).some(item => item.kind === 'clear'), false);
    await press(page, '休憩を終える').click();
    assert.equal(await page.locator('.prev').textContent(), '新しい負荷');
    await press(page, '終了').click();
    assert.match(await page.textContent('.see'), /ライン突破 0 \/ 0/);
    await press(page, 'ホームへ').click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
    await tab(page, '記録').click();
    await page.locator('.rec[data-exercise-id=e2]').click();
    const today = localDate(new Date());
    assert.equal(await page.locator('.hist .r[data-date="' + today + '"] .v b').count(), 0);
    assert.deepEqual(errors, []);
    await close();
  }
});

test('a short first-set verdict shows the next-day line instead of a carry-forward message', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await page.clock.install();
  await press(page, '始める').click();
  await press(page, '腕立て伏せ 1回減らす').click();
  await complete(page);
  const saved = await stored(page);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const next = line(saved, 'e1', localDate(tomorrow));
  assert.match(await page.locator('.verdict b').textContent(), /^あと\d+$/);
  assert.equal(await page.locator('.verdict small').textContent(), '次回のライン ' + next.value);
  assert.ok(!(await page.textContent('.see')).includes('ラインは次回へ'));
  assert.deepEqual(errors, []);
  await close();
});

test('reload restores exercise, unfinished input, completed sets, notes and the remaining rest', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await page.clock.install({ time: new Date(localDate(new Date()) + 'T12:00:00') });
  await press(page, '始める').click();
  await press(page, '次 ▶').click();
  await press(page, '赤').click();
  await press(page, 'バンドロウ 1回増やす').click();
  await press(page, 'メモ').click();
  await sheet(page).getByLabel('メモ', { exact: true }).fill('再開するメモ');
  await sheet(page).getByRole('button', { name: 'コーチに送る：オフ', exact: true }).click();
  await closeSheet(page);
  const firstValue = await page.locator('.counter .num').textContent();
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:training')));
  assert.equal(pending.training.index, 1);
  assert.equal(pending.training.entries[1].sets[0].bandId, 'r');
  assert.equal(pending.training.note, '再開するメモ');
  assert.equal(pending.training.toCoach, true);
  await page.reload();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'today');
  await press(page, '続きから').click();
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  assert.equal(await page.locator('.sets .cur .no').textContent(), '1');
  assert.equal(await page.locator('.counter .num').textContent(), firstValue);
  assert.equal(await press(page, '赤').getAttribute('aria-pressed'), 'true');
  await complete(page);
  await press(page, 'バンドロウ 1回増やす').click();
  const secondValue = await page.locator('.counter .num').textContent();
  await page.clock.runFor(10000);
  const remaining = await page.locator('.restbar .num').textContent();
  const checkpoint = await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:training')));
  const before = await stored(page);
  await page.reload();
  await press(page, '続きから').click();
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  assert.equal(await page.locator('.sets .cur .no').textContent(), '2');
  assert.equal(await page.locator('.sets .done').count(), 1);
  assert.equal(await page.locator('.counter .num').textContent(), secondValue);
  assert.equal(await page.locator('.restbar .num').textContent(), remaining);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:training')));
  assert.equal(restored.rest.end, checkpoint.rest.end);
  assert.equal(restored.rest.duration, checkpoint.rest.duration);
  assert.deepEqual((await stored(page)).sessions, before.sessions);
  await page.clock.runFor(80000);
  assert.equal(await page.locator('.restbar').count(), 0);
  await page.reload();
  await press(page, '続きから').click();
  assert.equal(await page.locator('.restbar').count(), 0);
  assert.equal(await page.locator('.sets .cur .no').textContent(), '2');
  await leaveTraining(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:training')), null);
  await page.reload();
  assert.equal(await press(page, '続きから').count(), 0);
  assert.deepEqual(errors, []);
  await close();
});

test('a training checkpoint from another day is discarded on startup', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await press(page, '始める').click();
  await page.evaluate(() => {
    const checkpoint = JSON.parse(localStorage.getItem('kintore:training'));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    checkpoint.training.date = [
      yesterday.getFullYear(), String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0')
    ].join('-');
    localStorage.setItem('kintore:training', JSON.stringify(checkpoint));
  });
  await page.reload();
  assert.equal(await press(page, '続きから').count(), 0);
  assert.equal(await press(page, '始める').count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:training')), null);
  assert.deepEqual(errors, []);
  await close();
});

test('a failed complete keeps the set count, counter and rest unchanged and can be retried', async () => {
  for (const duringRest of [false, true]) {
    const { page, errors, close } = await open({ data: fixture() });
    await page.clock.install();
    await press(page, '始める').click();
    if (duringRest) await complete(page);
    const before = await stored(page);
    const checkpoint = await page.evaluate(() => localStorage.getItem('kintore:training'));
    const amount = await page.locator('.counter .num').textContent();
    const setNumber = await page.locator('.sets .cur .no').textContent();
    const restText = duringRest ? await page.locator('.restbar .num').textContent() : null;
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'kintore:data') throw new DOMException('full', 'QuotaExceededError');
        return window.originalSetItem.call(this, key, value);
      };
    });
    await complete(page);
    assert.equal(await page.textContent('#toast'), '保存できませんでした。もう一度押してください');
    assert.deepEqual(await stored(page), before);
    assert.equal(await page.evaluate(() => localStorage.getItem('kintore:training')), checkpoint);
    assert.equal(await page.locator('.counter .num').textContent(), amount);
    assert.equal(await page.locator('.sets .cur .no').textContent(), setNumber);
    assert.equal(await page.locator('.sets .done').count(), duringRest ? 1 : 0);
    if (duringRest) assert.equal(await page.locator('.restbar .num').textContent(), restText);
    else assert.equal(await page.locator('.restbar, .verdict').count(), 0);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await complete(page);
    const saved = await stored(page);
    const session = saved.sessions.find(session => session.date === localDate(new Date()));
    assert.equal(session.sets.length, duringRest ? 2 : 1);
    assert.equal(session.sets.at(-1).reps, Number(amount));
    assert.deepEqual(errors, []);
    await close();
  }
});

test('failed set edits and deletions keep the current sheet and saved record until retry', async () => {
  for (const context of ['training', 'records']) {
    const data = fixture();
    const { page, errors, close } = await open({ data });
    await page.clock.install();
    if (context === 'training') {
      await press(page, '始める').click();
      await complete(page);
      await page.locator('.sets .done').click();
    } else {
      await tab(page, '記録').click();
      await page.locator('.rec[data-exercise-id=e1]').click();
      await page.locator('.hist .r').first().click();
      await sheet(page).locator('.row').first().click();
    }
    const before = await stored(page);
    await sheet(page).getByRole('button', { name: '腕立て伏せ 1回増やす', exact: true }).click();
    const amount = await sheet(page).locator('.counter .num').textContent();
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'kintore:data') throw new Error('full');
        return window.originalSetItem.call(this, key, value);
      };
    });
    await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
    assert.equal(await sheet(page).getAttribute('aria-label'), '1セット目を直す');
    assert.equal(await sheet(page).locator('.counter .num').textContent(), amount);
    assert.deepEqual(await stored(page), before);
    assert.equal(await page.textContent('#toast'), '保存できませんでした。もう一度押してください');
    await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
    assert.equal(await sheet(page).getAttribute('aria-label'), '1セット目を直す');
    assert.deepEqual(await stored(page), before);
    assert.equal(await page.textContent('#toast'), '保存できませんでした。もう一度押してください');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
    if (context === 'training') {
      await page.waitForFunction(() => !window.history.state?.sheet);
      assert.equal(await page.locator('.sets .done .td').textContent(), amount);
    } else {
      assert.equal(await sheet(page).locator('.row').count(), 3);
      assert.match(await sheet(page).locator('.row').first().textContent(), new RegExp(amount));
    }
    assert.deepEqual(errors, []);
    await close();
  }
});
