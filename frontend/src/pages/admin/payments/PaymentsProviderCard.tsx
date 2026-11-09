import { Clock, Settings2, ShieldAlert } from 'lucide-react';

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
import { PAYMENT_PROVIDER_STATE_META } from './constants';
import { providerBlockingIssues, providerState } from './utils';

/**
 * 单个支付渠道卡片。
 *
 * 一张卡只回答三个问题：
 *   1. 能不能收钱 —— 状态按「可运营状态」分档，不把开关当状态；
 *   2. 缺什么 / 卡在哪 —— 异常原因直接写在卡片内；
 *   3. 下一步做什么 —— 唯一主动作是配置渠道。
 *
 * 卡片保持紧凑：币种、支付方式、自动关闭与更新时间都是一行可扫读的
 * 辅助信息，不把每个字段都做成带边框的小指标块。异常原因才占用更多
 * 纵向空间，因为它确实需要运营停下来处理。
 */

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

function ProviderIcon({ icon }: { icon: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 text-sm font-semibold',
        PROVIDER_ACCENTS[icon] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {PROVIDER_GLYPHS[icon] ?? '沙'}
    </span>
  );
}

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
  const usable = state === 'usable';
  const danger = state === 'misconfigured';

  /*
   * 阻断原因必须写在**这张卡上**。ZPay 这类渠道的必填项齐全，但缺回调
   * 公网地址，如果只在页面顶部报错，扫卡片的运营会以为它没问题。
   * 「缺必填项」不在这里重复，下面的字段清单已经说清。
   */
  const blocking = providerBlockingIssues(provider).filter(
    (message) => !message.includes('必填项'),
  );

  return (
    <Card
      data-testid="admin-provider-card"
      data-row-key={provider.id}
      data-provider-id={provider.id}
      data-usable={usable ? 'true' : 'false'}
      data-state={state}
      className={cn(
        'h-full gap-0 overflow-hidden rounded-xl border bg-card py-0 shadow-card transition-[border-color,box-shadow] hover:shadow-md',
        danger ? 'border-danger-soft' : 'border-border',
        !usable && !danger && 'bg-muted/10',
      )}
    >
      <CardHeader className="grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 pt-4 pb-3">
        <ProviderIcon icon={provider.icon} />
        <div className="min-w-0">
          <CardTitle className="truncate text-[15px] leading-5 font-semibold">
            {provider.name}
          </CardTitle>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <code className="font-mono">{provider.id}</code>
            <span aria-hidden className="text-border">·</span>
            <span>{provider.supportedCurrencies.join(' / ')}</span>
            {provider.supportsReconciliation && (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                支持对账
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

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-0 pb-4">
        {blocking.length > 0 && (
          <div
            data-testid="admin-provider-blocking"
            className="flex items-start gap-2 rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-danger-text"
          >
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <div className="min-w-0 text-[12px] leading-5">
              <div className="font-medium">当前无法收款</div>
              {blocking.map((message) => (
                <p key={message} className="mt-0.5 opacity-90">
                  {message}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          <span>{provider.closeAfterMinutes} 分钟自动关闭</span>
        </div>

        {provider.hasOpenOrders && (
          <p className="text-[11px] leading-4 text-muted-foreground">
            有未完成订单；保存新版本不影响验签与查单
          </p>
        )}
      </CardContent>

      <CardFooter className="mt-auto justify-end border-t border-border bg-muted/20 px-4 py-2.5">
        <ActionButton
          variant={danger ? 'default' : 'secondary'}
          size="sm"
          icon={Settings2}
          onClick={onConfigure}
          ariaLabel={writable ? `配置${provider.name}` : `查看${provider.name}`}
        >
          {writable ? (danger ? '去处理' : '配置') : '查看'}
        </ActionButton>
      </CardFooter>
    </Card>
  );
}
