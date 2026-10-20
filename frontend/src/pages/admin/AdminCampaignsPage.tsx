import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Drawer, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { marketingApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  ConfirmAction,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
import type {
  AdminCampaign,
  CampaignStatus,
  CampaignType,
  UpsertCampaignPayload,
} from '../../types/api';

const yuan = (cents: number) => (cents / 100).toFixed(2);

const TYPE_LABEL: Record<CampaignType, string> = {
  limited_price: '限时价',
  limited_free: '限时免费',
  popup: '弹窗位',
};

const STATUS_LABEL: Record<CampaignStatus, { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'muted' },
  active: { label: '进行中', tone: 'success' },
  ended: { label: '已结束', tone: 'warn' },
  off: { label: '已下线', tone: 'muted' },
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** payload 摘要: 不同类型展示不同内容, 统一抽象成一行可读描述 */
function payloadSummary(c: AdminCampaign): string {
  const p = c.payload ?? {};
  if (c.type === 'limited_price') {
    return p.priceCents !== undefined ? `活动价 ¥${yuan(p.priceCents)}` : '未设置活动价';
  }
  if (c.type === 'limited_free') {
    const ids = p.capabilityIds ?? [];
    return ids.length ? `${ids.length} 项能力免费` : '未选择能力';
  }
  return p.title || '未设置标题';
}

/** 是否在时间窗内 —— active 但不在窗内是「配置了但没生效」, 需要能看出来 */
function inWindow(c: AdminCampaign): boolean {
  const now = Date.now();
  return now >= new Date(c.startAt).getTime() && now <= new Date(c.endAt).getTime();
}

interface FormState {
  name: string;
  type: CampaignType;
  startAt: string;
  endAt: string;
  status: CampaignStatus;
  onlyNewUsers: boolean;
  productId: string;
  priceCents: string;
  capabilityIds: string;
  title: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
}

function emptyForm(): FormState {
  const now = new Date();
  const later = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return {
    name: '', type: 'limited_price',
    startAt: toLocalInput(now.toISOString()),
    endAt: toLocalInput(later.toISOString()),
    status: 'draft', onlyNewUsers: false,
    productId: '', priceCents: '', capabilityIds: '',
    title: '', body: '', ctaText: '', ctaUrl: '',
  };
}

export function AdminCampaignsPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminCampaign | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<AdminCampaign | null>(null);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      marketingApi.campaigns({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        status: params.status as string | undefined,
      }),
    [],
  );

  const { data, loading, error, setQuery, setPage, reload } = useAdminList<{
    items: AdminCampaign[];
    total: number;
    page: number;
    pageSize: number;
  }>(fetcher);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (c: AdminCampaign) => {
    setEditing(c);
    const p = c.payload ?? {};
    setForm({
      name: c.name,
      type: c.type,
      startAt: toLocalInput(c.startAt),
      endAt: toLocalInput(c.endAt),
      status: c.status,
      onlyNewUsers: !!c.audience?.onlyNewUsers,
      productId: p.productId ?? '',
      priceCents: p.priceCents !== undefined ? String(p.priceCents) : '',
      capabilityIds: (p.capabilityIds ?? []).join(','),
      title: p.title ?? '',
      body: p.body ?? '',
      ctaText: p.ctaText ?? '',
      ctaUrl: p.ctaUrl ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const buildPayload = (): UpsertCampaignPayload | string => {
    const name = form.name.trim();
    if (!name) return '请填写活动名称';

    const start = new Date(form.startAt);
    const end = new Date(form.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '时间格式非法';
    if (end <= start) return '结束时间必须晚于开始时间';

    const payload: UpsertCampaignPayload = {
      name,
      type: form.type,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: form.status,
      onlyNewUsers: form.onlyNewUsers,
      payload: {},
    };

    // payload 随类型而变, 只提交当前类型需要的字段 —— 混着提交会让后端拿到
    // 属于其它类型的字段, 后续改动类型时残留数据会意外生效
    if (form.type === 'limited_price') {
      const cents = Math.round(Number(form.priceCents) * 100);
      if (!form.productId.trim()) return '请填写目标商品 ID';
      if (!Number.isFinite(cents) || cents < 0) return '活动价必须是非负数';
      payload.payload = { productId: form.productId.trim(), priceCents: cents };
    } else if (form.type === 'limited_free') {
      const ids = form.capabilityIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return '请至少填写一项能力 ID';
      payload.payload = { capabilityIds: ids };
    } else {
      if (!form.title.trim()) return '请填写弹窗标题';
      // 站内相对路径: 后端限定不接受外链, 前端先拦一道给出更友好的提示
      if (form.ctaUrl.trim() && !form.ctaUrl.trim().startsWith('/')) {
        return '跳转地址必须是站内相对路径(以 / 开头)';
      }
      payload.payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        ctaText: form.ctaText.trim(),
        ctaUrl: form.ctaUrl.trim(),
      };
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
        await marketingApi.updateCampaign(editing.id, payload);
        void message.success('已保存');
      } else {
        await marketingApi.createCampaign(payload);
        void message.success('活动已创建');
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
      await marketingApi.toggleCampaign(toggleTarget.id);
      setToggleTarget(null);
      void message.success('状态已切换');
      reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminCampaign> = useMemo(
    () => [
      { title: '活动名称', dataIndex: 'name', key: 'name', width: 160 },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        width: 90,
        render: (t: CampaignType) => TYPE_LABEL[t] ?? t,
      },
      {
        title: '内容',
        key: 'payload',
        width: 150,
        render: (_: unknown, row) => <span className="adm-cell-sub">{payloadSummary(row)}</span>,
      },
      {
        title: '投放人群',
        key: 'audience',
        width: 90,
        render: (_: unknown, row) =>
          row.audience?.onlyNewUsers ? '仅新用户' : <span className="adm-cell-sub">全站</span>,
      },
      {
        title: '时间窗',
        key: 'window',
        width: 185,
        render: (_: unknown, row) => {
          const live = inWindow(row);
          return (
            <div className="adm-cell-sub">
              {new Date(row.startAt).toLocaleDateString('zh-CN')} ~{' '}
              {new Date(row.endAt).toLocaleDateString('zh-CN')}
              {/* active 但不在窗内: 配置生效了却不会展示, 必须让人看见 */}
              {row.status === 'active' && !live && (
                <span className="adm-tag is-warn" style={{ marginLeft: 6 }}>
                  未在窗内
                </span>
              )}
            </div>
          );
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (s: CampaignStatus) => {
          const meta = STATUS_LABEL[s] ?? { label: s, tone: 'muted' };
          return <StatusTag status={s === 'active' ? 'active' : s === 'ended' ? 'pending' : 'user'} />;
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 110,
        fixed: 'right',
        render: (_: unknown, row) => (
          <div className="adm-row-actions">
            {writable && (
              <>
                <button type="button" className="adm-link" onClick={() => openEdit(row)}>
                  编辑
                </button>
                <button type="button" className="adm-link" onClick={() => setToggleTarget(row)}>
                  切换
                </button>
              </>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writable],
  );

  if (loading && !data) return <AdminListLoading tip="加载活动…" />;
  if (error) return <AdminListError error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="限时活动"
        description="限时价 / 限时免费 / 弹窗位。状态为「进行中」但不在时间窗内，活动不会展示。"
        actions={
          writable ? (
            <button type="button" className="adm-btn is-primary" onClick={openCreate}>
              新建活动
            </button>
          ) : (
            <span className="adm-cell-sub">当前账号无 marketing.write 权限，仅可查看</span>
          )
        }
      />

      <div className="adm-filter">
        <Input
          className="adm-filter-input"
          placeholder="活动名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => setQuery({ keyword: keyword || undefined })}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="状态"
          options={Object.entries(STATUS_LABEL).map(([v, m]) => ({ value: v, label: m.label }))}
          value={status}
          onChange={setStatus}
          allowClear
        />
        <div className="adm-filter-actions">
          <button
            type="button"
            className="adm-btn is-primary"
            onClick={() => setQuery({ keyword: keyword || undefined, status })}
          >
            查询
          </button>
          <button
            type="button"
            className="adm-btn"
            onClick={() => {
              setKeyword(''); setStatus(undefined);
              setQuery({ keyword: undefined, status: undefined });
            }}
          >
            重置
          </button>
        </div>
      </div>

      <Panel title="活动列表">
        {(data?.items.length ?? 0) === 0 ? (
          <AdminEmpty
            description="还没有活动"
            action={
              writable ? (
                <button type="button" className="adm-btn is-primary" onClick={openCreate}>
                  创建第一个活动
                </button>
              ) : undefined
            }
          />
        ) : (
          <Table<AdminCampaign>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            scroll={{ x: 1000 }}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              showTotal: (t) => `共 ${t} 个`,
              onChange: setPage,
            }}
          />
        )}
      </Panel>

      <Drawer
        title={editing ? `编辑活动 · ${editing.name}` : '新建活动'}
        width={560}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        className="adm-drawer"
        footer={
          <div className="adm-drawer-footer">
            <button type="button" className="adm-btn" onClick={() => setFormOpen(false)}>取消</button>
            <button type="button" className="adm-btn is-primary" onClick={() => void save()} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        {formError && <div className="adm-form-error">{formError}</div>}

        <div className="adm-form">
          <div className="adm-field">
            <label htmlFor="k-name">活动名称</label>
            <input
              id="k-name"
              type="text"
              value={form.name}
              placeholder="如: 双十一大促"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="adm-field">
            <label htmlFor="k-type">类型</label>
            <select
              id="k-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CampaignType })}
            >
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          {/* payload 字段随类型切换, 避免看到不相关的输入框 */}
          {form.type === 'limited_price' && (
            <>
              <div className="adm-field">
                <label htmlFor="k-pid">目标商品 ID</label>
                <input
                  id="k-pid"
                  type="text"
                  value={form.productId}
                  placeholder="商品 ID"
                  onChange={(e) => setForm({ ...form, productId: e.target.value })}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="k-price">活动价 (元)</label>
                <input
                  id="k-price"
                  type="number"
                  value={form.priceCents}
                  placeholder="9.90"
                  onChange={(e) => setForm({ ...form, priceCents: e.target.value })}
                />
              </div>
            </>
          )}

          {form.type === 'limited_free' && (
            <div className="adm-field">
              <label htmlFor="k-caps">能力 ID (逗号分隔)</label>
              <input
                id="k-caps"
                type="text"
                value={form.capabilityIds}
                placeholder="main_image, detail_image"
                onChange={(e) => setForm({ ...form, capabilityIds: e.target.value })}
              />
              <div className="adm-field-hint">这些能力在活动期内免费使用</div>
            </div>
          )}

          {form.type === 'popup' && (
            <>
              <div className="adm-field">
                <label htmlFor="k-title">弹窗标题</label>
                <input
                  id="k-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="k-body">正文</label>
                <textarea
                  id="k-body"
                  rows={3}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </div>
              <div className="adm-form-row">
                <div className="adm-field">
                  <label htmlFor="k-cta">按钮文案</label>
                  <input
                    id="k-cta"
                    type="text"
                    value={form.ctaText}
                    onChange={(e) => setForm({ ...form, ctaText: e.target.value })}
                  />
                </div>
                <div className="adm-field">
                  <label htmlFor="k-url">跳转地址</label>
                  <input
                    id="k-url"
                    type="text"
                    value={form.ctaUrl}
                    placeholder="/workbench"
                    onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })}
                  />
                  <div className="adm-field-hint">仅支持站内相对路径</div>
                </div>
              </div>
            </>
          )}

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="k-from">开始时间</label>
              <input
                id="k-from"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="k-to">结束时间</label>
              <input
                id="k-to"
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </div>
          </div>

          <div className="adm-form-row">
            <div className="adm-field">
              <label htmlFor="k-status">状态</label>
              <select
                id="k-status"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}
              >
                {Object.entries(STATUS_LABEL).map(([v, m]) => (
                  <option key={v} value={v}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label className="adm-switch">
                <input
                  type="checkbox"
                  checked={form.onlyNewUsers}
                  onChange={(e) => setForm({ ...form, onlyNewUsers: e.target.checked })}
                />
                <span className="adm-switch-track" aria-hidden="true" />
                <span className="adm-switch-text">仅投放新用户</span>
              </label>
            </div>
          </div>
        </div>
      </Drawer>

      {toggleTarget && (
        <ConfirmAction
          open
          title="切换活动状态"
          confirmText="确认切换"
          loading={busy}
          onCancel={() => setToggleTarget(null)}
          onConfirm={() => void doToggle()}
          description={<p>活动「{toggleTarget.name}」</p>}
          impact={[
            `当前状态: ${STATUS_LABEL[toggleTarget.status]?.label ?? toggleTarget.status}`,
            '切换后立即生效，用户端刷新即可见',
            toggleTarget.status !== 'active' && !inWindow(toggleTarget)
              ? '注意: 当前不在时间窗内，即使启用也不会展示'
              : '活动将在时间窗内对目标人群生效',
          ]}
        />
      )}
    </>
  );
}