import { Link } from 'react-router-dom';

import type { SitemapSection } from './constants';

interface SitemapSectionCardProps {
  section: SitemapSection;
}

/** 单个分组：编号小标、标题、条目数与链接列表。 */
export function SitemapSectionCard({ section }: SitemapSectionCardProps) {
  return (
    <section className="sitemap-section">
      <span className="sitemap-section-no" style={{ color: section.color }}>
        {section.no} / {section.label}
      </span>
      <div className="sitemap-section-head">
        <h2>{section.title}</h2>
        <span>{section.links.length} 个</span>
      </div>
      <ul className="sitemap-list">
        {section.links.map((link) => (
          <li key={link.to + link.name}>
            <Link to={link.to} className="sitemap-item">
              <span className="sitemap-item-name">{link.name}</span>
              <span className="sitemap-item-path">{link.path}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
