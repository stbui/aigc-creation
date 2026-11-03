import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Row, ACTION_LABELS } from './constants';
import { useAdmin, useToast, useAdminList, useAdminUrlFilterSync } from './hooks';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';

import { adminAuditApi } from '../../../lib/api';

import { ActionButton, AdminDataTable, AppliedFilters, ClearableField, FilterActions, FilterBar, PageHeader, Panel, SelectField, StatusTag, StaleError, type AdminColumn, type AppliedFilter } from './components';
import type { AdminAuditListResult } from '../../../types/api';

/**
 * 操作审计。
 *
 * 页面职责不变：只读，记录后台全部写操作，用于事后追责与举证。
 * 审计只留痕，不承载任何操作确认：包括导出在内，均不弹二次确认；
 * 高危动作的确认与原因输入属于业务页面，由业务动作自行负责。
 * 本次改造只换渲染层 —— 筛选条件、URL 同步、导出、行内展开的行为逐条保留：
 *
 * - 筛选值有「草稿 / 已生效」两态，只有点「查询」才改列表，URL 也只同步已生效的值；
 * - 详情铺在行内而不是抽屉：追溯时经常要对照上一行的记录，抽屉会挡住上下文；
 * - 导出走**已生效**的筛选条件，与屏幕上的列表同口径。
 */

/** 审计详情直接铺在表格行内，避免只读追溯被抽屉或弹窗打断 */
export function AuditExpandedDetail({ row }: { row: Row }) {
  const detailEntries = Object.entries(row.detail);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-foreground">审计详情</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            记录只追加，不支持修改或删除
          </div>
        </div>
        <StatusTag
          status={row.success ? 'succeeded' : 'failed'}
          label={row.success ? '成功' : '失败'}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3 xl:grid-cols-6">
        <Field label="时间">{new Date(row.createdAt).toLocaleString('zh-CN')}</Field>
        <Field label="操作人">
          {row.actorEmail}
          <span className="ml-1.5 text-muted-foreground">{row.actorRole}</span>
        </Field>
        <Field label="动作">{ACTION_LABELS[row.action] ?? row.action}</Field>
        <Field label="对象">
          {row.targetType} / <Mono>{row.targetId}</Mono>
        </Field>
        <Field label="来源 IP">
          <Mono>{row.ip}</Mono>
        </Field>
        <Field label="记录 ID">
          <Mono>{row.id}</Mono>
        </Field>
      </dl>

      {row.reason && (
        <div>
          <div className="mb-1 text-[12px] text-muted-foreground">操作原因</div>
          <div className="rounded-lg border border-border bg-warn-soft px-2.5 py-2 text-xs text-foreground">
            {row.reason}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[12px] text-muted-foreground">变更内容</span>
          <span className="text-[12px] text-muted-foreground">
            仅记录白名单字段，密码与凭据类内容不写入审计
          </span>
        </div>
        {detailEntries.length === 0 ? (
          <div className="text-xs text-muted-foreground">本条操作没有可展示的变更字段。</div>
        ) : (
          <table className="w-auto border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th scope="col" className="px-2 py-1 text-left font-medium text-muted-foreground">
                  字段
                </th>
                <th scope="col" className="px-2 py-1 text-left font-medium text-muted-foreground">
                  值
                </th>
              </tr>
            </thead>
            <tbody>
              {detailEntries.map(([key, value]) => (
                <tr key={key} className="border-b border-border/70">
                  <td className="px-2 py-1 align-top text-muted-foreground">{key}</td>
                  <td className="px-2 py-1 align-top text-foreground">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-xs text-foreground" title={typeof children === 'string' ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12px] text-muted-foreground">{children}</code>;
}

export function AdminAuditPage() {
  const toast = useToast();
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

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'createdAt',
        title: '时间',
        width: 160,
        render: (row) => new Date(row.createdAt).toLocaleString('zh-CN'),
      },
      {
        key: 'actor',
        title: '操作人',
        width: 190,
        render: (row) => (
          <div>
            <div>{row.actorEmail}</div>
            <div className="text-[12px] text-muted-foreground">{row.actorRole}</div>
          </div>
        ),
      },
      {
        key: 'action',
        title: '动作',
        width: 150,
        // 动作标签的颜色跟随结果：一眼扫下去先看见红的是什么动作失败
        render: (row) => (
          <StatusTag
            status={row.success ? 'succeeded' : 'failed'}
            label={ACTION_LABELS[row.action] ?? row.action}
          />
        ),
      },
      {
        key: 'target',
        title: '对象',
        width: 200,
        render: (row) => (
          <div>
            <div>{row.targetType}</div>
            <Mono>{row.targetId.slice(-8)}</Mono>
          </div>
        ),
      },
      {
        key: 'ip',
        title: 'IP',
        width: 120,
        render: (row) => <Mono>{row.ip}</Mono>,
      },
      {
        key: 'success',
        title: '结果',
        width: 70,
        render: (row) => (
          <StatusTag
            status={row.success ? 'succeeded' : 'failed'}
            label={row.success ? '成功' : '失败'}
          />
        ),
      },
      {
        key: 'detail',
        title: '',
        width: 76,
        render: (row) => (
          <ActionButton
            variant="ghost"
            size="sm"
            aria-expanded={expandedId === row.id}
            onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
          >
            {expandedId === row.id ? '收起' : '详情'}
          </ActionButton>
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
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
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
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Download}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </ActionButton>
          ) : undefined
        }
      />

      <FilterBar>
        {/*
         * 动作下拉不做搜索框：动作总数取自后端聚合，量级在十几条，
         * radix Select 自带键盘首字母跳转，再加搜索框只是多一层操作。
         */}
        <SelectField
          className="w-48"
          ariaLabel="按动作筛选"
          placeholder="动作"
          options={actions}
          value={action}
          onChange={setAction}
          allowClear
        />
        <ClearableField
          className="w-48"
          placeholder="对象 ID"
          value={targetId}
          onChange={setTargetId}
          onEnter={applyFilters}
        />
        <SelectField
          className="w-28"
          ariaLabel="按结果筛选"
          placeholder="结果"
          options={[
            { value: 'true', label: '成功' },
            { value: 'false', label: '失败' },
          ]}
          value={success}
          onChange={setSuccess}
          allowClear
        />
        <FilterActions>
          <ActionButton variant="default" size="sm" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel>
        <AdminDataTable<Row>
          rows={list?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1100}
          emptyText={
            hasFilter
              ? '没有符合条件的审计记录。清除筛选后再试。'
              : '暂无审计记录。后台的写操作（禁用用户、调价、退款等）会自动记录在这里。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          expandedKeys={expandedId ? [expandedId] : []}
          onExpandedChange={(keys) =>
            setExpandedId(keys.length > 0 ? keys[keys.length - 1] : null)
          }
          renderExpanded={(row) => <AuditExpandedDetail row={row} />}
          pagination={{
            current: list?.page ?? 1,
            pageSize: list?.pageSize ?? 20,
            total: list?.total ?? 0,
            onChange: (page, pageSize) => {
              setExpandedId(null);
              setPage(page, pageSize);
            },
          }}
        />
      </Panel>
    </>
  );
}
