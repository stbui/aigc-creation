/**
 * 多图融合页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 主体图 + 搭配图 → 一条 `multi_fusion` 任务;
 * `inputAssetIds` 的顺序即语义 ([0]=主体图, [1..]=搭配图),
 * 后端按提交序保序做融合。「AI 分析」走文本通道的识图接口。
 *
 * 约定: `multi-image-fusion/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 素材上传 / 地址换算 / 生成任务 / 识图工具 */
export {
  assetsApi,
  assetSrc,
  assetThumbUrl,
  generateApi,
  newIdempotencyKey,
  promptToolsApi,
  toAbsoluteUrl,
} from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';
