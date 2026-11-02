import { generateApi, promptToolsApi } from '../../lib/api';
import type { GenerateResponse, KnownCapability } from '../../types/api';

/**
 * 商品详情图页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 页面只表达「提交什么」; 计费、按模块拆批、批次删除的连带关系都在服务端,
 * 这里不做任何业务推算。
 *
 * 约定: `product-detail/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 通用接口模块 (生成 / 提示词工具) */
export { generateApi, newIdempotencyKey, promptToolsApi } from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';

export const DETAIL_CAPABILITY: KnownCapability = 'detail_image';

/** 一次详情图提交的输入 (已由页面校验 / 归一化) */
export interface DetailGenerationInput {
  projectId: string;
  /** 前台模型 id; 由 `resolveModelId('detail_image')` 解析 */
  logicalModelId: string;
  inputAssetIds: string[];
  productName: string;
  brand: string;
  platform: string;
  language: string;
  description: string;
  /** 已选模块 key, 提交时按逗号拼成 `sections` 参数 */
  sections: string[];
  /** 画质档位 (1k / 2k / 4k) → 任务参数 `size` */
  resolution: string;
  /** 用户提交意图的幂等键；同一次提交的网络重试必须复用 */
  idempotencyKey?: string;
}

/**
 * 提交一次商品详情图生成。
 *
 * 服务端按勾选模块把这次提交拆成 N 个任务 (每张各扣一次单价),
 * 返回 `batchId` / `batchSize` / 本次合计积分。
 */
export function startDetailGeneration(input: DetailGenerationInput): Promise<GenerateResponse> {
  return generateApi.start({
    projectId: input.projectId,
    capability: DETAIL_CAPABILITY,
    logicalModelId: input.logicalModelId,
    inputAssetIds: input.inputAssetIds,
    idempotencyKey: input.idempotencyKey,
    params: {
      productName: input.productName.trim(),
      brand: input.brand.trim(),
      platform: input.platform,
      language: input.language,
      description: input.description.trim(),
      sections: input.sections.join(','),
      size: input.resolution,
    },
  });
}

/**
 * 删除一次生成 —— 只删批次里的父任务。
 *
 * 后端 `removeTask` 删除父任务时会连带删除 `parentTaskId` 指向它的兄弟任务,
 * 所以不需要对每张图各发一次 DELETE: 既避免「删到一半失败」的半套状态,
 * 也不会出现父任务先被删、子任务 404 的噪音。
 */
export function removeDetailGeneration(taskId: string) {
  return generateApi.remove(taskId);
}

/**
 * 「AI分析」—— 走文本通道的「图片转提示词」, 对首张商品图做真实识别。
 *
 * 失败语义: 文本通道没配时后端返回 502, 由页面如实抛给用户;
 * 绝不退回「用文件名拼一段描述」—— 那会让用户以为模型看过图。
 */
export function analyzeImageToPrompt(assetId: string) {
  return promptToolsApi.imageToPrompt(assetId);
}
