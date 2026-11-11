import { memo } from 'react';

import type { TemplateEntry } from './utils';

/**
 * 写真模板网格（右栏主内容）。
 *
 * 卡片只展示预览图与模板名：模板提示词不下发到 C 端，标签、大图入口与角标
 * 等附加信息都不展示。选中反馈由卡片品牌紫描边表达，不额外渲染文字角标。
 */

export interface TemplateGalleryProps {
  templates: TemplateEntry[];
  /** 当前选中的模板 id */
  selectedId: string | null;
  onSelect: (template: TemplateEntry) => void;
  /** 模板清单加载失败 */
  error?: string | null;
  loading?: boolean;
  /** 重新拉取模板清单（后端重启 / 网络抖动后无需整页刷新） */
  onRetry?: () => void;
}

function TemplateGalleryImpl({
  templates,
  selectedId,
  onSelect,
  error,
  loading,
  onRetry,
}: TemplateGalleryProps) {
  if (error) {
    return (
      <div className="tpl-template-error">
        <p className="tool-submit-notice tool-submit-notice-error">模板加载失败：{error}</p>
        {onRetry && (
          <button type="button" className="tpl-template-retry" onClick={onRetry}>
            重新加载
          </button>
        )}
      </div>
    );
  }

  if (loading && templates.length === 0) {
    return <div className="tpl-template-empty">模板加载中…</div>;
  }

  if (templates.length === 0) {
    return <div className="tpl-template-empty">该分类下暂无模板</div>;
  }

  return (
    <div className="tpl-template-grid">
      {templates.map((template) => {
        const selected = template.id === selectedId;
        return (
          <article
            key={template.id}
            className={`tpl-template-card${selected ? ' is-selected' : ''}`}
            data-testid={`tpl-template-${template.id}`}
          >
            <div className="tpl-template-cover">
              <button
                type="button"
                className="tpl-template-cover-btn"
                onClick={() => onSelect(template)}
                aria-label={`选用模板${template.name}`}
                aria-pressed={selected}
              >
                <img
                  src={template.thumbFile}
                  alt={`${template.name} 模板预览`}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </div>

            <div className="tpl-template-content">
              <strong className="tpl-template-title">{template.name}</strong>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** memo: 分类切换才重建网格，左栏输入不影响 */
export const TemplateGallery = memo(TemplateGalleryImpl);
