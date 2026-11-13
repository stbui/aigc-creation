import { Power } from 'lucide-react';
import {
  ActionButton,
  Descriptions,
  Notice,
  StatCards,
  StatusTag,
} from '~/admin-ui/primitives';
import { RUNTIME_LABELS } from '../../../lib/constants';
import type { AdminCapabilityControl } from '../../../types/api';
import type { AdminCapabilityModelListView, CapabilityPricingView } from '../../../types/model';
import { DEFAULT_OFFLINE_REASON } from './constants';
import { bindingCanRun, formatUpdatedAt, runtimeTone } from './utils';

/** 能力概览：先回答“现在能不能卖”，再给上下线与当前配置快照。 */
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
  const executable = validBindings.filter(bindingCanRun).length;
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
  const pricingSource = !pricingReadable
    ? '—'
    : pricingPending
      ? '读取中…'
      : pricingFailed
        ? '读取失败'
        : pricing?.configured
          ? '能力售价'
          : pricing
            ? '默认价'
            : '未知';
  const pricingHint = !pricingReadable
    ? '无售价读取权限'
    : pricingPending
      ? '正在读取能力售价'
      : pricingFailed
        ? `读取失败：${pricingError || '未知错误'}`
        : pricing
          ? `${pricing.configured ? '能力售价已配置' : '使用默认价'} · ${pricing.billingMode}${
              pricingError ? ' · 刷新失败，展示上次数据' : ''
            }`
          : '售价未知';

  return (
    <div className="flex flex-col gap-3">
      <StatCards
        columns={4}
        items={[
          {
            key: 'runtime',
            label: '运行结论',
            value: RUNTIME_LABELS[capability.runtime.effective] ?? capability.runtime.effective,
            hint: capability.runtime.reason,
            tone: capability.runtime.effective === 'remote' ? undefined : 'warn',
          },
          {
            key: 'executable',
            label: '可执行商品',
            value: bindingValue(executable),
            hint: bindingHint(
              !bindingsReady
                ? '绑定配置尚未就绪'
                : capability.runtime.remoteAvailable
                  ? `${validBindings.length} 条有效绑定，最终线路以模拟选路为准`
                  : `${validBindings.length} 条有效绑定；运行侧暂不可用，请模拟选路`,
            ),
          },
          {
            key: 'invalid',
            label: '失效绑定',
            value: bindingValue(invalidCount),
            hint: bindingHint(
              !bindingsReady
                ? '绑定配置尚未就绪'
                : invalidCount > 0
                  ? '保存绑定不会自动删除，需显式清理'
                  : '无待清理项',
            ),
            tone: bindingsReady && invalidCount > 0 ? 'danger' : undefined,
          },
          {
            key: 'pricing',
            label: '售价来源',
            value: pricingSource,
            hint: pricingHint,
          },
        ]}
      />

      {capability.runtime.effective !== 'remote' && (
        <Notice tone={capability.runtime.effective === 'disabled' ? 'warn' : 'danger'} title="C 端当前不可提交">
          {capability.runtime.reason}
          {capability.runtime.effective === 'unavailable'
            ? ' 请先检查候选商品、商品状态与能力售价，再用“模拟选路”确认线路。'
            : ' 上线后目录最多 3 秒内刷新；能否恢复承接仍以运行结论与模拟选路为准。已创建任务不受影响。'}
        </Notice>
      )}

      <div className="rounded-lg border border-border bg-card p-4 shadow-card">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-foreground">能力状态</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              下线会让 C 端立即停止提交；价格调整不影响已创建任务。
            </div>
          </div>
          <StatusTag
            status={capability.runtime.effective}
            tone={runtimeTone(capability.runtime.effective)}
            label={RUNTIME_LABELS[capability.runtime.effective] ?? capability.runtime.effective}
          />
        </div>

        <Descriptions
          columns={2}
          items={[
            { label: '能力 ID', value: <span className="font-mono text-xs">{capability.capabilityId}</span> },
            { label: '分组', value: capability.group },
            { label: '运行侧可用线路', value: capability.runtime.remoteAvailable ? '有' : '无' },
            { label: '最后更新', value: formatUpdatedAt(capability.updatedAt) },
            { label: '更新人', value: capability.updatedBy || '—' },
            { label: '下线原因', value: capability.reason || '—' },
          ]}
        />

        {capabilityWritable && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <p className="mr-auto max-w-xl text-xs leading-5 text-muted-foreground">
              {capability.enabled
                ? `下线后 C 端会统一看到：「${DEFAULT_OFFLINE_REASON}」`
                : `当前下线提示：「${capability.reason || DEFAULT_OFFLINE_REASON}」`}
            </p>
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
            <span className="text-xs text-muted-foreground">
              {capability.enabled ? '确认下线后会切到影响面，便于继续核对' : '上线后按当前绑定与售价刷新目录'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
