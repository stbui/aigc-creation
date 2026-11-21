import { X } from 'lucide-react';

import { Button } from '../ui';
import type { Draft, SkuHandle, SkuRegion } from '../lib/skuRegionGeometry';

/**
 * SKU 区域编辑器的帧内叠加层：已提交区域、拖动中的草稿框、画笔笔迹点。
 *
 * 2026-11-15 从 `SkuRegionEditorModal` 抽出。三种元素都挂在模板图容器内、
 * 跟着 `scale(zoom)` 一起缩放，因此用百分比定位而不是像素。
 *
 * 这些元素**没有 shadcn 对应角色**（画布上的可拖拽几何体），所以视觉细节
 * 留在工具类里；四角手柄与删除按钮使用 shadcn `Button`，保证焦点环、
 * 禁用与点击语义一致。
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
  onRegionPointerDown: (event: React.PointerEvent<HTMLDivElement>, region: SkuRegion) => void;
  onHandlePointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
    region: SkuRegion,
    handle: SkuHandle,
  ) => void;
  onRemoveRegion: (id: string) => void;
}

const REGION_BASE = 'absolute box-border leading-normal touch-none';

const HANDLE_POS: Record<SkuHandle, string> = {
  nw: '-top-1.5 -left-1.5 cursor-nwse-resize',
  ne: '-top-1.5 -right-1.5 cursor-nesw-resize',
  sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
  se: '-right-1.5 -bottom-1.5 cursor-nwse-resize',
};

function regionClass(region: SkuRegion, selected: boolean): string {
  if (region.type === 'brush') {
    return `${REGION_BASE} cursor-move border-0 bg-transparent${selected ? ' z-[4]' : ''}`;
  }
  const shape = region.type === 'ellipse' ? 'rounded-full' : 'rounded-[5px]';
  const state = selected
    ? 'z-[4] border-solid bg-brand/25 ring-1 ring-brand/35'
    : 'border-dashed bg-brand/10';
  return `${REGION_BASE} cursor-move border-2 border-brand/60 ${state} ${shape}`;
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
            className={regionClass(region, selected)}
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
                  className="pointer-events-none absolute block -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/50"
                  style={{
                    left: `${((point.x - region.x) / Math.max(region.width, 0.0001)) * 100}%`,
                    top: `${((point.y - region.y) / Math.max(region.height, 0.0001)) * 100}%`,
                    width: brushSize,
                    height: brushSize,
                  }}
                />
              ))}
            <span className="absolute -top-[9px] -left-[9px] grid size-[18px] place-items-center rounded-full bg-brand text-xs font-medium text-primary-foreground">
              {index + 1}
            </span>
            {selected &&
              region.type !== 'brush' &&
              (['nw', 'ne', 'sw', 'se'] as SkuHandle[]).map((handle) => (
                <Button
                  key={handle}
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className={`absolute size-2.5 min-w-2.5 rounded-[2px] border-2 border-brand bg-card p-0 ${HANDLE_POS[handle]}`}
                  aria-label={`调整区域 ${index + 1}`}
                  onPointerDown={(event) => onHandlePointerDown(event, region, handle)}
                />
              ))}
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              className="absolute top-1 right-1 bg-foreground/65 p-0 text-primary-foreground hover:bg-foreground/90"
              aria-label={`删除区域 ${index + 1}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveRegion(region.id);
              }}
            >
              <X aria-hidden />
            </Button>
          </div>
        );
      })}
      {draftBox && (
        <div
          className={`${REGION_BASE} pointer-events-none border-2 border-dashed border-brand/60 bg-brand/10 opacity-70 ${
            draft?.type === 'ellipse' ? 'rounded-full' : 'rounded-[5px]'
          }`}
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
            className="pointer-events-none absolute block -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/60"
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