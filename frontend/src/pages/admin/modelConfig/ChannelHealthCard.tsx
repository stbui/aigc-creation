import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { Notice } from '../../../admin-ui/primitives';
import { TONE_CHIP_COLOR } from '../../../components/admin/statusMeta';
import { cx } from '../../../admin-ui/lib/cn';
import type { AdminModelChannelSnapshot, Modality } from '../../../types/api';
import {
  DISPATCH_SOURCE_META,
  EFFECTIVE_LABEL,
  EFFECTIVE_TONE,
  MODALITY_EMPTY_HINT,
  MODALITY_LABEL,
} from './meta';

/**
 * 模态健康卡 —— 首屏「一屏看清三个模态」的入口。
 *
 * 既是总览也是筛选器：状态、线路数、可用数、冷却数、调度来源都在一屏内。
 */
export function ChannelHealthCard({
  modality,
  snapshot,
  active,
  onClick,
}: {
  modality: Modality;
  snapshot?: AdminModelChannelSnapshot;
  active: boolean;
  onClick: () => void;
}) {
  const source = snapshot?.source ?? 'none';
  const available = snapshot?.availableCount ?? 0;
  const effective = available > 0 ? 'gateway' : 'none';
  const dispatch = DISPATCH_SOURCE_META[source];
  const total = snapshot?.total ?? 0;
  const cooling = snapshot?.coolingCount ?? 0;
  const unsupported = snapshot?.unsupportedCount ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`筛选${MODALITY_LABEL[modality]}线路`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cx(
        'h-full cursor-pointer rounded-xl border bg-white px-4 py-3 transition-colors',
        active
          ? 'border-accent-500 shadow-[0_0_0_1px_var(--color-accent-500)]'
          : 'border-border-table hover:border-border-button-hover',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">{MODALITY_LABEL[modality]}</span>
        <Chip variant="caption" color={TONE_CHIP_COLOR[EFFECTIVE_TONE[effective]]}>
          {EFFECTIVE_LABEL[effective]}
        </Chip>
      </div>

      <dl className="my-3 flex gap-6">
        {[
          { label: '线路', value: total },
          { label: '可用', value: available },
          { label: '冷却', value: cooling },
        ].map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-text-tertiary">{item.label}</dt>
            <dd className="text-[20px] font-semibold leading-7 tabular-nums text-text-primary">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {source !== 'none' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-tertiary">调度来源</span>
          <Chip variant="caption" color={TONE_CHIP_COLOR[dispatch.tone]}>
            {dispatch.label}
          </Chip>
        </div>
      )}

      {(cooling > 0 || unsupported > 0) && (
        <Notice
          tone="warn"
          className="mb-0 mt-2.5"
          title={`${cooling > 0 ? `${cooling} 条冷却中；` : ''}${
            unsupported > 0 ? `${unsupported} 条协议未接入；` : ''
          }调度会自动跳过不可用线路。`}
        />
      )}

      {source === 'none' && (
        <Notice
          tone={modality === 'image' ? 'warn' : 'danger'}
          className="mb-0 mt-2.5"
          title={MODALITY_EMPTY_HINT[modality]}
        />
      )}

      <p className="mt-2.5 text-xs text-text-tertiary">
        {active ? '正在查看该模态' : '点击筛选该模态'}
      </p>
    </div>
  );
}
