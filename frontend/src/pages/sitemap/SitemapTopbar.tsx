import { Link } from 'react-router-dom';

/** 顶部条：品牌 + 返回首页。 */
export function SitemapTopbar() {
  return (
    <header className="sitemap-topbar">
      <Link to="/" className="sitemap-topbar-brand">
        {/* 品牌标记: 货觉AI「觉眼」logo (2026-10-19, 见 docs/brand/brand-basics.md) */}
        <img src="/brand/huojue-mark.svg" alt="货觉AI" className="sitemap-topbar-brand-mark" />
        <span>
          货觉<span className="sitemap-topbar-brand-ai">AI</span>
        </span>
      </Link>
      <div className="sitemap-topbar-right">
        <span className="sitemap-topbar-note">本页即站点索引，无需 XML</span>
        <Link to="/" className="sitemap-topbar-link">
          返回首页 ↗
        </Link>
      </div>
    </header>
  );
}
