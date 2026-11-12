import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { Picked } from './constants';

interface MobileUploadPreviewProps {
  item: Picked;
  index: number;
  total: number;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}

/** 单张已选图片：序号、删除与左右排序。 */
export function MobileUploadPreview({
  item,
  index,
  total,
  onRemove,
  onMove,
}: MobileUploadPreviewProps) {
  return (
    <div className="mup-preview">
      <img src={item.url} alt={item.file.name} />
      <span>{index + 1}</span>
      <button
        type="button"
        className="mup-remove"
        aria-label={`移除第 ${index + 1} 张`}
        onClick={onRemove}
      >
        ×
      </button>
      <div className="mup-order">
        <button
          type="button"
          aria-label={`第 ${index + 1} 张前移`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
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
