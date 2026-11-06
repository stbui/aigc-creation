import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminPaymentOrdersApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmDialog,
  ListError,
  Panel,
  StaleError,
  StatusTag,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  useToast,
} from './hooks';
import type { AdminPaymentOrderRow, PaymentDisplayStatus } from '../../../types/payment';
import {
  ORDER_PROVIDER_IDS,
  PAYMENT_ORDER_STATUS_OPTIONS,
  PAYMENT_ORDER_TIME_FIELD_OPTIONS,
  PAYMENT_STATUS_META,
  PROVIDER_LABELS,
} from './constants';
import { moneyText } from './utils';
import { PaymentOrderDetailDrawer } from './PaymentOrderDetailDrawer';
import {
  PaymentOrdersFilterBar,
  type PaymentOrderFilterKey,
} from './PaymentOrdersFilterBar';

/**
 * 支付订单标签。
 *
 * 筛选是**草稿 → 应用**两段式：草稿改完点「查询」才生效。这样「改了条件但
 * 没点查询」不会让人以为筛选没生效（列表还停在旧条件上，用户会以为筛错了）。
 *
 * 页面**不提供退款**：退款在订单管理里，且退款要动积分与优惠券回滚，
 * 放在支付域会让人以为「关单 = 退款」。关单只停止未支付订单继续挂着。
 */

export function PaymentsOrdersTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canExport = can('data.export');

  const [searchParams] = useSearchParams();

  // 初始筛选从 URL 读，避免先发一次空筛选请求
  const initialStatus = (() => {
    const raw = searchParams.get('status');
    return PAYMENT_ORDER_STATUS_OPTIONS.some((o) => o.value === raw)
      ? (raw as PaymentDisplayStatus)
      : undefined;
  })();
  const initialProvider = (() => {
    const raw = searchParams.get('providerId');
    return raw && (ORDER_PROVIDER_IDS as string[]).includes(raw) ? raw : undefined;
  })();
  const initialTimeField = (() => {
    const raw = searchParams.get('timeField');
    return raw === 'created' || raw === 'paid' || raw === 'credited' ? raw : undefined;
  })();
  const initialKeyword = searchParams.get('keyword') ?? '';
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';

  // 草稿
  const [keyword, setKeyword] = useState(initialKeyword);
  const [status, setStatus] = useState<PaymentDisplayStatus | undefined>(initialStatus);
  const [providerId, setProviderId] = useState<string | undefined>(initialProvider);
  const [timeField, setTimeField] = useState<string | undefined>(initialTimeField);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const updateFilter = (key: PaymentOrderFilterKey, value: string | undefined) => {
    switch (key) {
      case 'keyword':
        setKeyword(value ?? '');
        break;
      case 'status':
        setStatus(value as PaymentDisplayStatus | undefined);
        break;
      case 'providerId':
        setProviderId(value);
        break;
      case 'timeField':
        setTimeField(value);
        break;
      case 'from':
        setFrom(value ?? '');
        break;
      case 'to':
        setTo(value ?? '');
        break;
    }
  };

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminPaymentOrdersApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        ...(params.status ? { status: params.status as string } : {}),
        ...(params.keyword ? { keyword: params.keyword as string } : {}),
        ...(params.providerId ? { providerId: params.providerId as string } : {}),
        ...(params.timeField ? { timeField: params.timeField as 'created' | 'paid' | 'credited' } : {}),
        ...(params.from ? { from: params.from as string } : {}),
        ...(params.to ? { to: params.to as string } : {}),
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList(fetcher, {
    pageSize: 30,
    ...(initialStatus ? { status: initialStatus } : {}),
    ...(initialKeyword ? { keyword: initialKeyword } : {}),
    ...(initialProvider ? { providerId: initialProvider } : {}),
    ...(initialTimeField ? { timeField: initialTimeField } : {}),
    ...(initialFrom ? { from: initialFrom } : {}),
    ...(initialTo ? { to: initialTo } : {}),
  });

  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    keyword: params.keyword as string | undefined,
    providerId: params.providerId as string | undefined,
    timeField: params.timeField as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });

  // 刷新只重取当前筛选下的数据，筛选与分页都不动
  useEffect(() => {
    if (refreshNonce > 0) void reload();
  }, [refreshNonce, reload]);

  // 草稿与应用值不一致 → 提示先查询
  const draftChanged = useMemo(() => {
    return (
      keyword !== (params.keyword ?? '') ||
      (status ?? '') !== (params.status ?? '') ||
      (providerId ?? '') !== (params.providerId ?? '') ||
      (timeField ?? '') !== (params.timeField ?? '') ||
      from !== (params.from ?? '') ||
      to !== (params.to ?? '')
    );
  }, [keyword, status, providerId, timeField, from, to, params]);

  const appliedChips: AppliedFilter[] = [];
  if (params.status) {
    const meta = PAYMENT_STATUS_META[params.status as PaymentDisplayStatus];
    appliedChips.push({
      key: 'status',
      label: `状态：${meta?.label ?? params.status}`,
      onClear: () => {
        setStatus(undefined);
        setQuery({ status: undefined });
      },
    });
  }
  if (params.keyword) {
    appliedChips.push({
      key: 'keyword',
      label: `关键词：${params.keyword}`,
      onClear: () => {
        setKeyword('');
        setQuery({ keyword: undefined });
      },
    });
  }
  if (params.providerId) {
    appliedChips.push({
      key: 'providerId',
      label: `渠道：${PROVIDER_LABELS[params.providerId as keyof typeof PROVIDER_LABELS] ?? params.providerId}`,
      onClear: () => {
        setProviderId(undefined);
        setQuery({ providerId: undefined });
      },
    });
  }
  if (params.timeField) {
    appliedChips.push({
      key: 'timeField',
      label: `时间口径：${PAYMENT_ORDER_TIME_FIELD_OPTIONS.find((o) => o.value === params.timeField)?.label ?? params.timeField}`,
      onClear: () => {
        setTimeField(undefined);
        setQuery({ timeField: undefined });
      },
    });
  }
  if (params.from) {
    appliedChips.push({
      key: 'from',
      label: `起始：${params.from}`,
      onClear: () => {
        setFrom('');
        setQuery({ from: undefined });
      },
    });
  }
  if (params.to) {
    appliedChips.push({
      key: 'to',
      label: `截止：${params.to}`,
      onClear: () => {
        setTo('');
        setQuery({ to: undefined });
      },
    });
  }

  /*
   * 详情抽屉用 `?orderId=` 深链：刷新后抽屉还在、链接可分享。
   * 订单页与对账页都可能开抽屉，语义不同就不能共用 `id`，所以参数名各自定制。
   */
  const [detailId, setDetailId] = useAdminDetailParam('orderId');
  const [action, setAction] = useState<{
    order: AdminPaymentOrderRow;
    kind: 'query' | 'close';
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data?.items ?? [];

  const columns: Array<AdminColumn<AdminPaymentOrderRow>> = [
    {
      key: 'user',
      title: '用户',
      width: 180,
      render: (row) =>
        row.user ? (
          <div className="flex flex-col gap-0.5">
            <span className="truncate">{row.user.name || row.user.email}</span>
            <span className="truncate text-[12px] text-muted-foreground">{row.user.email}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">用户不存在</span>
        ),
    },
    {
      key: 'order',
      title: '订单 / 商品',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <code className="font-mono text-[12px]">{row.orderNo}</code>
          <span className="truncate text-[12px] text-muted-foreground">{row.productName}</span>
        </div>
      ),
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
      key: 'amount',
      title: '金额 / 权益',
      width: 130,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{moneyText(row.amountCents, row.currency)}</span>
          <span className="text-[12px] text-muted-foreground">
            {row.credits.toLocaleString('zh-CN')} 积分
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => {
        const meta = PAYMENT_STATUS_META[row.status];
        return (
          <StatusTag
            status={row.status}
            tone={meta?.tone ?? 'muted'}
            label={meta?.label ?? row.status}
          />
        );
      },
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 110,
      render: (row) => (
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {row.createdAt.slice(5, 16).replace('T', ' ')}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      render: (row) => {
        const actionable =
          row.status === 'created' ||
          row.status === 'pending' ||
          row.status === 'create_failed' ||
          row.status === 'closing';
        return (
          <div className="flex items-center gap-1">
            <ActionButton
              onClick={() => setDetailId(row.id)}
              ariaLabel={`查看订单${row.orderNo}`}
            >
              详情
            </ActionButton>
            {actionable && (
              <>
                <ActionButton
                  onClick={() => setAction({ order: row, kind: 'query' })}
                  ariaLabel={`同步状态${row.orderNo}`}
                >
                  同步状态
                </ActionButton>
                <ActionButton
                  onClick={() => setAction({ order: row, kind: 'close' })}
                  ariaLabel={`关闭订单${row.orderNo}`}
                >
                  关闭
                </ActionButton>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const applyQuery = () =>
    setQuery({
      keyword: keyword.trim() || undefined,
      status,
      providerId,
      timeField,
      from: from || undefined,
      to: to || undefined,
    });

  const resetQuery = () => {
    setKeyword('');
    setStatus(undefined);
    setProviderId(undefined);
    setTimeField(undefined);
    setFrom('');
    setTo('');
    setQuery({
      keyword: undefined,
      status: undefined,
      providerId: undefined,
      timeField: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const exportCsv = () =>
    void adminPaymentOrdersApi
      .exportCsv({
        ...(params.status ? { status: params.status as string } : {}),
        ...(params.keyword ? { keyword: params.keyword as string } : {}),
        ...(params.providerId ? { providerId: params.providerId as string } : {}),
        ...(params.timeField
          ? { timeField: params.timeField as 'created' | 'paid' | 'credited' }
          : {}),
        ...(params.from ? { from: params.from as string } : {}),
        ...(params.to ? { to: params.to as string } : {}),
      })
      .catch((e: Error) => toast.error(e.message));

  return (
    <div className="flex flex-col gap-3">
      <PaymentOrdersFilterBar
        values={{ keyword, status, providerId, timeField, from, to }}
        onChange={updateFilter}
        onApply={applyQuery}
        onReset={resetQuery}
        onExport={exportCsv}
        exportDisabled={!canExport || draftChanged || loading || !data || data.total === 0}
        appliedChips={appliedChips}
      />

      {draftChanged && (
        <p className="text-xs text-warn-text">筛选条件已修改，请点击「查询」以应用。</p>
      )}

      <Panel title="支付订单" note="本页不提供退款；退款请到订单管理">
        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        {error && !data ? (
          <ListError error={error} onRetry={() => void reload()} />
        ) : (
          <AdminDataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            emptyText="还没有支付订单"
            minWidth={1040}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 30,
              total: data?.total ?? 0,
              onChange: (page, pageSize) => setPage(page, pageSize),
            }}
          />
        )}
      </Panel>

      <ConfirmDialog
        open={action !== null}
        danger={action?.kind === 'close'}
        title={action?.kind === 'close' ? '关闭支付订单' : '向渠道同步订单状态'}
        description={
          action?.kind === 'close'
            ? '关闭后该订单不再等待支付。已支付的订单不会被关闭，请先同步状态确认。'
            : '向渠道查一次订单状态；若渠道已收款，会立即入账并补发积分。'
        }
        impact={
          action?.kind === 'close'
            ? ['未支付订单将标记为已关闭', '已支付订单会被拒绝关闭，请先同步状态', '关闭不会退款']
            : ['若渠道已收款，积分会立即入账']
        }
        confirmText={action?.kind === 'close' ? '确认关闭' : '确认同步'}
        loading={busy}
        onCancel={() => setAction(null)}
        onConfirm={async () => {
          if (!action) return;
          setBusy(true);
          try {
            if (action.kind === 'query') {
              await adminPaymentOrdersApi.query(action.order.id);
              toast.success('已同步渠道状态');
            } else {
              await adminPaymentOrdersApi.close(action.order.id);
              toast.success('订单已关闭');
            }
            setAction(null);
            reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '操作失败');
          } finally {
            setBusy(false);
          }
        }}
      />

      {detailId && (
        <PaymentOrderDetailDrawer
          orderId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
