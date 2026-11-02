import type { CSSProperties } from 'react';
import { cn } from '../lib/cn';

export interface InputNumberProps {
  value?: number | null;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  onChange?: (value: number | null) => void;
  onPressEnter?: () => void;
}

/** antd InputNumber 的兼容壳：允许清空，越界值交给 min/max。 */
export function InputNumber({
  value,
  defaultValue,
  min,
  max,
  step = 1,
  precision,
  disabled,
  placeholder,
  className,
  style,
  onChange,
  onPressEnter,
}: InputNumberProps) {
  const handleChange = (raw: string) => {
    if (raw.trim() === '') {
      onChange?.(null);
      return;
    }
    let next = Number(raw);
    if (Number.isNaN(next)) return;
    if (precision !== undefined) next = Number(next.toFixed(precision));
    onChange?.(next);
  };

  return (
    <input
      type="number"
      value={value ?? ''}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      className={cn('ui-input-number', className)}
      style={style}
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onPressEnter?.();
      }}
    />
  );
}
