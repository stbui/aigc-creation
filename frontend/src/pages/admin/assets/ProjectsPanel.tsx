import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  ClearableField,
  FilterActions,
  FilterBar,
  Panel,
  StaleError,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { adminAssetsApi } from './api';
import { useAdmin, useToast } from './hooks';
import { ProjectDeleteConfirm, type ProjectDeleteResult } from './ProjectDeleteConfirm';
import { ProjectFormDrawer } from './ProjectFormDrawer';
import type { AdminProject, AdminProjectListResult, Project } from '../../../types/api';

const DEFAULT_PAGE_SIZE = 20;

/** 后台项目分类列表：查询、新建、重命名、删除与素材迁移。 */
export function ProjectsPanel({ onDataChanged }: { onDataChanged?: () => void }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canWrite = can('project.write');
  const canDelete = can('project.delete');

  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<AdminProjectListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminProject | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminAssetsApi.listProjects({
        page,
        pageSize,
        keyword: appliedKeyword || undefined,
      });
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '项目列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, page, pageSize, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  const applyFilters = () => {
    const next = keyword.trim();
    setPage(1);
    if (next === appliedKeyword) reload();
    else setAppliedKeyword(next);
  };

  const resetFilters = () => {
    setKeyword('');
    setAppliedKeyword('');
    setPage(1);
    if (!appliedKeyword) reload();
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (project: AdminProject) => {
    setEditing(project);
    setFormOpen(true);
  };

  const onSaved = (project: Project, mode: 'create' | 'update') => {
    toast.success(mode === 'create' ? `已创建项目「${project.name}」` : '项目名称已更新');
    reload();
    onDataChanged?.();
  };

  const onDeleted = (result: ProjectDeleteResult) => {
    toast.success(
      result.movedAssets > 0
        ? `项目已删除，${result.movedAssets} 个素材已迁移`
        : '项目已删除',
    );
    setDeleteTarget(null);
    onDataChanged?.();
    if (data?.items.length === 1 && page > 1) setPage((current) => current - 1);
    else reload();
  };

  const columns = useMemo<Array<AdminColumn<AdminProject>>>(() => [
    {
      key: 'name',
      title: '项目名称',
      width: 220,
      cellTitle: (project) => project.name,
      render: (project) => <span className="block max-w-[220px] truncate font-medium">{project.name}</span>,
    },
    {
      key: 'ownerName',
      title: '所属用户',
      width: 230,
      cellTitle: (project) => project.ownerEmail,
      render: (project) => (
        <div className="min-w-0">
          <div className="truncate">{project.ownerName || '未命名用户'}</div>
          <div className="truncate text-xs text-muted-foreground">{project.ownerEmail}</div>
        </div>
      ),
    },
    {
      key: 'assetCount',
      title: '素材数',
      width: 90,
      align: 'right',
      render: (project) => <span className="tabular-nums">{project.assetCount}</span>,
    },
    {
      key: 'taskCount',
      title: '任务数',
      width: 90,
      align: 'right',
      render: (project) => <span className="tabular-nums">{project.taskCount}</span>,
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 170,
      render: (project) => new Date(project.createdAt).toLocaleString('zh-CN'),
    },
    {
      key: 'ops',
      title: '操作',
      width: 150,
      align: 'right',
      fixed: 'right',
      render: (project) => (
        <div className="flex items-center justify-end gap-1">
          {canWrite && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={Pencil}
              onClick={() => openEdit(project)}
            >
              编辑
            </ActionButton>
          )}
          {canDelete && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={() => setDeleteTarget(project)}
            >
              删除
            </ActionButton>
          )}
        </div>
      ),
    },
  ], [canDelete, canWrite]);

  const emptyAction = canWrite ? (
    <ActionButton variant="default" size="sm" icon={FolderPlus} onClick={openCreate}>
      新建项目
    </ActionButton>
  ) : undefined;

  return (
    <>
      {error && data && <StaleError error={error} onRetry={reload} />}

      <FilterBar>
        <ClearableField
          className="w-64"
          placeholder="项目名称关键词"
          ariaLabel="按项目名称筛选"
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
        />
        <FilterActions>
          <ActionButton variant="default" onClick={applyFilters}>查询</ActionButton>
          <ActionButton
            variant="secondary"
            onClick={resetFilters}
            disabled={!keyword && !appliedKeyword}
          >
            重置
          </ActionButton>
        </FilterActions>
      </FilterBar>

      <Panel
        title="项目分类"
        note={`${data?.total ?? 0} 个项目`}
        extra={canWrite ? (
          <ActionButton variant="default" size="sm" icon={FolderPlus} onClick={openCreate}>
            新建项目
          </ActionButton>
        ) : undefined}
      >
        <AdminDataTable
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(project) => project.id}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyText={appliedKeyword ? '没有匹配的项目' : '还没有项目分类'}
          emptyAction={emptyAction}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            unit: '个项目',
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
        />
      </Panel>

      <ProjectFormDrawer
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
      />

      {deleteTarget && (
        <ProjectDeleteConfirm
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
