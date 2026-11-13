import { CircleDashed, ShieldAlert, ShieldCheck } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  Meter,
  StatusTag,
} from '~/admin-ui/primitives';
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
    Icon: CircleDashed,
    iconClassName: 'bg-accent text-accent-foreground',
    meterTone: 'brand' as const,
  },
};

/** 收款来源总览：先给运营「客户现在能不能付款」的结论，再列状态分布。 */
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
  const attention = counts.misconfigured + counts.unconfigured;
  const health =
    counts.misconfigured > 0
      ? 'danger'
      : counts.usable === 0
        ? 'warn'
        : attention === 0
          ? 'success'
          : 'brand';
  const visual = HEALTH_VISUAL[health];
  const conclusion =
    counts.misconfigured > 0
      ? `${attention} 个收款来源需要处理，部分客户付款可能受影响`
      : counts.usable === 0
        ? '当前没有可收款的来源，客户暂时无法完成充值'
        : attention > 0
          ? `客户可以付款，另有 ${attention} 个来源尚未准备完成`
          : '所有收款来源状态正常，客户可以顺畅付款';

  return (
    <Card
      data-testid="admin-provider-summary"
      className={cn(
        'flex h-full flex-col gap-0 rounded-xl border-border bg-card py-0 shadow-card',
        className,
      )}
    >
      <CardHeader className="flex items-start justify-between gap-4 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <CardDescription className="text-[12px] font-medium">
            当前收款状态
          </CardDescription>
          <div className="mt-1.5 flex items-end gap-1.5">
            <span className="text-[32px] leading-9 font-semibold tracking-tight text-foreground tabular-nums">
              {counts.usable}
            </span>
            <span className="pb-1 text-[12px] text-muted-foreground tabular-nums">
              / {total} 个来源可收款
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{conclusion}</p>
        </div>
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            visual.iconClassName,
          )}
        >
          <visual.Icon className="size-5" aria-hidden />
        </span>
      </CardHeader>

      <CardContent className="mt-auto border-t border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
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
          <span className="text-[12px] text-muted-foreground tabular-nums">
            可用占比 {readiness}%
          </span>
        </div>
        <Meter
          value={readiness}
          tone={visual.meterTone}
          decorative
          className="mt-2.5 h-1.5"
        />
      </CardContent>
    </Card>
  );
}
