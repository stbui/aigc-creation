import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminPaymentProvidersApi, adminPaymentReconciliationApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ConfirmAction,
  Drawer,
  FilterActions,
  FilterBar,
  FormField,
  ListError,
  Notice,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
  useToast,
} from './hooks';
import type {
  AdminReconciliationItem,
  AdminReconciliationRun,
  PaymentProviderId,
} from '../../../types/payment';
import {
  PROVIDER_LABELS,
  RECONCILIATION_PROVIDER_IDS,
  RECONCILIATION_PROVIDERS,
} from './constants';
import { moneyText } from './utils';
import { RECONCILIATION_RESULT_LABELS } from '../../../types/payment';

/**
 * 支付对账标签。
 *
 * 与旧版「人工导入账单 + 逐笔处置」是两种东西：
 *
 * 旧版让人上传渠道账单 CSV，逐条勾「已处理 / 已忽略」—— 处置动作只改数据库
 * 状态，钱一分没动，看板上却消失了。
 *
 * 新版由系统每天 10:15 自动下载渠道账单并比对，发现「渠道已收款但本地没入账」
 * 会自动补发积分；失败可在同一账单日重跑。**页面只展示结果，不提供改钱入口**。
 * 人工要处理的是「渠道重复扣款」「本地多记了一笔」这类真异常，走订单退款流程。
 */

const RUN_STATUS_OPTIONS = [
  { value: 'running', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

const RUN_STATUS_META: Record<string, { label: string; tone: 'success' | 'danger' | 'warn' | 'brand' | 'muted' }> = {
  running: { label: '执行中', tone: 'brand' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
};

/** 昨天（YYYY-MM-DD，上海时区）。对账只能选昨天及更早 */
function yesterday(): string {
  // 必须按上海时区切日：用 toISOString 会在东八区 00:00–08:00 默认成前天
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

/** 90 天前的日期，对账最早回溯范围 */
function ninetyDaysAgo(): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 90);
  return shifted.toISOString().slice(0, 10);
}

export function PaymentsReconciliationTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canReconcile = can('finance.reconcile');
  const canExport = can('data.export');

  const [searchParams] = useSearchParams();

  const initialProvider = (() => {
    const raw = searchParams.get('providerId');
    return raw && (RECONCILIATION_PROVIDER_IDS as string[]).includes(raw) ? raw : undefined;
  })();
  const initialStatus = (() => {
    const raw = searchParams.get('status');
    return raw && raw in RUN_STATUS_META ? raw : undefined;
  })();
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';

  // 执行区草稿
  const [runProvider, setRunProvider] = useState<string>('');
  const [billDate, setBillDate] = useState(yesterday());
  const [runOpen, setRunOpen] = useState(false);

  // CSV / ZIP 兜底导入
  const [importOpen, setImportOpen] = useState(false);
  const [importProvider, setImportProvider] = useState<string>('');
  const [importBillDate, setImportBillDate] = useState<string>(yesterday());
  const [importFile, setImportFile] = useState<File | null>(null);

  // 列表筛选草稿
  const [filterProvider, setFilterProvider] = useState<string | undefined>(initialProvider);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(initialStatus);
  const [filterFrom, setFilterFrom] = useState(initialFrom);
  const [filterTo, setFilterTo] = useState(initialTo);

  const providers = useAdminResource(() => adminPaymentProvidersApi.list());

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminPaymentReconciliationApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        ...(params.providerId ? { providerId: params.providerId as string } : {}),
        ...(params.status ? { status: params.status as string } : {}),
        ...(params.from ? { from: params.from as string } : {}),
        ...(params.to ? { to: params.to as string } : {}),
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList(fetcher, {
    pageSize: 30,
    ...(initialProvider ? { providerId: initialProvider } : {}),
    ...(initialStatus ? { status: initialStatus } : {}),
    ...(initialFrom ? { from: initialFrom } : {}),
    ...(initialTo ? { to: initialTo } : {}),
  });

  useAdminUrlFilterSync({
    providerId: params.providerId as string | undefined,
    status: params.status as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });

  // 刷新只重取当前筛选下的数据，筛选与分页都不动
  useEffect(() => {
    if (refreshNonce > 0) {
      void reload();
      void providers.reload();
    }
  }, [refreshNonce, reload, providers.reload]);

  const appliedChips: AppliedFilter[] = [];
  if (params.providerId) {
    appliedChips.push({
      key: 'providerId',
      label: `渠道：${PROVIDER_LABELS[params.providerId as keyof typeof PROVIDER_LABELS] ?? params.providerId}`,
      onClear: () => {
        setFilterProvider(undefined);
        setQuery({ providerId: undefined });
      },
    });
  }
  if (params.status) {
    appliedChips.push({
      key: 'status',
      label: `状态：${RUN_STATUS_META[params.status as string]?.label ?? params.status}`,
      onClear: () => {
        setFilterStatus(undefined);
        setQuery({ status: undefined });
      },
    });
  }
  if (params.from) {
    appliedChips.push({
      key: 'from',
      label: `起始：${params.from}`,
      onClear: () => {
        setFilterFrom('');
        setQuery({ from: undefined });
      },
    });
  }
  if (params.to) {
    appliedChips.push({
      key: 'to',
      label: `截止：${params.to}`,
      onClear: () => {
        setFilterTo('');
        setQuery({ to: undefined });
      },
    });
  }

  const [detailId, setDetailId] = useAdminDetailParam('runId');
  const [busy, setBusy] = useState(false);

  const runs = data?.items ?? [];

  /** 可参与对账的渠道：需已配置且渠道本身支持账单下载；沙箱没有渠道侧账单 */
  const reconcilableProviders = useMemo(
    () =>
      (providers.data?.items ?? [])
        .filter((provider) => provider.supportsReconciliation && provider.configured)
        .map((provider) => ({
          value: provider.id,
          label: PROVIDER_LABELS[provider.id as keyof typeof PROVIDER_LABELS] ?? provider.name,
        })),
    [providers.data],
  );

  const columns: Array<AdminColumn<AdminReconciliationRun>> = [
    {
      key: 'billDate',
      title: '账单日期',
      width: 110,
      render: (row) => <span className="tabular-nums">{row.billDate}</span>,
    },
    {
      key: 'provider',
      title: '渠道',
      width: 100,
      render: (row) => (
        <span className="text-muted-foreground">
          {PROVIDER_LABELS[row.providerId as keyof typeof PROVIDER_LABELS] ?? row.providerId}
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (row) => {
        const meta = RUN_STATUS_META[row.status] ?? { label: row.status, tone: 'muted' as const };
        return <StatusTag status={row.status} tone={meta.tone} label={meta.label} />;
      },
    },
    {
      key: 'matchItems',
      title: '一致',
      width: 70,
      render: (row) => <span className="tabular-nums">{row.matchItems}</span>,
    },
    {
      key: 'recoveredItems',
      title: '自动补发',
      width: 90,
      render: (row) => (
        <span className={row.recoveredItems > 0 ? 'font-medium text-success-text tabular-nums' : 'tabular-nums'}>
          {row.recoveredItems}
        </span>
      ),
    },
    {
      key: 'errorItems',
      title: '异常',
      width: 70,
      render: (row) => (
        <span className={row.errorItems > 0 ? 'font-medium text-danger-text tabular-nums' : 'tabular-nums'}>
          {row.errorItems}
        </span>
      ),
    },
    {
      key: 'completedAt',
      title: '完成时间',
      width: 150,
      render: (row) => (
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {row.completedAt ? row.completedAt.replace('T', ' ').slice(0, 19) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 80,
      render: (row) => (
        <ActionButton onClick={() => setDetailId(row.id)} ariaLabel="查看对账明细">
          查看
        </ActionButton>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="执行对账"
        note="系统每天 10:15 后自动对账昨日账单；失败可在同一账单日重跑"
      >
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <FormField label="渠道" className="w-[160px]">
            <SelectField
              value={runProvider || undefined}
              onChange={(value) => setRunProvider(value ?? '')}
              options={reconcilableProviders}
              placeholder="选择渠道"
              ariaLabel="对账渠道"
            />
          </FormField>
          <FormField label="账单日期" className="w-[180px]" hint="最早 90 天前，最晚昨天">
            <TextField
              type="date"
              value={billDate}
              onChange={setBillDate}
              ariaLabel="账单日期"
            />
          </FormField>
          <ActionButton
            onClick={() => setRunOpen(true)}
            disabled={!canReconcile || !runProvider}
          >
            执行对账
          </ActionButton>
          <ActionButton
            onClick={() => {
              setImportProvider(reconcilableProviders[0]?.value ?? '');
              setImportBillDate(yesterday());
              setImportFile(null);
              setImportOpen(true);
            }}
            disabled={!canReconcile || reconcilableProviders.length === 0}
          >
            导入 CSV
          </ActionButton>
        </div>
      </Panel>

      <FilterBar>
        <SelectField
          value={filterProvider}
          onChange={setFilterProvider}
          options={RECONCILIATION_PROVIDERS}
          allowClear
          className="w-[130px]"
          ariaLabel="筛选渠道"
        />
        <SelectField
          value={filterStatus}
          onChange={setFilterStatus}
          options={RUN_STATUS_OPTIONS}
          allowClear
          className="w-[120px]"
          ariaLabel="筛选状态"
        />
        <TextField
          type="date"
          value={filterFrom}
          onChange={setFilterFrom}
          className="w-[140px]"
          ariaLabel="筛选起始日期"
        />
        <TextField
          type="date"
          value={filterTo}
          onChange={setFilterTo}
          className="w-[140px]"
          ariaLabel="筛选截止日期"
        />
        <FilterActions>
          <ActionButton
            onClick={() =>
              setQuery({
                providerId: filterProvider,
                status: filterStatus,
                from: filterFrom || undefined,
                to: filterTo || undefined,
              })
            }
          >
            筛选
          </ActionButton>
          <ActionButton
            onClick={() => {
              setFilterProvider(undefined);
              setFilterStatus(undefined);
              setFilterFrom('');
              setFilterTo('');
              setQuery({
                providerId: undefined,
                status: undefined,
                from: undefined,
                to: undefined,
              });
            }}
          >
            重置
          </ActionButton>
          <ActionButton
            onClick={() => {
              void adminPaymentReconciliationApi
                .exportCsv({
                  ...(params.providerId ? { providerId: params.providerId as string } : {}),
                  ...(params.status ? { status: params.status as string } : {}),
                  ...(params.from ? { from: params.from as string } : {}),
                  ...(params.to ? { to: params.to as string } : {}),
                })
                .catch((e: Error) => toast.error(e.message));
            }}
            disabled={!canExport || loading || !data || data.total === 0}
          >
            导出 CSV
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} />
      </FilterBar>

      <Panel title="对账运行" note="渠道账单由系统自动下载并比对，异常项会自动补发积分">
        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        {error && !data ? (
          <ListError error={error} onRetry={() => void reload()} />
        ) : (
          <AdminDataTable
            rows={runs}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            emptyText="还没有对账记录"
            minWidth={880}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 30,
              total: data?.total ?? 0,
              onChange: (page, pageSize) => setPage(page, pageSize),
            }}
          />
        )}
      </Panel>

      <ConfirmAction
        open={runOpen}
        title="执行对账"
        description="系统会向渠道下载指定账单日的交易流水并与本地支付记录比对。若发现渠道已收款但本地未入账，会幂等补发积分。"
        impact={[
          '下载并比对渠道账单',
          '发现已支付未入账的订单会自动补发积分',
          '同一账单日重复执行会新增一次运行记录',
        ]}
        confirmText="确认执行"
        loading={busy}
        onCancel={() => setRunOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const result = await adminPaymentReconciliationApi.run({
              providerId: runProvider as PaymentProviderId,
              billDate,
            });
            toast.success(
              result.reused ? '该账单日已有一次成功的运行记录，已复用' : '对账已执行完成',
            );
            setRunOpen(false);
            reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '执行失败');
          } finally {
            setBusy(false);
          }
        }}
      />

      <ConfirmAction
        open={importOpen}
        title="导入对账单"
        description="渠道账单接口不可用时的兜底入口。导入后仍会逐笔核对，不一致的行进入差异列表。"
        impact={['按商户订单号与本地订单比对', '支付宝支持 ZIP 内的 CSV', '超过 10000 行会拒绝导出']}
        confirmText="确认导入"
        confirmDisabled={!importFile || !importProvider || !importBillDate}
        loading={busy}
        onCancel={() => setImportOpen(false)}
        onConfirm={async () => {
          if (!importFile) return;
          setBusy(true);
          try {
            await adminPaymentReconciliationApi.importCsv(importFile, {
              providerId: importProvider as PaymentProviderId,
              billDate: importBillDate,
            });
            toast.success('对账单已导入');
            setImportOpen(false);
            reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '导入失败');
          } finally {
            setBusy(false);
          }
        }}
        extra={
          <div className="flex flex-col gap-3">
            <FormField label="渠道" required>
              <SelectField
                value={importProvider || undefined}
                onChange={(value) => setImportProvider(value ?? '')}
                options={reconcilableProviders}
                placeholder="选择渠道"
                ariaLabel="导入对账渠道"
              />
            </FormField>
            <FormField label="账单日期" required hint="最早 90 天前，最晚昨天">
              <TextField
                type="date"
                value={importBillDate}
                onChange={setImportBillDate}
                ariaLabel="导入账单日期"
              />
            </FormField>
            <FormField
              label="对账单文件"
              required
              hint={importProvider === 'alipay' ? 'CSV，或支付宝导出的 ZIP' : 'CSV'}
            >
              <input
                type="file"
                accept={importProvider === 'alipay' ? '.csv,.zip' : '.csv'}
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:text-foreground"
                aria-label="对账单文件"
              />
            </FormField>
          </div>
        }
      />

      {detailId && (
        <ReconciliationDetailDrawer
          runId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

/** 对账明细抽屉 */
function ReconciliationDetailDrawer({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const { can } = useAdmin();
  const [result, setResult] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data, loading, error, reload } = useAdminResource(
    () => adminPaymentReconciliationApi.items(runId, { result, page, pageSize }),
    [runId, result, page, pageSize],
  );

  const columns: Array<AdminColumn<AdminReconciliationItem>> = [
    {
      key: 'result',
      title: '结果',
      width: 110,
      render: (row) => {
        const meta = RECONCILIATION_RESULT_LABELS[row.result] ?? {
          label: row.result,
          tone: 'muted' as const,
        };
        return <StatusTag status={row.result} tone={meta.tone} label={meta.label} />;
      },
    },
    {
      key: 'merchantOrderNo',
      title: '商户订单号',
      width: 200,
      render: (row) => (
        <code className="font-mono text-[12px]">{row.merchantOrderNo}</code>
      ),
    },
    {
      key: 'providerTradeNo',
      title: '渠道交易号',
      width: 200,
      render: (row) => (
        <code className="font-mono text-[12px]">{row.providerTradeNo ?? '—'}</code>
      ),
    },
    {
      key: 'amount',
      title: '金额',
      width: 110,
      render: (row) => (
        <span className="tabular-nums">{moneyText(row.amountCents, row.currency)}</span>
      ),
    },
    {
      key: 'detail',
      title: '说明',
      render: (row) => <span className="text-muted-foreground">{row.detail ?? '—'}</span>,
    },
  ];

  const items = data?.items ?? [];

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="对账明细"
      description="差异由系统比对得出；需要人工处理的异常走订单退款流程"
      width={1080}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton onClick={onClose}>关闭</ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            value={result}
            onChange={(value) => {
              setResult(value);
              setPage(1);
            }}
            options={Object.entries(RECONCILIATION_RESULT_LABELS).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
            allowClear
            clearLabel="全部结果"
            className="w-[160px]"
            ariaLabel="结果筛选"
          />
          <ActionButton onClick={() => void reload()}>刷新</ActionButton>
          <ActionButton
            onClick={() => {
              void adminPaymentReconciliationApi
                .exportItemsCsv(runId, result ? { result } : {})
                .catch((e: Error) => toast.error(e.message));
            }}
            disabled={!can('data.export') || items.length === 0}
          >
            导出明细 CSV
          </ActionButton>
        </div>

        {error && !data ? (
          <ListError error={error} onRetry={() => void reload()} />
        ) : (
          <AdminDataTable
            rows={items}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            emptyText="没有差异明细"
            minWidth={860}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 50,
              total: data?.total ?? 0,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
          />
        )}

        <Notice tone="info" title="本页不改钱">
          对账发现「渠道已收款但本地未入账」时系统会自动补发积分；重复扣款等异常请到订单管理走退款流程。
        </Notice>
      </div>
    </Drawer>
  );
}
