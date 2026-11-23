import { CheckCircle2, MessageSquare, User } from 'lucide-react';
import type { Ticket } from '../../types/api';
import { formatDateTime } from './utils';
import { Button, CharacterCountTextarea } from './components';

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
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-l-[3px] border-border border-l-border bg-card px-4 py-3.5 max-[640px]:px-3.5 max-[640px]:py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground">
              <span className="grid size-[22px] place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                <User size={12} aria-hidden />
              </span>
              我
            </span>
            <span className="flex-none text-xs text-muted-foreground tabular-nums">
              {formatDateTime(detail.createdAt)}
            </span>
          </div>
          <div className="text-sm leading-[1.75] whitespace-pre-wrap text-muted-foreground [word-break:break-word]">
            {detail.content}
          </div>
        </div>
        {(detail.replies ?? []).map((r) => {
          const isAdmin = r.authorType === 'admin';
          return (
            <div
              key={r.id}
              className={`rounded-lg border border-l-[3px] px-4 py-3.5 max-[640px]:px-3.5 max-[640px]:py-3 ${
                isAdmin
                  ? 'border-border border-l-brand bg-brand-bg'
                  : 'border-border border-l-border bg-card'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <span
                    className={`grid size-[22px] place-items-center rounded-full text-xs font-semibold ${
                      isAdmin
                        ? 'bg-brand text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isAdmin ? '服' : <User size={12} aria-hidden />}
                  </span>
                  {isAdmin ? '货觉客服' : '我'}
                </span>
                <span className="flex-none text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(r.createdAt)}
                </span>
              </div>
              <div className="text-sm leading-[1.75] whitespace-pre-wrap text-muted-foreground [word-break:break-word]">
                {r.content}
              </div>
            </div>
          );
        })}
      </div>

      {detail.status === 'closed' ? (
        <p className="mt-4 mb-0 flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted px-4 py-3.5 text-[13px] text-muted-foreground">
          <CheckCircle2 size={15} aria-hidden />
          该工单已关闭，如需继续沟通请新建工单。
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-5 max-[640px]:p-4">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h3 className="m-0 flex items-center gap-1.5 text-sm font-semibold text-foreground [&_svg]:text-brand">
              <MessageSquare size={15} aria-hidden /> 继续沟通
            </h3>
            <span className="text-xs text-muted-foreground">客服回复会同时推送站内消息</span>
          </div>
          <CharacterCountTextarea
            rows={4}
            maxLength={2000}
            value={reply}
            disabled={busy}
            onChange={(e) => onReplyChange(e.target.value)}
            placeholder="补充说明或继续追问…"
          />
          <div className="flex flex-wrap justify-between gap-2">
            <Button disabled={busy} onClick={onCloseTicket}>
              问题已解决，关闭工单
            </Button>
            <Button variant="default" disabled={busy || !reply.trim()} onClick={onSendReply}>
              {busy && <span className="state-spinner is-small" aria-hidden />}
              发送
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
