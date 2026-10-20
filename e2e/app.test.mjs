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
const sheet = page => page.locator('dialog.sheet[open]').last();
const settings = page => press(page, '設定').click();

async function adjust(page, name) {
  await press(page, '今日の調整').click();
  await sheet(page).locator('.row').filter({ has: page.getByText(name, { exact: true }) }).click();
}

async function home(page) {
  await press(page, 'ホーム').click();
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
    elements.filter(element => !element.closest('.press, dialog.sheet, .slab'))
      .map(element => element.outerHTML)), []);
  const size = await page.evaluate(() => ({
    w: document.scrollingElement.scrollWidth, h: document.scrollingElement.scrollHeight,
    top: document.scrollingElement.scrollTop, iw: innerWidth, ih: innerHeight,
    bottom: document.querySelector('.press').getBoundingClientRect().bottom
  }));
  assert.ok(size.w <= size.iw, 'page scrolls sideways');
  assert.ok(size.h <= size.ih && size.top === 0, 'page scrolls vertically');
  assert.ok(size.bottom <= size.ih, 'press is cut off');
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

test('paper/slab principles hold on both phone sizes, modes, editors and open sheets', async () => {
  const { page, errors, close } = await open({ data: fixture(), extra: {
    'kintore:posts': [{ id: 'p1', at: '2099-01-01', kind: 'reading', text: '読み物',
      source: { title: '出典', url: 'https://example.com' } }]
  } });
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await principles(page);
    await press(page, '今日の調整').click();
    await principles(page);
    await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
    for (const text of ['メニュー変更', '休む', '体重']) {
      await adjust(page, text === 'メニュー変更' ? 'メニュー' : text);
      await principles(page);
      if (text === 'メニュー変更') {
        await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
        await principles(page);
      }
      await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
    }
    await press(page, '始める').click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
    await principles(page);
    await leaveTraining(page);
    await adjust(page, '軽めの日');
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
    await principles(page);
    await leaveTraining(page);
    await press(page, '成長').click();
    await principles(page);
    await press(page, '新着').click();
    await principles(page);
    assert.ok(await sheet(page).getByRole('link', { name: '出典' }).isVisible());
    await sheet(page).getByRole('button', { name: '閉じる' }).click();
    await home(page);
    await press(page, '設定').click();
    await principles(page);
    for (const text of ['＋ 種目', '＋ バンド', '＋ テンプレ']) {
      await press(page, text).click();
      await principles(page);
      await press(page, 'キャンセル').click();
    }
    await page.setInputFiles('input[type=file]', {
      name: 'data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture()))
    });
    await sheet(page).waitFor();
    await principles(page);
    await page.locator('#confirm-dialog button[value=cancel]').click();
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
  await check({ kind: 'template', templateId: 't1' });
  assert.match(await page.textContent('.hello'), /胸と背中/);
  await adjust(page, 'メニュー');
  await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '腕立て伏せ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '足上げ腕立て', exact: true }).click();
  await sheet(page).getByRole('button', { name: '決定' }).click();
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

test('home and settings ignore swipes; growth swipes change items and dots at the specified thresholds', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  const mode = () => page.getAttribute('.app', 'data-mode');
  for (const dx of [-100, 100]) {
    await swipe(page, dx);
    assert.equal(await mode(), 'today');
  }
  await press(page, '成長').click();
  const index = () => page.locator('.exdots i').evaluateAll(dots => dots.findIndex(dot => dot.classList.contains('on')));
  assert.equal(await page.locator('.exdots i').count(), 4);
  assert.ok(await press(page, '◀ 前の種目').isDisabled());
  await swipe(page, -59);
  assert.equal(await index(), 0);
  await swipe(page, -80, 50);
  assert.equal(await index(), 0);
  await swipe(page, 100);
  assert.equal(await index(), 0);
  await swipe(page, -60);
  assert.equal(await mode(), 'growth');
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  assert.equal(await index(), 1);
  await swipe(page, 60, 0, '.press');
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  assert.equal(await index(), 0);
  for (let i = 0; i < 3; i++) await swipe(page, -100);
  assert.equal(await page.textContent('.exname'), '体重');
  assert.equal(await index(), 3);
  assert.ok(await press(page, '次の種目 ▶').isDisabled());
  await swipe(page, -100);
  assert.equal(await index(), 3);
  await home(page);
  await settings(page);
  for (const dx of [-100, 100]) {
    await swipe(page, dx);
    assert.equal(await mode(), 'settings');
  }
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
  await page.getByRole('slider').press('ArrowRight');
  const amount = await page.getByRole('slider').getAttribute('aria-valuenow');
  await home(page);
  await press(page, '続きから').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.match(await page.textContent('.tr-top'), /2 \/ 3 ・ 2セット目へ/);
  assert.equal(await page.getByRole('slider').getAttribute('aria-valuenow'), amount);
  assert.equal(await page.getByRole('slider').getAttribute('aria-label'), 'バンドロウ 回数');
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

test('history back from growth, settings, training and summary closes sheets and returns home', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await page.evaluate(() => {
    window.pushes = 0;
    const push = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => { window.pushes++; push(...args); };
  });
  for (const destination of ['成長', '設定', '始める']) {
    const before = await page.evaluate(() => window.pushes);
    await press(page, destination).click();
    assert.equal(await page.evaluate(() => window.pushes), before + 1);
    if (destination === '成長') await press(page, '新着').click();
    if (destination === '始める') await press(page, 'メモ').click();
    await page.evaluate(() => window.history.back());
    await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await principles(page);
  }
  await press(page, '続きから').click();
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: 'トレーニングをやめる', exact: true }).click();
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => document.querySelector('.app').dataset.mode === 'today');
  assert.equal(await press(page, '続きから').count(), 0);
  assert.equal(await press(page, '始める').count(), 1);
  assert.deepEqual(errors, []);
  await close();
});

test('today adjustment rows open their sheets and light start uses one set per exercise', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await press(page, '今日の調整').click();
  assert.equal(await sheet(page).getAttribute('aria-label'), '今日の調整');
  assert.deepEqual(await sheet(page).locator('.row span').allTextContents(), ['メニュー', '軽めの日', '休む', '体重']);
  assert.deepEqual(await sheet(page).locator('.row small').allTextContents(), [
    '前回と同じ ›', '各1セットで始める', '今日は休みにする', '記録する'
  ]);
  await principles(page);
  await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
  for (const [name, title] of [['メニュー', 'メニュー変更'], ['休む', '今日は休む'], ['体重', '体重を記録']]) {
    await adjust(page, name);
    assert.equal(await sheet(page).getAttribute('aria-label'), title);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
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
  await home(page);
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'today');
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
  }
  assert.match(await page.textContent('#toast'), /休むのも練習/);
  await adjust(page, '体重');
  await sheet(page).getByRole('button', { name: '体重を減らす', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
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
  await press(page, '＋ バンド').click();
  await page.getByLabel('名前', { exact: true }).fill('青');
  await press(page, '保存').click();
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

test('ruler renders every tick, moves with the finger, supports thirds and arrow keys', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  const today = localDate(new Date());
  await press(page, '始める').click();
  const slider = page.getByRole('slider', { name: '腕立て伏せ 回数' });
  const initial = prefill(data, 'e1', today)[0].reps;
  const target = line(data, 'e1', today).value;
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial));
  assert.equal(await slider.getAttribute('aria-valuemin'), '0');
  assert.equal(await slider.getAttribute('aria-valuemax'), '200');
  assert.equal(await slider.locator('.t').count(), 201);
  assert.equal(await slider.locator('.line b').textContent(), 'ライン' + target);
  assert.equal(await slider.locator('.t.over').count(), 201 - target);
  assert.deepEqual(await slider.locator('.t').evaluateAll(ticks =>
    ticks.map((tick, i) => tick.classList.contains('over') === (i >= Number(
      document.querySelector('.line b').textContent.replace('ライン', '')))).every(Boolean)), true);
  const box = await slider.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 6 });
  await page.mouse.up();
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial + 2));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 3 });
  await page.mouse.up();
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial + 1));
  await slider.click({ position: { x: 10, y: 30 } });
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial));
  await slider.click({ position: { x: box.width - 10, y: 30 } });
  await slider.press('ArrowRight');
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial + 2));
  await slider.press('ArrowLeft');
  assert.equal(await page.locator('.big .num').textContent(), String(initial + 1));
  const center = await slider.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const n = Number(el.getAttribute('aria-valuenow'));
    const tick = el.querySelectorAll('.t')[n].getBoundingClientRect();
    return Math.abs(tick.x + tick.width / 2 - bounds.x - bounds.width / 2);
  });
  assert.ok(center < 1, 'selected tick is centered');
  const name = await page.textContent('.exname');
  await swipe(page, -100, 0, '.ruler');
  assert.equal(await page.textContent('.exname'), name);
  await swipe(page, -100);
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  await swipe(page, 100);
  assert.equal(await page.textContent('.exname'), name);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('time ruler uses five-second steps, all 121 ticks, and clamps at both ends', async () => {
  const { page, close } = await open({ data: fixture(), extra: {
    'kintore:menu': { kind: 'custom', exerciseIds: ['e3'] }
  } });
  await press(page, '始める').click();
  const slider = page.getByRole('slider', { name: 'プランク 秒数' });
  assert.equal(await slider.locator('.t').count(), 121);
  assert.equal(await slider.getAttribute('aria-valuemax'), '600');
  const initial = Number(await slider.getAttribute('aria-valuenow'));
  await slider.press('ArrowRight');
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial + 5));
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + 30);
  await page.mouse.up();
  assert.equal(await slider.getAttribute('aria-valuenow'), String(initial + 10));
  await slider.evaluate(el => {
    for (let i = 0; i < 140; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  });
  assert.equal(await slider.getAttribute('aria-valuenow'), '0');
  await slider.evaluate(el => {
    for (let i = 0; i < 140; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  assert.equal(await slider.getAttribute('aria-valuenow'), '600');
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
  const slider = page.getByRole('slider');
  const target = line(data, 'e1', localDate(new Date())).value;
  await slider.press('ArrowRight');
  const reps = Number(await slider.getAttribute('aria-valuenow'));
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
  assert.equal((await stored(page)).sessions.length, data.sessions.length);
  await press(page, '完了').click();
  let session = (await stored(page)).sessions.at(-1);
  assert.equal(session.note, '肩が重い');
  assert.equal(session.toCoach, true);
  await press(page, '休憩を終える').click();
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: '次の段階へ切り替え', exact: true }).click();
  assert.equal(await page.textContent('.exname'), '足上げ腕立て');
  await press(page, 'メモ').click();
  await sheet(page).getByRole('button', { name: '種目を追加', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'バンドロウ', exact: true }).click();
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
  await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
  await press(page, '終了').click();
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('growth stairs, stats, load colors and twelve-week heat follow the records', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await press(page, '成長').click();
  assert.equal(await page.textContent('.see > .k'), '成長');
  assert.equal(await page.textContent('.exname'), '腕立て伏せ');
  assert.match(await page.locator('.stairs path').first().getAttribute('d'), /H.*V/);
  assert.equal(await page.locator('.heat i').count(), 12);
  const today = localDate(new Date());
  assert.deepEqual(await page.locator('.heat i').evaluateAll(cells =>
    cells.map(cell => cell.className)), weekHeat(data, today).map(n => n >= 3 ? 'd' : n ? 'l' : ''));
  assert.deepEqual(await page.locator('.stat .num').allTextContents(), [
    String(line(data, 'e1', today).value), String(clearCount(data, 'e1')),
    totals(data).e1.toLocaleString('ja-JP')
  ]);
  await press(page, '次の種目 ▶').click();
  assert.ok(await page.locator('.stairs path.old').count());
  assert.ok(await page.locator('.stairs path.now').count());
  assert.match(await page.locator('.stairs').textContent(), /黒へ/);
  assert.equal(await page.locator('.exdots i.on').evaluate(dot => [...dot.parentNode.children].indexOf(dot)), 1);
  await principles(page);
  await home(page);
  await press(page, '設定').click();
  await home(page);
  await press(page, '成長').click();
  assert.equal(await page.textContent('.exname'), 'バンドロウ');
  assert.deepEqual(errors, []);
  await close();
});

test('body item shows daily points, seven-day average and four-week difference', async () => {
  const data = fixture();
  const { page, errors, close } = await open({ data });
  await press(page, '成長').click();
  for (let i = 0; i < 3; i++) await press(page, '次の種目 ▶').click();
  const today = localDate(new Date());
  const previous = new Date(today + 'T12:00:00');
  previous.setDate(previous.getDate() - 28);
  const average = bodyAvg7(data.body, today, 'kg');
  const delta = average - bodyAvg7(data.body, localDate(previous), 'kg');
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

test('growth empty state and a single line point explain the missing stairs', async () => {
  const data = fixture();
  data.sessions = [data.sessions[0]];
  data.body = [];
  const { page, errors, close } = await open({ data });
  await press(page, '成長').click();
  assert.match(await page.textContent('.see'), /記録が増えると、ここに階段ができる/);
  assert.equal(await page.locator('.stairs path').count(), 0);
  assert.equal(await page.locator('.exdots i').count(), 3);
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('growth calendar edits values and notes, deletes sets and confirms day deletion', async () => {
  const data = fixture();
  const date = data.sessions.at(-1).date;
  const { page, errors, close } = await open({ data });
  await press(page, '成長').click();
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await press(page, '記録を見る・直す').click();
    assert.equal(await sheet(page).locator('.calendar button').count(), 84);
    await principles(page);
    await sheet(page).getByRole('button', { name: date + ' トレーニング', exact: true }).click();
    await principles(page);
    await sheet(page).getByRole('button', { name: '腕立て伏せ 1セットを増やす', exact: true }).click();
    const expected = data.sessions.at(-1).sets[0].reps + 1;
    assert.equal((await stored(page)).sessions.find(s => s.date === date).sets[0].reps, expected);
    data.sessions.at(-1).sets[0].reps = expected;
    await sheet(page).getByLabel('メモ', { exact: true }).fill('今日は軽い');
    await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
  }
  await press(page, '記録を見る・直す').click();
  await sheet(page).getByRole('button', { name: date + ' トレーニング', exact: true }).click();
  assert.equal(await sheet(page).getByLabel('メモ', { exact: true }).inputValue(), '今日は軽い');
  const count = (await stored(page)).sessions.find(s => s.date === date).sets.length;
  await sheet(page).getByRole('button', { name: '削除', exact: true }).first().click();
  assert.equal((await stored(page)).sessions.find(s => s.date === date).sets.length, count - 1);
  await sheet(page).getByRole('button', { name: 'この日の記録を削除', exact: true }).click();
  await principles(page);
  await page.locator('#confirm-dialog button[value=cancel]').click();
  assert.ok((await stored(page)).sessions.some(s => s.date === date));
  await sheet(page).getByRole('button', { name: 'この日の記録を削除', exact: true }).click();
  await page.locator('#confirm-dialog button[value=confirm]').click();
  // The delete is saved after the confirm dialog's promise resolves.
  await page.waitForFunction(d => !JSON.parse(localStorage.getItem('kintore:data')).sessions.some(s => s.date === d), date);
  assert.match(await sheet(page).textContent(), /記録なし/);
  await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
  await page.reload();
  assert.ok(!(await stored(page)).sessions.some(s => s.date === date));
  assert.deepEqual(errors, []);
  await close();
});

test('growth news shows all items in time order and marks them read', async () => {
  const posts = [
    { id: 'older-reply', at: '2098-01-01', kind: 'reply', text: '返事', quote: 'メモ' },
    { id: 'newer', at: '2099-01-01', kind: 'reading', text: '読み物',
      source: { title: '資料', url: 'https://example.com' } },
    { id: 'third', at: '2097-01-01', kind: 'finding', text: '発見' }
  ];
  const data = fixture();
  const { page, errors, close } = await open({ data, extra: { 'kintore:posts': posts } });
  await press(page, '成長').click();
  await press(page, '新着').click();
  const items = mergeFeed(feed(data, localDate(new Date())), posts, [])
    .sort((a, b) => b.at.localeCompare(a.at));
  assert.equal(await sheet(page).locator('.post').count(), items.length);
  assert.match(await sheet(page).locator('.post').first().textContent(), /読み物/);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:seen')));
  assert.ok(items.every(item => seen.includes(item.id)));
  await principles(page);
  await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
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
