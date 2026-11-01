import type { TaskStatus } from '../../types/api';

/**
 * 创意生图 / 自由创作工作台页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定: `creative-image/` 下的文件不从 `src/lib/constants` 直接取东西, 一律经由本文件 ——
 * 页面上传上限、字段长度与能力标签集中可见, 调整只改一处。
 * 目录内新增共享常量时在这里补一行 re-export。
 */

/** 单张图片体积上限 (字节 / MB) 与支持格式, 全站上传校验共用 */
export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
} from '../../lib/constants';

// ───────────────── 上传与字段长度 (参考站实拍) ─────────────────

/** 一次提交最多上传的参考图张数 */
export const MAX_REF_IMAGES = 4;
/** 创作提示词输入上限 (textarea maxlength) */
export const MAX_PROMPT_LEN = 4000;

// ───────────────── 能力上下文 ─────────────────

/**
 * 本页支持的两个能力。
 *
 * 页面外观同构, 但提交的任务能力不同 —— `creative_image` 是「创意生图」入口,
 * `free_create` 是「自由创作」入口。能力 id 必须与后端注册表一致。
 */
export type CreationCapability = 'creative_image' | 'free_create';

/** 能力 id → 页面标题 (与后端能力注册表的 name 同口径) */
export const CREATION_CAPABILITY_LABELS: Record<CreationCapability, string> = {
  creative_image: '创意生图',
  free_create: '自由创作',
};

/** 能力 id → 结果下载文件名前缀 */
export const CREATION_DOWNLOAD_PREFIX: Record<CreationCapability, string> = {
  creative_image: 'creative-image',
  free_create: 'free-create',
};

// ───────────────── 页面数据类型 ─────────────────

/** 本页上传区里的素材 (参考图) */
export interface PkAsset {
  id: string;
  url: string;
  name: string;
}

/** 一次创作任务的结果 (只用于失败提示与提交后的即时插卡) */
export interface PkResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}
