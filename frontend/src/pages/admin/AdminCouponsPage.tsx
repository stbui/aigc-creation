import { useCallback, useMemo, useState } from 'react';
import { App, Button, Drawer, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { marketingApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  adminPagination,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel, StatusTag, type TagTone } from '../../components/admin/PageHeader';
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
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<AdminCoupon | null>(null);

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
  }>(fetcher);

  const hasFilter = Boolean(params.keyword || params.type || params.status);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (c: AdminCoupon) => {
    setEditing(c);
    setForm({
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
    });
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
        void message.success('已保存');
      } else {
        await marketingApi.createCoupon(payload);
        void message.success('优惠券已创建');
      }
      setFormOpen(false);
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doToggle = async () => {
    if (!toggleTarget) return;
    setBusy(true);
    try {
      const res = await marketingApi.toggleCoupon(toggleTarget.id);
      setToggleTarget(null);
      void message.success(res.status === 'on' ? '已启用' : '已停用');
      reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminCoupon> = useMemo(
    () => [
      {
        title: '券码',
        key: 'code',
        width: 125,
        render: (_: unknown, row) => (
          <Button type="link" className="adm-link adm-mono" onClick={() => openEdit(row)}>
            {row.code}
          </Button>
        ),
      },
      { title: '名称', dataIndex: 'name', key: 'name', width: 130 },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        width: 70,
        render: (t: CouponType) => TYPE_LABEL[t] ?? t,
      },
      {
        title: '面额',
        dataIndex: 'value',
        key: 'value',
        width: 90,
        render: (v: number, row) => (
          <span style={{ color: 'var(--brand)', fontWeight: 500 }}>{faceValue({ type: row.type, value: v })}</span>
        ),
      },
      {
        title: '门槛',
        dataIndex: 'thresholdCents',
        key: 'threshold',
        width: 80,
        render: (v: number) => (v > 0 ? `满 ¥${yuan(v)}` : <span className="adm-cell-sub">无门槛</span>),
      },
      {
        title: '适用范围',
        dataIndex: 'scope',
        key: 'scope',
        width: 110,
        render: (s: CouponScope) => SCOPE_LABEL[s] ?? s,
      },
      {
        title: '核销',
        key: 'used',
        width: 90,
        render: (_: unknown, row) => {
          const total = row.totalCount === 0 ? null : row.totalCount;
          const pct = total ? Math.round((row.usedCount / total) * 100) : null;
          return (
            <div>
              <div>{row.usedCount}{total ? ` / ${total}` : ' / 不限'}</div>
              {pct !== null && (
                <div className="adm-progress">
                  <div className="adm-progress-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              )}
            </div>
          );
        },
      },
      {
        title: '有效期',
        key: 'valid',
        width: 165,
        render: (_: unknown, row) => (
          <div className="adm-cell-sub">
            {new Date(row.validFrom).toLocaleDateString('zh-CN')} ~{' '}
            {new Date(row.validTo).toLocaleDateString('zh-CN')}
          </div>
        ),
      },
      {
        title: '状态',
        dataIndex: 'effective',
        key: 'status',
        width: 80,
        render: (_: unknown, row) => {
          const meta = EFFECTIVE_META[row.effective] ?? { label: row.status, tone: 'muted' as TagTone };
          return <StatusTag status={row.status} label={meta.label} tone={meta.tone} />;
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 105,
        fixed: 'right',
        render: (_: unknown, row) => (
          <div className="adm-row-actions">
            {writable && (
              <>
                <Button type="link" className="adm-link" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Button type="link" className="adm-link" onClick={() => setToggleTarget(row)}>
                  {row.status === 'on' ? '停用' : '启用'}
                </Button>
              </>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writable],
  );

  if (loading && !data) return <AdminListLoading tip="加载优惠券…" />;
  if (error && !data) return <AdminListError error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="优惠券"
        description="发放范围、使用条件、有效期与限用。券不提供删除 —— 已核销订单仍引用它，只能停用。"
        actions={
          writable ? (
            <Button type="primary" className="adm-btn is-primary" onClick={openCreate}>
              新建优惠券
            </Button>
          ) : (
            <span className="adm-cell-sub">当前账号无 marketing.write 权限，仅可查看</span>
          )
        }
      />

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && <AdminStaleError error={error} onRetry={reload} />}

      <div className="adm-filter">
        <Input
          className="adm-filter-input"
          placeholder="券码 / 名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => setQuery({ keyword: keyword || undefined })}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="类型"
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          value={type}
          onChange={setType}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="状态"
          options={[
            { value: 'on', label: '启用' },
            { value: 'off', label: '停用' },
          ]}
          value={status}
          onChange={setStatus}
          allowClear
        />
        <div className="adm-filter-actions">
          <Button
            type="primary"
            className="adm-btn is-primary"
            onClick={() => setQuery({ keyword: keyword || undefined, type, status })}
          >
            查询
          </Button>
          <Button
            type="default"
            className="adm-btn"
            onClick={() => {
              setKeyword(''); setType(undefined); setStatus(undefined);
              setQuery({ keyword: undefined, type: undefined, status: undefined });
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <Panel title="券列表">
        {(data?.items.length ?? 0) === 0 ? (
          hasFilter ? (
            <AdminEmpty
              description="没有匹配的优惠券。清除筛选条件后再试。"
              action={
                <Button
                  type="default"
                  className="adm-btn"
                  onClick={() => {
                    setKeyword('');
                    setType(undefined);
                    setStatus(undefined);
                    setQuery({ keyword: undefined, type: undefined, status: undefined });
                  }}
                >
                  清除筛选
                </Button>
              }
            />
          ) : (
            <AdminEmpty
              description="还没有优惠券"
              action={
                writable ? (
                  <Button type="primary" className="adm-btn is-primary" onClick={openCreate}>
                    创建第一张券
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <Table<AdminCoupon>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            scroll={{ x: 1040 }}
            pagination={adminPagination({
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              unit: '张',
              onChange: setPage,
            })}
          />
        )}
      </Panel>

      {/* 创建/编辑抽屉 */}
      <Drawer
        title={editing ? `编辑优惠券 · ${editing.code}` : '新建优惠券'}
        size={560}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        className="adm-drawer"
        footer={
          <div className="adm-drawer-footer">
            <Button type="default" className="adm-btn" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button
              type="primary"
              className="adm-btn is-primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        }
      >
        {formError && <div className="adm-form-error">{formError}</div>}

        <div className="adm-form">
          {!editing && (
            <div className="adm-field">
              <label htmlFor="c-code">券码</label>
              <Input
                id="c-code"
                type="text"
                value={form.code}
                placeholder="4~24 位大写字母或数字"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
              <div className="adm-field-hint">用户手动输入此码。创建后不可修改。</div>
            </div>
          )}

          <div className="adm-field">
            <label htmlFor="c-name">券名称</label>
            <Input
              id="c-name"
              type="text"
              value={form.name}
              placeholder="如: 新客立减 10 元"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="c-type">类型</label>
              <Select
                id="c-type"
                value={form.type}
                onChange={(value) =>
                  setForm({ ...form, type: value as CouponType, value: '' })
                }
                options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="c-value">
                {form.type === 'discount' ? '折扣 (万分比)' : '减免金额 (元)'}
              </label>
              <Input
                id="c-value"
                type="number"
                /* 表单内已是展示单位：折扣为万分比，其余为元 */
                value={form.value}
                placeholder={form.type === 'discount' ? '8500 = 85折' : '10.00'}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </div>
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="c-threshold">使用门槛 (元)</label>
              <Input
                id="c-threshold"
                type="number"
                /* 表单内统一是元，只在提交时乘 100 —— 渲染不能再除一次 */
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              />
              <div className="adm-field-hint">0 表示无门槛</div>
            </div>
            <div className="adm-field">
              <label htmlFor="c-scope">适用范围</label>
              <Select
                id="c-scope"
                value={form.scope}
                onChange={(value) => setForm({ ...form, scope: value as CouponScope })}
                options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </div>

          {form.scope === 'product' && (
            <div className="adm-field">
              <label>指定商品</label>
              <div className="adm-field-hint">
                商品范围由后端按订单明细校验，此处留空表示不限具体商品（仅限制在指定范围订单内）。
              </div>
            </div>
          )}

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="c-total">发行总量</label>
              <Input
                id="c-total"
                type="number"
                value={form.totalCount}
                onChange={(e) => setForm({ ...form, totalCount: e.target.value })}
              />
              <div className="adm-field-hint">0 表示不限量</div>
            </div>
            <div className="adm-field">
              <label htmlFor="c-limit">每人限用</label>
              <Input
                id="c-limit"
                type="number"
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              />
              <div className="adm-field-hint">0 表示不限</div>
            </div>
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="c-from">生效时间</label>
              <Input
                id="c-from"
                type="datetime-local"
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="c-to">失效时间</label>
              <Input
                id="c-to"
                type="datetime-local"
                value={form.validTo}
                onChange={(e) => setForm({ ...form, validTo: e.target.value })}
              />
            </div>
          </div>

          <div className="adm-field">
            <label htmlFor="c-status">状态</label>
            <Select
              id="c-status"
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value as CouponStatus })}
              options={[
                { value: 'on', label: '启用' },
                { value: 'off', label: '停用' },
              ]}
            />
          </div>
        </div>
      </Drawer>

      {/* 启停确认 */}
      {toggleTarget && (
        <ConfirmAction
          open
          title={toggleTarget.status === 'on' ? '停用优惠券' : '启用优惠券'}
          confirmText={toggleTarget.status === 'on' ? '确认停用' : '确认启用'}
          danger={toggleTarget.status === 'on'}
          loading={busy}
          onCancel={() => setToggleTarget(null)}
          onConfirm={() => void doToggle()}
          description={
            <p>
              券 <strong>{toggleTarget.code}</strong>（{toggleTarget.name}）
            </p>
          }
          impact={
            toggleTarget.status === 'on'
              ? [
                  '停用后用户无法再使用该券',
                  `已核销的 ${toggleTarget.usedCount} 笔订单不受影响`,
                  '随时可重新启用',
                ]
              : ['启用后用户可立即使用该券', `有效期至 ${new Date(toggleTarget.validTo).toLocaleDateString('zh-CN')}`]
          }
        />
      )}
    </>
  );
}
