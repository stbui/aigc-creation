import { Link } from 'react-router-dom';
import { Notice, Panel, StatCards, StatusTag } from '~/admin-ui/primitives';
import { RUNTIME_LABELS } from '../../../lib/constants';
import { toCredits } from '../../../lib/microcredits';
import type { AdminCapabilityControl } from '../../../types/api';
import type { AdminCapabilityModelListView, CapabilityPricingView } from '../../../types/model';
import { bindingCanRun, runtimeTone } from './utils';

/** 影响面：改绑定、改价、下线前，先明确 C 端与已绑定商品会受什么影响。 */
export function ImpactPanel({
  capability,
  bindings,
  pricing,
  bindingsReadable = true,
  pricingReadable = true,
}: {
  capability: AdminCapabilityControl;
  bindings: AdminCapabilityModelListView | null;
  pricing: CapabilityPricingView | null;
  bindingsReadable?: boolean;
  pricingReadable?: boolean;
}) {
  const rows = bindings?.bindings ?? [];
  const executable = rows.filter(bindingCanRun);
  const blocked = rows.filter((row) => !bindingCanRun(row));
  const invalidCount = bindings?.invalidCount ?? 0;

  return (
    <Panel title="影响面" extra={<span className="text-xs text-muted-foreground">改价 / 下线前必看</span>}>
      <div className="flex flex-col gap-3">
        <StatCards
          columns={4}
          items={[
            { key: 'consumer', label: 'C 端结果', value: RUNTIME_LABELS[capability.runtime.effective] ?? capability.runtime.effective },
            { key: 'executable', label: '可切换线路', value: bindingsReadable ? executable.length : '—' },
            {
              key: 'blocked',
              label: '不可执行绑定',
              value: bindingsReadable ? blocked.length : '—',
              tone: bindingsReadable && blocked.length > 0 ? 'warn' : undefined,
            },
            {
              key: 'invalid',
              label: '失效绑定',
              value: bindingsReadable ? invalidCount : '—',
              tone: bindingsReadable && invalidCount > 0 ? 'danger' : undefined,
            },
          ]}
        />

        <Notice tone={capability.runtime.effective === 'remote' ? 'info' : 'danger'} className="mb-0">
          <div className="flex flex-col gap-1.5">
            <div>
              当前结论：<strong>{RUNTIME_LABELS[capability.runtime.effective] ?? capability.runtime.effective}</strong>
              。{capability.runtime.reason}
            </div>
            <div>
              下线影响：C 端立即不可提交，且不会自动退款；已创建任务继续按原账单快照执行。
            </div>
            <div>
              改价影响：只影响后续请求，候选线路不变；已创建任务按原价格结算。
            </div>
          </div>
        </Notice>

        {!bindingsReadable && (
          <Notice tone="locked" className="mb-0">
            当前账号没有绑定读取权限，影响面只展示能力运行结论；绑定数量与线路切换情况不可见。
          </Notice>
        )}

        {bindingsReadable && invalidCount > 0 && (
          <Notice tone="warn" className="mb-0">
            另有 {invalidCount} 条失效绑定，已排除在可执行线路之外。保存绑定不会自动删除它们，请到「绑定」页确认后显式清理。
          </Notice>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_100px] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>绑定商品</span>
            <span>供应商</span>
            <span>选路</span>
            <span>可执行</span>
          </div>
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              没有有效绑定。当前能力无法承接真实请求。
            </div>
          ) : !bindingsReadable ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              无绑定读取权限
            </div>
          ) : (
            rows.map((row) => {
              const canRun = bindingCanRun(row);
              return (
                <div
                  key={row.channelModelId}
                  className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_100px] items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{row.displayName || row.modelKey}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{row.modelKey}</div>
                  </div>
                  <Link
                    to={`/admin/channels?view=channels&id=${encodeURIComponent(row.channelId)}`}
                    className="truncate text-xs text-brand hover:underline"
                    title="在供应商中查看"
                  >
                    {row.channelName || row.channelId}
                  </Link>
                  <span className="text-xs text-muted-foreground">{row.enabled ? '参与' : '关闭'}</span>
                  <StatusTag
                    status={canRun ? 'impact-ok' : 'impact-blocked'}
                    tone={canRun ? 'success' : 'warn'}
                    label={canRun ? '是' : '否'}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {pricingReadable ? (
            <>
              能力售价：{pricing?.configured ? '已配置' : '默认价'} · {pricing?.billingMode ?? '读取中'}
              {pricing ? ` · ${toCredits(pricing.unitPriceMicrocredits)} 积分 / 单位` : ''}
            </>
          ) : (
            '能力售价：无读取权限'
          )}
        </div>
      </div>
    </Panel>
  );
}
