/**
 * 单次产出的**实际来源**徽标（2026-10-22）。
 *
 * ## 为什么不能靠能力的 mode 标注
 *
 * `mode`（real/planned）只回答「代码里实现到什么程度」，而同一项能力在不同部署、
 * 不同时刻按下去可能是：
 *
 *   - 云端通道可用   → 真实模型产出（`provider = 'gateway'`）
 *   - 2026-10-25 前的历史任务 → 本地算法产出（`provider = 'local'`）
 *   - 仍在执行       → `provider = 'pending'`（建任务时的初值，跑完会被改写）
 *
 * 新任务只会是 gateway；保留 local 标签是为了如实标识历史记录，
 * 而不是把旧结果伪装成模型产出。徽标一律读 `task.provider`，不读 capability.mode。
 *
 * ## 配色
 *
 * 绿 = 真实模型，琥珀 = 历史本地结果；`pending` 不渲染徽标。
 */

const PROVIDER_LABELS: Record<string, { text: string; tone: 'remote' | 'local'; title: string }> = {
  gateway: {
    text: '真实模型',
    tone: 'remote',
    title: '本次由云端模型通道生成',
  },
  local: {
    text: '历史本地结果',
    tone: 'local',
    title: '这是本地生成算法停用前的历史产出；新任务只使用模型通道',
  },
};

export function ProviderBadge({
  provider,
  className,
}: {
  /** `task.provider` 或轮询结果里的同名字段；空值 / 'pending' 不渲染 */
  provider?: string | null;
  className?: string;
}) {
  const meta = provider ? PROVIDER_LABELS[provider] : undefined;
  if (!meta) return null;
  return (
    <span
      className={`provider-badge is-${meta.tone}${className ? ` ${className}` : ''}`}
      title={meta.title}
    >
      {meta.text}
    </span>
  );
}

/** 徽标文案（需要拼进一行文字、不渲染标签时用） */
export function providerLabel(provider?: string | null): string | null {
  return provider ? (PROVIDER_LABELS[provider]?.text ?? null) : null;
}
