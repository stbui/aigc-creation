import { useId, useRef, type ReactNode } from 'react';
import { Paperclip, X } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import { NumberField } from './form';

/**
 * 低频但后台必须有的原生控件：复选、文件、取色、滑块、建议输入、悬停说明、
 * 纯图标按钮。
 *
 * 与 `form.tsx` 分开是因为这些控制器的**交互成本不同**：文本/下拉是每页都
 * 用，取色与滑块只在「AI 标识」「水印」这类配置页出现。放在同一个文件里会让
 * 表单层越滚越大，而它们共享的样式约束（8px 圆角、`border-input` 描边、
 * 焦点环）已经由 `admin.css` 的 radius 重映射统一。
 */

/* ────────────────────────── 复选 ────────────────────────── */

/** 复选：`indeterminate` 是三态表的「部分选中」，不能退化成布尔值。 */
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
      />
      {label && (
        <span className={cn('text-foreground', size === 'sm' ? 'text-xs' : 'text-sm')}>
          {label}
        </span>
      )}
    </label>
  );
}

/* ────────────────────────── 文件选择 ────────────────────────── */

/**
 * 文件选择。
 *
 * 只挑文件、不负责上传 —— 上传进度与失败语义属于调用方（插件导入、对账
 * CSV），这里把「已选文件 + 移除」收成一个可复用的形态。格式说明不占版面：
 * 系统文件对话框已按 `accept` 过滤，说明放在悬停与读屏里。
 */
export function FilePicker({
  file,
  accept,
  onPick,
  onClear,
  disabled = false,
  label = '选择文件',
  hint,
  compact = false,
}: {
  file: File | null;
  accept?: string;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** 标题栏等窄位置只保留图标；已选文件由调用方在内容区回显。 */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-w-0 items-center gap-2">
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
        variant={compact ? 'ghost' : 'secondary'}
        size={compact ? 'icon-xs' : 'sm'}
        disabled={disabled}
        aria-label={compact ? label : undefined}
        title={
          compact
            ? file
              ? `${label}（已选择 ${file.name}）`
              : label
            : hint
              ? `支持 ${hint} 格式`
              : undefined
        }
        className={compact ? 'text-muted-foreground hover:text-foreground' : undefined}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" aria-hidden />
        {!compact && label}
      </Button>
      {!compact && file ? (
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
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
      ) : !compact ? (
        hint && <span className="sr-only">支持 {hint} 格式</span>
      ) : null}
    </div>
  );
}

/* ────────────────────────── 悬停说明 ────────────────────────── */

/** 悬停说明：键盘聚焦也能展开，最大宽度限制避免长文案横穿整页。 */
export function HelpTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
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

/* ────────────────────────── 纯图标按钮 ────────────────────────── */

/** 纯图标按钮：必须给 `label`（无障碍名），图标本身读屏不可读。 */
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
  const sizes = { xs: 'icon-xs', sm: 'icon-sm', md: 'icon' } as const;
  return (
    <Button
      type="button"
      variant="ghost"
      size={sizes[size]}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}

/* ────────────────────────── 取色 ────────────────────────── */

/**
 * 取色：原生 `<input type="color">` + 十六进制文本框。
 *
 * 用系统取色面板而不是自绘拾色器：键盘可操作、浏览器原生无障碍语义。
 * 文本框允许手填非 `#rrggbb` 写法，是否合法交给后端判定 —— 前端提前拦截
 * 会让「想存一个 CSS 变量名」变成不可能。
 */
export function ColorField({
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
        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <Input
        type="text"
        value={value}
        maxLength={7}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} 十六进制值` : '颜色十六进制值'}
        placeholder="#rrggbb"
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-28 bg-background px-2.5 text-sm disabled:bg-muted"
      />
    </div>
  );
}

/* ────────────────────────── 滑块 ────────────────────────── */

/**
 * 数值滑块 + 数字框（同步）。
 *
 * 滑块负责「拖动看效果」，数字框负责「精确落值」；只给其中一种都会让另一类
 * 操作变难。范围与步长由调用方给定，越界值由数字框自己收敛。
 */
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
        <NumberField
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

/* ────────────────────────── 建议输入 ────────────────────────── */

/**
 * 带候选建议的文本输入（原生 `<datalist>`）。
 *
 * 候选由浏览器渲染，零状态、零依赖。代价是只能前缀匹配、候选不能带说明 ——
 * 字体族这类候选项本就不需要说明。
 */
export function SuggestField({
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
      <Input
        list={listId}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn('h-9 bg-background text-sm disabled:bg-muted', className)}
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </>
  );
}
