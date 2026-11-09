import { CircleCheck, CircleDashed, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Card, Meter, StatusTag } from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { PAYMENT_PROVIDER_STATE_META, type PaymentProviderState } from './constants';
import type { AdminPaymentProviderView } from '../../../types/payment';
import { providerState } from './utils';

const STATE_ORDER: readonly PaymentProviderState[] = [
  'usable',
  'misconfigured',
  'unconfigured',
  'disabled',
];

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

/** 渠道状态总览：保留「能不能收款」的结论与分档数量，去掉重复说明。 */
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

  return (
    <Card
      data-testid="admin-provider-summary"
      className={cn(
        'flex flex-row items-center gap-4 rounded-lg border-border bg-card px-4 py-3 shadow-card',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          visual.iconClassName,
        )}
      >
        <visual.Icon className="size-4.5" aria-hidden />
      </span>

      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">收款就绪度</span>
        <span className="text-[24px] leading-7 font-semibold tracking-tight text-foreground tabular-nums">
          {counts.usable}
        </span>
        <span className="text-[12px] text-muted-foreground tabular-nums">/ {total}</span>
      </div>

      <Meter
        value={readiness}
        tone={visual.meterTone}
        decorative
        className="mx-1 h-1.5 flex-1"
      />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {visible.map((state) => {
          const meta = PAYMENT_PROVIDER_STATE_META[state];
          return (
            <StatusTag
              key={state}
              status={state}
              tone={meta.tone}
              label={`${meta.label} ${counts[state]}`}
              showDot={state === 'usable'}
            />
          );
        })}
      </div>
    </Card>
  );
}
