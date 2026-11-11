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
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  Panel,
  RefreshButton,
  SelectField,
  StaleError,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminList, useAdminUrlFilterSync, useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import { STATUS_OPTIONS, TYPE_LABEL, TYPE_OPTIONS, type FormState } from './constants';
import { buildCouponPayload, emptyForm, toLocalInput } from './utils';
import { CouponTable } from './CouponTable';
import { CouponFormDrawer } from './CouponFormDrawer';
import type { AdminCoupon, CouponType } from '../../../types/api';

/**
 * 优惠券（`/admin/coupons`）。
 *
 * 从未产生订单的券可以删除；有历史订单的券只能停用。创建 / 编辑走全量
 * 表单，金额在表单内一律用「元」与「万分比」，只在提交时换算一次，避免
 * 同一份数据在页面里出现两套单位。
 *
 * ## 模块划分
 *
 * 列表与表单抽屉各自独立；本文件保留筛选、URL 同步与写操作编排。
 */
export function AdminCouponsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList，首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('keyword') ?? '';
  // 地址栏参数不可信：只接受本页筛选下拉里真实存在的取值，否则会把
  // 非法枚举直接送到后端，变成一次 400
  const rawType = searchParams.get('type');
  const initialType = rawType && rawType in TYPE_LABEL ? rawType : undefined;
  const rawStatus = searchParams.get('status');
  const initialStatus = rawStatus === 'on' || rawStatus === 'off' ? rawStatus : undefined;

  const [keyword, setKeyword] = useState(initialKeyword);
  const [type, setType] = useState<string | undefined>(initialType);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [busy, setBusy] = useState(false);
  const { exporting, runExport } = useAdminExport(toast);

  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [deleting, setDeleting] = useState<AdminCoupon | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formBase, setFormBase] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const formDirty = Boolean(formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase));
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

  // 只同步已生效的筛选，不同步分页
  useAdminUrlFilterSync({
    keyword: params.keyword as string | undefined,
    type: params.type as string | undefined,
    status: params.status as string | undefined,
  });

  const hasFilter = Boolean(params.keyword || params.type || params.status);
  const rows = data?.items ?? [];

  const applyFilters = () => setQuery({ keyword: keyword.trim() || undefined, type, status });
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
  const exportCsv = () =>
    runExport(
      () =>
        marketingApi.exportCoupons({
          keyword: params.keyword as string | undefined,
          type: params.type as string | undefined,
          status: params.status as string | undefined,
        }),
      '导出已开始下载',
    );

  const openCreate = () => {
    setEditing(null);
    const next = emptyForm();
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  /* 命令面板「新建优惠券」带 ?create=1 进入 */
  const createIntentApplied = useRef(false);
  useEffect(() => {
    if (searchParams.get('create') !== '1' || createIntentApplied.current) return;
    createIntentApplied.current = true;
    openCreate();
  }, [searchParams]);

  const openEdit = (c: AdminCoupon) => {
    setEditing(c);
    const next: FormState = {
      // 券码编辑时留空 = 不改。改券码等于让用户手里的券集体失效
      code: '',
      name: c.name,
      type: c.type,
      // 折扣是万分比原样；其余是分 → 元
      value: c.type === 'discount' ? String(c.value) : String(c.value / 100),
      // 门槛以**元**载入表单，提交时再换算成分 —— 表单内只保留一种口径
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

  const patchForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    const payload = buildCouponPayload(form, editing);
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

  /** 有关联订单的券不能物理删除，先给出「改为停用」的下一步。 */
  const requestDelete = (row: AdminCoupon) => {
    if (row.orderCount > 0) {
      toast.error(`该优惠券已有 ${row.orderCount} 笔关联订单，不能删除；请改为停用`);
      return;
    }
    setDeleting(row);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await marketingApi.removeCoupon(deleting.id);
      toast.success(`已删除优惠券「${deleting.name}」`);
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      title="优惠券"
      description="发放范围、使用条件、有效期与限用。有历史订单的券只能停用；从未产生订单的券可删除。"
      actions={
        writable ? (
          <ActionButton variant="default" size="sm" icon={Plus} onClick={openCreate}>
            新建优惠券
          </ActionButton>
        ) : (
          <span className="text-[12px] text-muted-foreground">当前账号无 marketing.write 权限，仅可查看</span>
        )
      }
    >
      <FilterBar>
        <ClearableField
          className="w-56"
          ariaLabel="按券码或名称搜索"
          placeholder="券码 / 名称"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
        />
        <SelectField
          className="w-32"
          ariaLabel="按类型筛选"
          clearLabel="全部类型"
          allowClear
          value={type}
          onChange={setType}
          options={TYPE_OPTIONS}
        />
        <SelectField
          className="w-32"
          ariaLabel="按状态筛选"
          clearLabel="全部状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        {/* 动作按钮右对齐，与全站其余筛选栏一致；右侧留白是刻意的呼吸区 */}
        <FilterActions>
          <ActionButton variant="default" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      <Panel
        title="券列表"
        extra={
          <>
            {can('data.export') && <ExportCsvButton exporting={exporting} onExport={exportCsv} />}
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <CouponTable
          rows={rows}
          loading={loading}
          error={rows.length === 0 ? error : null}
          hasFilter={hasFilter}
          current={data?.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          total={data?.total ?? 0}
          writable={writable}
          busy={busy}
          onEdit={openEdit}
          onToggle={(row) => void doToggle(row)}
          onDelete={requestDelete}
          onPageChange={setPage}
          onRetry={reload}
          onResetFilters={resetFilters}
          onCreate={openCreate}
        />
      </Panel>

      <CouponFormDrawer
        open={formOpen}
        editing={editing}
        form={form}
        formError={formError}
        dirty={formDirty}
        busy={busy}
        onPatch={patchForm}
        onClose={requestCloseForm}
        onSave={() => void save()}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `删除优惠券「${deleting.name}」` : '删除优惠券'}
        description={
          deleting
            ? deleting.status === 'on'
              ? '该券当前处于启用状态，删除后用户将无法再使用，且无法恢复。'
              : '删除后该券将从后台列表移除，且无法恢复。'
            : undefined
        }
        impact={
          deleting
            ? [
                `券码：${deleting.code}`,
                `面额：${deleting.valueLabel}（${TYPE_LABEL[deleting.type] ?? deleting.type}）`,
                '该券没有关联订单，删除不影响任何历史交易',
              ]
            : undefined
        }
        danger
        confirmText="删除优惠券"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AdminPage>
  );
}
