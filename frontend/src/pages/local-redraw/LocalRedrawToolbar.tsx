import type { CSSProperties } from 'react';
import { Columns2 } from 'lucide-react';

import { TOOLS, type PaintTool } from './constants';

/** 参考站工具栏顺序：抓手 / 擦除在对比按钮左侧，其余工具在右侧。 */
const LEADING_TOOLS: PaintTool[] = ['hand', 'eraser'];
const TRAILING_TOOLS: PaintTool[] = ['rect', 'ellipse', 'brush'];

const BRUSH_MIN = 10;
const BRUSH_MAX = 60;
const BRUSH_STEP = 2;

/**
 * 工具栏浮在画布顶部、居中固定 532px；≤1180 回到文档流并横向滚动。
 * 画笔滑块是原生 range，轨道填充与白芯紫边滑块只能靠伪元素皮肤。
 */
const TOOLBAR =
  'redraw-toolbar absolute top-0 left-1/2 box-border w-[532px] max-w-[calc(100%_-_32px)]! h-10 min-h-10 py-0! px-4! flex-nowrap! gap-1.5! overflow-hidden -translate-x-1/2 max-[1200px]:static! max-[1200px]:w-full! max-[1200px]:max-w-none! max-[1200px]:overflow-x-auto! max-[1200px]:overflow-y-hidden! max-[1200px]:justify-start! max-[1200px]:translate-none';

const TOOL_BTN_PADDING = 'p-1!';

const RANGE =
  'h-4 w-[100px] cursor-pointer appearance-none border-0 bg-transparent p-0 outline-none [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-[10px] [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--brand)_0_var(--range-progress),var(--surface)_var(--range-progress)_100%)] [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-brand [&::-webkit-slider-thumb]:bg-card [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-[10px] [&::-moz-range-track]:bg-[var(--surface)] [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-[10px] [&::-moz-range-progress]:bg-[var(--brand)] [&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-brand [&::-moz-range-thumb]:bg-card';

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
        className={`redraw-tool-btn${tool === item.value ? ' active' : ''} ${TOOL_BTN_PADDING}`}
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
    <div className={TOOLBAR} role="toolbar" aria-label="重绘工具">
      {LEADING_TOOLS.map(renderTool)}
      <button type="button" className={`redraw-tool-btn ${TOOL_BTN_PADDING}`} title="对比" disabled>
        <Columns2 size={16} />
        对比
      </button>
      {TRAILING_TOOLS.map(renderTool)}
      <label className="redraw-toolbar-brush ml-0!">
        <span className="sr-only">画笔大小</span>
        <input
          aria-label="画笔大小"
          type="range"
          className={RANGE}
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
