import { useId, useRef, useState, type ReactNode } from 'react';
import { Paperclip, X } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentTitle,
} from '../components/ui/attachment';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

/**
 * 低频但后台必须有的控件：文件、取色、建议输入。
 *
 * 与 `forms.tsx` 分开是因为这些控制器的**交互成本不同**：文本/下拉是每页都
 * 用，取色与建议输入只在「AI 标识」这类配置页出现。它们共享的样式约束
 * （8px 圆角、`border-input` 描边、焦点环）由 `tailwind-theme.css` 的 radius
 * 重映射统一。
 */

/** 复选：`indeterminate` 是三态表的「部分选中」，不能退化成布尔值。 */
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
        <Attachment size="xs" className="min-w-0 max-w-[280px]">
          <AttachmentContent>
            <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              aria-label="移除已选文件"
              disabled={disabled}
              onClick={onClear}
              className="text-muted-foreground hover:text-destructive"
            >
              <X aria-hidden />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ) : !compact ? (
        hint && <span className="sr-only">支持 {hint} 格式</span>
      ) : null}
    </div>
  );
}

/* ────────────────────────── 悬停说明 ────────────────────────── */

/** 悬停说明：键盘聚焦也能展开，最大宽度限制避免长文案横穿整页。 */
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
