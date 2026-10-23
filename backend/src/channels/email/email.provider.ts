import type { DeliveryResult, EmailMessage, MessageProvider } from '../channel.types';

/**
 * 邮件通道契约。
 *
 * 实现只需关心「怎么把一条消息发出去」，重试/超时/日志由实现自己负责，
 * 选择哪个实现由 `EmailService` 依据 `EMAIL_PROVIDER` 决定。
 */
export interface EmailProvider extends MessageProvider<EmailMessage> {
  /** 发件人地址（控制台实现用于展示，HTTP 实现放入请求体） */
  readonly from: string;
}

export type { DeliveryResult, EmailMessage };
