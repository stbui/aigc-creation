import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { adminProductsApi } from './api';
import {
  ActionButton,
  ConfirmDialog,
  PageHeader,
  RefreshButton,
  StaleError,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminResource,
  useAdminUrlFilterSync,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { EMPTY_DRAFT, GRANT_TYPE_LABELS, STATUS_LABELS, type ProductDraft } from './constants';
import { buildProductPayload, deleteBlockedReason, toDraft } from './utils';
import { ProductStats } from './ProductStats';
import { ProductFilterBar } from './ProductFilterBar';
import { ProductCardGrid } from './ProductCardGrid';
import { ProductFormDrawer } from './ProductFormDrawer';
import type { AdminProduct } from '../../../types/api';

/**
 * 商品管理（`/admin/products`，B-34~B-36）。
 *
 * ## 删除的边界：只有「从没卖出去过」的 SKU 能删
 *
 * 已产生订单的商品不做物理删除 —— 退款与积分回收要回查该 SKU 的原价与
 * 发放积分，删掉后对账无从追溯（`OrderItem.productId` 也是 RESTRICT 外键）。
 * 这类商品请改为下架：C 端立即不可购买，历史订单照常展示。
 *
 * 列表接口带回 `orderCount`，前台在打开确认弹窗之前就拦下并给出可执行提示，
 * 不让运营先点确认再吃一个 409。后端仍会再校验一次，防并发窗口。
 *
 * ## 为什么价格用「元」输入、「分」存储
 *
 * 库里一律整数分（浮点算钱会在对账时出现 0.01 的差异，且无法复现）。
 * 转换只在回填与提交两处发生，见 `utils.ts`。
 *
 * ## 为什么一次全量拉取、客户端筛选分页
 *
 * 商品是运营维护的小数据集（几十个），全量拉取比服务端分页更符合
 * 「一眼看全卖什么」的心智；分页只解决渲染长度，不改变数据口径。
 * 统计卡始终基于完整目录计算，不受筛选影响。
 *
 * ## 模块划分
 *
 * 统计条 / 筛选条 / 列表 / 表单抽屉各自独立；本文件只保留取数、
 * 筛选状态与写操作编排。
 */
export function AdminProductsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('product.write');
  const deletable = can('product.delete');

  const [searchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const initialStatus: 'active' | 'offline' | undefined =
    rawStatus === 'active' || rawStatus === 'offline' ? rawStatus : undefined;
  const rawGrantType = searchParams.get('grantType');
  const initialGrantType: 'immediate' | 'manual' | undefined =
    rawGrantType === 'immediate' || rawGrantType === 'manual' ? rawGrantType : undefined;
  const initialQ = searchParams.get('q') ?? '';

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState<'active' | 'offline' | undefined>(initialStatus);
  const [grantType, setGrantType] = useState<'immediate' | 'manual' | undefined>(
    initialGrantType,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [draftBase, setDraftBase] = useState<ProductDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  /** 已通过订单数预检、等待二次确认的商品 */
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);

  const { data, loading, error, reload } = useAdminResource(() => adminProductsApi.list());
  const rows = useMemo(() => data ?? [], [data]);

  const filteredRows = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    const matched = rows.filter((row) => {
      if (status && row.status !== status) return false;
      if (grantType && row.grantType !== grantType) return false;
      if (!keyword) return true;
      return (
        row.name.toLowerCase().includes(keyword) || row.sku.toLowerCase().includes(keyword)
      );
    });
    // 卡片按「排序」字段升序展示：运营在前台排的序就是这里看到的序。
    // 排序值相同时保持接口返回的原始相对次序（Array.prototype.sort 稳定）。
    return matched.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [rows, q, status, grantType]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  // 筛选把结果缩到当前页之外时回落到末页，避免停在一页空白
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageRows = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize],
  );

  const hasFilter = Boolean(status || grantType || q.trim());

  const changeQ = (next: string) => {
    setQ(next);
    setPage(1);
  };
  const changeStatus = (next: 'active' | 'offline' | undefined) => {
    setStatus(next);
    setPage(1);
  };
  const changeGrantType = (next: 'immediate' | 'manual' | undefined) => {
    setGrantType(next);
    setPage(1);
  };
  const resetFilters = useCallback(() => {
    setQ('');
    setStatus(undefined);
    setGrantType(undefined);
    setPage(1);
  }, []);

  useAdminUrlFilterSync({ status, grantType, q: q.trim() || undefined });

  const appliedChips: AppliedFilter[] = [
    q.trim()
      ? {
          key: 'q',
          label: `关键词：${q.trim()}`,
          onClear: () => changeQ(''),
        }
      : null,
    status
      ? {
          key: 'status',
          label: `状态：${STATUS_LABELS[status]}`,
          onClear: () => changeStatus(undefined),
        }
      : null,
    grantType
      ? {
          key: 'grantType',
          label: `发放：${GRANT_TYPE_LABELS[grantType]}`,
          onClear: () => changeGrantType(undefined),
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDraftBase(EMPTY_DRAFT);
    setEditing(null);
    setCreating(true);
  };

  /* 命令面板「新建商品」带 ?create=1 进入：只打开表单，不自动保存 */
  const createIntentApplied = useRef(false);
  useEffect(() => {
    if (searchParams.get('create') !== '1' || createIntentApplied.current) return;
    createIntentApplied.current = true;
    openCreate();
  }, [searchParams]);

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

  const patchDraft = (patch: Partial<ProductDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  /** 提交前把草稿翻译成后端 payload；任何一项非法就停下并指出是哪一项 */
  const submit = async () => {
    const payload = buildProductPayload(draft, editing);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await adminProductsApi.update(editing.id, payload.update);
        toast.success('商品已更新，新价格对后续下单生效');
      } else {
        await adminProductsApi.create(payload.create);
        toast.success('商品已创建，当前为下架状态，确认后请手动上架');
      }
      closeForm();
      void reload();
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
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  /**
   * 打开删除确认。有历史订单的直接拦下并告诉运营该怎么做 ——
   * 这类商品只能下架，弹一个注定失败的确认框没有意义。
   */
  const requestDelete = (row: AdminProduct) => {
    const blocked = deleteBlockedReason(row);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    setDeleting(row);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await adminProductsApi.remove(deleting.id);
      toast.success(`已删除商品「${deleting.name}」`);
      setDeleting(null);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="商品管理"
        description="积分包与增值商品的价目表。改价只影响之后的下单，历史订单按下单时的快照结算。"
        actions={
          writable ? undefined : (
            <span className="text-[12px] text-muted-foreground">
              当前账号无 product.write 权限，仅可查看
            </span>
          )
        }
      />

      <ProductStats rows={rows} />

      <ProductFilterBar
        q={q}
        onQChange={changeQ}
        status={status}
        onStatusChange={changeStatus}
        grantType={grantType}
        onGrantTypeChange={changeGrantType}
        onReset={resetFilters}
        hasFilter={hasFilter}
        appliedChips={appliedChips}
      />

      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={() => void reload()} />}

      <section className="mb-4" aria-labelledby="admin-products-list-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            id="admin-products-list-title"
            className="m-0 font-semibold text-[13px] text-foreground"
          >
            全部商品
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshButton loading={loading} onRefresh={() => void reload()} />
            {writable && (
              <ActionButton size="sm" icon={Plus} onClick={openCreate}>
                新建商品
              </ActionButton>
            )}
          </div>
        </div>
        <ProductCardGrid
          rows={pageRows}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          writable={writable}
          deletable={deletable}
          saving={saving}
          filtered={hasFilter}
          onClearFilter={resetFilters}
          onCreate={openCreate}
          onEdit={openEdit}
          onToggle={(row) => void runToggle(row)}
          onDelete={requestDelete}
          pagination={{
            current: page,
            pageSize,
            total: filteredRows.length,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
        />
      </section>

      <ProductFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        formDirty={formDirty}
        saving={saving}
        onPatch={patchDraft}
        onClose={requestCloseForm}
        onSubmit={() => void submit()}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `删除商品「${deleting.name}」` : '删除商品'}
        description={
          deleting
            ? `SKU ${deleting.sku} 没有历史订单，删除不影响任何订单与积分。`
            : undefined
        }
        impact={
          deleting
            ? [
                '商品将从后台与 C 端结算页移除，且不可恢复',
                `SKU「${deleting.sku}」随之释放，可用同一编码重新创建`,
              ]
            : undefined
        }
        danger
        confirmText="删除商品"
        loading={saving}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
