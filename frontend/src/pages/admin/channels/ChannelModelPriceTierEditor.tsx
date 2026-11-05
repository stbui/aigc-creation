import { Controller, useFieldArray, useWatch, type Control } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import {
  ActionButton,
  CheckboxField,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  NumberField,
  Panel,
  SelectField,
  SwitchField,
  TextField,
  type SelectFieldOption,
} from '~/admin-ui/primitives';
import {
  BILLING_MODE_OPTIONS,
  EMPTY_TIER,
  type ModelDraft,
  type TierDraft,
} from './constants';

type TierTextFieldName =
  | 'selector'
  | 'resolution'
  | 'unit'
  | 'input'
  | 'output'
  | 'cached'
  | 'costUnit'
  | 'costInput'
  | 'costOutput'
  | 'costCached';

function TierTextField({
  control,
  index,
  name,
  label,
  ariaLabel,
  hint,
  placeholder,
  inputMode,
}: {
  control: Control<ModelDraft>;
  index: number;
  name: TierTextFieldName;
  label: string;
  ariaLabel: string;
  hint?: string;
  placeholder?: string;
  inputMode?: 'text' | 'decimal';
}) {
  return (
    <Controller
      control={control}
      name={`tiers.${index}.${name}`}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor={`tier-${index}-${name}`}>{label}</FieldLabel>
          <TextField
            id={`tier-${index}-${name}`}
            ariaLabel={ariaLabel}
            value={field.value}
            onChange={field.onChange}
            placeholder={placeholder}
            inputMode={inputMode}
          />
          {hint && (
            <FieldDescription>{hint}</FieldDescription>
          )}
        </Field>
      )}
    />
  );
}

function TierSelectField({
  control,
  index,
  label,
  ariaLabel,
  options,
}: {
  control: Control<ModelDraft>;
  index: number;
  label: string;
  ariaLabel: string;
  options: SelectFieldOption[];
}) {
  return (
    <Controller
      control={control}
      name={`tiers.${index}.billingMode`}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor={`tier-${index}-billing-mode`}>{label}</FieldLabel>
          <SelectField
            id={`tier-${index}-billing-mode`}
            ariaLabel={ariaLabel}
            value={field.value}
            options={options}
            onChange={(value) => field.onChange(value ?? 'fixed_request')}
          />
        </Field>
      )}
    />
  );
}

function TierCheckboxField({
  control,
  index,
  name,
  label,
}: {
  control: Control<ModelDraft>;
  index: number;
  name: 'priceConfigured' | 'costConfigured';
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={`tiers.${index}.${name}`}
      render={({ field }) => (
        <CheckboxField
          size="sm"
          checked={field.value}
          label={label}
          onChange={field.onChange}
        />
      )}
    />
  );
}

/** 价格档编辑器：useFieldArray 管理增删，字段值仍由 RHF 统一持有 */
export function ChannelModelPriceTierEditor({
  control,
  tierError,
}: {
  control: Control<ModelDraft>;
  tierError?: string;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: 'tiers' });
  const tiers = useWatch({ control, name: 'tiers' }) as TierDraft[];

  return (
    <Panel
      title="价格档"
      note="每一档对应一类规格（分辨率 / 时长 / 尺寸）。全部删除会回落为一个通配档。"
      extra={
        <ActionButton
          variant="ghost"
          size="xs"
          icon={Plus}
          onClick={() => append({ ...EMPTY_TIER })}
        >
          添加档位
        </ActionButton>
      }
    >
      <FieldGroup className="gap-3">
        {fields.map((item, index) => {
          const tier = tiers[index] ?? item;
          return (
            <FieldSet key={item.id} className="gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <FieldLegend variant="label" className="mb-0 text-xs text-muted-foreground">
                  档位 {index + 1}
                </FieldLegend>
                <span className="flex-1" />
                <Controller
                  control={control}
                  name={`tiers.${index}.enabled`}
                  render={({ field }) => (
                    <SwitchField
                      checked={field.value}
                      ariaLabel={`档位 ${index + 1} 启用`}
                      onChange={field.onChange}
                    />
                  )}
                />
                <ActionButton
                  variant="ghost"
                  size="xs"
                  icon={Trash2}
                  disabled={fields.length <= 1}
                  onClick={() => remove(index)}
                >
                  移除
                </ActionButton>
              </div>

              <FieldGroup className="grid grid-cols-4 gap-3">
                <TierTextField
                  control={control}
                  index={index}
                  name="selector"
                  label="规格条件"
                  ariaLabel={`档位 ${index + 1} 规格条件`}
                  hint="key=value，逗号分隔；留空 = 通配"
                  placeholder="size=1024x1024, quality=high"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="resolution"
                  label="分辨率档"
                  ariaLabel={`档位 ${index + 1} 分辨率`}
                  placeholder="*"
                />
                <Controller
                  control={control}
                  name={`tiers.${index}.videoSeconds`}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor={`tier-${index}-video-seconds`}>
                        视频秒数
                      </FieldLabel>
                      <NumberField
                        id={`tier-${index}-video-seconds`}
                        ariaLabel={`档位 ${index + 1} 视频秒数`}
                        value={Number(field.value) || 0}
                        min={0}
                        onChange={(value) => field.onChange(String(value ?? 0))}
                      />
                      <FieldDescription>按时长计费时必填</FieldDescription>
                    </Field>
                  )}
                />
                <TierSelectField
                  control={control}
                  index={index}
                  label="计费方式"
                  ariaLabel={`档位 ${index + 1} 计费方式`}
                  options={BILLING_MODE_OPTIONS}
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="unit"
                  label="单价（积分）"
                  ariaLabel={`档位 ${index + 1} 单价`}
                  hint="按次 / 按秒使用"
                  inputMode="decimal"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="input"
                  label="输入 Token 价"
                  ariaLabel={`档位 ${index + 1} 输入 Token 价`}
                  inputMode="decimal"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="output"
                  label="输出 Token 价"
                  ariaLabel={`档位 ${index + 1} 输出 Token 价`}
                  inputMode="decimal"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="cached"
                  label="缓存 Token 价"
                  ariaLabel={`档位 ${index + 1} 缓存 Token 价`}
                  inputMode="decimal"
                />
              </FieldGroup>

              <FieldGroup className="flex-row gap-4">
                <TierCheckboxField
                  control={control}
                  index={index}
                  name="priceConfigured"
                  label="价格已确认"
                />
                <TierCheckboxField
                  control={control}
                  index={index}
                  name="costConfigured"
                  label="记录成本价"
                />
              </FieldGroup>

              {tier.costConfigured && (
                <FieldGroup className="grid grid-cols-4 gap-3">
                  <TierTextField
                    control={control}
                    index={index}
                    name="costUnit"
                    label="成本单价"
                    ariaLabel={`档位 ${index + 1} 成本单价`}
                    inputMode="decimal"
                  />
                  <TierTextField
                    control={control}
                    index={index}
                    name="costInput"
                    label="输入 Token 成本"
                    ariaLabel={`档位 ${index + 1} 输入 Token 成本`}
                    inputMode="decimal"
                  />
                  <TierTextField
                    control={control}
                    index={index}
                    name="costOutput"
                    label="输出 Token 成本"
                    ariaLabel={`档位 ${index + 1} 输出 Token 成本`}
                    inputMode="decimal"
                  />
                  <TierTextField
                    control={control}
                    index={index}
                    name="costCached"
                    label="缓存 Token 成本"
                    ariaLabel={`档位 ${index + 1} 缓存 Token 成本`}
                    inputMode="decimal"
                  />
                </FieldGroup>
              )}
            </FieldSet>
          );
        })}
        {tierError && <FieldError errors={[{ message: tierError }]} />}
      </FieldGroup>
    </Panel>
  );
}
