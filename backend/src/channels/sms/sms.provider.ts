import type { DeliveryResult, MessageProvider, SmsMessage } from '../channel.types';

/**
 * 短信通道契约 —— 与邮件同构。
 *
 * `code` 单独成字段的原因：模板化短信服务商（阿里云/腾讯云）要求验证码
 * 走独立的 templateParam，正文里的数字只是给人看的。两者必须同时给。
 */
export interface SmsProvider extends MessageProvider<SmsMessage> {
  /** 短信签名（如「货觉AI」），控制台实现用于展示，HTTP 实现放入请求体 */
  readonly sign: string;
}

export type { DeliveryResult, SmsMessage };
