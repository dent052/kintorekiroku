// Every screen with the real data (data repo clone at ../kintorekiroku-data). Run after EVERY change, not only the changed screens. Usage: node docs/handoff/shots-all.mjs <dir>
import { chromium } from '/home/user/kintorekiroku/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8080/');
await p.evaluate(d => { localStorage.clear(); localStorage.setItem('kintore:data', d); }, readFileSync('/home/user/kintorekiroku-data/data.json', 'utf8'));
await p.reload(); await p.waitForTimeout(1000);
let n = 0; const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` }); };
await shot('home');
await p.click('.press >> text=始める'); await shot('train');
await p.click('.press .go'); await p.waitForTimeout(300); await shot('rest');
await p.click('.tr-top .end'); await p.waitForTimeout(300); await p.click('dialog[open] >> text=ここまでで終える').catch(() => {}); await shot('summary');
await p.click('.press >> text=ホームへ'); await shot('home-after');
for (const t of ['記録', 'コーチ', '種目', '設定']) { await p.click('.tabs >> text=' + t); await shot(t); }
console.log('errors', errs); await b.close();
