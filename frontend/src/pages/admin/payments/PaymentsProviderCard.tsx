import { ChevronRight, ListChecks, ShieldAlert } from 'lucide-react';

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
  instanceState,
  providerBlockingIssues,
  providerState,
  usableInstanceCount,
} from './utils';

/** 来源图标：内联小方块，避免拉外链图片（后台不该有第三方资源依赖） */
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

const STATE_ACCENTS: Record<PaymentProviderState, string> = {
  usable: 'from-success-text via-success-text/50 to-transparent',
  misconfigured: 'from-danger-text via-danger-text/50 to-transparent',
  unconfigured: 'from-warn-text via-warn-text/50 to-transparent',
  disabled: 'from-border via-border/70 to-transparent',
};

const STATE_STORY: Record<PaymentProviderState, string> = {
  usable: '客户可以正常付款，系统会优先使用可用通道。',
  misconfigured: '已有付款受到影响，请尽快处理报错通道。',
  unconfigured: '收款准备尚未完成，当前不会承接客户付款。',
  disabled: '已停止承接新付款，历史交易不受影响。',
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
 * 单个收款来源卡片。
 *
 * 卡片先回答「客户能不能付款」「还有多少通道要处理」，把实例 ID、版本号等
 * 技术细节收进「查看并调整」，避免运营在一屏里读配置参数。
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
  const usableInstances = usableInstanceCount(provider);
  const attentionInstances = provider.instances.filter((instance) => {
    const instanceStatus = instanceState(instance);
    return instanceStatus === 'misconfigured' || instanceStatus === 'unconfigured';
  }).length;

  return (
    <Card
      data-testid="admin-provider-card"
      data-row-key={provider.id}
      data-provider-id={provider.id}
      data-usable={usable ? 'true' : 'false'}
      data-state={state}
      data-instance-count={totalInstances}
      data-enabled-instance-count={provider.instances.filter((instance) => instance.enabled).length}
      data-usable-instance-count={usableInstances}
      className={cn(
        'group relative h-full min-h-[184px] gap-0 overflow-hidden rounded-xl border bg-card py-0 shadow-card transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg',
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
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span className="truncate">支持 {provider.supportedCurrencies.join(' / ')}</span>
            {provider.supportsReconciliation && (
              <span className="flex items-center gap-1">
                <ListChecks className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
                自动核对
              </span>
            )}
          </div>
        </div>
        <StatusTag
          status={state}
          tone={meta.tone}
          label={meta.label}
          showDot={usable}
        />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-4 pb-2">
        <p className="m-0 text-[12px] leading-5 text-muted-foreground">
          {STATE_STORY[state]}
        </p>

        <div className="mt-3 grid grid-cols-2 divide-x divide-border/60 rounded-lg border border-border/60 bg-muted/20">
          <div className="min-w-0 px-3 py-2.5">
            <div className="text-[12px] leading-4 text-muted-foreground">可用通道</div>
            <div className="mt-0.5 truncate text-[14px] leading-5 font-semibold text-foreground tabular-nums">
              {usableInstances}
              <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                / {totalInstances} 条
              </span>
            </div>
          </div>
          <div className="min-w-0 px-3 py-2.5">
            <div className="text-[12px] leading-4 text-muted-foreground">需要处理</div>
            <div
              className={cn(
                'mt-0.5 truncate text-[14px] leading-5 font-semibold tabular-nums',
                attentionInstances > 0 ? 'text-danger-text' : 'text-foreground',
              )}
            >
              {attentionInstances}
              <span className="ml-1 text-[12px] font-normal text-muted-foreground">条通道</span>
            </div>
          </div>
        </div>

        {blocking.length > 0 && (
          <div className="mt-2 flex min-w-0 items-start gap-1.5 text-danger-text">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="truncate text-[12px] leading-5" title={fullMessage}>
              {summary}
            </span>
          </div>
        )}
      </CardContent>

      <CardFooter className="mt-auto flex items-center justify-end gap-3 px-4 pt-2 pb-3">
        <ActionButton
          variant="ghost"
          size="xs"
          icon={ChevronRight}
          onClick={onConfigure}
          ariaLabel={
            writable
              ? `查看并调整${provider.name}收款来源`
              : `查看${provider.name}收款来源`
          }
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {writable ? '查看并调整' : '查看详情'}
        </ActionButton>
      </CardFooter>
    </Card>
  );
}
