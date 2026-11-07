import { Link } from 'react-router-dom';
import {
  ActionButton,
  AdminDataTable,
  BatchBar,
  Panel,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { CHANNEL_LABELS, STATUS_LABEL_OVERRIDE } from './constants';
import { adminOrderDetailHref, adminUserDetailHref, yuan } from './utils';
import type { AdminOrderRow } from '../../../types/api';

/** 订单列表：列定义与批量核销入口集中在这里，页面只提供数据与动作。 */
export function OrderTable({
  rows,
  loading,
  error,
  selected,
  page,
  pageSize,
  total,
  hasFilter,
  canMarkPaid,
  canRefund,
  busy,
  onRetry,
  onSelectedChange,
  onPageChange,
  onOpenDetail,
  onAction,
  onBatchMarkPaid,
  onReset,
}: {
  rows: AdminOrderRow[];
  loading: boolean;
  error?: string | null;
  selected: string[];
  page: number;
  pageSize: number;
  total: number;
  hasFilter: boolean;
  canMarkPaid: boolean;
  canRefund: boolean;
  busy: boolean;
  onRetry: () => void;
  onSelectedChange: (keys: string[]) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onOpenDetail: (id: string) => void;
  onAction: (kind: 'markPaid' | 'refund', row: AdminOrderRow) => void;
  onBatchMarkPaid: () => void;
  onReset: () => void;
}) {
  const columns: Array<AdminColumn<AdminOrderRow>> = [
    {
      key: 'orderNo',
      title: '订单号 / 下单时间',
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <Link
            className="truncate rounded font-mono text-xs font-medium text-brand hover:underline"
            to={adminOrderDetailHref(row.id)}
          >
            {row.orderNo}
          </Link>
          <span className="text-[12px] text-muted-foreground">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
      ),
    },
    {
      key: 'user',
      title: '用户',
      width: 170,
      render: (row) => (
        <Link
          className="block max-w-[160px] truncate text-xs font-medium text-foreground transition-colors hover:text-brand hover:underline"
          to={adminUserDetailHref(row.userId)}
          title={row.userEmail}
        >
          {row.userEmail}
        </Link>
      ),
    },
    {
      key: 'status',
      title: '状态 / 渠道',
      width: 120,
      render: (row) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusTag status={row.status} label={STATUS_LABEL_OVERRIDE[row.status]} />
          <span className="max-w-[110px] truncate text-[12px] text-muted-foreground">
            {row.channel ? CHANNEL_LABELS[row.channel] ?? row.channel : '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'paid',
      title: '实付 / 优惠',
      width: 150,
      render: (row) => {
        const extra = [
          row.refundedCents > 0 ? `已退 ¥ ${yuan(row.refundedCents)}` : '',
          row.discountCents > 0 ? `优惠 -¥ ${yuan(row.discountCents)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums">¥ {yuan(row.paidCents)}</span>
            <span
              className={
                row.refundedCents > 0
                  ? 'max-w-[140px] truncate text-[12px] text-danger-text'
                  : 'max-w-[140px] truncate text-[12px] text-muted-foreground'
              }
              title={extra || undefined}
            >
              {extra || '无优惠'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'items',
      title: '商品 / 积分',
      width: 180,
      render: (row) => {
        const credits = row.grantedCredits > 0 ? `+${row.grantedCredits} 积分` : '无积分';
        return row.membershipPlanName ? (
          <div className="flex flex-col gap-0.5">
            <span className="max-w-[170px] truncate" title={row.membershipPlanName}>
              {row.membershipPlanName}
            </span>
            <span
              className="max-w-[170px] truncate text-[12px] text-muted-foreground"
              title={`${row.membershipPlanCode} · ${credits}`}
            >
              {row.membershipPlanCode} · {credits}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 text-[12px] text-muted-foreground">
            {/*
             * 直接给商品名而不是「N 件商品」：运营在商品卡上点「N 单」跳过来，
             * 首先要确认这几单买的确实是那个 SKU。多件时取首个 + 计数。
             */}
            <span
              className="max-w-[170px] truncate"
              title={row.items.map((item) => `${item.name}（${item.sku}）`).join('\n')}
            >
              {row.items[0]?.name ?? `${row.itemCount} 件商品`}
              {row.items.length > 1 ? ` 等 ${row.items.length} 件` : ''}
            </span>
            <span>{credits}</span>
          </div>
        );
      },
    },
    {
      key: 'paidAt',
      title: '支付时间',
      width: 150,
      render: (row) =>
        row.paidAt ? (
          <span className="text-xs tabular-nums">{new Date(row.paidAt).toLocaleString('zh-CN')}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">未支付</span>
        ),
    },
    {
      key: 'ops',
      title: '',
      width: 130,
      /* 固定在最右, 保证滚动时高频动作仍可见 */
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" onClick={() => onOpenDetail(row.id)}>
            详情
          </ActionButton>
          {/*
           * 动作按状态出现而非置灰: 「未支付才能核销」「已支付才能退款」都是
           * 后端硬校验, 给一个点不动的按钮只会让人反复试。
           */}
          {row.status === 'pending' && canMarkPaid && (
            <ActionButton variant="ghost" size="sm" onClick={() => onAction('markPaid', row)}>
              核销
            </ActionButton>
          )}
          {(row.status === 'paid' || row.status === 'partial_refunded') &&
            row.paidCents > row.refundedCents &&
            canRefund && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => onAction('refund', row)}
              >
                退款
              </ActionButton>
            )}
        </div>
      ),
    },
  ];


  return (
      <Panel title="订单列表" note="日期筛选含结束当天；导出口径与当前筛选一致">
        {/* 批量条贴在表头上方: 勾选后要立即看到「能动多少笔」 */}
        <BatchBar count={selected.length} unit="单">
          {canMarkPaid && (
            <ActionButton
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => {
                onBatchMarkPaid();
              }}
            >
              批量核销
            </ActionButton>
          )}
          <ActionButton variant="ghost" size="sm" onClick={() => onSelectedChange([])}>
            清空选择
          </ActionButton>
        </BatchBar>

        <AdminDataTable<AdminOrderRow>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={onRetry}
          minWidth={1090}
          selectable
          selected={selected}
          onSelectedChange={onSelectedChange}
          // 只有待支付能核销; 已支付/已退款选中后再点批量核销只会得到一堆失败项
          isRowSelectable={(row) => row.status === 'pending'}
          pagination={{
            current: page,
            pageSize,
            total,
            unit: '单',
            // 翻页清空选择: 批量核销/退款只应对看得见的行下手
            onChange: (page, size) => {
              onSelectedChange([]);
              onPageChange(page, size);
            },
          }}
          emptyText={
            hasFilter
              ? '没有符合条件的订单。清除筛选或换一个时间范围试试。'
              : '还没有订单。用户下单后会出现在这里。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={onReset}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>
  );
}
