import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { App, Spin } from 'antd';
import {
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Maximize2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { toAbsoluteUrl } from '../lib/api';
import { ImageLightbox } from './ImageLightbox';
import { ImageContextMenu, type ImageMenuItem } from './ImageContextMenu';
import { ToolEmptyState } from './ToolEmptyState';
import type { GalleryItem } from '../hooks/useResultGallery';

/**
 * 结果栏「全部生成图」网格。
 *
 * 自由创作页与商品主图 / 详情 / 爆款复刻页共用这套交互 —— 网格 + 每行张数 +
 * 缩略图点击看大图 + 右键菜单 + 生成中占位, 不再各页复制一份。
 *
 * 组件只负责**展示与本地交互** (列数偏好、大图、右键菜单):
 *   - 数据由调用方经 useResultGallery 提供, 这里不碰接口;
 *   - 「删除」与「额外动作」都由调用方接管 —— 删除要连带素材/参考图位,
 *     各页的连带关系不同, 组件不该猜。
 *
 * 展示口径两页一致: 缩略图方形裁切 (出图比例不一, 方形网格最整齐),
 * 点开看**原始比例**, 新图由调用方 prepend 插到首位。
 */

/** 每行张数 (用户要求"一行显示图片数量可调") */
const GRID_COL_OPTIONS = [3, 4, 5, 6] as const;
const DEFAULT_GRID_COLS = 4;
/**
 * 首屏优先加载的缩略图张数。
 *
 * 网格默认 4 列, 一屏通常能看到 4~12 张; 超过这个数量的图仍然懒加载。
 * 全部 eager 会和首屏竞争带宽 (2K 原图一张就是几 MB), 反而更慢。
 */
const PRIORITY_THUMBS = 8;
/**
 * 列数偏好按**本机**记在 localStorage (不进后端)。
 * 两页共用同一个 key: 这是「我习惯每行看几张」的视口偏好, 不是某一页的设置。
 */
const GRID_COLS_STORAGE_KEY = 'fc.resultCols';

function readGridCols(): number {
  try {
    const saved = Number(window.localStorage.getItem(GRID_COLS_STORAGE_KEY));
    if ((GRID_COL_OPTIONS as readonly number[]).includes(saved)) return saved;
  } catch {
    // 私密窗口 / 存储被禁用: 用默认值, 不影响页面渲染
  }
  return DEFAULT_GRID_COLS;
}

/**
 * 结果网格中的一张图卡。
 *
 * 图片解码完成前保持与「生成中占位」**完全一致的 shimmer 底**, 加载完成后再淡入 ——
 * 否则占位撤下的瞬间会先露出一块空白底色, 图片随后突然跳出, 形成一次闪白。
 *
 * 失败后可以原地重试: 签名 URL 过期 (410) 或后端重启导致一次请求失败时,
 * 点「重试」即可; 重试用 key 变化强制浏览器重新发请求 (同一个 src 直接
 * setState 不会重试)。
 */
function GalleryThumb({
  item,
  onOpen,
  onContextMenu,
  priority,
}: {
  item: GalleryItem;
  onOpen: () => void;
  /** 右键: 由调用方决定打开哪个菜单; 这里只负责接管系统菜单 */
  onContextMenu: (e: ReactMouseEvent) => void;
  /** 首屏前几张: 不做懒加载, 让用户一进来就能看到图, 而不是等到滚动才请求 */
  priority?: boolean;
}) {
  /*
   * 加载状态**按 URL 派生**, 而不是只存布尔值:
   * 刷新列表后同一张图会带着新的签名 URL 回来, 组件按 id 复用;
   * 若沿用上一张的布尔状态, 新 URL 会以「已加载」的样子出现一帧空白,
   * 或者把上一张的「失败」一直挂在新的 URL 上 (重试也没用)。
   */
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const loaded = loadedUrl === item.url;
  const failed = failedUrl === item.url;
  /** 失败后自增, 作为 key 让浏览器丢弃旧请求重新拉一次 */
  const [retryNonce, setRetryNonce] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);

  /*
   * 缓存兜底: 图片已在缓存里时 load 可能早于监听, 会一直停在 shimmer 占位。
   * 每次换图/重试后查一次 complete 直接落定。
   */
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) setLoadedUrl(item.url);
  }, [item.url, retryNonce]);

  const retry = () => {
    setFailedUrl(null);
    setLoadedUrl(null);
    setRetryNonce((n) => n + 1);
  };

  return (
    <button
      type="button"
      className={`fc-result-item${loaded ? ' is-loaded' : ''}${failed ? ' is-failed' : ''}`}
      title={failed ? '图片加载失败，点击重试' : '点击查看大图，右键更多操作'}
      aria-label={
        failed ? '图片加载失败，点击重试' : item.caption ? `查看${item.caption}大图` : '查看生成图大图'
      }
      onClick={failed ? retry : onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
    >
      <img
        ref={imgRef}
        key={retryNonce}
        src={item.url}
        alt={item.caption ? `${item.caption}生成图` : '生成图'}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoadedUrl(item.url)}
        onError={() => setFailedUrl(item.url)}
      />
      {item.caption && <span className="fc-result-item-caption">{item.caption}</span>}
      {failed && (
        <span className="fc-result-item-error">
          <X size={18} />
          <span>加载失败，点击重试</span>
        </span>
      )}
      {!failed && (
        <span className="fc-result-item-mask">
          <Maximize2 size={16} />
        </span>
      )}
    </button>
  );
}

export interface ResultGalleryPaneProps {
  /** 标题文字 (如「全部生成图」/「生成结果」) */
  title: string;
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息; 非空时保留已有列表并提示, 不清空成空态 */
  error?: string | null;
  /** 标题下方的提示行 (最近一次失败原因等), 由页面决定是否出现 */
  notice?: ReactNode;
  /** 生成中占位: 每项一张虚线卡, 文案取 label (如「白底图」) */
  pending?: Array<{ key: string; label?: string }>;
  /** 空态 */
  emptyTitle: string;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  /** 未登录 (无数据源) 时是否仍渲染空态插画 */
  onRefresh: () => void;
  /** 删除一张 —— 接口调用与连带清理由页面负责 */
  onDelete: (item: GalleryItem) => void;
  /** 追加的右键动作 (如「用作参考图」) */
  extraActions?: (item: GalleryItem) => ImageMenuItem[];
  /** 下载文件名前缀, 仅影响另存的文件名 */
  downloadNamePrefix?: string;
}

export function ResultGalleryPane({
  title,
  items,
  loading,
  error,
  notice,
  pending = [],
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onRefresh,
  onDelete,
  extraActions,
  downloadNamePrefix = 'generated',
}: ResultGalleryPaneProps) {
  const { message } = App.useApp();
  const [cols, setCols] = useState<number>(readGridCols);
  /*
   * 大图预览按**索引**保存, 而不是按对象: 查看器要支持 ←/→ 翻页,
   * 索引天然跟随同一个列表; 按对象保存翻页时还得反查下标, 列表刷新后
   * 还可能指向一个已经不在页面上的旧对象。
   */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  /** 右键菜单的锚点与目标图 (index 指向 items) */
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  /**
   * 已完成 (有 url) 的项。生成中的任务也会出现在 items 里 (离开页面再回来时
   * 由服务端状态回填), 它们没有 url, 只能渲染成占位卡, 也不能进大图查看器。
   */
  const readyItems = useMemo(() => items.filter((item) => Boolean(item.url)), [items]);
  const activeCount = items.length - readyItems.length;

  const changeCols = useCallback((next: number) => {
    setCols(next);
    try {
      window.localStorage.setItem(GRID_COLS_STORAGE_KEY, String(next));
    } catch {
      // 存不了只影响"下次打开还记得", 本次切换照常生效
    }
  }, []);

  // 列表变化后, 越界的预览索引要收敛, 否则删完最后一张查看器会指向 undefined
  useEffect(() => {
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      if (readyItems.length === 0) return null;
      return Math.min(prev, readyItems.length - 1);
    });
  }, [readyItems.length]);

  const openMenu = useCallback((x: number, y: number, index: number) => {
    setMenu({ index, x, y });
  }, []);

  const copyImageUrl = async (item: GalleryItem) => {
    // 复制绝对地址: 站内的相对路径 (/uploads/...) 贴到别处打不开
    const url = toAbsoluteUrl(item.url) || item.url;
    try {
      await navigator.clipboard.writeText(url);
      message.success('图片地址已复制');
    } catch {
      // 非安全上下文 (局域网 http) 或用户拒绝授权时 clipboard 会失败
      message.warning(`复制失败，请手动复制：${url}`);
    }
  };

  const downloadImage = (item: GalleryItem) => {
    // 扩展名跟真实格式走: 厂商返回的链接常常没有后缀, 猜后缀会把 PNG 存成 .jpg
    const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
    const a = document.createElement('a');
    a.href = item.url;
    a.download = `${downloadNamePrefix}-${item.id.slice(-6)}.${ext}`;
    a.click();
  };

  const isEmpty = items.length === 0 && pending.length === 0;
  const showLoading = loading && isEmpty;
  const showEmpty = !loading && isEmpty;

  /*
   * 提示行 (加载失败 / 最近一次失败的变体数) 在**两个分支都要出现**:
   * 首次就全失败时网格是空的, 若只挂在网格分支里, 用户看到的是那句
   * 「提交任务后，生成结果将在此处展示」—— 明明刚提交过。
   * 分支内渲染以沿用各自的容器 (白卡片 / 空态卡), 不做跨分支浮层。
   */
  const noticeNode =
    !showLoading && (error || notice) ? (
      <>
        {error && <p className="tool-submit-notice tool-submit-notice-error">历史生成图加载失败：{error}</p>}
        {notice}
      </>
    ) : null;

  return (
    <section className="pk-result-pane">
      {showLoading ? (
        <div className="fc-result-loading">
          <Spin />
        </div>
      ) : showEmpty ? (
        <ToolEmptyState title={emptyTitle} desc={emptyDesc}>
          {emptyChildren}
          {noticeNode && <div className="pk-result-notice pk-result-notice-standalone">{noticeNode}</div>}
        </ToolEmptyState>
      ) : (
        <div className="pk-result-body">
          <div className="pk-result-toolbar">
            <div className="pk-result-title">
              {title}
              {readyItems.length > 0 && <span className="pk-result-count">{readyItems.length} 张</span>}
            </div>
            <div className="fc-result-actions">
              {/* 每行张数: 3~6 可选, 选择记在本机 —— 出图比例不一时用户可以自己决定看几张 */}
              <div className="fc-grid-size" role="group" aria-label="每行显示图片数量">
                <span className="fc-grid-size-label">每行</span>
                {GRID_COL_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`fc-grid-size-btn${cols === n ? ' is-active' : ''}`}
                    aria-pressed={cols === n}
                    title={`每行显示 ${n} 张`}
                    onClick={() => changeCols(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button type="button" className="pk-result-regen" disabled={loading} onClick={onRefresh}>
                <RefreshCw size={13} />
                {loading ? '刷新中' : '刷新'}
              </button>
            </div>
          </div>
          {noticeNode}
          <div className={`fc-result-gallery fc-cols-${cols}`}>
            {/* 生成中占位: 提交后立刻出现在网格首位, 与真实图同尺寸,
                出图后由调用方 prepend 的新图顶替 —— 不让「已提交 → 出图」之间出现空窗。 */}
            {pending.length > 0 && activeCount === 0 && pending.map((p) => (
              <div
                key={p.key}
                className="fc-result-item fc-result-item-loading"
                role="status"
                aria-label={p.label ? `正在生成${p.label}` : '正在生成'}
              >
                <ImagePlus size={22} />
                <span className="fc-result-item-loading-tip">{p.label ? `正在生成${p.label}…` : '正在生成…'}</span>
              </div>
            ))}
            {items.map((item, i) =>
              item.url ? (
                <GalleryThumb
                  key={item.id}
                  item={item}
                  priority={i < PRIORITY_THUMBS}
                  onOpen={() => setPreviewIndex(readyItems.findIndex((x) => x.id === item.id))}
                  onContextMenu={(e) => openMenu(e.clientX, e.clientY, i)}
                />
              ) : (
                <div
                  key={item.id}
                  className="fc-result-item fc-result-item-loading"
                  role="status"
                  aria-label={item.caption ? `正在生成${item.caption}` : '正在生成'}
                >
                  <ImagePlus size={22} />
                  <span className="fc-result-item-loading-tip">
                    {item.caption ? `正在生成${item.caption}…` : '正在生成…'}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* 生成图大图查看器 (点缩略图打开; 整屏、可缩放、可翻页) */}
      {previewIndex !== null && readyItems[previewIndex] && (
        <ImageLightbox
          items={readyItems}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onItemContextMenu={(pos, i) => {
            const target = readyItems[i];
            const fullIndex = target ? items.findIndex((x) => x.id === target.id) : -1;
            if (fullIndex >= 0) openMenu(pos.x, pos.y, fullIndex);
          }}
        />
      )}

      {/* 结果图右键菜单 (缩略图与查看器共用同一套动作) */}
      {menu && items[menu.index] && (
        <ImageContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={buildMenuItems()}
        />
      )}
    </section>
  );

  function buildMenuItems(): ImageMenuItem[] {
    if (!menu) return [];
    const item = items[menu.index];
    if (!item) return [];
    const extras = extraActions?.(item) ?? [];
    return [
      {
        key: 'view',
        label: '查看大图',
        icon: Maximize2,
        onSelect: () => {
          const index = readyItems.findIndex((x) => x.id === item.id);
          if (index >= 0) setPreviewIndex(index);
        },
      },
      ...extras,
      {
        key: 'open',
        label: '在新标签页打开',
        icon: ExternalLink,
        onSelect: () => {
          const url = toAbsoluteUrl(item.url) || item.url;
          window.open(url, '_blank', 'noopener');
        },
      },
      {
        key: 'copy',
        label: '复制图片地址',
        icon: Copy,
        onSelect: () => void copyImageUrl(item),
      },
      {
        key: 'download',
        label: '下载原图',
        icon: Download,
        onSelect: () => downloadImage(item),
      },
      {
        key: 'delete',
        label: '删除这张作品',
        icon: Trash2,
        danger: true,
        divider: true,
        onSelect: () => onDelete(item),
      },
    ];
  }
}
