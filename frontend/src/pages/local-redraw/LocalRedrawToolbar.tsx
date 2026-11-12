import type { CSSProperties } from 'react';
import { Columns2 } from 'lucide-react';

import { TOOLS, type PaintTool } from './constants';

/** 参考站工具栏顺序：抓手 / 擦除在对比按钮左侧，其余工具在右侧。 */
const LEADING_TOOLS: PaintTool[] = ['hand', 'eraser'];
const TRAILING_TOOLS: PaintTool[] = ['rect', 'ellipse', 'brush'];

const BRUSH_MIN = 10;
const BRUSH_MAX = 60;
const BRUSH_STEP = 2;

interface LocalRedrawToolbarProps {
  tool: PaintTool;
  brush: number;
  onToolChange: (tool: PaintTool) => void;
  onBrushChange: (brush: number) => void;
}

/** 画布工具栏：工具切换 + 画笔大小。 */
export function LocalRedrawToolbar({
  tool,
  brush,
  onToolChange,
  onBrushChange,
}: LocalRedrawToolbarProps) {
  const renderTool = (value: PaintTool) => {
    const item = TOOLS.find((candidate) => candidate.value === value);
    if (!item) return null;
    const Icon = item.icon;
    return (
      <button
        key={item.value}
        type="button"
        className={`redraw-tool-btn${tool === item.value ? ' active' : ''}`}
        aria-pressed={tool === item.value}
        title={`${item.label} (${item.shortcut})`}
        onClick={() => onToolChange(item.value)}
      >
        <Icon size={16} />
        {item.label}
      </button>
    );
  };

  return (
    <div className="redraw-toolbar" role="toolbar" aria-label="重绘工具">
      {LEADING_TOOLS.map(renderTool)}
      <button type="button" className="redraw-tool-btn" title="对比" disabled>
        <Columns2 size={16} />
        对比
      </button>
      {TRAILING_TOOLS.map(renderTool)}
      <label className="redraw-toolbar-brush">
        <span className="sr-only">画笔大小</span>
        <input
          aria-label="画笔大小"
          type="range"
          min={BRUSH_MIN}
          max={BRUSH_MAX}
          step={BRUSH_STEP}
          value={brush}
          style={
            {
              '--range-progress': `${((brush - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN)) * 100}%`,
            } as CSSProperties
          }
          onChange={(event) => onBrushChange(Number(event.target.value))}
        />
        <output>{brush}</output>
      </label>
    </div>
  );
}
