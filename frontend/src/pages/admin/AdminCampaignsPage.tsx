import { useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { Button, Chip } from '../../admin-ui/shadcn/kit';
import { marketingApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { Notice } from '../../admin-ui/primitives';
import { SelectBox, SwitchBox, TextArea, TextInput } from '../../admin-ui/controls';
import { AdminStaleError, useAdminList, useAdminUrlFilterSync } from '../../components/admin/AdminWidgets';
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

/**
 * 派生生效态优先于人工 status 展示。
 * `status=active` 但时间窗未到，对用户就是不生效；把这种状态显示成「进行中」
 * 会让运营以为活动已在曝光，实际一条都没跑到。
 */
const EFFECTIVE_META: Record<AdminCampaign['effective'], { label: string; tone: TagTone }> = {
  draft: { label: '草稿', tone: 'muted' },
  live: { label: '进行中', tone: 'success' },
  scheduled: { label: '未开始', tone: 'brand' },
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
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('keyword') ?? '';
  // 地址栏参数不可信: 只接受筛选下拉里真实存在的状态值
  const rawStatus = searchParams.get('status');
  const initialStatus = rawStatus && rawStatus in STATUS_LABEL ? rawStatus : undefined;

  const [keyword, setKeyword] = useState(initialKeyword);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState<AdminCampaign | null>(null);
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
      marketingApi.campaigns({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        status: params.status as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<{
    items: AdminCampaign[];
    total: number;
    page: number;
    pageSize: number;
  }>(fetcher, {
    keyword: initialKeyword || undefined,
    status: initialStatus,
  });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    keyword: params.keyword as string | undefined,
    status: params.status as string | undefined,
  });

  const hasFilter = Boolean(params.keyword || params.status);

  const applyFilters = () =>
    setQuery({ keyword: keyword.trim() || undefined, status });
  const resetFilters = () => {
    setKeyword('');
    setStatus(undefined);
    setQuery({ keyword: undefined, status: undefined });
  };

  const appliedKeyword = (params.keyword as string | undefined) ?? '';
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
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_LABEL[appliedStatus as CampaignStatus]?.label ?? appliedStatus}`,
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
      await marketingApi.exportCampaigns({
        keyword: params.keyword as string | undefined,
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

  const openEdit = (c: AdminCampaign) => {
    setEditing(c);
    const p = c.payload ?? {};
    const next: FormState = {
      name: c.name,
      type: c.type,
      startAt: toLocalInput(c.startAt),
      endAt: toLocalInput(c.endAt),
      status: c.status,
      onlyNewUsers: !!c.audience?.onlyNewUsers,
      productId: p.productId ?? '',
      // 表单内统一存「元」，提交时再换算成分 —— 避免编辑回填后又乘一次 100
      priceCents: p.priceCents !== undefined ? String(p.priceCents / 100) : '',
      capabilityIds: (p.capabilityIds ?? []).join(','),
      title: p.title ?? '',
      body: p.body ?? '',
      ctaText: p.ctaText ?? '',
      ctaUrl: p.ctaUrl ?? '',
    };
    setForm(next);
    setFormBase(next);
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
        toast.success('已保存');
      } else {
        await marketingApi.createCampaign(payload);
        toast.success('活动已创建');
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
  const doToggle = async (row: AdminCampaign) => {
    setBusy(true);
    try {
      await marketingApi.toggleCampaign(row.id);
      toast.success('状态已切换');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminCampaign>> = [
    { key: 'name', title: '活动名称', width: 160, render: (row) => <span>{row.name}</span> },
    {
      key: 'type',
      title: '类型',
      width: 90,
      render: (row) => <span className="text-xs">{TYPE_LABEL[row.type] ?? row.type}</span>,
    },
    {
      key: 'payload',
      title: '内容',
      width: 150,
      render: (row) => <span className="text-[11px] text-text-tertiary">{payloadSummary(row)}</span>,
    },
    {
      key: 'audience',
      title: '投放人群',
      width: 90,
      render: (row) =>
        row.audience?.onlyNewUsers ? (
          <span className="text-xs">仅新用户</span>
        ) : (
          <span className="text-[11px] text-text-tertiary">全站</span>
        ),
    },
    {
      key: 'window',
      title: '时间窗',
      width: 200,
      render: (row) => {
        const live = inWindow(row);
        return (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-[11px] tabular-nums text-text-tertiary">
              {new Date(row.startAt).toLocaleDateString('zh-CN')} ~{' '}
              {new Date(row.endAt).toLocaleDateString('zh-CN')}
            </span>
            {/* active 但不在窗内: 配置生效了却不会展示, 必须让人看见 */}
            {row.status === 'active' && !live && (
              <Chip variant="caption" color="yellow">
                未在窗内
              </Chip>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (row) => {
        const meta = EFFECTIVE_META[row.effective] ?? { label: row.statusLabel, tone: 'muted' as TagTone };
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
            <Button variant="ghost" size="small" disabled={busy} onClick={() => void doToggle(row)}>
              切换
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="限时活动"
        description="限时价 / 限时免费 / 弹窗位。状态为「进行中」但不在时间窗内，活动不会展示。"
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
                新建活动
              </Button>
            ) : (
              <span className="text-[11px] text-text-tertiary">当前账号无 marketing.write 权限，仅可查看</span>
            )}
          </div>
        }
      />

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <FilterBar>
        <TextInput
          className="w-56"
          ariaLabel="按活动名称搜索"
          placeholder="活动名称"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
          allowClear
        />
        <SelectBox
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={Object.entries(STATUS_LABEL).map(([value, item]) => ({ value, label: item.label }))}
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

      <Panel title="活动列表" note="列表状态为派生结果：时间窗、人工开关与上下线共同决定">
        <AdminDataTable<AdminCampaign>
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1010}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            unit: '个',
            onChange: setPage,
          }}
          emptyText={
            hasFilter
              ? '没有匹配的活动。清除筛选条件后再试。'
              : '还没有活动。新建一个限时活动，C 端会按时间窗自动生效。'
          }
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="small" onClick={resetFilters}>
                清除筛选
              </Button>
            ) : writable ? (
              <Button variant="primary" size="small" leadingIcon={Plus} onClick={openCreate}>
                创建第一个活动
              </Button>
            ) : undefined
          }
        />
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={560}
        title={editing ? `编辑活动 · ${editing.name}` : '新建活动'}
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

          <Field label="活动名称">
            <TextInput
              ariaLabel="活动名称"
              value={form.name}
              placeholder="如: 双十一大促"
              maxLength={60}
              onChange={(value) => setForm({ ...form, name: value })}
            />
          </Field>

          <Field label="类型" hint="类型决定 payload 字段，切换类型后原有的内容不会保留">
            <SelectBox
              ariaLabel="活动类型"
              value={form.type}
              onChange={(value) => setForm({ ...form, type: value as CampaignType })}
              options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>

          {/* payload 字段随类型切换, 避免看到不相关的输入框 */}
          {form.type === 'limited_price' && (
            <>
              <Field label="目标商品 ID">
                <TextInput
                  ariaLabel="目标商品 ID"
                  value={form.productId}
                  placeholder="商品 ID"
                  onChange={(value) => setForm({ ...form, productId: value })}
                />
              </Field>
              <Field label="活动价 (元)" hint="表单内填元，入库换算成分">
                <TextInput
                  ariaLabel="活动价"
                  inputMode="decimal"
                  value={form.priceCents}
                  placeholder="9.90"
                  onChange={(value) => setForm({ ...form, priceCents: value })}
                />
              </Field>
            </>
          )}

          {form.type === 'limited_free' && (
            <Field label="能力 ID (逗号分隔)" hint="这些能力在活动期内免费使用">
              <TextInput
                ariaLabel="能力 ID"
                value={form.capabilityIds}
                placeholder="main_image, detail_image"
                onChange={(value) => setForm({ ...form, capabilityIds: value })}
              />
            </Field>
          )}

          {form.type === 'popup' && (
            <>
              <Field label="弹窗标题">
                <TextInput
                  ariaLabel="弹窗标题"
                  value={form.title}
                  maxLength={60}
                  onChange={(value) => setForm({ ...form, title: value })}
                />
              </Field>
              <Field label="正文">
                <TextArea
                  ariaLabel="弹窗正文"
                  rows={3}
                  value={form.body}
                  maxLength={300}
                  showCount
                  onChange={(value) => setForm({ ...form, body: value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="按钮文案">
                  <TextInput
                    ariaLabel="按钮文案"
                    value={form.ctaText}
                    maxLength={12}
                    onChange={(value) => setForm({ ...form, ctaText: value })}
                  />
                </Field>
                <Field label="跳转地址" hint="仅支持站内相对路径">
                  <TextInput
                    ariaLabel="跳转地址"
                    value={form.ctaUrl}
                    placeholder="/workbench"
                    onChange={(value) => setForm({ ...form, ctaUrl: value })}
                  />
                </Field>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="开始时间">
              <TextInput
                ariaLabel="开始时间"
                type="datetime-local"
                value={form.startAt}
                onChange={(value) => setForm({ ...form, startAt: value })}
              />
            </Field>
            <Field label="结束时间">
              <TextInput
                ariaLabel="结束时间"
                type="datetime-local"
                value={form.endAt}
                onChange={(value) => setForm({ ...form, endAt: value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 items-start gap-4">
            <Field label="状态">
              <SelectBox
                ariaLabel="状态"
                value={form.status}
                onChange={(value) => setForm({ ...form, status: value as CampaignStatus })}
                options={Object.entries(STATUS_LABEL).map(([value, item]) => ({
                  value,
                  label: item.label,
                }))}
              />
            </Field>
            <div className="pt-6">
              <SwitchBox
                checked={form.onlyNewUsers}
                onChange={(checked) => setForm({ ...form, onlyNewUsers: checked })}
                label={form.onlyNewUsers ? '仅投放新用户' : '投放全站用户'}
              />
            </div>
          </div>

          {editing && (
            <p className="text-[11px] leading-4 text-text-tertiary">
              当前派生状态：{EFFECTIVE_META[editing.effective]?.label ?? editing.statusLabel}
              {editing.status === 'active' && !inWindow(editing) && '（不在时间窗内，实际不会曝光）'}
            </p>
          )}
        </div>
      </Drawer>
    </>
  );
}
