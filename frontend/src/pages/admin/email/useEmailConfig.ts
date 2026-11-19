import { useMemo, useState } from 'react';
import { adminSettingsApi } from './api';
import { ALL_EMAIL_KEYS } from './constants';
import { useAdminResource, useToast, useUnsavedGuard } from './hooks';
import type { AdminSettingValue, EmailSettingItem } from './types';
import { emailSettingItems } from './utils';

/** 同值比较只服务草稿去重；配置值类型由后端 SETTING_DEFS 固定。 */
function sameSettingValue(a: unknown, b: unknown): boolean {
  return a === b;
}

/**
 * 邮箱配置的取数与草稿。
 *
 * 「配置 → 验证 → 使用」这条链路里，本 hook 只管第一段的**编辑**：拉全量设置、
 * 取出 `email.*` 分组、维护草稿与待清除键、提交保存。通道运行状态与测试发信
 * 属于第二段，由 `useEmailChannel` 单独负责 —— 两者失败互不影响，塞进同一个
 * hook 会让「保存失败」和「状态读取失败」共用一个 error。
 *
 * 数据仍写入统一 settings API，确保发信服务与注册、支付、工单等业务链路读取
 * 到同一份运行时配置；这里只提交 `email.*` 键，不触碰其他系统设置。
 *
 * @param onSaved 保存成功、设置已重新拉取后调用（用于刷新通道运行状态）
 */
export function useEmailConfig(onSaved?: () => Promise<void> | void) {
  const toast = useToast();
  const { data: settings, loading, error, reload } = useAdminResource(() =>
    adminSettingsApi.read(),
  );
  const items = useMemo(() => emailSettingItems(settings), [settings]);
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.key, item])),
    [items],
  );

  const [draft, setDraft] = useState<Record<string, AdminSettingValue>>({});
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const dirtyCount = Object.keys(draft).length + clears.size;
  useUnsavedGuard(dirtyCount > 0);

  const itemFor = (key: string): EmailSettingItem | undefined => itemMap.get(key);

  const valueFor = (key: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
    return itemFor(key)?.value ?? null;
  };

  const configuredFor = (key: string): boolean => {
    const item = itemFor(key);
    if (!item) return false;
    if (Object.prototype.hasOwnProperty.call(draft, key)) {
      return String(draft[key] ?? '').trim().length > 0;
    }
    return Boolean(item.hasSecret || item.overridden);
  };

  /** 敏感项清空即视为「不覆盖原值」，不能写进草稿，否则会把密钥置空。 */
  const setValue = (key: string, next: AdminSettingValue) => {
    const item = itemFor(key);
    setDraft((current) => {
      const updated = { ...current };
      if (item?.sensitive && String(next ?? '') === '') {
        delete updated[key];
      } else if (sameSettingValue(next, item?.value ?? null)) {
        delete updated[key];
      } else {
        updated[key] = next;
      }
      return updated;
    });
    setClears((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  };

  const requestClear = (key: string) => {
    setDraft((current) => {
      const updated = { ...current };
      delete updated[key];
      return updated;
    });
    setClears((current) => new Set(current).add(key));
  };

  const undoClear = (key: string) => {
    setClears((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  };

  const discard = () => {
    setDraft({});
    setClears(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      const changes = Object.fromEntries(
        Object.entries(draft).filter(([key]) => ALL_EMAIL_KEYS.has(key) && !clears.has(key)),
      );
      const clearKeys = [...clears].filter((key) => ALL_EMAIL_KEYS.has(key));
      const result = await adminSettingsApi.update({ settings: changes, clears: clearKeys });
      setDraft({});
      setClears(new Set());
      await reload();
      await onSaved?.();
      toast.success(
        '邮箱配置已保存',
        `${result.updated.length + result.cleared.length} 项变更将在后续邮件中生效。`,
      );
    } catch (cause) {
      toast.error(
        '邮箱配置保存失败',
        cause instanceof Error ? cause.message : '请检查邮箱配置后重试。',
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    settings,
    loading,
    error,
    reload,
    items,
    draft,
    clears,
    saving,
    dirtyCount,
    itemFor,
    valueFor,
    configuredFor,
    setValue,
    requestClear,
    undoClear,
    clearPending: (key: string) => clears.has(key),
    dirty: (key: string) =>
      Object.prototype.hasOwnProperty.call(draft, key) || clears.has(key),
    discard,
    save,
  };
}

export type EmailConfigState = ReturnType<typeof useEmailConfig>;
