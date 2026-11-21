import { X } from 'lucide-react';

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentMedia,
  type ToolAsset,
} from './components';
import { assetThumbUrl } from './api';

interface ProductSkuReferenceThumbProps {
  reference: ToolAsset;
  /** 完整无障碍名称，如「SKU 1 区域 2 参考图」 */
  label: string;
  onRemove: () => void;
  onPreview: (url: string) => void;
}

/**
 * 变体区域右上角的参考图缩略图。
 *
 * 走 shadcn `Attachment` 的竖排缩略图形态：媒体位裁切方形、移除按钮落在
 * 附件操作位上（Radix/Button 的焦点环与读屏名称都由原子件提供）。
 * 缩略图用 `assetThumbUrl()` 小图，点开预览用原图地址。
 */
export function ProductSkuReferenceThumb({
  reference,
  label,
  onRemove,
  onPreview,
}: ProductSkuReferenceThumbProps) {
  return (
    <Attachment
      orientation="vertical"
      size="xs"
      className="absolute top-4 right-4 w-16 border border-border"
    >
      <AttachmentMedia variant="image" className="group-data-[size=xs]/attachment:w-full">
        <button
          type="button"
          className="size-full cursor-zoom-in border-0 bg-transparent p-0"
          aria-label={`预览 ${label}`}
          onClick={() => onPreview(reference.url)}
        >
          <img src={assetThumbUrl(reference.url, 240) ?? reference.url} alt={label} />
        </button>
      </AttachmentMedia>
      <AttachmentActions>
        <AttachmentAction aria-label="移除参考图" onClick={onRemove}>
          <X aria-hidden />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}