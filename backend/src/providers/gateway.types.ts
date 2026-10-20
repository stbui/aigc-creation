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
