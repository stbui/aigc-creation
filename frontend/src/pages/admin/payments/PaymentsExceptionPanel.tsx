import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminPaymentExceptionsApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmDialog,
  FormField,
  ListError,
  Notice,
  Panel,
  StaleError,
  StatusTag,
  TextAreaField,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import type { AdminPaymentException, PaymentExceptionStatus } from '../../../types/payment';
import { ORDER_PROVIDERS, PROVIDER_LABELS } from './constants';
import { moneyText } from './utils';
import { PaymentsExceptionFilterPanel } from './PaymentsExceptionFilterPanel';

const STATUS_META: Record<
  PaymentExceptionStatus,
  { label: string; tone: 'success' | 'danger' | 'warn' | 'brand' | 'muted' }
> = {
  open: { label: '待处理', tone: 'warn' },
  auto_refund_pending: { label: '退款处理中', tone: 'brand' },
  refunded: { label: '已退款', tone: 'success' },
  manual_review: { label: '需人工核对', tone: 'danger' },
  closed: { label: '已结案', tone: 'muted' },
};

const KIND_LABELS: Record<string, string> = {
  cancelled_but_paid: '已取消仍扣款',
  refund_failed: '退款失败',
  refund_processing: '退款异步处理中',
  auto_reconcile_failed: '自动对账失败',
  local_order_not_found: '本地订单缺失',
  provider_record_missing: '渠道流水缺失',
  amount_mismatch: '金额不一致',
  trade_no_mismatch: '交易号不一致',
  duplicate_charge: '疑似重复扣款',
  credit_failed: '补发积分失败',
};

const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '普通' },
];

type ConfirmAction = 'retry' | 'close';

function statusMeta(status: string) {
  return (
    STATUS_META[status as PaymentExceptionStatus] ?? {
      label: status,
      tone: 'muted' as const,
    }
  );
}

export function PaymentsExceptionPanel({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canOperate = can('finance.reconcile');
  const [searchParams] = useSearchParams();

  const initialStatus = searchParams.get('status') ?? undefined;
  const initialProvider = searchParams.get('providerId') ?? undefined;
  const initialPriority = searchParams.get('priority') ?? undefined;
  const initialOverdue = searchParams.get('overdue') ?? undefined;

  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [providerId, setProviderId] = useState<string | undefined>(initialProvider);
  const [priority, setPriority] = useState<string | undefined>(initialPriority);
  const [overdue, setOverdue] = useState<string | undefined>(initialOverdue);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: ConfirmAction;
    row: AdminPaymentException;
  } | null>(null);
  const [resolution, setResolution] = useState('');

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminPaymentExceptionsApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        ...(params.status ? { status: params.status as string } : {}),
        ...(params.providerId ? { providerId: params.providerId as string } : {}),
        ...(params.priority ? { priority: params.priority as string } : {}),
        ...(params.overdue !== undefined ? { overdue: params.overdue === true || params.overdue === 'true' } : {}),
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList(fetcher, {
    pageSize: 30,
    ...(initialStatus ? { status: initialStatus } : {}),
    ...(initialProvider ? { providerId: initialProvider } : {}),
    ...(initialPriority ? { priority: initialPriority } : {}),
    ...(initialOverdue ? { overdue: initialOverdue } : {}),
  });

  useEffect(() => {
    if (refreshNonce > 0) void reload();
  }, [refreshNonce, reload]);

  useAdminUrlFilterSync({ status, providerId, priority, overdue });

  const rows = data?.items ?? [];
  const appliedFilters: AppliedFilter[] = useMemo(() => {
    const items: AppliedFilter[] = [];
    if (params.status) {
      items.push({
        key: 'status',
        label: `状态：${statusMeta(String(params.status)).label}`,
        onClear: () => {
          setStatus(undefined);
          setQuery({ status: undefined });
        },
      });
    }
    if (params.providerId) {
      items.push({
        key: 'providerId',
        label: `渠道：${PROVIDER_LABELS[String(params.providerId)] ?? String(params.providerId)}`,
        onClear: () => {
          setProviderId(undefined);
          setQuery({ providerId: undefined });
        },
      });
    }
    if (params.priority) {
      items.push({
        key: 'priority',
        label: `优先级：${params.priority === 'urgent' ? '紧急' : '普通'}`,
        onClear: () => {
          setPriority(undefined);
          setQuery({ priority: undefined });
        },
      });
    }
    if (params.overdue !== undefined) {
      items.push({
        key: 'overdue',
        label: `SLA：${String(params.overdue) === 'true' ? '已逾期' : '含未逾期'}`,
        onClear: () => {
          setOverdue(undefined);
          setQuery({ overdue: undefined });
        },
      });
    }
    return items;
  }, [params, setQuery]);

  const run = async (row: AdminPaymentException, kind: ConfirmAction) => {
    if (kind === 'close' && resolution.trim().length < 2) {
      toast.error('请填写人工结案依据');
      return;
    }
    setBusyId(row.id);
    try {
      if (kind === 'retry') {
        const result = await adminPaymentExceptionsApi.retryRefund(row.id);
        const outcome = result.outcome;
        if (outcome === 'manual_review') {
          toast.warning('未能安全自动退款，已转人工核对');
        } else if (outcome === 'refund_processing') {
          toast.info('渠道正在处理退款，请稍后核对退款状态');
        } else {
          toast.success('自动退款已完成');
        }
      } else {
        await adminPaymentExceptionsApi.close(row.id, resolution.trim());
        toast.success('异常单已结案');
      }
      setConfirm(null);
      setResolution('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const claim = async (row: AdminPaymentException) => {
    setBusyId(row.id);
    try {
      await adminPaymentExceptionsApi.claim(row.id);
      toast.success('异常单已认领');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '认领失败');
    } finally {
      setBusyId(null);
    }
  };

  const columns: Array<AdminColumn<AdminPaymentException>> = [
    {
      key: 'merchantOrderNo',
      title: '商户订单 / 交易号',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <code className="break-all font-mono text-xs">{row.merchantOrderNo}</code>
          <code className="break-all font-mono text-[11px] text-muted-foreground">
            {row.providerTradeNo ?? '无渠道交易号'}
          </code>
        </div>
      ),
    },
    {
      key: 'providerId',
      title: '渠道',
      width: 90,
      render: (row) => PROVIDER_LABELS[row.providerId] ?? row.providerId,
    },
    {
      key: 'amountCents',
      title: '金额',
      width: 100,
      align: 'right',
      render: (row) => <span className="tabular-nums">{moneyText(row.amountCents, row.currency)}</span>,
    },
    {
      key: 'kind',
      title: '差异类型',
      width: 145,
      render: (row) => KIND_LABELS[row.kind] ?? row.kind,
    },
    {
      key: 'status',
      title: '状态',
      width: 120,
      render: (row) => {
        const meta = statusMeta(row.status);
        return <StatusTag status={row.status} tone={meta.tone} label={meta.label} />;
      },
    },
    {
      key: 'priority',
      title: '优先级',
      width: 78,
      render: (row) => (
        <StatusTag
          status={row.priority}
          tone={row.priority === 'urgent' ? 'danger' : 'muted'}
          label={row.priority === 'urgent' ? '紧急' : '普通'}
        />
      ),
    },
    {
      key: 'slaDueAt',
      title: 'SLA',
      width: 160,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
          <span>{row.slaDueAt.replace('T', ' ').slice(0, 19)}</span>
          <span className={row.overdue ? 'font-medium text-danger-text' : 'text-muted-foreground'}>
            {row.overdue ? '已逾期' : '处理中'}
          </span>
        </div>
      ),
    },
    {
      key: 'ownerId',
      title: '负责人',
      width: 120,
      render: (row) => <span className="break-all text-xs text-muted-foreground">{row.ownerId ?? '未认领'}</span>,
    },
    {
      key: 'refundStatus',
      title: '退款状态',
      width: 120,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs">
          <span>{row.refundStatus ?? '无退款单'}</span>
          <code className="break-all font-mono text-[11px] text-muted-foreground">{row.providerRefundId ?? '—'}</code>
        </div>
      ),
    },
    {
      key: 'lastError',
      title: '最近错误 / 依据',
      width: 240,
      render: (row) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">{row.lastError ?? row.resolution ?? '—'}</span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 230,
      render: (row) => {
        const actionable = row.status === 'open' || row.status === 'manual_review';
        return (
          <div className="flex flex-wrap gap-1">
            {actionable && !row.ownerId && canOperate && (
              <ActionButton size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => void claim(row)}>
                {busyId === row.id ? '处理中…' : '认领'}
              </ActionButton>
            )}
            {actionable && row.kind === 'cancelled_but_paid' && canOperate && (
              <ActionButton
                size="sm"
                disabled={busyId === row.id}
                onClick={() => {
                  setResolution('');
                  setConfirm({ kind: 'retry', row });
                }}
              >
                重试退款
              </ActionButton>
            )}
            {actionable && canOperate && (
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={busyId === row.id}
                onClick={() => {
                  setResolution('');
                  setConfirm({ kind: 'close', row });
                }}
              >
                结案
              </ActionButton>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warn" title="真实资金差异必须闭环">
        自动退款只处理能精确匹配到本订单成功支付流水的已取消订单；匹配不到、金额或币种不一致、
        渠道退款失败的情况一律保留在这里，禁止只在对账明细或日志中“消账”。
      </Notice>

      <PaymentsExceptionFilterPanel
        status={status}
        providerId={providerId}
        priority={priority}
        overdue={overdue}
        statusOptions={STATUS_OPTIONS}
        providerOptions={ORDER_PROVIDERS}
        priorityOptions={PRIORITY_OPTIONS}
        appliedFilters={appliedFilters}
        onStatusChange={setStatus}
        onProviderChange={setProviderId}
        onPriorityChange={setPriority}
        onOverdueChange={setOverdue}
        onApply={() =>
          setQuery({
            status,
            providerId,
            priority,
            overdue: overdue === undefined ? undefined : overdue === 'true',
          })
        }
        onReset={() => {
          setStatus(undefined);
          setProviderId(undefined);
          setPriority(undefined);
          setOverdue(undefined);
          setQuery({
            status: undefined,
            providerId: undefined,
            priority: undefined,
            overdue: undefined,
          });
        }}
      />
      {error && data && <StaleError error={error} onRetry={() => void reload()} />}
      {error && !data && <ListError error={error} onRetry={() => void reload()} />}

      <Panel title="支付异常单" note={`共 ${data?.total ?? 0} 条`}>
        <AdminDataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          emptyText="当前筛选下没有支付异常单"
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 30),
            total: data?.total ?? 0,
            onChange: setPage,
          }}
        />
      </Panel>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'retry' ? '重试自动原路退款' : '人工结案'}
        confirmText={confirm?.kind === 'retry' ? '确认重试' : '确认结案'}
        danger={confirm?.kind === 'close'}
        loading={busyId === confirm?.row.id}
        confirmDisabled={confirm?.kind === 'close' && resolution.trim().length < 2}
        onCancel={() => {
          if (!busyId) {
            setConfirm(null);
            setResolution('');
          }
        }}
        onConfirm={() => {
          if (confirm) void run(confirm.row, confirm.kind);
        }}
        description={
          confirm?.kind === 'retry' ? (
            <p>
              系统会再次核验订单、成功支付流水、金额和币种后调用渠道退款；任一条件不满足会自动转人工，
              不会猜测交易关系。
            </p>
          ) : (
            <p>结案只代表财务已核对处置，不会自动改订单或积分。请填写可追溯的处置依据。</p>
          )
        }
        extra={
          confirm?.kind === 'close' ? (
            <FormField label="结案依据" hint="至少 2 个字符，最多 500 字符">
              <TextAreaField
                value={resolution}
                onChange={setResolution}
                rows={4}
                maxLength={500}
                ariaLabel="结案依据"
              />
            </FormField>
          ) : undefined
        }
        impact={[`异常单：${confirm?.row.merchantOrderNo ?? ''}`, '操作会写入管理员审计日志']}
      />
    </div>
  );
}
