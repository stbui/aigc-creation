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
    <main className="local-redraw-stage" aria-busy={submitting}>
      <div className="redraw-stage-topbar">
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
