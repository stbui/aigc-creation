import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '../../vendor/boardui/components/base/dropdown/dropdown';
import { adminUsersApi } from '../../lib/api';
import { assetThumbUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { SelectBox, TextInput } from '../../admin-ui/controls';
import { cx } from '../../admin-ui/lib/cn';
import {
  AdminDrawer,
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { BatchResultModal } from '../../components/admin/BatchResultModal';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
} from '../../lib/admin-links';
import type {
  AdminLoginLogResult,
  AdminUserDetail,
  AdminUserListResult,
  BatchSummary,
} from '../../types/api';

/**
 * 用户管理 (B-27~B-33)。
 *
 * ## 选择状态不跨翻页保留
 *
 * 运营切到另一页继续勾选时, 上一页选中的账号仍在选中集里 —— 界面上看不见
 * 它们, 此时点「批量禁用」会禁用一批肉眼不可见的账号。每次重新查询就清空,
 * 是更安全的默认。
 *
 * ## 删除不弹确认, 禁用/变更角色要
 *
 * 删除按产品要求直接执行 (接口本身写审计原因); 禁用与变更角色会切断在线凭证,
 * 用页内确认条承载原因输入, 原因随请求落审计。
 *
 * ## 登录记录单独取数
 *
 * `GET /admin/users/:id/logins` 需要 `audit.read`。并进详情会让没有审计权限
 * 的角色顺带看到全站登录 IP, 所以单独请求, 403 按「不可见」渲染说明。
 */

type Row = AdminUserListResult['items'][number];

const ROLE_OPTIONS = [
  { value: 'user', label: '用户' },
  { value: 'admin', label: '管理员' },
  { value: 'operator', label: '运营' },
  { value: 'finance', label: '财务' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'disabled', label: '已禁用' },
  { value: 'deleted', label: '已注销' },
];

/** 列表默认排序。后端默认与之一致, 显式传参是为了让表头箭头与请求口径对得上 */
const DEFAULT_SORT = 'createdAt:desc';

/** 详情抽屉里的小节标题：标题 + 一句口径说明 */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border-table pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {note && <span className="text-[11px] text-text-tertiary">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 抽屉里的小计数格。不用 StatCard: 那套是列表页首屏用的, 96px 高度在抽屉里太占 */
function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-table px-3 py-2">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="mt-0.5 text-lg font-semibold leading-6 tabular-nums text-text-primary">
        {value}
      </div>
      {hint && <div className="text-[11px] text-text-tertiary">{hint}</div>}
    </div>
  );
}

/** 表单字段：标签 + 控件 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

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

  // 筛选输入与已提交的查询分离: 不做每键即查, 避免无意义请求
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
        // 排序必须真的发给后端: 少了这一行表头箭头会变而顺序不变
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
   * 用 ref 记录"已应用过哪一个值"而不是直接比较 state —— 用户在页内改筛选后
   * URL 不变, 若每次渲染都按 URL 覆盖, 页内筛选会被打回原样。
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

  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const detailFetcher = useCallback(() => adminUsersApi.detail(detailId as string), [detailId]);

  const refresh = (tip?: string) => {
    reload();
    if (tip) toast.success(tip);
  };

  /** 翻页 / 改筛选都会清空选择, 避免对不可见的行下手 */
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
    try {
      // 导出必须与屏幕上的列表同口径：用已生效的 params，而不是输入框草稿
      await adminUsersApi.exportCsv({
        keyword: (params.keyword as string) || undefined,
        role: params.role as string | undefined,
        status: params.status as string | undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  const changeStatus = async (target: Row, next: 'active' | 'disabled', reason: string) => {
    setBusy(true);
    try {
      await adminUsersApi.changeStatus(target.id, next, reason || undefined);
      setStatusTarget(null);
      refresh(next === 'disabled' ? '账号已禁用，登录凭证立即失效' : '账号已启用');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: Row, next: string, reason: string) => {
    setBusy(true);
    try {
      await adminUsersApi.changeRole(target.id, next, reason || undefined);
      setRoleTarget(null);
      refresh('角色已变更');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  /** 删除按产品要求直接执行，不再弹窗二次确认 */
  const openDelete = async (target: Row) => {
    setBusy(true);
    try {
      await adminUsersApi.remove(target.id, true, '删除');
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
        ? { key: 'del', label: '删除用户', danger: true, onClick: () => void openDelete(row) }
        : null,
    ].filter(Boolean) as RowAction[];

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'email',
        title: '邮箱',
        width: 230,
        sortable: true,
        // 邮箱常被截断, 悬停给出完整值
        cellTitle: (row: Row) => row.email,
        render: (row: Row) => (
          <button
            type="button"
            className="max-w-[220px] truncate rounded text-left text-accent-700 hover:underline"
            onClick={() => setDetailId(row.id)}
          >
            {row.email}
          </button>
        ),
      },
      {
        key: 'role',
        title: '角色',
        width: 90,
        render: (row: Row) => <StatusTag status={row.role} />,
      },
      {
        key: 'status',
        title: '状态',
        width: 90,
        render: (row: Row) => <StatusTag status={row.status} />,
      },
      {
        key: 'projects',
        title: '项目',
        width: 70,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{row.projectCount}</span>,
      },
      {
        key: 'tasks',
        title: '任务',
        width: 70,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{row.taskCount}</span>,
      },
      {
        key: 'assets',
        title: '素材',
        width: 70,
        align: 'right',
        render: (row: Row) => <span className="tabular-nums">{row.assetCount}</span>,
      },
      {
        key: 'createdAt',
        title: '注册时间',
        width: 160,
        sortable: true,
        render: (row: Row) => (
          <span className="text-[12px] tabular-nums">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'lastLoginAt',
        title: '最近登录',
        width: 160,
        sortable: true,
        // 无登录记录显示「—」而非空单元格: 空白会被误读为加载中
        render: (row: Row) => (
          <span className="text-[12px] tabular-nums text-text-secondary">
            {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '—'}
          </span>
        ),
      },
      {
        key: 'ops',
        title: '',
        width: 150,
        fixed: 'right',
        /*
         * 只直显「详情」+「更多」, 其余动作收进下拉。
         *
         * 实测: 5 个动作平铺需~340px, 把整行撑高且右侧被裁。与
         * docs/admin-ui-design.md §2.3「操作列最多直显 2 个」一致。
         */
        render: (row: Row) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="small" onClick={() => setDetailId(row.id)}>
              详情
            </Button>
            <RowMenu items={rowMenuItems(row)} />
          </div>
        ),
      },
    ],
    // rowMenuItems 依赖 can() 与 busy 捕获的 setter, 均为稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, busy],
  );

  const sort = (params.sort as string | undefined) ?? DEFAULT_SORT;

  return (
    <>
      <PageHeader
        title="用户管理"
        description="管理注册用户的账号状态、角色与资源"
        actions={
          can('data.export') ? (
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              onClick={() => void exportUsers()}
            >
              导出 CSV
            </Button>
          ) : (
            <span className="text-[11px] text-text-tertiary">
              当前账号无 data.export 权限，不可导出
            </span>
          )
        }
      />

      <FilterBar>
        <TextInput
          className="w-56"
          placeholder="邮箱关键词"
          allowClear
          value={keyword}
          onChange={setKeyword}
          onEnter={applyFilters}
        />
        <SelectBox
          className="w-32"
          ariaLabel="按角色筛选"
          placeholder="角色"
          allowClear
          value={role}
          onChange={setRole}
          options={ROLE_OPTIONS}
        />
        <SelectBox
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <FilterActions>
          <Button variant="primary" size="small" onClick={applyFilters}>
            查询
          </Button>
          <Button variant="secondary" size="small" onClick={resetFilters}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel
        title="用户列表"
        note="已注销账号不可再改状态，但仍可勾选——批量操作会逐条返回失败原因"
      >
        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
            <span className="text-xs font-medium text-accent-900">已选 {selected.length} 项</span>
            {can('user.disable') && (
              <>
                <Button
                  variant="danger"
                  size="small"
                  disabled={busy}
                  onClick={() => void runBatch('disable')}
                >
                  批量禁用
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busy}
                  onClick={() => void runBatch('enable')}
                >
                  批量启用
                </Button>
              </>
            )}
            <Button variant="ghost" size="small" onClick={() => setSelected([])}>
              清空选择
            </Button>
          </div>
        )}

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
          // 已注销账号不能再改状态, 但仍允许选中 (批量启用会逐条返回失败原因)
          isRowSelectable={(row) => row.status !== 'deleted'}
          emptyText={
            hasFilter
              ? '没有符合条件的用户。清除筛选或换一个关键词试试。'
              : '还没有用户。用户注册后会出现在这里。'
          }
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="small" onClick={resetFilters}>
                清除筛选
              </Button>
            ) : undefined
          }
          pagination={
            data
              ? {
                  current: data.page,
                  pageSize: data.pageSize,
                  total: data.total,
                  unit: '位用户',
                  // 翻页时清空选择 (见 selected 处的说明)
                  onChange: (page, size) => {
                    setSelected([]);
                    setPage(page, size);
                  },
                }
              : undefined
          }
        />
      </Panel>

      {/* 详情抽屉 */}
      <AdminDrawer<AdminUserDetail>
        open={detailId !== null}
        title="用户详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
      >
        {(d) => (
          <div className="flex flex-col gap-4">
            <Section title="基本信息">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                <div className="col-span-2 min-w-0">
                  <dt className="text-[11px] text-text-tertiary">邮箱</dt>
                  <dd className="mt-0.5 break-all text-sm text-text-primary">{d.email}</dd>
                </div>
                <div className="col-span-2 min-w-0">
                  <dt className="text-[11px] text-text-tertiary">关联记录</dt>
                  <dd className="mt-0.5 flex flex-wrap gap-3 text-xs">
                    <Link className="text-accent-700 hover:underline" to={adminTasksHref({ userId: d.id })}>
                      任务记录
                    </Link>
                    <Link className="text-accent-700 hover:underline" to={adminOrderHref({ email: d.email })}>
                      订单记录
                    </Link>
                    <Link
                      className="text-accent-700 hover:underline"
                      to={adminCreditHref({ userId: d.id, email: d.email })}
                    >
                      积分账本
                    </Link>
                  </dd>
                </div>
                <InfoItem label="昵称" value={d.name} />
                <InfoItem label="角色" value={<StatusTag status={d.role} />} />
                <InfoItem label="状态" value={<StatusTag status={d.status} />} />
                <InfoItem
                  label="手机号"
                  value={
                    d.phone ? (
                      <span className="flex items-center gap-1.5">
                        {d.phone}
                        <span className="text-[11px] text-text-tertiary">
                          {d.phoneVerifiedAt ? '已验证' : '未验证'}
                        </span>
                      </span>
                    ) : (
                      '未绑定'
                    )
                  }
                />
                <InfoItem label="注册时间" value={new Date(d.createdAt).toLocaleString('zh-CN')} />
                <InfoItem
                  label="最近登录"
                  value={
                    d.lastLoginAt ? new Date(d.lastLoginAt).toLocaleString('zh-CN') : '从未登录'
                  }
                />
              </dl>
            </Section>

            {/* 登录审计：权限点 audit.read，无权限时静默显示说明而非报错 */}
            <RecentLoginsSection userId={d.id} />

            <Section title="资源统计">
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="项目" value={d.stats.projects} />
                <MiniStat
                  label="任务"
                  value={d.stats.tasks}
                  hint={`成功 ${d.stats.taskStatus.succeeded} · 失败 ${d.stats.taskStatus.failed}`}
                />
                <MiniStat label="素材" value={d.stats.assets} />
              </div>
            </Section>

            <Section title="最近任务" note="20 条">
              {d.recentTasks.length === 0 ? (
                <AdminEmpty description="暂无任务记录" />
              ) : (
                <ul className="flex flex-col divide-y divide-border-table">
                  {d.recentTasks.map((t) => (
                    <li key={t.id}>
                      <Link
                        className="flex items-center gap-2.5 py-1.5 hover:bg-background-secondary-default/70"
                        to={adminTaskHref(t.id)}
                        aria-label={`查看任务详情：${t.capabilityName} ${t.id.slice(-8)}`}
                      >
                        {t.thumbnailUrl ? (
                          <img
                            className="size-9 shrink-0 rounded-md border border-border-table object-cover"
                            src={assetThumbUrl(t.thumbnailUrl, 96)}
                            alt=""
                          />
                        ) : (
                          <div className="size-9 shrink-0 rounded-md border border-dashed border-border-table bg-background-secondary-default" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                          {t.capabilityName}
                        </span>
                        <StatusTag status={t.status} />
                        <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
                          {new Date(t.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="最近素材" note="20 张">
              {d.recentAssets.length === 0 ? (
                <AdminEmpty description="暂无素材" />
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {d.recentAssets.map((a) => (
                    <Link
                      key={a.id}
                      className="block overflow-hidden rounded-md border border-border-table"
                      to={adminAssetHref(a.id)}
                      aria-label={`在素材库查看素材 ${a.id.slice(-8)}`}
                    >
                      <img
                        className="aspect-square w-full object-cover"
                        src={assetThumbUrl(a.sourceUrl, 240)}
                        alt=""
                        loading="lazy"
                      />
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </AdminDrawer>

      {/* 禁用/启用 */}
      {statusTarget && (
        <StatusPanel
          target={statusTarget}
          loading={busy}
          onCancel={() => setStatusTarget(null)}
          onConfirm={(next, reason) => void changeStatus(statusTarget, next, reason)}
        />
      )}

      {/* 变更角色 */}
      {roleTarget && (
        <RolePanel
          target={roleTarget}
          loading={busy}
          onCancel={() => setRoleTarget(null)}
          onConfirm={(next, reason) => void changeRole(roleTarget, next, reason)}
        />
      )}

      {/* 临时密码: 仅展示一次 */}
      {tempPassword && (
        <ConfirmAction
          open
          title="临时密码已生成"
          confirmText="我已保存"
          loading={busy}
          description="请立即复制并安全转交给用户，此密码关闭后无法再次查看。"
          extra={
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-text-primary">
                {tempPassword}
              </code>
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  void navigator.clipboard?.writeText(tempPassword);
                  toast.success('已复制');
                }}
              >
                复制
              </Button>
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

/** 描述列表的一项 */
function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-text-tertiary">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-primary">{value}</dd>
    </div>
  );
}

/**
 * 行内「更多」菜单。
 *
 * 受控展开: 选中一项后必须收起, 否则删完用户菜单还浮在空行上。
 * 无可用动作时整个触发器不渲染 —— 留一个点开是空的菜单比没有更糟。
 */
function RowMenu({ items }: { items: Array<{ key: string; label: string; danger?: boolean; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      {/*
       * 与同列的「详情」保持同一形态（ghost 按钮）。
       * 之前这里是纯文字链，同一列里一个带底色一个不带，
       * 读起来像两个不同层级的操作。
       */}
      <DropdownTrigger
        className="inline-flex h-8 items-center rounded-lg bg-button-ghost-background px-2 text-xs text-button-ghost-foreground transition-colors hover:bg-button-ghost-hover"
      >
        更多
      </DropdownTrigger>
      <DropdownPopover aria-label="更多操作" placement="bottom end" className="w-40">
        <DropdownGroup>
          {items.map((item) => (
            <DropdownItem
              key={item.key}
              className={item.danger ? 'text-rose-600' : undefined}
              onSelect={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </DropdownItem>
          ))}
        </DropdownGroup>
      </DropdownPopover>
    </Dropdown>
  );
}

/** 禁用/启用操作条 */
function StatusPanel({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: Row;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (next: 'active' | 'disabled', reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const next: 'active' | 'disabled' = target.status === 'active' ? 'disabled' : 'active';

  return (
    <ConfirmAction
      open
      title={next === 'disabled' ? '禁用账号' : '启用账号'}
      confirmText={next === 'disabled' ? '确认禁用' : '确认启用'}
      danger={next === 'disabled'}
      loading={loading}
      description={
        <>
          <p>
            用户：<strong>{target.email}</strong>
          </p>
          {next === 'disabled' && (
            <p className="mt-1 text-rose-700">
              禁用后该用户的登录凭证立即失效，无法再登录或调用接口。
            </p>
          )}
        </>
      }
      extra={
        <Field label="操作原因（建议填写）">
          <TextInput
            ariaLabel="操作原因"
            placeholder="如：违规使用"
            value={reason}
            onChange={setReason}
          />
        </Field>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next, reason)}
    />
  );
}

/** 变更角色操作条 */
function RolePanel({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: Row;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (role: string, reason: string) => void;
}) {
  // 默认值必须等于当前角色：管理员/财务账号打开时不能预选「运营」，
  // 否则直接点确认就把人降权了
  const currentAssignable = target.role === 'user' ? 'operator' : target.role;
  const [next, setNext] = useState<string>(currentAssignable);
  const [reason, setReason] = useState('');

  return (
    <ConfirmAction
      open
      title="变更角色"
      confirmText="确认变更"
      loading={loading}
      confirmDisabled={next === target.role}
      description={
        <>
          <p>
            用户：<strong>{target.email}</strong>
          </p>
          <p className="mt-1 flex items-center gap-1.5">
            当前角色：<StatusTag status={target.role} />
          </p>
        </>
      }
      impact={[
        '变更立即生效，该用户的旧 token 下次请求即按新角色鉴权',
        '目标角色的权限点集合将整体生效',
      ]}
      extra={
        <>
          <Field label="目标角色">
            <SelectBox
              ariaLabel="目标角色"
              size="md"
              value={next}
              onChange={(value) => {
                if (value) setNext(value);
              }}
              options={[
                { value: 'operator', label: '运营' },
                { value: 'finance', label: '财务' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Field>
          <Field label="操作原因">
            <TextInput
              ariaLabel="操作原因"
              placeholder="如：岗位调整"
              value={reason}
              onChange={setReason}
            />
          </Field>
        </>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next, reason)}
    />
  );
}

/** 登录方式/失败原因 -> 中文。未知值原样展示，免得新原因被吞成「其他」 */
const LOGIN_REASON_LABEL: Record<string, string> = {
  password: '密码登录',
  sms: '短信登录',
  bad_credentials: '邮箱或密码错误',
  sms_code: '短信验证码错误',
  disabled: '账号已禁用',
  deleted: '账号已注销',
};

/**
 * 详情抽屉里的「最近登录」区块。
 *
 * 单独取数（GET /admin/users/:id/logins，权限 audit.read）而不是并进 detail：
 * 只有运营/管理员持有 audit.read，塞进详情会让其他角色顺带看到全站登录 IP。
 * 403 时按「不可见」渲染说明 —— 这是权限边界，不是错误。
 */
function RecentLoginsSection({ userId }: { userId: string }) {
  const [data, setData] = useState<AdminLoginLogResult | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState('loading');
    adminUsersApi
      .logins(userId, 20)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 403 = 没有 audit.read；其余错误如实标为加载失败，不伪装成空列表
        const status = (e as { status?: number }).status;
        setState(status === 403 ? 'forbidden' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [userId, reloadKey]);

  return (
    <Section
      title="最近登录"
      note={
        state === 'ready' && data
          ? `共 ${data.total} 次 · 近 30 天失败 ${data.failedLast30Days} 次`
          : undefined
      }
    >
      {state === 'loading' ? <AdminListLoading tip="加载登录记录…" /> : null}
      {state === 'forbidden' ? (
        <p className="text-[11px] text-text-tertiary">
          当前角色没有审计权限（audit.read），无法查看登录记录。
        </p>
      ) : null}
      {state === 'error' ? (
        <AdminListError error="登录记录加载失败" onRetry={() => setReloadKey((n) => n + 1)} />
      ) : null}
      {state === 'ready' && data ? (
        data.items.length === 0 ? (
          <AdminEmpty description="暂无登录记录" />
        ) : (
          <ul className="flex flex-col divide-y divide-border-table">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5 py-1.5">
                <StatusTag
                  status={item.success ? 'success' : 'failed'}
                  label={item.success ? '成功' : '失败'}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                  {LOGIN_REASON_LABEL[item.reason] ?? item.reason}
                </span>
                <span className={cx('shrink-0 text-[11px] tabular-nums text-text-tertiary')}>
                  {item.ip || '未知 IP'}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Section>
  );
}
