// Screens of v8: training top, exercise list, finish sheet, personal best, memo, records rows. Usage: node docs/handoff/shots-v8.mjs <dir>
import { chromium } from '/home/user/kintorekiroku/node_modules/playwright/index.mjs';
import { fixture } from '/home/user/kintorekiroku/e2e/fixture.mjs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8080/');
await p.evaluate(d => { localStorage.clear(); localStorage.setItem('kintore:data', JSON.stringify(d)); }, fixture());
await p.reload(); await p.waitForTimeout(1200);
let n = 0; const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` }); };
const click = async sel => { try { await p.click(sel, { timeout: 1500 }); } catch { console.log('MISSING', sel); } };
await click('.press >> text=始める'); await shot('train');
await click('.tr-top .prog'); await shot('list'); await click('dialog[open] >> text=閉じる');
await click('.tr-top .end'); await shot('finish'); await click('dialog[open] >> text=続ける');
await click('.press .big .num'); await p.keyboard.type('25'); await p.keyboard.press('Enter'); await click('.press .go'); await shot('personal-best');
await click('.press >> text=メモ'); await shot('memo'); await click('dialog[open] >> text=閉じる');
await click('.press >> text=ホーム'); await click('.tabs >> text=記録'); await click('.seg >> text=種目ごと'); await shot('records');
console.log('errors', errs); await b.close();
