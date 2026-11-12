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
        <div className="annotation-mark-preview">
          <img
            src={sourceImage.url}
            alt={`${label}框选区域`}
            style={previewStyleOf(region)}
          />
          <button
            type="button"
            className="annotation-remove"
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
