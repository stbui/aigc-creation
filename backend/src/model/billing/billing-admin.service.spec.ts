import { describe, expect, it, vi } from 'vitest';
import { BillingAdminService, type ApiLogQuery } from './billing-admin.service';

function serviceWith(apiCallLog: Record<string, ReturnType<typeof vi.fn>>) {
  const prisma = {
    apiCallLog,
    user: { findMany: vi.fn().mockResolvedValue([]) },
    generationTask: { findMany: vi.fn().mockResolvedValue([]) },
    billingOrder: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return new BillingAdminService(prisma as never, {} as never);
}

describe('BillingAdminService 调用记录筛选', () => {
  it('来源与操作会进入列表查询条件', async () => {
    const apiCallLog = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _avg: { durationMs: null }, _count: { _all: 0 } }),
    };
    const service = serviceWith(apiCallLog);
    const query: ApiLogQuery & { source: string; operation: string } = {
      source: 'tool',
      operation: 'image_to_prompt',
    };

    await service.listApiLogs(query);

    const where = { source: 'tool', operation: 'image_to_prompt' };
    expect(apiCallLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(apiCallLog.count).toHaveBeenCalledWith({ where: { ...where, status: 'success' } });
    expect(apiCallLog.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });
});
