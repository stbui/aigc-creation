/**
 * 通用工具页的纯函数与外部工具入口 —— 目录内文件的唯一本页工具来源。
 */

/** 能力定义查询与统一路径映射（兜底路由与独立工作台都用同一份） */
export { capabilityById, toolPath } from '../../lib/capabilities';
/** 上传校验 / 运行时标签 / 任务错误文案 */
export {
  IS_PROD,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
  MODE_LABELS,
  RUNTIME_LABELS,
  runtimeOf,
  taskErrorText,
} from '../../lib/constants';
/** 任务轮询 */
export { waitForTask } from '../../lib/poll';
