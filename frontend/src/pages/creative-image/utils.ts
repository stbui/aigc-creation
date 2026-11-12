import type { CreationCapability } from './constants';

/**
 * 创意生图 / 自由创作工作台页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `creative-image/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的图片校验、轮询与错误文案集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 上传前的图片格式校验与错误码文案 */
export { isSupportedImageFile, taskErrorText } from '../../lib/constants';
/** 任务轮询到终态 */
export { pollToResult } from '../../lib/poll';
/** 缩略图地址换算 */
export { assetThumbUrl } from '../../lib/api';

/**
 * URL 查询参数 → 能力 id。
 *
 * `/creative-image` 路由由 `App.tsx` 直接传入 `creative_image`, 本函数只服务
 * 保留的旧入口 `/free-creation?capability=creative_image` 与 `/free-creation`:
 * 只认白名单值, 未知参数回落到自由创作, 避免把任意串透传给后端。
 */
export function resolveCreationCapability(param: string | null): CreationCapability {
  return param === 'creative_image' ? 'creative_image' : 'free_create';
}
