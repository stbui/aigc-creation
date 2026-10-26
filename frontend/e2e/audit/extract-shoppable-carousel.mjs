import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PAGE_URL = 'https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const CHROME = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const ROOT = path.resolve(import.meta.dirname, '../..');
const ASSET_DIR = path.join(ROOT, 'public/templates/shoppable-carousel');
const OUT_DIR = '/tmp/designkit-shoppable-carousel';
const CAPTURED_AT = new Date().toISOString();

const CATEGORY_CODES = new Map([
  ['男装/女装/运动服饰', 'apparel'],
  ['鞋包/配饰', 'accessories'],
  ['运动器械/户外装备', 'outdoor'],
  ['家具/家装', 'home'],
  ['日用/家纺', 'household'],
  ['五金/工具/汽摩', 'hardware'],
  ['3C数码/家电', 'digital'],
  ['美妆/个护', 'beauty'],
  ['健康/保健', 'health'],
  ['玩具/盲盒', 'toys'],
]);

await mkdir(ASSET_DIR, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-proxy-server'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();

async function readVisibleCards() {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class^="social-media-card-"]')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return cards.map((card) => ({
      name: card.querySelector('[class^="social-media-title-"]')?.textContent?.trim() ?? '',
      beatsText: card.querySelector('[class^="social-media-description-"]')?.textContent?.trim() ?? '',
      images: Array.from(card.querySelectorAll('[class^="social-media-imageSlot-"] img')).map((img) => ({
        src: img.getAttribute('src') ?? '',
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
    }));
  });
}

async function measureImages(urls) {
  return page.evaluate(async (sources) => {
    return Promise.all(
      sources.map(async (src) => {
        const img = new Image();
        img.src = src;
        try {
          await img.decode();
        } catch {
          // Natural dimensions can still be available for a decoded cached image.
        }
        return { width: img.naturalWidth, height: img.naturalHeight };
      }),
    );
  }, urls);
}

try {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[class^="social-media-card-"]', { timeout: 60000 });
  await page.waitForTimeout(4000);

  const allCards = await readVisibleCards();
  if (allCards.length !== 49 || new Set(allCards.map((card) => card.name)).size !== 49) {
    throw new Error(`全部模板清单异常：${allCards.length} 条`);
  }

  const categoryLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-pressed]'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((label) => label && label !== '全部模板'),
  );
  if (categoryLabels.length !== CATEGORY_CODES.size) {
    throw new Error(`分类数量变化：${categoryLabels.length} / ${CATEGORY_CODES.size}`);
  }

  const extracted = [];
  for (const categoryLabel of categoryLabels) {
    const code = CATEGORY_CODES.get(categoryLabel);
    if (!code) throw new Error(`未知分类：${categoryLabel}`);

    await page.getByRole('button', { name: categoryLabel, exact: true }).click();
    await page.waitForFunction(
      (label) => {
        const button = Array.from(document.querySelectorAll('button[aria-pressed]')).find(
          (el) => el.textContent?.trim() === label,
        );
        return button?.getAttribute('aria-pressed') === 'true';
      },
      categoryLabel,
      { timeout: 10000 },
    );
    await page.waitForTimeout(500);

    const cards = await readVisibleCards();
    if (cards.length === 0) throw new Error(`分类无模板：${categoryLabel}`);

    for (const [index, card] of cards.entries()) {
      if (!card.name || !card.beatsText) throw new Error(`模板字段缺失：${categoryLabel} #${index + 1}`);
      const beats = card.beatsText.split('→').map((item) => item.trim()).filter(Boolean);
      if (beats.length !== 3) throw new Error(`三拍文案异常：${card.name} -> ${card.beatsText}`);
      if (card.images.length !== 3) throw new Error(`预览图数量异常：${card.name} -> ${card.images.length}`);

      const id = `${code}-${String(index + 1).padStart(2, '0')}`;
      const dims = await measureImages(card.images.map((image) => image.src));
      extracted.push({
        id,
        categories: [{ code, label: categoryLabel }],
        name: card.name,
        beats,
        images: card.images.map((image, imageIndex) => ({
          file: `${id}-${imageIndex + 1}.webp`,
          runtimeUrl: `/templates/shoppable-carousel/${id}-${imageIndex + 1}.webp`,
          sourceUrl: image.src,
          width: dims[imageIndex]?.width || image.width,
          height: dims[imageIndex]?.height || image.height,
        })),
      });
    }
    console.log(`${categoryLabel}: ${cards.length}`);
  }

  const unique = [];
  const byName = new Map();
  const memberships = new Map();
  for (const item of extracted) {
    const current = memberships.get(item.name) ?? [];
    current.push(...item.categories);
    memberships.set(item.name, current);
    const existing = byName.get(item.name);
    if (existing) {
      continue;
    }
    byName.set(item.name, item);
    unique.push(item);
  }
  if (unique.length !== 49) {
    throw new Error(`模板去重异常：${extracted.length} 条 / ${unique.length} 个唯一模板`);
  }

  const ordered = allCards.map((card) => {
    const item = byName.get(card.name);
    if (!item) throw new Error(`全部模板中存在未归类项：${card.name}`);
    item.categories = memberships.get(card.name) ?? [];
    return item;
  });

  for (const item of ordered) {
    for (const image of item.images) {
      const response = await context.request.get(image.sourceUrl, { timeout: 60000 });
      if (!response.ok()) throw new Error(`缩略图下载失败 ${response.status()}：${image.sourceUrl}`);
      const body = await response.body();
      if (body.length < 1000) throw new Error(`缩略图过小：${image.file}`);
      await writeFile(path.join(ASSET_DIR, image.file), body);
      image.bytes = body.length;
    }
  }

  const result = {
    pageUrl: PAGE_URL,
    capturedAt: CAPTURED_AT,
    tool: 'Playwright Chromium 1134 / extract-shoppable-carousel.mjs',
    assetDir: 'frontend/public/templates/shoppable-carousel',
    categories: categoryLabels.map((label) => ({ label, code: CATEGORY_CODES.get(label) })),
    templates: ordered,
  };
  await writeFile(path.join(OUT_DIR, 'extracted.json'), JSON.stringify(result, null, 2));
  console.log(`\nSaved ${ordered.length} templates / ${ordered.length * 3} images`);
  console.log(
    'Multi-category:',
    ordered.filter((item) => item.categories.length > 1).map((item) => `${item.name}(${item.categories.map((c) => c.label).join(' + ')})`),
  );
  console.log(`${OUT_DIR}/extracted.json`);
} finally {
  await browser.close();
}
