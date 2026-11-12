import { Minus, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';

import { SHORTCUT_HINT } from './constants';

interface LocalRedrawCanvasFooterProps {
  canUndo: boolean;
  canRedo: boolean;
  /** 参考图 / 遮罩上传期间禁止清空与撤回，避免与上传竞态 */
  busy: boolean;
  zoom: number;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/** 画布底部操作条：撤回 / 恢复 / 清空、缩放与快捷键提示。 */
export function LocalRedrawCanvasFooter({
  canUndo,
  canRedo,
  busy,
  zoom,
  onUndo,
  onRedo,
  onClear,
  onZoomIn,
  onZoomOut,
}: LocalRedrawCanvasFooterProps) {
  return (
    <>
      <div className="redraw-canvas-footer">
        <button
          type="button"
          className="redraw-footer-btn"
          disabled={!canUndo || busy}
          title="撤回 (Ctrl+Z)"
          onClick={onUndo}
        >
          <Undo2 size={16} />
          撤回
        </button>
        <button
          type="button"
          className="redraw-footer-btn"
          disabled={!canRedo || busy}
          title="恢复 (Ctrl+Shift+Z)"
          onClick={onRedo}
        >
          <Redo2 size={16} />
          恢复
        </button>
        <button type="button" className="redraw-footer-btn" disabled={busy} onClick={onClear}>
          <Trash2 size={16} />
          清空
        </button>
        <span className="redraw-tool-divider" />
        <button
          type="button"
          className="redraw-footer-btn redraw-zoom-btn"
          aria-label="缩小"
          title="缩小 (-)"
          onClick={onZoomOut}
        >
          <Minus size={16} />
        </button>
        <span className="redraw-zoom-value">{zoom}%</span>
        <button
          type="button"
          className="redraw-footer-btn redraw-zoom-btn"
          aria-label="放大"
          title="放大 (+)"
          onClick={onZoomIn}
        >
          <Plus size={16} />
        </button>
      </div>
      {/* 提示相对画布舞台定位；嵌在绝对定位的操作条内会以操作条为包含块而压住按钮 */}
      <p className="redraw-shortcut-hint">{SHORTCUT_HINT}</p>
    </>
  );
}
