import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ActionButton,
  AdminDataTable,
  ClearableField,
  ConfirmDialog,
  FilterActions,
  FilterBar,
  Panel,
  RefreshButton,
  SelectField,
  StaleError,
  StatusTag,
  formatDateTime,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { marketingApi } from './api';
import { useAdmin, useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import {
  REWARD_STATUS_META,
  REWARD_STATUS_OPTIONS,
  type InviteRow,
  type RewardStatus,
} from './constants';
import { UserCell } from './UserCell';
import { inviteSummaryNote, userLabel } from './utils';
import type { AdminInviteListResult } from '../../../types/api';

/**
 * 邀请关系流水（`?tab=invites`）。
 *
 * 规则表单只回答「奖励是多少」，回答不了「谁邀请了谁、这笔钱发出去了没有」。
 * 运营查的就是这两件事，缺了列表就只能翻数据库。
 *
 * **补发是发积分，不是改营销配置**：后端 `POST /admin/invites/:id/grant` 的权限点
 * 是 `credit.adjust`，所以按钮按那个权限点显示，与本页的 `marketing.write` 无关。
 */
export function InviteRelationsTab() {
  const toast = useToast();
  const { can } = useAdmin();
  const canGrant = can('credit.adjust');

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList，首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('keyword') ?? '';
  const rawStatus = searchParams.get('rewardStatus');
  const initialStatus =
    rawStatus && rawStatus in REWARD_STATUS_META ? (rawStatus as RewardStatus) : undefined;

  const [keyword, setKeyword] = useState(initialKeyword);
  const [rewardStatus, setRewardStatus] = useState<RewardStatus | undefined>(initialStatus);
  const [granting, setGranting] = useState<InviteRow | null>(null);
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      marketingApi.invites({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        rewardStatus: params.rewardStatus as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminInviteListResult>(fetcher, {
      keyword: initialKeyword || undefined,
      rewardStatus: initialStatus,
    });

  // 只同步已生效的筛选，不同步分页；`?tab=` 由 useAdminUrlFilterSync 原样保留
  useAdminUrlFilterSync({
    keyword: params.keyword as string | undefined,
    rewardStatus: params.rewardStatus as string | undefined,
  });

  const rows = data?.items ?? [];
  const hasFilter = Boolean(params.keyword || params.rewardStatus);

  const applyFilters = () => setQuery({ keyword: keyword.trim() || undefined, rewardStatus });
  const resetFilters = () => {
    setKeyword('');
    setRewardStatus(undefined);
    setQuery({ keyword: undefined, rewardStatus: undefined });
  };

  const confirmGrant = async () => {
    if (!granting) return;
    setBusy(true);
    try {
      const res = await marketingApi.grantInviteReward(granting.id);
      toast.success(`已补发邀请奖励 ${res.credits} 积分`);
      setGranting(null);
      // 重新拉取而不是本地改成 granted：摘要与状态列都以服务端为准
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<InviteRow>> = [
    {
      key: 'inviteCode',
      title: '邀请码',
      width: 120,
      render: (row) => <span className="font-mono text-[12px]">{row.inviteCode}</span>,
    },
    {
      key: 'inviter',
      title: '邀请人',
      width: 220,
      render: (row) => <UserCell name={row.inviterName} email={row.inviterEmail} />,
    },
    {
      key: 'invitee',
      title: '被邀请人',
      width: 220,
      render: (row) => <UserCell name={row.inviteeName} email={row.inviteeEmail} />,
    },
    {
      key: 'boundAt',
      title: '绑定时间',
      width: 160,
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{formatDateTime(row.boundAt)}</span>
      ),
    },
    {
      key: 'rewardStatus',
      title: '奖励状态',
      width: 100,
      cellTitle: (row) => REWARD_STATUS_META[row.rewardStatus]?.hint,
      render: (row) => {
        const meta = REWARD_STATUS_META[row.rewardStatus];
        return (
          <StatusTag
            status={row.rewardStatus}
            label={meta?.label ?? row.rewardStatus}
            tone={meta?.tone ?? 'muted'}
          />
        );
      },
    },
    {
      key: 'ops',
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (row) =>
        row.rewardStatus === 'pending' ? (
          canGrant ? (
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setGranting(row)}
            >
              补发奖励
            </ActionButton>
          ) : (
            /* 无权补发时说明差哪个权限，而不是留一个看不懂的空白 */
            <span className="text-[12px] text-muted-foreground">需积分调整权限</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      <FilterBar>
        <ClearableField
          className="w-56"
          ariaLabel="按邀请码或邮箱搜索"
          placeholder="邀请码 / 双方邮箱"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
        />
        <SelectField
          className="w-32"
          ariaLabel="按奖励状态筛选"
          placeholder="全部状态"
          clearLabel="全部状态"
          allowClear
          value={rewardStatus}
          onChange={(value) => setRewardStatus(value as RewardStatus | undefined)}
          options={REWARD_STATUS_OPTIONS}
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
        title="邀请关系"
        note={
          data
            ? `${inviteSummaryNote(data.summary)} · 摘要为全量统计，不随筛选变化`
            : '被邀请人通过邀请码注册后产生一条绑定关系'
        }
        extra={<RefreshButton loading={loading} onRefresh={reload} />}
      >
        {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <AdminDataTable<InviteRow>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={reload}
          minWidth={960}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            unit: '条',
            onChange: setPage,
          }}
          emptyText={
            hasFilter
              ? '没有匹配的邀请关系。清除筛选条件后再试。'
              : '还没有邀请关系。用户在「我的邀请」分享邀请码，对方注册后才会出现在这里。'
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

      <ConfirmDialog
        open={granting !== null}
        title="手动补发邀请奖励"
        description={
          granting
            ? `给「${userLabel(granting.inviterName, granting.inviterEmail)}」与「${userLabel(
                granting.inviteeName,
                granting.inviteeEmail,
              )}」按当前邀请规则发放积分。`
            : undefined
        }
        impact={
          granting
            ? [
                '补发会直接写入积分账本，与后台调整积分同性质',
                '同一条关系只会发放一次，重复请求不会重复加分',
                '奖励金额取当前规则，不是绑定时刻的规则',
              ]
            : undefined
        }
        confirmText="确认补发"
        loading={busy}
        onCancel={() => setGranting(null)}
        onConfirm={() => void confirmGrant()}
      />
    </>
  );
}
