// Acceptance tests for spec v3 (docs/superpowers/specs/2026-10-19-kintore-v3-design.md).
// Written by the designer. Implementers must make these pass WITHOUT editing this file.
// Run: npm run e2e
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './fixture.mjs';
import { line, localDate } from '../logic.js';

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

async function open({ data, extra = {}, github, viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: 'block' });
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
  await page.addInitScript(([data, extra, github]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    if (data) localStorage.setItem('kintore:data', typeof data === 'string' ? data : JSON.stringify(data));
    if (github) localStorage.setItem('kintore:github', JSON.stringify(github));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
  }, [data ?? null, extra, github ?? null]);
  await page.goto(base);
  await page.waitForSelector('.app[data-mode]');
  return { page, api, errors, close: () => context.close() };
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('kintore:data')));
const mode = page => page.getAttribute('.app', 'data-mode');
const pressBtn = (page, text) => page.locator('.press button', { hasText: text }).first();
const sheetBtn = (page, text) => page.locator('dialog.sheet[open] button', { hasText: text }).first();
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/** Principle 1: nothing pressable on the paper. */
async function pressablesOnSlab(page, where) {
  const stray = await page.$$eval('button, a[href], select, input, textarea, [role=slider]', els => els
    .filter(e => e.offsetParent !== null || e.getClientRects().length)
    .filter(e => !e.closest('.press, dialog.sheet, .slab'))
    .map(e => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16)}`));
  assert.deepEqual(stray, [], `${where}: pressable controls on the paper`);
}

/** Principle 2: the page itself never scrolls; the slab is fully visible. */
async function pageFits(page, where) {
  const s = await page.evaluate(() => {
    const press = document.querySelector('.press')?.getBoundingClientRect();
    return { w: document.scrollingElement.scrollWidth, h: document.scrollingElement.scrollHeight,
      iw: innerWidth, ih: innerHeight, top: document.scrollingElement.scrollTop, pressBottom: press?.bottom ?? 0 };
  });
  assert.ok(s.w <= s.iw && s.h <= s.ih && s.top === 0, `${where}: page scrolls (${s.w}x${s.h} in ${s.iw}x${s.ih})`);
  assert.ok(s.pressBottom <= s.ih + 0.5, `${where}: slab cut off (${s.pressBottom} > ${s.ih})`);
}

async function swipe(page, selector, dx) {
  await page.evaluate(([selector, dx]) => {
    const target = document.querySelector(selector);
    const r = target.getBoundingClientRect();
    const y = r.top + Math.min(r.height / 2, 200), x0 = r.left + r.width / 2 - dx / 2;
    const t = x => new Touch({ identifier: 1, target, clientX: x, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x0)], changedTouches: [t(x0)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(x0 + dx)], bubbles: true }));
  }, [selector, dx]);
  await page.waitForTimeout(250);
}

const rulerValue = async page => Number(await page.getAttribute('.press .ruler[role=slider]', 'aria-valuenow'));
async function dragRuler(page, dx) {
  const box = await page.locator('.press .ruler').boundingBox();
  const y = box.y + box.height / 2, x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + dx * i / 6, y);
  await page.mouse.up();
}

test('principles hold on every screen: slab-only controls, no page scroll', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  const check = async where => { await page.waitForTimeout(200); await pressablesOnSlab(page, where); await pageFits(page, where); };
  await check('today');
  await pressBtn(page, 'メニュー変更').click(); await check('menu sheet'); await sheetBtn(page, '閉じる').click();
  await pressBtn(page, '体重').click(); await check('body sheet'); await sheetBtn(page, '閉じる').click();
  await page.click('.pager button[data-page=growth]'); await check('growth');
  await pressBtn(page, '記録を見る').click(); await check('records sheet'); await sheetBtn(page, '閉じる').click();
  await pressBtn(page, '設定').click(); assert.equal(await mode(page), 'settings'); await check('settings');
  await pressBtn(page, '戻る').click();
  await page.click('.pager button[data-page=today]');
  await page.locator('.press button.go').click(); assert.equal(await mode(page), 'train'); await check('train before set');
  await page.locator('.press button.go', { hasText: '完了' }).click(); await check('train resting');
  await pressBtn(page, 'メモ・その他').click(); await check('train sheet'); await sheetBtn(page, '閉じる').click();
  assert.deepEqual(errors, []);
  await close();
});

test('principle 2 also on a short Android screen', async () => {
  const { page, close } = await open({ data: fixture(), viewport: { width: 360, height: 640 } });
  await pageFits(page, 'today 360x640');
  await page.locator('.press button.go').click();
  await pageFits(page, 'train 360x640');
  await close();
});

test('visual tokens match the approved mockup', async () => {
  const { page, close } = await open({ data: fixture() });
  const css = (sel, props) => page.$eval(sel, (el, props) => Object.fromEntries(props.map(p => [p, getComputedStyle(el)[p]])), props);
  assert.equal((await css('.app', ['backgroundColor'])).backgroundColor, rgb('#F6F7F9'));
  assert.equal((await css('.press', ['backgroundColor'])).backgroundColor, rgb('#1C2B4B'));
  const go = await css('.press .go', ['backgroundColor', 'color', 'borderTopLeftRadius', 'height', 'boxShadow']);
  assert.deepEqual([go.backgroundColor, go.color, go.borderTopLeftRadius, go.boxShadow], [rgb('#D03C22'), 'rgb(255, 255, 255)', '18px', 'none']);
  assert.ok(parseFloat(go.height) >= 64);
  assert.match((await css('.see .ln .name', ['fontFamily'])).fontFamily, /Zen Kaku Gothic New/);
  const lnNum = await css('.see .ln .num', ['fontFamily', 'fontSize']);
  assert.match(lnNum.fontFamily, /Barlow Condensed/);
  assert.equal(lnNum.fontSize, '52px');
  assert.equal(await page.locator('.see .card, .see [class*=shadow]').count(), 0, 'no boxed cards');
  await page.locator('.press button.go').click();
  const ex = await css('.see .exname', ['fontWeight', 'fontSize']);
  assert.deepEqual([ex.fontWeight, ex.fontSize], ['900', '34px']);
  const target = await css('.see .target .num', ['fontSize', 'color']);
  assert.deepEqual([target.fontSize, target.color], ['96px', rgb('#D03C22')]);
  assert.equal((await css('.press .ruler', ['height'])).height, '66px');
  assert.equal((await css('.press .big .num', ['fontSize'])).fontSize, '76px');
  await close();
});

test('今日: today lines come from the line logic, carry-over in vermilion', async () => {
  const data = fixture();
  const { page, close } = await open({ data });
  assert.equal(await mode(page), 'today');
  assert.equal(await page.getAttribute('.pager button[aria-current=page]', 'data-page'), 'today');
  const today = localDate(new Date());
  const rows = await page.$$eval('.see .lines .ln', els => els.map(e => ({
    name: e.querySelector('.name').firstChild.textContent.trim(), num: e.querySelector('.num').textContent.replace(/\s/g, '') })));
  const last = [...data.sessions].sort((a, b) => b.date.localeCompare(a.date))[0];
  const ids = [...new Set(last.sets.map(s => s.exerciseId))];
  assert.deepEqual(rows.map(r => r.name), ids.map(id => data.exercises.find(e => e.id === id).name), 'menu = 前回と同じ');
  for (const [i, id] of ids.entries()) {
    const l = line(data, id, today);
    if ('value' in l) assert.ok(rows[i].num.startsWith(String(l.value)), `${rows[i].name}: ${rows[i].num} vs line ${l.value}`);
  }
  assert.match(await page.textContent('.see .date'), /通算\s*\d+\s*日/);
  await close();
});

test('swipe switches 今日 ⇄ 成長, but not on the ruler', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await swipe(page, '.see', -200);
  assert.equal(await mode(page), 'growth');
  await swipe(page, '.see', 200);
  assert.equal(await mode(page), 'today');
  await page.locator('.press button.go').click();
  const name1 = await page.textContent('.see .exname');
  await swipe(page, '.see', -200);
  assert.notEqual(await page.textContent('.see .exname'), name1, 'swipe moves to the next exercise in training');
  await swipe(page, '.press .ruler', -200);
  assert.equal(await mode(page), 'train', 'ruler drag is not a page swipe');
  assert.deepEqual(errors, []);
  await close();
});

test('ruler: drag, tap thirds, keyboard, line marker and over ticks', async () => {
  const { page, close } = await open({ data: fixture() });
  await page.locator('.press button.go').click();
  const v0 = await rulerValue(page);
  assert.equal(Number((await page.textContent('.press .big .num')).trim()), v0, 'big number shows the ruler value');
  await dragRuler(page, -90);
  assert.equal(await rulerValue(page), v0 + 3, 'finger left 90px = +3');
  await dragRuler(page, 60);
  assert.equal(await rulerValue(page), v0 + 1, 'finger right 60px = -2');
  const box = await page.locator('.press .ruler').boundingBox();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  assert.equal(await rulerValue(page), v0 + 2, 'tap right third = +1');
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2);
  assert.equal(await rulerValue(page), v0 + 1, 'tap left third = -1');
  await page.focus('.press .ruler');
  await page.keyboard.press('ArrowRight');
  assert.equal(await rulerValue(page), v0 + 2, 'ArrowRight = +1');
  const lineValue = Number((await page.textContent('.see .target .num')).trim());
  assert.equal((await page.textContent('.press .ruler .line b')).trim(), `ライン${lineValue}`);
  const ticks = await page.$$eval('.press .ruler .t', els => els.map(e => e.classList.contains('over')));
  const firstOver = ticks.indexOf(true);
  assert.ok(firstOver >= 0 && ticks.slice(firstOver).every(Boolean) && ticks.slice(0, firstOver).every(x => !x), 'ticks from the line upward are .over');
  assert.equal(firstOver, lineValue, 'first .over tick is the line value (ticks start at 0)');
  await close();
});

test('完了: saved at once, verdict and rest ring on the paper, rest controls on the slab', async () => {
  const { page, close } = await open({ data: fixture() });
  await page.locator('.press button.go').click();
  const lineValue = Number((await page.textContent('.see .target .num')).trim());
  await page.focus('.press .ruler');
  while (await rulerValue(page) < lineValue) await page.keyboard.press('ArrowRight');
  const before = (await stored(page)).sessions.length;
  await page.locator('.press button.go', { hasText: '完了' }).click();
  assert.equal((await stored(page)).sessions.length, before + 1, 'saved on 完了');
  assert.match(await page.textContent('.see .verdict'), /突破/);
  assert.ok(await page.locator('.see .ring').isVisible());
  assert.ok(await pressBtn(page, '+15秒').isVisible());
  await pressBtn(page, '休憩を終える').click();
  assert.ok(await page.locator('.see .ring').isHidden());
  await close();
});

test('training to summary and back to 今日', async () => {
  const { page, close } = await open({ data: fixture() });
  await page.locator('.press button.go').click();
  for (let i = 0; i < 10 && !(await pressBtn(page, '終了').count()); i++) await pressBtn(page, '次の種目').click();
  await page.locator('.press button.go', { hasText: '完了' }).click();
  await pressBtn(page, '終了').click();
  assert.equal(await mode(page), 'summary');
  assert.match(await page.textContent('.see'), /今日の記録[\s\S]*ライン突破\s*\d+\s*\/\s*\d+/);
  await page.locator('.press button.go', { hasText: '今日へ戻る' }).click();
  assert.equal(await mode(page), 'today');
  await close();
});

test('メニュー変更 picks a template and is remembered', async () => {
  const data = fixture();
  data.templates.push({ id: 't2', name: 'プランクだけ', exerciseIds: ['e3'], sets: 2 });
  const { page, close } = await open({ data });
  await pressBtn(page, 'メニュー変更').click();
  await sheetBtn(page, 'プランクだけ').click();
  assert.deepEqual(await page.$$eval('.see .lines .ln .name', els => els.map(e => e.firstChild.textContent.trim())), ['プランク']);
  await page.reload();
  await page.waitForSelector('.app[data-mode]');
  assert.match(await page.textContent('.see .lines'), /プランク/);
  assert.doesNotMatch(await page.textContent('.see .lines'), /腕立て/);
  await close();
});

test('成長: stairs, stats, 12-week heat, body weight chip', async () => {
  const { page, errors, close } = await open({ data: fixture() });
  await page.click('.pager button[data-page=growth]');
  assert.equal(await mode(page), 'growth');
  const d = await page.getAttribute('.see svg.stairs path:last-of-type', 'd');
  assert.match(d, /H[\d.]+\s*V[\d.]+/, 'stairs use horizontal + vertical segments');
  assert.equal(await page.locator('.see .heat > i').count(), 12);
  assert.match(await page.textContent('.see .stat'), /今のライン[\s\S]*突破[\s\S]*累計/);
  await page.locator('.press .chips button', { hasText: 'バンドロウ' }).click();
  assert.match(await page.textContent('.see .exname'), /バンドロウ/);
  assert.ok(await page.locator('.see svg.stairs path.old').count() >= 1 && await page.locator('.see svg.stairs path.now').count() >= 1, 'band change splits the stairs by color');
  await page.locator('.press .chips button', { hasText: '体重' }).click();
  assert.match(await page.textContent('.see .stat'), /最新[\s\S]*7日平均/);
  assert.deepEqual(errors, []);
  await close();
});

test('first use: no exercises → register → baseline', async () => {
  const { page, close } = await open();
  assert.match(await page.textContent('.see'), /まず種目を登録しましょう/);
  await page.locator('.press button.go', { hasText: '種目を追加' }).click();
  assert.equal(await mode(page), 'settings');
  await page.fill('.slab input[type=text]', '腕立て伏せ');
  await page.locator('button', { hasText: '保存' }).first().click();
  await pressBtn(page, '戻る').click().catch(() => page.locator('button', { hasText: '戻る' }).first().click());
  await page.click('.pager button[data-page=today]').catch(() => {});
  await page.locator('.press button.go').click();
  if (await page.locator('dialog.sheet[open]').count()) { await sheetBtn(page, '腕立て伏せ').click(); await sheetBtn(page, '決定').click().catch(() => {}); }
  if (await mode(page) !== 'train') await page.locator('.press button.go').click();
  assert.match(await page.textContent('.see'), /初回。この1セットが基準になる/);
  await page.locator('.press button.go', { hasText: '完了' }).click();
  assert.match(await page.textContent('.see .verdict'), /基準/);
  await close();
});

test('data safety: corrupt data kept aside; bad import rejected', async () => {
  const broken = await open({ data: '{broken' });
  assert.equal(await broken.page.evaluate(() => localStorage.getItem('kintore:data:broken')), '{broken');
  assert.equal(await broken.page.evaluate(() => localStorage.getItem('kintore:data')), '{broken');
  await broken.close();
  const { page, close } = await open({ data: fixture() });
  await page.click('.pager button[data-page=growth]');
  await pressBtn(page, '設定').click();
  const before = await page.evaluate(() => localStorage.getItem('kintore:data'));
  await page.setInputFiles('input[type=file]', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#toast'), /読み込めないファイルです/);
  assert.equal(await page.evaluate(() => localStorage.getItem('kintore:data')), before);
  await close();
});

test('GitHub sync and coach posts keep working', async () => {
  const github = { owner: 'me', repo: 'data', token: 't', lastSyncAt: null, dirty: false };
  const { page, api, close } = await open({ data: fixture(), github });
  api.posts = [{ id: 'r1', at: '2099-01-01T07:30:00+09:00', kind: 'reply', quote: '肩が重い', text: '1セット目だけ狙えば十分。' }, { broken: true }];
  await page.reload();
  await page.waitForTimeout(600);
  assert.match(await page.textContent('.see .feed'), /1セット目だけ狙えば十分/);
  await pressBtn(page, '休む').click();
  await sheetBtn(page, '予定').click();
  await page.waitForTimeout(6000);
  assert.ok(api.puts.at(-1)?.skips.some(s => s.reason === '予定'), 'pushed after the 5 s debounce');
  await close();
});
