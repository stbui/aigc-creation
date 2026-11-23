import { X } from 'lucide-react';

import type { ToolAsset } from './components';
import { Attachment, AttachmentAction, AttachmentActions, AttachmentMedia } from './components';
import { assetThumbUrl } from './api';

/**
 * 已上传图片的缩略卡（主体图与搭配图共用）。
 *
 * 2026-11-21 由自绘 `div + button + 角标` 改为 shadcn `Attachment`：
 * 图片位、上传中状态（`state="uploading"`）与移除动作都由组合件表达，
 * 页面只负责高度与移除回调。移除按钮仍是 `AttachmentAction`（真按钮语义）。
 */
export function MultiFusionImageThumb({
  asset,
  uploading,
  removeLabel,
  className,
  onRemove,
}: {
  asset: ToolAsset;
  uploading: boolean;
  /** 无障碍标签：主体图与搭配图的语义不同 */
  removeLabel: string;
  /** 图位高度由调用点决定（主体图高于搭配图槽） */
  className?: string;
  onRemove: () => void;
}) {
  return (
    <Attachment
      orientation="vertical"
      size="xs"
      state={uploading ? 'uploading' : 'done'}
      className={className}
    >
      <AttachmentMedia variant="icon" className="aspect-auto h-full w-full rounded-[13px]">
        <img
          src={assetThumbUrl(asset.url, 320) ?? asset.url}
          alt={asset.name}
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
        />
        {uploading && (
          <span className="absolute inset-0 grid place-items-center bg-background/70 text-xs font-bold text-brand">
            上传中
          </span>
        )}
      </AttachmentMedia>
      <AttachmentActions className="group-data-[orientation=vertical]/attachment:top-1.5 group-data-[orientation=vertical]/attachment:right-1.5">
        <AttachmentAction
          aria-label={removeLabel}
          className="bg-foreground/65 text-primary-foreground hover:bg-danger-text hover:text-primary-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X aria-hidden />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}
