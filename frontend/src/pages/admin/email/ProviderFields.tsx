import {
  ActionButton,
  FormField,
  Notice,
  NumberField,
  SelectField,
  SwitchField,
} from './components';
import { ALIYUN_ADDRESS_TYPE_LABELS, EMAIL_KEYS } from './constants';
import type { AdminSettingValue, EmailProvider, EmailSettingItem } from './types';
import { emailFieldCopy, providerMeta, settingValueText } from './utils';
import { SettingTextField } from './SettingTextField';

/**
 * 按通道渲染各自的凭据字段。
 *
 * `env` / `console` 没有可填字段，只给一段说明 —— 渲染空表单会让人以为「这里
 * 应该填但没加载出来」。SMTP 段额外提供 163 推荐参数一键填充，那是国内运营
 * 最常踩的坑（端口与加密方式不匹配）。
 */
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
  onChange: (key: string, value: AdminSettingValue) => void;
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
          value={settingValueText(valueFor(EMAIL_KEYS.aliyunDmAddressType))}
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
