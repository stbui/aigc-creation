import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  RefreshButton,
  AdminDataTable,
  Drawer,
  ListError,
  Notice,
  SelectField,
  StaleError,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { adminPaymentReconciliationApi } from './api';
import { useAdmin, useAdminResource, useToast } from './hooks';
import { adminOrderDetailHref, moneyText } from './utils';
import { RECONCILIATION_RESULT_LABELS, type AdminReconciliationItem } from '../../../types/payment';

/** 交易核对明细抽屉。 */
export function ReconciliationDetailDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
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
      render: (row) =>
        row.orderId ? (
          <Link
            className="font-mono text-[12px] text-brand hover:underline"
            to={adminOrderDetailHref(row.orderId)}
            title="在订单管理中打开"
          >
            {row.merchantOrderNo}
          </Link>
        ) : (
          <code className="font-mono text-[12px]">{row.merchantOrderNo}</code>
        ),
    },
    {
      key: 'providerTradeNo',
      title: '收款交易号',
      width: 200,
      render: (row) => <code className="font-mono text-[12px]">{row.providerTradeNo ?? '—'}</code>,
    },
    {
      key: 'amount',
      title: '金额',
      width: 110,
      render: (row) => <span className="tabular-nums">{moneyText(row.amountCents, row.currency)}</span>,
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
      onClose={onClose}
      title="交易核对明细"
      description="差异由系统自动比对得出；需要人工处理的资金问题请到订单管理跟进"
      size="xl"
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
          <RefreshButton variant="default" onRefresh={reload} />
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

        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        {error && !data ? (
          <ListError error={error} onRetry={() => void reload()} />
        ) : (
          <AdminDataTable
            rows={items}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            emptyText="当前没有差异记录"
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
          核对发现「渠道已收款但本地未入账」时系统会自动补单；重复扣款等资金异常请到
          <Link className="text-brand hover:underline" to="/admin/orders">
            订单管理
          </Link>
          走退款流程。
        </Notice>
      </div>
    </Drawer>
  );
}
