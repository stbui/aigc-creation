import './ImageLightbox.css';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download, FileText, Minus, Plus, RotateCw, X } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '../lib/lightboxViewport';
import { useLightboxViewport } from './useLightboxViewport';
import { Button } from '../ui';
import type { ImageLightboxProps } from './imageLightboxTypes';

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
 *
 * 2026-11-15 分层：交互状态机在 `useLightboxViewport`，几何计算在
 * `lib/lightboxViewport`，本文件只保留结构与按钮。
 */
export type { LightboxItem } from './imageLightboxTypes';

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
  const {
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
    zoomBy,
    rotate,
    resetView,
    retry,
    onImageLoad,
    onImageError,
    stageHandlers,
  } = useLightboxViewport({ items, index, item, onIndexChange, onClose });

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * 换图时收起「已复制」反馈（提示词面板的展开态保留）。
   * 与视口复位同属派生状态：在渲染期做，避免用户先看到一帧属于上一张的「已复制」。
   */
  const [copiedFor, setCopiedFor] = useState(item?.id);
  if (copiedFor !== item?.id) {
    setCopiedFor(item?.id);
    setPromptCopied(false);
  }

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

  // 打开期间锁住页面滚动；弹层宽度补偿由共享 hook 处理。
  useBodyScrollLock(Boolean(item));

  if (!item) return null;

  const meta = [items.length > 1 ? `${index + 1} / ${items.length}` : null, ...(item.meta ?? [])].filter(Boolean) as string[];

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
      <Button
        ref={closeRef}
        type="text"
        className="img-viewer-close"
        aria-label="关闭预览"
        title="关闭（Esc）"
        onClick={onClose}
      >
        <X size={20} className="size-[20px]" />
      </Button>

      {items.length > 1 && (
        <>
          <Button
            type="text"
            className="img-viewer-nav is-prev"
            aria-label="上一张"
            title="上一张（←）"
            onClick={() => go(-1)}
          >
            <ChevronLeft size={22} className="size-[22px]" />
          </Button>
          <Button
            type="text"
            className="img-viewer-nav is-next"
            aria-label="下一张"
            title="下一张（→）"
            onClick={() => go(1)}
          >
            <ChevronRight size={22} className="size-[22px]" />
          </Button>
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
        {...stageHandlers}
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
          onLoad={onImageLoad}
          onError={onImageError}
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
            <Button type="text" onClick={retry}>
              重新加载
            </Button>
          </div>
        )}
      </div>

      <div className="img-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="img-viewer-meta" aria-live="polite">{meta.join(' · ')}</span>
        <div className="img-viewer-zoom">
          <Button type="text" aria-label="缩小" title="缩小（-）" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(-ZOOM_STEP)}>
            <Minus size={16} />
          </Button>
          <Button
            type="text"
            className="img-viewer-zoom-value"
            aria-label={zoom === 1 ? '适应窗口' : `当前缩放 ${Math.round(zoom * 100)}%，点击适应窗口`}
            title="适应窗口（0）"
            onClick={resetView}
          >
            {zoom === 1 ? '适应' : `${Math.round(zoom * 100)}%`}
          </Button>
          <Button type="text" aria-label="放大" title="放大（+）" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus size={16} />
          </Button>
        </div>
        <Button
          type="text"
          className="img-viewer-rotate"
          aria-label={`顺时针旋转图片${rotation ? `，当前 ${rotation}°` : ''}`}
          aria-keyshortcuts="R"
          title="顺时针旋转 90°（R）"
          onClick={rotate}
        >
          <RotateCw size={15} className="size-[15px]" />
        </Button>
        <a className="img-viewer-download" href={item.url} download target="_blank" rel="noreferrer" aria-label="下载原图" title="下载原图">
          <Download size={15} />
          <span className="img-viewer-download-text">下载原图</span>
        </a>
        {item.prompt && (
          <Button
            type="text"
            className="img-viewer-action"
            aria-label={promptOpen ? '收起提示词' : '查看提示词'}
            aria-expanded={promptOpen}
            onClick={() => setPromptOpen((open) => !open)}
          >
            <FileText size={15} className="size-[15px]" />
            <span>提示词</span>
          </Button>
        )}
        {renderActions?.(index)}
      </div>

      {item.prompt && promptOpen && (
        <div className="img-viewer-prompt" role="region" aria-label="生成提示词" onClick={(e) => e.stopPropagation()}>
          <div className="img-viewer-prompt-head">
            <strong>生成提示词</strong>
            <Button type="text" onClick={() => void copyPrompt()}>
              {promptCopied ? <Check size={14} className="size-[14px]" /> : <Copy size={14} className="size-[14px]" />}
              {promptCopied ? '已复制' : '复制'}
            </Button>
          </div>
          <p>{item.prompt}</p>
        </div>
      )}
    </div>
  );
}
