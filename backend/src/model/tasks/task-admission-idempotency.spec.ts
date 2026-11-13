import { describe, expect, it, vi } from 'vitest';

import { generationRequestFingerprint, TaskAdmissionService } from './task-admission.service';

const DTO = {
  projectId: 'project-1',
  capability: 'main_image',
  modelKey: 'model-1',
  inputAssetIds: ['asset-1', 'asset-2'],
  params: { prompt: '商品图', options: { ratio: '1:1', quality: 'high' } },
};

function setup(existing: Record<string, unknown> | null) {
  const prisma = {
    generationTask: { findUnique: vi.fn().mockResolvedValue(existing) },
  };
  const service = new TaskAdmissionService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('TaskAdmissionService 请求指纹幂等', () => {
  it('同幂等键、同内容返回原任务', async () => {
    const fingerprint = generationRequestFingerprint(DTO);
    const { service, prisma } = setup({
      id: 'task-1',
      status: 'queued',
      creditCost: 8,
      params: JSON.stringify({ batchId: 'batch-1', batchSize: 2 }),
      requestFingerprint: fingerprint,
    });

    await expect(
      service.admit({ ownerId: 'user-1', dto: { ...DTO, idempotencyKey: 'idem-key-1' } as never }),
    ).resolves.toEqual({
      taskId: 'task-1',
      status: 'queued',
      creditCost: 16,
      idempotentHit: true,
      batchId: 'batch-1',
      batchSize: 2,
    });
    expect(prisma.generationTask.findUnique).toHaveBeenCalledOnce();
  });

  it('params 对象 key 顺序变化仍视为同一请求', async () => {
    const fingerprint = generationRequestFingerprint({
      ...DTO,
      params: { options: { quality: 'high', ratio: '1:1' }, prompt: '商品图' },
    });
    const { service } = setup({
      id: 'task-1',
      status: 'queued',
      creditCost: 8,
      params: '{}',
      requestFingerprint: fingerprint,
    });

    await expect(
      service.admit({ ownerId: 'user-1', dto: { ...DTO, idempotencyKey: 'idem-key-2' } as never }),
    ).resolves.toMatchObject({ idempotentHit: true, taskId: 'task-1' });
  });

  it.each([
    ['参数', { ...DTO, params: { ...DTO.params, prompt: '另一张图' } }],
    ['模型', { ...DTO, modelKey: 'model-2' }],
    ['素材顺序', { ...DTO, inputAssetIds: ['asset-2', 'asset-1'] }],
  ])('%s不同时拒绝复用幂等键', async (_label, changed) => {
    const { service } = setup({
      id: 'task-1',
      status: 'queued',
      creditCost: 8,
      params: '{}',
      requestFingerprint: generationRequestFingerprint(DTO),
    });

    await expect(
      service.admit({ ownerId: 'user-1', dto: { ...changed, idempotencyKey: 'idem-key-3' } as never }),
    ).rejects.toMatchObject({ code: 40900, status: 409 });
  });

  it('旧任务没有请求指纹时拒绝猜测并要求换键', async () => {
    const { service } = setup({
      id: 'task-1',
      status: 'queued',
      creditCost: 8,
      params: '{}',
      requestFingerprint: null,
    });

    await expect(
      service.admit({ ownerId: 'user-1', dto: { ...DTO, idempotencyKey: 'idem-key-4' } as never }),
    ).rejects.toMatchObject({ code: 40900, status: 409, message: expect.stringContaining('旧任务') });
  });
});
