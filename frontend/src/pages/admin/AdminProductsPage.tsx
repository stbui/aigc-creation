import { useCallback, useMemo, useState } from 'react';
import { App, Button, Drawer, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { adminProductsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
  StatusTag,
} from '../../components/admin/PageHeader';
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
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('product.write');

  const [status, setStatus] = useState<'active' | 'offline' | undefined>();
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
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

  const { data, loading, error, setQuery, reload } = useAdminList<AdminProduct[]>(fetcher, {
    status: undefined,
  });

  const rows = data ?? [];

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
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (p: AdminProduct) => {
    setDraft(toDraft(p));
    setEditing(p);
    setCreating(false);
  };

  const closeForm = () => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
  };

  /** 提交前把草稿翻译成后端 payload; 任何一项非法就停下并指出是哪一项 */
  const submit = async () => {
    const priceCents = yuanTextToCents(draft.priceYuan);
    if (priceCents === null) {
      void message.error('售价格式不正确，请填两位小数的金额，如 9.90');
      return;
    }
    const originalCents = draft.originalPriceYuan.trim()
      ? yuanTextToCents(draft.originalPriceYuan)
      : undefined;
    if (draft.originalPriceYuan.trim() && originalCents === null) {
      void message.error('划线价格式不正确');
      return;
    }
    const credits = Number(draft.credits);
    if (!Number.isInteger(credits) || credits < 0) {
      void message.error('赠送积分必须是非负整数');
      return;
    }
    const validDays = Number(draft.creditsValidDays || '0');
    if (!Number.isInteger(validDays) || validDays < 0) {
      void message.error('积分有效期必须是非负整数天');
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
        void message.success('商品已更新，新价格对后续下单生效');
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
        void message.success('商品已创建，当前为下架状态，确认后请手动上架');
      }
      closeForm();
      reload();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '保存失败');
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
      void message.success(next === 'active' ? '已上架' : '已下架');
      reload();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<AdminProduct> = [
    {
      title: '商品',
      key: 'product',
      width: 220,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.name}</span>
          <code className="adm-cell-sub">{row.sku}</code>
        </div>
      ),
    },
    {
      title: '售价',
      key: 'price',
      width: 130,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>¥ {centsToYuanText(row.priceCents)}</span>
          {/* 分的口径同时给出: 财务回查流水时看到的是分, 免得每次心算 */}
          <span className="adm-cell-sub">{row.priceCents} 分</span>
        </div>
      ),
    },
    {
      title: '划线价',
      key: 'originalPrice',
      width: 90,
      render: (_: unknown, row) =>
        row.originalPriceCents !== null ? (
          <span className="adm-cell-sub" style={{ textDecoration: 'line-through' }}>
            ¥ {centsToYuanText(row.originalPriceCents)}
          </span>
        ) : (
          <span className="adm-cell-sub">—</span>
        ),
    },
    {
      title: '赠送积分',
      key: 'credits',
      width: 130,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.credits} 积分</span>
          <span className="adm-cell-sub">{validDaysText(row.creditsValidDays)}</span>
        </div>
      ),
    },
    {
      title: '发放方式',
      dataIndex: 'grantType',
      key: 'grantType',
      width: 90,
      render: (v: string) => (
        <span className="adm-cell-sub">{v === 'immediate' ? '支付即发放' : '人工发放'}</span>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 60,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      // `active` 与账号状态的「正常」共用同一个键: 商品语境下应读作「在售」
      render: (v: string) => <StatusTag status={v} label={v === 'active' ? '在售' : undefined} />,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '',
      key: 'ops',
      width: 110,
      fixed: 'right',
      render: (_: unknown, row) => (
        <div className="adm-ops">
          {writable && (
            <>
              <Button type="link" className="adm-link" onClick={() => openEdit(row)}>
                编辑
              </Button>
              <Button
                type="default"
                className={`adm-link${row.status === 'active' ? ' is-danger' : ''}`}
                disabled={saving}
                onClick={() => void runToggle(row)}
              >
                {row.status === 'active' ? '下架' : '上架'}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="商品管理"
        description="积分包与增值商品的价目表。改价只影响之后的下单，历史订单按下单时的快照结算。"
        actions={
          writable ? (
            <Button type="primary" className="adm-btn is-primary" onClick={openCreate}>
              <Plus size={14} style={{ marginRight: 4 }} />
              新建商品
            </Button>
          ) : (
            <span className="adm-cell-sub">当前账号无 product.write 权限，仅可查看</span>
          )
        }
      />

      <div className="adm-stat-grid">
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
        <Select
          className="adm-filter-select"
          placeholder="状态"
          allowClear
          value={status}
          onChange={(v) => {
            setStatus(v);
            setQuery({ status: v });
          }}
          options={[
            { value: 'active', label: '在售' },
            { value: 'offline', label: '已下架' },
          ]}
        />
        <FilterActions>
          <Button type="default" className="adm-btn" onClick={reload}>
            刷新
          </Button>
        </FilterActions>
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel
        title="全部商品"
        note="价格以「分」存储，界面展示按「元」；两者同时显示便于与流水核对"
      >
        {loading && !data ? (
          <AdminListLoading tip="加载商品…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <AdminEmpty
            description={
              status
                ? '当前筛选下没有商品。切换状态或清除筛选看看。'
                : '还没有商品。新建一个积分包，C 端结算页才会出现可购买项。'
            }
            action={
              status ? (
                <Button
                  type="default"
                  className="adm-btn"
                  onClick={() => {
                    setStatus(undefined);
                    setQuery({ status: undefined });
                  }}
                >
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table<AdminProduct>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            loading={loading}
            pagination={false}
            scroll={{ x: 1060 }}
          />
        )}
      </Panel>

      <Drawer
        title={editing ? '编辑商品' : '新建商品'}
        size={520}
        open={creating || editing !== null}
        onClose={closeForm}
        className="adm-drawer"
        destroyOnHidden
        footer={
          <div className="adm-drawer-footer">
            <Button type="default" className="adm-btn" onClick={closeForm} disabled={saving}>
              取消
            </Button>
            <Button
              type="primary"
              className="adm-btn is-primary"
              onClick={() => void submit()}
              disabled={saving}
            >
              {saving ? '保存中…' : editing ? '保存修改' : '创建'}
            </Button>
          </div>
        }
      >
        <div className="adm-form">
          <div className="adm-field">
            <label htmlFor="p-sku">SKU</label>
            <Input
              id="p-sku"
              value={draft.sku}
              disabled={editing !== null}
              onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
              placeholder="如 credits-100"
              maxLength={40}
            />
            <div className="adm-field-hint">
              {editing
                ? 'SKU 创建后不可修改：历史订单与外部对账都靠它认商品'
                : '只允许字母、数字与连字符，创建后不可修改'}
            </div>
          </div>

          <div className="adm-field">
            <label htmlFor="p-name">商品名称</label>
            <Input
              id="p-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="如 100 积分包"
              maxLength={80}
            />
          </div>

          <div className="adm-field">
            <label htmlFor="p-desc">商品描述</label>
            <Input.TextArea
              id="p-desc"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              maxLength={500}
              placeholder="展示在结算页的补充说明，可留空"
            />
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="p-price">售价（元）</label>
              <Input
                id="p-price"
                value={draft.priceYuan}
                onChange={(e) => setDraft({ ...draft, priceYuan: e.target.value })}
                placeholder="9.90"
                inputMode="decimal"
              />
              <div className="adm-field-hint">
                {yuanTextToCents(draft.priceYuan) !== null
                  ? `入库为 ${yuanTextToCents(draft.priceYuan)} 分`
                  : '两位小数'}
              </div>
            </div>
            <div className="adm-field">
              <label htmlFor="p-original">划线价（元）</label>
              <Input
                id="p-original"
                value={draft.originalPriceYuan}
                onChange={(e) => setDraft({ ...draft, originalPriceYuan: e.target.value })}
                placeholder="留空表示不展示"
                inputMode="decimal"
              />
              <div className="adm-field-hint">仅用于展示对比，不参与结算</div>
            </div>
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="p-credits">赠送积分</label>
              <Input
                id="p-credits"
                value={draft.credits}
                onChange={(e) => setDraft({ ...draft, credits: e.target.value })}
                inputMode="numeric"
                placeholder="100"
              />
            </div>
            <div className="adm-field">
              <label htmlFor="p-days">积分有效期（天）</label>
              <Input
                id="p-days"
                value={draft.creditsValidDays}
                onChange={(e) => setDraft({ ...draft, creditsValidDays: e.target.value })}
                inputMode="numeric"
                placeholder="0"
              />
              <div className="adm-field-hint">0 表示永久有效，不参与到期回收</div>
            </div>
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="p-grant">发放方式</label>
              <Select
                id="p-grant"
                value={draft.grantType}
                onChange={(value) =>
                  setDraft({ ...draft, grantType: value as 'immediate' | 'manual' })
                }
                options={[
                  { value: 'immediate', label: '支付成功即发放' },
                  { value: 'manual', label: '人工发放（需运营在积分账本操作）' },
                ]}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="p-sort">排序权重</label>
              <Input
                id="p-sort"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                inputMode="numeric"
                placeholder="0"
              />
              <div className="adm-field-hint">数字越小越靠前</div>
            </div>
          </div>

          {editing && (
            <div className="adm-field-hint">
              上次更新：{new Date(editing.updatedAt).toLocaleString('zh-CN')} · 改价会写入操作审计
            </div>
          )}
        </div>
      </Drawer>

    </>
  );
}
