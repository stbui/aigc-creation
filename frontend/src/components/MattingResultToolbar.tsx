import type { CSSProperties } from 'react';
import { Columns2, Download, Eraser, Hand, Wrench } from 'lucide-react';
import { BRUSH_MAX, BRUSH_MIN, type EditorTool } from '../lib/mattingEditor';

/**
 * 一键抠图结果编辑器的顶部工具条（抓手 / 对比 / 擦除 / 修补 + 笔刷大小 + 下载）。
 *
 * 2026-11-15 从 `MattingResultEditor` 抽出：工具条只表达「当前选中哪个工具」，
 * 编辑状态与像素操作都在主组件与 `lib/mattingEditor`。
 */
interface Props {
  tool: EditorTool;
  compare: boolean;
  brushSize: number;
  downloading: boolean;
  onSelectTool: (tool: EditorTool) => void;
  onToggleCompare: () => void;
  onBrushSizeChange: (size: number) => void;
  onDownload: () => void;
}

export function MattingResultToolbar({
  tool,
  compare,
  brushSize,
  downloading,
  onSelectTool,
  onToggleCompare,
  onBrushSizeChange,
  onDownload,
}: Props) {
  const rangeProgress = `${((brushSize - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN)) * 100}%`;

  return (
    <div className="background-result-toolbar" role="toolbar" aria-label="一键抠图结果工具">
      <button
        type="button"
        className={tool === 'hand' && !compare ? 'active' : ''}
        aria-pressed={tool === 'hand' && !compare}
        onClick={() => onSelectTool('hand')}
      >
        <Hand size={16} />
        抓手
      </button>
      <button
        type="button"
        className={compare ? 'active' : ''}
        aria-pressed={compare}
        onClick={onToggleCompare}
      >
        <Columns2 size={16} />
        对比
      </button>
      <b />
      <button
        type="button"
        className={tool === 'eraser' && !compare ? 'active' : ''}
        aria-pressed={tool === 'eraser' && !compare}
        onClick={() => onSelectTool('eraser')}
      >
        <Eraser size={16} />
        擦除
      </button>
      <button
        type="button"
        className={tool === 'repair' && !compare ? 'active' : ''}
        aria-pressed={tool === 'repair' && !compare}
        onClick={() => onSelectTool('repair')}
      >
        <Wrench size={16} />
        修补
      </button>
      <input
        aria-label="工具大小"
        type="range"
        min={BRUSH_MIN}
        max={BRUSH_MAX}
        value={brushSize}
        style={{ ['--range-progress' as string]: rangeProgress } as CSSProperties}
        onChange={(e) => onBrushSizeChange(Number(e.target.value))}
      />
      <output>{brushSize}</output>
      <b />
      <button
        type="button"
        className="background-result-download-icon"
        aria-label="下载图片"
        title="下载图片"
        disabled={downloading}
        onClick={onDownload}
      >
        <Download size={16} />
      </button>
    </div>
  );
}
