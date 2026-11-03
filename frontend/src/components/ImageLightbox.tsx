import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download, FileText, Minus, Plus, RotateCw, X } from 'lucide-react';

/**
 * 生成图大图查看器。
 *
 * 整屏暗色查看器：
 *   - 适应屏幕（object-fit: contain），按原始比例完整显示，不裁切；
 *   - 点击图片 / 滚轮 / 工具条都能放大到 1~4 倍，放大后可拖拽查看局部；
 *   - ←/→ 翻页，Esc 关闭，R 旋转；底部显示序号与业务元信息。
 *
 * 只负责展示与缩放，不改动调用方的数据 —— 图片列表与当前索引都从外部传入，
 * 换图（`index` 变化）时自动复位缩放，避免把上一张的位移带到下一张。
 *
 * 交互约定：
 *   - 预加载左右相邻两张，翻页无需等待下载；
 *   - 加载中有提示，失败可原地重试（签名过期 / 文件清理都能自愈一次）；
 *   - 滚轮/点击缩放以**光标为锚点**，触屏支持双指缩放；
 *   - 支持 90° 顺时针旋转，旋转后按可视区域重新适配；
 *   - 拖拽有边界约束，放大后内容始终留在视野内；
 *   - 未放大时左右滑动翻页（触屏），已放大时单指滑动改为拖拽视图；
 *   - 点击图片切换适应/2 倍预览，点击黑色背景关闭查看器。
 */
export interface LightboxItem {
  id: string;
  url: string;
  /** 图片替代文本；未传时沿用「生成图预览」 */
  alt?: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
  /** 生成时提交的提示词；有值时可在查看器内展开查看与复制 */
  prompt?: string;
  /** 调用方补充的业务元信息；查看器不再自动展示尺寸与创建时间 */
  meta?: string[];
}

interface ImageLightboxProps {
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 无障碍名称，默认「生成图预览」 */
  ariaLabel?: string;
  /** 查看器底栏右侧的业务动作；参数为当前图片索引 */
  renderActions?: (index: number) => ReactNode;
  /**
   * 图片上点右键。传了才接管系统菜单, 不传保持浏览器默认行为 ——
   * 查看器本身不认识「复制 / 下载 / 删除」这类业务动作, 交给调用方决定。
   */
  onItemContextMenu?: (pos: { x: number; y: number }, index: number) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

/** 触屏横向滑动超过这个距离才翻页，避免把轻微抖动当成手势 */
const SWIPE_THRESHOLD = 56;

interface Point {
  x: number;
  y: number;
}

interface PinchStart {
  distance: number;
  midpoint: Point;
  zoom: number;
  offset: Point;
  /** 图片未经 transform 时的中心点，用于把双指锚点换算回图片坐标 */
  layoutCenter: Point;
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

/**
 * 把位移夹在「放大后的图片边缘不越过舞台可视区」的范围内。
 *
 * 旋转 90°/270° 后图片的视觉宽高会互换；如果仍按原布局尺寸计算，
 * 横向拖拽会在竖图上提前停住，纵向则可能拖出空屏。这里按旋转后的
 * 视觉尺寸与舞台内容区取交集，缩放和旋转共用同一套边界。
 */
function clampOffset(
  next: { x: number; y: number },
  zoom: number,
  img: HTMLImageElement | null,
  rotation = 0,
) {
  if (!img) return next;
  const stage = img.parentElement;
  if (!stage) return next;
  const style = getComputedStyle(stage);
  const stageWidth = stage.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  const stageHeight = stage.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
  const quarterTurn = rotation % 180 !== 0;
  const visualWidth = (quarterTurn ? img.offsetHeight : img.offsetWidth) * zoom;
  const visualHeight = (quarterTurn ? img.offsetWidth : img.offsetHeight) * zoom;
  const limitX = Math.max(0, (visualWidth - stageWidth) / 2);
  const limitY = Math.max(0, (visualHeight - stageHeight) / 2);
  return {
    x: Math.min(limitX, Math.max(-limitX, next.x)),
    y: Math.min(limitY, Math.max(-limitY, next.y)),
  };
}

/**
 * 以光标为锚点缩放时的位移增量。
 *
 * 变换按 `translate(offset) scale(z)`（origin 为图片中心）合成。
 * 取图片**当前**的视觉中心 `c`（已含 offset 与缩放，直接读 rect 即可），
 * 锚点在未缩放图片坐标里的位置是 `p = (anchor - c) / z₀`；要让该点不动，
 * 位移需补 `(z₀ - z₁)·p`。
 *
 * 用图片自身的 rect 而不是舞台 rect：舞台上下内边距不对称（56 / 72），
 * 按舞台中心算会恒定偏 8px，放大时表现为锚点缓慢漂移。
 */
function anchorDelta(
  anchor: { x: number; y: number },
  img: HTMLImageElement,
  fromZoom: number,
  toZoom: number,
) {
  const rect = img.getBoundingClientRect();
  const px = (anchor.x - (rect.left + rect.width / 2)) / fromZoom;
  const py = (anchor.y - (rect.top + rect.height / 2)) / fromZoom;
  return { x: (fromZoom - toZoom) * px, y: (fromZoom - toZoom) * py };
}

export function ImageLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  ariaLabel = '生成图预览',
  renderActions,
  onItemContextMenu,
}: ImageLightboxProps) {
  const item = items[index];
  /*
   * 缩放与位移放在**同一个状态对象**里。
   *
   * 分成两个 useState 时, 缩放要在 zoom 的更新函数里同步算位移并 setOffset ——
   * 更新函数必须是纯函数, StrictMode 下会被调用两次, 位移就会被叠加两次
   * (表现为「放大后图突然偏到一边」)。合并成一个对象后每次更新都是纯计算。
   */
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const zoom = view.zoom;
  const offset = { x: view.x, y: view.y };
  const [dragging, setDragging] = useState(false);
  const [pinching, setPinching] = useState(false);
  /**
   * 加载状态**带着图片 id**。
   *
   * 只存一个字符串时，翻页后新图会先继承上一张的 'loaded'（effect 在绘制之后才跑），
   * 于是新图以 opacity:1 出现、解码期间露一块空白 —— 正是要避免的闪白。
   * 存 id 后可以直接推导「不是当前这张 → 视为 loading」，无需等 effect。
   */
  const [imageState, setImageState] = useState<{ id?: string; state: 'loading' | 'loaded' | 'failed' }>({
    state: 'loading',
  });
  /**
   * 已经成功显示过的图。翻回上一张时直接按「已加载」渲染 ——
   * 不走淡入, 避免来回翻页时每张都闪一下。
   * 失败不缓存: 用户点了重试就该真的再试。
   */
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const imgState =
    imageState.id === item?.id ? imageState.state : item && loadedIdsRef.current.has(item.id) ? 'loaded' : 'loading';
  /** 失败后「重试」自增，用来强制重建 <img> 让浏览器重新请求 */
  const [retryNonce, setRetryNonce] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 拖拽起点；null 表示当前没有拖拽 */
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  /** 本次按下是否真的拖动了 —— 拖拽结束浏览器会补发 click，不能当成「点一下切换缩放」 */
  const movedRef = useRef(false);
  /** 触屏滑动起点（未放大时用于翻页） */
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  /** 当前按在舞台上的触点，双指手势需要同时跟踪两个 pointerId */
  const touchPointsRef = useRef<Map<number, Point>>(new Map());
  /** 双指缩放起始快照；null 表示当前不是双指手势 */
  const pinchRef = useRef<PinchStart | null>(null);

  const resetView = useCallback(() => {
    setView({ zoom: 1, x: 0, y: 0 });
  }, []);

  /*
   * 换图复位：上一张的放大位移与加载状态都不该带到下一张。
   *
   * 在渲染期做（而不是 useEffect）是 React 官方的「派生状态」写法：
   * effect 在绘制之后才跑，用户会先看到一帧带旧位移/旧状态的图。
   * 条件在下一轮渲染即不成立，不会死循环。
   */
  const [renderedId, setRenderedId] = useState(item?.id);
  if (renderedId !== item?.id) {
    setRenderedId(item?.id);
    setView({ zoom: 1, x: 0, y: 0 });
    setRotation(0);
    setPromptCopied(false);
    setImageState({ id: item?.id, state: item && loadedIdsRef.current.has(item.id) ? 'loaded' : 'loading' });
    setRetryNonce(0);
  }

  /*
   * 缓存兜底: 图片已在 HTTP 缓存里时, load 事件可能早于 React 挂上监听,
   * 于是永远停在「正在加载」。挂载/换图后查一次 complete 补上状态。
   */
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !item) return;
    if (img.complete && img.naturalWidth > 0) {
      setImageState({ id: item.id, state: 'loaded' });
    }
  }, [item, retryNonce]);

  // 成功加载过就记下, 供翻回时跳过淡入
  useEffect(() => {
    if (imgState === 'loaded' && item) loadedIdsRef.current.add(item.id);
  }, [imgState, item]);

  // 换图时终止尚未结束的手势，避免上一张的触点/拖拽状态污染下一张。
  useEffect(() => {
    touchPointsRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
    swipeRef.current = null;
    setPinching(false);
    setDragging(false);
  }, [item?.id]);

  /*
   * 预加载相邻两张。
   *
   * 翻页是查看器最高频的动作。用 `new Image()` 提前把 ±1 拉进 HTTP 缓存，
   * 翻页几乎是瞬时的；
   * 首尾闭环（与 ←/→ 的取模翻页一致），不额外请求已缓存的当前图。
   */
  useEffect(() => {
    if (items.length < 2) return;
    const neighbors = [(index + 1) % items.length, (index - 1 + items.length) % items.length];
    const preloaded = neighbors
      .filter((i) => i !== index && items[i]?.url)
      .map((i) => {
        const img = new Image();
        img.src = items[i].url;
        return img;
      });
    return () => {
      preloaded.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [index, items]);

  /*
   * 打开时把焦点交给关闭按钮，关闭时还给打开前的元素。
   * 不做焦点陷阱（整屏查看器本身没有其它可跳出的焦点目标），但至少让键盘
   * 用户一进来就能 Esc 关闭，而不是按 Tab 一路穿过背后的页面。
   */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  /*
   * 窗口旋转 / 分屏会改变适应后的图片尺寸，旧位移可能在新尺寸下越界。
   * 图片尺寸落定后再收敛一次，避免放大中的内容被裁到视野之外。
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setView((cur) => {
        if (cur.zoom <= 1) return cur;
        const clamped = clampOffset({ x: cur.x, y: cur.y }, cur.zoom, imgRef.current, rotation);
        return clamped.x === cur.x && clamped.y === cur.y ? cur : { zoom: cur.zoom, ...clamped };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rotation]);

  /**
   * 缩放到 `next`，并让舞台内 `anchor` 点（视口坐标，缺省为正中）保持不动。
   *
   * 不传锚点（键盘 +/- 与工具条）时保留当前位移、只做边界收敛，视觉上仍是
   * 围绕当前视点缩放；滚轮与点击传入光标位置，放大的是用户正在看的那块细节。
   */
  const applyZoom = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const value = clampZoom(next);
    setView((cur) => {
      if (cur.zoom === value) return cur;
      if (value === 1) return { zoom: 1, x: 0, y: 0 };
      // 无锚点 (键盘/工具条) 保留原有位移并做边界收敛, 仍是「居中放大」
      if (!anchor || !imgRef.current) {
        const clamped = clampOffset({ x: cur.x, y: cur.y }, value, imgRef.current, rotation);
        return { zoom: value, x: clamped.x, y: clamped.y };
      }
      const delta = anchorDelta(anchor, imgRef.current, cur.zoom, value);
      const clamped = clampOffset({ x: cur.x + delta.x, y: cur.y + delta.y }, value, imgRef.current, rotation);
      return { zoom: value, x: clamped.x, y: clamped.y };
    });
  }, [rotation]);

  const zoomBy = useCallback(
    (delta: number, anchor?: { x: number; y: number }) => {
      setView((cur) => {
        const value = clampZoom(cur.zoom + delta);
        if (value === cur.zoom) return cur;
        if (value === 1) return { zoom: 1, x: 0, y: 0 };
        if (!anchor || !imgRef.current) {
          const clamped = clampOffset({ x: cur.x, y: cur.y }, value, imgRef.current, rotation);
          return { zoom: value, x: clamped.x, y: clamped.y };
        }
        const shift = anchorDelta(anchor, imgRef.current, cur.zoom, value);
        const clamped = clampOffset({ x: cur.x + shift.x, y: cur.y + shift.y }, value, imgRef.current, rotation);
        return { zoom: value, x: clamped.x, y: clamped.y };
      });
    },
    [rotation],
  );

  const rotate = useCallback(() => {
    setRotation((current) => (current + 90) % 360);
    // 旋转后保持当前倍率，但回到中心，避免上一方向的位移让图片突然跳到角落。
    setView((current) => ({ ...current, x: 0, y: 0 }));
  }, []);

  // 键盘：Esc 关闭 / ←→ 翻页 / +/- 缩放 / R 旋转
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (items.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        onIndexChange((index + dir + items.length) % items.length);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === '-') {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        resetView();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onIndexChange, resetView, rotate, zoomBy]);

  /*
   * 滚轮缩放必须绑原生监听：React 的 onWheel 在浏览器里是 passive 的，
   * preventDefault() 无效，缩放窗口的同时整页会跟着滚。
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 以光标为锚点: 放大的是指针所在的那块细节, 而不是永远围绕正中
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // 打开期间锁住页面滚动，关闭时恢复原值（不假设它一定是空串）
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;

  const go = (dir: -1 | 1) => onIndexChange((index + dir + items.length) % items.length);
  const meta = [items.length > 1 ? `${index + 1} / ${items.length}` : null, ...(item.meta ?? [])].filter(Boolean) as string[];

  const retry = () => {
    setImageState({ id: item.id, state: 'loading' });
    setRetryNonce((n) => n + 1);
  };

  const copyPrompt = async () => {
    if (!item.prompt) return;
    try {
      await navigator.clipboard.writeText(item.prompt);
      setPromptCopied(true);
    } catch {
      setPromptCopied(false);
    }
  };

  return (
    <div
      className="img-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="img-viewer-close"
        aria-label="关闭预览"
        title="关闭（Esc）"
        onClick={onClose}
      >
        <X size={20} />
      </button>

      {items.length > 1 && (
        <>
          <button
            type="button"
            className="img-viewer-nav is-prev"
            aria-label="上一张"
            title="上一张（←）"
            onClick={() => go(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="img-viewer-nav is-next"
            aria-label="下一张"
            title="下一张（→）"
            onClick={() => go(1)}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      <div
        ref={stageRef}
        className={`img-viewer-stage${zoom > 1 ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}${pinching ? ' is-pinching' : ''}${rotation % 180 !== 0 ? ' is-quarter-turn' : ''}`}
        onContextMenu={(e) => {
          if (!onItemContextMenu) return;
          e.preventDefault();
          onItemContextMenu({ x: e.clientX, y: e.clientY }, index);
        }}
        onClick={(e) => {
          if (movedRef.current) {
            movedRef.current = false;
            return;
          }
          const target = e.target as HTMLElement;
          // 黑色留白是“关闭”热区；只有点图片本身才切换缩放，避免点在图旁边也乱放大。
          if (target === e.currentTarget) {
            onClose();
            return;
          }
          if (!target.dataset.viewerImg) return;
          // 未加载/失败时不缩放: 点的是「重试」区域附近, 不该同时把空舞台放大
          if (imgState !== 'loaded') return;
          applyZoom(zoom > 1 ? 1 : 2, zoom > 1 ? undefined : { x: e.clientX, y: e.clientY });
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;

          if (e.pointerType === 'touch') {
            e.currentTarget.setPointerCapture(e.pointerId);
            touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (touchPointsRef.current.size >= 2) {
              const [a, b] = [...touchPointsRef.current.values()];
              const rect = imgRef.current?.getBoundingClientRect();
              if (rect && rect.width > 0 && rect.height > 0) {
                const startZoom = zoom;
                const startOffset = { x: offset.x, y: offset.y };
                pinchRef.current = {
                  distance: Math.max(1, distanceBetween(a, b)),
                  midpoint: midpointOf(a, b),
                  zoom: startZoom,
                  offset: startOffset,
                  layoutCenter: {
                    x: rect.left + rect.width / 2 - startOffset.x,
                    y: rect.top + rect.height / 2 - startOffset.y,
                  },
                };
                swipeRef.current = null;
                dragRef.current = null;
                movedRef.current = true;
                setDragging(false);
                setPinching(true);
              }
              return;
            }

            // 单指未放大时记录滑动起点 (翻页手势), 放大后改为拖拽视图
            if (zoom <= 1) {
              swipeRef.current = { x: e.clientX, y: e.clientY };
              return;
            }
            dragRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
            movedRef.current = false;
            setDragging(true);
            return;
          }

          if (zoom <= 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
          movedRef.current = false;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'touch') {
            const previous = touchPointsRef.current.get(e.pointerId);
            if (previous) touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            const pinch = pinchRef.current;
            if (pinch && touchPointsRef.current.size >= 2) {
              const [a, b] = [...touchPointsRef.current.values()];
              const distance = Math.max(1, distanceBetween(a, b));
              const midpoint = midpointOf(a, b);
              const nextZoom = clampZoom(pinch.zoom * (distance / pinch.distance));
              const startCenter = {
                x: pinch.layoutCenter.x + pinch.offset.x,
                y: pinch.layoutCenter.y + pinch.offset.y,
              };
              const local = {
                x: (pinch.midpoint.x - startCenter.x) / pinch.zoom,
                y: (pinch.midpoint.y - startCenter.y) / pinch.zoom,
              };
              const nextCenter = {
                x: midpoint.x - local.x * nextZoom,
                y: midpoint.y - local.y * nextZoom,
              };
              const clamped = clampOffset(
                {
                  x: nextCenter.x - pinch.layoutCenter.x,
                  y: nextCenter.y - pinch.layoutCenter.y,
                },
                nextZoom,
                imgRef.current,
                rotation,
              );
              setView({ zoom: nextZoom, ...clamped });
              return;
            }
            // 单指滑动时只记录；抬手后才判定翻页
            if (swipeRef.current && Math.abs(e.clientY - swipeRef.current.y) > Math.abs(e.clientX - swipeRef.current.x)) {
              swipeRef.current = null;
            }
          }

          const drag = dragRef.current;
          if (drag) {
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
            const clamped = clampOffset({ x: drag.originX + dx, y: drag.originY + dy }, zoom, imgRef.current, rotation);
            setView({ zoom, x: clamped.x, y: clamped.y });
          }
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'touch') {
            touchPointsRef.current.delete(e.pointerId);
          }
          if (pinchRef.current) {
            pinchRef.current = null;
            setPinching(false);
            movedRef.current = true;
            swipeRef.current = null;
            const remaining = [...touchPointsRef.current.values()][0];
            dragRef.current = remaining && zoom > 1
              ? { startX: remaining.x, startY: remaining.y, originX: offset.x, originY: offset.y }
              : null;
            setDragging(remaining != null && zoom > 1);
            return;
          }

          const swipe = swipeRef.current;
          swipeRef.current = null;
          dragRef.current = null;
          setDragging(false);
          if (!swipe || items.length < 2) return;
          const dx = e.clientX - swipe.x;
          // 轻点 (几乎没动) 仍然保留“点一下放大”; 拖了一点但不够翻页则什么都不做,
          // 不能落到 click 里变成一次意外放大
          if (Math.abs(dx) < SWIPE_THRESHOLD) {
            if (Math.abs(dx) > 3) movedRef.current = true;
            return;
          }
          // 滑动已经翻页, 随后浏览器补发的 click 不能再来一次“放大”
          movedRef.current = true;
          // 左滑看下一张, 右滑看上一张 (与相册一致)
          go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={(e) => {
          if (e.pointerType === 'touch') touchPointsRef.current.delete(e.pointerId);
          if (touchPointsRef.current.size < 2) {
            pinchRef.current = null;
            setPinching(false);
          }
          if (touchPointsRef.current.size === 0) {
            swipeRef.current = null;
            dragRef.current = null;
            setDragging(false);
          }
        }}
      >
        <img
          key={`${item.id}-${retryNonce}`}
          ref={imgRef}
          data-viewer-img="1"
          src={item.url}
          alt={item.alt ?? '生成图预览'}
          draggable={false}
          decoding="async"
          fetchPriority="high"
          className={imgState === 'loaded' ? 'is-loaded' : undefined}
          onLoad={() => setImageState({ id: item.id, state: 'loaded' })}
          onError={() => setImageState({ id: item.id, state: 'failed' })}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom}) rotate(${rotation}deg)` }}
        />

        {/* 加载态: 与缩略图同款淡底, 不闪白; 失败态给出可点重试的原因提示 */}
        {imgState === 'loading' && (
          <span className="img-viewer-hint" role="status">
            <span className="img-viewer-spinner" aria-hidden="true" />
            正在加载原图…
          </span>
        )}
        {imgState === 'failed' && (
          <div className="img-viewer-failed" role="alert" onClick={(e) => e.stopPropagation()}>
            <strong>原图加载失败</strong>
            <span>链接可能已过期或文件已被清理，可先重新加载一次。</span>
            <button type="button" onClick={retry}>
              重新加载
            </button>
          </div>
        )}
      </div>

      <div className="img-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="img-viewer-meta" aria-live="polite">{meta.join(' · ')}</span>
        <div className="img-viewer-zoom">
          <button type="button" aria-label="缩小" title="缩小（-）" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(-ZOOM_STEP)}>
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="img-viewer-zoom-value"
            aria-label={zoom === 1 ? '适应窗口' : `当前缩放 ${Math.round(zoom * 100)}%，点击适应窗口`}
            title="适应窗口（0）"
            onClick={resetView}
          >
            {zoom === 1 ? '适应' : `${Math.round(zoom * 100)}%`}
          </button>
          <button type="button" aria-label="放大" title="放大（+）" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus size={16} />
          </button>
        </div>
        <button
          type="button"
          className="img-viewer-rotate"
          aria-label={`顺时针旋转图片${rotation ? `，当前 ${rotation}°` : ''}`}
          aria-keyshortcuts="R"
          title="顺时针旋转 90°（R）"
          onClick={rotate}
        >
          <RotateCw size={15} />
        </button>
        <a className="img-viewer-download" href={item.url} download target="_blank" rel="noreferrer" aria-label="下载原图" title="下载原图">
          <Download size={15} />
          <span className="img-viewer-download-text">下载原图</span>
        </a>
        {item.prompt && (
          <button
            type="button"
            className="img-viewer-action"
            aria-label={promptOpen ? '收起提示词' : '查看提示词'}
            aria-expanded={promptOpen}
            onClick={() => setPromptOpen((open) => !open)}
          >
            <FileText size={15} />
            <span>提示词</span>
          </button>
        )}
        {renderActions?.(index)}
      </div>

      {item.prompt && promptOpen && (
        <div className="img-viewer-prompt" role="region" aria-label="生成提示词" onClick={(e) => e.stopPropagation()}>
          <div className="img-viewer-prompt-head">
            <strong>生成提示词</strong>
            <button type="button" onClick={() => void copyPrompt()}>
              {promptCopied ? <Check size={14} /> : <Copy size={14} />}
              {promptCopied ? '已复制' : '复制'}
            </button>
          </div>
          <p>{item.prompt}</p>
        </div>
      )}
    </div>
  );
}
