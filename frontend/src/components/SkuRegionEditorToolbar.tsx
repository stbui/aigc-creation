import { Brush, Check, Circle, Eraser, Hand, Redo2, Square, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';

import { Badge, Button, Slider, ToggleGroup, ToggleGroupItem } from '../ui';
import type { SkuTool } from '../lib/skuRegionGeometry';

/**
 * SKU 区域编辑器的工具条与底部确认条。
 *
 * 2026-11-20 从 `SkuRegionEditorModal` 抽出。工具选择走 shadcn `ToggleGroup`
 * （单选、方向键组内移动、`aria-pressed` 由 Radix 维护），笔刷尺寸走 shadcn
 * `Slider`（读屏为 slider 角色，自带键盘步进），撤销 / 重做 / 清空与缩放走
 * shadcn `Button`。此前这里是自绘 button + 原生 range + 伪元素滑块。
 */
interface Props {
  tool: SkuTool;
  onToolChange: (tool: SkuTool) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  count: number;
  onConfirm: () => void;
}

const TOOLS: Array<{ value: SkuTool; label: string; icon: typeof Hand }> = [
  { value: 'hand', label: '抓手', icon: Hand },
  { value: 'rect', label: '矩形', icon: Square },
  { value: 'ellipse', label: '椭圆', icon: Circle },
  { value: 'brush', label: '画笔', icon: Brush },
  { value: 'eraser', label: '橡皮', icon: Eraser },
];

export function SkuRegionEditorToolbar({
  tool,
  onToolChange,
  brushSize,
  onBrushSizeChange,
  canUndo,
  canRedo,
  canClear,
  onUndo,
  onRedo,
  onClear,
  zoom,
  onZoomChange,
  count,
  onConfirm,
}: Props) {
  return (
    <div className="mx-auto mt-8 flex min-h-10 w-fit max-w-full flex-wrap items-center gap-2.5 max-[900px]:w-full">
      <div
        className="flex min-h-10 flex-auto flex-wrap items-center gap-2 rounded-md bg-card px-3 py-1.5 shadow-card"
        role="toolbar"
        aria-label="区域编辑工具"
      >
        <ToggleGroup
          type="single"
          value={tool}
          onValueChange={(next) => next && onToolChange(next as SkuTool)}
          aria-label="绘制工具"
          size="sm"
          className="gap-1"
        >
          {TOOLS.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={label}
              title={label}
              size="sm"
              className="size-7 min-w-7 rounded-sm p-0 text-muted-foreground data-[state=on]:bg-brand-bg data-[state=on]:text-brand"
            >
              <Icon size={14} aria-hidden />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex w-24 items-center gap-2">
          <Slider
            value={[brushSize]}
            min={6}
            max={48}
            step={1}
            thumbAriaLabel="画笔大小"
            onValueChange={(next) => onBrushSizeChange(next[0] ?? brushSize)}
          />
          <span className="min-w-5 text-center text-xs text-muted-foreground">{brushSize}</span>
        </div>

        <span className="h-4 w-px bg-border" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="撤销"
          title="撤销"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="重做"
          title="重做"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="清空区域"
          title="清空区域"
          disabled={!canClear}
          onClick={onClear}
        >
          <Trash2 aria-hidden />
        </Button>
        <span className="h-4 w-px bg-border" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="缩小画布"
          disabled={zoom <= 1}
          onClick={() => onZoomChange(Math.max(1, zoom - 0.25))}
        >
          <ZoomOut aria-hidden />
        </Button>
        <span className="min-w-8 text-center text-xs font-normal text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="放大画布"
          disabled={zoom >= 2.5}
          onClick={() => onZoomChange(Math.min(2.5, zoom + 0.25))}
        >
          <ZoomIn aria-hidden />
        </Button>
      </div>

      <Badge variant="secondary" className="shrink-0">
        共 {count} 个区域
      </Badge>
      <Button type="button" size="sm" className="w-[76px] flex-none" disabled={count === 0} onClick={onConfirm}>
        <Check aria-hidden />
        确认 ({count})
      </Button>
    </div>
  );
}