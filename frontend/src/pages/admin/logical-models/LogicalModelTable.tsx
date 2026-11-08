import { Archive, FlaskConical } from 'lucide-react';
import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from '~/admin-ui/primitives';
import { BILLING_MODE_LABELS, PRICE_POLICY_LABELS } from './constants';
import type { AdminLogicalModelView } from '../../../types/model';

/**
 * 前台模型清单。
 *
 * 「线路可用」与「已上架」是两件事：上架但路由不可用的模型照样会失败（42204），
 * 所以两列分开展示，排障时能一眼看出卡在哪一层。
 */
export function LogicalModelTable({
  rows,
  loading,
  error,
  writable,
  onEdit,
  onSimulate,
  onArchive,
  onRetry,
}: {
  rows: AdminLogicalModelView[];
  loading: boolean;
  error: string | null;
  writable: boolean;
  onEdit: (row: AdminLogicalModelView) => void;
  onSimulate: (row: AdminLogicalModelView) => void;
  onArchive: (row: AdminLogicalModelView) => void;
  onRetry: () => void;
}) {
  const columns: Array<AdminColumn<AdminLogicalModelView>> = [
    {
      key: 'name',
      title: '前台模型',
      width: 240,
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {row.icon && <span aria-hidden>{row.icon}</span>}
            <span className="truncate font-medium text-foreground">{row.name}</span>
            {row.archivedAt && <StatusTag status="archived" tone="muted" label="已归档" />}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
            {row.code}
          </div>
        </div>
      ),
    },
    {
      key: 'capability',
      title: '能力',
      width: 140,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[12px]">
          <span className="text-foreground">{row.capabilitySpec?.capability || '—'}</span>
          <span className="text-muted-foreground">{row.capability}</span>
        </div>
      ),
    },
    {
      key: 'price',
      title: '价格',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[12px]">
          <span className="text-foreground">
            {PRICE_POLICY_LABELS[row.pricePolicy] ?? row.pricePolicy} ·{' '}
            {BILLING_MODE_LABELS[row.billingMode] ?? row.billingMode}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {row.displayPrice === null ? '跟随服务价格' : `${row.displayPrice} 积分`}
            {row.priceTiers.length > 1 ? ` · ${row.priceTiers.length} 档` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'routes',
      title: '服务来源',
      width: 120,
      render: (row) => {
        const available = row.routes.filter((route) => route.available).length;
        return (
          <div className="flex flex-col gap-0.5 text-[12px]">
            <span className="tabular-nums text-foreground">
              {available} / {row.routes.length} 可用
            </span>
            {row.routes.length > 0 && (
              <span
                className="truncate text-muted-foreground"
                title={row.routes
                  .map((r) => `${r.channelName} / ${r.channelModelName}`)
                  .join('、')}
              >
                {row.routes[0].channelName} / {row.routes[0].channelModelName}
                {row.routes.length > 1 ? ' 等' : ''}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 150,
      render: (row) => (
        <div className="flex flex-col gap-1">
          {row.enabled ? (
            <StatusTag status="enabled" tone="success" label="已上架" />
          ) : (
            <StatusTag status="disabled" tone="muted" label="未上架" />
          )}
          {row.available ? (
            <StatusTag status="available" tone="success" label="路由可用" />
          ) : (
            <StatusTag
              status="unavailable"
              tone="danger"
              label={row.configurationError ? '配置错误' : '路由不可用'}
            />
          )}
        </div>
      ),
    },
    {
      key: 'revision',
      title: 'Revision',
      width: 90,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">v{row.revisionVersion}</span>
      ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 240,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={!writable || !!row.archivedAt}
            onClick={() => onEdit(row)}
          >
            编辑
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={FlaskConical}
            onClick={() => onSimulate(row)}
          >
            模拟
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Archive}
            disabled={!writable || !!row.archivedAt}
            onClick={() => onArchive(row)}
          >
            归档
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <AdminDataTable<AdminLogicalModelView>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={rows.length === 0 ? error : null}
      onRetry={onRetry}
      emptyText="还没有前台模型。先在「渠道工作台」配置渠道与模型，再在这里把能力暴露给用户。"
      minWidth={1120}
    />
  );
}
