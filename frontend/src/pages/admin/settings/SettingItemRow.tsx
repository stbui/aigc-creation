import { Link } from 'react-router-dom';
import { ActionButton, NumberField, SelectField, SwitchField, TextField, ToneBadge } from '~/admin-ui/primitives';
import type { AdminSettingValue } from '../../../types/api';
import type { SettingItem } from './constants';
import { displayValue } from './utils';

function renderControl({
  item,
  value,
  editable,
  onChange,
}: {
  item: SettingItem;
  value: AdminSettingValue;
  editable: boolean;
  onChange: (value: AdminSettingValue) => void;
}) {
  if (item.readOnly) {
    /* 只读值不画成输入框：它不是可编辑控件，画成禁用输入框会让人反复去点 */
    return (
      <span className="inline-flex min-h-8 items-center text-right text-[13px] font-medium text-foreground">
        {displayValue(item.value, item.type)}
      </span>
    );
  }

  if (item.type === 'boolean') {
    return (
      <SwitchField
        checked={Boolean(value)}
        onChange={(checked) => onChange(checked)}
        disabled={!editable}
        ariaLabel={item.label}
      />
    );
  }

  if (item.type === 'number') {
    if (item.enum && item.enum.length > 0) {
      return (
        <SelectField
          value={String(value)}
          onChange={(next) => next !== undefined && onChange(Number(next))}
          options={item.enum.map((next) => ({ value: String(next), label: String(next) }))}
          ariaLabel={item.label}
          disabled={!editable}
          className="w-40"
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
        disabled={!editable}
        ariaLabel={item.label}
        className="w-40"
      />
    );
  }

  if (item.type === 'string' && item.options?.length) {
    return (
      <SelectField
        value={String(value)}
        onChange={(next) => next !== undefined && onChange(next)}
        options={item.options.map((next) => ({
          value: next,
          label: item.optionLabels?.[next] ?? next,
        }))}
        ariaLabel={item.label}
        disabled={!editable}
        className="w-40"
      />
    );
  }

  return (
    <TextField
      value={String(value)}
      onChange={(next) => onChange(next)}
      disabled={!editable}
      ariaLabel={item.label}
      maxLength={item.maxLength}
      className="w-full"
    />
  );
}

/** 单个配置项：左侧说明与元信息、右侧控件，以及只在该项可操作时出现的行内动作。 */
export function SettingItemRow({
  item,
  value,
  isDraft,
  isClearing,
  editable,
  onChange,
  onRevert,
  onClear,
}: {
  item: SettingItem;
  value: AdminSettingValue;
  isDraft: boolean;
  isClearing: boolean;
  editable: boolean;
  onChange: (value: AdminSettingValue) => void;
  onRevert: () => void;
  onClear: () => void;
}) {
  const showActions = !item.readOnly && (isDraft || isClearing || (item.overridden && editable));

  return (
    <div className="flex items-start gap-6 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{item.label}</span>
          {item.readOnly && <ToneBadge tone="neutral">只读</ToneBadge>}
          {item.overridden && !isClearing && (
            <ToneBadge tone="brand">
              <span title="已覆盖代码默认值">已自定义</span>
            </ToneBadge>
          )}
          {isClearing && <ToneBadge tone="warn">待恢复默认</ToneBadge>}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{item.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <span>默认值：{displayValue(item.default, item.type)}</span>
          {item.type === 'number' && (item.min !== undefined || item.max !== undefined) && (
            <span>
              取值范围 {item.min ?? '—'} ~ {item.max ?? '—'}
            </span>
          )}
          {item.updatedBy && (
            <span>
              上次修改：{item.updatedBy}
              {item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleString('zh-CN')}` : ''}
            </span>
          )}
          {item.linkTo && (
            <Link className="text-brand hover:underline" to={item.linkTo}>
              前往配置 →
            </Link>
          )}
        </div>
      </div>

      {/* 控件列固定 240：不同分组的输入框右边缘落在同一条竖线上 */}
      <div className="flex w-[240px] shrink-0 flex-col items-end gap-1">
        <div className="flex w-full justify-end">{renderControl({ item, value, editable, onChange })}</div>
        {showActions && (
          <div className="flex items-center gap-1">
            {(isDraft || isClearing) && (
              <ActionButton variant="ghost" size="xs" onClick={onRevert} disabled={!editable}>
                撤销
              </ActionButton>
            )}
            {item.overridden && !isClearing && editable && (
              <ActionButton variant="ghost" size="xs" onClick={onClear}>
                恢复默认
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
