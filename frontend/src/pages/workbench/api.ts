/**
 * 工作台页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 统计总览 / 素材缩略图地址。
 *
 * 约定: `workbench/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件转出 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

export { assetThumbUrl, statsApi } from '../../lib/api';
