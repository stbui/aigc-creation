import { useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  AdminDrawer,
  Descriptions,
  DetailSection,
  StatusTag,
} from './components';
import { adminOrdersApi } from './api';
import { CHANNEL_LABELS, REFUND_STATUS_LABELS, STATUS_LABEL_OVERRIDE } from './constants';
import {
  adminCreditHref,
  adminTasksHref,
  adminUserDetailHref,
  cn,
  yuan,
} from './utils';
import type { AdminOrderDetail, AdminOrderRow } from '../../../types/api';

/** 详情抽屉里的一条时间线记录：状态点 + 主行 + 灰色补充行 */
function RecordRow({
  head,
  meta,
  state = 'done',
}: {
  head: ReactNode;
  meta: ReactNode;
  /** 未成功的流水/退款用灰点：既保留时间线，又不假装它已经成立 */
  state?: 'done' | 'pending';
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
    </li>
  );
}

/**
 * 订单详情抽屉。
 *
 * 从页面拆出：详情的数据获取与退款/核销入口和列表筛选是两套生命周期；
 * 动作仍回到页面统一走确认条，避免同一笔订单出现两个确认入口。
 */
export function OrderDetailDrawer({
  detailId,
  rows,
  canMarkPaid,
  canRefund,
  onClose,
  onAction,
}: {
  detailId: string | null;
  rows: AdminOrderRow[];
  canMarkPaid: boolean;
  canRefund: boolean;
  onClose: () => void;
  onAction: (kind: 'markPaid' | 'refund', row: AdminOrderRow) => void;
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
        const row = rows.find((o) => o.id === d.id);
        if (!row) return null;
        const markPaid =
          canMarkPaid && d.status === 'pending';
        const refund =
          canRefund &&
          (d.status === 'paid' || d.status === 'partial_refunded') &&
          d.paidCents > d.refundedCents;
        // 无可执行动作时不渲染空页脚，避免详情底部留下无意义的空白操作条
        if (!markPaid && !refund) return null;
        return (
          <>
            {markPaid && (
              <ActionButton variant="default" size="sm" onClick={() => onAction('markPaid', row)}>
                标记为已支付
              </ActionButton>
            )}
            {refund && (
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
                { label: '下单时间', value: new Date(d.createdAt).toLocaleString('zh-CN') },
                {
                  label: '支付时间',
                  value: d.paidAt ? new Date(d.paidAt).toLocaleString('zh-CN') : '未支付',
                },
                { label: '支付时限', value: new Date(d.expiresAt).toLocaleString('zh-CN') },
                ...(d.membershipPlan
                  ? [
                      {
                        label: '会员套餐',
                        value: (
                          <>
                            {d.membershipPlan.name}（{d.membershipPlan.durationDays} 天 · 每月{' '}
                            {d.membershipPlan.monthlyCredits} 积分）
                            {d.membershipAppliedAt ? (
                              <span className="text-[12px] text-muted-foreground"> · 权益已发放</span>
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
                      </>
                    }
                    meta={
                      <>
                        <code className="font-mono">{p.payTransactionId}</code>
                        {p.sandboxScenario ? ` · 沙箱/${p.sandboxScenario}` : ''}
                        {p.message ? ` · ${p.message}` : ''} ·{' '}
                        {new Date(p.createdAt).toLocaleString('zh-CN')}
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </DetailSection>

          {d.refunds.length > 0 && (
            <DetailSection title="退款记录">
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
                        {r.reason} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </>
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
