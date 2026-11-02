import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminMembershipPlansApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  ActionButton,
  AdminDataTable,
  ConfirmAction,
  Drawer,
  EmptyState,
  FormField,
  ListError,
  NumberField,
  PageHeader,
  PageSkeleton,
  Panel,
  SelectField,
  StatCard,
  StatusTag,
  StaleError,
  SwitchField,
  TextField,
  useAdminResource,
  type AdminColumn,
} from '../../admin-ui/primitives';
import type { AdminMembershipPlan } from '../../types/api';

/** 分 → 元 */
function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元 → 分。非法输入返回 null，由调用方拦截 */
function yuanToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** 万分比 → 折扣百分比。9500 → 95 */
function bpsToPercent(bps: number): string {
  return String(Math.round(bps / 100));
}

interface PlanDraft {
  code: string;
  name: string;
  description: string;
  priceYuan: string;
  durationDays: string;
  monthlyCredits: string;
  fastChannel: boolean;
  maxConcurrent: string;
  discountPercent: string;
  sortOrder: string;
  reason: string;
}

const EMPTY_DRAFT: PlanDraft = {
  code: '',
  name: '',
  description: '',
  priceYuan: '',
  durationDays: '30',
  monthlyCredits: '0',
  fastChannel: true,
  maxConcurrent: '5',
  discountPercent: '100',
  sortOrder: '0',
  reason: '',
};

function toDraft(plan: AdminMembershipPlan): PlanDraft {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceYuan: centsToYuan(plan.priceCents),
    durationDays: String(plan.durationDays),
    monthlyCredits: String(plan.monthlyCredits),
    fastChannel: plan.perks.fastChannel,
    maxConcurrent: String(plan.perks.maxConcurrent),
    discountPercent: bpsToPercent(plan.perks.addonDiscountBps),
    sortOrder: String(plan.sortOrder),
    reason: '',
  };
}

/**
 * 会员套餐管理。
 *
 * 会员套餐与积分包是两套商品：会员按周期生效、带权益快照，积分包一次性发放。
 * 此前后台只能改积分包，会员价目表只能靠种子/改库 —— 运营改一次价格就要发版。
 *
 * 三条约束：
 * 1. 套餐编码创建后不可改（订单与外部对账靠它认套餐）；
 * 2. 下架不影响存量会员，已付周期的权益仍按 `Membership.perksSnapshot` 执行；
 * 3. 改价/改权益/上下架都必须写原因，审计要能回答「谁为什么改」。
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
  const [statusReason, setStatusReason] = useState('');
  const [statusReasonError, setStatusReasonError] = useState(false);

  const rows = data?.items ?? [];
  const stats = useMemo(() => {
    const active = rows.filter((p) => p.status === 'active');
    const members = rows.reduce((sum, p) => sum + p.memberCount, 0);
    const paid = rows.filter((p) => p.priceCents > 0);
    return { active: active.length, members, paid: paid.length };
  }, [rows]);

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

  const submit = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast.error('请填写套餐名称');
      return;
    }
    if (creating && !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(draft.code.trim())) {
      toast.error('套餐编码只能是小写字母/数字/下划线/短横线，长度 2~40');
      return;
    }
    const priceCents = yuanToCents(draft.priceYuan);
    if (priceCents === null) {
      toast.error('价格格式不正确，请填两位小数，如 29.00');
      return;
    }
    const durationDays = Number(draft.durationDays);
    if (!Number.isInteger(durationDays) || durationDays < 0) {
      toast.error('周期必须是非负整数天');
      return;
    }
    if (editing?.code !== 'free' && durationDays === 0) {
      toast.error('可购买的套餐周期必须大于 0 天');
      return;
    }
    const monthlyCredits = Number(draft.monthlyCredits);
    if (!Number.isInteger(monthlyCredits) || monthlyCredits < 0) {
      toast.error('每月积分必须是非负整数');
      return;
    }
    const maxConcurrent = Number(draft.maxConcurrent);
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 0 || maxConcurrent > 100) {
      toast.error('并发上限必须是 0~100 的整数（0 表示不限）');
      return;
    }
    const discountPercent = Number(draft.discountPercent);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      toast.error('折扣必须是 1~100 的整数（100 表示无折扣）');
      return;
    }
    const reason = draft.reason.trim();
    if (!reason) {
      toast.error('请填写变更原因，审计记录需要能回答「谁为什么改」');
      return;
    }

    const perks = {
      fastChannel: draft.fastChannel,
      maxConcurrent,
      addonDiscountBps: discountPercent * 100,
    };
    const sortOrder = Number(draft.sortOrder) || 0;

    setSaving(true);
    try {
      if (editing) {
        await adminMembershipPlansApi.update(editing.id, {
          name,
          description: draft.description.trim(),
          priceCents,
          durationDays,
          monthlyCredits,
          perks,
          sortOrder,
          reason,
        });
        toast.success('会员套餐已更新，新价格只影响之后的订单');
      } else {
        await adminMembershipPlansApi.create({
          code: draft.code.trim(),
          name,
          description: draft.description.trim(),
          priceCents,
          durationDays,
          monthlyCredits,
          perks,
          sortOrder,
          reason,
          // 新建默认下架，确认无误后再上架，避免半成品套餐立刻可售
          status: 'offline',
        });
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
    const reason = statusReason.trim();
    if (!reason) {
      setStatusReasonError(true);
      return;
    }
    setSaving(true);
    try {
      const next = statusTarget.status === 'active' ? 'offline' : 'active';
      await adminMembershipPlansApi.setStatus(statusTarget.id, next, reason);
      toast.success(next === 'active' ? '套餐已上架' : '套餐已下架，存量会员不受影响');
      setStatusTarget(null);
      setStatusReason('');
      setStatusReasonError(false);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: Array<AdminColumn<AdminMembershipPlan>> = [
    {
      key: 'plan',
      title: '套餐',
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <code className="font-mono text-[12px] text-muted-foreground">{row.code}</code>
          {row.description && (
            <span
              className="max-w-[220px] truncate text-[12px] text-muted-foreground"
              title={row.description}
            >
              {row.description}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'price',
      title: '订阅价',
      width: 85,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">¥ {centsToYuan(row.priceCents)}</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {row.priceCents} 分
          </span>
        </div>
      ),
    },
    {
      key: 'duration',
      title: '周期',
      width: 60,
      render: (row) => (row.durationDays === 0 ? '永久' : `${row.durationDays} 天`),
    },
    {
      key: 'credits',
      title: '每月积分',
      width: 70,
      render: (row) => <span className="tabular-nums">{row.monthlyCredits}</span>,
    },
    {
      key: 'perks',
      title: '权益',
      width: 220,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.perkLabels.map((label) => (
            <span
              key={label}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'usage',
      title: '会员 / 订单',
      width: 80,
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.memberCount} / {row.orderCount}
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 70,
      render: (row) => (
        <StatusTag
          status={row.status}
          label={row.status === 'active' ? '在售' : '已下架'}
        />
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 120,
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => openEdit(row)}
            disabled={!writable}
          >
            编辑
          </ActionButton>
          {row.code === 'free' ? (
            <span
              className="px-1.5 text-[12px] text-muted-foreground"
              title="free 套餐由系统内置，不能下架"
            >
              内置
            </span>
          ) : (
            <ActionButton
              variant={row.status === 'active' ? 'destructive' : 'ghost'}
              size="sm"
              disabled={!writable || saving}
              onClick={() => {
                setStatusTarget(row);
                setStatusReason('');
                setStatusReasonError(false);
              }}
            >
              {row.status === 'active' ? '下架' : '上架'}
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  /*
   * 页头照常渲染：加载期间标题与说明就该在位。
   * 之前的守卫整页替换，首屏先闪一段没有标题的灰条，再冒出完整页面 ——
   * 骨架该占住位置，不是把版面清空。
   *
   * 四张统计卡 + 一块列表面板，与真实版面同构。
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

      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="套餐总数" value={rows.length} hint="含 free 与已下架套餐" />
        <StatCard label="在售" value={stats.active} hint="C 端价目表可见并可下单" />
        <StatCard label="付费套餐" value={stats.paid} hint="订阅价大于 0 的套餐" />
        <StatCard label="存量会员" value={stats.members} hint="按当前套餐订阅的用户数（含历史）" />
      </div>

      {error && data && <StaleError error={error} onRetry={() => void reload()} />}

      <Panel title="全部会员套餐" note="编码创建后不可修改；下架不影响存量会员已付周期的权益">
        <AdminDataTable<AdminMembershipPlan>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          minWidth={900}
          emptyText="还没有会员套餐。新建一个套餐，C 端价目表才会出现可订阅项。"
          emptyAction={
            writable ? (
              <ActionButton variant="secondary" onClick={openCreate}>
                新建套餐
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={540}
        title={editing ? '编辑会员套餐' : '新建会员套餐'}
        description={
          formDirty
            ? '有未保存修改'
            : editing
              ? `编码 ${editing.code} 不可修改`
              : '创建后默认为下架状态'
        }
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={requestCloseForm}
              disabled={saving}
            >
              取消
            </ActionButton>
            <ActionButton disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : editing ? '保存修改' : '创建'}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="套餐编码"
              hint={editing ? '创建后不可修改' : '小写字母、数字、下划线或短横线'}
            >
              <TextField
                ariaLabel="套餐编码"
                value={draft.code}
                disabled={editing !== null}
                onChange={(value) => setDraft({ ...draft, code: value })}
                placeholder="如 pro"
                maxLength={40}
              />
            </FormField>
            <FormField label="套餐名称">
              <TextField
                ariaLabel="套餐名称"
                value={draft.name}
                onChange={(value) => setDraft({ ...draft, name: value })}
                placeholder="如 专业会员"
                maxLength={40}
              />
            </FormField>
          </div>

          <FormField label="套餐说明" hint="展示在 C 端会员卡上">
            <TextField
              ariaLabel="套餐说明"
              value={draft.description}
              onChange={(value) => setDraft({ ...draft, description: value })}
              placeholder="一句话说明适合谁"
              maxLength={300}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="订阅价（元）" hint="整数分入库；free 套餐必须为 0">
              <TextField
                ariaLabel="订阅价"
                value={draft.priceYuan}
                onChange={(value) => setDraft({ ...draft, priceYuan: value })}
                placeholder="如 29.00"
              />
            </FormField>
            <FormField label="周期（天）" hint="0 = 永久，仅 free 套餐可用">
              <NumberField
                ariaLabel="周期天数"
                value={Number(draft.durationDays) || 0}
                min={0}
                max={3650}
                onChange={(next) => setDraft({ ...draft, durationDays: String(next ?? 0) })}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="每月赠送积分">
              <NumberField
                ariaLabel="每月赠送积分"
                value={Number(draft.monthlyCredits) || 0}
                min={0}
                onChange={(next) => setDraft({ ...draft, monthlyCredits: String(next ?? 0) })}
              />
            </FormField>
            <FormField label="并发任务上限" hint="0 = 不限">
              <NumberField
                ariaLabel="并发任务上限"
                value={Number(draft.maxConcurrent) || 0}
                min={0}
                max={100}
                onChange={(next) => setDraft({ ...draft, maxConcurrent: String(next ?? 0) })}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="加油包折扣" hint="100 = 无折扣，95 = 95 折">
              <NumberField
                ariaLabel="加油包折扣"
                value={Number(draft.discountPercent) || 100}
                min={1}
                max={100}
                onChange={(next) => setDraft({ ...draft, discountPercent: String(next ?? 100) })}
              />
            </FormField>
            <FormField label="排序" hint="数字越小越靠前">
              <NumberField
                ariaLabel="排序"
                value={Number(draft.sortOrder) || 0}
                onChange={(next) => setDraft({ ...draft, sortOrder: String(next ?? 0) })}
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <div className="text-xs font-medium text-foreground">专享快速通道</div>
              <div className="text-[12px] text-muted-foreground">开启后该套餐会员走快速生成队列</div>
            </div>
            <SwitchField
              checked={draft.fastChannel}
              onChange={(checked) => setDraft({ ...draft, fastChannel: checked })}
              ariaLabel="专享快速通道"
            />
          </div>

          <FormField label="变更原因" hint="写入审计，必须能回答「谁为什么改」">
            <TextField
              ariaLabel="变更原因"
              value={draft.reason}
              onChange={(value) => setDraft({ ...draft, reason: value })}
              placeholder={editing ? '如：专业会员月费 99 → 89 元' : '如：新增工作室套餐'}
              maxLength={200}
            />
          </FormField>
        </div>
      </Drawer>

      {statusTarget && (
        <ConfirmAction
          open
          title={statusTarget.status === 'active' ? '下架会员套餐' : '上架会员套餐'}
          confirmText={statusTarget.status === 'active' ? '确认下架' : '确认上架'}
          loading={saving}
          description={
            <p>
              {statusTarget.status === 'active'
                ? '下架后 C 端不再展示该套餐，但存量会员已付周期的权益不受影响。'
                : '上架后该套餐会出现在 C 端价目表并允许下单。'}
            </p>
          }
          impact={[
            `套餐：${statusTarget.name}（${statusTarget.code}）`,
            `订阅价：¥ ${centsToYuan(statusTarget.priceCents)} / ${statusTarget.durationDays || '永久'} 天`,
            `当前存量会员：${statusTarget.memberCount} 人`,
          ]}
          extra={
            <FormField
              label="变更原因（写入审计）"
              htmlFor="adm-plan-status-reason"
              required
              error={statusReasonError ? '请填写变更原因。' : null}
            >
              <TextField
                value={statusReason}
                onChange={(next) => {
                  setStatusReason(next);
                  if (next.trim()) setStatusReasonError(false);
                }}
                placeholder="如：活动结束，暂停售卖"
                ariaLabel="变更原因"
              />
            </FormField>
          }
          onCancel={() => {
            setStatusTarget(null);
            setStatusReason('');
            setStatusReasonError(false);
          }}
          onConfirm={() => void runToggle()}
        />
      )}
    </>
  );
}
