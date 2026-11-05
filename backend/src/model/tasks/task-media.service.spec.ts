import { describe, expect, it, vi } from 'vitest';

import { TaskMediaService, generatedOutputStorageKey } from './task-media.service';

const TASK = {
  id: 'task-1',
  projectId: 'project-1',
  ownerId: 'owner-1',
  capability: 'main_image',
  params: '{}',
};

function existingAsset(id = 'asset-existing') {
  return {
    id,
    aigcMeta: JSON.stringify({ labeled: false, metadata: false, visible: false, method: 'api-only' }),
  };
}

function setup(options: { existing?: unknown[]; createError?: unknown } = {}) {
  const prisma = {
    asset: {
      findFirst: vi.fn().mockResolvedValue(options.existing?.shift() ?? null),
      create: options.createError
        ? vi.fn().mockRejectedValue(options.createError)
        : vi
            .fn()
            .mockImplementation(({ data }: { data: { storageKey: string } }) =>
              Promise.resolve({ id: `asset-${data.storageKey}`, ...data }),
            ),
    },
  };
  const provider = {
    backend: 'local',
    put: vi.fn().mockResolvedValue({ key: '', sizeBytes: 10, contentType: 'video/mp4' }),
    url: vi.fn().mockResolvedValue('/uploads/generated.mp4'),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    getActive: vi.fn().mockReturnValue(provider),
  };
  const service = new TaskMediaService(prisma as never, storage as never, {} as never);
  return { service, prisma, provider, storage };
}

const VIDEO_OUTPUT = { buffer: Buffer.from('video'), format: 'video/mp4', durationMs: 1000 };

describe('TaskMediaService 产物落盘', () => {
  it('产出使用任务内确定性 key', async () => {
    const { service, provider, prisma } = setup();

    await expect(service.persist(TASK, [VIDEO_OUTPUT])).resolves.toHaveLength(1);

    expect(provider.put).toHaveBeenCalledWith(
      'generated/task/task-1/output-1.mp4',
      VIDEO_OUTPUT.buffer,
      'video/mp4',
    );
    expect(prisma.asset.create).toHaveBeenCalledOnce();
  });

  it('已登记 Asset 时直接复用，不重复写文件', async () => {
    const { service, provider, prisma } = setup({ existing: [existingAsset()] });

    await expect(service.persist(TASK, [VIDEO_OUTPUT])).resolves.toMatchObject([
      { assetId: 'asset-existing' },
    ]);

    expect(provider.put).not.toHaveBeenCalled();
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it('写文件后建 Asset 失败时清理孤儿文件', async () => {
    const { service, provider } = setup({ createError: new Error('db unavailable') });

    await expect(service.persist(TASK, [VIDEO_OUTPUT])).rejects.toThrow('db unavailable');

    expect(provider.delete).toHaveBeenCalledWith('generated/task/task-1/output-1.mp4');
  });

  it('P2002 并发冲突回查已有 Asset，不删除对方文件', async () => {
    const duplicate = Object.assign(new Error('unique constraint'), { code: 'P2002' });
    const { service, provider, prisma } = setup({ createError: duplicate });
    prisma.asset.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingAsset('asset-concurrent'));

    await expect(service.persist(TASK, [VIDEO_OUTPUT])).resolves.toMatchObject([
      { assetId: 'asset-concurrent' },
    ]);
    expect(provider.delete).not.toHaveBeenCalled();
  });

  it('第二张失败只清理第二张，重试复用第一张', async () => {
    const { service, provider, prisma } = setup();
    const key1 = generatedOutputStorageKey(TASK.id, 0, 'mp4');
    const key2 = generatedOutputStorageKey(TASK.id, 1, 'mp4');
    const saved = new Map<string, { id: string; aigcMeta: string; storageKey: string }>();
    let failSecondWrite = true;

    prisma.asset.findFirst.mockImplementation(({ where }: { where: { storageKey: string } }) =>
      Promise.resolve(saved.get(where.storageKey) ?? null),
    );
    prisma.asset.create.mockImplementation(({ data }: { data: { storageKey: string } }) => {
      const asset = {
        id: `asset-${data.storageKey}`,
        aigcMeta: existingAsset().aigcMeta,
        ...data,
      };
      saved.set(data.storageKey, asset);
      return Promise.resolve(asset);
    });
    provider.put.mockImplementation((key: string) => {
      if (key === key2 && failSecondWrite) {
        failSecondWrite = false;
        return Promise.reject(new Error('object store unavailable'));
      }
      return Promise.resolve({ key, sizeBytes: 10, contentType: 'video/mp4' });
    });

    const outputs = [VIDEO_OUTPUT, { ...VIDEO_OUTPUT, buffer: Buffer.from('video-2') }];
    await expect(service.persist(TASK, outputs)).rejects.toThrow('object store unavailable');
    expect(provider.delete).toHaveBeenCalledWith(key2);
    expect(provider.delete).not.toHaveBeenCalledWith(key1);

    await expect(service.persist(TASK, outputs)).resolves.toHaveLength(2);
    expect(provider.put).toHaveBeenCalledTimes(3);
    expect(prisma.asset.create).toHaveBeenCalledTimes(2);
  });

  it('任务 id 会清洗为安全路径段', () => {
    expect(generatedOutputStorageKey('../a b', 0, 'png')).toBe(
      'generated/task/___a_b/output-1.png',
    );
  });
});
