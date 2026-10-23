import { useCallback, useState } from 'react';
import { App, Button, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminInvoicesApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  ConfirmAction,
  adminPagination,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
} from '../../components/admin/PageHeader';
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
  const { message } = App.useApp();
  const { can } = useAdmin();

  const [status, setStatus] = useState<InvoiceStatus | undefined>();
  const [keyword, setKeyword] = useState('');

  const [action, setAction] = useState<{ kind: 'issue' | 'reject'; row: AdminInvoice } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

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
    useAdminList<{ items: AdminInvoice[]; total: number }>(fetcher);

  const applyQuery = () =>
    setQuery({ status, keyword: keyword.trim() || undefined });

  const reset = () => {
    setStatus(undefined);
    setKeyword('');
    setQuery({ status: undefined, keyword: undefined });
  };

  const openAction = (kind: 'issue' | 'reject', row: AdminInvoice) => {
    setAction({ kind, row });
    setReason('');
  };

  const runAction = async () => {
    if (!action) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      void message.warning('请填写说明，它会写入操作审计');
      return;
    }
    setBusy(true);
    try {
      if (action.kind === 'issue') {
        const r = await adminInvoicesApi.issue(action.row.id, trimmed);
        void message.success(`已开具 ${r.invoiceNo}`);
      } else {
        await adminInvoicesApi.reject(action.row.id, trimmed);
        void message.success('已驳回，原因会展示给用户');
      }
      setAction(null);
      reload();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminInvoice> = [
    {
      title: '发票号',
      key: 'invoiceNo',
      width: 180,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <code>{row.invoiceNo}</code>
          <span className="adm-cell-sub">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>
        </div>
      ),
    },
    {
      title: '订单号',
      key: 'orderNo',
      width: 180,
      render: (_: unknown, row) => <code className="adm-cell-sub">{row.orderNo ?? row.orderId}</code>,
    },
    {
      title: '用户',
      key: 'user',
      width: 190,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          {row.userName && <span>{row.userName}</span>}
          <span className="adm-cell-sub">{row.userEmail ?? '—'}</span>
        </div>
      ),
    },
    {
      title: '抬头',
      key: 'title',
      width: 200,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>
            {row.title}
            <span className="adm-cell-sub"> · {KIND_LABELS[row.kind] ?? row.kind}</span>
          </span>
          {row.taxNo && <code className="adm-cell-sub">{row.taxNo}</code>}
        </div>
      ),
    },
    {
      title: '金额',
      key: 'amount',
      width: 120,
      render: (_: unknown, row) => `¥ ${yuan(row.amountCents)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: string, row) => (
        <div className="adm-cell-stack">
          <StatusTag status={v} label={STATUS_LABELS[v]} />
          {row.status === 'rejected' && row.rejectReason && (
            <span className="adm-cell-sub">{row.rejectReason}</span>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'ops',
      width: 170,
      render: (_: unknown, row) => (
        <div className="adm-ops">
          {/* 只有待开具的票可操作: 已开具不可逆, 已驳回不复活 (用户需重新申请) */}
          {row.status === 'pending' && can('invoice.write') && (
            <>
              <Button type="link" className="adm-link" onClick={() => openAction('issue', row)}>
                开具
              </Button>
              <Button
                type="link" danger
                className="adm-link is-danger"
                onClick={() => openAction('reject', row)}
              >
                驳回
              </Button>
            </>
          )}
          {row.hasStoredFile && (
            <Button
              type="link"
              className="adm-link"
              onClick={() => void adminInvoicesApi.preview(row.id).catch((e: Error) => message.error(e.message))}
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
      />

      <FilterBar>
        <Select
          className="adm-filter-select"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <Input
          className="adm-filter-input"
          placeholder="发票号 / 订单号 / 抬头"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
        />
        <FilterActions>
          <Button type="primary" className="adm-btn is-primary" onClick={applyQuery}>
            查询
          </Button>
          <Button type="default" className="adm-btn" onClick={reset}>
            重置
          </Button>
        </FilterActions>
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel title="开票申请" note="默认展示全部，按状态与关键字筛选">
        {loading && !data ? (
          <AdminListLoading tip="加载发票…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (data?.items.length ?? 0) === 0 ? (
          <AdminEmpty description="没有符合条件的开票申请。" />
        ) : (
          <Table<AdminInvoice>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            scroll={{ x: 1060 }}
            pagination={adminPagination({
              current: (params.page as number) || 1,
              pageSize: (params.pageSize as number) || 20,
              total: data?.total ?? 0,
              onChange: setPage,
            })}
          />
        )}
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
                <p className="adm-cell-sub">
                  {action.row.invoiceNo} · {action.row.title} · ¥ {yuan(action.row.amountCents)}
                </p>
              </>
            ) : (
              <>
                <p>驳回后用户会看到驳回原因，可重新提交申请（将占用新的票号）。</p>
                <p className="adm-cell-sub">
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
            <div className="adm-confirm-typing">
              <label htmlFor="adm-invoice-reason">
                {action.kind === 'issue' ? '开具说明（强制，写入审计）：' : '驳回原因（会展示给用户）：'}
              </label>
              <Input
                id="adm-invoice-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={action.kind === 'issue' ? '如：已按申请抬头开具' : '如：抬头与税号不一致，请修改后重提'}
                maxLength={300}
                autoComplete="off"
              />
            </div>
          }
        />
      )}
    </>
  );
}
