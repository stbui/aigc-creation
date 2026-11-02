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
  /**
   * 输入原图（任务的首张输入素材）。
   *
   * 详情图结果行要展示「原图 + 各模块图」，原图不在产出里，只能从任务输入取。
   * 素材被删或历史任务缺字段时为空，调用方按商品名称占位。
   */
  inputUrl?: string;
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
  /**
   * 是否把 failed / cancelled 任务也放进列表（没有 url，由调用方渲染成失败格）。
   *
   * 默认 false：网格页只展示有图的产出，失败任务靠提示行说明。详情图的批次
   * 结果行需要逐个模块显示「这张失败了」，否则用户只看到少了一张图。
   */
  includeFailed?: boolean;
}

export function useResultGallery({ capability, token, captionOf, includeFailed = false }: Options): ResultGallery {
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
  /** 请求序号：切换筛选/登出/重拉后，旧请求返回不得再写状态 */
  const loadSeqRef = useRef(0);
  /** 发起请求时的 token；响应回来时与当前 token 不一致则丢弃（跨账号串号） */
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // captionOf 通常是内联箭头函数, 每次渲染都是新引用; 放进依赖会让 load 反复重建并重拉列表
  const captionRef = useRef(captionOf);
  useEffect(() => {
    captionRef.current = captionOf;
  }, [captionOf]);

  const load = useCallback(async (silent = false): Promise<number> => {
    const seq = ++loadSeqRef.current;
    if (!token) {
      setItems([]);
      setError(null);
      return 0;
    }
    if (!silent) setLoading(true);
    try {
      const requestToken = token;
      /*
       * 结果栏只关心当前能力，交给服务端按 capability 过滤并限制 100 条。
       * 之前拉全量任务再在前端 filter，用户任务多时每次轮询都要传整张表。
       */
      const page = await generateApi.listPage({ capability, limit: 100, offset: 0 });
      const tasks = page.items;
      /*
       * 用户可能在请求期间登出 / 切号 / 重新拉取。旧响应如果直接 setItems,
       * 会把上一账号的作品写进新会话；序号与 token 双校验兜住。
       */
      if (seq !== loadSeqRef.current || tokenRef.current !== requestToken) {
        return activeRef.current;
      }
      const next: GalleryItem[] = [];
      for (const t of tasks) {
        if (t.capability !== capability) continue;
        const params = t.params ?? {};
        const base = {
          id: t.id,
          createdAt: t.createdAt,
          params,
          prompt: promptOf(params),
          caption: captionRef.current?.(params) || undefined,
          inputUrl: assetSrc(t.inputAssets?.[0]),
        };
        if (t.status !== 'succeeded') {
          // 生成中的任务也要进列表: 离开页面再回来时, 占位卡由服务端状态回填
          if (t.status === 'running' || t.status === 'queued') {
            next.push({ ...base, status: t.status, url: '' });
          } else if (includeFailed && (t.status === 'failed' || t.status === 'cancelled')) {
            next.push({ ...base, status: t.status, url: '' });
          }
          continue;
        }
        const url = assetSrc(t.outputAsset);
        if (!url) continue;
        next.push({
          ...base,
          status: 'succeeded',
          url,
          assetId: t.outputAsset?.id,
          format: t.outputAsset?.format,
          width: t.outputAsset?.width ?? null,
          height: t.outputAsset?.height ?? null,
        });
      }
      setItems(next);
      setError(null);
      const active = next.filter((x) => x.status === 'running' || x.status === 'queued').length;
      activeRef.current = active;
      return active;
    } catch (e) {
      // 旧请求的失败不覆盖新一轮的状态
      if (seq !== loadSeqRef.current) return activeRef.current;
      // 保留上一次结果: 刷新失败不该把已看到的图清空
      setError((e as Error).message || '历史生成图加载失败');
      return activeRef.current;
    } finally {
      // 静默轮询不置 true, 但首次静默加载要把初始的 true 收掉
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [capability, token, includeFailed]);

  const reload = useCallback(() => load(false), [load]);

  // 首次进入拉一次 (占位卡由服务端状态回填)
  useEffect(() => {
    void load(true);
  }, [load]);

  /**
   * 有生成中的任务就按间隔轮询, 全部到终态即停。
   *
   * 轮询条件挂在「列表里还有占位卡」上而不是一次性的启动循环: 提交任务后
   * `reload()` 把新任务放进列表, 此时必须重新起轮询 —— 否则首帧 active=0
   * 就让循环退出了, 用户看到的占位卡永远停在「生成中…」。
   */
  const hasActive = items.some((item) => item.status === 'running' || item.status === 'queued');

  useEffect(() => {
    if (!token || !hasActive) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const active = await load(true);
      if (cancelled || active === 0) return;
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [token, hasActive, load]);

  const prepend = useCallback((fresh: GalleryItem[]) => {
    if (fresh.length === 0) return;
    setItems((prev) => [...fresh, ...prev.filter((x) => !fresh.some((f) => f.id === x.id))]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { items, loading, error, reload, prepend, removeItem };
}
