import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { adminProductsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  Drawer,
  FilterActions,
  FilterBar,
  FormField,
  PageHeader,
  Panel,
  SelectField,
  StaleError,
  StatCard,
  StatusTag,
  TextAreaField,
  TextField,
  useAdminList,
  useAdminUrlFilterSync,
  type AdminColumn,
  type AppliedFilter,
} from '../../admin-ui/primitives';
import type { AdminProduct } from '../../types/api';

/**
 * 商品管理 (B-34~B-36)。
 *
 * ## 为什么没有「删除」
 *
 * 历史订单的 OrderItem 存的是**快照** (name/sku/价格/积分), 删商品不会让
 * 旧订单显示不全。但对账时后台就再也查不到「这个 SKU 原来卖多少钱、发多少
 * 积分」了 —— 而这两个数正是退款与积分回收的计算依据。下架即够。
 *
 * ## 为什么价格用「元」输入、「分」存储
 *
 * 库里一律整数分 (浮点算钱会在对账时出现 0.01 的差异, 且无法复现)。
 * 运营面对的是价目表, 填 9.9 元比填 990 自然。转换只在提交/回填两处发生,
 * 且用 Math.round 而不是 parseInt —— `9.9 * 100` 在浮点下是 989.9999…
 */

/** 分 → 元 (输入框回填值) */
function centsToYuanText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元 → 分。非法输入返回 null, 由调用方拦截; 不在转换里兜底成 0 —— 静默变免费是灾难 */
function yuanTextToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** 表单草稿。金额留字符串, 避免每次输入都做一次有损转换 */
interface ProductDraft {
  sku: string;
  name: string;
  description: string;
  /** 元 */
  priceYuan: string;
  /** 元; 空串 = 无划线价 */
  originalPriceYuan: string;
  credits: string;
  /** 0 = 永久 */
  creditsValidDays: string;
  grantType: 'immediate' | 'manual';
  sortOrder: string;
}

const EMPTY_DRAFT: ProductDraft = {
  sku: '',
  name: '',
  description: '',
  priceYuan: '',
  originalPriceYuan: '',
  credits: '',
  creditsValidDays: '0',
  grantType: 'immediate',
  sortOrder: '0',
};

function toDraft(p: AdminProduct): ProductDraft {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    priceYuan: centsToYuanText(p.priceCents),
    originalPriceYuan: p.originalPriceCents === null ? '' : centsToYuanText(p.originalPriceCents),
    credits: String(p.credits),
    creditsValidDays: String(p.creditsValidDays),
    grantType: p.grantType,
    sortOrder: String(p.sortOrder),
  };
}

/** 积分有效期的人类可读文案。0 是「永久」而不是「0 天」 */
function validDaysText(days: number): string {
  return days === 0 ? '永久有效' : `${days} 天`;
}

export function AdminProductsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('product.write');

  const [searchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const initialStatus: 'active' | 'offline' | undefined =
    rawStatus === 'active' || rawStatus === 'offline' ? rawStatus : undefined;

  const [status, setStatus] = useState<'active' | 'offline' | undefined>(initialStatus);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [draftBase, setDraftBase] = useState<ProductDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  /**
   * 商品不分组不分页: 积分包/会员套餐一类的 SKU 通常只有个位数到几十个,
   * 一次全量拉取比分页更符合运营的心智 (他们要看的就是「全部卖什么」)。
   */
  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminProductsApi.list(params.status as 'active' | 'offline' | undefined),
    [],
  );

  const { data, loading, error, params, setQuery, reload } = useAdminList<AdminProduct[]>(
    fetcher,
    {
      ...(initialStatus ? { status: initialStatus } : {}),
    },
  );

  useAdminUrlFilterSync({ status: params.status as string | undefined });

  const rows = data ?? [];
  const appliedStatus = params.status as 'active' | 'offline' | undefined;
  const appliedChips: AppliedFilter[] = appliedStatus
    ? [
        {
          key: 'status',
          label: `状态：${appliedStatus === 'active' ? '在售' : '已下架'}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        },
      ]
    : [];

  const stats = useMemo(() => {
    const active = rows.filter((p) => p.status === 'active');
    const offline = rows.length - active.length;
    const discounted = rows.filter(
      (p) => p.originalPriceCents !== null && p.originalPriceCents > p.priceCents,
    ).length;
    return { active: active.length, offline, discounted };
  }, [rows]);

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDraftBase(EMPTY_DRAFT);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (p: AdminProduct) => {
    const next = toDraft(p);
    setDraft(next);
    setDraftBase(next);
    setEditing(p);
    setCreating(false);
  };

  const formOpen = creating || editing !== null;
  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const closeForm = () => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
  };
  const requestCloseForm = useDiscardConfirm(formDirty, closeForm);

  /** 提交前把草稿翻译成后端 payload; 任何一项非法就停下并指出是哪一项 */
  const submit = async () => {
    const priceCents = yuanTextToCents(draft.priceYuan);
    if (priceCents === null) {
      toast.error('售价格式不正确，请填两位小数的金额，如 9.90');
      return;
    }
    const originalCents = draft.originalPriceYuan.trim()
      ? yuanTextToCents(draft.originalPriceYuan)
      : undefined;
    if (draft.originalPriceYuan.trim() && originalCents === null) {
      toast.error('划线价格式不正确');
      return;
    }
    const credits = Number(draft.credits);
    if (!Number.isInteger(credits) || credits < 0) {
      toast.error('赠送积分必须是非负整数');
      return;
    }
    const validDays = Number(draft.creditsValidDays || '0');
    if (!Number.isInteger(validDays) || validDays < 0) {
      toast.error('积分有效期必须是非负整数天');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await adminProductsApi.update(editing.id, {
          name: draft.name.trim(),
          description: draft.description,
          priceCents,
          // 清空划线价要显式传 null —— 传 undefined 会被 whitelist 丢掉, 旧值留着
          originalPriceCents: originalCents ?? null,
          credits,
          creditsValidDays: validDays,
          grantType: draft.grantType,
          sortOrder: Number(draft.sortOrder) || 0,
          ...(editing.priceCents !== priceCents
            ? { reason: `改价 ${centsToYuanText(editing.priceCents)} → ${centsToYuanText(priceCents)} 元` }
            : {}),
        });
        toast.success('商品已更新，新价格对后续下单生效');
      } else {
        await adminProductsApi.create({
          sku: draft.sku.trim(),
          name: draft.name.trim(),
          description: draft.description,
          priceCents,
          // 新建时 null 与"不填"同效 (库里就是 null), 但 DTO 只接受数字, 故不发 null
          ...(originalCents != null ? { originalPriceCents: originalCents } : {}),
          credits,
          creditsValidDays: validDays,
          grantType: draft.grantType,
          sortOrder: Number(draft.sortOrder) || 0,
          // 新建一律先下架: 建完确认无误再上架, 避免半成品 SKU 立刻可售
          status: 'offline',
        });
        toast.success('商品已创建，当前为下架状态，确认后请手动上架');
      }
      closeForm();
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 上下架可随时再切回，按产品要求直接执行，不再弹窗确认 */
  const runToggle = async (row: AdminProduct) => {
    const next = row.status === 'active' ? 'offline' : 'active';
    setSaving(true);
    try {
      await adminProductsApi.setStatus(row.id, next);
      toast.success(next === 'active' ? '已上架' : '已下架');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: Array<AdminColumn<AdminProduct>> = [
    {
      key: 'product',
      title: '商品',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.name}</span>
          <code className="font-mono text-[11px] text-muted-foreground">{row.sku}</code>
        </div>
      ),
    },
    {
      key: 'price',
      title: '售价',
      width: 130,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">¥ {centsToYuanText(row.priceCents)}</span>
          {/* 分的口径同时给出: 财务回查流水时看到的是分, 免得每次心算 */}
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {row.priceCents} 分
          </span>
        </div>
      ),
    },
    {
      key: 'originalPrice',
      title: '划线价',
      width: 90,
      render: (row) =>
        row.originalPriceCents !== null ? (
          <span className="tabular-nums text-muted-foreground line-through">
            ¥ {centsToYuanText(row.originalPriceCents)}
          </span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
    {
      key: 'credits',
      title: '赠送积分',
      width: 130,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{row.credits} 积分</span>
          <span className="text-[11px] text-muted-foreground">
            {validDaysText(row.creditsValidDays)}
          </span>
        </div>
      ),
    },
    {
      key: 'grantType',
      title: '发放方式',
      width: 90,
      render: (row) => (
        <span className="text-[11px] text-muted-foreground">
          {row.grantType === 'immediate' ? '支付即发放' : '人工发放'}
        </span>
      ),
    },
    {
      key: 'sortOrder',
      title: '排序',
      width: 60,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.sortOrder}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      // `active` 与账号状态的「正常」共用同一个键: 商品语境下应读作「在售」
      render: (row) => (
        <StatusTag status={row.status} label={row.status === 'active' ? '在售' : undefined} />
      ),
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      width: 150,
      render: (row) => new Date(row.updatedAt).toLocaleString('zh-CN'),
    },
    {
      key: 'ops',
      title: '',
      width: 120,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" size="sm" onClick={() => openEdit(row)}>
              编辑
            </ActionButton>
            <ActionButton
              variant={row.status === 'active' ? 'destructive' : 'ghost'}
              size="sm"
              disabled={saving}
              onClick={() => void runToggle(row)}
            >
              {row.status === 'active' ? '下架' : '上架'}
            </ActionButton>
          </div>
        ) : null,
    },
  ];

  const clearStatus = () => {
    setStatus(undefined);
    setQuery({ status: undefined });
  };

  return (
    <>
      <PageHeader
        title="商品管理"
        description="积分包与增值商品的价目表。改价只影响之后的下单，历史订单按下单时的快照结算。"
        actions={
          writable ? (
            <ActionButton icon={Plus} onClick={openCreate}>
              新建商品
            </ActionButton>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              当前账号无 product.write 权限，仅可查看
            </span>
          )
        }
      />

      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="商品总数" value={rows.length} hint="含已下架，均可被历史订单引用" />
        <StatCard label="在售" value={stats.active} hint="C 端可下单" />
        <StatCard label="已下架" value={stats.offline} hint="不可下单，历史订单不受影响" />
        <StatCard
          label="促销中"
          value={stats.discounted}
          hint="划线价高于售价的商品数量"
          tone={stats.discounted > 0 ? 'warn' : undefined}
        />
      </div>

      <FilterBar>
        <SelectField
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          clearLabel="全部状态"
          value={status}
          onChange={(value) => {
            const next = value as 'active' | 'offline' | undefined;
            setStatus(next);
            setQuery({ status: next });
          }}
          options={[
            { value: 'active', label: '在售' },
            { value: 'offline', label: '已下架' },
          ]}
        />
        <FilterActions>
          <ActionButton variant="secondary" onClick={reload}>
            刷新
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={clearStatus} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel
        title="全部商品"
        note="价格以「分」存储，界面展示按「元」；两者同时显示便于与流水核对"
      >
        <AdminDataTable<AdminProduct>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1120}
          emptyText={
            status
              ? '当前筛选下没有商品。切换状态或清除筛选看看。'
              : '还没有商品。新建一个积分包，C 端结算页才会出现可购买项。'
          }
          emptyAction={
            status ? (
              <ActionButton variant="secondary" onClick={clearStatus}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={520}
        title={editing ? '编辑商品' : '新建商品'}
        description={formDirty ? '有未保存修改' : undefined}
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={requestCloseForm}
              disabled={saving}
            >
              取消
            </ActionButton>
            <ActionButton disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : editing ? '保存修改' : '创建'}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField
            label="SKU"
            hint={
              editing
                ? 'SKU 创建后不可修改：历史订单与外部对账都靠它认商品'
                : '只允许字母、数字与连字符，创建后不可修改'
            }
          >
            <TextField
              ariaLabel="SKU"
              value={draft.sku}
              disabled={editing !== null}
              onChange={(value) => setDraft({ ...draft, sku: value })}
              placeholder="如 credits-100"
              maxLength={40}
            />
          </FormField>

          <FormField label="商品名称">
            <TextField
              ariaLabel="商品名称"
              value={draft.name}
              onChange={(value) => setDraft({ ...draft, name: value })}
              placeholder="如 100 积分包"
              maxLength={80}
            />
          </FormField>

          <FormField label="商品描述">
            <TextAreaField
              ariaLabel="商品描述"
              value={draft.description}
              onChange={(value) => setDraft({ ...draft, description: value })}
              rows={2}
              maxLength={500}
              placeholder="展示在结算页的补充说明，可留空"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="售价（元）"
              hint={
                yuanTextToCents(draft.priceYuan) !== null
                  ? `入库为 ${yuanTextToCents(draft.priceYuan)} 分`
                  : '两位小数'
              }
            >
              <TextField
                ariaLabel="售价"
                inputMode="decimal"
                value={draft.priceYuan}
                onChange={(value) => setDraft({ ...draft, priceYuan: value })}
                placeholder="9.90"
              />
            </FormField>
            <FormField label="划线价（元）" hint="仅用于展示对比，不参与结算">
              <TextField
                ariaLabel="划线价"
                inputMode="decimal"
                value={draft.originalPriceYuan}
                onChange={(value) => setDraft({ ...draft, originalPriceYuan: value })}
                placeholder="留空表示不展示"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="赠送积分">
              <TextField
                ariaLabel="赠送积分"
                inputMode="numeric"
                value={draft.credits}
                onChange={(value) => setDraft({ ...draft, credits: value })}
                placeholder="100"
              />
            </FormField>
            <FormField label="积分有效期（天）" hint="0 表示永久有效，不参与到期回收">
              <TextField
                ariaLabel="积分有效期天数"
                inputMode="numeric"
                value={draft.creditsValidDays}
                onChange={(value) => setDraft({ ...draft, creditsValidDays: value })}
                placeholder="0"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="发放方式"
              hint={draft.grantType === 'manual' ? '需运营在积分账本中手动发放' : undefined}
            >
              <SelectField
                ariaLabel="发放方式"
                value={draft.grantType}
                onChange={(value) =>
                  setDraft({ ...draft, grantType: value as 'immediate' | 'manual' })
                }
                options={[
                  { value: 'immediate', label: '支付成功即发放' },
                  { value: 'manual', label: '人工发放' },
                ]}
              />
            </FormField>
            <FormField label="排序权重" hint="数字越小越靠前">
              <TextField
                ariaLabel="排序权重"
                inputMode="numeric"
                value={draft.sortOrder}
                onChange={(value) => setDraft({ ...draft, sortOrder: value })}
                placeholder="0"
              />
            </FormField>
          </div>

          {editing && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              上次更新：{new Date(editing.updatedAt).toLocaleString('zh-CN')} · 改价会写入操作审计
            </p>
          )}
        </div>
      </Drawer>
    </>
  );
}
