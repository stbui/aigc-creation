import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FolderInput,
  FolderKanban,
  LayoutGrid,
  RefreshCw,
  Smartphone,
  Upload,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  ImageLightbox,
  MobileUploadModal,
  Select,
  StateError,
  StateSkeleton,
  Surface,
  SurfaceContent,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  ToggleGroup,
  modalityOfFormat,
  type LightboxItem,
} from './components';
import { AssetCard } from './AssetCard';
import { MoveAssetsDialog } from './MoveAssetsDialog';
import { ProjectManagerDialog } from './ProjectManagerDialog';
import { assetsApi, assetSrc, projectsApi } from './api';
import { useApp, useAuth, useCapabilities, useDocumentMeta, useProject } from './hooks';
import {
  DEFAULT_KIND,
  KIND_OPTIONS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  PAGE_SIZE,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  type AssetGroup,
  type GroupBy,
  type Kind,
} from './constants';
import {
  assetExtension,
  capabilityName,
  dateBucket,
  isSupportedImageFile,
  toolPath,
} from './utils';
import type { Asset, MobileUploadAsset, ProjectListItem } from '../../types/api';

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
  const [kind, setKind] = useState<Kind>(DEFAULT_KIND);
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
  /** 手机扫码上传弹窗；素材由后端直落素材库，接收后只需刷新列表 */
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  /** 大图查看器下标；null = 关闭。只收录图片素材，视频继续使用原生播放器。 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /*
   * 外部入口: 浏览器扩展保存后跳 `/asset-library?projectId=xxx`，直接落在
   * 刚采集进的那个分组上。惰性初始化是为了首帧就分组，不闪一下「全部」。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');

  /** 分组依据与当前选中的分组（null = 全部分组） */
  const [groupBy, setGroupBy] = useState<GroupBy>(projectIdParam ? 'project' : 'none');
  const [groupKey, setGroupKey] = useState<string | null>(projectIdParam);
  /** 项目名映射：按项目分组时要显示名字，只有 id 的分组没人看得懂 */
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  /** 项目分组与 URL 同步，刷新/分享后仍能直接落到同一个项目。 */
  const setProjectParam = useCallback(
    (id: string | null) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('projectId', id); else next.delete('projectId');
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const selectProjectGroup = useCallback(
    (id: string | null) => {
      setGroupBy('project');
      setGroupKey(id);
      setProjectParam(id);
    },
    [setProjectParam],
  );

  /*
   * 切换维度/能力/分组后清空勾选：批量下载只应作用于当前可见集合，
   * 否则用户会把屏幕上看不到、无法核对的素材一起下载。
   */
  useEffect(() => {
    setSelected([]);
  }, [kind, capability, groupBy, groupKey]);

  /** 项目列表同时服务于项目分组、上传目标与项目管理弹窗。 */
  const refreshProjects = useCallback(async () => {
    if (!token) {
      setProjects([]);
      return [] as ProjectListItem[];
    }
    const list = await projectsApi.list();
    setProjects(list);
    return list;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setProjects([]);
      return;
    }
    void refreshProjects().catch(() => {
      /* 拉不到项目名时分组仍用 id 兜底，不阻断素材浏览 */
    });
  }, [refreshProjects, token]);

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

    // 项目分组以项目列表为主：即使项目里没有素材，也要能在这里看到并进入。
    if (groupBy === 'project') {
      projects.forEach((project, index) => {
        map.set(project.id, {
          key: project.id,
          label: project.name,
          count: 0,
          sort: index,
        });
      });
    }

    for (const a of items) {
      const { key, label, sort } = groupOf(a);
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { key, label, count: 1, sort });
    }
    return [...map.values()].sort(
      (x, y) => x.sort - y.sort || x.label.localeCompare(y.label, 'zh-CN'),
    );
  }, [items, groupBy, groupOf, projects]);

  // 分组不存在（换了分组依据 / 素材被删）时自动回到「全部」, 不留一个筛不出东西的选中态
  const activeGroup = groups.some((g) => g.key === groupKey) ? groupKey : null;
  const selectedProjectId = groupBy === 'project' ? activeGroup : null;
  const activeProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId) ?? null
    : null;
  const moveTargetProjects = useMemo(
    () => projects.filter((project) => project.id !== selectedProjectId),
    [projects, selectedProjectId],
  );
  const shown = useMemo(
    () => (activeGroup ? items.filter((a) => groupOf(a).key === activeGroup) : items),
    [items, activeGroup, groupOf],
  );

  /** 空态不是一种状态：游客、真实空库、筛选无结果显示不同的原因与下一步。 */
  const hasActiveFilters =
    kind !== DEFAULT_KIND || capability !== 'all' || activeGroup !== null;
  const emptyState = !token
    ? {
        title: '登录后管理素材',
        description: '上传原图或生成图片后，可在这里统一筛选、预览和下载。',
        action: '登录并上传',
      }
    : activeProject
      ? {
          title: `「${activeProject.name}」还没有素材`,
          description: '把素材上传到这个项目，或在批量操作中把已有素材移动过来。',
          action: '上传到该项目',
        }
      : hasActiveFilters
      ? {
          title: '没有符合条件的素材',
          description: '换个来源、能力或分组条件试试。',
          action: '清除筛选',
        }
      : {
          title: '还没有本地上传的素材',
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
      const targetProjectId = selectedProjectId ?? (await ensureProject());
      for (const f of list) await assetsApi.upload(f, targetProjectId);
      message.success(`已上传 ${list.length} 张素材`);
      await Promise.all([refreshProjects(), load()]);
    } catch (e) {
      message.error((e as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  /**
   * 手机端传回图片 → 刷新素材列表。
   *
   * 与工具页回填参考图位不同，手机上传在这里**就走素材库主路径**：
   * 后端接收时已按 owner / project 落库，刷新即可看到，不需要前端再上传一次。
   */
  const receiveFromMobile = async (assets: MobileUploadAsset[]) => {
    setMobileOpen(false);
    message.success(`已从手机接收 ${assets.length} 张素材`);
    await Promise.all([refreshProjects(), load()]);
  };

  const remove = async (id: string) => {
    try {
      const res = await assetsApi.remove(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setSelected((prev) => prev.filter((x) => x !== id));
      message.success(res.removedTasks > 0 ? '已删除素材及其作品记录' : '已删除素材');
      await refreshProjects();
    } catch (e) {
      message.error((e as Error).message || '删除失败');
    }
  };

  const downloadAsset = (a: Asset) => {
    const url = assetSrc(a);
    if (!url) return;
    const ext = assetExtension(a.format);
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
    if (activeProject) {
      fileRef.current?.click();
      return;
    }
    if (hasActiveFilters) {
      setKind(DEFAULT_KIND);
      setCapability('all');
      setGroupKey(null);
      setProjectParam(null);
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
          </div>
          {token && (
            <div className="asset-library-header-actions">
              <Select
                value={kind}
                onChange={(next) => setKind(next as Kind)}
                options={KIND_OPTIONS}
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
                icon={<Smartphone className="size-3.5" />}
                className="asset-library-button"
                onClick={() => setMobileOpen(true)}
              >
                手机上传
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
        {token && (
          <Surface className="asset-library-groups-panel gap-0">
            <SurfaceHeader className="asset-library-group-head px-0">
              <div className="min-w-0">
                <SurfaceTitle className="asset-library-group-title">素材分组</SurfaceTitle>
                <SurfaceDescription className="asset-library-group-desc">
                  按项目、能力或日期聚合素材，点选即可筛选
                </SurfaceDescription>
              </div>
              <Button
                type="text"
                size="small"
                icon={<FolderKanban className="size-3.5" />}
                className="ml-auto shrink-0"
                onClick={() => {
                  setGroupBy('project');
                  setProjectManagerOpen(true);
                }}
              >
                项目管理
              </Button>
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
                  /*
                   * 能力只存在于生成结果上：默认来源是「本地上传」，
                   * 留在该来源下按能力分组只会剩一个「未关联能力」。
                   * 切到按能力时同步放开来源与能力筛选，否则用户看不到任何能力分组。
                   */
                  if (next === 'capability') {
                    setKind('all');
                    setCapability('all');
                  }
                  const nextGroupBy = next as GroupBy;
                  setGroupBy(nextGroupBy);
                  setGroupKey(nextGroupBy === 'project' ? projectIdParam : null);
                  if (nextGroupBy !== 'project') setProjectParam(null);
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
                    if (groupBy === 'project') {
                      selectProjectGroup(next && next !== '__all__' ? next : null);
                    } else {
                      setGroupKey(next && next !== '__all__' ? next : null);
                    }
                  }}
                />
              )}
            </SurfaceContent>
          </Surface>
        )}

        {/* 批量操作条（选中后出现） */}
        {selected.length > 0 && (
          <Surface className="asset-library-batch-bar flex-row gap-3 py-0">
            <SurfaceContent className="flex flex-wrap items-center gap-3 p-0">
              {/* 只播报选中个数；整条容器挂 role=status 会让内部按钮失去按钮语义 */}
              <span aria-live="polite">已选 {selected.length} 个素材</span>
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
                icon={<FolderInput className="size-3" />}
                onClick={() => setMoveDialogOpen(true)}
              >
                移动到项目
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
                type={(hasActiveFilters && token && !activeProject) ? 'default' : 'primary'}
                icon={(hasActiveFilters && token && !activeProject) ? undefined : <Upload className="size-3.5" />}
                className={
                  (hasActiveFilters && token && !activeProject)
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
              {shown.slice(0, visible).map((a, index) => (
                <AssetCard
                  key={a.id}
                  asset={a}
                  selected={selected.includes(a.id)}
                  priority={index < 5}
                  previewIndex={
                    modalityOfFormat(a.format) === 'video'
                      ? -1
                      : lightboxItems.findIndex((item) => item.id === a.id)
                  }
                  onToggle={toggle}
                  onPreview={setPreviewIndex}
                  onDownload={downloadAsset}
                  onRemove={(id) => void remove(id)}
                  onReuse={(capability) => navigate(toolPath(capability))}
                />
              ))}
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

        {/* 手机上传弹窗 (二维码方案): 手机扫码选图/拍照, 电脑端接收后刷新列表 */}
        <MobileUploadModal
          open={mobileOpen}
          projectId={selectedProjectId}
          onReceived={(assets) => void receiveFromMobile(assets)}
          onCancel={() => setMobileOpen(false)}
        />

        <ProjectManagerDialog
          open={projectManagerOpen}
          projects={projects}
          currentProjectId={selectedProjectId}
          onClose={() => setProjectManagerOpen(false)}
          onSelect={(id) => selectProjectGroup(id)}
          onCreate={async (name) => {
            await projectsApi.create(name);
            await refreshProjects();
          }}
          onRename={async (id, name) => {
            await projectsApi.update(id, name);
            await refreshProjects();
          }}
          onDelete={async (project, moveAssetsTo) => {
            await projectsApi.remove(project.id, moveAssetsTo);
            if (project.id === selectedProjectId) {
              setGroupKey(null);
              setProjectParam(null);
            }
            await Promise.all([refreshProjects(), load()]);
          }}
        />

        <MoveAssetsDialog
          open={moveDialogOpen}
          count={selected.length}
          projects={moveTargetProjects}
          onCancel={() => setMoveDialogOpen(false)}
          onConfirm={async (projectId) => {
            const result = await assetsApi.move(selected, projectId);
            message.success(`已移动 ${result.moved} 个素材`);
            setMoveDialogOpen(false);
            setSelected([]);
            await Promise.all([refreshProjects(), load()]);
          }}
        />
      </div>
    </div>
  );
}
