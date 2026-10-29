import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Button, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Download } from 'lucide-react';
import { adminAuditApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  adminPagination,
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
  type AppliedFilter,
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
  'data.export': '导出数据',
  'backup.download': '下载备份',
};

/** 审计详情直接铺在表格行内，避免只读追溯被抽屉或弹窗打断 */
function AuditExpandedDetail({ row }: { row: Row }) {
  const detailEntries = Object.entries(row.detail);

  return (
    <div className="adm-audit-detail">
      <div className="adm-audit-detail-head">
        <div>
          <div className="adm-audit-detail-title">审计详情</div>
          <div className="adm-audit-detail-sub">记录只追加，不支持修改或删除</div>
        </div>
        <span className={`adm-tag ${row.success ? 'is-success' : 'is-danger'}`}>
          {row.success ? '成功' : '失败'}
        </span>
      </div>

      <dl className="adm-audit-detail-grid">
        <div>
          <dt>时间</dt>
          <dd>{new Date(row.createdAt).toLocaleString('zh-CN')}</dd>
        </div>
        <div>
          <dt>操作人</dt>
          <dd>
            {row.actorEmail} <span className="adm-cell-sub">{row.actorRole}</span>
          </dd>
        </div>
        <div>
          <dt>动作</dt>
          <dd>{ACTION_LABELS[row.action] ?? row.action}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd>
            {row.targetType} / <code>{row.targetId}</code>
          </dd>
        </div>
        <div>
          <dt>来源 IP</dt>
          <dd>
            <code>{row.ip}</code>
          </dd>
        </div>
        <div>
          <dt>记录 ID</dt>
          <dd>
            <code>{row.id}</code>
          </dd>
        </div>
      </dl>

      {row.reason && (
        <div className="adm-audit-detail-block">
          <div className="adm-audit-detail-block-title">操作原因</div>
          <div className="adm-reason-box">{row.reason}</div>
        </div>
      )}

      <div className="adm-audit-detail-block">
        <div className="adm-audit-detail-block-title">
          变更内容
          <span className="adm-panel-note">仅记录白名单字段，密码与凭据类内容不写入审计</span>
        </div>
        {detailEntries.length === 0 ? (
          <div className="adm-audit-detail-empty">本条操作没有可展示的变更字段。</div>
        ) : (
          <table className="adm-diff-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              {detailEntries.map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function AdminAuditPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  // 深链/刷新后保留筛选: 地址栏是运营之间传「我看到的这批」最直接的方式。
  // 初始值同时喂给 useState 与 useAdminList, 首次请求即带筛选 ——
  // 否则会先拉一遍全量、再被 effect 改条件, 白跑一次查询。
  const [searchParams] = useSearchParams();
  const initialAction = searchParams.get('action') ?? undefined;
  const initialTargetId = searchParams.get('targetId') ?? '';
  const rawSuccess = searchParams.get('success');
  const initialSuccess =
    rawSuccess === 'true' ? true : rawSuccess === 'false' ? false : undefined;

  const [action, setAction] = useState<string | undefined>(initialAction);
  const [targetId, setTargetId] = useState(initialTargetId);
  const [success, setSuccess] = useState<string | undefined>(
    initialSuccess === undefined ? undefined : String(initialSuccess),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
    params,
    setQuery,
    setPage,
    reload,
  } = useAdminList<{ result: AdminAuditListResult; actions: Array<{ action: string; count: number }> }>(
    fetcher,
    {
      action: initialAction,
      targetId: initialTargetId || undefined,
      success: initialSuccess,
    },
  );

  // 只同步已生效的筛选, 不同步分页 —— 分享出去的链接不该停在第 7 页
  useAdminUrlFilterSync({
    action: params.action as string | undefined,
    targetId: params.targetId as string | undefined,
    success: params.success as boolean | undefined,
  });

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
          <span className={`adm-tag ${row.success ? 'is-success' : 'is-danger'}`}>
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
        render: (ok: boolean) => <span className={`adm-tag ${ok ? 'is-success' : 'is-danger'}`}>{ok ? '成功' : '失败'}</span>,
      },
      {
        title: '',
        key: 'detail',
        width: 76,
        render: (_: unknown, row) => (
          <Button
            type="link"
            className="adm-link"
            aria-expanded={expandedId === row.id}
            onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
          >
            {expandedId === row.id ? '收起' : '详情'}
          </Button>
        ),
      },
    ],
    [expandedId],
  );

  const hasFilter = Boolean(action || targetId || success);
  const applyFilters = () => {
    setExpandedId(null);
    setQuery({
      action,
      targetId: targetId || undefined,
      success: success === undefined ? undefined : success === 'true',
    });
  };
  const resetFilters = () => {
    setAction(undefined);
    setTargetId('');
    setSuccess(undefined);
    setExpandedId(null);
    setQuery({ action: undefined, targetId: undefined, success: undefined });
  };

  const appliedAction = params.action as string | undefined;
  const appliedTargetId = (params.targetId as string | undefined) ?? '';
  const appliedSuccess = params.success as boolean | undefined;
  const appliedChips: AppliedFilter[] = [
    appliedAction
      ? {
          key: 'action',
          label: `动作：${ACTION_LABELS[appliedAction] ?? appliedAction}`,
          onClear: () => {
            setAction(undefined);
            setExpandedId(null);
            setQuery({ action: undefined });
          },
        }
      : null,
    appliedTargetId
      ? {
          key: 'targetId',
          label: `对象 ID：${appliedTargetId}`,
          onClear: () => {
            setTargetId('');
            setExpandedId(null);
            setQuery({ targetId: undefined });
          },
        }
      : null,
    appliedSuccess !== undefined
      ? {
          key: 'success',
          label: `结果：${appliedSuccess ? '成功' : '失败'}`,
          onClear: () => {
            setSuccess(undefined);
            setExpandedId(null);
            setQuery({ success: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  /** 导出走已生效的筛选条件 —— 必须与屏幕上的列表同口径 */
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminAuditApi.exportCsv({
        action: params.action as string | undefined,
        targetId: params.targetId as string | undefined,
        success: params.success as boolean | undefined,
      });
      void message.success('导出已开始下载');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="操作审计"
        description="记录所有后台写操作，用于事后追责与举证。只读，不可删除或修改。"
        actions={
          can('data.export') ? (
            <Button
              type="default"
              className="adm-btn"
              loading={exporting}
              onClick={() => void exportCsv()}
            >
              <Download size={14} style={{ marginRight: 4 }} />
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          ) : undefined
        }
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
          onPressEnter={applyFilters}
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
          <Button
            type="primary"
            className="adm-btn is-primary"
            onClick={applyFilters}
          >
            查询
          </Button>
          <Button type="default" className="adm-btn" onClick={resetFilters}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel>
        {loading && !data ? (
          <AdminListLoading tip="加载审计记录…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (list?.items.length ?? 0) === 0 ? (
          <AdminEmpty
            description={
              hasFilter
                ? '没有符合条件的审计记录。清除筛选后再试。'
                : '暂无审计记录。后台的写操作（禁用用户、调价、退款等）会自动记录在这里。'
            }
            action={
              hasFilter ? (
                <Button type="default" className="adm-btn" onClick={resetFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={list?.items ?? []}
            loading={loading}
            scroll={{ x: 1100 }}
            expandable={{
              expandedRowKeys: expandedId ? [expandedId] : [],
              expandedRowRender: (row) => <AuditExpandedDetail row={row} />,
              expandedRowClassName: 'adm-audit-expanded-row',
              showExpandColumn: false,
              onExpandedRowsChange: (keys) =>
                setExpandedId(keys.length > 0 ? String(keys[keys.length - 1]) : null),
            }}
            pagination={adminPagination({
              current: list?.page ?? 1,
              pageSize: list?.pageSize ?? 20,
              total: list?.total ?? 0,
              onChange: (page, pageSize) => {
                setExpandedId(null);
                setPage(page, pageSize);
              },
            })}
          />
        )}
      </Panel>
    </>
  );
}
