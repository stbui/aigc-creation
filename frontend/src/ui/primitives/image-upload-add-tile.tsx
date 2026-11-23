import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '~/admin-ui/components/ui/button';
import { cn } from '../lib/cn';

export interface ImageUploadAddTileProps {
  /** 可读名称，如「添加商品图片」 */
  label: string;
  disabled?: boolean;
  /** 追加到补位块的 class（页面专属皮肤） */
  className?: string;
  /** 自定义内容；缺省为加号 */
  children?: ReactNode;
  onClick: () => void;
}

/** 缩略图网格里的补位块。只表达「继续添加」，点击冒泡由上层命中区忽略。 */
export function ImageUploadAddTile({
  label,
  disabled = false,
  className,
  children,
  onClick,
}: ImageUploadAddTileProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      disabled={disabled}
      className={cn(
        'grid aspect-square h-auto place-items-center rounded-md border border-dashed border-border bg-card p-0 text-muted-foreground transition-colors hover:border-brand-light hover:bg-card hover:text-brand',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children ?? <Plus size={18} className="size-[18px]" aria-hidden />}
    </Button>
  );
}
