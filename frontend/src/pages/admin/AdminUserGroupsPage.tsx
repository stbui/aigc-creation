import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminChannelsApi, adminUserGroupsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { Notice } from '../../admin-ui/primitives';
import { CheckBox, NumberInput, SelectBox, SwitchBox, TextArea, TextInput } from '../../admin-ui/controls';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
import { parseCredits, toCreditsInput } from '../../lib/microcredits';
import type { ChannelOrderItemView, UserGroupView } from '../../types/model';

/**
 * 用户分组（`/admin/user-groups`）。
 *
 * 分组决定三件事：倍率（同一次调用扣多少）、可见渠道、按模型的覆盖价格。
 * 本仓没有 `users.user_group` 列 —— 分组由会员套餐映射而来，没有有效会员的
 * 用户落在默认分组 `default`，所以「默认分组」不允许删除。
 *
 * `code` 创建后不可改：会员套餐按编码映射分组，改编码等于把存量会员整体换组。
 */

const BADGE_STYLE_OPTIONS = [
  { value: 'none', label: '无徽标' },
  { value: 'vip', label: 'VIP' },
  { value: 'svip', label: 'SVIP' },
];

const BADGE_STYLE_LABELS: Record<string, string> = {
  none: '无',
  vip: 'VIP',
  svip: 'SVIP',
};

interface OverrideDraft {
  modelKey: string;
  ratioPercent: string;
  pointsPerUsd: string;
  pointsPerCny: string;
}

interface GroupDraft {
  code: string;
  name: string;
  description: string;
  badgeLabel: string;
  badgeStyle: string;
  sortOrder: string;
  ratioPercent: string;
  pointsPerUsd: string;
  pointsPerCny: string;
  allChannels: boolean;
  channelIds: string[];
  overrides: OverrideDraft[];
  reason: string;
}

const EMPTY_DRAFT: GroupDraft = {
  code: '',
  name: '',
  description: '',
  badgeLabel: '',
  badgeStyle: 'none',
  sortOrder: '0',
  ratioPercent: '100',
  pointsPerUsd: '1',
  pointsPerCny: '0.14',
  allChannels: true,
  channelIds: [],
  overrides: [],
  reason: '',
};

function toDraft(group: UserGroupView): GroupDraft {
  return {
    code: group.code,
    name: group.name,
    description: group.description,
    badgeLabel: group.badgeLabel,
    badgeStyle: group.badgeStyle || 'none',
    sortOrder: String(group.sortOrder),
    // 万分比 → 百分比：9500 → 95
    ratioPercent: String(Math.round(group.ratioBasisPoints / 100)),
    pointsPerUsd: toCreditsInput(group.pointsPerUsdMicrocredits),
    pointsPerCny: toCreditsInput(group.pointsPerCnyMicrocredits),
    allChannels: group.allChannels,
    channelIds: [...group.channelIds],
    overrides: group.modelOverrides.map((item) => ({
      modelKey: item.modelKey,
      ratioPercent: String(Math.round(item.ratioBasisPoints / 100)),
      pointsPerUsd: toCreditsInput(item.pointsPerUsdMicrocredits),
      pointsPerCny: toCreditsInput(item.pointsPerCnyMicrocredits),
    })),
    reason: '',
  };
}

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <p className="text-[11px] leading-4 text-text-tertiary">{hint}</p>}
    </div>
  );
}

export function AdminUserGroupsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const writable = can('user_group.write');

  const { data, loading, error, reload } = useAdminResource(() => adminUserGroupsApi.list());
  const rows = data ?? [];

  const [channels, setChannels] = useState<ChannelOrderItemView[]>([]);
  useEffect(() => {
    void adminChannelsApi.order().then(setChannels).catch(() => undefined);
  }, []);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserGroupView | null>(null);
  const [draft, setDraft] = useState<GroupDraft>(EMPTY_DRAFT);
  const [draftBase, setDraftBase] = useState<GroupDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserGroupView | null>(null);

  const formOpen = creating || editing !== null;
  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const resetForm = () => {
    setCreating(false);
    setEditing(null);
  };
  const requestCloseForm = useDiscardConfirm(formDirty, resetForm);

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDraftBase(EMPTY_DRAFT);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (group: UserGroupView) => {
    const next = toDraft(group);
    setDraft(next);
    setDraftBase(next);
    setEditing(group);
    setCreating(false);
  };

  const patchDraft = (patch: Partial<GroupDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleChannel = (channelId: string) =>
    patchDraft({
      channelIds: draft.channelIds.includes(channelId)
        ? draft.channelIds.filter((id) => id !== channelId)
        : [...draft.channelIds, channelId],
    });

  const addOverride = () =>
    patchDraft({
      overrides: [
        ...draft.overrides,
        { modelKey: '', ratioPercent: '100', pointsPerUsd: '1', pointsPerCny: '0.14' },
      ],
    });

  const updateOverride = (index: number, patch: Partial<OverrideDraft>) =>
    patchDraft({
      overrides: draft.overrides.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });

  const removeOverride = (index: number) =>
    patchDraft({ overrides: draft.overrides.filter((_, i) => i !== index) });

  const submit = async () => {
    const code = draft.code.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code)) {
      toast.error('分组编码只能使用小写字母、数字、下划线或连字符，最多 40 位');
      return;
    }
    if (!draft.name.trim()) {
      toast.error('请填写分组名称');
      return;
    }
    const ratioPercent = Number(draft.ratioPercent);
    if (!Number.isFinite(ratioPercent) || ratioPercent <= 0 || ratioPercent > 100) {
      toast.error('倍率必须是 0–100 之间的百分比（100 = 原价）');
      return;
    }
    const pointsPerUsd = parseCredits(draft.pointsPerUsd);
    const pointsPerCny = parseCredits(draft.pointsPerCny);
    if (pointsPerUsd === null || pointsPerCny === null) {
      toast.error('点数汇率必须是「积分」数字，最多 6 位小数');
      return;
    }
    if (!draft.allChannels && draft.channelIds.length === 0) {
      toast.error('取消「全部渠道可见」后至少要勾选一条渠道');
      return;
    }
    const overrides: Array<Record<string, unknown>> = [];
    for (const item of draft.overrides) {
      const modelKey = item.modelKey.trim();
      if (!modelKey) {
        toast.error('覆盖项的模型编码不能为空');
        return;
      }
      const ratio = Number(item.ratioPercent);
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 100) {
        toast.error(`覆盖项「${modelKey}」的倍率必须是 0–100`);
        return;
      }
      const usd = parseCredits(item.pointsPerUsd);
      const cny = parseCredits(item.pointsPerCny);
      if (usd === null || cny === null) {
        toast.error(`覆盖项「${modelKey}」的点数汇率格式不正确`);
        return;
      }
      overrides.push({
        modelKey,
        ratioBasisPoints: Math.round(ratio * 100),
        pointsPerUsdMicrocredits: usd,
        pointsPerCnyMicrocredits: cny,
      });
    }

    const body: Record<string, unknown> = {
      code,
      name: draft.name.trim(),
      description: draft.description.trim(),
      badgeLabel: draft.badgeLabel.trim(),
      badgeStyle: draft.badgeStyle,
      sortOrder: Number(draft.sortOrder) || 0,
      ratioBasisPoints: Math.round(ratioPercent * 100),
      pointsPerUsdMicrocredits: pointsPerUsd,
      pointsPerCnyMicrocredits: pointsPerCny,
      allChannels: draft.allChannels,
      channelIds: draft.allChannels ? [] : draft.channelIds,
      modelOverrides: overrides,
      ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
    };

    setSaving(true);
    try {
      if (editing) {
        await adminUserGroupsApi.update(editing.id, body);
        toast.success('分组已保存；目录快照与报价缓存已同时失效');
      } else {
        await adminUserGroupsApi.create(body);
        toast.success('分组已创建');
      }
      resetForm();
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await adminUserGroupsApi.remove(deleteTarget.id);
      toast.success(`已删除分组「${deleteTarget.name}」`);
      setDeleteTarget(null);
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const channelNameById = useMemo(
    () => new Map(channels.map((item) => [item.id, item.name])),
    [channels],
  );

  const columns: Array<AdminColumn<UserGroupView>> = [
    {
      key: 'name',
      title: '分组',
      width: 220,
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-text-primary">{row.name}</span>
            {row.isDefault && <StatusTag status="default" tone="brand" label="默认" />}
            {row.badgeStyle !== 'none' && (
              <StatusTag
                status="badge"
                tone="brand"
                label={row.badgeLabel || BADGE_STYLE_LABELS[row.badgeStyle] || row.badgeStyle}
              />
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{row.code}</div>
        </div>
      ),
    },
    {
      key: 'users',
      title: '用户数',
      width: 80,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.userCount}</span>,
    },
    {
      key: 'ratio',
      title: '倍率',
      width: 90,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">{Math.round(row.ratioBasisPoints / 100)}%</span>
      ),
    },
    {
      key: 'rate',
      title: '点数汇率',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
          <span>1 USD = {toCreditsInput(row.pointsPerUsdMicrocredits)} 积分</span>
          <span className="text-text-tertiary">1 CNY = {toCreditsInput(row.pointsPerCnyMicrocredits)} 积分</span>
        </div>
      ),
    },
    {
      key: 'channels',
      title: '可见渠道',
      width: 170,
      render: (row) =>
        row.allChannels ? (
          <StatusTag status="all" tone="success" label="全部渠道" />
        ) : (
          <span
            className="truncate text-[11px] text-text-secondary"
            title={row.channelIds.map((id) => channelNameById.get(id) ?? id).join('、')}
          >
            {row.channelIds.length} 条：
            {row.channelIds.map((id) => channelNameById.get(id) ?? id).join('、')}
          </span>
        ),
    },
    {
      key: 'overrides',
      title: '模型覆盖',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.modelOverrides.length}</span>,
    },
    {
      key: 'ops',
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" disabled={!writable} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="xs"
            leadingIcon={Trash2}
            disabled={!writable || row.isDefault}
            onClick={() => setDeleteTarget(row)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="用户分组"
        description="决定倍率、可见渠道与按模型的覆盖价格。分组由会员套餐映射，没有有效会员的用户落在默认分组。"
        actions={
          <Button variant="primary" size="small" leadingIcon={Plus} disabled={!writable} onClick={openCreate}>
            新建分组
          </Button>
        }
      />

      <Panel
        title="分组清单"
        note="保存后目录快照与报价缓存同时失效；只刷新其中一个会出现「展示按新倍率、扣费按旧倍率」。"
      >
        {loading && rows.length === 0 ? (
          <AdminListLoading />
        ) : (
          <>
            {error && <AdminStaleError error={error} onRetry={() => void reload()} />}
            <AdminDataTable<UserGroupView>
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              loading={loading}
              error={rows.length === 0 ? error : null}
              onRetry={() => void reload()}
              emptyText="没有分组。默认分组由系统维护，通常无需手工创建。"
              minWidth={1020}
            />
          </>
        )}
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={700}
        title={editing ? `编辑分组 · ${editing.name}` : '新建用户分组'}
        description={formDirty ? '有未保存修改' : editing ? '编码创建后不可修改' : '编码用于会员套餐映射'}
        footer={
          <>
            <Button variant="secondary" size="small" onClick={requestCloseForm} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" size="small" disabled={saving || !writable} onClick={() => void submit()}>
              {saving ? '保存中…' : editing ? '保存修改' : '创建'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="编码" hint={editing ? '不可修改' : '小写字母 / 数字 / _ / -'}>
              <TextInput
                ariaLabel="分组编码"
                value={draft.code}
                onChange={(value) => patchDraft({ code: value })}
                placeholder="default"
                disabled={!!editing?.isDefault}
                maxLength={40}
              />
            </Field>
            <Field label="名称">
              <TextInput
                ariaLabel="分组名称"
                value={draft.name}
                onChange={(value) => patchDraft({ name: value })}
                placeholder="普通用户"
                maxLength={40}
              />
            </Field>
            <Field label="排序值">
              <NumberInput
                ariaLabel="排序值"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => patchDraft({ sortOrder: String(value ?? 0) })}
              />
            </Field>
          </div>

          <Field label="描述">
            <TextArea
              ariaLabel="分组描述"
              value={draft.description}
              onChange={(value) => patchDraft({ description: value })}
              rows={2}
              maxLength={200}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="徽标文字" hint="用户侧展示，如「VIP」">
              <TextInput
                ariaLabel="徽标文字"
                value={draft.badgeLabel}
                onChange={(value) => patchDraft({ badgeLabel: value })}
                placeholder="VIP"
                maxLength={16}
              />
            </Field>
            <Field label="徽标样式">
              <SelectBox
                ariaLabel="徽标样式"
                value={draft.badgeStyle}
                options={BADGE_STYLE_OPTIONS}
                onChange={(value) => patchDraft({ badgeStyle: value ?? 'none' })}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-border-table p-3">
            <div className="mb-2 text-xs font-semibold text-text-primary">价格</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="倍率（%）" hint="100 = 原价；50 = 五折">
                <TextInput
                  ariaLabel="倍率"
                  inputMode="numeric"
                  value={draft.ratioPercent}
                  onChange={(value) => patchDraft({ ratioPercent: value })}
                />
              </Field>
              <Field label="1 USD = 积分">
                <TextInput
                  ariaLabel="美元点数汇率"
                  inputMode="decimal"
                  value={draft.pointsPerUsd}
                  onChange={(value) => patchDraft({ pointsPerUsd: value })}
                />
              </Field>
              <Field label="1 CNY = 积分">
                <TextInput
                  ariaLabel="人民币点数汇率"
                  inputMode="decimal"
                  value={draft.pointsPerCny}
                  onChange={(value) => patchDraft({ pointsPerCny: value })}
                />
              </Field>
            </div>
          </div>

          <div className="rounded-lg border border-border-table p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-text-primary">可见渠道</div>
                <div className="text-[11px] text-text-tertiary">不在可见范围内的渠道，其模型不会出现在该分组的目录里</div>
              </div>
              <SwitchBox
                checked={draft.allChannels}
                label="全部渠道"
                ariaLabel="全部渠道可见"
                onChange={(checked) => patchDraft({ allChannels: checked })}
              />
            </div>
            {!draft.allChannels && (
              <div className="grid grid-cols-2 gap-2">
                {channels.length === 0 ? (
                  <p className="text-[11px] text-text-tertiary">尚无渠道可勾选</p>
                ) : (
                  channels.map((channel) => (
                    <CheckBox
                      key={channel.id}
                      checked={draft.channelIds.includes(channel.id)}
                      label={channel.name}
                      onChange={() => toggleChannel(channel.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-table p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-text-primary">按模型覆盖</div>
                <div className="text-[11px] text-text-tertiary">按前台模型编码覆盖倍率与汇率；未命中时用分组默认值</div>
              </div>
              <Button variant="secondary" size="xs" leadingIcon={Plus} disabled={!writable} onClick={addOverride}>
                添加覆盖
              </Button>
            </div>
            {draft.overrides.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-text-tertiary">没有覆盖项</p>
            ) : (
              <div className="flex flex-col gap-2">
                {draft.overrides.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_70px_90px_90px_32px] items-end gap-2">
                    <TextInput
                      ariaLabel="模型编码"
                      value={item.modelKey}
                      onChange={(value) => updateOverride(index, { modelKey: value })}
                      placeholder="ecom-image-pro"
                    />
                    <TextInput
                      ariaLabel="覆盖倍率"
                      inputMode="numeric"
                      value={item.ratioPercent}
                      onChange={(value) => updateOverride(index, { ratioPercent: value })}
                    />
                    <TextInput
                      ariaLabel="覆盖美元汇率"
                      inputMode="decimal"
                      value={item.pointsPerUsd}
                      onChange={(value) => updateOverride(index, { pointsPerUsd: value })}
                    />
                    <TextInput
                      ariaLabel="覆盖人民币汇率"
                      inputMode="decimal"
                      value={item.pointsPerCny}
                      onChange={(value) => updateOverride(index, { pointsPerCny: value })}
                    />
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      leadingIcon={Trash2}
                      aria-label="删除覆盖"
                      onClick={() => removeOverride(index)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {editing?.isDefault && (
            <Notice tone="info" title="默认分组">
              没有有效会员的用户都会落在默认分组；它的编码不可修改，也不允许删除。
            </Notice>
          )}

          <Field label="变更原因" hint="写入审计">
            <TextInput
              ariaLabel="变更原因"
              value={draft.reason}
              onChange={(value) => patchDraft({ reason: value })}
              placeholder="如：会员权益调整"
              maxLength={200}
            />
          </Field>
        </div>
      </Drawer>

      <ConfirmAction
        open={deleteTarget !== null}
        title={`删除分组「${deleteTarget?.name ?? ''}」？`}
        description="删除为软删除；会员套餐若仍映射到该编码，需要先改套餐。"
        impact={[
          `该分组当前有 ${deleteTarget?.userCount ?? 0} 名有效会员`,
          '引用该编码的会员套餐会失去对应分组配置',
        ]}
        danger
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
      />
    </>
  );
}
