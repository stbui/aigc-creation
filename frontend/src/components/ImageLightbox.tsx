import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react';

/**
 * 生成图大图查看器（2026-10-21 重做）。
 *
 * 旧的实现是 860px 宽的 antd Modal：图最大 62vh、不能放大也不能翻页 ——
 * 一张 2K 图在宽屏上只能看到一半细节，「看大图」名不副实。
 * 现在改为整屏暗色查看器：
 *   - 适应屏幕（object-fit: contain），按原始比例完整显示，不裁切；
 *   - 点击图片 / 滚轮 / 工具条都能放大到 1~4 倍，放大后可拖拽查看局部；
 *   - ←/→ 翻页，Esc 关闭；底部显示序号、尺寸、时间与「下载原图」。
 *
 * 只负责展示与缩放，不改动调用方的数据 —— 图片列表与当前索引都从外部传入，
 * 换图（`index` 变化）时自动复位缩放，避免把上一张的位移带到下一张。
 */
export interface LightboxItem {
  id: string;
  url: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
}

interface ImageLightboxProps {
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /**
   * 图片上点右键 (2026-10-22)。传了才接管系统菜单, 不传保持浏览器默认行为 ——
   * 查看器本身不认识「复制 / 下载 / 删除」这类业务动作, 交给调用方决定。
   */
  onItemContextMenu?: (pos: { x: number; y: number }, index: number) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function ImageLightbox({ items, index, onIndexChange, onClose, onItemContextMenu }: ImageLightboxProps) {
  const item = items[index];
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  /** 拖拽起点；null 表示当前没有拖拽 */
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  /** 本次按下是否真的拖动了 —— 拖拽结束浏览器会补发 click，不能当成「点一下切换缩放」 */
  const movedRef = useRef(false);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 换图复位：上一张的放大位置不该带到下一张
  useEffect(() => {
    resetView();
  }, [item?.id, resetView]);

  const applyZoom = useCallback((next: number) => {
    const value = clampZoom(next);
    setZoom(value);
    if (value === 1) setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setZoom((current) => {
      const value = clampZoom(current + delta);
      if (value === 1) setOffset({ x: 0, y: 0 });
      return value;
    });
  }, []);

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
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
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
    item.width && item.height ? `${item.width}×${item.height}` : null,
    item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className="img-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="生成图预览"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button type="button" className="img-viewer-close" aria-label="关闭预览" title="关闭（Esc）" onClick={onClose}>
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
          applyZoom(zoom > 1 ? 1 : 2);
        }}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
          movedRef.current = false;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = e.clientX - drag.startX;
          const dy = e.clientY - drag.startY;
          if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
          setOffset({ x: drag.originX + dx, y: drag.originY + dy });
        }}
        onPointerUp={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <img
          data-viewer-img="1"
          src={item.url}
          alt="生成图预览"
          draggable={false}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
        />
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
      </div>
    </div>
  );
}
