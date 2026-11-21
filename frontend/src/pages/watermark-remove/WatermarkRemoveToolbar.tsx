import { Columns2, Hand, Square } from 'lucide-react';

import type { WatermarkMaskTool } from './components';

interface WatermarkRemoveToolbarProps {
  tool: WatermarkMaskTool;
  onToolChange: (tool: WatermarkMaskTool) => void;
}

/** 工具栏浮在画布顶部、居中固定 210px（参考站只暴露三个入口）。 */
const TOOLBAR =
  'redraw-toolbar absolute top-0 left-1/2 box-border w-[210px] max-w-[calc(100%_-_32px)]! h-10 min-h-10 py-0! px-4! flex-nowrap! gap-1.5! justify-center overflow-hidden -translate-x-1/2 shadow-[0_4px_8px_rgba(107,114,128,0.2)] max-[900px]:max-w-full!';

const TOOL_BTN =
  'redraw-tool-btn box-border h-[30px] self-center gap-1! rounded-md p-1! text-xs text-[color:var(--text-5)]! [&>svg]:size-4 [&>svg]:shrink-0';

interface ToolButtonProps {
  active: boolean;
  className?: string;
}

function toolButtonClass({ active, className }: ToolButtonProps): string {
  const state = active
    ? 'text-brand! bg-[var(--wb-flow-income-bg)]! shadow-[inset_0_0_0_1px_rgba(85,70,216,0.1)]!'
    : '';
  return `${TOOL_BTN} ${state}${className ? ` ${className}` : ''}`;
}

/** 画布工具栏：抓手 / 对比（未出结果时禁用）/ 框选。 */
export function WatermarkRemoveToolbar({ tool, onToolChange }: WatermarkRemoveToolbarProps) {
  return (
    <div className={TOOLBAR} role="toolbar" aria-label="重绘工具">
      <span className="toolbar-item-wrap contents">
        <button
          type="button"
          className={toolButtonClass({ active: tool === 'hand' })}
          aria-pressed={tool === 'hand'}
          title="抓手 (H)"
          onClick={() => onToolChange('hand')}
        >
          <Hand size={13} />
          抓手
        </button>
      </span>
      <span className="toolbar-item-wrap contents">
        <button type="button" className={TOOL_BTN} title="对比" disabled aria-pressed={false}>
          <Columns2 size={13} />
          对比
        </button>
        <b className="toolbar-divider flex-[0_0_1px] w-px h-4 m-0 bg-border max-[900px]:w-0" />
        <button
          type="button"
          className={toolButtonClass({ active: tool === 'rect' })}
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
