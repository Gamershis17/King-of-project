import { chromium } from 'playwright';
const shots = [
  { name: 'login-desktop', w: 1280, h: 720 },
  { name: 'login-mobile', w: 390, h: 844 },
];
for (const s of shots) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: s.w, height: s.h } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0,120)); });
  await page.goto('http://localhost:3101', { waitUntil: 'networkidle' });
  await page.waitForSelector('#auth-view, #view-auth, .auth-card, #login-btn', { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `preview/${s.name}.png` });
  console.log(s.name, 'errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
}
