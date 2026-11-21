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
        <div className="flex gap-3 rounded-lg border border-border bg-[var(--surface-soft)] p-3">
          <button
            type="button"
            className="group h-[100px] w-[76px] shrink-0 cursor-zoom-in overflow-hidden rounded-md border-0 bg-card p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            onClick={() => setPreviewOpen(true)}
            aria-label={`查看${template.name}大图`}
            title="看大图"
          >
            <img
              className="block size-full rounded-md object-cover transition-transform duration-200 group-hover:scale-[1.04]"
              src={template.thumbFile}
              alt={`${template.name} 模板预览`}
              loading="lazy"
            />
          </button>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-xs leading-4 text-[color:var(--text-desc)]">
              {template.categoryName} · {template.groupName}
            </span>
            <strong className="text-sm font-semibold text-foreground">{template.name}</strong>
            {visibleTags.length > 0 && (
              <span className="flex flex-wrap gap-1" title={tags.join('、')}>
                {visibleTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-brand-bg px-2 py-px text-xs leading-[18px] text-[color:var(--text-brand-1)]"
                  >
                    {tag}
                  </span>
                ))}
                {restCount > 0 && (
                  <span className="rounded-full bg-muted px-2 py-px text-xs leading-[18px] text-[color:var(--text-desc)]">
                    +{restCount}
                  </span>
                )}
              </span>
            )}
            <button
              type="button"
              className="mt-1 cursor-pointer self-start border-0 bg-transparent p-0 text-xs leading-[18px] text-brand hover:text-brand-hover"
              onClick={onClear}
            >
              清除
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[100px] items-center gap-3 rounded-lg border border-dashed border-border bg-[var(--surface-soft)] p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-bg text-brand">
            <MousePointerClick size={18} />
          </span>
          <span className="grid gap-0.5">
            <strong className="text-sm font-semibold text-foreground">在右侧选择一个模板</strong>
            <small className="text-xs leading-[18px] text-[color:var(--text-desc)]">
              选中后会回显在这里
            </small>
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
