import { useState } from 'react';
import { Plus } from 'lucide-react';
import { adminMembershipPlansApi } from './api';
import {
  ActionButton,
  EmptyState,
  ListError,
  PageHeader,
  PageSkeleton,
  Panel,
  StaleError,
} from './components';
import {
  useAdmin,
  useAdminResource,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { EMPTY_DRAFT, type PlanDraft } from './constants';
import { buildPlanPayload, toDraft } from './utils';
import { PlanStats } from './PlanStats';
import { PlanTable } from './PlanTable';
import { PlanFormDrawer } from './PlanFormDrawer';
import { PlanStatusConfirm } from './PlanStatusConfirm';
import type { AdminMembershipPlan } from '../../../types/api';
import { auditReason } from '../../../admin-ui/lib/auditReason';

/**
 * 会员套餐管理（`/admin/membership-plans`）。
 *
 * 会员套餐与积分包是两套商品：会员按周期生效、带权益快照，积分包一次性发放。
 *
 * 三条约束：
 * 1. 套餐编码创建后不可改（订单与外部对账靠它认套餐）；
 * 2. 下架不影响存量会员，已付周期的权益仍按 `Membership.perksSnapshot` 执行；
 * 3. 改价/改权益/上下架都必须写原因，审计要能回答「谁为什么改」。
 *
 * ## 模块划分
 *
 * 统计条 / 列表 / 表单抽屉 / 上下架确认各自独立；本文件只保留取数、
 * 草稿状态与写操作编排。
 */
export function AdminMembershipPlansPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('product.write');

  const { data, loading, error, reload } = useAdminResource(() => adminMembershipPlansApi.list());

  const [editing, setEditing] = useState<AdminMembershipPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<PlanDraft>(EMPTY_DRAFT);
  const [draftBase, setDraftBase] = useState<PlanDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [statusTarget, setStatusTarget] = useState<AdminMembershipPlan | null>(null);

  const rows = data?.items ?? [];

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDraftBase(EMPTY_DRAFT);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (plan: AdminMembershipPlan) => {
    const next = toDraft(plan);
    setDraft(next);
    setDraftBase(next);
    setEditing(plan);
    setCreating(false);
  };

  const formOpen = creating || editing !== null;
  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const resetForm = () => {
    setCreating(false);
    setEditing(null);
  };
  const requestCloseForm = useDiscardConfirm(formDirty, resetForm);

  const patchDraft = (patch: Partial<PlanDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    const payload = buildPlanPayload(draft, {
      creating,
      editingCode: editing?.code ?? null,
    });
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await adminMembershipPlansApi.update(editing.id, payload.update);
        toast.success('会员套餐已更新，新价格只影响之后的订单');
      } else {
        await adminMembershipPlansApi.create(payload.create);
        toast.success('会员套餐已创建，当前为下架状态，确认后请手动上架');
      }
      resetForm();
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runToggle = async () => {
    if (!statusTarget) return;
    setSaving(true);
    try {
      const next = statusTarget.status === 'active' ? 'offline' : 'active';
      await adminMembershipPlansApi.setStatus(
        statusTarget.id,
        next,
        auditReason(next === 'active' ? '上架会员套餐' : '下架会员套餐'),
      );
      toast.success(next === 'active' ? '套餐已上架' : '套餐已下架，存量会员不受影响');
      setStatusTarget(null);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  /*
   * 页头照常渲染：加载期间标题与说明就该在位。
   * 骨架与真实版面同构：四张统计卡 + 一块列表面板。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="会员套餐"
        description="会员按周期生效，权益在下单时快照到用户订阅上；改价或改权益只影响之后的订单。"
        stats={4}
        panels={1}
        panelRows={5}
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="还没有会员套餐" />;

  return (
    <>
      <PageHeader
        title="会员套餐"
        description="会员按周期生效，权益在下单时快照到用户订阅上；改价或改权益只影响之后的订单。"
        actions={
          writable ? (
            <ActionButton icon={Plus} onClick={openCreate}>
              新建套餐
            </ActionButton>
          ) : (
            <span className="text-[12px] text-muted-foreground">
              当前账号无 product.write 权限，仅可查看
            </span>
          )
        }
      />

      <PlanStats rows={rows} />

      {error && data && <StaleError error={error} onRetry={() => void reload()} />}

      <Panel title="全部会员套餐" note="编码创建后不可修改；下架不影响存量会员已付周期的权益">
        <PlanTable
          rows={rows}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          writable={writable}
          saving={saving}
          onCreate={openCreate}
          onEdit={openEdit}
          onToggle={setStatusTarget}
        />
      </Panel>

      <PlanFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        formDirty={formDirty}
        saving={saving}
        onPatch={patchDraft}
        onClose={requestCloseForm}
        onSubmit={() => void submit()}
      />

      <PlanStatusConfirm
        target={statusTarget}
        saving={saving}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => void runToggle()}
      />
    </>
  );
}
