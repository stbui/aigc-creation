import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { marketingApi } from './api';
import { ActionButton, PageHeader, Panel, StaleError, type AppliedFilter } from '~/admin-ui/primitives';
import { useAdmin, useAdminList, useAdminUrlFilterSync, useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import { STATUS_LABEL, type FormState } from './constants';
import { buildCampaignPayload, emptyForm, toLocalInput } from './utils';
import { CampaignFilterBar } from './CampaignFilterBar';
import { CampaignTable } from './CampaignTable';
import { CampaignFormDrawer } from './CampaignFormDrawer';
import type { AdminCampaign, CampaignStatus } from '../../../types/api';

/**
 * 限时活动（`/admin/campaigns`）。
 *
 * 三种类型共用一张表：限时价（商品 + 活动价）、限时免费（能力清单）、
 * 弹窗位（标题 / 正文 / CTA）。`effective` 是后端按时间窗与开关算出的
 * 派生状态，列表与状态筛选都以它为准；人工 `status` 只决定「有没有上线」。
 *
 * ## 模块划分
 *
 * 筛选条 / 列表 / 表单抽屉各自独立；本文件只保留取数、筛选状态与写操作编排。
 */
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

  const applyFilters = () => setQuery({ keyword: keyword.trim() || undefined, status });
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

  const patchForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

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

  const save = async () => {
    const payload = buildCampaignPayload(form);
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

  return (
    <>
      <PageHeader
        title="限时活动"
        description="限时价 / 限时免费 / 弹窗位。状态为「进行中」但不在时间窗内，活动不会展示。"
        actions={
          <>
            {can('data.export') && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={Download}
                disabled={exporting}
                onClick={() => void exportCsv()}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </ActionButton>
            )}
            {writable ? (
              <ActionButton variant="default" size="sm" icon={Plus} onClick={openCreate}>
                新建活动
              </ActionButton>
            ) : (
              <span className="text-[12px] text-muted-foreground">
                当前账号无 marketing.write 权限，仅可查看
              </span>
            )}
          </>
        }
      />

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <CampaignFilterBar
        keyword={keyword}
        onKeywordChange={setKeyword}
        status={status}
        onStatusChange={setStatus}
        appliedChips={appliedChips}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <Panel title="活动列表" note="列表状态为派生结果：时间窗、人工开关与上下线共同决定">
        <CampaignTable
          rows={data?.items ?? []}
          loading={loading}
          error={error}
          onRetry={reload}
          writable={writable}
          busy={busy}
          onEdit={openEdit}
          onToggle={(row) => void doToggle(row)}
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
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : writable ? (
              <ActionButton variant="default" size="sm" icon={Plus} onClick={openCreate}>
                创建第一个活动
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>

      <CampaignFormDrawer
        open={formOpen}
        editing={editing}
        form={form}
        formError={formError}
        formDirty={formDirty}
        busy={busy}
        onPatch={patchForm}
        onClose={requestCloseForm}
        onSave={() => void save()}
      />
    </>
  );
}
