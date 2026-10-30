import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { Pagination } from '../../vendor/boardui/components/base/pagination/pagination';
import { adminCreditsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { adminOrderHref, adminTasksHref, adminUserDetailHref } from '../../lib/admin-links';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { Descriptions, FormField, Notice } from '../../admin-ui/primitives';
import { FilePick, SelectBox, TextArea, TextInput } from '../../admin-ui/controls';
import { cx } from '../../admin-ui/lib/cn';
import type {
  AdminCreditLedgerRow,
  AdminCreditListResult,
  AdminCreditLotRow,
  AdminCreditRow,
  CreditImportResult,
} from '../../types/api';

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
 */

/** 流水类型 → 中文。未知类型原样显示, 便于发现未登记的取值 */
const LEDGER_LABELS: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  admin_adjust: '人工调整',
  expire: '到期回收',
  refund_reclaim: '退款扣回',
};

/** 批次来源 → 中文 */
const SOURCE_LABELS: Record<string, string> = {
  purchase: '购买',
  grant: '发放',
  admin_adjust: '人工',
  refund_reclaim: '退款扣回',
};

const LEDGER_OPTIONS = Object.entries(LEDGER_LABELS).map(([value, label]) => ({ value, label }));

/** CSV 导入结果每页行数。结果是一次性返回的, 分页只在客户端做。 */
const IMPORT_PAGE_SIZE = 10;

/** 带符号的积分文本: 正数显式加号, 否则扫视时看不出是增还是减 */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function fmtTime(v: string | null): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

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

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminCreditListResult>(fetcher, {
      email: initialEmail || undefined,
      userId: initialUserId || undefined,
    });

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
          <span className="text-sm text-text-primary">{row.name || row.email}</span>
          <span className="text-[11px] text-text-tertiary">
            <Link className="text-accent-700 hover:underline" to={adminUserDetailHref(row.userId)}>
              {row.email}
            </Link>
            {row.name ? '' : ' · 无昵称'}
          </span>
          <code className="text-[11px] text-text-tertiary" title={row.userId}>
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
          <span className="tabular-nums text-amber-700">{row.expiringSoon}</span>
        ) : (
          <span className="text-[11px] text-text-tertiary">—</span>
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
        <span className="text-[11px] text-text-tertiary">{fmtTime(row.nearestExpiry)}</span>
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 80,
      fixed: 'right',
      render: (row) => (
        <Button variant="ghost" size="xs" onClick={() => setDetail(row)}>
          明细
        </Button>
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
              <Button variant="secondary" size="small" leadingIcon={Upload} onClick={() => setBatchOpen(true)}>
                批量调整
              </Button>
            )}
            {/* CSV 导入走邮箱而非用户 ID: 运营手里的补偿名单通常是邮箱表, 不是 cuid */}
            {/* 后端 /admin/credits/import 的权限点是 credit.adjust（导入会改余额，
                与人工调整同一套规则）。此前这里用 data.import，导致有 credit.adjust
                的财务看不到入口，而只有 data.import 的角色点进去反而 403。 */}
            {can('credit.adjust') && (
              <Button variant="secondary" size="small" leadingIcon={Upload} onClick={() => setImportOpen(true)}>
                导入 CSV
              </Button>
            )}
            {can('data.export') && (
              <Button
                variant="secondary"
                size="small"
                leadingIcon={Download}
                onClick={() => void exportCsv()}
                disabled={exporting}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StatCard label="用户总数" value={data?.total ?? '—'} hint="符合当前筛选的账户数" />
        <StatCard label="本页余额合计" value={pageSummary.balance} hint="仅统计当前页，不是全站总量" />
        <StatCard
          label="本页 30 天内到期"
          value={pageSummary.expiring}
          hint="到期会被自动回收，用户可能察觉余额下降"
          tone={pageSummary.expiring > 0 ? 'warn' : undefined}
        />
      </div>

      <FilterBar>
        <TextInput
          className="w-52"
          ariaLabel="按邮箱筛选"
          placeholder="邮箱"
          value={email}
          onChange={setEmail}
          onEnter={applyQuery}
          allowClear
        />
        <TextInput
          className="w-52"
          ariaLabel="按用户 ID 筛选"
          placeholder="用户 ID（精确）"
          value={userId}
          onChange={setUserId}
          onEnter={applyQuery}
          allowClear
        />
        <FilterActions>
          <Button variant="primary" size="small" onClick={applyQuery}>
            查询
          </Button>
          <Button variant="secondary" size="small" onClick={reset}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel title="用户积分总览" note="按注册时间倒序">
        {loading && !data ? (
          <AdminListLoading tip="加载积分总览…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <AdminEmpty
            description={hasFilter ? '没有符合条件的用户。' : '还没有可查看的用户。'}
            action={
              hasFilter ? (
                <Button variant="secondary" size="small" onClick={reset}>
                  清除筛选
                </Button>
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

/**
 * 单用户明细: 批次 + 流水 + 单条调整。
 *
 * 独立组件而不是把状态塞进页面: 抽屉的批次/流水是「随用户切换而重拉」的数据,
 * 与列表的分页状态生命周期完全不同, 混在一起会让列表重新渲染时抽屉闪一下。
 */
function CreditDetailDrawer({
  user,
  writable,
  onClose,
  onChanged,
}: {
  user: AdminCreditRow;
  writable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [type, setType] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [validDays, setValidDays] = useState('');

  const [busy, setBusy] = useState(false);

  /*
   * 批次与流水一次拉齐: 只看流水不看批次, 看不出「这 30 分是从哪一批扣的」;
   * 分成两次加载会让两块停留在不同时刻的数字上。
   */
  const { data, loading, error, reload } = useAdminResource(
    () =>
      Promise.all([
        adminCreditsApi.lots(user.userId, { from: from || undefined, to: to || undefined }),
        adminCreditsApi.ledger(user.userId, {
          type,
          from: from || undefined,
          to: to || undefined,
          limit: 100,
        }),
      ]),
    [user.userId, type, from, to],
  );
  const lots = data?.[0] ?? [];
  const ledger = data?.[1] ?? [];

  const parsedDelta = Number(delta);
  const deltaValid = Number.isInteger(parsedDelta) && parsedDelta !== 0;
  const adjustmentDirty = Boolean(delta.trim() || reason.trim() || validDays.trim());
  useUnsavedGuard(adjustmentDirty);
  const requestClose = useDiscardConfirm(adjustmentDirty, onClose);

  const submitAdjust = async () => {
    if (!deltaValid) {
      toast.warning('变动量必须是非零整数，正数增加、负数扣减');
      return;
    }
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写调整原因');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.adjust({
        userId: user.userId,
        delta: parsedDelta,
        reason: trimmed,
        ...(validDays.trim() ? { validDays: Number(validDays) } : {}),
      });
      toast.success(`已调整 ${signed(parsedDelta)} 积分，当前余额 ${r.balance}`);
      setDelta('');
      setReason('');
      setValidDays('');
      void reload({ silent: true });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '调整失败');
    } finally {
      setBusy(false);
    }
  };

  const lotColumns: Array<AdminColumn<AdminCreditLotRow>> = [
    {
      key: 'source',
      title: '来源',
      width: 100,
      render: (row) => <span className="text-xs">{SOURCE_LABELS[row.source] ?? row.source}</span>,
    },
    {
      key: 'amount',
      title: '剩余 / 总量',
      width: 140,
      render: (row) => (
        <span className="tabular-nums text-xs">
          {row.remainingCredits} / {row.totalCredits}
        </span>
      ),
    },
    {
      key: 'expireAt',
      title: '到期',
      width: 170,
      render: (row) =>
        row.expireAt ? (
          <span className="text-[11px] text-text-secondary">{fmtTime(row.expireAt)}</span>
        ) : (
          <span className="text-[11px] text-text-tertiary">永久</span>
        ),
    },
    {
      key: 'createdAt',
      title: '创建时间',
      render: (row) => (
        <span className="text-[11px] text-text-secondary">{fmtTime(row.createdAt)}</span>
      ),
    },
  ];

  const ledgerColumns: Array<AdminColumn<AdminCreditLedgerRow>> = [
    {
      key: 'createdAt',
      title: '时间',
      width: 170,
      render: (row) => (
        <span className="text-[11px] tabular-nums text-text-secondary">{fmtTime(row.createdAt)}</span>
      ),
    },
    {
      key: 'type',
      title: '类型',
      width: 110,
      render: (row) => <span className="text-xs">{LEDGER_LABELS[row.type] ?? row.type}</span>,
    },
    {
      key: 'amount',
      title: '变动',
      width: 90,
      render: (row) => (
        <b className={cx('tabular-nums', row.amount > 0 ? 'text-emerald-600' : 'text-rose-600')}>
          {signed(row.amount)}
        </b>
      ),
    },
    {
      key: 'balanceAfter',
      title: '变动后余额',
      width: 110,
      render: (row) => <span className="tabular-nums text-xs">{row.balanceAfter}</span>,
    },
    {
      key: 'reason',
      title: '说明',
      render: (row) => (
        <span className="text-[11px] text-text-tertiary">
          {row.reason ?? '—'}
          {row.taskId ? ` · 任务 ${row.taskId.slice(-8)}` : ''}
          {row.orderId ? ` · 订单 ${row.orderId.slice(-8)}` : ''}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      title={`积分明细 · ${user.email}`}
      width={760}
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      {error && data && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <section className="mb-6">
        <SectionTitle title="账户概要" />
        <Descriptions
          columns={2}
          items={[
            {
              label: '用户',
              value: (
                <Link className="text-accent-700 hover:underline" to={adminUserDetailHref(user.userId)}>
                  {user.email}
                </Link>
              ),
            },
            { label: '用户 ID', value: <code className="font-mono text-xs">{user.userId}</code> },
            {
              label: '关联记录',
              value: (
                <span className="flex flex-wrap gap-x-3">
                  <Link className="text-accent-700 hover:underline" to={adminOrderHref({ email: user.email })}>
                    订单记录
                  </Link>
                  <Link className="text-accent-700 hover:underline" to={adminTasksHref({ userId: user.userId })}>
                    任务记录
                  </Link>
                </span>
              ),
            },
            { label: '当前余额', value: <b className="tabular-nums">{user.balance}</b> },
            { label: '30 天内到期', value: <span className="tabular-nums">{user.expiringSoon}</span> },
            {
              label: '累计获得 / 消耗',
              value: (
                <span className="tabular-nums">
                  {user.totalEarned} / {user.totalConsumed}
                  <span className="ml-1 text-[11px] text-text-tertiary">
                    不含到期回收与退款扣回，故与余额不构成等式
                  </span>
                </span>
              ),
            },
            { label: '最近到期', value: fmtTime(user.nearestExpiry) },
          ]}
        />
      </section>

      {writable && (
        <section className="mb-6">
          <SectionTitle title="人工调整" note="正数增加、负数扣减；扣减受余额限制" />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <div className="w-40">
                <FormField label="变动量（积分）" htmlFor="c-delta">
                  <TextInput
                    value={delta}
                    onChange={setDelta}
                    placeholder="如 100 或 -50"
                    inputMode="numeric"
                    ariaLabel="变动量"
                  />
                </FormField>
              </div>
              <div className="w-40">
                <FormField label="有效天数（可选）" htmlFor="c-valid">
                  <TextInput
                    value={validDays}
                    onChange={setValidDays}
                    placeholder="留空 = 永久"
                    inputMode="numeric"
                    ariaLabel="有效天数"
                  />
                </FormField>
              </div>
            </div>
            <FormField label="调整原因（强制）" htmlFor="c-reason">
              <TextInput
                value={reason}
                onChange={setReason}
                placeholder="如：工单 #123 补偿生成失败"
                maxLength={200}
                ariaLabel="调整原因"
              />
            </FormField>
            <div>
              <Button
                variant="primary"
                size="small"
                disabled={!deltaValid}
                onClick={() => void submitAdjust()}
              >
                提交调整
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="mb-6">
        <SectionTitle title="批次" note="消耗按先到期先扣（FEFO），空到期视为最晚" />
        {loading && !data ? (
          <AdminListLoading tip="加载积分批次…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : lots.length === 0 ? (
          <AdminEmpty description="该用户没有积分批次。" />
        ) : (
          <AdminDataTable<AdminCreditLotRow>
            rows={lots}
            columns={lotColumns}
            rowKey={(row) => row.id}
            loading={loading}
            density="compact"
            emptyText="该用户没有积分批次。"
          />
        )}
      </section>

      <section>
        <SectionTitle title="流水" />
        <FilterBar>
          <SelectBox
            className="w-36"
            ariaLabel="按流水类型筛选"
            placeholder="类型"
            allowClear
            value={type}
            onChange={setType}
            options={LEDGER_OPTIONS}
          />
          <TextInput className="w-40" ariaLabel="开始日期" type="date" value={from} onChange={setFrom} />
          <TextInput className="w-40" ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
          <FilterActions>
            <Button variant="secondary" size="small" onClick={() => void reload()} disabled={loading}>
              刷新
            </Button>
          </FilterActions>
        </FilterBar>
        {/*
          流水区不再重复报错: 批次区已经整块显示了同一次加载的失败原因,
          同一个错误在抽屉里出现两次只会让人以为两处各自坏了。
        */}
        {loading && !data ? (
          <AdminListLoading tip="加载积分流水…" />
        ) : error && !data ? null : ledger.length === 0 ? (
          <AdminEmpty description="没有符合条件的流水。" />
        ) : (
          <AdminDataTable<AdminCreditLedgerRow>
            rows={ledger}
            columns={ledgerColumns}
            rowKey={(row) => row.id}
            loading={loading}
            density="compact"
            emptyText="没有符合条件的流水。"
          />
        )}
      </section>
    </Drawer>
  );
}

/**
 * 批量调整。
 *
 * 输入格式是「每行 用户ID,变动量[,原因]」而不是动态表单:
 * 运营手里通常是从表格里复制出来的一批 id, 粘进 textarea 比逐行点「添加」
 * 快一个数量级, 也避免了 N 个受控输入各自校验。
 */
function BatchAdjustDrawer({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{ userId: string; success: boolean; balance?: number; message?: string }>;
  } | null>(null);
  const dirty = !result && Boolean(text.trim() || reason.trim());
  useUnsavedGuard(open && dirty);

  /** 解析结果与错误行分开返回: 有错行时仍展示能解析的部分, 便于边改边看 */
  const parsed = useMemo(() => {
    const items: Array<{ userId: string; delta: number; reason?: string }> = [];
    const errors: string[] = [];
    text
      .split('\n')
      .map((l) => l.trim())
      .forEach((line, i) => {
        if (!line) return;
        // 逗号兼容中英文, 从表格粘贴过来的常是中文逗号
        const parts = line.split(/[,，]/).map((p) => p.trim());
        if (parts.length < 2) {
          errors.push(`第 ${i + 1} 行：缺少变动量`);
          return;
        }
        const delta = Number(parts[1]);
        if (!parts[0]) errors.push(`第 ${i + 1} 行：用户 ID 为空`);
        else if (!Number.isInteger(delta) || delta === 0) {
          errors.push(`第 ${i + 1} 行：变动量必须是非零整数`);
        } else {
          items.push({
            userId: parts[0],
            delta,
            ...(parts[2] ? { reason: parts[2] } : {}),
          });
        }
      });
    if (items.length > 100) errors.push(`共 ${items.length} 条，单次最多 100 条`);
    return { items, errors };
  }, [text]);

  const close = () => {
    if (busy) return;
    setText('');
    setReason('');
    setResult(null);
    onClose();
  };
  const requestClose = useDiscardConfirm(open && dirty, close);
  const done = () => {
    setText('');
    setReason('');
    setResult(null);
    onDone();
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写整批调整原因');
      return;
    }
    if (parsed.items.length === 0) {
      toast.warning('没有可提交的有效行');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.batchAdjust({ items: parsed.items, reason: trimmed });
      setResult(r);
      if (r.failed === 0) toast.success(`已调整 ${r.succeeded} 条`);
      else toast.warning(`成功 ${r.succeeded} 条，失败 ${r.failed} 条`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量调整失败');
    } finally {
      setBusy(false);
    }
  };

  const resultColumns: Array<AdminColumn<{ userId: string; success: boolean; balance?: number; message?: string }>> = [
    {
      key: 'userId',
      title: '用户 ID',
      render: (row) => (
        <code className="font-mono text-[11px] text-text-secondary">{row.userId}</code>
      ),
    },
    {
      key: 'ok',
      title: '结果',
      width: 90,
      render: (row) =>
        row.success ? (
          <StatusTag status="succeeded" label="成功" tone="success" />
        ) : (
          <StatusTag status="failed" label="失败" tone="danger" />
        ),
    },
    {
      key: 'msg',
      title: '说明',
      render: (row) => (
        <span className="text-[11px] text-text-tertiary">
          {row.success ? `余额 ${row.balance}` : (row.message ?? '未知原因')}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      title="批量调整积分"
      width={680}
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      footer={
        <>
          <Button variant="secondary" size="small" onClick={requestClose} disabled={busy}>
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (
            <Button variant="primary" size="small" onClick={done}>
              完成
            </Button>
          ) : (
            <Button
              variant="primary"
              size="small"
              onClick={() => void submit()}
              disabled={busy || parsed.items.length === 0}
            >
              {busy ? '提交中…' : `提交 ${parsed.items.length} 条`}
            </Button>
          )}
        </>
      }
    >
      {result ? (
        <section>
          <SectionTitle
            title="执行结果"
            note={`成功 ${result.succeeded} · 失败 ${result.failed}`}
          />
          <AdminDataTable
            rows={result.results}
            columns={resultColumns}
            rowKey={(row) => row.userId}
            density="compact"
            emptyText="没有结果"
          />
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField
            label="调整清单"
            hint="正数增加、负数扣减，单次最多 100 条；逐条独立执行，一条失败不影响其余"
          >
            <TextArea
              value={text}
              onChange={setText}
              rows={8}
              placeholder={'每行一条：用户ID,变动量[,单独原因]\n如：\ncuid_abc,100\ncuid_def,-50,工单 #223 扣回'}
              ariaLabel="调整清单"
            />
          </FormField>

          {parsed.errors.length > 0 && (
            <Notice tone="warn">
              {parsed.errors.slice(0, 5).join('；')}
              {parsed.errors.length > 5 ? ` …共 ${parsed.errors.length} 处问题` : ''}
            </Notice>
          )}

          <FormField
            label="整批原因（强制）"
            hint="逐行未填原因时使用该文案；每一条都会写入审计"
          >
            <TextInput
              value={reason}
              onChange={setReason}
              placeholder="如：2026-10 故障补偿"
              maxLength={200}
              ariaLabel="整批原因"
            />
          </FormField>
        </div>
      )}
    </Drawer>
  );
}

/**
 * CSV 导入积分。
 *
 * ## 为什么单独做而不是复用「批量调整」
 *
 * 批量调整的输入是 `用户ID,变动量`, 而运营手里拿到的是财务/客服给的
 * **邮箱名单**（Excel 导出）。让运营先把邮箱查成 cuid 再粘贴, 是几百次
 * 手工查找, 且错一个 id 就会给不相干的人加积分。
 *
 * ## 格式
 *
 * 首行可以是表头（`email,delta,reason` / `邮箱,变动量,原因`）, 也可以是
 * 直接的数据行 —— 两种在 Excel 另存为 CSV 的场景里都很常见, 后端两种都认。
 * 逗号分隔、UTF-8（Excel 中文版另存的 CSV 常带 BOM, 后端会剥掉）。
 */
function CsvImportDrawer({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [validDays, setValidDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreditImportResult | null>(null);
  const [importPage, setImportPage] = useState(1);
  const dirty = !result && Boolean(file || reason.trim() || validDays.trim());
  useUnsavedGuard(open && dirty);

  /** 关闭时清空: 下次打开不该看到上次选的文件 */
  const close = () => {
    if (busy) return;
    setFile(null);
    setReason('');
    setValidDays('');
    setResult(null);
    setImportPage(1);
    onClose();
  };
  const requestClose = useDiscardConfirm(open && dirty, close);
  const done = () => {
    setFile(null);
    setReason('');
    setValidDays('');
    setResult(null);
    setImportPage(1);
    onDone();
  };

  /** 失败行排最后 + 客户端分页切片 */
  const importRows = useMemo(() => {
    const sorted = [...(result?.results ?? [])].sort(
      (a, b) => Number(a.success) - Number(b.success),
    );
    const start = (importPage - 1) * IMPORT_PAGE_SIZE;
    return sorted.slice(start, start + IMPORT_PAGE_SIZE);
  }, [result, importPage]);

  const submit = async () => {
    if (!file) {
      toast.warning('请先选择 CSV 文件');
      return;
    }
    const days = validDays.trim() ? Number(validDays.trim()) : undefined;
    if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
      toast.warning('有效期必须是不小于 1 的整数天');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.importCsv(file, {
        reason: reason.trim() || undefined,
        validDays: days,
      });
      setResult(r);
      if (r.failed === 0) toast.success(`已导入 ${r.succeeded} 条`);
      else toast.warning(`成功 ${r.succeeded} 条，失败 ${r.failed} 条`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const resultColumns: Array<AdminColumn<CreditImportResult['results'][number]>> = [
    { key: 'row', title: '行号', width: 70, render: (row) => <span className="tabular-nums">{row.row}</span> },
    {
      key: 'email',
      title: '邮箱',
      render: (row) => <span className="text-[11px] text-text-tertiary">{row.email || '—'}</span>,
    },
    {
      key: 'delta',
      title: '变动',
      width: 90,
      render: (row) => (
        <span className="tabular-nums text-xs">
          {Number.isFinite(row.delta) ? signed(row.delta) : '—'}
        </span>
      ),
    },
    {
      key: 'ok',
      title: '结果',
      width: 90,
      render: (row) =>
        row.success ? (
          <StatusTag status="succeeded" label="成功" tone="success" />
        ) : (
          <StatusTag status="failed" label="失败" tone="danger" />
        ),
    },
    {
      key: 'msg',
      title: '说明',
      render: (row) => (
        <span className="text-[11px] text-text-tertiary">
          {row.success ? `余额 ${row.balance}` : (row.message ?? '未知原因')}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      title="导入积分（CSV）"
      width={680}
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      footer={
        <>
          <Button variant="secondary" size="small" onClick={requestClose} disabled={busy}>
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (
            <Button variant="primary" size="small" onClick={done}>
              完成
            </Button>
          ) : (
            <Button
              variant="primary"
              size="small"
              onClick={() => void submit()}
              disabled={busy || !file}
            >
              {busy ? '导入中…' : '开始导入'}
            </Button>
          )}
        </>
      }
    >
      {result ? (
        <section>
          <SectionTitle
            title="导入结果"
            note={`共 ${result.total} 行 · 成功 ${result.succeeded} · 失败 ${result.failed}`}
          />
          {/*
            失败行排在最后 (原 antd 版同样如此): 运营最先要处理的是失败。
            结果是纯前端一次返回的, 所以这里做客户端分页 —— 不走 DataTable 的
            `pagination` prop, 那个会带出 20/50/100 的每页条数选择器, 与
            这里每页 10 行的口径打架。
          */}
          <AdminDataTable
            rows={importRows}
            columns={resultColumns}
            rowKey={(row) => String(row.row)}
            density="compact"
            emptyText="没有结果"
          />
          <div className="mt-2 flex justify-end">
            <Pagination
              page={importPage}
              totalPages={Math.max(1, Math.ceil(importRows.length / IMPORT_PAGE_SIZE))}
              onChange={setImportPage}
              previousLabel="上一页"
              nextLabel="下一页"
              aria-label="导入结果分页"
            />
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField
            label="CSV 文件"
            hint="每行 邮箱,变动量[,原因]，首行可带表头；单次最多 500 行。正数增加、负数扣减。"
          >
            <FilePick
              file={file}
              accept=".csv,text/csv"
              label="选择 CSV"
              onPick={setFile}
              onClear={() => setFile(null)}
            />
          </FormField>

          <FormField label="整批原因" hint="会写入每一条的审计记录">
            <TextInput
              value={reason}
              onChange={setReason}
              placeholder="如：2026-10 故障补偿（行内未填原因时使用该文案）"
              maxLength={200}
              ariaLabel="整批原因"
            />
          </FormField>

          <FormField label="有效期（天，可选）">
            <TextInput
              value={validDays}
              onChange={setValidDays}
              placeholder="留空表示永久有效"
              inputMode="numeric"
              ariaLabel="有效期"
            />
          </FormField>

          <Notice tone="warn">
            导入会立即改变用户可用余额且不可撤销。建议先用几行小数据验证格式，再导全量。
          </Notice>
        </div>
      )}
    </Drawer>
  );
}

/** 抽屉里的小节标题：标题 + 一句口径说明 */
function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 border-b border-border-table pb-1.5">
      <strong className="text-xs font-semibold text-text-primary">{title}</strong>
      {note && <span className="text-[11px] text-text-tertiary">{note}</span>}
    </div>
  );
}
