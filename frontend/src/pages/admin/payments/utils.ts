import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  PaymentConfigField,
  PaymentCurrency,
  PaymentSource,
  VisiblePaymentMethod,
} from '../../../types/payment';
import {
  PROVIDER_LABELS,
  type PaymentProviderState,
} from './constants';

/**
 * 支付域的纯函数：账单日期（上海时区）、金额格式化、渠道短名与配置草稿校验。
 *
 * 充值商品的展示与表单派生不在这里 —— 商品统一由「商品管理」（`/admin/products`）
 * 维护，`payments/` 只处理渠道、订单、对账、异常四件事。
 */

/**
 * 昨天（`YYYY-MM-DD`，上海时区）。对账只能选昨天及更早的账单日。
 *
 * 必须按上海时区切日：用 `toISOString` 会在东八区 00:00–08:00 默认成前天。
 */
export function yesterday(): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

/** 90 天前（`YYYY-MM-DD`，上海时区），对账最早回溯范围。 */
export function ninetyDaysAgo(): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 90);
  return shifted.toISOString().slice(0, 10);
}

/** 金额格式化：分 → 带币种符号的两位小数 */
export function moneyText(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/**
 * 渠道 id → 展示短名。
 *
 * 订单、对账、异常三个列表都要把渠道 id 翻成人话；未登记的 id 原样返回，
 * 保证新增渠道时页面不会出现空白格。
 */
export function providerLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return PROVIDER_LABELS[id] ?? id;
}

/** 跨模块深链：订单管理（商品订单）/ 用户 / 商品订单清单 */
export {
  adminOrderDetailHref,
  adminProductOrdersHref,
  adminUserDetailHref,
} from '../../../lib/admin-links';

/**
 * 渠道配置的**草稿态**必填项校验。
 *
 * 必须基于当前草稿，而不是已保存的值（`provider.missing`）：
 *   · 用户刚补上必填项时，提示还挂着 → 误以为还没生效；
 *   · 用户清空必填项时，提示不出现 → 点保存才报 400。
 *
 * 密字段留空表示「沿用上一版」，所以空白的密字段只要旧值存在就不算缺失。
 *
 * @returns 缺失的必填字段**标签**列表（空数组 = 可用）
 */
export function missingRequiredLabels(
  fields: PaymentConfigField[],
  draftValues: Record<string, string>,
  secretConfigured: Record<string, boolean>,
): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = draftValues[f.name] ?? '';
      if (v.trim()) return false;
      return !(f.secret && secretConfigured[f.name]);
    })
    .map((f) => f.label);
}

/** 实例展示名：自定义名优先；default 与自动生成 id 都有可读兜底。 */
export function instanceLabel(
  instance: Pick<AdminPaymentProviderInstanceView, 'instanceId' | 'name'>,
): string {
  const name = instance.name?.trim();
  if (name) return name;
  return instance.instanceId === 'default' ? '默认实例' : instance.instanceId;
}

/** 单个实例的阻断项。后端告警是唯一事实源。 */
export function instanceBlockingIssues(
  instance: Pick<AdminPaymentProviderInstanceView, 'warnings'>,
): string[] {
  return instance.warnings
    .filter((warning) => warning.level === 'danger')
    .map((warning) => warning.message);
}

/**
 * 单个实例的可运营状态。
 *
 * 实例与渠道使用同一套状态词，便于列表中用同一枚 StatusTag。
 * 后端 `configured` 已综合必填项校验，前端不再从 values 重推。
 */
export function instanceState(
  instance: Pick<
    AdminPaymentProviderInstanceView,
    'enabled' | 'configured' | 'warnings'
  >,
): PaymentProviderState {
  if (instance.enabled) {
    return instanceBlockingIssues(instance).length > 0 || !instance.configured
      ? 'misconfigured'
      : 'usable';
  }
  return instance.configured ? 'disabled' : 'unconfigured';
}

/**
 * 渠道状态按实例聚合：
 *   · 至少一个实例可用 → usable（前台仍可收款）
 *   · 没有可用实例，但有已启用实例报错 → misconfigured
 *   · 全部停用，且至少一个配置完整 → disabled
 *   · 其余 → unconfigured
 */
export function providerState(
  provider: AdminPaymentProviderView,
): PaymentProviderState {
  const states = provider.instances.map(instanceState);
  if (states.includes('usable')) return 'usable';
  if (states.includes('misconfigured')) return 'misconfigured';
  if (states.includes('disabled')) return 'disabled';
  return 'unconfigured';
}

/** 渠道下所有实例的 danger 告警（去重，保留后端原文）。 */
export function providerBlockingIssues(
  provider: AdminPaymentProviderView,
): string[] {
  return [...new Set(provider.instances.flatMap(instanceBlockingIssues))];
}

/** 渠道中真正可收款的实例数量。 */
export function usableInstanceCount(provider: AdminPaymentProviderView): number {
  return provider.instances.filter(
    (instance) => instanceState(instance) === 'usable',
  ).length;
}

/** 渠道中已启用的实例数量。 */
export function enabledInstanceCount(provider: AdminPaymentProviderView): number {
  return provider.instances.filter((instance) => instance.enabled).length;
}

/** 某来源下可作为指定前台按钮的实例。 */
export function sourceAvailableInstances(
  providers: AdminPaymentProviderView[],
  currency: PaymentCurrency,
  method: VisiblePaymentMethod,
  source: PaymentSource,
): { provider: AdminPaymentProviderView | null; instances: AdminPaymentProviderInstanceView[] } {
  if (source === 'unset') return { provider: null, instances: [] };
  const providerId = source === 'official' ? method : 'epay';
  const provider = providers.find((item) => item.id === providerId) ?? null;
  if (!provider || !provider.supportedCurrencies.includes(currency)) {
    return { provider, instances: [] };
  }
  const instances = provider.instances.filter(
    (instance) =>
      instance.enabled &&
      instance.configured &&
      instance.paymentMethods.includes(method) &&
      instanceBlockingIssues(instance).length === 0,
  );
  return { provider, instances };
}

/** 前台某按钮的来源可用性；不可用时给出可操作的原因。 */
export function sourceAvailability(
  providers: AdminPaymentProviderView[],
  currency: PaymentCurrency,
  method: VisiblePaymentMethod,
  source: PaymentSource,
): { ok: boolean; reason: string } {
  if (source === 'unset') return { ok: false, reason: '未选择支付来源' };

  const providerId = source === 'official' ? method : 'epay';
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    return {
      ok: false,
      reason: `尚未创建${source === 'official' ? '对应官方' : '易支付'}渠道`,
    };
  }
  if (!provider.supportedCurrencies.includes(currency)) {
    return { ok: false, reason: `${provider.name}不支持默认币种 ${currency}` };
  }
  if (provider.instances.length === 0) {
    return { ok: false, reason: `${provider.name}尚未创建服务商实例` };
  }

  const candidates = provider.instances.filter((instance) =>
    instance.paymentMethods.includes(method),
  );
  if (candidates.length === 0) {
    return { ok: false, reason: `${provider.name}没有实例选择${method === 'alipay' ? '支付宝' : '微信支付'}` };
  }
  const enabled = candidates.filter((instance) => instance.enabled);
  if (enabled.length === 0) {
    return { ok: false, reason: `${provider.name}没有已启用的${method === 'alipay' ? '支付宝' : '微信支付'}实例` };
  }
  const configured = enabled.filter((instance) => instance.configured);
  if (configured.length === 0) {
    return { ok: false, reason: `${provider.name}的已启用实例配置不完整` };
  }
  const danger = configured
    .flatMap(instanceBlockingIssues)
    .find((message) => Boolean(message));
  if (danger) return { ok: false, reason: danger };
  return { ok: true, reason: '' };
}
