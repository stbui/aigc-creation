import { useCallback, useEffect, useRef, useState } from 'react';

/** 去水印标注工具：参考站上传态只提供抓手与框选，默认框选。 */
export type WatermarkMaskTool = 'hand' | 'rect';

type ResizeHandle = 'n' | 'e' | 's' | 'w';

export interface WatermarkMaskRegion {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface WatermarkMaskHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  remove: (id: number) => void;
}

interface RectMark {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  mode: 'move' | 'resize';
  mark: RectMark;
  snapshot: RectMark;
  start: { x: number; y: number };
  handle?: ResizeHandle;
}

const RESIZE_HANDLES: ResizeHandle[] = ['n', 'e', 's', 'w'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

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
 * 去水印画布。
 *
 * 可见标注使用参考站同款 `.redraw-image-frame > .mask-layer > .mask-mark` DOM，
 * 不再用 canvas 位图覆盖交互。离屏遮罩仅在提交时生成：白底 + 透明标注区域。
 */
export function WatermarkMaskEditor({
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
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const naturalRef = useRef({ w: 0, h: 0 });
  const nextIdRef = useRef(1);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [marks, setMarks] = useState<RectMark[]>([]);
  const [redoMarks, setRedoMarks] = useState<RectMark[]>([]);
  const [draft, setDraft] = useState<RectMark | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);

  const marksRef = useRef(marks);
  const redoRef = useRef(redoMarks);
  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);
  useEffect(() => {
    redoRef.current = redoMarks;
  }, [redoMarks]);

  useEffect(() => {
    naturalRef.current = { w: 0, h: 0 };
    nextIdRef.current = 1;
    startRef.current = null;
    panStartRef.current = null;
    dragRef.current = null;
    setMarks([]);
    setRedoMarks([]);
    marksRef.current = [];
    redoRef.current = [];
    setDraft(null);
    setSelectedId(null);
    setPanning(false);
  }, [url]);

  const regions: WatermarkMaskRegion[] = marks.map((mark) => ({
    ...mark,
    sourceWidth: naturalRef.current.w,
    sourceHeight: naturalRef.current.h,
  }));

  useEffect(() => {
    onState(marks.length > 0, marks.length > 0, redoMarks.length > 0, regions);
    // regions 由 marks / 图片尺寸派生；imageRevision 让 onLoad 后重新发布一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, redoMarks, imageRevision, onState]);

  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    const { w, h } = naturalRef.current;
    const rect = frame?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || w <= 0 || h <= 0) return null;
    return {
      x: clamp(((clientX - rect.left) / rect.width) * w, 0, w),
      y: clamp(((clientY - rect.top) / rect.height) * h, 0, h),
      inside:
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
    };
  }, []);

  const setMark = useCallback((next: RectMark) => {
    const updated = marksRef.current.map((mark) => (mark.id === next.id ? next : mark));
    marksRef.current = updated;
    setMarks(updated);
  }, []);

  const commitMark = useCallback((mark: RectMark) => {
    const updated = [...marksRef.current, mark];
    marksRef.current = updated;
    redoRef.current = [];
    setMarks(updated);
    setRedoMarks([]);
    setSelectedId(mark.id);
    setDraft(null);
    startRef.current = null;
  }, []);

  const undo = useCallback(() => {
    const current = marksRef.current;
    const last = current[current.length - 1];
    if (!last) return;
    const next = current.slice(0, -1);
    const redo = [last, ...redoRef.current];
    marksRef.current = next;
    redoRef.current = redo;
    setMarks(next);
    setRedoMarks(redo);
    setSelectedId((selected) => (selected === last.id ? null : selected));
  }, []);

  const redo = useCallback(() => {
    const next = redoRef.current[0];
    if (!next) return;
    const redo = redoRef.current.slice(1);
    const updated = [...marksRef.current, next];
    marksRef.current = updated;
    redoRef.current = redo;
    setMarks(updated);
    setRedoMarks(redo);
    setSelectedId(next.id);
  }, []);

  const clear = useCallback(() => {
    marksRef.current = [];
    redoRef.current = [];
    setMarks([]);
    setRedoMarks([]);
    setDraft(null);
    setSelectedId(null);
    startRef.current = null;
    dragRef.current = null;
  }, []);

  const remove = useCallback((id: number) => {
    const updated = marksRef.current.filter((mark) => mark.id !== id);
    marksRef.current = updated;
    redoRef.current = [];
    setMarks(updated);
    setRedoMarks([]);
    setSelectedId((selected) => (selected === id ? null : selected));
  }, []);

  const toBlob = useCallback((): Promise<Blob | null> => {
    const { w, h } = naturalRef.current;
    const current = marksRef.current;
    if (w <= 0 || h <= 0 || current.length === 0) return Promise.resolve(null);

    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const ctx = mask.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'black';
    for (const mark of current) ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    return new Promise<Blob | null>((resolve) => mask.toBlob((blob) => resolve(blob), 'image/png'));
  }, []);

  useEffect(() => {
    handleRef.current = { toBlob, clear, undo, redo, remove };
    return () => {
      handleRef.current = null;
    };
  }, [clear, handleRef, redo, remove, toBlob, undo]);

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'hand') {
      panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      setPanning(true);
      return;
    }

    const point = pointFromClient(event.clientX, event.clientY);
    if (!point || !point.inside) return;
    startRef.current = { x: point.x, y: point.y };
    setSelectedId(null);
    setDraft({ id: nextIdRef.current, x: point.x, y: point.y, width: 0, height: 0 });
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panStartRef.current) {
      onPanChange({
        x: panStartRef.current.panX + event.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + event.clientY - panStartRef.current.y,
      });
      return;
    }
    if (!startRef.current || !draft) return;
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    const start = startRef.current;
    setDraft({
      ...draft,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const onCanvasPointerUp = () => {
    panStartRef.current = null;
    setPanning(false);
    if (!draft) return;
    if (draft.width >= 4 && draft.height >= 4) {
      nextIdRef.current += 1;
      commitMark(draft);
    } else {
      setDraft(null);
      startRef.current = null;
    }
  };

  const onCanvasPointerCancel = () => {
    panStartRef.current = null;
    startRef.current = null;
    dragRef.current = null;
    setPanning(false);
    setDraft(null);
  };

  const beginMarkInteraction = (
    event: React.PointerEvent<HTMLElement>,
    mark: RectMark,
    mode: DragState['mode'],
    handle?: ResizeHandle,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(mark.id);
    setRedoMarks([]);
    dragRef.current = {
      mode,
      mark: { ...mark },
      snapshot: { ...mark },
      start: pointFromClient(event.clientX, event.clientY) ?? { x: 0, y: 0 },
      handle,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onMarkPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const { w, h } = naturalRef.current;
    const snapshot = drag.snapshot;
    let next: RectMark;

    if (drag.mode === 'move') {
      next = {
        ...drag.mark,
        x: clamp(snapshot.x + dx, 0, Math.max(0, w - snapshot.width)),
        y: clamp(snapshot.y + dy, 0, Math.max(0, h - snapshot.height)),
      };
    } else {
      let left = snapshot.x;
      let top = snapshot.y;
      let right = snapshot.x + snapshot.width;
      let bottom = snapshot.y + snapshot.height;
      if (drag.handle === 'w') left = clamp(left + dx, 0, right - 4);
      if (drag.handle === 'e') right = clamp(right + dx, left + 4, w);
      if (drag.handle === 'n') top = clamp(top + dy, 0, bottom - 4);
      if (drag.handle === 's') bottom = clamp(bottom + dy, top + 4, h);
      next = { ...drag.mark, x: left, y: top, width: right - left, height: bottom - top };
    }
    drag.mark = next;
    setMark(next);
  };

  const endMarkInteraction = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    event.stopPropagation();
    dragRef.current = null;
  };

  const visibleMarks = draft ? [...marks, draft] : marks;
  const frame = framePosition(naturalRef.current.w, naturalRef.current.h);

  return (
    <div
      className="redraw-canvas-wrap"
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}
    >
      <div
        ref={canvasRef}
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
              naturalRef.current = {
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              };
              setImageRevision((value) => value + 1);
            }}
          />
          <div className="mask-layer" aria-hidden="true">
            {visibleMarks.map((mark, index) => {
              const { w, h } = naturalRef.current;
              const selected = selectedId === mark.id;
              return (
                <i
                  key={mark.id}
                  className={`mask-mark rect has-index${selected ? ' is-selected' : ''}`}
                  style={{
                    left: `${((mark.x + mark.width / 2) / Math.max(w, 1)) * 100}%`,
                    top: `${((mark.y + mark.height / 2) / Math.max(h, 1)) * 100}%`,
                    width: `${(mark.width / Math.max(w, 1)) * 100}%`,
                    height: `${(mark.height / Math.max(h, 1)) * 100}%`,
                  }}
                  onPointerDown={(event) => beginMarkInteraction(event, mark, 'move')}
                  onPointerMove={onMarkPointerMove}
                  onPointerUp={endMarkInteraction}
                  onPointerCancel={endMarkInteraction}
                >
                  <span className="mask-mark-index">{index + 1}</span>
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
}
