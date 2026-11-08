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
      title="价格方案"
      note="按规格或用量设置不同价格。"
      extra={
        <ActionButton
          variant="ghost"
          size="xs"
          icon={Plus}
          onClick={() => append({ ...EMPTY_TIER })}
        >
          添加方案
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
                  方案 {index + 1}
                </FieldLegend>
                <span className="flex-1" />
                <Controller
                  control={control}
                  name={`tiers.${index}.enabled`}
                  render={({ field }) => (
                    <SwitchField
                      checked={field.value}
                      ariaLabel={`方案 ${index + 1} 启用`}
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
                  label="适用规格"
                  ariaLabel={`方案 ${index + 1} 适用规格`}
                  hint="按接口参数填写；留空表示全部规格"
                  placeholder="size=1024x1024, quality=high"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="resolution"
                  label="适用分辨率"
                  ariaLabel={`方案 ${index + 1} 适用分辨率`}
                  placeholder="*"
                />
                <Controller
                  control={control}
                  name={`tiers.${index}.videoSeconds`}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor={`tier-${index}-video-seconds`}>
                        适用时长（秒）
                      </FieldLabel>
                      <NumberField
                        id={`tier-${index}-video-seconds`}
                        ariaLabel={`方案 ${index + 1} 适用时长（秒）`}
                        value={Number(field.value) || 0}
                        min={0}
                        onChange={(value) => field.onChange(String(value ?? 0))}
                      />
                      <FieldDescription>按使用时长计价时填写</FieldDescription>
                    </Field>
                  )}
                />
                <TierSelectField
                  control={control}
                  index={index}
                  label="计价方式"
                  ariaLabel={`方案 ${index + 1} 计价方式`}
                  options={BILLING_MODE_OPTIONS}
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="unit"
                  label="价格（积分）"
                  ariaLabel={`方案 ${index + 1} 价格`}
                  hint="按次或按秒计价时填写"
                  inputMode="decimal"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="input"
                  label="输入用量价格"
                  ariaLabel={`方案 ${index + 1} 输入用量价格`}
                  inputMode="decimal"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="output"
                  label="输出用量价格"
                  ariaLabel={`方案 ${index + 1} 输出用量价格`}
                  inputMode="decimal"
                />
                <TierTextField
                  control={control}
                  index={index}
                  name="cached"
                  label="缓存内容价格"
                  ariaLabel={`方案 ${index + 1} 缓存内容价格`}
                  inputMode="decimal"
                />
              </FieldGroup>

              <FieldGroup className="flex-row gap-4">
                <TierCheckboxField
                  control={control}
                  index={index}
                  name="priceConfigured"
                  label="价格已核对"
                />
                <TierCheckboxField
                  control={control}
                  index={index}
                  name="costConfigured"
                  label="同时记录成本"
                />
              </FieldGroup>

              {tier.costConfigured && (
                <FieldGroup className="grid grid-cols-4 gap-3">
                  <TierTextField
                    control={control}
                    index={index}
                    name="costUnit"
                    label="成本单价"
                    ariaLabel={`方案 ${index + 1} 成本单价`}
                    inputMode="decimal"
                  />
                  <TierTextField
                    control={control}
                    index={index}
                    name="costInput"
                    label="输入用量成本"
                    ariaLabel={`方案 ${index + 1} 输入用量成本`}
                    inputMode="decimal"
                  />
                  <TierTextField
                    control={control}
                    index={index}
                    name="costOutput"
                    label="输出用量成本"
                    ariaLabel={`方案 ${index + 1} 输出用量成本`}
                    inputMode="decimal"
                  />
                  <TierTextField
                    control={control}
                    index={index}
                    name="costCached"
                    label="缓存内容成本"
                    ariaLabel={`方案 ${index + 1} 缓存内容成本`}
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
