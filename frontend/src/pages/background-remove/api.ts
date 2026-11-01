/**
 * 一键抠图页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 原图 → `matting` 任务; 背景色 (预设 / 自定义 HEX + 不透明度) 由前端
 * 随任务参数提交, 结果在 `MattingResultEditor` 里实时合成预览。
 *
 * 约定: `background-remove/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 素材缩略图地址换算 (上传预览用) */
export { assetThumbUrl } from '../../lib/api';
