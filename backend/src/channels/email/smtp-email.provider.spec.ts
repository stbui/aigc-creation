import { describe, expect, it, vi } from 'vitest';

import { SmtpEmailProvider, type SmtpEmailOptions } from './smtp-email.provider';

const OPTIONS: SmtpEmailOptions = {
  host: 'smtp.163.com',
  port: 465,
  secure: true,
  user: 'sender@163.com',
  password: 'client-auth-code',
  from: 'sender@163.com',
  fromAlias: '货觉AI',
};

describe('SmtpEmailProvider', () => {
  it('sends text and HTML through SMTP with the configured sender identity', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<smtp-message@163.com>' });
    const provider = new SmtpEmailProvider(OPTIONS, { sendMail } as never);

    const result = await provider.send({
      to: 'user@example.com',
      subject: '测试邮件',
      text: '纯文本正文',
      html: '<p>HTML 正文</p>',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: { name: '货觉AI', address: 'sender@163.com' },
      to: 'user@example.com',
      subject: '测试邮件',
      text: '纯文本正文',
      html: '<p>HTML 正文</p>',
    });
    expect(result).toEqual({
      ok: true,
      provider: 'smtp',
      delivered: true,
      messageId: '<smtp-message@163.com>',
    });
  });

  it('turns authentication failures into actionable copy without leaking credentials', async () => {
    const sendMail = vi.fn().mockRejectedValue(
      new Error('535 authentication failed for password client-auth-code'),
    );
    Object.assign(sendMail.mock.results, {});
    const failure = Object.assign(new Error('535 authentication failed'), {
      code: 'EAUTH',
      password: 'client-auth-code',
    });
    sendMail.mockRejectedValue(failure);
    const provider = new SmtpEmailProvider(OPTIONS, { sendMail } as never);

    const result = await provider.send({
      to: 'user@example.com',
      subject: '测试邮件',
      text: '正文',
    });

    expect(result).toMatchObject({
      ok: false,
      provider: 'smtp',
      delivered: false,
      error: expect.stringContaining('客户端授权码'),
    });
    expect(JSON.stringify(result)).not.toContain('client-auth-code');
  });
});
