import { useMemo, useRef } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ActionButton, Notice, Panel } from '~/admin-ui/primitives';
import { ChannelModelBasicFields } from './ChannelModelFormFields';
import { ChannelModelContractField } from './ChannelModelContractField';
import { createDefaultTextCapabilityConfigJson } from './textCapability';
import { ChannelModelImageCapabilityField } from './ChannelModelImageCapabilityField';
import { ChannelModelPriceTierEditor } from './ChannelModelPriceTierEditor';
import { ChannelModelTestPanel } from './ChannelModelTestPanel';
import { modelDraftSchema } from './ChannelModelForm.schema';
import { clearStaleTierUpstream, staleTierUpstream } from './utils';
import { useToast } from './hooks';
import { useProtocolCatalog } from './useChannelModels';
import type { ModelDraft } from './constants';
import type { ImageParameterDefinitionView } from './imageCapability';
import type { ProtocolTestResultView } from '../../../types/model';

export const CHANNEL_MODEL_FORM_ID = 'channel-model-form';

const EMPTY_IMAGE_PARAMETERS: ImageParameterDefinitionView[] = [];

const MODEL_FIELD_LABELS: Array<[keyof ModelDraft, string]> = [
  ['modelKey', '商品编号'],
  ['capability', '模型类型'],
  ['protocol', '接入方式'],
  ['priceCurrency', '结算币种'],
  ['tags', '展示标签'],
  ['description', '商品介绍'],
  ['channelLabel', '供应商内名称'],
  ['capabilityConfig', '能力配置'],
  ['tiers', '售价方案'],
];

function firstFormErrorMessage(errors: FieldErrors<ModelDraft>): string | null {
  for (const [field, label] of MODEL_FIELD_LABELS) {
    const error = errors[field] as
      | { message?: string; root?: { message?: string } }
      | undefined;
    const message = error?.message ?? error?.root?.message;
    if (message) return `${label}：${message}`;
  }
  return null;
}

interface ChannelModelFormProps {
  id?: string;
  draft: ModelDraft;
  testResult: ProtocolTestResultView | null;
  testing: boolean;
  /** 测试当前表单配置（含未保存修改），不要求先保存 */
  onTest: (draft: ModelDraft) => Promise<void>;
  onSubmit: (draft: ModelDraft) => void;
  /** 校验失败时回调；调用方可据此清理“保存并测试”的意图 */
  onInvalid?: () => void;
  /**
   * 编辑前的模型级上游键。
   *
   * 改了上游名后，仍指向旧上游的档位要提示出来 —— 否则「改了上游却不生效」
   * 会被当成玄学问题排查很久。
   */
  previousProviderModelKey?: string;
}

/**
 * 商品表单：基础信息 + 售价方案 + 能力配置。
 *
 * 表单状态完全由 react-hook-form 持有，父级只提供打开弹窗时的初始值和最终
 * 提交值。校验统一走 zod schema，错误就近落到 Field；父级不再保存每次按键。
 */
export function ChannelModelForm({
  id = CHANNEL_MODEL_FORM_ID,
  draft,
  testResult,
  testing,
  onTest,
  onSubmit,
  onInvalid,
  previousProviderModelKey = '',
}: ChannelModelFormProps) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    setValue,
    watch,
  } = useForm<ModelDraft>({
    defaultValues: draft,
    resolver: zodResolver(modelDraftSchema),
    mode: 'onSubmit',
  });

  const values = watch();
  const {
    options: protocolOptions,
    protocols,
    loading: protocolLoading,
  } = useProtocolCatalog(values.capability);
  const selectedProtocol = useMemo(
    () => protocols.find((protocol) => protocol.id === values.protocol),
    [protocols, values.protocol],
  );
  const imageParameterDefinitions = selectedProtocol?.imageParameters ?? EMPTY_IMAGE_PARAMETERS;
  const staleTiers = staleTierUpstream(values, previousProviderModelKey);

  /*
   * 存量模型的协议可能因插件停用而不再可选。下拉里不补这一项会显示空白，
   * 看上去像「没选」，实际表单仍带着旧值；补一项并标出来，运营才知道要改配。
   * 保存时后端也会以「没有运行时执行器」拒绝，两侧口径一致。
   */
  const protocolSelectOptions = useMemo(() => {
    if (!values.protocol || protocolOptions.some((option) => option.value === values.protocol)) {
      return protocolOptions;
    }
    return [...protocolOptions, { value: values.protocol, label: `${values.protocol}（已不可用）` }];
  }, [protocolOptions, values.protocol]);

  const clearStaleTiers = () => {
    const current = getValues();
    const stale = staleTierUpstream(current, previousProviderModelKey);
    if (stale.length === 0) return;
    setValue('tiers', clearStaleTierUpstream(current, stale).tiers, {
      shouldDirty: true,
      shouldValidate: true,
    });
    toast.success(`已清除 ${stale.length} 个方案的上游模型名，改为跟随商品`);
  };

  const focusFirstInvalidField = () => {
    /*
     * 高级区默认折叠：错误控件可能藏在 details 里。先把所有含无效控件的
     * details 展开，再滚动/聚焦，否则用户只看到 toast，找不到要改的字段。
     */
    formRef.current?.querySelectorAll('details').forEach((details) => {
      if (details.querySelector('[aria-invalid="true"]')) details.open = true;
    });
    /*
     * 用 setTimeout(0) 而不是 requestAnimationFrame：jsdom 下 rAF 在密集
     * 断言里可能迟迟不触发，导致「错误已出、焦点还没到」的偶发失败。
     * 下一个宏任务已经晚于 React 的错误状态提交，行为与用户可见结果一致。
     */
    window.setTimeout(() => {
      const firstInvalid = formRef.current?.querySelector<HTMLElement>(
        'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"], button[aria-invalid="true"], [role="combobox"][aria-invalid="true"]',
      );
      if (!firstInvalid) return;
      firstInvalid.scrollIntoView({ block: 'center' });
      firstInvalid.focus({ preventScroll: true });
    }, 0);
  };

  return (
    <form
      ref={formRef}
      id={id}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(
        (next) => onSubmit(next),
        (formErrors) => {
          onInvalid?.();
          toast.error('无法保存商品', firstFormErrorMessage(formErrors) ?? '请检查标红的字段');
          focusFirstInvalidField();
        },
      )}
    >
      <Panel title="商品信息">
        <ChannelModelBasicFields
          control={control}
          errors={errors}
          protocolOptions={protocolSelectOptions}
          onCapabilityChange={(value, onChange) => {
            const previousCapability = getValues('capability');
            onChange(value);
            setValue('protocol', '', { shouldDirty: true });
            if (previousCapability !== value) {
              setValue(
                'capabilityConfig',
                value === 'text' ? createDefaultTextCapabilityConfigJson() : '',
                { shouldDirty: true, shouldValidate: false },
              );
            }
          }}
        />
      </Panel>

      <ChannelModelPriceTierEditor
        control={control}
        tierError={errors.tiers?.root?.message}
      />

      <details className="group rounded-xl border border-border bg-muted/20">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-xs font-semibold text-foreground">高级：能力参数</span>
          <span className="text-[12px] text-muted-foreground">
            参考素材限制、可用参数与响应格式；默认使用推荐值
          </span>
        </summary>
        <div className="border-t border-border p-3">
          {values.capability === 'image' ? (
            <ChannelModelImageCapabilityField
              control={control}
              protocol={values.protocol}
              protocolLabel={selectedProtocol?.label}
              protocolLoading={protocolLoading}
              definitions={imageParameterDefinitions}
              model={values.providerModelKey.trim() || values.modelKey.trim()}
              setValue={setValue}
            />
          ) : (
            <ChannelModelContractField control={control} capability={values.capability} />
          )}
        </div>
      </details>

      {staleTiers.length > 0 && (
        <Notice tone="warn" title={`${staleTiers.length} 个售价方案仍使用旧的上游模型名`}>
          <div className="flex flex-wrap items-center gap-2">
            <span>
              商品的上游模型名已改为「{values.providerModelKey}」，但这些方案仍使用旧名称
              （{previousProviderModelKey}），保存后请求仍会发到旧上游模型。
            </span>
            <ActionButton variant="secondary" size="xs" onClick={clearStaleTiers}>
              清除并跟随模型
            </ActionButton>
          </div>
        </Notice>
      )}

      <ChannelModelTestPanel
        testResult={testResult}
        testing={testing}
        onTest={() => onTest(getValues())}
      />
    </form>
  );
}
