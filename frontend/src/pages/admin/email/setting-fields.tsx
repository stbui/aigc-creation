import {
  ActionButton,
  FormField,
  Notice,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
} from '~/admin-ui/primitives';

import {
  ALIYUN_ADDRESS_TYPE_LABELS,
  EMAIL_KEYS,
  emailFieldCopy,
  providerMeta,
  type EmailProvider,
  type EmailSettingItem,
} from './constants';

export type SettingValue = string | number | boolean | null;

function valueText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/* ────────────────────────── 设置字段 ────────────────────────── */

export function SettingTextField({
  item,
  value,
  disabled,
  clearPending = false,
  onChange,
  onClear,
  onUndoClear,
}: {
  item: EmailSettingItem;
  value: unknown;
  disabled: boolean;
  clearPending?: boolean;
  onChange: (value: SettingValue) => void;
  onClear?: () => void;
  onUndoClear?: () => void;
}) {
  const configured = Boolean(item.hasSecret || item.overridden);
  const showClear = item.sensitive && configured && !clearPending && Boolean(onClear);
  const copy = emailFieldCopy(item.key, item);

  return (
    <FormField
      label={copy.label}
      hint={copy.hint}
      className="min-w-0"
    >
      <div className="flex items-start gap-2">
        <TextField
          key="input"
          value={clearPending ? '' : valueText(value)}
          onChange={(next) => {
            if (item.sensitive && next === '') {
              onChange('');
              return;
            }
            onChange(next);
          }}
          disabled={disabled || clearPending}
          ariaLabel={copy.label}
          type={item.control === 'password' ? 'password' : 'text'}
          maxLength={item.maxLength}
          placeholder={
            item.sensitive && configured && !clearPending
              ? '留空保持当前密钥'
              : copy.placeholder ?? '请输入'
          }
          className="min-w-0 flex-1"
        />
        {showClear && (
          <ActionButton
            key="clear"
            variant="ghost"
            size="xs"
            className="mt-0.5 shrink-0 text-danger-text"
            onClick={onClear}
            ariaLabel={`移除${copy.label}`}
          >
            移除
          </ActionButton>
        )}
        {clearPending && onUndoClear && (
          <ActionButton
            key="restore"
            variant="ghost"
            size="xs"
            className="mt-0.5 shrink-0"
            onClick={onUndoClear}
            ariaLabel={`恢复${copy.label}`}
          >
            恢复
          </ActionButton>
        )}
      </div>
      {item.sensitive ? (
        <p className="text-[12px] leading-4 text-muted-foreground">
          {clearPending
            ? '保存后将移除当前密钥。依赖该密钥的邮件通道可能无法正常发送。'
            : configured
              ? `已保存${item.secretMask ? ` ${item.secretMask}` : ''}；留空不会覆盖现有密钥。`
              : '尚未配置。密钥加密保存，页面不会显示明文。'}
        </p>
      ) : null}
    </FormField>
  );
}

export function ProviderFields({
  provider,
  itemFor,
  valueFor,
  disabled,
  clearPending,
  onChange,
  onClear,
  onUndoClear,
}: {
  provider: EmailProvider;
  itemFor: (key: string) => EmailSettingItem | undefined;
  valueFor: (key: string) => unknown;
  disabled: boolean;
  clearPending: (key: string) => boolean;
  onChange: (key: string, value: SettingValue) => void;
  onClear: (key: string) => void;
  onUndoClear: (key: string) => void;
}) {
  const meta = providerMeta(provider);
  const ProviderIcon = meta.icon;

  if (provider === 'env' || provider === 'console') {
    return (
      <Notice
        tone={provider === 'console' ? 'warn' : 'info'}
        title={provider === 'console' ? '本地记录模式' : '部署环境配置'}
        className="mt-3 mb-0"
      >
        {meta.detail}
        {provider === 'env' ? ' 本页设置的发件地址和发件人名称优先于部署环境默认值。' : null}
      </Notice>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <ProviderIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <p className="m-0 text-[12px] leading-5 text-muted-foreground">{meta.detail}</p>
        </div>
        {provider === 'smtp' ? (
          <ActionButton
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={() => {
              onChange(EMAIL_KEYS.smtpHost, 'smtp.163.com');
              onChange(EMAIL_KEYS.smtpPort, 465);
              onChange(EMAIL_KEYS.smtpSecure, true);
            }}
          >
            使用 163 推荐参数
          </ActionButton>
        ) : null}
      </div>

      {provider === 'http' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {renderTextField(EMAIL_KEYS.httpApiUrl)}
          {renderTextField(EMAIL_KEYS.httpApiKey)}
        </div>
      ) : provider === 'smtp' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {renderTextField(EMAIL_KEYS.smtpHost)}
          {renderPortField()}
          {renderTextField(EMAIL_KEYS.smtpUser)}
          {renderTextField(EMAIL_KEYS.smtpPassword)}
          {renderSecureField()}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {renderTextField(EMAIL_KEYS.aliyunAccessKeyId)}
          {renderTextField(EMAIL_KEYS.aliyunAccessKeySecret)}
          {renderTextField(EMAIL_KEYS.aliyunDmAccountName)}
          {renderAddressType()}
        </div>
      )}
    </div>
  );

  function renderPortField() {
    const item = itemFor(EMAIL_KEYS.smtpPort);
    if (!item) return null;
    const copy = emailFieldCopy(item.key, item);
    const raw = valueFor(EMAIL_KEYS.smtpPort);
    const value = raw === null || raw === undefined || String(raw).trim() === '' ? undefined : Number(raw);
    return (
      <FormField label={copy.label} hint={copy.hint}>
        <NumberField
          value={Number.isFinite(value) ? value : undefined}
          min={item.min ?? 1}
          max={item.max ?? 65535}
          disabled={disabled}
          ariaLabel={copy.label}
          onChange={(next) => onChange(EMAIL_KEYS.smtpPort, next ?? null)}
        />
      </FormField>
    );
  }

  function renderSecureField() {
    const item = itemFor(EMAIL_KEYS.smtpSecure);
    if (!item) return null;
    const copy = emailFieldCopy(item.key, item);
    return (
      <FormField label={copy.label} hint={copy.hint}>
        <SwitchField
          checked={valueFor(EMAIL_KEYS.smtpSecure) !== false}
          disabled={disabled}
          ariaLabel={copy.label}
          label="开启 SSL/TLS 直连"
          onChange={(next) => onChange(EMAIL_KEYS.smtpSecure, next)}
        />
      </FormField>
    );
  }

  function renderTextField(key: string) {
    const item = itemFor(key);
    if (!item) return null;
    return (
      <SettingTextField
        key={key}
        item={item}
        value={valueFor(key)}
        disabled={disabled}
        clearPending={clearPending(key)}
        onChange={(next) => onChange(key, next)}
        onClear={() => onClear(key)}
        onUndoClear={() => onUndoClear(key)}
      />
    );
  }

  function renderAddressType() {
    const item = itemFor(EMAIL_KEYS.aliyunDmAddressType);
    if (!item) return null;
    const copy = emailFieldCopy(item.key, item);
    return (
      <FormField label={copy.label} hint={copy.hint}>
        <SelectField
          ariaLabel={copy.label}
          value={valueText(valueFor(EMAIL_KEYS.aliyunDmAddressType))}
          disabled={disabled}
          onChange={(next) => {
            if (next !== undefined) onChange(EMAIL_KEYS.aliyunDmAddressType, next);
          }}
          options={(item.options ?? ['1', '0']).map((option) => ({
            value: option,
            label: ALIYUN_ADDRESS_TYPE_LABELS[option] ?? item.optionLabels?.[option] ?? option,
          }))}
        />
      </FormField>
    );
  }
}
