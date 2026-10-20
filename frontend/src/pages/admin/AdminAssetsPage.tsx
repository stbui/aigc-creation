import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FolderOpen, Grid3x3, HardDrive, List } from 'lucide-react';
import { adminAssetsApi, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  ConfirmAction,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import type {
  AdminAssetListResult,
  AdminAssetStats,
  AssetStatus,
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

  const batch = async (next: AssetStatus) => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const res = await adminAssetsApi.batchStatus(selected, next);
      void message.success(`已处理 ${res.count} 条`);
      setSelected([]);
      reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
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
              <button
                type="button"
                className="adm-link"
                onClick={() => void toggleStatus(row, row.status === 'visible' ? 'hidden' : 'visible')}
              >
                {row.status === 'visible' ? '下架' : '恢复'}
              </button>
            )}
            {can('asset.delete') && (
              <button
                type="button"
                className="adm-link is-danger"
                onClick={() => setDeleteTarget(row)}
              >
                删除
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can],
  );

  if (loading && !data) return <AdminListLoading tip="加载素材…" />;
  if (error) return <AdminListError error={error} onRetry={reload} />;

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="素材管理"
        description="管理全平台用户的上传与生成素材；下架后用户端不可见但可恢复"
        actions={
          <>
            <div className="adm-segmented">
              <button
                type="button"
                className={`adm-segmented-item${view === 'grid' ? ' is-active' : ''}`}
                onClick={() => setView('grid')}
                title="缩略图网格"
              >
                <Grid3x3 size={14} />
              </button>
              <button
                type="button"
                className={`adm-segmented-item${view === 'table' ? ' is-active' : ''}`}
                onClick={() => setView('table')}
                title="表格视图"
              >
                <List size={14} />
              </button>
            </div>
            {can('asset.hide') && selected.length > 0 && (
              <>
                <button type="button" className="adm-btn" onClick={() => void batch('hidden')} disabled={busy}>
                  批量下架 ({selected.length})
                </button>
                <button type="button" className="adm-btn" onClick={() => void batch('visible')} disabled={busy}>
                  批量恢复
                </button>
              </>
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

      <div className="adm-filter">
        <Input
          className="adm-filter-input"
          placeholder="ID / 能力关键词"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => setQuery({ keyword: keyword || undefined })}
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
          <button
            type="button"
            className="adm-btn is-primary"
            onClick={() => setQuery({ keyword: keyword || undefined, kind, status, backend })}
          >
            查询
          </button>
          <button
            type="button"
            className="adm-btn"
            onClick={() => {
              setKeyword(''); setKind(undefined); setStatus(undefined); setBackend(undefined);
              setQuery({ keyword: undefined, kind: undefined, status: undefined, backend: undefined });
            }}
          >
            重置
          </button>
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
                  can('asset.hide') &&
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
              can('asset.hide')
                ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }
                : undefined
            }
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (t) => `共 ${t} 条`,
              onChange: setPage,
            }}
          />
        )}

        {view === 'grid' && (
          <div className="adm-pagination">
            <button
              type="button"
              className="adm-btn"
              disabled={(data?.page ?? 1) <= 1}
              onClick={() => setPage((data?.page ?? 1) - 1)}
            >
              上一页
            </button>
            <span className="adm-cell-sub">
              第 {data?.page ?? 1} 页 · 共 {data?.total ?? 0} 条
            </span>
            <button
              type="button"
              className="adm-btn"
              disabled={(data?.page ?? 1) * (data?.pageSize ?? 60) >= (data?.total ?? 0)}
              onClick={() => setPage((data?.page ?? 1) + 1)}
            >
              下一页
            </button>
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
    </>
  );
}