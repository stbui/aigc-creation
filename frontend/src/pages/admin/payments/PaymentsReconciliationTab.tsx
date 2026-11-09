import { useMemo, useState } from 'react';
import { adminPaymentProvidersApi, adminPaymentReconciliationApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmDialog,
  DateField,
  FilePicker,
  FormField,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  formatShanghaiDateTime,
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
  PaymentProviderId,
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
 *
 * 执行与筛选共用工具栏里的同一套渠道 + 账单日（见 `ReconciliationToolbar`），
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
  const runProviderLabel = runProvider ? providerLabel(runProvider) : '所选渠道';

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

  const selectedReconcilableGroup = reconcilableGroups.find(
    (group) => group.provider.id === runProvider,
  );
  const instanceOptions = selectedReconcilableGroup?.instanceOptions ?? [];
  const runInstance = selectedReconcilableGroup?.provider.instances.find(
    (instance) => instance.instanceId === runProviderInstance,
  );
  const runInstanceLabel = runInstance
    ? instanceLabel(runInstance)
    : (runProviderInstance ?? '所选实例');

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
      title: '渠道 / 实例',
      width: 170,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate text-foreground">{providerLabel(row.providerId)}</div>
          <div
            className="truncate text-[11px] text-muted-foreground"
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
      title: '自动补发',
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
      title: '异常',
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
          {formatShanghaiDateTime(row.completedAt)}
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

      {draftChanged && (
        <p className="text-xs text-warn-text">筛选条件已修改，请点击「查询」以应用。</p>
      )}

      <Panel
        title="对账运行"
        note="系统每天 10:15 后自动对账昨日账单；渠道账单自动下载比对，异常项会补发积分，失败可在同一账单日重跑"
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
            appliedChips.length > 0 ? '当前筛选下没有对账记录，清除筛选后再试' : '还没有对账记录'
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
        title="执行对账"
        description={`系统会向${runProviderLabel} / ${runInstanceLabel} 下载 ${runBillDate || '—'} 的交易流水并与本地支付记录比对。若发现渠道已收款但本地未入账，会幂等补发积分。`}
        impact={[
          '下载并比对渠道账单',
          '发现已支付未入账的订单会自动补发积分',
          '同一账单日重复执行会新增一次运行记录',
        ]}
        confirmText="确认执行"
        loading={busy}
        onCancel={() => setRunOpen(false)}
        onConfirm={async () => {
          if (!runProvider || !runProviderInstance || !runBillDate) return;
          setBusy(true);
          try {
            const result = await adminPaymentReconciliationApi.run({
              providerId: runProvider as PaymentProviderId,
              providerInstanceId: runProviderInstance,
              billDate: runBillDate,
            });
            toast.success(
              result.reused ? '该账单日已有一次成功的运行记录，已复用' : '对账已执行完成',
            );
            setRunOpen(false);
            // 执行条件与列表筛选同源：成功后把列表切到本次执行的渠道 + 账单日
            applyFilters();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '执行失败');
          } finally {
            setBusy(false);
          }
        }}
      />

      <ConfirmDialog
        open={importOpen}
        title="导入对账单"
        description="渠道账单接口不可用时的兜底入口。导入后仍会逐笔核对，不一致的行进入差异列表。"
        impact={['按商户订单号与本地订单比对', '支付宝支持 ZIP 内的 CSV', '超过 10000 行会拒绝导出']}
        confirmText="确认导入"
        confirmDisabled={
          !importFile || !importProvider || !importInstance || !importBillDate
        }
        loading={busy}
        onCancel={() => setImportOpen(false)}
        onConfirm={async () => {
          if (!importFile || !importProvider || !importInstance || !importBillDate) return;
          setBusy(true);
          try {
            await adminPaymentReconciliationApi.importCsv(importFile, {
              providerId: importProvider as PaymentProviderId,
              providerInstanceId: importInstance,
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
                onChange={(value) => {
                  setImportProvider(value ?? '');
                  setImportInstance('');
                }}
                options={reconcilableProviders}
                placeholder="选择渠道"
                ariaLabel="导入对账渠道"
              />
            </FormField>
            <FormField label="服务商实例" required>
              <SelectField
                value={importInstance || undefined}
                onChange={(value) => setImportInstance(value ?? '')}
                options={importInstanceOptions}
                placeholder={importProvider ? '选择实例' : '先选渠道'}
                ariaLabel="导入对账服务商实例"
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
              label="对账单文件"
              required
              hint={importProvider === 'alipay' ? 'CSV，或支付宝导出的 ZIP' : 'CSV'}
            >
              <FilePicker
                file={importFile}
                accept={importProvider === 'alipay' ? '.csv,.zip' : '.csv'}
                onPick={setImportFile}
                onClear={() => setImportFile(null)}
                label="选择对账单"
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
