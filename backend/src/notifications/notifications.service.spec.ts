import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsService } from './notifications.service';

function createDependencies() {
  const prisma = {
    messageTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const email = {
    sendNotificationEmail: vi.fn(),
  };
  const settings = {
    getBoolean: vi.fn().mockResolvedValue(false),
  };
  const service = new NotificationsService(
    prisma as never,
    email as never,
    settings as never,
  );
  return { service, prisma, email, settings };
}

describe('NotificationsService.notify', () => {
  it('邮件关闭时仍写入站内消息，但不查询收件人也不发邮件', async () => {
    const { service, prisma, email, settings } = createDependencies();

    await service.notify({
      userId: 'user-1',
      type: 'welcome',
      emailEvent: 'welcome',
      fallbackTitle: '欢迎 {name}',
      fallbackBody: '{name}，欢迎加入',
      vars: { name: '小明' },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'welcome',
        title: '欢迎 小明',
        body: '小明，欢迎加入',
      }),
    });
    expect(settings.getBoolean).toHaveBeenCalledWith('email.enabled');
    expect(settings.getBoolean).toHaveBeenCalledWith('email.events.welcome');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(email.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('邮件发送抛异常时不向注册、支付等业务主流程冒泡', async () => {
    const { service, prisma, email, settings } = createDependencies();
    settings.getBoolean.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com', status: 'active' });
    email.sendNotificationEmail.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.notify({
        userId: 'user-1',
        type: 'payment_success',
        emailEvent: 'payment_success',
        fallbackTitle: '支付成功',
        fallbackBody: '订单 {orderNo} 已支付',
        vars: { orderNo: 'P-1001' },
      }),
    ).resolves.toBeUndefined();

    expect(prisma.notification.create).toHaveBeenCalledOnce();
    expect(email.sendNotificationEmail).toHaveBeenCalledOnce();
  });
});

describe('NotificationsService.broadcast', () => {
  let deps: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    deps = createDependencies();
  });

  it('未勾选邮件时不读取邮件配置，只写站内广播', async () => {
    deps.prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', email: 'one@example.com', name: '一号' },
      { id: 'user-2', email: 'two@example.com', name: '二号' },
    ]);
    deps.prisma.notification.createMany.mockResolvedValue({ count: 2 });

    await expect(
      deps.service.broadcast('活动通知', '活动正文', '/packages', false),
    ).resolves.toEqual({
      sent: 2,
      users: 2,
      emailSent: 0,
      emailFailed: 0,
      emailSkipped: 0,
    });

    expect(deps.prisma.notification.createMany).toHaveBeenCalledOnce();
    expect(deps.settings.getBoolean).not.toHaveBeenCalled();
    expect(deps.email.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('逐人发送邮件并分别统计成功、失败、异常和跳过', async () => {
    deps.prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', email: 'one@example.com', name: '一号' },
      { id: 'user-2', email: null, name: '二号' },
      { id: 'user-3', email: 'three@example.com', name: '三号' },
      { id: 'user-4', email: 'four@example.com', name: '四号' },
    ]);
    deps.prisma.notification.createMany.mockResolvedValue({ count: 4 });
    deps.prisma.messageTemplate.findFirst.mockResolvedValue({
      subject: '给 {name} 的活动通知',
      body: '{body}',
    });
    deps.settings.getBoolean.mockResolvedValue(true);
    deps.email.sendNotificationEmail
      .mockResolvedValueOnce({ delivered: true })
      .mockResolvedValueOnce({ delivered: false })
      .mockRejectedValueOnce(new Error('network timeout'));

    await expect(
      deps.service.broadcast('活动通知', '活动正文', '/packages', true),
    ).resolves.toEqual({
      sent: 4,
      users: 4,
      emailSent: 1,
      emailFailed: 2,
      emailSkipped: 1,
    });

    expect(deps.email.sendNotificationEmail).toHaveBeenCalledTimes(3);
    expect(deps.email.sendNotificationEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: 'one@example.com',
        subject: '给 一号 的活动通知',
        text: expect.stringContaining('查看详情：\nhttp://localhost:5100/packages'),
      }),
    );
    expect(deps.email.sendNotificationEmail.mock.calls[0][0]).not.toHaveProperty('cc');
    expect(deps.email.sendNotificationEmail.mock.calls[0][0]).not.toHaveProperty('bcc');
  });
});

describe('NotificationsService.upsertTemplate', () => {
  it('按 code + channel 唯一键维护同编码的站内与邮件模板', async () => {
    const { service, prisma } = createDependencies();
    prisma.messageTemplate.upsert.mockResolvedValue({ id: 'template-1' });

    await service.upsertTemplate({
      code: 'welcome',
      channel: 'email',
      subject: '欢迎',
      body: '你好，{name}',
      enabled: true,
    });

    expect(prisma.messageTemplate.upsert).toHaveBeenCalledWith({
      where: { code_channel: { code: 'welcome', channel: 'email' } },
      update: {
        subject: '欢迎',
        body: '你好，{name}',
        enabled: true,
      },
      create: {
        code: 'welcome',
        channel: 'email',
        subject: '欢迎',
        body: '你好，{name}',
        enabled: true,
      },
    });
  });

  it('拒绝保存缺少安全变量的邮件验证码模板', async () => {
    const { service, prisma } = createDependencies();

    await expect(
      service.upsertTemplate({
        code: 'email_verification',
        channel: 'email',
        subject: '邮箱验证码',
        body: '请查看你的验证码。',
        enabled: true,
      }),
    ).rejects.toThrow('必须保留 {{code}}');

    expect(prisma.messageTemplate.upsert).not.toHaveBeenCalled();
  });

  it('拒绝保存缺少重置链接变量的找回密码模板', async () => {
    const { service, prisma } = createDependencies();

    await expect(
      service.upsertTemplate({
        code: 'password_reset',
        channel: 'email',
        subject: '重置密码',
        body: '请打开重置密码页面。',
        enabled: true,
      }),
    ).rejects.toThrow('必须保留 {{resetUrl}}');

    expect(prisma.messageTemplate.upsert).not.toHaveBeenCalled();
  });
});
