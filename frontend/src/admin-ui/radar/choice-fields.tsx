import type { AriaAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { Slider } from '../components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { NumberField } from './forms';

/* 选择类控件：开关 / 复选 / 滑块 / 分段页签。 */

export function SwitchField({
  checked,
  onChange,
  label,
  disabled = false,
  ariaLabel,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
} & AriaAttributes) {
  const control = (
    <Switch
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      onCheckedChange={onChange}
      className="data-[state=checked]:bg-radar-brand data-[state=unchecked]:bg-radar-ink-300"
    />
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', className)}>
      {control}
      <span className="text-[13px] text-radar-ink-700">{label}</span>
    </label>
  );
}

export function CheckboxField({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  indeterminate = false,
  size = 'md',
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  indeterminate?: boolean;
  size?: 'md' | 'sm';
  className?: string;
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', className)}>
      <Checkbox
        checked={indeterminate ? 'indeterminate' : checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onCheckedChange={(next) => onChange(next === true)}
        className="data-[state=checked]:bg-radar-brand data-[state=checked]:border-radar-brand"
      />
      {label && (
        <span className={cn('text-radar-ink-700', size === 'sm' ? 'text-[12px]' : 'text-[13px]')}>
          {label}
        </span>
      )}
    </label>
  );
}

export function RangeField({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <div className="flex items-center gap-3">
      <Slider
        className="flex-1"
        value={[safe]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        thumbAriaLabel={ariaLabel}
        onValueChange={([next]) => onChange(next)}
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <NumberField
          value={safe}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(next) => onChange(next ?? min)}
          ariaLabel={ariaLabel}
          className="w-20"
        />
        {suffix && <span className="text-[12px] text-radar-ink-400">{suffix}</span>}
      </div>
    </div>
  );
}

export function SegmentedTabs({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className={cn('gap-0', className)}>
      <TabsList aria-label={ariaLabel} className="h-9 gap-1 rounded-[8px] border border-radar-ink-200 bg-radar-surface p-1">
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className="h-7 rounded-[6px] px-3 text-[13px] font-medium data-[state=active]:bg-radar-brand data-[state=active]:text-white"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
export function SegmentedGroup({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
      aria-label={ariaLabel}
      size="sm"
      className={cn('h-9 rounded-[8px] border border-radar-ink-200 bg-radar-surface p-1', className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            'h-7 rounded-[6px] px-3 text-[13px] font-medium text-radar-ink-600 transition-colors',
            'hover:bg-radar-ink-100 hover:text-radar-ink-900',
            'data-[state=on]:bg-radar-brand data-[state=on]:text-white',
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

