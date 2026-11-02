import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Empty, Popover, Spin } from '../ui';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notificationsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { safeInternalPath } from '../lib/safePath';
import type { NotificationItem } from '../types/api';

/**
 * 顶导消息铃铛。
 *
 * 三条取舍：
 * 1. **未登录不渲染**。没有身份就没有"我的消息"，展示一个 0 角标只会让人以为坏了。
 * 2. 打开面板时才拉列表，另有 60s 静默轮询维持角标。轮询不做 WebSocket：
 *    单机 MVP 的消息量级用不上长连接，而长连接意味着断线重连、心跳、鉴权续期
 *    一整条链路，收益与成本不成比例。
 * 3. **点击条目即已读**并跳到 link。已读与跳转绑定，避免"读了没标"或"标了没读"。
 */
export function NotificationBell() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!token) return;
      if (showSpinner) setLoading(true);
      try {
        const res = await notificationsApi.list({ limit: 20 });
        setItems(res.items);
        setUnread(res.unread);
      } catch {
        // 消息拉取失败不影响主界面：铃铛保持上一次的角标，不弹错误、
        // 不清空列表 —— 静默失败比一个红色 toast 更符合"辅助信息"的定位。
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      setItems([]);
      setUnread(0);
      return;
    }
    void load(false);
    let timer = 0;
    const startPolling = () => {
      if (timer) return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load(false);
      }, 60_000);
    };
    const stopPolling = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(false);
        startPolling();
      } else {
        stopPolling();
      }
    };
    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    /*
     * 账户页 / 其它入口标记已读后广播该事件。没有它, 铃铛只能等下一轮
     * 60s 轮询才更新, 用户会以为“全部已读”没生效。
     */
    const onChanged = () => void load(false);
    window.addEventListener('notifications:changed', onChanged);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('notifications:changed', onChanged);
    };
  }, [token, load]);

  if (!token) return null;

  const markAll = async () => {
    try {
      await notificationsApi.readAll();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      setUnread(0);
    } catch {
      /* 忽略：下次轮询会纠正 */
    }
  };

  const openItem = async (n: NotificationItem) => {
    if (!n.readAt) {
      try {
        const res = await notificationsApi.read(n.id);
        setUnread(res.unread);
        setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it)));
      } catch {
        /* 已读失败仍然允许跳转，用户要看的是内容 */
      }
    }
    setOpen(false);
    if (n.link) {
      // 服务端下发的 link 也当作不可信输入：只允许站内绝对路径，
      // 非法值直接忽略（停留在当前页），与 PromoBar 的口径一致。
      const target = safeInternalPath(n.link, '');
      if (target) navigate(target);
    }
  };

  const content = (
    <div className="app-notif-panel">
      <div className="app-notif-head">
        <span>消息通知</span>
        <Button type="link" size="small" disabled={unread === 0} onClick={markAll} icon={<CheckCheck size={13} />}>
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
              <span className="app-notif-time">{formatTime(n.createdAt)}</span>
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
        if (v) void load(true);
      }}
      placement="bottom"
      className="app-notif-popover"
    >
      <button type="button" className="app-notif-trigger" aria-label={unread ? `消息通知，${unread} 条未读` : '消息通知'}>
        <Badge count={unread} size="small" offset={[0, -2]}>
          <Bell size={18} />
        </Badge>
      </button>
    </Popover>
  );
}

/** 相对时间：24 小时内按分钟/小时，超过按日期。列表里读「3 分钟前」比读时间戳更快。 */
function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
