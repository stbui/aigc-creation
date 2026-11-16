import { useState } from 'react';
import { adminStorageApi } from './api';
import { META } from './constants';
import { useToast } from './hooks';
import type { StorageBackendId } from './types';

/**
 * 存储后端的连通性探测与默认后端切换。
 *
 * 两个动作成功后都要重拉状态：只改本地 state 会让卡片上的连通性 / 「当前」
 * 标记停留在操作前的快照。忙碌态分开保存 —— 探测是按后端粒度的，切换是整页的。
 */
export function useStorageActions(reload: () => void | Promise<void>) {
  const toast = useToast();
  const [probing, setProbing] = useState<StorageBackendId | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = async (backend: StorageBackendId) => {
    setProbing(backend);
    try {
      const res = await adminStorageApi.probe(backend);
      if (res.ok) {
        toast.success(`${META[backend].label} 连通正常${res.latencyMs ? ` (${res.latencyMs}ms)` : ''}`);
      } else {
        toast.error(res.message);
      }
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProbing(null);
    }
  };

  /** 切换只改运行时默认值，按产品要求直接执行，不再弹窗二次确认 */
  const doSwitch = async (backend: StorageBackendId) => {
    setBusy(true);
    try {
      const res = await adminStorageApi.setActive(backend);
      toast.success(`默认后端已切到 ${META[backend].label} — ${res.note}`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { probing, busy, probe, doSwitch };
}
