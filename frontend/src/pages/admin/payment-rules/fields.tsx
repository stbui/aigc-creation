import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

import {
  ActionButton,
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
  FilePicker,
  FormField,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  NumberField,
  SelectField,
  Spinner,
  SwitchField,
  TextAreaField,
  TextField,
  ToneBadge,
} from '~/admin-ui/primitives';
import { adminSettingsApi } from '../../../lib/api';
import type { AdminSettingValue } from '../../../types/api';
import {
  PAYMENT_RULE_COPY,
  PAYMENT_RULES_KEYS,
  type PaymentRuleItem,
} from './constants';

function ruleValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function PercentField({
  value,
  disabled,
  label,
  onChange,
}: {
  value: AdminSettingValue;
  disabled: boolean;
  label: string;
  onChange: (value: AdminSettingValue) => void;
}) {
  const percent = Number(value) / 100;
  return (
    <InputGroup className="h-9 bg-background">
      <InputGroupInput
        type="number"
        min={0}
        max={100}
        step={1}
        value={Number.isFinite(percent) ? percent : ''}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === '' ? 0 : Math.round(Number(next) * 100));
        }}
      />
      <InputGroupAddon align="inline-end" className="pr-3">
        <InputGroupText>%</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** 帮助图片：上传成功后只把稳定引用写进草稿，不把临时地址保存到配置。 */
function HelpImageField({
  item,
  value,
  disabled,
  onChange,
}: {
  item: PaymentRuleItem;
  value: AdminSettingValue;
  disabled: boolean;
  onChange: (value: AdminSettingValue) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{ value: string; previewUrl: string } | null>(null);
  const [error, setError] = useState('');
  const copy = PAYMENT_RULE_COPY[item.key];

  useEffect(() => {
    setUploaded((current) =>
      current && current.value !== String(value ?? '') ? null : current,
    );
  }, [value]);

  const currentValue = String(value ?? '');
  const previewUrl =
    currentValue && uploaded?.value === currentValue
      ? uploaded.previewUrl
      : currentValue
        ? item.previewUrl ?? null
        : null;

  const upload = async (next: File) => {
    setFile(next);
    setUploading(true);
    setError('');
    try {
      const result = await adminSettingsApi.uploadImage(next);
      setUploaded({ value: result.value, previewUrl: result.previewUrl });
      onChange(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片上传失败，请重试');
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  return (
    <Field data-disabled={disabled || undefined} className="gap-2 rounded-lg bg-muted/20 p-3">
      <FieldContent>
        <FieldTitle>{copy?.label ?? item.label}</FieldTitle>
        <FieldDescription className="text-[12px] leading-5">
          {copy?.hint ?? item.description}
        </FieldDescription>
      </FieldContent>
      <div className="flex min-h-24 items-center justify-center overflow-hidden rounded-md bg-background">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${copy?.label ?? item.label}预览`}
            className="h-24 w-full object-contain"
          />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[12px] text-muted-foreground">
            <ImageIcon className="size-5" aria-hidden />
            尚未上传帮助图片
          </span>
        )}
      </div>
      {uploading ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Spinner className="size-3.5" aria-hidden />
          正在上传图片…
        </p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <FilePicker
            file={file}
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            onPick={(next) => void upload(next)}
            onClear={() => setFile(null)}
            disabled={disabled}
            label={previewUrl ? '更换帮助图片' : '上传帮助图片'}
            hint="PNG / JPEG / WebP"
          />
          {previewUrl ? (
            <ActionButton
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => {
                setUploaded(null);
                onChange('');
              }}
            >
              移除
            </ActionButton>
          ) : null}
        </div>
      )}
      {error ? <p className="text-[12px] text-danger-text">{error}</p> : null}
    </Field>
  );
}

function RuleControl({
  item,
  value,
  disabled,
  onChange,
}: {
  item: PaymentRuleItem;
  value: AdminSettingValue;
  disabled: boolean;
  onChange: (value: AdminSettingValue) => void;
}) {
  const label = PAYMENT_RULE_COPY[item.key]?.label ?? item.label;

  if (item.key === PAYMENT_RULES_KEYS.refundMaxRatioBps) {
    return <PercentField value={value} disabled={disabled} label={label} onChange={onChange} />;
  }

  if (item.type === 'boolean') {
    return (
      <SwitchField
        checked={Boolean(value)}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={label}
      />
    );
  }

  if (item.type === 'number') {
    if (item.enum?.length) {
      return (
        <SelectField
          value={String(value)}
          onChange={(next) => next !== undefined && onChange(Number(next))}
          options={item.enum.map((next) => ({ value: String(next), label: String(next) }))}
          ariaLabel={label}
          disabled={disabled}
        />
      );
    }
    return (
      <NumberField
        value={value === null ? undefined : Number(value)}
        min={item.min}
        max={item.max}
        onChange={(next) =>
          onChange(item.nullable ? (next ?? null) : Number(next ?? item.default))
        }
        disabled={disabled}
        ariaLabel={label}
      />
    );
  }

  if (item.options?.length) {
    return (
      <SelectField
        value={String(value)}
        onChange={(next) => next !== undefined && onChange(next)}
        options={item.options.map((next) => ({
          value: next,
          label: item.optionLabels?.[next] ?? next,
        }))}
        ariaLabel={label}
        disabled={disabled}
      />
    );
  }

  if (item.key === PAYMENT_RULES_KEYS.helpText) {
    return (
      <TextAreaField
        value={ruleValue(value)}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={label}
        maxLength={item.maxLength}
        rows={5}
        showCount
        placeholder="例如：支付后通常 1 分钟内到账，如有问题请联系客服。"
      />
    );
  }

  return (
    <TextField
      value={ruleValue(value)}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={label}
      maxLength={item.maxLength}
      placeholder={item.maxLength ? `最多 ${item.maxLength} 个字符` : undefined}
    />
  );
}

/** 单项规则控件：运营文案在本地维护，校验范围仍以后端设置定义为准。 */
export function PaymentRuleField({
  item,
  value,
  dirty,
  clearing,
  disabled,
  onChange,
  onRevert,
  onClear,
}: {
  item: PaymentRuleItem;
  value: AdminSettingValue;
  dirty: boolean;
  clearing: boolean;
  disabled: boolean;
  onChange: (value: AdminSettingValue) => void;
  onRevert: () => void;
  onClear: () => void;
}) {
  const copy = PAYMENT_RULE_COPY[item.key];
  const label = copy?.label ?? item.label;
  const hint = copy?.hint ?? item.description;
  const showActions = !disabled && (dirty || clearing || item.overridden);

  if (item.key === PAYMENT_RULES_KEYS.helpImage) {
    return (
      <div className="flex flex-col gap-1.5">
        <HelpImageField item={item} value={value} disabled={disabled} onChange={onChange} />
        {showActions ? (
          <FieldActions
            dirty={dirty}
            clearing={clearing}
            overridden={item.overridden}
            onRevert={onRevert}
            onClear={onClear}
          />
        ) : null}
      </div>
    );
  }

  if (item.type === 'boolean') {
    return (
      <Field
        data-disabled={disabled || undefined}
        orientation="horizontal"
        className="rounded-lg bg-muted/20 p-3"
      >
        <FieldContent>
          <div className="flex flex-wrap items-center gap-2">
            <FieldTitle>{label}</FieldTitle>
            <RuleStateBadge
              dirty={dirty}
              clearing={clearing}
              overridden={item.overridden}
            />
          </div>
          <FieldDescription className="text-[12px] leading-5">{hint}</FieldDescription>
          {showActions ? (
            <FieldActions
              dirty={dirty}
              clearing={clearing}
              overridden={item.overridden}
              onRevert={onRevert}
              onClear={onClear}
            />
          ) : null}
        </FieldContent>
        <RuleControl item={item} value={value} disabled={disabled} onChange={onChange} />
      </Field>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FormField label={label} hint={hint}>
        <RuleControl item={item} value={value} disabled={disabled} onChange={onChange} />
      </FormField>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <RuleStateBadge
          dirty={dirty}
          clearing={clearing}
          overridden={item.overridden}
        />
        {showActions ? (
          <FieldActions
            dirty={dirty}
            clearing={clearing}
            overridden={item.overridden}
            onRevert={onRevert}
            onClear={onClear}
          />
        ) : null}
      </div>
    </div>
  );
}

function RuleStateBadge({
  dirty,
  clearing,
  overridden,
}: {
  dirty: boolean;
  clearing: boolean;
  overridden: boolean;
}) {
  if (clearing) return <ToneBadge tone="warn">保存后恢复默认</ToneBadge>;
  if (dirty) return <ToneBadge tone="warn">未保存</ToneBadge>;
  if (overridden) return <ToneBadge tone="brand">已自定义</ToneBadge>;
  return null;
}

function FieldActions({
  dirty,
  clearing,
  overridden,
  onRevert,
  onClear,
}: {
  dirty: boolean;
  clearing: boolean;
  overridden: boolean;
  onRevert: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {dirty || clearing ? (
        <ActionButton variant="ghost" size="xs" onClick={onRevert}>
          撤销
        </ActionButton>
      ) : null}
      {overridden && !clearing ? (
        <ActionButton variant="ghost" size="xs" onClick={onClear}>
          恢复默认
        </ActionButton>
      ) : null}
    </div>
  );
}
