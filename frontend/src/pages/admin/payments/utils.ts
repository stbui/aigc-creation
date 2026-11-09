import type { AdminPaymentProviderView, PaymentConfigField } from '../../../types/payment';
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

/** 渠道当前是否「可发起支付」：必填齐全且已启用。 */
export function providerReady(
  provider: AdminPaymentProviderView,
  draftValues: Record<string, string>,
): boolean {
  if (!provider.enabled) return false;
  return (
    missingRequiredLabels(
      provider.configFields,
      draftValues,
      provider.secretConfigured,
    ).length === 0
  );
}

/**
 * 渠道的**阻断项**判定。
 *
 * 「能不能收钱」的条件不止「必填项齐全」一条。后端 `PaymentOrderService`
 * 在发起支付时会因为下列任一情况抛 503：
 *   · 必填项缺失（`validateConfig` 不通过）
 *   · 真实渠道缺回调公网地址（`publicBaseUrl` 与 `PAYMENT_NOTIFY_BASE` 都没配）
 *   · 生产环境缺 `PAYMENT_SECRET_KEY`（凭据无法解密）
 *
 * 后端已经把这些情况写进了 `provider.warnings`（`level: 'danger'`），所以
 * **以它为准**，而不是前端自己重推一遍规则 —— 前端重推的规则一定会和后端
 * 漂移（后端加一条判定，前端的「可用」就成了假话）。
 *
 * 这里只做一件事：把 danger 告警翻译成「这个渠道现在收不了钱」。
 */
export function providerBlockingIssues(
  provider: AdminPaymentProviderView,
): string[] {
  return provider.warnings
    .filter((w) => w.level === 'danger')
    .map((w) => w.message);
}

/**
 * 渠道的可运营状态。
 *
 * 判据是「能不能收钱」，不是「开关开没开」：
 *   · 开关开 + 无阻断项 → usable（能收钱）
 *   · 开关开 + 有阻断项 → misconfigured（**正在报错**：发起支付 503）
 *   · 开关关 + 凭据缺 → unconfigured（启用前要补齐）
 *   · 开关关 + 凭据齐 → disabled（随时可开）
 *
 * 开关与凭据必须分开看：只看 `enabled` 会把「开关开了但收不了钱」显示成
 * 绿色可用，运营照着页面去收款时才撞上 503。
 *
 * 阻断项取自后端 danger 告警（见 {@link providerBlockingIssues}），不靠前端
 * 复刻后端规则 —— 复刻出来的口径迟早与后端不一致，而不一致的方向永远是
 * 前端显示「可用」、实际收不到钱。
 */
export function providerState(
  provider: AdminPaymentProviderView,
): PaymentProviderState {
  const configured =
    missingRequiredLabels(
      provider.configFields,
      provider.values,
      provider.secretConfigured,
    ).length === 0;

  if (!provider.enabled) return configured ? 'disabled' : 'unconfigured';

  // 开关开着：后端报了 danger 就说明收不了钱（缺必填项 / 缺回调地址 / 缺密钥）
  if (providerBlockingIssues(provider).length > 0) return 'misconfigured';
  return configured ? 'usable' : 'misconfigured';
}

/**
 * 渠道缺失的必填项**标签**（不是字段名）。
 *
 * 直接用 `provider.missing`（后端给的字段名）会把 `merchantPrivateKey` 这种
 * 内部字段名暴露给运营。页面上要的是「应用私钥（PEM）」这种人话。
 */
export function providerMissingLabels(
  provider: AdminPaymentProviderView,
): string[] {
  return missingRequiredLabels(
    provider.configFields,
    provider.values,
    provider.secretConfigured,
  );
}
