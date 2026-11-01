import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, RefreshCw, Trash2, TrendingUp, UploadCloud, Zap } from 'lucide-react';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { adminChannelsApi } from '../../../lib/api';
import { parseCredits, toCreditsInput } from '../../../lib/microcredits';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { Descriptions, FormField, Notice } from '../../../admin-ui/primitives';
import { Drawer } from '../../../admin-ui/primitives/Drawer';
import { ChannelModelRepriceDialog } from './ChannelModelRepriceDialog';
import {
  CheckBox,
  HoverTip,
  NumberInput,
  SelectBox,
  SwitchBox,
  TextArea,
  TextInput,
} from '../../../admin-ui/controls';
import { ConfirmAction } from '../../../components/admin/AdminWidgets';
import { Panel, StatusTag } from '../../../components/admin/PageHeader';
import type {
  AdminChannelModelView,
  AdminChannelView,
  ChannelModelPriceTierView,
  ProtocolCatalogEntryView,
  ProtocolTestResultView,
  UpstreamModelPreview,
} from '../../../types/model';

/**
 * 渠道模型工作台（渠道行内「模型」抽屉）。
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
 */

const CAPABILITY_OPTIONS = [
  { value: 'image', label: '图像' },
  { value: 'text', label: '文本' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
];

const BILLING_MODE_OPTIONS = [
  { value: 'fixed_request', label: '按次' },
  { value: 'per_second', label: '按时长（秒）' },
  { value: 'token', label: '按 Token 用量' },
];

const CURRENCY_OPTIONS = [
  { value: 'credits', label: '积分' },
  { value: 'USD', label: '美元' },
  { value: 'CNY', label: '人民币' },
];

const TAG_COLOR_OPTIONS = ['purple', 'blue', 'green', 'gold', 'orange', 'pink'];

interface TierDraft {
  selector: string;
  resolution: string;
  videoSeconds: string;
  providerModelKey: string;
  billingMode: string;
  unit: string;
  input: string;
  output: string;
  cached: string;
  costConfigured: boolean;
  costUnit: string;
  costInput: string;
  costOutput: string;
  costCached: string;
  priceConfigured: boolean;
  enabled: boolean;
}

interface ModelDraft {
  modelKey: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  description: string;
  icon: string;
  capability: string;
  protocol: string;
  priceCurrency: string;
  tags: string;
  capabilityConfig: string;
  enabled: boolean;
  tiers: TierDraft[];
}

const EMPTY_TIER: TierDraft = {
  selector: '',
  resolution: '*',
  videoSeconds: '0',
  providerModelKey: '',
  billingMode: 'fixed_request',
  unit: '0',
  input: '0',
  output: '0',
  cached: '0',
  costConfigured: false,
  costUnit: '0',
  costInput: '0',
  costOutput: '0',
  costCached: '0',
  priceConfigured: false,
  enabled: true,
};

const EMPTY_DRAFT: ModelDraft = {
  modelKey: '',
  providerModelKey: '',
  displayName: '',
  channelLabel: '',
  description: '',
  icon: '',
  capability: 'image',
  protocol: '',
  priceCurrency: 'credits',
  tags: '',
  capabilityConfig: '',
  enabled: true,
  tiers: [{ ...EMPTY_TIER }],
};

/** 选择器文本 ⇄ 对象：`operation=generate, size=1024x1024` */
function parseSelector(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of String(text ?? '').split(',')) {
    const [rawKey, ...rest] = part.split('=');
    const key = String(rawKey ?? '').trim();
    const value = rest.join('=').trim();
    if (key && value) result[key] = value;
  }
  return result;
}

function formatSelector(selector: Record<string, string>): string {
  return Object.entries(selector ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function tagsToText(tags: Array<{ text: string; color: string }>): string {
  return (tags ?? []).map((tag) => `${tag.text}:${tag.color}`).join(', ');
}

/** 标签文本 → 请求体；颜色非法时回落 purple，不让一个笔误阻断保存 */
function textToTags(text: string): Array<{ text: string; color: string }> {
  return String(text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rawText, rawColor] = item.split(':');
      const color = TAG_COLOR_OPTIONS.includes(String(rawColor ?? '').trim())
        ? String(rawColor).trim()
        : 'purple';
      return { text: String(rawText ?? '').trim(), color };
    })
    .filter((tag) => tag.text !== '');
}

function tierToDraft(tier: ChannelModelPriceTierView): TierDraft {
  return {
    selector: formatSelector(tier.selector),
    resolution: tier.resolution || '*',
    videoSeconds: String(tier.videoSeconds ?? 0),
    providerModelKey: tier.providerModelKey,
    billingMode: tier.billingMode,
    unit: toCreditsInput(tier.unitPriceMicrocredits),
    input: toCreditsInput(tier.inputTokenPriceMicrocredits),
    output: toCreditsInput(tier.outputTokenPriceMicrocredits),
    cached: toCreditsInput(tier.cachedTokenPriceMicrocredits),
    costConfigured: tier.costPricing?.configured ?? false,
    costUnit: toCreditsInput(tier.costPricing?.unitPriceMicrocredits ?? 0),
    costInput: toCreditsInput(tier.costPricing?.inputTokenPriceMicrocredits ?? 0),
    costOutput: toCreditsInput(tier.costPricing?.outputTokenPriceMicrocredits ?? 0),
    costCached: toCreditsInput(tier.costPricing?.cachedTokenPriceMicrocredits ?? 0),
    priceConfigured: tier.priceConfigured,
    enabled: tier.enabled,
  };
}

function toDraft(model: AdminChannelModelView): ModelDraft {
  return {
    modelKey: model.modelKey,
    providerModelKey: model.providerModelKey,
    displayName: model.displayName,
    channelLabel: model.channelLabel,
    description: model.description,
    icon: model.icon,
    capability: model.capability || 'image',
    protocol: model.protocol,
    priceCurrency: model.priceCurrency || 'credits',
    tags: tagsToText(model.tags),
    capabilityConfig: model.capabilityConfig ? JSON.stringify(model.capabilityConfig, null, 2) : '',
    enabled: model.enabled,
    tiers:
      model.priceTiers.length > 0
        ? model.priceTiers.map(tierToDraft)
        : [{ ...EMPTY_TIER, providerModelKey: model.providerModelKey }],
  };
}

function priceOf(text: string, label: string): number {
  const value = parseCredits(text);
  if (value === null) throw new Error(`${label}格式不正确，请填积分，最多 6 位小数`);
  return value;
}

/** 表单字段容器（与其它后台页保持一致的三段式：标签 / 控件 / 说明） */
function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <p className="text-[11px] leading-4 text-text-tertiary">{hint}</p>}
    </div>
  );
}

export function ChannelModelsDrawer({
  channel,
  open,
  writable,
  onClose,
  onChanged,
}: {
  channel: AdminChannelView | null;
  open: boolean;
  writable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const channelId = channel?.id ?? '';

  const [models, setModels] = useState<AdminChannelModelView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [protocols, setProtocols] = useState<ProtocolCatalogEntryView[]>([]);
  const [editing, setEditing] = useState<AdminChannelModelView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [upstream, setUpstream] = useState<UpstreamModelPreview[] | null>(null);
  const [selectedUpstream, setSelectedUpstream] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);

  const [testResult, setTestResult] = useState<ProtocolTestResultView | null>(null);
  const [testing, setTesting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminChannelModelView | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  /** 统一调价：勾选的模型 id；空数组 = 未打开调价弹窗 */
  const [repriceIds, setRepriceIds] = useState<string[]>([]);
  const [repriceOpen, setRepriceOpen] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const list = await adminChannelsApi.models(channelId);
      setModels(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (!open || !channelId) return;
    setEditing(null);
    setCreating(false);
    setUpstream(null);
    setSelectedUpstream([]);
    setTestResult(null);
    // 重新打开抽屉时不沿用上一次的勾选：价格版本可能已变，旧勾选会让调价整批被拒
    setRepriceIds([]);
    setRepriceOpen(false);
    void load();
  }, [open, channelId, load]);

  const loadProtocols = useCallback(async (capability: string) => {
    try {
      const res = await adminChannelsApi.protocols(capability);
      setProtocols(res.protocols.filter((item) => item.selectable));
    } catch {
      setProtocols([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadProtocols(draft.capability);
    // 只在打开与能力切换时拉取；草稿其它字段变化不触发
  }, [open, draft.capability, loadProtocols]);

  const openCreate = () => {
    const next = { ...EMPTY_DRAFT, tiers: [{ ...EMPTY_TIER }] };
    setDraft(next);
    setEditing(null);
    setCreating(true);
    setTestResult(null);
  };

  const openEdit = (model: AdminChannelModelView) => {
    setDraft(toDraft(model));
    setEditing(model);
    setCreating(false);
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
      tags: textToTags(draft.tags),
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
      // 默认预选「本地还没有」的模型，已存在的由用户自己决定是否覆盖
      const existing = new Set((models ?? []).map((item) => item.modelKey.toLowerCase()));
      setSelectedUpstream(res.models.filter((item) => !existing.has(item.id.toLowerCase())).map((item) => item.id));
      if (res.models.length === 0) toast.error('上游目录为空，请检查 Base URL 与凭证');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉取上游目录失败');
    } finally {
      setFetching(false);
    }
  };

  const runImport = async () => {
    if (selectedUpstream.length === 0) {
      toast.error('请勾选要导入的模型');
      return;
    }
    setImporting(true);
    try {
      const res = await adminChannelsApi.importModels(channelId, selectedUpstream);
      toast.success(`已导入 ${res.added} 个模型，默认停用，请补能力与价格后再启用`);
      setUpstream(null);
      setSelectedUpstream([]);
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
      await adminChannelsApi.removeModel(channelId, deleteTarget.id, deleteReason.trim() || undefined);
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

  const protocolOptions = useMemo(
    () => protocols.map((item) => ({ value: item.id, label: `${item.label}（${item.id}）` })),
    [protocols],
  );

  const rows = models ?? [];

  return (
    <>
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={formOpen ? 980 : 860}
      title={formOpen ? (editing ? `编辑模型 · ${editing.modelKey}` : '新建渠道模型') : `渠道模型 · ${channel?.name ?? ''}`}
      description={
        formOpen
          ? '价格按「积分」输入，最多 6 位小数；保存后立即进入路由目录'
          : '模型是计费与选路的最小单位：能力合同、协议与价格档都在这里定义'
      }
      footer={
        formOpen ? (
          <>
            <Button variant="secondary" size="small" onClick={closeForm} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" size="small" disabled={saving || !writable} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存模型'}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="small"
              leadingIcon={RefreshCw}
              disabled={fetching || !writable}
              onClick={() => void fetchUpstream()}
            >
              {fetching ? '拉取中…' : '拉取上游目录'}
            </Button>
            <Button variant="primary" size="small" leadingIcon={Plus} disabled={!writable} onClick={openCreate}>
              新建模型
            </Button>
          </>
        )
      }
    >
      {formOpen ? (
        <ModelForm
          draft={draft}
          setDraft={setDraft}
          protocolOptions={protocolOptions}
          testResult={testResult}
          testing={testing}
          onTest={async () => {
            if (!editing) {
              toast.error('先保存模型再测试：测试使用库内凭证与能力合同');
              return;
            }
            await runTest(editing);
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {error && (
            <Notice tone="danger" title="模型清单加载失败">
              {error}
            </Notice>
          )}

          {upstream && (
            <Panel
              title="上游目录"
              note="只导入勾选的模型；导入后默认停用，需要补能力合同与价格"
              extra={
                <>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setUpstream(null);
                      setSelectedUpstream([]);
                    }}
                  >
                    收起
                  </Button>
                  <Button
                    variant="primary"
                    size="xs"
                    leadingIcon={UploadCloud}
                    disabled={importing || selectedUpstream.length === 0}
                    onClick={() => void runImport()}
                  >
                    {importing ? '导入中…' : `导入 ${selectedUpstream.length} 个`}
                  </Button>
                </>
              }
            >
              <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
                {upstream.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-background-secondary-default"
                  >
                    <CheckBox
                      size="sm"
                      checked={selectedUpstream.includes(item.id)}
                      onChange={(checked) =>
                        setSelectedUpstream((prev) =>
                          checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                        )
                      }
                      ariaLabel={`选择模型 ${item.id}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">
                      {item.id}
                    </span>
                    <span className="text-[11px] text-text-tertiary">
                      {item.displayName || item.modelType || ''}
                    </span>
                  </label>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title={`模型清单（${rows.length}）`}
            note={writable ? '停用后的模型不会进入路由，但历史账单与调用记录仍保留' : '当前账号只有渠道模型读权限'}
            extra={
              <Button
                variant="secondary"
                size="xs"
                leadingIcon={TrendingUp}
                disabled={!writable || repriceIds.length === 0}
                onClick={() => setRepriceOpen(true)}
              >
                {repriceIds.length > 0 ? `统一调价（${repriceIds.length}）` : '统一调价'}
              </Button>
            }
          >
            {loading && rows.length === 0 ? (
              <p className="py-8 text-center text-xs text-text-tertiary">加载中…</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-xs text-text-tertiary">
                该渠道还没有模型。可以「拉取上游目录」批量导入，或手动新建。
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border-table">
                {rows.map((model) => (
                  <div key={model.id} className="flex items-center gap-3 py-2.5">
                    <CheckBox
                      size="sm"
                      checked={repriceIds.includes(model.id)}
                      disabled={!writable}
                      ariaLabel={`选择模型 ${model.modelKey}`}
                      onChange={(checked) =>
                        setRepriceIds((prev) =>
                          checked ? [...prev, model.id] : prev.filter((id) => id !== model.id),
                        )
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-text-primary">{model.modelKey}</span>
                        <StatusTag
                          status="capability"
                          tone="brand"
                          label={
                            CAPABILITY_OPTIONS.find((item) => item.value === model.capability)?.label ??
                            model.capability
                          }
                        />
                        {model.priceConfigured ? (
                          <StatusTag status="priced" tone="success" label="已定价" />
                        ) : (
                          <HoverTip tip="没有任何已配置的价格档：该模型不会被报价，也不应被线路选用">
                            <StatusTag status="unpriced" tone="warn" label="未定价" />
                          </HoverTip>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
                        {model.displayName} · {model.protocol} · {model.priceTiers.length} 个价格档
                      </div>
                    </div>
                    <SwitchBox
                      checked={model.enabled}
                      disabled={!writable}
                      ariaLabel={`${model.modelKey} 启用`}
                      onChange={(value) => void toggleModel(model, value)}
                    />
                    <Button variant="ghost" size="xs" disabled={testing} onClick={() => void runTest(model)}>
                      测试
                    </Button>
                    <Button variant="ghost" size="xs" disabled={!writable} onClick={() => openEdit(model)}>
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!writable}
                      leadingIcon={Trash2}
                      onClick={() => {
                        setDeleteReason('');
                        setDeleteTarget(model);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {testResult && (
            <Panel title="最近一次测试结果" note={`调用记录 ${testResult.logId || '—'}（非计费）`}>
              <Descriptions
                columns={2}
                items={[
                  {
                    label: '结果',
                    value: (
                      <StatusTag
                        status={testResult.status}
                        tone={testResult.status === 'succeeded' ? 'success' : 'danger'}
                        label={testResult.status === 'succeeded' ? '成功' : testResult.status === 'pending' ? '未完成' : '失败'}
                      />
                    ),
                  },
                  { label: '耗时', value: `${testResult.durationMs}ms` },
                  { label: 'HTTP', value: String(testResult.request?.path ?? '') },
                  {
                    label: '错误',
                    value: testResult.error || testResult.message || '—',
                  },
                  {
                    label: '产出',
                    value: `${testResult.result?.images ?? 0} 图 / ${testResult.result?.videos ?? 0} 视频 / ${testResult.result?.text ? '有文本' : '无文本'}`,
                  },
                ]}
              />
              {testResult.responsePreview && (
                <pre className="mt-3 max-h-[200px] overflow-auto rounded-lg bg-background-secondary-default p-3 font-mono text-[11px] text-text-secondary">
                  {testResult.responsePreview}
                </pre>
              )}
            </Panel>
          )}

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
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => void runDelete()}
            extra={
              <Field label="删除原因" hint="写入审计，建议写清替代模型或下线原因">
                <TextInput
                  ariaLabel="删除原因"
                  value={deleteReason}
                  onChange={setDeleteReason}
                  placeholder="如：上游已下线该模型"
                />
              </Field>
            }
          />
        </div>
      )}

    </Drawer>

      {/*
        调价弹窗与抽屉**平级**（不是抽屉的子节点）：两个 React Aria 模态嵌套时
        焦点作用域会互相抢，关掉弹窗后焦点回不到触发它的那个复选框。
      */}
      {repriceOpen && channelId && (
        <ChannelModelRepriceDialog
          channelId={channelId}
          channelName={channel?.name ?? ''}
          models={rows.filter((model) => repriceIds.includes(model.id))}
          onClose={() => setRepriceOpen(false)}
          onSaved={() => {
            setRepriceIds([]);
            return load();
          }}
        />
      )}
    </>
  );
}

/* ────────────────────────── 模型表单 ────────────────────────── */

function ModelForm({
  draft,
  setDraft,
  protocolOptions,
  testResult,
  testing,
  onTest,
}: {
  draft: ModelDraft;
  setDraft: (next: ModelDraft) => void;
  protocolOptions: Array<{ value: string; label: string }>;
  testResult: ProtocolTestResultView | null;
  testing: boolean;
  onTest: () => Promise<void>;
}) {
  const setTier = (index: number, patch: Partial<TierDraft>) => {
    setDraft({
      ...draft,
      tiers: draft.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="基础信息">
        <div className="grid grid-cols-2 gap-3">
          <Field label="模型标识（对外 modelKey）">
            <TextInput
              ariaLabel="模型标识"
              value={draft.modelKey}
              onChange={(value) => setDraft({ ...draft, modelKey: value })}
              placeholder="如 seedream-4.0"
            />
          </Field>
          <Field label="上游模型名" hint="与 modelKey 不同时填写；留空则同 modelKey">
            <TextInput
              ariaLabel="上游模型名"
              value={draft.providerModelKey}
              onChange={(value) => setDraft({ ...draft, providerModelKey: value })}
              placeholder="如 doubao-seedream-4-0"
            />
          </Field>
          <Field label="展示名" hint="C 端模型选择器显示的名称">
            <TextInput
              ariaLabel="展示名"
              value={draft.displayName}
              onChange={(value) => setDraft({ ...draft, displayName: value })}
              placeholder="如 即梦 4.0"
            />
          </Field>
          <Field label="渠道展示名" hint="留空则沿用展示名">
            <TextInput
              ariaLabel="渠道展示名"
              value={draft.channelLabel}
              onChange={(value) => setDraft({ ...draft, channelLabel: value })}
            />
          </Field>
          <Field label="产出能力">
            <SelectBox
              ariaLabel="产出能力"
              value={draft.capability}
              options={CAPABILITY_OPTIONS}
              onChange={(value) => setDraft({ ...draft, capability: value ?? 'image', protocol: '' })}
            />
          </Field>
          <Field label="请求协议" hint="按能力过滤；空选项说明该能力没有可用协议">
            <SelectBox
              ariaLabel="请求协议"
              value={draft.protocol || undefined}
              options={protocolOptions}
              placeholder={protocolOptions.length === 0 ? '该能力暂无可用协议' : '请选择协议'}
              onChange={(value) => setDraft({ ...draft, protocol: value ?? '' })}
            />
          </Field>
          <Field label="计价货币" hint="通道按 USD/CNY 报价时，展示价按分组汇率折算">
            <SelectBox
              ariaLabel="计价货币"
              value={draft.priceCurrency}
              options={CURRENCY_OPTIONS}
              onChange={(value) => setDraft({ ...draft, priceCurrency: value ?? 'credits' })}
            />
          </Field>
          <Field label="标签" hint="最多 5 个，格式「文字:颜色」，颜色可选 purple/blue/green/gold/orange/pink">
            <TextInput
              ariaLabel="标签"
              value={draft.tags}
              onChange={(value) => setDraft({ ...draft, tags: value })}
              placeholder="如 高清:blue, 推荐:purple"
            />
          </Field>
          <Field label="描述">
            <TextInput
              ariaLabel="描述"
              value={draft.description}
              onChange={(value) => setDraft({ ...draft, description: value })}
              maxLength={500}
            />
          </Field>
          <Field label="图标" hint="C 端选择器图标标识，可留空">
            <TextInput
              ariaLabel="图标"
              value={draft.icon}
              onChange={(value) => setDraft({ ...draft, icon: value })}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border-table px-3 py-2.5">
          <div>
            <div className="text-xs font-medium text-text-primary">启用该模型</div>
            <div className="text-[11px] text-text-tertiary">停用后不进入路由目录，不影响历史数据</div>
          </div>
          <SwitchBox
            checked={draft.enabled}
            ariaLabel="启用该模型"
            onChange={(value) => setDraft({ ...draft, enabled: value })}
          />
        </div>
      </Panel>

      <Panel
        title="价格档"
        note="每一档对应一类规格（分辨率 / 时长 / 尺寸）。全部删除会回落为一个通配档。"
        extra={
          <Button
            variant="ghost"
            size="xs"
            leadingIcon={Plus}
            onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { ...EMPTY_TIER }] })}
          >
            添加档位
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {draft.tiers.map((tier, index) => (
            <div key={index} className="rounded-lg border border-border-table p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">档位 {index + 1}</span>
                <span className="flex-1" />
                <SwitchBox
                  checked={tier.enabled}
                  ariaLabel={`档位 ${index + 1} 启用`}
                  onChange={(checked) => setTier(index, { enabled: checked })}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  leadingIcon={Trash2}
                  disabled={draft.tiers.length <= 1}
                  onClick={() =>
                    setDraft({ ...draft, tiers: draft.tiers.filter((_, i) => i !== index) })
                  }
                >
                  移除
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <Field label="规格条件" hint="key=value，逗号分隔；留空 = 通配">
                  <TextInput
                    ariaLabel={`档位 ${index + 1} 规格条件`}
                    value={tier.selector}
                    onChange={(value) => setTier(index, { selector: value })}
                    placeholder="size=1024x1024, quality=high"
                  />
                </Field>
                <Field label="分辨率档">
                  <TextInput
                    ariaLabel={`档位 ${index + 1} 分辨率`}
                    value={tier.resolution}
                    onChange={(value) => setTier(index, { resolution: value })}
                    placeholder="*"
                  />
                </Field>
                <Field label="视频秒数" hint="按时长计费时必填">
                  <NumberInput
                    ariaLabel={`档位 ${index + 1} 视频秒数`}
                    value={Number(tier.videoSeconds) || 0}
                    min={0}
                    onChange={(value) => setTier(index, { videoSeconds: String(value ?? 0) })}
                  />
                </Field>
                <Field label="计费方式">
                  <SelectBox
                    ariaLabel={`档位 ${index + 1} 计费方式`}
                    value={tier.billingMode}
                    options={BILLING_MODE_OPTIONS}
                    onChange={(value) => setTier(index, { billingMode: value ?? 'fixed_request' })}
                  />
                </Field>
                <Field label="单价（积分）" hint="按次 / 按秒使用">
                  <TextInput
                    ariaLabel={`档位 ${index + 1} 单价`}
                    value={tier.unit}
                    onChange={(value) => setTier(index, { unit: value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="输入 Token 价">
                  <TextInput
                    ariaLabel={`档位 ${index + 1} 输入 Token 价`}
                    value={tier.input}
                    onChange={(value) => setTier(index, { input: value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="输出 Token 价">
                  <TextInput
                    ariaLabel={`档位 ${index + 1} 输出 Token 价`}
                    value={tier.output}
                    onChange={(value) => setTier(index, { output: value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="缓存 Token 价">
                  <TextInput
                    ariaLabel={`档位 ${index + 1} 缓存 Token 价`}
                    value={tier.cached}
                    onChange={(value) => setTier(index, { cached: value })}
                    inputMode="decimal"
                  />
                </Field>
              </div>
              <div className="mt-2 flex items-center gap-4">
                <CheckBox
                  size="sm"
                  checked={tier.priceConfigured}
                  label="价格已确认"
                  onChange={(checked) => setTier(index, { priceConfigured: checked })}
                />
                <CheckBox
                  size="sm"
                  checked={tier.costConfigured}
                  label="记录成本价"
                  onChange={(checked) => setTier(index, { costConfigured: checked })}
                />
              </div>
              {tier.costConfigured && (
                <div className="mt-2 grid grid-cols-4 gap-3">
                  <Field label="成本单价">
                    <TextInput
                      ariaLabel={`档位 ${index + 1} 成本单价`}
                      value={tier.costUnit}
                      onChange={(value) => setTier(index, { costUnit: value })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="输入 Token 成本">
                    <TextInput
                      ariaLabel={`档位 ${index + 1} 输入 Token 成本`}
                      value={tier.costInput}
                      onChange={(value) => setTier(index, { costInput: value })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="输出 Token 成本">
                    <TextInput
                      ariaLabel={`档位 ${index + 1} 输出 Token 成本`}
                      value={tier.costOutput}
                      onChange={(value) => setTier(index, { costOutput: value })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="缓存 Token 成本">
                    <TextInput
                      ariaLabel={`档位 ${index + 1} 缓存 Token 成本`}
                      value={tier.costCached}
                      onChange={(value) => setTier(index, { costCached: value })}
                      inputMode="decimal"
                    />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="能力合同（可选）"
        note="JSON，声明支持的输入素材数量、选项范围与图片尺寸；留空使用能力默认合同"
      >
        <TextArea
          ariaLabel="能力合同 JSON"
          value={draft.capabilityConfig}
          onChange={(value) => setDraft({ ...draft, capabilityConfig: value })}
          rows={8}
          placeholder={'{\n  "inputs": { "image": { "min": 0, "max": 4 } },\n  "options": { "size": { "values": ["1024x1024", "1536x1024"] } }\n}'}
        />
      </Panel>

      <div className="flex items-center gap-3">
        <Button variant="secondary" size="small" leadingIcon={Zap} disabled={testing} onClick={() => void onTest()}>
          {testing ? '测试中…' : '连通性测试'}
        </Button>
        <span className="text-[11px] text-text-tertiary">
          用渠道已保存凭证发一次最小请求，不建任务、不扣费；结果记入调用记录（非计费）。
        </span>
      </div>

      {testResult && (
        <Notice tone={testResult.status === 'succeeded' ? 'success' : 'danger'} title={testResult.status === 'succeeded' ? '测试通过' : '测试失败'}>
          <Descriptions
            columns={2}
            items={[
              { label: '耗时', value: `${testResult.durationMs}ms` },
              { label: '协议', value: testResult.request?.protocol ?? '—' },
              { label: '错误', value: testResult.error || testResult.message || '—' },
              { label: '调用记录', value: testResult.logId || '—' },
            ]}
          />
        </Notice>
      )}
    </div>
  );
}
