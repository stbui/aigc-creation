import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { TextAction } from './text-action';

export interface ImageUploadHeaderProps {
  /** 区块标题，如「上传商品图」 */
  title: ReactNode;
  /** 标题前是否带红色必填星号 */
  required?: boolean;
  /** 右侧计数，如 `2/4`；缺省不渲染 */
  count?: ReactNode;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  /** 手机上传按钮的 title 提示，说明图片回填位置 */
  mobileHint?: string;
  /** 追加到标题行的 class */
  className?: string;
}

/**
 * 图片上传区块的标题行：标题 / 必填标记 + 素材库 / 手机上传入口 + 计数器。
 *
 * 通用 tw 皮肤，动作统一走 `TextAction`；页面差异只通过 `className` 与
 * `data-slot` 槽位覆盖（`image-upload-header` / `image-upload-actions`）。
 */
export function ImageUploadHeader({
  title,
  required = false,
  count,
  onOpenLibrary,
  onOpenMobile,
  mobileHint,
  className,
}: ImageUploadHeaderProps) {
  return (
    <div
      data-slot="image-upload-header"
      className={cn('flex items-center justify-between gap-2.5', className)}
    >
      <strong className="text-sm leading-[13px] font-bold text-foreground">
        {required && (
          <i
            data-slot="image-upload-required"
            className="mr-[3px] font-bold not-italic text-danger-text"
            aria-hidden
          >
            *
          </i>
        )}
        {title}
      </strong>
      <div data-slot="image-upload-actions" className="flex items-center gap-2.5">
        <TextAction onClick={onOpenLibrary}>从素材库导入</TextAction>
        <TextAction onClick={onOpenMobile} title={mobileHint}>
          手机上传
        </TextAction>
        {count ? (
          <span className="text-base leading-6 text-foreground tabular-nums">{count}</span>
        ) : null}
      </div>
    </div>
  );
}
