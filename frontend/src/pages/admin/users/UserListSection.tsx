import {
  ActionButton,
  EmptyState,
  ListError,
  Pagination,
  SelectField,
  SkeletonCards,
  StaleError,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { PAGE_SIZE_OPTIONS } from './constants';
import { UserCard, type UserCardAction } from './UserCard';
import type { AdminUserListResult } from '../../../types/api';
import type { AdminUserRow } from './types';

interface UserListSectionProps {
  data: AdminUserListResult | null;
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  onRetry: () => void;
  onResetFilters: () => void;
  onOpenUser: (id: string) => void;
  actionsFor: (row: AdminUserRow) => UserCardAction[];
  onPageChange: (page: number, pageSize: number) => void;
}

/** 用户卡片列表的加载、空态、网格与分页。 */
export function UserListSection({
  data,
  loading,
  error,
  hasFilter,
  onRetry,
  onResetFilters,
  onOpenUser,
  actionsFor,
  onPageChange,
}: UserListSectionProps) {
  const rows = data?.items ?? [];
  const activeCount = rows.filter((row) => row.status === 'active').length;
  const restrictedCount = rows.filter((row) => row.status !== 'active').length;
  const privilegedCount = rows.filter((row) => row.role !== 'user').length;

  return (
    <>
      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={onRetry} />}

      {loading && rows.length === 0 && (
        <SkeletonCards
          count={8}
          className="mt-0"
          gridClassName="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
        />
      )}

      {error && rows.length === 0 && <ListError error={error} onRetry={onRetry} />}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title={
            hasFilter
              ? '没有符合条件的用户。清除筛选或换一个关键词试试。'
              : '还没有用户。用户注册后会出现在这里。'
          }
          action={
            hasFilter ? (
              <ActionButton variant="secondary" onClick={onResetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
        />
      )}

      {rows.length > 0 && (
        <>
          <div
            data-testid="admin-user-summary"
            className="mb-3 grid grid-cols-4 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card"
          >
            <UserSummaryMetric
              label="当前页用户"
              value={rows.length}
              hint={data ? `共 ${data.total} 位匹配` : undefined}
            />
            <UserSummaryMetric label="正常账号" value={activeCount} hint="本页状态为正常" />
            <UserSummaryMetric
              label="受限账号"
              value={restrictedCount}
              hint="禁用或已注销"
              tone={restrictedCount > 0 ? 'warn' : undefined}
            />
            <UserSummaryMetric label="管理身份" value={privilegedCount} hint="管理员 / 运营 / 财务" />
          </div>

          <div
            data-testid="admin-user-grid"
            className={cn(
              'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4',
              loading && 'opacity-60',
            )}
          >
            {rows.map((row) => (
              <UserCard
                key={row.id}
                user={row}
                onOpen={() => onOpenUser(row.id)}
                actions={actionsFor(row)}
              />
            ))}
          </div>

          {data && data.total > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
              <span className="text-xs text-muted-foreground">
                共 {data.total} 位用户
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  每页
                  <SelectField
                    className="w-[72px]"
                    ariaLabel="每页条数"
                    value={String(data.pageSize)}
                    onChange={(next) => {
                      if (next) onPageChange(1, Number(next));
                    }}
                    options={PAGE_SIZE_OPTIONS}
                  />
                </div>
                <Pagination
                  page={data.page}
                  totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
                  onChange={(page) => onPageChange(page, data.pageSize)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function UserSummaryMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-[18px] font-semibold leading-6 tabular-nums text-foreground',
          tone === 'warn' && 'text-warn-text',
        )}
      >
        {value}
      </span>
      {hint && <span className="truncate text-[12px] leading-4 text-muted-foreground">{hint}</span>}
    </div>
  );
}
