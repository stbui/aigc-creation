import { useEffect, useMemo, useState } from 'react';
import { adminPaymentProvidersApi, adminPaymentReconciliationApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmDialog,
  DateField,
  FilePicker,
  FormField,
  Notice,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  formatDateTime,
  type AdminColumn,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminResource,
  useReconciliationFilters,
  useRefreshOnNonce,
  useToast,
} from './hooks';
import type {
  AdminPaymentProviderView,
  AdminReconciliationRun,
} from '../../../types/payment';
import {
  RECONCILIATION_RUN_STATUS_META,
  RECONCILIATION_RUN_STATUS_OPTIONS,
} from './constants';
import {
  instanceLabel,
  ninetyDaysAgo,
  providerLabel,
  yesterday,
} from './utils';
import { ReconciliationDetailDrawer } from './ReconciliationDetailDrawer';
import { ReconciliationToolbar } from './ReconciliationToolbar';

/**
 * 交易核对标签。
 *
 * 与旧版「人工导入账单 + 逐笔处置」是两种东西：
 *
 * 旧版让人上传渠道账单 CSV，逐条勾「已处理 / 已忽略」—— 处置动作只改数据库
 * 状态，钱一分没动，看板上却消失了。
 *
 * 新版由系统每天 10:15 自动下载交易流水并比对，发现「渠道已收款但本地没入账」
 * 会自动补单；失败可在同一账单日重新核对。**页面只展示结果，不提供改钱入口**。
 * 人工要处理的是「渠道重复扣款」「本地多记了一笔」这类真异常，走订单退款流程。
 *
 * 执行与筛选共用工具栏里的同一套收款来源 + 账单日（见 `ReconciliationToolbar`），
 * 执行成功后列表切到本次执行的条件。
 */

export function PaymentsReconciliationTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canReconcile = can('finance.reconcile');
  const canExport = can('data.export');

  const {
    data,
    loading,
    error,
    values: filterValues,
    updateFilter,
    applyFilters,
    resetFilters,
    replaceFilters,
    draftChanged,
    appliedChips,
    exporting,
    exportCsv,
    setPage,
    reload,
  } = useReconciliationFilters();

  const providers = useAdminResource(() => adminPaymentProvidersApi.list());

  // 刷新只重取当前筛选下的数据，筛选与分页都不动
  useRefreshOnNonce(refreshNonce, reload, providers.reload);

  // 执行区与筛选共用同一套条件，这里只保留弹窗开关
  const [runOpen, setRunOpen] = useState(false);

  // CSV / ZIP 兜底导入
  const [importOpen, setImportOpen] = useState(false);
  const [importProvider, setImportProvider] = useState<string>('');
  const [importInstance, setImportInstance] = useState<string>('');
  const [importBillDate, setImportBillDate] = useState<string>(yesterday());
  const [importFile, setImportFile] = useState<File | null>(null);

  const [detailId, setDetailId] = useAdminDetailParam('runId');
  const [busy, setBusy] = useState(false);

  const runs = data?.items ?? [];
  const runProvider = filterValues.providerId;
  const runProviderInstance = filterValues.providerInstanceId;
  const runBillDate = filterValues.billDate;
  const runProviderLabel = runProvider ? providerLabel(runProvider) : '所选收款来源';

  /** 可参与对账的分组：渠道支持账单下载，且至少有一个配置完整的实例。 */
  const reconcilableGroups = useMemo(
    () =>
      (providers.data?.items ?? [])
        .filter((provider) => provider.supportsReconciliation)
        .map((provider) => ({
          provider,
          instanceOptions: provider.instances
            .filter((instance) => instance.configured)
            .map((instance) => ({
              value: instance.instanceId,
              label: `${instanceLabel(instance)}${instance.enabled ? '' : '（已停用）'}`,
            })),
        }))
        .filter((group) => group.instanceOptions.length > 0),
    [providers.data],
  );

  const reconcilableProviders = useMemo(
    () =>
      reconcilableGroups.map((group) => ({
        value: group.provider.id,
        label: providerLabel(group.provider.id),
      })),
    [reconcilableGroups],
  );

  // URL 里的渠道 / 实例必须落在实时能力清单内；后端不支持对账或实例未配置时清掉。
  useEffect(() => {
    if (!providers.data || !filterValues.providerId) return;
    const group = reconcilableGroups.find(
      (item) => item.provider.id === filterValues.providerId,
    );
    if (!group) {
      replaceFilters({
        ...filterValues,
        providerId: undefined,
        providerInstanceId: undefined,
      });
      return;
    }
    if (
      filterValues.providerInstanceId &&
      !group.instanceOptions.some(
        (option) => option.value === filterValues.providerInstanceId,
      )
    ) {
      replaceFilters({ ...filterValues, providerInstanceId: undefined });
    }
  }, [
    filterValues,
    providers.data,
    reconcilableGroups,
    replaceFilters,
  ]);

  const selectedReconcilableGroup = reconcilableGroups.find(
    (group) => group.provider.id === runProvider,
  );
  const instanceOptions = selectedReconcilableGroup?.instanceOptions ?? [];
  const runInstance = selectedReconcilableGroup?.provider.instances.find(
    (instance) => instance.instanceId === runProviderInstance,
  );
  const runInstanceLabel = runInstance
    ? instanceLabel(runInstance)
    : (runProviderInstance ?? '所选通道');

  const importGroup = reconcilableGroups.find(
    (group) => group.provider.id === importProvider,
  );
  const importInstanceOptions = importGroup?.instanceOptions ?? [];

  const runInstanceText = (row: AdminReconciliationRun): string => {
    const provider = providers.data?.items.find(
      (item: AdminPaymentProviderView) => item.id === row.providerId,
    );
    const instance = provider?.instances.find(
      (item) => item.instanceId === row.providerInstanceId,
    );
    return instance ? instanceLabel(instance) : row.providerInstanceId;
  };

  const columns: Array<AdminColumn<AdminReconciliationRun>> = [
    {
      key: 'billDate',
      title: '账单日期',
      width: 110,
      render: (row) => <span className="tabular-nums">{row.billDate}</span>,
    },
    {
      key: 'provider',
      title: '收款来源 / 通道',
      width: 170,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate text-foreground">{providerLabel(row.providerId)}</div>
          <div
            className="truncate text-[12px] text-muted-foreground"
            title={`${runInstanceText(row)} · ${row.providerInstanceId}`}
          >
            {runInstanceText(row)}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (row) => {
        const meta = RECONCILIATION_RUN_STATUS_META[
          row.status as keyof typeof RECONCILIATION_RUN_STATUS_META
        ] ?? { label: row.status, tone: 'muted' as const };
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
      title: '自动补单',
      width: 90,
      render: (row) => (
        <span
          className={
            row.recoveredItems > 0 ? 'font-medium text-success-text tabular-nums' : 'tabular-nums'
          }
        >
          {row.recoveredItems}
        </span>
      ),
    },
    {
      key: 'errorItems',
      title: '待处理差异',
      width: 70,
      render: (row) => (
        <span
          className={
            row.errorItems > 0 ? 'font-medium text-danger-text tabular-nums' : 'tabular-nums'
          }
        >
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
          {formatDateTime(row.completedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 80,
      render: (row) => (
        <ActionButton onClick={() => setDetailId(row.id)} ariaLabel="查看交易核对明细">
          查看
        </ActionButton>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <ReconciliationToolbar
        values={filterValues}
        providerOptions={reconcilableProviders}
        instanceOptions={instanceOptions}
        statusOptions={RECONCILIATION_RUN_STATUS_OPTIONS}
        minBillDate={ninetyDaysAgo()}
        maxBillDate={yesterday()}
        canReconcile={canReconcile}
        onChange={updateFilter}
        onApply={applyFilters}
        onReset={resetFilters}
        onRun={() => setRunOpen(true)}
        onOpenImport={() => {
          const defaultGroup =
            selectedReconcilableGroup ?? reconcilableGroups[0];
          setImportProvider(defaultGroup?.provider.id ?? '');
          setImportInstance(
            defaultGroup?.instanceOptions.find(
              (option) => option.value === runProviderInstance,
            )?.value ??
              defaultGroup?.instanceOptions[0]?.value ??
              '',
          );
          setImportBillDate(runBillDate || yesterday());
          setImportFile(null);
          setImportOpen(true);
        }}
        onExport={exportCsv}
        exporting={exporting}
        exportDisabled={!canExport || loading || !data || data.total === 0}
        appliedChips={appliedChips}
      />

      {providers.error && (
        <Notice tone="danger" title="收款来源加载失败">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {providers.error}。开始核对、导入与收款来源筛选暂不可用。
            </span>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => void providers.reload()}
            >
              重试
            </ActionButton>
          </div>
        </Notice>
      )}

      {draftChanged && (
        <p className="text-xs text-warn-text">筛选条件已修改，请点击「查询」以应用。</p>
      )}

      <Panel
        title="交易核对记录"
        note="系统每天 10:15 后自动核对昨日交易；发现已付款未入账会自动补单，失败可在同一账单日重新核对"
      >
        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable
          rows={runs}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={data ? null : error}
          onRetry={() => void reload()}
          emptyText={
            appliedChips.length > 0
              ? '当前筛选下没有交易核对记录，清除筛选后再试'
              : '还没有交易核对记录'
          }
          emptyAction={
            appliedChips.length > 0 ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          minWidth={960}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 30,
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <ConfirmDialog
        open={runOpen}
        title="开始交易核对"
        description={`系统会下载${runProviderLabel} · ${runInstanceLabel} 在 ${runBillDate || '—'} 的交易流水，并与本地支付记录比对。若发现渠道已收款但本地未入账，会自动补单。`}
        impact={[
          '下载并比对收款交易流水',
          '发现已付款未入账的订单会自动补单',
          '同一账单日重复核对会新增一条记录',
        ]}
        confirmText="确认执行"
        loading={busy}
        onCancel={() => setRunOpen(false)}
        onConfirm={async () => {
          const providerId = selectedReconcilableGroup?.provider.id;
          if (!providerId || !runProviderInstance || !runBillDate) return;
          setBusy(true);
          try {
            const result = await adminPaymentReconciliationApi.run({
              providerId,
              providerInstanceId: runProviderInstance,
              billDate: runBillDate,
            });
            toast.success(
              result.reused
                ? '该账单日已有一次成功的核对记录，已复用'
                : '交易核对已完成',
            );
            setRunOpen(false);
            // 执行条件与列表筛选同源：成功后把列表切到本次执行的渠道 + 账单日
            applyFilters();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '核对失败');
          } finally {
            setBusy(false);
          }
        }}
      />

      <ConfirmDialog
        open={importOpen}
        title="导入交易流水"
        description="自动获取流水失败时的兜底入口。导入后仍会逐笔核对，不一致的记录会进入待处理差异。"
        impact={['按商户订单号与本地订单比对', '支付宝支持 ZIP 内的 CSV', '超过 10000 行会拒绝导入']}
        confirmText="确认导入"
        confirmDisabled={
          !importFile || !importProvider || !importInstance || !importBillDate
        }
        loading={busy}
        onCancel={() => setImportOpen(false)}
        onConfirm={async () => {
          const providerId = importGroup?.provider.id;
          if (!importFile || !providerId || !importInstance || !importBillDate) return;
          setBusy(true);
          try {
            await adminPaymentReconciliationApi.importCsv(importFile, {
              providerId,
              providerInstanceId: importInstance,
              billDate: importBillDate,
            });
            toast.success('交易流水已导入');
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
            <FormField label="收款来源" required>
              <SelectField
                value={importProvider || undefined}
                onChange={(value) => {
                  setImportProvider(value ?? '');
                  setImportInstance('');
                }}
                options={reconcilableProviders}
                placeholder="选择收款来源"
                ariaLabel="导入收款来源"
              />
            </FormField>
            <FormField label="收款通道" required>
              <SelectField
                value={importInstance || undefined}
                onChange={(value) => setImportInstance(value ?? '')}
                options={importInstanceOptions}
                placeholder={importProvider ? '选择通道' : '先选收款来源'}
                ariaLabel="导入收款通道"
                disabled={!importProvider}
              />
            </FormField>
            <FormField label="账单日期" required hint="最早 90 天前，最晚昨天">
              <DateField
                value={importBillDate}
                onChange={setImportBillDate}
                ariaLabel="导入账单日期"
                minDate={ninetyDaysAgo()}
                maxDate={yesterday()}
              />
            </FormField>
            <FormField
              label="交易流水文件"
              required
              hint={importProvider === 'alipay' ? 'CSV，或支付宝导出的 ZIP' : 'CSV'}
            >
              <FilePicker
                file={importFile}
                accept={importProvider === 'alipay' ? '.csv,.zip' : '.csv'}
                onPick={setImportFile}
                onClear={() => setImportFile(null)}
                label="选择交易流水"
                hint={importProvider === 'alipay' ? 'CSV / ZIP' : 'CSV'}
              />
            </FormField>
          </div>
        }
      />

      {detailId && (
        <ReconciliationDetailDrawer runId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
