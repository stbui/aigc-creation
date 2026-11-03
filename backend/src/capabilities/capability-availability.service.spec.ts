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
    {} as never,
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
