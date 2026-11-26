import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES } from './capability.registry';
import { CapabilitiesService } from './capabilities.service';

/**
 * `GET /capabilities` 的 creditCost 是 C 端「按钮价」。
 *
 * 守住的契约：按钮价必须已经叠加当前用户分组的计价倍率 —— 账单按
 * `BillingService.buildDraft` 里的 `access.pricing` 折算实扣，下发少一步倍率
 * 就会让用户看到「10 积分」、实际扣 15。取整方向与计费一致（向上）。
 */

const CREDIT = 1_000_000n;

interface ServiceParams {
  pricingRows?: Array<{
    capabilityId: string;
    billingMode: string;
    unitPriceMicrocredits: bigint;
  }>;
  multiplierBasisPoints?: number;
  freeCampaignIds?: Map<string, string>;
  accessThrows?: boolean;
}

function createService(params: ServiceParams = {}) {
  const accessWith = (multiplierBasisPoints: number) => ({
    pricing: (_currency: string, _keys: string[] = []) => ({
      multiplierBasisPoints: BigInt(multiplierBasisPoints),
    }),
  });
  const memberAccess = accessWith(params.multiplierBasisPoints ?? 10_000);
  const groups = {
    /*
     * 镜像生产委托：`UserGroupService.accessForUser` 对空身份直接返回默认分组
     * （倍率 1.0），有身份才解析会员映射。本服务不替它做决定，也不捕获它抛出的错误。
     */
    systemAccess: vi.fn().mockResolvedValue(accessWith(10_000)),
    accessForUser: vi.fn().mockImplementation((userId?: string) => {
      if (String(userId ?? '').trim() === '') return groups.systemAccess();
      if (params.accessThrows) return Promise.reject(new Error('分组配置损坏'));
      return Promise.resolve(memberAccess);
    }),
  };
  const service = new CapabilitiesService(
    {
      freeCampaignIdsOf: vi.fn().mockResolvedValue(params.freeCampaignIds ?? new Map()),
    } as never,
    { runtimeAll: vi.fn().mockResolvedValue({}) } as never,
    {
      capabilityPricing: { findMany: vi.fn().mockResolvedValue(params.pricingRows ?? []) },
    } as never,
    groups as never,
  );
  return { service, groups };
}

function costOf(items: Array<{ id: string; creditCost: number }>, id: string): number {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`能力清单缺少 ${id}`);
  return item.creditCost;
}

describe('CapabilitiesService.list creditCost', () => {
  it('下发能力清单全量，默认分组按配置价原样给出', async () => {
    const { service } = createService();

    const data = await service.list('user-1');
    expect(data.items).toHaveLength(CAPABILITIES.length);
    // free_create 的定义价 10，默认分组倍率 1.0
    expect(costOf(data.items, 'free_create')).toBe(10);
  });

  it('分组倍率 1.5 时按钮价随之上浮，与实扣同口径', async () => {
    const { service } = createService({ multiplierBasisPoints: 15_000 });

    const data = await service.list('user-1');
    expect(costOf(data.items, 'free_create')).toBe(15);
  });

  it('倍率产生的零头向上取整，标价不会低于实扣', async () => {
    const { service } = createService({ multiplierBasisPoints: 10_001 });

    const data = await service.list('user-1');
    // 10 × 10001/10000 = 10.001 积分 → 展示 11
    expect(costOf(data.items, 'free_create')).toBe(11);
  });

  it('后台售价优先于代码默认价，并同样叠倍率', async () => {
    const { service } = createService({
      pricingRows: [
        {
          capabilityId: 'free_create',
          billingMode: 'fixed_request',
          unitPriceMicrocredits: 4n * CREDIT,
        },
      ],
      multiplierBasisPoints: 25_000,
    });

    const data = await service.list('user-1');
    expect(costOf(data.items, 'free_create')).toBe(10);
  });

  it('命中限时免费时为 0，且不受倍率影响', async () => {
    const { service } = createService({
      multiplierBasisPoints: 25_000,
      freeCampaignIds: new Map([['free_create', 'campaign-1']]),
    });

    const data = await service.list('user-1');
    expect(costOf(data.items, 'free_create')).toBe(0);
  });

  it('匿名身份由分组服务落到默认分组，不误用会员倍率', async () => {
    const { service, groups } = createService({ multiplierBasisPoints: 15_000 });

    const data = await service.list(undefined);
    expect(groups.systemAccess).toHaveBeenCalled();
    expect(costOf(data.items, 'free_create')).toBe(10);
  });

  it('不足 1 积分的价格显示 1，不下探成会被读成免费的 0', async () => {
    const { service } = createService({
      pricingRows: [
        {
          capabilityId: 'free_create',
          billingMode: 'fixed_request',
          unitPriceMicrocredits: 400_000n,
        },
      ],
    });

    const data = await service.list('user-1');
    expect(costOf(data.items, 'free_create')).toBe(1);
  });

  it('分组配置损坏时如实抛错，不回落默认分组冒充 1.0 倍率', async () => {
    const { service, groups } = createService({
      multiplierBasisPoints: 15_000,
      accessThrows: true,
    });

    await expect(service.list('user-1')).rejects.toThrow('分组配置损坏');
    expect(groups.systemAccess).not.toHaveBeenCalled();
  });
});
