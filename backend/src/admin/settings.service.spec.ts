import { describe, expect, it, vi } from 'vitest';

import { AdminSettingsService } from './settings.service';

function createService() {
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    systemSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const settings = { invalidate: vi.fn() };
  const service = new AdminSettingsService(
    prisma as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, settings, upsert };
}

describe('AdminSettingsService.updateAll 上传格式白名单', () => {
  it('拒绝空白格式列表', async () => {
    const { service, prisma } = createService();

    await expect(
      service.updateAll({ 'upload.allowedTypes': ' , ' }, [], 'tester'),
    ).rejects.toThrow('至少要允许一种文件类型');
    expect(prisma.systemSetting.findMany).not.toHaveBeenCalled();
  });

  it('拒绝后端无法识别的格式', async () => {
    const { service, prisma } = createService();

    await expect(
      service.updateAll({ 'upload.allowedTypes': 'gif' }, [], 'tester'),
    ).rejects.toThrow('不支持的文件类型: gif');
    expect(prisma.systemSetting.findMany).not.toHaveBeenCalled();
  });

  it('把格式别名与重复项归一为稳定落库值', async () => {
    const { service, upsert, settings } = createService();

    const result = await service.updateAll(
      { 'upload.allowedTypes': 'webp,jpeg,jpg,png' },
      [],
      'tester',
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'upload.allowedTypes' },
      create: {
        key: 'upload.allowedTypes',
        value: 'jpg,png,webp',
        updatedBy: 'tester',
      },
      update: {
        value: 'jpg,png,webp',
        updatedBy: 'tester',
      },
    });
    expect(result.changes[0]).toMatchObject({
      key: 'upload.allowedTypes',
      after: 'jpg,png,webp',
      action: 'update',
    });
    expect(settings.invalidate).toHaveBeenCalledOnce();
  });
});
