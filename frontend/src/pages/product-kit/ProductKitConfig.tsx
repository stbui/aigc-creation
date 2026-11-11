import { NumberStepper } from '../../ui';

import { VARIANT_FIELDS } from './constants';

const MAX_PER_VARIANT = 5;

/**
 * 自定义配置：白底 / 场景 / 卖点 / 其他图的张数。
 *
 * 计数只到 5，输入框与步进按钮共用同一套夹取规则；超出范围的输入被归一，
 * 不抛错也不静默保留非法值。
 */
export function ProductKitConfig({
  counts,
  onCountChange,
}: {
  counts: Record<string, number>;
  onCountChange: (key: string, value: number) => void;
}) {
  return (
    <section className="pk-config-card">
      <div className="pk-section">
        <strong className="pk-section-title">自定义配置</strong>
        <div className="pk-count-grid">
          {VARIANT_FIELDS.map((v) => (
            <div key={v.key} className="pk-count-field">
              <span className="pk-count-label">{v.label}</span>
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
