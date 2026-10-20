import { useCallback, useMemo, useState } from 'react';
import { App, Dropdown, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminUsersApi } from '../../lib/api';
import { toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminDrawer,
  AdminListError,
  AdminListLoading,
  ConfirmAction,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
} from '../../components/admin/PageHeader';
import type {
  AdminUserDetail,
  AdminUserImpact,
  AdminUserListResult,
} from '../../types/api';

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

export function AdminUsersPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();

  // 筛选输入与已提交的查询分离: 不做每键即查, 避免无意义请求
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminUsersApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        role: params.role as string | undefined,
        status: params.status as string | undefined,
      }),
    [],
  );

  const { data, loading, error, setQuery, setPage, reload } = useAdminList<AdminUserListResult>(
    fetcher,
  );

  // 详情抽屉
  const [detailId, setDetailId] = useState<string | null>(null);

  // 高危操作
  const [statusTarget, setStatusTarget] = useState<Row | null>(null);
  const [roleTarget, setRoleTarget] = useState<Row | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<AdminUserImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const detailFetcher = useCallback(
    () => adminUsersApi.detail(detailId as string),
    [detailId],
  );

  const refresh = () => {
    reload();
    void message.success('操作完成');
  };

  const changeStatus = async (target: Row, next: 'active' | 'disabled', reason: string) => {
    setBusy(true);
    try {
      await adminUsersApi.changeStatus(target.id, next, reason || undefined);
      setStatusTarget(null);
      refresh();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: Row, next: string, reason: string) => {
    setBusy(true);
    try {
      await adminUsersApi.changeRole(target.id, next, reason || undefined);
      setRoleTarget(null);
      refresh();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDelete = async (target: Row) => {
    setDeleteTarget(target);
    setDeleteImpact(null);
    try {
      setDeleteImpact(await adminUsersApi.impact(target.id));
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const doDelete = async (typed: string) => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await adminUsersApi.remove(deleteTarget.id, true, typed);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doResetPassword = async (target: Row) => {
    setBusy(true);
    try {
      const res = await adminUsersApi.resetPassword(target.id);
      setTempPassword(res.tempPassword);
      refresh();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        sorter: true,
        render: (email: string, row) => (
          <button type="button" className="adm-link" onClick={() => setDetailId(row.id)}>
            {email}
          </button>
        ),
      },
      {
        title: '角色',
        dataIndex: 'roleLabel',
        key: 'role',
        width: 90,
        render: (_: unknown, row) => <StatusTag status={row.role} />,
      },
      {
        title: '状态',
        dataIndex: 'statusLabel',
        key: 'status',
        width: 90,
        render: (_: unknown, row) => <StatusTag status={row.status} />,
      },
      { title: '项目', dataIndex: 'projectCount', key: 'projects', width: 70, align: 'right' },
      { title: '任务', dataIndex: 'taskCount', key: 'tasks', width: 70, align: 'right' },
      { title: '素材', dataIndex: 'assetCount', key: 'assets', width: 70, align: 'right' },
      {
        title: '注册时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 150,
        sorter: true,
        defaultSortOrder: 'descend',
        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
      },
      {
        title: '最近登录',
        dataIndex: 'lastLoginAt',
        key: 'lastLoginAt',
        width: 150,
        sorter: true,
        // 无登录记录显示「—」而非空单元格: 空白会被误读为加载中
        render: (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—'),
      },
      {
        title: '操作',
        key: 'actions',
        width: 150,
        fixed: 'right',
        /*
         * 只直显「详情」+「更多」, 其余动作收进下拉。
         *
         * 实测: 5 个动作平铺需~340px, 列宽 190px 时会折成两行 (行高 44→51px),
         * 把整行撑高且右侧被裁。收到下拉后列宽 150px 足够, 行高稳定。
         * 与 docs/admin-ui-design.md §2.3「操作列最多直显 2 个」一致。
         */
        render: (_: unknown, row) => {
          const menuItems = [
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
              ? {
                  key: 'pwd',
                  label: '重置密码',
                  onClick: () => void doResetPassword(row),
                }
              : null,
            can('user.delete')
              ? { key: 'del', label: '删除用户', danger: true, onClick: () => void openDelete(row) }
              : null,
          ].filter(Boolean) as Array<{
            key: string;
            label: string;
            danger?: boolean;
            onClick: () => void;
          }>;

          return (
            <div className="adm-row-actions">
              <button type="button" className="adm-link" onClick={() => setDetailId(row.id)}>
                详情
              </button>
              {menuItems.length > 0 && (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: menuItems,
                    // 危险动作与常规动作之间加分隔线, 避免误点
                  }}
                  disabled={busy}
                >
                  <button type="button" className="adm-link">
                    更多
                  </button>
                </Dropdown>
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, busy],
  );

  return (
    <>
      <PageHeader title="用户管理" description="管理注册用户的账号状态、角色与资源" />

      <FilterBar>
        <Input
          className="adm-filter-input"
          placeholder="邮箱关键词"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => setQuery({ keyword: keyword || undefined })}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="角色"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(v) => setRole(v)}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="状态"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v)}
          allowClear
        />
        <FilterActions>
          <button
            type="button"
            className="adm-btn is-primary"
            onClick={() => setQuery({ keyword: keyword || undefined, role, status })}
          >
            查询
          </button>
          <button
            type="button"
            className="adm-btn"
            onClick={() => {
              setKeyword('');
              setRole(undefined);
              setStatus(undefined);
              setQuery({ keyword: undefined, role: undefined, status: undefined });
            }}
          >
            重置
          </button>
        </FilterActions>
      </FilterBar>

      <Panel>
        {loading && !data ? (
          <AdminListLoading tip="加载用户列表…" />
        ) : error ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            scroll={{ x: 1000 }}
            onChange={(_p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              const field = s?.columnKey;
              if (typeof field === 'string') {
                setQuery({ sort: `${field}:${s?.order === 'ascend' ? 'asc' : 'desc'}` }, false);
              }
            }}
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
      </Panel>

      {/* 详情抽屉 */}
      <AdminDrawer<AdminUserDetail>
        open={detailId !== null}
        title="用户详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
      >
        {(d) => (
          <>
            <div className="adm-section">
              <div className="adm-section-title">基本信息</div>
              <dl className="adm-desc">
                <dt>邮箱</dt>
                <dd>{d.email}</dd>
                <dt>昵称</dt>
                <dd>{d.name}</dd>
                <dt>角色</dt>
                <dd>
                  <StatusTag status={d.role} />
                </dd>
                <dt>状态</dt>
                <dd>
                  <StatusTag status={d.status} />
                </dd>
                <dt>注册时间</dt>
                <dd>{new Date(d.createdAt).toLocaleString('zh-CN')}</dd>
                <dt>最近登录</dt>
                <dd>{d.lastLoginAt ? new Date(d.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</dd>
              </dl>
            </div>

            <div className="adm-section">
              <div className="adm-section-title">资源统计</div>
              <div className="adm-stat-grid is-compact">
                <div className="adm-stat">
                  <div className="adm-stat-label">项目</div>
                  <div className="adm-stat-value">{d.stats.projects}</div>
                </div>
                <div className="adm-stat">
                  <div className="adm-stat-label">任务</div>
                  <div className="adm-stat-value">{d.stats.tasks}</div>
                  <div className="adm-stat-hint">
                    成功 {d.stats.taskStatus.succeeded} · 失败 {d.stats.taskStatus.failed}
                  </div>
                </div>
                <div className="adm-stat">
                  <div className="adm-stat-label">素材</div>
                  <div className="adm-stat-value">{d.stats.assets}</div>
                </div>
              </div>
            </div>

            <div className="adm-section">
              <div className="adm-section-title">最近任务（20 条）</div>
              {d.recentTasks.length === 0 ? (
                <AdminEmpty description="暂无任务记录" />
              ) : (
                <ul className="adm-mini-list">
                  {d.recentTasks.map((t) => (
                    <li key={t.id} className="adm-mini-item">
                      {t.thumbnailUrl ? (
                        <img className="adm-mini-thumb" src={toAbsoluteUrl(t.thumbnailUrl)} alt="" />
                      ) : (
                        <div className="adm-mini-thumb is-empty" />
                      )}
                      <span className="adm-mini-name">{t.capabilityName}</span>
                      <StatusTag status={t.status} />
                      <span className="adm-mini-time">
                        {new Date(t.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="adm-section">
              <div className="adm-section-title">最近素材（20 张）</div>
              {d.recentAssets.length === 0 ? (
                <AdminEmpty description="暂无素材" />
              ) : (
                <div className="adm-thumb-grid">
                  {d.recentAssets.map((a) => (
                    <img
                      key={a.id}
                      className="adm-thumb-cell"
                      src={toAbsoluteUrl(a.sourceUrl)}
                      alt=""
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </AdminDrawer>

      {/* 禁用/启用 */}
      {statusTarget && (
        <StatusDialog
          target={statusTarget}
          loading={busy}
          onCancel={() => setStatusTarget(null)}
          onConfirm={(next, reason) => void changeStatus(statusTarget, next, reason)}
        />
      )}

      {/* 变更角色 */}
      {roleTarget && (
        <RoleDialog
          target={roleTarget}
          loading={busy}
          onCancel={() => setRoleTarget(null)}
          onConfirm={(next, reason) => void changeRole(roleTarget, next, reason)}
        />
      )}

      {/* 删除: 量化影响 + 输入确认 */}
      {deleteTarget && (
        <ConfirmAction
          open
          title="删除用户"
          confirmText="永久删除"
          danger
          requireTyping
          typingText="删除"
          loading={busy}
          description={<p>即将永久删除账号及其数据，用户邮箱将被匿名化。</p>}
          impact={[
            deleteImpact
              ? `${deleteImpact.projects} 个项目`
              : '正在统计项目数量…',
            deleteImpact ? `${deleteImpact.tasks} 条任务记录` : '正在统计任务数量…',
            deleteImpact ? `${deleteImpact.assets} 张素材（含磁盘文件）` : '正在统计素材数量…',
          ]}
          extra={
            <div className="adm-confirm-warn">
              订单与支付记录将保留（《电子商务法》要求保存 3 年），但用户信息将被匿名化。
            </div>
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={(typed) => void doDelete(typed)}
        />
      )}

      {/* 临时密码: 仅展示一次 */}
      {tempPassword && (
        <ConfirmAction
          open
          title="临时密码已生成"
          confirmText="我已保存"
          loading={busy}
          description={
            <>
              <p>请立即复制并安全转交给用户，此密码关闭后无法再次查看。</p>
              <div className="adm-secret-box">
                <code>{tempPassword}</code>
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(tempPassword);
                    void message.success('已复制');
                  }}
                >
                  复制
                </button>
              </div>
            </>
          }
          onCancel={() => setTempPassword(null)}
          onConfirm={() => setTempPassword(null)}
        />
      )}
    </>
  );
}

/** 禁用/启用弹窗 */
function StatusDialog({
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
            <div className="adm-confirm-warn">
              禁用后该用户的登录凭证立即失效，无法再登录或调用接口。
            </div>
          )}
        </>
      }
      extra={
        <div className="adm-field">
          <label htmlFor="adm-status-reason">操作原因（建议填写）</label>
          <input
            id="adm-status-reason"
            type="text"
            placeholder="如：违规使用"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next, reason)}
    />
  );
}

/** 变更角色弹窗 */
function RoleDialog({
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
  const [next, setNext] = useState<string>('operator');
  const [reason, setReason] = useState('');

  return (
    <ConfirmAction
      open
      title="变更角色"
      confirmText="确认变更"
      loading={loading}
      description={
        <>
          <p>
            用户：<strong>{target.email}</strong>
          </p>
          <p>
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
          <div className="adm-field">
            <label htmlFor="adm-role-select">目标角色</label>
            <select
              id="adm-role-select"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            >
              <option value="operator">运营</option>
              <option value="finance">财务</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="adm-role-reason">操作原因</label>
            <input
              id="adm-role-reason"
              type="text"
              placeholder="如：岗位调整"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next, reason)}
    />
  );
}