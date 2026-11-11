import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { marketingApi } from './api';
import {
  ActionButton,
  AdminPage,
  ConfirmDialog,
  ExportCsvButton,
  useAdminExport,
  Notice,
  Panel,
  RefreshButton,
  StaleError,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminList, useAdminUrlFilterSync, useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import { EFFECTIVE_META, TYPE_LABEL, type FormState } from './constants';
import { buildCampaignPayload, emptyForm, toLocalInput } from './utils';
import { CampaignFilterBar } from './CampaignFilterBar';
import { CampaignTable } from './CampaignTable';
import { CampaignFormDrawer } from './CampaignFormDrawer';
import type { AdminCampaign } from '../../../types/api';

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
  // 地址栏参数不可信: 只接受筛选下拉里真实存在的派生生效态
  const rawEffective = searchParams.get('effective');
  const initialEffective = rawEffective && rawEffective in EFFECTIVE_META ? rawEffective : undefined;
  const rawType = searchParams.get('type');
  const initialType = rawType && rawType in TYPE_LABEL ? rawType : undefined;

  const [keyword, setKeyword] = useState(initialKeyword);
  const [type, setType] = useState<string | undefined>(initialType);
  const [effective, setEffective] = useState<string | undefined>(initialEffective);
  const [busy, setBusy] = useState(false);
  const { exporting, runExport } = useAdminExport(toast);
  const [editing, setEditing] = useState<AdminCampaign | null>(null);
  const [deleting, setDeleting] = useState<AdminCampaign | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formBase, setFormBase] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const formDirty = Boolean(formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase));
  useUnsavedGuard(formDirty);
  const requestCloseForm = useDiscardConfirm(formDirty, () => setFormOpen(false));

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      marketingApi.campaigns({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        type: params.type as string | undefined,
        effective: params.effective as string | undefined,
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
    type: initialType,
    effective: initialEffective,
  });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    keyword: params.keyword as string | undefined,
    type: params.type as string | undefined,
    effective: params.effective as string | undefined,
  });

  const hasFilter = Boolean(params.keyword || params.type || params.effective);
  const rows = data?.items ?? [];

  const applyFilters = () => setQuery({ keyword: keyword.trim() || undefined, type, effective });
  const resetFilters = () => {
    setKeyword('');
    setType(undefined);
    setEffective(undefined);
    setQuery({ keyword: undefined, type: undefined, effective: undefined });
  };

  const appliedKeyword = (params.keyword as string | undefined) ?? '';
  const appliedType = params.type as string | undefined;
  const appliedEffective = params.effective as string | undefined;
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
          label: `类型：${TYPE_LABEL[appliedType as keyof typeof TYPE_LABEL] ?? appliedType}`,
          onClear: () => {
            setType(undefined);
            setQuery({ type: undefined });
          },
        }
      : null,
    appliedEffective
      ? {
          key: 'effective',
          label: `生效状态：${EFFECTIVE_META[appliedEffective as AdminCampaign['effective']]?.label ?? appliedEffective}`,
          onClear: () => {
            setEffective(undefined);
            setQuery({ effective: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  /** 导出走已生效的筛选条件 —— 必须与屏幕上的列表同口径 */
  const exportCsv = () =>
    runExport(
      () =>
        marketingApi.exportCampaigns({
          keyword: params.keyword as string | undefined,
          type: params.type as string | undefined,
          effective: params.effective as string | undefined,
        }),
      '导出已开始下载',
    );

  const patchForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    const next = emptyForm();
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  /* 命令面板「新建限时活动」带 ?create=1 进入 */
  const createIntentApplied = useRef(false);
  useEffect(() => {
    if (searchParams.get('create') !== '1' || createIntentApplied.current) return;
    createIntentApplied.current = true;
    openCreate();
  }, [searchParams]);

  const openEdit = (c: AdminCampaign) => {
    setEditing(c);
    const p = c.payload ?? {};
    const next: FormState = {
      name: c.name,
      type: c.type,
      startAt: toLocalInput(c.startAt),
      endAt: toLocalInput(c.endAt),
      startAtRaw: c.startAt,
      endAtRaw: c.endAt,
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
    const goingLive = row.status !== 'active';
    setBusy(true);
    try {
      await marketingApi.toggleCampaign(row.id);
      toast.success(goingLive ? '活动已上线' : '活动已下线');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 有订单或免费账单的活动不能物理删除；先给出下一步，不让运营点进注定失败的确认框。 */
  const requestDelete = (row: AdminCampaign) => {
    const usageCount = row.orderCount + (row.billingCount ?? 0);
    if (usageCount > 0) {
      toast.error(`该活动已有 ${usageCount} 条关联记录，不能删除；请改为下线`);
      return;
    }
    setDeleting(row);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await marketingApi.removeCampaign(deleting.id);
      toast.success(`已删除活动「${deleting.name}」`);
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * 后端把 marketing.write 声明在 controller 类上，列表 GET 同样要求该权限。
   * 没有它的账号连列表都拉不到，不能渲染一个写着「仅可查看」却 403 的表格。
   * 是否拆出 marketing.read 让财务/只读角色可查看，属权限模型决策，未在本批改动。
   */
  if (!writable) {
    return (
      <AdminPage title="限时活动" description="限时价 / 限时免费 / 弹窗位。">
        <Panel title="活动列表">
          <Notice tone="warn" className="mb-0">
            当前账号没有 marketing.write 权限，无法查看活动列表。如需只读访问，请联系管理员调整角色权限。
          </Notice>
        </Panel>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="限时活动"
      description="限时价 / 限时免费 / 弹窗位。状态为「进行中」但不在时间窗内，活动不会展示。"
      actions={
        <ActionButton variant="default" size="sm" icon={Plus} onClick={openCreate}>
          新建活动
        </ActionButton>
      }
    >

      <CampaignFilterBar
        keyword={keyword}
        onKeywordChange={setKeyword}
        type={type}
        onTypeChange={setType}
        effective={effective}
        onEffectiveChange={setEffective}
        appliedChips={appliedChips}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <Panel
        title="活动列表"
        note="列表状态与筛选均为派生结果：人工状态优先，仅「进行中」按时间窗派生"
        extra={
          <>
            {can('data.export') && <ExportCsvButton exporting={exporting} onExport={exportCsv} />}
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <CampaignTable
          rows={rows}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={reload}
          writable={writable}
          busy={busy}
          onEdit={openEdit}
          onToggle={(row) => void doToggle(row)}
          onDelete={requestDelete}
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

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `删除活动「${deleting.name}」` : '删除活动'}
        description={
          deleting
            ? deleting.status === 'active'
              ? '该活动当前处于上线状态，删除后将立即停止投放，且无法恢复。'
              : '删除后活动将从后台列表移除，且无法恢复。'
            : undefined
        }
        impact={
          deleting
            ? [
                `活动类型：${TYPE_LABEL[deleting.type] ?? deleting.type}`,
                '该活动没有关联订单或限时免费账单，删除不影响任何历史交易',
              ]
            : undefined
        }
        danger
        confirmText="删除活动"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AdminPage>
  );
}
