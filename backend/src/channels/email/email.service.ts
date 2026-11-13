import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { DeliveryResult, EmailMessage } from '../channel.types';
import { maskEmail } from '../channel.types';
import type { EmailProvider } from './email.provider';
import { ConsoleEmailProvider } from './console-email.provider';
import { HttpEmailProvider } from './http-email.provider';
import { AliyunEmailProvider } from './aliyun-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';
import { escapeHtml, renderTemplate } from '../template';
import { SettingsService } from '../../common/settings.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface EmailChannelStatus {
  /** 总开关。关闭时验证码、找回密码和业务通知都不会真实投递。 */
  enabled: boolean;
  /** 实际选中的实现。配置不完整时会如实回落到 console。 */
  provider: string;
  /** 是否真实投递；console 恒为 false。 */
  delivers: boolean;
  from: string;
  /** 当前 provider 所需配置是否完整。 */
  configured: boolean;
  /** 面向运营的状态说明，不含地址、正文或任何凭据。 */
  message?: string;
}

interface ResolvedEmailConfig {
  enabled: boolean;
  provider: EmailProvider;
  providerName: string;
  from: string;
  configured: boolean;
  message?: string;
}

const DEFAULT_FROM = 'noreply@huojue.local';

const DEFAULT_EMAIL_VERIFICATION_BODY = [
  '你的货觉AI邮箱验证码是：{{code}}',
  '',
  '验证码 {{expiresMinutes}} 分钟内有效，仅可使用一次。',
  '如果不是你本人操作，请忽略本邮件。',
  '',
  '—— 货觉AI 团队',
].join('\n');

const DEFAULT_PASSWORD_RESET_BODY = [
  '{{name}}，你好：',
  '',
  '我们收到了重置货觉AI账号密码的请求。请在 {{expiresMinutes}} 分钟内打开下面的链接设置新密码：',
  '',
  '{{resetUrl}}',
  '',
  '如果不是你本人操作，请忽略本邮件，你的密码不会被修改。',
  '请求来源 IP：{{ip}}',
  '',
  '—— 货觉AI 团队',
].join('\n');

function textSetting(value: unknown): string {
  return String(value ?? '').trim();
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * 邮件门面。
 *
 * 每次发送都从运行时设置解析配置，后台改完立即生效；只有 provider 选择
 * `env` 时才沿用 EMAIL_PROVIDER 等环境变量。真实通道配置不完整时回落到
 * console 而不是拖垮主流程，但 status/send 会明确标记「未真实投递」。
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const status = await this.status();
      if (status.delivers) {
        this.logger.log(`邮件通道: ${status.provider}（真实投递）`);
      } else {
        this.logger.warn(`邮件通道: ${status.provider}（不会真实投递）${status.message ? `：${status.message}` : ''}`);
      }
    } catch (error) {
      // 邮件是可选通道，状态探测失败不应阻断应用启动。
      this.logger.warn(`邮件通道状态读取失败: ${(error as Error).message}`);
    }
  }

  async status(): Promise<EmailChannelStatus> {
    const config = await this.resolveConfig();
    return {
      enabled: config.enabled,
      provider: config.providerName,
      delivers: config.provider.delivers,
      from: config.from,
      configured: config.configured,
      ...(config.message ? { message: config.message } : {}),
    };
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    try {
      const config = await this.resolveConfig();
      if (!config.enabled) {
        return {
          ok: false,
          provider: 'disabled',
          delivered: false,
          error: '邮件通知已关闭，请先启用并保存配置。',
        };
      }

      if (!config.configured) {
        const error = config.message || '邮件投递配置不完整，请补全后重试。';
        this.logger.warn(`邮件未投递 ${maskEmail(message.to)}: ${error}`);
        return {
          ok: false,
          provider: config.providerName,
          delivered: false,
          error,
        };
      }

      // 生产环境不允许把写本地 outbox 当成用户已收到邮件。
      if (process.env.NODE_ENV === 'production' && !config.provider.delivers) {
        const error = '生产环境尚未配置可实际发送的邮件通道，邮件未投递。';
        this.logger.error(`邮件未投递 ${maskEmail(message.to)}: ${error}`);
        return {
          ok: false,
          provider: config.providerName,
          delivered: false,
          error,
        };
      }

      const result = await config.provider.send(message);
      if (!result.ok) {
        this.logger.warn(
          `邮件投递失败 ${maskEmail(message.to)} provider=${result.provider} error=${result.error ?? 'unknown'}`,
        );
      }
      return result;
    } catch (error) {
      // 邮件失败绝不能把注册、支付、任务等主流程变成失败。
      this.logger.error(`邮件通道异常 ${maskEmail(message.to)}: ${(error as Error).message}`);
      return {
        ok: false,
        provider: 'unknown',
        delivered: false,
        error: (error as Error).message,
      };
    }
  }

  /** 后台测试邮件。返回真实投递结果，不把 console 的结果伪装成已送达。 */
  async sendTestEmail(to: string): Promise<DeliveryResult> {
    return this.sendNotificationEmail({
      to,
      subject: '【货觉AI】邮件通道测试',
      text: [
        '这是一封来自货觉AI后台的测试邮件。',
        '',
        '如果你收到本邮件，说明当前发件地址与投递通道可以正常工作。',
        '',
        '—— 货觉AI',
      ].join('\n'),
    });
  }

  async sendNotificationEmail(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<DeliveryResult> {
    const subject = String(input.subject || '通知').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    const text = String(input.text || '').trim() || subject;
    const html = input.html || this.plainTextHtml(text);
    return this.send({
      to: String(input.to || '').trim(),
      subject,
      text,
      html,
    });
  }

  /**
   * 密码重置邮件。
   *
   * 正文里只放一次性链接，不放邮箱等账号资料；昵称与 IP 在 HTML 中必须转义。
   */
  async sendPasswordReset(params: {
    to: string;
    name: string;
    resetUrl: string;
    expiresMinutes: number;
    ip?: string;
  }): Promise<DeliveryResult> {
    const vars = {
      name: params.name || '用户',
      resetUrl: params.resetUrl,
      expiresMinutes: params.expiresMinutes,
      ip: params.ip || '未知',
      year: new Date().getFullYear(),
    };
    const template = await this.loadEmailTemplate('password_reset');
    const subject = renderTemplate(template?.subject || '【货觉AI】重置密码', vars);
    const text = renderTemplate(template?.body || DEFAULT_PASSWORD_RESET_BODY, vars);
    return this.sendNotificationEmail({
      to: params.to,
      subject,
      text,
    });
  }

  /** 邮箱归属验证码。正文只含验证码和有效期，不携带账号资料。 */
  async sendEmailVerification(params: {
    to: string;
    code: string;
    expiresMinutes: number;
  }): Promise<DeliveryResult> {
    const code = String(params.code).replace(/[^0-9]/g, '').slice(0, 6);
    const vars = { code, expiresMinutes: params.expiresMinutes };
    const template = await this.loadEmailTemplate('email_verification');
    const subject = renderTemplate(template?.subject || '【货觉AI】邮箱验证码', vars);
    const text = renderTemplate(template?.body || DEFAULT_EMAIL_VERIFICATION_BODY, vars);
    return this.sendNotificationEmail({
      to: params.to,
      subject,
      text,
    });
  }

  /** 安全邮件模板同样支持后台修改；读取失败或未配置时使用内置文案。 */
  private async loadEmailTemplate(code: string) {
    try {
      return await this.prisma.messageTemplate.findFirst({
        where: { code, channel: 'email', enabled: true },
      });
    } catch (error) {
      this.logger.warn(`安全邮件模板读取失败 (${code}): ${(error as Error).message}`);
      return null;
    }
  }

  private async resolveConfig(): Promise<ResolvedEmailConfig> {
    const all = await this.settings.getAll();
    const enabled = all['email.enabled'] === true;
    const mode = textSetting(all['email.provider']) || 'env';
    const envMode = mode === 'env';
    const wanted = (envMode ? process.env.EMAIL_PROVIDER || 'console' : mode).toLowerCase();

    const settingFrom = textSetting(all['email.from']);
    const fromAlias = textSetting(all['email.fromAlias']) || textSetting(process.env.ALIYUN_DM_FROM_ALIAS);
    const apiUrl = textSetting(all['email.httpApiUrl']) || textSetting(process.env.EMAIL_API_URL);
    const apiKey = (await this.settings.getSecret('email.httpApiKey')) || textSetting(process.env.EMAIL_API_KEY);
    const accessKeyId =
      (await this.settings.getSecret('email.aliyunAccessKeyId')) ||
      textSetting(process.env.ALIYUN_ACCESS_KEY_ID);
    const accessKeySecret =
      (await this.settings.getSecret('email.aliyunAccessKeySecret')) ||
      textSetting(process.env.ALIYUN_ACCESS_KEY_SECRET);
    const accountName =
      textSetting(all['email.aliyunDmAccountName']) || textSetting(process.env.ALIYUN_DM_ACCOUNT_NAME);
    const addressType =
      textSetting(all['email.aliyunDmAddressType']) || textSetting(process.env.ALIYUN_DM_ADDRESS_TYPE) || '1';

    const smtpHost = envMode
      ? textSetting(process.env.EMAIL_SMTP_HOST)
      : textSetting(all['email.smtpHost']) || textSetting(process.env.EMAIL_SMTP_HOST);
    const smtpPort = envMode
      ? Number(process.env.EMAIL_SMTP_PORT || 465)
      : Number(all['email.smtpPort'] ?? process.env.EMAIL_SMTP_PORT ?? 465);
    const smtpSecure = envMode
      ? booleanSetting(process.env.EMAIL_SMTP_SECURE, true)
      : booleanSetting(all['email.smtpSecure'], booleanSetting(process.env.EMAIL_SMTP_SECURE, true));
    const smtpUser = envMode
      ? textSetting(process.env.EMAIL_SMTP_USER)
      : textSetting(all['email.smtpUser']) || textSetting(process.env.EMAIL_SMTP_USER);
    const smtpPassword = envMode
      ? textSetting(process.env.EMAIL_SMTP_PASSWORD)
      : (await this.settings.getSecret('email.smtpPassword')) ||
        textSetting(process.env.EMAIL_SMTP_PASSWORD);
    const from = settingFrom || textSetting(process.env.EMAIL_FROM) || smtpUser || DEFAULT_FROM;

    if (wanted === 'smtp') {
      const validPort = Number.isInteger(smtpPort) && smtpPort >= 1 && smtpPort <= 65535;
      if (!smtpHost || !smtpUser || !smtpPassword || !validPort) {
        return {
          enabled,
          provider: new ConsoleEmailProvider(from),
          providerName: 'console',
          from,
          configured: false,
          message: 'SMTP 服务器、端口、账号或客户端授权码尚未配置，请补全后重试。',
        };
      }
      return {
        enabled,
        provider: new SmtpEmailProvider({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          user: smtpUser,
          password: smtpPassword,
          from,
          fromAlias,
        }),
        providerName: 'smtp',
        from,
        configured: true,
        message: enabled ? 'SMTP 邮箱已配置' : '邮件通知已关闭。',
      };
    }

    if (wanted === 'http') {
      if (!apiUrl) {
        return {
          enabled,
          provider: new ConsoleEmailProvider(from),
          providerName: 'console',
          from,
          configured: false,
          message: '邮件接口地址尚未配置，请补全后重试。',
        };
      }
      return {
        enabled,
        provider: new HttpEmailProvider(apiUrl, apiKey, from),
        providerName: 'http',
        from,
        configured: true,
        message: enabled ? '自定义邮件接口已配置' : '邮件通知已关闭。',
      };
    }

    if (wanted === 'aliyun') {
      if (!accessKeyId || !accessKeySecret || !accountName) {
        return {
          enabled,
          provider: new ConsoleEmailProvider(from),
          providerName: 'console',
          from,
          configured: false,
          message: '阿里云 AccessKey 或发信地址尚未配置，请补全后重试。',
        };
      }
      return {
        enabled,
        provider: new AliyunEmailProvider(accessKeyId, accessKeySecret, accountName, fromAlias, addressType),
        providerName: 'aliyun-dm',
        from: accountName,
        configured: true,
        message: enabled ? '阿里云邮件推送已配置' : '邮件通知已关闭。',
      };
    }

    return {
      enabled,
      provider: new ConsoleEmailProvider(from),
      providerName: 'console',
      from,
      configured: true,
      message: enabled ? '当前为本地记录模式，邮件不会实际发送。' : '邮件通知已关闭。',
    };
  }

  private plainTextHtml(text: string): string {
    const paragraphs = escapeHtml(text)
      .split(/\n{2,}/)
      .map((part) => `<p style="margin:0 0 14px;line-height:1.7">${part.replace(/\n/g, '<br>')}</p>`)
      .join('');
    return [
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#171a2b">',
      paragraphs,
      '<p style="color:#86909c;font-size:12px;margin-top:24px">—— 货觉AI 团队</p>',
      '</div>',
    ].join('');
  }
}
