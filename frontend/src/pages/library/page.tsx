import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ImageLightbox,
  MobileUploadModal,
  modalityOfFormat,
  type LightboxItem,
} from './components';
import { LibraryMoveAssetsDialog } from './LibraryMoveAssetsDialog';
import { LibraryProjectManagerDialog } from './LibraryProjectManagerDialog';
import { assetsApi, assetSrc, projectsApi } from './api';
import { useApp, useAuth, useCapabilities, useDocumentMeta, useProject } from './hooks';
import {
  DEFAULT_KIND,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  PAGE_SIZE,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  type GroupBy,
  type Kind,
} from './constants';
import {
  assetExtension,
  buildEmptyStateCopy,
  capabilityName,
  isSupportedImageFile,
  toolPath,
} from './utils';
import { useLibraryAssets } from './useLibraryAssets';
import { useLibraryProjects } from './useLibraryProjects';
import { useLibraryGroups } from './useLibraryGroups';
import { LibraryToolbar } from './LibraryToolbar';
import { LibraryGroupPanel } from './LibraryGroupPanel';
import { LibraryBatchBar } from './LibraryBatchBar';
import { LibraryGrid } from './LibraryGrid';
import { LibraryLoadingState } from './LibraryLoadingState';
import { LibraryErrorState } from './LibraryErrorState';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryUploadInput } from './LibraryUploadInput';
import type { Asset, MobileUploadAsset } from '../../types/api';

/**
 * 素材库。
 *
 * 页面只保留编排与写操作（上传 / 删除 / 下载 / 移动）；取数在
 * `useLibraryAssets.ts` / `useLibraryProjects.ts`，分组状态与可见集合在 `useLibraryGroups.ts`，
 * 页头 / 分组面板 / 批量条 / 状态视图 / 网格各自一个展示组件。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
export function LibraryPage() {
  useDocumentMeta('素材库 · 货觉AI', '管理上传的原图与生成图，支持分组、下载与删除。');
  const { message } = useApp();
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { ensureProject } = useProject();
  const { data: caps } = useCapabilities();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [kind, setKind] = useState<Kind>(DEFAULT_KIND);
  const [capability, setCapability] = useState('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  /** 手机扫码上传弹窗；素材由后端直落素材库，接收后只需刷新列表 */
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  /** 大图查看器下标；null = 关闭。只收录图片素材，视频继续使用原生播放器。 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /*
   * 首屏数据到达后把可见条数收敛回第一页：换筛选 / 刷新后不应沿用上一轮的
   * 滚动深度，否则会一次性铺开几百张卡片。
   */
  const resetVisible = useCallback(() => setVisible(PAGE_SIZE), []);
  const { items, setItems, loading, error, load } = useLibraryAssets({
    kind,
    capability,
    onLoaded: resetVisible,
  });
  const { projects, refreshProjects } = useLibraryProjects();
  const {
    groupBy,
    setGroupBy,
    groupKey,
    setGroupKey,
    projectIdParam,
    setProjectParam,
    selectProjectGroup,
    groups,
    activeGroup,
    selectedProjectId,
    activeProject,
    moveTargetProjects,
    shown,
  } = useLibraryGroups({ items, projects });

  /*
   * 切换维度/能力/分组后清空勾选：批量下载只应作用于当前可见集合，
   * 否则用户会把屏幕上看不到、无法核对的素材一起下载。
   */
  useEffect(() => {
    setSelected([]);
  }, [kind, capability, groupBy, groupKey]);

  /*
   * 切换分组依据时一并处理副作用：能力只存在于生成结果上，默认来源是
   * 「本地上传」，留在该来源下按能力分组只会剩一个「未关联能力」；切到按能力
   * 时同步放开来源与能力筛选，否则用户看不到任何能力分组。
   */
  const handleGroupByChange = (next: GroupBy) => {
    if (next === 'capability') {
      setKind('all');
      setCapability('all');
    }
    setGroupBy(next);
    setGroupKey(next === 'project' ? projectIdParam : null);
    if (next !== 'project') setProjectParam(null);
  };

  /** 分组面板点选：项目分组同步 URL，其余只改本地选中键 */
  const handleSelectGroup = (key: string | null) => {
    if (groupBy === 'project') selectProjectGroup(key);
    else setGroupKey(key);
  };

  /** 实时镜像 shown.length，避免 IntersectionObserver 回调读到过期闭包 */
  const shownLengthRef = useRef(shown.length);
  shownLengthRef.current = shown.length;

  /*
   * 滚动加载（无限滚动）。数据已全量在 items 里，这里只是按视口续加可见条数，
   * 不再发请求。哨兵距视口 400px 即预触发，体感无缝；触底后 guard 自动停手。
   * 哨兵节点稳定，shown.length 经 ref 实时读取，故依赖为空数组。
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => (v < shownLengthRef.current ? v + PAGE_SIZE : v));
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const hasActiveFilters =
    kind !== DEFAULT_KIND || capability !== 'all' || activeGroup !== null;
  const emptyState = buildEmptyStateCopy({
    loggedIn: Boolean(token),
    activeProjectName: activeProject?.name ?? null,
    hasFilters: hasActiveFilters,
  });
  /** 「清除筛选」是次要动作；上传 / 登录才是主行动 */
  const emptyActionIsPrimary = !(hasActiveFilters && token && !activeProject);

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

  // id→查看器下标：卡片渲染时 O(1) 取值，取代对每张图的全量 findIndex。
  const lightboxIndexById = useMemo(() => new Map(lightboxItems.map((item, index) => [item.id, index])), [lightboxItems]);

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
      fileInputRef.current?.click();
      return;
    }
    if (hasActiveFilters) {
      setKind(DEFAULT_KIND);
      setCapability('all');
      setGroupKey(null);
      setProjectParam(null);
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <div className="asset-library-page">
      <div className="asset-library-shell">
        <LibraryToolbar
          loggedIn={Boolean(token)}
          kind={kind}
          capability={capability}
          capabilityOptions={caps?.items ?? []}
          uploading={uploading}
          onKindChange={setKind}
          onCapabilityChange={setCapability}
          onRefresh={() => void load()}
          onMobileUpload={() => setMobileOpen(true)}
          onUpload={() => fileInputRef.current?.click()}
        />

        {/* 分组面板: 客户端按项目 / 能力 / 日期真实聚合, 点选分组即筛选 */}
        {token && (
          <LibraryGroupPanel
            groupBy={groupBy}
            groups={groups}
            activeGroup={activeGroup}
            totalCount={items.length}
            onGroupByChange={handleGroupByChange}
            onSelectGroup={handleSelectGroup}
            onOpenProjectManager={() => {
              setGroupBy('project');
              setProjectManagerOpen(true);
            }}
          />
        )}

        {/* 批量操作条（选中后出现） */}
        {selected.length > 0 && (
          <LibraryBatchBar
            count={selected.length}
            onDownload={downloadSelected}
            onMove={() => setMoveDialogOpen(true)}
            onClear={() => setSelected([])}
          />
        )}

        <LibraryUploadInput
          inputRef={fileInputRef}
          accept={SUPPORTED_IMAGE_ACCEPT}
          onSelect={(files) => void upload(files)}
        />

        {loading ? (
          <LibraryLoadingState />
        ) : error ? (
          /* 「没连上」不是「没素材」 */
          <LibraryErrorState detail={error} onRetry={() => void load()} />
        ) : shown.length === 0 ? (
          <LibraryEmptyState
            copy={emptyState}
            primary={emptyActionIsPrimary}
            onAction={handleEmptyAction}
          />
        ) : (
          <LibraryGrid
            assets={shown}
            visible={visible}
            selected={selected}
            lightboxIndexById={lightboxIndexById}
            onLoadMore={() => setVisible((v) => v + PAGE_SIZE)}
            onToggle={toggle}
            onPreview={setPreviewIndex}
            onDownload={downloadAsset}
            onRemove={(id) => void remove(id)}
            onReuse={(capabilityId) => navigate(toolPath(capabilityId))}
          />
        )}

        {/* 无限滚动哨兵常驻：进入视口即自动加载更多（见上方 IntersectionObserver） */}
        <div ref={sentinelRef} className="asset-library-sentinel" aria-hidden="true" />

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

        <LibraryProjectManagerDialog
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

        <LibraryMoveAssetsDialog
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
