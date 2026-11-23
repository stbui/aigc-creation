import { X } from 'lucide-react';

import { Button } from '~/admin-ui/components/ui/button';
import { cn } from '../lib/cn';
import type { ImageUploadItem } from './image-upload-types';

export interface ImageUploadThumbProps {
  item: ImageUploadItem;
  /** 移除按钮的可读名称，如「移除 probe.png」 */
  removeLabel: string;
  disabled?: boolean;
  /** 追加到缩略图容器的 class（如固定 72px 的预览位） */
  className?: string;
  /** 缺省时不渲染移除按钮 */
  onRemove?: (id: string) => void;
}

/** 单张缩略图 + 移除入口。移除点击在此截断，不触发上传区开框。 */
export function ImageUploadThumb({
  item,
  removeLabel,
  disabled = false,
  className,
  onRemove,
}: ImageUploadThumbProps) {
  return (
    <div
      data-slot="image-upload-thumb"
      className={cn(
        'relative aspect-square overflow-hidden rounded-md border border-border bg-card',
        className,
      )}
    >
      <img
        src={item.thumbUrl ?? item.url}
        alt={item.name}
        loading="lazy"
        decoding="async"
        className="block size-full object-cover"
      />
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          aria-label={removeLabel}
          disabled={disabled}
          className="absolute top-1 right-1 grid size-[18px] place-items-center rounded-full border-0 bg-foreground/65 p-0 text-primary-foreground transition-colors hover:bg-foreground/85 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item.id);
          }}
        >
          <X size={12} className="size-3" aria-hidden />
        </Button>
      )}
    </div>
  );
}
