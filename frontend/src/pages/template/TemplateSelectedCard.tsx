import type { TemplateEntry } from './utils';

interface TemplateSelectedCardProps {
  template: TemplateEntry | null;
  onClear: () => void;
}

/** 已选模板回显：缩略图、名称与清除入口；未选时提示去右侧选择。 */
export function TemplateSelectedCard({ template, onClear }: TemplateSelectedCardProps) {
  return (
    <section className="tpl-section">
      <strong className="pk-section-title">
        <i className="pk-required-mark">*</i>
        选择模板
      </strong>
      {template ? (
        <div className="tpl-selected">
          <img src={template.thumbFile} alt={`${template.name} 模板预览`} loading="lazy" />
          <div className="tpl-selected-copy">
            <strong>{template.name}</strong>
            <button type="button" className="tpl-selected-clear" onClick={onClear}>
              清除
            </button>
          </div>
        </div>
      ) : (
        <div className="tpl-selected-empty">在右侧选择一个模板后即可生成</div>
      )}
    </section>
  );
}
