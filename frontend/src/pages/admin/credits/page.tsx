import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import {
  AdminPage,
  ActionButton,
  BatchBar,
  ExportCsvButton,
  useAdminExport,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  Panel,
  RefreshButton,
  StatCards,
  StatusTag,
  StaleError,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import {
  BATCH_DELETE_CONFIRM,
  BATCH_DELETE_LIMIT,
  BatchDeleteUsersDialog,
} from '~/components/admin/BatchDeleteUsersDialog';
import { adminCreditsApi, adminUsersApi } from './api';
import { useAdmin, useAdminUrlFilterSync, useCreditDirectory, useToast } from './hooks';
import { adminUserDetailHref, fmtTime } from './utils';
import { CreditDetailDrawer } from './CreditDetailDrawer';
import { BatchAdjustDrawer } from './BatchAdjustDrawer';
import { CsvImportDrawer } from './CsvImportDrawer';
import type { AdminCreditRow } from '../../../types/api';

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
 * 积分是可变现资产，单条调整、批量调整与导入都会写入积分流水，并保留调整备注。
 *
 * ## 模块划分
 *
 * - `api.ts` / `hooks.ts` / `utils.ts` / `constants.ts`：接口、数据 hook、
 *   纯函数与选项表；
 * - `CreditDetailDrawer` / `BatchAdjustDrawer` / `CsvImportDrawer`：三个写操作抽屉；
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

  const [email, setEmail] = useState(initialEmail);
  const [userId, setUserId] = useState(initialUserId);

  const [detail, setDetail] = useState<AdminCreditRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { exporting, runExport } = useAdminExport(toast);

  const { data, loading, error, params, setQuery, setPage, reload } = useCreditDirectory(initialEmail, initialUserId);

  const rows = data?.items ?? [];

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
  });

  const confirmDeleteUsers = async () => {
    if (!deleteTargets?.length) return;
    const ids = deleteTargets.map((row) => row.userId);
    setDeleting(true);
    try {
      const summary = await adminUsersApi.batch(ids, 'delete', BATCH_DELETE_CONFIRM);
      setDeleteTargets(null);
      setSelected([]);
      // 抽屉里正开着某个被删账号时一起关掉，否则会停在已不存在的数据上
      if (detail && ids.includes(detail.userId)) setDetail(null);
      reload();
      if (summary.failed > 0) {
        const first = summary.results.find((item) => !item.ok)?.message;
        toast.error(
          `批量删除完成：成功 ${summary.succeeded} 个，失败 ${summary.failed} 个${first ? `（${first}）` : ''}`,
        );
      } else {
        toast.success(`已注销 ${summary.succeeded} 个账号，资金记录已匿名保留`);
      }
    } catch (e) {
      // 失败时保留弹框与勾选，便于原样重试
      toast.error(e instanceof Error ? e.message : '批量删除失败');
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

  /**
   * 导出走**已生效**的筛选, 而不是输入框里的草稿 ——
   * 用户输入后未点「查询」时, 导出的必须与屏幕上的列表同口径。
   */
  const exportCsv = () =>
    runExport(
      () =>
        adminCreditsApi.exportCsv({
          email: params.email as string | undefined,
          userId: params.userId as string | undefined,
        }),
      '导出已开始下载',
    );

  const columns: Array<AdminColumn<AdminCreditRow>> = [
    {
      key: 'user',
      title: '用户',
      width: 230,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-foreground">
            {row.name || row.email}
            {/* 注销账号仍留在账本里（历史可查），但不能再被删除，标出来省得运营反复试 */}
            {row.status === 'deleted' ? <StatusTag status="deleted" showDot /> : null}
          </span>
          <span className="text-muted-foreground">
            <Link className="text-brand hover:underline" to={adminUserDetailHref(row.userId)}>
              {row.email}
            </Link>
            {row.name ? '' : ' · 无昵称'}
          </span>
          <code className="text-muted-foreground" title={row.userId}>
            {row.userId}
          </code>
        </div>
      ),
    },
    {
      key: 'balance',
      title: '当前余额',
      width: 110,
      align: 'right',
      render: (row) => <b className="tabular-nums">{row.balance}</b>,
    },
    {
      key: 'expiringSoon',
      title: '30 天内到期',
      width: 120,
      align: 'right',
      render: (row) =>
        row.expiringSoon > 0 ? (
          <span className="tabular-nums text-warn-text">{row.expiringSoon}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'totalEarned',
      title: '累计获得',
      width: 100,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.totalEarned}</span>,
    },
    {
      key: 'totalConsumed',
      title: '累计消耗',
      width: 100,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.totalConsumed}</span>,
    },
    {
      key: 'activeLots',
      title: '有效批次',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.activeLots}</span>,
    },
    {
      key: 'nearestExpiry',
      title: '最近到期',
      width: 160,
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
          <>
            <ActionButton variant="secondary" icon={Upload} onClick={() => setBatchOpen(true)}>
              批量调整
            </ActionButton>
            {/* CSV 导入走邮箱而非用户 ID: 运营手里的补偿名单通常是邮箱表, 不是 cuid */}
            {/* 后端 /admin/credits/import 的权限点是 credit.adjust（导入会改余额，
                与人工调整同一套规则）。权限跟动作走：导入属于给钱，统一要求
                credit.adjust，不再使用无效的通用导入权限。 */}
            <ActionButton variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
              导入 CSV
            </ActionButton>
          </>
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
        note="按注册时间倒序；点击整行查看批次与流水，勾选后可批量删除账号"
        extra={
          <>
            {can('data.export') && <ExportCsvButton exporting={exporting} onExport={exportCsv} />}
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        {/*
         * 批量动作放在表格上方而不是页面顶部：勾选发生在表内，操作按钮贴着
         * 选择区，视线不用来回跳。删除的是「用户」，不是积分记录 —— 积分只能
         * 通过扣减流水调整（余额必须恒等于 Σ 批次剩余）。
         */}
        <BatchBar count={selectedRows.length} unit="个账户">
          <span className="text-xs text-muted-foreground">
            {selectedRows.length > BATCH_DELETE_LIMIT
              ? `删除单次最多 ${BATCH_DELETE_LIMIT} 个账号，请分批处理`
              : '删除即注销：清空作品、任务、素材与积分批次，资金记录匿名保留'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <ActionButton
              variant="destructive"
              size="sm"
              disabled={deleting || selectedRows.length > BATCH_DELETE_LIMIT}
              onClick={() => setDeleteTargets(selectedRows)}
            >
              批量删除账号
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
          isRowSelectable={(row) => row.status !== 'deleted' && row.userId !== me?.id}
          rowSelectLabel={(row) => `选择账户 ${row.email}`}
          minWidth={1100}
          emptyText={hasFilter ? '没有符合条件的用户。' : '还没有可查看的用户。'}
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

      <CsvImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          reload();
        }}
      />

      {deleteTargets && (
        <BatchDeleteUsersDialog
          targets={deleteTargets.map((row) => ({ id: row.userId, email: row.email }))}
          clearedNote={`积分批次与余额（合计 ${deleteTargets.reduce(
            (sum, row) => sum + row.balance,
            0,
          )} 积分）、作品、任务、素材`}
          loading={deleting}
          onCancel={() => setDeleteTargets(null)}
          onConfirm={() => void confirmDeleteUsers()}
        />
      )}
    </AdminPage>
  );
}
