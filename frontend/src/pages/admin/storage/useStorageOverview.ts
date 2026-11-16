import { adminAssetsApi, adminStorageApi } from './api';
import { useAdminResource } from './hooks';
import type { StorageOverview } from './types';

/**
 * 存储页的唯一取数入口：后端状态 + 容量统计并行拉取。
 *
 * 容量统计复用素材域 `GET /admin/assets/stats`（后台唯一的容量事实源），
 * 不在存储域另写一份聚合 —— 两处 groupBy 迟早和素材管理页的数字对不上。
 *
 * 存储页只要求 setting.read；没有 asset.read 时不发统计请求，避免整页 403。
 * 权限由页面从 `useAdmin()` 传入，取数 hook 自身不再重复读 context。
 */
export function useStorageOverview(canReadAssets: boolean) {
  const { data, loading, error, reload } = useAdminResource<StorageOverview>(async () => {
    const [status, stats] = await Promise.all([
      adminStorageApi.status(),
      canReadAssets ? adminAssetsApi.stats() : Promise.resolve(null),
    ]);
    return { status, stats };
  });

  return { data, loading, error, reload };
}
