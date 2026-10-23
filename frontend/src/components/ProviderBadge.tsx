/**
 * 单次产出的**实际来源**徽标（2026-10-22）。
 *
 * ## 为什么不能靠能力的 mode 标注
 *
 * `mode`（real/planned）只回答「代码里实现到什么程度」，而同一项能力在不同部署、
 * 不同时刻按下去可能走三条完全不同的路：
 *
 *   - 云端通道可用   → 真实模型产出（`provider = 'gateway'`）
 *   - 云端不可用回落 → 本地真实算法产出（`provider = 'local'`）
 *   - 仍在执行       → `provider = 'pending'`（建任务时的初值，跑完会被改写）
 *
 * 若结果卡只按 mode 标「已接入」，用户在网关故障那天会拿到本地算法的图，
 * 却以为是模型产出 —— 等于用假效果冒充模型能力。故徽标一律读
 * `task.provider`（或轮询结果里的同名字段），**不读 capability.mode**。
 *
 * ## 配色
 *
 * 绿 = 真实模型，琥珀 = 本地算法。两档都断言"产出是真的"，只是来源不同；
 * 真正需要警惕的是 `pending`（还没有结果），此时不渲染徽标。
 */

const PROVIDER_LABELS: Record<string, { text: string; tone: 'remote' | 'local'; title: string }> = {
  gateway: {
    text: '真实模型',
    tone: 'remote',
    title: '本次由云端模型通道生成',
  },
  local: {
    text: '本地算法',
    tone: 'local',
    title: '本次由本地算法生成（云端通道不可用或该能力已配置为本地）',
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
