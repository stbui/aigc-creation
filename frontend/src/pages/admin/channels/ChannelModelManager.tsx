import { useEffect, useMemo, useState } from 'react';
import { adminChannelsApi } from './api';
import { ConfirmAction, Notice, TextField } from './components';
import { useToast } from './hooks';
import { ChannelModelFormDialog } from './ChannelModelFormDialog';
import { ChannelModelRepriceDialog } from './ChannelModelRepriceDialog';
import { ChannelModelTable } from './ChannelModelTable';
import { ChannelOrderDialog } from './ChannelOrderDialog';
import { ChannelUpstreamDialog } from './ChannelUpstreamDialog';
import { Field } from './ChannelField';
import { EMPTY_MODEL_DRAFT, EMPTY_TIER, type ModelDraft } from './constants';
import {
  parseSelector,
  priceOf,
  toModelDraft,
  staleTierUpstream,
  clearStaleTierUpstream,
  validateModelTags,
  validateModelTiers,
} from './utils';
import { useChannelModelHealth, useChannelModels, useProtocolCatalog } from './useChannelModels';
import type {
  AdminChannelModelView,
  AdminChannelView,
  ProtocolTestResultView,
  UpstreamModelPreview,
} from '../../../types/model';

/**
 * 渠道模型工作台（渠道工作台右侧详情区，跟随选中渠道内联渲染）。
 *
 * 一条渠道下可以有任意模态的模型，每个模型带自己的能力合同与价格档。
 * 三条不可省的行为：
 *   1. **价格以微积分存取**，界面按「积分」输入，6 位小数；保存时换算回整数；
 *   2. **价格档是真实计费单位**，不是展示字段 —— 保存后 `BillingService` 直接按
 *      档位选价，所有档位都被删掉时会回落到一个通配档；
 *   3. 连通性测试走与正式任务相同的协议、出站策略、鉴权，不建任务、不扣费。
 *
 * 上游目录导入只写入管理员勾选的模型，且默认停用、待定价 —— 自动启用会让
 * 一个没配价格的模型立刻进入路由，用户拿到 42204（无可用线路）。
 *
 * ## 模块划分
 *
 * - `constants.ts` / `utils.ts`：草稿类型与默认值、纯转换（选择器 / 标签 / 价格）；
 * - `useChannelModels.ts`：清单、健康、协议目录三份数据；
 * - `ChannelModelTable` / `ChannelModelFormDialog` / `ChannelUpstreamDialog`：三块 UI；
 * - 本文件只保留编排与写操作（保存、启停、测试、导入、删除）。
 */
export function ChannelModelManager({
  channel,
  writable,
  canTest = true,
  onChanged,
  focusModelId,
  onFocusConsumed,
}: {
  channel: AdminChannelView;
  writable: boolean;
  /** 是否可发起连通性测试（`channel.test` 权限，与改配置权限分开） */
  canTest?: boolean;
  onChanged: () => void;
  /** 从「全部模型」跳过来时要直接打开的模型 id；消费后由父级清空 */
  focusModelId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const toast = useToast();
  const channelId = channel.id;

  const { models, loading, error, load } = useChannelModels(channelId);
  const { healthById, healthLoading } = useChannelModelHealth(channelId);

  const [editing, setEditing] = useState<AdminChannelModelView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_MODEL_DRAFT);
  const [saving, setSaving] = useState(false);

  const [upstream, setUpstream] = useState<UpstreamModelPreview[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);

  const [testResult, setTestResult] = useState<ProtocolTestResultView | null>(null);
  const [testing, setTesting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminChannelModelView | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  /** 勾选的模型 id：统一调价与批量删除共用同一份勾选 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [repriceOpen, setRepriceOpen] = useState(false);

  /** 停用前确认：停用会把模型从路由目录里拿掉，不是纯展示开关 */
  const [disableTarget, setDisableTarget] = useState<AdminChannelModelView | null>(null);
  /** 批量删除确认 */
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteReason, setBatchDeleteReason] = useState('');
  /** 模型排序弹窗 */
  const [orderOpen, setOrderOpen] = useState(false);

  const { options: protocolOptions } = useProtocolCatalog(draft.capability);

  useEffect(() => {
    if (!channelId) return;
    setEditing(null);
    setCreating(false);
    setUpstream(null);
    setTestResult(null);
    // 切换渠道时不沿用上一次的勾选：价格版本可能已变，旧勾选会让调价整批被拒
    setSelectedIds([]);
    setRepriceOpen(false);
    setBatchDeleteOpen(false);
    setOrderOpen(false);
    setDisableTarget(null);
  }, [channelId]);

  /**
   * 跨渠道视图的「编辑」动线：清单加载完成后直接打开这条模型的编辑器。
   *
   * 找不到（例如刚被删掉）就静默放弃 —— 用户已经落在正确的渠道上，
   * 再弹一个「模型不存在」只会打断排障。
   */
  useEffect(() => {
    if (!focusModelId || !models) return;
    const target = models.find((model) => model.id === focusModelId);
    if (target) {
      setDraft(toModelDraft(target));
      setEditing(target);
      setCreating(false);
      setTestResult(null);
    }
    onFocusConsumed?.();
    // openEdit 每次渲染都是新函数，不进依赖；这里只认「清单 + 目标 id」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, focusModelId]);

  /** 本地已有的上游键：上游 id 命中它就不算「新模型」，勾了也不会重复写入 */
  const existingUpstreamKeys = useMemo(
    () =>
      new Set(
        (models ?? [])
          .flatMap((item) => [item.modelKey, item.providerModelKey])
          .filter(Boolean)
          .map((key) => key.toLowerCase()),
      ),
    [models],
  );

  const openCreate = () => {
    const next = { ...EMPTY_MODEL_DRAFT, tiers: [{ ...EMPTY_TIER }] };
    setDraft(next);
    setEditing(null);
    setCreating(true);
    setTestResult(null);
  };

  const openEdit = (model: AdminChannelModelView) => {
    setDraft(toModelDraft(model));
    setEditing(model);
    setCreating(false);
    setTestResult(null);
  };

  /**
   * 复制模型：同价位、换上游 SKU 的常规做法，逐项重填一遍等于逼人抄错。
   *
   * 副本以**停用**状态创建：新模型标识必然没配过价格与上游键，直接启用会让
   * 一条半配置线路立刻进入路由。标识逐次加后缀，避免二次复制撞唯一键。
   */
  const openCopy = (model: AdminChannelModelView) => {
    const existing = new Set((models ?? []).map((item) => item.modelKey));
    let modelKey = `${model.modelKey}-copy`;
    let index = 2;
    while (existing.has(modelKey)) modelKey = `${model.modelKey}-copy-${index++}`;
    const base = toModelDraft(model);
    /*
     * 副本清空「档位级上游键」，保留「模型级上游键」。
     *
     * 档位级上游键是显式指向某个上游 SKU 的；照抄过来会让副本继续打旧上游，
     * 改模型级上游名时又出现「档位没跟随」的老问题。模型级上游键是这份配置的
     * 主体（同价换 SKU 的常见用法），保留。
     */
    setDraft({
      ...base,
      modelKey,
      displayName: model.displayName ? `${model.displayName} 副本` : '',
      enabled: false,
      tiers: base.tiers.map((tier) => ({ ...tier, providerModelKey: '' })),
    });
    setEditing(null);
    setCreating(true);
    setTestResult(null);
  };

  const formOpen = creating || editing !== null;
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setTestResult(null);
  };

  const submit = async () => {
    if (!channelId) return;
    const modelKey = draft.modelKey.trim();
    if (!modelKey) {
      toast.error('请填写模型标识');
      return;
    }
    if (!draft.protocol) {
      toast.error('请选择请求协议');
      return;
    }
    let capabilityConfig: unknown = null;
    if (draft.capabilityConfig.trim()) {
      try {
        capabilityConfig = JSON.parse(draft.capabilityConfig);
      } catch {
        toast.error('能力合同不是合法 JSON');
        return;
      }
    }
    let priceTiers;
    try {
      const tierError = validateModelTiers(draft.capability, draft.tiers);
      if (tierError) {
        toast.error(tierError);
        return;
      }
      priceTiers = draft.tiers
        .filter((tier) => tier.enabled || tier.unit !== '0' || tier.output !== '0')
        .map((tier) => ({
          selector: parseSelector(tier.selector),
          resolution: tier.resolution.trim() || '*',
          videoSeconds: Number(tier.videoSeconds) || 0,
          providerModelKey: tier.providerModelKey.trim() || draft.providerModelKey.trim() || modelKey,
          billingMode: tier.billingMode,
          unitPriceMicrocredits: priceOf(tier.unit, '单价'),
          inputTokenPriceMicrocredits: priceOf(tier.input, '输入 Token 单价'),
          outputTokenPriceMicrocredits: priceOf(tier.output, '输出 Token 单价'),
          cachedTokenPriceMicrocredits: priceOf(tier.cached, '缓存 Token 单价'),
          priceConfigured: tier.priceConfigured,
          enabled: tier.enabled,
          costPricing: tier.costConfigured
            ? {
                configured: true,
                unitPriceMicrocredits: priceOf(tier.costUnit, '成本单价'),
                inputTokenPriceMicrocredits: priceOf(tier.costInput, '输入 Token 成本'),
                outputTokenPriceMicrocredits: priceOf(tier.costOutput, '输出 Token 成本'),
                cachedTokenPriceMicrocredits: priceOf(tier.costCached, '缓存 Token 成本'),
              }
            : null,
        }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '价格格式不正确');
      return;
    }
      // 标签已在编辑器里结构化维护；提交前再校验一次，避免绕过界面的写入
      const tagError = validateModelTags(draft.tags);
      if (tagError) {
        toast.error(tagError);
        return;
      }
      const body = {
        modelKey,
        providerModelKey: draft.providerModelKey.trim() || modelKey,
        displayName: draft.displayName.trim(),
        channelLabel: draft.channelLabel.trim(),
        description: draft.description.trim(),
        icon: draft.icon.trim(),
        capability: draft.capability,
        protocol: draft.protocol,
        priceCurrency: draft.priceCurrency,
        tags: draft.tags
          .map((tag) => ({ text: tag.text.trim(), color: tag.color }))
          .filter((tag) => tag.text !== ''),
      capabilityConfig,
      enabled: draft.enabled,
      priceTiers,
    };
    setSaving(true);
    try {
      if (editing) {
        await adminChannelsApi.updateModel(channelId, editing.id, body);
        toast.success(`模型 ${modelKey} 已保存`);
      } else {
        await adminChannelsApi.createModel(channelId, body);
        toast.success(`模型 ${modelKey} 已创建`);
      }
      closeForm();
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleModel = async (model: AdminChannelModelView, enabled: boolean) => {
    try {
      await adminChannelsApi.setModelEnabled(channelId, model.id, enabled);
      toast.success(enabled ? `已启用 ${model.modelKey}` : `已停用 ${model.modelKey}`);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  /** 停用会把模型从路由目录里拿掉：先确认；启用没有破坏性，直接执行 */
  const requestToggle = (model: AdminChannelModelView, enabled: boolean) => {
    if (enabled) void toggleModel(model, true);
    else setDisableTarget(model);
  };

  const runTest = async (model: AdminChannelModelView) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await adminChannelsApi.testModel(channelId, {
        modelId: model.id,
        capability: model.capability,
        protocol: model.protocol,
        waitForResult: true,
      });
      setTestResult(result);
      if (result.status === 'succeeded') toast.success('连通性测试通过');
      else toast.error(result.error || result.message || '连通性测试失败');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const fetchUpstream = async () => {
    setFetching(true);
    try {
      const res = await adminChannelsApi.fetchModels(channelId);
      setUpstream(res.models);
      if (res.models.length === 0) toast.error('上游目录为空，请检查 Base URL 与凭证');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉取上游目录失败');
    } finally {
      setFetching(false);
    }
  };

  const closeUpstream = () => {
    if (importing) return;
    setUpstream(null);
  };

  const runImport = async (ids: string[]) => {
    if (ids.length === 0) {
      toast.error('请勾选要导入的模型');
      return;
    }
    setImporting(true);
    try {
      const res = await adminChannelsApi.importModels(channelId, ids);
      toast.success(`已导入 ${res.added} 个模型，默认停用，请补能力与价格后再启用`);
      setUpstream(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    // 删除是高危动作（channel.model_write）：原因必填，后端也会拒收空原因
    if (deleteReason.trim().length === 0) {
      toast.error('必须填写变更原因');
      return;
    }
    setSaving(true);
    try {
      await adminChannelsApi.removeModel(channelId, deleteTarget.id, deleteReason.trim());
      toast.success(`已删除 ${deleteTarget.modelKey}`);
      setDeleteTarget(null);
      setDeleteReason('');
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  /**
   * 批量删除：后端是**全有或全无**的。
   *
   * 任一被选模型仍被前台线路或进行中任务引用，本次不删除任何模型
   * （见 `ChannelModelService.removeMany`）。所以失败提示必须转述后端
   * 给的原话，不能写成「删除失败」—— 后端那句才是运营要知道的事实。
   */
  const runBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    // 删除是高危动作（channel.model_write）：原因必填，后端也会拒收空原因
    if (batchDeleteReason.trim().length === 0) {
      toast.error('必须填写变更原因');
      return;
    }
    setSaving(true);
    try {
      const result = await adminChannelsApi.batchDeleteModels(
        channelId,
        selectedIds,
        batchDeleteReason.trim(),
      );
      toast.success(`已删除 ${result.deleted} 个模型`);
      setBatchDeleteOpen(false);
      setBatchDeleteReason('');
      setSelectedIds([]);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <ChannelModelFormDialog
          open={formOpen}
          editing={editing}
          draft={draft}
          setDraft={setDraft}
          protocolOptions={protocolOptions}
          testResult={testResult}
          testing={testing}
          saving={saving}
          writable={writable}
          onTest={async () => {
            if (!editing) {
              toast.error('先保存模型再测试：测试使用库内凭证与能力合同');
              return;
            }
            await runTest(editing);
          }}
          onClose={closeForm}
          onSubmit={() => void submit()}
          previousProviderModelKey={editing?.providerModelKey ?? ''}
          onFollowModelUpstream={() => {
            const stale = staleTierUpstream(draft, editing?.providerModelKey ?? '');
            if (stale.length === 0) return;
            setDraft(clearStaleTierUpstream(draft, stale));
            toast.success(`已清除 ${stale.length} 个档位的独立上游名，改为跟随模型`);
          }}
        />

        <ChannelUpstreamDialog
          open={upstream !== null}
          models={upstream ?? []}
          existingKeys={existingUpstreamKeys}
          importing={importing}
          onClose={closeUpstream}
          onImport={(ids) => void runImport(ids)}
        />

        <div className="flex flex-col gap-4">
          {/* 已有数据时保留旧清单并提示读取失败；空清单由表格自己的错误态给重试 */}
          {error && (models ?? []).length > 0 && (
            <Notice tone="danger" title="模型清单刷新失败，显示的是上一次读取结果">
              {error}
            </Notice>
          )}

          <ChannelModelTable
            models={models}
            loading={loading}
            error={error}
            healthById={healthById}
            healthLoading={healthLoading}
            selectedIds={selectedIds}
            writable={writable}
            canTest={canTest}
            testing={testing}
            testResult={testResult}
            onSelectedChange={setSelectedIds}
            onRetry={() => void load()}
            onTest={(model) => void runTest(model)}
            onEdit={openEdit}
            onToggle={requestToggle}
            onCopy={openCopy}
            onDelete={(model) => {
              setDeleteReason('');
              setDeleteTarget(model);
            }}
            onOpenOrder={() => setOrderOpen(true)}
            onOpenBatchDelete={() => {
              setBatchDeleteReason('');
              setBatchDeleteOpen(true);
            }}
            onOpenReprice={() => setRepriceOpen(true)}
            onOpenCreate={openCreate}
            onFetchUpstream={() => void fetchUpstream()}
            fetching={fetching}
          />

          <ConfirmAction
            open={deleteTarget !== null}
            title={`删除模型 ${deleteTarget?.modelKey ?? ''}？`}
            description="删除后从路由目录移除；引用该模型的前台线路会变为不可用。历史账单与调用记录保留。"
            impact={[
              '该渠道模型的价格档一并作废',
              '引用它的前台模型线路需要重新选路',
            ]}
            danger
            loading={saving}
            confirmDisabled={deleteReason.trim().length === 0}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => void runDelete()}
            extra={
              <Field
                label="删除原因"
                hint="写入审计，建议写清替代模型或下线原因"
                error={deleteReason.trim().length === 0 ? '删除是高危操作，必须填写原因' : null}
              >
                <TextField
                  ariaLabel="删除原因"
                  value={deleteReason}
                  onChange={setDeleteReason}
                  placeholder="如：上游已下线该模型"
                />
              </Field>
            }
          />

          <ConfirmAction
            open={batchDeleteOpen}
            title={`批量删除 ${selectedIds.length} 个模型？`}
            description="软删除：所选模型从路由目录移除，价格档一并作废；历史账单与调用记录保留。"
            impact={[
              '任一模型仍被前台线路或进行中任务使用时，本次不删除任何模型',
              '引用这些模型的前台线路需要重新选路',
            ]}
            danger
            loading={saving}
            confirmDisabled={batchDeleteReason.trim().length === 0}
            onCancel={() => setBatchDeleteOpen(false)}
            onConfirm={() => void runBatchDelete()}
            extra={
              <Field
                label="删除原因"
                hint="写入审计"
                error={batchDeleteReason.trim().length === 0 ? '删除是高危操作，必须填写原因' : null}
              >
                <TextField
                  ariaLabel="批量删除原因"
                  value={batchDeleteReason}
                  onChange={setBatchDeleteReason}
                  placeholder="如：批量下线旧版本模型"
                />
              </Field>
            }
          />

          <ConfirmAction
            open={disableTarget !== null}
            title={`停用模型 ${disableTarget?.modelKey ?? ''}？`}
            description="停用后新任务不再路由到该模型，引用它的前台线路会走其他可用线路；价格与配置保留，可随时重新启用。"
            impact={[
              '路由目录会剔除该模型（本进程立即生效，其他进程最多滞后一个缓存周期）',
              '进行中的任务不受影响',
            ]}
            danger
            onCancel={() => setDisableTarget(null)}
            onConfirm={() => {
              const target = disableTarget;
              setDisableTarget(null);
              if (target) void toggleModel(target, false);
            }}
          />
        </div>
      </div>

      {/*
        调价 / 排序弹窗与详情区**平级**：两个 React Aria 模态嵌套时焦点作用域
        会互相抢，关掉弹窗后焦点回不到触发它的那个复选框。
      */}
      {repriceOpen && channelId && (
        <ChannelModelRepriceDialog
          channelId={channelId}
          channelName={channel.name}
          models={(models ?? []).filter((model) => selectedIds.includes(model.id))}
          onClose={() => setRepriceOpen(false)}
          onSaved={() => {
            setSelectedIds([]);
            return load();
          }}
        />
      )}

      {orderOpen && channelId && (
        <ChannelOrderDialog
          open
          channelId={channelId}
          channelName={channel.name}
          onClose={() => setOrderOpen(false)}
          onSaved={() => load()}
        />
      )}
    </>
  );
}
