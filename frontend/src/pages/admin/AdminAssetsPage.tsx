import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Checkbox, Input, Segmented, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import {
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
import { adminAssetsApi, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { ImageLightbox, type LightboxItem } from '../../components/ImageLightbox';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  adminPagination,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import { BatchResultModal } from '../../components/admin/BatchResultModal';
import type {
  AdminAssetListResult,
  AdminAssetStats,
  AssetStatus,
  BatchSummary,
} from '../../types/api';

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
      <span className={`${className} is-error`} role="img" aria-label={`${alt}，缩略图加载失败`}>
        <ImageOff size={18} aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function AdminAssetsPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();

  const [keyword, setKeyword] = useState('');
  const [kind, setKind] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [backend, setBackend] = useState<string | undefined>();
  /** B-25: 缩略图网格与表格视图切换。网格适合看图, 表格适合查属性 */
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const [stats, setStats] = useState<AdminAssetStats | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary<unknown> | null>(null);
  const [batchTitle, setBatchTitle] = useState('');

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
    useAdminList<AdminAssetListResult>(fetcher, { pageSize: 60 });
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
    appliedKeyword ? `关键词「${appliedKeyword}」` : null,
    appliedKind ? (appliedKind === 'original' ? '原始上传' : '生成图') : null,
    appliedStatus ? (appliedStatus === 'visible' ? '已上架' : '已下架') : null,
    appliedBackend ? (BACKEND_LABEL[appliedBackend] ?? appliedBackend) : null,
  ].filter(Boolean) as string[];

  const selectable = can('asset.hide') || can('asset.delete');
  const allPageSelected = items.length > 0 && items.every((item) => selected.includes(item.id));
  const somePageSelected = items.some((item) => selected.includes(item.id)) && !allPageSelected;

  /** 顶栏搜索带 `?q=` 跳过来时套用关键词（ref 防止覆盖页内手动筛选） */
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const appliedQ = useRef('');
  useEffect(() => {
    if (!urlQ || urlQ === appliedQ.current) return;
    appliedQ.current = urlQ;
    setKeyword(urlQ);
    setQuery({ keyword: urlQ });
  }, [urlQ, setQuery]);

  useEffect(() => {
    adminAssetsApi
      .stats()
      .then(setStats)
      .catch(() => undefined);
  }, [reload]);

  const applyFilters = useCallback(() => {
    setSelected([]);
    setQuery({
      keyword: keyword.trim() || undefined,
      kind,
      status,
      backend,
    });
  }, [backend, keyword, kind, setQuery, status]);

  const resetFilters = useCallback(() => {
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

  const toggleStatus = useCallback(async (row: Row, next: AssetStatus) => {
    if (statusBusyId) return;
    setStatusBusyId(row.id);
    try {
      await adminAssetsApi.setStatus(row.id, next);
      void message.success(next === 'hidden' ? '已下架，用户端不再展示' : '已恢复上架');
      reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setStatusBusyId(null);
    }
  }, [message, reload, statusBusyId]);

  /**
   * 批量动作走 `/admin/assets/batch`（逐条结果）而不是旧的 `batch-status`（只回 count）。
   *
   * 素材可能在这几秒内被用户删掉 / 被别的运营下架 —— 只回一个总数时,
   * 少处理的几条会被 `已处理 N 条` 掩盖过去。逐条结果才能把失败原因摊开。
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
      void message.error((e as Error).message);
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
      void message.error((e as Error).message);
    }
  };

  /** 删除按产品要求直接执行，不再弹窗二次确认 */
  const openDelete = useCallback(
    async (row: Row) => {
      setPreviewId(null);
      setBusy(true);
      try {
        const res = await adminAssetsApi.remove(row.id);
        void message.success(`已删除，连带清理 ${res.removedTasks} 条任务记录`);
        reload();
      } catch (e) {
        void message.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '预览',
        key: 'thumb',
        width: 72,
        render: (_: unknown, row) => (
          <button
            type="button"
            className="adm-asset-thumb-btn"
            title="查看大图"
            aria-label={`查看大图：${assetLabel(row)}`}
            onClick={() => setPreviewId(row.id)}
          >
            <AssetThumb
              className="adm-asset-thumb-sm"
              src={thumbOf(row.sourceUrl)}
              alt={`${assetLabel(row)}缩略图`}
            />
          </button>
        ),
      },
      {
        title: '类型',
        dataIndex: 'kind',
        key: 'kind',
        width: 80,
        render: (k: string) => (k === 'original' ? '原始' : '生成'),
      },
      {
        title: '能力',
        dataIndex: 'capability',
        key: 'capability',
        width: 130,
        ellipsis: true,
        render: (c: string | null) => c ?? <span className="adm-cell-sub">—</span>,
      },
      {
        title: '尺寸',
        key: 'dim',
        width: 110,
        render: (_: unknown, row) => (
          <span className="adm-cell-sub">
            {row.width && row.height ? `${row.width}×${row.height}` : '—'}
          </span>
        ),
      },
      {
        title: '格式',
        dataIndex: 'format',
        key: 'format',
        width: 68,
        render: (format: string) => <span className="adm-cell-sub">{fmtFormat(format)}</span>,
      },
      { title: '大小', dataIndex: 'sizeBytes', key: 'size', width: 80, align: 'right',
        render: (v: number) => fmtBytes(v) },
      { title: '存储', dataIndex: 'storageBackend', key: 'backend', width: 90,
        render: (b: string) => BACKEND_LABEL[b] ?? b },
      { title: '所属用户', dataIndex: 'ownerEmail', key: 'owner', width: 190, ellipsis: true },
      { title: '项目', dataIndex: 'projectName', key: 'project', width: 130, ellipsis: true },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 80,
        render: (s: string) => (
          <span className={`adm-tag ${s === 'visible' ? 'is-success' : 'is-warn'}`}>
            <span className="adm-tag-dot" />
            {s === 'visible' ? '已上架' : '已下架'}
          </span>
        ),
      },
      {
        title: '上传时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 120,
        render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
      },
      {
        title: '操作',
        key: 'actions',
        width: 130,
        fixed: 'right',
        render: (_: unknown, row) => (
          <div className="adm-row-actions">
            {can('asset.hide') && (
              <Button
                type="link"
                className="adm-link"
                loading={statusBusyId === row.id}
                disabled={statusBusyId !== null && statusBusyId !== row.id}
                onClick={() => void toggleStatus(row, row.status === 'visible' ? 'hidden' : 'visible')}
              >
                {row.status === 'visible' ? '下架' : '恢复'}
              </Button>
            )}
            {can('asset.delete') && (
              <Button
                type="link" danger
                className="adm-link is-danger"
                onClick={() => void openDelete(row)}
              >
                删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, openDelete, statusBusyId, toggleStatus],
  );

  if (loading && !data) return <AdminListLoading tip="加载素材…" />;
  if (error && !data) return <AdminListError error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="素材管理"
        description="管理全平台用户的上传与生成素材；下架后用户端不可见但可恢复"
        actions={
          <>
            <Segmented
              value={view}
              onChange={(value) => handleViewChange(value as 'grid' | 'table')}
              options={[
                {
                  value: 'grid',
                  label: (
                    <span className="adm-segmented-item" title="缩略图网格">
                      <Grid3x3 size={14} />
                    </span>
                  ),
                },
                {
                  value: 'table',
                  label: (
                    <span className="adm-segmented-item" title="表格视图">
                      <List size={14} />
                    </span>
                  ),
                },
              ]}
            />
            {can('data.export') && (
              <Button type="default" className="adm-btn" onClick={() => void exportAssets()}>
                导出 CSV
              </Button>
            )}
          </>
        }
      />

      {stats && (
        <div className="adm-stat-grid is-4">
          <div className="adm-stat is-primary">
            <div className="adm-stat-head">
              <span className="adm-stat-label">素材总量</span>
              <FolderOpen className="adm-stat-icon" size={16} />
            </div>
            <div className="adm-stat-value">{stats.total}</div>
            <div className="adm-stat-hint">共 {stats.totalMb} MB</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">已下架</span>
            </div>
            <div className="adm-stat-value">{stats.byStatus.hidden ?? 0}</div>
            <div className="adm-stat-hint">用户端不可见</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">生成图</span>
            </div>
            <div className="adm-stat-value">{stats.byKind.generated ?? 0}</div>
            <div className="adm-stat-hint">原始上传 {stats.byKind.original ?? 0}</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">存储分布</span>
              <HardDrive className="adm-stat-icon" size={16} />
            </div>
            <div className="adm-stat-value" style={{ fontSize: 18 }}>
              {Object.entries(stats.byBackend)
                .map(([k, v]) => `${BACKEND_LABEL[k] ?? k} ${v}`)
                .join(' · ') || '—'}
            </div>
            <div className="adm-stat-hint">按写入时后端统计</div>
          </div>
        </div>
      )}

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && <AdminStaleError error={error} onRetry={reload} />}

      <div className="adm-filter">
        <Input
          className="adm-filter-input"
          placeholder="ID / 能力关键词"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={applyFilters}
          aria-label="按素材 ID 或能力关键词筛选"
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="类型"
          options={[
            { value: 'original', label: '原始上传' },
            { value: 'generated', label: '生成图' },
          ]}
          value={kind}
          onChange={setKind}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="状态"
          options={[
            { value: 'visible', label: '已上架' },
            { value: 'hidden', label: '已下架' },
          ]}
          value={status}
          onChange={setStatus}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="存储后端"
          options={Object.entries(BACKEND_LABEL).map(([value, label]) => ({ value, label }))}
          value={backend}
          onChange={setBackend}
          allowClear
        />
        <div className="adm-filter-actions">
          <Button
            type="primary"
            className="adm-btn is-primary"
            onClick={applyFilters}
          >
            查询
          </Button>
          <Button
            type="default"
            className="adm-btn"
            onClick={resetFilters}
            disabled={!appliedChips.length && !keyword && !kind && !status && !backend}
          >
            重置
          </Button>
        </div>
        {appliedChips.length > 0 && (
          <div className="adm-filter-chips" aria-label="已生效的筛选条件">
            <span className="adm-filter-chips-label">已筛选</span>
            {appliedChips.map((chip, index) => (
              <span className="adm-filter-chip" key={`${index}-${chip}`}>
                {chip}
              </span>
            ))}
            <Button type="link" className="adm-filter-chip-clear" onClick={resetFilters}>
              全部清除
            </Button>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="adm-bulk-bar" role="status">
          <span className="adm-bulk-count">已选 {selected.length} 张素材</span>
          <Checkbox
            checked={allPageSelected}
            indeterminate={somePageSelected}
            onChange={(e) => toggleSelectPage(e.target.checked)}
          >
            {allPageSelected ? '取消全选' : '全选本页'}
          </Checkbox>
          {can('asset.hide') && (
            <>
              <Button
                type="default"
                className="adm-btn"
                onClick={() => void runBatch('hide')}
                disabled={busy}
              >
                批量下架
              </Button>
              <Button
                type="default"
                className="adm-btn"
                onClick={() => void runBatch('show')}
                disabled={busy}
              >
                批量恢复
              </Button>
            </>
          )}
          {can('asset.delete') && (
            <Button
              type="primary"
              danger
              className="adm-btn is-danger"
              onClick={() => void runBatch('delete')}
              disabled={busy}
            >
              批量删除
            </Button>
          )}
          <Button type="link" className="adm-link" onClick={() => setSelected([])}>
            清空选择
          </Button>
        </div>
      )}

      <Panel
        title={view === 'grid' ? '缩略图网格' : '素材列表'}
        note={`${data?.total ?? 0} 张`}
      >
        {items.length === 0 ? (
          <AdminEmpty
            description={
              appliedChips.length > 0
                ? '没有符合当前筛选条件的素材。清除筛选后可查看全部素材。'
                : '暂无素材。用户上传或生成图片后，会在这里出现。'
            }
            action={
              appliedChips.length > 0 ? (
                <Button type="default" className="adm-btn" onClick={resetFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : view === 'grid' ? (
          <div className="adm-asset-grid" aria-busy={loading}>
            {items.map((a) => (
              <article
                key={a.id}
                className={[
                  'adm-asset-cell',
                  selected.includes(a.id) ? 'is-selected' : '',
                  a.status === 'hidden' ? 'is-hidden' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="adm-asset-visual">
                  <button
                    type="button"
                    className="adm-asset-preview"
                    aria-label={`查看大图：${assetLabel(a)}`}
                    onClick={() => setPreviewId(a.id)}
                  >
                    <AssetThumb
                      className="adm-asset-image"
                      src={thumbOf(a.sourceUrl)}
                      alt={`${assetLabel(a)}缩略图`}
                    />
                  </button>
                  {selectable && (
                    <span className="adm-asset-select" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.includes(a.id)}
                        onChange={(e) => toggleSelected(a.id, e.target.checked)}
                        aria-label={`选择 ${assetLabel(a)}`}
                      />
                    </span>
                  )}
                  {a.status === 'hidden' && <span className="adm-asset-badge">已下架</span>}
                  <div className="adm-asset-actions" role="group" aria-label="素材快捷操作">
                    <button
                      type="button"
                      className="adm-asset-action"
                      title="查看大图"
                      aria-label={`查看大图：${assetLabel(a)}`}
                      onClick={() => setPreviewId(a.id)}
                    >
                      <Maximize2 size={15} />
                    </button>
                    {can('asset.hide') && (
                      <button
                        type="button"
                        className="adm-asset-action"
                        title={a.status === 'visible' ? '下架素材' : '恢复上架'}
                        aria-label={a.status === 'visible' ? '下架素材' : '恢复上架'}
                        disabled={statusBusyId === a.id}
                        onClick={() =>
                          void toggleStatus(a, a.status === 'visible' ? 'hidden' : 'visible')
                        }
                      >
                        {a.status === 'visible' ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    )}
                    {can('asset.delete') && (
                      <button
                        type="button"
                        className="adm-asset-action is-danger"
                        title="永久删除"
                        aria-label="永久删除素材"
                        onClick={() => void openDelete(a)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="adm-asset-info">
                  <div className="adm-asset-name" title={assetLabel(a)}>
                    {assetLabel(a)}
                  </div>
                  <div
                    className="adm-asset-meta"
                    title={`${fmtFormat(a.format)}${a.width && a.height ? ` · ${a.width}×${a.height}` : ''} · ${fmtBytes(a.sizeBytes)}`}
                  >
                    {fmtFormat(a.format)}
                    {a.width && a.height ? ` · ${a.width}×${a.height}` : ''} ·{' '}
                    {fmtBytes(a.sizeBytes)}
                  </div>
                  <div className="adm-asset-meta" title={`${a.ownerEmail} · ${a.projectName}`}>
                    {a.ownerEmail} · {a.projectName}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={items}
            loading={loading}
            scroll={{ x: 1300 }}
            rowClassName={(row) => (row.status === 'hidden' ? 'is-hidden-row' : '')}
            rowSelection={
              can('asset.hide') || can('asset.delete')
                ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }
                : undefined
            }
            pagination={adminPagination({
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              // 翻页必须清空选择: 否则会对看不见的行执行批量下架/删除
              onChange: (page, size) => {
                setSelected([]);
                setPage(page, size);
              },
            })}
          />
        )}

        {view === 'grid' && (
          <div className="adm-pagination">
            <Button
              type="default"
              className="adm-btn"
              disabled={(data?.page ?? 1) <= 1}
              onClick={() => {
                setSelected([]);
                setPage((data?.page ?? 1) - 1);
              }}
            >
              上一页
            </Button>
            <span className="adm-cell-sub">
              第 {data?.page ?? 1} 页 · 共 {data?.total ?? 0} 条
            </span>
            <Button
              type="default"
              className="adm-btn"
              disabled={(data?.page ?? 1) * (data?.pageSize ?? 60) >= (data?.total ?? 0)}
              onClick={() => {
                setSelected([]);
                setPage((data?.page ?? 1) + 1);
              }}
            >
              下一页
            </Button>
          </div>
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
