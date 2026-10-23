import type { DeliveryResult, EmailMessage } from '../channel.types';
import type { EmailProvider } from './email.provider';
import { postJson } from '../http-client';

/**
 * HTTP 邮件实现 —— 走服务商的 JSON API（Resend / SendGrid / 自建中转均可）。
 *
 * 通用契约（本项目定义的唯一标准，服务商适配放在网关侧）：
 *   POST {EMAIL_API_URL}
 *   Authorization: Bearer {EMAIL_API_KEY}
 *   { "from", "to", "subject", "text", "html" }
 *   成功: 2xx；响应体里 `id` / `messageId` / `data.id` 任一存在即作为消息号
 *
 * 为什么不自建 SMTP：SMTP 需要处理 STARTTLS 分片、认证重试与退信解析，
 * 手写风险远高于「HTTP POST 一个 JSON」；而所有主流邮件服务商都提供
 * HTTP API，SMTP 反而是那条更麻烦的路。
 */
export class HttpEmailProvider implements EmailProvider {
  readonly name = 'http';
  readonly delivers = true;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<DeliveryResult> {
    const res = await postJson({
      url: this.apiUrl,
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      body: {
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      },
    });

    if (!res.ok) {
      return { ok: false, provider: this.name, delivered: false, error: res.error };
    }

    let messageId: string | undefined;
    try {
      const parsed = res.bodyText ? JSON.parse(res.bodyText) : undefined;
      messageId =
        parsed?.id ?? parsed?.messageId ?? parsed?.data?.id ?? parsed?.data?.messageId ?? undefined;
    } catch {
      // 服务商返回非 JSON（如纯文本 ok）不算失败：2xx 已说明受理
    }

    return { ok: true, provider: this.name, delivered: true, messageId: messageId && String(messageId) };
  }
}
