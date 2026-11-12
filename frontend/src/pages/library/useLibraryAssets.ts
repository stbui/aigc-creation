import { useCallback, useEffect, useRef, useState } from 'react';

import { assetsApi } from './api';
import type { AssetKind } from './constants';
import { useAuth } from './hooks';
import type { Asset } from '../../types/api';

/**
 * 素材库列表取数。
 *
 * 2026-11-12 从 `page.tsx` 抽出：首屏只等第一页就退出骨架屏，剩余页在后台
 * 静默补齐；筛选变化 / 手动刷新会让旧的翻页序号失效，避免旧结果覆盖新列表。
 */

export interface UseLibraryAssetsArgs {
  assetKind: AssetKind;
  capability: string;
  /** 首屏数据到达后回调：页面据此把可见条数收敛回第一页（须保持引用稳定） */
  onLoaded?: () => void;
}

export function useLibraryAssets({ assetKind, capability, onLoaded }: UseLibraryAssetsArgs) {
  const { token } = useAuth();
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败与「素材库为空」必须分开 (2026-10-20 修)。
   * 此前失败只弹 message.error, 随后照样渲染「素材库还是空的」——
   * 用户以为没上传过素材, 真相是接口没连上。
   */
  const [error, setError] = useState<string | null>(null);

  /**
   * 每次加载的序号。翻页在后台继续跑, 用户换筛选 / 刷新后旧循环必须立刻停写,
   * 否则「全部来源」的旧结果会覆盖新筛选出来的列表。
   */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    // guest 不发请求: 素材接口要鉴权, 401 会被渲染成「素材加载失败」。
    // 不动 loading: 登录后直接进骨架屏, 不会先闪一下「素材库还是空的」
    if (!token) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = {
      kind: assetKind === 'all' ? undefined : assetKind,
      capability: capability === 'all' ? undefined : capability,
      limit: 200,
    };

    /*
     * 首屏只等第一页 (最多 200 条) 就退出骨架屏; 剩余元数据在后台补齐。
     * 此前要等 `while` 把所有页翻完才 setItems —— 素材上千时要串行请求十几次,
     * 首屏白白空等, 而图片本来就只渲染前 20 张。
     */
    let first: Awaited<ReturnType<typeof assetsApi.list>>;
    try {
      first = await assetsApi.list(params);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      // 保留上一次数据: 刷新失败不该把已看到的素材清空
      setError((e as Error).message || '素材加载失败');
      setLoading(false);
      return;
    }
    if (seq !== loadSeq.current) return;
    setItems(first.items);
    onLoaded?.();
    setLoading(false);

    /*
     * 后端单页上限 200, 分组计数与「加载更多」仍需要全量元数据。
     * 这里继续翻页, 但每页到达就追加渲染; 中途失败静默停止 ——
     * 首屏已经可用了, 不该因为第 5 页超时把整个素材库换成错误页。
     */
    let all = first.items;
    try {
      while (all.length < first.total) {
        const next = await assetsApi.list({ ...params, offset: all.length });
        if (seq !== loadSeq.current) return;
        if (next.items.length === 0) break; // 翻页期间素材被删时避免死循环
        all = all.concat(next.items);
        setItems(all);
      }
    } catch {
      /* 已展示首屏, 后台补齐失败不打扰用户 */
    }
  }, [assetKind, capability, token, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  // 页面卸载后后台翻页可能还在跑: 让序号失效, 停止后续 setState
  useEffect(() => () => {
    loadSeq.current += 1;
  }, []);

  return { items, setItems, loading, error, load };
}
