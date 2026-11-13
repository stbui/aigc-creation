import { Link } from 'react-router-dom';
import { HelpTip, ToneBadge } from '~/admin-ui/primitives';
import type { ProductConsumptionRef } from './useProductConsumption';

function dedupeByCapability(refs: ProductConsumptionRef[]): ProductConsumptionRef[] {
  const byCapability = new Map<string, ProductConsumptionRef>();
  for (const ref of refs) {
    const current = byCapability.get(ref.capabilityId);
    // 同一能力可能有多个前台模型；只要有一个可用，就按可用展示
    if (!current || (!current.available && ref.available)) {
      byCapability.set(ref.capabilityId, ref);
    }
  }
  return [...byCapability.values()];
}

function consumptionTip(refs: ProductConsumptionRef[]) {
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      {refs.map((ref) => (
        <div key={ref.modelKey}>
          {ref.capabilityName} · {ref.modelName}
          {!ref.enabled || !ref.available ? '（暂不可用）' : ''}
        </div>
      ))}
    </div>
  );
}

/**
 * 「消费能力」单元格：这个商品正被哪些能力使用。
 *
 * 标签最多两个，其余数字悬停展开；点击跳到能力页并带上关键词。
 * 没有 `logical_model.read`（能力绑定读权限）时显示 `—`，不把商品表变成权限错误页。
 */
export function ProductConsumptionCell({
  refs,
  loading,
  available,
}: {
  refs?: ProductConsumptionRef[];
  loading: boolean;
  available: boolean;
}) {
  if (!available) {
    return (
      <span className="text-[12px] text-muted-foreground" title="需要「前台模型读」权限">
        —
      </span>
    );
  }
  if (loading && !refs) {
    return <span className="text-[12px] text-muted-foreground">读取中…</span>;
  }

  const unique = dedupeByCapability(refs ?? []);
  if (unique.length === 0) {
    return <span className="text-[12px] text-muted-foreground">未被消费</span>;
  }

  const shown = unique.slice(0, 2);
  const rest = unique.slice(2);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((ref) => (
        <Link
          key={ref.capabilityId}
          to={`/admin/capabilities?q=${encodeURIComponent(ref.capabilityId)}`}
          className="min-w-0 max-w-full"
          title={`${ref.capabilityName} · ${ref.modelName}`}
        >
          <ToneBadge tone={ref.enabled && ref.available ? 'neutral' : 'warn'}>
            {ref.capabilityName}
          </ToneBadge>
        </Link>
      ))}
      {rest.length > 0 && (
        <HelpTip tip={consumptionTip(unique)}>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            +{rest.length}
          </span>
        </HelpTip>
      )}
    </div>
  );
}
