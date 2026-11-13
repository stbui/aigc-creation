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
  onPreviewPrompt,
  previewing,
}: {
  counts: Record<string, number>;
  onCountChange: (key: string, value: number) => void;
  /** 打开提示词预览（不扣费、不生成） */
  onPreviewPrompt?: () => void;
  /** 预览请求进行中 */
  previewing?: boolean;
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
        {/*
          * 提示词预览入口。
          *
          * 白底图 / 场景图 / 卖点图三类主图的画面要求**互斥**，用户往往
          * 无法从成品图反推模型收到了什么。加上预览后，用户在提交前就能
          * 确认「这一类要的是纯白底，那一类要的是场景」—— 而不是等三张
          * 出来后发现全是同一张。
          */}
        {onPreviewPrompt && (
          <button
            type="button"
            className="pk-preview-prompt-btn u-font-13"
            onClick={onPreviewPrompt}
            disabled={previewing || total === 0}
            title={total === 0 ? '请先选择至少一种主图类型' : '查看本次提交将发送给模型的提示词'}
          >
            {previewing ? '正在计算…' : '查看提示词'}
          </button>
        )}
      </div>
    </section>
  );
}
