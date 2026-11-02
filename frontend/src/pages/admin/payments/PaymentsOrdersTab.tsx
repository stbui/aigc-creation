import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminPaymentOrdersApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ConfirmAction,
  Descriptions,
  Drawer,
  FilterActions,
  FilterBar,
  FormField,
  ListError,
  Notice,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  TextAreaField,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from './components';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  useToast,
} from './hooks';
import type {
  AdminPaymentOrderDetail,
  AdminPaymentOrderRow,
  PaymentDisplayStatus,
} from '../../../types/payment';
import {
  CHECKOUT_MODE_LABELS,
  PAYMENT_STATUS_META,
  PROVIDER_LABELS,
} from './constants';
import { moneyText } from './utils';

/**
 * 支付订单标签。
 *
 * 筛选是**草稿 → 应用**两段式：草稿改完点「查询」才生效。这样「改了条件但
 * 没点查询」不会让人以为筛选没生效（列表还停在旧条件上，用户会以为筛错了）。
 *
 * 页面**不提供退款**：退款在订单管理里，且退款要动积分与优惠券回滚，
 * 放在支付域会让人以为「关单 = 退款」。关单只停止未支付订单继续挂着。
 */

/** 可筛选的状态白名单 */
const STATUS_OPTIONS: Array<{ value: PaymentDisplayStatus; label: string }> = [
  { value: 'created', label: '待支付' },
  { value: 'pending', label: '支付中' },
  { value: 'closing', label: '关单中' },
  { value: 'create_failed', label: '发起失败' },
  { value: 'closed', label: '已关闭' },
  { value: 'credited', label: '已入账' },
  { value: 'refunded', label: '已退款' },
  { value: 'partial_refunded', label: '部分退款' },
];

const TIME_FIELD_OPTIONS = [
  { value: 'created', label: '按下单时间' },
  { value: 'paid', label: '按支付时间' },
  { value: 'credited', label: '按入账时间' },
];

export function PaymentsOrdersTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canExport = can('data.export');

  const [searchParams] = useSearchParams();

  // 初始筛选从 URL 读，避免先发一次空筛选请求
  const initialStatus = (() => {
    const raw = searchParams.get('status');
    return STATUS_OPTIONS.some((o) => o.value === raw) ? (raw as PaymentDisplayStatus) : undefined;
  })();
  const initialProvider = (() => {
    const raw = searchParams.get('providerId');
    return raw && raw in PROVIDER_LABELS ? raw : undefined;
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
      label: `时间口径：${TIME_FIELD_OPTIONS.find((o) => o.value === params.timeField)?.label ?? params.timeField}`,
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
    reason: string;
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
            <span className="truncate text-[11px] text-muted-foreground">{row.user.email}</span>
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
          <code className="font-mono text-[11px]">{row.orderNo}</code>
          <span className="truncate text-[11px] text-muted-foreground">{row.productName}</span>
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
          <span className="text-[11px] text-muted-foreground">
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
        <span className="text-[11px] text-muted-foreground tabular-nums">
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
                  onClick={() => setAction({ order: row, kind: 'query', reason: '' })}
                  ariaLabel={`同步状态${row.orderNo}`}
                >
                  同步状态
                </ActionButton>
                <ActionButton
                  onClick={() => setAction({ order: row, kind: 'close', reason: '' })}
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

  return (
    <div className="flex flex-col gap-3">
      <FilterBar>
        <TextField
          value={keyword}
          onChange={setKeyword}
          placeholder="搜索名称、用户名、邮箱、订单号"
          className="w-[240px]"
          onEnter={() =>
            setQuery({
              keyword: keyword.trim() || undefined,
              status,
              providerId,
              timeField,
              from: from || undefined,
              to: to || undefined,
            })
          }
        />
        <SelectField
          value={status}
          onChange={(value) => setStatus(value as PaymentDisplayStatus | undefined)}
          options={STATUS_OPTIONS}
          allowClear
          className="w-[130px]"
          ariaLabel="订单状态"
        />
        <SelectField
          value={providerId}
          onChange={setProviderId}
          options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }))}
          allowClear
          className="w-[120px]"
          ariaLabel="支付渠道"
        />
        <SelectField
          value={timeField}
          onChange={setTimeField}
          options={TIME_FIELD_OPTIONS}
          allowClear
          className="w-[130px]"
          ariaLabel="时间口径"
        />
        <TextField
          type="date"
          value={from}
          onChange={setFrom}
          className="w-[140px]"
          ariaLabel="起始日期"
        />
        <TextField
          type="date"
          value={to}
          onChange={setTo}
          className="w-[140px]"
          ariaLabel="截止日期"
        />
        <FilterActions>
          <ActionButton
            onClick={() =>
              setQuery({
                keyword: keyword.trim() || undefined,
                status,
                providerId,
                timeField,
                from: from || undefined,
                to: to || undefined,
              })
            }
          >
            查询
          </ActionButton>
          <ActionButton
            onClick={() => {
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
            }}
          >
            重置
          </ActionButton>
          <ActionButton
            onClick={() => {
              void adminPaymentOrdersApi
                .exportCsv({
                  ...(params.status ? { status: params.status as string } : {}),
                  ...(params.keyword ? { keyword: params.keyword as string } : {}),
                  ...(params.providerId ? { providerId: params.providerId as string } : {}),
                  ...(params.timeField ? { timeField: params.timeField as 'created' | 'paid' | 'credited' } : {}),
                  ...(params.from ? { from: params.from as string } : {}),
                  ...(params.to ? { to: params.to as string } : {}),
                })
                .catch((e: Error) => toast.error(e.message));
            }}
            disabled={!canExport || draftChanged || loading || !data || data.total === 0}
          >
            导出 CSV
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} />
      </FilterBar>

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

      <ConfirmAction
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
        confirmDisabled={!action?.reason.trim()}
        loading={busy}
        onCancel={() => setAction(null)}
        onConfirm={async () => {
          if (!action) return;
          setBusy(true);
          try {
            if (action.kind === 'query') {
              await adminPaymentOrdersApi.query(action.order.id, { reason: action.reason.trim() });
              toast.success('已同步渠道状态');
            } else {
              await adminPaymentOrdersApi.close(action.order.id, { reason: action.reason.trim() });
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
        extra={
          <FormField label="操作原因" required hint="原因会写入操作审计。">
            <TextAreaField
              value={action?.reason ?? ''}
              onChange={(value) => setAction((prev) => (prev ? { ...prev, reason: value } : prev))}
              maxLength={200}
              placeholder="例如：用户反馈已付款但页面未到账"
              ariaLabel="操作原因"
            />
          </FormField>
        }
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

/** 支付订单详情抽屉 */
function PaymentOrderDetailDrawer({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<AdminPaymentOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminPaymentOrdersApi
      .detail(orderId)
      .then((result) => {
        if (cancelled) return;
        setData(result.order);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const order = data;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="支付订单详情"
      description={order?.orderNo}
      width={680}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton onClick={onClose}>关闭</ActionButton>
        </div>
      }
    >
      {loading && !order ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : error && !order ? (
        <ListError error={error} onRetry={() => setData(null)} />
      ) : order ? (
        <div className="flex flex-col gap-4">
          {order.lastError && (
            <Notice tone="danger" title="失败原因">
              {order.lastError}
            </Notice>
          )}

          <Descriptions
            columns={2}
            items={[
              { label: '订单号', value: <code className="font-mono text-xs">{order.orderNo}</code> },
              { label: '用户', value: order.user ? order.user.name || order.user.email : '用户不存在' },
              { label: '邮箱', value: order.user?.email ?? '—' },
              {
                label: '用户 ID',
                value: <code className="font-mono text-xs break-all">{order.userId}</code>,
              },
              { label: '商品', value: order.productName },
              {
                label: '支付渠道',
                value: `${PROVIDER_LABELS[order.providerId as keyof typeof PROVIDER_LABELS] ?? order.providerId}（${CHECKOUT_MODE_LABELS[order.checkout.mode ?? ''] ?? order.checkout.mode ?? '—'}）`,
              },
              {
                label: '金额',
                value: <span className="tabular-nums">{moneyText(order.amountCents, order.currency)}</span>,
              },
              {
                label: '权益',
                value: `${order.credits.toLocaleString('zh-CN')} 积分`,
              },
              {
                label: '状态',
                value: (
                  <StatusTag
                    status={order.status}
                    tone={PAYMENT_STATUS_META[order.status]?.tone ?? 'muted'}
                    label={PAYMENT_STATUS_META[order.status]?.label ?? order.status}
                  />
                ),
              },
              {
                label: '渠道交易号',
                value: <code className="font-mono text-xs">{order.providerTradeNo ?? '—'}</code>,
              },
              {
                label: '配置版本',
                value: order.providerConfigVersion === null ? '—' : `v${order.providerConfigVersion}`,
              },
              { label: '创建时间', value: order.createdAt.replace('T', ' ').slice(0, 19) },
              { label: '过期时间', value: order.expiresAt.replace('T', ' ').slice(0, 19) },
              {
                label: '支付时间',
                value: order.providerPaidAt ? order.providerPaidAt.replace('T', ' ').slice(0, 19) : '—',
              },
              {
                label: '入账时间',
                value: order.creditedAt ? order.creditedAt.replace('T', ' ').slice(0, 19) : '—',
              },
              {
                label: '关闭时间',
                value: order.closedAt ? order.closedAt.replace('T', ' ').slice(0, 19) : '—',
              },
            ]}
          />

          {order.items.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">商品明细</span>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">商品</th>
                      <th className="px-3 py-2 text-left font-medium">SKU</th>
                      <th className="px-3 py-2 text-right font-medium">单价</th>
                      <th className="px-3 py-2 text-right font-medium">积分</th>
                      <th className="px-3 py-2 text-right font-medium">数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2">
                          <code className="font-mono text-xs">{item.sku}</code>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {moneyText(item.priceCents, order.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.credits}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">支付尝试记录</span>
            {order.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无支付尝试</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">状态</th>
                      <th className="px-3 py-2 text-left font-medium">渠道</th>
                      <th className="px-3 py-2 text-left font-medium">交易号</th>
                      <th className="px-3 py-2 text-right font-medium">金额</th>
                      <th className="px-3 py-2 text-left font-medium">创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.payments.map((payment) => (
                      <tr key={payment.id} className="border-t border-border">
                        <td className="px-3 py-2">{payment.status}</td>
                        <td className="px-3 py-2">
                          {PROVIDER_LABELS[payment.providerId as keyof typeof PROVIDER_LABELS] ??
                            payment.providerId}
                        </td>
                        <td className="px-3 py-2">
                          <code className="font-mono text-xs">{payment.payTransactionId ?? '—'}</code>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {moneyText(payment.amountCents, order.currency)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                          {payment.createdAt.replace('T', ' ').slice(0, 19)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Notice tone="info" title="退款请到订单管理">
            本页不提供退款操作。退款会动积分与优惠券回滚，统一在订单管理执行。
          </Notice>

          <div className="flex justify-end">
            <ActionButton onClick={() => {
              onChanged();
              toast.success('已刷新');
            }}>
              刷新
            </ActionButton>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
