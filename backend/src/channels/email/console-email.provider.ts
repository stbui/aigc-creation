import type { DeliveryResult, EmailMessage } from '../channel.types';
import type { EmailProvider } from './email.provider';
import { writeOutbox } from '../console-outbox';

/**
 * 控制台邮件实现 —— 不发网络请求，把正文写进 `logs/outbox/email-<日期>.log`。
 *
 * `delivers` 恒为 false：任何「已发送」的用户提示都必须据此区分真实投递，
 * 否则在没配通道的环境里用户会一直等一封永远不会到的邮件。
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly delivers = false;

  constructor(readonly from: string) {}

  async send(message: EmailMessage): Promise<DeliveryResult> {
    writeOutbox({
      channel: 'email',
      to: message.to,
      subject: message.subject,
      body: message.text,
      provider: this.name,
      at: new Date().toISOString(),
    });
    return { ok: true, provider: this.name, delivered: false };
  }
}
