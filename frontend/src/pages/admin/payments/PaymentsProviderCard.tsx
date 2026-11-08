import { Settings2 } from 'lucide-react';
import {
  ActionButton,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,
  StatusTag,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import type { AdminPaymentProviderView } from '../../../types/payment';
import { CHECKOUT_MODE_LABELS } from './constants';

/** 渠道图标：内联小方块，避免拉外链图片（后台不该有第三方资源依赖） */
function ProviderIcon({ icon }: { icon: string }) {
  // 品牌图标色用语义 token，不写裸 hex —— 支付宝/微信的品牌色也不进全站令牌表
  const tone =
    icon === 'alipay'
      ? 'bg-brand/10 text-brand'
      : icon === 'wechat'
        ? 'bg-success-soft text-success-text'
        : icon === 'paypal'
          ? 'bg-brand/10 text-brand'
          : icon === 'stripe'
            ? 'bg-brand/10 text-brand'
            : icon === 'epay'
              ? 'bg-warn-soft text-warn-text'
              : icon === 'zpay'
                ? 'bg-brand/10 text-brand'
                : 'bg-muted text-muted-foreground';

  const glyph =
    icon === 'alipay'
      ? '支'
      : icon === 'wechat'
        ? '微'
        : icon === 'paypal'
          ? 'P'
          : icon === 'stripe'
            ? 'S'
            : icon === 'epay'
              ? '易'
              : icon === 'zpay'
                ? 'Z'
                : '沙';

  return (
    <span
      aria-hidden
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${tone}`}
    >
      {glyph}
    </span>
  );
}

function ProviderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2.5 py-2">
      <div className="text-[12px] leading-4 text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[13px] leading-5 font-medium tabular-nums" title={value}>
        {value}
      </div>
    </div>
  );
}

/** 单个支付渠道卡片：身份、可用状态、关键配置与操作入口集中在一屏内。 */
export function PaymentsProviderCard({
  provider,
  writable,
  onConfigure,
}: {
  provider: AdminPaymentProviderView;
  writable: boolean;
  onConfigure: () => void;
}) {
  const usable = provider.enabled && provider.configured;
  const missingText = provider.configured
    ? '凭据已配齐'
    : `缺少 ${provider.missing.length} 项凭据`;

  return (
    <Card
      data-testid="admin-provider-card"
      data-row-key={provider.id}
      data-provider-id={provider.id}
      data-usable={usable ? 'true' : 'false'}
      className={cn(
        'h-full gap-0 overflow-hidden rounded-xl border border-border bg-card py-0 shadow-card transition-shadow hover:shadow-md',
        !usable && 'bg-muted/20',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'h-1 w-full shrink-0',
          usable
            ? 'bg-gradient-to-r from-brand via-brand-light to-brand/30'
            : 'bg-border',
        )}
      />

      <CardHeader className="grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 pt-4 pb-3">
        <ProviderIcon icon={provider.icon} />
        <div className="min-w-0">
          <CardTitle className="truncate text-[15px] leading-5 font-semibold">
            {provider.name}
          </CardTitle>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <code className="font-mono text-[12px] text-muted-foreground">{provider.id}</code>
            <span aria-hidden className="text-border">·</span>
            <span className="text-[12px] text-muted-foreground">
              {provider.supportedCurrencies.join(' / ')}
            </span>
          </div>
        </div>
        <StatusTag
          status={usable ? 'usable' : 'unusable'}
          tone={usable ? 'success' : 'muted'}
          label={usable ? '可用' : '不可用'}
          showDot={usable}
        />
      </CardHeader>

      <CardContent className="px-4 pb-3">
        <div className="grid grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-muted/35">
          <ProviderMetric
            label="支付方式"
            value={CHECKOUT_MODE_LABELS[provider.checkoutMode] ?? provider.checkoutMode}
          />
          <ProviderMetric label="自动关闭" value={`${provider.closeAfterMinutes} 分钟`} />
          <ProviderMetric
            label="配置版本"
            value={provider.version === null ? '未配置' : `v${provider.version}`}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-muted-foreground">
          <span>配置{provider.enabled ? '已启用' : '已停用'}</span>
          <span aria-hidden>·</span>
          <span className={!provider.configured ? 'text-warn-text' : undefined}>{missingText}</span>
        </div>
      </CardContent>

      <Separator />
      <CardFooter className="justify-between gap-3 bg-muted/15 px-4 py-2">
        <span className="truncate text-[12px] text-muted-foreground">
          {provider.supportsReconciliation ? '支持自动对账' : '仅支持手工对账'}
        </span>
        <ActionButton
          variant="secondary"
          size="sm"
          icon={Settings2}
          onClick={onConfigure}
          ariaLabel={writable ? `配置${provider.name}` : `查看${provider.name}`}
        >
          {writable ? '配置' : '查看'}
        </ActionButton>
      </CardFooter>
    </Card>
  );
}
