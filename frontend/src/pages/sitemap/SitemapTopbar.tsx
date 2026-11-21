import { Link } from 'react-router-dom';

/**
 * 顶部条：品牌 + 返回首页。
 *
 * 视觉全部来自 Tailwind 语义类与 `tokens.css` 令牌，本页不再有独占样式表。
 * 边框与次要文字用 `border-border` / `text-muted-foreground`，
 * 与全站同一套映射（见 `styles/tailwind-theme.css`）。
 */
export function SitemapTopbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border px-6">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-base font-bold text-foreground no-underline"
      >
        {/* 品牌标记: 货觉AI「觉眼」logo (2026-10-19, 见 docs/brand/brand-basics.md) */}
        <img src="/brand/huojue-mark.svg" alt="货觉AI" className="block size-6 shrink-0" />
        <span>
          货觉<span className="text-brand">AI</span>
        </span>
      </Link>
      <div className="flex items-center gap-4">
        <span className="text-xs text-muted-foreground">本页即站点索引，无需 XML</span>
        <Link to="/" className="text-[13px] text-foreground no-underline hover:text-brand">
          返回首页 ↗
        </Link>
      </div>
    </header>
  );
}