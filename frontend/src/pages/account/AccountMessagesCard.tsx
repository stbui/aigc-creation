import { Bell, CheckCheck } from 'lucide-react';

import type { NotificationItem } from '../../types/api';
import { ACCOUNT_CARD, ACCOUNT_CARD_HEAD } from './constants';
import { fmtDateTime } from './utils';
import { Button } from '../../ui';

/**
 * 最近消息卡。
 *
 * 未读条目的圆点是纯视觉提示; 点击条目由页面负责「先标已读再按 link 跳转」,
 * 所以这里只上抛条目本身, 不在这里发请求。
 */
export function AccountMessagesCard({
  messages,
  unread,
  onOpenMessage,
  onMarkAllRead,
}: {
  messages: NotificationItem[];
  unread: number;
  onOpenMessage: (notification: NotificationItem) => void;
  onMarkAllRead: () => void;
}) {
  return (
    <section className={ACCOUNT_CARD}>
      <header className={ACCOUNT_CARD_HEAD}>
        <Bell size={15} aria-hidden className="flex-none text-muted-foreground" />
        <h2 className="m-0 text-sm font-semibold">最近消息</h2>
        <Button
          variant="link"
          size="sm"
          className="ml-auto p-0 text-xs"
          disabled={unread === 0}
          onClick={onMarkAllRead}
        >
          {<CheckCheck size={13} />}
          全部已读
        </Button>
      </header>
      {messages.length === 0 ? (
        <p className="m-0 px-0 pt-3 pb-0.5 text-[13px] text-muted-foreground">
          暂无消息。支付、任务失败退款与工单回复会在这里通知你。
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {messages.map((notification) => {
            const unreadItem = !notification.readAt;
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  className={`flex w-full items-start gap-2.5 rounded-md border border-[var(--border-row)] bg-card px-3 py-2.5 text-left text-inherit transition-colors hover:border-brand hover:bg-brand-bg`}
                  onClick={() => onOpenMessage(notification)}
                >
                  <span
                    className={`mt-1.5 size-1.5 flex-none rounded-full ${unreadItem ? 'bg-brand' : 'bg-transparent'}`}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={`text-[13px] ${
                        unreadItem ? 'font-semibold text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {notification.title}
                    </span>
                    {notification.body && (
                      <span
                        className="line-clamp-2 text-xs whitespace-normal text-muted-foreground"
                        title={notification.body}
                      >
                        {notification.body}
                      </span>
                    )}
                  </span>
                  <span className="flex-none pt-px text-xs text-muted-foreground">
                    {fmtDateTime(notification.createdAt, true)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
