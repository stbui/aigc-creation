import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { AdminMembershipPlansService } from './membership-plans.controller';

describe('AdminMembershipPlansService 删除套餐', () => {
  let prisma: Record<string, any>;
  let service: AdminMembershipPlansService;

  beforeEach(() => {
    prisma = {
      membershipPlan: {
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
    };
    service = new AdminMembershipPlansService(
      prisma as never,
      { invalidateUserGroupCatalog: vi.fn() } as never,
    );
  });

  it('套餐不存在返回 404', async () => {
    prisma.membershipPlan.findUnique.mockResolvedValue(null);

    const error = await service.remove('plan-404').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40400);
    expect(prisma.membershipPlan.delete).not.toHaveBeenCalled();
  });

  it('free 套餐由系统内置，拒绝删除', async () => {
    prisma.membershipPlan.findUnique.mockResolvedValue({
      id: 'plan-free',
      code: 'free',
      name: '免费用户',
      _count: { memberships: 0, orders: 0 },
    });

    const error = await service.remove('plan-free').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40001);
    expect(prisma.membershipPlan.delete).not.toHaveBeenCalled();
  });

  it('有会员或订单的套餐拒绝删除并提示改为下架', async () => {
    prisma.membershipPlan.findUnique.mockResolvedValue({
      id: 'plan-pro',
      code: 'pro',
      name: '专业版',
      _count: { memberships: 2, orders: 3 },
    });

    const error = await service.remove('plan-pro').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('请改为下架'),
    });
    expect(prisma.membershipPlan.delete).not.toHaveBeenCalled();
  });

  it('未使用的自建套餐物理删除', async () => {
    prisma.membershipPlan.findUnique.mockResolvedValue({
      id: 'plan-pro',
      code: 'pro',
      name: '专业版',
      _count: { memberships: 0, orders: 0 },
    });
    prisma.membershipPlan.delete.mockResolvedValue({ id: 'plan-pro' });

    await expect(service.remove('plan-pro')).resolves.toEqual({
      id: 'plan-pro',
      code: 'pro',
      name: '专业版',
    });
    expect(prisma.membershipPlan.delete).toHaveBeenCalledWith({ where: { id: 'plan-pro' } });
  });

  it('预检后并发产生会员或订单时，外键错误转为 409', async () => {
    prisma.membershipPlan.findUnique.mockResolvedValue({
      id: 'plan-pro',
      code: 'pro',
      name: '专业版',
      _count: { memberships: 0, orders: 0 },
    });
    prisma.membershipPlan.delete.mockRejectedValue(
      Object.assign(new Error('fk'), { code: 'P2003' }),
    );

    const error = await service.remove('plan-pro').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
  });
});
