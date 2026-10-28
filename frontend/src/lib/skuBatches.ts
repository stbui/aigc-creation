import type { GalleryItem } from '../hooks/useResultGallery';

export interface SkuBatchGroup {
  /** 批次内部稳定 key；旧任务没有 batchId 时退化为单任务 key */
  id: string;
  batchId?: string;
  label: string;
  items: GalleryItem[];
  cover?: GalleryItem;
  createdAt?: string;
  /** 提交时声明的整批数量；旧任务或部分失败时可能大于实际 items.length。 */
  totalCount: number;
}

function textParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberParam(params: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = Number(params?.[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupLabel(items: GalleryItem[], totalCount: number): string {
  const first = items.find((item) => item.caption)?.caption || 'SKU 图';
  return totalCount > 1 ? `${first} 等 ${totalCount} 款` : first;
}

/**
 * 把同一轮 SKU 生成产生的多个任务聚合成一条历史记录。
 *
 * 后端当前没有批次实体，批次语义由任务的隐藏参数承载：
 * batchId / batchIndex / batchSize。旧任务或非批量任务没有 batchId，
 * 各自作为一条历史，避免把不同提交误合并。
 */
export function groupSkuHistory(items: GalleryItem[]): SkuBatchGroup[] {
  const buckets = new Map<string, { batchId?: string; items: GalleryItem[]; order: number }>();

  items.forEach((item, order) => {
    const batchId = textParam(item.params, 'batchId');
    const id = batchId ? `batch:${batchId}` : `task:${item.id}`;
    const bucket = buckets.get(id);
    if (bucket) bucket.items.push(item);
    else buckets.set(id, { batchId, items: [item], order });
  });

  return Array.from(buckets.entries())
    .map(([id, bucket]) => {
      const ordered = [...bucket.items].sort((a, b) => {
        const indexDiff =
          (numberParam(a.params, 'batchIndex') ?? Number.MAX_SAFE_INTEGER) -
          (numberParam(b.params, 'batchIndex') ?? Number.MAX_SAFE_INTEGER);
        if (indexDiff !== 0) return indexDiff;
        return timestamp(a.createdAt) - timestamp(b.createdAt);
      });
      const createdAt = ordered.reduce<string | undefined>((latest, item) => {
        if (!item.createdAt) return latest;
        return !latest || timestamp(item.createdAt) > timestamp(latest) ? item.createdAt : latest;
      }, undefined);
      const totalCount = Math.max(
        ordered.length,
        ...ordered.map((item) => numberParam(item.params, 'batchSize') ?? 1),
      );
      return {
        id,
        batchId: bucket.batchId,
        label: groupLabel(ordered, totalCount),
        items: ordered,
        cover: ordered.find((item) => item.url) ?? ordered[0],
        createdAt,
        totalCount,
        order: bucket.order,
      };
    })
    .sort((a, b) => {
      const timeDiff = timestamp(b.createdAt) - timestamp(a.createdAt);
      return timeDiff !== 0 ? timeDiff : a.order - b.order;
    })
    .map(({ order: _order, ...group }) => group);
}

export function groupContainsTask(group: SkuBatchGroup, taskId: string): boolean {
  return group.items.some((item) => item.id === taskId);
}
