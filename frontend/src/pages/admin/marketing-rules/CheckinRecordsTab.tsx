import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ActionButton,
  AdminDataTable,
  ClearableField,
  FilterActions,
  FilterBar,
  Panel,
  RefreshButton,
  StaleError,
  formatShanghaiDateTime,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { UserCell } from './UserCell';
import { marketingApi } from './api';
import { useAdminList, useAdminUrlFilterSync } from './hooks';
import { checkinSummaryNote } from './utils';
import type { CheckinRow } from './constants';
import type { AdminCheckinListResult } from '../../../types/api';

/**
 * 签到记录流水（`?tab=checkins`）。
 *
 * 这张表的用途是**发放量对账**：规则页写着「每天 5 分」，实际发出去多少要看
 * 流水。`credits` 与 `streak` 都是发放时刻的快照，之后改规则不会回头改历史行，
 * 所以记录与账本能对上，而不会「规则一改，历史跟着变」。
 */
export function CheckinRecordsTab() {
  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList，首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialUserId = searchParams.get('userId') ?? '';

  const [userId, setUserId] = useState(initialUserId);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      marketingApi.checkins({
        page: params.page as number,
        pageSize: params.pageSize as number,
        userId: params.userId as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminCheckinListResult>(fetcher, { userId: initialUserId || undefined });

  useAdminUrlFilterSync({ userId: params.userId as string | undefined });

  const rows = data?.items ?? [];
  const hasFilter = Boolean(params.userId);

  const applyFilters = () => setQuery({ userId: userId.trim() || undefined });
  const resetFilters = () => {
    setUserId('');
    setQuery({ userId: undefined });
  };

  const columns: Array<AdminColumn<CheckinRow>> = [
    {
      key: 'day',
      title: '签到日期',
      width: 110,
      render: (row) => <span className="tabular-nums">{row.day}</span>,
    },
    {
      key: 'user',
      title: '用户',
      width: 240,
      render: (row) => <UserCell name={row.userName} email={row.userEmail} />,
    },
    {
      key: 'streak',
      title: '连续天数',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.streak} 天</span>,
    },
    {
      key: 'credits',
      title: '本次发放',
      width: 100,
      align: 'right',
      render: (row) =>
        row.credits > 0 ? (
          <span className="font-medium tabular-nums text-brand">+{row.credits}</span>
        ) : (
          /* 0 分是真实结果（当日已达上限或规则为 0），如实显示而不是留白 */
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: 'createdAt',
      title: '记录时间',
      width: 160,
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {formatShanghaiDateTime(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <FilterBar>
        <ClearableField
          className="w-64"
          ariaLabel="按用户 ID 筛选"
          placeholder="用户 ID（完整匹配）"
          value={userId}
          onChange={setUserId}
          onEnter={applyFilters}
        />
        <FilterActions>
          <ActionButton variant="default" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
      </FilterBar>

      <Panel
        title="签到记录"
        note={
          data
            ? `${checkinSummaryNote(data.summary)} · 摘要为全量统计，与积分账本核对用`
            : '每人每天最多一条，重复签到不重复发放'
        }
        extra={<RefreshButton loading={loading} onRefresh={reload} />}
      >
        {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <AdminDataTable<CheckinRow>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={reload}
          minWidth={760}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            unit: '条',
            onChange: setPage,
          }}
          emptyText={
            hasFilter
              ? '没有该用户的签到记录。用户 ID 需完整匹配，可从用户详情页复制。'
              : '还没有签到记录。C 端签到入口上线后，流水会出现在这里。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>
    </>
  );
}
