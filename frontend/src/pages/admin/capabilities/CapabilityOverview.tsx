import { Power } from 'lucide-react';
import { ActionButton, Notice, StatCards } from '~/admin-ui/primitives';
import type { AdminCapabilityControl } from '../../../types/api';
import type { AdminCapabilityModelListView, CapabilityPricingView } from '../../../types/model';
import { DEFAULT_OFFLINE_REASON } from './constants';
import { bindingCanRun, bindingIssue, capabilityPriceText, formatUpdatedAt } from './utils';

/** 能力概览：先回答“现在能不能卖”，再给出下一步该做什么。 */
export function CapabilityOverview({
  capability,
  bindings,
  bindingsLoading = false,
  bindingsError = null,
  pricing,
  pricingLoading = false,
  pricingError = null,
  bindingsReadable,
  pricingReadable,
  capabilityWritable,
  savingEnabled,
  onToggle,
}: {
  capability: AdminCapabilityControl;
  bindings: AdminCapabilityModelListView | null;
  bindingsLoading?: boolean;
  bindingsError?: string | null;
  pricing: CapabilityPricingView | null;
  pricingLoading?: boolean;
  pricingError?: string | null;
  bindingsReadable: boolean;
  pricingReadable: boolean;
  capabilityWritable: boolean;
  savingEnabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const validBindings = bindings?.bindings ?? [];
  const executable = validBindings.filter(bindingCanRun);
  const blockedCount = validBindings.length - executable.length;
  const invalidCount = bindings?.invalidCount ?? 0;
  const bindingsPending = bindingsReadable && bindingsLoading && bindings === null;
  const bindingsFailed = bindingsReadable && !bindingsLoading && Boolean(bindingsError) && bindings === null;
  const bindingsReady = bindingsReadable && bindings !== null;

  const bindingValue = (value: number) => {
    if (!bindingsReadable) return '—';
    if (bindingsPending) return '读取中…';
    if (bindingsFailed) return '读取失败';
    if (bindings === null) return '—';
    return value;
  };
  const bindingHint = (readyHint: string) => {
    if (!bindingsReadable) return '无绑定读取权限';
    if (bindingsPending) return '正在读取绑定配置';
    if (bindingsFailed) return `读取失败：${bindingsError || '未知错误'}`;
    if (bindingsError) return `${readyHint} · 刷新失败，展示上次数据`;
    return readyHint;
  };

  const pricingPending = pricingReadable && pricingLoading && pricing === null;
  const pricingFailed = pricingReadable && !pricingLoading && Boolean(pricingError) && pricing === null;
  const pricingValue = !pricingReadable
    ? '—'
    : pricingPending
      ? '读取中…'
      : pricingFailed
        ? '读取失败'
        : capabilityPriceText(pricing);
  const pricingHint = !pricingReadable
    ? '无售价读取权限'
    : pricingPending
      ? '正在读取能力售价'
      : pricingFailed
        ? `读取失败：${pricingError || '未知错误'}`
        : pricing
          ? pricing.configured
            ? '能力售价 · 所有线路共用'
            : '能力默认价 · 可在「售价」页配置'
          : '售价未知';

  const blockedHint =
    blockedCount > 0
      ? `${blockedCount} 条因供应商、商品或绑定停用未参与选路`
      : '全部参与选路';

  return (
    <div className="flex flex-col gap-3">
      <StatCards
        columns={4}
        items={[
          {
            key: 'executable',
            label: '可承接线路',
            value: bindingValue(executable.length),
            hint: bindingHint(`共 ${validBindings.length} 条绑定`),
          },
          {
            key: 'bindings',
            label: '绑定商品',
            value: bindingValue(validBindings.length),
            hint: bindingHint(blockedHint),
            tone: bindingsReady && blockedCount > 0 ? 'warn' : undefined,
          },
          {
            key: 'invalid',
            label: '失效绑定',
            value: bindingValue(invalidCount),
            hint: bindingHint(invalidCount > 0 ? '不参与选路，请在「商品绑定」页清理' : '无待清理项'),
            tone: bindingsReady && invalidCount > 0 ? 'danger' : undefined,
          },
          {
            key: 'pricing',
            label: '当前售价',
            value: pricingValue,
            hint: pricingError && pricing ? `${pricingHint} · 刷新失败，展示上次数据` : pricingHint,
          },
        ]}
      />

      {capability.runtime.effective === 'disabled' ? (
        <Notice tone="warn" title="能力已下线，C 端不可提交" className="mb-0">
          {capability.reason || DEFAULT_OFFLINE_REASON}
          {' '}重新上线后，请在「商品绑定」页模拟选路，确认线路可以承接再放量。
        </Notice>
      ) : capability.runtime.effective === 'unavailable' ? (
        <Notice tone="danger" title="暂不可承接请求" className="mb-0">
          当前没有可执行的模型线路。请到「商品绑定」页启用商品与供应商，再用「模拟选路」确认。
        </Notice>
      ) : (
        <Notice tone="success" title="运行正常，C 端可正常提交" className="mb-0">
          调整绑定后请用「模拟选路」确认线路；改价只影响后续请求，已创建任务按原账单结算。
        </Notice>
      )}

      {bindingsReady && invalidCount > 0 && (
        <Notice tone="warn" className="mb-0">
          有 {invalidCount} 条绑定指向已删除或不存在的商品，已排除在选路之外。请到「商品绑定」页确认后清理。
        </Notice>
      )}

      {bindingsReady && blockedCount > 0 && (
        <Notice tone="warn" className="mb-0">
          {validBindings
            .filter((row) => !bindingCanRun(row))
            .slice(0, 3)
            .map((row) => `${row.displayName || row.modelKey}：${bindingIssue(row)}`)
            .join('；')}
          {blockedCount > 3 ? ` 等 ${blockedCount} 条` : ''}
          。请到「商品绑定」页处理后再模拟选路。
        </Notice>
      )}

      <div className="rounded-lg border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">能力开关</div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {capability.enabled
                ? '下线后 C 端立即停止提交，已创建任务不受影响。'
                : `当前下线提示：「${capability.reason || DEFAULT_OFFLINE_REASON}」`}
            </p>
            {capability.updatedAt && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                最近调整 {formatUpdatedAt(capability.updatedAt)}
                {capability.updatedBy ? ` · ${capability.updatedBy}` : ''}
              </p>
            )}
          </div>
          {capabilityWritable ? (
            <ActionButton
              variant={capability.enabled ? 'ghost' : 'default'}
              size="sm"
              icon={Power}
              disabled={savingEnabled}
              className={capability.enabled ? 'text-danger-text hover:text-danger-text' : undefined}
              onClick={() => onToggle(!capability.enabled)}
            >
              {savingEnabled ? '保存中…' : capability.enabled ? '下线能力' : '上线能力'}
            </ActionButton>
          ) : (
            <span className="text-xs text-muted-foreground">当前账号无上下线权限</span>
          )}
        </div>
      </div>
    </div>
  );
}
