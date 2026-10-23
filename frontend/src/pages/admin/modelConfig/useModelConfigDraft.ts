import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminModelConfig, AdminModelConfigItem, Modality } from '../../../types/api';

type DraftValue = string | number | boolean;

/**
 * 全局设置 / 逐能力路由的草稿。
 *
 * ## 为什么单独抽出来
 *
 * 旧页面把「初始化、脏值计算、提交」写在一个 900 行的组件里，结果三处
 * 各自 `if (it.secret) continue`，手填 token 永远进不了保存请求。
 * 现在凭据语义只在这里定义一次：
 *   - 初始化：secret 不回填（拿不到明文）
 *   - 脏值：secret 以「草稿里有非空字符串」为变更
 *   - 提交：secret 非空才发送；清除走 clears
 */
export function useModelConfigDraft(data: AdminModelConfig | null) {
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [clears, setClears] = useState<Record<string, boolean>>({});

  const reset = useCallback(() => {
    if (!data) {
      setDraft({});
      setClears({});
      return;
    }
    const init: Record<string, DraftValue> = {};
    for (const g of data.groups) {
      for (const it of g.items) {
        // 凭据拿不到明文，保持「未输入」；其余项用当前生效值初始化
        if (it.secret) continue;
        init[it.key] = it.value ?? it.default;
      }
    }
    setDraft(init);
    setClears({});
  }, [data]);

  useEffect(() => {
    reset();
  }, [reset]);

  const changed = useMemo(() => {
    if (!data) return [] as AdminModelConfigItem[];
    const out: AdminModelConfigItem[] = [];
    for (const g of data.groups) {
      for (const it of g.items) {
        const cur = draft[it.key];
        if (it.secret) {
          // 凭据：有非空输入就是变更（旧值不可见，无法比较）
          if (typeof cur === 'string' && cur.length > 0 && !clears[it.key]) out.push(it);
          continue;
        }
        if (cur !== undefined && String(cur) !== String(it.value ?? it.default)) out.push(it);
      }
    }
    return out;
  }, [data, draft, clears]);

  const clearKeys = useMemo(() => Object.keys(clears).filter((k) => clears[k]), [clears]);

  const dirty = changed.length > 0 || clearKeys.length > 0;

  const setValue = useCallback((key: string, value: DraftValue) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // 一旦输入新值就取消「恢复默认」，两个语义不能同时成立
    if (typeof value === 'string' && value) {
      setClears((c) => (c[key] ? { ...c, [key]: false } : c));
    }
  }, []);

  const toggleClear = useCallback((key: string) => {
    setClears((c) => ({ ...c, [key]: !c[key] }));
  }, []);

  /** 厂商联动：一次写入多模态的 baseUrl/provider/model/vendor */
  const patchDraft = useCallback((patch: Record<string, DraftValue>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const clearFlags = useCallback((keys: string[]) => {
    setClears((c) => {
      const next = { ...c };
      for (const k of keys) next[k] = false;
      return next;
    });
  }, []);

  const dirtyOfModality = useCallback(
    (modality: Modality) => {
      const prefix = `gateway.${modality}.`;
      return (
        changed.filter((c) => c.key.startsWith(prefix)).length +
        clearKeys.filter((k) => k.startsWith(prefix)).length
      );
    },
    [changed, clearKeys],
  );

  const buildPayload = useCallback(() => {
    const settings: Record<string, unknown> = {};
    for (const it of changed) settings[it.key] = draft[it.key];
    return { settings, clears: clearKeys };
  }, [changed, clearKeys, draft]);

  return {
    draft,
    clears,
    changed,
    clearKeys,
    dirty,
    setValue,
    toggleClear,
    patchDraft,
    clearFlags,
    dirtyOfModality,
    buildPayload,
    reset,
  };
}

export type ModelConfigDraft = ReturnType<typeof useModelConfigDraft>;
