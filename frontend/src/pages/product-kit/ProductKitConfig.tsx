import { Minus, Plus } from 'lucide-react';

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
            <label key={v.key} className="pk-count-field">
              <span className="pk-count-label">{v.label}</span>
              <div className="pk-number-control">
                <button
                  type="button"
                  aria-label={`减少${v.label}`}
                  onClick={() => onCountChange(v.key, Math.max(0, (counts[v.key] ?? 0) - 1))}
                >
                  <Minus size={13} />
                </button>
                <input
                  type="number"
                  min={0}
                  max={MAX_PER_VARIANT}
                  value={counts[v.key] ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onCountChange(
                      v.key,
                      Number.isFinite(n)
                        ? Math.min(MAX_PER_VARIANT, Math.max(0, Math.round(n)))
                        : 0,
                    );
                  }}
                />
                <button
                  type="button"
                  aria-label={`增加${v.label}`}
                  onClick={() =>
                    onCountChange(v.key, Math.min(MAX_PER_VARIANT, (counts[v.key] ?? 0) + 1))
                  }
                >
                  <Plus size={13} />
                </button>
              </div>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
