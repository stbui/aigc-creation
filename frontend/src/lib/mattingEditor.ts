import { COLOR_HEX, DEFAULT_CUSTOM_COLOR, normalizeHexColor } from './colorPalette';

/**
 * 一键抠图结果编辑器的数据模型、像素操作与图片载入。
 *
 * 2026-11-15 从 `MattingResultEditor` 抽出（810 行的组件里，前 110 行是纯逻辑、
 * 中间是手势状态、后 210 行是 JSX）。这里只留不依赖 React 的部分：
 * 笔迹模型、画笔/修补的合成算法、背景色换算、带 CORS 退路的图片载入。
 *
 * 「修补」不是重新生成：用原始抠图结果回填笔刷覆盖的像素，恢复被误擦掉的主体边缘。
 * 编辑器只改像素，不写服务端任务记录。
 */

export type EditorTool = 'hand' | 'eraser' | 'repair';
export type ZoomTarget = 'subject' | 'canvas';

export interface Point {
  x: number;
  y: number;
}

export interface PaintAction {
  tool: Exclude<EditorTool, 'hand'>;
  points: Point[];
  /** 笔刷半径，单位是结果画布像素 */
  radius: number;
}

export interface PaintGesture {
  pointerId: number;
  action: PaintAction;
}

export interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  target: ZoomTarget;
}

export const BRUSH_MIN = 10;
export const BRUSH_MAX = 60;
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(value: string): string {
  return normalizeHexColor(value) ?? DEFAULT_CUSTOM_COLOR;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex);
  const value = Number.parseInt(normalized.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 100) / 100})`;
}

/** 结果底衬色；`null` 表示透明（棋盘格由 CSS 提供）。 */
export function backdropOf(selectedColor: string, customColor: string, customAlpha: number): string | null {
  if (selectedColor === 'transparent') return null;
  if (selectedColor === 'custom') {
    if (customAlpha <= 0) return null;
    return hexToRgba(customColor, customAlpha);
  }
  return COLOR_HEX[selectedColor] ?? normalizeHex(selectedColor);
}

export function ratioValue(ratio: string, naturalRatio: number): number {
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
export async function loadCanvasSource(url: string): Promise<{ image: HTMLImageElement; release: () => void }> {
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

/**
 * 在笔迹里补点。
 *
 * 指针事件的采样间隔随手速变化，直接连点会得到折线；按笔刷半径的 35% 作为
 * 步距插值，笔画才连续。单步上限 400，避免快速划动时一次 push 上万点。
 */
export function appendPaintPoint(action: PaintAction, point: Point): void {
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
}

/**
 * 把底座与全部笔迹合成到结果画布。
 *
 * 每次都从底座重绘而不是增量叠加：撤销要能精确回退，增量绘制无法恢复被擦掉的
 * 中间态。笔迹数量在人工编辑量级（几十条），整幅重绘的开销可以忽略。
 */
export function paintCanvas(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  actions: readonly PaintAction[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);

  for (const action of actions) {
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
}

interface ExportOptions {
  /** 输出比例（`original` 或 `w:h`） */
  outputRatio: string;
  /** 底色；`null` 表示保持透明 */
  backdrop: string | null;
  /** 主体缩放（百分比） */
  subjectZoom: number;
  /** 主体平移（屏幕像素） */
  subjectPan: Point;
  /** 当前舞台尺寸，用于把屏幕位移换算成导出画布位移 */
  stageSize: { width: number; height: number };
}

/**
 * 按当前编辑状态渲染导出画布。
 *
 * 输出边长取结果画布的长边，比例按用户选择裁切；主体平移是结果的一部分，
 * 而画布平移只是视口，因此只映射 `subjectPan`，并保持导出画布与当前舞台同比例，
 * 否则用户调整过主体位置后下载到的图会与所见不一致。
 *
 * 只负责渲染；编码与触发下载留在调用方（要处理 toBlob 失败与跨域提示）。
 */
export function renderMattingExport(canvas: HTMLCanvasElement, options: ExportOptions): HTMLCanvasElement {
  const { outputRatio, backdrop, subjectZoom, subjectPan, stageSize } = options;
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
  const offsetX = subjectPan.x * (out.width / Math.max(stageSize.width, 1));
  const offsetY = subjectPan.y * (out.height / Math.max(stageSize.height, 1));
  ctx.drawImage(canvas, (out.width - drawWidth) / 2 + offsetX, (out.height - drawHeight) / 2 + offsetY, drawWidth, drawHeight);
  return out;
}
