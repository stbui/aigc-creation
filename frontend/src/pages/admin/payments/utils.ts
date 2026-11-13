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

/** 收款通道展示名：自定义名优先；技术编号不直接暴露给运营。 */
export function instanceLabel(
  instance: Pick<AdminPaymentProviderInstanceView, 'instanceId' | 'name'>,
): string {
  const name = instance.name?.trim();
  if (name) return name;
  return instance.instanceId === 'default' ? '默认通道' : '未命名通道';
}

/**
 * 后端告警 → 运营提示。
 *
 * 告警仍以后端判定为唯一事实源，但展示层不能把字段名、环境变量、HTTP 状态码
 * 直接丢给运营。已知告警给出明确影响与下一步；未知告警保留业务描述，只做基础
 * 技术词清洗，避免未来新增告警时整段信息丢失。
 */
export function paymentWarningText(message: string): string {
  const text = message.trim();
  if (!text) return '通道配置存在待处理问题，请联系技术同事确认。';
  if (text.startsWith('实例已启用但缺少必填项：')) {
    return '通道已启用，但接入信息尚未补齐，客户付款会失败。请先补齐必填项。';
  }
  if (text.includes('未配置回调公网地址')) {
    return '通道已启用，但回调公网地址尚未准备好，客户付款会失败。请先补齐回调地址。';
  }
  if (text.includes('PAYMENT_SECRET_KEY')) {
    return '支付安全配置尚未完成，通道当前无法收款。请联系技术同事处理。';
  }
  if (text.includes('生产环境仍启用沙箱渠道')) {
    return '当前为生产环境，沙箱通道不会产生真实资金流转。上线前请停用该通道。';
  }
  if (text.includes('存在未完成订单引用当前实例')) {
    return '当前有未完成订单使用此通道；保存调整不会影响这些订单的查单与退款。';
  }

  return text
    .replace(/PAYMENT_[A-Z_]+/g, '支付安全配置')
    .replace(/发起支付会返回 503/g, '客户付款会失败')
    .replace(/当前实例/g, '当前通道')
    .replace(/\b实例\b/g, '通道');
}

/**
 * 接入字段说明去技术化。
 *
 * 字段是否必填、如何取值仍由后端适配器定义；这里只把环境变量名、内部接口路径
 * 等实现细节换成运营能理解的配置结果，不改动任何校验或提交值。
 */
export function paymentConfigDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;
  return description
    .replace(/留空使用 PAYMENT_NOTIFY_BASE/g, '留空使用系统统一的回调地址')
    .replace(
      /适配器自动拼接 \/mapi\.php 与 \/api\.php/g,
      '系统会自动拼接支付接口路径',
    )
    .replace(
      /会自动拼接 \/api\/createOrder 与 \/api\/getOrder/g,
      '系统会自动拼接下单与查单接口路径',
    )
    .replace(/；?文档取值：.*$/g, '');
}

/** 单个通道的阻断项；文案已在展示层转为运营口径。 */
export function instanceBlockingIssues(
  instance: Pick<AdminPaymentProviderInstanceView, 'warnings'>,
): string[] {
  return instance.warnings
    .filter((warning) => warning.level === 'danger')
    .map((warning) => paymentWarningText(warning.message));
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

/** 渠道下所有通道的 danger 告警（去重，使用运营口径）。 */
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
  if (source === 'unset') return { ok: false, reason: '尚未选择收款来源' };

  const providerId = source === 'official' ? method : 'epay';
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    return {
      ok: false,
      reason: `尚未开通${source === 'official' ? '官方' : '易支付'}收款来源`,
    };
  }
  if (!provider.supportedCurrencies.includes(currency)) {
    return { ok: false, reason: `${provider.name}暂不支持当前结算币种 ${currency}` };
  }
  if (provider.instances.length === 0) {
    return { ok: false, reason: `${provider.name}尚未添加收款通道` };
  }

  const candidates = provider.instances.filter((instance) =>
    instance.paymentMethods.includes(method),
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: `${provider.name}没有通道支持${method === 'alipay' ? '支付宝' : '微信支付'}`,
    };
  }
  const enabled = candidates.filter((instance) => instance.enabled);
  if (enabled.length === 0) {
    return {
      ok: false,
      reason: `${provider.name}没有已启用的${method === 'alipay' ? '支付宝' : '微信支付'}收款通道`,
    };
  }
  const configured = enabled.filter((instance) => instance.configured);
  if (configured.length === 0) {
    return { ok: false, reason: `${provider.name}的收款通道尚未准备完成` };
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
