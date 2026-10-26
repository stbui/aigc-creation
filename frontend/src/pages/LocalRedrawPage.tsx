import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Drawer } from 'antd';
import { ChevronRight, ChevronUp, Circle, Columns2, Eraser, Hand, History, Minus, Paintbrush, Plus, Redo2, Square, Trash2, Undo2, X } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { useProject } from '../hooks/useProject';
import { useAuth } from '../context/AuthContext';
import { assetsApi, assetSrc, generateApi } from '../lib/api';
import { ToolShell, type ToolAsset } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import { ToolHistoryGrid } from '../components/ToolHistoryPane';
import { LocalRedrawIllustration } from '../components/illustrations';

/**
 * 局部重绘 —— 1:1 复刻参考站 https://ijihua.cn/local-redraw。
 *
 * ## 画布交互 (2026-10-25 重构)
 *
 * 工具: 抓手 (平移) / 画笔 (涂抹重绘区) / 橡皮 (擦除涂抹) / 框选 / 圈选。
 * 额外能力: 缩放 (按钮 ±) / 撤回 / 恢复 / 清空。
 *
 * 笔迹用**矢量标记**保存 (不是落成不可逆的位图)：
 *   - brush/eraser → 一串采样点
 *   - rect/ellipse → 归一化矩形
 * 渲染时重放整份标记列表 → 生成可见叠层与黑白遮罩。因此撤回/恢复/清空
 * 只是增删数组元素并重放，不需要保存 4K ImageData 快照。
 *
 * ## 遮罩怎么走 (仍沿用 2026-10-22 的协议)
 *
 * 所有标记合成一张 PNG：透明区 = 要重绘的区域 (OpenAI `images/edits` 约定)，
 * 上传成素材后随 `maskAssetId` 提交。后端对不支持遮罩的通道判 `42205` 退款。
 *
 * 诚实披露: local_redraw 必须由真实 inpainting 模型完成, 本地没有实现；
 * 没有可用通道时后端判 failed/42204 并退款，本页据 runtime 提前禁用提交。
 */

type PaintTool = 'hand' | 'brush' | 'eraser' | 'rect' | 'ellipse';

/** 页面只有 3 条描述位，遮罩也必须与之一致，不能多圈区域却没有描述。 */
const MAX_ANNOTATIONS = 3;

const TOOLS: { value: PaintTool; label: string; shortcut: string; icon: typeof Hand }[] = [
  { value: 'hand', label: '抓手', shortcut: 'H', icon: Hand },
  { value: 'eraser', label: '擦除', shortcut: 'E', icon: Eraser },
  { value: 'rect', label: '框选', shortcut: 'R', icon: Square },
  { value: 'ellipse', label: '圈选', shortcut: 'O', icon: Circle },
  { value: 'brush', label: '涂抹', shortcut: 'B', icon: Paintbrush },
];

type StrokeTool = 'brush' | 'eraser';
type ShapeTool = 'rect' | 'ellipse';

/** 矢量标记：一笔涂抹 / 一个框选区域。坐标均为原图像素坐标。 */
interface StrokeMark {
  kind: 'stroke';
  id: number;
  tool: StrokeTool;
  points: { x: number; y: number }[];
  /** 笔刷宽度（原图像素） */
  width: number;
}
interface ShapeMark {
  kind: 'shape';
  id: number;
  tool: ShapeTool;
  x: number;
  y: number;
  width: number;
  height: number;
}
type Mark = StrokeMark | ShapeMark;
type ResizeHandle = 'n' | 'e' | 's' | 'w';

/** 一个可描述区域在原图上的包围盒（像素坐标） */
interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** 只有画笔涂抹和框选/圈选算可描述区域，橡皮只是修正遮罩 */
function isRegionMark(mark: Mark): boolean {
  return mark.kind === 'shape' || (mark.kind === 'stroke' && mark.tool === 'brush');
}

/** 画布对外的动作 */
interface MaskPainterHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  getRegionCount: () => number;
  getRegionBounds: () => RegionBounds[];
  removeRegion: (index: number) => void;
}

/** 数值夹取：拖动和缩放时把标记限制在原图范围内。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneMark(mark: Mark): Mark {
  return mark.kind === 'stroke'
    ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
    : { ...mark };
}

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
function MaskPainter({
  url,
  tool,
  brush,
  zoom,
  pan,
  maxRegions,
  onPanChange,
  onRegionLimit,
  onChange,
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
   * 把原图等比装进参考站的方形画布舞台。
   *
   * 舞台固定 1:1，但图片本身可能是任意宽高比；直接让 img 撑满会裁切，
   * 只设 max-height 又会让竖图溢出。这里按舞台实际可用宽高等比收缩，
   * 并把 img / overlay 的共同父级设为该尺寸 —— 涂抹坐标仍以图片为基准。
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
    [fitToStage, notify, render],
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
      if (drag.handle === 'w') left = clamp(left + dx, 0, right - 4);
      if (drag.handle === 'e') right = clamp(right + dx, left + 4, w);
      if (drag.handle === 'n') top = clamp(top + dy, 0, bottom - 4);
      if (drag.handle === 's') bottom = clamp(bottom + dy, top + 4, h);
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
                    ? (['n', 'e', 's', 'w'] as ResizeHandle[]).map((handle) => (
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

export function LocalRedrawPage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'local_redraw', successMessage: '重绘结果已生成' });

  const [tool, setTool] = useState<PaintTool>('rect');
  const [brush, setBrush] = useState(30);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [painted, setPainted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [regionCount, setRegionCount] = useState(0);
  /** 最多 3 条标注描述，与参考站一致 */
  const [prompts, setPrompts] = useState<string[]>(['', '', '']);
  /** 遮罩上传期间也要禁用按钮 —— 否则连点会传两份遮罩 */
  const [preparing, setPreparing] = useState(false);
  /** 每条标注可选上传的参考图 */
  const [references, setReferences] = useState<Array<ToolAsset | null>>([null, null, null]);
  /**
   * 正在上传参考图的下标集合。
   *
   * 用集合而不是单个下标: 用户可能连着触发两条标注的上传，若只存一个值，
   * 先完成的请求会把状态提前清空，后一条还在上传时按钮又变成可提交。
   */
  const [referenceUploading, setReferenceUploading] = useState<Set<number>>(() => new Set());
  const uploadBusy = referenceUploading.size > 0;
  /** 历史抽屉 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof generateApi.list>>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  /** 桌面右栏折叠; 窄屏本来就不显示右栏, 改用浮动按钮打开抽屉 */
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [sourceImage, setSourceImage] = useState<ToolAsset | null>(null);
  const painter = useRef<MaskPainterHandle | null>(null);
  /*
   * 提交后结果态会卸载标注画布，painter 也随之清空。「重新生成」必须复用
   * 上一次的遮罩快照，否则会误报「请先标注」；同一张源图且遮罩未改时也
   * 复用已上传的素材，避免每次重试都新传一份 PNG。
   */
  const maskBlobRef = useRef<Blob | null>(null);
  const maskAssetIdRef = useRef<string | null>(null);
  const maskSourceIdRef = useRef<string | null>(null);
  const lastSourceIdRef = useRef<string | null>(null);
  const { token } = useAuth();

  const setPromptAt = (index: number, value: string) =>
    setPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));

  const uploadReference = async (index: number, file: File | undefined) => {
    if (!file) return;
    try {
      setReferenceUploading((prev) => new Set(prev).add(index));
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setReferences((prev) => prev.map((item, i) => (i === index ? { id: asset.id, url: assetSrc(asset) ?? '', name: file.name } : item)));
    } catch (e) {
      message.error((e as Error).message || '参考图上传失败，请重试');
    } finally {
      setReferenceUploading((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  // 历史记录以任务为准；生成完成后刷新一次，首次挂载若有登录态也拉一次。
  useEffect(() => {
    if (!token) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void generateApi
      .list()
      .then((items) => {
        if (cancelled) return;
        setHistory(
          items
            .filter((task) => task.capability === 'local_redraw' && task.status === 'succeeded' && task.outputAsset)
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .slice(0, 20),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setHistory([]);
          setHistoryError((e as Error).message || '历史记录加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, result, historyReload]);

  /** 清掉当前图的遮罩、笔迹状态与结果；源图本身由上传位管理。 */
  const clearMaskSession = useCallback(() => {
    maskBlobRef.current = null;
    maskAssetIdRef.current = null;
    maskSourceIdRef.current = null;
    setPainted(false);
    setCanUndo(false);
    setCanRedo(false);
    setRegionCount(0);
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setResult(null);
  }, [setResult]);

  /** 上传位发生变化时同步源图，并清掉上一张图残留的遮罩与描述。 */
  const handleImagesChange = useCallback(
    (images: ToolAsset[]) => {
      const next = images[0] ?? null;
      const nextId = next?.id ?? null;
      setSourceImage(next);
      if (lastSourceIdRef.current === nextId) return;
      lastSourceIdRef.current = nextId;
      clearMaskSession();
      setPrompts(['', '', '']);
      setReferences([null, null, null]);
      setReferenceUploading(() => new Set());
    },
    [clearMaskSession],
  );

  /**
   * 结果态会卸载标注画布，因此失败后也必须给用户一个回到画布的入口；
   * 只保留「重新生成」会让一次失败变成无法调整标注的死路。
   */
  const handleReannotation = () => {
    clearMaskSession();
  };

  /**
   * 历史结果回填后清掉上一轮结果态、遮罩缓存与旧标注。
   *
   * ToolShell 会先把历史产出复制成当前项目的新素材；MaskPainter 因 URL
   * 变化自动重置笔迹。这里把页面级引用和描述一起清掉，避免把上一张图的
   * 区域描述与参考图带到新素材上。
   */
  const handleHistoryReuse = () => {
    clearMaskSession();
    setPrompts(['', '', '']);
    setReferences([null, null, null]);
    setSourceImage(null);
    setHistoryOpen(false);
  };

  const historyPane = (
    <>
      <aside className="redraw-history-pane" aria-label="局部重绘历史记录">
        <div className="redraw-history-head">
          <h2>历史记录</h2>
          <button
            type="button"
            className="redraw-history-collapse"
            aria-label={historyCollapsed ? '展开历史记录' : '收起历史记录'}
            aria-expanded={!historyCollapsed}
            title={historyCollapsed ? '展开历史记录' : '收起历史记录'}
            onClick={() => setHistoryCollapsed((value) => !value)}
          >
            {historyCollapsed ? <ChevronRight size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        <div className="redraw-history-scroll">
          <ToolHistoryGrid
            tasks={history}
            loading={historyLoading}
            error={historyError}
            emptyText="暂无局部重绘记录"
            onRetry={() => setHistoryReload((value) => value + 1)}
          />
        </div>
      </aside>

      <button
        type="button"
        className="redraw-history-float-toggle"
        aria-label="历史记录"
        title="历史记录"
        onClick={() => {
          // 桌面端右栏收起后，浮动按钮把右栏展开；窄屏没有右栏，改用抽屉。
          if (window.matchMedia('(max-width: 1180px)').matches) setHistoryOpen(true);
          else setHistoryCollapsed(false);
        }}
      >
        <History size={16} />
      </button>

      <Drawer
        title="历史记录"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size={320}
        styles={{ body: { padding: 12 } }}
      >
        <ToolHistoryGrid
          tasks={history}
          loading={historyLoading}
          error={historyError}
          emptyText="暂无局部重绘记录"
          onRetry={() => setHistoryReload((value) => value + 1)}
        />
      </Drawer>
    </>
  );

  const handlePaintState = useCallback(
    (isPainted: boolean, undoable: boolean, redoable: boolean, regions: number) => {
      setPainted(isPainted);
      setCanUndo(undoable);
      setCanRedo(redoable);
      setRegionCount(regions);
    },
    [],
  );

  const removeAnnotationAt = (index: number) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再删除标注');
      return;
    }
    painter.current?.removeRegion(index);
    setPrompts((prev) => [...prev.filter((_, i) => i !== index), '']);
    setReferences((prev) => [...prev.filter((_, i) => i !== index), null]);
  };

  // 快捷键：H/B/E/R/O 切工具，Ctrl+Z 撤回，Ctrl+Shift+Z 恢复，+/- 缩放
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) painter.current?.redo();
        else painter.current?.undo();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(140, z + 10));
        return;
      }
      if (e.key === '-') {
        setZoom((z) => Math.max(70, z - 10));
        return;
      }
      const toolKey = TOOLS.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase());
      if (toolKey) setTool(toolKey.value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (inputs: ToolAsset[], settings: { ratio: string; resolution: string }) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再提交');
      return;
    }
    setSourceImage(inputs[0] ?? null);
    const sourceId = inputs[0]?.id ?? null;
    if (maskSourceIdRef.current !== sourceId) {
      maskBlobRef.current = null;
      maskAssetIdRef.current = null;
      maskSourceIdRef.current = sourceId;
    }
    let maskAssetId: string | undefined;
    try {
      setPreparing(true);
      const freshBlob = await painter.current?.toBlob();
      const blob = freshBlob ?? maskBlobRef.current;
      if (!blob) {
        message.warning('请先在图片上标注需要重绘的区域');
        return;
      }
      if (freshBlob) {
        maskBlobRef.current = freshBlob;
        maskAssetIdRef.current = null;
      }
      if (!maskAssetIdRef.current) {
        const projectId = await ensureProject();
        const file = new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' });
        const asset = await assetsApi.upload(file, projectId);
        maskAssetIdRef.current = asset.id;
      }
      maskAssetId = maskAssetIdRef.current;
    } catch (e) {
      message.error((e as Error).message || '遮罩上传失败，请重试');
      return;
    } finally {
      setPreparing(false);
    }

    const annotationCount = Math.max(1, Math.min(MAX_ANNOTATIONS, regionCount));
    const annotations = prompts
      .slice(0, annotationCount)
      .map((p, i) => ({
        annotationId: String(i + 1),
        label: `标注${i + 1}`,
        instruction: p.trim(),
        referenceAssetId: references[i]?.id ?? null,
      }))
      .filter((item) => item.instruction);
    const parts = annotations.map((item) => `${item.label}：${item.instruction}`);
    await run(inputs, {
      prompt: parts.join('；'),
      annotations: JSON.stringify(annotations),
      modelGuideAssetId: maskAssetId,
      strength: Math.min(1, Math.max(0, brush / 60)),
      ratio: settings.ratio,
      size: settings.resolution,
      ...(settings.ratio !== 'original' ? { imageRatio: settings.ratio } : {}),
      ...(maskAssetId ? { maskAssetId } : {}),
      outputCount: 1,
    });
  };

  const currentResult = Array.isArray(result) ? result[0] : result;
  const resultUrl = currentResult?.status === 'succeeded' ? currentResult.url : undefined;
  /** 与参考站一致: 未标注时只给一条描述位; 标注后按区域数展开, 最多 3 条 */
  const visiblePromptCount = Math.max(1, Math.min(MAX_ANNOTATIONS, regionCount));
  const filledCount = prompts.slice(0, visiblePromptCount).filter((p) => p.trim()).length;

  return (
    <>
    <ToolShell
      capability="local_redraw"
      pageClass={`local-redraw-page${historyCollapsed ? ' history-collapsed' : ''}`}
      title="局部重绘"
      desc="只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      replaceUpload
      onImagesChange={handleImagesChange}
      renderUploadPreview={(uploaded, controls) => {
        const image = uploaded[0];
        if (!image) return null;
        return (
          <div className={`source-row${controls.uploading ? ' processing' : ''}`}>
            <button
              type="button"
              className="local-source-preview"
              aria-label="预览待重绘原图"
              onClick={() => controls.preview(image)}
            >
              <img src={image.url} alt="待重绘原图" draggable={false} />
            </button>
            <div>
              <button
                type="button"
                disabled={controls.uploading}
                onClick={() => controls.remove(image.id)}
              >
                重新编辑
              </button>
              <button
                type="button"
                className="soft"
                disabled={controls.uploading}
                onClick={controls.open}
              >
                重新上传
              </button>
            </div>
          </div>
        );
      }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="开始重绘"
      emptyDesc="上传图片并标注区域、写下描述后，重绘结果将在此处展示"
      formValid={painted && filledCount > 0 && !uploadBusy && !preparing}
      /*
       * uploadBusy 只通过 formValid 禁用提交，不能并入 submitting：ToolShell 在
       * submitting 时会用生成态替换 sourcePane，画布会被卸载，参考图上传完成
       * 后重建并清空刚画好的遮罩。遮罩上传也只通过 formValid 阻止重复提交，
       * 不切换生成态 —— 上传失败时用户仍保留画布上的笔迹，可直接重试。
       */
      submitting={submitting}
      result={result}
      resultTag={painted ? '已标注区域' : undefined}
      resultCompare={resultUrl && sourceImage ? { beforeUrl: sourceImage.url, beforeLabel: '原图', afterLabel: '重绘后' } : undefined}
      onHistoryReuse={handleHistoryReuse}
      onSubmit={(inputs, settings) => submit(inputs, settings)}
      resultActions={
        result ? (
          <button type="button" className="tool-result-action" onClick={handleReannotation}>
            重新标注
          </button>
        ) : null
      }
      trailingPane={historyPane}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) {
          return (
            <div className="redraw-intro">
              <div className="redraw-intro-art" aria-hidden="true">
                <LocalRedrawIllustration />
              </div>
              <div className="redraw-intro-copy">
                <strong>局部重绘</strong>
                <p>只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素</p>
              </div>
            </div>
          );
        }
        const renderToolButton = (value: PaintTool) => {
          const item = TOOLS.find((t) => t.value === value);
          if (!item) return null;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              className={`redraw-tool-btn${tool === item.value ? ' active' : ''}`}
              aria-pressed={tool === item.value}
              title={`${item.label} (${item.shortcut})`}
              onClick={() => setTool(item.value)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        };
        return (
          <div className="pk-source-pane redraw-stage">
            <div className="redraw-stage-topbar">
              <div className="redraw-toolbar" role="toolbar" aria-label="重绘工具">
                {renderToolButton('hand')}
                {renderToolButton('eraser')}
                <button
                  type="button"
                  className="redraw-tool-btn"
                  title="对比"
                  disabled
                >
                  <Columns2 size={16} />
                  对比
                </button>
                {renderToolButton('rect')}
                {renderToolButton('ellipse')}
                {renderToolButton('brush')}
                <label className="redraw-toolbar-brush">
                  <span className="sr-only">画笔大小</span>
                  <input
                    aria-label="画笔大小"
                    type="range"
                    min={10}
                    max={60}
                    step={2}
                    value={brush}
                    style={{ '--range-progress': `${((brush - 10) / 50) * 100}%` } as React.CSSProperties}
                    onChange={(e) => setBrush(Number(e.target.value))}
                  />
                  <output>{brush}</output>
                </label>
              </div>
            </div>
            <div className="redraw-stage-main">
              <div className="redraw-canvas-wrap">
                <MaskPainter
                  url={image.url}
                  tool={tool}
                  brush={brush}
                  zoom={zoom}
                  pan={pan}
                  maxRegions={MAX_ANNOTATIONS}
                  onPanChange={setPan}
                  onRegionLimit={() => message.warning(`最多支持 ${MAX_ANNOTATIONS} 个标注区域，请先撤回或删除一个`) }
                  onChange={handlePaintState}
                  handleRef={painter}
                />
              </div>
              <p className="redraw-mask-hint">
                {painted
                  ? '标注区域将按描述重绘，其余像素保持不变。'
                  : '还没标注。涂抹、框选或圈选要修改的区域后再提交。'}
              </p>
            </div>
            <div className="redraw-canvas-footer">
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canUndo || uploadBusy}
                title="撤回 (Ctrl+Z)"
                onClick={() => painter.current?.undo()}
              >
                <Undo2 size={16} />
                撤回
              </button>
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canRedo || uploadBusy}
                title="恢复 (Ctrl+Shift+Z)"
                onClick={() => painter.current?.redo()}
              >
                <Redo2 size={16} />
                恢复
              </button>
              <button type="button" className="redraw-footer-btn" disabled={uploadBusy} onClick={() => painter.current?.clear()}>
                <Trash2 size={16} />
                清空
              </button>
              <span className="redraw-tool-divider" />
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="缩小" title="缩小 (-)" onClick={() => setZoom((z) => Math.max(70, z - 10))}>
                <Minus size={16} />
              </button>
              <span className="redraw-zoom-value">{zoom}%</span>
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="放大" title="放大 (+)" onClick={() => setZoom((z) => Math.min(140, z + 10))}>
                <Plus size={16} />
              </button>
            </div>
            <p className="redraw-shortcut-hint">
              快捷键：H 抓手 · B 涂抹 · E 擦除 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
            </p>
          </div>
        );
      }}
    >
      {(images) => {
        if (images.length === 0) return null;
        return (
          <>
            <ToolCard
              title={<><i className="pk-required-mark">*</i>重绘描述</>}
              actions={<span>{filledCount}/{MAX_ANNOTATIONS}</span>}
              className="prompt-card"
            >
              {prompts.slice(0, visiblePromptCount).map((prompt, index) => (
                <div key={index} className={`redraw-prompt${index < regionCount ? '' : ' is-pending'}`}>
                  {index < regionCount && (
                    <button
                      type="button"
                      className="remove-annotation"
                      aria-label={`删除标注${index + 1}`}
                      title={`删除标注${index + 1}`}
                      disabled={uploadBusy}
                      onClick={() => removeAnnotationAt(index)}
                    >
                      <X size={13} />
                    </button>
                  )}
                  <label className={`redraw-prompt-label${index < regionCount ? ' is-marked' : ' is-pending'}`}>
                    <i />
                    标注{index + 1}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={prompt}
                    placeholder="请输入您要重绘的内容，例如：更换颜色..."
                    onChange={(e) => setPromptAt(index, e.target.value)}
                  />
                  <label
                    className={`redraw-prompt-tools reference-upload${references[index] ? ' has-image' : ''}`}
                    title={references[index] ? `替换标注${index + 1}参考图` : `上传标注${index + 1}参考图`}
                  >
                    {references[index] && (
                      <>
                        <img src={references[index]!.url} alt={`标注${index + 1}参考图`} />
                        <button
                          type="button"
                          className="remove-reference"
                          aria-label={`移除标注${index + 1}参考图`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setReferences((prev) => prev.map((item, i) => (i === index ? null : item)));
                          }}
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                    {referenceUploading.has(index) && !references[index] ? (
                      <span>上传中…</span>
                    ) : !references[index] ? (
                      <>
                        <Plus size={16} />
                        <span>上传图片</span>
                      </>
                    ) : null}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      disabled={referenceUploading.has(index)}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        void uploadReference(index, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              ))}
            </ToolCard>
          </>
        );
      }}
    </ToolShell>

    </>
  );
}
