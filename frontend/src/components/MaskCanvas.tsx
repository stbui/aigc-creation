import { useCallback, useEffect, useRef } from 'react';

/**
 * 可复用的遮罩画布（去除水印 / 局部重绘同源交互）。
 *
 * 与局部重绘保持一致：底图用 <img>，品牌色叠层只用于预览；离屏画布先铺白，
 * 再用 destination-out 擦出透明区域。后端约定「透明 = 要去除」。
 * 笔迹保存为矢量标记，撤销/恢复只增删标记后重放，不必缓存整张 4K 位图。
 */

export type MaskTool = 'hand' | 'brush' | 'eraser' | 'rect' | 'ellipse';
type StrokeTool = 'brush' | 'eraser';
type ShapeTool = 'rect' | 'ellipse';

interface StrokeMark {
  kind: 'stroke';
  tool: StrokeTool;
  points: { x: number; y: number }[];
  width: number;
}

interface ShapeMark {
  kind: 'shape';
  tool: ShapeTool;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Mark = StrokeMark | ShapeMark;

export interface MaskCanvasHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
}

function brandColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#5b4df5';
}

export function MaskCanvas({
  url,
  alt,
  tool,
  brush,
  zoom,
  pan,
  onPanChange,
  onState,
  handleRef,
}: {
  url: string;
  alt: string;
  tool: MaskTool;
  brush: number;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  onState: (painted: boolean, canUndo: boolean, canRedo: boolean) => void;
  handleRef: { current: MaskCanvasHandle | null };
}) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<HTMLDivElement | null>(null);
  const marksRef = useRef<Mark[]>([]);
  const redoRef = useRef<Mark[]>([]);
  const draftRef = useRef<Mark | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const naturalRef = useRef({ w: 0, h: 0 });

  const lineWidth = useCallback(() => {
    const width = naturalRef.current.w;
    const displayWidth = transformRef.current?.offsetWidth || 1;
    const scale = Math.max(zoom / 100, 0.01);
    return Math.max(2, (brush * (width / Math.max(displayWidth, 1))) / scale);
  }, [brush, zoom]);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1)),
      y: (e.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1)),
    };
  };

  const drawMark = useCallback((octx: CanvasRenderingContext2D, mctx: CanvasRenderingContext2D, mark: Mark) => {
    const brand = brandColor();
    if (mark.kind === 'stroke') {
      if (!mark.points.length) return;
      const stroke = (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        ctx.moveTo(mark.points[0].x, mark.points[0].y);
        for (let i = 1; i < mark.points.length; i += 1) ctx.lineTo(mark.points[i].x, mark.points[i].y);
        ctx.stroke();
      };

      octx.save();
      octx.lineCap = 'round';
      octx.lineJoin = 'round';
      octx.lineWidth = mark.width;
      if (mark.tool === 'brush') {
        octx.globalCompositeOperation = 'source-over';
        octx.globalAlpha = 0.45;
        octx.strokeStyle = brand;
      } else {
        octx.globalCompositeOperation = 'destination-out';
        octx.globalAlpha = 1;
        octx.strokeStyle = 'black';
      }
      stroke(octx);
      octx.restore();

      mctx.save();
      mctx.lineCap = 'round';
      mctx.lineJoin = 'round';
      mctx.lineWidth = mark.width;
      mctx.globalAlpha = 1;
      if (mark.tool === 'brush') {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.strokeStyle = 'black';
      } else {
        mctx.globalCompositeOperation = 'source-over';
        mctx.strokeStyle = 'white';
      }
      stroke(mctx);
      mctx.restore();
      return;
    }

    octx.save();
    octx.fillStyle = brand;
    octx.globalAlpha = 0.4;
    if (mark.tool === 'rect') octx.fillRect(mark.x, mark.y, mark.width, mark.height);
    else {
      octx.beginPath();
      octx.ellipse(
        mark.x + mark.width / 2,
        mark.y + mark.height / 2,
        Math.abs(mark.width) / 2,
        Math.abs(mark.height) / 2,
        0,
        0,
        Math.PI * 2,
      );
      octx.fill();
    }
    octx.globalAlpha = 0.9;
    octx.lineWidth = 2;
    if (mark.tool === 'rect') octx.strokeRect(mark.x, mark.y, mark.width, mark.height);
    else {
      octx.beginPath();
      octx.ellipse(
        mark.x + mark.width / 2,
        mark.y + mark.height / 2,
        Math.abs(mark.width) / 2,
        Math.abs(mark.height) / 2,
        0,
        0,
        Math.PI * 2,
      );
      octx.stroke();
    }
    octx.restore();

    mctx.save();
    mctx.globalCompositeOperation = 'destination-out';
    mctx.fillStyle = 'black';
    if (mark.tool === 'rect') mctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    else {
      mctx.beginPath();
      mctx.ellipse(
        mark.x + mark.width / 2,
        mark.y + mark.height / 2,
        Math.abs(mark.width) / 2,
        Math.abs(mark.height) / 2,
        0,
        0,
        Math.PI * 2,
      );
      mctx.fill();
    }
    mctx.restore();
  }, []);

  const render = useCallback(
    (draft?: Mark | null) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask) return;
      const octx = overlay.getContext('2d');
      const mctx = mask.getContext('2d');
      if (!octx || !mctx) return;

      octx.clearRect(0, 0, overlay.width, overlay.height);
      mctx.globalCompositeOperation = 'source-over';
      mctx.globalAlpha = 1;
      mctx.fillStyle = 'white';
      mctx.fillRect(0, 0, mask.width, mask.height);
      for (const mark of marksRef.current) drawMark(octx, mctx, mark);
      if (draft) drawMark(octx, mctx, draft);
    },
    [drawMark],
  );

  const hasPaint = useCallback(() => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0) return false;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const ctx = probe.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(mask, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent += 1;
    return transparent >= 4;
  }, []);

  const notify = useCallback(() => {
    onState(hasPaint(), marksRef.current.length > 0, redoRef.current.length > 0);
  }, [hasPaint, onState]);

  const setup = useCallback(
    (w: number, h: number) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask || w <= 0 || h <= 0) return;
      naturalRef.current = { w, h };
      overlay.width = w;
      overlay.height = h;
      mask.width = w;
      mask.height = h;
      marksRef.current = [];
      redoRef.current = [];
      draftRef.current = null;
      shapeStartRef.current = null;
      render();
      notify();
    },
    [notify, render],
  );

  const commit = useCallback(
    (mark: Mark) => {
      marksRef.current = [...marksRef.current, mark];
      redoRef.current = [];
      draftRef.current = null;
      shapeStartRef.current = null;
      render();
      notify();
    },
    [notify, render],
  );

  const undo = useCallback(() => {
    const last = marksRef.current[marksRef.current.length - 1];
    if (!last) return;
    marksRef.current = marksRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, last];
    render();
    notify();
  }, [notify, render]);

  const redo = useCallback(() => {
    const next = redoRef.current[redoRef.current.length - 1];
    if (!next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    marksRef.current = [...marksRef.current, next];
    render();
    notify();
  }, [notify, render]);

  const clear = useCallback(() => {
    marksRef.current = [];
    redoRef.current = [];
    draftRef.current = null;
    shapeStartRef.current = null;
    render();
    notify();
  }, [notify, render]);

  const toBlob = useCallback((): Promise<Blob | null> => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0 || !hasPaint()) return Promise.resolve(null);
    return new Promise<Blob | null>((resolve) => mask.toBlob((blob) => resolve(blob), 'image/png'));
  }, [hasPaint]);

  useEffect(() => {
    handleRef.current = { toBlob, clear, undo, redo };
    return () => {
      handleRef.current = null;
    };
  }, [clear, handleRef, redo, toBlob, undo]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'hand') {
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    const point = pointOf(e);
    if (tool === 'brush' || tool === 'eraser') {
      draftRef.current = { kind: 'stroke', tool, points: [point], width: lineWidth() };
      render(draftRef.current);
      return;
    }
    shapeStartRef.current = point;
    draftRef.current = { kind: 'shape', tool, x: point.x, y: point.y, width: 0, height: 0 };
    render(draftRef.current);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panStartRef.current) {
      onPanChange({
        x: panStartRef.current.panX + e.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + e.clientY - panStartRef.current.y,
      });
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    const point = pointOf(e);
    if (draft.kind === 'stroke') draft.points = [...draft.points, point];
    else if (shapeStartRef.current) {
      draft.x = Math.min(shapeStartRef.current.x, point.x);
      draft.y = Math.min(shapeStartRef.current.y, point.y);
      draft.width = Math.abs(point.x - shapeStartRef.current.x);
      draft.height = Math.abs(point.y - shapeStartRef.current.y);
    }
    render(draft);
  };

  const onPointerUp = () => {
    panStartRef.current = null;
    const draft = draftRef.current;
    if (!draft) return;
    if (draft.kind === 'stroke') {
      if (draft.points.length) commit(draft);
      else {
        draftRef.current = null;
        render();
        notify();
      }
      return;
    }
    if (draft.width >= 4 || draft.height >= 4) commit(draft);
    else {
      draftRef.current = null;
      shapeStartRef.current = null;
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

  return (
    <div className="redraw-mask-stage">
      <div
        ref={transformRef}
        className="redraw-mask-transform"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}
      >
        <img
          className="redraw-mask-bg"
          src={url}
          alt={alt}
          onLoad={(e) => setup(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        />
        <canvas
          ref={overlayRef}
          className={`redraw-mask-overlay tool-${tool}`}
          aria-label="在图片上涂抹、框选或圈选要去除的区域"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
      <canvas ref={maskRef} className="redraw-mask-hidden" aria-hidden="true" />
    </div>
  );
}
