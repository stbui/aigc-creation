import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  PaymentConfigField,
  PaymentCurrency,
  PaymentSource,
  VisiblePaymentMethod,
} from '../../../types/payment';
import { formatYuanPlain } from '../../../admin-ui/lib/format';
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

/** 对账账单日：必须是真实存在的日期，且位于最早 90 天前到昨天之间。 */
export function isValidReconciliationBillDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return false;
  }
  return value >= ninetyDaysAgo() && value <= yesterday();
}

/** 金额格式化：分 → 带币种符号的两位小数 */
export function moneyText(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${formatYuanPlain(cents)}`;
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


/** 某渠道允许配置的可见支付方式，与后端 `defaultMethods` 保持一致。 */
export function allowedPaymentMethods(
  providerId: string,
): VisiblePaymentMethod[] {
  if (providerId === 'alipay') return ['alipay'];
  if (providerId === 'wechat') return ['wechat'];
  return ['alipay', 'wechat'];
}

/**
 * 切换实例支持的支付方式。
 *
 * 至少保留一个：服务商实例不绑定任何支付方式时既不能收款，也无法通过后端
 * `normalizePaymentMethods` 的校验。官方渠道的跨渠道选项不在这里静默修正，
 * 而是只允许传入 `allowedPaymentMethods(providerId)` 返回的子集。
 */
export function togglePaymentMethod(
  methods: VisiblePaymentMethod[],
  method: VisiblePaymentMethod,
  allowed: VisiblePaymentMethod[],
): VisiblePaymentMethod[] {
  if (!allowed.includes(method)) return methods;
  if (methods.includes(method)) {
    if (methods.length <= 1) return methods;
    return methods.filter((item) => item !== method);
  }
  return allowed.filter((item) => item === method || methods.includes(item));
}

/** 用变更后的实例列表重建渠道兼容投影，供本地卡片即时更新。 */
export function providerWithInstances(
  provider: AdminPaymentProviderView,
  instances: AdminPaymentProviderInstanceView[],
): AdminPaymentProviderView {
  const sorted = [...instances].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.instanceId.localeCompare(b.instanceId),
  );
  return {
    ...provider,
    instances: sorted,
    enabled: sorted.some((instance) => instance.enabled),
    configured: sorted.some((instance) => instance.configured),
    closeAfterMinutes: sorted[0]?.closeAfterMinutes ?? 30,
    configEnabled: sorted[0]?.enabled ?? false,
    version: sorted[0]?.version ?? null,
    configId: sorted[0]?.configId ?? null,
    values: sorted[0]?.values ?? {},
    secretConfigured: sorted[0]?.secretConfigured ?? {},
    identityLockedFields: sorted[0]?.identityLockedFields ?? [],
    hasOpenOrders: sorted.some((instance) => instance.hasOpenOrders),
    warnings: sorted[0]?.warnings ?? [],
  };
}
