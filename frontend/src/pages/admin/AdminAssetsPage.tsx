import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Grid3x3,
  HardDrive,
  ImageOff,
  List,
  Maximize2,
  Trash2,
} from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  BatchResultModal,
  CheckboxField,
  ClearableField,
  EmptyState,
  FilterActions,
  FilterBar,
  IconButton,
  ListError,
  PageHeader,
  Pagination,
  Panel,
  SegmentedGroup,
  SelectField,
  Skeleton,
  StatCard,
  StatusTag,
  StaleError,
  useAdminList,
  useAdminUrlFilterSync,
  type AdminColumn,
  type AppliedFilter,
} from '../../admin-ui/primitives';
import { adminAssetsApi, assetThumbUrl, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { cn } from '../../admin-ui/lib/cn';
import { ImageLightbox, type LightboxItem } from '../../components/ImageLightbox';
import type {
  AdminAssetListResult,
  AdminAssetStats,
  AssetStatus,
  BatchSummary,
} from '../../types/api';

/**
 * 素材管理 (B-22~B-26)。
 *
 * ## 两种视图解决两个问题
 *
 * 缩略图网格用来「扫图」—— 一页 60 张，看得快；表格用来「查属性」—— 尺寸、
 * 格式、存储后端、所属用户都在列上，一页 20 行。切换视图同时改页码与页大小，
 * 否则从网格第 4 页切到表格会落在越界页上显示空表。
 *
 * ## 批量动作要逐条结果
 *
 * 素材可能在这几秒内被用户删掉或被别的运营下架 —— 只回一个总数时，少处理的
 * 几条会被「已处理 N 条」掩盖。批量接口回逐条结果，弹窗把失败原因摊开。
 *
 * ## 删除不弹确认
 *
 * 按产品要求直接执行；接口返回连带清理的任务数，用提示如实告知。
 */

type Row = AdminAssetListResult['items'][number];

/** 字节 → 人类可读 */
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const BACKEND_LABEL: Record<string, string> = {
  local: '本地',
  oss: '阿里云 OSS',
  minio: 'MinIO',
};

/**
 * 缩略图 URL —— 复用 lib/api 的 toAbsoluteUrl。
 *
 * 不自己拼: 本地路径要加 API_BASE, 云端签名 URL 要原样透传,
 * 这两条规则已封装在 toAbsoluteUrl, 重写一遍必然漂移。
 */
const thumbOf = (url: string): string => toAbsoluteUrl(url) ?? url;

/** 列表 / 网格用的方形缩略图; 查看大图仍用 thumbOf 的完整地址 */
const thumbSrc = (url: string, size = 320): string => assetThumbUrl(url, size) ?? thumbOf(url);

const assetLabel = (a: Row): string =>
  a.capability ?? (a.kind === 'original' ? '原始上传' : '生成图');

const fmtFormat = (format: string): string =>
  format ? (format.split('/').pop() ?? format).toUpperCase() : '—';

/** 缩略图失败时保留稳定占位，避免破图图标破坏网格节奏 */
function AssetThumb({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <span
        className={cn(
          'flex items-center justify-center bg-muted text-muted-foreground',
          className,
        )}
        role="img"
        aria-label={`${alt}，缩略图加载失败`}
      >
        <ImageOff className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <img
      className={cn('bg-muted object-cover', className)}
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function AdminAssetsPage() {
  const toast = useToast();
  const { can } = useAdmin();

  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('q') ?? '';
  const rawKind = searchParams.get('kind');
  const initialKind = rawKind === 'original' || rawKind === 'generated' ? rawKind : undefined;
  const rawStatus = searchParams.get('status');
  const initialStatus = rawStatus === 'visible' || rawStatus === 'hidden' ? rawStatus : undefined;
  const rawBackend = searchParams.get('backend');
  const initialBackend =
    rawBackend && Object.prototype.hasOwnProperty.call(BACKEND_LABEL, rawBackend)
      ? rawBackend
      : undefined;
  const initialView: 'grid' | 'table' = searchParams.get('view') === 'table' ? 'table' : 'grid';

  const [keyword, setKeyword] = useState(initialKeyword);
  const [kind, setKind] = useState<string | undefined>(initialKind);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [backend, setBackend] = useState<string | undefined>(initialBackend);
  /** B-25: 缩略图网格与表格视图切换。网格适合看图, 表格适合查属性 */
  const [view, setView] = useState<'grid' | 'table'>(initialView);

  const [stats, setStats] = useState<AdminAssetStats | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary<unknown> | null>(null);
  const [batchTitle, setBatchTitle] = useState('');
  const appliedQ = useRef(initialKeyword);

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

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminAssetListResult>(fetcher, {
      pageSize: initialView === 'grid' ? 60 : 20,
      ...(initialKeyword ? { keyword: initialKeyword } : {}),
      ...(initialKind ? { kind: initialKind } : {}),
      ...(initialStatus ? { status: initialStatus } : {}),
      ...(initialBackend ? { backend: initialBackend } : {}),
    });
  const items = data?.items ?? [];

  const previewItems = useMemo<LightboxItem[]>(
    () =>
      items.map((a) => ({
        id: a.id,
        url: thumbOf(a.sourceUrl),
        alt: `${assetLabel(a)}素材预览`,
        width: a.width,
        height: a.height,
        createdAt: a.createdAt,
        meta: [
          assetLabel(a),
          a.status === 'visible' ? '已上架' : '已下架',
          fmtFormat(a.format),
          fmtBytes(a.sizeBytes),
          BACKEND_LABEL[a.storageBackend] ?? a.storageBackend,
          a.ownerEmail,
          a.projectName,
        ],
      })),
    [items],
  );
  const previewIndex = previewId ? items.findIndex((a) => a.id === previewId) : -1;
  const previewAsset = previewIndex >= 0 ? items[previewIndex] : null;

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
  const pageSize = data?.pageSize ?? (view === 'grid' ? 60 : 20);
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

  useEffect(() => {
    adminAssetsApi
      .stats()
      .then(setStats)
      .catch(() => undefined);
  }, [reload]);

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
    setQuery({ keyword: undefined, kind: undefined, status: undefined, backend: undefined });
  }, [setQuery]);

  const handleViewChange = (next: 'grid' | 'table') => {
    if (next === view) return;
    setView(next);
    setSelected([]);
    setPreviewId(null);
    // 网格适合扫图, 一页 60 张; 表格适合查属性, 一页 20 行。页码回到 1,
    // 否则从网格第 4 页切到表格时可能直接落在越界页。
    setQuery({ page: 1, pageSize: next === 'grid' ? 60 : 20 });
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((item) => item !== id),
    );
  };

  const toggleSelectPage = (checked: boolean) => {
    setSelected(checked ? items.map((item) => item.id) : []);
  };

  const toggleStatus = useCallback(
    async (row: Row, next: AssetStatus) => {
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
   */
  const runBatch = async (action: 'hide' | 'show' | 'delete') => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const summary = await adminAssetsApi.batch(selected, action);
      setBatchTitle(
        action === 'hide' ? '批量下架结果' : action === 'show' ? '批量恢复结果' : '批量删除结果',
      );
      setBatchSummary(summary);
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

  /** 删除按产品要求直接执行，不再弹窗二次确认 */
  const openDelete = useCallback(
    async (row: Row) => {
      setPreviewId(null);
      setBusy(true);
      try {
        const res = await adminAssetsApi.remove(row.id);
        toast.success(`已删除，连带清理 ${res.removedTasks} 条任务记录`);
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '删除失败');
      } finally {
        setBusy(false);
      }
    },
    [reload, toast],
  );

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'thumb',
        title: '预览',
        width: 72,
        render: (row: Row) => (
          <button
            type="button"
            className="block size-9 overflow-hidden rounded-md border border-border"
            title="查看大图"
            aria-label={`查看大图：${assetLabel(row)}`}
            onClick={() => setPreviewId(row.id)}
          >
            <AssetThumb
              className="size-full"
              src={thumbSrc(row.sourceUrl, 96)}
              alt={`${assetLabel(row)}缩略图`}
            />
          </button>
        ),
      },
      {
        key: 'kind',
        title: '类型',
        width: 80,
        render: (row: Row) => (row.kind === 'original' ? '原始' : '生成'),
      },
      {
        key: 'capability',
        title: '能力',
        width: 130,
        cellTitle: (row: Row) => row.capability ?? undefined,
        render: (row: Row) =>
          row.capability ?? <span className="text-muted-foreground">—</span>,
      },
      {
        key: 'dim',
        title: '尺寸',
        width: 110,
        render: (row: Row) => (
          <span className="text-muted-foreground">
            {row.width && row.height ? `${row.width}×${row.height}` : '—'}
          </span>
        ),
      },
      {
        key: 'format',
        title: '格式',
        width: 68,
        render: (row: Row) => (
          <span className="text-muted-foreground">{fmtFormat(row.format)}</span>
        ),
      },
      {
        key: 'sizeBytes',
        title: '大小',
        width: 80,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{fmtBytes(row.sizeBytes)}</span>,
      },
      {
        key: 'storageBackend',
        title: '存储',
        width: 90,
        render: (row: Row) => BACKEND_LABEL[row.storageBackend] ?? row.storageBackend,
      },
      {
        key: 'ownerEmail',
        title: '所属用户',
        width: 190,
        cellTitle: (row: Row) => row.ownerEmail,
        render: (row: Row) => <span className="block max-w-[180px] truncate">{row.ownerEmail}</span>,
      },
      {
        key: 'projectName',
        title: '项目',
        width: 130,
        cellTitle: (row: Row) => row.projectName,
        render: (row: Row) => <span className="block max-w-[120px] truncate">{row.projectName}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 80,
        // visible / hidden 不在 STATUS_META 里：素材语境下要读作「上架 / 下架」
        render: (row: Row) => (
          <StatusTag
            status={row.status}
            label={row.status === 'visible' ? '已上架' : '已下架'}
            tone={row.status === 'visible' ? 'success' : 'warn'}
          />
        ),
      },
      {
        key: 'createdAt',
        title: '上传时间',
        width: 120,
        render: (row: Row) => new Date(row.createdAt).toLocaleDateString('zh-CN'),
      },
      {
        key: 'ops',
        title: '',
        width: 130,
        fixed: 'right',
        render: (row: Row) => (
          <div className="flex items-center gap-1">
            {can('asset.hide') && (
              <ActionButton
                variant="ghost"
                size="sm"
                disabled={statusBusyId !== null}
                onClick={() =>
                  void toggleStatus(row, row.status === 'visible' ? 'hidden' : 'visible')
                }
              >
                {statusBusyId === row.id ? '处理中…' : row.status === 'visible' ? '下架' : '恢复'}
              </ActionButton>
            )}
            {can('asset.delete') && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => void openDelete(row)}
              >
                删除
              </ActionButton>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, openDelete, statusBusyId, toggleStatus],
  );

  /** 表格页大小必须落在 `AdminDataTable` 的选项集里，否则选择器显示空值 */
  const tablePageSize = [20, 50, 100].includes(pageSize) ? pageSize : 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="素材管理"
        description="管理全平台用户的上传与生成素材；下架后用户端不可见但可恢复"
        actions={
          <>
            <SegmentedGroup
              ariaLabel="切换视图"
              value={view}
              onChange={(next) => handleViewChange(next as 'grid' | 'table')}
              options={[
                {
                  value: 'grid',
                  label: (
                    <span className="inline-flex items-center gap-1" title="缩略图网格">
                      <Grid3x3 className="size-3.5" aria-hidden />
                      网格
                    </span>
                  ),
                },
                {
                  value: 'table',
                  label: (
                    <span className="inline-flex items-center gap-1" title="表格视图">
                      <List className="size-3.5" aria-hidden />
                      表格
                    </span>
                  ),
                },
              ]}
            />
            {can('data.export') && (
              <ActionButton
                variant="secondary"
                icon={Download}
                onClick={() => void exportAssets()}
              >
                导出 CSV
              </ActionButton>
            )}
          </>
        }
      />

      {stats && (
        <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          <StatCard
            label="素材总量"
            value={stats.total}
            hint={`共 ${stats.totalMb} MB`}
          />
          <StatCard
            label="已下架"
            value={stats.byStatus.hidden ?? 0}
            hint="用户端不可见"
            tone={(stats.byStatus.hidden ?? 0) > 0 ? 'warn' : undefined}
          />
          <StatCard
            label="生成图"
            value={stats.byKind.generated ?? 0}
            hint={`原始上传 ${stats.byKind.original ?? 0}`}
          />
          <StatCard
            label="存储分布"
            value={
              <span className="flex items-center gap-1.5 text-[15px] leading-6">
                <HardDrive className="size-4 text-muted-foreground" aria-hidden />
                {Object.entries(stats.byBackend)
                  .map(([k, v]) => `${BACKEND_LABEL[k] ?? k} ${v}`)
                  .join(' · ') || '—'}
              </span>
            }
            hint="按写入时后端统计，切换后端不迁移既有文件"
          />
        </div>
      )}

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <FilterBar>
        <ClearableField
          className="w-56"
          placeholder="ID / 能力关键词"
          ariaLabel="按素材 ID 或能力关键词筛选"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
        />
        <SelectField
          className="w-32"
          ariaLabel="按类型筛选"
          placeholder="类型"
          allowClear
          clearLabel="全部类型"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'original', label: '原始上传' },
            { value: 'generated', label: '生成图' },
          ]}
        />
        <SelectField
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          clearLabel="全部状态"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'visible', label: '已上架' },
            { value: 'hidden', label: '已下架' },
          ]}
        />
        <SelectField
          className="w-36"
          ariaLabel="按存储后端筛选"
          placeholder="存储后端"
          allowClear
          clearLabel="全部存储后端"
          value={backend}
          onChange={setBackend}
          options={Object.entries(BACKEND_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <FilterActions>
          <ActionButton variant="default" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={resetFilters}
            disabled={appliedChips.length === 0 && !keyword && !kind && !status && !backend}
          >
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      {selected.length > 0 && (
        <div
          data-testid="admin-bulk-bar"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-accent px-3 py-2"
          role="status"
        >
          <span className="text-xs font-medium text-accent-foreground">
            已选 {selected.length} 张素材
          </span>
          {view === 'grid' && (
            <CheckboxField
              size="sm"
              checked={allPageSelected}
              indeterminate={somePageSelected}
              label={allPageSelected ? '取消全选' : '全选本页'}
              onChange={toggleSelectPage}
            />
          )}
          {can('asset.hide') && (
            <>
              <ActionButton
                variant="secondary"
                onClick={() => void runBatch('hide')}
                disabled={busy}
              >
                批量下架
              </ActionButton>
              <ActionButton
                variant="secondary"
                onClick={() => void runBatch('show')}
                disabled={busy}
              >
                批量恢复
              </ActionButton>
            </>
          )}
          {can('asset.delete') && (
            <ActionButton
              variant="destructive"
              onClick={() => void runBatch('delete')}
              disabled={busy}
            >
              批量删除
            </ActionButton>
          )}
          <ActionButton variant="ghost" onClick={() => setSelected([])}>
            清空选择
          </ActionButton>
        </div>
      )}

      <Panel
        title={view === 'grid' ? '缩略图网格' : '素材列表'}
        note={`${total} 张`}
        extra={
          view === 'grid' && items.length > 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FolderOpen className="size-3.5" aria-hidden />
              每页 {pageSize} 张
            </span>
          ) : undefined
        }
      >
        {view === 'grid' ? (
          loading && items.length === 0 ? (
            <div className="flex flex-col gap-2 py-2">
              <Skeleton rows={4} />
              <p className="text-center text-xs text-muted-foreground">加载素材…</p>
            </div>
          ) : error && items.length === 0 ? (
            <ListError error={error} onRetry={reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={appliedChips.length > 0 ? '没有符合条件的素材' : '暂无素材'}
              description={
                appliedChips.length > 0
                  ? '没有符合当前筛选条件的素材。清除筛选后可查看全部素材。'
                  : '暂无素材。用户上传或生成图片后，会在这里出现。'
              }
              action={
                appliedChips.length > 0 ? (
                  <ActionButton variant="secondary" onClick={resetFilters}>
                    清除筛选
                  </ActionButton>
                ) : undefined
              }
            />
          ) : (
            <>
              <div
                className={cn(
                  'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]',
                  loading && 'opacity-60',
                )}
                aria-busy={loading}
              >
                {items.map((a) => {
                  const checked = selected.includes(a.id);
                  return (
                    <article
                      key={a.id}
                      data-testid="admin-asset-cell"
                      data-status={a.status}
                      className={cn(
                        'group overflow-hidden rounded-xl border bg-card transition-colors',
                        checked ? 'border-brand ring-1 ring-brand/20' : 'border-border',
                        a.status === 'hidden' && 'opacity-75',
                      )}
                    >
                      <div className="relative aspect-square">
                        <button
                          type="button"
                          className="block size-full"
                          aria-label={`查看大图：${assetLabel(a)}`}
                          onClick={() => setPreviewId(a.id)}
                        >
                          <AssetThumb
                            className="size-full"
                            src={thumbSrc(a.sourceUrl, 320)}
                            alt={`${assetLabel(a)}缩略图`}
                          />
                        </button>

                        {selectable && (
                          <span className="absolute left-2 top-2 flex size-5 items-center justify-center rounded bg-card/90 shadow-xs">
                            <CheckboxField
                              ariaLabel={`选择 ${assetLabel(a)}`}
                              checked={checked}
                              onChange={(next) => toggleSelected(a.id, next)}
                            />
                          </span>
                        )}

                        {a.status === 'hidden' && (
                          <span className="absolute right-2 top-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] text-background">
                            已下架
                          </span>
                        )}

                        <div
                          className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-foreground/55 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                          role="group"
                          aria-label="素材快捷操作"
                        >
                          <IconButton
                            size="sm"
                            icon={Maximize2}
                            label={`查看大图：${assetLabel(a)}`}
                            title="查看大图"
                            onClick={() => setPreviewId(a.id)}
                          />
                          {can('asset.hide') && (
                            <IconButton
                              size="sm"
                              icon={a.status === 'visible' ? EyeOff : Eye}
                              label={a.status === 'visible' ? '下架素材' : '恢复上架'}
                              title={a.status === 'visible' ? '下架素材' : '恢复上架'}
                              disabled={statusBusyId === a.id}
                              onClick={() =>
                                void toggleStatus(
                                  a,
                                  a.status === 'visible' ? 'hidden' : 'visible',
                                )
                              }
                            />
                          )}
                          {can('asset.delete') && (
                            <IconButton
                              size="sm"
                              icon={Trash2}
                              label="永久删除素材"
                              title="永久删除"
                              className="text-danger-text hover:text-danger-text"
                              onClick={() => void openDelete(a)}
                            />
                          )}
                        </div>
                      </div>

                      <div className="px-2 py-1.5">
                        <div className="truncate text-xs font-medium text-foreground" title={assetLabel(a)}>
                          {assetLabel(a)}
                        </div>
                        <div
                          className="truncate text-[11px] text-muted-foreground"
                          title={`${fmtFormat(a.format)}${
                            a.width && a.height ? ` · ${a.width}×${a.height}` : ''
                          } · ${fmtBytes(a.sizeBytes)}`}
                        >
                          {fmtFormat(a.format)}
                          {a.width && a.height ? ` · ${a.width}×${a.height}` : ''} ·{' '}
                          {fmtBytes(a.sizeBytes)}
                        </div>
                        <div
                          className="truncate text-[11px] text-muted-foreground"
                          title={`${a.ownerEmail} · ${a.projectName}`}
                        >
                          {a.ownerEmail} · {a.projectName}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {total > 0 && (
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">共 {total} 张</span>
                  <Pagination
                    page={Math.min(page, totalPages)}
                    totalPages={totalPages}
                    // 翻页必须清空选择: 否则会对看不见的行执行批量下架/删除
                    onChange={(next) => {
                      setSelected([]);
                      setPage(next);
                    }}
                    previousLabel="上一页"
                    nextLabel="下一页"
                    aria-label="分页"
                  />
                </div>
              )}
            </>
          )
        ) : (
          <AdminDataTable<Row>
            rows={items}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            error={error}
            onRetry={reload}
            minWidth={1300}
            rowClassName={(row) => (row.status === 'hidden' ? 'bg-warn-soft/40' : undefined)}
            selectable={selectable}
            selected={selected}
            onSelectedChange={setSelected}
            emptyText={
              appliedChips.length > 0
                ? '没有符合当前筛选条件的素材。清除筛选后可查看全部素材。'
                : '暂无素材。用户上传或生成图片后，会在这里出现。'
            }
            emptyAction={
              appliedChips.length > 0 ? (
                <ActionButton variant="secondary" onClick={resetFilters}>
                  清除筛选
                </ActionButton>
              ) : undefined
            }
            pagination={
              data
                ? {
                    current: page,
                    pageSize: tablePageSize,
                    total,
                    unit: '张',
                    // 翻页必须清空选择: 否则会对看不见的行执行批量下架/删除
                    onChange: (next, size) => {
                      setSelected([]);
                      setPage(next, size);
                    },
                  }
                : undefined
            }
          />
        )}
      </Panel>

      {previewAsset && (
        <ImageLightbox
          items={previewItems}
          index={previewIndex}
          onIndexChange={(nextIndex) => setPreviewId(items[nextIndex]?.id ?? null)}
          onClose={() => setPreviewId(null)}
          ariaLabel="素材预览"
          renderActions={(nextIndex) => {
            const asset = items[nextIndex];
            if (!asset) return null;
            return (
              <div className="img-viewer-actions">
                {can('asset.hide') && (
                  <button
                    type="button"
                    className="img-viewer-action"
                    disabled={statusBusyId === asset.id}
                    onClick={() => {
                      setPreviewId(null);
                      void toggleStatus(
                        asset,
                        asset.status === 'visible' ? 'hidden' : 'visible',
                      );
                    }}
                  >
                    {asset.status === 'visible' ? <EyeOff size={14} /> : <Eye size={14} />}
                    {asset.status === 'visible' ? '下架' : '恢复'}
                  </button>
                )}
                {can('asset.delete') && (
                  <button
                    type="button"
                    className="img-viewer-action is-danger"
                    onClick={() => void openDelete(asset)}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                )}
              </div>
            );
          }}
        />
      )}

      <BatchResultModal
        open={batchSummary !== null}
        title={batchTitle}
        summary={batchSummary}
        onClose={() => setBatchSummary(null)}
      />
    </>
  );
}
