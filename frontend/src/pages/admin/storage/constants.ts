/**
 * AdminStoragePage 的本地常量与类型。
 */

import { Cloud, HardDrive, Server } from 'lucide-react';
import type { StorageBackendId } from '../../../types/api';

export const META: Record<
  StorageBackendId,
  { label: string; desc: string; icon: typeof HardDrive; envKeys: string[] }
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
      'OSS_ENDPOINT(可选)',
    ],
  },
  minio: {
    label: 'MinIO',
    desc: 'S3 兼容对象存储，自建或用云厂商的兼容服务',
    icon: Server,
    envKeys: [
      'MINIO_ENDPOINT',
      'MINIO_PORT',
      'MINIO_ACCESS_KEY',
      'MINIO_SECRET_KEY',
      'MINIO_BUCKET',
    ],
  },
};
