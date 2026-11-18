import { chromium } from 'playwright';
const [ex, sec, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`http://localhost:5173/?example=${ex}`);
await p.waitForTimeout(6500);
await p.locator(`#sec-${sec}`).screenshot({ path: out });
await b.close();
