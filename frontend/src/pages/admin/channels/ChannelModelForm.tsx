import { useMemo, useRef } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ActionButton, Notice, Panel } from '~/admin-ui/primitives';
import { ChannelModelBasicFields } from './ChannelModelFormFields';
import { ChannelModelContractField } from './ChannelModelContractField';
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
  ['modelKey', '模型标识'],
  ['capability', '产出能力'],
  ['protocol', '请求协议'],
  ['priceCurrency', '计价货币'],
  ['tags', '展示标签'],
  ['description', '描述'],
  ['channelLabel', '渠道展示名'],
  ['capabilityConfig', '图片能力参数'],
  ['tiers', '价格档'],
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
  onTest: () => Promise<void>;
  onSubmit: (draft: ModelDraft) => void;
  /**
   * 编辑前的模型级上游键。
   *
   * 改了上游名后，仍指向旧上游的档位要提示出来 —— 否则「改了上游却不生效」
   * 会被当成玄学问题排查很久。
   */
  previousProviderModelKey?: string;
}

/**
 * 渠道模型表单：基础信息 + 价格档 + 能力合同。
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

  const clearStaleTiers = () => {
    const current = getValues();
    const stale = staleTierUpstream(current, previousProviderModelKey);
    if (stale.length === 0) return;
    setValue('tiers', clearStaleTierUpstream(current, stale).tiers, {
      shouldDirty: true,
      shouldValidate: true,
    });
    toast.success(`已清除 ${stale.length} 个档位的独立上游名，改为跟随模型`);
  };

  const focusFirstInvalidField = () => {
    window.requestAnimationFrame(() => {
      const firstInvalid = formRef.current?.querySelector<HTMLElement>(
        'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"], button[aria-invalid="true"], [role="combobox"][aria-invalid="true"]',
      );
      if (!firstInvalid) return;
      firstInvalid.scrollIntoView({ block: 'center' });
      firstInvalid.focus({ preventScroll: true });
    });
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
          toast.error('无法保存模型', firstFormErrorMessage(formErrors) ?? '请检查标红的字段');
          focusFirstInvalidField();
        },
      )}
    >
      <Panel title="基础信息">
        <ChannelModelBasicFields
          control={control}
          errors={errors}
          protocolOptions={protocolOptions}
          onCapabilityChange={(value, onChange) => {
            onChange(value);
            setValue('protocol', '', { shouldDirty: true });
          }}
        />
      </Panel>

      <ChannelModelPriceTierEditor
        control={control}
        tierError={errors.tiers?.root?.message}
      />

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
        <ChannelModelContractField control={control} />
      )}

      {staleTiers.length > 0 && (
        <Notice tone="warn" title={`${staleTiers.length} 个价格档仍指向旧的上游模型`}>
          <div className="flex flex-wrap items-center gap-2">
            <span>
              模型级上游已改为「{values.providerModelKey}」，但这些档位仍写着旧的上游名
              （{previousProviderModelKey}），保存后请求仍会发到旧供应商模型。
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
        onTest={onTest}
      />
    </form>
  );
}
