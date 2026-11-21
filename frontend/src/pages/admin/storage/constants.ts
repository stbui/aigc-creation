/**
 * 存储配置的选项表与后端元信息。
 *
 * 本目录派生的类型统一从 `./types` 取；此处只放常量与选项表，不放函数 / 请求 / 组件。
 */

import { Cloud, HardDrive, Server } from 'lucide-react';
import type { StorageBackendId } from './types';

/** 固定展示顺序：与 STORAGE_BACKENDS 一致，避免接口返回顺序决定版面 */
export const BACKEND_ORDER: StorageBackendId[] = ['local', 'oss', 'minio'];

/** Asset.kind → 中文。未知值原样显示，不静默丢弃 */
export const KIND_LABEL: Record<string, string> = {
  original: '上传原图',
  generated: 'AI 产出',
};

export const KIND_ORDER = ['original', 'generated'];

/**
 * SDK 命令属于部署期依赖；连接参数和凭据统一由后端字段定义驱动，保存在数据库。
 */
export const META: Record<
  StorageBackendId,
  {
    label: string;
    desc: string;
    icon: typeof HardDrive;
    /** 切换前需手工安装的 SDK（刻意不进 package.json） */
    sdk?: string;
  }
> = {
  local: {
    label: '本地磁盘',
    desc: '文件存于 backend/uploads/，可配置对外访问地址',
    icon: HardDrive,
  },
  oss: {
    label: '阿里云 OSS',
    desc: '对象存储，私有读 + 签名 URL；支持 CDN 域名与路径前缀',
    icon: Cloud,
    sdk: 'npm --prefix backend install --no-save ali-oss',
  },
  minio: {
    label: 'MinIO',
    desc: 'S3 兼容对象存储，支持自建或云厂商兼容服务',
    icon: Server,
    sdk: 'npm --prefix backend install --no-save minio',
  },
};
