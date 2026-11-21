import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextAction,
  useApp,
} from '../ui';
import {
  boundsOfPoints,
  clamp01,
  createRegionId,
  MAX_HISTORY,
  MIN_SIZE,
  normalizeBox,
  resizeBox,
  round4,
  type SkuRegion,
  type Draft,
  type Interaction,
  type Point,
  type SkuHandle as Handle,
  type SkuTool as Tool,
} from '../lib/skuRegionGeometry';
import { SkuRegionEditorToolbar } from './SkuRegionEditorToolbar';
import { SkuRegionOverlay } from './SkuRegionOverlay';

/** 区域坐标模型与几何运算的唯一来源是 `lib/skuRegionGeometry`，此处按原路径再导出。 */
export type { SkuRegion, SkuRegionPoint, SkuRegionType } from '../lib/skuRegionGeometry';

interface Props {
  open: boolean;
  url: string;
  alt?: string;
  initialRegions: SkuRegion[];
  max?: number;
  onClose: () => void;
  onConfirm: (regions: SkuRegion[]) => void;
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
  const { message } = useApp();
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
      // Esc 由 Radix Dialog 负责关闭与焦点归位，这里只处理编辑器快捷键。
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
  }, [open, redo, removeRegion, selectedId, undo]);

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

  const frameCursor: Record<Tool, string> = {
    hand: 'cursor-grab',
    rect: 'cursor-crosshair',
    ellipse: 'cursor-crosshair',
    brush: 'cursor-crosshair',
    eraser: 'cursor-crosshair',
  };

  const dialog = (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[2400] bg-[var(--overlay-mask-strong)]"
        className="z-[2400] flex h-[min(800px,calc(100vh-48px))] min-h-0 w-[min(1200px,calc(100%-48px))] max-w-none flex-col gap-0 rounded-3xl border-0 bg-page px-8 pt-[33px] pb-[22px] sm:max-w-none max-[900px]:rounded-[18px] max-[900px]:px-3.5 max-[900px]:py-5"
        aria-describedby="product-sku-region-desc"
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-center text-base leading-[22px] font-semibold text-foreground">
            框选 SKU 变体区域
          </DialogTitle>
          <DialogDescription
            id="product-sku-region-desc"
            className="text-center text-xs leading-[18px] text-muted-foreground max-[560px]:mx-auto max-[560px]:max-w-[270px]"
          >
            在模板图上框选需要跟随 SKU 变化的位置，最多 3 个区域；框外内容保持不变。
          </DialogDescription>
        </DialogHeader>

        <SkuRegionEditorToolbar
          tool={tool}
          onToolChange={setTool}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          canClear={regions.length > 0}
          onUndo={undo}
          onRedo={redo}
          onClear={() => {
            commit([]);
            setSelectedId(null);
          }}
          zoom={zoom}
          onZoomChange={setZoom}
          count={regions.length}
          onConfirm={() => onConfirm(regions)}
        />

        <div
          ref={stageRef}
          className="flex min-h-0 flex-1 items-center justify-center overflow-auto pt-[23px] pb-[9px] max-[900px]:h-[min(60vh,500px)] max-[900px]:p-2.5"
        >
          <div
            ref={frameRef}
            className={`relative inline-block max-h-full max-w-full flex-none origin-center leading-none transition-transform duration-[160ms] touch-none select-none motion-reduce:transition-none ${frameCursor[tool]}`}
            style={{ transform: `scale(${zoom})` }}
            onPointerDown={onFramePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelPointer}
          >
            <img
              src={url}
              alt={alt}
              draggable={false}
              className="pointer-events-none block h-auto w-auto max-h-[min(510px,calc(100vh-290px))] max-w-[min(100%,1100px)] object-contain select-none max-[900px]:max-h-[min(54vh,440px)]"
            />
            <SkuRegionOverlay
              regions={regions}
              selectedId={selectedId}
              draftBox={draftBox}
              draft={draft}
              brushSize={brushSize}
              onRegionPointerDown={onRegionPointerDown}
              onHandlePointerDown={onHandlePointerDown}
              onRemoveRegion={removeRegion}
            />
          </div>
        </div>

        <DialogFooter className="mt-2 items-center justify-between gap-2 max-[900px]:flex-wrap">
          <TextAction
            icon={<RotateCcw size={13} aria-hidden />}
            disabled={regions.length === 0}
            onClick={() => {
              commit([]);
              setSelectedId(null);
            }}
          >
            清空全部区域
          </TextAction>
          <p className="m-0 text-center text-xs leading-4 text-muted-foreground">
            抓手可移动区域或画布 · Delete 删除选中区域 · Ctrl/⌘ + Z 撤销
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return dialog;
}

