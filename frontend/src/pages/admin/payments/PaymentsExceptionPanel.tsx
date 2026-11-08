import { useState } from 'react';
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
  TextAreaField,
  formatShanghaiDateTime,
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
import { moneyText, providerLabel } from './utils';

/**
 * 支付异常标签。
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

type ConfirmAction = 'retry' | 'close';

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

  const rows = data?.items ?? [];

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
          <code className="break-all font-mono text-[12px] text-muted-foreground">
            {row.providerTradeNo ?? '无渠道交易号'}
          </code>
        </div>
      ),
    },
    {
      key: 'providerId',
      title: '渠道',
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
      title: '差异类型',
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
      title: 'SLA',
      width: 160,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
          <span>{formatShanghaiDateTime(row.slaDueAt)}</span>
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
      title: '退款状态',
      width: 120,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs">
          <span>{row.refundStatus ?? '无退款单'}</span>
          <code className="break-all font-mono text-[12px] text-muted-foreground">
            {row.providerRefundId ?? '—'}
          </code>
        </div>
      ),
    },
    {
      key: 'lastError',
      title: '最近错误 / 依据',
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

      <FilterBar>
        <SelectField
          value={values.status}
          onChange={(value) => updateFilter('status', value)}
          options={PAYMENT_EXCEPTION_STATUS_OPTIONS}
          allowClear
          className="w-[140px]"
          ariaLabel="筛选异常状态"
        />
        <SelectField
          value={values.providerId}
          onChange={(value) => updateFilter('providerId', value)}
          options={ORDER_PROVIDERS}
          allowClear
          className="w-[130px]"
          ariaLabel="筛选异常渠道"
        />
        <SelectField
          value={values.priority}
          onChange={(value) => updateFilter('priority', value)}
          options={PAYMENT_EXCEPTION_PRIORITY_OPTIONS}
          allowClear
          className="w-[120px]"
          ariaLabel="筛选异常优先级"
        />
        <SelectField
          value={values.overdue}
          onChange={(value) => updateFilter('overdue', value)}
          options={PAYMENT_EXCEPTION_OVERDUE_OPTIONS}
          allowClear
          className="w-[120px]"
          ariaLabel="筛选 SLA"
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

      <Panel title="支付异常单" note={`SLA 2 小时；逾期单优先展示 · 共 ${data?.total ?? 0} 条`}>
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
              ? '当前筛选下没有支付异常单，清除筛选后再试'
              : '当前没有支付异常单'
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
