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
  pricing,
  bindingsReadable,
  pricingReadable,
  capabilityWritable,
  savingEnabled,
  onToggle,
}: {
  capability: AdminCapabilityControl;
  bindings: AdminCapabilityModelListView | null;
  pricing: CapabilityPricingView | null;
  bindingsReadable: boolean;
  pricingReadable: boolean;
  capabilityWritable: boolean;
  savingEnabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const validBindings = bindings?.bindings ?? [];
  const executable = validBindings.filter(bindingCanRun).length;
  const invalidCount = bindings?.invalidCount ?? 0;
  const pricingHint = pricing
    ? pricing.configured
      ? `能力售价已配置 · ${pricing.billingMode}`
      : `使用默认价 · ${pricing.billingMode}`
    : '售价读取中…';

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
            value: bindingsReadable ? executable : '—',
            hint: bindingsReadable
              ? capability.runtime.remoteAvailable
                ? `${validBindings.length} 条有效绑定，最终线路以模拟选路为准`
                : `${validBindings.length} 条有效绑定；运行侧暂不可用，请模拟选路`
              : '无绑定读取权限',
          },
          {
            key: 'invalid',
            label: '失效绑定',
            value: bindingsReadable ? invalidCount : '—',
            hint: bindingsReadable
              ? invalidCount > 0
                ? '保存绑定不会自动删除，需显式清理'
                : '无待清理项'
              : '无绑定读取权限',
            tone: bindingsReadable && invalidCount > 0 ? 'danger' : undefined,
          },
          {
            key: 'pricing',
            label: '售价来源',
            value: pricingReadable ? (pricing?.configured ? '能力售价' : '默认价') : '—',
            hint: pricingReadable ? pricingHint : '无售价读取权限',
          },
        ]}
      />

      {capability.runtime.effective !== 'remote' && (
        <Notice tone={capability.runtime.effective === 'disabled' ? 'warn' : 'danger'} title="C 端当前不可提交">
          {capability.runtime.reason}
          {capability.runtime.effective === 'unavailable'
            ? ' 请先补齐候选商品、商品状态与售价，再用“模拟选路”确认线路。'
            : ' 上线后最多 3 秒恢复；已创建任务不受影响。'}
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
              {capability.enabled ? '下线会先展示影响面并二次确认' : '上线后按当前绑定与售价立即恢复'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
