import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminPaymentExceptionsApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ConfirmDialog,
  FilterActions,
  FilterBar,
  FormField,
  Notice,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  TextField,
  TextAreaField,
  formatDateTime,
  type AdminColumn,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  usePaymentExceptionFilters,
  useRefreshOnNonce,
  useToast,
} from './hooks';
import type { AdminPaymentException, PaymentExceptionStatus } from '../../../types/payment';
import {
  ORDER_PROVIDERS,
  PAYMENT_EXCEPTION_KIND_LABELS,
  PAYMENT_EXCEPTION_OVERDUE_OPTIONS,
  PAYMENT_EXCEPTION_PRIORITY_OPTIONS,
  PAYMENT_EXCEPTION_STATUS_META,
  PAYMENT_EXCEPTION_STATUS_OPTIONS,
} from './constants';
import { adminOrderDetailHref, moneyText, providerLabel } from './utils';

/**
 * 资金异常待办标签。
 *
 * 异常队列承接「需要人工兜底的真资金差异」：已取消仍扣款、退款失败、渠道与
 * 本地流水对不上等。自动退款只处理能精确匹配到本订单成功支付流水的场景，
 * 其余必须在这里留痕并闭环 —— **禁止只在对账明细或日志中消账**。
 *
 * 筛选、地址栏同步在 `usePaymentExceptionFilters`；这里只保留渲染与
 * 认领 / 重试退款 / 结案三个写操作。
 */

function statusMeta(status: string) {
  return (
    PAYMENT_EXCEPTION_STATUS_META[status as PaymentExceptionStatus] ?? {
      label: status,
      tone: 'muted' as const,
    }
  );
}

type ConfirmAction = 'retry' | 'close' | 'confirm-succeeded' | 'confirm-failed';

export function PaymentsExceptionPanel({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canOperate = can('finance.reconcile');

  const {
    data,
    loading,
    error,
    values,
    updateFilter,
    applyFilters,
    resetFilters,
    draftChanged,
    appliedChips,
    setPage,
    reload,
  } = usePaymentExceptionFilters();

  useRefreshOnNonce(refreshNonce, reload);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: ConfirmAction;
    row: AdminPaymentException;
  } | null>(null);
  const [resolution, setResolution] = useState('');
  const [providerRefundId, setProviderRefundId] = useState('');

  const rows = data?.items ?? [];

  const openConfirm = (kind: ConfirmAction, row: AdminPaymentException) => {
    setResolution('');
    setProviderRefundId('');
    setConfirm({ kind, row });
  };

  const run = async (row: AdminPaymentException, kind: ConfirmAction) => {
    const needsReason = kind !== 'retry';
    if (needsReason && resolution.trim().length < 2) {
      toast.error(kind === 'close' ? '请填写人工结案依据' : '请填写人工核销依据');
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
      } else if (kind === 'confirm-succeeded' || kind === 'confirm-failed') {
        const outcome = kind === 'confirm-succeeded' ? 'succeeded' : 'failed';
        await adminPaymentExceptionsApi.confirmRefund(row.id, {
          outcome,
          reason: resolution.trim(),
          ...(providerRefundId.trim() ? { providerRefundId: providerRefundId.trim() } : {}),
        });
        if (outcome === 'succeeded') {
          toast.success('已确认渠道退款成功；订单状态和积分未变更');
        } else {
          toast.warning('已确认渠道退款失败，资金异常待办仍需继续处理');
        }
      } else {
        await adminPaymentExceptionsApi.close(row.id, resolution.trim());
        toast.success('资金异常待办已结案');
      }
      setConfirm(null);
      setResolution('');
      setProviderRefundId('');
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
      toast.success('资金异常待办已认领');
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
          {row.orderId ? (
            <Link
              className="break-all font-mono text-xs text-brand hover:underline"
              to={adminOrderDetailHref(row.orderId)}
              title="在订单管理中打开"
            >
              {row.merchantOrderNo}
            </Link>
          ) : (
            <code className="break-all font-mono text-xs">{row.merchantOrderNo}</code>
          )}
          <code className="break-all font-mono text-[12px] text-muted-foreground">
            {row.providerTradeNo ?? '无渠道交易号'}
          </code>
        </div>
      ),
    },
    {
      key: 'providerId',
      title: '收款来源',
      width: 90,
      render: (row) => providerLabel(row.providerId),
    },
    {
      key: 'amountCents',
      title: '金额',
      width: 100,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">{moneyText(row.amountCents, row.currency)}</span>
      ),
    },
    {
      key: 'kind',
      title: '问题类型',
      width: 145,
      render: (row) => PAYMENT_EXCEPTION_KIND_LABELS[row.kind] ?? row.kind,
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
      title: '处理时限',
      width: 160,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
          <span>{formatDateTime(row.slaDueAt)}</span>
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
      render: (row) => (
        <span className="break-all text-xs text-muted-foreground">{row.ownerId ?? '未认领'}</span>
      ),
    },
    {
      key: 'refundStatus',
      title: '退款进度',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs">
          <span>{row.refundStatus ?? '无退款单'}</span>
          <code className="break-all font-mono text-[12px] text-muted-foreground">
            {row.providerRefundId ?? '—'}
          </code>
          {row.refundStatus === 'failed' && (
            <span
              className={
                row.refundFailureKind === 'definitive'
                  ? 'text-danger-text'
                  : 'text-warn-text'
              }
            >
              {row.refundFailureKind === 'definitive'
                ? '渠道明确拒绝，可新建退款单重试'
                : '结果未知，必须同号重试或核对渠道'}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'lastError',
      title: '最近问题 / 处理依据',
      width: 240,
      render: (row) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {row.lastError ?? row.resolution ?? '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 230,
      render: (row) => {
        const actionable = row.status === 'open' || row.status === 'manual_review';
        const autoRefund = row.kind === 'cancelled_but_paid';
        const confirmProcessing =
          canOperate && autoRefund && row.status === 'auto_refund_pending' && row.refundStatus === 'processing';
        const failedRetry =
          canOperate && autoRefund && row.status === 'manual_review' && row.refundStatus === 'failed';
        const retryRefund =
          canOperate &&
          autoRefund &&
          !confirmProcessing &&
          (row.status === 'open' ||
            (row.status === 'manual_review' &&
              (row.refundStatus === null || row.refundStatus === 'failed')));
        return (
          <div className="flex flex-wrap gap-1">
            {actionable && !row.ownerId && canOperate && (
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={busyId === row.id}
                onClick={() => void claim(row)}
              >
                {busyId === row.id ? '处理中…' : '认领'}
              </ActionButton>
            )}
            {confirmProcessing && (
              <>
                <ActionButton
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => openConfirm('confirm-succeeded', row)}
                >
                  确认退款成功
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="ghost"
                  disabled={busyId === row.id}
                  onClick={() => openConfirm('confirm-failed', row)}
                >
                  确认退款失败
                </ActionButton>
              </>
            )}
            {retryRefund && (
              <ActionButton
                size="sm"
                variant={failedRetry ? 'secondary' : 'default'}
                disabled={busyId === row.id}
                onClick={() => openConfirm('retry', row)}
              >
                {failedRetry
                  ? row.refundFailureKind === 'definitive'
                    ? '新建退款单重试'
                    : '同号重试'
                  : '重试退款'}
              </ActionButton>
            )}
            {actionable && canOperate && (
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={busyId === row.id}
                onClick={() => openConfirm('close', row)}
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
      <Notice tone="warn" title="资金异常必须处理完">
        系统只会自动处理能准确匹配到原支付记录的取消订单；匹配不到、金额或币种不一致、
        退款失败的情况都会保留在这里，不能只在对账明细或日志中标记完成。
      </Notice>

      <FilterBar>
        <SelectField
          value={values.status}
          onChange={(value) => updateFilter('status', value)}
          options={PAYMENT_EXCEPTION_STATUS_OPTIONS}
          allowClear
          className="w-[140px]" ariaLabel="筛选待办状态" clearLabel="全部状态"
        />
        <SelectField
          value={values.providerId}
          onChange={(value) => updateFilter('providerId', value)}
          options={ORDER_PROVIDERS}
          allowClear
          className="w-[130px]" ariaLabel="筛选收款来源" clearLabel="全部来源"
        />
        <SelectField
          value={values.priority}
          onChange={(value) => updateFilter('priority', value)}
          options={PAYMENT_EXCEPTION_PRIORITY_OPTIONS}
          allowClear
          className="w-[120px]" ariaLabel="筛选待办优先级" clearLabel="全部优先级"
        />
        <SelectField
          value={values.overdue}
          onChange={(value) => updateFilter('overdue', value)}
          options={PAYMENT_EXCEPTION_OVERDUE_OPTIONS}
          allowClear
          className="w-[120px]" ariaLabel="筛选处理时限" clearLabel="全部时限"
        />
        <FilterActions>
          <ActionButton onClick={applyFilters}>查询</ActionButton>
          <ActionButton variant="ghost" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} />
      </FilterBar>

      {draftChanged && (
        <p className="text-xs text-warn-text">筛选条件已修改，请点击「查询」以应用。</p>
      )}

      <Panel title="资金异常待办" note={`处理时限 2 小时；逾期待办优先展示 · 共 ${data?.total ?? 0} 条`}>
        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          error={data ? null : error}
          onRetry={() => void reload()}
          emptyText={
            appliedChips.length > 0
              ? '当前筛选下没有资金异常待办，清除筛选后再试'
              : '当前没有资金异常待办'
          }
          emptyAction={
            appliedChips.length > 0 ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 30,
            total: data?.total ?? 0,
            onChange: setPage,
          }}
        />
      </Panel>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === 'retry'
            ? '重试自动原路退款'
            : confirm?.kind === 'confirm-succeeded'
              ? '确认渠道退款成功'
              : confirm?.kind === 'confirm-failed'
                ? '确认渠道退款失败'
                : '人工结案'
        }
        confirmText={
          confirm?.kind === 'retry'
            ? '确认重试'
            : confirm?.kind === 'confirm-succeeded'
              ? '确认成功'
              : confirm?.kind === 'confirm-failed'
                ? '确认失败'
                : '确认结案'
        }
        danger={confirm?.kind === 'close' || confirm?.kind === 'confirm-failed'}
        loading={busyId === confirm?.row.id}
        confirmDisabled={confirm?.kind !== 'retry' && resolution.trim().length < 2}
        onCancel={() => {
          if (!busyId) {
            setConfirm(null);
            setResolution('');
            setProviderRefundId('');
          }
        }}
        onConfirm={() => {
          if (confirm) void run(confirm.row, confirm.kind);
        }}
        description={
          confirm?.kind === 'retry' ? (
            <p>
              {confirm.row.refundFailureKind === 'definitive'
                ? '渠道已明确拒绝上一笔退款，本次会生成新的退款单号后重新发起。'
                : '系统会复用原退款单号再次调用渠道，避免结果未知时产生第二笔退款。'}
              调用前会重新核验订单、成功支付流水、金额和币种。
            </p>
          ) : confirm?.kind === 'confirm-succeeded' ? (
            <p>仅代表已到渠道商户后台核对退款成功；不会修改订单状态，也不会回收或恢复积分。</p>
          ) : confirm?.kind === 'confirm-failed' ? (
            <p>确认失败后资金异常待办会保留，仍需继续核对或处置，不会自动改订单或积分。</p>
          ) : (
            <p>结案只代表财务已核对处置，不会自动改订单或积分。请填写可追溯的处置依据。</p>
          )
        }
        extra={
          confirm && confirm.kind !== 'retry' ? (
            <>
              {confirm.kind !== 'close' && (
                <FormField label="渠道退款单号" hint="可选；请从渠道商户后台复制完整单号">
                  <TextField
                    value={providerRefundId}
                    onChange={setProviderRefundId}
                    maxLength={200}
                    ariaLabel="渠道退款单号"
                  />
                </FormField>
              )}
              <FormField
                label={confirm.kind === 'close' ? '结案依据' : '核销依据'}
                hint="至少 2 个字符，最多 500 字符"
              >
                <TextAreaField
                  value={resolution}
                  onChange={setResolution}
                  rows={4}
                  maxLength={500}
                  showCount
                  ariaLabel={confirm.kind === 'close' ? '结案依据' : '核销依据'}
                />
              </FormField>
            </>
          ) : undefined
        }
        impact={[`资金异常待办：${confirm?.row.merchantOrderNo ?? ''}`, '操作会记录处理依据']}
      />
    </div>
  );
}
