import { MIN_REGION_SIZE, clamp, moveRectWithin, resizeRectWithin } from './geometry';
import {
  cloneMark,
  isRegionMark,
  regionBoundsForMark,
  resolveVisibleMarks,
  sampleStrokeDots,
  strokeHasLength,
  visibleRegionMarks,
} from './marks';
import { MaskBuffer } from './mask';
import type {
  DragMode,
  DrawTool,
  Mark,
  MaskOverlayModel,
  MaskSessionOptions,
  MaskState,
  Point,
  RegionBounds,
  ResizeHandle,
  SourceSize,
} from './types';

interface DragSession {
  mark: Mark;
  mode: DragMode;
  snapshot: Mark;
  start: Point;
  handle?: ResizeHandle;
}

/**
 * 遮罩画布会话 —— 画布 SDK 的核心，不依赖 React / 具体 DOM 结构。
 *
 * 职责：
 *   - 维护标记列表、撤销 / 恢复栈、草稿与选中态；
 *   - 处理画笔 / 橡皮 / 框选 / 圈选的手势，以及已提交标记的拖动与缩放；
 *   - 持有离屏遮罩缓冲，负责整张重放、增量描边与 PNG 导出；
 *   - 通过订阅把「叠层变化」与「状态变化」分开通知适配层。
 *
 * 适配层只负责：把客户端坐标换算成原图坐标（`geometry.sourcePoint`）、
 * 渲染 DOM 叠层、处理指针捕获与平移缩放。
 *
 * 通知分两条通道：
 *   - `subscribe`：叠层需要重渲染（含每帧的连续手势），适配层按 `version` 记忆化；
 *   - `onStateChange`：离散状态变化（提交 / 撤销 / 清空 / 删除 / 拖拽结束），
 *     适配层据此回传 painted / canUndo / canRedo / regions。
 * 分开的原因：拖动期间每帧都通知页面 onChange 会让整页（含外壳）按帧重渲染，
 * 而页面的可提交状态只在离散动作后才会改变。
 */
export class MaskSession {
  private source: SourceSize | null = null;
  private marks: Mark[] = [];
  private redo: Mark[] = [];
  private draft: Mark | null = null;
  private gestureStart: Point | null = null;
  private selectedId: number | null = null;
  private drag: DragSession | null = null;
  private nextId = 1;

  private maxRegions = Number.POSITIVE_INFINITY;
  private onRegionLimit: (() => void) | null = null;
  private selectDraftShape = true;

  private mask = new MaskBuffer();
  private overlayListeners = new Set<() => void>();
  private stateListeners = new Set<(state: MaskState) => void>();
  private version = 0;
  private rafId: number | null = null;
  private pendingReplay = false;

  constructor(options: MaskSessionOptions = {}) {
    this.setOptions(options);
  }

  /** 运行期更新页面策略（区域上限、上限提示、草稿是否即选）。 */
  setOptions(options: MaskSessionOptions): void {
    if (options.maxRegions !== undefined) this.maxRegions = options.maxRegions;
    if (options.onRegionLimit !== undefined) this.onRegionLimit = options.onRegionLimit;
    if (options.selectDraftShape !== undefined) this.selectDraftShape = options.selectDraftShape;
  }

  // ── 订阅 ────────────────────────────────────────────────

  /** 叠层变化（含连续手势，按帧合并）。返回退订函数。 */
  subscribe = (listener: () => void): (() => void) => {
    this.overlayListeners.add(listener);
    return () => {
      this.overlayListeners.delete(listener);
    };
  };

  /** 离散状态变化。返回退订函数。 */
  onStateChange = (listener: (state: MaskState) => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };

  /** `useSyncExternalStore` 的快照；数字变化即代表叠层需要重算。 */
  getVersion = (): number => this.version;

  /** 取消排队中的帧并清空订阅；不销毁标记数据（StrictMode 下可继续使用）。 */
  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingReplay = false;
    this.overlayListeners.clear();
    this.stateListeners.clear();
  }

  // ── 生命周期 ────────────────────────────────────────────

  /** 原图加载后调用：重置标记并按原图尺寸分配遮罩。 */
  setSourceSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.source = { width, height };
    this.resetState();
    this.nextId = 1;
    this.mask.setSize(width, height);
    this.emitDiscrete();
  }

  /** 换图时立即清空（新的原图尺寸就绪前先让叠层归零）。 */
  reset(): void {
    this.resetState();
    this.nextId = 1;
    this.emitDiscrete();
  }

  getSourceSize(): SourceSize | null {
    return this.source;
  }

  // ── 手势：新建标记 ──────────────────────────────────────

  /**
   * 在画布上按下。
   *
   * @param width 画笔 / 橡皮的笔宽（原图像素），由适配层按缩放换算后传入。
   */
  beginGesture(tool: DrawTool, point: Point, width = 2): boolean {
    if (!this.source) return false;
    this.selectedId = null;
    this.gestureStart = point;
    if (tool === 'brush' || tool === 'eraser') {
      this.draft = {
        kind: 'stroke',
        id: this.nextId++,
        tool,
        points: [point],
        width: Math.max(2, width),
      };
    } else {
      this.draft = {
        kind: 'shape',
        id: this.nextId++,
        tool,
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      };
      if (this.selectDraftShape) this.selectedId = this.draft.id;
    }
    this.pendingReplay = false;
    this.mask.replay(this.marks, this.draft);
    this.emitOverlaySync();
    return true;
  }

  /** 手势移动。画笔增量描边，形状整张重放（按帧合并）。 */
  extendGesture(point: Point): void {
    const draft = this.draft;
    if (!draft) return;
    if (draft.kind === 'stroke') {
      const from = draft.points[draft.points.length - 1];
      draft.points.push(point);
      this.mask.appendStrokeSegment(draft, from, point);
      this.scheduleFrame(false);
      return;
    }
    if (!this.gestureStart) return;
    const start = this.gestureStart;
    draft.x = Math.min(start.x, point.x);
    draft.y = Math.min(start.y, point.y);
    draft.width = Math.abs(point.x - start.x);
    draft.height = Math.abs(point.y - start.y);
    this.scheduleFrame(true);
  }

  /** 手势结束：达到可见长度的涂抹 / 达到最小边长的形状才提交。 */
  endGesture(): void {
    const draft = this.draft;
    if (!draft) return;
    const valid =
      draft.kind === 'stroke'
        ? strokeHasLength(draft)
        : draft.width >= MIN_REGION_SIZE && draft.height >= MIN_REGION_SIZE;

    let limitReached = false;
    if (valid) {
      if (isRegionMark(draft) && this.getRegionCount() >= this.maxRegions) {
        limitReached = true;
        if (this.selectedId === draft.id) this.selectedId = null;
      } else {
        this.marks.push(draft);
        this.redo = [];
        this.selectedId = draft.kind === 'shape' ? draft.id : null;
      }
    } else if (draft.kind === 'shape') {
      if (this.selectedId === draft.id) this.selectedId = null;
    }

    this.draft = null;
    this.gestureStart = null;
    this.emitDiscrete();
    if (limitReached) this.onRegionLimit?.();
  }

  /** 手势取消：丢弃草稿并整张重放，去掉已经增量画进去的部分。 */
  cancelGesture(): void {
    if (!this.draft) return;
    this.draft = null;
    this.gestureStart = null;
    this.emitDiscrete();
  }

  // ── 手势：拖动 / 缩放已提交标记 ─────────────────────────

  /** 按住一个已提交标记。返回是否真的进入了拖拽（找不到标记时为 false）。 */
  beginDrag(markId: number, mode: DragMode, point: Point, handle?: ResizeHandle): boolean {
    const mark = this.marks.find((item) => item.id === markId);
    if (!mark) return false;
    this.selectedId = mark.id;
    this.redo = [];
    this.drag = { mark, mode, snapshot: cloneMark(mark), start: point, handle };
    this.emitOverlaySync();
    return true;
  }

  extendDrag(point: Point): void {
    const drag = this.drag;
    if (!drag || !this.source) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const { width, height } = this.source;

    if (drag.mode === 'move') {
      if (drag.mark.kind === 'shape' && drag.snapshot.kind === 'shape') {
        const next = moveRectWithin(drag.snapshot, dx, dy, width, height);
        drag.mark.x = next.x;
        drag.mark.y = next.y;
      } else if (drag.mark.kind === 'stroke' && drag.snapshot.kind === 'stroke') {
        drag.mark.points = drag.snapshot.points.map((p) => ({
          x: clamp(p.x + dx, 0, width),
          y: clamp(p.y + dy, 0, height),
        }));
      }
    } else if (drag.mark.kind === 'shape' && drag.snapshot.kind === 'shape') {
      const next = resizeRectWithin(drag.snapshot, drag.handle, dx, dy, width, height);
      drag.mark.x = next.x;
      drag.mark.y = next.y;
      drag.mark.width = next.width;
      drag.mark.height = next.height;
    }
    this.scheduleFrame(true);
  }

  endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.emitDiscrete();
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  /** 是否有进行中的新建手势；适配层据此跳过无谓的坐标换算。 */
  isGesturing(): boolean {
    return this.draft !== null;
  }

  // ── 直接动作 ────────────────────────────────────────────

  undo(): void {
    const last = this.marks[this.marks.length - 1];
    if (!last) return;
    this.marks = this.marks.slice(0, -1);
    this.redo = [...this.redo, last];
    if (this.selectedId === last.id) this.selectedId = null;
    this.emitDiscrete();
  }

  redoStep(): void {
    const next = this.redo[this.redo.length - 1];
    if (!next) return;
    this.redo = this.redo.slice(0, -1);
    this.marks = [...this.marks, next];
    this.selectedId = next.kind === 'shape' ? next.id : null;
    this.emitDiscrete();
  }

  clear(): void {
    this.resetState();
    this.emitDiscrete();
  }

  /** 按稳定 id 删除当前可见的可描述区域。 */
  removeRegion(id: number): void {
    const target = visibleRegionMarks(this.marks).find((mark) => mark.id === id);
    if (!target) return;
    this.marks = this.marks.filter((mark) => mark !== target);
    this.redo = [];
    this.draft = null;
    this.gestureStart = null;
    this.drag = null;
    if (this.selectedId === target.id) this.selectedId = null;
    this.emitDiscrete();
  }

  select(id: number | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emitOverlaySync();
  }

  // ── 查询与导出 ──────────────────────────────────────────

  getSelectedId(): number | null {
    return this.selectedId;
  }

  /** 橡皮只是修正遮罩，不创建新区域；完全擦除的涂抹也不再计入。 */
  getRegionCount(): number {
    return visibleRegionMarks(this.marks).length;
  }

  /** 每个可描述区域在原图上的包围盒。 */
  getRegionBounds(): RegionBounds[] {
    const source = this.source;
    if (!source) return [];
    const { regions, pointsById } = resolveVisibleMarks(this.marks);
    const bounds: RegionBounds[] = [];
    for (const mark of regions) {
      const region = regionBoundsForMark(
        mark,
        this.marks,
        source.width,
        source.height,
        pointsById.get(mark.id),
      );
      if (region) bounds.push(region);
    }
    return bounds;
  }

  /** 会话状态快照（适配层回传给页面的形状）。 */
  getState(): MaskState {
    return {
      painted: this.mask.hasPaint(),
      canUndo: this.marks.length > 0,
      canRedo: this.redo.length > 0,
      regions: this.getRegionBounds(),
    };
  }

  /**
   * 适配层渲染 DOM 叠层所需的派生数据。
   *
   * 返回的 `marks` 含草稿；`regionIndex` / `dotsById` 只覆盖当前可见区域。
   */
  getOverlayModel(): MaskOverlayModel {
    const marks = this.draft ? [...this.marks, this.draft] : this.marks;
    const { regions, pointsById } = resolveVisibleMarks(marks);
    const regionIndex = new Map<number, number>();
    regions.forEach((mark, index) => regionIndex.set(mark.id, index + 1));
    const dotsById = new Map<number, Point[]>();
    for (const mark of marks) {
      if (mark.kind !== 'stroke' || mark.tool !== 'brush') continue;
      dotsById.set(mark.id, sampleStrokeDots(pointsById.get(mark.id) ?? mark.points, mark.width));
    }
    return { marks, regionIndex, dotsById, selectedId: this.selectedId };
  }

  /** 导出遮罩 PNG（会先整张重放，保证结果是标记列表的唯一映射）。 */
  toBlob(): Promise<Blob | null> {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingReplay = false;
    this.mask.replay(this.marks, this.draft);
    return this.mask.toBlob();
  }

  // ── 内部：帧合并与通知 ──────────────────────────────────

  private resetState(): void {
    this.marks = [];
    this.redo = [];
    this.draft = null;
    this.gestureStart = null;
    this.drag = null;
    this.selectedId = null;
    /*
     * 不清 nextId：页面按区域 id 保存描述草稿，清空画布后复用 id 会让旧描述
     * 附着到新区域上。只有换图（页面同时清空草稿）才重新从 1 开始。
     */
  }

  private scheduleFrame(replay: boolean): void {
    if (replay) this.pendingReplay = true;
    if (typeof requestAnimationFrame === 'undefined') {
      this.flushFrame();
      return;
    }
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flushFrame();
    });
  }

  private flushFrame(): void {
    if (this.pendingReplay) {
      this.pendingReplay = false;
      this.mask.replay(this.marks, this.draft);
    }
    this.bumpOverlay();
  }

  /** 同步通知叠层（选中 / 手势按下这类必须立刻可见的变化）。 */
  private emitOverlaySync(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingReplay = false;
    this.bumpOverlay();
  }

  /** 离散变化：整张重放 + 叠层 + 状态一起通知。 */
  private emitDiscrete(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingReplay = false;
    this.mask.replay(this.marks, this.draft);
    this.bumpOverlay();
    if (this.stateListeners.size === 0) return;
    const state = this.getState();
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private bumpOverlay(): void {
    this.version += 1;
    for (const listener of [...this.overlayListeners]) listener();
  }
}
