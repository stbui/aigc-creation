import { ActionButton, FormField, TextField } from './components';
import type { AdminSettingValue, EmailSettingItem } from './types';
import { emailFieldCopy, settingValueText } from './utils';

/**
 * 单条文本/密钥配置。
 *
 * 三态要给对：正常编辑、已保存密钥（留空表示不覆盖）、待清除（保存后移除）。
 * 把「留空」直接当成清空密钥，会让运维在只想改发件地址时顺手删掉授权码。
 */
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
  onChange: (value: AdminSettingValue) => void;
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
          value={clearPending ? '' : settingValueText(value)}
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
