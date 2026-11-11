import { formatDateTime, Panel } from '~/admin-ui/primitives';
import type { AdminAigcLabel } from '../../../types/api';

/**
 * 当前生效位图 —— 服务端实际使用的那一张。
 *
 * 透明底用棋盘格衬出来，否则深色角标在白底上会看不清边缘。
 */
export function CurrentBadgePanel({ badge }: { badge: AdminAigcLabel['badge'] }) {
  if (badge.source !== 'custom' || !badge.pngBase64) return null;

  return (
    <Panel title="当前生效位图" note="服务端实际使用的那一张">
      <div
        className="grid place-items-center rounded-xl p-3"
        style={{
          background:
            'repeating-conic-gradient(var(--surface) 0% 25%, var(--page-bg) 0% 50%) 50% / 16px 16px',
        }}
      >
        <img
          src={`data:image/png;base64,${badge.pngBase64}`}
          alt="当前角标位图"
          className="max-w-full"
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {badge.width}×{badge.height}px
        {badge.updatedAt
          ? ` · 更新于 ${formatDateTime(badge.updatedAt)}`
          : ''}
      </p>
    </Panel>
  );
}
