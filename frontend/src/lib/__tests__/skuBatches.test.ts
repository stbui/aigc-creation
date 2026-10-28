import { describe, expect, it } from 'vitest';
import { groupContainsTask, groupSkuHistory } from '../skuBatches';
import type { GalleryItem } from '../../hooks/useResultGallery';

function item(id: string, caption: string, params: Record<string, unknown>, createdAt = '2026-10-27T10:00:00.000Z'): GalleryItem {
  return {
    id,
    caption,
    url: `/uploads/${id}.png`,
    createdAt,
    params,
  };
}

describe('groupSkuHistory', () => {
  it('把同一 batchId 的任务聚合为一组并按 batchIndex 排序', () => {
    const groups = groupSkuHistory([
      item('task-b', 'SKU 蓝', { batchId: 'batch-1', batchIndex: 2, batchSize: 2 }, '2026-10-27T10:00:02.000Z'),
      item('task-a', 'SKU 白', { batchId: 'batch-1', batchIndex: 1, batchSize: 2 }, '2026-10-27T10:00:01.000Z'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].batchId).toBe('batch-1');
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['task-a', 'task-b']);
    expect(groups[0].label).toBe('SKU 白 等 2 款');
    expect(groupContainsTask(groups[0], 'task-b')).toBe(true);
  });

  it('没有 batchId 的旧任务保持独立历史', () => {
    const groups = groupSkuHistory([
      item('legacy-1', 'SKU 1', {}),
      item('legacy-2', 'SKU 2', {}),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.items.length === 1)).toBe(true);
  });

  it('按最新批次时间排序，同时保留组内 SKU 顺序', () => {
    const groups = groupSkuHistory([
      item('old', '旧批次', { batchId: 'old-batch' }, '2026-10-26T10:00:00.000Z'),
      item('new-2', '新款 B', { batchId: 'new-batch', batchIndex: 2 }, '2026-10-27T10:00:02.000Z'),
      item('new-1', '新款 A', { batchId: 'new-batch', batchIndex: 1 }, '2026-10-27T10:00:01.000Z'),
    ]);

    expect(groups.map((group) => group.batchId)).toEqual(['new-batch', 'old-batch']);
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['new-1', 'new-2']);
  });
});
