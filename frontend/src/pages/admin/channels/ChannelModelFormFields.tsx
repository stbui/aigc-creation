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
        label="模型编号"
        hint="用于关联前台模型；创建后建议保持不变"
        ariaLabel="模型编号"
        placeholder="如 seedream-4.0"
      />
      <ControlledTextField
        control={control}
        name="providerModelKey"
        label="服务商模型名称"
        hint="与模型编号不同时填写；留空则默认相同"
        ariaLabel="服务商模型名称"
        placeholder="如 doubao-seedream-4-0"
      />
      <ControlledTextField
        control={control}
        name="displayName"
        label="用户端名称"
        hint="展示给用户的模型名称；同一模型请保持一致"
        ariaLabel="用户端名称"
        placeholder="如 即梦 4.0"
      />
      <ControlledTextField
        control={control}
        name="channelLabel"
        label="渠道内名称"
        hint="用于区分同一模型的不同服务来源；留空则沿用用户端名称"
        ariaLabel="渠道内名称"
        maxLength={80}
      />
      <ControlledSelectField
        control={control}
        name="capability"
        label="能力类型"
        ariaLabel="能力类型"
        options={CAPABILITY_OPTIONS}
        onValueChange={onCapabilityChange}
      />
      <ControlledSelectField
        control={control}
        name="protocol"
        label="接口类型"
        hint="按服务商提供的接口选择"
        ariaLabel="接口类型"
        options={protocolOptions}
        placeholder={protocolOptions.length === 0 ? '该能力暂无可选接口' : '请选择接口类型'}
      />
      <ControlledSelectField
        control={control}
        name="priceCurrency"
        label="结算币种"
        hint="按所选币种展示与结算"
        ariaLabel="结算币种"
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
              <FieldLabel htmlFor={ids.control}>模型介绍</FieldLabel>
              <TextAreaField
                id={ids.control}
                ariaLabel="模型介绍"
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
                  展示在用户端模型选项中，最多 500 字
                </FieldDescription>
              )}
            </Field>
          );
        }}
      />
      <ControlledTextField
        control={control}
        name="icon"
        label="模型图标"
        hint="展示在用户端模型选项中，可留空"
        ariaLabel="模型图标"
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
                停用后新任务不再使用该模型；配置和历史记录会保留
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
