import { useMemo } from 'react';

import { SECTIONS, SITEMAP_PAGE_META } from './constants';
import { useCapabilities, useDocumentMeta } from './hooks';
import { filterVisibleSections } from './utils';
import { SitemapFooter } from './SitemapFooter';
import { SitemapHero } from './SitemapHero';
import { SitemapSectionCard } from './SitemapSectionCard';
import { SitemapTopbar } from './SitemapTopbar';

/**
 * 网站地图
 *
 * 版面尺寸沿用参考站实拍 (2026-10-17, 1280 视口)，样式全部走 Tailwind
 * 语义类与 `tokens.css` 令牌，本页不再有独占样式表：
 *   顶部条: 品牌 + 「本页即站点索引」说明 + 「返回首页 ↗」
 *   hero 宽 1100: eyebrow「HUOJUE AI / SITE INDEX」+ h1「网站地图.」
 *     68px / leading 66.64px; 下方说明文案，窄屏 40px
 *   主体 main 宽 1100，两列网格，窄屏单列
 *   每组: 编号小标 + 组标题 + 条目数，编号四组四色
 *     取 `--sitemap-accent-1..4`：第一组即品牌紫，其余三色压到白底 ≥4.9:1
 *   条目: 名称 + 路径，整行可点，悬停底色
 *   页脚: © 2026
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：顶部条 `SitemapTopbar`、
 * 页头 `SitemapHero`、分组卡 `SitemapSectionCard`、页脚 `SitemapFooter`；
 * 静态路由清单落 `constants.ts`，能力可见性过滤落 `utils.ts`。
 */
export function SitemapPage() {
  useDocumentMeta(SITEMAP_PAGE_META.title, SITEMAP_PAGE_META.description);
  const { data } = useCapabilities();
  const sections = useMemo(
    () => filterVisibleSections(SECTIONS, data?.items),
    [data],
  );

  return (
    <div className="flex min-h-screen flex-col bg-card">
      <SitemapTopbar />

      <main className="mx-auto w-[1100px] max-w-full px-6 pt-[58px] pb-10">
        <SitemapHero />

        <div className="grid grid-cols-1 gap-x-24 gap-y-8 min-[901px]:grid-cols-2">
          {sections.map((section) => (
            <SitemapSectionCard key={section.no} section={section} />
          ))}
        </div>
      </main>

      <SitemapFooter />
    </div>
  );
}
