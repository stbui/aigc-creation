import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  EmptyState,
  FilterActions,
  FilterBar,
  ListError,
  PageHeader,
  Panel,
  SkeletonBody,
  StatCard,
  StaleError,
  type AdminColumn,
  type AppliedFilter,
} from './components';
import { adminCreditsApi } from './api';
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
 * ## 人工调整必须有原因
 *
 * 积分是可变现资产, 无理由的加减无法追责。单条调整与批量调整都强制原因。
 *
 * ## 模块划分
 *
 * - `api.ts` / `hooks.ts` / `utils.ts` / `constants.ts`：接口、数据 hook、
 *   纯函数与选项表；
 * - `CreditDetailDrawer` / `BatchAdjustDrawer` / `CsvImportDrawer`：三个写操作抽屉；
 * - 本文件只保留页面编排与列表列定义。
 */
export function AdminCreditsPage() {
  const toast = useToast();
  const { can } = useAdmin();

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const initialUserId = searchParams.get('userId') ?? '';

  const [email, setEmail] = useState(initialEmail);
  const [userId, setUserId] = useState(initialUserId);

  const [detail, setDetail] = useState<AdminCreditRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data, loading, error, params, setQuery, setPage, reload } = useCreditDirectory(
    initialEmail,
    initialUserId,
  );

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    email: params.email as string | undefined,
    userId: params.userId as string | undefined,
  });

  const rows = data?.items ?? [];

  const pageSummary = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        balance: acc.balance + r.balance,
        expiring: acc.expiring + r.expiringSoon,
      }),
      { balance: 0, expiring: 0 },
    );
  }, [rows]);

  const hasFilter = Boolean(email || userId);

  const applyQuery = () =>
    setQuery({ email: email.trim() || undefined, userId: userId.trim() || undefined });

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
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminCreditsApi.exportCsv({
        email: params.email as string | undefined,
        userId: params.userId as string | undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const columns: Array<AdminColumn<AdminCreditRow>> = [
    {
      key: 'user',
      title: '用户',
      width: 230,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{row.name || row.email}</span>
          <span className="text-[12px] text-muted-foreground">
            <Link className="text-brand hover:underline" to={adminUserDetailHref(row.userId)}>
              {row.email}
            </Link>
            {row.name ? '' : ' · 无昵称'}
          </span>
          <code className="text-[12px] text-muted-foreground" title={row.userId}>
            {row.userId}
          </code>
        </div>
      ),
    },
    {
      key: 'balance',
      title: '当前余额',
      width: 110,
      render: (row) => <b className="tabular-nums">{row.balance}</b>,
    },
    {
      key: 'expiringSoon',
      title: '30 天内到期',
      width: 120,
      render: (row) =>
        row.expiringSoon > 0 ? (
          <span className="tabular-nums text-warn-text">{row.expiringSoon}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">—</span>
        ),
    },
    {
      key: 'totalEarned',
      title: '累计获得',
      width: 100,
      render: (row) => <span className="tabular-nums">{row.totalEarned}</span>,
    },
    {
      key: 'totalConsumed',
      title: '累计消耗',
      width: 100,
      render: (row) => <span className="tabular-nums">{row.totalConsumed}</span>,
    },
    {
      key: 'activeLots',
      title: '有效批次',
      width: 90,
      render: (row) => <span className="tabular-nums">{row.activeLots}</span>,
    },
    {
      key: 'nearestExpiry',
      title: '最近到期',
      width: 160,
      render: (row) => (
        <span className="text-[12px] text-muted-foreground">{fmtTime(row.nearestExpiry)}</span>
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 80,
      fixed: 'right',
      render: (row) => (
        <ActionButton variant="ghost" size="xs" onClick={() => setDetail(row)}>
          明细
        </ActionButton>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="积分账本"
        description="余额由批次推导，流水只追加不修改。人工调整会立即改变用户可用余额并写入审计。"
        actions={
          <>
            {can('credit.adjust') && (
              <ActionButton variant="secondary" icon={Upload} onClick={() => setBatchOpen(true)}>
                批量调整
              </ActionButton>
            )}
            {/* CSV 导入走邮箱而非用户 ID: 运营手里的补偿名单通常是邮箱表, 不是 cuid */}
            {/* 后端 /admin/credits/import 的权限点是 credit.adjust（导入会改余额，
                与人工调整同一套规则）。此前这里用 data.import，导致有 credit.adjust
                的财务看不到入口，而只有 data.import 的角色点进去反而 403。 */}
            {can('credit.adjust') && (
              <ActionButton variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                导入 CSV
              </ActionButton>
            )}
            {can('data.export') && (
              <ActionButton
                variant="secondary"
                icon={Download}
                onClick={() => void exportCsv()}
                disabled={exporting}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </ActionButton>
            )}
          </>
        }
      />

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StatCard label="用户总数" value={data?.total ?? '—'} hint="符合当前筛选的账户数" />
        <StatCard
          label="本页余额合计"
          value={pageSummary.balance}
          hint="仅统计当前页，不是全站总量"
        />
        <StatCard
          label="本页 30 天内到期"
          value={pageSummary.expiring}
          hint="到期会被自动回收，用户可能察觉余额下降"
          tone={pageSummary.expiring > 0 ? 'warn' : undefined}
        />
      </div>

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

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel title="用户积分总览" note="按注册时间倒序">
        {loading && !data ? (
          /* 面板外壳已经是实的，只替内容行 */
          <SkeletonBody rows={4} />
        ) : error && !data ? (
          <ListError error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilter ? '没有符合条件的用户。' : '还没有可查看的用户。'}
            description={
              hasFilter
                ? '清除筛选后可查看全部账户。'
                : '用户注册后，其积分余额与批次会在这里出现。'
            }
            action={
              hasFilter ? (
                <ActionButton variant="secondary" onClick={reset}>
                  清除筛选
                </ActionButton>
              ) : undefined
            }
          />
        ) : (
          <AdminDataTable<AdminCreditRow>
            rows={rows}
            columns={columns}
            rowKey={(row) => row.userId}
            loading={loading}
            error={error}
            onRetry={reload}
            minWidth={1100}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              unit: '个账户',
              onChange: (page, size) => setPage(page, size),
            }}
          />
        )}
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
    </>
  );
}
