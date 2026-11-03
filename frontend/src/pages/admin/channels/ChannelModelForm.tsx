import { Plus, Trash2, Zap } from 'lucide-react';
import {
  ActionButton,
  CheckboxField,
  Descriptions,
  Notice,
  NumberField,
  Panel,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import { Field } from './ChannelField';
import { ChannelModelTagsEditor } from './ChannelModelTagsEditor';
import { staleTierUpstream } from './utils';
import {
  BILLING_MODE_OPTIONS,
  CAPABILITY_OPTIONS,
  CURRENCY_OPTIONS,
  EMPTY_TIER,
  type ModelDraft,
  type TierDraft,
} from './constants';
import type { ProtocolTestResultView } from '../../../types/model';

interface ChannelModelFormProps {
  draft: ModelDraft;
  setDraft: (next: ModelDraft) => void;
  protocolOptions: Array<{ value: string; label: string }>;
  testResult: ProtocolTestResultView | null;
  testing: boolean;
  onTest: () => Promise<void>;
  /**
   * 编辑前的模型级上游键。
   *
   * 改了上游名后，仍指向旧上游的档位要提示出来 —— 否则「改了上游却不生效」
   * 会被当成玄学问题排查很久。
   */
  previousProviderModelKey?: string;
  /** 一键让这批档位跟随模型默认上游 */
  onFollowModelUpstream?: () => void;
}

/**
 * 渠道模型表单：基础信息 + 价格档 + 能力合同。
 *
 * 价格按「积分」输入（最多 6 位小数），保存时由父级换算回微积分；
 * 价格档是真实计费单位，不是展示字段。
 */
export function ChannelModelForm({
  draft,
  setDraft,
  protocolOptions,
  testResult,
  testing,
  onTest,
  previousProviderModelKey = '',
  onFollowModelUpstream,
}: ChannelModelFormProps) {
  const setTier = (index: number, patch: Partial<TierDraft>) => {
    setDraft({
      ...draft,
      tiers: draft.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)),
    });
  };

  /** 仍指向旧上游的档位（模型级上游改名后才有） */
  const staleTiers = staleTierUpstream(draft, previousProviderModelKey);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="基础信息">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="模型标识（对外 modelKey）"
            hint="不同渠道下同名标识会被归为同一产品模型；创建后建议保持稳定"
          >
            <TextField
              ariaLabel="模型标识"
              value={draft.modelKey}
              onChange={(value) => setDraft({ ...draft, modelKey: value })}
              placeholder="如 seedream-4.0"
            />
          </Field>
          <Field label="上游模型名" hint="与 modelKey 不同时填写；留空则同 modelKey">
            <TextField
              ariaLabel="上游模型名"
              value={draft.providerModelKey}
              onChange={(value) => setDraft({ ...draft, providerModelKey: value })}
              placeholder="如 doubao-seedream-4-0"
            />
          </Field>
          <Field
            label="展示名"
            hint="C 端模型选择器显示的名称；同名会归到同一产品分组，勿给同一模型在不同渠道起不同名"
          >
            <TextField
              ariaLabel="展示名"
              value={draft.displayName}
              onChange={(value) => setDraft({ ...draft, displayName: value })}
              placeholder="如 即梦 4.0"
            />
          </Field>
          <Field label="渠道展示名" hint="留空则沿用展示名；同一模型在不同渠道用它区分来源">
            <TextField
              ariaLabel="渠道展示名"
              value={draft.channelLabel}
              maxLength={80}
              onChange={(value) => setDraft({ ...draft, channelLabel: value })}
            />
          </Field>
          <Field label="产出能力">
            <SelectField
              ariaLabel="产出能力"
              value={draft.capability}
              options={CAPABILITY_OPTIONS}
              onChange={(value) => setDraft({ ...draft, capability: value ?? 'image', protocol: '' })}
            />
          </Field>
          <Field label="请求协议" hint="按能力过滤；空选项说明该能力没有可用协议">
            <SelectField
              ariaLabel="请求协议"
              value={draft.protocol || undefined}
              options={protocolOptions}
              placeholder={protocolOptions.length === 0 ? '该能力暂无可用协议' : '请选择协议'}
              onChange={(value) => setDraft({ ...draft, protocol: value ?? '' })}
            />
          </Field>
          <Field label="计价货币" hint="通道按 USD/CNY 报价时，展示价按分组汇率折算">
            <SelectField
              ariaLabel="计价货币"
              value={draft.priceCurrency}
              options={CURRENCY_OPTIONS}
              onChange={(value) => setDraft({ ...draft, priceCurrency: value ?? 'credits' })}
            />
          </Field>
          <ChannelModelTagsEditor
            tags={draft.tags}
            onChange={(tags) => setDraft({ ...draft, tags })}
          />
          <Field label="描述" hint="在 C 端模型选项中常驻显示，最多 500 字">
            <TextAreaField
              ariaLabel="描述"
              value={draft.description}
              onChange={(value) => setDraft({ ...draft, description: value })}
              maxLength={500}
              rows={3}
            />
          </Field>
          <Field label="图标" hint="C 端选择器图标标识，可留空">
            <TextField
              ariaLabel="图标"
              value={draft.icon}
              onChange={(value) => setDraft({ ...draft, icon: value })}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <div className="text-xs font-medium text-foreground">启用该模型</div>
            <div className="text-[12px] text-muted-foreground">停用后不进入路由目录，不影响历史数据</div>
          </div>
          <SwitchField
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
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Plus}
            onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { ...EMPTY_TIER }] })}
          >
            添加档位
          </ActionButton>
        }
      >
        <div className="flex flex-col gap-3">
          {draft.tiers.map((tier, index) => (
            <div key={index} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">档位 {index + 1}</span>
                <span className="flex-1" />
                <SwitchField
                  checked={tier.enabled}
                  ariaLabel={`档位 ${index + 1} 启用`}
                  onChange={(checked) => setTier(index, { enabled: checked })}
                />
                <ActionButton
                  variant="ghost"
                  size="xs"
                  icon={Trash2}
                  disabled={draft.tiers.length <= 1}
                  onClick={() =>
                    setDraft({ ...draft, tiers: draft.tiers.filter((_, i) => i !== index) })
                  }
                >
                  移除
                </ActionButton>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <Field label="规格条件" hint="key=value，逗号分隔；留空 = 通配">
                  <TextField
                    ariaLabel={`档位 ${index + 1} 规格条件`}
                    value={tier.selector}
                    onChange={(value) => setTier(index, { selector: value })}
                    placeholder="size=1024x1024, quality=high"
                  />
                </Field>
                <Field label="分辨率档">
                  <TextField
                    ariaLabel={`档位 ${index + 1} 分辨率`}
                    value={tier.resolution}
                    onChange={(value) => setTier(index, { resolution: value })}
                    placeholder="*"
                  />
                </Field>
                <Field label="视频秒数" hint="按时长计费时必填">
                  <NumberField
                    ariaLabel={`档位 ${index + 1} 视频秒数`}
                    value={Number(tier.videoSeconds) || 0}
                    min={0}
                    onChange={(value) => setTier(index, { videoSeconds: String(value ?? 0) })}
                  />
                </Field>
                <Field label="计费方式">
                  <SelectField
                    ariaLabel={`档位 ${index + 1} 计费方式`}
                    value={tier.billingMode}
                    options={BILLING_MODE_OPTIONS}
                    onChange={(value) => setTier(index, { billingMode: value ?? 'fixed_request' })}
                  />
                </Field>
                <Field label="单价（积分）" hint="按次 / 按秒使用">
                  <TextField
                    ariaLabel={`档位 ${index + 1} 单价`}
                    value={tier.unit}
                    onChange={(value) => setTier(index, { unit: value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="输入 Token 价">
                  <TextField
                    ariaLabel={`档位 ${index + 1} 输入 Token 价`}
                    value={tier.input}
                    onChange={(value) => setTier(index, { input: value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="输出 Token 价">
                  <TextField
                    ariaLabel={`档位 ${index + 1} 输出 Token 价`}
                    value={tier.output}
                    onChange={(value) => setTier(index, { output: value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="缓存 Token 价">
                  <TextField
                    ariaLabel={`档位 ${index + 1} 缓存 Token 价`}
                    value={tier.cached}
                    onChange={(value) => setTier(index, { cached: value })}
                    inputMode="decimal"
                  />
                </Field>
              </div>
              <div className="mt-2 flex items-center gap-4">
                <CheckboxField
                  size="sm"
                  checked={tier.priceConfigured}
                  label="价格已确认"
                  onChange={(checked) => setTier(index, { priceConfigured: checked })}
                />
                <CheckboxField
                  size="sm"
                  checked={tier.costConfigured}
                  label="记录成本价"
                  onChange={(checked) => setTier(index, { costConfigured: checked })}
                />
              </div>
              {tier.costConfigured && (
                <div className="mt-2 grid grid-cols-4 gap-3">
                  <Field label="成本单价">
                    <TextField
                      ariaLabel={`档位 ${index + 1} 成本单价`}
                      value={tier.costUnit}
                      onChange={(value) => setTier(index, { costUnit: value })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="输入 Token 成本">
                    <TextField
                      ariaLabel={`档位 ${index + 1} 输入 Token 成本`}
                      value={tier.costInput}
                      onChange={(value) => setTier(index, { costInput: value })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="输出 Token 成本">
                    <TextField
                      ariaLabel={`档位 ${index + 1} 输出 Token 成本`}
                      value={tier.costOutput}
                      onChange={(value) => setTier(index, { costOutput: value })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="缓存 Token 成本">
                    <TextField
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
        <TextAreaField
          ariaLabel="能力合同 JSON"
          value={draft.capabilityConfig}
          onChange={(value) => setDraft({ ...draft, capabilityConfig: value })}
          rows={8}
          placeholder={'{\n  "inputs": { "image": { "min": 0, "max": 4 } },\n  "options": { "size": { "values": ["1024x1024", "1536x1024"] } }\n}'}
        />
      </Panel>

      {staleTiers.length > 0 && (
        <Notice
          tone="warn"
          title={`${staleTiers.length} 个价格档仍指向旧的上游模型`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span>
              模型级上游已改为「{draft.providerModelKey}」，但这些档位仍写着旧的上游名
              （{previousProviderModelKey}），保存后请求仍会发到旧供应商模型。
            </span>
            {onFollowModelUpstream && (
              <ActionButton variant="secondary" size="xs" onClick={onFollowModelUpstream}>
                清除并跟随模型
              </ActionButton>
            )}
          </div>
        </Notice>
      )}

      <div className="flex items-center gap-3">
        <ActionButton variant="secondary" size="sm" icon={Zap} disabled={testing} onClick={() => void onTest()}>
          {testing ? '测试中…' : '连通性测试'}
        </ActionButton>
        <span className="text-[12px] text-muted-foreground">
          用渠道已保存凭证向上游发一次最小请求，可能产生供应商费用；不建任务、不扣用户积分，结果记入调用记录（非计费）。
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
