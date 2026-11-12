/**
 * 手机上传页面的常量与类型 —— 目录内文件的唯一常量入口。
 */

export const MOBILE_UPLOAD_META = {
  title: '手机上传 · 货觉AI',
  description: '扫码后从手机选择图片并回传到电脑端参考图位。',
} as const;

/** 一次最多上传张数 —— 与后端一致 */
export const MAX_FILES = 9;
/** 整批上限 —— 与后端一致 */
export const MAX_TOTAL_MB = 60;
export const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;
/** 压缩后的最长边 (像素) */
export const MAX_EDGE = 1600;
/** 压缩后的 JPEG 质量 */
export const QUALITY = 0.85;

export type Phase = 'pick' | 'uploading' | 'success' | 'error';

export interface Picked {
  file: File;
  url: string;
  /** 压缩后的大小 (字节); 未压缩时为原大小 */
  size: number;
  /** 是否被压缩过 */
  compressed: boolean;
  /** 压缩到的最长边 */
  edge?: number;
}
