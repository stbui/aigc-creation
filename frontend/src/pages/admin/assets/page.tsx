import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PageHeader,
  Panel,
  SegmentedTabs,
  StaleError,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { adminAssetsApi } from './api';
import { useAdmin, useAdminList, useAdminUrlFilterSync, useSelectionPrune, useToast } from './hooks';
import {
  BACKEND_LABEL,
  GRID_PAGE_SIZE,
  TABLE_PAGE_SIZE,
  type AssetDeleteTarget,
  type AssetRow,
} from './constants';
import { assetLabel, fmtBytes, thumbOf } from './utils';
import { AssetFilterBar } from './AssetFilterBar';
import { AssetGrid } from './AssetGrid';
import { AssetTable } from './AssetTable';
import { AssetPreview } from './AssetPreview';
import { AssetDeleteConfirm } from './AssetDeleteConfirm';
import { AssetViewToolbar } from './AssetViewToolbar';
import { ProjectsPanel } from './ProjectsPanel';
import type { AdminAssetListResult, AssetStatus } from '../../../types/api';

/**
 * 素材管理 (B-22~B-26)。
 *
 * ## 两种视图解决两个问题
 *
 * 缩略图网格用来「扫图」—— 一页 60 张，看得快；表格用来「查属性」—— 尺寸、
 * 格式、存储后端、所属用户都在列上，一页 20 行。切换视图同时改页码与页大小，
 * 否则从网格第 4 页切到表格会落在越界页上显示空表。
 *
 * ## 批量动作结果用 toast 汇总
 *
 * 素材可能在这几秒内被用户删掉或被别的运营下架 —— 只回一个总数时，少处理的
 * 几条会被「已处理 N 条」掩盖。批量接口仍回逐条结果，页面用 toast 报成功 /
 * 失败条数，不再弹一次结果框；失败行可回列表按状态筛选处理。
 *
 * ## 删除必须二次确认
 *
 * 删除会同步移除对象存储文件且不可恢复。单张删除先展示影响（大小、关联任务、
 * 存储后端），批量删除展示条数；「下架」仍是即时动作，可恢复。
 *
 * ## 模块划分
 *
 * 网格 / 表格 / 大图预览 / 统计卡 / 删除确认各自独立成组件；本文件只保留
 * 筛选、URL 同步、取数与写操作编排。
 */
export function AdminAssetsPage() {
  const toast = useToast();
  const { can } = useAdmin();

  const [searchParams, setSearchParams] = useSearchParams();
  const canReadProjects = can('project.read');
  const initialSection: 'assets' | 'projects' =
    searchParams.get('tab') === 'projects' && canReadProjects ? 'projects' : 'assets';
  const [section, setSection] = useState<'assets' | 'projects'>(initialSection);
  const initialKeyword = searchParams.get('q') ?? '';
  const rawKind = searchParams.get('kind');
  const initialKind = rawKind === 'original' || rawKind === 'generated' ? rawKind : undefined;
  const rawStatus = searchParams.get('status');
  const initialStatus = rawStatus === 'visible' || rawStatus === 'hidden' ? rawStatus : undefined;
  const rawBackend = searchParams.get('backend');
  const initialBackend =
    rawBackend && Object.prototype.hasOwnProperty.call(BACKEND_LABEL, rawBackend) ? rawBackend : undefined;
  const initialView: 'grid' | 'table' = searchParams.get('view') === 'table' ? 'table' : 'grid';

  const [keyword, setKeyword] = useState(initialKeyword);
  const [kind, setKind] = useState<string | undefined>(initialKind);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [backend, setBackend] = useState<string | undefined>(initialBackend);
  /** B-25: 缩略图网格与表格视图切换。网格适合看图，表格适合查属性 */
  const [view, setView] = useState<'grid' | 'table'>(initialView);

  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetDeleteTarget | null>(null);
  const appliedQ = useRef(initialKeyword);

  useEffect(() => {
    if (section !== 'projects' || canReadProjects) return;
    setSection('assets');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('tab');
      return next;
    }, { replace: true });
  }, [canReadProjects, section, setSearchParams]);

  const changeSection = (next: string) => {
    if (next !== 'assets' && next !== 'projects') return;
    if (next === 'projects' && !canReadProjects) return;
    setSection(next);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 'projects') params.set('tab', 'projects');
      else params.delete('tab');
      return params;
    }, { replace: true });
  };

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminAssetsApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        kind: params.kind as string | undefined,
        status: params.status as string | undefined,
        backend: params.backend as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<AdminAssetListResult>(fetcher, {
    pageSize: initialView === 'grid' ? GRID_PAGE_SIZE : TABLE_PAGE_SIZE,
    ...(initialKeyword ? { keyword: initialKeyword } : {}),
    ...(initialKind ? { kind: initialKind } : {}),
    ...(initialStatus ? { status: initialStatus } : {}),
    ...(initialBackend ? { backend: initialBackend } : {}),
  });
  const items = data?.items ?? [];

  /*
   * 翻页、换筛选、切网格/表格后，上一屏勾选的素材已不在屏幕上；裁剪到当前
   * 可见集合，避免批量隐藏/删除作用到看不见的行。
   */
  const visibleAssetIds = useMemo(() => items.map((item) => item.id), [items]);
  useSelectionPrune(setSelected, visibleAssetIds);

  const previewItems = useMemo(
    () =>
      items.map((a) => ({
        id: a.id,
        url: thumbOf(a.sourceUrl),
        alt: `${assetLabel(a)}素材预览`,
        width: a.width,
        height: a.height,
        createdAt: a.createdAt,
        meta: [
          // 只保留技术信息：大小与存储位置。能力、上下架状态、格式、所属用户、
          // 项目都属于业务属性，放在查看器里会干扰看图。
          fmtBytes(a.sizeBytes),
          BACKEND_LABEL[a.storageBackend] ?? a.storageBackend,
        ],
      })),
    [items],
  );
  const previewIndex = previewId ? items.findIndex((a) => a.id === previewId) : -1;

  const appliedKeyword = (params.keyword as string | undefined) ?? '';
  const appliedKind = params.kind as string | undefined;
  const appliedStatus = params.status as string | undefined;
  const appliedBackend = params.backend as string | undefined;
  const appliedChips = [
    appliedKeyword
      ? {
          key: 'keyword',
          label: `关键词「${appliedKeyword}」`,
          onClear: () => {
            appliedQ.current = '';
            setKeyword('');
            setQuery({ keyword: undefined });
          },
        }
      : null,
    appliedKind
      ? {
          key: 'kind',
          label: appliedKind === 'original' ? '原始上传' : '生成图',
          onClear: () => {
            setKind(undefined);
            setQuery({ kind: undefined });
          },
        }
      : null,
    appliedStatus
      ? {
          key: 'status',
          label: appliedStatus === 'visible' ? '已上架' : '已下架',
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedBackend
      ? {
          key: 'backend',
          label: BACKEND_LABEL[appliedBackend] ?? appliedBackend,
          onClear: () => {
            setBackend(undefined);
            setQuery({ backend: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const selectable = can('asset.hide') || can('asset.delete');
  const page = data?.page ?? 1;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? (view === 'grid' ? GRID_PAGE_SIZE : TABLE_PAGE_SIZE);
  const allPageSelected = items.length > 0 && items.every((item) => selected.includes(item.id));
  const somePageSelected = items.some((item) => selected.includes(item.id)) && !allPageSelected;

  /** 顶栏搜索带 `?q=` 跳过来时套用关键词（ref 防止覆盖页内手动筛选） */
  const urlQ = searchParams.get('q') ?? '';
  useEffect(() => {
    if (urlQ === appliedQ.current) return;
    appliedQ.current = urlQ;
    setKeyword(urlQ);
    setQuery({ keyword: urlQ || undefined });
  }, [urlQ, setQuery]);

  useAdminUrlFilterSync({
    q: params.keyword as string | undefined,
    kind: params.kind as string | undefined,
    status: params.status as string | undefined,
    backend: params.backend as string | undefined,
    view,
  });

  const applyFilters = useCallback(() => {
    appliedQ.current = keyword.trim();
    setSelected([]);
    setQuery({
      keyword: keyword.trim() || undefined,
      kind,
      status,
      backend,
    });
  }, [backend, keyword, kind, setQuery, status]);

  const resetFilters = useCallback(() => {
    appliedQ.current = '';
    setKeyword('');
    setKind(undefined);
    setStatus(undefined);
    setBackend(undefined);
    setSelected([]);
    setQuery({
      keyword: undefined,
      kind: undefined,
      status: undefined,
      backend: undefined,
    });
  }, [setQuery]);

  const handleViewChange = (next: 'grid' | 'table') => {
    if (next === view) return;
    setView(next);
    setSelected([]);
    setPreviewId(null);
    // 网格适合扫图，一页 60 张；表格适合查属性，一页 20 行。页码回到 1，
    // 否则从网格第 4 页切到表格时可能直接落在越界页。
    setQuery({
      page: 1,
      pageSize: next === 'grid' ? GRID_PAGE_SIZE : TABLE_PAGE_SIZE,
    });
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((current) =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id),
    );
  };

  const toggleSelectPage = (checked: boolean) => {
    setSelected(checked ? items.map((item) => item.id) : []);
  };

  const toggleStatus = useCallback(
    async (row: AssetRow, next: AssetStatus) => {
      if (statusBusyId) return;
      setStatusBusyId(row.id);
      try {
        await adminAssetsApi.setStatus(row.id, next);
        toast.success(next === 'hidden' ? '已下架，用户端不再展示' : '已恢复上架');
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '操作失败');
      } finally {
        setStatusBusyId(null);
      }
    },
    [reload, statusBusyId, toast],
  );

  /**
   * 批量动作走 `/admin/assets/batch`（逐条结果）而不是旧的 `batch-status`（只回 count）。
   * 删除先进确认；下架 / 恢复可逆，保持即时执行。
   */
  const runBatch = async (action: 'hide' | 'show' | 'delete') => {
    if (selected.length === 0) return;
    if (action === 'delete') {
      setDeleteTarget({ kind: 'batch', count: selected.length });
      return;
    }
    setBusy(true);
    try {
      const summary = await adminAssetsApi.batch(selected, action);
      const verb = action === 'hide' ? '下架' : '恢复';
      if (summary.failed > 0) {
        toast.warning(`批量${verb}完成：成功 ${summary.succeeded} 张，失败 ${summary.failed} 张`);
      } else {
        toast.success(`批量${verb}完成：成功 ${summary.succeeded} 张`);
      }
      setSelected([]);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败');
    } finally {
      setBusy(false);
    }
  };

  const exportAssets = async () => {
    try {
      await adminAssetsApi.exportCsv({
        // 导出必须与屏幕上已生效的筛选一致，而不是筛选栏里尚未提交的草稿值
        keyword: appliedKeyword || undefined,
        kind: appliedKind,
        status: appliedStatus,
        backend: appliedBackend,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  const requestDelete = useCallback((row: AssetRow) => {
    setPreviewId(null);
    setDeleteTarget({ kind: 'single', row });
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      if (deleteTarget.kind === 'single') {
        const res = await adminAssetsApi.remove(deleteTarget.row.id);
        toast.success(`已删除，连带清理 ${res.removedTasks} 条任务记录`);
        reload();
      } else {
        const summary = await adminAssetsApi.batch(selected, 'delete');
        if (summary.failed > 0) {
          toast.warning(`批量删除完成：成功 ${summary.succeeded} 张，失败 ${summary.failed} 张`);
        } else {
          toast.success(`批量删除完成：成功 ${summary.succeeded} 张`);
        }
        setSelected([]);
        reload();
      }
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  /** 表格页大小必须落在 `AdminDataTable` 的选项集里，否则选择器显示空值 */
  const tablePageSize = [20, 50, 100].includes(pageSize) ? pageSize : TABLE_PAGE_SIZE;

  return (
    <>
      <PageHeader title="素材管理" />

      {canReadProjects && (
        <SegmentedTabs
          value={section}
          onChange={changeSection}
          ariaLabel="素材管理与项目分类"
          className="mb-4"
          options={[
            { value: 'assets', label: '素材' },
            { value: 'projects', label: '项目分类' },
          ]}
        />
      )}

      {section === 'projects' ? (
        <ProjectsPanel onDataChanged={reload} />
      ) : (
        <>

      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <AssetFilterBar
        keyword={keyword}
        kind={kind}
        status={status}
        backend={backend}
        appliedChips={appliedChips}
        onKeywordChange={setKeyword}
        onKindChange={setKind}
        onStatusChange={setStatus}
        onBackendChange={setBackend}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <Panel
        title={view === 'grid' ? '缩略图网格' : '素材列表'}
        note={`${total} 张`}
        extra={
          <AssetViewToolbar
            view={view}
            itemCount={items.length}
            selectedCount={selected.length}
            selectable={selectable}
            canHide={can('asset.hide')}
            canDelete={can('asset.delete')}
            canExport={can('data.export')}
            busy={busy}
            allPageSelected={allPageSelected}
            somePageSelected={somePageSelected}
            onBatchHide={() => void runBatch('hide')}
            onBatchShow={() => void runBatch('show')}
            onBatchDelete={() => void runBatch('delete')}
            onClearSelection={() => setSelected([])}
            onToggleSelectPage={toggleSelectPage}
            onViewChange={handleViewChange}
            onExport={() => void exportAssets()}
          />
        }
      >
        {view === 'grid' ? (
          <AssetGrid
            items={items}
            loading={loading}
            error={error}
            page={page}
            pageSize={pageSize}
            total={total}
            selected={selected}
            selectable={selectable}
            hasFilter={appliedChips.length > 0}
            onRetry={reload}
            onResetFilters={resetFilters}
            onToggleSelected={toggleSelected}
            onSelectMany={setSelected}
            onPreview={setPreviewId}
            onPageChange={(next) => {
              setSelected([]);
              setPage(next);
            }}
          />
        ) : (
          <AssetTable
            items={items}
            loading={loading}
            error={error}
            page={page}
            pageSize={tablePageSize}
            total={total}
            selected={selected}
            selectable={selectable}
            statusBusyId={statusBusyId}
            canHide={can('asset.hide')}
            canDelete={can('asset.delete')}
            hasFilter={appliedChips.length > 0}
            onRetry={reload}
            onResetFilters={resetFilters}
            onSelectedChange={setSelected}
            onPreview={setPreviewId}
            onToggleStatus={(row, next) => void toggleStatus(row, next)}
            onDelete={requestDelete}
            onPageChange={(next, size) => {
              setSelected([]);
              setPage(next, size);
            }}
          />
        )}
      </Panel>

      {previewIndex >= 0 && (
        <AssetPreview
          assets={items}
          items={previewItems}
          index={previewIndex}
          statusBusyId={statusBusyId}
          canHide={can('asset.hide')}
          canDelete={can('asset.delete')}
          onIndexChange={(nextIndex) => setPreviewId(items[nextIndex]?.id ?? null)}
          onClose={() => setPreviewId(null)}
          onToggleStatus={(row, next) => void toggleStatus(row, next)}
          onDelete={requestDelete}
        />
      )}

      {deleteTarget && (
        <AssetDeleteConfirm
          target={deleteTarget}
          loading={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
        </>
      )}
    </>
  );
}
