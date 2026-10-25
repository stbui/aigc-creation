import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import {
  Check,
  ChevronDown,
  Download,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateApi, assetSrc } from '../lib/api';
import { capabilityById, capabilityName, toolPath } from '../lib/capabilities';
import { useCapabilities } from '../hooks/useCapabilities';
import { usePollAbort } from '../hooks/usePollAbort';
import { useGenerateError } from '../hooks/useGenerateError';
import { useAuth } from '../context/AuthContext';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { runtimeOf, taskErrorText } from '../lib/constants';
import { waitForTask } from '../lib/poll';
import { StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import { ResultMedia } from '../components/ResultMedia';
import { ImageLightbox, type LightboxItem } from '../components/ImageLightbox';
import type { Modality, Task } from '../types/api';

/**
 * 我的作品 —— 1:1 复刻参考站 https://ijihua.cn/my-works。
 *
 * 版面数值来源:
 *   ① 未登录可达空态实拍: `.my-works-page` 1190 宽 padding `28px 28px 72px`、bg #F6F7FB;
 *      h1 38.4px/600 #161616; 双 tab 56×32; 工具栏 `.my-works-toolbar` 白底 radius16
 *      padding `12px 14px` shadow rgba(41,33,22,.04) 0 12px 30; 4 个筛选器各 108×37
 *      (12px #5F5B55 / border #EBE8E1 / radius 999); 「选择下载」97×33 白字 radius 999;
 *      计数 13px #4D4943; 排序说明 12px #96918A; 空态 h2 18px/700 #3D3934
 *   ② 卡片区（登录墙内）取自参考站**样式产物** `/assets/index-*.css`（未混淆，类名可直读）:
 *      `.my-works-grid` repeat(6, minmax(0,1fr)) gap 16 align-items start（≤某断点降 5 列）
 *      `.my-work-meta` absolute top 10 left 10, flex gap 9, z7, pointer-events none
 *      (本地精简: 只留能力名一个角标, 见下方渲染处的说明)
 *      `.my-work-card.selected` outline #6C5CE7; `.my-work-check` 选中 #6C5CE7
 *      `.my-works-selection-bar` 12px / #5B4BD7 on #F1EFFF / padding `10px 14px` / radius 9
 *      按钮 11px 白字 radius 999 padding `6px 10px`
 *      `.my-works-load-more` min-height 58 / 12px #9A958D
 *      `.my-works-empty` min-height 300 / #9A958D / align-content center / gap 8
 *      `.my-works-tabs` border-bottom #ECE9E3 gap 24, 按钮 14px/600 #8B8F9B padding `0 0 12px`
 *      `.my-works-filter-popover` 白底 radius12 padding16 shadow rgba(33,31,27,.14) 0 16px 36
 *      业务类型 330×318（分组多选）· 日期 308×229 · 状态 214×167 · 所属任务 318×159
 *
 * 诚实差异:
 *   - 「视频作品」页签按**产出模态**真实过滤（图生视频落地的产物），
 *     没有视频作品时说明视频来自哪项能力，不再弹「未接入视频」的假提示
 *   - 浮层内「重绘」工具列本地真实可跳转的工具页；未实现的项不出现
 *   - 所属任务筛选按**任务 ID / 能力名**检索本地真实任务（参考站为云端任务 ID）
 */

/** 参考站日期筛选的快捷项（本地按真实日期区间过滤） */
type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | 'custom';

const PAGE_SIZE = 24;

/**
 * 作品卡的图片比例。
 *
 * 用产出的真实宽高计算比例, 并夹在 3:4 ~ 16:9 之间: 常见产出正好铺满,
 * 极长竖图 / 超宽横幅只留少量边, 不裁掉内容。尺寸缺失时交给浏览器按
 * 图片自然比例排。
 */
function mediaAspect(width?: number | null, height?: number | null): string | undefined {
  if (!width || !height) return undefined;
  const ratio = width / height;
  const clamped = Math.min(16 / 9, Math.max(3 / 4, ratio));
  return String(clamped);
}

/**
 * 作品卡里的图片。
 *
 * - 加载中保留 shimmer 底、加载完成淡入，撤掉占位时不闪白；
 * - 加载失败可原地重试（签名 URL 过期 / 后端重启后无需刷新整页）；
 * - 状态按 **URL** 记而不是布尔值 —— 刷新列表会换签名地址，布尔值不会自己复位。
 *
 * 容器比例来自产出尺寸 (见 mediaAspect), 图片用 contain 填满, 不裁内容。
 */
function WorkImage({
  src,
  alt,
  priority,
  onOpen,
  aspect,
}: {
  src: string;
  alt: string;
  /** 首屏前两张: 不懒加载, 让作品页一进来就有图可看 */
  priority?: boolean;
  onOpen: () => void;
  /** 图片显示区的宽高比 (见 mediaAspect) */
  aspect?: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const loaded = loadedSrc === src;
  const failed = failedSrc === src;

  // 缓存命中时 load 可能早于监听挂载, 会永远停在 shimmer 上
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoadedSrc(src);
  }, [src, retryNonce]);

  const retry = () => {
    setFailedSrc(null);
    setLoadedSrc(null);
    setRetryNonce((n) => n + 1);
  };

  return (
    <button
      type="button"
      className={`my-work-image-button${loaded ? ' is-loaded' : ''}${failed ? ' is-failed' : ''}`}
      style={aspect ? { aspectRatio: aspect } : undefined}
      onClick={failed ? retry : onOpen}
      aria-label={failed ? '图片加载失败，点击重试' : `查看${alt}大图`}
      title={failed ? '加载失败，点击重试' : '点击查看大图'}
    >
      <img
        ref={imgRef}
        key={retryNonce}
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
      />
      {failed && (
        <span className="my-work-image-failed">
          <ImageOff size={18} />
          <small>加载失败，点击重试</small>
        </span>
      )}
    </button>
  );
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 任务产出的模态。
 *
 * 优先取产出文件自己的 `modality`（后端按产出的 mime 推导，是文件的真实形态）；
 * 还没产出（生成中 / 失败）时回落能力注册表里的 `modality` —— 否则视频任务在
 * 生成完成前会掉进「图片作品」，用户刚提交完就找不到它了。
 */
function taskModality(t: Task): Modality {
  return t.outputAsset?.modality ?? capabilityById(t.capability)?.modality ?? 'image';
}

export function WorksPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { data: caps } = useCapabilities();
  const reportError = useGenerateError();
  const retrySignal = usePollAbort();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败必须与「没有作品」分开存。
   *
   * 失败时不能只弹 `message.error` 再落进空态分支渲染「还没有作品」——
   * 用户看到"你还没有作品", 真相却是"接口没连上", 会以为作品丢了而反复重试。
   */
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'image' | 'video'>('image');

  // 四个筛选器（与参考站一致的多选/单选语义）
  const [bizOpen, setBizOpen] = useState(false);
  const [biz, setBiz] = useState<string[]>([]);
  const [dateOpen, setDateOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customRange, setCustomRange] = useState<[string, string]>(['', '']);
  const [statusOpen, setStatusOpen] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskPick, setTaskPick] = useState<string[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  /**
   * 大图查看器的当前下标 (null = 关闭)。
   *
   * 列表取**当前页签下所有已出图的图片作品**, 与网格同源: 在大图里按 ←/→
   * 翻的是用户此刻在页面上看到的那一组, 不会翻到另一个页签或别的筛选结果里。
   */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  /** 正在重试的任务 id：按钮显示进度，避免连点重复建单。 */
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await generateApi.list());
    } catch (e) {
      // 保留上一次数据: 刷新失败不该把已看到的作品清空
      setError((e as Error).message || '作品列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 依赖 token: 登录 / 退出都要重新拉取 (与 StatsPage 同构)
  useEffect(() => {
    if (!token) {
      // guest: 作品接口需鉴权, 不发无谓请求 —— 否则首屏会先闪一次「加载失败」
      setTasks([]);
      setLoading(false);
      return;
    }
    void load();
  }, [token, load]);

  const closeAll = () => {
    setBizOpen(false);
    setDateOpen(false);
    setStatusOpen(false);
    setTaskOpen(false);
  };

  /*
   * 点空白处 / 按 Esc 关闭筛选浮层。
   *
   * 之前只有 toolbar 的 onMouseLeave, 桌面端移出能关、移动端却关不掉：
   * 手指点空白不会触发 mouseleave, 浮层会一直盖在作品上。事件挂在 document
   * 上并排除 toolbar 内部 (浮层本身也在 toolbar 里), 选择筛选时不会误关。
   */
  useEffect(() => {
    if (!bizOpen && !dateOpen && !statusOpen && !taskOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('.my-works-toolbar')) return;
      setBizOpen(false);
      setDateOpen(false);
      setStatusOpen(false);
      setTaskOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBizOpen(false);
        setDateOpen(false);
        setStatusOpen(false);
        setTaskOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bizOpen, dateOpen, statusOpen, taskOpen]);

  // ── 真实过滤（全部基于本地任务数据，不做假筛选）──
  const filtered = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => {
      // 页签是第一道切分: 图片 / 视频互不混排
      if ((tab === 'video') !== (taskModality(t) === 'video')) return false;
      if (biz.length > 0 && !biz.includes(t.capability)) return false;
      if (status.length > 0) {
        const bucket = t.status === 'succeeded' ? 'succeeded' : t.status === 'failed' ? 'failed' : 'running';
        if (!status.includes(bucket)) return false;
      }
      if (taskPick.length > 0 && !taskPick.includes(t.id)) return false;
      const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      if (datePreset === 'today' && ts < startOfDay(now)) return false;
      if (datePreset === 'yesterday') {
        const y = startOfDay(now) - 86400000;
        if (ts < y || ts >= startOfDay(now)) return false;
      }
      if (datePreset === '7d' && ts < startOfDay(now) - 6 * 86400000) return false;
      if (datePreset === 'custom' && customRange[0] && customRange[1]) {
        const from = startOfDay(new Date(customRange[0]));
        const to = startOfDay(new Date(customRange[1])) + 86400000;
        if (ts < from || ts >= to) return false;
      }
      return true;
    });
  }, [tasks, tab, biz, status, taskPick, datePreset, customRange]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      ),
    [filtered],
  );

  const visible = sorted.slice(0, visibleCount);

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      sorted
        .filter((t) => t.outputAsset && taskModality(t) !== 'video')
        .map((t) => ({
          id: t.id,
          url: assetSrc(t.outputAsset)!,
          width: t.outputAsset?.width ?? null,
          height: t.outputAsset?.height ?? null,
          createdAt: t.createdAt,
        })),
    [sorted],
  );
  /**
   * 「张作品」只数有产出的卡片。
   *
   * 失败 / 生成中的任务仍在网格里 (用占位卡如实说明状态, 也能被「状态」筛选到),
   * 但它们不是作品。计数不能直接用 `sorted.length`, 否则一个失败任务就会让
   * 我的作品与素材库的生成图数量对不上。
   */
  const worksCount = useMemo(() => sorted.filter((t) => t.outputAsset).length, [sorted]);
  /*
   * 作品被删 / 筛选变化后, 大图查看器的下标可能指向不存在的项。
   * 越界就关掉, 而不是让查看器拿着 undefined 渲染一屏空白。
   */
  useEffect(() => {
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      return prev < lightboxItems.length ? prev : lightboxItems.length > 0 ? lightboxItems.length - 1 : null;
    });
  }, [lightboxItems.length]);

  const activeFilterCount =
    biz.length + status.length + taskPick.length + (datePreset === 'all' ? 0 : 1);

  const toggleIn = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const cardOf = (t: Task) => capabilityById(t.capability);

  /**
   * 删除作品。产出图与磁盘文件会一并删除且不可恢复，故必须二次确认 ——
   * hover 浮层里「下载」与「删除」相邻，误点一次就永久丢掉产出。
   */
  const removeTask = (id: string) => {
    modal.confirm({
      title: '删除这个作品？',
      content: '生成图与本地文件会一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await generateApi.remove(id);
          setTasks((prev) => prev.filter((t) => t.id !== id));
          setSelected((prev) => prev.filter((x) => x !== id));
          message.success('已删除作品及其生成图');
        } catch (e) {
          message.error((e as Error).message || '删除失败');
        }
      },
    });
  };

  /**
   * 失败任务重试（PRD F-20）。
   *
   * 直接用原任务的 capability / inputAssetIds / params 新建一次任务，
   * 而不是让用户回到工具页重新填一遍。失败任务在创建时扣过费、失败时已退款，
   * 因此这是一次**新的扣费**，确认框必须写明本次消耗。
   *
   * 输入素材被删除、能力已下线、或能力此刻没有可用通道时不做无意义提交：
   * 先告诉用户原因，再引导回对应工具页重新准备素材。
   */
  const retryTask = (t: Task) => {
    const def = caps?.items.find((c) => c.id === t.capability);
    if (!def) {
      message.warning('能力清单尚未加载完成，请稍后再试');
      return;
    }
    const rt = runtimeOf(def);
    if (rt.effective === 'disabled' || rt.effective === 'unavailable') {
      message.warning(rt.reason || '该能力当前不可提交，请稍后再试');
      return;
    }
    const inputs = t.inputAssetIds ?? [];
    if ((def.inputs ?? 0) > 0 && inputs.length < (def.inputs ?? 0)) {
      message.warning('原任务的输入素材已不存在，请回到工具页重新上传');
      navigate(toolPath(def.id));
      return;
    }

    const costText = def.creditCost > 0 ? `本次将消耗 ${def.creditCost} 积分` : '本次免费';
    modal.confirm({
      title: `重新生成「${def.name}」？`,
      content: `将沿用原任务的输入图与参数新建一次生成。${costText}；原失败任务已退回的积分不受影响。`,
      okText: '重新生成',
      cancelText: '取消',
      onOk: async () => {
        setRetryingId(t.id);
        try {
          const { taskId } = await generateApi.start({
            projectId: t.projectId,
            capability: t.capability,
            inputAssetIds: inputs,
            params: t.params ?? {},
          });
          // 先插一张进行中的卡，用户立刻能看到重试已被受理。
          setTasks((prev) => [
            {
              id: taskId,
              projectId: t.projectId,
              capability: t.capability,
              status: 'pending',
              inputAssetIds: inputs,
              params: t.params ?? {},
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
          const outcome = await waitForTask(taskId, { signal: retrySignal });
          if (outcome.ok && outcome.task.status === 'succeeded') {
            message.success('重试完成，作品已更新');
          } else if (outcome.ok) {
            message.error(`重试失败：${taskErrorText(outcome.task.errorCode)}`);
          }
          await load();
        } catch (e) {
          reportError(e);
          await load();
        } finally {
          setRetryingId(null);
          notifyCreditsChanged();
        }
      },
    });
  };

  const downloadSelected = () => {
    const list = tasks.filter((t) => selected.includes(t.id) && t.outputAsset);
    if (list.length === 0) {
      message.warning('请选择已生成成功的作品');
      return;
    }
    list.forEach((t, i) => {
      const url = assetSrc(t.outputAsset)!;
      if (!url) return;
      // 扩展名跟着产出的真实格式走: 视频是 mp4/webm, 写死 jpg 会让下载的文件打不开
      const ext = (t.outputAsset!.format || '').toLowerCase().replace(/^\./, '') || 'jpg';
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${t.capability}-${t.id.slice(-6)}.${ext}`;
        a.click();
      }, i * 220);
    });
    message.success(`已下载 ${list.length} 个文件`);
  };

  // 作品页只按「电商生图 / AI修图」分组, 与顶导/落地页口径一致 (参考站这两处均两组)。
    // 分组名直接取后端下发的 g.name, 不在前端硬编码中文名。
    // 业务类型随页签走: 图片页列出「电商生图 / AI修图」两组 (参考站口径),
    // 视频页列「AI视频」。不跟着切会让用户在视频页勾「商品主图」后永远筛出空。
    const bizGroups = useMemo(() => {
      const items = caps?.items ?? [];
      const groupIds =
        tab === 'video' ? ['ai_video'] : ['ecommerce_gen', 'ai_retouch'];
      return (caps?.groups ?? [])
        .filter((g) => groupIds.includes(g.id))
        .map((g) => ({ name: g.name, items: items.filter((i) => i.group === g.id) }))
        .filter((g) => g.items.length > 0);
    }, [caps, tab]);

  /**
   * 切页签要清掉业务类型筛选: 两个页签的能力集合不相交, 留着上一页的选择
   * 只会得到「没有符合条件」的空网格, 而用户刚点的只是一个页签。
   */
  const switchTab = (next: 'image' | 'video') => {
    setTab(next);
    setBiz([]);
    setVisibleCount(PAGE_SIZE);
  };

  const matchedTasks = useMemo(() => {
    const q = taskQuery.trim();
    if (!q) return tasks.slice(0, 20);
    return tasks
      .filter((t) => capabilityName(t.capability).includes(q) || t.id.includes(q))
      .slice(0, 20);
  }, [tasks, taskQuery]);

  /*
   * guest 态: 路由对外开放, 未登录也能进来。
   * 不误报「作品列表加载失败」(那是接口 401 的文案), 而是给登录入口。
   */
  if (!token) {
    return (
      <div className="my-works-page">
        <div className="my-works-head">
          <h1>我的作品</h1>
        </div>
        <div className="state-page">
          <StateEmpty
            title="登录后查看你的作品"
            desc="作品与账号绑定，登录后这里会列出你生成过的图片与视频。"
            action={
              <button type="button" className="state-btn is-primary" onClick={openLogin}>
                登录/注册
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="my-works-page">
      <div className="my-works-head">
        <h1>我的作品</h1>
        <div className="my-works-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'image'}
            className={tab === 'image' ? 'is-active' : ''}
            onClick={() => switchTab('image')}
          >
            图片作品
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'video'}
            className={tab === 'video' ? 'is-active' : ''}
            onClick={() => switchTab('video')}
          >
            视频作品
          </button>
        </div>
      </div>

      <div className="my-works-toolbar" onMouseLeave={closeAll}>
        {/* 业务类型（分组多选） */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${biz.length > 0 ? ' active' : ''}${bizOpen ? ' is-open' : ''}`}
            aria-expanded={bizOpen}
            onClick={() => {
              closeAll();
              setBizOpen((v) => !v);
            }}
          >
            业务类型
            {biz.length > 0 && <span className="my-works-filter-badge">{biz.length}</span>}
            <ChevronDown size={13} />
          </button>
          {bizOpen && (
            <div className="my-works-filter-popover my-works-business-popover">
              <div className="my-works-popover-head">
                <strong>业务类型</strong>
                <span>可多选 · 选择后立即生效</span>
              </div>
              <button
                type="button"
                className={`my-works-business-all${biz.length === 0 ? ' selected' : ''}`}
                onClick={() => setBiz([])}
              >
                <span className={`my-works-checkbox${biz.length === 0 ? ' on' : ''}`}>
                  {biz.length === 0 && <Check size={11} />}
                </span>
                全部
              </button>
              {bizGroups.map((g) => (
                <div key={g.name} className="my-works-option-group">
                  <span className="my-works-option-group-title">{g.name}</span>
                  <div className="my-works-option-chips">
                    {g.items.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className={`my-works-option-chip${biz.includes(i.id) ? ' selected' : ''}`}
                        onClick={() => toggleIn(biz, i.id, setBiz)}
                      >
                        {i.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 日期 */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${datePreset !== 'all' ? ' active' : ''}${dateOpen ? ' is-open' : ''}`}
            aria-expanded={dateOpen}
            onClick={() => {
              closeAll();
              setDateOpen((v) => !v);
            }}
          >
            日期
            <ChevronDown size={13} />
          </button>
          {dateOpen && (
            <div className="my-works-filter-popover my-works-date-popover">
              <div className="my-works-popover-head">
                <strong>日期</strong>
                <span>只精确到日期</span>
              </div>
              <div className="my-works-date-pills">
                {(
                  [
                    ['all', '全部'],
                    ['today', '今天'],
                    ['yesterday', '昨天'],
                    ['7d', '近 7 天'],
                  ] as [DatePreset, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={datePreset === v ? 'selected' : ''}
                    onClick={() => setDatePreset(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="my-works-custom-date">
                <span className="my-works-custom-date-label">自定义日期范围</span>
                <div className="my-works-date-fields">
                  <input
                    type="date"
                    value={customRange[0]}
                    onChange={(e) => setCustomRange([e.target.value, customRange[1]])}
                  />
                  <span>至</span>
                  <input
                    type="date"
                    value={customRange[1]}
                    onChange={(e) => setCustomRange([customRange[0], e.target.value])}
                  />
                </div>
                <span className="my-works-custom-date-hint">包含开始日和结束日</span>
              </div>
            </div>
          )}
        </div>

        {/* 状态 */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${status.length > 0 ? ' active' : ''}${statusOpen ? ' is-open' : ''}`}
            aria-expanded={statusOpen}
            onClick={() => {
              closeAll();
              setStatusOpen((v) => !v);
            }}
          >
            状态
            <ChevronDown size={13} />
          </button>
          {statusOpen && (
            <div className="my-works-filter-popover my-works-status-popover">
              <div className="my-works-popover-head">
                <strong>状态</strong>
                <span>按作品状态筛选</span>
              </div>
              <div className="my-works-status-pills">
                {(
                  [
                    ['succeeded', '成功'],
                    ['running', '生成中'],
                    ['failed', '失败'],
                  ] as [string, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={status.includes(v) ? 'selected' : ''}
                    onClick={() => toggleIn(status, v, setStatus)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 所属任务 */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${taskPick.length > 0 ? ' active' : ''}${taskOpen ? ' is-open' : ''}`}
            aria-expanded={taskOpen}
            onClick={() => {
              closeAll();
              setTaskOpen((v) => !v);
            }}
          >
            所属任务
            <ChevronDown size={13} />
          </button>
          {taskOpen && (
            <div className="my-works-filter-popover my-works-task-popover">
              <div className="my-works-popover-head">
                <strong>所属任务</strong>
                <span>支持任务 ID 或能力名称搜索</span>
              </div>
              <label className="my-works-task-search">
                <Search size={13} />
                <input
                  value={taskQuery}
                  placeholder="搜索任务"
                  onChange={(e) => setTaskQuery(e.target.value)}
                />
              </label>
              <div className="my-works-task-list">
                <button
                  type="button"
                  className={taskPick.length === 0 ? 'selected' : ''}
                  onClick={() => setTaskPick([])}
                >
                  全部任务
                </button>
                {matchedTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={taskPick.includes(t.id) ? 'selected' : ''}
                    onClick={() => toggleIn(taskPick, t.id, setTaskPick)}
                  >
                    <span>{capabilityName(t.capability)}</span>
                    <small>{t.id.slice(-8)}</small>
                  </button>
                ))}
                {matchedTasks.length === 0 && <span className="my-works-task-empty">无匹配任务</span>}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="my-works-download"
          disabled={selected.length === 0}
          onClick={downloadSelected}
        >
          <Download size={13} /> 选择下载{selected.length > 0 ? ` (${selected.length})` : ''}
        </button>

        {activeFilterCount > 0 && (
          <button
            type="button"
            className="my-works-filter-clear"
            onClick={() => {
              setBiz([]);
              setStatus([]);
              setTaskPick([]);
              setDatePreset('all');
              setCustomRange(['', '']);
            }}
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 多选操作条（选择任一卡片后出现，实测 spec: #5B4BD7 on #F1EFFF） */}
      {selected.length > 0 && (
        <div className="my-works-selection-bar">
          <span>已选 {selected.length} 个作品</span>
          <button type="button" onClick={downloadSelected}>
            <Download size={11} /> 下载所选
          </button>
          <button
            type="button"
            className="my-works-selection-exit"
            onClick={() => setSelected([])}
          >
            取消选择
          </button>
        </div>
      )}

      <div className="my-works-count-row">
        <span>
          {worksCount} {tab === 'video' ? '个视频' : '张作品'}
          {sorted.length > worksCount && (
            <em className="my-works-count-extra">
              {/* 失败 / 生成中的任务仍在网格里, 但不算作品 —— 在这里说清楚, 不藏 */}
              {' · 另有 '}
              {sorted.length - worksCount}
              {' 个未出图任务'}
            </em>
          )}
        </span>
        <span className="my-works-sort-label">按创作日期倒序</span>
        <button type="button" className="my-works-refresh" onClick={() => void load()}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      {loading ? (
        /* 骨架屏占住卡片网格的形状 —— 内容到达时零位移;
           否则网格区域会先塌陷再撑开, 页面明显跳动。 */
        <StateSkeleton variant="card" count={12} columns={6} />
      ) : error ? (
        /* 失败态与空态必须分开: 「没连上」不是「没有作品」 */
        <StateError
          title="作品列表加载失败"
          desc="没能取回你的作品列表。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      ) : visible.length === 0 ? (
        <div className="my-works-empty">
          <h2>
            {activeFilterCount === 0
              ? tab === 'video'
                ? '还没有视频作品'
                : '还没有作品'
              : tab === 'video'
                ? '没有符合条件的视频'
                : '没有符合条件的作品'}
          </h2>
          <p>
            {activeFilterCount > 0
              ? '试试放宽筛选条件，或清除全部筛选。'
              : tab === 'video'
                ? '视频作品来自「图生视频」能力，完成后会出现在这里。'
                : '完成一次创作后，作品会出现在这里。'}
          </p>
        </div>
      ) : (
        <>
          <div className="my-works-grid">
            {visible.map((t, cardIndex) => {
              const url = t.outputAsset ? assetSrc(t.outputAsset) : undefined;
              const isSel = selected.includes(t.id);
              const isVideo = taskModality(t) === 'video';
              const def = cardOf(t);
              // 大图列表里的下标: 只有图片作品进查看器, 视频没有可翻的静态原图
              const previewAt = url && !isVideo ? lightboxItems.findIndex((x) => x.id === t.id) : -1;
              return (
                <article key={t.id} className={`my-work-card${isSel ? ' selected' : ''}`}>
                  {/*
                    图片点开大图查看器; 视频直接给可播放的播放器 (原生控件不能被
                    <button> 包住); 「用它再做一张」留在 hover 浮层里。
                  */}
                  <div
                    className={`my-work-media${isVideo ? ' is-video' : ''}${!url ? ' is-placeholder' : ''}`}
                  >
                    {url ? (
                      isVideo ? (
                        <ResultMedia
                          url={url}
                          modality="video"
                          // 视频没有容器元数据可写, 显式标识只能由播放器侧补 (图片已烙进像素)
                          aigc={t.outputAsset?.aigc}
                          alt={capabilityName(t.capability)}
                        />
                      ) : (
                        <WorkImage
                          src={url}
                          alt={capabilityName(t.capability)}
                          priority={cardIndex < 2}
                          aspect={mediaAspect(t.outputAsset?.width, t.outputAsset?.height)}
                          onOpen={() => {
                            if (previewAt >= 0) setPreviewIndex(previewAt);
                          }}
                        />
                      )
                    ) : (
                      <span className="my-work-image-placeholder">
                        {t.status === 'failed' ? (
                          <>
                            <ImageOff size={18} />
                            <strong>生成失败</strong>
                            <small>{taskErrorText(t.errorCode)}</small>
                            {def && (
                              <button
                                type="button"
                                className="my-work-placeholder-retry"
                                disabled={retryingId === t.id}
                                title={
                                  runtimeOf(def).effective === 'unavailable'
                                    ? runtimeOf(def).reason || '该能力暂无可用模型通道'
                                    : runtimeOf(def).effective === 'disabled'
                                      ? runtimeOf(def).reason || '该能力已下线'
                                      : '沿用原参数重新生成'
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryTask(t);
                                }}
                              >
                                {retryingId === t.id ? (
                                  <Loader2 size={12} className="my-work-generating-spinner" />
                                ) : (
                                  <RefreshCw size={12} />
                                )}
                                {retryingId === t.id ? '重试中…' : '重试'}
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <Loader2 size={18} className="my-work-generating-spinner" />
                            <strong>生成中</strong>
                            <small>完成后会自动出现在这里</small>
                          </>
                        )}
                      </span>
                    )}

                    {/*
                      角标只留能力名。缩略图上的信息以「这张图是什么」为主;
                      来源与状态在作品详情 / 占位图里表达, 不重复叠加。
                    */}
                    <span className="my-work-meta">
                      <span className="my-work-tag">{capabilityName(t.capability)}</span>
                    </span>

                    {/* hover 浮层: 顶部再来一张 / 底部操作。无产出的任务只能删除,
                        不能显示一个实际不会下载任何文件的「下载」。 */}
                    <span className={`my-work-hover-actions${url ? '' : ' is-placeholder'}`}>
                      {url && (
                        <span className="my-work-hover-top">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (def) navigate(toolPath(def.id));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (def) navigate(toolPath(def.id));
                              }
                            }}
                          >
                            <Sparkles size={12} /> 再来一张
                          </span>
                        </span>
                      )}
                      <span className="my-work-hover-bottom">
                        {url && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              // 真下载: 用 a[download] 触发, 移动端也能保存
                              const ext =
                                (t.outputAsset!.format || '').toLowerCase().replace(/^\./, '') ||
                                (isVideo ? 'mp4' : 'jpg');
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${t.capability}-${t.id.slice(-6)}.${ext}`;
                              a.click();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                window.open(url, '_blank', 'noopener');
                              }
                            }}
                          >
                            下载
                          </span>
                        )}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => removeTask(t.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              removeTask(t.id);
                            }
                          }}
                        >
                          <Trash2 size={12} /> 删除
                        </span>
                      </span>
                    </span>
                  </div>

                  {/* 勾选（多选下载） */}
                  {/* 没有产出的失败 / 生成中任务不能勾选: 下载的是文件, 不能把
                      「任务」当成作品选中, 否则会提示下载 0 个文件。 */}
                  {url && (
                    <label className="my-work-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleIn(selected, t.id, setSelected)}
                      />
                      <span>{isSel && <Check size={11} />}</span>
                    </label>
                  )}

                  <div className="my-work-caption">
                    <small>
                      {t.createdAt
                        ? new Date(t.createdAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })
                        : ''}
                      {t.outputAsset ? ` · ${t.outputAsset.width}×${t.outputAsset.height}` : ''}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>

          {/* 大图查看器: 与结果栏同一套 (缩放 / 拖拽 / ←→ 翻页 / Esc 关闭) */}
          {previewIndex !== null && lightboxItems[previewIndex] && (
            <ImageLightbox
              items={lightboxItems}
              index={previewIndex}
              onIndexChange={setPreviewIndex}
              onClose={() => setPreviewIndex(null)}
            />
          )}

          {visibleCount < sorted.length && (
            <button
              type="button"
              className="my-works-load-more"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              <ChevronDown size={14} /> 加载更多（剩余 {sorted.length - visibleCount} 个）
            </button>
          )}
        </>
      )}
    </div>
  );
}
