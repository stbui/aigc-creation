import { Link } from 'react-router-dom';
import { Notice, Panel, StatCards, StatusTag } from '~/admin-ui/primitives';
import type { AdminCapabilityControl } from '../../../types/api';
import type { AdminCapabilityModelListView, CapabilityPricingView } from '../../../types/model';
import { bindingConfigAvailable, capabilityPriceText } from './utils';

/** 影响面：调整商品、改价、下线前，先明确用户与已创建任务会受什么影响。 */
export function ImpactPanel({
  capability,
  bindings,
  bindingsLoading = false,
  bindingsError = null,
  pricing,
  pricingLoading = false,
  pricingError = null,
  bindingsReadable = true,
  pricingReadable = true,
}: {
  capability: AdminCapabilityControl;
  bindings: AdminCapabilityModelListView | null;
  bindingsLoading?: boolean;
  bindingsError?: string | null;
  pricing: CapabilityPricingView | null;
  pricingLoading?: boolean;
  pricingError?: string | null;
  bindingsReadable?: boolean;
  pricingReadable?: boolean;
}) {
  const rows = bindings?.bindings ?? [];
  const configAvailable = rows.filter(bindingConfigAvailable);
  const inactive = rows.filter((row) => !bindingConfigAvailable(row));
  const invalidCount = bindings?.invalidCount ?? 0;
  const bindingsPending = bindingsReadable && bindingsLoading && bindings === null;
  const bindingsFailed =
    bindingsReadable && !bindingsLoading && Boolean(bindingsError) && bindings === null;
  const bindingsReady = bindingsReadable && bindings !== null;
  const bindingValue = (value: number) => {
    if (!bindingsReadable) return '—';
    if (bindingsPending) return '读取中…';
    if (bindingsFailed) return '读取失败';
    if (bindings === null) return '—';
    return value;
  };
  const pricingPending = pricingReadable && pricingLoading && pricing === null;
  const pricingFailed =
    pricingReadable && !pricingLoading && Boolean(pricingError) && pricing === null;
  const runtimeReason = capability.runtime.reason.trim();
  const runtimeSummary =
    capability.runtime.effective === 'remote'
      ? '运行正常，用户可以提交新任务。'
      : capability.runtime.effective === 'unavailable'
        ? '暂不可用。当前没有可用商品，用户暂时不能提交新任务。'
        : runtimeReason
          ? `已下线。下线提示：${/[。！？…]$/.test(runtimeReason) ? runtimeReason : `${runtimeReason}。`}`
          : '已下线。用户暂时不能提交新任务。';

  return (
    <Panel
      title="影响面"
      extra={<span className="text-xs text-muted-foreground">调整前核对影响</span>}
    >
      <div className="flex flex-col gap-3">
        <StatCards
          columns="auto"
          inline
          minWidth={190}
          items={[
            {
              key: 'available',
              label: '可用商品',
              value: bindingValue(configAvailable.length),
            },
            {
              key: 'inactive',
              label: '不可用商品',
              value: bindingValue(inactive.length),
              tone: bindingsReady && inactive.length > 0 ? 'warn' : undefined,
            },
            {
              key: 'invalid',
              label: '失效商品',
              value: bindingValue(invalidCount),
              tone: bindingsReady && invalidCount > 0 ? 'danger' : undefined,
            },
          ]}
        />

        <Notice
          tone={capability.runtime.effective === 'remote' ? 'info' : 'danger'}
          className="mb-0"
        >
          <div className="flex flex-col gap-1.5">
            <div>当前状态：{runtimeSummary}</div>
            <div>
              下线影响：用户立即无法提交新任务，已创建任务继续执行且不会退款。可随时重新上线。
            </div>
            <div>改价影响：只影响新提交的任务，已创建任务仍按原价格结算。</div>
            <div>改商品影响：保存后，新提交的任务使用新商品，已创建任务不受影响。</div>
          </div>
        </Notice>

        {!bindingsReadable && (
          <Notice tone="locked" className="mb-0">
            当前账号没有商品配置查看权限，无法查看商品数量和可用状态。请联系管理员开通后复核。
          </Notice>
        )}

        {bindingsReadable && bindingsError && (
          <Notice tone="warn" className="mb-0">
            {bindings
              ? '商品配置刷新失败，当前展示上次读取结果。请稍后刷新页面重试。'
              : '商品配置读取失败。请稍后刷新页面重试。'}
          </Notice>
        )}

        {bindingsReady && invalidCount > 0 && (
          <Notice tone="warn" className="mb-0">
            另有 {invalidCount} 条失效商品配置，不会用于生成。请到「商品绑定」页确认并清理。
          </Notice>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_100px] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>商品</span>
            <span>供应商</span>
            <span>商品开关</span>
            <span>是否可用</span>
          </div>
          {!bindingsReadable ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              无法查看商品配置
            </div>
          ) : bindingsPending ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              正在读取商品配置…
            </div>
          ) : bindingsFailed ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              商品配置读取失败。请稍后刷新页面重试。
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              还没有配置商品，用户暂时不能提交该能力。请到「商品绑定」页添加。
            </div>
          ) : (
            rows.map((row) => {
              const configAvailable = bindingConfigAvailable(row);
              return (
                <div
                  key={row.channelModelId}
                  className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_100px] items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {row.displayName || row.modelKey}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {row.modelKey}
                    </div>
                  </div>
                  <Link
                    to={`/admin/channels?view=channels&id=${encodeURIComponent(row.channelId)}`}
                    className="truncate text-xs text-brand hover:underline"
                    title="查看供应商"
                  >
                    {row.channelName || row.channelId}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {row.enabled ? '已开启' : '已关闭'}
                  </span>
                  <StatusTag
                    status={configAvailable ? 'impact-ok' : 'impact-blocked'}
                    tone={configAvailable ? 'success' : 'warn'}
                    label={configAvailable ? '可用' : '不可用'}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {!pricingReadable ? (
            '当前售价：当前账号无读取权限'
          ) : pricingPending ? (
            '当前售价：读取中…'
          ) : pricingFailed ? (
            '当前售价读取失败。请稍后刷新页面重试。'
          ) : (
            <>
              当前售价：{capabilityPriceText(pricing)}
              {pricing ? `（${pricing.configured ? '能力售价' : '能力默认价'}）` : ''}。
              {pricingError ? '刷新失败，暂展示上次结果，请稍后刷新页面重试。' : ''}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
