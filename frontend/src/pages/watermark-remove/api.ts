/**
 * 去除水印页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 原图 + 框选区域合成的遮罩素材 → `remove_watermark` 任务。
 * 遮罩由 `WatermarkMaskEditor` 在提交时才生成透明 PNG，上传成素材后随
 * `maskAssetId` 提交；未生成遮罩则本地拦截，不发任务。
 *
 * 约定: `watermark-remove/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 素材上传 / 缩略图地址换算 */
export { assetsApi, assetThumbUrl } from '../../lib/api';
