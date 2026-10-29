// After a deploy (file changed on the server), the new file must show by the second reopen.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
const root = process.argv[2];
const server = http.createServer((req, res) => setTimeout(() => {
  let p = new URL(req.url, 'http://x').pathname; if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (err, body) => { if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html', 'cache-control': 'max-age=600' }); res.end(body); });
}, 200)).listen(8092);
const browser = await chromium.launch(); const ctx = await browser.newContext(); let page = await ctx.newPage();
await page.goto('http://localhost:8092/'); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForTimeout(1000);
fs.appendFileSync(path.join(root, 'style.css'), '\nbody{outline:3px solid red}\n');
const seen = [];
for (let i = 0; i < 3; i++) { await page.close(); page = await ctx.newPage(); await page.goto('http://localhost:8092/'); await page.waitForTimeout(800); seen.push(await page.evaluate(async () => [getComputedStyle(document.body).outlineStyle, !!navigator.serviceWorker.controller, (await (await caches.match('style.css')).text()).includes('red')].join('/'))); }
console.log('after deploy, reopens:', seen.join(', '));
await browser.close(); server.close();
