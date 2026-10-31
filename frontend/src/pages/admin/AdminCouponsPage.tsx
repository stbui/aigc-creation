import { useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { marketingApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { Notice } from '../../admin-ui/primitives';
import { SelectBox, TextInput } from '../../admin-ui/controls';
import {
  AdminStaleError,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
  type AppliedFilter,
  type TagTone,
} from '../../components/admin/PageHeader';
import type {
  AdminCoupon,
  CouponScope,
  CouponStatus,
  CouponType,
  UpsertCouponPayload,
} from '../../types/api';

/** 分 → 元 */
const yuan = (cents: number) => (cents / 100).toFixed(2);

/** 面额展示: 语义随类型而变, 不统一按元显示 */
function faceValue(c: { type: CouponType; value: number }): string {
  if (c.type === 'discount') {
    // 万分比 → 折数: 8500 → 8.5折
    const zhe = (c.value / 1000).toFixed(2).replace(/\.?0+$/, '');
    return `${zhe} 折`;
  }
  return `¥${yuan(c.value)}`;
}

const TYPE_LABEL: Record<CouponType, string> = {
  full_cut: '满减',
  discount: '折扣',
  fixed: '固定额',
};

const SCOPE_LABEL: Record<CouponScope, string> = {
  all: '全站',
  product: '指定商品',
  new_user: '仅新用户首单',
};

/** 时间格式化为 datetime-local 需要的格式 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 表单字段：标签 + 控件 + 一句说明 */
function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <p className="text-[11px] leading-4 text-text-tertiary">{hint}</p>}
    </div>
  );
}

interface FormState {
  code: string;
  name: string;
  type: CouponType;
  /** 折扣为万分比；满减 / 固定额为用户输入的**元** —— 只在 buildPayload 换算一次 */
  value: string;
  /** 使用门槛，用户输入的**元** —— 只在 buildPayload 换算一次 */
  threshold: string;
  scope: CouponScope;
  totalCount: string;
  perUserLimit: string;
  validFrom: string;
  validTo: string;
  status: CouponStatus;
}

function emptyForm(): FormState {
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return {
    code: '',
    name: '',
    type: 'full_cut',
    value: '',
    threshold: '0',
    scope: 'all',
    totalCount: '0',
    perUserLimit: '1',
    validFrom: toLocalInput(now.toISOString()),
    validTo: toLocalInput(later.toISOString()),
    status: 'on',
  };
}

/** 券的派生生效态：优先于人工开关展示，过期/未开始/售罄不是「停用」 */
const EFFECTIVE_META: Record<AdminCoupon['effective'], { label: string; tone: TagTone }> = {
  on: { label: '生效中', tone: 'success' },
  off: { label: '已停用', tone: 'muted' },
  expired: { label: '已过期', tone: 'warn' },
  not_started: { label: '未开始', tone: 'brand' },
  sold_out: { label: '已售罄', tone: 'danger' },
};

export function AdminCouponsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('keyword') ?? '';
  // 地址栏参数不可信: 只接受本页筛选下拉里真实存在的取值, 否则会把
  // 非法枚举直接送到后端, 变成一次 400
  const rawType = searchParams.get('type');
  const initialType = rawType && rawType in TYPE_LABEL ? rawType : undefined;
  const rawStatus = searchParams.get('status');
  const initialStatus = rawStatus === 'on' || rawStatus === 'off' ? rawStatus : undefined;

  const [keyword, setKeyword] = useState(initialKeyword);
  const [type, setType] = useState<string | undefined>(initialType);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formBase, setFormBase] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const formDirty = Boolean(
    formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase),
  );
  useUnsavedGuard(formDirty);
  const requestCloseForm = useDiscardConfirm(formDirty, () => setFormOpen(false));

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      marketingApi.coupons({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        type: params.type as string | undefined,
        status: params.status as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<{
    items: AdminCoupon[];
    total: number;
    page: number;
    pageSize: number;
  }>(fetcher, {
    keyword: initialKeyword || undefined,
    type: initialType,
    status: initialStatus,
  });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    keyword: params.keyword as string | undefined,
    type: params.type as string | undefined,
    status: params.status as string | undefined,
  });

  const hasFilter = Boolean(params.keyword || params.type || params.status);

  const applyFilters = () =>
    setQuery({ keyword: keyword.trim() || undefined, type, status });
  const resetFilters = () => {
    setKeyword('');
    setType(undefined);
    setStatus(undefined);
    setQuery({ keyword: undefined, type: undefined, status: undefined });
  };

  const appliedKeyword = (params.keyword as string | undefined) ?? '';
  const appliedType = params.type as string | undefined;
  const appliedStatus = params.status as string | undefined;
  const appliedChips: AppliedFilter[] = [
    appliedKeyword
      ? {
          key: 'keyword',
          label: `关键词：${appliedKeyword}`,
          onClear: () => {
            setKeyword('');
            setQuery({ keyword: undefined });
          },
        }
      : null,
    appliedType
      ? {
          key: 'type',
          label: `类型：${TYPE_LABEL[appliedType as CouponType] ?? appliedType}`,
          onClear: () => {
            setType(undefined);
            setQuery({ type: undefined });
          },
        }
      : null,
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${appliedStatus === 'on' ? '启用' : '停用'}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  /** 导出走已生效的筛选条件 —— 必须与屏幕上的列表同口径 */
  const exportCsv = async () => {
    setExporting(true);
    try {
      await marketingApi.exportCoupons({
        keyword: params.keyword as string | undefined,
        type: params.type as string | undefined,
        status: params.status as string | undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    const next = emptyForm();
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (c: AdminCoupon) => {
    setEditing(c);
    const next: FormState = {
      // 券码编辑时留空 = 不改。改券码等于让用户手里的券集体失效
      code: '',
      name: c.name,
      type: c.type,
      // 折扣是万分比原样; 其余是分 → 元
      value: c.type === 'discount' ? String(c.value) : String(c.value / 100),
      // 门槛以**元**载入表单, 提交时再换算成分 —— 表单内只保留一种口径
      threshold: String(c.thresholdCents / 100),
      scope: c.scope,
      totalCount: String(c.totalCount),
      perUserLimit: String(c.perUserLimit),
      validFrom: toLocalInput(c.validFrom),
      validTo: toLocalInput(c.validTo),
      status: c.status,
    };
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  /** 表单 → payload, 附带语义校验 */
  const buildPayload = (): UpsertCouponPayload | string => {
    const name = form.name.trim();
    if (!name) return '请填写券名称';

    //⚠ value 的单位是**分**, 与 thresholdCents 一致 (后端直接拿两者比较,
    // 传元会让「满 100 减 200」这类负价校验失效)。用户在 UI 上输入的是元,
    // 这里负责换算。
    const raw = Number(form.value);
    if (!Number.isFinite(raw)) return '面额必须是数字';

    let value: number;
    if (form.type === 'discount') {
      // 折扣的 value 是万分比, 不是金额 —— 不做元/分换算
      value = Math.round(raw);
      if (value < 1 || value >= 10000) return '折扣需小于 10 折(万分比 1~9999)';
    } else {
      if (raw <= 0) return '减免金额必须大于 0';
      value = Math.round(raw * 100); // 表单内是元 → 存库用分
    }

    const from = new Date(form.validFrom);
    const to = new Date(form.validTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '有效期格式非法';
    if (to <= from) return '失效时间必须晚于生效时间';

    const thresholdYuan = Number(form.threshold);
    if (!Number.isFinite(thresholdYuan) || thresholdYuan < 0) return '使用门槛必须是非负数';

    const payload: UpsertCouponPayload = {
      name,
      type: form.type,
      value,
      // 门槛: 表单内存元 → 存库用分（只在这里换算一次）
      thresholdCents: Math.round(thresholdYuan * 100),
      scope: form.scope,
      totalCount: Math.max(0, Number(form.totalCount) || 0),
      perUserLimit: Math.max(0, Number(form.perUserLimit) || 0),
      validFrom: from.toISOString(),
      validTo: to.toISOString(),
      status: form.status,
    };

    // 创建时券码必填; 更新留空表示不改
    if (!editing) {
      const code = form.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,24}$/.test(code)) {
        return '券码需为 4~24 位大写字母或数字';
      }
      payload.code = code;
    }
    return payload;
  };

  const save = async () => {
    const payload = buildPayload();
    if (typeof payload === 'string') {
      setFormError(payload);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await marketingApi.updateCoupon(editing.id, payload);
        toast.success('已保存');
      } else {
        await marketingApi.createCoupon(payload);
        toast.success('优惠券已创建');
      }
      setFormOpen(false);
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 启停可随时再切回，按产品要求直接执行，不再弹窗确认 */
  const doToggle = async (row: AdminCoupon) => {
    setBusy(true);
    try {
      const res = await marketingApi.toggleCoupon(row.id);
      toast.success(res.status === 'on' ? '已启用' : '已停用');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminCoupon>> = [
    {
      key: 'code',
      title: '券码',
      width: 125,
      render: (row) => (
        <button
          type="button"
          className="rounded font-mono text-xs font-medium text-accent-700 hover:underline"
          onClick={() => openEdit(row)}
        >
          {row.code}
        </button>
      ),
    },
    { key: 'name', title: '名称', width: 140, render: (row) => <span>{row.name}</span> },
    {
      key: 'type',
      title: '类型',
      width: 70,
      render: (row) => <span className="text-xs">{TYPE_LABEL[row.type] ?? row.type}</span>,
    },
    {
      key: 'value',
      title: '面额',
      width: 90,
      render: (row) => (
        <span className="font-medium text-accent-700">{faceValue({ type: row.type, value: row.value })}</span>
      ),
    },
    {
      key: 'threshold',
      title: '门槛',
      width: 90,
      render: (row) =>
        row.thresholdCents > 0 ? (
          <span className="tabular-nums">满 ¥{yuan(row.thresholdCents)}</span>
        ) : (
          <span className="text-[11px] text-text-tertiary">无门槛</span>
        ),
    },
    {
      key: 'scope',
      title: '适用范围',
      width: 110,
      render: (row) => <span className="text-xs">{SCOPE_LABEL[row.scope] ?? row.scope}</span>,
    },
    {
      key: 'used',
      title: '核销',
      width: 100,
      render: (row) => {
        const total = row.totalCount === 0 ? null : row.totalCount;
        const pct = total ? Math.round((row.usedCount / total) * 100) : null;
        return (
          <div className="flex flex-col gap-1">
            <span className="tabular-nums">
              {row.usedCount}
              {total ? ` / ${total}` : ' / 不限'}
            </span>
            {pct !== null && (
              <span
                className="block h-1 w-16 overflow-hidden rounded-full bg-background-secondary-default"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-accent-500"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'valid',
      title: '有效期',
      width: 170,
      render: (row) => (
        <span className="text-[11px] tabular-nums text-text-tertiary">
          {new Date(row.validFrom).toLocaleDateString('zh-CN')} ~{' '}
          {new Date(row.validTo).toLocaleDateString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (row) => {
        const meta = EFFECTIVE_META[row.effective] ?? { label: row.status, tone: 'muted' as TagTone };
        return <StatusTag status={row.status} label={meta.label} tone={meta.tone} />;
      },
    },
    {
      key: 'ops',
      title: '',
      width: 110,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button
              variant={row.status === 'on' ? 'dangerGhost' : 'ghost'}
              size="small"
              disabled={busy}
              onClick={() => void doToggle(row)}
            >
              {row.status === 'on' ? '停用' : '启用'}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="优惠券"
        description="发放范围、使用条件、有效期与限用。券不提供删除 —— 已核销订单仍引用它，只能停用。"
        actions={
          <div className="flex items-center gap-2">
            {can('data.export') && (
              <Button
                variant="secondary"
                size="small"
                leadingIcon={Download}
                disabled={exporting}
                onClick={() => void exportCsv()}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </Button>
            )}
            {writable ? (
              <Button variant="primary" size="small" leadingIcon={Plus} onClick={openCreate}>
                新建优惠券
              </Button>
            ) : (
              <span className="text-[11px] text-text-tertiary">
                当前账号无 marketing.write 权限，仅可查看
              </span>
            )}
          </div>
        }
      />

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <FilterBar>
        <TextInput
          className="w-56"
          ariaLabel="按券码或名称搜索"
          placeholder="券码 / 名称"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
          allowClear
        />
        <SelectBox
          className="w-32"
          ariaLabel="按类型筛选"
          placeholder="类型"
          allowClear
          value={type}
          onChange={setType}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <SelectBox
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={[
            { value: 'on', label: '启用' },
            { value: 'off', label: '停用' },
          ]}
        />
        <FilterActions>
          <Button variant="primary" size="small" onClick={applyFilters}>
            查询
          </Button>
          <Button variant="secondary" size="small" onClick={resetFilters}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      <Panel title="券列表" note="核销进度按发行总量计算，不限量券不显示进度">
        <AdminDataTable<AdminCoupon>
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1060}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            unit: '张',
            onChange: setPage,
          }}
          emptyText={
            hasFilter
              ? '没有匹配的优惠券。清除筛选条件后再试。'
              : '还没有优惠券。新建第一张券，C 端结算页才会出现可用的抵扣项。'
          }
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="small" onClick={resetFilters}>
                清除筛选
              </Button>
            ) : writable ? (
              <Button variant="primary" size="small" leadingIcon={Plus} onClick={openCreate}>
                创建第一张券
              </Button>
            ) : undefined
          }
        />
      </Panel>

      {/* 创建/编辑抽屉 */}
      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={560}
        title={editing ? `编辑优惠券 · ${editing.code}` : '新建优惠券'}
        description={formDirty ? '有未保存修改' : undefined}
        footer={
          <>
            <Button variant="secondary" size="small" onClick={requestCloseForm} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" size="small" disabled={busy} onClick={() => void save()}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <Notice tone="danger" className="mb-0">
              {formError}
            </Notice>
          )}

          {!editing && (
            <Field label="券码" hint="用户手动输入此码。创建后不可修改。">
              <TextInput
                ariaLabel="券码"
                value={form.code}
                placeholder="4~24 位大写字母或数字"
                maxLength={24}
                onChange={(value) => setForm({ ...form, code: value.toUpperCase() })}
              />
            </Field>
          )}

          <Field label="券名称">
            <TextInput
              ariaLabel="券名称"
              value={form.name}
              placeholder="如: 新客立减 10 元"
              maxLength={60}
              onChange={(value) => setForm({ ...form, name: value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="类型">
              <SelectBox
                ariaLabel="类型"
                value={form.type}
                // 换类型要清空面额: 折扣的万分比与金额的分是两套单位, 留着旧值必然算错
                onChange={(value) =>
                  setForm({ ...form, type: value as CouponType, value: '' })
                }
                options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field
              label={form.type === 'discount' ? '折扣 (万分比)' : '减免金额 (元)'}
              hint={form.type === 'discount' ? '8500 表示 8.5 折' : '表单内填元，入库换算成分'}
            >
              <TextInput
                ariaLabel="面额"
                inputMode="decimal"
                value={form.value}
                placeholder={form.type === 'discount' ? '8500 = 8.5折' : '10.00'}
                onChange={(value) => setForm({ ...form, value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="使用门槛 (元)" hint="0 表示无门槛">
              <TextInput
                ariaLabel="使用门槛"
                inputMode="decimal"
                value={form.threshold}
                onChange={(value) => setForm({ ...form, threshold: value })}
              />
            </Field>
            <Field label="适用范围">
              <SelectBox
                ariaLabel="适用范围"
                value={form.scope}
                onChange={(value) => setForm({ ...form, scope: value as CouponScope })}
                options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
          </div>

          {form.scope === 'product' && (
            <p className="rounded-lg border border-border-table bg-background-secondary-default/60 px-3 py-2 text-[11px] leading-4 text-text-tertiary">
              商品范围由后端按订单明细校验，此处留空表示不限具体商品（仅限制在指定范围订单内）。
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="发行总量" hint="0 表示不限量">
              <TextInput
                ariaLabel="发行总量"
                inputMode="numeric"
                value={form.totalCount}
                onChange={(value) => setForm({ ...form, totalCount: value })}
              />
            </Field>
            <Field label="每人限用" hint="0 表示不限">
              <TextInput
                ariaLabel="每人限用"
                inputMode="numeric"
                value={form.perUserLimit}
                onChange={(value) => setForm({ ...form, perUserLimit: value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="生效时间">
              <TextInput
                ariaLabel="生效时间"
                type="datetime-local"
                value={form.validFrom}
                onChange={(value) => setForm({ ...form, validFrom: value })}
              />
            </Field>
            <Field label="失效时间">
              <TextInput
                ariaLabel="失效时间"
                type="datetime-local"
                value={form.validTo}
                onChange={(value) => setForm({ ...form, validTo: value })}
              />
            </Field>
          </div>

          <Field label="状态" hint="过期、未开始、售罄由时间与库存派生，列表里优先展示派生结果">
            <SelectBox
              ariaLabel="状态"
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value as CouponStatus })}
              options={[
                { value: 'on', label: '启用' },
                { value: 'off', label: '停用' },
              ]}
            />
          </Field>

          {editing && (
            <p className="text-[11px] leading-4 text-text-tertiary">
              已核销 {editing.usedCount} 张 · 券码不可修改，停用后已发放的券立即失效
            </p>
          )}
        </div>
      </Drawer>
    </>
  );
}
