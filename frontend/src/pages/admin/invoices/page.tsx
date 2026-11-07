import { useCallback, useState } from 'react';
import { STATUS_OPTIONS, KIND_LABELS, STATUS_LABELS } from './constants';
import { yuan } from './utils';
import { useAdmin, useToast, useAdminList, useAdminUrlFilterSync } from './hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { adminInvoicesApi } from './api';

import {
  ActionButton,
  ExportCsvButton,
  useAdminExport,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  ConfirmDialog,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  RefreshButton,
  SelectField,
  StatusTag,
  StaleError,
  TextField,
  formatDateTimeLoose,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { adminOrderDetailHref, adminUserHref } from '../../../lib/admin-links';
import type { AdminInvoice, InvoiceStatus } from '../../../types/api';

/**
 * 发票审核与开具。
 *
 * 三条业务约束决定了这一页的形状:
 *
 * 1. **一单一张有效票** —— 发票号在申请时就已占用, 驳回后重提会生成新票号。
 *    列表按发票行展示并保留完整历史, 同一订单同一时刻最多一张有效票。
 * 2. **开具不可逆** —— 票号与抬头一旦印出无法回收, 因此「开具」走高风险确认弹窗。
 *    已开具发票只能做冲红登记, 且必须填写原因并写入操作审计。
 * 3. **金额是快照** —— 展示的是申请时算出的 `paidCents - refundedCents`,
 *    不随后续退款变化。冲红登记只固化台账, 线下税务手续仍由财务完成。
 */

export function AdminInvoicesPage() {
  const toast = useToast();
  const { can } = useAdmin();

  // 深链/刷新后保留筛选: 财务之间传「待开具的这批」直接发地址。
  // 初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const initialStatus: InvoiceStatus | undefined =
    rawStatus === 'pending' || rawStatus === 'issued' || rawStatus === 'rejected' || rawStatus === 'red_flushed'
      ? rawStatus
      : undefined;
  const initialKeyword = searchParams.get('keyword') ?? '';

  const [status, setStatus] = useState<InvoiceStatus | undefined>(initialStatus);
  const [keyword, setKeyword] = useState(initialKeyword);

  const [action, setAction] = useState<{
    kind: 'issue' | 'reject' | 'redFlush';
    row: AdminInvoice;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { exporting, runExport } = useAdminExport(toast);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminInvoicesApi.list({
        status: params.status as InvoiceStatus | undefined,
        keyword: params.keyword as string | undefined,
        limit: params.pageSize as number,
        offset: ((params.page as number) - 1) * (params.pageSize as number),
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<{
    items: AdminInvoice[];
    total: number;
  }>(fetcher, {
    status: initialStatus,
    keyword: initialKeyword || undefined,
  });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    keyword: params.keyword as string | undefined,
  });

  const hasFilter = Boolean(params.status || params.keyword);
  const rows = data?.items ?? [];

  const applyQuery = () => setQuery({ status, keyword: keyword.trim() || undefined });

  const reset = () => {
    setStatus(undefined);
    setKeyword('');
    setQuery({ status: undefined, keyword: undefined });
  };

  const appliedStatus = params.status as InvoiceStatus | undefined;
  const appliedKeyword = (params.keyword as string | undefined) ?? '';
  const appliedChips: AppliedFilter[] = [
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_LABELS[appliedStatus] ?? appliedStatus}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedKeyword
      ? {
          key: 'keyword',
          label: `关键词：${appliedKeyword}`,
          onClear: () => {
            setKeyword('');
            setQuery({ keyword: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  /** 导出走已生效的筛选条件 —— 必须与屏幕上的列表同口径 */
  const exportCsv = () =>
    runExport(
      () =>
        adminInvoicesApi.exportCsv({
          status: params.status as InvoiceStatus | undefined,
          keyword: params.keyword as string | undefined,
        }),
      '导出已开始下载',
    );

  const openAction = (kind: 'issue' | 'reject' | 'redFlush', row: AdminInvoice) => {
    setAction({ kind, row });
    setReason('');
  };

  const runAction = async () => {
    if (!action) return;
    const trimmed = reason.trim();
    if (action.kind !== 'issue' && !trimmed) {
      toast.warning(action.kind === 'reject' ? '请填写驳回原因' : '请填写冲红原因');
      return;
    }
    setBusy(true);
    try {
      if (action.kind === 'issue') {
        const r = await adminInvoicesApi.issue(action.row.id);
        toast.success(`已开具 ${r.invoiceNo}`);
      } else if (action.kind === 'reject') {
        await adminInvoicesApi.reject(action.row.id, trimmed);
        toast.success('已驳回，原因会展示给用户');
      } else {
        await adminInvoicesApi.redFlush(action.row.id, trimmed);
        toast.success('已登记冲红，发票历史与原因已保留');
      }
      setAction(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminInvoice>> = [
    {
      key: 'invoiceNo',
      title: '发票号',
      width: 190,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <code className="font-mono font-medium text-foreground">{row.invoiceNo}</code>
          <span className="text-muted-foreground">{formatDateTimeLoose(row.createdAt)}</span>
        </div>
      ),
    },
    {
      key: 'orderNo',
      title: '订单号',
      width: 190,
      render: (row) => (
        <Link className="text-brand hover:underline" to={adminOrderDetailHref(row.orderId)}>
          <code className="font-mono">{row.orderNo ?? row.orderId}</code>
        </Link>
      ),
    },
    {
      key: 'user',
      title: '用户',
      width: 190,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          {row.userName && <span>{row.userName}</span>}
          <span className="text-muted-foreground">
            {row.userEmail ? (
              <Link className="hover:underline" to={adminUserHref(row.userEmail)}>
                {row.userEmail}
              </Link>
            ) : (
              '—'
            )}
          </span>
        </div>
      ),
    },
    {
      key: 'title',
      title: '抬头',
      width: 200,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>
            {row.title}
            <span className="text-muted-foreground"> · {KIND_LABELS[row.kind] ?? row.kind}</span>
          </span>
          {row.taxNo && <code className="font-mono text-muted-foreground">{row.taxNo}</code>}
        </div>
      ),
    },
    {
      key: 'amount',
      title: '金额',
      width: 120,
      align: 'right',
      render: (row) => <span className="tabular-nums">¥ {yuan(row.amountCents)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 200,
      render: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <StatusTag status={row.status} label={STATUS_LABELS[row.status]} />
          {row.status === 'rejected' && row.rejectReason && (
            <span className="line-clamp-1 text-muted-foreground" title={row.rejectReason}>
              {row.rejectReason}
            </span>
          )}
          {row.status === 'red_flushed' && (
            <span
              className="line-clamp-1 text-muted-foreground"
              title={row.redFlushReason ?? undefined}
            >
              {row.redFlushReason ?? '未填写冲红原因'}
              {row.redFlushedAt ? ` · ${formatDateTimeLoose(row.redFlushedAt)}` : ''}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 170,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          {/* 已开具只能登记冲红；已驳回需用户重新申请，不能原地复活 */}
          {row.status === 'pending' && can('invoice.write') && (
            <>
              <ActionButton variant="ghost" size="sm" onClick={() => openAction('issue', row)}>
                开具
              </ActionButton>
              <ActionButton variant="ghost" size="sm" onClick={() => openAction('reject', row)}>
                驳回
              </ActionButton>
            </>
          )}
          {row.status === 'issued' && can('invoice.write') && (
            <ActionButton variant="ghost" size="sm" onClick={() => openAction('redFlush', row)}>
              冲红登记
            </ActionButton>
          )}
          {(row.status === 'issued' || row.status === 'red_flushed') && (
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => void adminInvoicesApi.preview(row.id).catch((e: Error) => toast.error(e.message))}
            >
              预览
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="发票管理"
        description="审核并开具用户申请的开票。保留历史记录，已开具发票只能登记冲红，操作全程写入审计。"
      />

      <FilterBar>
        <SelectField
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="全部状态"
          clearLabel="全部状态"
          allowClear
          value={status}
          onChange={(value) => setStatus(value as InvoiceStatus | undefined)}
          options={STATUS_OPTIONS}
        />
        <ClearableField
          className="w-64"
          ariaLabel="按发票号或抬头搜索"
          placeholder="发票号 / 订单号 / 抬头"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyQuery}
        />
        <FilterActions>
          <ActionButton variant="default" size="sm" onClick={applyQuery}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" size="sm" onClick={reset}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      <Panel
        title="开票申请"
        note="默认展示全部，按状态与关键字筛选"
        extra={
          <>
            {can('data.export') && <ExportCsvButton exporting={exporting} onExport={exportCsv} />}
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <AdminDataTable<AdminInvoice>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={reload}
          minWidth={1180}
          emptyText={hasFilter ? '没有符合条件的开票申请。' : '还没有开票申请。'}
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={reset}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={{
            current: (params.page as number) || 1,
            pageSize: (params.pageSize as number) || 20,
            total: data?.total ?? 0,
            onChange: setPage,
          }}
        />
      </Panel>

      {action && (
        <ConfirmDialog
          open
          title={action.kind === 'issue' ? '开具发票' : action.kind === 'reject' ? '驳回开票申请' : '登记发票冲红'}
          confirmText={action.kind === 'issue' ? '确认开具' : action.kind === 'reject' ? '确认驳回' : '确认冲红'}
          danger={action.kind !== 'issue'}
          loading={busy}
          onCancel={() => setAction(null)}
          onConfirm={() => void runAction()}
          description={
            action.kind === 'issue' ? (
              <>
                <p>将为该申请生成正式票号并输出可打印发票文件，同时邮件通知用户。</p>
                <p className="text-[12px] text-muted-foreground">
                  {action.row.invoiceNo} · {action.row.title} · ¥ {yuan(action.row.amountCents)}
                </p>
              </>
            ) : action.kind === 'reject' ? (
              <>
                <p>驳回后用户会看到驳回原因，可重新提交申请（将占用新的票号）。</p>
                <p className="text-[12px] text-muted-foreground">
                  {action.row.invoiceNo} · {action.row.title} · ¥ {yuan(action.row.amountCents)}
                </p>
              </>
            ) : (
              <>
                <p>将发票登记为已冲红，并固化操作人、时间与原因。当前系统不直连税务平台， 线下冲红手续仍需财务完成。</p>
                <p className="text-[12px] text-muted-foreground">
                  {action.row.invoiceNo} · {action.row.title} · ¥ {yuan(action.row.amountCents)}
                </p>
              </>
            )
          }
          impact={
            action.kind === 'issue'
              ? [`发票 ${action.row.invoiceNo} → 已开具`, '生成可打印文件', '写操作审计（含操作人）']
              : action.kind === 'reject'
                ? [`发票 ${action.row.invoiceNo} → 已驳回`, '用户可重新申请', '写操作审计（含操作人）']
                : [
                    `发票 ${action.row.invoiceNo} → 已冲红`,
                    '保留开具与冲红历史，不可重新申请',
                    '写操作审计（含操作人、时间与原因）',
                  ]
          }
          extra={
            action.kind !== 'issue' ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="adm-invoice-reason" className="text-xs text-muted-foreground">
                  {action.kind === 'reject' ? '驳回原因（会展示给用户）：' : '冲红原因（写入审计与冲红记录）：'}
                </label>
                <TextField
                  id="adm-invoice-reason"
                  ariaLabel={action.kind === 'reject' ? '驳回原因' : '冲红原因'}
                  value={reason}
                  onChange={setReason}
                  placeholder={
                    action.kind === 'reject' ? '如：抬头与税号不一致，请修改后重提' : '如：用户退费，对应发票需冲红'
                  }
                  maxLength={300}
                />
              </div>
            ) : undefined
          }
        />
      )}
    </>
  );
}
