import { X } from 'lucide-react';

import { Button, type ToolAsset } from './components';
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
 * 缩略图走 `assetThumbUrl()`（小图），点开预览用原图地址；
 * 移除按钮独立于图片，避免点关闭时误触放大。
 */
export function ProductSkuReferenceThumb({
  reference,
  label,
  onRemove,
  onPreview,
}: ProductSkuReferenceThumbProps) {
  return (
    <div className="product-sku-reference-thumb">
      <Button
        htmlType="button"
        variant="ghost"
        size="icon-xs"
        aria-label="移除参考图"
        onClick={onRemove}
      >
        <X className="size-4" />
      </Button>
      <img
        src={assetThumbUrl(reference.url, 240) ?? reference.url}
        alt={label}
        onClick={() => onPreview(reference.url)}
      />
    </div>
  );
}
