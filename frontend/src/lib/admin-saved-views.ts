/**
 * 后台列表的保存视图。
 *
 * 与侧栏展开态一样属于**本机偏好**：存 `localStorage`，不落库，也不参与
 * 权限判断。内置视图是代码常量，不占用户存储；用户视图只保存筛选字段，
 * 应用时仍走各页原有的 `setQuery` / URL 同步。
 */

export type AdminViewFilters = Record<string, string | undefined>;

export interface AdminSavedView {
  id: string;
  name: string;
  filters: AdminViewFilters;
  /** 内置视图不可删除 */
  builtin?: boolean;
}

const STORAGE_PREFIX = 'huojue.admin.views.';

/**
 * 内置视图。
 *
 * `__me` 在应用时替换为当前后台账号 id；`__24h` 替换为 24 小时前的日期。
 * 用占位符而不是写死值，避免「我处理中」变成某个固定同事、或「近 24h」
 * 永远停在保存那一天。
 */
export const ADMIN_BUILTIN_VIEWS: Record<string, AdminSavedView[]> = {
  tickets: [
    {
      id: 'ticket-open',
      name: '待回复',
      filters: { status: 'open', assigneeId: 'unassigned' },
    },
    {
      id: 'ticket-mine',
      name: '我处理中',
      filters: { status: 'processing', assigneeId: '__me' },
    },
    {
      id: 'ticket-high',
      name: '高优先级',
      filters: { status: 'open', priority: 'high' },
    },
  ],
  tasks: [
    {
      id: 'task-failed-24h',
      name: '近 24h 失败',
      filters: { status: 'failed', from: '__24h' },
    },
    {
      id: 'task-running',
      name: '执行中积压',
      filters: { status: 'running' },
    },
    {
      id: 'task-uncertain',
      name: '结果不明',
      filters: { status: 'failed', errorCode: '42206' },
    },
  ],
  orders: [
    {
      id: 'order-refund-processing',
      name: '退款处理中',
      filters: { refundState: 'processing' },
    },
    {
      id: 'order-pending',
      name: '待支付',
      filters: { status: 'pending' },
    },
  ],
  'billing-orders': [
    {
      id: 'billing-uncertain',
      name: '结果不明',
      filters: { status: 'uncertain' },
    },
  ],
  invoices: [
    {
      id: 'invoice-pending',
      name: '待开具',
      filters: { status: 'pending' },
    },
  ],
};

export function resolveViewFilters(
  filters: AdminViewFilters,
  currentUserId?: string,
): AdminViewFilters {
  const date = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => {
      if (value === '__me') return [key, currentUserId];
      if (value === '__24h') return [key, date];
      return [key, value];
    }),
  );
}

function storageKey(userId: string, pageKey: string): string {
  return `${STORAGE_PREFIX}${userId}.${pageKey}`;
}

export function loadSavedViews(userId: string | undefined, pageKey: string): AdminSavedView[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId, pageKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is AdminSavedView => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<AdminSavedView>;
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.name === 'string' &&
          Boolean(candidate.filters) &&
          typeof candidate.filters === 'object'
        );
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function persistSavedViews(
  userId: string | undefined,
  pageKey: string,
  views: AdminSavedView[],
): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId, pageKey), JSON.stringify(views.slice(0, 20)));
  } catch {
    /* 存不下时只在本次会话生效，不影响筛选 */
  }
}

export function createSavedView(name: string, filters: AdminViewFilters): AdminSavedView {
  return {
    id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 30),
    filters,
  };
}
