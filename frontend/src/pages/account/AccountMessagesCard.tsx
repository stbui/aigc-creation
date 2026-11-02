import { Bell, CheckCheck } from 'lucide-react';

import type { NotificationItem } from '../../types/api';
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
    <section className="account-card">
      <header className="account-card-head">
        <Bell size={15} aria-hidden />
        <h2>最近消息</h2>
        <Button
          type="link"
          size="small"
          className="account-card-more"
          icon={<CheckCheck size={13} />}
          disabled={unread === 0}
          onClick={onMarkAllRead}
        >
          全部已读
        </Button>
      </header>
      {messages.length === 0 ? (
        <p className="account-empty">暂无消息。支付、任务失败退款与工单回复会在这里通知你。</p>
      ) : (
        <ul className="account-msg-list">
          {messages.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`account-msg${notification.readAt ? '' : ' is-unread'}`}
                onClick={() => onOpenMessage(notification)}
              >
                <span className="account-msg-dot" aria-hidden />
                <span className="account-msg-main">
                  <span className="account-msg-title">{notification.title}</span>
                  {notification.body && (
                    <span className="account-msg-body" title={notification.body}>
                      {notification.body}
                    </span>
                  )}
                </span>
                <span className="account-msg-time">{fmtDateTime(notification.createdAt, true)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
