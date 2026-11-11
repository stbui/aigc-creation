import { ActionButton, AdminDataTable, RowMenu, StatusTag, type AdminColumn, type RowMenuItem } from '~/admin-ui/primitives';
import { BILLING_MODE_LABELS, PRICE_POLICY_LABELS } from './constants';
import type { AdminLogicalModelView } from '../../../types/model';

/**
 * 售卖单元清单（孤儿前台模型）。
 *
 * 「商品可用」与「售卖中」是两件事：售卖中但商品不可用的配置照样会失败（42204），
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
      title: '售卖单元',
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
      title: '用户实付',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[12px]">
          <span className="text-foreground">
            {PRICE_POLICY_LABELS[row.pricePolicy] ?? row.pricePolicy} ·{' '}
            {BILLING_MODE_LABELS[row.billingMode] ?? row.billingMode}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {row.displayPrice === null ? '跟随商品售价' : `${row.displayPrice} 积分`}
            {row.priceTiers.length > 1 ? ` · ${row.priceTiers.length} 档` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'routes',
      title: '模型商品',
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
            <StatusTag status="enabled" tone="success" label="售卖中" />
          ) : (
            <StatusTag status="disabled" tone="muted" label="未售卖" />
          )}
          {row.available ? (
            <StatusTag status="available" tone="success" label="商品可用" />
          ) : (
            <StatusTag
              status="unavailable"
              tone="danger"
              label={row.configurationError ? '配置错误' : '商品不可用'}
            />
          )}
        </div>
      ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (row) => {
        /*
         * 直显只有「编辑」。测试消费与移除售卖都是低频动作：前者是配价时的
         * 一次性验证，后者是下架前才点，平铺三颗会让操作列比正文还抢眼。
         */
        const moreItems: RowMenuItem[] = [
          { key: 'simulate', label: '测试消费', onSelect: () => onSimulate(row) },
        ];
        if (!row.archivedAt) {
          moreItems.push({
            key: 'archive',
            label: '移除售卖',
            danger: true,
            separator: true,
            disabled: !writable,
            onSelect: () => onArchive(row),
          });
        }
        return (
          <div className="flex items-center gap-1">
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={!writable || !!row.archivedAt}
              onClick={() => onEdit(row)}
            >
              编辑
            </ActionButton>
            <RowMenu label={`售卖单元 ${row.name} 更多操作`} items={moreItems} />
          </div>
        );
      },
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
      emptyText="还没有售卖单元。先在「模型商品」配置供应商与商品，再在这里把能力暴露给用户。"
      minWidth={1040}
    />
  );
}
