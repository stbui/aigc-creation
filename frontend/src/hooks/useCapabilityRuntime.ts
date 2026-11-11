import { useCapabilities } from './useCapabilities';
import { runtimeOf } from '../lib/constants';
import type { CapabilityDef, CapabilityRuntime } from '../types/api';

export interface CapabilityRuntimeState {
  def: CapabilityDef | null;
  runtime: CapabilityRuntime | null;
  /** 能力清单是否仍在请求中。加载中不拦截，避免后端响应慢时把按钮误置灰。 */
  loading: boolean;
  /** 已确认不可提交（运营下线，或没有可用模型线路）。 */
  blocked: boolean;
  /** 运营下线的可解释原因；其余不可提交场景不展示提示，由页面按语境兜底。 */
  reason: string | null;
}

/**
 * 单项能力的实时可用性。
 *
 * 专用工作台（商品主图 / 详情图 / 多图融合等）此前各自只读 creditCost，
 * 却忘了像通用工具页那样读取 runtime。结果是一项能力被下线或模型通道
 * 全部不可用时，用户仍能填完表单、点提交，最终等到一次 42204。
 *
 * 这里把判定收口，页面只需要用它控制提交按钮；reason 仅在运营下线时有值。
 */
export function useCapabilityRuntime(capability: string): CapabilityRuntimeState {
  const { data, loading } = useCapabilities();
  const def = data?.items.find((c) => c.id === capability) ?? null;
  const runtime = def ? runtimeOf(def) : null;
  const blocked = Boolean(
    def && runtime && (runtime.effective === 'disabled' || runtime.effective === 'unavailable'),
  );
  /*
   * 不可提交时只置灰按钮，不再渲染提交区提示。运营主动下线时仍透出
   * 后台填写的原因（它面向 C 端编写）；「没有可用线路」属于内部诊断，
   * 已在 `publicCapabilityRuntime` 中清空，这里不再补兜底文案。
   */
  const reason = blocked ? runtime?.reason || null : null;

  return { def, runtime, loading, blocked, reason };
}
