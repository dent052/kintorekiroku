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
  bodyAvg7, feed, setHistory, weekStart, value, load } from '../logic.js';

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
const tab = (page, text) => page.locator('.tabs').getByRole('button', { name: text === 'コーチ' ? /^コーチ(?:\s*\d+)?$/ : text, exact: true });
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

async function finishTraining(page) {
  await page.locator('.tr-top .end').click();
  if (await page.locator('dialog[open]').count()) {
    await sheet(page).getByRole('button', { name: 'ここまでで終える', exact: true }).click();
  }
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'summary');
}

async function leaveTraining(page) {
  await finishTraining(page);
  await principles(page);
  await press(page, 'ホームへ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
}

async function principles(page) {
  assert.deepEqual(await page.$$eval('button, a[href], select, input, textarea, [role=slider]', elements =>
    elements.filter(element => !element.closest('.press, dialog.sheet, .slab, .tabs, #toast button') &&
      !element.closest('.see .ln, .see .rec, .see .ex, .see .pill, .see .back, .see .sets .r.done, .see .hist .r, .see .seg, .see .day, .see .bl, .see .big input, .see .tr-top .prog, .see .tr-top .end, .see .card, .see .tw .src, .see .xc, .see .dc, .see .rest'))
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
    await page.locator('.xc').first().click();
    await principles(page);
    await page.getByRole('button', { name: '‹ 記録', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'records');
    await tab(page, 'コーチ').click();
    await principles(page);
    assert.ok(await page.locator('.tl').getByRole('link', { name: '出典 example.com' }).isVisible());
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
  await page.locator('.xc').first().click();
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
  assert.deepEqual(await page.locator('.tabs button').allTextContents(), ['ホーム', '記録', 'コーチ', '種目', '設定']);
  assert.equal(await page.locator('.tabs svg[aria-hidden=true]').count(), 5);
  for (const [name, mode] of [['記録', 'records'], ['コーチ', 'coach'], ['種目', 'exercises'], ['設定', 'settings'], ['設定', 'settings'], ['記録', 'records']]) {
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
  await finishTraining(page);
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
  await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
  await pill(page, '＋ 過去の日').click();
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
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.tw .t').textContent(), '1セット目だけ狙えば十分。');
  assert.equal(await page.locator('.tw .q').textContent(), '肩が重い');
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

test('home leaves coach posts unread; the coach timeline labels the same post', async () => {
  const data = fixture();
  const last = data.sessions.at(-1);
  last.sets[0].reps = 19;
  const { page, close } = await open({ data, extra: {
    'kintore:posts': [{ id: 'reply', at: '2099-01-01', kind: 'reply', text: '肩を休める。' }]
  } });
  assert.equal(await page.locator('.feed .post').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:seen')), null);
  await tab(page, '記録').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:seen')), null);
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.tw .who').evaluate(node => node.firstChild.textContent), 'コーチ');
  assert.equal(await page.locator('.tw .tag').textContent(), '返信');
  assert.equal(await page.locator('.tw .t').textContent(), '肩を休める。');
  assert.equal(await page.locator('.tw.unread').count(), 1);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:seen'))), ['reply']);
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
  assert.equal(await page.locator('.verdict b').textContent(), '自己ベスト');
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
  assert.equal(await page.locator('.verdict b').textContent(), '自己ベスト');
  assert.equal(await page.locator('.verdict small').textContent(), 'これまで ' + (target - 1) + '回 ・ ライン突破');
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
  assert.match(await page.textContent('.see'), /今日の記録.*腕立て伏せ.*前回.*プランク.*前回/s);
  assert.doesNotMatch(await page.textContent('.see'), /合計回数|前回より|ライン突破/);
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

test('memo has only notes and coach opt-in; the exercise list adds and switches stages', async () => {
  const data = fixture();
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1'] }
  } });
  await press(page, '始める').click();
  await press(page, 'メモ').click();
  await principles(page);
  await sheet(page).getByLabel('メモ', { exact: true }).fill('肩が重い');
  assert.equal(await sheet(page).getAttribute('aria-label'), 'メモ');
  assert.deepEqual(await sheet(page).locator('button').allTextContents(), ['コーチに送る', '閉じる']);
  const coach = sheet(page).getByRole('button', { name: 'コーチに送る', exact: true });
  assert.equal(await coach.getAttribute('aria-pressed'), 'false');
  await coach.click();
  assert.equal(await coach.getAttribute('aria-pressed'), 'true');
  assert.equal(await coach.evaluate(button => button.classList.contains('on')), true);
  await closeSheet(page);
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  await complete(page);
  let session = (await stored(page)).sessions.at(-1);
  assert.equal(session.note, '肩が重い');
  assert.equal(session.toCoach, true);
  await press(page, '休憩を終える').click();
  await page.locator('.tr-top .prog').click();
  await sheet(page).getByRole('button', { name: 'この種目を次の段階へ', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.textContent('.exname'), '足上げ腕立て');
  await page.locator('.tr-top .prog').click();
  await sheet(page).getByRole('button', { name: '＋ 種目を足す', exact: true }).click();
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
  assert.deepEqual(await page.locator('.xc').evaluateAll(rows => rows.map(row => row.dataset.exerciseId)),
    [...data.exercises.filter(ex => recorded.has(ex.id)).map(ex => ex.id), 'body']);
  const today = localDate(new Date());
  for (const ex of data.exercises.filter(ex => recorded.has(ex.id))) {
    const row = page.locator('.xc[data-exercise-id="' + ex.id + '"]');
    const latest = [...data.sessions].filter(session =>
      session.sets.some(set => set.exerciseId === ex.id))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const first = latest.sets.find(set => set.exerciseId === ex.id);
    const target = line(data, ex.id, today);
    assert.equal(await row.locator('.xs > div').nth(1).locator('.num').textContent(),
      String(value(ex, first)));
    assert.equal(await row.locator('.ln2 .num').textContent(), String(target.value ?? '—'));
    const text = await row.locator('.xp').textContent();
    const clears = clearCount(data, ex.id);
    assert.equal(text.includes('突破 ' + clears + '回'), clears > 0);
    assert.ok(!text.includes('累計'));
    const sets = data.sessions.at(-1).sets.filter(set => set.exerciseId === ex.id);
    const expected = ex.type === 'band'
      ? '黒 ' + sets.map(set => set.reps).join('・')
      : sets.map(set => ex.type === 'time' ? set.sec : set.reps).join(' ・ ') +
        (ex.type === 'time' ? '秒' : '');
    assert.ok(text.startsWith('前回 ' + expected + ' ・ '));
  }
  assert.equal(await page.locator('.heat i').count(), 12);
  assert.deepEqual(await page.locator('.heat i').evaluateAll(cells =>
    cells.map(cell => cell.className)), weekHeat(data, today).map(n => n >= 3 ? 'd' : n ? 'l' : ''));
  assert.equal(await page.locator('.press').evaluate(dock => dock.getBoundingClientRect().height), 0);

  for (const id of ['e1', 'e2', 'e3']) {
    await page.locator('.xc[data-exercise-id="' + id + '"]').click();
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
  const row = page.locator('.xc[data-exercise-id=body]');
  assert.deepEqual(await row.locator('.xs .num').allTextContents(),
    [data.body.at(-1).kg.toFixed(1), average.toFixed(1)]);
  assert.deepEqual(await row.locator('.xs > div > small').allTextContents(), ['最新', '7日平均']);
  assert.equal(await row.locator('.pi').count(), 0);
  assert.equal((await row.locator('.spark polyline').getAttribute('points')).split(' ').length,
    Math.min(12, data.body.length));
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
  const card = page.locator('.xc[data-exercise-id=e1]');
  assert.equal(await card.locator('.few').textContent(), '記録 1回 ・ 4回から線で伸びを描く');
  assert.equal(await card.locator('.spark').count(), 0);
  await card.click();
  assert.equal(await page.locator('.chart circle.first').count(), 1);
  assert.equal(await page.locator('.chart circle.other').count(), 2);
  assert.equal(await page.locator('.chart path').count(), 0);
  assert.equal(await page.locator('.exdots').count(), 0);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});
test('records empty state keeps its explanation while unread posts belong to the coach tab', async () => {
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
  assert.equal(await page.locator('.see .pill').count(), 0);
  assert.equal(await tab(page, 'コーチ').locator('.badge').textContent(), '1');
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.tw .t').textContent(), '新しい発見');
  await tab(page, '記録').click();
  assert.equal(await page.locator('.see .pill').count(), 0);
  assert.equal(await tab(page, 'コーチ').locator('.badge').count(), 0);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('day sheets edit sets and notes, delete and undo sets, and confirm session deletion', async () => {
  const data = fixture();
  const date = data.sessions.at(-1).date;
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await page.locator('.dc[data-date="' + date + '"]').click();
    const token = await page.evaluate(() => window.history.state.sheet);
    await principles(page);
    await sheet(page).locator('.row').first().click();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.evaluate(() => window.history.state.sheet), token);
    await sheet(page).getByRole('button', { name: '腕立て伏せ 1回増やす', exact: true }).click();
    await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
    data.sessions.at(-1).sets[0].reps++;
    assert.equal((await stored(page)).sessions.find(s => s.date === date).sets[0].reps,
      data.sessions.at(-1).sets[0].reps);
    await sheet(page).getByLabel('メモ', { exact: true }).fill('今日は軽い');
    await closeSheet(page);
  }
  await page.locator('.dc[data-date="' + date + '"]').click();
  assert.equal(await sheet(page).getByLabel('メモ', { exact: true }).inputValue(), '今日は軽い');
  const before = (await stored(page)).sessions.find(s => s.date === date).sets;
  await sheet(page).locator('.row').first().click();
  await sheet(page).getByRole('button', { name: 'このセットを消す', exact: true }).click();
  assert.equal((await stored(page)).sessions.find(s => s.date === date).sets.length, before.length - 1);
  await sheet(page).getByRole('button', { name: '元に戻す', exact: true }).click();
  assert.deepEqual((await stored(page)).sessions.find(s => s.date === date).sets, before);
  await sheet(page).getByRole('button', { name: 'この日の記録を削除', exact: true }).click();
  await page.locator('#confirm-dialog button[value=cancel]').click();
  await page.waitForFunction(() => !document.querySelector('#confirm-dialog').open);
  assert.ok((await stored(page)).sessions.some(s => s.date === date));
  await sheet(page).getByRole('button', { name: 'この日の記録を削除', exact: true }).click();
  await page.locator('#confirm-dialog button[value=confirm]').click();
  await page.waitForFunction(d => !JSON.parse(localStorage.getItem('kintore:data')).sessions.some(s => s.date === d), date);
  assert.match(await sheet(page).textContent(), /記録なし/);
  await closeSheet(page);
  await page.reload();
  assert.ok(!(await stored(page)).sessions.some(s => s.date === date));
  assert.deepEqual(errors, []);
  await close();
});
test('coach timeline shows the same posts in time order and marks them read', async () => {
  const posts = [
    { id: 'older-reply', at: '2098-01-01', kind: 'reply', text: '返事', quote: 'メモ' },
    { id: 'newer', at: '2099-01-01', kind: 'reading', text: '読み物',
      source: { title: '資料', url: 'https://example.com' } },
    { id: 'third', at: '2097-01-01', kind: 'finding', text: '発見' }
  ];
  const data = fixture();
  const { page, errors, close } = await open({ data, extra: { 'kintore:posts': posts } });
  assert.equal(await tab(page, 'コーチ').locator('.badge').textContent(), '3');
  await tab(page, 'コーチ').click();
  assert.deepEqual(await page.locator('.tw .t').allTextContents(), ['読み物', '返事', '発見']);
  assert.equal(await page.locator('.tw .q').textContent(), 'メモ');
  const source = page.locator('.tw .src');
  assert.equal(await source.locator('b').textContent(), '資料');
  assert.equal(await source.textContent(), '資料example.com');
  assert.equal(await source.getAttribute('href'), 'https://example.com/');
  assert.equal(await source.getAttribute('target'), '_blank');
  assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:seen')));
  assert.ok(posts.every(post => seen.includes(post.id)));
  assert.equal(seen.length, posts.length);
  assert.equal(await page.locator('.tw.unread').count(), 3);
  assert.equal(await tab(page, 'コーチ').locator('.badge').count(), 0);
  await principles(page);
  await home(page);
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.tw.unread').count(), 0);
  await home(page);
  assert.equal(await page.locator('.feed > .k').textContent(), '今週');
  assert.equal(await page.locator('.feed .post, .feed .card').count(), 0);
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
  const time = new Date(localDate(new Date()) + 'T12:00:00');
  await page.clock.install({ time });
  // install() keeps time running; pause before the toast is scheduled.
  await page.clock.pauseAt(new Date(time.getTime() + 60000));
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
  await page.locator('.xc[data-exercise-id=e1]').click();
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
  await page.locator('.xc[data-exercise-id=e1]').click();
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
  await page.locator('.xc[data-exercise-id=e2]').click();
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
      diff > 0 ? '自己ベスト' : diff < 0 ? '前回より −1' : '前回と同じ');
    assert.equal(await page.locator('.verdict small').textContent(),
      diff > 0 ? 'これまで 20回 ・ 前回より +1' : '黒を検討');
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
    data.sessions.forEach(session => {
      session.sets.filter(set => set.exerciseId === 'e2').forEach(set => { set.bandId = 'r'; });
    });
    data.sessions.at(-1).sets.filter(set => set.exerciseId === 'e2').forEach(set => {
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
    await finishTraining(page);
    assert.doesNotMatch(await page.textContent('.see'), /合計回数|前回より|ライン突破/);
    assert.equal(await page.locator('.sumrow').count(), 1);
    await press(page, 'ホームへ').click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
    await tab(page, '記録').click();
    await page.locator('.xc[data-exercise-id=e2]').click();
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
  await sheet(page).getByRole('button', { name: 'コーチに送る', exact: true }).click();
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
      await page.locator('.xc[data-exercise-id=e1]').click();
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
test('direct counters select all, clamp on Enter, commit on blur and cancel on Escape', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await press(page, '始める').click();
  const original = await page.locator('.counter .num').textContent();
  await page.locator('.counter .num').click();
  const input = page.locator('.counter input');
  assert.equal(await input.getAttribute('inputmode'), 'numeric');
  assert.deepEqual(await input.evaluate(node => [node.selectionStart, node.selectionEnd]),
    [0, original.length]);
  await input.fill('999');
  await input.press('Enter');
  assert.equal(await page.locator('.counter .num').textContent(), '200');
  await page.locator('.counter .num').click();
  await input.fill('37');
  await input.press('Escape');
  assert.equal(await page.locator('.counter .num').textContent(), '200');
  await page.locator('.counter .num').click();
  await input.fill('not a number');
  await input.press('Enter');
  assert.equal(await page.locator('.counter .num').textContent(), '200');
  await page.locator('.counter .num').click();
  await input.fill('-8');
  await input.press('Enter');
  assert.equal(await page.locator('.counter .num').textContent(), '0');
  await page.locator('.counter .num').click();
  await input.fill('12.7');
  await complete(page);
  assert.equal((await stored(page)).sessions.at(-1).sets[0].reps, 13);
  await page.locator('.sets .done').click();
  await sheet(page).locator('.counter .num').click();
  await sheet(page).locator('.counter input').fill('19');
  await sheet(page).locator('.counter input').press('Escape');
  assert.equal(await sheet(page).isVisible(), true);
  assert.equal(await sheet(page).locator('.counter .num').textContent(), '13');
  await sheet(page).locator('.counter .num').click();
  await sheet(page).locator('.counter input').fill('18');
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await stored(page)).sessions.at(-1).sets[0].reps, 18);
  await page.waitForFunction(() => !window.history.state?.sheet);
  await press(page, '休憩を終える').click();
  await press(page, '次 ▶').click();
  await press(page, '次 ▶').click();
  await page.locator('.counter .num').click();
  await input.fill('47');
  await input.press('Enter');
  assert.equal(await page.locator('.counter .num').textContent(), '47');
  await page.locator('.counter .num').click();
  await input.fill('601');
  await input.press('Enter');
  assert.equal(await page.locator('.counter .num').textContent(), '600');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('weight direct input accepts decimals, rounds and clamps without losing the complete click', async () => {
  const data = fixture();
  data.exercises.push({ id: 'ew', name: 'ダンベル', type: 'weight', part: '腕', nextId: null, archived: false });
  const { page, errors, close } = await open({ data,
    extra: { 'kintore:menu': { kind: 'custom', exerciseIds: ['ew'] } } });
  await press(page, '始める').click();
  await page.locator('.stepper .num').click();
  const input = page.locator('.stepper input');
  assert.equal(await input.getAttribute('inputmode'), 'decimal');
  await input.fill('900');
  await input.press('Enter');
  assert.match(await page.locator('.stepper .num').textContent(), /^500/);
  await page.locator('.stepper .num').click();
  await input.fill('12.54');
  await input.press('Enter');
  assert.match(await page.locator('.stepper .num').textContent(), /^12.5/);
  await page.locator('.stepper .num').click();
  await input.fill('12.5');
  await complete(page);
  assert.equal((await stored(page)).sessions.at(-1).sets[0].kg, 12.5);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('by-day records include training, light, rest and body-only dates and remember the view', async () => {
  const data = fixture();
  data.sessions.at(-1).light = true;
  const bodyOnly = data.body.find(entry => !data.sessions.some(s => s.date === entry.date) &&
    !data.skips.some(s => s.date === entry.date));
  bodyOnly.kg = 67.83;
  const { page, errors, close } = await open({ data });
  await page.setViewportSize({ width: 360, height: 760 });
  await tab(page, '記録').click();
  assert.equal(await pill(page, '日付から探す').count(), 0);
  await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
  const expected = [...new Set([...data.sessions.map(s => s.date),
    ...data.skips.map(s => s.date), ...data.body.map(b => b.date)])].sort().reverse();
  assert.deepEqual(await page.locator('.dc, .rest').evaluateAll(rows => rows.map(row => row.dataset.date)), expected);
  const latest = page.locator('.dc[data-date="' + data.sessions.at(-1).date + '"]');
  assert.equal(await latest.locator('.top').textContent(), '3種目 ・ 6セット ・ 軽め');
  assert.deepEqual(await latest.locator('li > span:first-child').allTextContents(),
    ['腕立て伏せ', 'バンドロウ', 'プランク']);
  assert.equal(await latest.locator('li .v small').textContent(), '黒');
  assert.match(await latest.locator('li .v').last().textContent(), /秒$/);
  const restRow = page.locator('.dc[data-date="' + data.skips[0].date + '"]');
  assert.equal(await restRow.locator('.top').textContent(), '3種目 ・ 6セット ・ 休み');
  await restRow.click();
  assert.ok((await sheet(page).textContent()).includes('休み（風邪）'));
  await closeSheet(page);
  const bodyRow = page.locator('.rest[data-date="' + bodyOnly.date + '"]');
  assert.ok((await bodyRow.textContent()).endsWith('体重 67.8kg'));
  assert.equal((await stored(page)).body.find(entry => entry.date === bodyOnly.date).kg, 67.83);
  await bodyRow.click();
  assert.ok((await sheet(page).textContent()).includes('体重 67.8kg'));
  assert.ok(!(await sheet(page).textContent()).includes('67.83'));
  await closeSheet(page);
  await principles(page);
  await page.reload();
  await tab(page, '記録').click();
  assert.equal(await page.locator('.seg .on').textContent(), '日ごと');
  assert.equal(await page.locator('.dc, .rest').count(), expected.length);
  await page.locator('.seg').getByRole('button', { name: '種目ごと', exact: true }).click();
  assert.equal(await page.locator('.heat i').count(), 12);
  assert.ok(await page.locator('.xc').count());
  assert.deepEqual(errors, []);
  await close();
});
test('past-day entry creates no empty session and adds, edits and repeats sets on that date', async () => {
  const data = fixture();
  data.sessions = [];
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
  await pill(page, '＋ 過去の日').click();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = localDate(yesterday);
  assert.equal(await sheet(page).locator('input[type=date]').inputValue(), date);
  assert.equal(await sheet(page).locator('input[type=date]').getAttribute('max'), date);
  await sheet(page).locator('input[type=date]').fill(localDate(new Date()));
  assert.equal(await sheet(page).getByRole('button', { name: '決定', exact: true }).isDisabled(), true);
  await sheet(page).locator('input[type=date]').fill(date);
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
  assert.equal((await stored(page)).sessions.length, 0);
  const token = await page.evaluate(() => window.history.state.sheet);
  await sheet(page).getByRole('button', { name: '＋ 種目を足す', exact: true }).click();
  await sheet(page).locator('.row').filter({ hasText: '腕立て伏せ' }).click();
  assert.equal((await stored(page)).sessions[0].date, date);
  assert.equal((await stored(page)).sessions[0].light, false);
  await sheet(page).locator('.counter .num').click();
  await sheet(page).locator('.counter input').fill('23');
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await page.evaluate(() => window.history.state.sheet), token);
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal((await stored(page)).sessions[0].sets[0].reps, 23);
  await sheet(page).getByRole('button', { name: '＋ セット', exact: true }).click();
  assert.equal(await sheet(page).locator('.counter .num').textContent(), '23');
  assert.equal((await stored(page)).sessions[0].sets.length, 2);
  await sheet(page).locator('.counter .num').click();
  await sheet(page).locator('.counter input').fill('17');
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  assert.deepEqual((await stored(page)).sessions[0].sets.map(set => set.reps), [23, 17]);
  await closeSheet(page);
  assert.equal(await page.locator('.dc[data-date="' + date + '"] li .v').textContent(), '23・17');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});
test('failed past-day additions keep the picker open and create no session', async () => {
  const data = fixture();
  data.sessions = [];
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
  await pill(page, '＋ 過去の日').click();
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
  await sheet(page).getByRole('button', { name: '＋ 種目を足す', exact: true }).click();
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'kintore:data') throw new Error('full');
      return window.originalSetItem.call(this, key, value);
    };
  });
  await sheet(page).locator('.row').filter({ hasText: '腕立て伏せ' }).click();
  assert.equal((await stored(page)).sessions.length, 0);
  assert.equal(await sheet(page).getAttribute('aria-label'), '種目を足す');
  assert.equal(await page.textContent('#toast'), '保存できませんでした。もう一度押してください');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  await sheet(page).locator('.row').filter({ hasText: '腕立て伏せ' }).click();
  assert.equal((await stored(page)).sessions.length, 1);
  assert.equal(await sheet(page).getAttribute('aria-label'), '1セット目を直す');
  assert.deepEqual(errors, []);
  await close();
});
test('body rows fill the paper, edit kg while retaining waist, delete without confirmation and undo', async () => {
  const data = fixture();
  const original = structuredClone(data.body);
  const latest = data.body.at(-1);
  const { page, errors, close } = await open({ data });
  await page.setViewportSize({ width: 360, height: 760 });
  await tab(page, '記録').click();
  await page.locator('.xc[data-exercise-id=body]').click();
  assert.deepEqual(await page.locator('.bl').evaluateAll(rows => rows.map(row => row.dataset.date)),
    data.body.map(entry => entry.date).sort().reverse());
  const bounds = await page.locator('.hist').evaluate(list => {
    const paper = list.closest('.see');
    const rect = paper.getBoundingClientRect();
    const style = getComputedStyle(paper);
    return {
      left: rect.left + parseFloat(style.paddingLeft),
      right: rect.right - parseFloat(style.paddingRight),
      rows: [...list.querySelectorAll('.bl')].map(row => {
        const box = row.getBoundingClientRect();
        return { left: box.left, right: box.right };
      })
    };
  });
  for (const row of bounds.rows) {
    assert.ok(Math.abs(row.left - bounds.left) <= 1, 'body row must start at the paper content edge');
    assert.ok(Math.abs(row.right - bounds.right) <= 1, 'body row must reach the paper content edge');
  }
  await page.locator('.bl').first().click();
  await sheet(page).locator('.big .num').click();
  await sheet(page).locator('.big input').fill('67.8');
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  const updated = (await stored(page)).body.find(entry => entry.date === latest.date);
  assert.equal(updated.kg, 67.8);
  assert.equal(updated.waist, latest.waist);
  await page.locator('.bl').first().click();
  await sheet(page).getByRole('button', { name: 'この日の体重を消す', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).body.length, original.length - 1);
  assert.equal(await page.locator('#confirm-dialog[open]').count(), 0);
  await page.locator('#toast').getByRole('button', { name: '元に戻す', exact: true }).click();
  const restored = (await stored(page)).body;
  assert.deepEqual(restored, original.map(entry => entry.date === latest.date ? { ...entry, kg: 67.8 } : entry));
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});
test('summary shows each exercise and its actual previous sets, PR badges and first-time copy', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data,
    extra: { 'kintore:menu': { kind: 'custom', exerciseIds: ['e1', 'e4'] } } });
  await press(page, '始める').click();
  await page.locator('.counter .num').click();
  await page.locator('.counter input').fill('200');
  await complete(page);
  await press(page, '休憩を終える').click();
  await press(page, '次 ▶').click();
  await complete(page);
  await press(page, '休憩を終える').click();
  await press(page, 'トレーニングを終える').click();
  const rows = page.locator('.sumrow');
  assert.equal(await rows.count(), 2);
  assert.equal(await rows.nth(0).locator('.n').textContent(), '腕立て伏せ自己ベスト');
  assert.equal(await rows.nth(0).locator('.t').textContent(), '200');
  const previous = data.sessions.at(-1).sets.filter(set => set.exerciseId === 'e1').map(set => set.reps).join(' ・ ');
  assert.equal(await rows.nth(0).locator('.p').textContent(), '前回 ' + previous);
  assert.equal(await rows.nth(1).locator('.p').textContent(), '初回');
  assert.equal(await rows.nth(1).locator('em').count(), 0);
  assert.doesNotMatch(await page.textContent('.see'), /合計回数|前回より|ライン突破/);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('top finish counts remaining work from every exercise and saves only completed sets', async () => {
  for (const index of [0, 1, 2]) {
    const { page, errors, close } = await open({ data: fixture() });
    await page.clock.install();
    await press(page, '始める').click();
    await page.locator('.tr-top .end').click();
    assert.equal(await sheet(page).getAttribute('aria-label'), 'トレーニングを終えますか？');
    assert.equal(await sheet(page).locator('.msg').textContent(),
      'まだ 3種目・6セット 残っています。記録したところまで保存されます。');
    await sheet(page).getByRole('button', { name: '続ける', exact: true }).click();
    await page.waitForFunction(() => !window.history.state?.sheet);
    await complete(page);
    await page.locator('.tr-top .prog').click();
    assert.equal(await sheet(page).getAttribute('aria-label'), '今日の種目');
    assert.deepEqual(await sheet(page).locator('.jl .c').allTextContents(), ['1 / 3', '0 / 2', '0 / 1']);
    await sheet(page).locator('.jl').nth(index).click();
    await page.waitForFunction(() => !window.history.state?.sheet);
    const before = await stored(page);
    await page.locator('.tr-top .end').click();
    assert.equal(await sheet(page).locator('.msg').textContent(),
      'まだ 3種目・5セット 残っています。記録したところまで保存されます。');
    await principles(page);
    await page.evaluate(() => window.history.back());
    await page.waitForFunction(() => !window.history.state?.sheet);
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
    await finishTraining(page);
    assert.equal(await page.locator('dialog[open], .restbar').count(), 0);
    assert.deepEqual((await stored(page)).sessions, before.sessions);
    assert.equal((await stored(page)).sessions.at(-1).sets.length, 1);
    await backTo(page, 'today');
    assert.equal(await press(page, '続きから').count(), 0);
    assert.deepEqual(errors, []);
    await close();
  }
});

test('finishing before any set creates no session', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await press(page, '始める').click();
  await finishTraining(page);
  assert.deepEqual((await stored(page)).sessions, data.sessions);
  assert.equal(await page.locator('.sumrow').count(), 0);
  await press(page, 'ホームへ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:training')), null);
  assert.deepEqual(errors, []);
  await close();
});

test('exercise list jumps, shows completion and adds at the end; all planned work finishes directly', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await startLight(page);
  await complete(page);
  await press(page, '休憩を終える').click();
  await page.locator('.tr-top .prog').click();
  assert.equal(await sheet(page).locator('.jl.done small').textContent(), '済み');
  assert.deepEqual(await sheet(page).locator('.jl .c').allTextContents(), ['1 / 1', '0 / 1', '0 / 1']);
  await sheet(page).locator('.jl[data-exercise-id=e3]').click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.textContent('.exname'), 'プランク');
  assert.equal(await press(page, '終了').count(), 0);
  await complete(page);
  await press(page, '休憩を終える').click();
  await page.locator('.tr-top .prog').click();
  await sheet(page).locator('.jl[data-exercise-id=e2]').click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await page.locator('.tr-top .prog').click();
  assert.equal(await sheet(page).locator('.jl.now small').textContent(), 'いまここ');
  assert.equal(await sheet(page).locator('.jl.now .c').textContent(), '0 / 1');
  await sheet(page).getByRole('button', { name: '＋ 種目を足す', exact: true }).click();
  await sheet(page).getByRole('button', { name: '足上げ腕立て', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal(await page.textContent('.exname'), '足上げ腕立て');
  await complete(page);
  await press(page, '休憩を終える').click();
  await page.locator('.tr-top .prog').click();
  assert.deepEqual(await sheet(page).locator('.jl').evaluateAll(rows => rows.map(row => row.dataset.exerciseId)),
    ['e1', 'e2', 'e3', 'e4']);
  await sheet(page).locator('.jl[data-exercise-id=e2]').click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await complete(page);
  const before = await stored(page);
  await page.locator('.tr-top .end').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'summary');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual((await stored(page)).sessions, before.sessions);
  assert.equal(before.sessions.at(-1).sets.length, 4);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('instant PR requires more than the same-load maximum and takes priority over the line result', async () => {
  for (const [bandId, reps, best] of [['r', 18, false], ['r', 19, true], ['k', 19, false]]) {
    const data = fixture();
    data.sessions = [{ ...data.sessions.at(-1), sets: [
      { exerciseId: 'e2', reps: 12, bandId: 'r' },
      { exerciseId: 'e2', reps: 18, bandId: 'r' }
    ] }];
    const { page, errors, close } = await open({ data,
      extra: { 'kintore:menu': { kind: 'custom', exerciseIds: ['e2'] } } });
    await page.clock.install();
    await page.evaluate(() => {
      window.vibrations = [];
      navigator.vibrate = value => { window.vibrations.push(value); return true; };
    });
    await press(page, '始める').click();
    await press(page, bandId === 'r' ? '赤' : '黒').click();
    await page.locator('.counter .num').click();
    await page.locator('.counter input').fill(String(reps));
    await page.locator('.counter input').press('Enter');
    assert.equal(await page.locator('.verdict').count(), 0);
    await complete(page);
    assert.equal(await page.locator('.verdict.pr').count(), best ? 1 : 0);
    assert.equal(await page.locator('.verdict b').textContent(),
      best ? '自己ベスト' : bandId === 'k' ? '新しい負荷' : '突破');
    if (best) {
      assert.equal(await page.locator('.verdict .num').textContent(), '19');
      assert.equal(await page.locator('.verdict small').textContent(), 'これまで 18回 ・ ライン突破');
      assert.deepEqual(await page.evaluate(() => window.vibrations), [[80, 60, 160]]);
    }
    assert.equal((await stored(page)).sessions.at(-1).sets[0].reps, reps);
    assert.deepEqual(errors, []);
    await close();
  }
});

test('later sets can set a PR and must also beat completed sets from today', async () => {
  const data = fixture();
  data.sessions = [{ ...data.sessions.at(-1), sets: [
    { exerciseId: 'e2', reps: 12, bandId: 'r' },
    { exerciseId: 'e2', reps: 18, bandId: 'r' }
  ] }];
  const { page, errors, close } = await open({ data,
    extra: { 'kintore:menu': { kind: 'custom', exerciseIds: ['e2'] } } });
  await page.clock.install();
  await press(page, '始める').click();
  await complete(page);
  assert.equal(await page.locator('.verdict.pr').count(), 0);
  await press(page, '休憩を終える').click();
  await page.locator('.counter .num').click();
  await page.locator('.counter input').fill('19');
  await page.locator('.counter input').press('Enter');
  await complete(page);
  assert.equal(await page.locator('.verdict.pr b').textContent(), '自己ベスト');
  assert.equal(await page.locator('.verdict small').textContent(), 'これまで 18回');
  await press(page, '休憩を終える').click();
  await press(page, '＋ もう1セット').click();
  await complete(page);
  assert.equal(await page.locator('.verdict').count(), 0);
  await press(page, '休憩を終える').click();
  await press(page, '＋ もう1セット').click();
  await press(page, 'バンドロウ 1回増やす').click();
  await complete(page);
  assert.equal(await page.locator('.verdict.pr .num').textContent(), '20');
  assert.equal(await page.locator('.verdict small').textContent(), 'これまで 19回');
  assert.deepEqual((await stored(page)).sessions.at(-1).sets.map(set => set.reps), [12, 19, 19, 20]);
  assert.deepEqual(errors, []);
  await close();
});

test('coach timeline merges posts, own writing and sent training memos as actual instants', async () => {
  const data = fixture(new Date('2026-10-21T12:00:00'));
  data.messages = [{ id: 'm1', at: '2026-10-21T08:00:00Z', text: '自分の相談' }];
  data.sessions.at(-1).date = '2026-10-21';
  data.sessions.at(-1).note = '送ったメモ';
  data.sessions.at(-1).toCoach = true;
  data.sessions.at(-2).note = '送らないメモ';
  data.sessions.at(-2).toCoach = false;
  data.sessions.at(-3).note = '   ';
  data.sessions.at(-3).toCoach = true;
  const posts = [
    { id: 'reading', at: '2026-10-21T07:23:00+09:00', kind: 'reading', text: '読む記事' },
    { id: 'reply', at: '2026-10-20T23:00:00Z', kind: 'reply', text: '相談への返信', quote: '引用した相談' },
    { id: 'weekly', at: '2026-10-19', kind: 'weekly', text: '今週のまとめ' },
    { id: 'finding', at: '2026-10-18', kind: 'finding', text: '気付いたこと' }
  ];
  const { page, errors, close } = await open({ data, extra: { 'kintore:posts': posts } });
  await page.clock.install({ time: new Date('2026-10-21T12:00:00Z') });
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.see.list .h1').textContent(), 'コーチ');
  assert.deepEqual(await page.locator('.tw .t').allTextContents(),
    ['自分の相談', '送ったメモ', '相談への返信', '読む記事', '今週のまとめ', '気付いたこと']);
  assert.deepEqual(await page.locator('.tw .av').allTextContents(), ['私', '私', '', '', '', '']);
  assert.equal(await page.locator('.tw .av.me').count(), 2);
  assert.equal(await page.locator('.tw .av.mark svg').count(), 4);
  assert.deepEqual(await page.locator('.tw .who').evaluateAll(nodes =>
    nodes.map(node => node.firstChild.textContent)), ['自分', '自分', 'コーチ', 'コーチ', 'コーチ', 'コーチ']);
  assert.deepEqual(await page.locator('.tw .tag').allTextContents(), ['返信', '読み物', '週のまとめ', '発見']);
  assert.equal(await page.locator('.tw .q').textContent(), '引用した相談');
  assert.equal(await page.locator('.tw').nth(1).locator('.who small').textContent(), '今日 ・ トレーニングのメモ');
  assert.equal(await page.locator('.tl .note').count(), 1);
  assert.equal(await page.locator('.tl > .tw + .note').textContent(), '返事は明日の朝 7:22 ごろ届きます');
  assert.equal(await page.locator('.tl > :nth-child(2)').getAttribute('class'), 'note');
  assert.deepEqual((await stored(page)).sessions, data.sessions);
  assert.deepEqual(errors, []);
  await close();
});
test('coach writing trims, prepends and persists messages without sending whitespace or vibrating', async () => {
  const data = fixture();
  data.messages = [{ id: 'old', at: '2026-10-19T12:00:00Z', text: '前の相談' }];
  const { page, errors, close } = await open({ data });
  const now = new Date('2026-10-21T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.evaluate(() => {
    window.vibrations = [];
    navigator.vibrate = value => { window.vibrations.push(value); return true; };
  });
  await tab(page, 'コーチ').click();
  const input = page.locator('.press.compose textarea');
  const send = press(page, '送る');
  assert.equal(await input.getAttribute('placeholder'), 'コーチに書く…');
  assert.equal(await input.getAttribute('maxlength'), '1000');
  assert.ok(await send.isDisabled());
  await input.fill('   　  ');
  assert.ok(await send.isDisabled());
  assert.deepEqual((await stored(page)).messages, data.messages);
  await input.fill('  次の種目を相談したい  ');
  assert.equal(await input.evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
  assert.equal(await input.evaluate(node => getComputedStyle(node, '::placeholder').color), 'rgb(143, 160, 191)');
  assert.equal(await send.isDisabled(), false);
  await send.click();
  const messages = (await stored(page)).messages;
  assert.equal(messages.length, 2);
  assert.match(messages[0].id, /^m_[a-z0-9]{8}$/);
  assert.equal(messages[0].at, now.toISOString());
  assert.equal(messages[0].text, '次の種目を相談したい');
  assert.deepEqual(messages[1], data.messages[0]);
  assert.equal(await page.locator('.tw .t').first().textContent(), messages[0].text);
  assert.equal(await page.locator('.tw .who small').first().textContent(), 'いま');
  assert.equal(await input.inputValue(), '');
  assert.ok(await send.isDisabled());
  assert.deepEqual(await page.evaluate(() => window.vibrations), []);
  await page.reload();
  await tab(page, 'コーチ').click();
  assert.deepEqual((await stored(page)).messages, messages);
  assert.equal(await page.locator('.tw .t').first().textContent(), messages[0].text);
  assert.deepEqual(errors, []);
  await close();
});

test('home card previews the newest unread coach post and opens the coach tab', async () => {
  const posts = [
    { id: 'old', at: '2026-10-19', kind: 'reply', text: '前の返信' },
    { id: 'newest', at: '2026-10-21T07:23:00Z', kind: 'reading', text: '新しい読み物' },
    { id: 'seen', at: '2026-10-21T09:00:00Z', kind: 'finding', text: '読んだ発見' }
  ];
  const { page, errors, close } = await open({ data: fixture(), extra: {
    'kintore:posts': posts, 'kintore:seen': ['seen']
  } });
  await page.clock.install({ time: new Date('2026-10-21T12:00:00Z') });
  await page.reload();
  await home(page);
  assert.equal(await tab(page, 'コーチ').locator('.badge').textContent(), '2');
  assert.equal(await page.locator('.feed .card').count(), 1);
  assert.equal(await page.locator('.week + .card + .quick').count(), 1);
  assert.equal(await page.locator('.card .av.mark svg').count(), 1);
  assert.equal(await page.locator('.card .who').evaluate(node => node.firstChild.textContent), 'コーチ');
  assert.equal(await page.locator('.card .who small').textContent(), '今日 7:23 ・ 読み物');
  assert.equal(await page.locator('.card .preview').textContent(), '新しい読み物');
  assert.equal(await page.locator('.card .preview').evaluate(node =>
    getComputedStyle(node).webkitLineClamp), '2');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:seen'))), ['seen']);
  await page.locator('.card').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'coach');
  assert.equal(await tab(page, 'コーチ').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.tw.unread').count(), 2);
  assert.equal(await tab(page, 'コーチ').locator('.badge').count(), 0);
  await home(page);
  assert.equal(await page.locator('.card').count(), 0);
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.tw.unread').count(), 0);
  await page.reload();
  assert.equal(await page.locator('.card, .tabs .badge').count(), 0);
  assert.deepEqual(errors, []);
  await close();
});
test('coach waiting note uses the next morning and disappears when fetched coach posts are newer', async () => {
  const data = fixture();
  const now = new Date();
  now.setHours(6, 0, 0, 0);
  data.messages = [{ id: 'm1', at: new Date(now.getTime() - 3600000).toISOString(), text: '朝の相談' }];
  const { page, api, errors, close } = await open({ data,
    github: { owner: 'me', repo: 'data', token: 't' } });
  await page.clock.install({ time: now });
  await page.reload();
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.note').textContent(), '返事は今日の朝 7:22 ごろ届きます');
  now.setHours(12);
  await page.clock.setFixedTime(now);
  await tab(page, '記録').click();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('posts.json')),
    tab(page, 'コーチ').click()
  ]);
  assert.equal(await page.locator('.note').textContent(), '返事は明日の朝 7:22 ごろ届きます');
  api.posts = [{ id: 'answer', at: new Date(now.getTime() - 60000).toISOString(),
    kind: 'reply', text: '届いた返信', quote: '朝の相談' }];
  await page.clock.setFixedTime(new Date(now.getTime() + 600001));
  await tab(page, '記録').click();
  await tab(page, 'コーチ').click();
  await page.waitForFunction(() => document.querySelector('.tw .t')?.textContent === '届いた返信');
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'coach');
  assert.equal(await page.locator('.note').count(), 0);
  assert.equal(await page.locator('.tw .q').textContent(), '朝の相談');
  assert.deepEqual(errors, []);
  await close();
});

test('old data without messages renders every tab and the empty coach compose bar', async () => {
  const data = fixture();
  assert.equal(Object.hasOwn(data, 'messages'), false);
  const { page, errors, close } = await open({ data });
  for (const [name, mode] of [['ホーム', 'today'], ['記録', 'records'], ['コーチ', 'coach'],
    ['種目', 'exercises'], ['設定', 'settings']]) {
    await tab(page, name).click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), mode);
    if (mode === 'coach') {
      assert.equal(await page.locator('.empty b').textContent(), 'まだやり取りはありません');
      assert.equal(await page.locator('.empty p').textContent(), '下の欄からコーチに書けます。返事は翌朝 7:22 ごろ届きます。');
      assert.equal(await page.locator('.press.compose textarea').count(), 1);
      assert.ok(await press(page, '送る').isDisabled());
      assert.equal(await page.locator('.tl, .note, .tabs .badge').count(), 0);
    }
    await principles(page);
  }
  assert.deepEqual(await stored(page), data);
  assert.deepEqual(errors, []);
  await close();
});

test('coach compose keeps Enter as a newline, sends multiline text and grows only to five lines', async () => {
  const data = fixture();
  data.messages = [];
  const { page, errors, close } = await open({ data });
  await tab(page, 'コーチ').click();
  const input = page.locator('.press.compose textarea');
  const send = press(page, '送る');
  const height = () => input.evaluate(node => node.getBoundingClientRect().height);
  assert.equal(await input.getAttribute('rows'), '1');
  assert.equal(await input.getAttribute('maxlength'), '1000');
  assert.equal(await input.getAttribute('placeholder'), 'コーチに書く…');
  const oneLine = await height();
  assert.equal(oneLine, 44);
  assert.ok(await send.isDisabled());

  await input.fill('  一行目');
  await page.keyboard.press('Enter');
  assert.equal(await input.inputValue(), '  一行目\n');
  assert.deepEqual((await stored(page)).messages, []);
  assert.equal(await page.locator('.tw').count(), 0);
  await page.keyboard.insertText('二行目  ');
  assert.ok(await height() > oneLine);
  assert.equal(await send.isDisabled(), false);
  await send.click();

  const messages = (await stored(page)).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, '一行目\n二行目');
  const text = page.locator('.tw .t').first();
  assert.equal(await text.textContent(), messages[0].text);
  assert.equal(await text.evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap');
  assert.ok(await text.evaluate(node =>
    Math.abs(node.getBoundingClientRect().height -
      2 * parseFloat(getComputedStyle(node).lineHeight)) < 1));
  assert.equal(await input.inputValue(), '');
  assert.equal(await height(), oneLine);
  assert.ok(await send.isDisabled());

  await input.fill('一\n二\n三');
  const threeLines = await height();
  assert.ok(threeLines > oneLine);
  await input.fill('一\n二\n三\n四\n五');
  const fiveLines = await height();
  assert.ok(fiveLines > threeLines);
  assert.ok(await input.evaluate(node =>
    Math.abs(node.getBoundingClientRect().height -
      (44 + 4 * parseFloat(getComputedStyle(node).lineHeight))) <= 1));
  await input.fill('一\n二\n三\n四\n五\n六\n七');
  assert.ok(Math.abs(await height() - fiveLines) <= 1);
  assert.equal(await input.evaluate(node => getComputedStyle(node).overflowY), 'auto');
  assert.ok(await input.evaluate(node => node.scrollHeight > node.clientHeight));
  assert.ok(await page.locator('.press.compose').evaluate(node =>
    Math.abs(node.querySelector('textarea').getBoundingClientRect().bottom -
      node.querySelector('.send').getBoundingClientRect().bottom) < 1));

  await send.click();
  assert.equal((await stored(page)).messages[0].text, '一\n二\n三\n四\n五\n六\n七');
  assert.equal(await input.inputValue(), '');
  assert.equal(await height(), oneLine);
  assert.ok(await send.isDisabled());
  await input.fill(' \n　');
  assert.ok(await send.isDisabled());
  assert.equal((await stored(page)).messages.length, 2);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('coach post newlines stay visible in the timeline and the home card stays clamped to two lines', async () => {
  const text = '一行目\n二行目\n三行目';
  const posts = [{ id: 'multiline', at: '2026-10-21', kind: 'reply', text }];
  const { page, errors, close } = await open({
    data: fixture(), extra: { 'kintore:posts': posts }
  });
  const preview = page.locator('.card .preview');
  assert.equal(await preview.textContent(), text);
  assert.equal(await preview.evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap');
  assert.equal(await preview.evaluate(node => getComputedStyle(node).webkitLineClamp), '2');
  assert.ok(await preview.evaluate(node =>
    Math.abs(node.getBoundingClientRect().height -
      2 * parseFloat(getComputedStyle(node).lineHeight)) < 1));
  await page.locator('.card').click();
  const body = page.locator('.tw .t');
  assert.equal(await body.textContent(), text);
  assert.equal(await body.evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap');
  assert.ok(await body.evaluate(node =>
    Math.abs(node.getBoundingClientRect().height -
      3 * parseFloat(getComputedStyle(node).lineHeight)) < 1));
  assert.deepEqual(errors, []);
  await close();
});

test('part badges and training figures highlight each part with the matching front or back view', async () => {
  const data = fixture();
  const parts = ['胸', '背中', '脚', '肩', '腕', '体幹', '全身'];
  data.exercises = parts.map((part, index) => ({
    id: 'part' + index, name: part + 'の種目', type: 'reps', part, archived: false
  }));
  data.sessions = [{ ...data.sessions.at(-1), sets: data.exercises.map(ex => ({
    exerciseId: ex.id, reps: 10
  })) }];
  data.body = [];
  const { page, errors, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: data.exercises.map(ex => ex.id) }
  } });
  async function checkFigure(figure, part) {
    assert.equal(await figure.getAttribute('aria-hidden'), 'true');
    assert.equal(await figure.getAttribute('data-view'), part === '背中' ? 'back' : 'front');
    assert.equal(await figure.locator('circle').getAttribute('fill'), '#DDE2EA');
    const regions = await figure.locator('[data-part]').evaluateAll(nodes =>
      nodes.map(node => ({ part: node.dataset.part, fill: node.getAttribute('fill') })));
    assert.ok(regions.length > 0);
    assert.ok(regions.some(region => region.fill === '#D03C22'));
    for (const region of regions) {
      assert.equal(region.fill, part === '全身' || region.part === part ? '#D03C22' : '#B4BDCC');
    }
    assert.equal(await figure.locator('[data-part="背中"]').count(), part === '背中' ? 1 : 0);
  }
  for (const ex of data.exercises) {
    const badge = page.locator('.ln[data-exercise-id="' + ex.id + '"] > .pi');
    assert.equal(await badge.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(await badge.evaluate(node => [node.offsetWidth, node.offsetHeight]), [34, 34]);
    await checkFigure(badge.locator('svg'), ex.part);
  }
  await tab(page, '記録').click();
  for (const ex of data.exercises) {
    await checkFigure(page.locator('.xc[data-exercise-id="' + ex.id + '"] .xh > .pi svg'), ex.part);
  }
  await principles(page);
  await home(page);
  await press(page, '始める').click();
  for (const [index, ex] of data.exercises.entries()) {
    assert.equal(await page.locator('.tag2').textContent(), ex.part);
    await checkFigure(page.locator('.tag2 .pi svg'), ex.part);
    const figure = page.locator('.exhead > svg');
    await checkFigure(figure, ex.part);
    assert.deepEqual(await figure.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return [rect.width, rect.height];
    }), [64, 100]);
    await principles(page);
    if (index < data.exercises.length - 1) await press(page, '次 ▶').click();
  }
  assert.deepEqual((await stored(page)).sessions, data.sessions);
  assert.deepEqual(errors, []);
  await close();
});
test('weekly part legend counts recorded sets, sorts ties and keeps whole body last only when positive', async () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const parts = ['胸', '背中', '脚', '肩', '腕', '体幹', '全身'];
  for (const whole of [12, 0]) {
    const data = fixture(now);
    data.exercises = parts.map((part, index) => ({
      id: 'part' + index, name: part + 'の種目', type: 'reps', part, archived: index === 2
    }));
    data.exercises.push({ id: 'chest2', name: '別の胸', type: 'reps', part: '胸', archived: false });
    const counts = [5, 10, 6, 1, 0, 0, whole];
    data.sessions = [
      { id: 'monday', date: '2026-10-19', light: true, sets: counts.flatMap((count, index) =>
        Array.from({ length: count }, () => ({ exerciseId: 'part' + index, reps: 10 }))) },
      { id: 'friday', date: '2026-10-23', light: false, sets: [{ exerciseId: 'chest2', reps: 0 }] },
      { id: 'outside', date: '2026-10-18', light: false,
        sets: Array.from({ length: 20 }, () => ({ exerciseId: 'part4', reps: 10 })) }
    ];
    data.body = [];
    const { page, errors, close } = await open({ data });
    await page.clock.install({ time: now });
    await page.clock.setFixedTime(now);
    await page.reload();
    await tab(page, '記録').click();
    assert.equal(await page.locator('.seg + .bm2 > .k').textContent(), '今週の部位（セット数）');
    const expected = Object.fromEntries(parts.map(part => [part, 0]));
    for (const session of data.sessions.filter(session =>
      session.date >= '2026-10-19' && session.date <= '2026-10-25')) {
      for (const set of session.sets) expected[data.exercises.find(ex => ex.id === set.exerciseId).part]++;
    }
    const legend = await page.locator('.bm2 .lg > span').evaluateAll(nodes => nodes.map(node => ({
      part: node.firstChild.textContent, count: Number(node.querySelector('b').textContent),
      low: node.classList.contains('low'), color: getComputedStyle(node).color
    })));
    assert.deepEqual(legend.map(row => [row.part, row.count]),
      [['背中', 10], ['胸', 6], ['脚', 6], ['肩', 1], ['腕', 0], ['体幹', 0],
        ...(whole ? [['全身', whole]] : [])]);
    for (const row of legend) {
      assert.equal(row.low, expected[row.part] === 0);
      if (row.low) assert.equal(row.color, 'rgb(208, 60, 34)');
    }
    for (const region of await page.locator('.bm2 .figs [data-part]').evaluateAll(nodes =>
      nodes.map(node => ({ part: node.dataset.part, fill: node.getAttribute('fill') })))) {
      const count = expected[region.part];
      assert.equal(region.fill, count >= 10 ? '#1C2B4B' : count >= 6 ? '#4A5C82' :
        count >= 1 ? '#8FA0BF' : '#DDE2EA');
    }
    assert.deepEqual(await page.locator('.bm2 .figs svg').evaluateAll(nodes =>
      nodes.map(node => [node.dataset.view, node.getAttribute('aria-hidden')])),
      [['front', 'true'], ['back', 'true']]);
    assert.deepEqual(await page.locator('.bm2 .figs svg').evaluateAll(nodes =>
      nodes.map(node => [node.getBoundingClientRect().width, node.getBoundingClientRect().height])),
      [[38, 60], [38, 60]]);
    await principles(page);
    await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
    assert.equal(await page.locator('.bm2').count(), 0);
    assert.deepEqual((await stored(page)).sessions, data.sessions);
    assert.deepEqual(errors, []);
    await close();
  }
});
test('summary stamps only cleared first sets and maps only parts recorded today', async () => {
  const data = fixture();
  data.exercises.push({ id: 'legs', name: '脚の種目', type: 'reps', part: '脚', archived: false });
  const { page, errors, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1', 'e2', 'e3', 'e4', 'legs'] }
  } });
  await startLight(page);
  const inputs = [['e1', 200], ['e2', 19], ['e3', 0], ['e4', 10]];
  for (const [index, [id, amount]] of inputs.entries()) {
    if (index) {
      await page.locator('.tr-top .prog').click();
      await sheet(page).locator('.jl[data-exercise-id="' + id + '"]').click();
      await page.waitForFunction(() => !window.history.state?.sheet);
    }
    if (id === 'e2') await press(page, '赤').click();
    await page.locator('.counter .num').click();
    await page.locator('.counter input').fill(String(amount));
    await page.locator('.counter input').press('Enter');
    await complete(page);
    await press(page, '休憩を終える').click();
    if (id === 'e3') {
      await press(page, '＋ もう1セット').click();
      await page.locator('.counter .num').click();
      await page.locator('.counter input').fill('600');
      await page.locator('.counter input').press('Enter');
      await complete(page);
      await press(page, '休憩を終える').click();
    }
  }
  const before = await stored(page);
  await finishTraining(page);
  assert.equal(await page.locator('.exname').textContent(), '今日の記録');
  assert.equal(await page.locator('.sumrow.st').count(), 4);
  assert.equal(await page.locator('.sumrow[data-exercise-id=e1] .stamp').textContent(), '突破');
  assert.equal(await page.locator('.sumrow[data-exercise-id=e1] .stamp br').count(), 1);
  assert.equal(await page.locator('.sumrow .stamp').count(), 1);
  const today = before.sessions.at(-1);
  for (const id of ['e2', 'e3', 'e4']) {
    const first = today.sets.find(set => set.exerciseId === id);
    assert.notEqual(firstSetResult(before, id, today.date, first).kind, 'clear');
    assert.equal(await page.locator('.sumrow[data-exercise-id="' + id + '"] .stamp').count(), 0);
  }
  assert.equal(await page.locator('.sumrow[data-exercise-id=legs]').count(), 0);
  assert.equal(await page.locator('.bm-card .k').textContent(), '今日きたえた部位');
  for (const region of await page.locator('.bodymap [data-part]').evaluateAll(nodes =>
    nodes.map(node => ({ part: node.dataset.part, fill: node.getAttribute('fill') })))) {
    assert.equal(region.fill, ['胸', '背中', '体幹'].includes(region.part) ? '#1C2B4B' : '#DDE2EA');
  }
  assert.deepEqual(await page.locator('.bodymap svg').evaluateAll(nodes =>
    nodes.map(node => [node.dataset.view, node.getAttribute('aria-hidden')])),
    [['front', 'true'], ['back', 'true']]);
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
  }
  assert.deepEqual((await stored(page)).sessions, before.sessions);
  assert.deepEqual(errors, []);
  await close();
});

test('coach avatars use the app icon while own messages keep the original avatar', async () => {
  const data = fixture();
  data.messages = [{ id: 'mine', at: '2026-10-23', text: '自分の相談' }];
  const { page, errors, close } = await open({ data, extra: {
    'kintore:posts': [{ id: 'coach', at: '2026-10-23', kind: 'reply', text: 'コーチの返事' }]
  } });
  const avatar = page.locator('.card .av.mark');
  assert.equal(await avatar.textContent(), '');
  assert.equal(await avatar.getAttribute('aria-hidden'), 'true');
  assert.equal(await avatar.locator('svg').getAttribute('viewBox'), '0 0 192 192');
  assert.equal(await avatar.locator('rect').first().getAttribute('fill'), '#2F4C8F');
  assert.equal(await avatar.locator('path').getAttribute('stroke'), '#fff');
  assert.equal(await avatar.locator('rect[fill="#FF6A4D"]').count(), 4);
  const icon = await avatar.innerHTML();
  await tab(page, 'コーチ').click();
  assert.equal(await page.locator('.tw .av.mark').innerHTML(), icon);
  assert.equal(await page.locator('.tw .av.me').textContent(), '私');
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
  }
  assert.deepEqual(errors, []);
  await close();
});

test('empty coach and records show decorative line art without a weekly map', async () => {
  const data = fixture();
  data.sessions = [];
  data.body = [];
  data.skips = [];
  const { page, errors, close } = await open({ data });
  for (const name of ['記録', 'コーチ']) {
    await tab(page, name).click();
    const illustration = page.locator('.empty > .illo');
    assert.equal(await illustration.getAttribute('aria-hidden'), 'true');
    assert.equal(await illustration.locator('svg').getAttribute('viewBox'), '0 0 150 110');
    assert.equal(await illustration.locator('path').count(), name === 'コーチ' ? 5 : 4);
    assert.equal(await illustration.locator('path[stroke="#D03C22"]').count(), 2);
    assert.equal(await illustration.locator('svg').evaluate(node => getComputedStyle(node).stroke),
      'rgb(28, 43, 75)');
    assert.equal(await page.locator('.bm-card').count(), 0);
    for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      await page.setViewportSize(size);
      await principles(page);
    }
  }
  assert.deepEqual(await stored(page), data);
  assert.deepEqual(errors, []);
  await close();
});

test('recordDelta compares the latest first set with the nearest earlier day at the same load', async () => {
  const { recordDelta } = await import('../logic.js');
  const entries = [
    { date: '2026-10-20', value: 10, load: 5 },
    { date: '2026-10-21', value: 15, load: 5 },
    { date: '2026-10-22', value: 100, load: 6 },
    { date: '2026-10-23', value: 14, load: 5 }
  ];
  const before = structuredClone(entries);
  assert.equal(recordDelta(entries), -1);
  assert.equal(recordDelta([...entries, { date: '2026-10-24', value: 16, load: 5 }]), 2);
  assert.equal(recordDelta([...entries, { date: '2026-10-24', value: 14, load: 5 }]), 0);
  assert.equal(recordDelta([]), null);
  assert.equal(recordDelta(entries.slice(0, 1)), null);
  assert.equal(recordDelta(entries.slice(1, 3)), null);
  assert.equal(recordDelta([{ value: 0, load: 0 }, { value: 5, load: 0 }]), 5);
  assert.deepEqual(entries, before);
});

test('loadUpPoints compares adjacent recorded days including light and mixed-load days', async () => {
  const { loadUpPoints } = await import('../logic.js');
  for (const type of ['weight', 'band', 'reps', 'time']) {
    const data = fixture();
    data.exercises = [{ ...data.exercises[0], type, nextId: null }];
    data.bands = [{ id: 'a', name: 'Light', order: 1 }, { id: 'b', name: 'Heavy', order: 2 }];
    const loads = [1, 1, 2, 1, 2];
    data.sessions = loads.map((amount, index) => ({
      id: 's' + index, date: '2026-10-' + (20 + index), light: index === 2, note: '',
      sets: [
        { exerciseId: 'e1', reps: 10 + index, sec: 30 + index,
          kg: amount / 10, bandId: amount === 1 ? 'a' : 'b' },
        { exerciseId: 'e1', reps: 99, sec: 99, kg: 500, bandId: 'b' }
      ]
    }));
    const before = structuredClone(data);
    assert.deepEqual(loadUpPoints(data, 'e1'), type === 'weight' || type === 'band' ? [
      { date: '2026-10-22', label: type === 'weight' ? '+0.1kg' : 'Heavy' },
      { date: '2026-10-24', label: type === 'weight' ? '+0.1kg' : 'Heavy' }
    ] : []);
    assert.deepEqual(data, before);
    data.sessions = [];
    assert.deepEqual(loadUpPoints(data, 'e1'), []);
  }
});

test('monthCalendar counts distinct set days and rest-only days with Monday alignment', async () => {
  const { monthCalendar } = await import('../logic.js');
  const data = fixture();
  const set = { exerciseId: 'e1', reps: 0 };
  data.sessions = [
    { date: '2026-10-01', light: false, sets: [set] },
    { date: '2026-10-01', light: true, sets: [set] },
    { date: '2026-10-26', light: true, sets: [set] },
    { date: '2026-10-27', light: false, sets: [] },
    { date: '2026-09-30', light: false, sets: [set] },
    { date: '2026-11-01', light: false, sets: [set] }
  ];
  data.skips = [
    { date: '2026-10-01', reason: '疲れ' },
    { date: '2026-10-22', reason: '予定' },
    { date: '2026-10-22', reason: '予定' },
    { date: '2026-10-27', reason: 'その他' },
    { date: '2026-09-30', reason: '予定' }
  ];
  data.body = [{ date: '2026-10-23', kg: 68, waist: null }];
  const before = structuredClone(data);
  const month = monthCalendar(data, '2026-10-26');
  assert.deepEqual([month.year, month.month, month.offset, month.done, month.rest],
    [2026, 10, 3, 2, 2]);
  assert.equal(month.days.length, 31);
  assert.deepEqual(month.days.filter(day => day.mark), [
    { date: '2026-10-01', mark: 'd' },
    { date: '2026-10-22', mark: 'r' },
    { date: '2026-10-26', mark: 'd' },
    { date: '2026-10-27', mark: 'r' }
  ]);
  assert.deepEqual(data, before);
  assert.equal(monthCalendar(data, '2028-02-29').days.length, 29);
  const january = monthCalendar(data, '2027-01-01');
  assert.deepEqual([january.offset, january.done, january.rest], [4, 0, 0]);
  assert.equal(january.days[0].date, '2027-01-01');
  assert.equal(january.days.at(-1).date, '2027-01-31');
  assert.equal(monthCalendar(data, '2026-06-01').offset, 0);
});

test('exercise cards show actual loads, first sets, lines, deltas and load-up markers for all types', async () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const data = fixture(now);
  data.exercises = [
    { id: 'w', name: '重りの種目', type: 'weight', part: '胸', archived: false },
    { id: 'b', name: 'バンドの種目', type: 'band', part: '背中', archived: false },
    { id: 'r', name: '自重の種目', type: 'reps', part: '脚', archived: false },
    { id: 't', name: '時間の種目', type: 'time', part: '体幹', archived: false }
  ];
  data.bands = [{ id: 'light', name: 'Light', order: 1 }, { id: 'heavy', name: 'Heavy', order: 2 }];
  data.body = [];
  data.skips = [];
  data.sessions = Array.from({ length: 14 }, (_, index) => ({
    id: 's' + index, date: '2026-10-' + (13 + index), light: index === 13, note: '',
    sets: data.exercises.flatMap(ex => [
      { exerciseId: ex.id, reps: index === 13 ? 13 : index === 12 ? 11 : 10,
        sec: index === 13 ? 29 : 30, kg: index >= 2 ? 15 : 10,
        bandId: index >= 2 ? 'heavy' : 'light' },
      { exerciseId: ex.id, reps: 99, sec: 99, kg: 100, bandId: 'heavy' }
    ])
  }));
  const { page, errors, close } = await open({ data });
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.reload();
  await tab(page, '記録').click();
  for (const ex of data.exercises) {
    const card = page.locator('.xc[data-exercise-id="' + ex.id + '"]');
    assert.equal(await card.locator('.xh b').textContent(), ex.name);
    assert.deepEqual(await card.locator('.xs > div > small').allTextContents(),
      ['負荷', '1セット目', '次のライン']);
    assert.equal(await card.locator('.xs > div').first().locator('p').textContent(),
      ex.type === 'weight' ? '15kg' : ex.type === 'band' ? 'Heavy' : '自重');
    assert.equal(await card.locator('.xs > div').nth(1).locator('p').textContent(),
      ex.type === 'time' ? '29秒' : '13回');
    assert.equal(await card.locator('.ln2 .num').textContent(),
      String(line(data, ex.id, '2026-10-26').value ?? '—'));
    assert.equal(await card.locator('.xp em').textContent(), ex.type === 'time' ? '−1秒' : '+2回');
    assert.ok((await card.locator('.xp').textContent()).includes(' ・ 今日'));
    const values = setHistory(data, ex.id).slice(-12).map(entry => entry.value);
    const points = (await card.locator('.spark polyline').getAttribute('points'))
      .split(' ').map(point => point.split(',').map(Number));
    assert.equal(points.length, 12);
    assert.ok(points[0][1] > points.at(-1)[1] || ex.type === 'time');
    for (let i = 1; i < points.length; i++) {
      if (values[i] === values[i - 1]) assert.equal(points[i][1], points[i - 1][1]);
      if (values[i] > values[i - 1]) assert.ok(points[i][1] < points[i - 1][1]);
      if (values[i] < values[i - 1]) assert.ok(points[i][1] > points[i - 1][1]);
    }
    assert.deepEqual(await card.locator('.spark .pt').evaluate(node =>
      [Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))]), points.at(-1));
    assert.deepEqual(await card.locator('.spark text').allTextContents(),
      ex.type === 'weight' ? ['+5kg'] : ex.type === 'band' ? ['Heavy'] : []);
    assert.equal(await card.locator('.spark line.up').count(),
      ex.type === 'weight' || ex.type === 'band' ? 1 : 0);
  }
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
    assert.equal(await page.locator('.see').evaluate(node => node.scrollWidth > node.clientWidth), false);
  }
  assert.deepEqual(await stored(page), data);
  assert.deepEqual(errors, []);
  await close();
});

test('sparse exercise and body cards show counts without lines and omit absent deltas', async () => {
  const now = new Date('2026-10-26T12:00:00Z');
  for (const count of [1, 2, 3]) {
    const data = fixture(now);
    data.sessions = Array.from({ length: count }, (_, index) => ({
      id: 's' + index, date: '2026-10-' + (24 + index), light: false, note: '',
      sets: [{ exerciseId: 'e1', reps: 0 }]
    }));
    data.body = data.sessions.map(session => ({ date: session.date, kg: 68, waist: null }));
    data.skips = [];
    const { page, errors, close } = await open({ data });
    await page.clock.install({ time: now });
    await page.clock.setFixedTime(now);
    await page.reload();
    await tab(page, '記録').click();
    assert.deepEqual(await page.locator('.xc .few').allTextContents(),
      Array(2).fill('記録 ' + count + '回 ・ 4回から線で伸びを描く'));
    assert.equal(await page.locator('.xc .spark, .xc .xp em').count(), 0);
    const body = page.locator('.xc[data-exercise-id=body]');
    assert.equal(await body.locator('.xh .pi').count(), 0);
    assert.deepEqual(await body.locator('.xs > div').evaluateAll(nodes =>
      nodes.map(node => node.getBoundingClientRect().width)).then(widths =>
        widths.map(width => Math.round(width))), [158, 158]);
    await principles(page);
    assert.deepEqual(errors, []);
    await close();
  }
});

test('day calendar and cards preserve counts, values, month groups, memos and sheet navigation', async () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const data = fixture(now);
  data.exercises[0].type = 'weight';
  data.sessions = [
    { id: 'old', date: '2026-09-30', light: false, note: '',
      sets: [{ exerciseId: 'e1', reps: 8, kg: 10 }] },
    { id: 'today', date: '2026-10-26', light: true, note: '最初の行\n次の行', sets: [
      { exerciseId: 'e1', reps: 13, kg: 15 }, { exerciseId: 'e1', reps: 10, kg: 15 },
      { exerciseId: 'e1', reps: 7, kg: 10 }, { exerciseId: 'e2', reps: 12, bandId: 'k' },
      { exerciseId: 'e3', sec: 30 }
    ] }
  ];
  data.skips = [{ date: '2026-10-26', reason: '疲れ' }, { date: '2026-10-22', reason: '予定' }];
  data.body = [{ date: '2026-10-23', kg: 68.2, waist: null }];
  const { page, errors, close } = await open({ data });
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.reload();
  await tab(page, '記録').click();
  await page.locator('.seg').getByRole('button', { name: '日ごと', exact: true }).click();
  assert.equal(await page.locator('.rhead .pill.add').textContent(), '＋ 過去の日');
  assert.equal(await page.locator('.see > .quick').count(), 0);
  assert.equal(await page.locator('.cal .mh b').textContent(), '2026年10月');
  assert.equal(await page.locator('.cal .mh span').textContent(), 'やった日 1 ・ 休み 1');
  assert.deepEqual(await page.locator('.cal .w').allTextContents(), [...'月火水木金土日']);
  assert.equal(await page.locator('.cal button, .cal a, .cal [tabindex]').count(), 0);
  assert.equal(await page.locator('.cal [data-date]').count(), 31);
  assert.equal(await page.locator('.cal .g > i').nth(10).getAttribute('data-date'), '2026-10-01');
  assert.equal(await page.locator('.cal [data-date="2026-10-26"]').getAttribute('class'), 'd t');
  assert.equal(await page.locator('.cal [data-date="2026-10-22"]').getAttribute('class'), 'r');
  assert.equal(await page.locator('.cal [data-date="2026-10-23"]').getAttribute('class'), '');
  assert.deepEqual(await page.locator('.mo').allTextContents(), ['10月', '9月']);
  const today = page.locator('.dc[data-date="2026-10-26"]');
  assert.equal(await today.locator('.dd .num').textContent(), '26');
  assert.equal(await today.locator('.dd small').textContent(), '月');
  assert.equal(await today.locator('.top').textContent(), '3種目 ・ 5セット ・ 軽め ・ 休み');
  assert.deepEqual(await today.locator('li .v').allTextContents(), ['15kg13・10 ・ 10kg7', '黒12', '30秒']);
  assert.deepEqual(await today.locator('li .v small').allTextContents(), ['15kg', '10kg', '黒']);
  assert.equal(await today.locator('.memo').textContent(), '最初の行');
  await today.click();
  assert.equal(await sheet(page).getByLabel('メモ', { exact: true }).inputValue(), '最初の行\n次の行');
  await closeSheet(page);
  const rest = page.locator('.rest[data-date="2026-10-22"]');
  assert.equal(await rest.textContent(), '22木 ・ 休み（予定）');
  await rest.click();
  assert.ok((await sheet(page).textContent()).includes('休み（予定）'));
  await closeSheet(page);
  const body = page.locator('.rest[data-date="2026-10-23"]');
  assert.equal(await body.textContent(), '23金 ・ 体重 68.2kg');
  await body.click();
  assert.ok((await sheet(page).textContent()).includes('体重 68.2kg'));
  await closeSheet(page);
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
    assert.equal(await page.locator('.see').evaluate(node => node.scrollWidth > node.clientWidth), false);
  }
  assert.deepEqual(await stored(page), data);
  assert.deepEqual(errors, []);
  await close();
});
