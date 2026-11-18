// Captures every replay example on desktop and mobile into docs/screenshots (README + case study + visual review).
// Usage: npm run preview:built (in another shell)  then  node scripts/screenshots.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = new URL('../../docs/screenshots/', import.meta.url);
mkdirSync(out, { recursive: true });
const shots = [
  ['snack-pouch', 'brief'], ['cosmetics-bottle', 'brief'], ['ecommerce-mailer', 'brief'], ['snack-pouch', 'how'],
];
const browser = await chromium.launch();
for (const [vp, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: vp === 'mobile' ? 2 : 1 });
  for (const [ex, tab] of shots) {
    await page.goto(`${base}/?example=${ex}&tab=${tab}`);
    await page.waitForTimeout(6500);
    await page.screenshot({ path: new URL(`${ex}-${tab}-${vp}.png`, out).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: tab === 'brief' });
    await page.screenshot({ path: new URL(`${ex}-${tab}-${vp}-top.png`, out).pathname.replace(/^\/([A-Z]:)/, '$1') });
  }
  await page.close();
}
const embed = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await embed.goto(`${base}/embed/replay?example=ecommerce-mailer`);
await embed.waitForTimeout(6500);
await embed.screenshot({ path: new URL('embed-replay.png', out).pathname.replace(/^\/([A-Z]:)/, '$1') });
await browser.close();
console.log('screenshots written to docs/screenshots');
