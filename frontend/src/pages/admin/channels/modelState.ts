import type { AdminChannelModelView } from './types';

/**
 * 商品对运营的三个结论，外加“还没配完”。
 *
 * 优先级刻意是「待配置 > 已停用 > 待定价 > 可用」：上游导入的骨架行同时
 * 满足“停用”和“缺能力 / 协议”，先报「待配置」才能把人带到要补的字段，
 * 而不是让他去点一个没有意义的启用开关。
 */
export type ProductState = 'available' | 'unpriced' | 'unconfigured' | 'disabled';

export const PRODUCT_STATE_META: Record<
  ProductState,
  { label: string; tone: 'success' | 'warn' | 'muted' }
> = {
  available: { label: '可用', tone: 'success' },
  unpriced: { label: '待定价', tone: 'warn' },
  unconfigured: { label: '待配置', tone: 'warn' },
  disabled: { label: '已停用', tone: 'muted' },
};

export function productStateOf(
  model: Pick<AdminChannelModelView, 'capability' | 'protocol' | 'enabled' | 'priceConfigured'>,
  channelEnabled = true,
): ProductState {
  if (!model.capability.trim() || !model.protocol.trim()) return 'unconfigured';
  if (!model.enabled || !channelEnabled) return 'disabled';
  if (!model.priceConfigured) return 'unpriced';
  return 'available';
}
