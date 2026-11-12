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
 * 版面数值来自参考站实拍 (2026-10-17, 1280 视口):
 *   顶部条: 品牌 + 「机器地图 XML」(/sitemap.xml) + 「返回首页 ↗」
 *   hero 1100x172: eyebrow「IJIHUA / SITE INDEX」+ h1「网站地图.」
 *     68px/780 #182033 lh66.64; 下方 15px 说明文案
 *   主体 main 1100, 两列网格 (各列起点 x=162 / x=721)
 *   每组: 编号小标 12px/750 letterSpacing 1.2 (四组四色)
 *     取 --sitemap-accent-1..4: 第一组即品牌紫, 其余三色压到白底 ≥4.9:1
 *     (参考站的 42,168,192 / 230,134,98 / 53,168,137 在白底只有 2.6–3.0:1)
 *     + 组标题 17px/720 #182033 + 条目数
 *   条目 li 491x38 display list-item: 名称 16px #182033 + 路径 12px #9AA1B1
 *   页脚: © 2026 + 「查看 XML Sitemap ↗」
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
    <div className="sitemap-page">
      <SitemapTopbar />

      <main className="sitemap-main">
        <SitemapHero />

        <div className="sitemap-grid">
          {sections.map((section) => (
            <SitemapSectionCard key={section.no} section={section} />
          ))}
        </div>
      </main>

      <SitemapFooter />
    </div>
  );
}
