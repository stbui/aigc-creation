import { Link } from 'react-router-dom';
import {
  ActionButton,
  AdminDataTable,
  BatchBar,
  RowMenu,
  StatusTag,
  type AdminColumn,
  type RowMenuItem,
} from '~/admin-ui/primitives';
import { CHANNEL_LABELS, REFUND_STATE_TONES, REFUND_STATUS_LABELS, STATUS_LABEL_OVERRIDE } from './constants';
import { adminOrderDetailHref, adminUserDetailHref, fmtTime, yuan } from './utils';
import type { AdminOrderRow } from '../../../types/api';

/**
 * 订单列表：列定义、批量核销入口与表格状态。
 *
 * 面板外壳、导出与刷新由页面持有 —— 表格只负责「这批行怎么显示」，
 * 与参考页（调用记录）保持同一层级：页头 → 筛选条 → 面板（含列表动作）。
 */
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
  canDelete,
  canPaymentOperate,
  busy,
  onRetry,
  onSelectedChange,
  onPageChange,
  onOpenDetail,
  onAction,
  onDelete,
  onPaymentAction,
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
  canDelete: boolean;
  /** `payment.operate`：渠道查单 / 关单 */
  canPaymentOperate: boolean;
  busy: boolean;
  onRetry: () => void;
  onSelectedChange: (keys: string[]) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onOpenDetail: (id: string) => void;
  onAction: (kind: 'markPaid' | 'refund', row: AdminOrderRow) => void;
  onDelete: (row: AdminOrderRow) => void;
  onPaymentAction: (kind: 'query' | 'close', row: AdminOrderRow) => void;
  onBatchMarkPaid: () => void;
  onReset: () => void;
}) {
  const columns: Array<AdminColumn<AdminOrderRow>> = [
    {
      key: 'orderNo',
      title: '订单号 / 下单时间',
      width: 190,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <Link
            className="truncate rounded font-mono font-medium text-brand hover:underline"
            to={adminOrderDetailHref(row.id)}
          >
            {row.orderNo}
          </Link>
          <span className="text-muted-foreground">{fmtTime(row.createdAt)}</span>
        </div>
      ),
    },
    {
      key: 'user',
      title: '用户',
      width: 170,
      render: (row) => (
        <Link
          className="block max-w-[160px] truncate font-medium text-foreground transition-colors hover:text-brand hover:underline"
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
          <span className="max-w-[110px] truncate text-muted-foreground">
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
                  ? 'max-w-[140px] truncate text-danger-text'
                  : 'max-w-[140px] truncate text-muted-foreground'
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
              className="max-w-[170px] truncate text-muted-foreground"
              title={`${row.membershipPlanCode} · ${credits}`}
            >
              {row.membershipPlanCode} · {credits}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 text-muted-foreground">
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
      width: 160,
      render: (row) =>
        row.paidAt ? (
          <span className="tabular-nums">{fmtTime(row.paidAt)}</span>
        ) : (
          <span className="text-muted-foreground">未支付</span>
        ),
    },
    {
      /*
       * 退款状态列：退款单状态与订单状态是两个维度 —— 渠道异步退款时订单
       * 仍是「已支付」，不单列一列就「筛得出却看不出是哪单」。
       */
      key: 'refundState',
      title: '退款状态',
      width: 110,
      render: (row) =>
        row.refundState ? (
          <StatusTag
            status={`refund-${row.refundState}`}
            tone={REFUND_STATE_TONES[row.refundState]}
            label={REFUND_STATUS_LABELS[row.refundState]}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 170,
      /* 固定在最右, 保证滚动时高频动作仍可见 */
      fixed: 'right',
      render: (row) => {
        /*
         * 支付域的查单/关单只对未支付订单成立：查单以渠道事实为准（可能立即
         * 入账），关单只停止继续等待支付。两者收进「更多」，避免操作列在
         * 已有核销/退款时被挤到横向滚动区外。
         */
        const canQuery = row.status === 'pending' && row.channel !== 'free';
        const canClose = row.status === 'pending';
        const canRemove =
          canDelete &&
          (row.status === 'pending' || row.status === 'cancelled') &&
          row.paymentCount === 0;

        const moreItems: RowMenuItem[] = [];
        if (canPaymentOperate && canQuery) {
          moreItems.push({
            key: 'query',
            label: '同步状态',
            onSelect: () => onPaymentAction('query', row),
          });
        }
        if (canPaymentOperate && canClose) {
          moreItems.push({
            key: 'close',
            label: '关闭订单',
            danger: true,
            onSelect: () => onPaymentAction('close', row),
          });
        }
        if (canRemove) {
          moreItems.push({
            key: 'delete',
            label: '删除',
            danger: true,
            separator: moreItems.length > 0,
            onSelect: () => onDelete(row),
          });
        }

        return (
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
            <RowMenu label={`订单 ${row.orderNo} 更多操作`} items={moreItems} />
          </div>
        );
      },
    },
  ];

  return (
    <>
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
        /* 整行可点开详情：操作列在横向滚动后容易被裁掉 */
        onRowClick={(row) => onOpenDetail(row.id)}
        minWidth={1200}
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
    </>
  );
}
