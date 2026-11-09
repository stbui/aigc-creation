import { ListChecks, Settings2, ShieldAlert } from 'lucide-react';

import {
  ActionButton,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  StatusTag,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import type { AdminPaymentProviderView } from '../../../types/payment';
import {
  PAYMENT_PROVIDER_STATE_META,
  type PaymentProviderState,
} from './constants';
import {
  enabledInstanceCount,
  providerBlockingIssues,
  providerState,
  usableInstanceCount,
} from './utils';

/** 渠道图标：内联小方块，避免拉外链图片（后台不该有第三方资源依赖） */
const PROVIDER_ACCENTS: Record<string, string> = {
  alipay: 'bg-brand/10 text-brand',
  wechat: 'bg-success-soft text-success-text',
  epay: 'bg-warn-soft text-warn-text',
};

const PROVIDER_GLYPHS: Record<string, string> = {
  alipay: '支',
  wechat: '微',
  paypal: 'P',
  stripe: 'S',
  epay: '易',
  zpay: 'Z',
};

/** 卡片顶边只做状态锚点，颜色仍由统一的语义令牌控制。 */
const STATE_ACCENTS: Record<PaymentProviderState, string> = {
  usable: 'from-success-text via-success-text/50 to-transparent',
  misconfigured: 'from-danger-text via-danger-text/50 to-transparent',
  unconfigured: 'from-warn-text via-warn-text/50 to-transparent',
  disabled: 'from-border via-border/70 to-transparent',
};

function ProviderIcon({ icon }: { icon: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 text-[13px] font-semibold',
        PROVIDER_ACCENTS[icon] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {PROVIDER_GLYPHS[icon] ?? '沙'}
    </span>
  );
}

/**
 * 单个支付渠道卡片。
 *
 * 双列卡片只承载运营扫读所需的信息：渠道身份、是否可收款、基础参数与
 * 阻断原因。动作收在卡片底部，避免每张卡都出现一块厚重按钮区。
 */
export function PaymentsProviderCard({
  provider,
  writable,
  onConfigure,
}: {
  provider: AdminPaymentProviderView;
  writable: boolean;
  onConfigure: () => void;
}) {
  const state = providerState(provider);
  const meta = PAYMENT_PROVIDER_STATE_META[state];
  const danger = state === 'misconfigured';
  const usable = state === 'usable';
  const blocking = providerBlockingIssues(provider);
  const fullMessage = blocking.join('；');
  const summary = blocking[0]?.split(/[：:]/, 1)[0];
  const totalInstances = provider.instances.length;
  const enabledInstances = enabledInstanceCount(provider);
  const usableInstances = usableInstanceCount(provider);

  return (
    <Card
      data-testid="admin-provider-card"
      data-row-key={provider.id}
      data-provider-id={provider.id}
      data-usable={usable ? 'true' : 'false'}
      data-state={state}
      data-instance-count={totalInstances}
      data-enabled-instance-count={enabledInstances}
      data-usable-instance-count={usableInstances}
      className={cn(
        'group relative h-full min-h-[146px] gap-0 overflow-hidden rounded-xl border bg-card py-0 shadow-card transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        danger
          ? 'border-danger-soft bg-danger-soft/10 hover:border-danger-text/25'
          : 'border-border hover:border-primary/20',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r',
          STATE_ACCENTS[state],
        )}
      />

      <CardHeader className="grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 pt-4 pb-3">
        <ProviderIcon icon={provider.icon} />
        <div className="min-w-0">
          <CardTitle className="truncate text-[15px] leading-5 font-semibold">
            {provider.name}
          </CardTitle>
          <code className="mt-1 block truncate font-mono text-[12px] leading-4 text-muted-foreground">
            {provider.id}
          </code>
        </div>
        <StatusTag
          status={state}
          tone={meta.tone}
          label={meta.label}
          showDot={usable}
        />
      </CardHeader>

      <CardContent className="px-4 pb-0">
        <div className="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60">
          <div className="min-w-0 py-2.5 pr-3">
            <div className="text-[12px] leading-4 text-muted-foreground">实例总数</div>
            <div className="mt-0.5 truncate text-[13px] leading-4 font-semibold text-foreground tabular-nums">
              {totalInstances} 个
            </div>
          </div>
          <div className="min-w-0 px-3 py-2.5">
            <div className="text-[12px] leading-4 text-muted-foreground">已启用</div>
            <div className="mt-0.5 truncate text-[13px] leading-4 font-semibold text-foreground tabular-nums">
              {enabledInstances} 个
            </div>
          </div>
          <div className="min-w-0 py-2.5 pl-3">
            <div className="text-[12px] leading-4 text-muted-foreground">可用实例</div>
            <div className="mt-0.5 truncate text-[13px] leading-4 font-semibold text-foreground tabular-nums">
              {usableInstances} 个
            </div>
          </div>
        </div>

        {blocking.length > 0 && (
          <div className="flex min-w-0 items-start gap-1.5 py-2.5 text-danger-text">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="truncate text-[12px] leading-5" title={fullMessage}>
              {summary}
            </span>
          </div>
        )}
      </CardContent>

      <CardFooter className="mt-auto flex items-center justify-between gap-3 px-4 pt-2 pb-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <span className="truncate">支持 {provider.supportedCurrencies.join(' / ')}</span>
          {provider.supportsReconciliation && (
            <span className="flex items-center gap-1.5">
              <ListChecks className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
              自动对账
            </span>
          )}
        </span>
        <ActionButton
          variant="ghost"
          size="xs"
          icon={Settings2}
          onClick={onConfigure}
          ariaLabel={
            writable
              ? `管理${provider.name}的服务商实例`
              : `查看${provider.name}的服务商实例`
          }
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {writable ? '管理实例' : '查看实例'}
        </ActionButton>
      </CardFooter>
    </Card>
  );
}
