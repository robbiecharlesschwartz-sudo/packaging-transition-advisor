import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
for (const ex of ['snack-pouch', 'cosmetics-bottle', 'ecommerce-mailer']) {
  for (const tab of ['brief', 'how']) {
    await p.goto(`http://localhost:5173/?example=${ex}&tab=${tab}`);
    await p.waitForTimeout(6000);
    const r = await p.evaluate(() => {
      const over = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.overflow-x-auto') && getComputedStyle(e).position !== 'fixed');
      return { page: document.documentElement.scrollWidth, vw: window.innerWidth, offenders: [...new Set(over.slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 50)))] };
    });
    console.log(ex, tab, JSON.stringify(r));
  }
}
await b.close();
