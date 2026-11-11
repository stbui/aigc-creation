import { eraseMaskRegion, fillMaskBackground } from './geometry';
import type { Mark, Point, StrokeMark } from './types';

/**
 * 离屏遮罩缓冲。
 *
 * 遮罩是唯一导出源：白底 + 透明标注区。可见的 DOM 叠层只负责显示与选择，
 * 两者互不影响。缓冲自己持有 canvas / 上下文 / 透明像素探测画布，适配层
 * 不需要再管理一块隐藏 canvas。
 */

/** 透明像素探测画布边长：足以判断「有没有涂过」，又不必为 4K 遮罩逐像素扫描。 */
const PROBE_SIZE = 64;
/** 至少这么多透明像素才认为用户涂过，滤掉单个采样点的舍入误差。 */
const PAINT_MIN_TRANSPARENT = 4;

/** 遮罩上的笔迹样式：画笔擦出透明孔，橡皮用白色补回保留区。 */
function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  tool: StrokeMark['tool'],
  width: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.globalAlpha = 1;
  if (tool === 'brush') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'black';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'white';
  }
}

/** 把一个标记画进遮罩（整张重放时使用）。 */
export function paintMaskMark(ctx: CanvasRenderingContext2D, mark: Mark): void {
  if (mark.kind === 'stroke') {
    if (mark.points.length === 0) return;
    ctx.save();
    applyStrokeStyle(ctx, mark.tool, mark.width);
    ctx.beginPath();
    ctx.moveTo(mark.points[0].x, mark.points[0].y);
    for (let i = 1; i < mark.points.length; i += 1) ctx.lineTo(mark.points[i].x, mark.points[i].y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  eraseMaskRegion(ctx, mark.tool, mark);
}

export class MaskBuffer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private probe: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;

  /** 按原图尺寸分配/重置遮罩；重复调用只改尺寸，不新建 canvas。 */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (typeof document === 'undefined') return;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d');
    }
    this.canvas.width = width;
    this.canvas.height = height;
    /* 改尺寸会重置上下文状态，但对象本身不变；首次取不到时再补一次。 */
    if (!this.context) this.context = this.canvas.getContext('2d');
  }

  /** 丢弃缓冲（换图或卸载时）。下一次 setSize 会重新创建。 */
  reset(): void {
    this.canvas = null;
    this.context = null;
    this.probe = null;
    this.width = 0;
    this.height = 0;
  }

  /** 整张重放：白底 + 全部标记（含草稿）。 */
  replay(marks: readonly Mark[], draft?: Mark | null): void {
    const ctx = this.context;
    if (!ctx) return;
    fillMaskBackground(ctx, this.width, this.height);
    for (const mark of marks) paintMaskMark(ctx, mark);
    if (draft) paintMaskMark(ctx, draft);
  }

  /**
   * 只把涂抹的最新一段画到遮罩上。
   *
   * 圆头线段逐段并集与整条折线一次描边在几何上等价，但前者只处理新增的
   * 十几个像素，后者要把全部标记重放一遍 —— 4K 图上差距最明显。增量结果
   * 只服务手势期间的预览：提交 / 取消 / 导出都会整张重放归一化。
   */
  appendStrokeSegment(mark: StrokeMark, from: Point, to: Point): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.save();
    applyStrokeStyle(ctx, mark.tool, mark.width);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  /** 在 64×64 缩略图上数透明像素；探测画布与上下文复用，避免每次新建。 */
  hasPaint(): boolean {
    const canvas = this.canvas;
    if (!canvas || this.width === 0) return false;
    if (!this.probe) {
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = PROBE_SIZE;
      probeCanvas.height = PROBE_SIZE;
      this.probe = probeCanvas.getContext('2d', { willReadFrequently: true });
      if (!this.probe) return false;
    }
    /* 遮罩有透明孔，drawImage 的 source-over 不会清掉旧像素，必须先擦干净。 */
    this.probe.clearRect(0, 0, PROBE_SIZE, PROBE_SIZE);
    this.probe.drawImage(canvas, 0, 0, PROBE_SIZE, PROBE_SIZE);
    const { data } = this.probe.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE);
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] >= 128) continue;
      transparent += 1;
      if (transparent >= PAINT_MIN_TRANSPARENT) return true;
    }
    return false;
  }

  /** 导出 PNG；没有原图或没有可提交区域时返回 null。 */
  toBlob(): Promise<Blob | null> {
    const canvas = this.canvas;
    if (!canvas || this.width === 0 || !this.hasPaint()) return Promise.resolve(null);
    return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  }
}
