import { memo, useState } from 'react';
import { Eye } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import { templateBeatsText } from './utils';
import type { ShoppableCarouselTemplate } from './api';
import { Modal } from '../../ui';

/**
 * 模板网格（右栏主内容）。
 *
 * 结构对齐参考站实拍（`docs/shoppable-carousel-design.md` §6）：
 *   卡片 = 三张连续预览图并排（沟槽底）+ 标题 + 三拍文案副标题；
 *   hover 时浮出「预览」与「选用」按钮；选中态用品牌紫描边。
 *
 * 预览按钮位置与参考站一致（缩略图左上角，hover 显）；点开不是单图翻看，
 * 而是把该模板的三张图**成组**铺开的弹窗（三张并排、各带拍名），
 * 再点单张才进大图灯箱 —— 参考站只能逐张翻，看不到整组。
 *
 * 视觉按本站体系落地：参考站的品牌蓝 `#3388ff` 一律换成 `--brand`，
 * 尺寸与间距取本站令牌（`--radius-panel` / `--surface-soft` / `--border`）。
 */

/** 预览图灯箱：把模板的三张图放进同一个查看器 */
function templateLightboxItems(template: ShoppableCarouselTemplate): LightboxItem[] {
  return template.thumbFiles.map((url, index) => ({
    id: `${template.id}:${index}`,
    url,
    alt: `${template.name} 第 ${index + 1} 张`,
    meta: [template.name, template.beats[index] ?? ''],
  }));
}

export interface TemplateGridProps {  templates: ShoppableCarouselTemplate[];
  /** 当前选中的模板 id */
  selectedId: string | null;
  onSelect: (template: ShoppableCarouselTemplate) => void;
  /** 模板清单加载失败 */
  error?: string | null;
  loading?: boolean;
}

function TemplateGridImpl({ templates, selectedId, onSelect, error, loading }: TemplateGridProps) {
  /** 大图灯箱：一次只显示一张，可左右翻 */
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  /** 一组图：三张并排铺开的总览弹窗 */
  const [group, setGroup] = useState<ShoppableCarouselTemplate | null>(null);

  /** 从总览里点单张：先收起总览，再开大图（灯箱层级低于弹窗，不能叠着开） */
  const openFromGroup = (template: ShoppableCarouselTemplate, index: number) => {
    setGroup(null);
    setPreview({ items: templateLightboxItems(template), index });
  };

  if (error) {
    return (
      <p className="tool-submit-notice tool-submit-notice-error">模板加载失败：{error}</p>
    );
  }

  if (loading && templates.length === 0) {
    return <div className="sc-template-grid-empty">模板加载中…</div>;
  }

  if (templates.length === 0) {
    return <div className="sc-template-grid-empty">该分类下暂无模板</div>;
  }

  return (
    <>
      <div className="sc-template-grid">
        {templates.map((template) => {
          const selected = template.id === selectedId;
          const beats = templateBeatsText(template);
          return (
            <article
              key={template.id}
              className={`sc-template-card${selected ? ' is-selected' : ''}`}
              data-testid={`sc-template-${template.id}`}
            >
              <div className="sc-template-gallery">
                {template.thumbFiles.map((url, index) => (
                  <div className="sc-template-slot" key={`${template.id}-${index}`}>
                    <img
                      src={url}
                      alt={`${template.name} 第 ${index + 1} 张`}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ))}
                {/* 位置与参考站一致（左上角、hover 显）；点开三张一组的弹窗 */}
                <button
                  type="button"
                  className="sc-template-preview"
                  aria-label={`查看模板${template.name}的一组图片`}
                  title="查看图片"
                  onClick={() => setGroup(template)}
                >
                  <Eye size={14} />
                </button>
              </div>

              <div className="sc-template-content">
                <span className="sc-template-details">
                  <strong className="sc-template-title">{template.name}</strong>
                  <small className="sc-template-desc" title={beats}>
                    {beats}
                  </small>
                </span>
                <button
                  type="button"
                  className="sc-template-use"
                  aria-label={`选用模板${template.name}`}
                  onClick={() => onSelect(template)}
                >
                  {selected ? '已选用' : '选用'}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {group && (
        <Modal
          open
          title={`${group.name} · 三张一组`}
          width={880}
          footer={null}
          onCancel={() => setGroup(null)}
        >
          <div className="sc-template-group">
            {group.thumbFiles.map((url, index) => (
              <button
                key={`${group.id}-group-${index}`}
                type="button"
                className="sc-template-group-item"
                aria-label={`查看模板${group.name}第 ${index + 1} 张大图`}
                onClick={() => openFromGroup(group, index)}
              >
                <img src={url} alt={`${group.name} 第 ${index + 1} 张`} />
                <span>{group.beats[index] ?? `第 ${index + 1} 拍`}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {preview && (
        <ImageLightbox
          items={preview.items}
          index={preview.index}
          onIndexChange={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

/** memo: 分类切换才重建网格, 左栏输入不影响 */
export const TemplateGrid = memo(TemplateGridImpl);
