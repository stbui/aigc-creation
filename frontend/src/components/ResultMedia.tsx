import { toAbsoluteUrl } from '../lib/api';
import type { Modality } from '../types/api';

/**
 * 产出媒体渲染 (2026-10-20 视频通道落地)。
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
}: {
  url: string;
  modality?: Modality;
  alt: string;
  className?: string;
}) {
  const src = toAbsoluteUrl(url);
  if (modality === 'video') {
    return (
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
  }
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
}

/** 该产出是否是视频 (供调用方决定是否显示时长等信息) */
export function isVideoModality(modality?: Modality): boolean {
  return modality === 'video';
}

/**
 * 由 mime 推导产出模态 (2026-10-20 视频通道落地)。
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
