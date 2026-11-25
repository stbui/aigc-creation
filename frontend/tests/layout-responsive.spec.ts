import { expect, test, type Page } from '@playwright/test';

/**
 * 布局与响应式守门用例。
 *
 * 守的是 `docs/design/standards/responsive-layout.md`（PR #9 落地）的三节契约：
 *   - §1 断点刻度：900 是外壳与内容的共用断点，899 必须与 900 落在同一档；
 *   - §2.1 内边距阶梯：`.app-content` 水平内边距 >900 → 24、≤900 → 16、≤640 → 12、≤480 → 10；
 *   - §3 页头三级：每页唯一 `h1`；L2 28 → ≤640 24，L3 18 → ≤640 16。
 *
 * ## 唯一 `h1` 与「视觉可见」是两件事
 *
 * 数量断言（每页恰好 1 个 `h1`）**永远执行**，多一个少一个都红。字号断言只对
 * **视觉可见**的 `h1` 执行：§3.1 管的是视觉字号阶，读屏用的 `sr-only` 标题
 * 不参与视觉排版，它的计算字号只是浏览器默认值。可见性按计算样式与盒子尺寸
 * 判定（见 `measure()` 的注释），不按类名 —— 类名随组件库变动，不是契约。
 *
 * ## 为什么四档都要跑，且必须有 899
 *
 * Tailwind 的 `max-[900px]:` 编译成 `@media (width < 900px)`（开区间），手写
 * `@media (max-width: 900px)` 是闭区间。同一个 900 刻度，两种写法在 900 整点
 * 相差 1px —— 这正是规范 §1.2 单列出来的坑。900 与 899 各跑一次，才能抓住
 * 「900 该生效却没生效」这类错误；只跑 900 会把开区间的写法判成正确。
 *
 * ## 为什么现在必然是红的
 *
 * 这份用例按**规范**断言，不按现状断言。截至 2026-11-22：
 *   - `.app-content` 在 ≤900 仍是 `16px 10px 24px`（规范要求 16），T-017 修；
 *   - 4 个工具页运行时没有任何 `h1`；`/works` 的 h1 到 390 不降档（28 应为 24）；
 *     `/free-creation` 的 h1 桌面 16（应为 18）—— T-018 修。
 * 红了是清单，不是回归；**不要为了变绿放宽下面的期望值**。
 *
 * ## 不在本文件覆盖范围
 *
 * 触控目标 ≥36×36、hover 依赖、焦点环（§6）与网格降列（§4）另有归属，
 * 本文件只管「无横向滚动 + 内边距阶梯 + 页头三级」这三条硬约束。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

/** 亚像素：字号读数是小数，允许 ±0.5px；滚动宽允许 1px 舍入误差。 */
const SIZE_TOLERANCE = 0.5;
const SCROLL_TOLERANCE = 1;

const VIEWPORTS = [
  { name: '1366×900', width: 1366, height: 900 },
  { name: '900×800', width: 900, height: 800 },
  { name: '899×800', width: 899, height: 800 },
  { name: '390×844', width: 390, height: 844 },
];

/**
 * 内边距阶梯（§2.1）专用档位。
 *
 * 与 `VIEWPORTS` 分开：路由 × 页头矩阵只跑四档，避免用例数翻倍；而内边距阶梯
 * 有四条分界线（900 / 640 / 480 三条 + 桌面），每条分界线都要在「整点」和
 * 「整点 −1」各测一次，才能抓住开区间（Tailwind `max-[Npx]:` → `width < Npx`）
 * 与闭区间（手写 `max-width: Npx`）相差的 1px。多档只加在这一组里。
 */
const PADDING_VIEWPORTS = [
  ...VIEWPORTS,
  { name: '641×800', width: 641, height: 800 },
  { name: '640×800', width: 640, height: 800 },
  { name: '481×800', width: 481, height: 800 },
  { name: '480×800', width: 480, height: 800 },
];

type HeadingLevel = 'L1' | 'L2' | 'L3';

interface RouteCase {
  /** 实际 router 路径（`frontend/src/App.tsx`） */
  path: string;
  name: string;
  level: HeadingLevel;
}

/**
 * 路由名以 `frontend/src/App.tsx` 为准。
 * 注意：规范正文举例写的 `/works/my-works` 在 router 里并不存在 —— 实际是
 * `/works` 与 `/my-works` 两个等价别名（`App.tsx:321`、`App.tsx:393`，同一个
 * `WorksPage`）。这里用 `/works`。
 */
const ROUTES: RouteCase[] = [
  { path: '/', name: '首页 hero', level: 'L1' },
  { path: '/library', name: '素材库', level: 'L2' },
  { path: '/works', name: '我的作品', level: 'L2' },
  { path: '/product-sku', name: '商品图', level: 'L3' },
  { path: '/local-redraw', name: '局部重绘', level: 'L3' },
  { path: '/watermark-remove', name: '去水印', level: 'L3' },
  { path: '/multi-image-fusion', name: '多图融合', level: 'L3' },
  { path: '/free-creation', name: '自由创作', level: 'L3' },
];

/** 规范 §3.1：L2 桌面 28 / ≤640 24；L3 桌面 18 / ≤640 16。 */
function expectedHeadingSize(level: Exclude<HeadingLevel, 'L1'>, width: number): number {
  if (level === 'L2') return width <= 640 ? 24 : 28;
  return width <= 640 ? 16 : 18;
}

/** 规范 §2.1：`.app-content` 水平内边距阶梯。900 是闭区间（≤900 生效）。 */
function expectedContentPadding(width: number): number {
  if (width > 900) return 24;
  if (width > 640) return 16;
  if (width > 480) return 12;
  return 10;
}

interface LayoutMetrics {
  /** 真实承载内容的根：外壳页是 .app-content，营销页是 .landing-page */
  rootSelector: string | null;
  docScroll: number;
  docClient: number;
  rootScroll: number | null;
  rootClient: number | null;
  contentPaddingLeft: number | null;
  contentPaddingRight: number | null;
  h1Count: number;
  h1Texts: string[];
  h1Size: number | null;
  /** 首个 h1 是否视觉可见；不可见时字号断言不适用（见 measure 内的判定注释） */
  h1Visible: boolean;
}

/**
 * 等到页面真正画出内容。开发服务器按需编译懒加载块，首次访问某条路由时
 * 只有骨架；只等 `load` 会在骨架态就量尺寸，得到假的「没有溢出」。
 *
 * 这里显式等 `h1`：导航文案比页头先到，只等「文本 > 40 字」会在 h1 挂载前
 * 就量，表现为「首档偶发 0 个 h1」（1366 是每条路由的第一档，最慢）。
 * 超时不视为失败 —— 由用例里的数量断言给出真实数字。
 */
async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(`${UI}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-content, .landing-page', { timeout: 30000 });
  await page.waitForSelector('h1', { timeout: 15000 }).catch(() => {
    /* 真没有 h1 时交给数量断言报错，这里不吞成超时异常 */
  });
  await page
    .waitForFunction(() => (document.body.innerText ?? '').trim().length > 40, { timeout: 30000 })
    .catch(() => {
      /* 空态页面文本可能很短，不视为失败 */
    });
  // 路由进场动画 6px 位移期间量到的位置不算数
  await page.waitForTimeout(400);
}

async function measure(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const content = document.querySelector('.app-content');
    const root = content ?? document.querySelector('.landing-page');
    const h1s = Array.from(document.querySelectorAll('h1'));
    const first = h1s[0];

    /*
     * 「视觉可见」判定：只看计算样式与盒子尺寸，**不看类名**。
     *
     * 类名会随主题、构建与组件库升级变动，而 `sr-only` 本身是 Tailwind 内置
     * 工具类，不是本仓契约；拿 `classList.contains('sr-only')` 判等于把实现
     * 细节写进测试。这里用它的产物特征判：
     *   - 硬隐藏：display:none / visibility:hidden / opacity:0；
     *   - 裁剪隐藏：clip-path 非 none（Tailwind v4 的 sr-only 用 inset(50%)）
     *     或 clip 为 rect(0,0,0,0) 这类全零矩形；
     *   - 盒模型隐藏：宽或高 ≤ 1px（sr-only 固定 1px×1px）。
     * 三者任一命中即视为不可见。可见的 h1 仍按 §3.1 断言字号，字号不符照样红。
     */
    const isVisuallyHidden = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      if (Number.parseFloat(style.opacity || '1') === 0) return true;
      const clipPath = style.clipPath;
      if (clipPath && clipPath !== 'none') return true;
      const clip = style.clip;
      if (clip && clip !== 'auto' && /rect\(\s*0(px)?[,\s]+0(px)?[,\s]+0(px)?[,\s]+0(px)?\s*\)/.test(clip)) {
        return true;
      }
      const rect = el.getBoundingClientRect();
      return rect.width <= 1 || rect.height <= 1;
    };

    return {
      rootSelector: content ? '.app-content' : root ? '.landing-page' : null,
      docScroll: doc.scrollWidth,
      docClient: doc.clientWidth,
      rootScroll: root ? root.scrollWidth : null,
      rootClient: root ? root.clientWidth : null,
      contentPaddingLeft: content ? Number.parseFloat(getComputedStyle(content).paddingLeft) : null,
      contentPaddingRight: content ? Number.parseFloat(getComputedStyle(content).paddingRight) : null,
      h1Count: h1s.length,
      h1Texts: h1s.map((el) => (el.textContent ?? '').trim().slice(0, 20)),
      h1Size: first ? Number.parseFloat(getComputedStyle(first).fontSize) : null,
      h1Visible: first ? !isVisuallyHidden(first) : false,
    };
  });
}

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${route.name} ${route.path}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`无横向滚动 @${viewport.name}`, async ({ page }) => {
        await gotoAndSettle(page, route.path);
        const m = await measure(page);

        const docOverflow = m.docScroll - m.docClient;
        expect(
          m.docScroll,
          `documentElement 横向溢出：scrollWidth ${m.docScroll} > clientWidth ${m.docClient}` +
            `（多 ${docOverflow}px）`,
        ).toBeLessThanOrEqual(m.docClient + SCROLL_TOLERANCE);

        // 营销页（/）不在外壳里，没有 .app-content：此时只看 documentElement
        if (m.rootSelector === '.app-content') {
          const rootOverflow = (m.rootScroll ?? 0) - (m.rootClient ?? 0);
          expect(
            m.rootScroll,
            `.app-content 横向溢出：scrollWidth ${m.rootScroll} > clientWidth ${m.rootClient}` +
              `（多 ${rootOverflow}px）`,
          ).toBeLessThanOrEqual((m.rootClient ?? 0) + SCROLL_TOLERANCE);
        }
      });

      test(`页头唯一 h1 与字号 @${viewport.name}`, async ({ page }) => {
        await gotoAndSettle(page, route.path);
        const m = await measure(page);

        expect(
          m.h1Count,
          `${route.path} 应有且仅有 1 个 h1，实测 ${m.h1Count} 个` +
            `（${m.h1Texts.length ? m.h1Texts.join(' / ') : '无'}）`,
        ).toBe(1);

        /*
         * 数量与唯一性永远断言；字号只在 h1 **视觉可见**时断言。
         *
         * §3.1 是视觉字号阶。给读屏用的 `sr-only` 标题不参与视觉排版，它的
         * 计算字号只是浏览器默认值（32px），按字号判会红成假阳性。可见性判据
         * 见 measure() 里的注释：只看计算样式与盒子尺寸，不看类名。
         * 判定为不可见时把原因记进 annotations，避免它悄悄被跳过。
         */
        if (!m.h1Visible) {
          test.info().annotations.push({
            type: 'h1-hidden',
            description: `${route.path} 的 h1「${m.h1Texts[0] ?? ''}」视觉隐藏（sr-only），跳过字号断言`,
          });
          return;
        }

        if (route.level === 'L1') {
          // §3.1 L1：桌面 48–68（按页面规格），且必须成组声明「桌面 → ≤900 降一档 → ≤640 降一档」。
          // 中间档的具体值由页面规格定（首页 42），故不写死，只要求「比桌面低、不低于手机档」。
          if (viewport.width <= 640) {
            expect(m.h1Size, `L1 hero 标题在 ≤640 应为 32px，实测 ${m.h1Size}px`).toBeCloseTo(
              32,
              1,
            );
          } else if (viewport.width <= 900) {
            expect(
              m.h1Size ?? 0,
              `L1 hero 标题在 ≤900 应≥手机档 32px，实测 ${m.h1Size}px`,
            ).toBeGreaterThanOrEqual(32 - SIZE_TOLERANCE);
            expect(
              m.h1Size ?? 0,
              `L1 hero 标题在 ≤900 未降档：实测 ${m.h1Size}px，应小于桌面档 68`,
            ).toBeLessThan(68);
          } else {
            expect(
              m.h1Size ?? 0,
              `L1 hero 标题在桌面应为 48–68px，实测 ${m.h1Size}px`,
            ).toBeGreaterThanOrEqual(48 - SIZE_TOLERANCE);
            expect(
              m.h1Size ?? 0,
              `L1 hero 标题不应超过 68px，实测 ${m.h1Size}px`,
            ).toBeLessThanOrEqual(68 + SIZE_TOLERANCE);
          }
          return;
        }

        const expected = expectedHeadingSize(route.level, viewport.width);
        expect(
          m.h1Size,
          `${route.level} 标题在 ${viewport.width}px 视口应为 ${expected}px（§3.1），实测 ${m.h1Size}px`,
        ).not.toBeNull();
        if (m.h1Size !== null) {
          expect(
            Math.abs(m.h1Size - expected),
            `${route.level} 标题在 ${viewport.width}px 视口应为 ${expected}px ±${SIZE_TOLERANCE}` +
              `（§3.1），实测 ${m.h1Size}px`,
          ).toBeLessThanOrEqual(SIZE_TOLERANCE);
        }
      });
    });
  }
}

test.describe('外壳容器内边距阶梯（§2.1）', () => {
  for (const viewport of PADDING_VIEWPORTS) {
    test(`.app-content 水平内边距 @${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoAndSettle(page, '/library');
      const m = await measure(page);
      const expected = expectedContentPadding(viewport.width);

      expect(m.rootSelector, '/library 应在外壳内，.app-content 必须存在').toBe('.app-content');
      for (const [side, actual] of [
        ['左', m.contentPaddingLeft],
        ['右', m.contentPaddingRight],
      ] as const) {
        expect(
          actual,
          `.app-content ${side}内边距在 ${viewport.width}px 视口应为 ${expected}px（§2.1），` +
            `实测 ${actual}px`,
        ).toBeCloseTo(expected, 1);
      }
    });
  }
});
