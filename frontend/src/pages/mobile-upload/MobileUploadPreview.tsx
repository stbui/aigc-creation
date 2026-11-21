import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { Picked } from './constants';

interface MobileUploadPreviewProps {
  item: Picked;
  index: number;
  total: number;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}

/** 半透明黑底小圆钮（序号 / 删除 / 排序共用） */
const FLOATING = 'bg-[rgba(20,18,30,0.7)] text-card';

/** 单张已选图片：序号、删除与左右排序。 */
export function MobileUploadPreview({
  item,
  index,
  total,
  onRemove,
  onMove,
}: MobileUploadPreviewProps) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-[var(--mup-surface)]">
      <img className="block size-full object-cover" src={item.url} alt={item.file.name} />
      <span
        className={`absolute top-1.5 left-1.5 grid size-[22px] place-items-center rounded-full text-xs ${FLOATING}`}
      >
        {index + 1}
      </span>
      <button
        type="button"
        className={`absolute top-1.5 right-1.5 grid size-[26px] cursor-pointer place-items-center rounded-full border-0 p-0 text-[15px] leading-none ${FLOATING}`}
        aria-label={`移除第 ${index + 1} 张`}
        onClick={onRemove}
      >
        ×
      </button>
      <div className="absolute right-1.5 bottom-1.5 flex overflow-hidden rounded-[7px] bg-[rgba(20,18,30,0.72)]">
        <button
          type="button"
          className="grid h-[27px] w-[29px] cursor-pointer place-items-center border-0 bg-transparent p-0 text-card disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`第 ${index + 1} 张前移`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="grid h-[27px] w-[29px] cursor-pointer place-items-center border-0 bg-transparent p-0 text-card disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`第 ${index + 1} 张后移`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
