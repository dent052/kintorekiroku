// End-to-end tests: real Chromium at phone size against the static app.
// Run: npm run e2e   (set CHROMIUM_PATH if Chromium is not at /opt/pw-browsers/chromium)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './fixture.mjs';
import { localDate, line, menuExercises, prefill, weekHeat, clearCount, totals,
  bodyAvg7, feed, mergeFeed, lineHistory, weekStart } from '../logic.js';

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
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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
const tab = (page, text) => page.locator('.tabs').getByRole('button', { name: text, exact: true });
const sheet = page => page.locator('dialog.sheet[open]').last();
const settings = page => tab(page, '設定').click();
const pill = (page, text) => page.locator('.see .pill').getByText(text, { exact: true });

async function adjust(page, name) {
  await pill(page, '今日の調整').click();
  await sheet(page).locator('.row').filter({ has: page.getByText(name, { exact: true }) }).click();
}

async function home(page) {
  if (await page.locator('.tabs').isVisible()) await tab(page, 'ホーム').click();
  else await press(page, 'ホーム').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
}

async function leaveTraining(page) {
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: 'トレーニングをやめる', exact: true }).click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'summary');
  await principles(page);
  await press(page, 'ホームへ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
}

async function principles(page) {
  assert.deepEqual(await page.$$eval('button, a[href], select, input, textarea, [role=slider]', elements =>
    elements.filter(element => !element.closest('.press, dialog.sheet, .slab, .tabs') &&
      !element.closest('.see .ln, .see .rec, .see .ex, .see .pill, .see .back'))
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
    await pill(page, '今日の調整').click();
    await principles(page);
    await closeSheet(page);
    for (const text of ['メニュー変更', '休む', '体重']) {
      await adjust(page, text === 'メニュー変更' ? 'メニュー' : text);
      await principles(page);
      if (text === 'メニュー変更') {
        await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
        await principles(page);
      }
      await closeSheet(page);
    }
    await press(page, '始める').click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
    assert.equal(await page.locator('.tabs').isVisible(), false);
    await principles(page);
    await leaveTraining(page);
    await adjust(page, '軽めの日');
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
  await adjust(page, 'メニュー');
  await sheet(page).getByRole('button', { name: '胸と背中', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await check({ kind: 'template', templateId: 't1' });
  assert.match(await page.textContent('.hello'), /胸と背中/);
  await adjust(page, 'メニュー');
  await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '腕立て伏せ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '足上げ腕立て', exact: true }).click();
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
  await press(page, '完了').click();
  await press(page, 'バンドロウ 1回増やす').click();
  const amount = await page.locator('.counter .num').textContent();
  await home(page);
  await press(page, '続きから').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.match(await page.textContent('.tr-top'), /2 \/ 3 ・ 2セット目へ/);
  assert.equal(await page.locator('.counter .num').textContent(), amount);
  assert.equal(await page.locator('.counter .pm').last().getAttribute('aria-label'), 'バンドロウ 1回増やす');
  assert.equal(await page.locator('.ring').count(), 1);
  await press(page, '休憩を終える').click();
  await home(page);
  await press(page, '続きから').click();
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  assert.match(await page.textContent('.see'), /2セット目/);
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
  await backTo(page, 'today');
  assert.equal(await press(page, '続きから').count(), 0);
  assert.equal(await press(page, '始める').count(), 1);
  assert.deepEqual(errors, []);
  await close();
});

test('back first closes a sheet on home, records and settings', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await pill(page, '今日の調整').click();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'today');
  await tab(page, '記録').click();
  await pill(page, 'カレンダーで見る・直す').click();
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

test('today adjustment rows open their sheets and light start uses one set per exercise', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  assert.equal(await page.locator('.press .sub').count(), 0);
  await pill(page, '今日の調整').click();
  assert.equal(await sheet(page).getAttribute('aria-label'), '今日の調整');
  assert.deepEqual(await sheet(page).locator('.row span').allTextContents(), ['メニュー', '軽めの日', '休む', '体重']);
  assert.deepEqual(await sheet(page).locator('.row small').allTextContents(), [
    '前回と同じ ›', '各1セットで始める', '今日は休みにする', '記録する'
  ]);
  await principles(page);
  await closeSheet(page);
  for (const [name, title] of [['メニュー', 'メニュー変更'], ['休む', '今日は休む'], ['体重', '体重を記録']]) {
    await adjust(page, name);
    assert.equal(await sheet(page).getAttribute('aria-label'), title);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await closeSheet(page);
  }
  await adjust(page, '軽めの日');
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  for (let i = 0; i < 3; i++) {
    await press(page, '完了').click();
    await press(page, '休憩を終える').click();
    if (i < 2) await press(page, '次 ▶').click();
  }
  await press(page, '◀ 前').click();
  assert.ok(await page.locator('.dots i').last().evaluate(dot => dot.classList.contains('done')));
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.light, true);
  assert.equal(session.sets.length, 3);
  assert.deepEqual(errors, []);
  await close();
});

test('home has seven week cells and miniature stairs from the last eight line points', async () => {
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
    const points = lineHistory(data, id).slice(-8);
    const mini = page.locator('.ln[data-exercise-id="' + id + '"] .mini');
    assert.equal(await mini.getAttribute('viewBox'), '0 0 64 28');
    assert.match(await mini.locator('path').getAttribute('d'), /H.*V/);
    assert.equal((await mini.locator('path').getAttribute('d')).match(/H/g).length, points.length - 1);
    assert.equal(await mini.locator('path').getAttribute('stroke'), 'var(--ai)');
  }
  assert.deepEqual(errors, []);
  await close();
});

test('first use adds an exercise without creating a session; an empty menu opens the picker', async () => {
  const { page, errors, close } = await open();
  assert.match(await page.textContent('.see'), /まず種目を登録しましょう/);
  await press(page, '種目を追加').click();
  await page.getByLabel('名前', { exact: true }).fill('腕立て伏せ');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  await press(page, '始める').click();
  await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
  assert.ok(await sheet(page).getByRole('button', { name: '決定' }).isDisabled());
  await sheet(page).getByRole('button', { name: '腕立て伏せ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '決定' }).click();
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
    await adjust(page, '休む');
    await sheet(page).getByRole('button', { name: reason, exact: true }).click();
    await page.waitForFunction(() => !window.history.state?.sheet);
  }
  assert.match(await page.textContent('#toast'), /休むのも練習/);
  await adjust(page, '体重');
  await sheet(page).getByRole('button', { name: '体重を減らす', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  await adjust(page, '体重');
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
  await adjust(page, '体重');
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
  await page.waitForFunction(() => document.querySelector('.see').textContent.includes('1セット目だけ狙えば十分'));
  await adjust(page, '休む');
  await sheet(page).getByRole('button', { name: '予定', exact: true }).click();
  await page.waitForTimeout(6000);
  assert.ok(api.puts.at(-1)?.skips.some(s => s.reason === '予定'));
  assert.equal(api.puts.at(-1).exercises[0].name, '腕立て伏せ');
  api.fail = true;
  await adjust(page, '休む');
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

test('today posts put the single coach or record label in the text block', async () => {
  const data = fixture();
  const last = data.sessions.at(-1);
  last.sets[0].reps = 19;
  const { page, close } = await open({ data, extra: {
    'kintore:posts': [{ id: 'reply', at: '2099-01-01', kind: 'reply', text: '肩を休める。' }]
  } });
  assert.deepEqual(await page.locator('.feed .post').evaluateAll(posts =>
    posts.map(post => ({
      labels: [...post.querySelectorAll('b')].map(b => b.textContent),
      separate: post.querySelectorAll('.k').length,
      blocks: post.children.length
    }))), [
    { labels: ['コーチ'], separate: 0, blocks: 1 }
  ]);
  assert.equal(await page.locator('.feed .post').first().textContent(), 'コーチ肩を休める。');
  await close();
});

test('counter steps, clamps, vibrates and shows the line only on the first set', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await page.evaluate(() => {
    window.vibrations = [];
    navigator.vibrate = value => { window.vibrations.push(value); return true; };
  });
  await press(page, '始める').click();
  const target = line(data, 'e1', localDate(new Date())).value;
  const number = page.locator('.counter .num');
  const minus = press(page, '腕立て伏せ 1回減らす');
  const plus = press(page, '腕立て伏せ 1回増やす');
  assert.equal(await number.textContent(), String(target));
  assert.equal(await page.textContent('.lineon'), 'ライン' + target + ' 突破');
  assert.equal(await number.evaluate(el => el.classList.contains('over')), true);
  await minus.click();
  assert.equal(await number.textContent(), String(target - 1));
  assert.equal(await page.textContent('.lineon'), 'ライン' + target + ' まで あと1');
  assert.equal(await number.evaluate(el => el.classList.contains('over')), false);
  await plus.click();
  assert.equal(await number.textContent(), String(target));
  assert.equal(await page.textContent('.lineon'), 'ライン' + target + ' 突破');
  assert.equal(await number.evaluate(el => el.classList.contains('over')), true);
  assert.deepEqual(await page.evaluate(() => window.vibrations), [5, 5]);
  await minus.evaluate(button => { for (let i = 0; i < 210; i++) button.click(); });
  assert.equal(await number.textContent(), '0');
  const count = await page.evaluate(() => window.vibrations.length);
  await minus.click();
  assert.equal(await number.textContent(), '0');
  assert.equal(await page.evaluate(() => window.vibrations.length), count);
  await plus.evaluate(button => { for (let i = 0; i < 210; i++) button.click(); });
  assert.equal(await number.textContent(), '200');
  await plus.click();
  assert.equal(await number.textContent(), '200');
  await press(page, '完了').click();
  assert.equal(await page.locator('.lineon').count(), 0);
  assert.equal(await number.evaluate(el => el.classList.contains('over')), false);
  assert.equal(await number.textContent(), String(prefill(data, 'e1', localDate(new Date()))[1].reps));
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

test('time counter steps by five seconds, clamps, and includes seconds in line feedback', async () => {
  const data = fixture();
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e3'] }
  } });
  await press(page, '始める').click();
  const number = page.locator('.counter .num');
  const minus = press(page, 'プランク 5秒減らす');
  const plus = press(page, 'プランク 5秒増やす');
  const target = line(data, 'e3', localDate(new Date())).value;
  assert.equal(await number.textContent(), String(target));
  assert.equal(await page.textContent('.lineon'), 'ライン' + target + '秒 突破');
  await minus.click();
  assert.equal(await number.textContent(), String(target - 5));
  assert.equal(await page.textContent('.lineon'), 'ライン' + target + '秒 まで あと5秒');
  assert.equal(await number.evaluate(el => el.classList.contains('over')), false);
  await plus.click();
  assert.equal(await number.textContent(), String(target));
  assert.equal(await number.evaluate(el => el.classList.contains('over')), true);
  await plus.click();
  assert.equal(await number.textContent(), String(target + 5));
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
  await page.getByLabel('種目を追加', { exact: true }).selectOption('e1');
  await press(page, '保存').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  await page.locator('.ex').filter({ hasText: '新しいメニュー' }).click();
  assert.equal(await page.getByLabel('名前', { exact: true }).inputValue(), '新しいメニュー');
  await press(page, 'キャンセル').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.deepEqual(errors, []);
  await close();
});

test('exercise ordering, archive visibility and confirmed deletion preserve past records', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await tab(page, '種目').click();
  await page.locator('.ex[data-exercise-id=e1]').click();
  await page.getByRole('button', { name: '腕立て伏せを下へ', exact: true }).click();
  assert.deepEqual((await stored(page)).exercises.slice(0, 2).map(ex => ex.id), ['e2', 'e1']);
  await press(page, 'アーカイブ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.equal(await page.locator('.ex[data-exercise-id=e1]').count(), 0);
  await pill(page, 'アーカイブ済みを表示').click();
  assert.equal(await pill(page, 'アーカイブ済みを表示').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.ex[data-exercise-id=e1]').textContent(), /アーカイブ済み/);
  await page.locator('.ex[data-exercise-id=e2]').click();
  await press(page, '削除').click();
  await page.locator('#confirm-dialog button[value=cancel]').click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).exercises.find(ex => ex.id === 'e2').archived, false);
  await press(page, '削除').click();
  await page.locator('#confirm-dialog button[value=confirm]').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'exercises');
  assert.equal((await stored(page)).exercises.find(ex => ex.id === 'e2').archived, true);
  assert.deepEqual((await stored(page)).sessions, data.sessions);
  assert.deepEqual(errors, []);
  await close();
});

test('complete immediately saves, shows first-set verdict and ring, then summary', async () => {
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
  await press(page, '完了').click();
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.sets[0].reps, reps);
  assert.equal(session.date, localDate(new Date()));
  assert.equal(await page.locator('.verdict b').textContent(), reps >= target ? '突破' : 'あと' + (target - reps));
  assert.equal(await page.locator('.verdict .num').textContent(), String(reps));
  assert.equal(await page.locator('.ring .num').textContent(), '1:30');
  const progress = () => page.locator('.ring').evaluate(el => parseFloat(el.style.getPropertyValue('--p')));
  const initialProgress = await progress();
  await page.clock.runFor(3000);
  assert.equal(await page.locator('.verdict').count(), 0);
  assert.ok(await progress() < initialProgress);
  await press(page, '+15秒').click();
  assert.equal(await page.locator('.ring .num').textContent(), '1:42');
  await press(page, '休憩を終える').click();
  assert.equal(await page.locator('.ring').count(), 0);
  assert.match(await page.textContent('.see'), /今日 /);
  await press(page, '完了').click();
  assert.equal(await page.locator('.verdict').count(), 0);
  await page.clock.runFor(90000);
  assert.equal(await page.locator('.ring').count(), 0);
  assert.ok(await page.evaluate(() => window.vibrations.some(v => JSON.stringify(v) === '[300,100,300]')));
  for (let i = 0; i < 3; i++) {
    await press(page, '完了').click();
    await press(page, '休憩を終える').click();
  }
  assert.equal((await stored(page)).sessions.at(-1).sets.length, 5, 'extra sets are added automatically');
  await press(page, '次 ▶').click();
  await press(page, '次 ▶').click();
  await press(page, '終了').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'summary');
  assert.match(await page.textContent('.see'), /今日の記録.*ライン突破 [01] \/ 1.*合計回数/s);
  await principles(page);
  await press(page, 'ホームへ').click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  await press(page, '始める').click();
  await press(page, '完了').click();
  assert.equal((await stored(page)).sessions.length, data.sessions.length + 1, 'same-day restart appends');
  assert.equal(await page.locator('.verdict').count(), 0, 'same-day first set is not judged again');
  assert.deepEqual(errors, []);
  await close();
});

test('training sheet keeps notes, coach opt-in, sets, additions and stage switching', async () => {
  const data = fixture();
  const { page, close } = await open({ data, extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e1'] }
  } });
  await press(page, '始める').click();
  await press(page, 'メモ').click();
  await principles(page);
  await sheet(page).getByLabel('メモ', { exact: true }).fill('肩が重い');
  await sheet(page).getByRole('button', { name: 'コーチに送る：オフ', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'セットを追加', exact: true }).click();
  await page.waitForFunction(() => !window.history.state?.sheet);
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  await press(page, '完了').click();
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
  await press(page, '完了').click();
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
  await adjust(page, '軽めの日');
  await principles(page);
  await press(page, '重さを増やす').click();
  await press(page, '完了').click();
  await principles(page);
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.light, true);
  assert.equal(session.sets[0].kg, 5.5);
  assert.equal(await page.locator('.verdict b').textContent(), '基準');
  await press(page, 'メモ').click();
  await principles(page);
  await closeSheet(page);
  await press(page, '終了').click();
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('records list and detail stairs, stats, load colors and twelve-week heat follow the records', async () => {
  const data = fixture();
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
    assert.match(await row.locator('b small').textContent(),
      new RegExp('突破 ' + clearCount(data, ex.id) + '回 ・ 累計 ' + totals(data)[ex.id].toLocaleString('ja-JP')));
  }
  assert.equal(await page.locator('.heat i').count(), 12);
  assert.deepEqual(await page.locator('.heat i').evaluateAll(cells =>
    cells.map(cell => cell.className)), weekHeat(data, today).map(n => n >= 3 ? 'd' : n ? 'l' : ''));
  assert.equal(await page.locator('.press').evaluate(dock => dock.getBoundingClientRect().height), 0);
  await page.locator('.rec[data-exercise-id=e1]').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'detail');
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  assert.equal(await tab(page, '記録').getAttribute('aria-current'), 'page');
  assert.match(await page.locator('.stairs path').first().getAttribute('d'), /H.*V/);
  assert.equal(await page.locator('.heat').count(), 0);
  assert.deepEqual(await page.locator('.stat .num').allTextContents(), [
    String(line(data, 'e1', today).value), String(clearCount(data, 'e1')),
    totals(data).e1.toLocaleString('ja-JP')
  ]);
  await page.getByRole('button', { name: '‹ 記録', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'records');
  await page.locator('.rec[data-exercise-id=e2]').click();
  assert.ok(await page.locator('.stairs path.old').count());
  assert.ok(await page.locator('.stairs path.now').count());
  assert.match(await page.locator('.stairs').textContent(), /黒へ/);
  await principles(page);
  await backTo(page, 'records');
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

test('a single line point explains the missing stairs in detail', async () => {
  const data = fixture();
  data.sessions = [data.sessions[0]];
  data.body = [];
  const { page, errors, close } = await open({ data });
  await tab(page, '記録').click();
  await page.locator('.rec[data-exercise-id=e1]').click();
  assert.match(await page.textContent('.see'), /記録が増えると、ここに階段ができる/);
  assert.equal(await page.locator('.stairs path').count(), 0);
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
    await pill(page, 'カレンダーで見る・直す').click();
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
  await pill(page, 'カレンダーで見る・直す').click();
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
  assert.equal(await page.locator('.feed > .k').last().textContent(), '新着 0');
  assert.deepEqual(errors, []);
  await close();
});

test('training target seconds sit four pixels after the large number', async () => {
  const { page, close } = await open({ data: fixture(), extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e3'] }
  } });
  await press(page, '始める').click();
  const gap = await page.locator('.target-value').evaluate(number => {
    const range = document.createRange();
    range.selectNodeContents(number.firstChild);
    return number.querySelector('small').getBoundingClientRect().left -
      range.getBoundingClientRect().right;
  });
  const bigGap = await page.locator('.big').evaluate(big =>
    big.querySelector('small').getBoundingClientRect().left -
    big.querySelector('.num').getBoundingClientRect().right);
  assert.ok(Math.abs(gap - bigGap) < 1);
  assert.ok(Math.abs(gap - 4) < 1);
  await close();
});
