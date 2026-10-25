import { useCapabilities } from './useCapabilities';
import { runtimeOf } from '../lib/constants';
import type { CapabilityDef, CapabilityRuntime } from '../types/api';

export interface CapabilityRuntimeState {
  def: CapabilityDef | null;
  runtime: CapabilityRuntime | null;
  /** 能力清单是否仍在请求中。加载中不拦截，避免后端响应慢时把按钮误置灰。 */
  loading: boolean;
  /** 已确认不可提交（运营下线，或没有本地实现且没有可用模型通道）。 */
  blocked: boolean;
  /** 对用户可解释的不可用原因；可提交时为 null。 */
  reason: string | null;
}

/**
 * 单项能力的实时可用性。
 *
 * 专用工作台（商品主图 / 详情图 / 多图融合等）此前各自只读 creditCost，
 * 却忘了像通用工具页那样读取 runtime。结果是一项能力被下线或模型通道
 * 全部不可用时，用户仍能填完表单、点提交，最终等到一次 42204。
 *
 * 这里把判定收口，页面只需要用它控制提交按钮并展示 reason。
 */
export function useCapabilityRuntime(capability: string): CapabilityRuntimeState {
  const { data, loading } = useCapabilities();
  const def = data?.items.find((c) => c.id === capability) ?? null;
  const runtime = def ? runtimeOf(def) : null;
  const blocked = Boolean(
    def && runtime && (runtime.effective === 'disabled' || runtime.effective === 'unavailable'),
  );
  const reason = blocked
    ? runtime?.reason ||
      (runtime?.effective === 'disabled'
        ? '该能力已下线，暂时不能提交。'
        : '该能力暂无可用模型通道，暂时不能提交。')
    : null;

  return { def, runtime, loading, blocked, reason };
}
