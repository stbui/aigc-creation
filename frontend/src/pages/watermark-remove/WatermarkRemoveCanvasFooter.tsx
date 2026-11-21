import { Minus, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';

import { SHORTCUT_HINT } from './constants';

interface WatermarkRemoveCanvasFooterProps {
  canUndo: boolean;
  canRedo: boolean;
  /** 有标注时才允许清空 */
  painted: boolean;
  zoom: number;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/** 画布底部操作条按钮：参考站窄条，图标在上、文字在下 */
const FOOTER_BTN =
  'redraw-footer-btn h-[18px]! w-[51px] justify-center gap-1! px-0! text-xs text-[color:var(--text-desc)]! [&>svg]:size-4 disabled:opacity-35! max-[900px]:box-border max-[900px]:w-10 max-[900px]:h-[18.5px] max-[900px]:p-px max-[900px]:px-1.5';

const ZOOM_BTN = `${FOOTER_BTN} redraw-zoom-btn w-[26px]! max-[900px]:w-[12.5px] max-[900px]:p-px max-[900px]:px-1.5`;

/** 画布底部操作条：撤回 / 恢复 / 清空、缩放与快捷键提示。 */
export function WatermarkRemoveCanvasFooter({
  canUndo,
  canRedo,
  painted,
  zoom,
  onUndo,
  onRedo,
  onClear,
  onZoomIn,
  onZoomOut,
}: WatermarkRemoveCanvasFooterProps) {
  return (
    <>
      <div className="redraw-canvas-footer absolute bottom-[45px] left-1/2 z-5 h-10 gap-2! py-0! px-4! -translate-x-1/2 shadow-[0_4px_16px_rgba(107,114,128,0.16)]">
        <button
          type="button"
          className={FOOTER_BTN}
          disabled={!canUndo}
          title="撤回 (Ctrl+Z)"
          onClick={onUndo}
        >
          <Undo2 size={16} />
          撤回
        </button>
        <button
          type="button"
          className={FOOTER_BTN}
          disabled={!canRedo}
          title="恢复 (Ctrl+Shift+Z)"
          onClick={onRedo}
        >
          <Redo2 size={16} />
          恢复
        </button>
        <button type="button" className={FOOTER_BTN} disabled={!painted} onClick={onClear}>
          <Trash2 size={16} />
          清空
        </button>
        <b className="redraw-tool-divider mx-0! max-[900px]:w-0" />
        <button
          type="button"
          className={ZOOM_BTN}
          aria-label="缩小"
          title="缩小 (-)"
          onClick={onZoomOut}
        >
          <Minus size={16} />
        </button>
        <span className="redraw-zoom-value w-[31px]! min-w-[31px]! text-center text-xs text-[color:var(--wb-text)]! max-[900px]:w-[30.9px] max-[900px]:min-w-[30.9px]">
          {zoom}%
        </span>
        <button
          type="button"
          className={ZOOM_BTN}
          aria-label="放大"
          title="放大 (+)"
          onClick={onZoomIn}
        >
          <Plus size={16} />
        </button>
      </div>
      {/* 提示相对画布舞台定位；嵌在绝对定位的操作条内会以操作条为包含块而压住按钮 */}
      <div className="redraw-shortcut-hint absolute bottom-2 left-1/2 z-4 m-0 whitespace-nowrap text-xs leading-normal! text-[color:var(--text-9)]! -translate-x-1/2">
        {SHORTCUT_HINT}
      </div>
    </>
  );
}
