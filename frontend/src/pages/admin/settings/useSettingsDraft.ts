import { useMemo, useState } from 'react';
import { adminSettingsApi } from './api';
import { HIDDEN_SETTING_GROUP_KEYS } from './constants';
import { useAdminResource, useToast, useUnsavedGuard } from './hooks';
import type { AdminSettingValue, SettingChange } from './types';
import {
  UPLOAD_LIMITS_CHANGED_EVENT,
  displayValue,
  effectForSetting,
  isSettingsTabKey,
} from './utils';

/**
 * 系统设置的取数、草稿与保存。
 *
 * 草稿（`draft`）与「恢复默认」（`clears`）是两套独立意图，同一 key 不能同时存在：
 * 改值要清掉该 key 的待恢复标记，恢复默认要从草稿里删掉它。`changedKeys` 是两者
 * 的并集，也是未保存守卫、页签角标与保存确认的唯一口径。
 */
export function useSettingsDraft() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, AdminSettingValue>>({});
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const { data: settings, loading, error, reload } = useAdminResource(() => adminSettingsApi.read());

  const visibleGroups = useMemo(
    () =>
      settings?.groups.filter(
        (group) =>
          isSettingsTabKey(group.key) &&
          group.key !== 'security' &&
          !HIDDEN_SETTING_GROUP_KEYS.has(group.key),
      ) ?? [],
    [settings],
  );

  const changedKeys = useMemo(
    () => [...new Set([...Object.keys(draft), ...clears])],
    [draft, clears],
  );
  const dirtyCount = changedKeys.length;
  useUnsavedGuard(dirtyCount > 0);

  const setValue = (key: string, value: AdminSettingValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setClears((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const revert = (key: string) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setClears((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const requestClear = (key: string) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setClears((current) => new Set(current).add(key));
  };

  const discardChanges = () => {
    setDraft({});
    setClears(new Set());
  };

  const changeSummary = useMemo<SettingChange[]>(() => {
    if (!settings) return [];
    const allItems = settings.groups.flatMap((group) => group.items);
    return changedKeys.map((key) => {
      const item = allItems.find((candidate) => candidate.key === key);
      const currentValue = item?.sensitive
        ? item.overridden
          ? '已配置'
          : '未配置'
        : item
          ? displayValue(item.value, item.type)
          : '—';
      const nextValue = clears.has(key)
        ? item?.sensitive
          ? '已清除'
          : `${item ? displayValue(item.default, item.type) : '—'}（恢复默认）`
        : item?.sensitive
          ? '已更新'
          : displayValue(draft[key], item?.type ?? 'string');
      return {
        key,
        label: item?.label ?? key,
        from: currentValue,
        to: nextValue,
        effect: effectForSetting(key),
      };
    });
  }, [changedKeys, clears, draft, settings]);

  const save = async () => {
    setBusy(true);
    const uploadChanged = changedKeys.some((key) => key.startsWith('upload.'));
    try {
      const result = await adminSettingsApi.update({
        settings: Object.fromEntries(
          Object.entries(draft).filter(([key]) => !clears.has(key)),
        ),
        clears: [...clears],
      });
      setDraft({});
      setClears(new Set());
      await reload();
      if (uploadChanged) window.dispatchEvent(new Event(UPLOAD_LIMITS_CHANGED_EVENT));
      setConfirming(false);
      toast.success(
        result.cleared.length > 0
          ? `已保存 ${result.updated.length} 项、恢复默认 ${result.cleared.length} 项`
          : `已保存 ${result.updated.length} 项配置`,
      );
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    settings,
    loading,
    error,
    reload,
    visibleGroups,
    draft,
    clears,
    changedKeys,
    dirtyCount,
    changeSummary,
    busy,
    confirming,
    setValue,
    revert,
    requestClear,
    discardChanges,
    openConfirm: () => setConfirming(true),
    closeConfirm: () => setConfirming(false),
    save,
  };
}

/** 板块组件共用的模型形状，由 hook 推导，避免再手写一份会漂移的接口。 */
export type SettingsDraft = ReturnType<typeof useSettingsDraft>;
