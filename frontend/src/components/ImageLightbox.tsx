import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react';

/**
 * 生成图大图查看器。
 *
 * 整屏暗色查看器：
 *   - 适应屏幕（object-fit: contain），按原始比例完整显示，不裁切；
 *   - 点击图片 / 滚轮 / 工具条都能放大到 1~4 倍，放大后可拖拽查看局部；
 *   - ←/→ 翻页，Esc 关闭；底部显示序号、尺寸、时间与「下载原图」。
 *
 * 只负责展示与缩放，不改动调用方的数据 —— 图片列表与当前索引都从外部传入，
 * 换图（`index` 变化）时自动复位缩放，避免把上一张的位移带到下一张。
 *
 * 交互约定：
 *   - 预加载左右相邻两张，翻页无需等待下载；
 *   - 加载中有提示，失败可原地重试（签名过期 / 文件清理都能自愈一次）；
 *   - 滚轮/点击缩放以**光标为锚点**；
 *   - 拖拽有边界约束，放大后内容始终留在视野内；
 *   - 未放大时左右滑动翻页（触屏），已放大时滑动改为拖拽视图。
 */
export interface LightboxItem {
  id: string;
  url: string;
  /** 图片替代文本；未传时沿用「生成图预览」 */
  alt?: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
  /** 调用方补充的业务元信息，显示在尺寸/时间之前 */
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

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

/**
 * 把位移夹在「放大后的图片边缘不越过它未缩放时的外框」范围内。
 *
 * 放大后图片会超出舞台；若不加约束，用户可以一路把图拖到视野之外，
 * 只剩一块黑底，还以为图没了。可平移量恰为 `未缩放尺寸 × (缩放比 - 1) / 2`：
 * 拖到边缘就停住，内容永远在视野内。只依赖图片自身尺寸，与舞台内边距无关。
 */
function clampOffset(next: { x: number; y: number }, zoom: number, img: HTMLImageElement | null) {
  if (!img) return next;
  const limitX = Math.max(0, (img.offsetWidth * (zoom - 1)) / 2);
  const limitY = Math.max(0, (img.offsetHeight * (zoom - 1)) / 2);
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
  const zoom = view.zoom;
  const offset = { x: view.x, y: view.y };
  const [dragging, setDragging] = useState(false);
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
        const clamped = clampOffset({ x: cur.x, y: cur.y }, value, imgRef.current);
        return { zoom: value, x: clamped.x, y: clamped.y };
      }
      const delta = anchorDelta(anchor, imgRef.current, cur.zoom, value);
      const clamped = clampOffset({ x: cur.x + delta.x, y: cur.y + delta.y }, value, imgRef.current);
      return { zoom: value, x: clamped.x, y: clamped.y };
    });
  }, []);

  const zoomBy = useCallback(
    (delta: number, anchor?: { x: number; y: number }) => {
      setView((cur) => {
        const value = clampZoom(cur.zoom + delta);
        if (value === cur.zoom) return cur;
        if (value === 1) return { zoom: 1, x: 0, y: 0 };
        if (!anchor || !imgRef.current) {
          const clamped = clampOffset({ x: cur.x, y: cur.y }, value, imgRef.current);
          return { zoom: value, x: clamped.x, y: clamped.y };
        }
        const shift = anchorDelta(anchor, imgRef.current, cur.zoom, value);
        const clamped = clampOffset({ x: cur.x + shift.x, y: cur.y + shift.y }, value, imgRef.current);
        return { zoom: value, x: clamped.x, y: clamped.y };
      });
    },
    [],
  );

  // 键盘：Esc 关闭 / ←→ 翻页 / +/- 缩放
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onIndexChange, zoomBy]);

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
  const meta = [
    items.length > 1 ? `${index + 1} / ${items.length}` : null,
    ...(item.meta ?? []),
    item.width && item.height ? `${item.width}×${item.height}` : null,
    item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : null,
  ].filter(Boolean) as string[];

  const retry = () => {
    setImageState({ id: item.id, state: 'loading' });
    setRetryNonce((n) => n + 1);
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
        className={`img-viewer-stage${zoom > 1 ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
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
          // 只响应舞台背景与图片本身；点工具条不触发缩放
          if (target !== e.currentTarget && !target.dataset.viewerImg) return;
          // 未加载/失败时不缩放: 点的是「重试」区域附近, 不该同时把空舞台放大
          if (imgState !== 'loaded') return;
          applyZoom(zoom > 1 ? 1 : 2, zoom > 1 ? undefined : { x: e.clientX, y: e.clientY });
        }}
        onPointerDown={(e) => {
          // 触屏未放大时记录滑动起点 (翻页手势), 放大后照旧拖拽
          if (zoom <= 1 && e.pointerType !== 'mouse') {
            swipeRef.current = { x: e.clientX, y: e.clientY };
            // 捕获指针: 手指滑出舞台边界时 pointerup 仍然落在舞台内, 否则漏掉翻页判定
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
          if (zoom <= 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
          movedRef.current = false;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag) {
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
            const clamped = clampOffset({ x: drag.originX + dx, y: drag.originY + dy }, zoom, imgRef.current);
            setView({ zoom, x: clamped.x, y: clamped.y });
            return;
          }
          // 未放大时的触屏滑动: 只记录, 抬手时才判定翻页
          if (swipeRef.current && Math.abs(e.clientY - swipeRef.current.y) > Math.abs(e.clientX - swipeRef.current.x)) {
            // 竖向手势交给浏览器 (查看器本身禁用了页面滚动, 这里仅是防误判)
            swipeRef.current = null;
          }
        }}
        onPointerUp={(e) => {
          const swipe = swipeRef.current;
          swipeRef.current = null;
          dragRef.current = null;
          setDragging(false);
          if (!swipe || items.length < 2) return;
          const dx = e.clientX - swipe.x;
          // 轻点 (几乎没动) 仍然保留「点一下放大」; 拖了一点但不够翻页则什么都不做,
          // 不能落到 click 里变成一次意外放大
          if (Math.abs(dx) < SWIPE_THRESHOLD) {
            if (Math.abs(dx) > 3) movedRef.current = true;
            return;
          }
          // 滑动已经翻页, 随后浏览器补发的 click 不能再来一次「放大」
          movedRef.current = true;
          // 左滑看下一张, 右滑看上一张 (与相册一致)
          go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipeRef.current = null;
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <img
          key={`${item.id}-${retryNonce}`}
          ref={imgRef}
          data-viewer-img="1"
          src={item.url}
          alt={item.alt ?? '生成图预览'}
          draggable={false}
          className={imgState === 'loaded' ? 'is-loaded' : undefined}
          onLoad={() => setImageState({ id: item.id, state: 'loaded' })}
          onError={() => setImageState({ id: item.id, state: 'failed' })}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
        />

        {/* 加载态: 与缩略图同款淡底, 不闪白; 失败态给出可点重试的原因提示 */}
        {imgState === 'loading' && (
          <span className="img-viewer-hint" role="status">
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
        <span className="img-viewer-meta">{meta.join(' · ')}</span>
        <div className="img-viewer-zoom">
          <button type="button" aria-label="缩小" title="缩小（-）" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(-ZOOM_STEP)}>
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="img-viewer-zoom-value"
            aria-label="恢复原始大小"
            title="恢复原始大小"
            onClick={resetView}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" aria-label="放大" title="放大（+）" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus size={16} />
          </button>
        </div>
        <a className="img-viewer-download" href={item.url} download target="_blank" rel="noreferrer">
          <Download size={15} />
          下载原图
        </a>
        {renderActions?.(index)}
      </div>
    </div>
  );
}
