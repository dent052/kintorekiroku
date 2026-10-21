// Screens of v9: home card + badge, coach timeline, after writing, empty coach. Usage: node docs/handoff/shots-v9.mjs <dir>
import { chromium } from '/home/user/kintorekiroku/node_modules/playwright/index.mjs';
import { fixture } from '/home/user/kintorekiroku/e2e/fixture.mjs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, timezoneId: 'Asia/Tokyo' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8080/');
const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv'); };
const data = fixture();
data.sessions.at(-1).note = '今日は肩が重かった。3セット目で崩れた。'; data.sessions.at(-1).toCoach = true;
const posts = [
  { id: 'p1', at: day(0) + 'T07:23:00+09:00', kind: 'reading', text: '膝付き腕立て伏せは、膝から頭までを一直線に保つのが要点。腰が落ちたり尻が上がったりすると、胸と腕に負荷が乗りにくくなる。', source: { title: 'Modified Push-Up', url: 'https://www.nasm.org/exercise-library' } },
  { id: 'p2', at: day(2) + 'T07:23:00+09:00', kind: 'reply', quote: '今日は肩が重かった', text: '1セット目のラインは届いている。次は同じバンドで2セット目を+1回。', ref: [] },
  { id: 'p3', at: day(3) + 'T07:23:00+09:00', kind: 'finding', text: '腕立ての1セット目が3回続けて先月の最高を上回っている。' }];
await p.evaluate(([d, posts]) => { localStorage.clear(); localStorage.setItem('kintore:data', JSON.stringify(d)); localStorage.setItem('kintore:posts', JSON.stringify(posts)); localStorage.setItem('kintore:seen', JSON.stringify(['p2', 'p3'])); }, [data, posts]);
await p.reload(); await p.waitForTimeout(1200);
let n = 0; const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` }); };
await shot('home-card');
await p.click('.tabs >> text=コーチ'); await shot('coach-unread');
await p.fill('.compose input', '膝付きなら20回いけそう。次は普通の腕立てに戻していい？'); await shot('typing');
await p.click('.compose .send'); await shot('after-send');
await p.evaluate(() => { localStorage.setItem('kintore:posts', '[]'); const d = JSON.parse(localStorage.getItem('kintore:data')); d.messages = []; d.sessions.forEach(s => s.toCoach = false); localStorage.setItem('kintore:data', JSON.stringify(d)); });
await p.reload(); await p.waitForTimeout(800); await p.click('.tabs >> text=コーチ'); await shot('coach-empty');
console.log('errors', errs); await b.close();
