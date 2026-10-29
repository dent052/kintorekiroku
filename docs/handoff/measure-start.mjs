// Serves the app with a fixed delay per request (like a phone network), installs the SW, then times a reopen.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
const root = process.argv[2], delay = +process.argv[3];
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const server = http.createServer((req, res) => setTimeout(() => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (err, body) => { if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); res.end(body); });
}, delay)).listen(8091);
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const page = await ctx.newPage();
await page.goto('http://localhost:8091/'); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForTimeout(1500);
const times = [];
for (let i = 0; i < 3; i++) { const t = Date.now(); await page.reload({ waitUntil: 'commit' }); await page.waitForSelector('.see *'); times.push(Date.now() - t); }
console.log('reopen ms', times.join(', '));
await browser.close(); server.close();
