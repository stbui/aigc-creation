import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../common/app.exception';
import { CAPABILITIES } from './capability.registry';
import { CapabilityAvailabilityService } from './capability-availability.service';

function createService(upsert = vi.fn()) {
  const prisma = {
    capabilityControl: { upsert },
  };
  return new CapabilityAvailabilityService(
    prisma as never,
    { hasHealthyLine: async () => false } as never,
    { get: vi.fn(), set: vi.fn(), del: vi.fn().mockResolvedValue(true) } as never,
  );
}

describe('CapabilityAvailabilityService.setEnabled', () => {
  it('未知能力返回明确的 400 业务错误', async () => {
    const service = createService();

    try {
      await service.setEnabled('not-a-capability', true, undefined, 'admin@test.com');
      throw new Error('expected setEnabled to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).getStatus()).toBe(400);
      expect((error as AppError).code).toBe(40001);
    }
  });

  it('下架能力缺少原因时返回 400', async () => {
    const service = createService();

    try {
      await service.setEnabled(CAPABILITIES[0].id, false, '   ', 'admin@test.com');
      throw new Error('expected setEnabled to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).getStatus()).toBe(400);
      expect((error as AppError).message).toBe('下架能力必须填写原因');
    }
  });

  it('数据库异常保持原异常，不伪装成客户端 400', async () => {
    const dbError = Object.assign(new Error('database unavailable'), { code: 'P1001' });
    const upsert = vi.fn().mockRejectedValue(dbError);
    const service = createService(upsert);

    await expect(
      service.setEnabled(CAPABILITIES[0].id, true, undefined, 'admin@test.com'),
    ).rejects.toBe(dbError);
  });
});

describe('CapabilityAvailabilityService.runtimeAll', () => {
  it('一次返回全部能力，并保留每项能力的运行时结论', async () => {
    const prisma = {
      capabilityControl: {
        findMany: vi.fn().mockResolvedValue([
          { capabilityId: CAPABILITIES[0].id, enabled: false, reason: '维护中' },
        ]),
      },
    };
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(true),
    };
    const router = { hasHealthyLine: vi.fn().mockResolvedValue(true) };
    const service = new CapabilityAvailabilityService(
      prisma as never,
      router as never,
      cache as never,
    );

    const runtime = await service.runtimeAll();

    expect(Object.keys(runtime)).toEqual(CAPABILITIES.map((capability) => capability.id));
    expect(runtime[CAPABILITIES[0].id]).toMatchObject({
      enabled: false,
      effective: 'disabled',
      reason: '维护中',
    });
    expect(runtime[CAPABILITIES[1].id]).toMatchObject({
      enabled: true,
      remoteAvailable: true,
      effective: 'remote',
    });
  });
});
