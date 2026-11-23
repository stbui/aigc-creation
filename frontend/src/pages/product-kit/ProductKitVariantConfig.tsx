import { NumberStepper, SectionCard } from '../../ui';

import { MAX_PER_VARIANT, VARIANT_FIELDS } from './constants';

/**
 * 自定义配置：白底 / 场景 / 卖点 / 其他图的张数。
 *
 * 只负责「变体张数」，故命名带 Variant，避免与表单区、高级设置混为一谈。
 * 计数只到 5，输入框与步进按钮共用同一套夹取规则；超出范围的输入被归一，
 * 不抛错也不静默保留非法值。
 *
 * 卡片外壳与标题行走 `SectionCard`，两列网格与窄屏单列由 Tailwind 工具类表达；
 * 此前对应的 `.pk-count-*` 页面 class 已随收口移除。
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
    <SectionCard title="自定义配置" extra={`共 ${total} 张`}>
      <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1 max-[480px]:gap-2.5">
        {VARIANT_FIELDS.map((v) => (
          <div
            key={v.key}
            className="grid h-8 grid-cols-[48px_minmax(0,1fr)] items-center gap-4 max-[480px]:grid-cols-[52px_minmax(0,1fr)] max-[480px]:gap-3"
          >
            <span className="text-sm leading-[13px] text-muted-foreground">{v.label}</span>
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
    </SectionCard>
  );
}
