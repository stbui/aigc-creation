import './NotificationBell.css';
import { useState } from 'react';
import { Badge, Button, Empty, Popover, Spin } from '../ui';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatRelativeTime } from '../lib/format';
import { safeInternalPath } from '../lib/safePath';
import type { NotificationItem } from '../types/api';
import { useNotificationInbox } from './hooks';

/**
 * 顶导消息铃铛。
 *
 * 未登录不渲染；打开面板时拉取列表，60s 静默轮询维持角标；点击条目即已读并跳转。
 * 数据、轮询与已读动作由 `useNotificationInbox` 托管。
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { token, items, unread, loading, reload, markAllRead, markRead } = useNotificationInbox();

  if (!token) return null;

  const openItem = async (n: NotificationItem) => {
    if (!n.readAt) await markRead(n.id);
    setOpen(false);
    if (n.link) {
      // 服务端下发的 link 同样按不可信输入处理：只允许站内绝对路径
      const target = safeInternalPath(n.link, '');
      if (target) navigate(target);
    }
  };

  const content = (
    <div className="app-notif-panel">
      <div className="app-notif-head">
        <span>消息通知</span>
        <Button type="link" size="small" disabled={unread === 0} onClick={markAllRead} icon={<CheckCheck size={13} />}>
          全部已读
        </Button>
      </div>
      <div className="app-notif-body">
        {loading ? (
          <div className="app-notif-empty">
            <Spin size="small" />
          </div>
        ) : items.length === 0 ? (
          <Empty description="暂无消息" />
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`app-notif-item${n.readAt ? '' : ' is-unread'}`}
              onClick={() => void openItem(n)}
            >
              <span className="app-notif-title">{n.title}</span>
              {n.body && <span className="app-notif-text">{n.body}</span>}
              <span className="app-notif-time">{formatRelativeTime(n.createdAt)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void reload(true);
      }}
      placement="bottom"
      className="app-notif-popover"
    >
      <button type="button" className="app-header-action app-notif-trigger" aria-label={unread ? `消息通知，${unread} 条未读` : '消息通知'}>
        <Badge count={unread}>
          <Bell size={18} />
        </Badge>
      </button>
    </Popover>
  );
}
