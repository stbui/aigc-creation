import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminChannelModelsApi, adminChannelsApi, adminLogicalModelsApi } from './api';
import { ActionButton, FilterBar, PageHeader, Panel, SkeletonBody, StaleError, SwitchField } from '~/admin-ui/primitives';
import { useAdmin, useAdminResource, useCapabilities, useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import {
  EMPTY_DRAFT,
  type ModelDraft,
  type RouteDraft,
} from './constants';
import { parseCredits, toDraft } from './utils';
import { LogicalModelTable } from './LogicalModelTable';
import { ModelFormDrawer } from './ModelFormDrawer';
import { RouteSimulateDrawer } from './RouteSimulateDrawer';
import { ArchiveConfirm } from './ArchiveConfirm';
import type {
  AdminChannelModelView,
  AdminLogicalModelView,
  ChannelOrderItemView,
} from '../../../types/model';

/**
 * 前台模型（`/admin/logical-models`）。
 *
 * 「前台模型」是用户看到的产品：名称、图标、价格、能力合同。它不直连上游，
 * 而是通过**线路**指向渠道模型 —— 只换供应不改产品就靠这一层。
 *
 * 表单是**全量提交**（PATCH 语义与参考实现一致）：保存会新建 revision 并重建
 * 线路，未填字段按默认值落库，不做「只改一个字段」的局部更新。
 *
 * ## 模块划分
 *
 * 清单、表单抽屉、路由模拟、归档确认各自独立；本文件保留数据装配与写操作编排。
 */
export function AdminLogicalModelsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const writable = can('logical_model.write');
  const capabilities = useCapabilities();

  const [includeArchived, setIncludeArchived] = useState(false);
  const { data, loading, error, reload } = useAdminResource(
    () => adminLogicalModelsApi.list(includeArchived),
    [includeArchived],
  );
  const rows = data ?? [];

  const [channelModels, setChannelModels] = useState<AdminChannelModelView[]>([]);
  const [channels, setChannels] = useState<ChannelOrderItemView[]>([]);
  useEffect(() => {
    // 线路选择器需要「渠道名 / 模型名」；任一请求失败不阻塞列表
    void adminChannelModelsApi
      .list()
      .then((res) => setChannelModels(res.models))
      .catch(() => undefined);
    void adminChannelsApi.order().then((res) => setChannels(res.items)).catch(() => undefined);
  }, []);

  const channelNameById = useMemo(
    () => new Map(channels.map((item) => [item.id, item.name])),
    [channels],
  );
  const channelModelLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of channelModels) {
      const channel = channelNameById.get(model.channelId) ?? model.channelId;
      map.set(model.id, `${channel} / ${model.displayName || model.modelKey}`);
    }
    return map;
  }, [channelModels, channelNameById]);

  const capabilityOptions = useMemo(
    () =>
      (capabilities.data?.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.name}（${item.id}）`,
      })),
    [capabilities.data],
  );

  const channelModelOptions = useMemo(
    () =>
      channelModels.map((model) => ({
        value: model.id,
        label: `${channelModelLabel.get(model.id) ?? model.id}${model.enabled ? '' : '（停用）'}`,
      })),
    [channelModels, channelModelLabel],
  );

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminLogicalModelView | null>(null);
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_DRAFT);
  const [draftBase, setDraftBase] = useState<ModelDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AdminLogicalModelView | null>(null);
  const [simulateFor, setSimulateFor] = useState<AdminLogicalModelView | null>(null);

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

  const openEdit = (model: AdminLogicalModelView) => {
    const next = toDraft(model);
    setDraft(next);
    setDraftBase(next);
    setEditing(model);
    setCreating(false);
  };

  const patchDraft = (patch: Partial<ModelDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const addRoute = () =>
    patchDraft({
      routes: [
        ...draft.routes,
        {
          key: `new-${Date.now()}-${draft.routes.length}`,
          channelModelId: '',
          enabled: true,
          priority: '100',
          weight: '100',
        },
      ],
    });

  const updateRoute = (key: string, patch: Partial<RouteDraft>) =>
    patchDraft({
      routes: draft.routes.map((route) => (route.key === key ? { ...route, ...patch } : route)),
    });

  const removeRoute = (key: string) =>
    patchDraft({ routes: draft.routes.filter((route) => route.key !== key) });

  const submit = async () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(code)) {
      toast.error('编码只能使用小写字母、数字、点、下划线或连字符，2–80 位');
      return;
    }
    if (!name) {
      toast.error('请填写模型名称');
      return;
    }
    if (!draft.capability) {
      toast.error('请选择 C 端能力');
      return;
    }
    const prices = {
      unitPriceMicrocredits: parseCredits(draft.unitPrice),
      inputPriceMicrocredits: parseCredits(draft.inputPrice),
      outputPriceMicrocredits: parseCredits(draft.outputPrice),
      cachedPriceMicrocredits: parseCredits(draft.cachedPrice),
    };
    if (Object.values(prices).some((value) => value === null)) {
      toast.error('价格必须是「积分」数字，最多 6 位小数');
      return;
    }
    let capabilitySpec: unknown;
    let defaultOptions: unknown;
    try {
      capabilitySpec = JSON.parse(draft.capabilitySpecText || '{}');
    } catch {
      toast.error('能力合同不是合法 JSON');
      return;
    }
    try {
      defaultOptions = JSON.parse(draft.defaultOptionsText || '{}');
      if (
        defaultOptions === null ||
        typeof defaultOptions !== 'object' ||
        Array.isArray(defaultOptions)
      ) {
        throw new Error('not object');
      }
    } catch {
      toast.error('默认参数必须是 JSON 对象');
      return;
    }
    const routes = draft.routes
      .filter((route) => route.channelModelId)
      .map((route) => ({
        channelModelId: route.channelModelId,
        enabled: route.enabled,
        priority: Number(route.priority) || 0,
        weight: Number(route.weight) || 0,
      }));
    if (routes.length !== draft.routes.length) {
      toast.error('有线路尚未选择渠道模型');
      return;
    }

    const body: Record<string, unknown> = {
      code,
      name,
      icon: draft.icon.trim(),
      description: draft.description.trim(),
      capability: draft.capability,
      enabled: draft.enabled,
      sortOrder: Number(draft.sortOrder) || 0,
      pricePolicy: draft.pricePolicy,
      billingMode: draft.billingMode,
      ...prices,
      capabilitySpec,
      defaultOptions,
      routes,
    };

    setSaving(true);
    try {
      if (editing) {
        await adminLogicalModelsApi.update(editing.id, body);
        toast.success('已保存：新 revision 已生成，旧 revision 保留供账单回溯');
      } else {
        await adminLogicalModelsApi.create(body);
        toast.success('前台模型已创建，请确认线路可用后再启用');
      }
      resetForm();
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runArchive = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await adminLogicalModelsApi.archive(archiveTarget.id);
      toast.success(`已归档「${archiveTarget.name}」，历史账单与调用记录仍可回溯`);
      setArchiveTarget(null);
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '归档失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="前台模型"
        description="用户看到的产品：名称、图标、价格与能力合同。模型经「线路」指向渠道模型，只换供应不改产品。"
        actions={
          <ActionButton
            variant="default"
            size="sm"
            icon={Plus}
            disabled={!writable}
            onClick={openCreate}
          >
            新建前台模型
          </ActionButton>
        }
      />

      <FilterBar>
        <SwitchField
          checked={includeArchived}
          label="显示已归档"
          ariaLabel="显示已归档"
          onChange={setIncludeArchived}
        />
      </FilterBar>

      <Panel
        title="模型清单"
        note="保存即生成新 revision 并重建线路；旧 revision 保留，历史账单可回溯到当时的能力合同。"
      >
        {loading && rows.length === 0 ? (
          /* 面板外壳已经是实的，只替内容行 */
          <SkeletonBody rows={4} />
        ) : (
          <>
            {error && <StaleError error={error} onRetry={() => void reload()} />}
            <LogicalModelTable
              rows={rows}
              loading={loading}
              error={error}
              writable={writable}
              onEdit={openEdit}
              onSimulate={setSimulateFor}
              onArchive={setArchiveTarget}
              onRetry={() => void reload()}
            />
          </>
        )}
      </Panel>

      <ModelFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        dirty={formDirty}
        saving={saving}
        writable={writable}
        capabilityOptions={capabilityOptions}
        channelModelOptions={channelModelOptions}
        onClose={requestCloseForm}
        onChange={patchDraft}
        onAddRoute={addRoute}
        onUpdateRoute={updateRoute}
        onRemoveRoute={removeRoute}
        onSave={() => void submit()}
      />

      {/* 按模型 id 重挂载，模拟抽屉内部状态随目标模型重新初始化 */}
      <RouteSimulateDrawer
        key={simulateFor?.id ?? 'none'}
        model={simulateFor}
        onClose={() => setSimulateFor(null)}
      />

      <ArchiveConfirm
        target={archiveTarget}
        saving={saving}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void runArchive()}
      />
    </>
  );
}
