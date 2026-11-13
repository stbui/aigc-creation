import { NumberStepper } from '../../ui';

import { MAX_PER_VARIANT, VARIANT_FIELDS } from './constants';

/**
 * 自定义配置：白底 / 场景 / 卖点 / 其他图的张数。
 *
 * 只负责「变体张数」，故命名带 Variant，避免与表单区、高级设置混为一谈。
 * 计数只到 5，输入框与步进按钮共用同一套夹取规则；超出范围的输入被归一，
 * 不抛错也不静默保留非法值。
 */
export function ProductKitVariantConfig({
  counts,
  onCountChange,
}: {
  counts: Record<string, number>;
  onCountChange: (key: string, value: number) => void;
}) {
  const total = VARIANT_FIELDS.reduce((sum, field) => sum + (counts[field.key] ?? 0), 0);

  return (
    <section className="pk-config-card">
      <div className="pk-section">
        <div className="pk-section-head">
          <strong className="pk-section-title u-font-14">自定义配置</strong>
          <span className="pk-section-count u-font-12">共 {total} 张</span>
        </div>
        <div className="pk-count-grid">
          {VARIANT_FIELDS.map((v) => (
            <div key={v.key} className="pk-count-field">
              <span className="pk-count-label u-font-14">{v.label}</span>
              <NumberStepper
                label={v.label}
                value={counts[v.key] ?? 0}
                min={0}
                max={MAX_PER_VARIANT}
                onChange={(next) => onCountChange(v.key, next)}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
