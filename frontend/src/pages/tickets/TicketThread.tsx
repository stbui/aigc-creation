import { CheckCircle2, MessageSquare, Send, User } from 'lucide-react';
import type { Ticket } from '../../types/api';
import { formatDateTime } from './utils';
import { Button, Input } from './components';

/**
 * 工单详情的对话线 + 回复区。
 *
 * 已关闭的工单只展示提示，不再给回复框 —— 状态机不允许在 closed 上继续追加，
 * 前端不给入口比提交后报错更清楚。
 */
export interface TicketThreadProps {
  detail: Ticket;
  reply: string;
  busy: boolean;
  onReplyChange: (value: string) => void;
  onSendReply: () => void;
  onCloseTicket: () => void;
}

export function TicketThread({
  detail,
  reply,
  busy,
  onReplyChange,
  onSendReply,
  onCloseTicket,
}: TicketThreadProps) {
  return (
    <>
      <div className="ticket-thread">
        <div className="ticket-msg is-user">
          <div className="ticket-msg-head">
            <span className="ticket-msg-author">
              <span className="ticket-msg-avatar">
                <User size={12} aria-hidden />
              </span>
              我
            </span>
            <span className="ticket-msg-time">{formatDateTime(detail.createdAt)}</span>
          </div>
          <div className="ticket-msg-body">{detail.content}</div>
        </div>
        {(detail.replies ?? []).map((r) => {
          const isAdmin = r.authorType === 'admin';
          return (
            <div key={r.id} className={`ticket-msg ${isAdmin ? 'is-admin' : 'is-user'}`}>
              <div className="ticket-msg-head">
                <span className="ticket-msg-author">
                  <span className="ticket-msg-avatar">
                    {isAdmin ? '服' : <User size={12} aria-hidden />}
                  </span>
                  {isAdmin ? '货觉客服' : '我'}
                </span>
                <span className="ticket-msg-time">{formatDateTime(r.createdAt)}</span>
              </div>
              <div className="ticket-msg-body">{r.content}</div>
            </div>
          );
        })}
      </div>

      {detail.status === 'closed' ? (
        <p className="ticket-closed-note">
          <CheckCircle2 size={15} aria-hidden />
          该工单已关闭，如需继续沟通请新建工单。
        </p>
      ) : (
        <div className="ticket-reply">
          <div className="ticket-reply-head">
            <h3>
              <MessageSquare size={15} aria-hidden /> 继续沟通
            </h3>
            <span>客服回复会同时推送站内消息</span>
          </div>
          <Input.TextArea
            rows={4}
            maxLength={2000}
            value={reply}
            disabled={busy}
            onChange={(e) => onReplyChange(e.target.value)}
            placeholder="补充说明或继续追问…"
            showCount
          />
          <div className="ticket-reply-actions">
            <Button disabled={busy} onClick={onCloseTicket}>
              问题已解决，关闭工单
            </Button>
            <Button
              type="primary"
              icon={<Send size={14} />}
              disabled={busy || !reply.trim()}
              loading={busy}
              onClick={onSendReply}
            >
              发送
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
