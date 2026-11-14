/**
 * 自由创作工作台页面的常量 —— 目录内文件的唯一常量入口。
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

/** 提示词输入框与放大编辑共用同一份占位文案，避免两处漂移 */
export const CREATION_PROMPT_PLACEHOLDER =
  '例如：把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感';

// ───────────────── 能力上下文 ─────────────────

/**
 * 本页唯一能力。
 *
 * 2026-11-14: 「创意生图」(creative_image / /creative-image) 与「自由创作」
 * (free_create / /free-creation) 合并为同一功能，只保留 free_create 与
 * /free-creation。能力 id 必须与后端注册表一致。
 */
export const CREATION_CAPABILITY = 'free_create';
/** 页面标题 (与后端能力注册表的 name 同口径) */
export const CREATION_CAPABILITY_LABEL = '自由创作';
/** 结果下载文件名前缀 */
export const CREATION_DOWNLOAD_PREFIX = 'free-create';
