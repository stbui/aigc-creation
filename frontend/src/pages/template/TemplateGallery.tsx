import { memo, useState } from 'react';
import { Check, Eye } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import type { PortraitTemplate } from './api';

/**
 * 写真模板网格（右栏主内容）。
 *
 * 卡片结构：竖版预览图 + 模板名 + 提示词。提示词是提交给模型的风格描述，
 * 直接展示在卡片上 —— 用户选模板时看的就是「这张图会用什么提示词生成」。
 * 选中态用品牌紫描边，并浮出「已选用」角标。
 */

export interface TemplateGalleryProps {
  templates: PortraitTemplate[];
  /** 当前选中的模板 id */
  selectedId: string | null;
  onSelect: (template: PortraitTemplate) => void;
  /** 模板清单加载失败 */
  error?: string | null;
  loading?: boolean;
  /** 重新拉取模板清单（后端重启 / 网络抖动后无需整页刷新） */
  onRetry?: () => void;
}

function lightboxItemOf(template: PortraitTemplate): LightboxItem {
  return {
    id: template.id,
    url: template.thumbFile,
    alt: `${template.name} 模板预览`,
    prompt: template.prompt,
    meta: [template.name],
  };
}

function TemplateGalleryImpl({
  templates,
  selectedId,
  onSelect,
  error,
  loading,
  onRetry,
}: TemplateGalleryProps) {
  const [preview, setPreview] = useState<PortraitTemplate | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    <>
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
                >
                  <img
                    src={template.thumbFile}
                    alt={`${template.name} 模板预览`}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
                <button
                  type="button"
                  className="tpl-template-preview"
                  aria-label={`查看模板${template.name}大图与提示词`}
                  title="查看大图与提示词"
                  onClick={() => setPreview(template)}
                >
                  <Eye size={14} />
                </button>
                {selected && (
                  <span className="tpl-template-selected" aria-hidden>
                    <Check size={12} />
                    已选用
                  </span>
                )}
              </div>

              <div className="tpl-template-content">
                <strong className="tpl-template-title">{template.name}</strong>
                <p
                  className={`tpl-template-prompt${expandedId === template.id ? ' is-expanded' : ''}`}
                  title={template.prompt}
                >
                  {template.prompt}
                </p>
                <div className="tpl-template-actions">
                  <button
                    type="button"
                    className="tpl-template-prompt-toggle"
                    aria-expanded={expandedId === template.id}
                    onClick={() =>
                      setExpandedId((current) => (current === template.id ? null : template.id))
                    }
                  >
                    {expandedId === template.id ? '收起提示词' : '展开提示词'}
                  </button>
                  <button
                    type="button"
                    className="tpl-template-use"
                    aria-label={selected ? `已选用模板${template.name}` : `选用模板${template.name}`}
                    onClick={() => onSelect(template)}
                  >
                    {selected ? '已选用' : '选用'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {preview && (
        <ImageLightbox
          items={[lightboxItemOf(preview)]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setPreview(null)}
          ariaLabel={`模板${preview.name}预览`}
        />
      )}
    </>
  );
}

/** memo: 分类切换才重建网格，左栏输入不影响 */
export const TemplateGallery = memo(TemplateGalleryImpl);
