import { X } from 'lucide-react';

import type { ToolAsset, WatermarkMaskRegion } from './components';
import { previewStyleOf } from './utils';

interface WatermarkRemoveAnnotationRowProps {
  /** null 表示还没有任何标注，渲染一条待标注占位行 */
  region: WatermarkMaskRegion | null;
  index: number;
  sourceImage: ToolAsset | null;
  onRemove: (id: number) => void;
}

/** 单个水印标注：原图裁切预览 + 删除入口；未标注时展示占位。 */
export function WatermarkRemoveAnnotationRow({
  region,
  index,
  sourceImage,
  onRemove,
}: WatermarkRemoveAnnotationRowProps) {
  const label = `标注${index + 1}`;

  return (
    <div
      className={`redraw-prompt watermark-annotation-row${region ? ' is-marked' : ' is-pending'}`}
    >
      <label className={`redraw-prompt-label ${region ? 'is-marked' : 'is-pending'}`}>
        <i />
        {label}
      </label>
      {region && sourceImage ? (
        <div className="relative size-16 self-center overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-brand)] bg-[var(--surface)]">
          <img
            className="block max-w-none object-fill"
            src={sourceImage.url}
            alt={`${label}框选区域`}
            style={previewStyleOf(region)}
          />
          <button
            type="button"
            className="absolute top-0.5 right-0.5 z-3 grid size-[18px] cursor-pointer place-items-center rounded-full border-0 bg-[rgba(51,51,51,0.78)] p-0 text-card hover:bg-[rgba(31,35,41,0.92)] focus-visible:bg-[rgba(31,35,41,0.92)] focus-visible:outline-none"
            aria-label={`删除${label}`}
            title={`删除${label}`}
            onClick={() => onRemove(region.id)}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
