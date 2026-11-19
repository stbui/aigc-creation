import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';

/** 通用小徽章：圆角药丸 + 浅底 + 中深文字。 */
export function RadarBadge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[12px] leading-4 font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* 形态（kind）语义色：好价/开源/新闻/资讯各自浅底。 */
const KIND_STYLE: Record<string, string> = {
  deal: 'bg-radar-code-subtle text-radar-code',
  opensource: 'bg-radar-deal-subtle text-radar-deal',
  news: 'bg-radar-alert-subtle text-radar-alert',
  info: 'bg-radar-ink-100 text-radar-ink-700',
};
const KIND_LABEL: Record<string, string> = {
  freebie: '福利',
  deal: '好价',
  opensource: '开源',
  news: '新闻',
  info: '资讯',
};

/** 形态徽章：免费/噪音不显示；颜色即语义。 */
export function KindBadge({ kind }: { kind?: string | null }) {
  if (!kind || kind === 'freebie' || kind === 'noise') return null;
  const label = KIND_LABEL[kind];
  if (!label) return null;
  return (
    <RadarBadge className={KIND_STYLE[kind] ?? 'bg-radar-ink-100 text-radar-ink-600'}>
      {label}
    </RadarBadge>
  );
}

/* 获取方式（obtain）语义色：free 不显示，其余标出避免混入「白嫖」。 */
const OBTAIN_STYLE: Record<string, string> = {
  conditional: 'bg-radar-code-subtle text-radar-code',
  lottery: 'bg-radar-brand-subtle text-radar-accent',
  trial: 'bg-radar-ink-100 text-radar-ink-700',
  promo: 'bg-radar-ink-100 text-radar-ink-600',
  paid: 'bg-radar-ink-100 text-radar-ink-600',
};
const OBTAIN_LABEL: Record<string, string> = {
  free: '免费',
  conditional: '有条件',
  lottery: '抽奖',
  trial: '试用',
  promo: '推广',
  paid: '付费',
};

export function ObtainBadge({ obtain }: { obtain?: string | null }) {
  const mode = obtain ?? 'free';
  if (mode === 'free') return null;
  return (
    <RadarBadge className={OBTAIN_STYLE[mode] ?? OBTAIN_STYLE.promo}>
      {OBTAIN_LABEL[mode] ?? mode}
    </RadarBadge>
  );
}

/** 评分徽章：≥70 绿 / ≥45 深灰 / 其余 浅灰；等宽数字对齐。 */
export function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? 'text-radar-deal'
      : score >= 45
        ? 'text-radar-ink-700'
        : 'text-radar-ink-400';
  return (
    <span className={cn('font-mono text-[12px] font-semibold tabular-nums', color)}>
      {Math.round(score)}
    </span>
  );
}

/** 兑换码胶囊：点击复制 + 1400ms “已复制” 反馈（参考 freebie-radar CodeChip）。 */
export function CodeChip({
  code,
  onCopy,
}: {
  code: string;
  onCopy: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCopy(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        'inline-flex max-w-[46vw] items-center gap-1 truncate rounded px-2 py-1 font-mono text-[12px] leading-4 font-semibold transition-colors sm:max-w-none',
        copied
          ? 'bg-radar-deal-subtle text-radar-deal'
          : 'bg-radar-code-subtle text-radar-code hover:bg-radar-code-subtle/70',
      )}
      title="点击复制兑换码"
      aria-label={`复制兑换码 ${code}`}
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {code}
    </button>
  );
}
