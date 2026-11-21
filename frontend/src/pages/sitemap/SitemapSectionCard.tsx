import { Link } from 'react-router-dom';

import type { SitemapSection } from './constants';

interface SitemapSectionCardProps {
  section: SitemapSection;
}

/**
 * 编号小标的四色。
 *
 * 色值只来自 `tokens.css` 的 `--sitemap-accent-1..4`（第一组即品牌紫，
 * 其余三色在白底 ≥4.9:1）。这里只登记「第几组 → 哪个令牌」，
 * 不写字面色值，改色仍只改令牌一处。
 */
const ACCENT_CLASS: Record<SitemapSection['accent'], string> = {
  1: 'text-[var(--sitemap-accent-1)]',
  2: 'text-[var(--sitemap-accent-2)]',
  3: 'text-[var(--sitemap-accent-3)]',
  4: 'text-[var(--sitemap-accent-4)]',
};

/** 单个分组：编号小标、标题、条目数与链接列表。 */
export function SitemapSectionCard({ section }: SitemapSectionCardProps) {
  return (
    <section>
      <span className={`text-xs font-[750] tracking-[1.2px] ${ACCENT_CLASS[section.accent]}`}>
        {section.no} / {section.label}
      </span>
      <div className="mt-[10px] flex items-baseline gap-[10px]">
        <h2 className="m-0 text-base font-[720] text-foreground">{section.title}</h2>
        <span className="text-xs text-muted-foreground">{section.links.length} 个</span>
      </div>
      <ul className="mt-[18px] flex list-none flex-col gap-[10px] p-0">
        {section.links.map((link) => (
          <li key={link.to + link.name}>
            <Link
              to={link.to}
              className="flex min-h-[38px] items-center justify-between gap-4 rounded-lg px-3 py-2 text-foreground no-underline transition-colors hover:bg-page"
            >
              <span className="text-base text-foreground">{link.name}</span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{link.path}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}