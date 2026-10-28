import { useCallback, useEffect, useRef, useState } from 'react';
import { assetSrc, generateApi } from '../lib/api';
import { POLL_INTERVAL_MS } from '../lib/constants';
import type { TaskStatus } from '../types/api';

/**
 * 结果栏「全部生成图」的数据源。
 *
 * 数据取自 **任务列表** 而非素材列表: 生成记录以任务为准 (创作时间、尺寸口径
 * 都在任务上), 素材列表不带任务上下文。素材库那边是「我有哪些图」,
 * 这里回答的是「这个工具生成过什么」。
 *
 * 自由创作页与商品主图 / 详情 / 爆款复刻页共用这份逻辑, 避免出现
 * 「一边按 capability 过滤、另一边忘了过滤」这类只在某一页复现的错。
 */
export interface GalleryItem {
  /** 任务 id (稳定且唯一) */
  id: string;
  /**
   * 任务状态。生成中的任务没有 url, 由结果栏渲染成占位卡;
   * 缺省视为 succeeded (页面内 prepend 的新图都是已完成态)。
   */
  status?: TaskStatus;
  url: string;
  /** 产出素材 id —— 右键「用作参考图」要凭它进图片位 (图片位存的是素材 id, 不是任务 id) */
  assetId?: string;
  /** 真实格式 (png/jpeg/webp), 下载时决定扩展名; 猜后缀会把 PNG 存成 .jpg */
  format?: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
  /** 生成时提交的提示词；只对参数里带 prompt 的能力有值 */
  prompt?: string;
  /** 任务原始参数；SKU 批量历史按 batchId 聚合时使用。 */
  params?: Record<string, unknown>;
  /**
   * 缩略图左上角的小标签 (商品主图用来标「白底图 / 场景图 / 卖点图」)。
   * 不传就不渲染 —— 自由创作页一次只出一种图, 没有可标的维度。
   */
  caption?: string;
}

function promptOf(params: Record<string, unknown> | undefined): string | undefined {
  const prompt = params?.prompt;
  return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : undefined;
}

export interface ResultGallery {
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息; 非空时列表应保留上一次结果并提示, 而不是清空成空态 */
  error: string | null;
  /** 重新拉取 (手动「刷新」按钮); 返回生成中的任务数, 供内部轮询判断是否继续 */
  reload: () => Promise<number>;
  /** 新图插到列表首位 (提交后用轮询结果当场顶替, 不重拉列表) */
  prepend: (fresh: GalleryItem[]) => void;
  /** 删除后从本地列表摘掉 */
  removeItem: (id: string) => void;
}

interface Options {
  /** 只保留该能力的产出 */
  capability: string;
  /** 未登录时为 null: /tasks 需鉴权, 不发请求, 列表回到空态 */
  token: string | null;
  /** 从任务参数推导标签; 返回空串/undefined 表示不标 */
  captionOf?: (params: Record<string, unknown>) => string | undefined;
}

export function useResultGallery({ capability, token, captionOf }: Options): ResultGallery {
  const [items, setItems] = useState<GalleryItem[]>([]);
  /*
   * 已登录时首帧就是 loading: reload 在 effect 里才跑, 若初值是 false,
   * 会先闪一帧「提交任务后，生成结果将在此处展示」再被网格顶掉 —— 用户
   * 打开页面看到的是一句与事实相反的提示。
   */
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  /** 上一次成功拉取到的生成中任务数: 轮询遇到网络抖动时据此继续, 不把占位卡卡死 */
  const activeRef = useRef(0);

  // captionOf 通常是内联箭头函数, 每次渲染都是新引用; 放进依赖会让 load 反复重建并重拉列表
  const captionRef = useRef(captionOf);
  useEffect(() => {
    captionRef.current = captionOf;
  }, [captionOf]);

  const load = useCallback(async (silent = false): Promise<number> => {
    if (!token) {
      setItems([]);
      setError(null);
      return 0;
    }
    if (!silent) setLoading(true);
    try {
      const tasks = await generateApi.list();
      const next: GalleryItem[] = [];
      for (const t of tasks) {
        if (t.capability !== capability) continue;
        if (t.status !== 'succeeded') {
          // 生成中的任务也要进列表: 离开页面再回来时, 占位卡由服务端状态回填
          if (t.status === 'running' || t.status === 'pending') {
            next.push({
              id: t.id,
              status: t.status,
              url: '',
              createdAt: t.createdAt,
              params: t.params ?? {},
              prompt: promptOf(t.params),
              caption: captionRef.current?.(t.params ?? {}) || undefined,
            });
          }
          continue;
        }
        const url = assetSrc(t.outputAsset);
        if (!url) continue;
        next.push({
          id: t.id,
          status: 'succeeded',
          url,
          assetId: t.outputAsset?.id,
          format: t.outputAsset?.format,
          width: t.outputAsset?.width ?? null,
          height: t.outputAsset?.height ?? null,
          createdAt: t.createdAt,
          params: t.params ?? {},
          prompt: promptOf(t.params),
          caption: captionRef.current?.(t.params ?? {}) || undefined,
        });
      }
      setItems(next);
      setError(null);
      const active = next.filter((x) => x.status === 'running' || x.status === 'pending').length;
      activeRef.current = active;
      return active;
    } catch (e) {
      // 保留上一次结果: 刷新失败不该把已看到的图清空
      setError((e as Error).message || '历史生成图加载失败');
      return activeRef.current;
    } finally {
      // 静默轮询不置 true, 但首次静默加载要把初始的 true 收掉
      setLoading(false);
    }
  }, [capability, token]);

  const reload = useCallback(() => load(false), [load]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const active = await load(true);
      if (cancelled || active === 0) return;
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load]);

  const prepend = useCallback((fresh: GalleryItem[]) => {
    if (fresh.length === 0) return;
    setItems((prev) => [...fresh, ...prev.filter((x) => !fresh.some((f) => f.id === x.id))]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { items, loading, error, reload, prepend, removeItem };
}
