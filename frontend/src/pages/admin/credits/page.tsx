import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Coins, Trash2 } from 'lucide-react';
import {
  AdminPage,
  ActionButton,
  BatchBar,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  Panel,
  RefreshButton,
  Segmented,
  StatCards,
  StatusTag,
  StaleError,
  type AdminColumn,
  type AppliedFilter,
} from './components';
import { BATCH_DELETE_CONFIRM, BATCH_DELETE_LIMIT, BatchDeleteUsersDialog } from './components';
import { adminCreditsApi, adminUsersApi } from './api';
import { useAdmin, useAdminUrlFilterSync, useCreditDirectory, useToast } from './hooks';
import { adminUserDetailHref, fmtTime } from './utils';
import { CreditDetailDrawer } from './CreditDetailDrawer';
import { BatchAdjustDrawer } from './BatchAdjustDrawer';
import type { AdminCreditRow } from './types';

/**
 * 积分账本 (B-49~B-52)。
 *
 * ## 只增不改的对账基础
 *
 * 余额永远从 `CreditLot` 推导, 流水 (`CreditLedger`) 只追加。所以这里
 * 「余额」与「累计获得/消耗」是两类数: 前者是当前可用 (含已过期扣除),
 * 后者是历史总量。把它们混在一列会让运营以为「余额对不上流水」——
 * 实际上是过期回收与退款扣回不进「累计消耗」。
 *
 * ## 人工调整保留业务依据
 *
 * 积分是可变现资产，单条调整与批量调整都会写入积分流水，并保留调整备注。
 *
 * ## 模块划分
 *
 * - `api.ts` / `hooks.ts` / `utils.ts` / `constants.ts`：接口、数据 hook、
 *   纯函数与选项表；
 * - `CreditDetailDrawer` / `BatchAdjustDrawer`：两个写操作抽屉（CSV 导入 /
 *   导出入口已从本页移除，避免把可变现资产的批量写入再开一条无确认的通道）；
 * - 批量删除账号复用 `components/admin/BatchDeleteUsersDialog` 与
 *   `POST /admin/users/batch`（`action=delete`）：这里删的是**用户**，不是积分
 *   记录 —— 积分只能通过扣减流水调整，余额必须恒等于 Σ 批次剩余；
 * - 本文件只保留页面编排与列表列定义。
 */
export function AdminCreditsPage() {
  const toast = useToast();
  const { can, me } = useAdmin();

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const initialUserId = searchParams.get('userId') ?? '';
  const initialStatus = (searchParams.get('status') as 'normal' | 'deleted' | null) ?? 'normal';

  const [email, setEmail] = useState(initialEmail);
  const [userId, setUserId] = useState(initialUserId);

  const [detail, setDetail] = useState<AdminCreditRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const { data, loading, error, params, setQuery, setPage, reload } = useCreditDirectory(
    initialEmail,
    initialUserId,
    initialStatus,
  );

  const rows = data?.items ?? [];
  /** 当前视图：normal = 未注销（可软注销）；deleted = 已注销（只能物理清除） */
  const status = (params.status as 'normal' | 'deleted' | undefined) ?? 'normal';
  const purging = status === 'deleted';

  /**
   * 勾选的是账户（`userId`），用于批量注销用户。
   *
   * 筛选/翻页后上一屏勾选的 userId 不再与屏幕对应，必须清空：批量注销
   * 是不可逆动作，「以为选的是这一页」是最危险的一种误操作。
   */
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTargets, setDeleteTargets] = useState<AdminCreditRow[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canDeleteUsers = can('user.delete');

  useEffect(() => {
    setSelected([]);
  }, [params]);

  const selectedRows = rows.filter((row) => selected.includes(row.userId));

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    email: params.email as string | undefined,
    userId: params.userId as string | undefined,
    status,
  });

  const confirmDeleteUsers = async () => {
    if (!deleteTargets?.length) return;
    const ids = deleteTargets.map((row) => row.userId);
    // 已注销视图下删除 = 物理清除；正常视图下删除 = 软注销
    const action: 'delete' | 'purge' = purging ? 'purge' : 'delete';
    setDeleting(true);
    try {
      const summary = await adminUsersApi.batch(ids, action, BATCH_DELETE_CONFIRM);
      setDeleteTargets(null);
      setSelected([]);
      // 抽屉里正开着某个被删账号时一起关掉，否则会停在已不存在的数据上
      if (detail && ids.includes(detail.userId)) setDetail(null);
      reload();
      if (summary.failed > 0) {
        const first = summary.results.find((item) => !item.ok)?.message;
        toast.error(
          `批量${purging ? '清除' : '删除'}完成：成功 ${summary.succeeded} 个，失败 ${summary.failed} 个${first ? `（${first}）` : ''}`,
        );
      } else if (purging) {
        toast.success(`已彻底清除 ${summary.succeeded} 个已注销账号`);
      } else {
        toast.success(`已注销 ${summary.succeeded} 个账号，资金记录已匿名保留`);
      }
    } catch (e) {
      // 失败时保留弹框与勾选，便于原样重试
      toast.error(e instanceof Error ? e.message : `批量${purging ? '清除' : '删除'}失败`);
    } finally {
      setDeleting(false);
    }
  };

  const pageSummary = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        balance: acc.balance + r.balance,
        expiring: acc.expiring + r.expiringSoon,
      }),
      { balance: 0, expiring: 0 },
    );
  }, [rows]);

  const hasFilter = Boolean(params.email || params.userId);

  const applyQuery = () => setQuery({ email: email.trim() || undefined, userId: userId.trim() || undefined });

  const reset = () => {
    setEmail('');
    setUserId('');
    setQuery({ email: undefined, userId: undefined });
  };

  const appliedEmail = (params.email as string | undefined) ?? '';
  const appliedUserId = (params.userId as string | undefined) ?? '';
  const appliedChips: AppliedFilter[] = [
    appliedEmail
      ? {
          key: 'email',
          label: `邮箱：${appliedEmail}`,
          onClear: () => {
            setEmail('');
            setQuery({ email: undefined });
          },
        }
      : null,
    appliedUserId
      ? {
          key: 'userId',
          label: `用户 ID：${appliedUserId}`,
          onClear: () => {
            setUserId('');
            setQuery({ userId: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const columns: Array<AdminColumn<AdminCreditRow>> = [
    /*
     * 身份拆成「用户 / 邮箱 / 状态」三列，而不是把昵称、邮箱、cuid 叠进同一个
     * 单元格：叠行会把行高撑到三行，六个数字列纵向留白，扫视时对不齐。
     * · 已注销：后端把 name 写成「已注销用户」、邮箱是 `deleted_<id>@anonymized
     *   .local`，两者都没有区分度也不该和「状态」列重复。用户列改用 ID 前缀做
     *   扫视锚点，邮箱列留空，状态列统一说「已注销」。
     * · 有昵称：用户列给昵称，邮箱列给邮箱。
     * · 无昵称的活跃账号：用户列留空（破折号），邮箱列即身份。
     * 完整 ID 不再占列，改挂邮箱链接的 title 与明细抽屉，需要时悬停或进详情看。
     */
    {
      key: 'user',
      title: '用户',
      width: 130,
      render: (row) =>
        row.status === 'deleted' ? (
          <span className="truncate font-mono text-muted-foreground" title={row.userId}>
            账号 {row.userId.slice(0, 8)}
          </span>
        ) : row.name ? (
          <span className="truncate text-foreground" title={row.name}>
            {row.name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'email',
      title: '邮箱',
      width: 200,
      render: (row) =>
        row.status === 'deleted' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Link
            className="block max-w-[188px] truncate text-radar-ink-950 hover:underline"
            to={adminUserDetailHref(row.userId)}
            title={`${row.email} · ${row.userId}`}
          >
            {row.email}
          </Link>
        ),
    },
    {
      key: 'status',
      title: '状态',
      width: 84,
      render: (row) => <StatusTag status={row.status} showDot />,
    },
    {
      key: 'balance',
      title: '当前余额',
      width: 100,
      align: 'right',
      // 账本里大量账户余额为 0；0 压成次要色，真正有余额的账户才会跳出来
      render: (row) =>
        row.balance > 0 ? (
          <b className="tabular-nums text-foreground">{row.balance}</b>
        ) : (
          <span className="tabular-nums text-muted-foreground">0</span>
        ),
    },
    {
      key: 'expiringSoon',
      title: '30 天内到期',
      width: 104,
      align: 'right',
      render: (row) =>
        row.expiringSoon > 0 ? (
          <span className="tabular-nums font-medium text-warn-text">{row.expiringSoon}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'totalEarned',
      title: '累计获得',
      width: 92,
      align: 'right',
      render: (row) => (
        <span className={row.totalEarned > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground'}>
          {row.totalEarned}
        </span>
      ),
    },
    {
      key: 'totalConsumed',
      title: '累计消耗',
      width: 92,
      align: 'right',
      render: (row) => (
        <span className={row.totalConsumed > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground'}>
          {row.totalConsumed}
        </span>
      ),
    },
    {
      key: 'activeLots',
      title: '有效批次',
      width: 80,
      align: 'right',
      render: (row) => (
        <span className={row.activeLots > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground'}>
          {row.activeLots}
        </span>
      ),
    },
    {
      key: 'nearestExpiry',
      title: '最近到期',
      width: 140,
      render: (row) => <span className="text-muted-foreground">{fmtTime(row.nearestExpiry)}</span>,
    },
    {
      key: 'ops',
      title: '操作',
      width: 80,
      fixed: 'right',
      render: (row) => (
        <ActionButton variant="ghost" size="sm" onClick={() => setDetail(row)}>
          明细
        </ActionButton>
      ),
    },
  ];

  return (
    <AdminPage
      title="积分账本"
      description="余额由批次推导，流水只追加不修改。人工调整会立即改变用户可用余额，并记录调整人、备注与变动。"
      actions={
        can('credit.adjust') ? (
          <ActionButton variant="secondary" icon={Coins} onClick={() => setBatchOpen(true)}>
            批量调整
          </ActionButton>
        ) : undefined
      }
    >

      <StatCards
        columns={3}
        className="mb-3"
        items={[
          { label: '用户总数', value: data?.total ?? '—', hint: '符合当前筛选的账户数' },
          { label: '本页余额合计', value: pageSummary.balance, hint: '仅统计当前页，不是全站总量' },
          {
            label: '本页 30 天内到期',
            value: pageSummary.expiring,
            hint: '到期会被自动回收，用户可能察觉余额下降',
            tone: pageSummary.expiring > 0 ? 'warn' : undefined,
          },
        ]}
      />

      <FilterBar>
        <Segmented
          ariaLabel="账号状态"
          value={status}
          onChange={(next) => setQuery({ status: next })}
          options={[
            { value: 'normal', label: '正常' },
            { value: 'deleted', label: '已注销' },
          ]}
        />
        <ClearableField
          className="w-52"
          ariaLabel="按邮箱筛选"
          placeholder="邮箱"
          value={email}
          onChange={setEmail}
          onEnter={applyQuery}
        />
        <ClearableField
          className="w-52"
          ariaLabel="按用户 ID 筛选"
          placeholder="用户 ID（精确）"
          value={userId}
          onChange={setUserId}
          onEnter={applyQuery}
        />
        <FilterActions>
          <ActionButton variant="default" onClick={applyQuery}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" onClick={reset}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      <Panel
        title="用户积分总览"
        note={
          purging
            ? '已注销账号只能物理清除；有订单 / 流水 / 发票的账号会被拒绝并原样保留'
            : '按注册时间倒序；点击整行查看批次与流水，勾选后可批量注销账号'
        }
        extra={<RefreshButton loading={loading} onRefresh={reload} />}
      >
        {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        {/*
         * 批量动作放在表格上方而不是页面顶部：勾选发生在表内，操作按钮贴着
         * 选择区，视线不用来回跳。删除的是「用户」，不是积分记录 —— 积分只能
         * 通过扣减流水调整（余额必须恒等于 Σ 批次剩余）。
         */}
        <BatchBar count={selectedRows.length} unit="个账户">
          <span
            className={
              selectedRows.length > BATCH_DELETE_LIMIT
                ? 'text-xs font-medium text-destructive'
                : 'text-xs text-muted-foreground'
            }
          >
            {selectedRows.length > BATCH_DELETE_LIMIT
              ? `${purging ? '清除' : '删除'}单次最多 ${BATCH_DELETE_LIMIT} 个账号，请分批处理`
              : purging
                ? '物理清除：删除账号及残量数据，不可恢复；有资金记录的账号会被拒绝'
                : '删除即注销：清空作品、任务、素材与积分批次，资金记录匿名保留'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <ActionButton
              variant="destructive"
              size="sm"
              icon={Trash2}
              disabled={deleting || selectedRows.length > BATCH_DELETE_LIMIT}
              onClick={() => setDeleteTargets(selectedRows)}
            >
              {purging ? '批量清除账号' : '批量删除账号'}
            </ActionButton>
            <ActionButton variant="ghost" size="sm" onClick={() => setSelected([])}>
              清除选择
            </ActionButton>
          </div>
        </BatchBar>

        <AdminDataTable<AdminCreditRow>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.userId}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={reload}
          onRowClick={setDetail}
          selectable={canDeleteUsers}
          selected={selected}
          onSelectedChange={setSelected}
          // 勾选数已由上方 BatchBar 显示，表格底部不再重复一遍
          hideSelectionSummary
          // 正常视图勾选 = 注销；已注销视图勾选 = 物理清除。两种都可勾，只排除自己
          rowSelectable={(row) => row.userId !== me?.id}
          rowSelectLabel={(row) => `选择账户 ${row.email}`}
          minWidth={1100}
          emptyText={
            hasFilter
              ? '没有符合条件的用户。'
              : purging
                ? '没有已注销的账号。'
                : '还没有可查看的用户。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" onClick={reset}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            unit: '个账户',
            onChange: (page, size) => setPage(page, size),
          }}
        />
      </Panel>

      {detail && (
        <CreditDetailDrawer
          user={detail}
          writable={can('credit.adjust')}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            // 抽屉里的余额落在 `detail` 快照上, 只 reload 列表不会让它变 ——
            // 刚调完仍显示旧数字, 会被当成"没生效"
            reload();
            try {
              const res = await adminCreditsApi.list({ userId: detail.userId });
              if (res.items[0]) setDetail(res.items[0]);
            } catch {
              // 刷新失败不影响"本次调整已成功"的结论, 静默即可
            }
          }}
        />
      )}

      <BatchAdjustDrawer
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onDone={() => {
          setBatchOpen(false);
          reload();
        }}
      />

      {deleteTargets && (
        <BatchDeleteUsersDialog
          mode={purging ? 'purge' : 'soft'}
          targets={deleteTargets.map((row) => ({ id: row.userId, email: row.email }))}
          clearedNote={
            purging
              ? '这些已注销账号的残量数据'
              : `积分批次与余额（合计 ${deleteTargets.reduce(
                  (sum, row) => sum + row.balance,
                  0,
                )} 积分）、作品、任务、素材`
          }
          loading={deleting}
          onCancel={() => setDeleteTargets(null)}
          onConfirm={() => void confirmDeleteUsers()}
        />
      )}
    </AdminPage>
  );
}
