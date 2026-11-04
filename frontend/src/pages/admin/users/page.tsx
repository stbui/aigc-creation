import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  BatchBar,
  BatchResultModal,
  ClearableField,
  ConfirmAction,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  RowMenu,
  SelectField,
  StatusTag,
  StaleError,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { adminUsersApi } from './api';
import { useAdmin, useAdminDetailParam, useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import { formatDateTime } from './utils';
import { DEFAULT_SORT, DELETE_CONFIRM_WORD, ROLE_OPTIONS, STATUS_OPTIONS } from './constants';
import { UserDetailDrawer } from './UserDetailDrawer';
import { UserStatusConfirm } from './UserStatusConfirm';
import { UserRoleConfirm } from './UserRoleConfirm';
import { UserDeleteConfirm } from './UserDeleteConfirm';
import { UserIdentityCell } from './UserIdentityCell';
import type { AdminUserListResult, BatchSummary } from '../../../types/api';

type Row = AdminUserListResult['items'][number];

/**
 * 用户管理。
 *
 * ## 选择状态不跨翻页保留
 *
 * 运营切到另一页继续勾选时，上一页选中的账号仍在选中集里 —— 界面上看不见
 * 它们，此时点「批量禁用」会禁用一批肉眼不可见的账号。每次重新查询就清空，
 * 是更安全的默认。
 *
 * ## 删除必须二次确认
 *
 * 删除会清空项目 / 任务 / 素材且不可恢复。确认条先展示影响数量，再要求
 * 手动输入「删除」—— 确认词与后端 `DeleteUserDto.confirm` 同一口径。
 *
 * ## 登录记录单独取数
 *
 * `GET /admin/users/:id/logins` 需要 `audit.read`。并进详情会让没有审计权限
 * 的角色顺带看到全站登录 IP，所以单独请求，403 按「不可见」渲染说明。
 */
export function AdminUsersPage() {
  const toast = useToast();
  const { can } = useAdmin();

  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('q') ?? '';
  const initialRole = ROLE_OPTIONS.some((option) => option.value === searchParams.get('role'))
    ? (searchParams.get('role') as string)
    : undefined;
  const initialStatus = STATUS_OPTIONS.some((option) => option.value === searchParams.get('status'))
    ? (searchParams.get('status') as string)
    : undefined;

  // 筛选输入与已提交的查询分离：不做每键即查，避免无意义请求
  const [keyword, setKeyword] = useState(initialKeyword);
  const [role, setRole] = useState<string | undefined>(initialRole);
  const [status, setStatus] = useState<string | undefined>(initialStatus);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminUsersApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        role: params.role as string | undefined,
        status: params.status as string | undefined,
        // 排序必须真的发给后端：少了这一行表头箭头会变而顺序不变
        sort: (params.sort as string | undefined) ?? DEFAULT_SORT,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminUserListResult>(fetcher, {
      ...(initialKeyword ? { keyword: initialKeyword } : {}),
      ...(initialRole ? { role: initialRole } : {}),
      ...(initialStatus ? { status: initialStatus } : {}),
    });

  /*
   * 顶栏全局搜索带 `?q=` 跳过来时自动套用筛选。
   * 用 ref 记录「已应用过哪一个值」而不是直接比较 state —— 用户在页内改筛选后
   * URL 不变，若每次渲染都按 URL 覆盖，页内筛选会被打回原样。
   */
  const urlQ = searchParams.get('q') ?? '';
  const appliedQ = useRef(initialKeyword);
  useEffect(() => {
    if (urlQ === appliedQ.current) return;
    appliedQ.current = urlQ;
    setKeyword(urlQ);
    setQuery({ keyword: urlQ || undefined });
  }, [urlQ, setQuery]);

  useAdminUrlFilterSync({
    q: params.keyword as string | undefined,
    role: params.role as string | undefined,
    status: params.status as string | undefined,
  });

  // 详情抽屉
  const [detailId, setDetailId] = useAdminDetailParam();

  const [selected, setSelected] = useState<string[]>([]);
  const [batchSummary, setBatchSummary] = useState<BatchSummary<{
    id: string;
    status: string;
  }> | null>(null);
  const [batchTitle, setBatchTitle] = useState('');

  // 高危操作
  const [statusTarget, setStatusTarget] = useState<Row | null>(null);
  const [roleTarget, setRoleTarget] = useState<Row | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const refresh = (tip?: string) => {
    reload();
    if (tip) toast.success(tip);
  };

  /** 翻页 / 改筛选都会清空选择，避免对不可见的行下手 */
  const queryAndClear = useCallback(
    (next: Record<string, unknown>, resetPage = true) => {
      setSelected([]);
      setQuery(next, resetPage);
    },
    [setQuery],
  );

  const applyFilters = () => {
    appliedQ.current = keyword.trim();
    queryAndClear({ keyword: keyword.trim() || undefined, role, status });
  };
  const resetFilters = () => {
    appliedQ.current = '';
    setKeyword('');
    setRole(undefined);
    setStatus(undefined);
    queryAndClear({ keyword: undefined, role: undefined, status: undefined });
  };

  const appliedKeyword = (params.keyword as string | undefined) ?? '';
  const appliedRole = params.role as string | undefined;
  const appliedStatus = params.status as string | undefined;
  const appliedChips: AppliedFilter[] = [
    appliedKeyword
      ? {
          key: 'keyword',
          label: `邮箱「${appliedKeyword}」`,
          onClear: () => {
            appliedQ.current = '';
            setKeyword('');
            queryAndClear({ keyword: undefined });
          },
        }
      : null,
    appliedRole
      ? {
          key: 'role',
          label: `角色：${ROLE_OPTIONS.find((option) => option.value === appliedRole)?.label ?? appliedRole}`,
          onClear: () => {
            setRole(undefined);
            queryAndClear({ role: undefined });
          },
        }
      : null,
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_OPTIONS.find((option) => option.value === appliedStatus)?.label ?? appliedStatus}`,
          onClear: () => {
            setStatus(undefined);
            queryAndClear({ status: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const hasFilter = Boolean(appliedKeyword || appliedRole || appliedStatus);
  const rows = data?.items ?? [];

  /** 批量启停按产品要求直接执行，不再弹窗二次确认 */
  const runBatch = async (action: 'disable' | 'enable') => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const summary = await adminUsersApi.batch(selected, action);
      setBatchTitle(action === 'disable' ? '批量禁用结果' : '批量启用结果');
      setBatchSummary(summary);
      setSelected([]);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败');
    } finally {
      setBusy(false);
    }
  };

  const exportUsers = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // 导出必须与屏幕上的列表同口径：用已生效的 params，而不是输入框草稿
      await adminUsersApi.exportCsv({
        keyword: (params.keyword as string) || undefined,
        role: params.role as string | undefined,
        status: params.status as string | undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const changeStatus = async (target: Row, next: 'active' | 'disabled') => {
    setBusy(true);
    try {
      await adminUsersApi.changeStatus(target.id, next);
      setStatusTarget(null);
      refresh(next === 'disabled' ? '账号已禁用，登录凭证立即失效' : '账号已启用');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: Row, next: string) => {
    setBusy(true);
    try {
      await adminUsersApi.changeRole(target.id, next);
      setRoleTarget(null);
      refresh('角色已变更');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  /** 物理删除。确认词由后端逐字校验，前端在确认条里已要求手动输入 */
  const confirmDelete = async (target: Row) => {
    setBusy(true);
    try {
      await adminUsersApi.remove(target.id, true, DELETE_CONFIRM_WORD);
      setDeleteTarget(null);
      setDetailId(null);
      refresh('用户已删除');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const doResetPassword = async (target: Row) => {
    setBusy(true);
    try {
      const res = await adminUsersApi.resetPassword(target.id);
      setTempPassword(res.tempPassword);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重置密码失败');
    } finally {
      setBusy(false);
    }
  };

  interface RowAction {
    key: string;
    label: string;
    danger?: boolean;
    separator?: boolean;
    onClick: () => void;
  }

  const rowMenuItems = (row: Row): RowAction[] =>
    [
      can('user.disable') && row.status !== 'deleted'
        ? {
            key: 'status',
            label: row.status === 'active' ? '禁用账号' : '启用账号',
            onClick: () => setStatusTarget(row),
          }
        : null,
      can('user.write') && row.status !== 'deleted'
        ? { key: 'role', label: '变更角色', onClick: () => setRoleTarget(row) }
        : null,
      can('user.reset_password') && row.status !== 'deleted'
        ? { key: 'pwd', label: '重置密码', onClick: () => void doResetPassword(row) }
        : null,
      can('user.delete')
        ? {
            key: 'del',
            label: '删除用户',
            danger: true,
            separator: true,
            onClick: () => setDeleteTarget(row),
          }
        : null,
    ].filter(Boolean) as RowAction[];

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'email',
        title: '用户',
        width: 300,
        sortable: true,
        cellTitle: (row: Row) =>
          row.name && row.name !== row.email ? `${row.name} · ${row.email}` : row.email,
        render: (row: Row) => (
          <UserIdentityCell user={row} onOpen={() => setDetailId(row.id)} />
        ),
      },
      {
        key: 'role',
        title: '角色',
        width: 80,
        render: (row: Row) => <StatusTag status={row.role} />,
      },
      {
        key: 'status',
        title: '状态',
        width: 80,
        render: (row: Row) => <StatusTag status={row.status} />,
      },
      {
        key: 'projects',
        title: '项目',
        width: 60,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{row.projectCount}</span>,
      },
      {
        key: 'tasks',
        title: '任务',
        width: 60,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{row.taskCount}</span>,
      },
      {
        key: 'assets',
        title: '素材',
        width: 60,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{row.assetCount}</span>,
      },
      {
        key: 'createdAt',
        title: '注册时间',
        width: 150,
        sortable: true,
        render: (row: Row) => (
          <span className="text-[12px] tabular-nums">{formatDateTime(row.createdAt)}</span>
        ),
      },
      {
        key: 'lastLoginAt',
        title: '最近登录',
        width: 150,
        sortable: true,
        // 无登录记录显示「—」而非空单元格：空白会被误读为加载中
        render: (row: Row) => (
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : '—'}
          </span>
        ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 140,
        fixed: 'right',
        /*
         * 只直显「详情」+「更多」，其余动作收进下拉。
         *
         * 实测：5 个动作平铺需约 340px，把整行撑高且右侧被裁。与
         * docs/admin-ui-design.md §2.3「操作列最多直显 2 个」一致。
         */
        render: (row: Row) => (
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
              详情
            </ActionButton>
            <RowMenu
              items={rowMenuItems(row).map((item) => ({
                key: item.key,
                label: item.label,
                danger: item.danger,
                separator: item.separator,
                onSelect: item.onClick,
              }))}
            />
          </div>
        ),
      },
    ],
    // rowMenuItems 只依赖 can() 与稳定的状态 setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can],
  );

  const sort = (params.sort as string | undefined) ?? DEFAULT_SORT;

  return (
    <>
      <PageHeader
        title="用户管理"
        description="管理注册用户的账号状态、角色与资源"
        actions={
          can('data.export') ? (
            <ActionButton
              variant="secondary"
              icon={Download}
              disabled={exporting}
              ariaLabel={exporting ? '正在导出用户 CSV' : '导出用户 CSV'}
              onClick={() => void exportUsers()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </ActionButton>
          ) : (
            <span className="text-[12px] text-muted-foreground">
              当前账号无 data.export 权限，不可导出
            </span>
          )
        }
      />

      <FilterBar>
        <ClearableField
          className="w-64"
          ariaLabel="按邮箱关键词搜索"
          placeholder="输入邮箱关键词"
          icon={<Search className="size-3.5" aria-hidden />}
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
        />
        <SelectField
          className="w-32"
          ariaLabel="按角色筛选"
          placeholder="角色"
          allowClear
          clearLabel="全部角色"
          value={role}
          onChange={setRole}
          options={ROLE_OPTIONS}
        />
        <SelectField
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          clearLabel="全部状态"
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <FilterActions>
          <ActionButton variant="default" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel
        title="用户列表"
        note="默认不显示已注销账号；已注销账号不可勾选，也不能进行批量操作。"
        extra={
          <span
            data-testid="admin-users-total"
            className="text-[12px] text-muted-foreground tabular-nums"
          >
            {data ? `共 ${data.total} 位用户` : loading ? '统计中…' : '—'}
          </span>
        }
      >
        <BatchBar count={selected.length} unit="位用户">
          {can('user.disable') && (
            <>
              <ActionButton
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void runBatch('disable')}
              >
                批量禁用
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void runBatch('enable')}
              >
                批量启用
              </ActionButton>
            </>
          )}
          <ActionButton variant="ghost" size="sm" onClick={() => setSelected([])}>
            清空选择
          </ActionButton>
        </BatchBar>

        <AdminDataTable<Row>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1040}
          sort={sort}
          onSortChange={(next) => setQuery({ sort: next ?? DEFAULT_SORT }, false)}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          // 已注销账号的批量启停必然失败，直接禁止勾选，避免制造无意义的失败项
          isRowSelectable={(row) => row.status !== 'deleted'}
          emptyText={
            hasFilter
              ? '没有符合条件的用户。清除筛选或换一个关键词试试。'
              : '还没有用户。用户注册后会出现在这里。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={
            data
              ? {
                  current: data.page,
                  pageSize: data.pageSize,
                  total: data.total,
                  unit: '位用户',
                  // 翻页时清空选择（见 selected 处的说明）
                  onChange: (page, size) => {
                    setSelected([]);
                    setPage(page, size);
                  },
                }
              : undefined
          }
        />
      </Panel>

      <UserDetailDrawer detailId={detailId} onClose={() => setDetailId(null)} />

      {/* 禁用 / 启用 */}
      {statusTarget && (
        <UserStatusConfirm
          target={statusTarget}
          loading={busy}
          onCancel={() => setStatusTarget(null)}
          onConfirm={(next) => void changeStatus(statusTarget, next)}
        />
      )}

      {/* 变更角色 */}
      {roleTarget && (
        <UserRoleConfirm
          target={roleTarget}
          loading={busy}
          onCancel={() => setRoleTarget(null)}
          onConfirm={(next) => void changeRole(roleTarget, next)}
        />
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <UserDeleteConfirm
          loading={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete(deleteTarget)}
        />
      )}

      {/* 临时密码：仅展示一次 */}
      {tempPassword && (
        <ConfirmAction
          open
          title="临时密码已生成"
          confirmText="我已保存"
          loading={busy}
          description="请立即复制并安全转交给用户，此密码关闭后无法再次查看。"
          extra={
            <div className="flex items-center gap-2 rounded-lg border border-warn-border bg-warn-soft px-3 py-2">
              <code className="min-w-0 flex-1 font-mono text-sm break-all text-foreground">
                {tempPassword}
              </code>
              <ActionButton
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(tempPassword);
                  toast.success('已复制');
                }}
              >
                复制
              </ActionButton>
            </div>
          }
          onCancel={() => setTempPassword(null)}
          onConfirm={() => setTempPassword(null)}
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
