import { chromium } from 'playwright';
const theme = process.argv[2] || 'modern';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 120)); });
await page.goto('http://localhost:3101', { waitUntil: 'networkidle' });
await page.waitForSelector('#view-app, .battle-screen, #tap-btn', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
// trigger a tap to show the hit flash / damage numbers
await page.click('#tap-btn').catch(() => {});
await page.waitForTimeout(220);
await page.screenshot({ path: `preview/rework-${theme}-battle.png` });
console.log(theme, 'battle errors:', errors.length ? errors.join(' | ') : 'none');
// More tab (settings with the new UI-style control)
await page.click("#tabbar .tab-btn[data-tab=\"more\"]");
await page.waitForTimeout(800);
await page.screenshot({ path: `preview/rework-${theme}-more.png` });
console.log(theme, 'more errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
