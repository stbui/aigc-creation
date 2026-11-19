import { Check } from 'lucide-react';
import { PROVIDERS } from './constants';
import type { EmailProvider } from './types';

/**
 * 投递通道选择。
 *
 * 用 `radiogroup` 而不是 Select：每个通道的差别（凭据、发信身份、能否真发）
 * 必须一眼可比，折叠进下拉后运营只会记住自己上次选的那一个。
 */
export function ChannelSelector({
  value,
  onChange,
  disabled,
}: {
  value: EmailProvider;
  onChange: (provider: EmailProvider) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="邮件投递通道"
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
    >
      {PROVIDERS.map((provider) => {
        const Icon = provider.icon;
        const selected = provider.value === value;
        return (
          <button
            key={provider.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(provider.value)}
            className={[
              'group relative flex min-h-[112px] flex-col items-start rounded-lg border p-3 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-ink-950 disabled:cursor-not-allowed disabled:opacity-60',
              selected
                ? 'border-radar-ink-300 bg-accent/60'
                : 'border-border bg-background hover:border-radar-ink-300 hover:bg-muted/30',
            ].join(' ')}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span
                className={[
                  'flex size-8 items-center justify-center rounded-lg',
                  selected ? 'bg-radar-ink-950 text-white' : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              {selected ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-radar-ink-950 text-white">
                  <Check className="size-3" aria-hidden />
                </span>
              ) : (
                <span className="text-xs font-semibold tracking-wider text-muted-foreground">
                  {provider.shortLabel}
                </span>
              )}
            </span>
            <span className="mt-2 text-[13px] font-semibold text-foreground">{provider.label}</span>
            <span className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
              {provider.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
