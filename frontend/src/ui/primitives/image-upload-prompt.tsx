import type { ReactNode } from 'react';
import { ImagePlus } from 'lucide-react';

import { cn } from '../lib/cn';

export interface ImageUploadPromptProps {
  /** 空态主文案 */
  title: ReactNode;
  /** 辅助文案：格式、数量与体积上限 */
  hint?: ReactNode;
  /** 前置图标，默认图片占位图标 */
  icon?: ReactNode;
  /** 追加到提示按钮的 class */
  className?: string;
  /** 追加到图标容器的 class，如参考图位的图标下移 */
  iconClassName?: string;
  /** 点击开框；组件只转交意图 */
  onClick: () => void;
}

/**
 * 图片上传空态提示。
 *
 * 通用 tw 皮肤，工具页与业务页只传文案和可选间距；点击冒泡在此截断，
 * 避免外层上传命中区重复开框。
 */
export function ImageUploadPrompt({
  title,
  hint,
  icon,
  className,
  iconClassName,
  onClick,
}: ImageUploadPromptProps) {
  return (
    <button
      type="button"
      data-slot="image-upload-prompt"
      className={cn(
        'flex min-h-[126px] w-full max-w-[238px] cursor-pointer appearance-none flex-col items-center justify-center gap-1 rounded-md border-0 bg-transparent p-0 text-center text-sm leading-[22px] text-foreground focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span aria-hidden className={cn('text-muted-foreground', iconClassName)}>
        {icon ?? <ImagePlus size={14} />}
      </span>
      <span>{title}</span>
      {hint ? (
        <span className="text-xs leading-5 text-[color:var(--text-desc)]">{hint}</span>
      ) : null}
    </button>
  );
}
