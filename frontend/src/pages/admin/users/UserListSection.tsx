import { Grid3x3, List, Trash2 } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  CheckboxField,
  EmptyState,
  ExportCsvButton,
  ListError,
  Pagination,
  SelectField,
  SegmentedGroup,
  SkeletonCards,
  StaleError,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { BATCH_DELETE_LIMIT } from '~/components/admin/BatchDeleteUsersDialog';
import { BATCH_STATUS_LIMIT, PAGE_SIZE_OPTIONS, SORT_OPTIONS } from './constants';
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
  /** 批量启停的目标由列表决定（已剔除自己与已注销账号），不读页面上的原始勾选 */
  onBatch: (action: 'disable' | 'enable', ids: string[]) => void;
  canBatchDelete: boolean;
  onBatchDelete: (rows: AdminUserRow[]) => void;
  batchBusy: boolean;
  /** 当前登录的管理员 id：自己不可被删除，也不进批量删除的候选集 */
  selfId?: string | null;
  sort: string;
  onSortChange: (sort: string) => void;
  canExport: boolean;
  exporting: boolean;
  onExport: () => void;
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
  canBatchDelete,
  onBatchDelete,
  batchBusy,
  selfId,
  sort,
  onSortChange,
  canExport,
  exporting,
  onExport,
  onRetry,
  onResetFilters,
  onOpenUser,
  actionsFor,
  onPageChange,
}: UserListSectionProps) {
  const rows = data?.items ?? [];
  // 已注销的账号没有可再删除/禁用的对象；自己不能被自己注销，选进来只会
  // 在批量里固定失败一条，因此两者都不进候选集。
  const selectableRows = rows.filter(
    (row) => row.status !== 'deleted' && row.id !== selfId,
  );
  const canSelect = canBatch || canBatchDelete;
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selected.includes(row.id));
  const someSelected = selectableRows.some((row) => selected.includes(row.id));
  const selectedSet = new Set(selected);
  const selectedRows = selectableRows.filter((row) => selectedSet.has(row.id));
  const deleteOverLimit = selectedRows.length > BATCH_DELETE_LIMIT;
  const batchHint = [
    canBatch ? `启停最多 ${BATCH_STATUS_LIMIT} 条` : null,
    canBatchDelete ? `删除最多 ${BATCH_DELETE_LIMIT} 条` : null,
  ]
    .filter(Boolean)
    .join('，');

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
              {canSelect && selectableRows.length > 0 && (
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
            {/*
             * 排序 / 导出 / 视图同属「列表怎么呈现」，原来排序导出独占一行、
             * 视图再占一行。合并到这一行后，左「选择本页」右「排序·导出·视图」，
             * 少一层工具栏，首屏能多露出一行卡片。视图切换复用素材页同一个
             * `SegmentedGroup`：自带图标、选中态与读屏语义，不再手写两个
             * `aria-pressed` 按钮和「视图」文字标签。
             */}
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <span className="text-xs text-muted-foreground">排序</span>
              <SelectField
                className="w-32"
                ariaLabel="用户排序"
                value={sort}
                onChange={(value) => {
                  if (value) onSortChange(value);
                }}
                options={SORT_OPTIONS}
              />
              {canExport && (
                <ExportCsvButton
                  exporting={exporting}
                  onExport={onExport}
                  ariaLabel={exporting ? '正在导出用户 CSV' : '导出用户 CSV'}
                />
              )}
              <span className="mx-1.5 h-4 w-px bg-border" aria-hidden />
              <SegmentedGroup
                ariaLabel="切换视图"
                value={view}
                onChange={(next) => onViewChange(next as UserListView)}
                options={[
                  {
                    value: 'cards',
                    label: (
                      <span className="inline-flex items-center gap-1" title="卡片视图">
                        <Grid3x3 className="size-3.5" aria-hidden />
                        卡片
                      </span>
                    ),
                  },
                  {
                    value: 'table',
                    label: (
                      <span className="inline-flex items-center gap-1" title="表格视图">
                        <List className="size-3.5" aria-hidden />
                        表格
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          {canSelect && selectedRows.length > 0 && (
            <div
              data-testid="admin-user-batch-bar"
              className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
            >
              <span className="text-xs font-medium text-foreground">
                已选 {selectedRows.length} 位用户
              </span>
              <span
                className={cn(
                  'text-xs',
                  canBatchDelete && deleteOverLimit
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {canBatchDelete && deleteOverLimit
                  ? `删除单次最多 ${BATCH_DELETE_LIMIT} 个账号，请分批处理`
                  : batchHint}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {canBatch && (
                  <>
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      disabled={batchBusy}
                      onClick={() =>
                        onBatch('enable', selectedRows.map((row) => row.id))
                      }
                    >
                      批量启用
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      disabled={batchBusy}
                      onClick={() =>
                        onBatch('disable', selectedRows.map((row) => row.id))
                      }
                    >
                      批量禁用
                    </ActionButton>
                  </>
                )}
                {canBatchDelete && (
                  <ActionButton
                    size="sm"
                    variant="destructive"
                    icon={Trash2}
                    disabled={batchBusy || deleteOverLimit}
                    onClick={() => onBatchDelete(selectedRows)}
                  >
                    批量删除
                  </ActionButton>
                )}
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
                  selectable={canSelect && row.status !== 'deleted' && row.id !== selfId}
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
              selectable={canSelect}
              selected={selected}
              onSelectedChange={onSelectedChange}
              isRowSelectable={(row) =>
                canSelect && row.status !== 'deleted' && row.id !== selfId
              }
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
