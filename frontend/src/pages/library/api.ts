/**
 * 素材库页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 约定: `library/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件转出 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 */

/** 素材上传 / 列表 / 删除 */
export { assetsApi } from '../../lib/api';
/** 素材地址换算 (原图 / 缩略图) */
export { assetSrc, assetThumbSrc } from '../../lib/api';
/** 项目列表: 按项目分组时把 id 换成可读名称 */
export { projectsApi } from '../../lib/api';
