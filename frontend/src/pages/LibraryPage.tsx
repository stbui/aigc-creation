import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  LayoutGrid,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { assetsApi, assetSrc, assetThumbSrc, projectsApi } from '../lib/api';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
} from '../lib/constants';
import { capabilityName, toolPath } from '../lib/capabilities';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useProject } from '../hooks/useProject';
import { ResultMedia, modalityOfFormat } from '../components/ResultMedia';
import { ImageLightbox, type LightboxItem } from '../components/ImageLightbox';
import { useCapabilities } from '../hooks/useCapabilities';
import { StateError, StateSkeleton } from '../components/StateViews';
import type { Asset, Project } from '../types/api';
import {
  Button,
  Checkbox,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  Popconfirm,
  Select,
  StatusBadge,
  Surface,
  SurfaceContent,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  ToggleGroup,
  cn,
  useApp,
} from '../ui';

/**
 * 素材库页面。完整视觉与文案规范见 `docs/library-design.md`。
 *
 * 页面只通过 `../ui` 使用 shadcn / Radix 组合件；分组按已有的
 * projectId / capability / createdAt 在客户端聚合，不额外发明素材文件夹契约。
 * 图片网格使用直角纯图卡，上传原图带常驻标记，操作按钮在 hover、键盘聚焦
 * 和触屏环境显示。
 */

const PAGE_SIZE = 20;
type Kind = 'all' | 'original' | 'generated';
/** 分组依据。'none' = 不分组，只在面板上给切换入口 */
type GroupBy = 'none' | 'project' | 'capability' | 'date';

interface AssetGroup {
  key: string;
  label: string;
  count: number;
  sort: number;
}

/** 日期分组：今天 / 昨天 / 近 7 天 / 更早。按本地时区切日，与作品页的日期筛选同口径 */
function dateBucket(iso: string): { key: string; label: string; sort: number } {
  const ts = new Date(iso).getTime();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  if (ts >= today) return { key: 'today', label: '今天', sort: 0 };
  if (ts >= today - 86400000) return { key: 'yesterday', label: '昨天', sort: 1 };
  if (ts >= today - 6 * 86400000) return { key: 'week', label: '近 7 天', sort: 2 };
  return { key: 'earlier', label: '更早', sort: 3 };
}

export function LibraryPage() {
  useDocumentMeta('素材库 · 货觉AI', '管理上传的原图与生成图，支持分组、下载与删除。');
  const { message } = useApp();
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { ensureProject } = useProject();
  const { data: caps } = useCapabilities();
  const fileRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);

  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<Kind>('all');
  const [capability, setCapability] = useState('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败与「素材库为空」必须分开 (2026-10-20 修)。
   * 此前失败只弹 message.error, 随后照样渲染「素材库还是空的」——
   * 用户以为没上传过素材, 真相是接口没连上。
   */
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  /** 大图查看器下标；null = 关闭。只收录图片素材，视频继续使用原生播放器。 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /*
   * 外部入口: 浏览器扩展保存后跳 `/asset-library?projectId=xxx`，直接落在
   * 刚采集进的那个分组上。惰性初始化是为了首帧就分组，不闪一下「全部」。
   */
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');

  /** 分组依据与当前选中的分组（null = 全部分组） */
  const [groupBy, setGroupBy] = useState<GroupBy>(projectIdParam ? 'project' : 'none');
  const [groupKey, setGroupKey] = useState<string | null>(projectIdParam);
  /** 项目名映射：按项目分组时要显示名字，只有 id 的分组没人看得懂 */
  const [projects, setProjects] = useState<Project[]>([]);

  /*
   * 切换维度/能力/分组后清空勾选：批量下载只应作用于当前可见集合，
   * 否则用户会把屏幕上看不到、无法核对的素材一起下载。
   */
  useEffect(() => {
    setSelected([]);
  }, [kind, capability, groupBy, groupKey]);

  // 项目列表只在真的要按项目分组时拉: 素材页的主路径是看图，不为一个辅助视图多发一次请求
  useEffect(() => {
    if (!token) return;
    if (groupBy !== 'project' || projects.length > 0) return;
    let alive = true;
    projectsApi
      .list()
      .then((list) => {
        if (alive) setProjects(list);
      })
      .catch(() => {
        /* 拉不到项目名就用 id 兜底，不阻断素材浏览 */
      });
    return () => {
      alive = false;
    };
  }, [groupBy, projects.length, token]);

  /*
   * 站内跳转 (已在素材库时再点扩展的通知) 不会重建组件，惰性初始化不生效，
   * 故再跟一次参数变化。用户随后手动换分组不受影响 —— 参数没变就不会再触发。
   */
  useEffect(() => {
    if (!projectIdParam) return;
    setGroupBy('project');
    setGroupKey(projectIdParam);
  }, [projectIdParam]);

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
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = {
      kind: kind === 'all' ? undefined : kind,
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
    setTotal(first.total);
    setVisible(PAGE_SIZE);
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
  }, [kind, capability, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // 页面卸载后后台翻页可能还在跑: 让序号失效, 停止后续 setState
  useEffect(() => () => {
    loadSeq.current += 1;
  }, []);

  /** 单个素材的所属分组（键 / 显示名 / 排序位） */
  const groupOf = useCallback(
    (a: Asset): { key: string; label: string; sort: number } => {
      if (groupBy === 'project') {
        const name = projects.find((p) => p.id === a.projectId)?.name;
        // 项目名还没拉回来时用 id 尾号兜底, 不留空标签
        return { key: a.projectId, label: name ?? `项目 ${a.projectId.slice(-6)}`, sort: 0 };
      }
      if (groupBy === 'capability') {
        if (!a.capability) return { key: '__none', label: '未关联能力', sort: 999 };
        return { key: a.capability, label: capabilityName(a.capability), sort: 0 };
      }
      return dateBucket(a.createdAt);
    },
    [groupBy, projects],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [] as AssetGroup[];
    const map = new Map<string, AssetGroup>();
    for (const a of items) {
      const { key, label, sort } = groupOf(a);
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { key, label, count: 1, sort });
    }
    return [...map.values()].sort(
      (x, y) => x.sort - y.sort || x.label.localeCompare(y.label, 'zh-CN'),
    );
  }, [items, groupBy, groupOf]);

  // 分组不存在（换了分组依据 / 素材被删）时自动回到「全部」, 不留一个筛不出东西的选中态
  const activeGroup = groups.some((g) => g.key === groupKey) ? groupKey : null;
  const shown = useMemo(
    () => (activeGroup ? items.filter((a) => groupOf(a).key === activeGroup) : items),
    [items, activeGroup, groupOf],
  );

  /** 空态不是一种状态：游客、真实空库、筛选无结果显示不同的原因与下一步。 */
  const hasActiveFilters = kind !== 'all' || capability !== 'all' || activeGroup !== null;
  const emptyState = !token
    ? {
        title: '登录后管理素材',
        description: '上传原图或生成图片后，可在这里统一筛选、预览和下载。',
        action: '登录并上传',
      }
    : hasActiveFilters
      ? {
          title: '没有符合条件的素材',
          description: '换个来源、能力或分组条件试试。',
          action: '清除筛选',
        }
      : {
          title: '还没有素材',
          description: '上传原图后，可在这里统一筛选、预览和下载。',
          action: '上传素材',
        };

  /** 与作品页同源：查看器只收录当前筛选/分组下的图片，支持左右键连续翻看。 */
  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      shown
        .filter((a) => modalityOfFormat(a.format) !== 'video')
        .flatMap((a) => {
          const url = assetSrc(a);
          if (!url) return [];
          return [{
            id: a.id,
            url,
            alt: `${capabilityName(a.capability)} 素材`,
            width: a.width ?? null,
            height: a.height ?? null,
            createdAt: a.createdAt,
            meta: [
              a.kind === 'generated' ? '生成图' : '原图',
              a.sourceTitle?.trim() || null,
              a.capability ? capabilityName(a.capability) : null,
            ].filter((value): value is string => Boolean(value)),
          }];
        }),
    [shown],
  );

  // 筛选/分组切换或删除素材后，当前下标可能已失效；收敛到最近一张，列表为空则关闭。
  useEffect(() => {
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      return prev < lightboxItems.length ? prev : lightboxItems.length > 0 ? lightboxItems.length - 1 : null;
    });
  }, [lightboxItems.length]);

  /*
   * 上传前先自检。此前素材库只按 MIME 过滤, 于是把任意文件改名为 .png 就能
   * "上传成功" —— 卡片是破图、尺寸显示 —×—、体积 12288KB, 还提示
   * 「已上传 1 张素材」。坏图随后会进入生成链路, 而且运营不知道该信哪里的限制。
   *
   * 三道检查: 类型 / 体积 / **能否真正解码**(决定它是不是一张图片)。
   * 体积上限与工具页共用同一个常量, 不再各写一套。
   */
  const upload = async (files: FileList | File[]) => {
    const picked = Array.from(files);
    const list = picked.filter(isSupportedImageFile);
    if (list.length === 0) {
      message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    if (list.length < picked.length) {
      message.warning(`已忽略 ${picked.length - list.length} 个非图片文件`);
    }
    const oversize = list.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (oversize.length > 0) {
      message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((f) => f.name).join('、')}`);
      return;
    }
    const undecodable: string[] = [];
    for (const f of list) {
      try {
        const bitmap = await createImageBitmap(f);
        bitmap.close();
      } catch {
        undecodable.push(f.name);
      }
    }
    if (undecodable.length > 0) {
      message.error(`这些文件不是有效图片：${undecodable.join('、')}`);
      return;
    }
    setUploading(true);
    try {
      const projectId = await ensureProject();
      for (const f of list) await assetsApi.upload(f, projectId);
      message.success(`已上传 ${list.length} 张素材`);
      await load();
    } catch (e) {
      message.error((e as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await assetsApi.remove(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setSelected((prev) => prev.filter((x) => x !== id));
      message.success(res.removedTasks > 0 ? '已删除素材及其作品记录' : '已删除素材');
    } catch (e) {
      message.error((e as Error).message || '删除失败');
    }
  };

  const downloadAsset = (a: Asset) => {
    const url = assetSrc(a);
    if (!url) return;
    const ext = (a.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
    const el = document.createElement('a');
    el.href = url;
    el.download = `asset-${a.id.slice(-6)}.${ext}`;
    el.rel = 'noopener';
    el.click();
  };

  const downloadSelected = () => {
    const list = items.filter((a) => selected.includes(a.id));
    list.forEach((a, i) => {
      window.setTimeout(() => downloadAsset(a), i * 200);
    });
    message.success(`已下载 ${list.length} 张素材`);
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleEmptyAction = () => {
    if (!token) {
      openLogin();
      return;
    }
    if (hasActiveFilters) {
      setKind('all');
      setCapability('all');
      setGroupKey(null);
      return;
    }
    fileRef.current?.click();
  };

  return (
    <div className="asset-library-page">
      <div className="asset-library-shell">
        <header className="asset-library-header">
          <div>
            <h1 className="asset-library-title">素材库</h1>
            <p className="asset-library-sub">
              统一管理上传原图与生成结果，支持筛选、分组、预览和批量下载
            </p>
          </div>
          {token && (
            <div className="asset-library-header-actions">
              <Select
                value={kind}
                onChange={(next) => setKind(next as Kind)}
                options={[
                  { value: 'all', label: '全部来源' },
                  { value: 'original', label: '原图' },
                  { value: 'generated', label: '生成图' },
                ]}
                aria-label="来源筛选"
                className="asset-library-date-filter"
              />
              <Select
                value={capability}
                onChange={(next) => setCapability(String(next))}
                options={[
                  { value: 'all', label: '全部能力' },
                  ...(caps?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
                ]}
                aria-label="能力筛选"
                className="asset-library-button"
              />
              <Button
                icon={<RefreshCw className="size-3.5" />}
                className="asset-library-button"
                onClick={() => void load()}
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<Upload className="size-3.5" />}
                className="asset-library-button asset-library-button-primary"
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                上传素材
              </Button>
            </div>
          )}
        </header>

        {/* 分组面板: 客户端按项目 / 能力 / 日期真实聚合, 点选分组即筛选 */}
        {token && items.length > 0 && (
          <Surface className="asset-library-groups-panel gap-0">
            <SurfaceHeader className="asset-library-group-head px-0">
              <SurfaceTitle className="asset-library-group-title">素材分组</SurfaceTitle>
              <SurfaceDescription className="asset-library-group-desc">
                按项目、能力或日期聚合素材，点选即可筛选
              </SurfaceDescription>
            </SurfaceHeader>
            <SurfaceContent className="px-0">
              <ToggleGroup
                aria-label="素材分组方式"
                value={groupBy}
                itemClassName="asset-library-new-group"
                className="asset-library-group-list"
                options={[
                  {
                    value: 'none',
                    label: '不分组',
                    icon: <LayoutGrid className="size-3.5" />,
                  },
                  { value: 'project', label: '按项目' },
                  { value: 'capability', label: '按能力' },
                  { value: 'date', label: '按日期' },
                ]}
                onValueChange={(next) => {
                  if (!next) return;
                  setGroupBy(next as GroupBy);
                  setGroupKey(null);
                }}
              />
              {groups.length > 0 && (
                <ToggleGroup
                  aria-label="素材分组筛选"
                  value={activeGroup ?? '__all__'}
                  itemClassName="asset-library-group-item"
                  className="asset-library-group-list"
                  options={[
                    {
                      value: '__all__',
                      label: (
                        <>
                          全部素材
                          <em className="asset-library-group-count">{items.length}</em>
                        </>
                      ),
                    },
                    ...groups.map((group) => ({
                      value: group.key,
                      title: group.label,
                      label: (
                        <>
                          {group.label}
                          <em className="asset-library-group-count">{group.count}</em>
                        </>
                      ),
                    })),
                  ]}
                  onValueChange={(next) => {
                    setGroupKey(next && next !== '__all__' ? next : null);
                  }}
                />
              )}
            </SurfaceContent>
          </Surface>
        )}

        {/* 批量操作条（选中后出现） */}
        {selected.length > 0 && (
          <Surface className="asset-library-batch-bar flex-row gap-3 py-0" role="status" aria-live="polite">
            <SurfaceContent className="flex flex-wrap items-center gap-3 p-0">
              <span>已选 {selected.length} 个素材</span>
              <Button
                type="text"
                size="small"
                icon={<Download className="size-3" />}
                onClick={downloadSelected}
              >
                下载所选
              </Button>
              <Button
                type="text"
                size="small"
                className="asset-library-batch-cancel"
                onClick={() => setSelected([])}
              >
                取消选择
              </Button>
            </SurfaceContent>
          </Surface>
        )}

        <input
          ref={(el) => {
            fileRef.current = el;
          }}
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = '';
          }}
        />

        {loading ? (
          /* 骨架屏占住 5 列卡片网格的形状, 内容到达时零位移 */
          <StateSkeleton variant="card" count={10} columns={5} />
        ) : error ? (
          /* 「没连上」不是「没素材」 */
          <StateError
            title="素材加载失败"
            desc="没能取回素材列表。可能是后端未启动或网络异常，重试一次即可。"
            detail={error}
            onRetry={() => void load()}
          />
        ) : shown.length === 0 ? (
          <EmptyState className="asset-library-empty asset-library-state-empty">
            <EmptyStateMedia>
              <img src="/asset-library/empty.svg" alt="" width={160} height={160} />
            </EmptyStateMedia>
            <EmptyStateHeader>
              <EmptyStateTitle>{emptyState.title}</EmptyStateTitle>
              <EmptyStateDescription>{emptyState.description}</EmptyStateDescription>
            </EmptyStateHeader>
            <EmptyStateContent>
              <Button
                type={hasActiveFilters && token ? 'default' : 'primary'}
                icon={hasActiveFilters && token ? undefined : <Upload className="size-3.5" />}
                className={
                  hasActiveFilters && token
                    ? 'asset-library-button asset-library-empty-action'
                    : 'asset-library-button asset-library-button-primary asset-library-empty-action'
                }
                onClick={handleEmptyAction}
              >
                {emptyState.action}
              </Button>
            </EmptyStateContent>
          </EmptyState>
        ) : (
          <>
            <div className="asset-library-grid">
              {shown.slice(0, visible).map((a, index) => {
                const url = assetSrc(a);
                const isVideo = modalityOfFormat(a.format) === 'video';
                /*
                 * 网格只加载缩略图; 视频没有缩略图管线, 直接用原文件 (卡片是懒加载)。
                 * 首行优先加载, 让首屏尽早出图。
                 */
                const previewUrl = isVideo ? url : assetThumbSrc(a, 640) ?? url;
                const isSel = selected.includes(a.id);
                const previewAt = isVideo ? -1 : lightboxItems.findIndex((item) => item.id === a.id);
                const openMedia = () => {
                  if (previewAt >= 0) {
                    setPreviewIndex(previewAt);
                    return;
                  }
                  if (url) window.open(url, '_blank', 'noopener');
                };
                return (
                  <Surface
                    key={a.id}
                    className={cn('asset-library-card', isSel && 'is-selected')}
                  >
                    <SurfaceContent className="asset-library-card-body p-0">
                      <div className="asset-library-cover">
                        {previewUrl && (isVideo ? (
                          <ResultMedia
                            url={previewUrl}
                            modality="video"
                            alt={`${capabilityName(a.capability)} 素材`}
                            priority={index < 5}
                            aigc={a.aigc}
                          />
                        ) : (
                          <Button
                            type="text"
                            className="asset-library-cover-button"
                            aria-label={`查看${capabilityName(a.capability)}素材大图`}
                            title="点击查看大图"
                            onClick={openMedia}
                          >
                            <ResultMedia
                              url={previewUrl}
                              modality="image"
                              alt={`${capabilityName(a.capability)} 素材`}
                              priority={index < 5}
                            />
                          </Button>
                        ))}
                        <Checkbox
                          checked={isSel}
                          onChange={() => toggle(a.id)}
                          className={cn('asset-library-check', isSel && 'on')}
                          aria-label={isSel ? '取消选择' : '选择该素材'}
                        />
                        {a.kind === 'original' && (
                          <StatusBadge
                            variant="secondary"
                            className="asset-library-source-badge"
                          >
                            上传原图
                          </StatusBadge>
                        )}
                        <div className="asset-library-hover-actions">
                          <Button
                            type="text"
                            size="small"
                            icon={<Eye className="size-3" />}
                            aria-label={isVideo ? '在新标签页查看视频' : '查看大图'}
                            title={isVideo ? '在新标签页查看视频' : '查看大图'}
                            onClick={openMedia}
                          >
                            查看
                          </Button>
                          <Button
                            type="text"
                            size="small"
                            icon={<Download className="size-3" />}
                            aria-label="下载素材"
                            title="下载素材"
                            onClick={() => downloadAsset(a)}
                          >
                            下载
                          </Button>
                          {a.kind === 'generated' && a.capability && (
                            <Button
                              type="text"
                              size="small"
                              icon={<Sparkles className="size-3" />}
                              onClick={() => navigate(toolPath(a.capability as string))}
                            >
                              再来一张
                            </Button>
                          )}
                          <Popconfirm
                            title="删除该素材？"
                            description={
                              a.kind === 'generated' ? '会连带删除产出它的作品记录' : '历史作品与结果会保留'
                            }
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void remove(a.id)}
                          >
                            <Button
                              type="text"
                              size="small"
                              icon={<Trash2 className="size-3" />}
                              className="asset-library-hover-delete"
                              aria-label={`删除素材${a.kind === 'generated' ? '及其作品记录' : ''}`}
                              title="删除素材"
                            />
                          </Popconfirm>
                        </div>
                      </div>
                    </SurfaceContent>
                  </Surface>
                );
              })}
            </div>

            {visible < shown.length && (
              <Button
                type="text"
                className="asset-library-load-more"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
              >
                加载更多（剩余 {shown.length - visible} 个）
              </Button>
            )}
          </>
        )}

        {previewIndex !== null && lightboxItems[previewIndex] && (
          <ImageLightbox
            items={lightboxItems}
            index={previewIndex}
            onIndexChange={setPreviewIndex}
            onClose={() => setPreviewIndex(null)}
            ariaLabel="素材预览"
          />
        )}
      </div>
    </div>
  );
}
