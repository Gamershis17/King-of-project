import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: 'preview/', size: { width: 390, height: 844 } } });
const page = await ctx.newPage();
await page.goto('http://localhost:3101', { waitUntil: 'networkidle' });
await page.waitForSelector('#tap-btn', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
for (let i = 0; i < 16; i++) { await page.click('#tap-btn').catch(()=>{}); await page.waitForTimeout(300); }
await page.waitForTimeout(1200);
const vpath = await page.video().path();
await ctx.close(); await browser.close();
console.log('video:', vpath);
