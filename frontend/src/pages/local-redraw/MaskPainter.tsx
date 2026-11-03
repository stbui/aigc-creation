import { useCallback, useEffect, useRef, useState } from 'react';

import {
  RESIZE_HANDLES,
  type Mark,
  type MaskPainterHandle,
  type PaintTool,
  type RegionBounds,
  type ResizeHandle,
  type ShapeMark,
  type StrokeMark,
} from './constants';
import { clamp, cloneMark, isRegionMark } from './utils';

interface MarkInteraction {
  mode: 'move' | 'resize';
  mark: Mark;
  snapshot: Mark;
  start: { x: number; y: number };
  handle?: ResizeHandle;
}

/**
 * 遮罩画布。
 *
 * 可见标注与参考站一致使用 DOM：矩形是可拖动、可四向缩放的透明色块，
 * 涂抹是沿采样点排列的圆点，右上编号与区域一一对应。离屏 mask canvas
 * 仍是唯一导出源，DOM 只负责显示和选择 —— 提交协议不因视觉层变化而改变。
 */
export function MaskPainter({
  url,
  tool,
  brush,
  zoom,
  pan,
  maxRegions,
  onPanChange,
  onRegionLimit,
  onChange,
  onNaturalSize,
  handleRef,
}: {
  url: string;
  tool: PaintTool;
  brush: number;
  zoom: number;
  pan: { x: number; y: number };
  maxRegions: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  onRegionLimit: () => void;
  /** 有可提交的涂抹 / 可撤回 / 可恢复 / 当前标注区域数 */
  onChange: (painted: boolean, canUndo: boolean, canRedo: boolean, regionCount: number) => void;
  /** 原图加载后回传真实像素尺寸，供外层画布按图片比例布局。 */
  onNaturalSize?: (size: { width: number; height: number }) => void;
  handleRef: { current: MaskPainterHandle | null };
}) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const marksRef = useRef<Mark[]>([]);
  const redoRef = useRef<Mark[]>([]);
  const draftRef = useRef<Mark | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dragRef = useRef<MarkInteraction | null>(null);
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const nextMarkIdRef = useRef(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [, bumpRevision] = useState(0);
  const [fittedSize, setFittedSize] = useState<{ width: number; height: number } | null>(null);

  /**
   * 把原图等比装进外层画布舞台。
   *
   * 外层宽高比由图片真实尺寸驱动；这里再按实际可用宽高收缩一次，
   * 用于抵消边框、缩放和窗口变化，确保图片、交互 canvas、DOM 标注层始终重合。
   */
  const fitToStage = useCallback(() => {
    const stage = stageRef.current;
    const wrap = stage?.parentElement;
    const { w, h } = naturalRef.current;
    if (!wrap || w <= 0 || h <= 0) return;
    const availableWidth = wrap.clientWidth;
    const availableHeight = wrap.clientHeight;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    const scale = Math.min(availableWidth / w, availableHeight / h);
    const round = (value: number) => Math.round(value * 100) / 100;
    const width = Math.max(1, round(w * scale));
    const height = Math.max(1, round(h * scale));
    setFittedSize((prev) =>
      prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    );
  }, []);

  useEffect(() => {
    const wrap = stageRef.current?.parentElement;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitToStage());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [fitToStage]);

  /** 当前笔刷在原图像素下的线宽。 */
  const lineWidth = useCallback(() => {
    const w = naturalRef.current.w;
    const displayWidth = transformRef.current?.offsetWidth || 1;
    const scale = Math.max(zoom / 100, 0.01);
    return Math.max(2, (brush * (w / Math.max(displayWidth, 1))) / scale);
  }, [brush, zoom]);

  /** 指针坐标 → 原图像素坐标；缩放与舞台适配都由 DOMRect 自动折算。 */
  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    const { w, h } = naturalRef.current;
    const rect = frame?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || w <= 0 || h <= 0) return { x: 0, y: 0 };
    return {
      x: clamp(((clientX - rect.left) / rect.width) * w, 0, w),
      y: clamp(((clientY - rect.top) / rect.height) * h, 0, h),
    };
  }, []);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) =>
    pointFromClient(e.clientX, e.clientY);

  /** 离屏遮罩只画黑白 alpha：透明 = 重绘区，白色 = 保留区。 */
  const drawMaskMark = useCallback((ctx: CanvasRenderingContext2D, mark: Mark) => {
    if (mark.kind === 'stroke') {
      if (mark.points.length === 0) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = mark.width;
      ctx.globalAlpha = 1;
      if (mark.tool === 'brush') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'black';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'white';
      }
      ctx.beginPath();
      ctx.moveTo(mark.points[0].x, mark.points[0].y);
      for (let i = 1; i < mark.points.length; i += 1) ctx.lineTo(mark.points[i].x, mark.points[i].y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'black';
    if (mark.tool === 'rect') {
      ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    } else {
      ctx.beginPath();
      ctx.ellipse(
        mark.x + mark.width / 2,
        mark.y + mark.height / 2,
        Math.abs(mark.width) / 2,
        Math.abs(mark.height) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }, []);

  const render = useCallback(
    (draft?: Mark | null) => {
      const mask = maskRef.current;
      if (!mask) return;
      const mctx = mask.getContext('2d');
      if (!mctx) return;
      mctx.globalCompositeOperation = 'source-over';
      mctx.globalAlpha = 1;
      mctx.fillStyle = 'white';
      mctx.fillRect(0, 0, mask.width, mask.height);
      for (const mark of marksRef.current) drawMaskMark(mctx, mark);
      if (draft) drawMaskMark(mctx, draft);
      bumpRevision((value) => value + 1);
    },
    [drawMaskMark],
  );

  /** 在 64×64 缩略图上数透明像素，避免为 4K 遮罩逐像素扫描。 */
  const hasPaint = useCallback((): boolean => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0) return false;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const pctx = probe.getContext('2d');
    if (!pctx) return false;
    pctx.drawImage(mask, 0, 0, 64, 64);
    const data = pctx.getImageData(0, 0, 64, 64).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent += 1;
    return transparent >= 4;
  }, []);

  /** 橡皮只是修正遮罩，不创建新区域；框选/圈选与每段涂抹各算一个区域。 */
  const getRegionCount = useCallback((): number => {
    return marksRef.current.filter(isRegionMark).length;
  }, []);

  /** 每个可描述区域在原图上的包围盒。 */
  const getRegionBounds = useCallback((): RegionBounds[] => {
    return marksRef.current.filter(isRegionMark).map((mark) => {
      if (mark.kind === 'shape') {
        return {
          x: mark.x,
          y: mark.y,
          width: mark.width,
          height: mark.height,
          sourceWidth: naturalRef.current.w,
          sourceHeight: naturalRef.current.h,
        };
      }
      const points = mark.points;
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));
      const pad = mark.width / 2;
      return {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        width: maxX - minX + mark.width,
        height: maxY - minY + mark.width,
        sourceWidth: naturalRef.current.w,
        sourceHeight: naturalRef.current.h,
      };
    });
  }, []);

  const notify = useCallback(() => {
    onChange(hasPaint(), marksRef.current.length > 0, redoRef.current.length > 0, getRegionCount());
  }, [getRegionCount, hasPaint, onChange]);

  /** 删除第 index 个可描述区域（同时让标注卡少一条）。 */
  const removeRegion = useCallback((index: number) => {
    const regionMarks = marksRef.current.filter(isRegionMark);
    const target = regionMarks[index];
    if (!target) return;
    marksRef.current = marksRef.current.filter((mark) => mark !== target);
    redoRef.current = [];
    draftRef.current = null;
    shapeStartRef.current = null;
    dragRef.current = null;
    setSelectedId((current) => (current === target.id ? null : current));
    render();
    notify();
  }, [notify, render]);

  const setup = useCallback(
    (w: number, h: number) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask || w <= 0 || h <= 0) return;
      naturalRef.current = { w, h };
      onNaturalSize?.({ width: w, height: h });
      overlay.width = w;
      overlay.height = h;
      mask.width = w;
      mask.height = h;
      marksRef.current = [];
      redoRef.current = [];
      draftRef.current = null;
      shapeStartRef.current = null;
      dragRef.current = null;
      setSelectedId(null);
      setCursor(null);
      fitToStage();
      render();
      notify();
    },
    [fitToStage, notify, onNaturalSize, render],
  );

  const commit = useCallback(
    (mark: Mark) => {
      if (isRegionMark(mark) && getRegionCount() >= maxRegions) {
        draftRef.current = null;
        shapeStartRef.current = null;
        setSelectedId((current) => (current === mark.id ? null : current));
        render();
        notify();
        onRegionLimit();
        return;
      }
      marksRef.current = [...marksRef.current, mark];
      redoRef.current = [];
      draftRef.current = null;
      shapeStartRef.current = null;
      setSelectedId(mark.kind === 'shape' ? mark.id : null);
      render();
      notify();
    },
    [getRegionCount, maxRegions, notify, onRegionLimit, render],
  );

  const undo = useCallback(() => {
    const last = marksRef.current[marksRef.current.length - 1];
    if (!last) return;
    marksRef.current = marksRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, last];
    setSelectedId((current) => (current === last.id ? null : current));
    render();
    notify();
  }, [notify, render]);

  const redo = useCallback(() => {
    const next = redoRef.current[redoRef.current.length - 1];
    if (!next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    marksRef.current = [...marksRef.current, next];
    setSelectedId(next.kind === 'shape' ? next.id : null);
    render();
    notify();
  }, [notify, render]);

  const clear = useCallback(() => {
    marksRef.current = [];
    redoRef.current = [];
    draftRef.current = null;
    shapeStartRef.current = null;
    dragRef.current = null;
    setSelectedId(null);
    render();
    notify();
  }, [notify, render]);

  const toBlob = useCallback((): Promise<Blob | null> => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0 || !hasPaint()) return Promise.resolve(null);
    return new Promise<Blob | null>((resolve) => mask.toBlob((b) => resolve(b), 'image/png'));
  }, [hasPaint]);

  useEffect(() => {
    handleRef.current = { toBlob, clear, undo, redo, getRegionCount, getRegionBounds, removeRegion };
    return () => {
      handleRef.current = null;
    };
  }, [clear, getRegionCount, getRegionBounds, handleRef, redo, removeRegion, toBlob, undo]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(null);
    if (tool === 'hand') {
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    const p = pointOf(e);
    if (tool === 'brush' || tool === 'eraser') {
      draftRef.current = {
        kind: 'stroke',
        id: nextMarkIdRef.current++,
        tool,
        points: [p],
        width: lineWidth(),
      };
      render(draftRef.current);
      return;
    }
    const draft: ShapeMark = {
      kind: 'shape',
      id: nextMarkIdRef.current++,
      tool,
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
    };
    shapeStartRef.current = p;
    draftRef.current = draft;
    setSelectedId(draft.id);
    render(draft);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'brush' || tool === 'eraser') setCursor(pointFromClient(e.clientX, e.clientY));
    if (tool === 'hand' && panStartRef.current) {
      onPanChange({
        x: panStartRef.current.panX + e.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + e.clientY - panStartRef.current.y,
      });
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    const p = pointOf(e);
    if (draft.kind === 'stroke') {
      draft.points = [...draft.points, p];
    } else if (shapeStartRef.current) {
      draft.x = Math.min(shapeStartRef.current.x, p.x);
      draft.y = Math.min(shapeStartRef.current.y, p.y);
      draft.width = Math.abs(p.x - shapeStartRef.current.x);
      draft.height = Math.abs(p.y - shapeStartRef.current.y);
    }
    render(draft);
  };

  const onPointerUp = () => {
    panStartRef.current = null;
    const draft = draftRef.current;
    if (!draft) return;
    if (draft.kind === 'stroke') {
      if (draft.points.length > 0) commit(draft);
      else {
        draftRef.current = null;
        render();
        notify();
      }
      return;
    }
    if (draft.width >= 4 && draft.height >= 4) commit(draft);
    else {
      draftRef.current = null;
      shapeStartRef.current = null;
      setSelectedId(null);
      render();
      notify();
    }
  };

  const onPointerCancel = () => {
    panStartRef.current = null;
    draftRef.current = null;
    shapeStartRef.current = null;
    render();
    notify();
  };

  const beginMarkInteraction = (
    e: React.PointerEvent<HTMLElement>,
    mark: Mark,
    mode: MarkInteraction['mode'],
    handle?: ResizeHandle,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(mark.id);
    dragRef.current = {
      mode,
      mark,
      snapshot: cloneMark(mark),
      start: pointFromClient(e.clientX, e.clientY),
      handle,
    };
    redoRef.current = [];
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMarkPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const point = pointFromClient(e.clientX, e.clientY);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const { w, h } = naturalRef.current;

    if (drag.mode === 'move') {
      if (drag.mark.kind === 'shape' && drag.snapshot.kind === 'shape') {
        drag.mark.x = clamp(drag.snapshot.x + dx, 0, Math.max(0, w - drag.snapshot.width));
        drag.mark.y = clamp(drag.snapshot.y + dy, 0, Math.max(0, h - drag.snapshot.height));
      } else if (drag.mark.kind === 'stroke' && drag.snapshot.kind === 'stroke') {
        drag.mark.points = drag.snapshot.points.map((p) => ({
          x: clamp(p.x + dx, 0, w),
          y: clamp(p.y + dy, 0, h),
        }));
      }
    } else if (drag.mark.kind === 'shape' && drag.snapshot.kind === 'shape') {
      const snapshot = drag.snapshot;
      let left = snapshot.x;
      let top = snapshot.y;
      let right = snapshot.x + snapshot.width;
      let bottom = snapshot.y + snapshot.height;
      if (drag.handle?.includes('w')) left = clamp(left + dx, 0, right - 4);
      if (drag.handle?.includes('e')) right = clamp(right + dx, left + 4, w);
      if (drag.handle?.includes('n')) top = clamp(top + dy, 0, bottom - 4);
      if (drag.handle?.includes('s')) bottom = clamp(bottom + dy, top + 4, h);
      drag.mark.x = left;
      drag.mark.y = top;
      drag.mark.width = right - left;
      drag.mark.height = bottom - top;
    }
    render();
  };

  const endMarkInteraction = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    notify();
  };

  const renderedMarks: Mark[] = draftRef.current
    ? [...marksRef.current, draftRef.current]
    : marksRef.current;
  const regionMarks = renderedMarks.filter(isRegionMark);
  const regionIndex = new Map(regionMarks.map((mark, index) => [mark.id, index + 1]));
  const cursorWidth = naturalRef.current.w > 0 ? (lineWidth() / naturalRef.current.w) * 100 : 0;

  const visiblePoints = (mark: StrokeMark, allMarks: Mark[]) => {
    const start = allMarks.indexOf(mark);
    const erasers = allMarks
      .slice(start + 1)
      .filter((item): item is StrokeMark => item.kind === 'stroke' && item.tool === 'eraser');
    if (erasers.length === 0) return mark.points;
    return mark.points.filter(
      (point) =>
        !erasers.some((eraser) =>
          eraser.points.some(
            (erased) => Math.hypot(point.x - erased.x, point.y - erased.y) <= (eraser.width + mark.width) / 2,
          ),
        ),
    );
  };

  return (
    <div
      ref={stageRef}
      className={`redraw-mask-stage tool-${tool}`}
      style={fittedSize ? { width: `${fittedSize.width}px`, height: `${fittedSize.height}px` } : undefined}
    >
      <div
        ref={transformRef}
        className="redraw-mask-transform"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}
      >
        <div
          ref={frameRef}
          className={`redraw-image-frame tool-${tool}`}
          onPointerMove={(e) => {
            if (tool === 'brush' || tool === 'eraser') setCursor(pointFromClient(e.clientX, e.clientY));
          }}
          onPointerLeave={() => setCursor(null)}
        >
          <img
            className="redraw-mask-bg"
            src={url}
            alt="待重绘的原图"
            draggable={false}
            onLoad={(e) => setup(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
          <canvas
            ref={overlayRef}
            className={`redraw-mask-overlay tool-${tool}`}
            aria-label="在图上涂抹、框选或圈选要重绘的区域"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
          <div className="mask-layer" aria-hidden="true">
            {renderedMarks.map((mark) => {
              if (mark.kind === 'stroke' && mark.tool === 'eraser') return null;
              const index = regionIndex.get(mark.id);
              if (mark.kind === 'stroke') {
                const widthPct = naturalRef.current.w > 0 ? (mark.width / naturalRef.current.w) * 100 : 0;
                const first = mark.points[0];
                const points = visiblePoints(mark, renderedMarks);
                return (
                  <div key={mark.id}>
                    <span className="mask-brush-stroke">
                      {points.map((point, pointIndex) => (
                        <i
                          key={pointIndex}
                          className="mask-mark brush"
                          style={{
                            left: `${(point.x / Math.max(naturalRef.current.w, 1)) * 100}%`,
                            top: `${(point.y / Math.max(naturalRef.current.h, 1)) * 100}%`,
                            width: `${widthPct}%`,
                          }}
                          onPointerDown={(e) => beginMarkInteraction(e, mark, 'move')}
                          onPointerMove={onMarkPointerMove}
                          onPointerUp={endMarkInteraction}
                          onPointerCancel={endMarkInteraction}
                        />
                      ))}
                    </span>
                    {first && index ? (
                      <span
                        className="mask-mark-index brush-index"
                        style={{
                          left: `${(first.x / Math.max(naturalRef.current.w, 1)) * 100}%`,
                          top: `${(first.y / Math.max(naturalRef.current.h, 1)) * 100}%`,
                        }}
                      >
                        {index}
                      </span>
                    ) : null}
                  </div>
                );
              }

              const centerX = mark.x + mark.width / 2;
              const centerY = mark.y + mark.height / 2;
              return (
                <i
                  key={mark.id}
                  className={`mask-mark ${mark.tool} has-index${selectedId === mark.id ? ' is-selected' : ''}`}
                  style={{
                    left: `${(centerX / Math.max(naturalRef.current.w, 1)) * 100}%`,
                    top: `${(centerY / Math.max(naturalRef.current.h, 1)) * 100}%`,
                    width: `${(mark.width / Math.max(naturalRef.current.w, 1)) * 100}%`,
                    height: `${(mark.height / Math.max(naturalRef.current.h, 1)) * 100}%`,
                  }}
                  onPointerDown={(e) => beginMarkInteraction(e, mark, 'move')}
                  onPointerMove={onMarkPointerMove}
                  onPointerUp={endMarkInteraction}
                  onPointerCancel={endMarkInteraction}
                >
                  {index ? <span className="mask-mark-index">{index}</span> : null}
                  {selectedId === mark.id
                    ? RESIZE_HANDLES.map((handle) => (
                        <span
                          key={handle}
                          className={`resize-handle ${handle}`}
                          onPointerDown={(e) => beginMarkInteraction(e, mark, 'resize', handle)}
                          onPointerMove={onMarkPointerMove}
                          onPointerUp={endMarkInteraction}
                          onPointerCancel={endMarkInteraction}
                        />
                      ))
                    : null}
                </i>
              );
            })}
            {cursor && (tool === 'brush' || tool === 'eraser') ? (
              <i
                className={`brush-cursor ${tool}`}
                aria-hidden="true"
                style={{
                  left: `${(cursor.x / Math.max(naturalRef.current.w, 1)) * 100}%`,
                  top: `${(cursor.y / Math.max(naturalRef.current.h, 1)) * 100}%`,
                  width: `${cursorWidth}%`,
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
      {/* 离屏遮罩：只用于导出，不显示 */}
      <canvas ref={maskRef} className="redraw-mask-hidden" aria-hidden="true" />
    </div>
  );
}
