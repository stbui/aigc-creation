import { VARIANT_COUNTS } from './constants';

/**
 * 输出参数卡 —— 当前只有「变体张数」一项。
 *
 * 张数直接进任务参数 `variantCount`；价格随张数变化，故按选项表渲染，
 * 选中态由页面持有的值决定。
 */
export function MultiFusionParameterCard({
  variantCount,
  onVariantCountChange,
}: {
  variantCount: string;
  onVariantCountChange: (value: string) => void;
}) {
  return (
    <div className="multi-image-fusion-card multi-image-fusion-parameter-card">
      <div className="multi-image-fusion-card-heading compact">
        <div>
          <h2>输出参数</h2>
        </div>
      </div>
      <div className="multi-image-fusion-parameter-group">
        <div className="multi-image-fusion-field-label">
          <span>变体张数</span>
        </div>
        <div className="multi-image-fusion-variant-options" role="radiogroup" aria-label="变体张数">
          {VARIANT_COUNTS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === variantCount}
              className={v === variantCount ? 'selected' : undefined}
              onClick={() => onVariantCountChange(v)}
            >
              {v} 张
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
