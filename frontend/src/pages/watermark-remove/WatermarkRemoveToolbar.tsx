import { Columns2, Hand, Square } from 'lucide-react';

import type { WatermarkMaskTool } from './components';

interface WatermarkRemoveToolbarProps {
  tool: WatermarkMaskTool;
  onToolChange: (tool: WatermarkMaskTool) => void;
}

/** 画布工具栏：抓手 / 对比（未出结果时禁用）/ 框选。 */
export function WatermarkRemoveToolbar({ tool, onToolChange }: WatermarkRemoveToolbarProps) {
  return (
    <div className="redraw-toolbar" role="toolbar" aria-label="重绘工具">
      <span className="toolbar-item-wrap">
        <button
          type="button"
          className={`redraw-tool-btn${tool === 'hand' ? ' active' : ''}`}
          aria-pressed={tool === 'hand'}
          title="抓手 (H)"
          onClick={() => onToolChange('hand')}
        >
          <Hand size={13} />
          抓手
        </button>
      </span>
      <span className="toolbar-item-wrap">
        <button type="button" className="redraw-tool-btn" title="对比" disabled aria-pressed={false}>
          <Columns2 size={13} />
          对比
        </button>
        <b className="toolbar-divider" />
        <button
          type="button"
          className={`redraw-tool-btn${tool === 'rect' ? ' active' : ''}`}
          aria-pressed={tool === 'rect'}
          title="框选 (R)"
          onClick={() => onToolChange('rect')}
        >
          <Square size={13} />
          框选
        </button>
      </span>
    </div>
  );
}
