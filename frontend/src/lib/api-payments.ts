import type {
  AdminPageResult,
  AdminPaymentProviderView,
  AdminPaymentSettings,
  AdminReconciliationItem,
  AdminReconciliationRun,
  PaymentCurrency,
  PaymentIntent,
  PaymentProviderConfigUpdate,
  PaymentProviderId,
  PaymentProviderInfo,
  PaymentProviderInstanceCreate,
  PaymentSettingsView,
  PaymentSource,
  PaymentStatusResult,
} from "../types/payment";
import { downloadCsv, request, toQuery } from "./api";

/**
 * 支付通道 (B3, 需登录)。
 *
 * 与 `ordersApi.sandboxPay` 的分工: 沙箱仍是站内模拟; 真实通道
 * (支付宝/微信) 走 `intent` 拿跳转地址或二维码, 到账由渠道回调驱动,
 * 前端只负责轮询 `status`。
 *
 * ⚠ 通道未配置凭据时 `intent` 返回 503 —— 界面必须如实提示「支付通道
 * 暂不可用」, 不能回落到沙箱装作成功。
 */
export const paymentsApi = {
  /** C 端支付设置：默认币种 + 该币种下可用渠道（公开） */
  settings: () =>
    request<PaymentSettingsView>("/payments/settings"),

  /**
   * 当前可用支付渠道。
   *
   * 后端在可用渠道 > 1 时要求 `intent` 显式传 providerId；不拉列表就无法
   * 让用户选择，最终只能拿到 400「存在多个可用支付渠道」。
   */
  providers: (currency?: string) => {
    const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
    return request<{ items: PaymentProviderInfo[]; total: number }>(
      `/payments/providers${qs}`,
    );
  },

  intent: (orderId: string, providerId?: string) =>
    request<PaymentIntent>(`/payments/${orderId}/intent`, {
      method: "POST",
      body: providerId ? { providerId } : {},
    }),

  status: (orderId: string) =>
    request<PaymentStatusResult>(`/payments/${orderId}/status`),

  /**
   * 用户主动查单。
   *
   * 与 `status` 共用同一后端结果，但 POST 会绕过状态轮询的 2 秒节流，
   * 用于“我已完成支付”以及渠道同步跳回后的立即确认。
   */
  query: (orderId: string) =>
    request<PaymentStatusResult>(`/payments/${orderId}/query`, {
      method: "POST",
    }),
};

/**
 * 支付域后台 API（`/admin/payments` 四标签页）。
 *
 * 与旧的 `adminPaymentChannelsApi` / `adminReconciliationApi` 是两代模型：
 * 旧版从环境变量读凭据、单一 PAYMENT_PROVIDER、人工导入账单逐笔处置；
 * 新版渠道配置**加密落库并版本化**、多渠道并存、对账由 worker 自动下载并
 * 自动补发。后端旧控制器已删除，故这里只有新契约。
 *
 * 分四组对应四个标签：渠道 / 商品 / 订单 / 对账。
 */

/** 支付渠道与站点设置 */
export const adminPaymentProvidersApi = {
  list: () =>
    request<{ items: AdminPaymentProviderView[] }>("/admin/payments/providers"),

  /**
   * 保存渠道配置（追加新版本，历史订单继续用旧版本）。
   *
   * 高危动作：后端写审计日志，但不要求填写变更原因。
   */
  saveConfig: (providerId: string, body: PaymentProviderConfigUpdate) =>
    request<{ provider: AdminPaymentProviderView; unchanged: boolean }>(
      `/admin/payments/providers/${providerId}/config`,
      { method: "PUT", body },
    ),

  /** 新建实例；instanceId 由服务端生成，默认停用。 */
  createInstance: (
    providerId: string,
    body: PaymentProviderInstanceCreate = {},
  ) =>
    request<{ instance: AdminPaymentProviderView["instances"][number] }>(
      `/admin/payments/providers/${providerId}/instances`,
      { method: "POST", body },
    ),

  /** 保存指定实例；历史订单继续绑定旧 configId。 */
  saveInstance: (
    providerId: string,
    instanceId: string,
    body: PaymentProviderConfigUpdate,
  ) =>
    request<{ provider: AdminPaymentProviderView; unchanged: boolean }>(
      `/admin/payments/providers/${providerId}/instances/${instanceId}/config`,
      { method: "PUT", body },
    ),

  /** 拖拽排序；必须提交当前渠道全部实例 id。 */
  reorderInstances: (providerId: string, instanceIds: string[]) =>
    request<AdminPaymentProviderView>(
      `/admin/payments/providers/${providerId}/instances/order`,
      { method: "PATCH", body: { instanceIds } },
    ),

  settings: () => request<AdminPaymentSettings>("/admin/payments/settings"),

  saveSettings: (body: {
    defaultCurrency: PaymentCurrency;
    alipaySource: PaymentSource;
    wechatSource: PaymentSource;
  }) =>
    request<AdminPaymentSettings>("/admin/payments/settings", {
      method: "PUT",
      body,
    }),
};

/** 充值商品已并入「商品管理」（`/admin/products`），不再有独立接口 */

/**
 * 支付订单动作。
 *
 * 列表与详情已并入「订单管理」（`/admin/orders`）—— 两边读同一张 `Order` 表，
 * 支付域只保留订单页要用的两个写动作。
 */
export const adminPaymentOrdersApi = {
  /** 向渠道查单：已支付则立即入账，否则不动本地状态 */
  query: (id: string) =>
    request<{ order: { id: string; status: string }; view: unknown }>(
      `/admin/payments/orders/${id}/query`,
      { method: "POST" },
    ),

  /**
   * 关单。
   *
   * **不会退款**：关单只停止这笔未支付订单继续挂着；已付款的订单要走退款流程，
   * 退款在订单管理里，不在支付域。
   */
  close: (id: string) =>
    request<{ order: { id: string; status: string }; view: unknown }>(
      `/admin/payments/orders/${id}/close`,
      { method: "POST" },
    ),
};

/** 支付对账 */
export const adminPaymentReconciliationApi = {
  /** 运行列表 */
  list: (
    params: {
      providerId?: string;
      providerInstanceId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<AdminPageResult<AdminReconciliationRun>>(
      `/admin/payments/reconciliations${toQuery(params)}`,
    ),

  /** 差异明细 */
  items: (
    runId: string,
    params: { result?: string; page?: number; pageSize?: number } = {},
  ) =>
    request<AdminPageResult<AdminReconciliationItem>>(
      `/admin/payments/reconciliations/${runId}/items${toQuery(params)}`,
    ),

  /** 手动执行对账（渠道账单下载失败时的重跑入口） */
  run: (body: {
    providerId: PaymentProviderId;
    providerInstanceId: string;
    billDate: string;
  }) =>
    request<{ run: AdminReconciliationRun; reused: boolean }>(
      "/admin/payments/reconciliations",
      {
        method: "POST",
        body,
      },
    ),

  /** CSV 兜底导入（渠道不支持账单下载时用） */
  importCsv: (
    file: File,
    body: {
      providerId: PaymentProviderId;
      providerInstanceId: string;
      billDate: string;
    },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("providerId", body.providerId);
    fd.append("providerInstanceId", body.providerInstanceId);
    fd.append("billDate", body.billDate);
    return request<{ run: AdminReconciliationRun }>(
      "/admin/payments/reconciliations/import",
      {
        method: "POST",
        body: fd,
      },
    );
  },

  exportCsv: (
    params: {
      providerId?: string;
      providerInstanceId?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ) =>
    downloadCsv(`/admin/payments/reconciliations/export.csv${toQuery(params)}`),

  exportItemsCsv: (runId: string, params: { result?: string } = {}) =>
    downloadCsv(
      `/admin/payments/reconciliations/${runId}/items/export.csv${toQuery(params)}`,
    ),
};
