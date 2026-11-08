import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { adminCapabilitiesApi, adminChannelModelsApi, adminChannelsApi, adminLogicalModelsApi } from './api';
import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  ConfirmDialog,
  EmptyState,
  FilterActions,
  FilterBar,
  ListError,
  Notice,
  PageHeader,
  Panel,
  RefreshButton,
  SegmentedTabs,
  SelectField,
  SkeletonCards,
  SwitchField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminResource,
  useAdminUrlFilterSync,
  useCapabilities,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import {
  EMPTY_DRAFT,
  type ModelDraft,
  type RouteDraft,
} from './constants';
import { defaultCapabilitySpecFor, parseCredits, toDraft } from './utils';
import { LogicalModelTable } from './LogicalModelTable';
import { ModelFormDrawer } from './ModelFormDrawer';
import { RouteSimulateDrawer } from './RouteSimulateDrawer';
import { ArchiveConfirm } from './ArchiveConfirm';
import { CapabilityModelCard } from './CapabilityModelCard';
import { CapabilityPricingPanel } from './CapabilityPricingPanel';
import {
  buildCapabilityWorkspace,
  filterCapabilityWorkspace,
  type CapabilityWorkspaceItem,
} from './workspace';
import type { AdminCapabilityControl } from '../../../types/api';
import type {
  AdminChannelModelView,
  AdminLogicalModelView,
  ChannelOrderItemView,
} from '../../../types/model';
import { RUNTIME_LABELS } from '../../../lib/constants';

/** 下线原因由页面自动生成：既作为 C 端提示，也作为审计留痕。 */
const OFFLINE_REASON = '该能力已暂时下线，请稍后再试';

type CapabilityTab = 'capabilities' | 'pricing';

/**
 * 能力与模型（`/admin/capabilities`）。
 *
 * 以「能力」为主实体，把能力上下线与所属前台模型放在同一工作台：
 * 运营先判断能力此刻是否可收单，再下钻到模型、价格与线路。能力状态和模型
 * 配置是两个独立写操作，分别受 `capability.write` / `logical_model.write`
 * 控制，不使用一个混合保存按钮。
 *
 * 旧地址 `/admin/logical-models` 由后台外壳重定向到这里；模型表单、路由模拟、
 * 归档确认仍复用前台模型目录中的现有组件，避免复制 CRUD 编排。
 */
export function AdminLogicalModelsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const capabilityReadable = can('capability.read');
  const capabilityWritable = can('capability.write');
  const modelReadable = can('logical_model.read');
  const modelWritable = can('logical_model.write');
  const pricingReadable = can('product.price');
  const capabilityWorkspaceReadable = capabilityReadable || modelReadable;
  const capabilityCatalog = useCapabilities();

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const requestedTab: CapabilityTab | null =
    rawTab === 'capabilities' || rawTab === 'pricing' ? rawTab : null;
  /*
   * 旧地址 `/admin/credit-prices` 会带 `?tab=pricing` 进来；默认页签不写 URL，
   * 保持 `/admin/capabilities` 与既有筛选深链的地址形态不变。
   * 只有 product.price 的用户直接落到定价，不让他先看到空的能力工作区。
   */
  const tab: CapabilityTab =
    requestedTab === 'pricing' && pricingReadable
      ? 'pricing'
      : requestedTab === 'capabilities' && capabilityWorkspaceReadable
        ? 'capabilities'
        : capabilityWorkspaceReadable
          ? 'capabilities'
          : 'pricing';

  const switchTab = (next: string) => {
    if (next !== 'capabilities' && next !== 'pricing') return;
    if (next === 'capabilities' && !capabilityWorkspaceReadable) return;
    if (next === 'pricing' && !pricingReadable) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'capabilities') params.delete('tab');
        else params.set('tab', 'pricing');
        return params;
      },
      { replace: true },
    );
  };
  const initialQ = searchParams.get('q') ?? '';
  const initialGroup = searchParams.get('group') ?? '';
  const rawRuntime = searchParams.get('runtime');
  const initialRuntime: 'remote' | 'disabled' | 'unavailable' | undefined =
    rawRuntime === 'remote' || rawRuntime === 'disabled' || rawRuntime === 'unavailable'
      ? rawRuntime
      : undefined;
  const [q, setQ] = useState(initialQ);
  const [group, setGroup] = useState(initialGroup);
  const [runtime, setRuntime] = useState<'remote' | 'disabled' | 'unavailable' | undefined>(
    initialRuntime,
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  useAdminUrlFilterSync({
    q: q.trim() || undefined,
    group: group || undefined,
    runtime,
  });

  const capabilityResource = useAdminResource(
    () =>
      capabilityReadable
        ? adminCapabilitiesApi.list()
        : Promise.resolve([] as AdminCapabilityControl[]),
    [capabilityReadable],
  );
  const modelResource = useAdminResource(
    () =>
      modelReadable
        ? adminLogicalModelsApi.list(includeArchived)
        : Promise.resolve([] as AdminLogicalModelView[]),
    [includeArchived, modelReadable],
  );

  const controls = capabilityResource.data ?? [];
  const models = modelResource.data ?? [];
  const definitions = capabilityCatalog.data?.items ?? [];
  const groupNames = useMemo(
    () =>
      new Map(
        (capabilityCatalog.data?.groups ?? []).map(
          (item) => [item.id, item.name] as const,
        ),
      ),
    [capabilityCatalog.data],
  );
  const workspace = useMemo(
    () => buildCapabilityWorkspace({ controls, definitions, models, groupNames }),
    [controls, definitions, groupNames, models],
  );
  const filteredWorkspace = useMemo(
    () => filterCapabilityWorkspace(workspace, { q, group, runtime }),
    [group, q, runtime, workspace],
  );

  const groupedItems = useMemo(() => {
    const groups = new Map<string, CapabilityWorkspaceItem[]>();
    for (const item of filteredWorkspace.items) {
      const list = groups.get(item.group);
      if (list) list.push(item);
      else groups.set(item.group, [item]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [filteredWorkspace.items]);

  const groupOptions = useMemo(
    () =>
      Array.from(new Set(workspace.items.map((item) => item.group)))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .map((value) => ({ value, label: value })),
    [workspace.items],
  );

  const capabilityOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of workspace.items) options.set(item.capabilityId, item.name);
    for (const definition of definitions) options.set(definition.id, definition.name);
    return Array.from(options, ([value, label]) => ({ value, label }));
  }, [definitions, workspace.items]);

  const [channelModels, setChannelModels] = useState<AdminChannelModelView[]>([]);
  const [channels, setChannels] = useState<ChannelOrderItemView[]>([]);
  useEffect(() => {
    if (!modelWritable) return;
    // 线路选择器需要「渠道名 / 模型名」；任一请求失败不阻塞列表
    void adminChannelModelsApi
      .list()
      .then((res) => setChannelModels(res.models))
      .catch(() => undefined);
    void adminChannelsApi.order().then((res) => setChannels(res.items)).catch(() => undefined);
  }, [modelWritable]);

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
  const [offlineTarget, setOfflineTarget] = useState<CapabilityWorkspaceItem | null>(null);
  const [capabilitySaving, setCapabilitySaving] = useState<string | null>(null);

  const formOpen = creating || editing !== null;
  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const resetForm = () => {
    setCreating(false);
    setEditing(null);
  };
  const requestCloseForm = useDiscardConfirm(formDirty, resetForm);

  const openCreate = (capabilityId = '') => {
    const next = { ...EMPTY_DRAFT, capability: capabilityId };
    setDraft(next);
    setDraftBase(next);
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

  const reloadWorkspace = async () => {
    await Promise.all([
      capabilityResource.reload({ silent: true }),
      modelResource.reload({ silent: true }),
    ]);
  };

  const submit = async () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(code)) {
      toast.error('模型编号需由 2–80 位小写字母、数字或连接符组成');
      return;
    }
    if (!name) {
      toast.error('请填写模型名称');
      return;
    }
    if (!draft.capability) {
      toast.error('请选择所属能力');
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
    if (draft.capabilitySpecText.trim()) {
      try {
        capabilitySpec = JSON.parse(draft.capabilitySpecText);
      } catch {
        toast.error('能力范围格式不正确');
        return;
      }
    } else {
      const definition = capabilityCatalog.data?.items.find(
        (item) => item.id === draft.capability,
      );
      capabilitySpec = defaultCapabilitySpecFor(definition);
      if (!capabilitySpec) {
        toast.error('请选择所属能力');
        return;
      }
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
      toast.error('默认选项格式不正确');
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
      toast.error('有服务来源尚未选择具体模型');
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
        toast.success('模型配置已保存');
      } else {
        await adminLogicalModelsApi.create(body);
        toast.success('前台模型已创建，请确认服务来源可用后再上架');
      }
      resetForm();
      await reloadWorkspace();
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
      await reloadWorkspace();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '归档失败');
    } finally {
      setSaving(false);
    }
  };

  const bringOnline = async (item: CapabilityWorkspaceItem) => {
    setCapabilitySaving(item.capabilityId);
    try {
      await adminCapabilitiesApi.set(item.capabilityId, true);
      toast.success(`${item.name} 已上线`);
      await capabilityResource.reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上线失败');
    } finally {
      setCapabilitySaving(null);
    }
  };

  const submitOffline = async () => {
    if (!offlineTarget) return;
    setCapabilitySaving(offlineTarget.capabilityId);
    try {
      await adminCapabilitiesApi.set(offlineTarget.capabilityId, false, OFFLINE_REASON);
      toast.success(`${offlineTarget.name} 已下线`);
      setOfflineTarget(null);
      await capabilityResource.reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下线失败');
    } finally {
      setCapabilitySaving(null);
    }
  };

  const handleToggleCapability = (item: CapabilityWorkspaceItem) => {
    if (item.enabled) setOfflineTarget(item);
    else void bringOnline(item);
  };

  const appliedFilters: AppliedFilter[] = [
    q.trim()
      ? {
          key: 'q',
          label: `关键词：${q.trim()}`,
          onClear: () => setQ(''),
        }
      : null,
    group
      ? {
          key: 'group',
          label: `分组：${group}`,
          onClear: () => setGroup(''),
        }
      : null,
    runtime
      ? {
          key: 'runtime',
          label: `运行结论：${RUNTIME_LABELS[runtime]}`,
          onClear: () => setRuntime(undefined),
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];
  const hasFilter = appliedFilters.length > 0;
  const resetFilters = () => {
    setQ('');
    setGroup('');
    setRuntime(undefined);
  };

  const workspaceLoading =
    capabilityResource.loading || modelResource.loading || capabilityCatalog.loading;
  const hasLoadedData =
    capabilityResource.data !== null ||
    modelResource.data !== null ||
    capabilityCatalog.data !== null;
  const modelDataReadable = modelReadable && modelResource.data !== null;
  const modelUnavailableReason = !modelReadable
    ? '当前账号无 logical_model.read 权限，模型与线路信息不可见。'
    : modelResource.error
      ? `模型清单加载失败：${modelResource.error}`
      : '模型清单加载中…';
  const filteredEmpty =
    filteredWorkspace.items.length === 0 && filteredWorkspace.orphans.length === 0;
  const fatalErrors = [capabilityResource.error, modelResource.error].filter(Boolean);
  const description =
    tab === 'pricing'
      ? '按能力维护运行时消耗价；改价、能力上下线与前台模型配置分别受独立权限控制。'
      : !capabilityReadable
        ? '当前账号可查看前台模型与线路，但没有 capability.read，能力运行状态不可见。'
        : !modelReadable
          ? '当前账号可查看能力状态并执行上下线，但没有 logical_model.read，模型与线路信息不可见。'
          : '以能力为单位管理上下线、前台模型与线路可用性；能力开关和模型配置分别保存。';

  const tabs: Array<{ value: CapabilityTab; label: string }> = [];
  if (capabilityWorkspaceReadable) tabs.push({ value: 'capabilities', label: '能力与模型' });
  if (pricingReadable) tabs.push({ value: 'pricing', label: '能力消耗价' });

  return (
    <>
      <PageHeader
        title={capabilityWorkspaceReadable ? '能力与模型' : '能力消耗价'}
        description={description}
        actions={
          tab === 'capabilities' && modelWritable ? (
            <ActionButton
              variant="default"
              size="sm"
              icon={Plus}
              onClick={() => openCreate()}
            >
              新建前台模型
            </ActionButton>
          ) : undefined
        }
      />

      {tabs.length > 1 && (
        <div className="mb-4">
          <SegmentedTabs
            value={tab}
            onChange={switchTab}
            options={tabs}
            ariaLabel="能力配置标签"
          />
        </div>
      )}

      {!capabilityWorkspaceReadable && !pricingReadable && (
        <Notice tone="locked" title="无权访问">
          当前账号缺少 capability.read、logical_model.read 与 product.price，无法查看此页面。
        </Notice>
      )}

      <div hidden={tab !== 'capabilities'}>
        <FilterBar>
          <ClearableField
            className="w-64"
            ariaLabel="搜索能力或模型"
            placeholder="能力 / 模型 / ID"
            value={q}
            onChange={setQ}
          />
          <SelectField
            className="w-40"
            ariaLabel="按分组筛选"
            placeholder="全部分组"
            allowClear
            clearLabel="全部分组"
            value={group || undefined}
            onChange={(value) => setGroup(value ?? '')}
            options={groupOptions}
          />
          <SelectField
            className="w-40"
            ariaLabel="按运行结论筛选"
            placeholder="全部运行结论"
            allowClear
            clearLabel="全部运行结论"
            value={runtime}
            onChange={(value) =>
              setRuntime(value as 'remote' | 'disabled' | 'unavailable' | undefined)
            }
            options={[
              { value: 'remote', label: RUNTIME_LABELS.remote },
              { value: 'disabled', label: RUNTIME_LABELS.disabled },
              { value: 'unavailable', label: RUNTIME_LABELS.unavailable },
            ]}
          />
          <SwitchField
            checked={includeArchived}
            label="显示已归档模型"
            ariaLabel="显示已归档模型"
            disabled={!modelReadable}
            onChange={setIncludeArchived}
          />
          <FilterActions>
            <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
              重置
            </ActionButton>
          </FilterActions>
          <AppliedFilters items={appliedFilters} onClearAll={resetFilters} />
        </FilterBar>

        {capabilityResource.error && capabilityResource.data !== null && (
          <Notice tone="warn" title="能力状态刷新失败">
            {capabilityResource.error}
          </Notice>
        )}
        {modelResource.error && modelResource.data !== null && (
          <Notice tone="warn" title="模型清单刷新失败">
            {modelResource.error}
          </Notice>
        )}
        {capabilityCatalog.error && (
          <Notice tone="warn" title="能力定义加载失败">
            {capabilityCatalog.error}。已有能力管控记录仍可展示，但新建模型时可能无法自动生成能力范围。
          </Notice>
        )}
        {!capabilityReadable && (
          <Notice tone="locked" title="能力状态只读">
            当前账号缺少 capability.read，能力状态与上下线操作不可见。
          </Notice>
        )}

        {workspaceLoading && !hasLoadedData ? (
          <SkeletonCards count={6} className="mt-0" />
        ) : fatalErrors.length > 0 && !hasLoadedData ? (
          <ListError
            error={fatalErrors.join('；')}
            onRetry={() => void reloadWorkspace()}
          />
        ) : filteredEmpty ? (
          <EmptyState
            title={hasFilter ? '没有符合当前筛选的能力或模型。' : '没有可管理的能力或模型。'}
            description={
              hasFilter
                ? '清除筛选或换个条件试试。'
                : '能力注册表为空且没有模型时才会出现。'
            }
            action={
              hasFilter ? (
                <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                  清除筛选
                </ActionButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span role="heading" aria-level={2} className="text-[13px] font-semibold text-foreground">能力与模型清单</span>
                <span className="text-[12px] text-muted-foreground">
                  {hasFilter
                    ? `筛选出 ${filteredWorkspace.items.length} / ${workspace.items.length} 项能力`
                    : `共 ${workspace.items.length} 项能力`}
                  {filteredWorkspace.orphans.length > 0
                    ? ` · ${filteredWorkspace.orphans.length} 个未归属模型`
                    : ''}
                </span>
              </div>
              <RefreshButton loading={workspaceLoading} onRefresh={() => void reloadWorkspace()} />
            </div>

            <div className="space-y-5">
              {groupedItems.map(([groupName, items]) => (
                <section key={groupName} aria-label={`${groupName} 分组`}>
                  <div className="mb-2.5 flex items-center gap-2">
                    <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                    <h2 className="text-[13px] font-semibold text-foreground">{groupName}</h2>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[12px] leading-4 text-muted-foreground">
                      {items.length}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(520px,1fr))]">
                    {items.map((item) => (
                      <CapabilityModelCard
                        key={item.capabilityId}
                        item={item}
                        modelsReadable={modelDataReadable}
                        modelsUnavailableReason={modelUnavailableReason}
                        capabilityWritable={capabilityWritable}
                        modelWritable={modelWritable}
                        capabilitySaving={capabilitySaving === item.capabilityId}
                        onToggleCapability={handleToggleCapability}
                        onCreateModel={openCreate}
                        onEditModel={openEdit}
                        onSimulateModel={setSimulateFor}
                        onArchiveModel={setArchiveTarget}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {filteredWorkspace.orphans.length > 0 && (
              <Panel title="未归属已知能力的模型" className="mt-4">
                <LogicalModelTable
                  rows={filteredWorkspace.orphans}
                  loading={modelResource.loading}
                  error={null}
                  writable={modelWritable}
                  onEdit={openEdit}
                  onSimulate={setSimulateFor}
                  onArchive={setArchiveTarget}
                  onRetry={() => void modelResource.reload()}
                />
              </Panel>
            )}
          </>
        )}
      </div>

      <div hidden={tab !== 'pricing'}>
        {pricingReadable && <CapabilityPricingPanel />}
      </div>

      <ModelFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        dirty={formDirty}
        saving={saving}
        writable={modelWritable}
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

      <ConfirmDialog
        open={!!offlineTarget}
        title={offlineTarget ? `下线「${offlineTarget.name}」` : ''}
        confirmText="确认下线"
        danger
        loading={capabilitySaving === offlineTarget?.capabilityId}
        onCancel={() => setOfflineTarget(null)}
        onConfirm={() => void submitOffline()}
        description={
          <p className="text-xs text-muted-foreground">
            下架后 C 端会看到统一提示「{OFFLINE_REASON}」，该能力立即停止提交。
            此操作会写入审计日志，不影响其它能力与模型线路。
          </p>
        }
        impact={['C 端停止提交该能力', 'C 端展示统一下线提示', '写操作审计（含操作人）']}
      />
    </>
  );
}
