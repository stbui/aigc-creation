import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  RESIZE_HANDLES,
  type Mark,
  type MaskPainterHandle,
  type MaskState,
  type PaintTool,
  type ResizeHandle,
} from './constants';
import { MaskSession, sourcePoint } from './utils';

/**
 * 遮罩画布 —— 页面侧适配层。
 *
 * 标记、撤销栈、手势、遮罩与导出都在 `mask-sdk` 的会话里；本组件只负责
 * DOM：舞台适配、指针捕获、笔刷光标与可见标注层。
 *
 * 可见标注与参考站一致使用 DOM：矩形是可拖动、可四向缩放的透明色块，
 * 涂抹是沿采样点排列的圆点，右上编号与区域一一对应。离屏遮罩仍是唯一
 * 导出源，DOM 只负责显示和选择 —— 提交协议不因视觉层变化而改变。
 *
 * 记忆化：页面每输入一个字都会重渲染，而标注描述并不影响画布；props 全部
 * 稳定（回调由页面 useCallback 持有）时跳过整棵笔迹 DOM 的对账。
 */
export const MaskPainter = memo(function MaskPainter({
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
  /** 有可提交的涂抹 / 可撤回 / 可恢复 / 当前有效标注区域 */
  onChange: (state: MaskState) => void;
  /** 原图加载后回传真实像素尺寸，供外层画布按图片比例布局。 */
  onNaturalSize?: (size: { width: number; height: number }) => void;
  handleRef: { current: MaskPainterHandle | null };
}) {
  const transformRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLElement | null>(null);
  /** 手势开始时缓存的画框矩形；逐次 pointermove 读取会强制重排。 */
  const gestureRectRef = useRef<DOMRect | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [fittedSize, setFittedSize] = useState<{ width: number; height: number } | null>(null);

  const sessionRef = useRef<MaskSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new MaskSession();
  const session = sessionRef.current;

  /* 会话每推进一帧，叠层就重算一次；选中态 / 连续手势都走这条通道。 */
  const version = useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const overlay = useMemo(() => session.getOverlayModel(), [session, version]);

  useEffect(() => {
    session.setOptions({ maxRegions, onRegionLimit });
  }, [session, maxRegions, onRegionLimit]);

  /* 离散状态才回传页面；连续手势只刷新叠层，避免整页按帧重渲染。 */
  useEffect(() => session.onStateChange(onChange), [session, onChange]);

  useEffect(() => () => session.dispose(), [session]);

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

  /* 缩放 / 平移都会改变画框矩形，手势期间缓存的坐标基准必须作废。 */
  useEffect(() => {
    gestureRectRef.current = null;
  }, [zoom, pan]);

  /** 当前笔刷在原图像素下的线宽。 */
  const lineWidth = useCallback(() => {
    const w = naturalRef.current.w;
    const displayWidth = transformRef.current?.offsetWidth || 1;
    const scale = Math.max(zoom / 100, 0.01);
    return Math.max(2, (brush * (w / Math.max(displayWidth, 1))) / scale);
  }, [brush, zoom]);

  /** 指针坐标 → 原图像素坐标；缩放与舞台适配都由 DOMRect 自动折算。 */
  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const { w, h } = naturalRef.current;
    const rect = gestureRectRef.current ?? frameRef.current?.getBoundingClientRect() ?? null;
    return sourcePoint(clientX, clientY, rect, w, h) ?? { x: 0, y: 0 };
  }, []);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) =>
    pointFromClient(e.clientX, e.clientY);

  /**
   * 笔刷光标直接改样式，不走 state。
   *
   * 光标跟随 pointermove，每个事件都 setState 会把整个 DOM 叠层额外重渲染
   * 一遍；这里只碰一个节点的 left/top，绘制路径上的 React 渲染保持不变。
   */
  const updateCursor = useCallback((point: { x: number; y: number } | null) => {
    const el = cursorRef.current;
    if (!el) return;
    const { w, h } = naturalRef.current;
    if (!point || w <= 0 || h <= 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${(point.x / w) * 100}%`;
    el.style.top = `${(point.y / h) * 100}%`;
  }, []);

  const setup = useCallback(
    (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      naturalRef.current = { w, h };
      onNaturalSize?.({ width: w, height: h });
      gestureRectRef.current = null;
      updateCursor(null);
      session.setSourceSize(w, h);
      fitToStage();
    },
    [fitToStage, onNaturalSize, session, updateCursor],
  );

  useEffect(() => {
    handleRef.current = {
      toBlob: () => session.toBlob(),
      clear: () => session.clear(),
      undo: () => session.undo(),
      redo: () => session.redoStep(),
      getRegionCount: () => session.getRegionCount(),
      getRegionBounds: () => session.getRegionBounds(),
      removeRegion: (id: number) => session.removeRegion(id),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, session]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'hand') {
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    /* 画框在本次手势内不会移动，缓存矩形避免每次 pointermove 强制重排。 */
    gestureRectRef.current = frameRef.current?.getBoundingClientRect() ?? null;
    const point = pointOf(e);
    if (tool === 'brush' || tool === 'eraser') session.beginGesture(tool, point, lineWidth());
    else session.beginGesture(tool, point);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'hand' && panStartRef.current) {
      onPanChange({
        x: panStartRef.current.panX + e.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + e.clientY - panStartRef.current.y,
      });
      return;
    }
    if (!session.isGesturing()) return;
    session.extendGesture(pointOf(e));
  };

  const onPointerUp = () => {
    panStartRef.current = null;
    gestureRectRef.current = null;
    session.endGesture();
  };

  const onPointerCancel = () => {
    panStartRef.current = null;
    gestureRectRef.current = null;
    session.cancelGesture();
  };

  const beginMarkInteraction = (
    e: React.PointerEvent<HTMLElement>,
    mark: Mark,
    mode: 'move' | 'resize',
    handle?: ResizeHandle,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    gestureRectRef.current = frameRef.current?.getBoundingClientRect() ?? null;
    const started = session.beginDrag(mark.id, mode, pointFromClient(e.clientX, e.clientY), handle);
    if (started) e.currentTarget.setPointerCapture(e.pointerId);
    else gestureRectRef.current = null;
  };

  const onMarkPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!session.isDragging()) return;
    e.stopPropagation();
    session.extendDrag(pointFromClient(e.clientX, e.clientY));
  };

  const endMarkInteraction = (e: React.PointerEvent<HTMLElement>) => {
    if (!session.isDragging()) return;
    e.stopPropagation();
    session.endDrag();
    gestureRectRef.current = null;
  };

  const { marks: renderedMarks, regionIndex, dotsById, selectedId } = overlay;
  const sourceWidth = Math.max(naturalRef.current.w, 1);
  const sourceHeight = Math.max(naturalRef.current.h, 1);
  const cursorWidth = (lineWidth() / sourceWidth) * 100;

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
            if (tool === 'brush' || tool === 'eraser') {
              updateCursor(pointFromClient(e.clientX, e.clientY));
            }
          }}
          onPointerLeave={() => updateCursor(null)}
        >
          <img
            className="redraw-mask-bg"
            src={url}
            alt="待重绘的原图"
            draggable={false}
            onLoad={(e) => setup(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
          {/* 交互面本身不绘制内容：尺寸交给 CSS 拉伸，避免按原图尺寸分配一块空 canvas。 */}
          <canvas
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
                const dots = dotsById.get(mark.id) ?? [];
                const widthPct = (mark.width / sourceWidth) * 100;
                const first = dots[0];
                return (
                  <div key={mark.id}>
                    <span className="mask-brush-stroke">
                      {dots.map((point, pointIndex) => (
                        <i
                          key={pointIndex}
                          className="mask-mark brush"
                          style={{
                            left: `${(point.x / sourceWidth) * 100}%`,
                            top: `${(point.y / sourceHeight) * 100}%`,
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
                          left: `${(first.x / sourceWidth) * 100}%`,
                          top: `${(first.y / sourceHeight) * 100}%`,
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
                    left: `${(centerX / sourceWidth) * 100}%`,
                    top: `${(centerY / sourceHeight) * 100}%`,
                    width: `${(mark.width / sourceWidth) * 100}%`,
                    height: `${(mark.height / sourceHeight) * 100}%`,
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
            {tool === 'brush' || tool === 'eraser' ? (
              <i
                ref={cursorRef}
                className={`brush-cursor ${tool}`}
                aria-hidden="true"
                style={{ display: 'none', width: `${cursorWidth}%` }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
