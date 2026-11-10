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
    <div className="flex flex-col gap-3">
      <FieldGroup className="grid grid-cols-2 gap-3">
        <ControlledTextField
          control={control}
          name="modelKey"
          label="商品编号"
          hint="用于关联消费它的能力；创建后建议保持不变"
          ariaLabel="商品编号"
          placeholder="如 seedream-4.0"
        />
        <ControlledTextField
          control={control}
          name="displayName"
          label="展示名称"
          hint="展示给用户的商品名称；同一模型请保持一致"
          ariaLabel="展示名称"
          placeholder="如 即梦 4.0"
        />
        <ControlledSelectField
          control={control}
          name="capability"
          label="模型类型"
          ariaLabel="模型类型"
          options={CAPABILITY_OPTIONS}
          onValueChange={onCapabilityChange}
        />
        <ControlledSelectField
          control={control}
          name="protocol"
          label="接入方式"
          hint="按服务商提供的接入方式选择"
          ariaLabel="接入方式"
          options={protocolOptions}
          placeholder={protocolOptions.length === 0 ? '该能力暂无可选接入方式' : '请选择接入方式'}
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
                <FieldTitle>启用该商品</FieldTitle>
                <FieldDescription>
                  停用后新任务不再使用该商品；配置和历史记录会保留
                </FieldDescription>
              </FieldContent>
              <SwitchField
                checked={field.value}
                ariaLabel="启用该商品"
                onChange={field.onChange}
              />
            </Field>
          )}
        />
      </FieldGroup>

      <details className="group rounded-lg border border-border bg-muted/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="text-xs font-semibold text-foreground">高级商品信息</span>
          <span className="text-[12px] text-muted-foreground">
            上游模型名、供应商内名称、展示素材与结算币种
          </span>
        </summary>
        <FieldGroup className="grid grid-cols-2 gap-3 border-t border-border p-3">
          <ControlledTextField
            control={control}
            name="providerModelKey"
            label="上游模型名"
            hint="与商品编号不同时填写；留空则默认相同"
            ariaLabel="上游模型名"
            placeholder="如 doubao-seedream-4-0"
          />
          <ControlledTextField
            control={control}
            name="channelLabel"
            label="供应商内名称"
            hint="用于区分同一模型的不同来源；留空则沿用展示名称"
            ariaLabel="供应商内名称"
            maxLength={80}
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

          <div className="col-span-2">
            <Controller
              control={control}
              name="description"
              render={({ field, fieldState }) => {
                const ids = fieldIds('description');
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={ids.control}>商品介绍</FieldLabel>
                    <TextAreaField
                      id={ids.control}
                      ariaLabel="商品介绍"
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
                        展示在用户端商品选项中，最多 500 字
                      </FieldDescription>
                    )}
                  </Field>
                );
              }}
            />
          </div>
          <ControlledTextField
            control={control}
            name="icon"
            label="商品图标"
            hint="展示在用户端商品选项中，可留空"
            ariaLabel="商品图标"
          />
        </FieldGroup>
      </details>
    </div>
  );
}
