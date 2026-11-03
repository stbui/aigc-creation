import * as React from 'react';
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/admin-ui/components/ui/select';
import { cn } from '../lib/cn';

const CLEAR_VALUE = '__clear__';

export interface SelectOption {
  value: string | number;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: any) => void;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  allowClear?: boolean;
  'aria-label'?: string;
}

/** antd Select 的兼容壳：options / value / onChange 语义保持不变。 */
export function Select({
  value,
  defaultValue,
  onChange,
  options = [],
  placeholder = '请选择',
  disabled,
  className,
  style,
  allowClear,
  'aria-label': ariaLabel,
}: SelectProps) {
  const normalizedValue = value === undefined || value === null ? undefined : String(value);
  const normalizedDefaultValue =
    defaultValue === undefined || defaultValue === null ? undefined : String(defaultValue);

  const handleValueChange = (next: string) => {
    if (next === CLEAR_VALUE) {
      onChange?.(undefined);
      return;
    }
    const option = options.find((item) => String(item.value) === next);
    onChange?.(option ? option.value : next);
  };

  return (
    <ShadcnSelect
      value={normalizedValue}
      defaultValue={normalizedDefaultValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn('ui-select-trigger h-9 min-w-0 bg-transparent px-3', className)}
        style={style}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {allowClear && (
            <SelectItem value={CLEAR_VALUE} onPointerDown={(event) => event.preventDefault()}>
              {placeholder}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </ShadcnSelect>
  );
}
