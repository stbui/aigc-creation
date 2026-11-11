import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  AdminDrawer,
  Descriptions,
  DetailSection,
  StatusTag,
} from '~/admin-ui/primitives';
import { adminOrdersApi } from './api';
import {
  aggregateRefundState,
  CHANNEL_LABELS,
  PAYMENT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  STATUS_LABEL_OVERRIDE,
} from './constants';
import {
  adminCreditHref,
  adminTasksHref,
  adminUserDetailHref,
  cn,
  fmtTime,
  yuan,
} from './utils';
import type { AdminOrderDetail, AdminOrderRefund, AdminOrderRow } from '../../../types/api';

/** 详情抽屉里的一条时间线记录：状态点 + 主行 + 灰色补充行 */
function RecordRow({
  head,
  meta,
  state = 'done',
  action,
}: {
  head: ReactNode;
  meta: ReactNode;
  /** 未成功的流水/退款用灰点：既保留时间线，又不假装它已经成立 */
  state?: 'done' | 'pending';
  action?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span
        className={cn(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          state === 'done' ? 'bg-success-text' : 'bg-muted-foreground/40',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-foreground">{head}</span>
        <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">{meta}</span>
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </li>
  );
}

/**
 * 把详情投影成列表行。
 *
 * 深链进入时目标订单不一定在当前筛选页里，不能用 `rows.find` 决定动作是否
 * 可用；列表行只是动作弹窗需要的字段集合，详情里都有。
 */
function rowFromDetail(detail: AdminOrderDetail): AdminOrderRow {
  return {
    id: detail.id,
    orderNo: detail.orderNo,
    userId: detail.userId,
    userEmail: detail.user.email,
    status: detail.status,
    channel: detail.channel,
    totalCents: detail.totalCents,
    discountCents: detail.discountCents,
    paidCents: detail.paidCents,
    refundedCents: detail.refundedCents,
    grantedCredits: detail.grantedCredits,
    itemCount: detail.items.length,
    items: detail.items.map((item) => ({
      name: item.nameSnapshot,
      sku: item.skuSnapshot,
    })),
    paymentCount: detail.payments.length,
    /*
     * 退款状态与列表列同源：命中任意一笔退款单即取最需要人管的那个。
     * 详情里带了完整退款单列表，这里直接聚合。
     */
    refundState: aggregateRefundState(detail.refunds.map((refund) => refund.status)),
    membershipPlanCode: detail.membershipPlan?.code ?? null,
    membershipPlanName: detail.membershipPlan?.name ?? null,
    createdAt: detail.createdAt,
    paidAt: detail.paidAt,
  };
}

/**
 * 深链意图的自动打开器。
 *
 * 只打开弹窗、不提交；用 ref 防止详情刷新后重复弹出。
 *
 * `confirmRefund`（渠道退款结果核对）**刻意不自动打开任何确认框**：
 * 这个动作有两个方向（已退款 / 退款失败），自动弹出其中一个等于替运营
 * 选了方向，而「确认已退款」会立刻扣积分、改订单状态。这里只把抽屉打开，
 * 由运营看完退款记录后在下方的两个按钮上自行选择。
 */
function OrderIntentAutoOpen({
  detail,
  intent,
  canMarkPaid,
  canRefund,
  onAction,
}: {
  detail: AdminOrderDetail;
  intent: 'markPaid' | 'refund' | 'confirmRefund';
  canMarkPaid: boolean;
  canRefund: boolean;
  onAction: (kind: 'markPaid' | 'refund', row: AdminOrderRow) => void;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (intent === 'markPaid' && canMarkPaid && detail.status === 'pending') {
      fired.current = true;
      onAction('markPaid', rowFromDetail(detail));
      return;
    }
    if (
      intent === 'refund' &&
      canRefund &&
      (detail.status === 'paid' || detail.status === 'partial_refunded') &&
      !detail.refunds.some((refund) => refund.status === 'processing') &&
      detail.paidCents > detail.refundedCents
    ) {
      fired.current = true;
      onAction('refund', rowFromDetail(detail));
    }
  }, [canMarkPaid, canRefund, detail, intent, onAction]);

  return null;
}

/**
 * 订单详情抽屉。
 *
 * 从页面拆出：详情的数据获取与退款/核销入口和列表筛选是两套生命周期；
 * 动作仍回到页面统一走确认弹窗，避免同一笔订单出现两个确认入口。
 */
export function OrderDetailDrawer({
  detailId,
  rows,
  canMarkPaid,
  canRefund,
  canPaymentOperate,
  initialIntent,
  onClose,
  onAction,
  onPaymentAction,
  onConfirmRefund,
}: {
  detailId: string | null;
  rows: AdminOrderRow[];
  canMarkPaid: boolean;
  canRefund: boolean;
  /** `payment.operate`：渠道查单 / 关单 */
  canPaymentOperate: boolean;
  /** 从工单/工作台带 `intent` 进入时，详情加载后自动打开对应动作 */
  initialIntent?: 'markPaid' | 'refund' | 'confirmRefund' | null;
  onClose: () => void;
  onAction: (kind: 'markPaid' | 'refund', row: AdminOrderRow) => void;
  onPaymentAction: (kind: 'query' | 'close', row: AdminOrderRow) => void;
  onConfirmRefund: (
    orderId: string,
    refund: AdminOrderRefund,
    outcome: 'succeeded' | 'failed',
  ) => void;
}) {
  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('订单不存在');
    return adminOrdersApi.detail(detailId);
  }, [detailId]);

  return (
    <AdminDrawer<AdminOrderDetail>
      open={detailId !== null}
      title="订单详情"
      onClose={onClose}
      fetcher={detailFetcher}
      footer={(d) => {
        const row = rows.find((o) => o.id === d.id) ?? rowFromDetail(d);
        const markPaid =
          canMarkPaid && d.status === 'pending';
        const refund =
          canRefund &&
          (d.status === 'paid' || d.status === 'partial_refunded') &&
          d.paidCents > d.refundedCents;
        /*
         * 查单/关单只对未支付订单成立（后端硬校验）。免费订单没有支付渠道可查，
         * 仍可关闭 —— 与后端 `canQuery` 的口径一致。
         */
        const syncPayment =
          canPaymentOperate && d.status === 'pending' && d.channel !== 'free';
        const closePayment = canPaymentOperate && d.status === 'pending';
        // 无可执行动作时不渲染空页脚，避免详情底部留下无意义的空白操作条
        if (!markPaid && !refund && !syncPayment && !closePayment) return null;
        return (
          <>
            {markPaid && (
              <ActionButton variant="default" size="sm" onClick={() => onAction('markPaid', row)}>
                标记为已支付
              </ActionButton>
            )}
            {syncPayment && (
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => onPaymentAction('query', row)}
              >
                同步渠道状态
              </ActionButton>
            )}
            {closePayment && (
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => onPaymentAction('close', row)}
              >
                关闭订单
              </ActionButton>
            )}
            {refund && !d.refunds.some((row) => row.status === 'processing') && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => onAction('refund', row)}
              >
                退款
              </ActionButton>
            )}
          </>
        );
      }}
    >
      {(d) => (
        <div className="flex flex-col gap-6">
          {initialIntent && (
            <OrderIntentAutoOpen
              detail={d}
              intent={initialIntent}
              canMarkPaid={canMarkPaid}
              canRefund={canRefund}
              onAction={onAction}
            />
          )}
          <DetailSection title="订单概要" note="金额以「分」存储，展示按「元」">
            <Descriptions
              columns={2}
              items={[
                {
                  label: '订单号',
                  value: <code className="font-mono text-xs">{d.orderNo}</code>,
                },
                {
                  label: '状态',
                  value: <StatusTag status={d.status} label={STATUS_LABEL_OVERRIDE[d.status]} />,
                },
                {
                  label: '用户',
                  value: (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        {d.user.name ? `${d.user.name} · ` : ''}
                        <Link
                          className="text-brand hover:underline"
                          to={adminUserDetailHref(d.userId)}
                        >
                          {d.user.email}
                        </Link>
                      </span>
                      <Link
                        className="text-[12px] text-brand hover:underline"
                        to={adminCreditHref({ userId: d.userId, email: d.user.email })}
                      >
                        积分账本
                      </Link>
                      <Link
                        className="text-[12px] text-brand hover:underline"
                        to={adminTasksHref({ userId: d.userId })}
                      >
                        任务记录
                      </Link>
                    </div>
                  ),
                },
                {
                  label: '订单金额',
                  value: (
                    <span className="tabular-nums">
                      ¥ {yuan(d.totalCents)}（{d.totalCents} 分）
                    </span>
                  ),
                },
                {
                  label: '优惠',
                  value: (
                    <span>
                      ¥ {yuan(d.discountCents)}
                      {d.coupon ? ` · 券 ${d.coupon.code}` : ''}
                      {d.campaign ? ` · 活动 ${d.campaign.name}` : ''}
                    </span>
                  ),
                },
                {
                  label: '实付',
                  value: <span className="tabular-nums">¥ {yuan(d.paidCents)}</span>,
                },
                {
                  label: '已退',
                  value: <span className="tabular-nums">¥ {yuan(d.refundedCents)}</span>,
                },
                {
                  label: '发放积分',
                  value: <span className="tabular-nums">{d.grantedCredits}</span>,
                },
                {
                  label: '渠道',
                  value: d.channel ? CHANNEL_LABELS[d.channel] ?? d.channel : '—',
                },
                { label: '下单时间', value: fmtTime(d.createdAt) },
                {
                  label: '支付时间',
                  value: d.paidAt ? fmtTime(d.paidAt) : '未支付',
                },
                { label: '支付时限', value: fmtTime(d.expiresAt) },
                ...(d.membershipPlan
                  ? [
                      {
                        label: '会员套餐',
                        value: (
                          <>
                            {d.membershipPlan.name}（{d.membershipPlan.durationDays} 天 · 每月{' '}
                            {d.membershipPlan.monthlyCredits} 积分）
                            {d.membershipAppliedAt ? (
                              <>
                                <span className="text-[12px] text-muted-foreground"> · 权益已发放</span>
                                {d.membershipPeriodStartAt && d.membershipPeriodEndAt ? (
                                  <span className="text-[12px] text-muted-foreground">
                                    {' '}· 周期 {fmtTime(d.membershipPeriodStartAt)} 至{' '}
                                    {fmtTime(d.membershipPeriodEndAt)}
                                  </span>
                                ) : (
                                  <span className="text-[12px] text-muted-foreground"> · 历史订单无周期快照</span>
                                )}
                                {d.membershipPeriodRevokedAt ? (
                                  <span className="text-[12px] text-danger-text">
                                    {' '}· 周期已撤销（{fmtTime(d.membershipPeriodRevokedAt)}）
                                  </span>
                                ) : (
                                  <span className="text-[12px] text-success-text"> · 周期有效</span>
                                )}
                              </>
                            ) : (
                              <span className="text-[12px] text-danger-text"> · 权益尚未发放</span>
                            )}
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </DetailSection>

          {d.items.length > 0 && (
            <DetailSection title="商品明细" note="下单时的快照，不随后续改价变化">
              <ul className="divide-y divide-border rounded-lg border border-border">
                {d.items.map((it) => (
                  <RecordRow
                    key={it.id}
                    head={
                      <>
                        {it.nameSnapshot}{' '}
                        <code className="font-mono text-[12px] text-muted-foreground">
                          {it.skuSnapshot}
                        </code>
                      </>
                    }
                    meta={
                      <span className="tabular-nums">
                        ¥ {yuan(it.priceCentsSnapshot)} × {it.quantity} · +{it.creditsSnapshot}{' '}
                        积分
                      </span>
                    }
                  />
                ))}
              </ul>
            </DetailSection>
          )}

          <DetailSection title="支付流水" note="渠道回调的原始记录">
            {d.payments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                尚无支付记录。订单未支付，或渠道回调尚未到达。
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {d.payments.map((p) => (
                  <RecordRow
                    key={p.id}
                    state={p.status === 'succeeded' ? 'done' : 'pending'}
                    head={
                      <>
                        {CHANNEL_LABELS[p.channel] ?? p.channel} · ¥ {yuan(p.amountCents)}
                        {/*
                         * 状态必须有文字：圆点颜色是唯一的编码时，读屏用户
                         * 和色弱用户都拿不到「这笔到底成没成」。
                         */}
                        <span
                          className={
                            p.status === 'succeeded'
                              ? 'text-[12px] text-success-text'
                              : 'text-[12px] text-warn-text'
                          }
                        >
                          {' '}
                          · {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </>
                    }
                    meta={
                      <>
                        <code className="font-mono">{p.payTransactionId}</code>
                        {p.sandboxScenario ? ` · 沙箱/${p.sandboxScenario}` : ''}
                        {p.message ? ` · ${p.message}` : ''} ·{' '}
                        {fmtTime(p.createdAt)}
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </DetailSection>

          {d.refunds.length > 0 && (
            <DetailSection title="退款记录">
              {/*
               * 有退款卡在渠道侧时必须显式提示：订单此时仍是「已支付」，
               * 运营容易以为退款没生效而重复发起。结论要由渠道商户后台给出，
               * 这里不替渠道判定。
               */}
              {d.refunds.some((r) => r.status === 'processing') && (
                <p className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] leading-5 text-foreground">
                  有退款仍在<b>渠道处理中</b>：订单状态与积分尚未变化。请先到渠道商户后台核对最终结果，
                  再在下方选择「确认渠道已退款」或「确认退款失败」。
                </p>
              )}
              <ul className="divide-y divide-border rounded-lg border border-border">
                {d.refunds.map((r) => (
                  <RecordRow
                    key={r.id}
                    state={r.status === 'succeeded' ? 'done' : 'pending'}
                    head={
                      <>
                        ¥ {yuan(r.amountCents)}
                        {/* 失败/处理中的退款行必须显示状态: 它们没有动过订单与积分 */}
                        {r.status !== 'succeeded' && (
                          <span className="text-[12px] text-warn-text">
                            {' '}
                            · {REFUND_STATUS_LABELS[r.status] ?? r.status}
                          </span>
                        )}
                      </>
                    }
                    meta={
                      <>
                        {r.reason} · {fmtTime(r.createdAt)}
                        {r.providerRefundId ? (
                          <>
                            {' '}· 渠道退款号 <code className="font-mono">{r.providerRefundId}</code>
                          </>
                        ) : null}
                        {r.status === 'succeeded' ? (
                          <>
                            {' '}· 回收积分 {r.creditsReclaimed}
                            {r.creditsUnreclaimable > 0
                              ? `，另有 ${r.creditsUnreclaimable} 已消耗无法回收`
                              : ''}
                            {r.creditsExpired > 0
                              ? `，另有 ${r.creditsExpired} 已过期作废`
                              : ''}
                          </>
                        ) : null}
                      </>
                    }
                    action={
                      r.status === 'processing' && canRefund ? (
                        <div className="flex items-center gap-1">
                          <ActionButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onConfirmRefund(d.id, r, 'succeeded')}
                          >
                            确认渠道已退款
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onConfirmRefund(d.id, r, 'failed')}
                          >
                            确认退款失败
                          </ActionButton>
                        </div>
                      ) : undefined
                    }
                  />
                ))}
              </ul>
            </DetailSection>
          )}
        </div>
      )}
    </AdminDrawer>
  );
}
