import type { RefObject } from 'react';

import {
  WatermarkMaskEditor,
  type ToolAsset,
  type WatermarkMaskHandle,
  type WatermarkMaskRegion,
  type WatermarkMaskTool,
} from './components';
import { WatermarkRemoveCanvasFooter } from './WatermarkRemoveCanvasFooter';
import { WatermarkRemoveToolbar } from './WatermarkRemoveToolbar';

interface WatermarkRemoveStageProps {
  image: ToolAsset;
  tool: WatermarkMaskTool;
  zoom: number;
  pan: { x: number; y: number };
  submitting: boolean;
  painted: boolean;
  canUndo: boolean;
  canRedo: boolean;
  painter: RefObject<WatermarkMaskHandle | null>;
  onToolChange: (tool: WatermarkMaskTool) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onState: (
    hasPaint: boolean,
    undoable: boolean,
    redoable: boolean,
    regions: WatermarkMaskRegion[],
  ) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/**
 * 去水印画布舞台：工具栏 + 遮罩编辑器 + 底部操作条。
 *
 * 撤回 / 恢复 / 清空直接调用画布句柄；页面只持有工具、缩放、平移与遮罩状态。
 * 顶栏 / 底栏浮在画布上（绝对定位），画布本身铺满舞台 —— 与局部重绘同一套骨架，
 * 但工具栏固定 210px，只暴露「抓手 / 对比 / 框选」。
 */
export function WatermarkRemoveStage({
  image,
  tool,
  zoom,
  pan,
  submitting,
  painted,
  canUndo,
  canRedo,
  painter,
  onToolChange,
  onPanChange,
  onState,
  onZoomIn,
  onZoomOut,
}: WatermarkRemoveStageProps) {
  return (
    <main
      className="local-redraw-stage relative flex h-full w-full min-w-0 min-h-0 items-center justify-center overflow-hidden rounded-[var(--radius-panel)] max-[1200px]:min-h-[720px]"
      aria-busy={submitting}
    >
      <div className="redraw-stage-topbar absolute top-0 left-0 z-5 flex min-h-10 w-full items-center justify-center max-[900px]:left-0 max-[900px]:w-[calc(100%_-_24px)] max-[900px]:translate-none">
        <WatermarkRemoveToolbar tool={tool} onToolChange={onToolChange} />
        <div className="stage-actions stage-actions-placeholder" aria-hidden="true" />
      </div>

      <WatermarkMaskEditor
        url={image.url}
        alt="待去水印的原图"
        tool={tool}
        zoom={zoom}
        pan={pan}
        onPanChange={onPanChange}
        onState={onState}
        handleRef={painter}
      />

      <WatermarkRemoveCanvasFooter
        canUndo={canUndo}
        canRedo={canRedo}
        painted={painted}
        zoom={zoom}
        onUndo={() => painter.current?.undo()}
        onRedo={() => painter.current?.redo()}
        onClear={() => painter.current?.clear()}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />
    </main>
  );
}
