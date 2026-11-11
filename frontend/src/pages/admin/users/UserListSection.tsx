import {
  ActionButton,
  AdminDataTable,
  CheckboxField,
  EmptyState,
  ListError,
  Pagination,
  SelectField,
  SkeletonCards,
  StaleError,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { PAGE_SIZE_OPTIONS } from './constants';
import { formatDateTime } from './utils';
import { UserCard, type UserCardAction } from './UserCard';
import type { AdminUserListResult } from '../../../types/api';
import type { AdminUserRow } from './types';

export type UserListView = 'cards' | 'table';

interface UserListSectionProps {
  data: AdminUserListResult | null;
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  view: UserListView;
  onViewChange: (view: UserListView) => void;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  canBatch: boolean;
  onBatch: (action: 'disable' | 'enable') => void;
  batchBusy: boolean;
  sort: string;
  onSortChange: (sort: string) => void;
  onRetry: () => void;
  onResetFilters: () => void;
  onOpenUser: (id: string) => void;
  actionsFor: (row: AdminUserRow) => UserCardAction[];
  onPageChange: (page: number, pageSize: number) => void;
}

const TABLE_COLUMNS: Array<AdminColumn<AdminUserRow>> = [
  {
    key: 'email',
    title: '邮箱',
    sortable: true,
    render: (row) => (
      <span className="block max-w-[240px] truncate font-medium text-foreground">
        {row.email}
      </span>
    ),
  },
  {
    key: 'name',
    title: '昵称',
    sortable: true,
    render: (row) => (
      <span className="block max-w-[160px] truncate">{row.name}</span>
    ),
  },
  {
    key: 'role',
    title: '角色',
    render: (row) => <StatusTag status={row.role} />,
  },
  {
    key: 'status',
    title: '状态',
    render: (row) => <StatusTag status={row.status} showDot />,
  },
  {
    key: 'projectCount',
    title: '项目',
    align: 'right',
    render: (row) => <span className="tabular-nums">{row.projectCount}</span>,
  },
  {
    key: 'taskCount',
    title: '任务',
    align: 'right',
    render: (row) => <span className="tabular-nums">{row.taskCount}</span>,
  },
  {
    key: 'assetCount',
    title: '素材',
    align: 'right',
    render: (row) => <span className="tabular-nums">{row.assetCount}</span>,
  },
  {
    key: 'createdAt',
    title: '注册时间',
    sortable: true,
    render: (row) => <span className="tabular-nums">{formatDateTime(row.createdAt)}</span>,
  },
  {
    key: 'lastLoginAt',
    title: '最近登录',
    sortable: true,
    render: (row) => (
      <span className="tabular-nums">
        {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : '从未登录'}
      </span>
    ),
  },
];

/** 用户列表的加载、空态、卡片/表格两种视图与分页。 */
export function UserListSection({
  data,
  loading,
  error,
  hasFilter,
  view,
  onViewChange,
  selected,
  onSelectedChange,
  canBatch,
  onBatch,
  batchBusy,
  sort,
  onSortChange,
  onRetry,
  onResetFilters,
  onOpenUser,
  actionsFor,
  onPageChange,
}: UserListSectionProps) {
  const rows = data?.items ?? [];
  const selectableRows = rows.filter((row) => row.status !== 'deleted');
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selected.includes(row.id));
  const someSelected = selectableRows.some((row) => selected.includes(row.id));
  const selectedSet = new Set(selected);

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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {canBatch && selectableRows.length > 0 && (
                <CheckboxField
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onChange={(next) => {
                    onSelectedChange(
                      next ? selectableRows.map((row) => row.id) : [],
                    );
                  }}
                  label="选择本页"
                  size="sm"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">视图</span>
              <ActionButton
                variant={view === 'cards' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => onViewChange('cards')}
                ariaPressed={view === 'cards'}
              >
                卡片
              </ActionButton>
              <ActionButton
                variant={view === 'table' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => onViewChange('table')}
                ariaPressed={view === 'table'}
              >
                表格
              </ActionButton>
            </div>
          </div>

          {canBatch && selected.length > 0 && (
            <div
              data-testid="admin-user-batch-bar"
              className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
            >
              <span className="text-xs font-medium text-foreground">
                已选 {selected.length} 位用户
              </span>
              <span className="text-xs text-muted-foreground">
                单次最多 100 条，逐条返回结果
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <ActionButton
                  size="sm"
                  variant="secondary"
                  disabled={batchBusy}
                  onClick={() => onBatch('enable')}
                >
                  批量启用
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="destructive"
                  disabled={batchBusy}
                  onClick={() => onBatch('disable')}
                >
                  批量禁用
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="ghost"
                  onClick={() => onSelectedChange([])}
                >
                  清除选择
                </ActionButton>
              </div>
            </div>
          )}

          {view === 'cards' ? (
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
                  selectable={canBatch && row.status !== 'deleted'}
                  selected={selectedSet.has(row.id)}
                  onToggleSelected={(next) => {
                    onSelectedChange(
                      next
                        ? [...new Set([...selected, row.id])]
                        : selected.filter((id) => id !== row.id),
                    );
                  }}
                />
              ))}
            </div>
          ) : (
            <AdminDataTable<AdminUserRow>
              rows={rows}
              columns={TABLE_COLUMNS}
              rowKey={(row) => row.id}
              loading={loading}
              error={error}
              onRetry={onRetry}
              sort={sort}
              onSortChange={(next) => onSortChange(next ?? sort)}
              selectable={canBatch}
              selected={selected}
              onSelectedChange={onSelectedChange}
              isRowSelectable={(row) => canBatch && row.status !== 'deleted'}
              rowSelectLabel={(row) => `选择用户 ${row.email}`}
              onRowClick={(row) => onOpenUser(row.id)}
              rowClassName={(row) =>
                row.status === 'disabled' ? 'bg-warn-soft/20' : undefined
              }
              pagination={{
                current: data?.page ?? 1,
                pageSize: data?.pageSize ?? 20,
                total: data?.total ?? 0,
                onChange: onPageChange,
                unit: '位用户',
              }}
              minWidth={960}
            />
          )}

          {view === 'cards' && data && data.total > 0 && (
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
