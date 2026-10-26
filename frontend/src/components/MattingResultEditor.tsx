import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { App, Spin } from 'antd';
import {
  Columns2,
  Download,
  Eraser,
  Hand,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
  Wrench,
} from 'lucide-react';

/**
 * 一键抠图结果编辑器 —— 对齐参考站 background-remove 的结果态。
 *
 * 抠图模型只负责产出透明主体；结果区的以下动作都在浏览器本地完成，不能
 * 伪装成一次新的 AI 调用：
 *   - 抓手平移、主体/画布双缩放、滚轮与 +/- 缩放
 *   - 原图/结果图分割对比
 *   - 擦除（destination-out）与修补（从原始抠图结果回填）
 *   - 撤回/恢复/重置（重放矢量笔迹，避免 4K ImageData 快照占内存）
 *   - 按当前比例与背景色合成并下载 PNG
 *
 * 编辑器只改像素，不改变服务端任务记录；刷新或重新生成会回到原始抠图结果。
 */

type EditorTool = 'hand' | 'eraser' | 'repair';
type ZoomTarget = 'subject' | 'canvas';

interface Point {
  x: number;
  y: number;
}

interface PaintAction {
  tool: Exclude<EditorTool, 'hand'>;
  points: Point[];
  /** 笔刷半径，单位是结果画布像素 */
  radius: number;
}

interface PaintGesture {
  pointerId: number;
  action: PaintAction;
}

interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  target: ZoomTarget;
}

const COLOR_HEX: Record<string, string> = {
  transparent: 'transparent',
  white: '#FFFFFF',
  'light-blue': '#82CEF3',
  blue: '#3988E9',
  red: '#FF0B22',
  'dark-red': '#A8001B',
};

const DEFAULT_CUSTOM_COLOR = '#5546D8';
const BRUSH_MIN = 10;
const BRUSH_MAX = 60;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(value: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : DEFAULT_CUSTOM_COLOR;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex);
  const value = Number.parseInt(normalized.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 100) / 100})`;
}

function backdropOf(selectedColor: string, customColor: string, customAlpha: number): string | null {
  if (selectedColor === 'transparent') return null;
  if (selectedColor === 'custom') {
    if (customAlpha <= 0) return null;
    return hexToRgba(customColor, customAlpha);
  }
  return COLOR_HEX[selectedColor] ?? normalizeHex(selectedColor);
}

function ratioValue(ratio: string, naturalRatio: number): number {
  if (!ratio || ratio === 'original') return naturalRatio;
  const [w, h] = ratio.split(':').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return naturalRatio;
  return w / h;
}

function loadImage(url: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('结果图片加载失败'));
    image.src = url;
  });
}

/**
 * 优先用 fetch 取回 Blob，再把 Blob URL 画进 canvas。
 *
 * 这样签名图床即使没有返回 ACAO，也还有一次「匿名 img」的退路；最终若仍
 * 被 canvas 安全策略污染，下载阶段会明确提示，而不是悄悄导出一张空白图。
 */
async function loadCanvasSource(url: string): Promise<{ image: HTMLImageElement; release: () => void }> {
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return { image: await loadImage(objectUrl), release: () => URL.revokeObjectURL(objectUrl) };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  } catch {
    try {
      const image = await loadImage(url, true);
      return { image, release: () => undefined };
    } catch {
      const image = await loadImage(url);
      return { image, release: () => undefined };
    }
  }
}

export function MattingResultEditor({
  resultUrl,
  originalUrl,
  selectedColor,
  customColor,
  customAlpha,
  outputRatio,
}: {
  resultUrl: string;
  originalUrl: string;
  selectedColor: string;
  customColor: string;
  customAlpha: number;
  outputRatio: string;
}) {
  const { message } = App.useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<PaintAction[]>([]);
  const redoRef = useRef<PaintAction[]>([]);
  const paintGestureRef = useRef<PaintGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<EditorTool>('hand');
  const [compare, setCompare] = useState(false);
  const [compareSplit, setCompareSplit] = useState(50);
  const [brushSize, setBrushSize] = useState(30);
  const [subjectZoom, setSubjectZoom] = useState(100);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget>('subject');
  const [subjectPan, setSubjectPan] = useState({ x: 0, y: 0 });
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [, setRevision] = useState(0);

  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const backdrop = useMemo(
    () => backdropOf(selectedColor, customColor, customAlpha),
    [selectedColor, customColor, customAlpha],
  );
  const previewRatio = useMemo(() => {
    const natural = naturalSize.width && naturalSize.height ? naturalSize.width / naturalSize.height : 1;
    return ratioValue(outputRatio, natural);
  }, [naturalSize, outputRatio]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !base || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);

    for (const action of actionsRef.current) {
      if (!action.points.length) continue;
      ctx.save();
      if (action.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = action.radius * 2;
        if (action.points.length === 1) {
          const point = action.points[0];
          ctx.beginPath();
          ctx.arc(point.x, point.y, action.radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(action.points[0].x, action.points[0].y);
          for (let i = 1; i < action.points.length; i += 1) {
            ctx.lineTo(action.points[i].x, action.points[i].y);
          }
          ctx.stroke();
        }
      } else {
        // 修补 = 用原始抠图结果回填笔刷覆盖的像素，恢复被误擦掉的主体边缘。
        ctx.beginPath();
        for (const point of action.points) {
          ctx.moveTo(point.x + action.radius, point.y);
          ctx.arc(point.x, point.y, action.radius, 0, Math.PI * 2);
        }
        ctx.clip();
        ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }
  }, []);

  // 载入结果图，并保留一份不可编辑的底座供「修补/重置」回填。
  useEffect(() => {
    let cancelled = false;
    let release: () => void = () => undefined;
    setLoading(true);
    setLoadError('');
    setCursor(null);
    setCompare(false);
    setCompareSplit(50);
    setTool('hand');
    setSubjectZoom(100);
    setCanvasZoom(100);
    setSubjectPan({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
    actionsRef.current = [];
    redoRef.current = [];
    paintGestureRef.current = null;
    panGestureRef.current = null;
    bump();

    void (async () => {
      try {
        const loaded = await loadCanvasSource(resultUrl);
        release = loaded.release;
        if (cancelled) return;
        const image = loaded.image;
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('结果图片尺寸无效');

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('结果画布尚未就绪');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d')?.drawImage(image, 0, 0);

        const base = document.createElement('canvas');
        base.width = image.naturalWidth;
        base.height = image.naturalHeight;
        base.getContext('2d')?.drawImage(image, 0, 0);
        baseCanvasRef.current = base;

        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '结果图片加载失败');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [bump, resultUrl]);

  // 比例变化时重置视图，避免旧平移量让新画幅跑出可视区 (参考站同行为)。
  useEffect(() => {
    setSubjectPan({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
    setSubjectZoom(100);
    setCanvasZoom(100);
    setCompareSplit(50);
  }, [outputRatio]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const frameSize = useMemo(() => {
    if (!stageSize.width || !stageSize.height || !naturalSize.width) return { width: 0, height: 0 };
    const maxWidth = Math.max(120, Math.min(680, stageSize.width - 80));
    const maxHeight = Math.max(120, Math.min(520, stageSize.height - 150));
    let width = Math.min(maxWidth, maxHeight * previewRatio);
    let height = width / Math.max(previewRatio, 0.01);
    if (height > maxHeight) {
      height = maxHeight;
      width = height * previewRatio;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }, [naturalSize.width, previewRatio, stageSize]);

  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp(((clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
      y: clamp(((clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height),
      cssX: clamp(clientX - rect.left, 0, rect.width),
      cssY: clamp(clientY - rect.top, 0, rect.height),
      scale: rect.width / canvas.width,
    };
  }, []);

  const appendPaintPoint = (action: PaintAction, point: Point) => {
    const previous = action.points[action.points.length - 1];
    if (!previous) {
      action.points.push(point);
      return;
    }
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const spacing = Math.max(1, action.radius * 0.35);
    const steps = Math.min(400, Math.max(1, Math.ceil(distance / spacing)));
    for (let i = 1; i <= steps; i += 1) {
      action.points.push({
        x: previous.x + ((point.x - previous.x) * i) / steps,
        y: previous.y + ((point.y - previous.y) * i) / steps,
      });
    }
  };

  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, output')) return;
    if (tool !== 'hand' && !compare) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const target: ZoomTarget = zoomTarget === 'subject' && !compare ? 'subject' : 'canvas';
    const origin = target === 'subject' ? subjectPan : canvasPan;
    panGestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: origin.x,
      originY: origin.y,
      target,
    };
  };

  const movePan = (e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const next = {
      x: gesture.originX + e.clientX - gesture.startX,
      y: gesture.originY + e.clientY - gesture.startY,
    };
    if (gesture.target === 'subject') setSubjectPan(next);
    else setCanvasPan(next);
  };

  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panGestureRef.current?.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    panGestureRef.current = null;
  };

  const updateCursor = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'hand' || compare) {
      setCursor(null);
      return;
    }
    const point = pointFromClient(e.clientX, e.clientY);
    setCursor(point ? { x: point.cssX, y: point.cssY } : null);
  };

  const startPaint = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tool === 'hand' || compare) return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const action: PaintAction = {
      tool,
      points: [{ x: point.x, y: point.y }],
      radius: Math.max(1, brushSize / 2 / Math.max(point.scale, 0.0001)),
    };
    actionsRef.current = [...actionsRef.current, action];
    redoRef.current = [];
    paintGestureRef.current = { pointerId: e.pointerId, action };
    setCursor({ x: point.cssX, y: point.cssY });
    redraw();
    bump();
  };

  const movePaint = (e: ReactPointerEvent<HTMLDivElement>) => {
    updateCursor(e);
    const gesture = paintGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    appendPaintPoint(gesture.action, { x: point.x, y: point.y });
    redraw();
    bump();
  };

  const endPaint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = paintGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    paintGestureRef.current = null;
  };

  const undo = useCallback(() => {
    const action = actionsRef.current[actionsRef.current.length - 1];
    if (!action) return;
    actionsRef.current = actionsRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, action];
    redraw();
    bump();
  }, [bump, redraw]);

  const redo = useCallback(() => {
    const action = redoRef.current[redoRef.current.length - 1];
    if (!action) return;
    redoRef.current = redoRef.current.slice(0, -1);
    actionsRef.current = [...actionsRef.current, action];
    redraw();
    bump();
  }, [bump, redraw]);

  const reset = useCallback(() => {
    actionsRef.current = [];
    redoRef.current = [];
    paintGestureRef.current = null;
    panGestureRef.current = null;
    setSubjectPan({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
    setSubjectZoom(100);
    setCanvasZoom(100);
    redraw();
    bump();
  }, [bump, redraw]);

  const changeZoom = useCallback(
    (delta: number) => {
      if (zoomTarget === 'canvas') {
        setCanvasZoom((value) => clamp(value + delta, ZOOM_MIN, ZOOM_MAX));
      } else {
        setSubjectZoom((value) => clamp(value + delta, ZOOM_MIN, ZOOM_MAX));
      }
    },
    [zoomTarget],
  );

  // 滚轮必须用非 passive 的原生监听，React 的 onWheel 在部分浏览器不能 preventDefault。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      changeZoom(event.deltaY < 0 ? 10 : -10);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [changeZoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'h') setTool('hand');
      if (key === 'e') {
        setTool('eraser');
        setCompare(false);
      }
      if (key === 'r') {
        setTool('repair');
        setCompare(false);
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        changeZoom(10);
      }
      if (key === '-') {
        event.preventDefault();
        changeZoom(-10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeZoom, redo, undo]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas || downloading) return;
    setDownloading(true);
    try {
      redraw();
      const natural = canvas.width / canvas.height;
      const aspect = ratioValue(outputRatio, natural);
      const out = document.createElement('canvas');
      const maxSide = Math.max(canvas.width, canvas.height);
      out.width = aspect >= 1 ? maxSide : Math.max(1, Math.round(maxSide * aspect));
      out.height = aspect >= 1 ? Math.max(1, Math.round(maxSide / aspect)) : maxSide;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('无法创建导出画布');
      if (backdrop) {
        ctx.fillStyle = backdrop;
        ctx.fillRect(0, 0, out.width, out.height);
      }
      const scale = Math.min(out.width / canvas.width, out.height / canvas.height) * (subjectZoom / 100);
      const drawWidth = canvas.width * scale;
      const drawHeight = canvas.height * scale;
      /*
       * 主体平移是结果的一部分，而画布平移只是视口。导出时只映射
       * subjectPan，并保持导出画布尺寸与当前舞台一致，否则用户调整过
       * 主体位置后下载到的图会与所见不一致。
       */
      const offsetX = subjectPan.x * (out.width / Math.max(stageSize.width, 1));
      const offsetY = subjectPan.y * (out.height / Math.max(stageSize.height, 1));
      ctx.drawImage(
        canvas,
        (out.width - drawWidth) / 2 + offsetX,
        (out.height - drawHeight) / 2 + offsetY,
        drawWidth,
        drawHeight,
      );
      out.toBlob((blob) => {
        if (!blob) {
          setDownloading(false);
          message.error('图片导出失败，请稍后重试');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `一键抠图-${Date.now()}.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        setDownloading(false);
      }, 'image/png');
    } catch {
      setDownloading(false);
      message.error('结果图跨域受限，无法导出编辑后的图片；请直接下载原始抠图结果');
    }
  };

  const selectTool = (next: EditorTool) => {
    setTool(next);
    if (next === 'hand') setCompare(false);
  };

  const canUndo = actionsRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const activeZoom = zoomTarget === 'canvas' ? canvasZoom : subjectZoom;
  const previewBackground = backdrop ?? undefined;
  const rangeProgress = `${((brushSize - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN)) * 100}%`;

  return (
    <div className="matting-result-editor" aria-label="一键抠图结果编辑">
      {!loading && !loadError && (
        <div className="background-result-toolbar" role="toolbar" aria-label="一键抠图结果工具">
          <button
            type="button"
            className={tool === 'hand' && !compare ? 'active' : ''}
            aria-pressed={tool === 'hand' && !compare}
            onClick={() => selectTool('hand')}
          >
            <Hand size={16} />
            抓手
          </button>
          <button
            type="button"
            className={compare ? 'active' : ''}
            aria-pressed={compare}
            onClick={() => setCompare((value) => !value)}
          >
            <Columns2 size={16} />
            对比
          </button>
          <b />
          <button
            type="button"
            className={tool === 'eraser' && !compare ? 'active' : ''}
            aria-pressed={tool === 'eraser' && !compare}
            onClick={() => selectTool('eraser')}
          >
            <Eraser size={16} />
            擦除
          </button>
          <button
            type="button"
            className={tool === 'repair' && !compare ? 'active' : ''}
            aria-pressed={tool === 'repair' && !compare}
            onClick={() => selectTool('repair')}
          >
            <Wrench size={16} />
            修补
          </button>
          <input
            aria-label="工具大小"
            type="range"
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            value={brushSize}
            style={{ ['--range-progress' as string]: rangeProgress }}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
          <output>{brushSize}</output>
          <b />
          <button
            type="button"
            className="background-result-download-icon"
            aria-label="下载图片"
            title="下载图片"
            disabled={downloading}
            onClick={download}
          >
            <Download size={16} />
          </button>
        </div>
      )}

      <div ref={stageRef} className="background-remove-stage has-result" aria-busy={loading}>
        {/* 画布必须常驻：加载 effect 的首轮就要拿 canvasRef 写入像素，不能用加载态把它卸载。 */}
        <div
          className={`background-remove-preview result-tool-${compare ? 'hand' : tool}${compare ? ' is-comparing' : ''}${loading || loadError ? ' is-state-hidden' : ''}`}
          style={{
            backgroundColor: previewBackground,
            transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom / 100})`,
          }}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
            <div
              className="background-result-content"
              style={{ transform: `translate(${subjectPan.x}px, ${subjectPan.y}px) scale(${subjectZoom / 100})` }}
            >
              <div
                ref={frameRef}
                className="background-result-image-frame"
                style={{
                  width: frameSize.width || undefined,
                  height: frameSize.height || undefined,
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
                onPointerDown={startPaint}
                onPointerMove={movePaint}
                onPointerUp={endPaint}
                onPointerCancel={endPaint}
                onPointerLeave={() => setCursor(null)}
              >
                <canvas
                  ref={canvasRef}
                  className="background-result-canvas"
                  aria-label="一键抠图结果"
                />

                {compare && (
                  <>
                    <div
                      className="background-original-compare"
                      style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}
                    >
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
                      onChange={(e) => setCompareSplit(Number(e.target.value))}
                    />
                  </>
                )}

                {!compare && cursor && tool !== 'hand' && (
                  <i
                    className={`background-result-cursor ${tool}`}
                    style={{
                      left: cursor.x,
                      top: cursor.y,
                      width: brushSize,
                      height: brushSize,
                    }}
                  />
                )}
              </div>
            </div>
        </div>

        {loading && (
          <div className="matting-editor-loading" role="status">
            <Spin />
            <span>正在载入抠图结果…</span>
          </div>
        )}
        {!loading && loadError && (
          <div className="matting-editor-loading" role="alert">
            <strong>结果载入失败</strong>
            <span>{loadError}</span>
            <a href={resultUrl} download target="_blank" rel="noreferrer">
              直接下载原始结果
            </a>
          </div>
        )}

        {!loading && !loadError && (
          <div className="background-result-footer">
            <button type="button" onClick={undo} disabled={!canUndo} title="撤回 (Ctrl+Z)">
              <Undo2 size={16} />
              撤回
            </button>
            <button type="button" onClick={redo} disabled={!canRedo} title="恢复 (Ctrl+Shift+Z)">
              <Redo2 size={16} />
              恢复
            </button>
            <button type="button" onClick={reset} title="重置视图与编辑">
              <RotateCcw size={16} />
              重置
            </button>
            <b />
            <div className="background-zoom-target" role="group" aria-label="缩放对象">
              <button
                type="button"
                className={zoomTarget === 'subject' ? 'active' : ''}
                aria-pressed={zoomTarget === 'subject'}
                onClick={() => setZoomTarget('subject')}
              >
                主体
              </button>
              <button
                type="button"
                className={zoomTarget === 'canvas' ? 'active' : ''}
                aria-pressed={zoomTarget === 'canvas'}
                onClick={() => setZoomTarget('canvas')}
              >
                画布
              </button>
            </div>
            <button type="button" aria-label="缩小" title="缩小 (-)" onClick={() => changeZoom(-10)}>
              <Minus size={16} />
            </button>
            <span>{activeZoom}%</span>
            <button type="button" aria-label="放大" title="放大 (+)" onClick={() => changeZoom(10)}>
              <Plus size={16} />
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <div className="background-result-shortcuts">
            快捷键：H 抓手 · E 擦除 · R 修补 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
          </div>
        )}
      </div>
    </div>
  );
}
