import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import { adminUsersApi } from '../../lib/api';
import { toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminDrawer,
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  ConfirmAction,
  adminPagination,
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
import { BatchResultModal } from '../../components/admin/BatchResultModal';
import type {
  AdminLoginLogResult,
  AdminUserDetail,
  AdminUserImpact,
  AdminUserListResult,
  BatchSummary,
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

  /*
   * 顶栏全局搜索带 `?q=` 跳过来时自动套用筛选。
   * 用 ref 记录"已应用过哪一个值"而不是直接比较 state —— 用户在页内改筛选后
   * URL 不变, 若每次渲染都按 URL 覆盖, 页内筛选会被打回原样。
   */
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const appliedQ = useRef('');
  useEffect(() => {
    if (!urlQ || urlQ === appliedQ.current) return;
    appliedQ.current = urlQ;
    setKeyword(urlQ);
    setQuery({ keyword: urlQ });
  }, [urlQ, setQuery]);

  // 详情抽屉
  const [detailId, setDetailId] = useState<string | null>(null);

  /*
   * 批量选择。
   *
   * 选择状态**不跨翻页/筛选保留**: 运营切到另一页继续选时, 上一页选中的账号
   * 仍在选中集里 —— 但界面上看不见它们, 此时点「批量禁用」会禁用一批
   * 肉眼不可见的账号。每次重新查询就清空, 是更安全的默认。
   */
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

  /** 翻页 / 改筛选都会清空选择, 避免对不可见的行下手 */
  const queryAndClear = useCallback(
    (next: Record<string, unknown>, resetPage = true) => {
      setSelected([]);
      setQuery(next, resetPage);
    },
    [setQuery],
  );

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
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportUsers = async () => {
    try {
      await adminUsersApi.exportCsv({
        keyword: keyword || undefined,
        role,
        status,
      });
    } catch (e) {
      void message.error((e as Error).message);
    }
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

  const rowMenuItems = (row: Row) =>
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

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        sorter: true,
        render: (email: string, row) => (
          <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
            {email}
          </Button>
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
          const menuItems = rowMenuItems(row);
          return (
            <div className="adm-row-actions">
              <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
                详情
              </Button>
              {menuItems.length > 0 && (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: menuItems,
                    // 危险动作与常规动作之间加分隔线, 避免误点
                  }}
                  disabled={busy}
                >
                  <Button type="link" className="adm-link">
                    更多
                  </Button>
                </Dropdown>
              )}
            </div>
          );
        },
      },
    ],
    [busy, rowMenuItems],
  );

  return (
    <>
      <PageHeader
        title="用户管理"
        description="管理注册用户的账号状态、角色与资源"
        actions={
          can('data.export') ? (
            <Button type="default" className="adm-btn" onClick={() => void exportUsers()}>
              导出 CSV
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <Input
          className="adm-filter-input"
          placeholder="邮箱关键词"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => queryAndClear({ keyword: keyword || undefined })}
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
          <Button
            type="primary"
            className="adm-btn is-primary"
            onClick={() => queryAndClear({ keyword: keyword || undefined, role, status })}
          >
            查询
          </Button>
          <Button
            type="default"
            className="adm-btn"
            onClick={() => {
              setKeyword('');
              setRole(undefined);
              setStatus(undefined);
              queryAndClear({ keyword: undefined, role: undefined, status: undefined });
            }}
          >
            重置
          </Button>
        </FilterActions>
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel>
        {loading && !data ? (
          <AdminListLoading tip="加载用户列表…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (
          <>
            {selected.length > 0 && (
              <div className="adm-bulk-bar">
                <span className="adm-bulk-count">已选 {selected.length} 项</span>
                {can('user.disable') && (
                  <>
                    <Button
                      type="primary" danger
                      className="adm-btn is-danger"
                      disabled={busy}
                      onClick={() => void runBatch('disable')}
                    >
                      批量禁用
                    </Button>
                    <Button
                      type="default"
                      className="adm-btn"
                      disabled={busy}
                      onClick={() => void runBatch('enable')}
                    >
                      批量启用
                    </Button>
                  </>
                )}
                <Button type="link" className="adm-link" onClick={() => setSelected([])}>
                  清空选择
                </Button>
              </div>
            )}
            {(data?.items.length ?? 0) === 0 ? (
              <AdminEmpty description="没有符合条件的用户。清除筛选或换一个关键词试试。" />
            ) : (
              <>
                <Table<Row>
                  rowKey="id"
                  size="small"
                  columns={columns}
                  dataSource={data?.items ?? []}
                  loading={loading}
                  scroll={{ x: 1000 }}
                  rowSelection={{
                    selectedRowKeys: selected,
                    onChange: (keys) => setSelected(keys as string[]),
                    // 已注销账号不能再改状态, 但仍允许选中 (批量启用会逐条返回失败原因)
                    getCheckboxProps: (row) => ({ disabled: row.status === 'deleted' }),
                  }}
                  onChange={(_p, _f, sorter) => {
                    const s = Array.isArray(sorter) ? sorter[0] : sorter;
                    const field = s?.columnKey;
                    if (typeof field === 'string') {
                      setQuery(
                        { sort: `${field}:${s?.order === 'ascend' ? 'asc' : 'desc'}` },
                        false,
                      );
                    }
                  }}
                  pagination={adminPagination({
                    current: data?.page ?? 1,
                    pageSize: data?.pageSize ?? 20,
                    total: data?.total ?? 0,
                    // 翻页时清空选择 (见 selected 处的说明)
                    onChange: (page, size) => {
                      setSelected([]);
                      setPage(page, size);
                    },
                  })}
                />
              </>
            )}
          </>
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
                <dt>手机号</dt>
                <dd>
                  {d.phone ? (
                    <>
                      {d.phone}
                      <span className="adm-field-hint" style={{ marginLeft: 8 }}>
                        {d.phoneVerifiedAt ? '已验证' : '未验证'}
                      </span>
                    </>
                  ) : (
                    '未绑定'
                  )}
                </dd>
                <dt>注册时间</dt>
                <dd>{new Date(d.createdAt).toLocaleString('zh-CN')}</dd>
                <dt>最近登录</dt>
                <dd>{d.lastLoginAt ? new Date(d.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</dd>
              </dl>
            </div>

            {/* 登录审计：权限点 audit.read，无权限时静默显示说明而非报错 */}
            <RecentLoginsSection userId={d.id} />

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
          description={<p>即将永久删除该账号及其全部数据，不可恢复。</p>}
          impact={[
            deleteImpact
              ? `${deleteImpact.projects} 个项目`
              : '正在统计项目数量…',
            deleteImpact ? `${deleteImpact.tasks} 条任务记录` : '正在统计任务数量…',
            deleteImpact ? `${deleteImpact.assets} 张素材（含磁盘与对象存储文件）` : '正在统计素材数量…',
          ]}
          extra={
            <div className="adm-confirm-warn">
              {/* 有资金记录的账号后端会直接拒绝 —— 提前说清, 免得运营输完确认词才发现删不掉 */}
              仅对<strong>没有订单 / 支付 / 退款 / 发票 / 积分流水</strong>的账号可用。
              有资金记录的账号请改用「注销」：保留资金记录并匿名化账号，符合《电子商务法》留存要求。
              工单、登录会话、站内消息、邀请与签到记录会一并删除。
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
                <Button
                  type="default"
                  className="adm-btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(tempPassword);
                    void message.success('已复制');
                  }}
                >
                  复制
                </Button>
              </div>
            </>
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
          <Input
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
            <Select
              id="adm-role-select"
              value={next}
              onChange={(value) => setNext(value)}
              options={[
                { value: 'operator', label: '运营' },
                { value: 'finance', label: '财务' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="adm-role-reason">操作原因</label>
            <Input
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

/** 失败原因 -> 中文。未知值原样展示，免得新原因被吞成「其他」 */
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
    <div className="adm-section">
      <div className="adm-section-title">
        最近登录
        {state === 'ready' && data ? (
          <span className="adm-field-hint" style={{ marginLeft: 8 }}>
            共 {data.total} 次 · 近 30 天失败 {data.failedLast30Days} 次
          </span>
        ) : null}
      </div>
      {state === 'loading' ? <AdminListLoading /> : null}
      {state === 'forbidden' ? (
        <div className="adm-field-hint">当前角色没有审计权限（audit.read），无法查看登录记录。</div>
      ) : null}
      {state === 'error' ? (
        <AdminListError error="登录记录加载失败" onRetry={() => setReloadKey((n) => n + 1)} />
      ) : null}
      {state === 'ready' && data ? (
        data.items.length === 0 ? (
          <AdminEmpty description="暂无登录记录" />
        ) : (
          <ul className="adm-mini-list">
            {data.items.map((item) => (
              <li key={item.id} className="adm-mini-item">
                <StatusTag status={item.success ? 'success' : 'failed'} label={item.success ? '成功' : '失败'} />
                <span className="adm-mini-name">{LOGIN_REASON_LABEL[item.reason] ?? item.reason}</span>
                <span className="adm-mini-time">{item.ip || '未知 IP'}</span>
                <span className="adm-mini-time">{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
