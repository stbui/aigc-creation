import { StorageBackendCard } from './StorageBackendCard';
import type { StorageBackendId, StorageBackendRow } from './types';

/**
 * 后端清单。
 *
 * auto-fit 而非固定三列：后端清单未来会随 STORAGE_BACKEND 增加，
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
  onProbe,
  onSwitch,
}: {
  backends: StorageBackendRow[];
  probing: StorageBackendId | null;
  busy: boolean;
  canProbe: boolean;
  canSwitch: boolean;
  onProbe: (backend: StorageBackendId) => void;
  onSwitch: (backend: StorageBackendId) => void;
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
          onProbe={() => void onProbe(b.backend as StorageBackendId)}
          onSwitch={() => void onSwitch(b.backend as StorageBackendId)}
        />
      ))}
    </div>
  );
}
