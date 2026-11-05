import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
  type SelectFieldOption,
} from '~/admin-ui/primitives';
import { ChannelModelTagsEditor } from './ChannelModelTagsEditor';
import { CAPABILITY_OPTIONS, CURRENCY_OPTIONS, type ModelDraft } from './constants';

type BasicTextFieldName =
  | 'modelKey'
  | 'providerModelKey'
  | 'displayName'
  | 'channelLabel'
  | 'icon';

function fieldIds(name: string) {
  return {
    control: `channel-model-${name}`,
    description: `channel-model-${name}-description`,
    error: `channel-model-${name}-error`,
  };
}

function ControlledTextField({
  control,
  name,
  label,
  hint,
  ariaLabel,
  placeholder,
  maxLength,
}: {
  control: Control<ModelDraft>;
  name: BasicTextFieldName;
  label: string;
  hint?: string;
  ariaLabel: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const ids = fieldIds(name);
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={ids.control}>{label}</FieldLabel>
            <TextField
              id={ids.control}
              ariaLabel={ariaLabel}
              value={field.value}
              onChange={field.onChange}
              placeholder={placeholder}
              maxLength={maxLength}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.error ? ids.error : hint ? ids.description : undefined}
            />
            {fieldState.error ? (
              <FieldError id={ids.error} errors={[fieldState.error]} />
            ) : (
              hint && <FieldDescription id={ids.description}>{hint}</FieldDescription>
            )}
          </Field>
        );
      }}
    />
  );
}

function ControlledSelectField({
  control,
  name,
  label,
  hint,
  ariaLabel,
  options,
  placeholder,
  onValueChange,
}: {
  control: Control<ModelDraft>;
  name: 'capability' | 'protocol' | 'priceCurrency';
  label: string;
  hint?: string;
  ariaLabel: string;
  options: SelectFieldOption[];
  placeholder?: string;
  onValueChange?: (value: string, onChange: (value: string) => void) => void;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const ids = fieldIds(name);
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={ids.control}>{label}</FieldLabel>
            <SelectField
              id={ids.control}
              ariaLabel={ariaLabel}
              value={field.value || undefined}
              options={options}
              placeholder={placeholder}
              onChange={(value) => {
                const next = value ?? '';
                if (onValueChange) onValueChange(next, field.onChange);
                else field.onChange(next);
              }}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.error ? ids.error : hint ? ids.description : undefined}
            />
            {fieldState.error ? (
              <FieldError id={ids.error} errors={[fieldState.error]} />
            ) : (
              hint && <FieldDescription id={ids.description}>{hint}</FieldDescription>
            )}
          </Field>
        );
      }}
    />
  );
}

function ControlledTagsField({
  control,
  error,
}: {
  control: Control<ModelDraft>;
  error?: string;
}) {
  return (
    <Controller
      control={control}
      name="tags"
      render={({ field, fieldState }) => (
        <ChannelModelTagsEditor
          tags={field.value}
          onChange={field.onChange}
          error={error ?? fieldState.error?.message}
        />
      )}
    />
  );
}

export function ChannelModelBasicFields({
  control,
  errors,
  protocolOptions,
  onCapabilityChange,
}: {
  control: Control<ModelDraft>;
  errors: FieldErrors<ModelDraft>;
  protocolOptions: SelectFieldOption[];
  onCapabilityChange: (value: string, onChange: (value: string) => void) => void;
}) {
  return (
    <FieldGroup className="grid grid-cols-2 gap-3">
      <ControlledTextField
        control={control}
        name="modelKey"
        label="模型标识（对外 modelKey）"
        hint="不同渠道下同名标识会被归为同一产品模型；创建后建议保持稳定"
        ariaLabel="模型标识"
        placeholder="如 seedream-4.0"
      />
      <ControlledTextField
        control={control}
        name="providerModelKey"
        label="上游模型名"
        hint="与 modelKey 不同时填写；留空则同 modelKey"
        ariaLabel="上游模型名"
        placeholder="如 doubao-seedream-4-0"
      />
      <ControlledTextField
        control={control}
        name="displayName"
        label="展示名"
        hint="C 端模型选择器显示的名称；同名会归到同一产品分组，勿给同一模型在不同渠道起不同名"
        ariaLabel="展示名"
        placeholder="如 即梦 4.0"
      />
      <ControlledTextField
        control={control}
        name="channelLabel"
        label="渠道展示名"
        hint="留空则沿用展示名；同一模型在不同渠道用它区分来源"
        ariaLabel="渠道展示名"
        maxLength={80}
      />
      <ControlledSelectField
        control={control}
        name="capability"
        label="产出能力"
        ariaLabel="产出能力"
        options={CAPABILITY_OPTIONS}
        onValueChange={onCapabilityChange}
      />
      <ControlledSelectField
        control={control}
        name="protocol"
        label="请求协议"
        hint="必选；请按渠道实际的上游接口选择，保存时会校验协议是否支持当前能力"
        ariaLabel="请求协议"
        options={protocolOptions}
        placeholder={protocolOptions.length === 0 ? '该能力暂无可用协议' : '请选择协议'}
      />
      <ControlledSelectField
        control={control}
        name="priceCurrency"
        label="计价货币"
        hint="通道按 USD/CNY 报价时，展示价按分组汇率折算"
        ariaLabel="计价货币"
        options={CURRENCY_OPTIONS}
      />
      <ControlledTagsField control={control} error={errors.tags?.message} />

      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => {
          const ids = fieldIds('description');
          return (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={ids.control}>描述</FieldLabel>
              <TextAreaField
                id={ids.control}
                ariaLabel="描述"
                value={field.value}
                onChange={field.onChange}
                maxLength={500}
                rows={3}
                showCount
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.error ? ids.error : ids.description}
              />
              {fieldState.error ? (
                <FieldError id={ids.error} errors={[fieldState.error]} />
              ) : (
                <FieldDescription id={ids.description}>
                  在 C 端模型选项中常驻显示，最多 500 字
                </FieldDescription>
              )}
            </Field>
          );
        }}
      />
      <ControlledTextField
        control={control}
        name="icon"
        label="图标"
        hint="C 端选择器图标标识，可留空"
        ariaLabel="图标"
      />

      <Controller
        control={control}
        name="enabled"
        render={({ field }) => (
          <Field
            orientation="horizontal"
            className="col-span-2 rounded-lg border border-border px-3 py-2.5"
          >
            <FieldContent>
              <FieldTitle>启用该模型</FieldTitle>
              <FieldDescription>
                停用后不进入路由目录，不影响历史数据
              </FieldDescription>
            </FieldContent>
            <SwitchField
              checked={field.value}
              ariaLabel="启用该模型"
              onChange={field.onChange}
            />
          </Field>
        )}
      />
    </FieldGroup>
  );
}
