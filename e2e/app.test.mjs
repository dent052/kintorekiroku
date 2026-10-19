// End-to-end tests: real Chromium at phone size against the static app.
// Run: npm run e2e   (set CHROMIUM_PATH if Chromium is not at /opt/pw-browsers/chromium)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './fixture.mjs';

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
const tab = (page, name) => page.click(`[data-tab=${name}]`);
const dockBtn = (page, text) => page.locator('#dock button', { hasText: text }).first();

/** Buttons/links/selects inside the scrolling content (#view), excluding allowed list affordances. */
async function contentActions(page) {
  return page.$$eval('#view button, #view a, #view select', els => els
    .filter(e => e.offsetParent !== null)
    .filter(e => !e.classList.contains('calendar-day') && !e.classList.contains('source-link') && e.textContent.trim() !== 'すべて見る')
    .map(e => e.textContent.trim() || e.getAttribute('aria-label')));
}

// The page itself must never scroll (only #view does), or the dock/tab bar slide out of sight.
async function pageFits(page) {
  const size = await page.evaluate(() => ({
    w: document.scrollingElement.scrollWidth, h: document.scrollingElement.scrollHeight,
    top: document.scrollingElement.scrollTop, iw: window.innerWidth, ih: window.innerHeight,
    tabs: document.querySelector('.tabs').getBoundingClientRect().bottom
  }));
  assert.ok(size.w <= size.iw, `page scrolls sideways (${size.w} > ${size.iw})`);
  assert.ok(size.h <= size.ih && size.top === 0, `page scrolls vertically (${size.h} > ${size.ih})`);
  assert.ok(size.tabs <= size.ih, 'tab bar is cut off');
}

test('every main screen keeps its actions in the bottom dock', async () => {
  const { page, errors, close } = await open({ data: fixture(), extra: { 'kintore:posts': [{ id: 'p1', at: '2026-10-19T07:30:00+09:00', kind: 'reading', text: '読み物', source: { title: '出典', url: 'https://example.com' } }] } });
  const screens = [
    ['home', async () => {}],
    ['training start', () => tab(page, 'train')],
    ['workout', () => dockBtn(page, '前回と同じ').click()],
    ['workout during rest', () => dockBtn(page, '完了').click()],
    ['workout next exercise', () => dockBtn(page, '次へ').click()],
    ['history exercise', () => tab(page, 'history')],
    ['history body', () => dockBtn(page, '体').click()],
    ['history calendar', () => dockBtn(page, '日付').click()]
  ];
  for (const [name, go] of screens) {
    await go();
    await page.waitForTimeout(150);
    assert.deepEqual(await contentActions(page), [], `${name}: actions above the dock`);
    await pageFits(page);
  }
  await tab(page, 'settings');
  await pageFits(page);
  for (const text of ['＋ 種目', '＋ バンド', '＋ テンプレ']) assert.ok(await dockBtn(page, text).isVisible(), text);
  assert.deepEqual(errors, []);
  await close();
});

test('first use: register an exercise, set a baseline, see it on home', async () => {
  const { page, errors, close } = await open();
  await tab(page, 'train');
  await dockBtn(page, '種目を追加').click();
  await page.fill('#view input[type=text]', '腕立て伏せ');
  await dockBtn(page, '保存').click();
  await tab(page, 'train');
  assert.equal((await page.textContent('#dock')).trim(), '種目を選んで始める');
  await dockBtn(page, '種目を選んで始める').click();
  await page.click('dialog >> text=腕立て伏せ');
  assert.match(await page.textContent('#view'), /初回。この1セットが基準になる/);
  await dockBtn(page, '完了').click();
  assert.match(await page.locator('.training-result').textContent(), /10\s*基準/);
  assert.equal((await stored(page)).sessions.length, 1, 'set is saved on 完了');
  await dockBtn(page, '終了').click();
  assert.match(await page.textContent('#view'), /今日の記録/);
  await dockBtn(page, 'ホームへ').click();
  assert.match(await page.textContent('#view'), /通算\s*1\s*日/);
  assert.deepEqual(errors, []);
  await close();
});

test('line: clear and short results, rest timer, summary', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await tab(page, 'train');
  await dockBtn(page, '前回と同じ').click();
  const chip = await page.locator('.line-chip').textContent();
  const line = Number(chip.match(/\d+/)[0]);
  const shown = Number(await page.locator('#dock .stepper output').textContent().then(t => t.match(/\d+/)[0]));
  const plus = page.locator('#dock .stepper button').last();
  for (let i = shown; i < line; i++) await plus.click();
  await dockBtn(page, '完了').click();
  assert.match(await page.locator('.training-result').textContent(), /突破/);
  assert.ok(await page.locator('#dock #timer').isVisible(), 'rest timer is in the dock');
  const t1 = await page.locator('#timer .num').textContent();
  await page.click('#timer >> text=+15秒');
  const t2 = await page.locator('#timer .num').textContent();
  const secs = t => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
  assert.ok(secs(t2) > secs(t1), `+15秒 adds time (${t1} → ${t2})`);
  await page.click('#timer >> text=スキップ');
  assert.ok(await page.locator('#timer').isHidden());

  await dockBtn(page, '次へ').click();
  const minus = page.locator('#dock .stepper button').first();
  for (let i = 0; i < 5; i++) await minus.click();
  await dockBtn(page, '完了').click();
  assert.match(await page.locator('.training-result').textContent(), /あと\s*\d+[\s\S]*ラインは次回へ/);

  await page.reload();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  assert.equal((await stored(page)).sessions.find(s => s.date === today)?.sets.length, 2, 'both sets survive a reload');
  assert.deepEqual(errors, []);
  await close();
});

test('summary counts cleared lines and shows a falling total neutrally', async () => {
  const { page, close } = await open({ data: fixture() });
  await tab(page, 'train');
  await dockBtn(page, '前回と同じ').click();
  const line = Number((await page.locator('.line-chip').textContent()).match(/\d+/)[0]);
  const plus = page.locator('#dock .stepper button').last();
  const shown = Number((await page.locator('#dock .stepper output').textContent()).match(/\d+/)[0]);
  for (let i = shown; i < line; i++) await plus.click();
  await dockBtn(page, '完了').click();
  await dockBtn(page, '次へ').click();
  await dockBtn(page, '次へ').click();
  await dockBtn(page, '終了').click();
  const text = await page.textContent('#view');
  assert.match(text, /ライン突破\s*1\s*\/\s*1/);
  assert.match(text, /前回より\s*-\d+/, 'a lower total is still shown');
  await close();
});

test('coach toggle marks the session for a reply', async () => {
  const { page, close } = await open({ data: fixture() });
  await tab(page, 'train');
  await dockBtn(page, '前回と同じ').click();
  await dockBtn(page, '完了').click();
  await dockBtn(page, 'その他').click();
  await page.fill('dialog textarea', '肩が重い');
  await page.locator('dialog textarea').blur();
  await page.click('dialog >> text=コーチに送る：オフ');
  assert.ok(await page.locator('dialog >> text=コーチに送る：オン').isVisible());
  const session = (await stored(page)).sessions.at(-1);
  assert.equal(session.toCoach, true);
  assert.equal(session.note, '肩が重い');
  await close();
});

test('rest day and body weight are recorded once per day', async () => {
  const { page, close } = await open({ data: fixture() });
  await dockBtn(page, '今日は休む').click();
  await page.click('dialog >> text=疲れ');
  assert.match(await page.textContent('#toast'), /休むのも練習/);
  await dockBtn(page, '体重を記録').click();
  await page.click('dialog button[aria-label="体重を減らす"]');
  await page.click('dialog >> text=保存');
  await dockBtn(page, '体重を記録').click();
  await page.click('dialog >> text=保存');
  const data = await stored(page);
  const today = data.skips.at(-1).date;
  assert.equal(data.skips.filter(s => s.date === today).length, 1);
  const todays = data.body.filter(b => b.date === today);
  assert.equal(todays.length, 1);
  assert.equal(todays[0].kg, Math.round(todays[0].kg * 10) / 10, 'weight has one decimal');
  await close();
});

test('history: chart colors by band, edit and delete a day', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await tab(page, 'history');
  await dockBtn(page, '種目を選ぶ').click();
  await page.click('dialog >> text=バンドロウ');
  assert.equal(await page.locator('#view svg polyline').count(), 2, 'one line per band');
  await dockBtn(page, '日付').click();
  await page.locator('.calendar-day.done').last().click();
  await page.waitForTimeout(150);
  const box = await page.locator('.history > section:last-child').boundingBox();
  assert.ok(box.y < 844 / 2, 'day detail scrolls into view');
  const before = (await stored(page)).sessions.length;
  const date = await page.locator('.calendar-day[aria-pressed=true]').getAttribute('aria-label');
  const reps = async () => (await stored(page)).sessions.find(s => s.date === date.slice(0, 10)).sets[0].reps;
  const r0 = await reps();
  await page.locator('.history > section:last-child button[aria-label$="を増やす"]').first().click();
  assert.equal(await reps(), r0 + 1);
  await page.click('text=この日の記録を削除');
  await page.click('#confirm-dialog button[value=confirm]');
  // Deleting saves after the confirm dialog's promise resolves, so wait for the write.
  await page.waitForFunction(n => JSON.parse(localStorage.getItem('kintore:data')).sessions.length === n, before - 1);
  assert.deepEqual(errors, []);
  await close();
});

test('settings: add from the dock, bad import leaves data untouched', async () => {
  const { page, close } = await open({ data: fixture() });
  await tab(page, 'settings');
  await dockBtn(page, '＋ バンド').click();
  await page.fill('#view input[type=text] >> nth=0', '青');
  await dockBtn(page, '保存').click();
  assert.deepEqual((await stored(page)).bands.map(b => `${b.name}${b.order}`), ['黄1', '赤2', '黒3', '青4']);
  const before = await page.evaluate(() => localStorage.getItem('kintore:data'));
  await page.setInputFiles('input[type=file]', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#toast'), /読み込めないファイルです/);
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
  api.posts = [{ id: 'r1', at: '2099-01-01T07:30:00+09:00', kind: 'reply', quote: '肩が重い', text: '1セット目だけ狙えば十分。' }, { broken: true }];
  await page.reload();
  await page.waitForTimeout(500);
  assert.match(await page.textContent('#view'), /1セット目だけ狙えば十分/);
  await dockBtn(page, '今日は休む').click();
  await page.click('dialog >> text=予定');
  await page.waitForTimeout(6000);
  assert.ok(api.puts.at(-1)?.skips.some(s => s.reason === '予定'), 'pushed after the 5 s debounce');
  assert.equal(api.puts.at(-1).exercises[0].name, '腕立て伏せ', 'Japanese survives base64');
  api.fail = true;
  await dockBtn(page, '今日は休む').click();
  await page.click('dialog >> text=風邪');
  await page.waitForTimeout(6000);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kintore:github')).dirty), true);
  api.fail = false;
  const count = api.puts.length;
  await page.reload();
  await page.waitForTimeout(1500);
  assert.ok(api.puts.length > count, 'retried on next start');
  await close();
});

test('swiping the content switches tabs in order', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  const swipe = (from, to) => page.evaluate(([from, to]) => {
    const target = document.querySelector('#view');
    const touch = x => new Touch({ identifier: 1, target, clientX: x, clientY: 400 });
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(from)], changedTouches: [touch(from)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(to)], bubbles: true }));
  }, [from, to]);
  const current = () => page.getAttribute('[data-tab][aria-current=page]', 'data-tab');
  await swipe(300, 80);
  assert.equal(await current(), 'train');
  await swipe(300, 80);
  assert.equal(await current(), 'history');
  await swipe(80, 300);
  assert.equal(await current(), 'train');
  await swipe(300, 270);
  assert.equal(await current(), 'train', 'a short drag does not switch');
  await pageFits(page);
  assert.deepEqual(errors, []);
  await close();
});

test('layout fits a short Android screen with the browser toolbar', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(d => { if (!localStorage.getItem('kintore:data')) localStorage.setItem('kintore:data', JSON.stringify(d)); }, fixture());
  await page.goto(base);
  for (const name of ['home', 'train', 'history', 'settings']) {
    await tab(page, name);
    await page.waitForTimeout(100);
    await pageFits(page);
  }
  await context.close();
});
