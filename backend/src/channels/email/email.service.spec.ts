import { describe, expect, it, vi } from 'vitest';

import { EmailService } from './email.service';

function createService(template: Record<string, unknown> | null = null) {
  const prisma = {
    messageTemplate: {
      findFirst: vi.fn().mockResolvedValue(template),
    },
  };
  const settings = {
    getAll: vi.fn(),
    getSecret: vi.fn(),
  };
  const service = new EmailService(settings as never, prisma as never);
  const send = vi.spyOn(service, 'send').mockResolvedValue({
    ok: true,
    provider: 'console',
    delivered: true,
  });
  return { service, prisma, send };
}

describe('EmailService security email templates', () => {
  it('uses the configured email verification template', async () => {
    const { service, prisma, send } = createService({
      subject: '验证码 {{code}}',
      body: '你的验证码是 {{code}}，{{expiresMinutes}} 分钟内有效。',
    });

    await service.sendEmailVerification({
      to: 'user@example.com',
      code: '482916',
      expiresMinutes: 10,
    });

    expect(prisma.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { code: 'email_verification', channel: 'email', enabled: true },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: '验证码 482916',
        text: '你的验证码是 482916，10 分钟内有效。',
      }),
    );
  });

  it('uses the configured password reset template', async () => {
    const { service, send } = createService({
      subject: '{{name}}，请重置密码',
      body: '请在 {{expiresMinutes}} 分钟内打开 {{resetUrl}}',
    });

    await service.sendPasswordReset({
      to: 'user@example.com',
      name: '小明',
      resetUrl: 'https://www.example.com/reset-password?token=example',
      expiresMinutes: 30,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: '小明，请重置密码',
        text: '请在 30 分钟内打开 https://www.example.com/reset-password?token=example',
      }),
    );
  });

  it('falls back to built-in copy when template lookup fails', async () => {
    const { service, prisma, send } = createService();
    prisma.messageTemplate.findFirst.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.sendEmailVerification({
        to: 'user@example.com',
        code: '482916',
        expiresMinutes: 10,
      }),
    ).resolves.toMatchObject({ ok: true, delivered: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '【货觉AI】邮箱验证码',
        text: expect.stringContaining('482916'),
      }),
    );
  });
});


describe('EmailService SMTP configuration', () => {
  function createSmtpService(password: string) {
    const settings = {
      getAll: vi.fn().mockResolvedValue({
        'email.enabled': true,
        'email.provider': 'smtp',
        'email.from': '',
        'email.fromAlias': '货觉AI',
        'email.smtpHost': 'smtp.163.com',
        'email.smtpPort': 465,
        'email.smtpSecure': true,
        'email.smtpUser': 'sender@163.com',
      }),
      getSecret: vi.fn().mockResolvedValue(password),
    };
    const prisma = { messageTemplate: { findFirst: vi.fn() } };
    return new EmailService(settings as never, prisma as never);
  }

  it('reports a complete 163 SMTP channel and falls back to the SMTP account as sender', async () => {
    const service = createSmtpService('client-auth-code');

    await expect(service.status()).resolves.toMatchObject({
      enabled: true,
      provider: 'smtp',
      delivers: true,
      configured: true,
      from: 'sender@163.com',
    });
  });

  it('does not claim delivery when the SMTP authorization code is missing', async () => {
    const service = createSmtpService('');

    await expect(service.status()).resolves.toMatchObject({
      enabled: true,
      provider: 'console',
      delivers: false,
      configured: false,
      message: expect.stringContaining('客户端授权码'),
    });
  });
});
