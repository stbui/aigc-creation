import { describe, expect, it, vi } from 'vitest';

import {
  detachAssetFromTasks,
  detachTaskOutput,
  orderedOutputIds,
  taskOutputReferenceWhere,
} from './task-output-links';

describe('task-output-links', () => {
  it('合并首产出的历史字段与 JSON 多产出并按序去重', () => {
    expect(orderedOutputIds('asset-1', '["asset-2","asset-1","asset-3"]')).toEqual([
      'asset-1',
      'asset-2',
      'asset-3',
    ]);
  });

  it('JSON 损坏时仍保留首产出', () => {
    expect(orderedOutputIds('asset-1', '{bad json')).toEqual(['asset-1']);
  });

  it('移除首产出时提升下一张', () => {
    expect(
      detachTaskOutput(
        { outputAssetId: 'asset-1', outputAssetIds: '["asset-1","asset-2"]' },
        'asset-1',
      ),
    ).toEqual({ outputAssetId: 'asset-2', outputAssetIds: '["asset-2"]' });
  });

  it('移除最后一张产出时返回 null 以便删除任务', () => {
    expect(
      detachTaskOutput(
        { outputAssetId: 'asset-1', outputAssetIds: '["asset-1"]' },
        'asset-1',
      ),
    ).toBeNull();
  });

  it('只更新真实引用并删除已无产出的任务', () => {
    const update = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'task-retain',
        outputAssetId: 'asset-1',
        outputAssetIds: '["asset-1","asset-2"]',
      },
      {
        id: 'task-delete',
        outputAssetId: 'asset-1',
        outputAssetIds: '["asset-1"]',
      },
      {
        id: 'task-false-positive',
        outputAssetId: 'asset-10',
        outputAssetIds: '["asset-10"]',
      },
    ]);

    return expect(
      detachAssetFromTasks(
        { generationTask: { findMany, update, deleteMany } } as never,
        'asset-1',
      ),
    ).resolves.toBe(1).then(() => {
      expect(findMany).toHaveBeenCalledWith({
        where: taskOutputReferenceWhere('asset-1'),
        select: { id: true, outputAssetId: true, outputAssetIds: true },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'task-retain' },
        data: { outputAssetId: 'asset-2', outputAssetIds: '["asset-2"]' },
      });
      expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'task-delete' } });
      expect(update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-false-positive' } }),
      );
    });
  });
});
