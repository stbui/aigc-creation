import { useId, type AriaAttributes, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { findFirstControlId, injectPropsIntoFirstControl } from '../lib/control-injection';
import { cn } from '../lib/cn';
import { Button } from './Button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { Slider } from '../components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';

export type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

/* ────────────────────────── 字段容器 ────────────────────────── */

export function FormField({
  label,
  required = false,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const controlId = findFirstControlId(children) ?? htmlFor ?? generatedId;
  const errorId = `${controlId}-error`;
  const control = injectPropsIntoFirstControl(
    children,
    {
      ...(required ? { 'aria-required': true } : {}),
      ...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}),
    },
    controlId,
  );
  return (
    <div
      className={cn('flex flex-col gap-1.5', className)}
      data-invalid={error ? true : undefined}
      data-required={required || undefined}
    >
      <div className="flex items-center gap-1">
        <label htmlFor={controlId} className="text-[13px] font-medium text-radar-ink-700">
          {label}
        </label>
        {required && (
          <span className="text-radar-alert" aria-hidden>
            *
          </span>
        )}
      </div>
      {control}
      {error ? (
        <p
          id={errorId}
          className="min-w-0 break-words text-[13px] leading-5 text-radar-alert [overflow-wrap:anywhere]"
          role="alert"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="min-w-0 break-words text-[13px] leading-5 text-radar-ink-400 [overflow-wrap:anywhere]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
  id,
  className,
  inputMode,
  maxLength,
  showCount = false,
  onEnter,
  type = 'text',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  showCount?: boolean;
  onEnter?: () => void;
  type?: 'text' | 'email' | 'date' | 'datetime-local' | 'password';
} & AriaAttributes) {
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className="h-8 w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface px-2.5 text-[13px] text-radar-ink-900 placeholder:text-radar-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-accent/30 disabled:cursor-not-allowed disabled:bg-radar-ink-100"
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0 text-[12px] tabular-nums text-radar-ink-400">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}
export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  showCount = false,
  ariaLabel,
  id,
  disabled = false,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  showCount?: boolean;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
} & AriaAttributes) {
  return (
    <div className={cn('relative', className)}>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-[8px] border border-radar-ink-200 bg-radar-surface px-2.5 py-1.5 text-[13px] text-radar-ink-900 placeholder:text-radar-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-accent/30 disabled:cursor-not-allowed disabled:bg-radar-ink-100"
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0 text-[12px] tabular-nums text-radar-ink-400">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min = 0,
  max,
  step: stepSize = 1,
  disabled = false,
  ariaLabel,
  id,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
} & AriaAttributes) {
  const clamp = (next: number) => {
    let result = next;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  };
  const step = (delta: number) => {
    if (disabled) return;
    onChange(clamp((value ?? min ?? 0) + delta));
  };
  return (
    <div
      className={cn(
        'flex h-8 w-full items-center rounded-[8px] border border-radar-ink-200 bg-radar-surface',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value === undefined || Number.isNaN(value) ? '' : value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? undefined : clamp(Number(raw)));
        }}
        className="h-full w-full min-w-0 rounded-[8px] bg-transparent px-2.5 text-right text-[13px] tabular-nums text-radar-ink-900 focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {!disabled && (
        <div className="flex flex-col pr-1">
          <button
            type="button"
            aria-label="增加"
            tabIndex={-1}
            onClick={() => step(stepSize)}
            className="flex h-3.5 items-center text-radar-ink-400 hover:text-radar-ink-900"
          >
            <ChevronUp className="size-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="减少"
            tabIndex={-1}
            onClick={() => step(-stepSize)}
            className="flex h-3.5 items-center text-radar-ink-400 hover:text-radar-ink-900"
          >
            <ChevronDown className="size-3" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── 下拉选择 ────────────────────────── */

export interface SelectFieldOption {
  value: string;
  label: string;
}
export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  clearLabel = '全部',
  allowClear = false,
  ariaLabel,
  id,
  disabled = false,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  clearLabel?: string;
  allowClear?: boolean;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
} & AriaAttributes) {
  const ALL = '__all__';
  const placeholderText = placeholder ?? (allowClear ? clearLabel : '请选择');
  return (
    <Select
      value={value ?? (allowClear ? ALL : undefined)}
      disabled={disabled}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        className={cn(
          'h-8 w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface text-[13px] text-radar-ink-900 shadow-none focus-visible:ring-2 focus-visible:ring-radar-accent/30',
          !value && 'text-radar-ink-400',
          className,
        )}
      >
        {/* 显式 placeholder 优先于 clearLabel：`allowClear` 在触发器里的回显值是
            选项里的「全部」，而 placeholder 表达的是「还没选」。旧实现在这里
            用 children 强制接管，radar 改造后丢了这层判断，导致传了
            placeholder 的调用点仍然显示「全部类型」。 */}
        <SelectValue placeholder={placeholderText}>
          {value === undefined && placeholder ? (
            <span className="text-radar-ink-400">{placeholder}</span>
          ) : undefined}
        </SelectValue>
      </SelectTrigger>
      {/* 门户挂在 body 下，拿不到内容区的 `.radar-scope`，必须显式带上 */}
      <SelectContent className="admin-portal radar-scope rounded-[8px] border border-radar-ink-200 bg-radar-surface shadow-none [&_[data-slot=select-item]]:text-[13px]">
        <SelectGroup>
          {allowClear && <SelectItem value={ALL}>{clearLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ClearableField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  icon,
  id,
  className,
  disabled = false,
  onEnter,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  id?: string;
  className?: string;
  disabled?: boolean;
  onEnter?: () => void;
} & AriaAttributes) {
  return (
    <div
      className={cn(
        'flex h-8 w-full items-center gap-1.5 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-2.5',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {icon && <span className="shrink-0 text-radar-ink-400">{icon}</span>}
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-radar-ink-900 placeholder:text-radar-ink-400 focus-visible:outline-none"
      />
      {value && !disabled && (
        <button
          type="button"
          aria-label="清空"
          onClick={() => onChange('')}
          className="shrink-0 text-radar-ink-400 hover:text-radar-ink-900"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

