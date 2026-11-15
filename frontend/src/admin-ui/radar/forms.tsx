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

export type { Tone } from '../primitives/form';

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

/* ────────────────────────── 文本输入 ────────────────────────── */

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

/* ────────────────────────── 数字输入 ────────────────────────── */

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
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        className={cn(
          'h-8 w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface text-[13px] text-radar-ink-900 focus-visible:ring-2 focus-visible:ring-radar-accent/30',
          !value && 'text-radar-ink-400',
          className,
        )}
      >
        <SelectValue placeholder={placeholderText} />
      </SelectTrigger>
      <SelectContent className="rounded-[8px] border border-radar-ink-200 bg-radar-surface shadow-none">
        <SelectGroup>
          {allowClear && <SelectItem value={ALL}>{clearLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="text-[13px] text-radar-ink-900 focus:bg-radar-surface-hover"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/* ────────────────────────── 开关 ────────────────────────── */

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

/* ────────────────────────── 复选 ────────────────────────── */

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

/* ────────────────────────── 滑块 ────────────────────────── */

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

/* ────────────────────────── 语义标签 ────────────────────────── */

export function ToneBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warn' | 'danger';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-radar-ink-100 text-radar-ink-600',
    brand: 'bg-radar-ink-100 text-radar-ink-700',
    success: 'bg-radar-deal-subtle text-radar-deal',
    warn: 'bg-radar-code-subtle text-radar-code',
    danger: 'bg-radar-alert-subtle text-radar-alert',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ────────────────────────── 分段切换 ────────────────────────── */

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

/* ────────────────────────── 可清空输入 ────────────────────────── */

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

/* ────────────────────────── 操作按钮 ────────────────────────── */

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  size = 'sm',
  disabled = false,
  icon: Icon,
  className,
  type = 'button',
  form,
  ariaLabel,
  ariaPressed,
  ariaExpanded,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'xs' | 'sm' | 'default';
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  type?: 'button' | 'submit';
  form?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
}) {
  const v: 'default' | 'secondary' | 'ghost' | 'danger' =
    variant === 'outline' ? 'secondary' : variant === 'destructive' ? 'danger' : variant;
  const s: 'sm' | 'md' = size === 'xs' ? 'sm' : size === 'default' ? 'md' : size;
  return (
    <Button
      type={type}
      form={form}
      variant={v}
      size={s}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      className={className}
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </Button>
  );
}

/* ────────────────────────── 纯图标按钮 ────────────────────────── */

export function IconButton({
  icon: Icon,
  label,
  title,
  size = 'sm',
  disabled = false,
  onClick,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  size?: 'xs' | 'sm' | 'md';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const sizes = { xs: 'size-7', sm: 'size-8', md: 'size-9' } as const;
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn('text-radar-ink-400 hover:bg-radar-ink-100 hover:text-radar-ink-900', sizes[size], className)}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}

/* ────────────────────────── 悬停说明 ────────────────────────── */

export function HelpTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex cursor-help items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-radar-accent/40"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={6}
          className="max-w-[340px] rounded-[8px] border border-radar-ink-200 bg-radar-ink-950 px-3 py-2 text-[12px] leading-relaxed text-white"
        >
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
