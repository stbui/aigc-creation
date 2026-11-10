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

function TierSaleFields({
  control,
  index,
  mode,
}: {
  control: Control<ModelDraft>;
  index: number;
  mode: string;
}) {
  if (mode === 'token') {
    return (
      <>
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
      </>
    );
  }
  return (
    <TierTextField
      control={control}
      index={index}
      name="unit"
      label={mode === 'per_second' ? '每秒价格（积分）' : '价格（积分）'}
      ariaLabel={`方案 ${index + 1} 价格`}
      hint="按次或按秒计价时填写"
      inputMode="decimal"
    />
  );
}

/**
 * 售价编辑器：默认只露一条全规格售价。
 *
 * 规格条件、分辨率、时长、成本价与多方案开关都在“高级价格设置”里。
 * 售价填了非零值即视为已定价；只有 0 积分免费商品需要显式勾选
 * 「按 0 积分免费提供」—— 取消“价格已核对”后，漏勾不再让整条商品
 * 静默变成未定价。
 */
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
      title="售价"
      note="默认一条全规格售价；需要按规格或成本定价时再展开高级。"
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
          const mode = tier?.billingMode ?? item.billingMode;
          return (
            <FieldSet key={item.id} className="gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <FieldLegend variant="label" className="mb-0 text-xs text-muted-foreground">
                  方案 {index + 1}
                </FieldLegend>
                <span className="flex-1" />
                {fields.length > 1 && (
                  <ActionButton
                    variant="ghost"
                    size="xs"
                    icon={Trash2}
                    onClick={() => remove(index)}
                  >
                    移除
                  </ActionButton>
                )}
              </div>

              <FieldGroup className="grid grid-cols-4 gap-3">
                <TierSelectField
                  control={control}
                  index={index}
                  label="计价方式"
                  ariaLabel={`方案 ${index + 1} 计价方式`}
                  options={BILLING_MODE_OPTIONS}
                />
                <TierSaleFields control={control} index={index} mode={mode} />
              </FieldGroup>

              <details className="group rounded-lg border border-border bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className="text-xs font-semibold text-foreground">高级价格设置</span>
                  <span className="text-[12px] text-muted-foreground">
                    规格条件、成本价与免费开关
                  </span>
                </summary>
                <div className="flex flex-col gap-3 border-t border-border p-3">
                  <FieldGroup className="grid grid-cols-3 gap-3">
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
                  </FieldGroup>

                  <FieldGroup className="flex-row items-center gap-4">
                    <Controller
                      control={control}
                      name={`tiers.${index}.enabled`}
                      render={({ field }) => (
                        <SwitchField
                          checked={field.value}
                          label="启用该方案"
                          ariaLabel={`方案 ${index + 1} 启用`}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <TierCheckboxField
                      control={control}
                      index={index}
                      name="priceConfigured"
                      label="按 0 积分免费提供"
                    />
                  </FieldGroup>

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
                </div>
              </details>
            </FieldSet>
          );
        })}
        {tierError && <FieldError errors={[{ message: tierError }]} />}
      </FieldGroup>
    </Panel>
  );
}
