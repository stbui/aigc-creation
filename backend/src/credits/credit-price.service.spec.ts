import { describe, expect, it, vi } from 'vitest';

import { CreditPriceService } from './credit-price.service';

describe('CreditPriceService 限时免费活动容错', () => {
  it('payload 合法但 audience 损坏时按全站免费处理', async () => {
    const prisma = {
      systemSetting: { findMany: vi.fn().mockResolvedValue([]) },
      campaign: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'campaign-broken-audience',
            payload: JSON.stringify({ capabilityIds: ['free_create'] }),
            audience: '{broken-json',
          },
        ]),
      },
      order: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new CreditPriceService(prisma as never);

    await expect(service.freeCampaignIdOf('free_create', 'paid-user')).resolves.toBe(
      'campaign-broken-audience',
    );
    expect(prisma.order.count).not.toHaveBeenCalled();
  });

  it('payload 损坏时跳过活动，不让整批价格读取失败', async () => {
    const prisma = {
      systemSetting: {
        findMany: vi.fn().mockResolvedValue([{ key: 'creditPrice.free_create', value: '12' }]),
      },
      campaign: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'campaign-broken-payload', payload: '{broken-json', audience: '{}' },
        ]),
      },
      order: { count: vi.fn() },
    };
    const service = new CreditPriceService(prisma as never);

    await expect(service.resolve('free_create')).resolves.toBe(12);
    await expect(service.freeCampaignIdOf('free_create')).resolves.toBe('');
  });
});
