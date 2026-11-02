import { useEffect, useMemo, useState } from 'react';
import { Archive, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { adminChannelModelsApi, adminChannelsApi, adminLogicalModelsApi } from '../../lib/api';
import { useCapabilities } from '../../hooks/useCapabilities';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import {
  ActionButton,
  AdminDataTable,
  ConfirmAction,
  Descriptions,
  Drawer,
  FilterBar,
  FormField,
  IconButton,
  Notice,
  NumberField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
  StatusTag,
  StaleError,
  SwitchField,
  TextAreaField,
  TextField,
  useAdminResource,
  type AdminColumn,
} from '../../admin-ui/primitives';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { parseCredits, toCreditsInput } from '../../lib/microcredits';
import type {
  AdminChannelModelView,
  AdminLogicalModelView,
  AdminLogicalRouteView,
  ChannelOrderItemView,
  SimulateResultView,
} from '../../types/model';

/**
 * 前台模型（`/admin/logical-models`）。
 *
 * 「前台模型」是用户看到的产品：名称、图标、价格、能力合同。它不直连上游，
 * 而是通过**线路**指向渠道模型 —— 只换供应不改产品就靠这一层。
 *
 * 表单是**全量提交**（PATCH 语义与参考实现一致）：保存会新建 revision 并重建
 * 线路，未填字段按默认值落库，不做「只改一个字段」的局部更新。
 */

const PRICE_POLICY_OPTIONS = [
  { value: 'unified', label: '统一价（按本页价格计费）' },
  { value: 'channel', label: '跟随渠道（按渠道模型价格档）' },
];

const BILLING_MODE_OPTIONS = [
  { value: 'fixed_request', label: '按次' },
  { value: 'per_second', label: '按时长（秒）' },
  { value: 'token', label: '按 Token 用量' },
];

const PRICE_POLICY_LABELS: Record<string, string> = {
  unified: '统一价',
  channel: '跟随渠道',
};

const BILLING_MODE_LABELS: Record<string, string> = {
  fixed_request: '按次',
  per_second: '按秒',
  token: '按 Token',
};

interface RouteDraft {
  key: string;
  channelModelId: string;
  enabled: boolean;
  priority: string;
  weight: string;
}

interface ModelDraft {
  code: string;
  name: string;
  icon: string;
  description: string;
  capability: string;
  sortOrder: string;
  enabled: boolean;
  pricePolicy: string;
  billingMode: string;
  unitPrice: string;
  inputPrice: string;
  outputPrice: string;
  cachedPrice: string;
  capabilitySpecText: string;
  defaultOptionsText: string;
  routes: RouteDraft[];
  reason: string;
}

function routeToDraft(route: AdminLogicalRouteView): RouteDraft {
  return {
    key: route.id,
    channelModelId: route.channelModelId,
    enabled: route.enabled,
    priority: String(route.priority),
    weight: String(route.weight),
  };
}

const EMPTY_DRAFT: ModelDraft = {
  code: '',
  name: '',
  icon: '',
  description: '',
  capability: '',
  sortOrder: '0',
  enabled: true,
  pricePolicy: 'channel',
  billingMode: 'fixed_request',
  unitPrice: '0',
  inputPrice: '0',
  outputPrice: '0',
  cachedPrice: '0',
  capabilitySpecText: '',
  defaultOptionsText: '{}',
  routes: [],
  reason: '',
};

function toDraft(model: AdminLogicalModelView): ModelDraft {
  return {
    code: model.code,
    name: model.name,
    icon: model.icon,
    description: model.description,
    capability: model.capability,
    sortOrder: String(model.sortOrder),
    enabled: model.enabled,
    pricePolicy: model.pricePolicy || 'channel',
    billingMode: model.billingMode || 'fixed_request',
    unitPrice: toCreditsInput(model.unitPriceMicrocredits),
    inputPrice: toCreditsInput(model.inputPriceMicrocredits),
    outputPrice: toCreditsInput(model.outputPriceMicrocredits),
    cachedPrice: toCreditsInput(model.cachedPriceMicrocredits),
    capabilitySpecText: JSON.stringify(model.capabilitySpec ?? {}, null, 2),
    defaultOptionsText: JSON.stringify(model.defaultOptions ?? {}, null, 2),
    routes: model.routes.map(routeToDraft),
    reason: '',
  };
}

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
  const [simulateOperation, setSimulateOperation] = useState('');
  const [simulateOptions, setSimulateOptions] = useState('{}');
  const [simulateResult, setSimulateResult] = useState<SimulateResultView | null>(null);
  const [simulating, setSimulating] = useState(false);

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

  const patchDraft = (patch: Partial<ModelDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

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
      if (defaultOptions === null || typeof defaultOptions !== 'object' || Array.isArray(defaultOptions)) {
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
      ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
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

  const openSimulate = (model: AdminLogicalModelView) => {
    setSimulateFor(model);
    setSimulateOperation(model.capabilitySpec?.operations?.[0] ?? '');
    setSimulateOptions(JSON.stringify(model.defaultOptions ?? {}, null, 2));
    setSimulateResult(null);
  };

  const runSimulate = async () => {
    if (!simulateFor) return;
    let options: unknown;
    try {
      options = JSON.parse(simulateOptions || '{}');
    } catch {
      toast.error('参数不是合法 JSON');
      return;
    }
    setSimulating(true);
    try {
      const result = await adminLogicalModelsApi.simulate(simulateFor.id, {
        // 意图的 capability 是**模态**（image / video），不是产品能力 id
        // （expand / main_image）。后端缺省时按模型自己的能力合同取，
        // 这里不传 —— 传产品 id 会让后端拒绝（命名空间不同）。
        operation: simulateOperation.trim() || undefined,
        options: options as Record<string, unknown>,
      });
      setSimulateResult(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '模拟失败');
    } finally {
      setSimulating(false);
    }
  };

  const columns: Array<AdminColumn<AdminLogicalModelView>> = [
    {
      key: 'name',
      title: '前台模型',
      width: 240,
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {row.icon && <span aria-hidden>{row.icon}</span>}
            <span className="truncate font-medium text-foreground">{row.name}</span>
            {row.archivedAt && <StatusTag status="archived" tone="muted" label="已归档" />}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{row.code}</div>
        </div>
      ),
    },
    {
      key: 'capability',
      title: '能力',
      width: 140,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[11px]">
          <span className="text-foreground">{row.capabilitySpec?.capability || '—'}</span>
          <span className="text-muted-foreground">{row.capability}</span>
        </div>
      ),
    },
    {
      key: 'price',
      title: '价格',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[11px]">
          <span className="text-foreground">
            {PRICE_POLICY_LABELS[row.pricePolicy] ?? row.pricePolicy} ·{' '}
            {BILLING_MODE_LABELS[row.billingMode] ?? row.billingMode}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {row.displayPrice === null ? '按渠道价格档' : `${row.displayPrice} 积分`}
            {row.priceTiers.length > 1 ? ` · ${row.priceTiers.length} 档` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'routes',
      title: '线路',
      width: 120,
      render: (row) => {
        const available = row.routes.filter((route) => route.available).length;
        return (
          <div className="flex flex-col gap-0.5 text-[11px]">
            <span className="tabular-nums text-foreground">
              {available} / {row.routes.length} 可用
            </span>
            {row.routes.length > 0 && (
              <span className="truncate text-muted-foreground" title={row.routes.map((r) => `${r.channelName} / ${r.channelModelName}`).join('、')}>
                {row.routes[0].channelName} / {row.routes[0].channelModelName}
                {row.routes.length > 1 ? ' 等' : ''}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 150,
      render: (row) => (
        <div className="flex flex-col gap-1">
          {row.enabled ? (
            <StatusTag status="enabled" tone="success" label="已上架" />
          ) : (
            <StatusTag status="disabled" tone="muted" label="未上架" />
          )}
          {row.available ? (
            <StatusTag status="available" tone="success" label="路由可用" />
          ) : (
            <StatusTag
              status="unavailable"
              tone="danger"
              label={row.configurationError ? '配置错误' : '路由不可用'}
            />
          )}
        </div>
      ),
    },
    {
      key: 'revision',
      title: 'Revision',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums text-muted-foreground">v{row.revisionVersion}</span>,
    },
    {
      key: 'ops',
      title: '操作',
      width: 240,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="xs" disabled={!writable || !!row.archivedAt} onClick={() => openEdit(row)}>
            编辑
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={FlaskConical}
            onClick={() => openSimulate(row)}
          >
            模拟
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Archive}
            disabled={!writable || !!row.archivedAt}
            onClick={() => setArchiveTarget(row)}
          >
            归档
          </ActionButton>
        </div>
      ),
    },
  ];

  const unavailableReasons = editing
    ? [editing.configurationError, editing.availabilityError].filter(Boolean)
    : [];

  return (
    <>
      <PageHeader
        title="前台模型"
        description="用户看到的产品：名称、图标、价格与能力合同。模型经「线路」指向渠道模型，只换供应不改产品。"
        actions={
          <ActionButton variant="default" size="sm" icon={Plus} disabled={!writable} onClick={openCreate}>
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
          <div className="flex flex-col gap-2 py-2">
            <Skeleton rows={4} />
            <p className="text-center text-xs text-muted-foreground">加载中…</p>
          </div>
        ) : (
          <>
            {error && <StaleError error={error} onRetry={() => void reload()} />}
            <AdminDataTable<AdminLogicalModelView>
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              loading={loading}
              error={rows.length === 0 ? error : null}
              onRetry={() => void reload()}
              emptyText="还没有前台模型。先在「渠道工作台」配置渠道与模型，再在这里把能力暴露给用户。"
              minWidth={1120}
            />
          </>
        )}
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={760}
        title={editing ? `编辑 · ${editing.name}` : '新建前台模型'}
        description={
          formDirty ? '有未保存修改' : '全量提交：未填字段按默认值落库，保存后生成新 revision'
        }
        footer={
          <>
            <ActionButton variant="secondary" size="sm" onClick={requestCloseForm} disabled={saving}>
              取消
            </ActionButton>
            <ActionButton variant="default" size="sm" disabled={saving || !writable} onClick={() => void submit()}>
              {saving ? '保存中…' : editing ? '保存（新 revision）' : '创建'}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {unavailableReasons.length > 0 && (
            <Notice tone="warn" title="当前模型不可用">
              <ul className="mt-1 list-disc pl-4">
                {unavailableReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Notice>
          )}

          <div className="grid grid-cols-3 gap-3">
            <FormField label="编码" hint={editing ? '创建后不可修改' : '小写字母 / 数字 / . _ -'}>
              <TextField
                ariaLabel="编码"
                value={draft.code}
                onChange={(value) => patchDraft({ code: value })}
                placeholder="ecom-image-pro"
                disabled={!!editing}
                maxLength={80}
              />
            </FormField>
            <FormField label="名称">
              <TextField
                ariaLabel="名称"
                value={draft.name}
                onChange={(value) => patchDraft({ name: value })}
                placeholder="电商主图 Pro"
                maxLength={60}
              />
            </FormField>
            <FormField label="图标" hint="emoji 或短字符">
              <TextField
                ariaLabel="图标"
                value={draft.icon}
                onChange={(value) => patchDraft({ icon: value })}
                placeholder="🎨"
                maxLength={8}
              />
            </FormField>
          </div>

          <FormField label="描述" hint="面向用户展示的一句话说明">
            <TextAreaField
              ariaLabel="描述"
              value={draft.description}
              onChange={(value) => patchDraft({ description: value })}
              rows={2}
              maxLength={200}
              placeholder="高质量商品主图生成，支持多尺寸"
            />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="C 端能力" hint="准入按这个 id 选模型">
              <SelectField
                ariaLabel="C 端能力"
                value={draft.capability || undefined}
                options={capabilityOptions}
                onChange={(value) => patchDraft({ capability: value ?? '' })}
                placeholder="选择能力"
              />
            </FormField>
            <FormField label="排序值" hint="数字越小越靠前">
              <NumberField
                ariaLabel="排序值"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => patchDraft({ sortOrder: String(value ?? 0) })}
              />
            </FormField>
            <FormField label="上架">
              <div className="flex h-8 items-center">
                <SwitchField
                  checked={draft.enabled}
                  label="对用户可见"
                  ariaLabel="上架"
                  onChange={(checked) => patchDraft({ enabled: checked })}
                />
              </div>
            </FormField>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">计费</div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="价格策略" hint="「跟随渠道」按渠道模型的价格档计费">
                <SelectField
                  ariaLabel="价格策略"
                  value={draft.pricePolicy}
                  options={PRICE_POLICY_OPTIONS}
                  onChange={(value) => patchDraft({ pricePolicy: value ?? 'channel' })}
                />
              </FormField>
              <FormField label="计费方式">
                <SelectField
                  ariaLabel="计费方式"
                  value={draft.billingMode}
                  options={BILLING_MODE_OPTIONS}
                  onChange={(value) => patchDraft({ billingMode: value ?? 'fixed_request' })}
                />
              </FormField>
            </div>
            {draft.pricePolicy === 'unified' && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                <FormField label="单价（积分）">
                  <TextField
                    ariaLabel="单价"
                    inputMode="decimal"
                    value={draft.unitPrice}
                    onChange={(value) => patchDraft({ unitPrice: value })}
                  />
                </FormField>
                <FormField label="输入 Token 价">
                  <TextField
                    ariaLabel="输入 Token 价"
                    inputMode="decimal"
                    value={draft.inputPrice}
                    onChange={(value) => patchDraft({ inputPrice: value })}
                  />
                </FormField>
                <FormField label="输出 Token 价">
                  <TextField
                    ariaLabel="输出 Token 价"
                    inputMode="decimal"
                    value={draft.outputPrice}
                    onChange={(value) => patchDraft({ outputPrice: value })}
                  />
                </FormField>
                <FormField label="缓存 Token 价">
                  <TextField
                    ariaLabel="缓存 Token 价"
                    inputMode="decimal"
                    value={draft.cachedPrice}
                    onChange={(value) => patchDraft({ cachedPrice: value })}
                  />
                </FormField>
              </div>
            )}
          </div>

          <FormField
            label="能力合同（capabilitySpec）"
            hint="声明本模型接受的 input / operation / 参数范围；线路按它做匹配，写错会让模型选不到线路"
          >
            <TextAreaField
              ariaLabel="能力合同"
              value={draft.capabilitySpecText}
              onChange={(value) => patchDraft({ capabilitySpecText: value })}
              rows={8}
              placeholder='{"version": 1, "capability": "image", "operations": ["generate"]}'
            />
          </FormField>

          <FormField label="默认参数" hint="用户未显式给出时使用的默认值（JSON 对象）">
            <TextAreaField
              ariaLabel="默认参数"
              value={draft.defaultOptionsText}
              onChange={(value) => patchDraft({ defaultOptionsText: value })}
              rows={4}
            />
          </FormField>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-foreground">线路</div>
                <div className="text-[11px] text-muted-foreground">
                  同一 priority 内按 weight 随机；priority 更小的层先被尝试
                </div>
              </div>
              <ActionButton variant="secondary" size="xs" icon={Plus} disabled={!writable} onClick={addRoute}>
                添加线路
              </ActionButton>
            </div>
            {draft.routes.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-muted-foreground">
                没有线路时模型永远不可用（C 端会收到 42204）。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {draft.routes.map((route) => (
                  <div key={route.key} className="grid grid-cols-[1fr_64px_64px_72px_32px] items-end gap-2">
                    <SelectField
                      ariaLabel="线路渠道模型"
                      value={route.channelModelId || undefined}
                      options={channelModelOptions}
                      onChange={(value) => updateRoute(route.key, { channelModelId: value ?? '' })}
                      placeholder="选择渠道模型"
                    />
                    <NumberField
                      ariaLabel="优先级"
                      value={Number(route.priority) || 0}
                      min={0}
                      onChange={(value) => updateRoute(route.key, { priority: String(value ?? 0) })}
                    />
                    <NumberField
                      ariaLabel="权重"
                      value={Number(route.weight) || 0}
                      min={0}
                      onChange={(value) => updateRoute(route.key, { weight: String(value ?? 0) })}
                    />
                    <SwitchField
                      checked={route.enabled}
                      label="启用"
                      ariaLabel="线路启用"
                      onChange={(checked) => updateRoute(route.key, { enabled: checked })}
                    />
                    <IconButton
                      icon={Trash2}
                      label="删除线路"
                      size="xs"
                      onClick={() => removeRoute(route.key)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <FormField label="变更原因" hint="写入审计">
            <TextField
              ariaLabel="变更原因"
              value={draft.reason}
              onChange={(value) => patchDraft({ reason: value })}
              placeholder="如：新增备用线路"
              maxLength={200}
            />
          </FormField>
        </div>
      </Drawer>

      <Drawer
        open={simulateFor !== null}
        onOpenChange={(open) => {
          if (!open) setSimulateFor(null);
        }}
        width={720}
        title={`路由模拟 · ${simulateFor?.name ?? ''}`}
        description="只读：按给定参数算一遍「会落到哪条线路、为什么没落」，不扣费、不建任务"
        footer={
          <>
            <ActionButton variant="secondary" size="sm" onClick={() => setSimulateFor(null)}>
              关闭
            </ActionButton>
            <ActionButton variant="default" size="sm" disabled={simulating} onClick={() => void runSimulate()}>
              {simulating ? '模拟中…' : '开始模拟'}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label="操作（operation）" hint="留空则用能力合同里的第一个操作">
            <TextField
              ariaLabel="操作"
              value={simulateOperation}
              onChange={setSimulateOperation}
              placeholder="generate"
            />
          </FormField>
          <FormField label="请求参数（options）" hint="JSON 对象；尺寸、数量等影响价格档的选择">
            <TextAreaField ariaLabel="请求参数" value={simulateOptions} onChange={setSimulateOptions} rows={6} />
          </FormField>

          {simulateResult && (
            <div className="flex flex-col gap-3">
              <Descriptions
                items={[
                  { label: '候选线路', value: String(simulateResult.candidates) },
                  {
                    label: '选中线路',
                    value:
                      simulateResult.routes.find((route) => route.selectedTier)?.channelModelKey ||
                      simulateResult.selectedRouteId ||
                      '无',
                  },
                  { label: '结论', value: simulateResult.reason || '—' },
                ]}
                columns={2}
              />
              <div className="rounded-lg border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">线路</th>
                      <th className="px-2 py-1.5 text-right">优先级</th>
                      <th className="px-2 py-1.5 text-right">权重</th>
                      <th className="px-2 py-1.5 text-left">价格档</th>
                      <th className="px-2 py-1.5 text-left">结论</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulateResult.routes.map((route) => (
                      <tr key={`${route.routeId}-${route.priceTierId}`} className="border-t border-border">
                        <td className="px-2 py-1.5 font-mono">{route.channelModelKey || route.channelModelId}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{route.priority}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{route.weight}</td>
                        <td className="px-2 py-1.5">{route.priceTierId || '—'}</td>
                        <td className="px-2 py-1.5">
                          {route.eligible ? (
                            <StatusTag status="ok" tone="success" label="可命中" />
                          ) : (
                            <span className="text-muted-foreground">{route.matchReasons.join('；') || '未命中'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmAction
        open={archiveTarget !== null}
        title={`归档前台模型「${archiveTarget?.name ?? ''}」？`}
        description="归档后不再出现在 C 端目录，历史 revision 与线路保留供账单回溯。"
        impact={[
          `当前 ${archiveTarget?.routes.length ?? 0} 条线路随模型一起退出路由`,
          '已在进行中的任务不受影响，完成后按各自快照结算',
        ]}
        danger
        loading={saving}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void runArchive()}
      />
    </>
  );
}
