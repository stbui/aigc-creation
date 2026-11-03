import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminPaymentProductsApi, adminPaymentProvidersApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmAction,
  Drawer,
  EmptyState,
  FormField,
  ListError,
  Notice,
  NumberField,
  PageSkeleton,
  Panel,
  SelectField,
  StatCard,
  StatusTag,
  SwitchField,
  TextAreaField,
  TextField,
  type AdminColumn,
} from './components';
import { useAdmin, useAdminResource, useToast } from './hooks';
import { auditReason } from '../../../admin-ui/lib/auditReason';
import type {
  AdminPaymentProductView,
  PaymentCurrency,
  PaymentSaleStrategy,
} from '../../../types/payment';
import {
  SALE_STATUS_META,
  creditsText,
  moneyText,
  saleStatusOf,
  strategyText,
} from './utils';

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

const STRATEGY_OPTIONS: Array<{ value: PaymentSaleStrategy; label: string }> = [
  { value: 'unlimited', label: '不限量' },
  { value: 'periodic', label: '周期限购' },
  { value: 'inventory', label: '库存' },
  { value: 'timed', label: '限时' },
];

interface ProductDraft {
  name: string;
  description: string;
  currency: PaymentCurrency;
  /** 元 / 美元，输入用小数，提交前换算成分 */
  price: string;
  originalPrice: string;
  credits: string;
  creditsValidDays: string;
  grantType: 'immediate' | 'manual';
  saleStrategy: PaymentSaleStrategy;
  periodDays: string;
  periodPurchaseLimit: string;
  stockTotal: string;
  saleStartAt: string;
  saleEndAt: string;
  sortOrder: string;
  enabled: boolean;
}

const EMPTY_DRAFT: ProductDraft = {
  name: '',
  description: '',
  currency: 'CNY',
  price: '',
  originalPrice: '',
  credits: '',
  creditsValidDays: '0',
  grantType: 'immediate',
  saleStrategy: 'unlimited',
  periodDays: '30',
  periodPurchaseLimit: '1',
  stockTotal: '0',
  saleStartAt: '',
  saleEndAt: '',
  sortOrder: '0',
  enabled: false,
};

function centsToText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * UTC ISO → `datetime-local` 值。
 *
 * 不能直接 slice ISO 字符串：后端存的是 UTC，`slice(0,16)` 会把 UTC 时间
 * 当成浏览器本地时间显示，每次编辑保存都会把限时窗口平移时区差（国内 8 小时）。
 */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function textToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

function toDraft(p: AdminPaymentProductView): ProductDraft {
  return {
    name: p.name,
    description: p.description,
    currency: p.currency,
    price: centsToText(p.priceCents),
    originalPrice: p.originalPriceCents === null ? '' : centsToText(p.originalPriceCents),
    credits: String(p.credits),
    creditsValidDays: String(p.creditsValidDays),
    grantType: p.grantType === 'manual' ? 'manual' : 'immediate',
    saleStrategy: p.saleStrategy,
    periodDays: String(p.periodDays || 30),
    periodPurchaseLimit: String(p.periodPurchaseLimit || 1),
    stockTotal: String(p.stockTotal || 0),
    saleStartAt: isoToLocalInput(p.saleStartAt),
    saleEndAt: isoToLocalInput(p.saleEndAt),
    sortOrder: String(p.sortOrder),
    enabled: p.status === 'active',
  };
}

/** `datetime-local` → ISO；空串返回 null */
function localToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function PaymentsProductsTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('product.write');

  const { data, loading, error, reload } = useAdminResource(() =>
    adminPaymentProductsApi.list(),
  );
  const settings = useAdminResource(() => adminPaymentProvidersApi.settings());
  const providers = useAdminResource(() => adminPaymentProvidersApi.list());

  // 刷新只重取数据，不动表单草稿
  useEffect(() => {
    if (refreshNonce > 0) {
      void reload();
      void settings.reload();
      void providers.reload();
    }
  }, [refreshNonce, reload, settings.reload, providers.reload]);

  const [editing, setEditing] = useState<AdminPaymentProductView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyDraft, setCurrencyDraft] = useState<PaymentCurrency>('CNY');

  const formOpen = creating || editing !== null;

  const openCreate = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT, currency: settings.data?.defaultCurrency ?? 'CNY' });
    setEditing(null);
    setCreating(true);
  }, [settings.data?.defaultCurrency]);

  const openEdit = useCallback((p: AdminPaymentProductView) => {
    setDraft(toDraft(p));
    setEditing(p);
    setCreating(false);
  }, []);

  const closeForm = useCallback(() => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
  }, [saving]);

  const products = data?.items ?? [];
  const stats = useMemo(() => {
    const onSale = products.filter((p) => saleStatusOf(p) === 'on_sale').length;
    const upcoming = products.filter((p) => saleStatusOf(p) === 'upcoming').length;
    const soldOut = products.filter((p) => saleStatusOf(p) === 'sold_out').length;
    return { onSale, upcoming, soldOut, total: products.length };
  }, [products]);

  /** 可用币种：CNY 始终可选；USD 需要有已配置的美元渠道 */
  const usdAvailable = (providers.data?.items ?? []).some(
    (p) => p.configured && p.supportedCurrencies.includes('USD'),
  );

  const columns: Array<AdminColumn<AdminPaymentProductView>> = [
    {
      key: 'name',
      title: '商品',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <span className="text-[12px] text-muted-foreground">
            {row.description || '无说明'}
          </span>
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
        <ActionButton onClick={() => openEdit(row)} disabled={!writable} ariaLabel={`编辑${row.name}`}>
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
    const priceCents = textToCents(draft.price);
    if (priceCents === null || priceCents <= 0) {
      toast.error('售价必须大于 0，请填两位小数的金额，如 9.90');
      return;
    }
    let originalPriceCents: number | null = null;
    if (draft.originalPrice.trim()) {
      originalPriceCents = textToCents(draft.originalPrice);
      if (originalPriceCents === null) {
        toast.error('划线价格式不正确');
        return;
      }
      if (originalPriceCents < priceCents) {
        toast.error('划线价不能低于售价');
        return;
      }
    }
    if (draft.saleStrategy === 'inventory' && (Number(draft.stockTotal) || 0) < 1) {
      toast.error('库存商品必须填写大于 0 的库存总量');
      return;
    }
    const credits = Number(draft.credits);
    if (!Number.isInteger(credits) || credits < 0) {
      toast.error('到账积分必须是非负整数');
      return;
    }
    const validDays = Number(draft.creditsValidDays || '0');
    if (!Number.isInteger(validDays) || validDays < 0 || validDays > 3650) {
      toast.error('积分有效期必须是 0–3650 之间的整数天');
      return;
    }
    if (draft.enabled && draft.currency === 'USD' && !usdAvailable) {
      toast.error('当前没有已配置的美元支付渠道，无法上架美元商品');
      return;
    }
    const payload = {
      // DTO 必填：当前只支持积分商品
      kind: 'credits' as const,
      name: draft.name.trim(),
      description: draft.description,
      currency: draft.currency,
      priceCents,
      originalPriceCents,
      credits,
      creditsValidDays: validDays,
      grantType: draft.grantType,
      sortOrder: Number(draft.sortOrder) || 0,
      saleStrategy: draft.saleStrategy,
      ...(draft.saleStrategy === 'periodic'
        ? {
            periodDays: Number(draft.periodDays) || 30,
            periodPurchaseLimit: Number(draft.periodPurchaseLimit) || 1,
          }
        : {}),
      ...(draft.saleStrategy === 'inventory'
        ? { stockTotal: Number(draft.stockTotal) || 0 }
        : {}),
      ...(draft.saleStrategy === 'timed'
        ? {
            saleStartAt: localToIso(draft.saleStartAt),
            saleEndAt: localToIso(draft.saleEndAt),
          }
        : {}),
      status: draft.enabled ? 'active' : 'offline',
      reason: auditReason(editing ? '编辑充值商品' : '新建充值商品'),
    };

    setSaving(true);
    try {
      if (editing) {
        await adminPaymentProductsApi.update(editing.id, payload);
        toast.success('商品已更新');
      } else {
        await adminPaymentProductsApi.create({ ...payload, sku: undefined });
        toast.success('商品已创建');
      }
      closeForm();
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="商品总数" value={stats.total} />
        <StatCard label="销售中" value={stats.onSale} />
        <StatCard label="待发售" value={stats.upcoming} tone={stats.upcoming > 0 ? 'warn' : undefined} />
        <StatCard label="已售罄" value={stats.soldOut} tone={stats.soldOut > 0 ? 'danger' : undefined} />
      </div>

      <Panel
        title="充值商品"
        note="商品是用户用真金白银兑换积分的售卖对象"
        extra={
          writable ? (
            <ActionButton icon={Plus} onClick={openCreate}>
              新增商品
            </ActionButton>
          ) : undefined
        }
      >
        <AdminDataTable
          rows={products}
          columns={columns}
          rowKey={(row) => row.id}
          emptyText="还没有充值商品"
          minWidth={900}
        />
      </Panel>

      <Panel title="默认充值货币" note="C 端商品卡按此排序与展示">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-sm">
            当前默认货币：
            <span className="font-medium">{settings.data?.defaultCurrency ?? 'CNY'}</span>
          </span>
          <ActionButton
            onClick={() => {
              setCurrencyDraft(settings.data?.defaultCurrency ?? 'CNY');
              setCurrencyOpen(true);
            }}
            disabled={!can('payment.write')}
          >
            更改
          </ActionButton>
        </div>
      </Panel>

      <ConfirmAction
        open={currencyOpen}
        title="更改默认充值货币"
        description="默认货币决定 C 端商品卡的展示顺序与结算币种。更改只影响展示与下单口径，已生成的订单按下单时的币种结算。"
        confirmText="确认更改"
        onCancel={() => setCurrencyOpen(false)}
        onConfirm={async () => {
          setSaving(true);
          try {
            await adminPaymentProvidersApi.saveSettings({
              defaultCurrency: currencyDraft,
              reason: auditReason('更改默认充值货币'),
            });
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
          <div className="flex flex-col gap-2">
            <SelectField
              value={currencyDraft}
              onChange={(value) => setCurrencyDraft((value as PaymentCurrency) ?? 'CNY')}
              options={[
                { value: 'CNY', label: '人民币 CNY' },
                { value: 'USD', label: '美元 USD' },
              ]}
              ariaLabel="默认充值货币"
            />
          </div>
        }
      />

      {formOpen && (
        <Drawer
          open
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
          title={editing ? `编辑商品 · ${editing.name}` : '新增商品'}
          description="售价按元 / 美元填写，提交时换算为整数分"
          width={520}
          footer={
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={closeForm} disabled={saving}>
                取消
              </ActionButton>
              <ActionButton
                onClick={submit}
                disabled={saving || !draft.name.trim()}
              >
                {saving ? '保存中…' : '保存'}
              </ActionButton>
            </div>
          }
        >
          <div className="flex flex-col gap-3.5">
            <FormField label="商品名称" required>
              <TextField
                value={draft.name}
                onChange={(value) => setDraft({ ...draft, name: value })}
                placeholder="例如：2,000 积分高能包"
                maxLength={80}
                disabled={!writable}
              />
            </FormField>

            <FormField label="商品说明">
              <TextAreaField
                value={draft.description}
                onChange={(value) => setDraft({ ...draft, description: value })}
                maxLength={200}
                disabled={!writable}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="售价币种" required>
                <SelectField
                  value={draft.currency}
                  onChange={(value) =>
                    setDraft({ ...draft, currency: (value as PaymentCurrency) ?? 'CNY' })
                  }
                  options={[
                    { value: 'CNY', label: '人民币 CNY' },
                    { value: 'USD', label: '美元 USD' },
                  ]}
                  disabled={!writable}
                />
              </FormField>

              <FormField label="售价" required hint="大于 0，最多两位小数">
                <TextField
                  value={draft.price}
                  onChange={(value) => setDraft({ ...draft, price: value })}
                  placeholder="9.90"
                  inputMode="decimal"
                  disabled={!writable}
                />
              </FormField>
            </div>

            {!usdAvailable && draft.currency === 'USD' && (
              <Notice tone="warn" title="暂无美元支付渠道">
                当前没有已配置的美元渠道，美元商品可以保存为下架状态，但不能上架。
              </Notice>
            )}

            <FormField label="划线价" hint="留空表示没有划线价">
              <TextField
                value={draft.originalPrice}
                onChange={(value) => setDraft({ ...draft, originalPrice: value })}
                placeholder="19.90"
                inputMode="decimal"
                disabled={!writable}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="到账积分" required>
                <TextField
                  value={draft.credits}
                  onChange={(value) => setDraft({ ...draft, credits: value })}
                  inputMode="numeric"
                  placeholder="2000"
                  disabled={!writable}
                />
              </FormField>

              <FormField label="积分有效期（天）" hint="0 = 永久有效">
                <TextField
                  value={draft.creditsValidDays}
                  onChange={(value) => setDraft({ ...draft, creditsValidDays: value })}
                  inputMode="numeric"
                  disabled={!writable}
                />
              </FormField>
            </div>

            <FormField label="上架策略" required>
              <SelectField
                value={draft.saleStrategy}
                onChange={(value) =>
                  setDraft({ ...draft, saleStrategy: (value as PaymentSaleStrategy) ?? 'unlimited' })
                }
                options={STRATEGY_OPTIONS}
                disabled={!writable}
              />
            </FormField>

            {draft.saleStrategy === 'periodic' && (
              <div className="grid grid-cols-2 gap-3">
                <FormField label="周期天数" required>
                  <NumberField
                    value={Number(draft.periodDays) || 30}
                    onChange={(value) => setDraft({ ...draft, periodDays: String(value ?? 30) })}
                    min={1}
                    max={365}
                    disabled={!writable}
                    ariaLabel="周期天数"
                  />
                </FormField>
                <FormField label="周期限购次数" required>
                  <NumberField
                    value={Number(draft.periodPurchaseLimit) || 1}
                    onChange={(value) =>
                      setDraft({ ...draft, periodPurchaseLimit: String(value ?? 1) })
                    }
                    min={1}
                    max={999}
                    disabled={!writable}
                    ariaLabel="周期限购次数"
                  />
                </FormField>
              </div>
            )}

            {draft.saleStrategy === 'inventory' && (
              <FormField label="库存总量" required hint="必须大于 0；售罄后不可购买">
                <NumberField
                  value={Number(draft.stockTotal) || 0}
                  onChange={(value) => setDraft({ ...draft, stockTotal: String(value ?? 0) })}
                  min={1}
                  max={1_000_000}
                  disabled={!writable}
                  ariaLabel="库存总量"
                />
              </FormField>
            )}

            {draft.saleStrategy === 'timed' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="开售时间" required>
                    <TextField
                      type="datetime-local"
                      value={draft.saleStartAt}
                      onChange={(value) => setDraft({ ...draft, saleStartAt: value })}
                      disabled={!writable}
                    />
                  </FormField>
                  <FormField label="结束时间" required>
                    <TextField
                      type="datetime-local"
                      value={draft.saleEndAt}
                      onChange={(value) => setDraft({ ...draft, saleEndAt: value })}
                      disabled={!writable}
                    />
                  </FormField>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  时间按浏览器本地时区显示，保存为绝对时间（中国区即北京时间）。
                </p>
              </>
            )}

            <FormField label="排序" hint="数字越小越靠前">
              <NumberField
                value={Number(draft.sortOrder) || 0}
                onChange={(value) => setDraft({ ...draft, sortOrder: String(value ?? 0) })}
                min={0}
                max={9999}
                disabled={!writable}
                ariaLabel="排序"
              />
            </FormField>


            <FormField label="上架" hint="下架的商品用户看不到也买不了">
              <SwitchField
                checked={draft.enabled}
                onChange={(checked) => setDraft({ ...draft, enabled: checked })}
                label={draft.enabled ? '已上架' : '已下架'}
                disabled={!writable}
                ariaLabel="上架开关"
              />
            </FormField>
          </div>
        </Drawer>
      )}
    </div>
  );
}
