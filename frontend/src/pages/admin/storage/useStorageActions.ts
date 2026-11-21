import { useState } from 'react';
import { adminStorageApi } from './api';
import { META } from './constants';
import { useToast } from './hooks';
import type { StorageBackendId, StorageConfigView } from './types';

/**
 * 存储后端的连通性探测、默认后端切换与配置编辑。
 *
 * 三个动作成功后都要重拉状态：只改本地 state 会让卡片上的连通性 /「当前」
 * 标记停留在操作前的快照。忙碌态分开保存 —— 探测是按后端粒度的，切换与
 * 保存是整页/抽屉级别的，草稿测试只在抽屉内进行。
 */
export function useStorageActions(reload: () => void | Promise<void>) {
  const toast = useToast();
  const [probing, setProbing] = useState<StorageBackendId | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  /* 正在编辑的后端；null = 抽屉关闭。view 从卡片携带，避免再查一遍 status。 */
  const [editing, setEditing] = useState<{
    backend: StorageBackendId;
    view: StorageConfigView;
  } | null>(null);

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

  const openEditor = (backend: StorageBackendId, view: StorageConfigView) => {
    setEditing({ backend, view });
  };

  const closeEditor = () => {
    if (!busy) setEditing(null);
  };

  /**
   * 用抽屉草稿做真实读写测试。不落库、不切换默认后端；
   * 结果直接回到抽屉里展示，不发 toast（失败原因通常较长，需要留在页面上）。
   */
  const testDraft = async (values: Record<string, string>) => {
    if (!editing) return { ok: false, message: '没有正在编辑的后端' };
    setTesting(true);
    try {
      return await adminStorageApi.probe(editing.backend, values);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    } finally {
      setTesting(false);
    }
  };

  /** 保存云端后端配置，即时生效；成功后关闭抽屉并重拉状态 */
  const doSave = async (values: Record<string, string>) => {
    if (!editing) return;
    setBusy(true);
    try {
      await adminStorageApi.saveConfig(editing.backend, values);
      toast.success(`${META[editing.backend].label} 配置已保存并即时生效`);
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { probing, testing, busy, probe, doSwitch, editing, openEditor, closeEditor, doSave, testDraft };
}