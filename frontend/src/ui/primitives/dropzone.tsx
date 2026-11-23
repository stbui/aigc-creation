import type { ReactNode } from 'react';
import { ImagePlus } from 'lucide-react';

import { Button } from '~/admin-ui/components/ui/button';
import { cn } from '../lib/cn';

export interface ImageDropzoneProps {
  /** 主动作文案，如「点击或拖拽图片到此处上传」 */
  title: string;
  /** 辅助文案：格式、数量与体积上限 */
  hint: string;
  /** 前置图标，默认图片占位图标 */
  icon?: ReactNode;
  /** `compact` 用于网格内的小槽位（搭配图 / 多图位），只改尺寸不改语义 */
  size?: 'default' | 'compact';
  disabled?: boolean;
  className?: string;
  /** 点击 / 回车触发文件选择；拖拽落点由外层的 `ImageUploadArea` 接管 */
  onClick: () => void;
}

/**
 * C 端图片拖拽上传空态。
 *
 * shadcn 没有「大面积拖拽区」这一角色，`Attachment` 只表达已选文件的横条；
 * 因此按语义组件层封装：外壳复用 shadcn `Button`（真正的按钮语义、焦点环、
 * 禁用态），内部图标与两行文案由调用点提供。拖拽命中与高亮属于上传区状态，
 * 由 `ImageUploadArea` 统一承担，本组件只负责空态外观。
 */
export function ImageDropzone({
  title,
  hint,
  icon,
  size = 'default',
  disabled = false,
  className,
  onClick,
}: ImageDropzoneProps) {
  const compact = size === 'compact';

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      className={cn(
        'h-auto w-full flex-col rounded-md border-dashed bg-muted shadow-none',
        'text-muted-foreground hover:border-brand hover:bg-muted hover:text-muted-foreground',
        'focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/30',
        compact ? 'min-h-27 gap-1 px-2 py-2' : 'min-h-40 gap-1.5 px-4 py-4 max-[560px]:min-h-32',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span
        className={cn(
          'grid place-items-center rounded-md bg-brand-bg text-brand',
          compact ? 'size-7 [&_svg]:size-4' : 'size-9 [&_svg]:size-5',
        )}
      >
        {icon ?? <ImagePlus aria-hidden />}
      </span>
      <strong className="text-xs font-semibold text-foreground">{title}</strong>
      <span className="text-xs font-normal">{hint}</span>
    </Button>
  );
}
