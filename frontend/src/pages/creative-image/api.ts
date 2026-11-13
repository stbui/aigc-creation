/**
 * 创意生图 / 自由创作工作台页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 参考图 (0~4 张, 顺序保留) + 提示词 → 本页能力任务 (参考图选填);
 * 比例/画质 → ratio / size 参数。页面只表达「提交什么」, 扣费与退款在服务端。
 *
 * 约定: `creative-image/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 素材上传 / 地址换算 / 生成任务 */
export { assetsApi, assetSrc, generateApi, newIdempotencyKey, toAbsoluteUrl } from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `modelKey` */
export { resolveModelKey } from '../../lib/models';
