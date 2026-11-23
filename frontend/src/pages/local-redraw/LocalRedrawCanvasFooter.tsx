import { Minus, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';

import { SHORTCUT_HINT } from './constants';

interface LocalRedrawCanvasFooterProps {
  canUndo: boolean;
  canRedo: boolean;
  /** 参考图 / 遮罩上传期间禁止清空与撤回，避免与上传竞态 */
  busy: boolean;
  /** 提交期间整条置灰失焦（画布仍可见，标注不丢） */
  dimmed: boolean;
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
  dimmed,
  zoom,
  onUndo,
  onRedo,
  onClear,
  onZoomIn,
  onZoomOut,
}: LocalRedrawCanvasFooterProps) {
  const dimmedClass = dimmed ? ' pointer-events-none opacity-[0.72]' : '';

  return (
    <>
      <div
        className={`redraw-canvas-footer absolute bottom-[45px] left-1/2 z-5 h-10 gap-2! py-0! px-4! -translate-x-1/2 shadow-[0_4px_16px_rgba(107,112,128,0.16)]${dimmedClass}`}
      >
        <button
          type="button"
          className="redraw-footer-btn px-0!"
          disabled={!canUndo || busy}
          title="撤回 (Ctrl+Z)"
          onClick={onUndo}
        >
          <Undo2 size={16} />
          撤回
        </button>
        <button
          type="button"
          className="redraw-footer-btn px-0!"
          disabled={!canRedo || busy}
          title="恢复 (Ctrl+Shift+Z)"
          onClick={onRedo}
        >
          <Redo2 size={16} />
          恢复
        </button>
        <button type="button" className="redraw-footer-btn px-0!" disabled={busy} onClick={onClear}>
          <Trash2 size={16} />
          清空
        </button>
        <span className="redraw-tool-divider mx-0!" />
        <button
          type="button"
          className="redraw-footer-btn redraw-zoom-btn"
          aria-label="缩小"
          title="缩小 (-)"
          onClick={onZoomOut}
        >
          <Minus size={16} />
        </button>
        <span className="redraw-zoom-value min-w-10!">{zoom}%</span>
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
      <p className="redraw-shortcut-hint absolute bottom-2 left-1/2 z-4 m-0 leading-4! whitespace-nowrap text-[color:var(--text-9)]! -translate-x-1/2 max-[1200px]:hidden">{SHORTCUT_HINT}</p>
    </>
  );
}
