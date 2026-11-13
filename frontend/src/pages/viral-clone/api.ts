/**
 * 爆款复刻工作台页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 商品图 + 参考图 → hot_remake 任务 (inputAssetIds 顺序即上传顺序,
 * 后端保序: [0]=商品图 [1]=参考图); 复刻程度 → degree 参数。
 *
 * 约定: `viral-clone/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 素材上传 / 地址换算 / 生成任务 */
export {
  assetsApi,
  assetSrc,
  assetThumbUrl,
  generateApi,
  newIdempotencyKey,
  toAbsoluteUrl,
} from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `modelKey` */
export { modelImageInputLimit, resolveModel, resolveModelKey } from '../../lib/models';
export type { PublicModelGroup } from '../../lib/models';
