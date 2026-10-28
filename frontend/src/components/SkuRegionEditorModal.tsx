import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { App } from 'antd';
import {
  Brush,
  Check,
  Circle,
  Eraser,
  Hand,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type SkuRegionType = 'rect' | 'ellipse' | 'brush';

export interface SkuRegionPoint {
  x: number;
  y: number;
}

/** 归一化坐标 (0~1)，与模板图原始像素尺寸无关。 */
export interface SkuRegion {
  id: string;
  type: SkuRegionType;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: SkuRegionPoint[];
}

type Tool = 'hand' | 'rect' | 'ellipse' | 'brush' | 'eraser';
type Handle = 'nw' | 'ne' | 'sw' | 'se';

interface Point {
  x: number;
  y: number;
}

interface Draft {
  type: 'rect' | 'ellipse' | 'brush';
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points: SkuRegionPoint[];
}

interface Interaction {
  kind: 'move' | 'resize';
  id: string;
  pointerId: number;
  start: Point;
  original: SkuRegion;
  snapshot: SkuRegion[];
  handle?: Handle;
}

interface Props {
  open: boolean;
  url: string;
  alt?: string;
  initialRegions: SkuRegion[];
  max?: number;
  onClose: () => void;
  onConfirm: (regions: SkuRegion[]) => void;
}

const MIN_SIZE = 0.025;
const MAX_HISTORY = 40;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeBox(start: Point, end: Point) {
  const left = clamp01(Math.min(start.x, end.x));
  const top = clamp01(Math.min(start.y, end.y));
  const right = clamp01(Math.max(start.x, end.x));
  const bottom = clamp01(Math.max(start.y, end.y));
  return {
    x: round4(left),
    y: round4(top),
    width: round4(right - left),
    height: round4(bottom - top),
  };
}

function boundsOfPoints(points: SkuRegionPoint[]) {
  if (points.length === 0) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return normalizeBox({ x: minX, y: minY }, { x: maxX, y: maxY });
}

function resizeBox(region: SkuRegion, handle: Handle, dx: number, dy: number) {
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;
  if (handle.includes('w')) left = Math.min(right - MIN_SIZE, Math.max(0, left + dx));
  if (handle.includes('e')) right = Math.max(left + MIN_SIZE, Math.min(1, right + dx));
  if (handle.includes('n')) top = Math.min(bottom - MIN_SIZE, Math.max(0, top + dy));
  if (handle.includes('s')) bottom = Math.max(top + MIN_SIZE, Math.min(1, bottom + dy));
  return {
    ...region,
    x: round4(left),
    y: round4(top),
    width: round4(right - left),
    height: round4(bottom - top),
  };
}

function createRegionId(): string {
  return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function ToolbarButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? 'active' : undefined}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SkuRegionEditorModal({
  open,
  url,
  alt = 'SKU 模板图',
  initialRegions,
  max = 3,
  onClose,
  onConfirm,
}: Props) {
  const { message } = App.useApp();
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<Draft | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);

  const [regions, setRegions] = useState<SkuRegion[]>(initialRegions);
  const [past, setPast] = useState<SkuRegion[][]>([]);
  const [future, setFuture] = useState<SkuRegion[][]>([]);
  const [tool, setTool] = useState<Tool>('rect');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!open) return;
    setRegions(initialRegions);
    setPast([]);
    setFuture([]);
    setSelectedId(initialRegions[0]?.id ?? null);
    setTool('rect');
    setZoom(1);
    setDraft(null);
    draftRef.current = null;
    interactionRef.current = null;
    panRef.current = null;
  }, [initialRegions, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const commit = useCallback(
    (next: SkuRegion[]) => {
      setPast((items) => [...items, regions].slice(-MAX_HISTORY));
      setFuture([]);
      setRegions(next);
    },
    [regions],
  );

  const removeRegion = useCallback(
    (id: string) => {
      commit(regions.filter((region) => region.id !== id));
      setSelectedId((current) => (current === id ? null : current));
    },
    [commit, regions],
  );

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items[items.length - 1];
      if (!previous) return items;
      setFuture((next) => [regions, ...next].slice(0, MAX_HISTORY));
      setRegions(previous);
      if (selectedId && !previous.some((region) => region.id === selectedId)) setSelectedId(null);
      return items.slice(0, -1);
    });
  }, [regions, selectedId]);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((previous) => [...previous, regions].slice(-MAX_HISTORY));
      setRegions(next);
      if (selectedId && !next.some((region) => region.id === selectedId)) setSelectedId(null);
      return items.slice(1);
    });
  }, [regions, selectedId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        event.preventDefault();
        removeRegion(selectedId);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, redo, removeRegion, selectedId, undo]);

  if (!open) return null;

  const pointOf = (event: ReactPointerEvent<HTMLElement>): Point => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(rect.width, 1)),
      y: clamp01((event.clientY - rect.top) / Math.max(rect.height, 1)),
    };
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startDraft = (event: ReactPointerEvent<HTMLDivElement>, type: 'rect' | 'ellipse' | 'brush') => {
    if (regions.length >= max) {
      message.warning(`最多框选 ${max} 个变体区域`);
      return;
    }
    const point = pointOf(event);
    const next: Draft = {
      type,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      points: type === 'brush' ? [{ x: point.x, y: point.y }] : [],
    };
    draftRef.current = next;
    setDraft(next);
    setSelectedId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onFramePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (tool === 'hand') {
      startPan(event);
      return;
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'brush') {
      startDraft(event, tool);
    }
  };

  const onRegionPointerDown = (event: ReactPointerEvent<HTMLDivElement>, region: SkuRegion) => {
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    setSelectedId(region.id);
    if (tool === 'eraser') {
      removeRegion(region.id);
      return;
    }
    if (tool !== 'hand') return;
    interactionRef.current = {
      kind: 'move',
      id: region.id,
      pointerId: event.pointerId,
      start: pointOf(event),
      original: region,
      snapshot: regions,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    region: SkuRegion,
    handle: Handle,
  ) => {
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    setSelectedId(region.id);
    interactionRef.current = {
      kind: 'resize',
      id: region.id,
      pointerId: event.pointerId,
      start: pointOf(event),
      original: region,
      snapshot: regions,
      handle,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollLeft = pan.left - (event.clientX - pan.x);
      stage.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }

    const interaction = interactionRef.current;
    if (interaction && interaction.pointerId === event.pointerId) {
      const point = pointOf(event);
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      setRegions((current) =>
        current.map((region) => {
          if (region.id !== interaction.id) return region;
          if (interaction.kind === 'move') {
            const x = round4(Math.min(1 - interaction.original.width, Math.max(0, interaction.original.x + dx)));
            const y = round4(Math.min(1 - interaction.original.height, Math.max(0, interaction.original.y + dy)));
            return { ...interaction.original, x, y };
          }
          return resizeBox(interaction.original, interaction.handle!, dx, dy);
        }),
      );
      return;
    }

    const current = draftRef.current;
    if (!current) return;
    const point = pointOf(event);
    const next: Draft = {
      ...current,
      currentX: point.x,
      currentY: point.y,
    };
    if (current.type === 'brush') {
      const last = current.points[current.points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.0025) {
        next.points = [...current.points, { x: round4(point.x), y: round4(point.y) }];
      }
    }
    draftRef.current = next;
    setDraft(next);
  };

  const finishInteraction = () => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    interactionRef.current = null;
    setPast((items) => [...items, interaction.snapshot].slice(-MAX_HISTORY));
    setFuture([]);
  };

  const finishDraft = () => {
    const current = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!current) return;

    let next: SkuRegion | null = null;
    if (current.type === 'brush') {
      const bounds = boundsOfPoints(current.points);
      if (bounds && bounds.width >= MIN_SIZE && bounds.height >= MIN_SIZE) {
        next = {
          id: createRegionId(),
          type: 'brush',
          ...bounds,
          points: current.points,
        };
      }
    } else {
      const box = normalizeBox(
        { x: current.startX, y: current.startY },
        { x: current.currentX, y: current.currentY },
      );
      if (box.width >= MIN_SIZE && box.height >= MIN_SIZE) {
        next = { id: createRegionId(), type: current.type, ...box };
      }
    }

    if (!next) {
      message.warning('框选区域太小，请拖拽出更大的范围');
      return;
    }
    commit([...regions, next]);
    setSelectedId(next.id);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      panRef.current = null;
      return;
    }
    if (interactionRef.current) {
      finishInteraction();
      return;
    }
    finishDraft();
  };

  const cancelPointer = () => {
    panRef.current = null;
    interactionRef.current = null;
    draftRef.current = null;
    setDraft(null);
  };

  const draftBox = draft && draft.type !== 'brush' ? normalizeBox(
    { x: draft.startX, y: draft.startY },
    { x: draft.currentX, y: draft.currentY },
  ) : null;

  const dialog = (
    <div
      className="product-sku-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="product-sku-region-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sku-region-title"
      >
        <button type="button" className="product-sku-modal-close" aria-label="关闭区域编辑器" onClick={onClose}>
          <X size={20} />
        </button>
        <h2 id="product-sku-region-title">框选 SKU 变体区域</h2>
        <p>在模板图上框选需要跟随 SKU 变化的位置，最多 3 个区域；框外内容保持不变。</p>

        <div className="product-sku-editor-actions">
          <div className="product-sku-editor-toolbar" role="toolbar" aria-label="区域编辑工具">
            <ToolbarButton active={tool === 'hand'} label="抓手" onClick={() => setTool('hand')}>
              <Hand size={14} />
            </ToolbarButton>
            <ToolbarButton active={tool === 'rect'} label="矩形" onClick={() => setTool('rect')}>
              <Square size={14} />
            </ToolbarButton>
            <ToolbarButton active={tool === 'ellipse'} label="椭圆" onClick={() => setTool('ellipse')}>
              <Circle size={14} />
            </ToolbarButton>
            <ToolbarButton active={tool === 'brush'} label="画笔" onClick={() => setTool('brush')}>
              <Brush size={14} />
            </ToolbarButton>
            <ToolbarButton active={tool === 'eraser'} label="橡皮" onClick={() => setTool('eraser')}>
              <Eraser size={14} />
            </ToolbarButton>
            <span className="product-sku-brush-size">
              <input
                type="range"
                min={6}
                max={48}
                value={brushSize}
                aria-label="画笔大小"
                style={{ '--range-progress': `${((brushSize - 6) / 42) * 100}%` } as CSSProperties}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
              <b>{brushSize}</b>
            </span>
            <span className="product-sku-toolbar-divider" aria-hidden="true" />
            <ToolbarButton disabled={past.length === 0} label="撤销" onClick={undo}>
              <Undo2 size={14} />
            </ToolbarButton>
            <ToolbarButton disabled={future.length === 0} label="重做" onClick={redo}>
              <Redo2 size={14} />
            </ToolbarButton>
            <ToolbarButton disabled={regions.length === 0} label="清空区域" onClick={() => {
              commit([]);
              setSelectedId(null);
            }}>
              <Trash2 size={14} />
            </ToolbarButton>
            <span className="product-sku-toolbar-divider" aria-hidden="true" />
            <span className="product-sku-zoom-controls">
              <button type="button" aria-label="缩小画布" onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>
                <ZoomOut size={14} />
              </button>
              <b>{Math.round(zoom * 100)}%</b>
              <button type="button" aria-label="放大画布" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}>
                <ZoomIn size={14} />
              </button>
            </span>
          </div>
          <button
            type="button"
            className="product-sku-region-confirm"
            disabled={regions.length === 0}
            onClick={() => onConfirm(regions)}
          >
            <Check size={15} />
            确认 ({regions.length})
          </button>
        </div>

        <div ref={stageRef} className="product-sku-editor-stage">
          <div
            ref={frameRef}
            className={`product-sku-editor-frame tool-${tool}`}
            style={{ transform: `scale(${zoom})` }}
            onPointerDown={onFramePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelPointer}
          >
            <img src={url} alt={alt} draggable={false} />
            {regions.map((region, index) => {
              const selected = selectedId === region.id;
              return (
                <div
                  key={region.id}
                  className={`product-sku-editor-region ${region.type}${selected ? ' is-selected' : ''}`}
                  data-region-id={region.id}
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                  onPointerDown={(event) => onRegionPointerDown(event, region)}
                >
                  {region.type === 'brush' && region.points?.map((point, pointIndex) => (
                    <i
                      key={`${pointIndex}-${point.x}-${point.y}`}
                      style={{
                        left: `${((point.x - region.x) / Math.max(region.width, 0.0001)) * 100}%`,
                        top: `${((point.y - region.y) / Math.max(region.height, 0.0001)) * 100}%`,
                        width: brushSize,
                        height: brushSize,
                      }}
                    />
                  ))}
                  <b>{index + 1}</b>
                  {selected && region.type !== 'brush' && (['nw', 'ne', 'sw', 'se'] as Handle[]).map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      className={`resize-handle ${handle}`}
                      aria-label={`调整区域 ${index + 1}`}
                      onPointerDown={(event) => onHandlePointerDown(event, region, handle)}
                    />
                  ))}
                  <button
                    type="button"
                    className="product-sku-editor-region-remove"
                    aria-label={`删除区域 ${index + 1}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRegion(region.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            {draftBox && (
              <div
                className={`product-sku-editor-region draft ${draft?.type === 'ellipse' ? 'ellipse' : 'rect'}`}
                style={{
                  left: `${draftBox.x * 100}%`,
                  top: `${draftBox.y * 100}%`,
                  width: `${draftBox.width * 100}%`,
                  height: `${draftBox.height * 100}%`,
                }}
              />
            )}
            {draft?.type === 'brush' && draft.points.map((point, index) => (
              <i
                key={`${index}-${point.x}-${point.y}`}
                className="product-sku-editor-brush-dot"
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                  width: brushSize,
                  height: brushSize,
                }}
              />
            ))}
          </div>
        </div>

        <p className="product-sku-editor-shortcut-hint">
          抓手可移动区域或画布 · Delete 删除选中区域 · Ctrl/⌘ + Z 撤销
        </p>
        <button type="button" className="product-sku-editor-reset" disabled={regions.length === 0} onClick={() => {
          commit([]);
          setSelectedId(null);
        }}>
          <RotateCcw size={13} />
          清空全部区域
        </button>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

