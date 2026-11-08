import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { MarketingService } from './marketing.service';

describe('MarketingService 邀请绑定与奖励幂等', () => {
  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let credit: { grant: ReturnType<typeof vi.fn> };
  let service: MarketingService;

  beforeEach(() => {
    tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'inviter-1' }) },
      inviteRelation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'relation-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      order: { count: vi.fn().mockResolvedValue(0) },
      inviteRewardRule: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    prisma = {
      inviteRewardRule: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (client: Record<string, any>) => unknown) => work(tx)),
    };
    credit = { grant: vi.fn().mockResolvedValue({}) };
    service = new MarketingService(prisma as never, credit as never);
  });

  it('用户行锁先于邀请人和付费记录读取', async () => {
    await expect(
      service.bindInvite({ inviteCode: ' abcd1234 ', inviteeId: 'invitee-1' }),
    ).resolves.toMatchObject({ bound: true, relationId: 'relation-1' });

    expect(tx.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inviteCode: 'ABCD1234' } }),
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.findUnique.mock.invocationCallOrder[0],
    );
  });

  it('已有已支付订单时拒绝补绑邀请码', async () => {
    tx.order.count.mockResolvedValue(1);

    await expect(
      service.bindInvite({ inviteCode: 'ABCD1234', inviteeId: 'invitee-1' }),
    ).resolves.toEqual({ bound: false, reason: 'already_paid' });
    expect(tx.inviteRelation.create).not.toHaveBeenCalled();
  });

  it('已绑定关系不会被覆盖', async () => {
    tx.inviteRelation.findUnique.mockResolvedValue({ id: 'relation-old', rewardStatus: 'granted' });

    await expect(
      service.bindInvite({ inviteCode: 'ABCD1234', inviteeId: 'invitee-1' }),
    ).resolves.toEqual({ bound: false, reason: 'already_bound' });
    expect(tx.inviteRelation.create).not.toHaveBeenCalled();
  });

  it('并发唯一约束冲突按已绑定返回', async () => {
    tx.inviteRelation.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.bindInvite({ inviteCode: 'ABCD1234', inviteeId: 'invitee-1' }),
    ).resolves.toEqual({ bound: false, reason: 'already_bound' });
  });

  it('条件更新抢占 pending 后只发放一次双方奖励', async () => {
    const relation = {
      id: 'relation-1',
      inviterId: 'inviter-1',
      inviteeId: 'invitee-1',
      rewardStatus: 'pending',
    };
    tx.inviteRelation.findUnique.mockResolvedValue(relation);
    tx.inviteRelation.updateMany.mockImplementation(async () => {
      if (relation.rewardStatus !== 'pending') return { count: 0 };
      relation.rewardStatus = 'granted';
      return { count: 1 };
    });
    tx.inviteRewardRule.findUnique.mockResolvedValue({
      valid: true,
      inviterCredits: 20,
      inviteeCredits: 10,
    });

    await expect(service.grantInviteReward('relation-1')).resolves.toEqual({
      granted: true,
      credits: 30,
    });
    await expect(service.grantInviteReward('relation-1')).resolves.toEqual({
      granted: false,
      credits: 0,
    });

    expect(credit.grant).toHaveBeenCalledTimes(2);
    expect(credit.grant).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: 'invite:relation-1:inviter' }),
      tx,
    );
    expect(credit.grant).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: 'invite:relation-1:invitee' }),
      tx,
    );
  });
});

describe('MarketingService 签到幂等与封顶', () => {
  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let credit: { grant: ReturnType<typeof vi.fn> };
  let service: MarketingService;

  beforeEach(() => {
    tx = {
      checkinRecord: {
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'record-1', ...data })),
      },
    };
    prisma = {
      checkinRule: {
        findUnique: vi.fn().mockResolvedValue({
          baseCredits: 5,
          bonusRules: '[]',
          maxStreak: 0,
          dailyCap: 0,
          enabled: true,
        }),
        upsert: vi.fn(),
      },
      checkinRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(async (work: (client: Record<string, any>) => unknown) => work(tx)),
    };
    credit = { grant: vi.fn().mockResolvedValue({}) };
    service = new MarketingService(prisma as never, credit as never);
  });

  it('当天已签到时不再次发放积分', async () => {
    prisma.checkinRecord.findUnique.mockResolvedValue({
      id: 'record-old',
      credits: 5,
      streak: 1,
    });

    await expect(service.checkin('user-1')).resolves.toMatchObject({
      alreadyCheckedIn: true,
      credits: 5,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(credit.grant).not.toHaveBeenCalled();
  });

  it('连续天数达到上限后保持封顶，并按封顶日发放加成', async () => {
    prisma.checkinRule.findUnique.mockResolvedValue({
      baseCredits: 5,
      bonusRules: JSON.stringify([{ day: 2, bonus: 10 }]),
      maxStreak: 2,
      dailyCap: 0,
      enabled: true,
    });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBefore = new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    prisma.checkinRecord.findMany.mockResolvedValue([
      { day: localDay(yesterday) },
      { day: localDay(dayBefore) },
    ]);

    await expect(service.checkin('user-1')).resolves.toMatchObject({
      alreadyCheckedIn: false,
      credits: 15,
      streak: 2,
    });
    expect(credit.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 15,
        idempotencyKey: expect.stringMatching(/^checkin:user-1:/),
      }),
      tx,
    );
  });

  it('重复加成日直接拒绝，不写入规则', async () => {
    await expect(
      service.updateCheckinRule({
        baseCredits: 5,
        bonusRules: [
          { day: 2, bonus: 10 },
          { day: 2, bonus: 20 },
        ],
      }),
    ).rejects.toMatchObject({ code: 40001 });
    expect(prisma.checkinRule.upsert).not.toHaveBeenCalled();
  });
});


describe('MarketingService 优惠券与活动删除', () => {
  let prisma: Record<string, any>;
  let service: MarketingService;

  beforeEach(() => {
    prisma = {
      coupon: {
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
      campaign: {
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
    };
    service = new MarketingService(prisma as never, { grant: vi.fn() } as never);
  });

  it('优惠券没有关联订单时物理删除', async () => {
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'SAVE10',
      name: '立减券',
      _count: { orders: 0 },
    });
    prisma.coupon.delete.mockResolvedValue({ id: 'coupon-1' });

    await expect(service.deleteCoupon('coupon-1')).resolves.toEqual({
      id: 'coupon-1',
      code: 'SAVE10',
      name: '立减券',
    });
    expect(prisma.coupon.delete).toHaveBeenCalledWith({ where: { id: 'coupon-1' } });
  });

  it('优惠券有历史订单时拒绝删除并提示改为停用', async () => {
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'SAVE10',
      name: '立减券',
      _count: { orders: 2 },
    });

    const error = await service.deleteCoupon('coupon-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('请改为停用'),
    });
    expect(prisma.coupon.delete).not.toHaveBeenCalled();
  });

  it('优惠券预检后并发产生订单时，外键错误转为 409', async () => {
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'SAVE10',
      name: '立减券',
      _count: { orders: 0 },
    });
    prisma.coupon.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));

    const error = await service.deleteCoupon('coupon-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
  });

  it('活动没有关联订单时物理删除', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      name: '限时特惠',
      _count: { orders: 0 },
    });
    prisma.campaign.delete.mockResolvedValue({ id: 'campaign-1' });

    await expect(service.deleteCampaign('campaign-1')).resolves.toEqual({
      id: 'campaign-1',
      name: '限时特惠',
    });
    expect(prisma.campaign.delete).toHaveBeenCalledWith({ where: { id: 'campaign-1' } });
  });

  it('活动有历史订单时拒绝删除并提示改为下线', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      name: '限时特惠',
      _count: { orders: 3 },
    });

    const error = await service.deleteCampaign('campaign-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('请改为下线'),
    });
    expect(prisma.campaign.delete).not.toHaveBeenCalled();
  });

  it('活动预检后并发产生订单时，外键错误转为 409', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      name: '限时特惠',
      _count: { orders: 0 },
    });
    prisma.campaign.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));

    const error = await service.deleteCampaign('campaign-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
  });
});

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
