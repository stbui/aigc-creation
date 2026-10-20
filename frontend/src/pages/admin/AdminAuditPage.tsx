import { useCallback, useMemo, useState } from 'react';
import { App, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminAuditApi } from '../../lib/api';
import {
  AdminDrawer,
  AdminListError,
  AdminListLoading,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
} from '../../components/admin/PageHeader';
import type { AdminAuditListResult } from '../../types/api';

type Row = AdminAuditListResult['items'][number];

/** 动作 → 中文说明。未登记的动作原样显示, 便于发现未文档化的操作 */
const ACTION_LABELS: Record<string, string> = {
  'user.status_change': '禁用/启用账号',
  'user.role_change': '变更用户角色',
  'user.password_reset': '重置用户密码',
  'user.delete': '删除用户',
  'role.permissions_update': '调整角色权限',
  'setting.update': '修改系统设置',
};

export function AdminAuditPage() {
  const { message } = App.useApp();
  const [action, setAction] = useState<string | undefined>();
  const [targetId, setTargetId] = useState('');
  const [success, setSuccess] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminAuditApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        action: params.action as string | undefined,
        targetId: params.targetId as string | undefined,
        success: params.success === undefined ? undefined : Boolean(params.success),
      }),
    [],
  );

  const {
    data,
    loading,
    error,
    setQuery,
    setPage,
    reload,
  } = useAdminList<{ result: AdminAuditListResult; actions: Array<{ action: string; count: number }> }>(
    fetcher,
  );

  const list = data?.result;
  const actions = useMemo(
    () =>
      (data?.actions ?? []).map((a) => ({
        value: a.action,
        label: `${ACTION_LABELS[a.action] ?? a.action}（${a.count}）`,
      })),
    [data],
  );

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 160,
        sorter: true,
        defaultSortOrder: 'descend',
        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
      },
      {
        title: '操作人',
        dataIndex: 'actorEmail',
        key: 'actor',
        width: 190,
        render: (email: string, row) => (
          <div>
            <div>{email}</div>
            <div className="adm-cell-sub">{row.actorRole}</div>
          </div>
        ),
      },
      {
        title: '动作',
        dataIndex: 'action',
        key: 'action',
        width: 150,
        render: (a: string, row) => (
          <span className={`adm-tag ${row.success ? 'is-succeeded' : 'is-failed'}`}>
            {ACTION_LABELS[a] ?? a}
          </span>
        ),
      },
      {
        title: '对象',
        dataIndex: 'targetType',
        key: 'target',
        width: 200,
        render: (type: string, row) => (
          <div>
            <div>{type}</div>
            <code className="adm-cell-sub">{row.targetId.slice(-8)}</code>
          </div>
        ),
      },
      {
        title: 'IP',
        dataIndex: 'ip',
        key: 'ip',
        width: 120,
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: '结果',
        dataIndex: 'success',
        key: 'success',
        width: 70,
        render: (ok: boolean) => <span className={`adm-tag ${ok ? 'is-succeeded' : 'is-failed'}`}>{ok ? '成功' : '失败'}</span>,
      },
      {
        title: '',
        key: 'detail',
        width: 60,
        render: (_: unknown, row) => (
          <button type="button" className="adm-link" onClick={() => setDetailId(row.id)}>
            详情
          </button>
        ),
      },
    ],
    [],
  );

  const detailFetcher = useCallback(async () => {
    // 详情复用列表里已取到的数据, 避免额外请求
    const found = list?.items.find((i) => i.id === detailId);
    if (!found) throw new Error('记录不存在');
    return found;
  }, [detailId, list]);

  return (
    <>
      <PageHeader
        title="操作审计"
        description="记录所有后台写操作，用于事后追责与举证。只读，不可删除或修改。"
      />

      <FilterBar>
        <Select
          className="adm-filter-select"
          placeholder="动作"
          options={actions}
          value={action}
          onChange={setAction}
          allowClear
          showSearch
          optionFilterProp="label"
        />
        <Input
          className="adm-filter-input"
          placeholder="对象 ID"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          onPressEnter={() => setQuery({ targetId: targetId || undefined })}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="结果"
          options={[
            { value: 'true', label: '成功' },
            { value: 'false', label: '失败' },
          ]}
          value={success}
          onChange={(v) => setSuccess(v)}
          allowClear
        />
        <FilterActions>
          <button
            type="button"
            className="adm-btn is-primary"
            onClick={() =>
              setQuery({
                action,
                targetId: targetId || undefined,
                success: success === undefined ? undefined : success === 'true',
              })
            }
          >
            查询
          </button>
          <button
            type="button"
            className="adm-btn"
            onClick={() => {
              setAction(undefined);
              setTargetId('');
              setSuccess(undefined);
              setQuery({ action: undefined, targetId: undefined, success: undefined });
            }}
          >
            重置
          </button>
        </FilterActions>
      </FilterBar>

      <Panel>
        {loading && !data ? (
          <AdminListLoading tip="加载审计记录…" />
        ) : error ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (list?.items.length ?? 0) === 0 ? (
          <AdminEmpty
            description="暂无审计记录。后台的写操作（禁用用户、调价、退款等）会自动记录在这里。"
          />
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={list?.items ?? []}
            loading={loading}
            scroll={{ x: 1100 }}
            onChange={(_p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              // 审计默认按时间倒序, 且必须始终倒序 —— 最早的记录没有追责价值
              void message.info('审计记录按时间倒序展示，不支持改序');
              void s;
            }}
            pagination={{
              current: list?.page ?? 1,
              pageSize: list?.pageSize ?? 20,
              total: list?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (t) => `共 ${t} 条`,
              onChange: setPage,
            }}
          />
        )}
      </Panel>

      <AdminDrawer<Row>
        open={detailId !== null}
        title="审计详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
      >
        {(row) => (
          <>
            <div className="adm-section">
              <div className="adm-section-title">操作概要</div>
              <dl className="adm-desc">
                <dt>时间</dt>
                <dd>{new Date(row.createdAt).toLocaleString('zh-CN')}</dd>
                <dt>操作人</dt>
                <dd>
                  {row.actorEmail} <code className="adm-cell-sub">{row.actorRole}</code>
                </dd>
                <dt>动作</dt>
                <dd>{ACTION_LABELS[row.action] ?? row.action}</dd>
                <dt>对象</dt>
                <dd>
                  {row.targetType} / <code>{row.targetId}</code>
                </dd>
                <dt>来源 IP</dt>
                <dd>
                  <code>{row.ip}</code>
                </dd>
                <dt>结果</dt>
                <dd>
                  <span className={`adm-tag ${row.success ? 'is-succeeded' : 'is-failed'}`}>
                    {row.success ? '成功' : '失败'}
                  </span>
                </dd>
              </dl>
            </div>

            {row.reason && (
              <div className="adm-section">
                <div className="adm-section-title">操作原因</div>
                <div className="adm-reason-box">{row.reason}</div>
              </div>
            )}

            <div className="adm-section">
              <div className="adm-section-title">
                变更内容
                <span className="adm-panel-note">
                  仅记录白名单字段，密码与凭据类内容不写入审计
                </span>
              </div>
              <table className="adm-diff-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>值</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(row.detail).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AdminDrawer>
    </>
  );
}