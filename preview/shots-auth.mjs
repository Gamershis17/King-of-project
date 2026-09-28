import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ maintenance: false })); return; }
  if (url.pathname === '/api/auth/me') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'nope' })); return; }
  if (url.pathname === '/api/broadcasts/latest') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"broadcast":null}'); return; }
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
  let p = path.join(pub, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1));
  if (!p.startsWith(pub)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
});
await new Promise(r => server.listen(3102, r));

const errors = [];
for (const vp of [{ w: 1280, h: 800, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: vp.w, height: vp.h } })).newPage();
  page.on('pageerror', e => errors.push(vp.tag + ' PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(vp.tag + ' CONSOLE: ' + m.text().slice(0, 120)); });
  await page.goto('http://localhost:3102', { waitUntil: 'networkidle' });
  await page.waitForSelector('#view-auth .auth-card', { timeout: 15000 });
  await page.waitForTimeout(1200); // let entrance animations finish
  const theme = await page.evaluate(() => document.body.dataset.uistyle);
  const title = await page.evaluate(() => document.querySelector('#view-auth .game-title').textContent);
  const tagline = await page.evaluate(() => document.querySelector('#view-auth .tagline').textContent);
  // toggle register tab and back
  await page.click('#auth-tab-register');
  await page.waitForTimeout(300);
  const regVisible = await page.evaluate(() => !document.querySelector('#register-form').classList.contains('hidden')
    && document.querySelector('#login-form').classList.contains('hidden'));
  await page.click('#auth-tab-login');
  await page.waitForTimeout(300);
  const loginVisible = await page.evaluate(() => !document.querySelector('#login-form').classList.contains('hidden')
    && document.querySelector('#register-form').classList.contains('hidden'));
  // error display still works (submit empty login)
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(300);
  const errShown = await page.evaluate(() => !document.querySelector('#auth-error').classList.contains('hidden'));
  await page.screenshot({ path: `preview/rework-modern-auth-${vp.tag}.png` });
  console.log(vp.tag, '| theme:', theme, '| title:', JSON.stringify(title), '| tagline:', JSON.stringify(tagline),
    '| reg-toggle:', regVisible, '| login-toggle:', loginVisible, '| error-box:', errShown);
  await browser.close();
}
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
server.close();
