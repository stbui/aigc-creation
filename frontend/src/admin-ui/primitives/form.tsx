import { useId, type AriaAttributes, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

import { cn } from '../lib/cn';
import { findFirstControlId, injectPropsIntoFirstControl } from '../lib/control-injection';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../components/ui/input-group';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';

/**
 * 后台表单控件。
 *
 * ## 为什么不直接用 `components/ui/*`
 *
 * shadcn 的原子件是「一个输入框」，后台真正需要的是「一个字段」：
 * 标签 + 控件 + 说明或错误 + 必填标记。这层把组合形态收成一次调用，
 * 页面写起来仍是原生语义，但不再每个调用点重复排版。
 *
 * 原子件（`components/ui`）只在这里被引用 —— 页面不直连。
 *
 * ## 圆角与高度
 *
 * 控件统一 `rounded-md`（8px，控件档）。`styles/admin.css` 把 Tailwind 的
 * radius 命名空间重映射到项目五档，所以 `rounded-md` 就是 8px，不是默认的 6px。
 *
 * 控件高度统一 `h-8`（32px）。这不是随手选的：筛选条里输入框、下拉和按钮
 * 并排一行，**高度不齐会让 `align-items: center` 把它们推到不同的 top 偏移**，
 * 视觉上是「错位一行」，量测上也是「换行」。三档控件共用一个高度档才排得齐。
 */

type ControlAriaProps = Pick<
  AriaAttributes,
  'aria-describedby' | 'aria-invalid' | 'aria-required'
>;

/* ────────────────────────── 字段容器 ────────────────────────── */

/**
 * 字段容器：标签在上，控件在下。
 *
 * 竖排而不是「左标签右控件」：字段名长短不一（「退款窗口天数」 vs 「备注」），
 * 左对齐标签列会被最长的那条把所有控件推到右边，短字段的控件离标签很远。
 *
 * ## 标签与控件的关联
 *
 * 调用方不传 `htmlFor` 时，这里生成一个 id 并注入唯一子元素。没有这层关联，
 * `<label>` 就是一块没有指代的文字 —— 屏幕阅读器读不出输入框叫什么，e2e 的
 * `getByLabel` 也找不到它。
 *
 * 必填星号放在 `<label>` **外面**：放里面会让标签的 textContent 变成
 * 「退款窗口天数*」，精确匹配的 `getByLabel('退款窗口天数')` 就失配了。
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
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/* ────────────────────────── 文本输入 ────────────────────────── */

/** 单行文本输入：支持字数计数、回车提交、数字键盘。 */
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
  /** 右下角显示 `12/80` */
  showCount?: boolean;
  onEnter?: () => void;
  /** 原生输入类型：日期 / 日期时间 / 密码走浏览器原生控件 */
  type?: 'text' | 'date' | 'datetime-local' | 'password';
} & ControlAriaProps) {
  return (
    <div className={cn('relative', className)}>
      <Input
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
        className="h-8 bg-background text-sm disabled:bg-muted"
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute right-0 -bottom-4 text-[12px] text-muted-foreground tabular-nums">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

/** 多行文本输入。 */
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
} & ControlAriaProps) {
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
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        onChange={(event) => onChange(event.target.value)}
        className="resize-none text-sm"
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute right-0 -bottom-4 text-[12px] text-muted-foreground tabular-nums">
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
 * 浏览器原生 spinner 必须关掉 —— 下面自带 ▲▼，不关会在右侧再叠一组黑色三角，
 * Chrome 上还会溢出圆角边框。
 */
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
} & ControlAriaProps) {
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
    /* 输入框 + 尾部步进按钮：走 shadcn `InputGroup`，与 `ClearableField` 同一套组合件 */
    <InputGroup className={cn('h-8 bg-background', className)}>
      <InputGroupInput
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
        className={cn(
          'h-8 text-right text-sm tabular-nums',
          '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
      {!disabled && (
        /* 上下步进竖排：与原生 number 输入框的步进器一致，横排会被误读成两个独立按钮 */
        <InputGroupAddon align="inline-end" className="flex-col gap-0 py-0 pr-0.5">
          <InputGroupButton
            size="icon-xs"
            aria-label="增加"
            tabIndex={-1}
            onClick={() => step(stepSize)}
            className="h-3.5 text-muted-foreground hover:text-foreground [&_svg]:size-3"
          >
            <ChevronUp aria-hidden />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label="减少"
            tabIndex={-1}
            onClick={() => step(-stepSize)}
            className="h-3.5 text-muted-foreground hover:text-foreground [&_svg]:size-3"
          >
            <ChevronDown aria-hidden />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/* ────────────────────────── 下拉选择 ────────────────────────── */

export interface SelectFieldOption {
  value: string;
  label: string;
}

/**
 * 下拉选择（radix `Select`）。`undefined` 表示未选中，由调用方决定是否给「全部」项。
 *
 * `allowClear` 渲染一个「全部」项：radix Select 的受控值无法直接清空，
 * 只能靠一个真实存在的选项回落到 `undefined` —— 筛选条里「全部角色」就是
 * 这个位置。
 *
 * ## 未选中时显示占位文案，而不是「全部」这一项的文字
 *
 * 筛选条里并排三个下拉，全写「全部」就分不清哪个是状态、哪个是渠道；
 * 占位文案（「全部状态」「全部能力」）才是这一格的身份标签。选了具体值之后
 * 交给 radix 显示选项自己的文字。
 */
export function SelectField({
  value,
  onChange,
  options,
  placeholder = '请选择',
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
  /** `allowClear` 时的「全部」项文案 */
  clearLabel?: string;
  allowClear?: boolean;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
} & ControlAriaProps) {
  const ALL = '__all__';
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
        className={cn('w-full bg-background', !value && 'text-muted-foreground', className)}
      >
        <SelectValue placeholder={placeholder}>
          {value === undefined ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
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

/* ────────────────────────── 开关 ────────────────────────── */

/**
 * 开关。
 *
 * 标签渲染在开关**旁边**而不是作为子节点 —— radix `Switch.Root` 只接受
 * `Thumb` 一个子元素，多出来的子节点会排在滑块后面，把轨道撑开。
 *
 * 无可见标签时（表格行内）必须给 `ariaLabel`，否则读屏只念「开关」。
 */
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
} & ControlAriaProps) {
  if (!label) {
    return (
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        onCheckedChange={onChange}
        className={className}
      />
    );
  }

  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', className)}>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        onCheckedChange={onChange}
      />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

/* ────────────────────────── 语义标签 ────────────────────────── */

export type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

/**
 * 语义标签。
 *
 * 形状取 shadcn `Badge`，颜色走项目语义色 —— 后台的标签表达业务状态，
 * 不是装饰，所以不用 Badge 的默认灰阶。
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
      className={cn('rounded-md border-transparent font-normal', tones[tone], className)}
    >
      {children}
    </Badge>
  );
}

/* ────────────────────────── 分段切换 ────────────────────────── */

/**
 * 分段页签（胶囊式）。
 *
 * 语义是「切到另一块内容」：下面跟着的是一整块表单或列表，选中项与内容区
 * 有归属关系。用 `tablist` / `tab` / `aria-selected` 表达这层关系。
 *
 * 若切换的只是同一份数据的**过滤维度**（网格 / 表格、严重级别、全部 / 按渠道），
 * 用 `SegmentedGroup` —— 那不是页签，读屏不该期待下面跟着 tabpanel。
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
    <Tabs
      value={value}
      onValueChange={onChange}
      className={cn('gap-0', className)}
    >
      <TabsList aria-label={ariaLabel} className="h-9 gap-1 p-1">
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className="h-7 px-3 text-sm font-medium"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * 分段单选组（胶囊式）。
 *
 * 语义是**单选组**而不是页签：切换后同一块区域换的是「过滤维度」，不是
 * 「另一块内容」。用 `tablist` 会让读屏用户以为下面跟着 tabpanel，而且
 * `aria-selected` 与筛选在语义上对不上。这里用 radiogroup + aria-checked，
 * 方向键切换、Tab 只落在当前项上都按单选组处理。
 */
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
      className={cn('inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1', className)}
    >
      {options.map((option, optionIndex) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-value={option.value}
            tabIndex={active || (index < 0 && optionIndex === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
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
 * 带右侧清空按钮的输入。筛选条件用：清空比逐字删快。
 *
 * 用 shadcn 官方 `InputGroup` 组合件（输入框 + 行内附加件）实现，不再手写
 * 「relative 容器 + 绝对定位按钮」：手写那份要自己对齐图标、自己在有值时
 * 让出 `pr-8`、自己复刻聚焦环，四处细节都得跟原子件同步。`InputGroup`
 * 由官方维护聚焦态与错误态，这里只声明「输入框 + 尾部清空按钮」。
 *
 * 高度固定 `h-8`（后台筛选控件的统一基线；shadcn `InputGroup` 默认 `h-9`），
 * 与 `SelectField` / `ActionButton` 同排时不出现参差。
 */
export function ClearableField({
  value,
  onChange,
  placeholder,
  ariaLabel,
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
  id?: string;
  className?: string;
  disabled?: boolean;
  onEnter?: () => void;
} & ControlAriaProps) {
  return (
    <InputGroup className={cn('h-8 bg-background', className)}>
      <InputGroupInput
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
        className="h-8 text-sm"
      />
      {value && !disabled && (
        <InputGroupAddon align="inline-end" className="pr-1.5">
          <InputGroupButton
            size="icon-xs"
            aria-label="清空"
            onClick={() => onChange('')}
            className="text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/* ────────────────────────── 操作按钮 ────────────────────────── */

/** 带图标按钮。图标一律 lucide（项目规范）。 */
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
  ariaLabel?: string;
  /** 分段/切换类按钮的选中态，读屏靠它而不是颜色 */
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
}) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      className={className}
    >
      {Icon ? <Icon className="size-4" /> : null}
      {children}
    </Button>
  );
}

/*
 * shadcn 官方 `Field` 组合件：FieldSet / FieldGroup / Field + Label /
 * Description / Error。与上面的 `FormField` 并存 —— `FormField` 是后台既有的
 * 单字段容器，`Field*` 用于需要自定义排布（分组、横向、分隔）的表单。
 */
export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '../components/ui/field';

/*
 * shadcn 官方 `InputGroup` 组合件：输入框 + 前后缀 / 行内按钮 / 文本。
 * 用于「一个输入框里带单位、搜索图标或操作按钮」的形态；单纯一个输入框仍用 `TextField`。
 */
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '../components/ui/input-group';
