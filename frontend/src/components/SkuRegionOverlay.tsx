import type { PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import type { Draft, SkuHandle, SkuRegion } from '../lib/skuRegionGeometry';

/**
 * SKU 区域编辑器的帧内叠加层：已提交区域、拖动中的草稿框、画笔笔迹点。
 *
 * 2026-11-15 从 `SkuRegionEditorModal` 抽出。三种元素都挂在模板图容器内、
 * 跟着 `scale(zoom)` 一起缩放，因此用百分比定位而不是像素。
 *
 * 注意：选中区域的四角手柄只对矩形/椭圆出现 —— 画笔区域按笔迹点裁切，
 * 没有可拖拽的边界框。
 */
interface Props {
  regions: SkuRegion[];
  selectedId: string | null;
  /** 拖动中的矩形/椭圆草稿外接框（归一化） */
  draftBox: { x: number; y: number; width: number; height: number } | null;
  draft: Draft | null;
  /** 笔迹点直径（CSS 像素，不随缩放变化） */
  brushSize: number;
  onRegionPointerDown: (event: ReactPointerEvent<HTMLDivElement>, region: SkuRegion) => void;
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, region: SkuRegion, handle: SkuHandle) => void;
  onRemoveRegion: (id: string) => void;
}

export function SkuRegionOverlay({
  regions,
  selectedId,
  draftBox,
  draft,
  brushSize,
  onRegionPointerDown,
  onHandlePointerDown,
  onRemoveRegion,
}: Props) {
  return (
    <>
      {regions.map((region, index) => {
        const selected = selectedId === region.id;
        return (
          <div
            key={region.id}
            className={`product-sku-editor-region ${region.type}${selected ? ' is-selected' : ''}`}
            data-region-id={region.id}
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
            onPointerDown={(event) => onRegionPointerDown(event, region)}
          >
            {region.type === 'brush' &&
              region.points?.map((point, pointIndex) => (
                <i
                  key={`${pointIndex}-${point.x}-${point.y}`}
                  style={{
                    left: `${((point.x - region.x) / Math.max(region.width, 0.0001)) * 100}%`,
                    top: `${((point.y - region.y) / Math.max(region.height, 0.0001)) * 100}%`,
                    width: brushSize,
                    height: brushSize,
                  }}
                />
              ))}
            <b>{index + 1}</b>
            {selected &&
              region.type !== 'brush' &&
              (['nw', 'ne', 'sw', 'se'] as SkuHandle[]).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className={`resize-handle ${handle}`}
                  aria-label={`调整区域 ${index + 1}`}
                  onPointerDown={(event) => onHandlePointerDown(event, region, handle)}
                />
              ))}
            <button
              type="button"
              className="product-sku-editor-region-remove"
              aria-label={`删除区域 ${index + 1}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveRegion(region.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {draftBox && (
        <div
          className={`product-sku-editor-region draft ${draft?.type === 'ellipse' ? 'ellipse' : 'rect'}`}
          style={{
            left: `${draftBox.x * 100}%`,
            top: `${draftBox.y * 100}%`,
            width: `${draftBox.width * 100}%`,
            height: `${draftBox.height * 100}%`,
          }}
        />
      )}
      {draft?.type === 'brush' &&
        draft.points.map((point, index) => (
          <i
            key={`${index}-${point.x}-${point.y}`}
            className="product-sku-editor-brush-dot"
            style={{
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
              width: brushSize,
              height: brushSize,
            }}
          />
        ))}
    </>
  );
}
