// Screens of v5: home, picker, records, detail, empty records, exercises, settings, editor, training. Usage: node docs/handoff/shots-v5.mjs <dir>
import { chromium } from '/home/user/kintorekiroku/node_modules/playwright/index.mjs';
import { fixture } from '/home/user/kintorekiroku/e2e/fixture.mjs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const load = async data => {
  await p.goto('http://localhost:8080/');
  await p.evaluate(d => { localStorage.clear(); if (d) localStorage.setItem('kintore:data', JSON.stringify(d));
    localStorage.setItem('kintore:posts', JSON.stringify([{ id: 'r1', at: new Date().toISOString(), kind: 'reply', text: '重い日は1セット目だけラインを狙えば十分。' }])); }, data);
  await p.reload(); await p.waitForTimeout(1200);
};
let n = 0; const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` }); };
const click = async sel => { try { await p.click(sel, { timeout: 1500 }); } catch { console.log('MISSING', sel); } };
await load(fixture());
await shot('home');
await click('text=種目を変える'); await shot('picker'); await click('dialog[open] >> text=閉じる');
await click('.tabs >> text=記録'); await shot('records');
await click('.rec >> nth=1'); await shot('detail');
await click('.tabs >> text=種目'); await shot('exercises');
await click('.ex >> nth=0'); await shot('editor'); await click('text=キャンセル');
await click('.tabs >> text=設定'); await shot('settings');
await click('.tabs >> text=ホーム'); await click('.press >> text=始める'); await shot('train');
await load({ version: 1, updatedAt: '', exercises: [], bands: [], templates: [], sessions: [], body: [], rests: [], settings: { restSec: 90 } });
await click('.tabs >> text=記録'); await shot('records-empty');
console.log('errors', errs); await b.close();
