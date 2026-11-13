/**
 * 素材管理的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import { assetThumbUrl, toAbsoluteUrl } from './api';
import type { AssetRow } from './constants';

export { cn } from '../../../admin-ui/lib/cn';

/** 字节 → 人类可读 */
export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** MIME → 展示用格式缩写 */
export function fmtFormat(format: string): string {
  return format ? (format.split('/').pop() ?? format).toUpperCase() : '—';
}

/** 素材展示名：能力名优先，其次按来源区分 */
export function assetLabel(a: AssetRow): string {
  return a.capability ?? (a.kind === 'original' ? '原始上传' : '生成图');
}

/**
 * 生成信息单行摘要：模型 · 比例 · 画质。
 *
 * 网格卡片一行放不下三项时逐项截断由容器负责；缺项直接跳过，
 * 不输出「—」占位 —— 原始上传没有生成信息，显示空串比显示破折号更干净。
 */
export function generationLine(generation: NonNullable<AssetRow['generation']>): string {
  return [generation.modelName, generation.ratio, generation.quality]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 缩略图 URL —— 复用 lib/api 的 toAbsoluteUrl。
 *
 * 不自己拼：本地路径要加 API_BASE，云端签名 URL 要原样透传，
 * 这两条规则已封装在 toAbsoluteUrl，重写一遍必然漂移。
 */
export const thumbOf = (url: string): string => toAbsoluteUrl(url) ?? url;

/** 列表 / 网格用的方形缩略图；查看大图仍用 thumbOf 的完整地址 */
export const thumbSrc = (url: string, size = 320): string => assetThumbUrl(url, size) ?? thumbOf(url);
