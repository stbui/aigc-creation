import { Check } from 'lucide-react';

/**
 * 底部居中 Toast（参考 freebie-radar）。
 * 受控组件：message 为 null 时不渲染；由调用方用计时器清空。
 */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="radar-toast-enter fixed bottom-6 left-1/2 z-[1200] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-radar-ink-700 bg-radar-ink-950 px-3.5 py-2 text-[12.5px] font-medium text-white"
    >
      <Check className="h-3.5 w-3.5 text-radar-deal" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
