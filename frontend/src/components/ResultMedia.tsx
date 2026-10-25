import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toAbsoluteUrl } from '../lib/api';
import { aigcBadgeStyle } from '../lib/aigc-label';
import { useAigcLabel } from '../hooks/useAigcLabel';
import type { AigcMeta, Modality } from '../types/api';

/**
 * 产出媒体渲染。
 *
 * ## 为什么需要这个组件
 *
 * 视频产出**不能**用 `<img>` 渲染 —— 浏览器会把 mp4 当图片解码,
 * 表现为「生成成功但预览是空白/破图」。而 `<video>` 渲染图片也能工作,
 * 只是拿不到图片的缩放与懒加载行为。
 *
 * 故按模态分流: 视频用 `<video>`, 其余用 `<img>`。
 *
 * ## 判定方式
 *
 * 按 **modality 字段**判定, 缺省按图片处理 ——
 * 不能反过来 (缺省当视频会让存量图像产出全变白屏)。
 */
export function ResultMedia({
  url,
  modality,
  alt,
  className,
  aigc,
  priority,
  fallback,
}: {
  url: string;
  modality?: Modality;
  alt: string;
  className?: string;
  /** 首屏图 (详情区主图等): 不做懒加载, 优先占用带宽 */
  priority?: boolean;
  /**
   * 图片加载失败时的替代内容。
   *
   * 不传时只把破图图标换成同尺寸的灰块 —— 浏览器默认的破图图标
   * (alt 文字 + 小图标) 在网格里比一张灰块更难看, 也会撑乱卡片。
   */
  fallback?: ReactNode;
  /**
   * AIGC 标识结果。**只有视频需要传** ——
   * 图像的「AI 生成」角标已由后端合成进像素 (用户下载/转发也带着),
   * 前端再画一个等于重复标注; 而视频没有 ffmpeg, 落不了容器元数据,
   * 后端只能回报 `method: 'api-only'`, 由播放器侧补显式标识。
   */
  aigc?: AigcMeta | null;
}) {
  const src = toAbsoluteUrl(url);
  /*
   * 失败状态按 **src 派生** (记录是哪一张失败), 而不是一个布尔值 ——
   * 列表刷新会换签名 URL, 布尔值不会自动回到「未失败」, 会让同一张图
   * 一直显示灰块; 按 src 记则换了地址就自动重试。
   */
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const failed = Boolean(src) && failedSrc === src;
  const imgRef = useRef<HTMLImageElement>(null);
  // 缓存兜底: 缓存命中时 onError 不会被补发; 只在图片明确坏掉 (complete 但无宽度) 时补一次
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0 && src) setFailedSrc(src);
  }, [src]);
  // 只有视频的 api-only 标识需要前端补角标；文案/配色从后台配置取
  const label = useAigcLabel(aigc?.method === 'api-only');
  // 后台关闭可见角标后，视频播放器的补标也一并停用（图片侧由服务端不再合成）
  const showBadge = aigc?.method === 'api-only' && label.enabled;
  if (modality === 'video') {
    const video = (
      <video
        src={src}
        className={className}
        controls
        playsInline
        preload="metadata"
        // ⚠️ 视频默认静音: 浏览器策略会拦截有声自动播放,
        // 而自动播放是本页的既有行为 (产出即展示)
        muted
      >
        您的浏览器不支持视频播放
      </video>
    );
    if (!showBadge) return video;
    return (
      <span className="result-media-aigc">
        {video}
        {/* 显式标识: 按《AIGC 标识办法》要求, 用户可感知。文案与配色跟后台「AI 标识」页一致 */}
        <span className="aigc-badge" aria-label="人工智能生成内容" style={aigcBadgeStyle(label)}>
          {label.text}
        </span>
      </span>
    );
  }
  if (failed && fallback) return <>{fallback}</>;
  /*
   * 失败后换成 1×1 透明像素, 而不是留着坏的 src:
   * 浏览器对「有 src 但加载失败」的 img 会画破图图标, 即使 alt 为空也可能留一个
   * 小图标; 换成合法图片后它只是一块空白, 尺寸仍由调用方 class 的 width/aspect-ratio
   * 决定, 于是网格不会因为一张坏图而错位。底色由 CSS 的 [data-broken] 补上。
   */
  const BROKEN_PIXEL =
    'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3C/svg%3E';
  return (
    <img
      ref={imgRef}
      src={failed ? BROKEN_PIXEL : src}
      // 失败后清空 alt, 浏览器就不再画「破图图标 + 一长串替代文字」;
      // 中性底色由 CSS 的 [data-broken] 提供, 容器尺寸与成功态一致
      alt={failed ? '' : alt}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      data-broken={failed ? '1' : undefined}
      onError={() => setFailedSrc(src)}
    />
  );
}

/** 该产出是否是视频 (供调用方决定是否显示时长等信息) */
export function isVideoModality(modality?: Modality): boolean {
  return modality === 'video';
}

/**
 * 由 mime 推导产出模态。
 *
 * 用于**只有 format 没有 modality 字段**的场合 (素材库列表等) ——
 * 后端在任务详情里已直接给 modality, 但素材列表只给 format。
 *
 * ⚠️ 按 mime 前缀判定而非按能力 id: 产出形态是文件的真实形态,
 * 不该由「当初打算产出什么」决定。
 */
export function modalityOfFormat(format?: string | null): Modality {
  return String(format ?? '').startsWith('video/') ? 'video' : 'image';
}

/** 毫秒 → 「1 分 05 秒」这类可读时长 */
export function formatDuration(durationMs?: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSec = Math.round(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min} 分 ${String(sec).padStart(2, '0')} 秒` : `${sec} 秒`;
}
