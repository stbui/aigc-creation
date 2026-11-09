import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Send, Share2, UserCheck } from 'lucide-react';
import {
  ActionButton,
  Descriptions,
  DetailSection,
  Drawer,
  EmptyState,
  ListError,
  SelectField,
  SkeletonBody,
  StatusTag,
  SwitchField,
  TextAreaField,
} from '~/admin-ui/primitives';
import {
  PRIORITY_OPTIONS,
  STATUS_LABELS,
  STATUS_TONE,
  TRANSITIONS,
  TYPE_LABELS,
} from './constants';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderDetailHref,
  adminOrderHref,
  adminUserDetailHref,
  cn,
  transitionLabel,
} from './utils';
import { TICKET_REPLY_TEMPLATES, fillTicketTemplate } from './reply-templates';
import { buildAdminContextLink } from '../../../lib/admin-context-link';
import type { AdminTicketAssignee, AdminTicketDetail, TicketStatus } from '../../../types/api';

/** 对话气泡：客户在左、客服在右，避免一长串同色消息分不清谁说的 */
function Message({
  author,
  at,
  body,
  fromAdmin = false,
  internal = false,
}: {
  author: string;
  at: string;
  body: string;
  fromAdmin?: boolean;
  internal?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        internal
          ? 'ml-10 border-warn-soft bg-warn-soft/30'
          : fromAdmin
            ? 'ml-10 border-brand/20 bg-accent'
            : 'border-border bg-card',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{author}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{at}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * 工单详情抽屉。
 *
 * 为什么用抽屉而不是独立页：客服的动线是「扫列表 → 处理 → 回列表继续」，
 * 独立详情页每次都要返回并重新定位列表位置。关闭时的未发送回复确认由页面
 * 的 `useDiscardConfirm` 提供，抽屉只负责展示与触发。
 */
export function TicketDetailDrawer({
  open,
  detail,
  loading,
  error,
  reply,
  busy,
  canHandle,
  canRefund,
  replyDirty,
  assignees,
  hasPrev,
  hasNext,
  onClose,
  onRetry,
  onReplyChange,
  onSendReply,
  onChangeStatus,
  onChangePriority,
  onAssign,
  onAssignSelf,
  onUnassign,
  onOpenTransfer,
  onPrev,
  onNext,
}: {
  open: boolean;
  detail: AdminTicketDetail | null;
  loading: boolean;
  error: string | null;
  reply: string;
  busy: boolean;
  canHandle: boolean;
  canRefund: boolean;
  replyDirty: boolean;
  assignees: AdminTicketAssignee[];
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onRetry: () => void;
  onReplyChange: (value: string) => void;
  onSendReply: (visibility: 'public' | 'internal') => void;
  onChangeStatus: (to: TicketStatus) => void;
  onChangePriority: (priority: string) => void;
  onAssign: (assigneeId: string) => void;
  onAssignSelf: () => void;
  onUnassign: () => void;
  onOpenTransfer: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [internal, setInternal] = useState(false);
  // 切到下一条工单时回到「回复用户」，不把上一条的内部备注模式带过去
  useEffect(() => {
    setInternal(false);
  }, [detail?.id]);
  const location = useLocation();
  const nextStatuses = detail
    ? (TRANSITIONS[detail.status as TicketStatus] ?? [])
    : [];
  const refundHref =
    detail?.related.order && canRefund
      ? buildAdminContextLink({
          path: '/admin/orders',
          id: detail.related.order.id,
          intent: 'refund',
          from: `ticket:${detail.id}`,
          returnTo: `${location.pathname}${location.search}`,
        })
      : null;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title={detail ? `${detail.subject} · ${detail.ticketNo}` : '工单详情'}
      description={replyDirty ? '有未发送的回复' : undefined}
    >
      {loading ? (
        /* 抽屉外壳已经是实的，只替内容行 */
        <SkeletonBody rows={4} />
      ) : error ? (
        <ListError error={error} onRetry={onRetry} />
      ) : detail ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <ActionButton
              variant="ghost"
              size="sm"
              icon={ChevronLeft}
              disabled={!hasPrev || busy}
              onClick={onPrev}
            >
              上一条
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              icon={ChevronRight}
              disabled={!hasNext || busy}
              onClick={onNext}
            >
              下一条
            </ActionButton>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <span className="text-xs text-muted-foreground">指派给</span>
            <SelectField
              className="w-48"
              ariaLabel="指派处理人"
              placeholder="未指派"
              allowClear
              clearLabel="未指派"
              value={detail.assigneeId ?? undefined}
              disabled={!canHandle || busy}
              onChange={(value) => {
                if (value) onAssign(value);
                else onUnassign();
              }}
              options={assignees.map((assignee) => ({
                value: assignee.id,
                label: `${assignee.name}（${assignee.role}）`,
              }))}
            />
            {!detail.assigneeId && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={UserCheck}
                disabled={!canHandle || busy}
                onClick={onAssignSelf}
              >
                认领给我
              </ActionButton>
            )}
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Share2}
              className="ml-auto"
              disabled={!canHandle || busy}
              onClick={onOpenTransfer}
            >
              转交
            </ActionButton>
          </div>

          <Descriptions
            columns={2}
            items={[
              {
                label: '状态',
                value: (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusTag
                      status={detail.status}
                      label={STATUS_LABELS[detail.status as TicketStatus]}
                      tone={STATUS_TONE[detail.status as TicketStatus]}
                    />
                    <span className="text-[12px] text-muted-foreground">
                      {detail.assigneeId ? '已指派' : '未指派'}
                    </span>
                  </span>
                ),
              },
              {
                label: '优先级',
                value: (
                  <SelectField
                    className="w-24"
                    ariaLabel="优先级"
                    value={detail.priority}
                    disabled={!canHandle || busy}
                    onChange={(value) => {
                      if (value) onChangePriority(value);
                    }}
                    options={PRIORITY_OPTIONS}
                  />
                ),
              },
              {
                label: '提交人',
                value: (
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {detail.user.name || '—'} ·{' '}
                      <Link
                        className="text-brand hover:underline"
                        to={adminUserDetailHref(detail.user.id)}
                      >
                        {detail.user.email}
                      </Link>
                    </span>
                    <span className="flex gap-3 text-[12px]">
                      <Link
                        className="text-brand hover:underline"
                        to={adminCreditHref({
                          userId: detail.user.id,
                          email: detail.user.email,
                        })}
                      >
                        积分账本
                      </Link>
                      <Link
                        className="text-brand hover:underline"
                        to={adminOrderHref({ email: detail.user.email })}
                      >
                        全部订单
                      </Link>
                    </span>
                  </span>
                ),
              },
              {
                label: '类型',
                value: detail.typeLabel || TYPE_LABELS[detail.type],
              },
              {
                label: '提交时间',
                value: (
                  <span className="tabular-nums">
                    {new Date(detail.createdAt).toLocaleString('zh-CN')}
                  </span>
                ),
              },
              ...(detail.resolvedAt
                ? [
                    {
                      label: '解决时间',
                      value: (
                        <span className="tabular-nums">
                          {new Date(detail.resolvedAt).toLocaleString('zh-CN')}
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(detail.related.order
                ? [
                    {
                      label: '关联订单',
                      value: (
                        <span className="flex flex-wrap items-baseline gap-1.5">
                          <Link
                            className="text-brand hover:underline"
                            to={adminOrderDetailHref(detail.related.order.id)}
                          >
                            {detail.related.order.orderNo}
                          </Link>
                          <span className="text-[12px] text-muted-foreground">
                            {detail.related.order.status} · ¥
                            {(detail.related.order.paidCents / 100).toFixed(2)}
                          </span>
                          {refundHref && (
                            <Link
                              className="text-[12px] font-medium text-danger-text hover:underline"
                              to={refundHref}
                            >
                              去退款
                            </Link>
                          )}
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(detail.related.asset
                ? [
                    {
                      label: '关联素材',
                      value: (
                        <span className="flex flex-wrap items-baseline gap-1.5">
                          <Link
                            className="text-brand hover:underline"
                            to={adminAssetHref(detail.related.asset.id)}
                          >
                            <code className="font-mono text-xs">
                              {detail.related.asset.id}
                            </code>
                          </Link>
                          <span className="text-[12px] text-muted-foreground">
                            {detail.related.asset.width}×{detail.related.asset.height}
                          </span>
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />

          <DetailSection title="对话" note={`共 ${detail.replies.length + 1} 条消息`}>
            <div className="flex flex-col gap-2">
              <Message
                author={detail.user.name || detail.user.email}
                at={new Date(detail.createdAt).toLocaleString('zh-CN')}
                body={detail.content}
              />
              {detail.replies.map((r) => (
                <Message
                  key={r.id}
                  fromAdmin={r.authorType === 'admin'}
                  internal={r.visibility === 'internal'}
                  author={
                    r.visibility === 'internal'
                      ? `内部备注 · ${r.authorName}`
                      : r.authorType === 'admin'
                        ? `客服 · ${r.authorName}`
                        : r.authorName
                  }
                  at={new Date(r.createdAt).toLocaleString('zh-CN')}
                  body={r.content}
                />
              ))}
              {detail.replies.length === 0 && (
                <p className="text-[12px] text-muted-foreground">
                  还没有回复。在下方向用户说明处理进展。
                </p>
              )}
            </div>
          </DetailSection>

          {canHandle ? (
            <DetailSection title={internal ? '内部备注' : '回复用户'}>
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <span className="mb-1 block text-xs text-muted-foreground">回复模板</span>
                  <SelectField
                    ariaLabel="选择回复模板"
                    placeholder="选择模板后仍可修改"
                    value={undefined}
                    disabled={busy}
                    onChange={(value) => {
                      const template = TICKET_REPLY_TEMPLATES.find((item) => item.id === value);
                      if (!template) return;
                      onReplyChange(
                        fillTicketTemplate(template.content, {
                          name: detail.user.name,
                          ticketNo: detail.ticketNo,
                          orderNo: detail.related.order?.orderNo,
                        }),
                      );
                    }}
                    options={TICKET_REPLY_TEMPLATES.map((template) => ({
                      value: template.id,
                      label: template.label,
                    }))}
                  />
                </div>
                <SwitchField
                  checked={internal}
                  disabled={busy}
                  onChange={setInternal}
                  label="内部备注（不发送给用户）"
                  ariaLabel="内部备注"
                />
              </div>
              <TextAreaField
                ariaLabel={internal ? '内部备注内容' : '回复内容'}
                rows={4}
                maxLength={2000}
                showCount
                value={reply}
                disabled={busy}
                onChange={onReplyChange}
                placeholder={
                  internal
                    ? '写给同事的交接说明，例如：用户申请退款，订单已核实，请财务处理。'
                    : '说明处理结论或需要用户补充的信息。回复后用户会在站内消息里收到通知。'
                }
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ActionButton
                  variant="default"
                  icon={Send}
                  disabled={busy || !reply.trim()}
                  onClick={() => onSendReply(internal ? 'internal' : 'public')}
                >
                  {internal ? '保存内部备注' : '发送回复'}
                </ActionButton>
                <span className="text-xs text-muted-foreground">
                  {internal
                    ? '内部备注不推送、不出现在用户端。'
                    : '发送后会推送站内消息给用户，并自动认领未指派工单。'}
                </span>
              </div>
            </DetailSection>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              你没有工单处理权限（ticket.handle），当前为只读视图。
            </p>
          )}

          {canHandle && nextStatuses.length > 0 && (
            <DetailSection title="状态流转">
              <div className="flex flex-wrap items-center gap-2">
                {nextStatuses.map((to) => (
                  <ActionButton
                    key={to}
                    variant={to === 'closed' ? 'destructive' : 'secondary'}
                    disabled={busy}
                    onClick={() => onChangeStatus(to)}
                  >
                    {transitionLabel(to)}
                  </ActionButton>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                关闭后用户无法继续回复，只能新建工单；如问题仍在，可重新打开接回原上下文。
              </p>
            </DetailSection>
          )}
        </div>
      ) : (
        <EmptyState title="暂无工单详情" description="没有可展示的工单详情。" />
      )}
    </Drawer>
  );
}
