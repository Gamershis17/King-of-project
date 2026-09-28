import { chromium } from 'playwright';

async function shot({ name, theme, w, h, tab }) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE: ' + m.text().slice(0, 100)); });
  await page.goto('http://localhost:3101', { waitUntil: 'networkidle' });
  await page.waitForSelector('#tap-btn', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2200);
  if (tab) {
    await page.click(`#tabbar .tab-btn[data-tab="${tab}"]`);
    await page.waitForTimeout(900);
  } else {
    await page.click('#tap-btn').catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: `preview/${name}.png` });
  // overlap check: any two visible cards/tabs overlapping?
  const overlaps = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#tab-content .card, .enemy-card, .hero-panel, .meter, .tap-btn, #tabbar .tab-btn')].filter(e => e.offsetParent !== null);
    const bad = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (x > 4 && y > 4) bad.push([els[i].className.slice(0, 24), els[j].className.slice(0, 24)]);
    }
    return bad.slice(0, 5);
  });
  console.log(name, '| theme:', await page.evaluate(() => document.body.dataset.uistyle),
    '| errors:', errors.length ? errors.join(' | ') : 'none',
    '| overlaps:', overlaps.length ? JSON.stringify(overlaps) : 'none');
  await browser.close();
}

const theme = process.argv[2] || 'modern';
const w = parseInt(process.argv[3] || '1440', 10);
const h = parseInt(process.argv[4] || '900', 10);
const tab = process.argv[5] || '';
const name = process.argv[6] || 'revamp-shot';
process.env.UISTYLE = theme;
await shot({ name, theme, w, h, tab });
