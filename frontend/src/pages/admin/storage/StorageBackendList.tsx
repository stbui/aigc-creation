import { StorageBackendCard } from './StorageBackendCard';
import type { StorageBackendId, StorageBackendRow } from './types';

/**
 * 后端清单。
 *
 * auto-fit 而非固定三列：后端清单未来可能增加更多存储后端，
 * 固定 3 列在只有 2 个后端时会留出半屏空白。
 *
 * 权限判定由页面从 `useAdmin()` 下发，卡片本身只读状态与回调。
 */
export function StorageBackendList({
  backends,
  probing,
  busy,
  canProbe,
  canSwitch,
  canEdit,
  onProbe,
  onSwitch,
  onEdit,
}: {
  backends: StorageBackendRow[];
  probing: StorageBackendId | null;
  busy: boolean;
  canProbe: boolean;
  canSwitch: boolean;
  canEdit: boolean;
  onProbe: (backend: StorageBackendId) => void;
  onSwitch: (backend: StorageBackendId) => void;
  onEdit: (backend: StorageBackendId, view: StorageBackendRow['config']) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
      {backends.map((b) => (
        <StorageBackendCard
          key={b.backend}
          backend={b}
          probing={probing === b.backend}
          busy={busy}
          canProbe={canProbe}
          canSwitch={canSwitch}
          /* 本地后端也可编辑：公开访问域名决定素材链接的对外形态 */
          canEdit={canEdit}
          onProbe={() => void onProbe(b.backend as StorageBackendId)}
          onSwitch={() => void onSwitch(b.backend as StorageBackendId)}
          onEdit={() => onEdit(b.backend as StorageBackendId, b.config)}
        />
      ))}
    </div>
  );
}
