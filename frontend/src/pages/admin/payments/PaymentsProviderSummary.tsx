import { CircleCheck, CircleDashed, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Card, Meter } from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { PAYMENT_PROVIDER_STATE_META, type PaymentProviderState } from './constants';
import type { AdminPaymentProviderView } from '../../../types/payment';
import { providerState } from './utils';

/**
 * 渠道状态总览。
 *
 * 运营打开页面时的第一个问题是「现在能不能收钱」。这一块先给出整体
 * 就绪度，再把四种运营状态摊开：可用、不可收款、待配置、已停用。
 *
 * 视觉上把「可收款」做成左侧结论，把其他档位做成右侧证据。这样不必
 * 逐张卡片数，也不会让四个同等权重的指标淹没最关键的「当前能否收款」。
 */

const STATE_ORDER: readonly PaymentProviderState[] = [
  'usable',
  'misconfigured',
  'unconfigured',
  'disabled',
];

/** 各档的图标与配色。数字是主角，图标只给这一档一个视觉锚点。 */
const STATE_VISUAL: Record<
  PaymentProviderState,
  { Icon: typeof ShieldCheck; iconClassName: string }
> = {
  usable: {
    Icon: ShieldCheck,
    iconClassName: 'bg-success-soft text-success-text',
  },
  misconfigured: {
    Icon: ShieldAlert,
    iconClassName: 'bg-danger-soft text-danger-text',
  },
  unconfigured: {
    Icon: CircleDashed,
    iconClassName: 'bg-warn-soft text-warn-text',
  },
  disabled: {
    Icon: CircleCheck,
    iconClassName: 'bg-muted text-muted-foreground',
  },
};

const HEALTH_VISUAL = {
  danger: {
    Icon: ShieldAlert,
    iconClassName: 'bg-danger-soft text-danger-text',
    meterTone: 'danger' as const,
  },
  warn: {
    Icon: ShieldAlert,
    iconClassName: 'bg-warn-soft text-warn-text',
    meterTone: 'warn' as const,
  },
  success: {
    Icon: ShieldCheck,
    iconClassName: 'bg-success-soft text-success-text',
    meterTone: 'success' as const,
  },
  brand: {
    Icon: ShieldCheck,
    iconClassName: 'bg-accent text-accent-foreground',
    meterTone: 'brand' as const,
  },
};

export function PaymentsProviderSummary({
  providers,
  className,
}: {
  providers: AdminPaymentProviderView[];
  className?: string;
}) {
  const counts = providers.reduce<Record<PaymentProviderState, number>>(
    (acc, provider) => {
      acc[providerState(provider)] += 1;
      return acc;
    },
    { usable: 0, misconfigured: 0, unconfigured: 0, disabled: 0 },
  );

  /*
   * 零值档位通常不占视觉空间，但「可用 0」是必须暴露的异常信号。
   * 「已停用 0」则只是噪音，因此和原来的口径保持一致。
   */
  const visible = STATE_ORDER.filter(
    (state) => counts[state] > 0 || state === 'usable',
  );

  const total = providers.length;
  const readiness = total > 0 ? Math.round((counts.usable / total) * 100) : 0;
  const health =
    counts.misconfigured > 0
      ? 'danger'
      : counts.usable === 0
        ? 'warn'
        : counts.usable === total
          ? 'success'
          : 'brand';
  const visual = HEALTH_VISUAL[health];

  const hint =
    counts.misconfigured > 0
      ? `${counts.misconfigured} 个渠道已开启但无法收款，请优先处理`
      : counts.usable === 0
        ? '当前没有可收款的渠道，请先补齐配置'
        : counts.usable === total
          ? '全部渠道均已就绪'
          : `还有 ${total - counts.usable} 个渠道尚未就绪`;

  return (
    <Card
      data-testid="admin-provider-summary"
      className={cn(
        'grid grid-cols-[minmax(340px,1.05fr)_minmax(0,1.95fr)] gap-0 overflow-hidden rounded-xl border border-border bg-card py-0 shadow-card',
        className,
      )}
    >
      <div className="flex items-center gap-4 bg-muted/20 px-4 py-4">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            visual.iconClassName,
          )}
        >
          <visual.Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-[11px] font-medium tracking-wide text-muted-foreground">
            <span>收款就绪度</span>
            <span className="tabular-nums">{readiness}%</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] leading-8 font-semibold tracking-tight text-foreground tabular-nums">
              {counts.usable}
            </span>
            <span className="text-[12px] text-muted-foreground">
              / {total} 条渠道可收款
            </span>
          </div>
          <Meter
            value={readiness}
            tone={visual.meterTone}
            decorative
            className="mt-2 h-1.5"
          />
          <p className="mt-2 truncate text-[11px] leading-4 text-muted-foreground" title={hint}>
            {hint}
          </p>
        </div>
      </div>

      <div className="grid auto-cols-fr grid-flow-col">
        {visible.map((state) => {
          const meta = PAYMENT_PROVIDER_STATE_META[state];
          const { Icon, iconClassName } = STATE_VISUAL[state];
          const danger = state === 'misconfigured' && counts[state] > 0;

          return (
            <div
              key={state}
              className={cn(
                'flex min-w-0 flex-col justify-center border-l border-border px-4 py-3 first:border-l-0',
                danger && 'bg-danger-soft/30',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-md',
                    iconClassName,
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="truncate text-[12px] font-medium text-muted-foreground">
                  {meta.label}
                </span>
              </div>
              <div
                data-testid={`admin-provider-count-${state}`}
                className={cn(
                  'mt-2 text-[22px] leading-7 font-semibold tabular-nums',
                  danger ? 'text-danger-text' : 'text-foreground',
                )}
              >
                {counts[state]}
              </div>
              <p
                className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground"
                title={meta.hint}
              >
                {meta.hint}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
