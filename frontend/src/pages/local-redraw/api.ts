/**
 * 局部重绘页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 原图 + 遮罩素材 + 标注描述 → `local_redraw` 任务; 遮罩由
 * `MaskPainter.toBlob()` 上传成素材后随 `maskAssetId` 提交。
 *
 * 约定: `local-redraw/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件转出 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 素材上传 / 地址换算 / 生成任务 */
export { assetsApi, assetSrc, assetThumbUrl, generateApi } from '../../lib/api';
