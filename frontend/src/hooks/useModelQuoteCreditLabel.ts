import { useMemo, useState } from 'react';
import { useCreditCost } from './useCreditLabel';

interface Options {
  /** 能力 id（与后端 capability.registry 一致） */
  capability: string;
  /** 本次会出几张；价签按张数折算 */
  count?: number;
  /** 免费态文案：详情图用「限时免费」，其余页面用「免费」 */
  freeLabel?: string;
}

/**
 * 提交区的积分价签 —— 模型实时报价优先，取不到才回落到能力基础价。
 *
 * 价签必须按「本次要出几张」计算：只显示单张单价、实际却扣多份，属于
 * 计费披露错误。所选模型报价来自高级设置里的 `ModelPicker`。
 */
export function useModelQuoteCreditLabel({
  capability,
  count = 1,
  freeLabel = '免费',
}: Options) {
  const [modelQuote, setModelQuote] = useState<number | null>(null);
  const unitCreditCost = useCreditCost(capability);

  const label = useMemo(() => {
    const unit = modelQuote ?? unitCreditCost;
    if (unit == null) return null;
    if (unit === 0) return freeLabel;
    const total = unit * Math.max(count, 1);
    return modelQuote == null
      ? `本次消耗 ${total} 积分`
      : `本次约 ${total} 积分（按所选模型）`;
  }, [modelQuote, unitCreditCost, count, freeLabel]);

  return { label, onModelQuoteChange: setModelQuote };
}
