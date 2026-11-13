import { useState } from 'react';
import { MousePointerClick } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import type { TemplateEntry } from './utils';

interface TemplateSelectedCardProps {
  template: TemplateEntry | null;
  onClear: () => void;
}

/** 已选模板回显：分类路径、名称、标签与清除入口；缩略图可点开大图。 */
export function TemplateSelectedCard({ template, onClear }: TemplateSelectedCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const tags = template?.tags ?? [];
  const visibleTags = tags.slice(0, 3);
  const restCount = tags.length - visibleTags.length;
  const lightboxItems: LightboxItem[] = template
    ? [
        {
          id: template.id,
          url: template.thumbFile,
          alt: `${template.name} 模板预览`,
          meta: [template.categoryName, template.groupName],
        },
      ]
    : [];

  return (
    <section className="pk-section">
      <strong className="pk-section-title u-font-14">
        <i className="pk-required-mark u-font-14">*</i>
        选择模板
      </strong>
      {template ? (
        <div className="tpl-selected">
          <button
            type="button"
            className="tpl-selected-thumb"
            onClick={() => setPreviewOpen(true)}
            aria-label={`查看${template.name}大图`}
            title="看大图"
          >
            <img src={template.thumbFile} alt={`${template.name} 模板预览`} loading="lazy" />
          </button>
          <div className="tpl-selected-copy">
            <span className="tpl-selected-path">
              {template.categoryName} · {template.groupName}
            </span>
            <strong className="tpl-selected-name">{template.name}</strong>
            {visibleTags.length > 0 && (
              <span className="tpl-selected-tags" title={tags.join('、')}>
                {visibleTags.map((tag) => (
                  <span key={tag} className="tpl-selected-tag">
                    {tag}
                  </span>
                ))}
                {restCount > 0 && (
                  <span className="tpl-selected-tag is-more">+{restCount}</span>
                )}
              </span>
            )}
            <button type="button" className="tpl-selected-clear" onClick={onClear}>
              清除
            </button>
          </div>
        </div>
      ) : (
        <div className="tpl-selected-empty">
          <span className="tpl-selected-empty-icon">
            <MousePointerClick size={18} />
          </span>
          <span className="tpl-selected-empty-copy">
            <strong>在右侧选择一个模板</strong>
            <small>选中后会回显在这里</small>
          </span>
        </div>
      )}

      {previewOpen && template && lightboxItems.length > 0 && (
        <ImageLightbox
          items={lightboxItems}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setPreviewOpen(false)}
          ariaLabel="模板大图预览"
        />
      )}
    </section>
  );
}
