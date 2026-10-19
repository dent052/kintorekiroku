// End-to-end tests: real Chromium at phone size against the static app.
// Run: npm run e2e   (set CHROMIUM_PATH if Chromium is not at /opt/pw-browsers/chromium)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './fixture.mjs';
import { localDate, line, menuExercises } from '../logic.js';

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
const settings = async page => {
  await press(page, '成長').click();
  await press(page, '設定').click();
};

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
    for (const text of ['メニュー変更', '休む', '体重']) {
      await press(page, text).click();
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
    await press(page, '戻る').click();
    await press(page, '軽めの日').click();
    assert.match(await page.textContent('.see'), /軽めの日/);
    await principles(page);
    await press(page, '戻る').click();
    await press(page, '成長').click();
    await principles(page);
    await press(page, '新着').click();
    await principles(page);
    assert.ok(await sheet(page).getByRole('link', { name: '出典' }).isVisible());
    await sheet(page).getByRole('button', { name: '閉じる' }).click();
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
    await press(page, '戻る').click();
    assert.equal(await page.getAttribute('.app', 'data-mode'), 'growth');
    await press(page, '今日').click();
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
  await press(page, 'メニュー変更').click();
  await sheet(page).getByRole('button', { name: '胸と背中', exact: true }).click();
  await check({ kind: 'template', templateId: 't1' });
  assert.match(await page.textContent('.lines > .k'), /胸と背中/);
  await press(page, 'メニュー変更').click();
  await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '腕立て伏せ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '足上げ腕立て', exact: true }).click();
  await sheet(page).getByRole('button', { name: '決定', exact: true }).click();
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

test('swipe switches only today and growth at the specified thresholds', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  const mode = () => page.getAttribute('.app', 'data-mode');
  await swipe(page, -59);
  assert.equal(await mode(), 'today');
  await swipe(page, -80, 50);
  assert.equal(await mode(), 'today');
  await swipe(page, -60);
  assert.equal(await mode(), 'growth');
  await swipe(page, -100);
  assert.equal(await mode(), 'growth');
  await swipe(page, 60, 0, '.press');
  assert.equal(await mode(), 'today');
  await press(page, '始める').click();
  await swipe(page, -100);
  assert.equal(await mode(), 'train');
  await principles(page);
  assert.deepEqual(errors, []);
  await close();
});

test('first use adds an exercise without creating a session; an empty menu opens the picker', async () => {
  const { page, errors, close } = await open();
  assert.match(await page.textContent('.see'), /まず種目を登録しましょう/);
  await press(page, '種目を追加').click();
  await page.getByLabel('名前', { exact: true }).fill('腕立て伏せ');
  await press(page, '保存').click();
  await press(page, '戻る').click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'today');
  await press(page, '始める').click();
  await sheet(page).getByRole('button', { name: '種目を選ぶ', exact: true }).click();
  assert.ok(await sheet(page).getByRole('button', { name: '決定' }).isDisabled());
  await sheet(page).getByRole('button', { name: '腕立て伏せ', exact: true }).click();
  await sheet(page).getByRole('button', { name: '決定' }).click();
  assert.equal(await page.getAttribute('.app', 'data-mode'), 'train');
  assert.equal((await stored(page)).sessions.length, 0);
  await press(page, '戻る').click();
  assert.equal(await page.locator('.ln .word').textContent(), '初回');
  assert.deepEqual(errors, []);
  await close();
});

test('rest day and body weight are recorded once per day', async () => {
  const { page, close } = await open({ data: fixture() });
  for (const reason of ['疲れ', '予定']) {
    await press(page, '休む').click();
    await sheet(page).getByRole('button', { name: reason, exact: true }).click();
  }
  assert.match(await page.textContent('#toast'), /休むのも練習/);
  await press(page, '体重').click();
  await sheet(page).getByRole('button', { name: '体重を減らす', exact: true }).click();
  await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
  await press(page, '体重').click();
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
  await press(page, '体重').click();
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
  await press(page, '休む').click();
  await sheet(page).getByRole('button', { name: '予定', exact: true }).click();
  await page.waitForTimeout(6000);
  assert.ok(api.puts.at(-1)?.skips.some(s => s.reason === '予定'));
  assert.equal(api.puts.at(-1).exercises[0].name, '腕立て伏せ');
  api.fail = true;
  await press(page, '休む').click();
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
