import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  MaskSession,
  pointInsideRect,
  sourcePoint,
  type DragMode,
  type Mark,
  type RegionBounds,
} from '../mask-sdk';

/** 去水印标注工具：参考站上传态只提供抓手与框选，默认框选。 */
export type WatermarkMaskTool = 'hand' | 'rect';

type ResizeHandle = 'n' | 'e' | 's' | 'w';

/** 去水印的标注区域与 SDK 的包围盒同源。 */
export type WatermarkMaskRegion = RegionBounds;

export interface WatermarkMaskHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  remove: (id: number) => void;
}

const RESIZE_HANDLES: ResizeHandle[] = ['n', 'e', 's', 'w'];

function framePosition(imageWidth: number, imageHeight: number) {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { left: '0%', top: '0%', width: '100%', height: '100%' };
  }
  if (imageWidth >= imageHeight) {
    const height = (imageHeight / imageWidth) * 100;
    return { left: '0%', top: `${(100 - height) / 2}%`, width: '100%', height: `${height}%` };
  }
  const width = (imageWidth / imageHeight) * 100;
  return { left: `${(100 - width) / 2}%`, top: '0%', width: `${width}%`, height: '100%' };
}

/**
 * 去水印画布 —— 页面侧适配层。
 *
 * 标记、撤销栈、手势、遮罩与导出都在 `mask-sdk` 的会话里；本组件只负责
 * 画框布局、指针捕获与可见标注层。可见标注使用参考站同款
 * `.redraw-image-frame > .mask-layer > .mask-mark` DOM，遮罩仅在提交时导出。
 *
 * 记忆化：本组件的 props 全部由页面稳定持有（setPan / handleMaskState / ref），
 * 页面因标注计数或上传态重渲染时无需重走标注 DOM。
 */
export const WatermarkMaskEditor = memo(function WatermarkMaskEditor({
  url,
  alt,
  tool,
  zoom,
  pan,
  onPanChange,
  onState,
  handleRef,
}: {
  url: string;
  alt: string;
  tool: WatermarkMaskTool;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  onState: (painted: boolean, canUndo: boolean, canRedo: boolean, regions: WatermarkMaskRegion[]) => void;
  handleRef: { current: WatermarkMaskHandle | null };
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const naturalRef = useRef({ w: 0, h: 0 });
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  /** 手势开始时缓存的画框矩形；逐次 pointermove 读取会强制重排。 */
  const gestureRectRef = useRef<DOMRect | null>(null);
  const [panning, setPanning] = useState(false);

  const sessionRef = useRef<MaskSession | null>(null);
  /* 去水印拖出新框时不立即显示缩放柄，抬起提交后再选中。 */
  if (!sessionRef.current) sessionRef.current = new MaskSession({ selectDraftShape: false });
  const session = sessionRef.current;

  const version = useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const overlay = useMemo(() => session.getOverlayModel(), [session, version]);

  /* 离散状态才回传页面；连续手势只刷新叠层。 */
  useEffect(
    () =>
      session.onStateChange((state) => {
        onState(state.painted, state.canUndo, state.canRedo, state.regions);
      }),
    [onState, session],
  );

  useEffect(() => () => session.dispose(), [session]);

  useEffect(() => {
    naturalRef.current = { w: 0, h: 0 };
    panStartRef.current = null;
    gestureRectRef.current = null;
    session.reset();
    setPanning(false);
  }, [session, url]);

  /* 缩放 / 平移 / 换图都会改变画框矩形，手势缓存必须作废。 */
  useEffect(() => {
    gestureRectRef.current = null;
  }, [zoom, pan, url]);

  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const { w, h } = naturalRef.current;
    const rect = gestureRectRef.current ?? frameRef.current?.getBoundingClientRect() ?? null;
    const point = sourcePoint(clientX, clientY, rect, w, h);
    if (!point || !rect) return null;
    return { ...point, inside: pointInsideRect(rect, clientX, clientY) };
  }, []);

  useEffect(() => {
    handleRef.current = {
      toBlob: () => session.toBlob(),
      clear: () => session.clear(),
      undo: () => session.undo(),
      redo: () => session.redoStep(),
      remove: (id: number) => session.removeRegion(id),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, session]);

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'hand') {
      panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      setPanning(true);
      return;
    }

    /* 画框在本次手势内不会移动，缓存矩形避免每次 pointermove 强制重排。 */
    gestureRectRef.current = frameRef.current?.getBoundingClientRect() ?? null;
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point || !point.inside) {
      gestureRectRef.current = null;
      return;
    }
    session.beginGesture('rect', point);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panStartRef.current) {
      onPanChange({
        x: panStartRef.current.panX + event.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + event.clientY - panStartRef.current.y,
      });
      return;
    }
    if (!session.isGesturing()) return;
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    session.extendGesture(point);
  };

  const onCanvasPointerUp = () => {
    panStartRef.current = null;
    gestureRectRef.current = null;
    setPanning(false);
    session.endGesture();
  };

  const onCanvasPointerCancel = () => {
    panStartRef.current = null;
    gestureRectRef.current = null;
    setPanning(false);
    session.cancelGesture();
  };

  const beginMarkInteraction = (
    event: React.PointerEvent<HTMLElement>,
    mark: Mark,
    mode: DragMode,
    handle?: ResizeHandle,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    gestureRectRef.current = frameRef.current?.getBoundingClientRect() ?? null;
    const started = session.beginDrag(
      mark.id,
      mode,
      pointFromClient(event.clientX, event.clientY) ?? { x: 0, y: 0 },
      handle,
    );
    if (started) event.currentTarget.setPointerCapture(event.pointerId);
    else gestureRectRef.current = null;
  };

  const onMarkPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!session.isDragging()) return;
    event.stopPropagation();
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    session.extendDrag(point);
  };

  const endMarkInteraction = (event: React.PointerEvent<HTMLElement>) => {
    if (!session.isDragging()) return;
    event.stopPropagation();
    session.endDrag();
    gestureRectRef.current = null;
  };

  const frame = framePosition(naturalRef.current.w, naturalRef.current.h);
  const { marks, regionIndex, selectedId } = overlay;

  return (
    <div
      className="redraw-canvas-wrap"
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}
    >
      <div
        className={`redraw-canvas tool-${tool}${panning ? ' is-panning' : ''}`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerCancel}
      >
        <div ref={frameRef} className="redraw-image-frame" style={frame}>
          <img
            className="canvas-original"
            src={url}
            alt={alt}
            draggable={false}
            onLoad={(event) => {
              const width = event.currentTarget.naturalWidth;
              const height = event.currentTarget.naturalHeight;
              if (width <= 0 || height <= 0) return;
              naturalRef.current = { w: width, h: height };
              session.setSourceSize(width, height);
            }}
          />
          <div className="mask-layer" aria-hidden="true">
            {marks.map((mark) => {
              const selected = selectedId === mark.id;
              const index = regionIndex.get(mark.id);
              return (
                <i
                  key={mark.id}
                  className={`mask-mark rect has-index${selected ? ' is-selected' : ''}`}
                  style={{
                    left: `${((mark.x + mark.width / 2) / Math.max(naturalRef.current.w, 1)) * 100}%`,
                    top: `${((mark.y + mark.height / 2) / Math.max(naturalRef.current.h, 1)) * 100}%`,
                    width: `${(mark.width / Math.max(naturalRef.current.w, 1)) * 100}%`,
                    height: `${(mark.height / Math.max(naturalRef.current.h, 1)) * 100}%`,
                  }}
                  onPointerDown={(event) => beginMarkInteraction(event, mark, 'move')}
                  onPointerMove={onMarkPointerMove}
                  onPointerUp={endMarkInteraction}
                  onPointerCancel={endMarkInteraction}
                >
                  {index ? <span className="mask-mark-index">{index}</span> : null}
                  {selected
                    ? RESIZE_HANDLES.map((handle) => (
                        <span
                          key={handle}
                          className={`resize-handle ${handle}`}
                          onPointerDown={(event) => beginMarkInteraction(event, mark, 'resize', handle)}
                          onPointerMove={onMarkPointerMove}
                          onPointerUp={endMarkInteraction}
                          onPointerCancel={endMarkInteraction}
                        />
                      ))
                    : null}
                </i>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
