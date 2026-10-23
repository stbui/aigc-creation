import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Segmented, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, Grid3x3, HardDrive, List } from 'lucide-react';
import { adminAssetsApi, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
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
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  /** 批量删除需要二次确认: 它会连磁盘文件一起删, 不可恢复 */
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchSummary<unknown> | null>(null);
  const [batchTitle, setBatchTitle] = useState('');

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminAssetsApi.list({
        page: params.page as number,
        pageSize: view === 'grid' ? 60 : ((params.pageSize as number) ?? 20),
        keyword: params.keyword as string | undefined,
        kind: params.kind as string | undefined,
        status: params.status as string | undefined,
        backend: params.backend as string | undefined,
      }),
    [view],
  );

  const { data, loading, error, setQuery, setPage, reload } =
    useAdminList<AdminAssetListResult>(fetcher);

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

  const toggleStatus = async (row: Row, next: AssetStatus) => {
    try {
      await adminAssetsApi.setStatus(row.id, next);
      void message.success(next === 'hidden' ? '已下架，用户端不再展示' : '已恢复上架');
      reload();
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

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
      setBatchDeleteOpen(false);
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
        keyword: keyword || undefined,
        kind,
        status,
        backend,
      });
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await adminAssetsApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      void message.success(`已删除，连带清理 ${res.removedTasks} 条任务记录`);
      reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '预览',
        key: 'thumb',
        width: 64,
        render: (_: unknown, row) => (
          <img className="adm-asset-thumb-sm" src={thumbOf(row.sourceUrl)} alt="" loading="lazy" />
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
      { title: '大小', dataIndex: 'sizeBytes', key: 'size', width: 80, align: 'right',
        render: (v: number) => fmtBytes(v) },
      { title: '存储', dataIndex: 'storageBackend', key: 'backend', width: 90,
        render: (b: string) => BACKEND_LABEL[b] ?? b },
      { title: '所属用户', dataIndex: 'ownerEmail', key: 'owner', width: 170 },
      { title: '项目', dataIndex: 'projectName', key: 'project', width: 120 },
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
                onClick={() => void toggleStatus(row, row.status === 'visible' ? 'hidden' : 'visible')}
              >
                {row.status === 'visible' ? '下架' : '恢复'}
              </Button>
            )}
            {can('asset.delete') && (
              <Button
                type="link" danger
                className="adm-link is-danger"
                onClick={() => setDeleteTarget(row)}
              >
                删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can],
  );

  if (loading && !data) return <AdminListLoading tip="加载素材…" />;
  if (error && !data) return <AdminListError error={error} onRetry={reload} />;

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="素材管理"
        description="管理全平台用户的上传与生成素材；下架后用户端不可见但可恢复"
        actions={
          <>
            <Segmented
              value={view}
              onChange={(value) => setView(value as 'grid' | 'table')}
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
            {can('asset.hide') && selected.length > 0 && (
              <>
                <Button type="default" className="adm-btn" onClick={() => void runBatch('hide')} disabled={busy}>
                  批量下架 ({selected.length})
                </Button>
                <Button type="default" className="adm-btn" onClick={() => void runBatch('show')} disabled={busy}>
                  批量恢复
                </Button>
              </>
            )}
            {can('asset.delete') && selected.length > 0 && (
              <Button
                type="primary" danger
                className="adm-btn is-danger"
                onClick={() => setBatchDeleteOpen(true)}
                disabled={busy}
              >
                批量删除
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
          onPressEnter={() => {
            setSelected([]);
            setQuery({ keyword: keyword || undefined });
          }}
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
            onClick={() => {
              setSelected([]);
              setQuery({ keyword: keyword || undefined, kind, status, backend });
            }}
          >
            查询
          </Button>
          <Button
            type="default"
            className="adm-btn"
            onClick={() => {
              setKeyword(''); setKind(undefined); setStatus(undefined); setBackend(undefined);
              setSelected([]);
              setQuery({ keyword: undefined, kind: undefined, status: undefined, backend: undefined });
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <Panel title={view === 'grid' ? '缩略图网格' : '素材列表'}>
        {items.length === 0 ? (
          <AdminEmpty description="没有符合条件的素材" />
        ) : view === 'grid' ? (
          <div className="adm-asset-grid">
            {items.map((a) => (
              <div
                key={a.id}
                className={`adm-asset-cell${selected.includes(a.id) ? ' is-selected' : ''}`}
                onClick={() =>
                  (can('asset.hide') || can('asset.delete')) &&
                  setSelected((s) =>
                    s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id],
                  )
                }
              >
                <img src={thumbOf(a.sourceUrl)} alt="" loading="lazy" />
                {a.status === 'hidden' && <span className="adm-asset-badge">已下架</span>}
                <div className="adm-asset-info">
                  <div className="adm-asset-name">
                    {a.capability ?? (a.kind === 'original' ? '原始上传' : '生成图')}
                  </div>
                  <div className="adm-asset-meta">
                    {a.width && a.height ? `${a.width}×${a.height} · ` : ''}
                    {fmtBytes(a.sizeBytes)} · {BACKEND_LABEL[a.storageBackend] ?? a.storageBackend}
                  </div>
                  <div className="adm-asset-meta">{a.ownerEmail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={items}
            loading={loading}
            scroll={{ x: 1200 }}
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

      {deleteTarget && (
        <ConfirmAction
          open
          title="删除素材"
          confirmText="永久删除"
          danger
          requireTyping
          typingText="删除"
          loading={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void doDelete()}
          description={
            <>
              <p>删除后素材文件与其产出任务都会被清理，操作不可恢复。</p>
              <p className="adm-cell-sub">
                存储位置：{BACKEND_LABEL[deleteTarget.storageBackend] ?? deleteTarget.storageBackend} ·{' '}
                {deleteTarget.storageKey}
              </p>
            </>
          }
          impact={[
            `文件大小 ${fmtBytes(deleteTarget.sizeBytes)} 将被释放`,
            '其产出的生成任务记录会一并删除',
            '若为云端素材，仅删除当前后端上的副本',
          ]}
        />
      )}

      {/* 批量删除: 连磁盘文件一起删, 必须二次确认并输入确认词 */}
      {batchDeleteOpen && (
        <ConfirmAction
          open
          title={`批量删除 ${selected.length} 张素材`}
          confirmText="永久删除"
          danger
          requireTyping
          typingText="删除"
          loading={busy}
          description={
            <>
              <p>选中的素材文件会被移除，产出它们的历史任务记录也一并清理，操作不可恢复。</p>
              <p className="adm-cell-sub">
                已选中的素材中，失败项会在结果里逐条列出原因（例如文件已不存在）。
              </p>
            </>
          }
          impact={[
            `共 ${selected.length} 张素材`,
            '其磁盘 / 云端文件将被删除',
            '产出这些素材的生成任务记录会一并清理',
          ]}
          onCancel={() => setBatchDeleteOpen(false)}
          onConfirm={() => void runBatch('delete')}
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
