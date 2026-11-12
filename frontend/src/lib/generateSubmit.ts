import { ApiError } from './api';

/**
 * `POST /generate` 的失败是否「结果不明」。
 *
 * 一次提交只发一个请求，服务端在**同一事务**里建任务 + 建账 + 预留：
 *   · 4xx 是扣费前的确定性拒绝（参数 / 权益 / 余额），不可能留下任务；
 *   · 5xx 与 fetch 网络中断时，请求可能已经到达服务端并落库，
 *     只能提示用户先核对生成记录，并在重试时复用幂等键。
 *
 * 多张能力（带货图文 / 写真模板）共用这一份判定，避免两页对同一错误
 * 给出不同语义。
 */
export function isUncertainSubmitError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}
