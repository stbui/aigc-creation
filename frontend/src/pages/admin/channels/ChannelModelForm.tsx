import { Plus, Trash2, Zap } from 'lucide-react';
import {
  Button,
  CheckBox,
  Descriptions,
  Notice,
  NumberInput,
  Panel,
  SelectBox,
  SwitchBox,
  TextArea,
  TextInput,
} from './components';
import { Field } from './ChannelField';
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
}: ChannelModelFormProps) {
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
