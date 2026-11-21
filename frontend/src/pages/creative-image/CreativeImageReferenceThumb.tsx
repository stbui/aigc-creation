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

/** 半透明深底小圆钮（排序箭头 / 移除共用） */
const FLOATING =
  'grid size-[18px] cursor-pointer place-items-center rounded-full border-0 bg-[rgba(29,33,41,0.66)] p-0 text-card';

/** 单张参考图缩略图：排序箭头 + 移除入口，边界箭头置灰。 */
export function CreativeImageReferenceThumb({
  image,
  index,
  total,
  onMove,
  onRemove,
}: CreativeImageReferenceThumbProps) {
  return (
    <div className="relative size-20 overflow-hidden rounded-md">
      <img
        className="block size-full object-cover"
        src={assetThumbUrl(image.url, 320) ?? image.url}
        alt={image.name}
        loading="lazy"
        decoding="async"
      />
      <div className="pointer-events-none absolute inset-x-0.5 top-1/2 flex -translate-y-1/2 justify-between">
        <button
          type="button"
          className={`${FLOATING} pointer-events-auto disabled:cursor-not-allowed disabled:opacity-35`}
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
          className={`${FLOATING} pointer-events-auto disabled:cursor-not-allowed disabled:opacity-35`}
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
        className={`${FLOATING} absolute top-1 right-1`}
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
