import type { DeliveryResult, SmsMessage } from '../channel.types';
import type { SmsProvider } from './sms.provider';
import { postJson } from '../http-client';

/**
 * HTTP 短信实现 —— 与服务商网关的中转契约。
 *
 *   POST {SMS_API_URL}
 *   Authorization: Bearer {SMS_API_KEY}
 *   { "phone", "code", "sign", "content", "template" }
 *
 * 为什么把 `code` 和 `content` 都传：模板短信要 code，普通短信要 content；
 * 网关侧按服务商能力二选一，本项目不用为每家厂商写一个 provider。
 */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  readonly delivers = true;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    readonly sign: string,
    private readonly template: string,
  ) {}

  async send(message: SmsMessage): Promise<DeliveryResult> {
    const res = await postJson({
      url: this.apiUrl,
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      body: {
        phone: message.to,
        code: message.code,
        sign: this.sign,
        content: message.text,
        ...(this.template ? { template: this.template } : {}),
      },
    });

    if (!res.ok) {
      return { ok: false, provider: this.name, delivered: false, error: res.error };
    }

    let messageId: string | undefined;
    try {
      const parsed = res.bodyText ? JSON.parse(res.bodyText) : undefined;
      messageId = parsed?.id ?? parsed?.messageId ?? parsed?.data?.id ?? undefined;
    } catch {
      // 非 JSON 的 2xx 仍视为受理
    }

    return { ok: true, provider: this.name, delivered: true, messageId: messageId && String(messageId) };
  }
}
