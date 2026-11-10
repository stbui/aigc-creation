import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminChannelsApi } from './api';
import { ConfirmDialog, Notice } from '~/admin-ui/primitives';
import { useToast } from './hooks';
import { ChannelModelDialogs } from './ChannelModelDialogs';
import { ChannelModelTable } from './ChannelModelTable';
import { createDefaultImageCapabilityConfigJson } from './imageCapability';
import { createDefaultTextCapabilityConfigJson } from './textCapability';
import {
  EMPTY_MODEL_DRAFT,
  EMPTY_TIER,
  type BatchImportConfig,
  type ModelDraft,
} from './constants';
import { buildPriceTiers, toModelDraft } from './utils';
import { useChannelModelHealth, useChannelModels } from './useChannelModels';
import { consumptionImpactText, type ProductConsumptionState } from './useProductConsumption';
import type {
  AdminChannelModelView,
  AdminChannelView,
  ProtocolTestResultView,
  UpstreamModelPreview,
} from '../../../types/model';

/**
 * 商品工作台（供应商视图右侧详情区，跟随选中供应商内联渲染）。
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
  consumption,
  autoFetchUpstream = false,
  onAutoFetchConsumed,
  onChanged,
  focusModelId,
  onFocusConsumed,
}: {
  channel: AdminChannelView;
  writable: boolean;
  /** 是否可发起连通性测试（`channel.test` 权限，与改配置权限分开） */
  canTest?: boolean;
  consumption: ProductConsumptionState;
  /** 新建供应商后自动拉一次上游目录 */
  autoFetchUpstream?: boolean;
  onAutoFetchConsumed?: () => void;
  onChanged: () => void;
  /** 从「商品台账」跳过来时要直接打开的商品 id；消费后由父级清空 */
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

  /** 勾选的模型 id：统一调价与批量删除共用同一份勾选 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [repriceOpen, setRepriceOpen] = useState(false);

  /** 停用前确认：停用会把模型从路由目录里拿掉，不是纯展示开关 */
  const [disableTarget, setDisableTarget] = useState<AdminChannelModelView | null>(null);
  /** 批量删除确认 */
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  /** 模型排序弹窗 */
  const [orderOpen, setOrderOpen] = useState(false);


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

  const openEdit = useCallback((model: AdminChannelModelView) => {
    setDraft(toModelDraft(model));
    setEditing(model);
    setCreating(false);
    setTestResult(null);
  }, []);

  /**
   * 跨渠道视图的「编辑」动线：清单加载完成后直接打开这条模型的编辑器。
   *
   * 找不到（例如刚被删掉）就静默放弃 —— 用户已经落在正确的渠道上，
   * 再弹一个「模型不存在」只会打断排障。
   */
  useEffect(() => {
    if (!focusModelId || !models) return;
    const target = models.find((model) => model.id === focusModelId);
    if (target) openEdit(target);
    onFocusConsumed?.();
    // openEdit 依赖稳定；onFocusConsumed 每次渲染都是新函数，不纳入依赖 ——
    // 目标 id 消费后父级会立即清空，不会重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, focusModelId, openEdit]);

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

  const submit = async (draft: ModelDraft) => {
    if (!channelId) return;
    const modelKey = draft.modelKey.trim();
    let capabilityConfig: unknown = null;
    if (draft.capabilityConfig.trim()) {
      try {
        capabilityConfig = JSON.parse(draft.capabilityConfig);
      } catch {
        toast.error('能力配置格式不正确');
        return;
      }
    }
    const tierResult = buildPriceTiers(draft);
    if ('error' in tierResult) {
      toast.error(tierResult.error);
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
      priceTiers: tierResult.tiers,
    };
    setSaving(true);
    try {
      if (editing) {
        await adminChannelsApi.updateModel(channelId, editing.id, body);
        toast.success(`商品 ${modelKey} 已保存`);
      } else {
        await adminChannelsApi.createModel(channelId, body);
        toast.success(`商品 ${modelKey} 已创建`);
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
      toast.success(enabled ? `已启用商品 ${model.modelKey}` : `已停用商品 ${model.modelKey}`);
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
      if (result.status === 'succeeded') toast.success('服务连接正常');
      else toast.error(result.error || result.message || '服务连接失败');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const autoFetchedRef = useRef(false);
  const fetchUpstream = useCallback(async () => {
    setFetching(true);
    try {
      const res = await adminChannelsApi.fetchModels(channelId);
      setUpstream(res.models);
      if (res.models.length === 0) toast.error('供应商没有返回可用商品，请检查服务地址与访问凭证');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '同步供应商商品失败');
    } finally {
      setFetching(false);
    }
  }, [channelId, toast]);

  useEffect(() => {
    if (!autoFetchUpstream || autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    // 先消费标记，避免父级重渲染后再次触发
    onAutoFetchConsumed?.();
    void fetchUpstream();
  }, [autoFetchUpstream, fetchUpstream, onAutoFetchConsumed]);

  const closeUpstream = () => {
    if (importing) return;
    setUpstream(null);
  };

  const runImport = async (ids: string[], config?: BatchImportConfig) => {
    if (ids.length === 0) {
      toast.error('请勾选要导入的商品');
      return;
    }
    setImporting(true);
    try {
      /*
       * 导入接口只建骨架行。带统一配置时，前端按「导入前后 id 差集」找出
       * 本次新增的商品，再逐条调用既有保存接口补类型 / 接入方式 / 售价。
       * 这样不新增后端契约，也不会误改用户同时勾选的已存在商品。
       */
      const before = config ? await adminChannelsApi.models(channelId) : null;
      const res = await adminChannelsApi.importModels(channelId, ids);

      let configured = 0;
      let skipped = 0;
      const failures: string[] = [];
      if (config && res.added === 0) {
        toast.success('没有新增商品：所选商品都已存在');
        setUpstream(null);
        await load();
        onChanged();
        return;
      }
      if (config) {
        const beforeIds = new Set((before?.models ?? []).map((model) => model.id));
        const wanted = new Set(ids.map((id) => id.toLowerCase()));
        let after: Awaited<ReturnType<typeof adminChannelsApi.models>>;
        try {
          after = await adminChannelsApi.models(channelId);
        } catch {
          // 导入已经成功；这里失败只是拿不到新行，不能让用户以为整次导入失败
          toast.error(`已导入 ${res.added} 个商品，但读取新商品失败；请刷新后手动补配置`);
          setUpstream(null);
          await load();
          onChanged();
          return;
        }
        const targets = after.models.filter((model) => {
          if (beforeIds.has(model.id)) return false;
          const upstreamKey = (model.providerModelKey || model.modelKey).toLowerCase();
          return wanted.has(upstreamKey) || wanted.has(model.modelKey.toLowerCase());
        });
        skipped = Math.max(0, res.added - targets.length);

        for (const model of targets) {
          try {
            const upstream = res.models.find(
              (item) =>
                item.id.toLowerCase() ===
                (model.providerModelKey || model.modelKey).toLowerCase(),
            );
            const capabilityConfig =
              config.capability === 'image'
                ? JSON.parse(
                    createDefaultImageCapabilityConfigJson(
                      config.imageParameters,
                      model.providerModelKey || model.modelKey,
                    ),
                  )
                : JSON.parse(createDefaultTextCapabilityConfigJson());
            await adminChannelsApi.updateModel(channelId, model.id, {
              modelKey: model.modelKey,
              providerModelKey: model.providerModelKey || model.modelKey,
              displayName:
                upstream?.displayName ||
                (model.displayName && model.displayName !== '未分类'
                  ? model.displayName
                  : model.modelKey),
              capability: config.capability,
              protocol: config.protocol,
              capabilityConfig,
              enabled: false,
              priceTiers: [
                {
                  selector: {},
                  resolution: '*',
                  videoSeconds: 0,
                  billingMode: config.billingMode,
                  unitPriceMicrocredits: config.unitPriceMicrocredits,
                  inputTokenPriceMicrocredits: config.inputTokenPriceMicrocredits,
                  outputTokenPriceMicrocredits: config.outputTokenPriceMicrocredits,
                  cachedTokenPriceMicrocredits: config.cachedTokenPriceMicrocredits,
                  priceConfigured: true,
                  enabled: true,
                },
              ],
            });
            configured += 1;
          } catch (e) {
            failures.push(
              `${model.modelKey}：${e instanceof Error ? e.message : '统一配置失败'}`,
            );
          }
        }
      }

      if (failures.length > 0) {
        toast.error(
          `已导入 ${res.added} 个商品，${failures.length} 个统一配置失败：${failures
            .slice(0, 2)
            .join('；')}`,
        );
      } else if (config) {
        toast.success(
          `已导入并配置 ${configured} 个商品${skipped > 0 ? `，${skipped} 个未匹配到新行` : ''}，默认停用；确认售价后启用`,
        );
      } else {
        toast.success(
          `已导入 ${res.added} 个商品，默认停用；设置类型、接入方式与售价后再启用`,
        );
      }
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
    setSaving(true);
    try {
      await adminChannelsApi.removeModel(channelId, deleteTarget.id);
      toast.success(`已删除商品 ${deleteTarget.modelKey}`);
      setDeleteTarget(null);
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
    setSaving(true);
    try {
      const result = await adminChannelsApi.batchDeleteModels(channelId, selectedIds);
      toast.success(`已删除 ${result.deleted} 个商品`);
      setBatchDeleteOpen(false);
      setSelectedIds([]);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  };

  const batchImpactRefs = selectedIds.flatMap(
    (id) => consumption.byModelId.get(id) ?? [],
  );

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          {/* 已有数据时保留旧清单并提示读取失败；空清单由表格自己的错误态给重试 */}
          {error && (models ?? []).length > 0 && (
            <Notice tone="danger" title="商品清单刷新失败，显示的是上一次读取结果">
              {error}
            </Notice>
          )}

          <ChannelModelTable
            models={models}
            channelEnabled={channel.enabled}
            loading={loading}
            error={error}
            consumption={consumption}
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
              setDeleteTarget(model);
            }}
            onOpenOrder={() => setOrderOpen(true)}
            onOpenBatchDelete={() => setBatchDeleteOpen(true)}
            onOpenReprice={() => setRepriceOpen(true)}
            onOpenCreate={openCreate}
            onFetchUpstream={() => void fetchUpstream()}
            fetching={fetching}
          />

          <ConfirmDialog
            open={deleteTarget !== null}
            title={`删除商品 ${deleteTarget?.modelKey ?? ''}？`}
            description="删除后该商品将停止使用；历史账单与调用记录保留。"
            impact={[
              consumptionImpactText(
                consumption.byModelId.get(deleteTarget?.id ?? '') ?? [],
              ),
              '该商品的售价方案一并作废',
              '消费该商品的能力需要重新选择来源',
            ]}
            danger
            confirmText="确认删除"
            loading={saving}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => void runDelete()}
          />

          <ConfirmDialog
            open={batchDeleteOpen}
            title={`批量删除 ${selectedIds.length} 个商品？`}
            description="删除后所选商品将停止使用，售价方案一并作废；历史账单与调用记录保留。"
            impact={[
              consumptionImpactText(batchImpactRefs),
              '任一商品仍被消费它的能力或进行中任务使用时，本次不会删除商品',
              '消费这些商品的能力需要重新选择来源',
            ]}
            danger
            confirmText="确认删除"
            loading={saving}
            onCancel={() => setBatchDeleteOpen(false)}
            onConfirm={() => void runBatchDelete()}
          />

          <ConfirmDialog
            open={disableTarget !== null}
            title={`停用商品 ${disableTarget?.modelKey ?? ''}？`}
            description="停用后新任务不再使用该商品，消费它的能力会切换到其他可用商品；价格与配置保留，可随时重新启用。"
            impact={[
              consumptionImpactText(
                consumption.byModelId.get(disableTarget?.id ?? '') ?? [],
              ),
              '该商品会立即停止接单',
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

      <ChannelModelDialogs
        channelId={channelId}
        channelName={channel.name}
        form={{
          open: formOpen,
          editing,
          draft,
          testResult,
          testing,
          saving,
          writable,
          previousProviderModelKey: editing?.providerModelKey ?? '',
          onTest: async () => {
            if (!editing) {
              toast.error('请先保存商品，再测试服务连接');
              return;
            }
            await runTest(editing);
          },
          onClose: closeForm,
          onSubmit: (next) => void submit(next),
        }}
        upstream={{
          models: upstream,
          existingKeys: existingUpstreamKeys,
          importing,
          onClose: closeUpstream,
          onImport: (ids, config) => void runImport(ids, config),
        }}
        reprice={{
          open: repriceOpen,
          models: (models ?? []).filter((model) => selectedIds.includes(model.id)),
          onClose: () => setRepriceOpen(false),
          onSaved: () => {
            setSelectedIds([]);
            return load();
          },
        }}
        order={{
          open: orderOpen,
          onClose: () => setOrderOpen(false),
          onSaved: () => load(),
        }}
      />
    </>
  );
}
