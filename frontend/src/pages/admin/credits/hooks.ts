/**
 * 积分账本的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * 约定: `credits/` 下的文件不从 `src/admin-ui/providers` / `src/context` /
 * `src/hooks` 直接取 hook, 一律经由本文件。目录内新增外部 hook 引用时在
 * 这里补一行 re-export。
 *
 * 本文件自己的 `useCreditDirectory` / `useCreditDetail` 只服务积分账本，
 * 与外部 hook 一起从这里出去。
 */

import { useCallback } from 'react';
import { useAdminList, useAdminResource } from '../../../admin-ui/primitives';
import { adminCreditsApi } from './api';
import type {
  AdminCreditLedgerRow,
  AdminCreditListResult,
  AdminCreditLotRow,
} from '../../../types/api';

export {
  useAdminDetailParam,
  useAdminUrlFilterSync,
} from '../../../admin-ui/primitives';
export { useAdminList, useAdminResource };
export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useAdmin } from '../../../context/AdminContext';
export { useDiscardConfirm, useUnsavedGuard } from '../../../hooks/useUnsavedGuard';

/**
 * 用户积分总览列表。
 *
 * 初始化参数来自 URL，首次请求即带筛选；筛选变更由页面通过 `setQuery`
 * 触发，`useAdminList` 负责竞态、失败保留与页码重置。
 */
export function useCreditDirectory(initialEmail: string, initialUserId: string) {
  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminCreditsApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        email: params.email as string | undefined,
        userId: params.userId as string | undefined,
      }),
    [],
  );

  return useAdminList<AdminCreditListResult>(fetcher, {
    email: initialEmail || undefined,
    userId: initialUserId || undefined,
  });
}

/**
 * 单用户的批次 + 流水。
 *
 * 一次拉齐而不是分两次：只看流水看不出「这 30 分是从哪一批扣的」，分两次
 * 加载会让两块停留在不同时刻的数字上。
 */
export function useCreditDetail(
  userId: string,
  filters: { type?: string; from: string; to: string },
) {
  return useAdminResource<[AdminCreditLotRow[], AdminCreditLedgerRow[]]>(
    () =>
      Promise.all([
        adminCreditsApi.lots(userId, {
          from: filters.from || undefined,
          to: filters.to || undefined,
        }),
        adminCreditsApi.ledger(userId, {
          type: filters.type,
          from: filters.from || undefined,
          to: filters.to || undefined,
          limit: 100,
        }),
      ]),
    [userId, filters.type, filters.from, filters.to],
  );
}
