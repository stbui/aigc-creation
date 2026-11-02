import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { adminProductsApi } from './api';
import {
  ActionButton,
  PageHeader,
  Panel,
  StaleError,
  type AppliedFilter,
} from './components';
import {
  useAdmin,
  useAdminList,
  useAdminUrlFilterSync,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { EMPTY_DRAFT, type ProductDraft } from './constants';
import { buildProductPayload, toDraft } from './utils';
import { ProductStats } from './ProductStats';
import { ProductFilterBar } from './ProductFilterBar';
import { ProductTable } from './ProductTable';
import { ProductFormDrawer } from './ProductFormDrawer';
import type { AdminProduct } from '../../../types/api';

/**
 * 商品管理（`/admin/products`，B-34~B-36）。
 *
 * ## 为什么没有「删除」
 *
 * 历史订单的 OrderItem 存的是快照，删商品不会让旧订单显示不全；但对账时
 * 后台就再也查不到「这个 SKU 原来卖多少钱、发多少积分」了 —— 而这两个数
 * 正是退款与积分回收的计算依据。下架即够。
 *
 * ## 为什么价格用「元」输入、「分」存储
 *
 * 库里一律整数分（浮点算钱会在对账时出现 0.01 的差异，且无法复现）。
 * 转换只在回填与提交两处发生，见 `utils.ts`。
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
   * 商品不分组不分页：积分包/会员套餐一类的 SKU 通常只有个位数到几十个，
   * 一次全量拉取比分页更符合运营的心智（他们要看的就是「全部卖什么」）。
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

  const changeStatus = (next: 'active' | 'offline' | undefined) => {
    setStatus(next);
    setQuery({ status: next });
  };

  const clearStatus = () => {
    setStatus(undefined);
    setQuery({ status: undefined });
  };

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
            <span className="text-[12px] text-muted-foreground">
              当前账号无 product.write 权限，仅可查看
            </span>
          )
        }
      />

      <ProductStats rows={rows} />

      <ProductFilterBar
        status={status}
        onStatusChange={changeStatus}
        onRefresh={reload}
        appliedChips={appliedChips}
        onClearAll={clearStatus}
      />

      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel
        title="全部商品"
        note="价格以「分」存储，界面展示按「元」；两者同时显示便于与流水核对"
      >
        <ProductTable
          rows={rows}
          loading={loading}
          error={error}
          onRetry={reload}
          writable={writable}
          saving={saving}
          filtered={Boolean(status)}
          onClearFilter={clearStatus}
          onEdit={openEdit}
          onToggle={(row) => void runToggle(row)}
        />
      </Panel>

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
    </>
  );
}
