import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import type { ToolAsset } from './components';
import { assetThumbUrl } from './utils';

interface CreativeImageReferenceThumbProps {
  image: ToolAsset;
  index: number;
  total: number;
  /** 调整这张图在参考图位中的先后顺序（顺序即构图顺序） */
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}

/** 单张参考图缩略图：排序箭头 + 移除入口，边界箭头置灰。 */
export function CreativeImageReferenceThumb({
  image,
  index,
  total,
  onMove,
  onRemove,
}: CreativeImageReferenceThumbProps) {
  return (
    <div className="fc-thumb">
      <img src={assetThumbUrl(image.url, 320) ?? image.url} alt={image.name} loading="lazy" decoding="async" />
      <div className="fc-thumb-order">
        <button
          type="button"
          aria-label={`前移 ${image.name}`}
          disabled={index === 0}
          onClick={(event) => {
            event.stopPropagation();
            onMove(index, -1);
          }}
        >
          <ChevronLeft size={12} />
        </button>
        <button
          type="button"
          aria-label={`后移 ${image.name}`}
          disabled={index === total - 1}
          onClick={(event) => {
            event.stopPropagation();
            onMove(index, 1);
          }}
        >
          <ChevronRight size={12} />
        </button>
      </div>
      <button
        type="button"
        className="fc-thumb-remove"
        aria-label={`移除 ${image.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(image.id);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
