/** 真实模型通道的共享类型 (gateway ↔ router 之间, 不依赖具体实现) */

/** 单能力路由: auto=网关可用则远程 / local=强制本地 / remote=强制远程 */
export type CapabilityRoute = 'auto' | 'local' | 'remote';

/** 产出来源: gateway=真实模型通道, local=本地 Jimp 算法 */
export type ProduceSource = 'gateway' | 'local';

/** 远程通道返回的结果 (router 转成 ImageProviderResult) */
export interface GatewayResult {
  buffer: Buffer;
  format: string;
  /** 网关任务 id, 便于排查与对账 */
  taskId?: string;
  /** 实际使用的模型 (网关回报时优先用它的) */
  model?: string;
  /** 网关侧记录的提示词, 便于核对我们发了什么 */
  prompt?: string;
}

/** 远程通道不可用 / 出错 (router 捕获后回落本地) */
export class GatewayUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string, detail?: string) {
    super(`网关不可用: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'GatewayUnavailableError';
    this.reason = reason;
  }
}

/**
 * 没有可用的真实模型通道, 且该能力**不允许**交付本地产物。
 *
 * 与 GatewayUnavailableError 的区别: 后者是可降级的一次通道故障 (图像能力回落本地);
 * 本错误是**终局** —— 该能力本地没有实现 (占位算法已于 2026-10-22 全部删除),
 * 除了真实模型没有别的产出路径。
 * 由 generate.service 转成任务失败 `42204` 并退款, 不落任何产出图。
 */
export class NoModelChannelError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`无可用模型通道: ${reason}`);
    this.name = 'NoModelChannelError';
    this.reason = reason;
  }
}

/**
 * 请求带了遮罩, 但当前通道的协议不接受遮罩 (2026-10-22)。
 *
 * ## 为什么单独一个错误类型
 *
 * 遮罩被忽略的下场不是「重绘范围不准」, 而是**整张图被重绘** ——
 * 用户涂的是包装盒, 模型改的是全图。这必须是一次可见的失败, 而不是
 * 一次看起来成功、结果却对不上的交付。
 *
 * 因此它不能与「通道故障」混为一谈:
 *   · 通道故障 → 试下一条通道 / 回落本地;
 *   · 协议不支持 → 该通道无论重试多少次都不会支持, 只能换一条声明了
 *     `maskSupport: 'edits'` 的通道; 全部通道都不支持时判任务失败 `42205` 并退款。
 *
 * 由 generate.service 转成 `42205`, 与 `42204`(没通道) / `42201`(生成异常) 区分。
 */
export class MaskUnsupportedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`通道不支持遮罩重绘: ${reason}`);
    this.name = 'MaskUnsupportedError';
    this.reason = reason;
  }
}
