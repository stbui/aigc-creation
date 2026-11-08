import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminPaymentProductsApi, adminPaymentProvidersApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmDialog,
  EmptyState,
  ListError,
  PageSkeleton,
  Panel,
  SelectField,
  StaleError,
  StatCards,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminResource,
  useDiscardConfirm,
  useRefreshOnNonce,
  useToast,
  useUnsavedGuard,
} from './hooks';
import type { AdminPaymentProductView, PaymentCurrency } from '../../../types/payment';
import {
  EMPTY_PAYMENT_PRODUCT_DRAFT,
  PAYMENT_CURRENCY_OPTIONS,
  type PaymentProductDraft,
} from './constants';
import {
  SALE_STATUS_META,
  buildPaymentProductPayload,
  creditsText,
  moneyText,
  paymentProductToDraft,
  saleStatusOf,
  strategyText,
} from './utils';
import { PaymentProductFormDrawer } from './PaymentProductFormDrawer';

/**
 * 充值商品标签。
 *
 * 商品是**充值入口**，与 `/admin/products` 的积分商品不是同一份数据：
 * 那边的商品面向平台内权益，这边是「用户付钱买积分」的售卖对象，走支付域的
 * `Product` 表（带币种、售卖策略、库存、限时）。
 *
 * 上架策略四选一：不限量 / 周期限购 / 库存 / 限时。切换策略会清空不相关字段 ——
 * 留着上一套策略的残留值，提交时后端虽会归零，但界面上会让人以为两套规则
 * 同时生效。
 */

export function PaymentsProductsTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('product.write');

  const { data, loading, error, reload } = useAdminResource(() => adminPaymentProductsApi.list());
  const settings = useAdminResource(() => adminPaymentProvidersApi.settings());
  const providers = useAdminResource(() => adminPaymentProvidersApi.list());

  // 刷新只重取数据，不动表单草稿
  useRefreshOnNonce(refreshNonce, reload, settings.reload, providers.reload);

  const [editing, setEditing] = useState<AdminPaymentProductView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<PaymentProductDraft>(EMPTY_PAYMENT_PRODUCT_DRAFT);
  const [baseDraft, setBaseDraft] = useState<PaymentProductDraft>(EMPTY_PAYMENT_PRODUCT_DRAFT);
  const [saving, setSaving] = useState(false);

  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyDraft, setCurrencyDraft] = useState<PaymentCurrency>('CNY');

  const formOpen = creating || editing !== null;
  const formDirty =
    formOpen && !saving && JSON.stringify(draft) !== JSON.stringify(baseDraft);

  useUnsavedGuard(formDirty);
  const closeForm = useCallback(() => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
  }, [saving]);
  const requestCloseForm = useDiscardConfirm(formDirty, closeForm);

  const openDraft = useCallback((next: PaymentProductDraft, product: AdminPaymentProductView | null) => {
    setDraft(next);
    setBaseDraft(next);
    setEditing(product);
    setCreating(product === null);
  }, []);

  const openCreate = useCallback(() => {
    openDraft(
      { ...EMPTY_PAYMENT_PRODUCT_DRAFT, currency: settings.data?.defaultCurrency ?? 'CNY' },
      null,
    );
  }, [openDraft, settings.data?.defaultCurrency]);

  const openEdit = useCallback(
    (product: AdminPaymentProductView) => openDraft(paymentProductToDraft(product), product),
    [openDraft],
  );

  const patchDraft = useCallback(
    (patch: Partial<PaymentProductDraft>) => setDraft((prev) => ({ ...prev, ...patch })),
    [],
  );

  const products = data?.items ?? [];
  const stats = useMemo(() => {
    const result = { onSale: 0, upcoming: 0, soldOut: 0, total: products.length };
    for (const product of products) {
      const status = saleStatusOf(product);
      if (status === 'on_sale') result.onSale += 1;
      else if (status === 'upcoming') result.upcoming += 1;
      else if (status === 'sold_out') result.soldOut += 1;
    }
    return result;
  }, [products]);

  /** 可用币种：CNY 始终可选；USD 需要有已配置的美元渠道 */
  const usdAvailable = (providers.data?.items ?? []).some(
    (provider) => provider.configured && provider.supportedCurrencies.includes('USD'),
  );

  const columns: Array<AdminColumn<AdminPaymentProductView>> = [
    {
      key: 'name',
      title: '商品',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <span className="text-[12px] text-muted-foreground">{row.description || '无说明'}</span>
        </div>
      ),
    },
    {
      key: 'price',
      title: '售价',
      width: 120,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{moneyText(row.priceCents, row.currency)}</span>
          {row.originalPriceCents !== null && (
            <span className="text-[12px] text-muted-foreground line-through tabular-nums">
              {moneyText(row.originalPriceCents, row.currency)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'credits',
      title: '权益',
      width: 180,
      render: (row) => <span className="text-muted-foreground">{creditsText(row)}</span>,
    },
    {
      key: 'strategy',
      title: '上架策略',
      width: 200,
      render: (row) => <span className="text-muted-foreground">{strategyText(row)}</span>,
    },
    {
      key: 'saleStatus',
      title: '状态',
      width: 100,
      render: (row) => {
        const status = saleStatusOf(row);
        const meta = SALE_STATUS_META[status];
        return <StatusTag status={status} tone={meta.tone} label={meta.label} />;
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 80,
      render: (row) => (
        <ActionButton
          onClick={() => openEdit(row)}
          disabled={!writable}
          ariaLabel={`编辑${row.name}`}
        >
          编辑
        </ActionButton>
      ),
    },
  ];

  /*
   * 标签页内的加载骨架只占**这一块面板**的位置：页头、页签、提示条都在上面，
   * 已经渲染好了，不该跟着塌。
   */
  if (loading && !data) {
    return <PageSkeleton panels={1} panelRows={5} />;
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="还没有充值商品" />;

  const submit = async () => {
    const result = buildPaymentProductPayload(draft, usdAvailable);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await adminPaymentProductsApi.update(editing.id, result.payload);
        toast.success('商品已更新');
      } else {
        await adminPaymentProductsApi.create({ ...result.payload, sku: undefined });
        toast.success('商品已创建');
      }
      setCreating(false);
      setEditing(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <StatCards
        columns={4}
        items={[
          { label: '商品总数', value: stats.total },
          { label: '销售中', value: stats.onSale },
          {
            label: '待发售',
            value: stats.upcoming,
            tone: stats.upcoming > 0 ? 'warn' : undefined,
          },
          {
            label: '已售罄',
            value: stats.soldOut,
            tone: stats.soldOut > 0 ? 'danger' : undefined,
          },
        ]}
      />

      <Panel
        title="充值商品"
        note="商品是用户用真金白银兑换积分的售卖对象"
        extra={
          <>
            <span className="text-[12px] text-muted-foreground">
              默认货币
              <span className="ml-1 font-medium text-foreground">
                {settings.data?.defaultCurrency ?? 'CNY'}
              </span>
            </span>
            <ActionButton
              variant="ghost"
              size="sm"
              ariaLabel="更改默认充值货币"
              disabled={!can('payment.write')}
              onClick={() => {
                setCurrencyDraft(settings.data?.defaultCurrency ?? 'CNY');
                setCurrencyOpen(true);
              }}
            >
              更改
            </ActionButton>
            {writable && (
              <ActionButton icon={Plus} onClick={openCreate}>
                新增商品
              </ActionButton>
            )}
          </>
        }
      >
        {error && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable
          rows={products}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          emptyText="还没有充值商品"
          minWidth={900}
        />
      </Panel>

      <ConfirmDialog
        open={currencyOpen}
        title="更改默认充值货币"
        description="默认货币决定 C 端商品卡的展示顺序与结算币种。更改只影响展示与下单口径，已生成的订单按下单时的币种结算。"
        confirmText="确认更改"
        loading={saving}
        onCancel={() => setCurrencyOpen(false)}
        onConfirm={async () => {
          setSaving(true);
          try {
            await adminPaymentProvidersApi.saveSettings({ defaultCurrency: currencyDraft });
            toast.success('默认货币已更新');
            setCurrencyOpen(false);
            settings.reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '保存失败');
          } finally {
            setSaving(false);
          }
        }}
        extra={
          <SelectField
            value={currencyDraft}
            onChange={(value) => setCurrencyDraft((value as PaymentCurrency) ?? 'CNY')}
            options={PAYMENT_CURRENCY_OPTIONS}
            ariaLabel="默认充值货币"
          />
        }
      />

      <PaymentProductFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        writable={writable}
        usdAvailable={usdAvailable}
        saving={saving}
        onPatch={patchDraft}
        onClose={requestCloseForm}
        onSubmit={() => void submit()}
      />
    </div>
  );
}
