import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface RadioProps {
  value: string | number;
  checked?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  onChange?: (event: { target: { value: string | number; checked: boolean } }) => void;
}

interface RadioGroupContextValue {
  value?: string | number;
  disabled?: boolean;
  onChange?: (event: { target: { value: string | number; checked: boolean } }) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function RadioItem({ value, checked, disabled, children, className, onChange }: RadioProps) {
  const group = useContext(RadioGroupContext);
  const mergedChecked = group ? String(group.value) === String(value) : checked;
  const mergedDisabled = disabled ?? group?.disabled;
  return (
    <label
      className={cn('ui-radio', mergedChecked && 'is-checked', mergedDisabled && 'is-disabled', className)}
    >
      <input
        type="radio"
        value={String(value)}
        checked={mergedChecked}
        disabled={mergedDisabled}
        onChange={(event) => {
          if (mergedDisabled) return;
          onChange?.({ target: { value, checked: event.target.checked } });
          group?.onChange?.({ target: { value, checked: event.target.checked } });
        }}
      />
      <span>{children}</span>
    </label>
  );
}

function RadioGroup({
  value,
  defaultValue,
  onChange,
  children,
  className,
  optionType,
  buttonStyle,
  disabled,
}: {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string | number; checked: boolean } }) => void;
  children?: ReactNode;
  className?: string;
  optionType?: 'default' | 'button';
  buttonStyle?: 'outline' | 'solid';
  disabled?: boolean;
}) {
  // 受控时完全跟随外层（FormItem 注入）；未受控时自己记住选中值。
  const [innerValue, setInnerValue] = useState<string | number | undefined>(defaultValue);
  const current = value !== undefined ? value : innerValue;
  const context = useMemo<RadioGroupContextValue>(
    () => ({
      value: current,
      disabled,
      onChange: (event) => {
        if (value === undefined) setInnerValue(event.target.value);
        onChange?.(event);
      },
    }),
    [current, disabled, onChange, value],
  );

  return (
    <div
      className={cn(
        optionType === 'button' ? 'ui-radio-group is-button' : 'ui-radio-group',
        buttonStyle === 'solid' && 'is-solid',
        disabled && 'is-disabled',
        className,
      )}
      role="radiogroup"
    >
      <RadioGroupContext.Provider value={context}>{children}</RadioGroupContext.Provider>
    </div>
  );
}

function RadioButton({ value, children, className, disabled, onChange }: RadioProps) {
  const group = useContext(RadioGroupContext);
  const mergedChecked = group ? String(group.value) === String(value) : undefined;
  const mergedDisabled = disabled ?? group?.disabled;
  return (
    <label className={cn('ui-radio-button', mergedChecked && 'is-checked', className)}>
      <input
        type="radio"
        value={String(value)}
        checked={mergedChecked}
        disabled={mergedDisabled}
        onChange={(event) => {
          if (mergedDisabled) return;
          onChange?.({ target: { value, checked: event.target.checked } });
          group?.onChange?.({ target: { value, checked: event.target.checked } });
        }}
      />
      <span>{children}</span>
    </label>
  );
}

/** antd Radio / Radio.Group / Radio.Button 的兼容壳。 */
export const Radio = Object.assign(RadioItem, {
  Group: RadioGroup,
  Button: RadioButton,
});
