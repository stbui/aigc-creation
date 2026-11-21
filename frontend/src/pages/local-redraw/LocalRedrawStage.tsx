import type { CSSProperties, RefObject } from 'react';

import {
  MAX_ANNOTATIONS,
  type MaskPainterHandle,
  type MaskState,
  type PaintTool,
} from './constants';
import type { ToolAsset } from './components';
import { MaskPainter } from './MaskPainter';
import { LocalRedrawCanvasFooter } from './LocalRedrawCanvasFooter';
import { LocalRedrawToolbar } from './LocalRedrawToolbar';

interface LocalRedrawStageProps {
  image: ToolAsset;
  tool: PaintTool;
  brush: number;
  zoom: number;
  pan: { x: number; y: number };
  /** 原图真实宽高比；画布按它展示，避免非方图出现空白 */
  aspect: number;
  submitting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 参考图 / 遮罩上传中 */
  busy: boolean;
  painter: RefObject<MaskPainterHandle | null>;
  onToolChange: (tool: PaintTool) => void;
  onBrushChange: (brush: number) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onRegionLimit: () => void;
  onPaintState: (state: MaskState) => void;
  onNaturalSize: (size: { width: number; height: number }) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/**
 * 标注画布舞台：工具栏 + `MaskPainter` + 底部操作条。
 *
 * 撤回 / 恢复 / 清空直接调用画布句柄，不经过页面；页面只持有角度无关的
 * 工具、画笔、缩放与平移状态。生成态由 `submitting` 控制禁用。
 */
export function LocalRedrawStage({
  image,
  tool,
  brush,
  zoom,
  pan,
  aspect,
  submitting,
  canUndo,
  canRedo,
  busy,
  painter,
  onToolChange,
  onBrushChange,
  onPanChange,
  onRegionLimit,
  onPaintState,
  onNaturalSize,
  onZoomIn,
  onZoomOut,
}: LocalRedrawStageProps) {
  const canvasWidth = `min(680px, calc(100% - 80px), calc((100vh - var(--workspace-topbar-height) - 144px) * ${aspect}))`;
  /** 提交期间画布保持可见（402 等确定性拒绝后不丢标注），但锁住交互 */
  const dimmed = submitting ? ' pointer-events-none opacity-[0.72]' : '';

  return (
    <div
      className={`pk-source-pane redraw-stage relative flex items-center justify-center gap-0! overflow-hidden! rounded-[var(--radius-panel)] p-0! max-[860px]:min-h-[720px]`}
      aria-busy={submitting}
    >
      <div
        className={`redraw-stage-topbar absolute top-0 left-0 z-5 flex min-h-10 w-full items-center justify-center max-[1180px]:left-1/2 max-[1180px]:w-[calc(100%_-_32px)] max-[1180px]:-translate-x-1/2 max-[860px]:w-[calc(100%_-_24px)]${dimmed}`}
      >
        <LocalRedrawToolbar
          tool={tool}
          brush={brush}
          onToolChange={onToolChange}
          onBrushChange={onBrushChange}
        />
      </div>
      <div className="redraw-stage-main absolute inset-0 flex items-center justify-center">
        <div
          className={`redraw-canvas-wrap relative flex-none! w-[var(--redraw-canvas-w)]! max-w-full max-h-full aspect-[var(--redraw-image-aspect)] flex items-center justify-center overflow-hidden max-[860px]:w-[600px] max-[860px]:max-w-[calc(100%_-_24px)]${dimmed}`}
          style={
            {
              '--redraw-image-aspect': aspect,
              '--redraw-canvas-w': canvasWidth,
            } as CSSProperties
          }
        >
          <MaskPainter
            url={image.url}
            tool={tool}
            brush={brush}
            zoom={zoom}
            pan={pan}
            maxRegions={MAX_ANNOTATIONS}
            onPanChange={onPanChange}
            onRegionLimit={onRegionLimit}
            onChange={onPaintState}
            onNaturalSize={onNaturalSize}
            handleRef={painter}
          />
        </div>
      </div>
      <LocalRedrawCanvasFooter
        canUndo={canUndo}
        canRedo={canRedo}
        busy={busy}
        dimmed={submitting}
        zoom={zoom}
        onUndo={() => painter.current?.undo()}
        onRedo={() => painter.current?.redo()}
        onClear={() => painter.current?.clear()}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />
    </div>
  );
}
