import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button } from '../../admin-ui/shadcn/kit';
import { adminInvoicesApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { SelectBox, TextInput } from '../../admin-ui/controls';
import {
  AdminStaleError,
  ConfirmAction,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { adminOrderDetailHref, adminUserHref } from '../../lib/admin-links';
import type { AdminInvoice, InvoiceStatus } from '../../types/api';

/**
 * 发票审核与开具。
 *
 * 三条业务约束决定了这一页的形状:
 *
 * 1. **一单一票** —— 发票号在申请时就已占用, 驳回不释放 (用户重新申请会开新票号)。
 *    所以列表按发票行展示而非按订单, 同一订单最多出现一条。
 * 2. **开具不可逆** —— 票号与抬头一旦印出无法回收, 因此「开具」走高风险确认弹窗,
 *    必须填原因并写入操作审计。
 * 3. **金额是快照** —— 展示的是申请时算出的 `paidCents - refundedCents`,
 *    不随后续退款变化。运营若要冲红, 必须走线下流程, 这一页不提供。
 */

const STATUS_OPTIONS: Array<{ value: InvoiceStatus; label: string }> = [
  { value: 'pending', label: '待开具' },
  { value: 'issued', label: '已开具' },
  { value: 'rejected', label: '已驳回' },
];

const KIND_LABELS: Record<string, string> = {
  personal: '个人',
  company: '企业',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待开具',
  issued: '已开具',
  rejected: '已驳回',
};

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function AdminInvoicesPage() {
  const toast = useToast();
  const { can } = useAdmin();

  // 深链/刷新后保留筛选: 财务之间传「待开具的这批」直接发地址。
  // 初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const initialStatus: InvoiceStatus | undefined =
    rawStatus === 'pending' || rawStatus === 'issued' || rawStatus === 'rejected'
      ? rawStatus
      : undefined;
  const initialKeyword = searchParams.get('keyword') ?? '';

  const [status, setStatus] = useState<InvoiceStatus | undefined>(initialStatus);
  const [keyword, setKeyword] = useState(initialKeyword);

  const [action, setAction] = useState<{ kind: 'issue' | 'reject'; row: AdminInvoice } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<{ items: AdminInvoice[]; total: number }>(fetcher, {
      status: initialStatus,
      keyword: initialKeyword || undefined,
    });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    keyword: params.keyword as string | undefined,
  });

  const hasFilter = Boolean(status || keyword);

  const applyQuery = () =>
    setQuery({ status, keyword: keyword.trim() || undefined });

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
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminInvoicesApi.exportCsv({
        status: params.status as InvoiceStatus | undefined,
        keyword: params.keyword as string | undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const openAction = (kind: 'issue' | 'reject', row: AdminInvoice) => {
    setAction({ kind, row });
    setReason('');
  };

  const runAction = async () => {
    if (!action) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写说明，它会写入操作审计');
      return;
    }
    setBusy(true);
    try {
      if (action.kind === 'issue') {
        const r = await adminInvoicesApi.issue(action.row.id, trimmed);
        toast.success(`已开具 ${r.invoiceNo}`);
      } else {
        await adminInvoicesApi.reject(action.row.id, trimmed);
        toast.success('已驳回，原因会展示给用户');
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
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <code className="font-mono text-[11px] text-text-primary">{row.invoiceNo}</code>
          <span className="text-[11px] text-text-tertiary">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
      ),
    },
    {
      key: 'orderNo',
      title: '订单号',
      width: 180,
      render: (row) => (
        <Link className="text-accent-600 hover:underline" to={adminOrderDetailHref(row.orderId)}>
          <code className="font-mono text-[11px]">{row.orderNo ?? row.orderId}</code>
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
          <span className="text-[11px] text-text-tertiary">
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
            <span className="text-[11px] text-text-tertiary">
              {' '}
              · {KIND_LABELS[row.kind] ?? row.kind}
            </span>
          </span>
          {row.taxNo && (
            <code className="font-mono text-[11px] text-text-tertiary">{row.taxNo}</code>
          )}
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
      width: 110,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <StatusTag status={row.status} label={STATUS_LABELS[row.status]} />
          {row.status === 'rejected' && row.rejectReason && (
            <span className="text-[11px] text-text-tertiary">{row.rejectReason}</span>
          )}
        </div>
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 170,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          {/* 只有待开具的票可操作: 已开具不可逆, 已驳回不复活 (用户需重新申请) */}
          {row.status === 'pending' && can('invoice.write') && (
            <>
              <Button variant="ghost" size="small" onClick={() => openAction('issue', row)}>
                开具
              </Button>
              <Button variant="ghost" size="small" onClick={() => openAction('reject', row)}>
                驳回
              </Button>
            </>
          )}
          {row.hasStoredFile && (
            <Button
              variant="ghost"
              size="small"
              onClick={() => void adminInvoicesApi.preview(row.id).catch((e: Error) => toast.error(e.message))}
            >
              预览
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="发票管理"
        description="审核并开具用户申请的开票。一单一票，开具后不可撤销，操作全程写入审计。"
        actions={
          can('data.export') ? (
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <SelectBox
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={(value) => setStatus(value as InvoiceStatus | undefined)}
          options={STATUS_OPTIONS}
        />
        <TextInput
          className="w-64"
          placeholder="发票号 / 订单号 / 抬头"
          value={keyword}
          onChange={setKeyword}
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

      <Panel title="开票申请" note="默认展示全部，按状态与关键字筛选">
        <AdminDataTable<AdminInvoice>
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1060}
          emptyText={hasFilter ? '没有符合条件的开票申请。' : '还没有开票申请。'}
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="small" onClick={reset}>
                清除筛选
              </Button>
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
        <ConfirmAction
          open
          title={action.kind === 'issue' ? '开具发票' : '驳回开票申请'}
          confirmText={action.kind === 'issue' ? '确认开具' : '确认驳回'}
          danger={action.kind === 'reject'}
          loading={busy}
          onCancel={() => setAction(null)}
          onConfirm={() => void runAction()}
          description={
            action.kind === 'issue' ? (
              <>
                <p>将为该申请生成正式票号并输出可打印发票文件，同时邮件通知用户。</p>
                <p className="text-[11px] text-text-tertiary">
                  {action.row.invoiceNo} · {action.row.title} · ¥ {yuan(action.row.amountCents)}
                </p>
              </>
            ) : (
              <>
                <p>驳回后用户会看到驳回原因，可重新提交申请（将占用新的票号）。</p>
                <p className="text-[11px] text-text-tertiary">
                  {action.row.invoiceNo} · {action.row.title} · ¥ {yuan(action.row.amountCents)}
                </p>
              </>
            )
          }
          impact={
            action.kind === 'issue'
              ? [`发票 ${action.row.invoiceNo} → 已开具`, '生成可打印文件', '写操作审计（含操作人）']
              : [`发票 ${action.row.invoiceNo} → 已驳回`, '用户可重新申请', '写操作审计（含操作人）']
          }
          extra={
            <div className="flex flex-col gap-1.5">
              <label htmlFor="adm-invoice-reason" className="text-xs text-text-secondary">
                {action.kind === 'issue' ? '开具说明（强制，写入审计）：' : '驳回原因（会展示给用户）：'}
              </label>
              <TextInput
                ariaLabel="说明"
                value={reason}
                onChange={setReason}
                placeholder={action.kind === 'issue' ? '如：已按申请抬头开具' : '如：抬头与税号不一致，请修改后重提'}
                maxLength={300}
              />
            </div>
          }
        />
      )}
    </>
  );
}
