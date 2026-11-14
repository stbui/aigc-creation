import { Minus, Plus, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import type { ZoomTarget } from '../lib/mattingEditor';

/**
 * 一键抠图结果编辑器的底部条（撤回 / 恢复 / 重置 · 缩放对象 · 缩放步进）。
 *
 * 2026-11-15 从 `MattingResultEditor` 抽出：这里只有「按钮 → 回调」的映射，
 * 撤销栈与缩放状态都在主组件，纯展示以便与顶部工具条分别演进。
 */
interface Props {
  canUndo: boolean;
  canRedo: boolean;
  zoomTarget: ZoomTarget;
  activeZoom: number;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onZoomTargetChange: (target: ZoomTarget) => void;
  onChangeZoom: (delta: number) => void;
}

export function MattingResultFooter({
  canUndo,
  canRedo,
  zoomTarget,
  activeZoom,
  onUndo,
  onRedo,
  onReset,
  onZoomTargetChange,
  onChangeZoom,
}: Props) {
  return (
    <div className="background-result-footer">
      <button type="button" onClick={onUndo} disabled={!canUndo} title="撤回 (Ctrl+Z)">
        <Undo2 size={16} />
        撤回
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title="恢复 (Ctrl+Shift+Z)">
        <Redo2 size={16} />
        恢复
      </button>
      <button type="button" onClick={onReset} title="重置视图与编辑">
        <RotateCcw size={16} />
        重置
      </button>
      <b />
      <div className="background-zoom-target" role="group" aria-label="缩放对象">
        <button
          type="button"
          className={zoomTarget === 'subject' ? 'active' : ''}
          aria-pressed={zoomTarget === 'subject'}
          onClick={() => onZoomTargetChange('subject')}
        >
          主体
        </button>
        <button
          type="button"
          className={zoomTarget === 'canvas' ? 'active' : ''}
          aria-pressed={zoomTarget === 'canvas'}
          onClick={() => onZoomTargetChange('canvas')}
        >
          画布
        </button>
      </div>
      <button type="button" aria-label="缩小" title="缩小 (-)" onClick={() => onChangeZoom(-10)}>
        <Minus size={16} />
      </button>
      <span>{activeZoom}%</span>
      <button type="button" aria-label="放大" title="放大 (+)" onClick={() => onChangeZoom(10)}>
        <Plus size={16} />
      </button>
    </div>
  );
}
