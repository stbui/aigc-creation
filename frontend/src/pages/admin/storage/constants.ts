/**
 * AdminStoragePage 的本地常量与类型。
 */

import { Cloud, HardDrive, Server } from 'lucide-react';
import type { StorageBackendId } from '../../../types/api';

/** 固定展示顺序：与 STORAGE_BACKENDS 一致，避免接口返回顺序决定版面 */
export const BACKEND_ORDER: StorageBackendId[] = ['local', 'oss', 'minio'];

/** Asset.kind → 中文。未知值原样显示，不静默丢弃 */
export const KIND_LABEL: Record<string, string> = {
  original: '上传原图',
  generated: 'AI 产出',
};

export const KIND_ORDER = ['original', 'generated'];

/**
 * envKeys 必须与 `StorageService.requiredEnv` 逐项对齐：列了有默认值的项会让
 * 运营以为必须配，漏了必填项则配完仍显示未启用。两者改一处就要改另一处。
 */
export const META: Record<
  StorageBackendId,
  {
    label: string;
    desc: string;
    icon: typeof HardDrive;
    envKeys: string[];
    /** 有默认值 / 可选的项，单独分组展示 */
    optionalKeys?: string[];
    /** 切换前需手工安装的 SDK（刻意不进 package.json） */
    sdk?: string;
  }
> = {
  local: {
    label: '本地磁盘',
    desc: '文件存于 backend/uploads/，由静态服务提供访问',
    icon: HardDrive,
    envKeys: ['STORAGE_BACKEND=local'],
  },
  oss: {
    label: '阿里云 OSS',
    desc: '对象存储，私有读 + 签名 URL 访问',
    icon: Cloud,
    envKeys: [
      'OSS_REGION',
      'OSS_BUCKET',
      'OSS_ACCESS_KEY_ID',
      'OSS_ACCESS_KEY_SECRET',
    ],
    optionalKeys: ['OSS_ENDPOINT'],
    sdk: 'npm --prefix backend install --no-save ali-oss',
  },
  minio: {
    label: 'MinIO',
    desc: 'S3 兼容对象存储，自建或用云厂商的兼容服务',
    icon: Server,
    envKeys: ['MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'],
    optionalKeys: ['MINIO_PORT=9000', 'MINIO_USE_SSL=false', 'MINIO_BUCKET=huojue'],
    sdk: 'npm --prefix backend install --no-save minio',
  },
};
