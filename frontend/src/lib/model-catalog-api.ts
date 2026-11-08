import { request } from "./api";
import type {
  ModelIntentPayload,
  ModelQuoteView,
  PublicChannelView,
  PublicModelCatalogResult,
} from "../types/model";
import type { PublicLogicalModel } from "./models";

/** 前台模型目录（产品视角，`/models*`） */
export const modelsApi = {
  list: () => request<{ models: PublicLogicalModel[] }>("/models"),

  available: (intent: ModelIntentPayload) =>
    request<{ models: PublicLogicalModel[] }>("/models/available", {
      method: "POST",
      body: intent,
    }),

  quote: (id: string, intent: ModelIntentPayload) =>
    request<{ quote: ModelQuoteView }>(`/models/${id}/quote`, {
      method: "POST",
      body: intent,
    }),
};

/**
 * 渠道模型目录（供应视角，`/model-catalog*`）。
 *
 * `models` 恒为空数组，模型在 `channels[].models` 内；渠道名恒为空串，
 * 前端统一显示「系统模型」。报价必须带 `channelId` + `modelKey` ——
 * 不同渠道的同名模型价格与协议都可能不同，不接受按 modelKey 全局搜索。
 */
export const modelCatalogApi = {
  catalog: () => request<PublicModelCatalogResult>("/model-catalog"),

  available: (intent: ModelIntentPayload) =>
    request<PublicModelCatalogResult>("/model-catalog/available", {
      method: "POST",
      body: intent,
    }),

  quote: (channelId: string, modelKey: string, intent: ModelIntentPayload) =>
    request<{ quote: ModelQuoteView }>("/model-catalog/quote", {
      method: "POST",
      body: { ...intent, channelId, modelKey },
    }),
};

/**
 * 公开的系统渠道连接信息（`/channels/system`）。
 *
 * 与 `/model-catalog` 的分工：目录给「有哪些模型、什么价」，本端点给
 * 「有哪些渠道、怎么连（中转入口）」。两者都不下发凭证与上游地址。
 *
 * 管理员走同一端点拿到后台视角（真实名称与上游地址），因此返回类型用
 * `PublicChannelView` 的宽松基线：非管理员视角下 `name` 恒为空串。
 */
export const publicChannelsApi = {
  system: () => request<{ channels: PublicChannelView[] }>("/channels/system"),
};
