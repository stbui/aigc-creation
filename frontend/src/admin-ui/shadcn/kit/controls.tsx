import { useId, useRef, type ComponentType, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Paperclip, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import {
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui';

/**
 * 后台控件套件（shadcn 版，2026-11-01）。
 *
 * ## 存在理由：让迁移只改一个文件
 *
 * 渠道工作台的 17 个文件、4400 行，全部经 `pages/admin/channels/components.ts`
 * 取外部控件（这是该目录自己写下的约定）。这一层把 BoardUI 版控件的**同名同签名**
 * 实现搬过来，于是「整页换观感」等于「换一个 re-export 文件」，业务代码一行不动。
 *
 * ## 与 `admin-ui/controls` 的差别
 *
 * 只是观感：圆角 8px、描边 `border-input`、底色 `bg-background`、聚焦环
 * `ring-ring/50`。交互语义（allowClear 走「全部」哨兵、数字框带步进、
 * 开关的 aria-label 是唯一可读名）全部照搬 —— 后台的 e2e 与运营肌肉记忆
 * 都建立在这些语义上。
 *
 * ## 颜色
 *
 * 全部吃 shadcn 语义令牌，由 `styles/shadcn-theme.css` 桥接到项目既有令牌。
 */

/* ────────────────────────── 按钮 ────────────────────────── */

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'dangerGhost'
  /* 下面是 shadcn 的变体名，等价映射：已迁移页面用 outline / destructive，存量页用 secondary / danger */
  | 'outline'
  | 'destructive';
type ButtonSize = 'medium' | 'small' | 'xs';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  secondary: 'border border-border bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
  outline: 'border border-border bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
  danger: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
  destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
  dangerGhost: 'text-destructive hover:bg-danger-soft hover:text-danger-text',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  medium: 'h-9 gap-1.5 rounded-md px-3.5 text-sm',
  small: 'h-8 gap-1.5 rounded-md px-2.5 text-[13px]',
  xs: 'h-6 gap-1 rounded-md px-2 text-xs',
};

const BUTTON_ICON_ONLY_SIZE: Record<ButtonSize, string> = {
  medium: 'size-9 p-0',
  small: 'size-8 p-0',
  xs: 'size-6 p-0',
};

const BUTTON_ICON_SIZE: Record<ButtonSize, string> = {
  medium: 'size-4',
  small: 'size-4',
  xs: 'size-3.5',
};

/** 图标组件（lucide 组件本身，不是元素） */
type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/**
 * 主 / 次按钮。
 *
 * 签名与 BoardUI 版一致（`variant` / `size` / `iconOnly` / `leadingIcon`），
 * 因此调用点不需要改写。
 */
export function Button({
  variant = 'secondary',
  size = 'medium',
  iconOnly = false,
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  children,
  className,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  children?: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const iconClass = BUTTON_ICON_SIZE[size];

  return (
    <button
      type="button"
      data-variant={variant}
      data-size={size}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANT[variant],
        iconOnly ? BUTTON_ICON_ONLY_SIZE[size] : BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {LeadingIcon && <LeadingIcon className={cn(iconClass, 'shrink-0')} aria-hidden />}
      {!iconOnly && children}
      {TrailingIcon && (
        <TrailingIcon className={cn(iconClass, 'shrink-0')} aria-hidden />
      )}
    </button>
  );
}

/** 图标按钮：`icon` 是组件本身，`aria-label` 必须有 —— 图标不构成可读名 */
export function IconButton({
  icon: Icon,
  size = 'small',
  label,
  title,
  className,
  ...rest
}: {
  icon: IconComponent;
  size?: ButtonSize;
  /** 无障碍名；传 `label` 或 `aria-label` 任一 */
  label?: string;
  title?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={rest['aria-label'] ?? label ?? title}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none',
        'hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_ICON_ONLY_SIZE[size],
        className,
      )}
      {...rest}
    >
      <Icon className={BUTTON_ICON_SIZE[size]} aria-hidden />
    </button>
  );
}

/* ────────────────────────── 文本输入 ────────────────────────── */

const INPUT_CLASS = cn(
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-xs',
  'transition-[color,box-shadow] outline-none placeholder:text-muted-foreground',
  'hover:border-ring/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
);

export function TextInput({
  value,
  onChange,
  placeholder,
  allowClear = false,
  onEnter,
  ariaLabel,
  className,
  inputMode,
  maxLength,
  disabled = false,
  showCount = false,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  onEnter?: () => void;
  ariaLabel?: string;
  className?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  disabled?: boolean;
  showCount?: boolean;
  type?: 'text' | 'date' | 'datetime-local' | 'password';
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className={cn(INPUT_CLASS, allowClear && value && 'pr-7')}
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0.5 text-[10px] tabular-nums text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      )}
      {allowClear && value && !disabled && (
        <button
          type="button"
          aria-label="清空"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ────────────────────────── 多行输入 ────────────────────────── */

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  showCount = false,
  ariaLabel,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  showCount?: boolean;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('relative', className)}>
      <Textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-0 resize-none text-sm"
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0.5 text-[10px] tabular-nums text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

/* ────────────────────────── 数字输入 ────────────────────────── */

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  disabled = false,
  onEnter,
  ariaLabel,
  className,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  onEnter?: () => void;
  ariaLabel?: string;
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
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className={cn(
          INPUT_CLASS,
          'tabular-nums',
          disabled ? 'pr-2.5' : 'pr-7',
          '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
      {!disabled && (
        <div className="absolute right-0 top-0 flex h-8 w-5 flex-col overflow-hidden rounded-r-md border-l border-border">
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

/* ────────────────────────── 开关 / 复选框 ────────────────────────── */

export function SwitchBox({
  checked,
  onChange,
  label,
  disabled = false,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onCheckedChange={onChange}
      />
      {label && <span className="text-sm text-foreground">{label}</span>}
    </div>
  );
}

export function CheckBox({
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
      />
      {label && (
        <span className={cn('text-foreground', size === 'sm' ? 'text-xs' : 'text-sm')}>
          {label}
        </span>
      )}
    </label>
  );
}

/* ────────────────────────── 分段切换 ────────────────────────── */

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

/**
 * 分段控件（筛选 / 视图切换）。
 *
 * 语义是**单选组**，不是页签：切换后同一块区域换的是「过滤条件」，不是
 * 「另一块内容」。用 `tablist` 会让读屏用户以为下面跟着 tabpanel，而且
 * `aria-selected` 与筛选在语义上对不上。这里用 radiogroup + aria-checked，
 * 方向键切换、Tab 只落在当前项上都按单选组处理。
 */
export function SegmentedBox({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  ariaLabel?: string;
  className?: string;
}) {
  const index = options.findIndex((option) => option.value === value);

  /** 方向键在组内移动并直接选中（单选组的惯例）；Tab 只停当前项 */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = options[(Math.max(0, index) + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    const group = event.currentTarget.parentElement;
    const target = group?.querySelector<HTMLButtonElement>(
      `[data-value="${CSS.escape(next.value)}"]`,
    );
    target?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-value={option.value}
            tabIndex={active || (index < 0 && option === options[0]) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex h-6 items-center justify-center rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
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

/* ────────────────────────── 文件选择 ────────────────────────── */

export function FilePick({
  file,
  accept,
  onPick,
  onClear,
  disabled = false,
  label = '选择文件',
  hint,
}: {
  file: File | null;
  accept?: string;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-w-0 shrink items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onPick(next);
          event.target.value = '';
        }}
      />
      <Button
        variant="secondary"
        size="small"
        leadingIcon={Paperclip}
        disabled={disabled}
        title={hint ? `支持 ${hint} 格式` : undefined}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
      {file ? (
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <span className="max-w-[240px] truncate" title={file.name}>
            {file.name}
          </span>
          <button
            type="button"
            aria-label="移除已选文件"
            className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
            disabled={disabled}
            onClick={onClear}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ) : (
        /*
         * 格式说明不再占版面。
         *
         * 渠道列表旁「导入 … 导出全部」这一行的可用宽度只有 200px 左右，
         * 挤三个元素时说明文字会被压成「JS…」，看着像样式坏了。格式约束
         * 本身由 `accept` 在系统文件对话框里过滤，说明文字只保留在
         * `title`（悬停可见）与 `sr-only`（读屏可听）里。
         */
        hint && <span className="sr-only">支持 {hint} 格式</span>
      )}
    </div>
  );
}

/* ────────────────────────── 悬停说明 ────────────────────────── */

export function HoverTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex cursor-help items-center rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-[340px] leading-relaxed">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ────────────────────────── 下拉选择 ────────────────────────── */

export interface SelectOption {
  value: string;
  label: string;
  hint?: ReactNode;
}

/** 「不过滤」哨兵值。radix 的 `Select` 不接受空串 value */
const ALL_KEY = '__all__';

export function SelectBox({
  value,
  onChange,
  options,
  placeholder = '请选择',
  allowClear = false,
  allLabel = '全部',
  ariaLabel,
  className,
  size = 'sm',
  disabled = false,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: SelectOption[];
  placeholder?: string;
  allowClear?: boolean;
  allLabel?: string;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const items = allowClear
    ? [{ value: ALL_KEY, label: allLabel }, ...options.map((o) => ({ value: o.value, label: o.label }))]
    : options.map((o) => ({ value: o.value, label: o.label }));

  return (
    <Select
      value={value ?? (allowClear ? ALL_KEY : undefined)}
      disabled={disabled}
      onValueChange={(next) => onChange(next === ALL_KEY ? undefined : next)}
    >
      <SelectTrigger
        aria-label={ariaLabel ?? placeholder}
        size={size === 'md' ? 'default' : 'sm'}
        className={cn('bg-background', !value && 'text-muted-foreground', className)}
      >
        {/*
         * 未筛选时显示**占位文案**而不是「全部」这一项的文字。
         *
         * 筛选条里并排三个下拉，全写「全部」就分不清哪个是状态、哪个是渠道；
         * 占位文案（「全部状态」「全部能力」）才是这一格的身份标签。选了具体值
         * 之后交给 radix 显示选项自己的文字。
         */}
        <SelectValue placeholder={placeholder}>
          {value === undefined ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ────────────────────────── 表单字段 ────────────────────────── */

export function FormField({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
          {label}
        </Label>
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
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


/* ────────────────────────── 分组页签 ────────────────────────── */

/**
 * 分组页签（下划线式）。
 *
 * 与 `SegmentedTabs` 的分工：那一个是「同一份数据按维度切一刀」的胶囊按钮，
 * 这一个承载**整块内容**（每个页签下是一张表单或一个列表），所以用带下划线
 * 的页签栏 —— 内容区在页签下方，视觉上要能看出归属。
 */
export function TabGroup({
  value,
  onChange,
  tabs,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 每项的 `id` 同时作为内容区的 key */
  tabs: Array<{ id: string; label: ReactNode; content: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className={className}>
      <TabsList aria-label={ariaLabel} className="h-9 w-full justify-start gap-1 bg-transparent p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="h-9 flex-none rounded-none border-b-2 border-transparent px-3 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="mt-3">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/* ────────────────────────── 取色 ────────────────────────── */

/**
 * 颜色选择：原生 `<input type="color">` + 十六进制文本框。
 *
 * 取色器用系统面板而不是自绘拾色器 —— 键盘可操作、浏览器原生无障碍语义，
 * 也不必引入一整族颜色计算依赖。文本框允许手填其它写法，校验交给后端。
 */
export function ColorBox({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        disabled={disabled}
        aria-label={ariaLabel ?? '选择颜色'}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <TextInput
        value={value}
        onChange={onChange}
        placeholder="#rrggbb"
        maxLength={7}
        disabled={disabled}
        ariaLabel={ariaLabel ? `${ariaLabel} 十六进制值` : '颜色十六进制值'}
        className="w-28"
      />
    </div>
  );
}

/* ────────────────────────── 滑块 ────────────────────────── */

/**
 * 数值滑块 + 数字输入（两者同步）。
 *
 * 滑块负责「拖动看效果」，数字框负责「精确落值」—— 只给滑块改一个像素要拖很久，
 * 只给数字框又没有参照。
 */
export function RangeBox({
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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safe}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <NumberInput
          value={safe}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(next) => onChange(next ?? min)}
          ariaLabel={ariaLabel}
          className="w-20"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

/* ────────────────────────── 带建议的文本输入 ────────────────────────── */

/**
 * 带候选建议的文本输入（原生 `<datalist>`）。
 *
 * 候选项由浏览器渲染，零状态、零依赖；代价是只能做前缀匹配、候选不能带说明 ——
 * 字体族之类的候选本来也不需要说明。
 */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        list={listId}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INPUT_CLASS, className)}
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </>
  );
}
