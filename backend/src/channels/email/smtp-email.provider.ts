import nodemailer, { type Transporter } from 'nodemailer';

import type { DeliveryResult, EmailMessage } from '../channel.types';
import type { EmailProvider } from './email.provider';

export interface SmtpEmailOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  fromAlias?: string;
}

type SmtpTransport = Pick<Transporter, 'sendMail'>;

const SMTP_ERROR_MESSAGES: Record<string, string> = {
  EAUTH: 'SMTP 认证失败，请核对邮箱账号，并使用邮箱服务商生成的客户端授权码而非登录密码。',
  ECONNECTION: '无法连接 SMTP 服务器，请检查服务器地址、端口、SSL/TLS 设置与网络策略。',
  ETIMEDOUT: '连接 SMTP 服务器超时，请检查服务器地址、端口、SSL/TLS 设置与网络策略。',
  ESOCKET: 'SMTP 连接已中断，请检查端口与 SSL/TLS 设置是否匹配。',
  EENVELOPE: 'SMTP 拒绝了发件人或收件人地址，请检查发件地址权限与收件邮箱格式。',
};

/** 错误只保留稳定的错误码，避免把认证命令、凭据或邮件正文带入日志和后台。 */
function smtpErrorText(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code ?? '').trim();
  if (SMTP_ERROR_MESSAGES[code]) return SMTP_ERROR_MESSAGES[code];
  return code
    ? `SMTP 发送失败（${code}）。请检查服务器地址、端口、SSL/TLS 设置与客户端授权码。`
    : 'SMTP 发送失败。请检查服务器地址、端口、SSL/TLS 设置与客户端授权码。';
}

/**
 * 标准 SMTP 发信实现，适用于 163、腾讯企业邮及其他支持 SMTP 的邮箱服务。
 *
 * 163 邮箱使用 SSL 直连：smtp.163.com:465；登录密码必须替换为客户端授权码。
 * 实现固定使用 nodemailer，不自行处理 SMTP 分片、STARTTLS 与认证重试。
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly delivers = true;
  readonly from: string;

  private readonly transporter: SmtpTransport;

  constructor(
    private readonly options: SmtpEmailOptions,
    transporter?: SmtpTransport,
  ) {
    this.from = options.from;
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        auth: {
          user: options.user,
          pass: options.password,
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.options.fromAlias
          ? { name: this.options.fromAlias, address: this.options.from }
          : this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });

      return {
        ok: true,
        provider: this.name,
        delivered: true,
        ...(info.messageId ? { messageId: String(info.messageId) } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        delivered: false,
        error: smtpErrorText(error),
      };
    }
  }
}
