import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminChannelsApi, adminUserGroupsApi } from './api';
import {
  ActionButton,
  ConfirmAction,
  PageHeader,
  Panel,
  SkeletonBody,
  StaleError,
} from './components';
import {
  useAdmin,
  useAdminResource,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { EMPTY_DRAFT, type GroupDraft, type OverrideDraft } from './constants';
import { buildGroupPayload, toDraft } from './utils';
import { UserGroupTable } from './UserGroupTable';
import { UserGroupFormDrawer } from './UserGroupFormDrawer';
import type { ChannelOrderItemView, UserGroupView } from '../../../types/model';

/**
 * 用户分组（`/admin/user-groups`）。
 *
 * 分组决定三件事：倍率（同一次调用扣多少）、可见渠道、按模型的覆盖价格。
 * 本仓没有 `users.user_group` 列 —— 分组由会员套餐映射而来，没有有效会员的
 * 用户落在默认分组 `default`，所以「默认分组」不允许删除。
 *
 * `code` 创建后不可改：会员套餐按编码映射分组，改编码等于把存量会员整体换组。
 *
 * ## 模块划分
 *
 * 列表与表单抽屉各自独立；本文件只保留取数、草稿状态与写操作编排。
 */
export function AdminUserGroupsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const writable = can('user_group.write');

  const { data, loading, error, reload } = useAdminResource(() => adminUserGroupsApi.list());
  const rows = data ?? [];

  const [channels, setChannels] = useState<ChannelOrderItemView[]>([]);
  useEffect(() => {
    void adminChannelsApi.order().then((res) => setChannels(res.items)).catch(() => undefined);
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
    const payload = buildGroupPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await adminUserGroupsApi.update(editing.id, payload.body);
        toast.success('分组已保存；目录快照与报价缓存已同时失效');
      } else {
        await adminUserGroupsApi.create(payload.body);
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

  return (
    <>
      <PageHeader
        title="用户分组"
        description="决定倍率、可见渠道与按模型的覆盖价格。分组由会员套餐映射，没有有效会员的用户落在默认分组。"
        actions={
          <ActionButton variant="default" size="sm" icon={Plus} disabled={!writable} onClick={openCreate}>
            新建分组
          </ActionButton>
        }
      />

      <Panel
        title="分组清单"
        note="保存后目录快照与报价缓存同时失效；只刷新其中一个会出现「展示按新倍率、扣费按旧倍率」。"
      >
        {loading && rows.length === 0 ? (
          /* 面板外壳已经是实的，只替内容行 */
          <SkeletonBody rows={4} />
        ) : (
          <>
            {error && <StaleError error={error} onRetry={() => void reload()} />}
            <UserGroupTable
              rows={rows}
              loading={loading}
              error={error}
              onRetry={() => void reload()}
              writable={writable}
              channels={channels}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          </>
        )}
      </Panel>

      <UserGroupFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        formDirty={formDirty}
        saving={saving}
        writable={writable}
        channels={channels}
        onPatch={patchDraft}
        onToggleChannel={toggleChannel}
        onAddOverride={addOverride}
        onUpdateOverride={updateOverride}
        onRemoveOverride={removeOverride}
        onClose={requestCloseForm}
        onSubmit={() => void submit()}
      />

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
