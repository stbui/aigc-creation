import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

import { cn } from '../lib/cn';
import {
  Badge,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '../components/ui';

/**
 * shadcn 版表单控件（2026-11-01）。
 *
 * ## 与 `admin-ui/controls/index.tsx` 的关系
 *
 * 两套并存，**按页面边界切**：一个页面要么全用 BoardUI 版控件，要么全用这一套，
 * 不混着用 —— 混用会在同一张表单里出现两套圆角、两套描边色。
 *
 * ## 为什么输入框不直接用 `components/ui/input`
 *
 * shadcn 的 `Input` 本身是原生 `<input>` 加一层类名。后台表单大量存在
 * 「带字数计数 / 右侧清空 / 禁用态 / 数字步进」的组合，直接用会在每个调用点
 * 重复这些样式。这里把项目要的几种形态收成一层，页面写起来仍是原生语义。
 *
 * ## 颜色
 *
 * 全部吃 shadcn 语义令牌（`bg-background` / `border-input` / `text-foreground` /
 * `ring-ring`），由 `admin-ui/styles/shadcn-theme.css` 桥接到项目既有令牌 ——
 * 改品牌色仍然只改 `global.css` 一处。
 */

/* ────────────────────────── 表单字段容器 ────────────────────────── */

/**
 * 字段容器：标签 + 控件 + 说明/错误。
 *
 * 标签在上、控件在下（纵向堆叠）而不是左标签右控件：后台表单的字段名
 * 长短不一（「退款窗口天数」「站点名称」），左对齐标签列会因最长标签把所有
 * 控件推到右边，短字段的控件离它的标签很远。
 *
 * ## 标签与控件的关联
 *
 * `htmlFor` 省略时会自动生成一个 id 并注入子元素 —— 少了这一步，`<label>`
 * 就是一块**没有指代的文字**，屏幕阅读器读不出「这个输入框叫什么」，
 * 而后台 e2e 一律走 `getByLabel`，标签失联等于控件没有可访问名。
 * 调用方给了 `htmlFor` 就用自己的，不覆盖。
 */
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
  const controlId = htmlFor ?? generatedId;

  /*
   * 只在子元素是单个 React 元素、且自己没带 id 时注入。
   * 多个子节点或非元素节点时保持原样 —— 这时只能靠调用方显式传 htmlFor。
   */
  const control = isValidElement(children) && (children.props as { id?: string }).id === undefined
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: controlId })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/*
       * 星号放在 `<label>` **外面**。
       *
       * `<label>` 内嵌星号会让标签的 textContent 变成「变更原因*」，
       * 后台 e2e 一律 `getByLabel('变更原因')` 精确匹配就会失配。
       * 用 `aria-hidden` 只解决屏幕阅读器的可访问名，不解决测试库按
       * textContent 匹配的行为 —— 两者要分开处理。
       */}
      <div className="flex items-center gap-1">
        <Label htmlFor={controlId} className="text-xs font-medium text-foreground">
          {label}
        </Label>
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </div>
      {control}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
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
  /** 右下角显示 `12/80` */
  showCount?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs',
          'transition-[color,box-shadow] outline-none placeholder:text-muted-foreground',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
        )}
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0 text-[10px] tabular-nums text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

/* ────────────────────────── 多行输入 ────────────────────────── */

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
}) {
  return (
    <div className={cn('relative', className)}>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className="resize-none text-sm"
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0 text-[10px] tabular-nums text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

/* ────────────────────────── 数字输入 ────────────────────────── */

/**
 * 数字输入：原生键盘行为 + 右侧步进按钮。
 *
 * 与旧 `NumberInput` 同思路：保留原生 input 的键盘行为，只补一对步进键，
 * `min` / `max` 同时约束手打与步进。
 */
export function NumberField({
  value,
  onChange,
  min = 0,
  max,
  disabled = false,
  ariaLabel,
  id,
  className,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}) {
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
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value === undefined || Number.isNaN(value) ? '' : value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? undefined : clamp(Number(raw)));
        }}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background py-1 pl-3 pr-7 text-sm tabular-nums text-foreground shadow-xs',
          'transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
          // 关掉浏览器原生 spinner：下面自带 ▲▼，两套箭头会叠在一起
          '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
      {!disabled && (
        <div className="absolute right-1 top-1 flex h-7 w-5 flex-col overflow-hidden rounded border border-border">
          <button
            type="button"
            aria-label="增加"
            tabIndex={-1}
            className="flex flex-1 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => step(1)}
          >
            <ChevronUp className="size-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="减少"
            tabIndex={-1}
            className="flex flex-1 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => step(-1)}
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

/**
 * 下拉选择（shadcn `Select`，底层 radix）。
 *
 * 与旧 `SelectBox` 的差别：旧版是 React Aria 的组合件，筛选场景需要在表头
 * 塞一条「全部」哨兵项；shadcn 版没有哨兵值的概念，`undefined` 直接表示
 * 未选中，页面自己决定要不要渲染「全部」这一项。
 */
export function SelectField({
  value,
  onChange,
  options,
  placeholder = '请选择',
  ariaLabel,
  id,
  disabled = false,
  className,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn('w-full bg-background', className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
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
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  /** 无可见标签时（如表格行内开关）用它给出可读名 */
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={onChange}
      className={className}
    >
      {label}
    </Switch>
  );
}

/* ────────────────────────── 语义标签 ────────────────────────── */

export type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

/**
 * 语义标签。
 *
 * 用 shadcn `Badge` 的形状，但颜色走**项目的语义色**（成功 / 警示 / 危险），
 * 不用 Badge 默认的灰阶 —— 后台的标签颜色表达的是业务状态，不是装饰。
 */
export function ToneBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-muted text-muted-foreground',
    brand: 'bg-accent text-accent-foreground',
    success: 'bg-success-soft text-success-text',
    warn: 'bg-warn-soft text-warn-text',
    danger: 'bg-danger-soft text-danger-text',
  };

  return (
    <Badge
      variant="secondary"
      className={cn('rounded-md border-transparent', tones[tone], className)}
    >
      {children}
    </Badge>
  );
}

/* ────────────────────────── 分段切换 ────────────────────────── */

/**
 * 分段页签（胶囊式）。
 *
 * 语义上是「同一份数据按维度切一刀」：维度选项少（2–5 个）且需要常驻可见，
 * 不做成下拉 —— 下拉会把当前维度藏起来。
 */
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
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors',
              'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────── 可清空输入 ────────────────────────── */

/**
 * 带右侧清空按钮的输入。
 *
 * 筛选条件用：清空比「手动逐字删」快，也不依赖键盘选中。
 */
export function ClearableField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  id,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs',
          'transition-[color,box-shadow] outline-none placeholder:text-muted-foreground',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
          value && 'pr-8',
        )}
      />
      {value && !disabled && (
        <button
          type="button"
          aria-label="清空"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ────────────────────────── 操作按钮 ────────────────────────── */

/**
 * 带图标的操作按钮。
 *
 * 图标统一用 lucide（本项目规范）。`variant` / `size` 沿用 shadcn 的语义：
 * `default` 主操作、`secondary` 次操作、`outline` 描边、`ghost` 无边框、
 * `destructive` 危险动作。
 */
export function ActionButton({
  children,
  onClick,
  variant = 'default',
  size = 'sm',
  disabled = false,
  icon: Icon,
  className,
  type = 'button',
  ariaLabel,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'xs' | 'sm' | 'default';
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={className}
    >
      {Icon ? <Icon className="size-4" /> : null}
      {children}
    </Button>
  );
}
