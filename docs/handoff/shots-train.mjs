// Training flow with the real data: before set, verdict, rest, all sets, summary. Usage: node docs/handoff/shots-train.mjs <dir>
import { chromium } from '/home/user/kintorekiroku/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8080/');
await p.evaluate(([d, posts]) => { localStorage.clear(); localStorage.setItem('kintore:data', d); localStorage.setItem('kintore:posts', posts); },
  [readFileSync('/home/user/kintorekiroku-data/data.json', 'utf8'), readFileSync('/home/user/kintorekiroku-data/posts.json', 'utf8')]);
await p.reload(); await p.waitForTimeout(1200);
const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${name}.png` }); };
await p.click('.press >> text=始める'); await shot('t1-goal');
await p.click('.press .go'); await p.waitForTimeout(500); await shot('t2-verdict');
await p.waitForTimeout(3000); await shot('t3-rest');
await p.click('.press >> text=休憩を終える'); await shot('t4-after');
await p.click('.press >> text=+ >> nth=0').catch(() => {}); 
await p.click('.press .go'); await p.waitForTimeout(300); await p.click('.press >> text=休憩を終える');
await p.click('.press .go'); await p.waitForTimeout(3200); await shot('t5-last');
await p.click('.tr-top .end'); await p.waitForTimeout(300); await p.click('dialog[open] >> text=ここまでで終える').catch(() => {}); await shot('t6-summary');
console.log('errors', errs); await b.close();
