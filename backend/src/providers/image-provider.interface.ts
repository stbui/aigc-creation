// 图像生成 Provider 抽象层 —— **转发层** (2026-10-20 架构重构后)。
//
// 定义已迁至 `unified/unified.provider.ts` (统一模型能力层), 本文件只做
// re-export 转发, 供既有调用点 (generate.service / local-image / 路由器) 继续
// 按原路径 import。
//
// ⚠️ 本文件**不得再定义任何类型** —— 保留两套「图像接口」定义就等于
// 回到本项目反复出现的那类重复 (两个真相源, 改一处另一处静默漂移)。
//
// 改造前的说明 (保留作对照):
//   MVP 使用本地 LocalImageProvider (Jimp) 产出可见结果;
//   后续可插拔真实模型 provider 实现同一接口即可替换。

export type { ImageOutcome, ImageProvider, ProduceSource } from './unified/unified.provider';

/**
 * @deprecated 改用 ImageOutcome (统一模型能力层的正式命名)。
 *
 * 保留别名是为不打断既有引用; 新代码一律用 ImageOutcome。
 */
export type ImageProviderResult = import('./unified/unified.provider').ImageOutcome;
