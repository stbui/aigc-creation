import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Avatar, Button, Input, Modal, Tag, message } from 'antd';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  CheckCheck,
  Download,
  Gem,
  Gift,
  KeyRound,
  LifeBuoy,
  Receipt,
  ShieldAlert,
  UserRound,
  Wallet,
} from 'lucide-react';
import { creditsApi, membershipApi, meApi, notificationsApi, ordersApi, ticketsApi } from '../lib/api';
import { StateSkeleton } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import type {
  CreditBalance,
  DeletionPreview,
  MyMembership,
  MyProfile,
  NotificationItem,
  Order,
  OrderStatus,
} from '../types/api';

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

/** 分 → 「¥39.00」；金额一律由后端下发整数分，前端只做展示格式化 */
function fmtYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 日期（不含时分） */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 日期 + 时分；消息列表用短格式 */
function fmtDateTime(iso: string | null | undefined, short = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    ...(short ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 账户中心（B4，2026-10-21 扩充为「个人主页」）。
 *
 * 分区按「用户来这儿要办的事」排列，而不是按接口分：
 *   概览 → 资料 → 积分与会员 → 我的数据 → 最近消息 → 安全 → 导出 → 注销。
 *
 * 关键约束：
 * · 邮箱**不可改**（登录标识 + 已用于订单与发票），手机号要走短信验证，
 *   所以这里只提供昵称编辑，其余展示为只读并说明原因；
 * · 改密成功后后端会让该账号全部 token 失效（含当前这把），前端必须主动登出
 *   并跳登录页，否则用户会看到一连串静默 401；
 * · 注销要先拉 `deletion-preview` 把影响面摊开给用户看，再要求密码 + 确认词；
 * · 积分 / 会员 / 消息 / 工单四个附加接口用 `allSettled` **互不阻断** ——
 *   积分接口抖一下不该让整页变成错误态，资料卡照常可用。
 */
export function AccountPage() {
  const navigate = useNavigate();
  const { token, logout, openLogin } = useAuth();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [messages, setMessages] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [ticketTotal, setTicketTotal] = useState<number | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [name, setName] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);

  const [exporting, setExporting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [p, c, m, n, t, o] = await Promise.allSettled([
        meApi.profile(),
        creditsApi.balance(),
        membershipApi.me(),
        notificationsApi.list({ limit: 5 }),
        ticketsApi.list({ limit: 1 }),
        ordersApi.list(),
      ]);
      if (p.status === 'fulfilled') {
        setProfile(p.value);
        setName(p.value.name ?? '');
      } else {
        message.error(p.reason instanceof Error ? p.reason.message : '加载账号信息失败');
      }
      // 附加信息失败保持上一次的值（或空态），不把整页打成错误态
      if (c.status === 'fulfilled') setCredits(c.value);
      if (m.status === 'fulfilled') setMembership(m.value);
      if (n.status === 'fulfilled') {
        setMessages(n.value.items);
        setUnread(n.value.unread);
      }
      if (t.status === 'fulfilled') setTicketTotal(t.value.total);
      // 只展示最近三笔；后端已按创建时间倒序返回
      if (o.status === 'fulfilled') setRecentOrders(o.value.slice(0, 3));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 取消自动续费：已付周期保留，到期后不再发放下一周期权益。 */
  const cancelMembership = () => {
    Modal.confirm({
      title: '取消会员自动续费？',
      content: `取消后不再自动续费。当前周期权益保留至 ${
        membership?.expiresAt ? fmtDate(membership.expiresAt) : '到期日'
      }，期间仍可正常使用会员权益；需要时可随时续费。`,
      okText: '取消自动续费',
      cancelText: '继续续费',
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancelling(true);
        try {
          const res = await membershipApi.cancel();
          message.success(`已取消自动续费，权益保留至 ${fmtDate(res.expiresAt)}`);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '取消续费失败');
          throw e;
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  if (!token) {
    return (
      <div className="account-page">
        <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> 返回
        </button>
        <Alert
          type="info"
          showIcon
          message="请先登录"
          description="账户设置需要登录后才能查看。"
          action={
            <Button size="small" type="primary" onClick={openLogin}>
              去登录
            </Button>
          }
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="account-page">
        <StateSkeleton />
      </div>
    );
  }

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning('昵称不能为空');
      return;
    }
    if (trimmed === profile?.name) return;
    setSavingName(true);
    try {
      const updated = await meApi.update({ name: trimmed });
      setProfile((p) => (p ? { ...p, name: updated.name } : p));
      message.success('昵称已更新');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      message.warning('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      message.warning('两次输入的新密码不一致');
      return;
    }
    setChanging(true);
    try {
      await meApi.changePassword(oldPassword, newPassword);
      message.success('密码已修改，请重新登录');
      // 后端已把 tokenVersion + 1，旧 token 全部失效 —— 主动登出比等 401 更干净
      logout();
      navigate('/login', { replace: true });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '修改失败');
    } finally {
      setChanging(false);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await meApi.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `huojue-account-${profile?.id ?? 'me'}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success('导出已开始下载');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const openDelete = async () => {
    setDeleteOpen(true);
    setPreviewLoading(true);
    setDeletePassword('');
    setDeleteConfirm('');
    try {
      setPreview(await meApi.deletionPreview());
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const doDelete = async () => {
    if (deleteConfirm !== '注销') {
      message.warning('请输入确认词「注销」');
      return;
    }
    if (!deletePassword) {
      message.warning('请输入当前密码');
      return;
    }
    setDeleting(true);
    try {
      await meApi.deleteAccount(deletePassword, deleteConfirm);
      message.success('账号已注销');
      logout();
      navigate('/', { replace: true });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '注销失败');
    } finally {
      setDeleting(false);
    }
  };

  /** 点消息条目：先标已读再按 link 跳转（与顶导铃铛同构，避免"读了没标"） */
  const openMessage = async (n: NotificationItem) => {
    if (!n.readAt) {
      try {
        const res = await notificationsApi.read(n.id);
        setUnread(res.unread);
        setMessages((prev) =>
          prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it)),
        );
      } catch {
        /* 已读失败仍允许跳转，用户要看的是内容 */
      }
    }
    if (n.link) navigate(n.link);
  };

  const markAllRead = async () => {
    try {
      const res = await notificationsApi.readAll();
      setUnread(res.unread);
      setMessages((prev) => prev.map((it) => ({ ...it, readAt: it.readAt ?? new Date().toISOString() })));
      message.success('已全部标为已读');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const counts = profile?.counts;
  const STATS: Array<{ label: string; value: number | null; to: string }> = [
    { label: '项目', value: counts?.projects ?? null, to: '/library' },
    { label: '作品', value: counts?.tasks ?? null, to: '/works' },
    { label: '素材', value: counts?.assets ?? null, to: '/library' },
    { label: '订单', value: counts?.orders ?? null, to: '/orders' },
    { label: '工单', value: ticketTotal, to: '/tickets' },
  ];

  const avatarChar = (profile?.name || profile?.email || 'U').charAt(0).toUpperCase();

  return (
    <div className="account-page">
      <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} /> 返回
      </button>

      {/* ── 概览 ───────────────────────────────────────────────── */}
      <section className="account-card account-hero">
        <div className="account-hero-main">
          <Avatar size={56} className="account-avatar">
            {avatarChar}
          </Avatar>
          <div className="account-hero-info">
            <div className="account-hero-name">
              {profile?.name || '未设置昵称'}
              <Tag color={profile?.status === 'active' ? 'green' : 'default'} className="account-status">
                {profile?.status === 'active' ? '正常' : profile?.status || '—'}
              </Tag>
              {unread > 0 && <Tag color="blue">{unread} 条未读消息</Tag>}
            </div>
            <div className="account-hero-email">{profile?.email}</div>
            <div className="account-hero-meta">
              <span>注册于 {fmtDate(profile?.createdAt)}</span>
              <span>上次登录 {fmtDateTime(profile?.lastLoginAt)}</span>
              <span>{profile?.phone ? `手机 ${profile.phone}` : '未绑定手机'}</span>
            </div>
          </div>
        </div>
        <div className="account-quick">
          <Button icon={<Wallet size={14} />} onClick={() => navigate('/credits')}>
            积分明细
          </Button>
          <Button icon={<Gem size={14} />} onClick={() => navigate('/packages')}>
            购买套餐
          </Button>
          <Button icon={<LifeBuoy size={14} />} onClick={() => navigate('/tickets')}>
            我的工单
          </Button>
          {/* 邀请 / 签到此前只有顶导一个入口, 个人主页是用户找「还能做什么」的地方 */}
          <Button icon={<Gift size={14} />} onClick={() => navigate('/invitations')}>
            邀请有礼
          </Button>
        </div>
      </section>

      {/* ── 资料 ───────────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <UserRound size={16} />
          <h2>基本资料</h2>
        </header>
        <div className="account-field">
          <label>邮箱</label>
          <div className="account-value">
            {profile?.email}
            <span className="account-hint">登录标识，已用于订单与发票，暂不支持修改</span>
          </div>
        </div>
        <div className="account-field">
          <label>昵称</label>
          <div className="account-value">
            <Input
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              onPressEnter={() => void saveName()}
              style={{ maxWidth: 280 }}
            />
            <Button size="small" type="primary" loading={savingName} onClick={() => void saveName()}>
              保存
            </Button>
          </div>
        </div>
        <div className="account-field">
          <label>手机号</label>
          <div className="account-value">
            {profile?.phone ?? '未绑定'}
            <span className="account-hint">绑定与更换需短信验证，请前往登录页使用短信登录后绑定</span>
          </div>
        </div>
      </section>

      {/* ── 积分与会员 ─────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <Wallet size={16} />
          <h2>积分与会员</h2>
          <Button
            type="link"
            size="small"
            className="account-card-more"
            onClick={() => navigate('/credits')}
          >
            查看明细
          </Button>
        </header>
        <div className="account-assets">
          <div className="account-asset">
            <span>可用积分</span>
            <b>{credits ? credits.balance.toLocaleString('zh-CN') : '—'}</b>
            <small>
              {credits
                ? credits.expiringSoon > 0
                  ? `${credits.expiringSoon} 积分将在 30 天内到期（最近 ${fmtDate(credits.nearestExpiry)}）`
                  : '暂无即将到期的积分'
                : '积分余额加载失败，可前往积分明细页查看'}
            </small>
            <Button size="small" onClick={() => navigate('/packages')}>
              购买积分
            </Button>
          </div>
          <div className="account-asset">
            <span>会员状态</span>
            <b>{membership?.isMember ? membership.planName : '普通用户'}</b>
            <small>
              {membership?.isMember
                ? `有效期至 ${fmtDate(membership.expiresAt)} · 每月赠送 ${membership.monthlyCredits} 积分`
                : '开通会员享专属折扣与每月赠送积分'}
            </small>
            <div className="account-membership-actions">
              <Button
                size="small"
                type={membership?.isMember ? 'default' : 'primary'}
                onClick={() => navigate('/packages')}
              >
                {membership?.isMember ? '续费会员' : '开通会员'}
              </Button>
              {membership?.isMember && !membership.cancelAtPeriodEnd && (
                <Button size="small" type="text" danger loading={cancelling} onClick={cancelMembership}>
                  取消续费
                </Button>
              )}
            </div>
            {membership?.isMember && membership.cancelAtPeriodEnd && (
              <span className="account-hint">已取消自动续费，权益保留至 {fmtDate(membership.expiresAt)}</span>
            )}
          </div>
        </div>
      </section>

      {/* ── 我的数据 ───────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <BarChart3 size={16} />
          <h2>我的数据</h2>
        </header>
        <div className="account-stats">
          {STATS.map((s) => (
            <button key={s.label} type="button" className="account-stat" onClick={() => navigate(s.to)}>
              <span>{s.label}</span>
              <b>{s.value ?? '—'}</b>
            </button>
          ))}
        </div>
      </section>

      {/* ── 最近订单 ───────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <Receipt size={16} />
          <h2>最近订单</h2>
          <Button
            type="link"
            size="small"
            className="account-card-more"
            onClick={() => navigate('/orders')}
          >
            全部订单
          </Button>
        </header>
        {recentOrders.length === 0 ? (
          <p className="account-empty">
            暂无订单。
            <Button type="link" size="small" onClick={() => navigate('/packages')}>
              去购买积分或会员
            </Button>
          </p>
        ) : (
          <ul className="account-order-list">
            {recentOrders.map((o) => (
              <li key={o.id}>
                <button type="button" className="account-order" onClick={() => navigate('/orders')}>
                  <span className="account-order-main">
                    <span className="account-order-title">
                      {o.membershipPlanName || o.items.map((it) => it.name).join('、') || o.orderNo}
                    </span>
                    <span className="account-order-meta">
                      {o.orderNo} · {fmtDateTime(o.createdAt, true)}
                    </span>
                  </span>
                  <span className="account-order-amount">{fmtYuan(o.paidCents)}</span>
                  <span className={`account-order-status is-${o.status}`}>
                    {ORDER_STATUS_LABEL[o.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 最近消息 ───────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <Bell size={16} />
          <h2>最近消息</h2>
          <Button
            type="link"
            size="small"
            className="account-card-more"
            icon={<CheckCheck size={13} />}
            disabled={unread === 0}
            onClick={() => void markAllRead()}
          >
            全部已读
          </Button>
        </header>
        {messages.length === 0 ? (
          <p className="account-empty">暂无消息。支付、任务失败退款与工单回复会在这里通知你。</p>
        ) : (
          <ul className="account-msg-list">
            {messages.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`account-msg${n.readAt ? '' : ' is-unread'}`}
                  onClick={() => void openMessage(n)}
                >
                  <span className="account-msg-dot" aria-hidden />
                  <span className="account-msg-main">
                    <span className="account-msg-title">{n.title}</span>
                    {n.body && (
                      <span className="account-msg-body" title={n.body}>
                        {n.body}
                      </span>
                    )}
                  </span>
                  <span className="account-msg-time">{fmtDateTime(n.createdAt, true)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 安全 ───────────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <KeyRound size={16} />
          <h2>修改密码</h2>
        </header>
        <p className="account-desc">修改成功后，该账号在所有设备上的登录状态都会失效，需要重新登录。</p>
        <div className="account-form">
          <Input.Password
            placeholder="当前密码"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
          />
          <Input.Password
            placeholder="新密码（至少 6 位）"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <Input.Password
            placeholder="再次输入新密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          <Button
            type="primary"
            loading={changing}
            onClick={() => void changePassword()}
            disabled={!oldPassword || !newPassword}
          >
            修改密码
          </Button>
        </div>
      </section>

      {/* ── 导出 ───────────────────────────────────────────────── */}
      <section className="account-card">
        <header className="account-card-head">
          <Download size={16} />
          <h2>个人数据导出</h2>
        </header>
        <p className="account-desc">
          导出账号资料、项目、素材元信息、生成记录、订单、积分流水与消息（JSON）。导出不含密码哈希等内部字段；素材文件本体请到素材库单独下载。
        </p>
        <Button loading={exporting} onClick={() => void exportData()}>
          导出我的数据
        </Button>
      </section>

      {/* ── 注销 ───────────────────────────────────────────────── */}
      <section className="account-card is-danger">
        <header className="account-card-head">
          <ShieldAlert size={16} />
          <h2>注销账号</h2>
        </header>
        <p className="account-desc">
          注销后账号不可恢复：作品、素材与积分将被清除，生效中的会员权益同时终止且不退款。依据会计与消费者权益相关法规，订单、支付与积分流水会以匿名化形式保留。
        </p>
        <Button danger onClick={() => void openDelete()}>
          注销账号
        </Button>
      </section>

      <Modal
        open={deleteOpen}
        title="确认注销账号"
        okText="确认注销"
        okButtonProps={{
          danger: true,
          loading: deleting,
          disabled: deleteConfirm !== '注销' || !deletePassword,
        }}
        cancelText="取消"
        onOk={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
        destroyOnHidden
      >
        <div className="account-delete-body">
          <Alert
            type="warning"
            showIcon
            message="此操作不可撤销"
            description={
              previewLoading
                ? '正在统计影响面…'
                : preview
                  ? `将清除 ${preview.projects} 个项目、${preview.tasks} 个作品、${preview.assets} 个素材、${preview.notifications} 条消息；${preview.orders} 笔订单将匿名化保留。`
                  : '未能获取影响面预览，但不影响注销流程。'
            }
          />
          <Input.Password
            placeholder="当前密码"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            placeholder="请输入确认词：注销"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
