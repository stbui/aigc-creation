import type { EditorTool, Point } from '../lib/mattingEditor';

/**
 * 结果帧内的叠加层：原图/结果分割对比，或笔刷光标。
 *
 * 2026-11-15 从 `MattingResultEditor` 抽出。两者互斥（对比模式不显示光标），
 * 都挂在 `.background-result-image-frame` 内、随主体一起缩放平移。
 */
interface Props {
  compare: boolean;
  compareSplit: number;
  originalUrl: string;
  /** 笔刷光标在帧内的 CSS 坐标（已扣除平移与缩放前的原图坐标换算） */
  cursor: Point | null;
  tool: EditorTool;
  brushSize: number;
  onCompareSplitChange: (value: number) => void;
}

export function MattingResultOverlay({
  compare,
  compareSplit,
  originalUrl,
  cursor,
  tool,
  brushSize,
  onCompareSplitChange,
}: Props) {
  if (compare) {
    return (
      <>
        <div className="background-original-compare" style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}>
          <img src={originalUrl} alt="原图" draggable={false} />
        </div>
        <span className="background-before-label">原图</span>
        <span className="background-after-label">结果图</span>
        <div className="background-compare-line" style={{ left: `${compareSplit}%` }} aria-hidden="true" />
        <input
          className="background-compare-range"
          type="range"
          min={0}
          max={100}
          value={compareSplit}
          aria-label="调整原图与结果图的对比位置"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onCompareSplitChange(Number(e.target.value))}
        />
      </>
    );
  }

  if (!cursor || tool === 'hand') return null;

  return (
    <i
      className={`background-result-cursor ${tool}`}
      style={{
        left: cursor.x,
        top: cursor.y,
        width: brushSize,
        height: brushSize,
      }}
    />
  );
}
