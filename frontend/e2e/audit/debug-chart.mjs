import { launchChromium } from './browser.mjs';


const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"], input[name="email"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[data-slot="card"]'));
  return cards.map((card) => {
    const title = card.querySelector('h2')?.textContent?.trim() ?? '';
    if (!title.includes('任务趋势') && !title.includes('收入')) return null;
    const rects = Array.from(card.querySelectorAll('.recharts-rectangle'));
    const bars = Array.from(card.querySelectorAll('.recharts-bar-rectangle path')).map((p) => {
      const bb = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return { w: Math.round(bb.width), h: Math.round(bb.height), fill: cs.fill };
    });
    const layer = card.querySelector('.recharts-bar');
    const layerBox = layer?.getBoundingClientRect();
    return {
      title,
      rectCount: rects.length,
      barCount: bars.length,
      bars: bars.slice(0, 10),
      layerBox: layerBox ? { w: Math.round(layerBox.width), h: Math.round(layerBox.height) } : null,
      layerHtml: layer?.outerHTML?.slice(0, 600) ?? '(无 .recharts-bar)',
    };
  }).filter(Boolean);
});

console.log(JSON.stringify(report, null, 2));

await browser.close();
