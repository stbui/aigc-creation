import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  SWIPE_THRESHOLD,
  ZOOM_STEP,
  anchorDelta,
  clampOffset,
  clampZoom,
  distanceBetween,
  midpointOf,
  type PinchStart,
  type Point,
} from '../lib/lightboxViewport';
import type { LightboxItem } from './imageLightboxTypes';

/**
 * 大图查看器的视口状态机：缩放 / 位移 / 旋转 / 拖拽 / 双指 / 加载态。
 *
 * 2026-11-15 从 `ImageLightbox` 抽出。此前 730 行的组件里，结构、按钮、手势与
 * 几何计算搅在一起 —— 加一个快捷键要先读懂六套 pointer 分支。抽出后组件只负责
 * DOM 与按钮，交互状态集中在这里；几何数学在 `lib/lightboxViewport`。
 *
 * 不变式（勿破坏）：
 * - 缩放与位移放在**同一个状态对象**里。拆成两个 useState 时，缩放要在 zoom 的
 *   更新函数里同步算位移，而更新函数必须是纯函数 —— StrictMode 下调用两次，
 *   位移会被叠加两次（表现为「放大后图突然偏到一边」）。
 * - 翻页、关闭、滚轮、预加载都按 `items` 首尾闭环。
 */

interface Options {
  items: LightboxItem[];
  index: number;
  item: LightboxItem | undefined;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export function useLightboxViewport({ items, index, item, onIndexChange, onClose }: Options) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
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
  const applyZoom = useCallback(
    (next: number, anchor?: Point) => {
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
    },
    [rotation],
  );

  const zoomBy = useCallback(
    (delta: number, anchor?: Point) => {
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

  const go = useCallback(
    (dir: -1 | 1) => onIndexChange((index + dir + items.length) % items.length),
    [index, items.length, onIndexChange],
  );

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

  const retry = useCallback(() => {
    if (!item) return;
    setImageState({ id: item.id, state: 'loading' });
    setRetryNonce((n) => n + 1);
  }, [item]);

  const onImageLoad = useCallback(() => {
    if (item) setImageState({ id: item.id, state: 'loaded' });
  }, [item]);

  const onImageError = useCallback(() => {
    if (item) setImageState({ id: item.id, state: 'failed' });
  }, [item]);

  /** 舞台点击：黑色留白 = 关闭；图片 = 切换适应/2 倍。 */
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
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
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
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
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
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
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      touchPointsRef.current.delete(e.pointerId);
    }
    if (pinchRef.current) {
      pinchRef.current = null;
      setPinching(false);
      movedRef.current = true;
      swipeRef.current = null;
      const remaining = [...touchPointsRef.current.values()][0];
      dragRef.current =
        remaining && zoom > 1
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
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
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
  };

  return {
    MIN_ZOOM,
    MAX_ZOOM,
    ZOOM_STEP,
    zoom,
    offset,
    rotation,
    dragging,
    pinching,
    imgState,
    retryNonce,
    stageRef,
    imgRef,
    go,
    applyZoom,
    zoomBy,
    rotate,
    resetView,
    retry,
    onImageLoad,
    onImageError,
    stageHandlers: { onClick: onStageClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
