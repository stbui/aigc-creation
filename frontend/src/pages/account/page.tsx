import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

import {
  DELETE_CONFIRM_WORD,
  MIN_PASSWORD_LENGTH,
  RECENT_MESSAGES_LIMIT,
  RECENT_ORDER_LIMIT,
} from './constants';
import { PersonalPage, StateButton, StateEmpty, StateSkeleton } from './components';
import { useAuth } from './hooks';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import {
  authApi,
  creditsApi,
  membershipApi,
  meApi,
  notificationsApi,
  ordersApi,
  ticketsApi,
} from './api';
import type { OAuthProviderInfo } from './api';
import { downloadJson, exportFilenameOf, fmtDate } from './utils';
import { AccountAssetsCard } from './AccountAssetsCard';
import { AccountDeleteModal } from './AccountDeleteModal';
import { AccountIdentityCard } from './AccountIdentityCard';
import { AccountMessagesCard } from './AccountMessagesCard';
import { AccountOrdersCard } from './AccountOrdersCard';
import { AccountPasswordModal } from './AccountPasswordModal';
import { AccountSecurityCard } from './AccountSecurityCard';
import { AccountStatsCard } from './AccountStatsCard';
import { Button, useApp } from '../../ui';
import type {
  CreditBalance,
  DeletionPreview,
  MyMembership,
  MyProfile,
  NotificationItem,
  Order,
} from '../../types/api';

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
  useDocumentMeta('账户设置 · 货觉AI', '管理账号资料、安全、数据导出与注销。');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, logout, openLogin } = useAuth();
  const { message, modal } = useApp();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [messages, setMessages] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [ticketTotal, setTicketTotal] = useState<number | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [name, setName] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  /** 改密表单放在弹窗里: 它一年用一两次, 常驻占走首屏一半高度不划算 */
  const [pwdOpen, setPwdOpen] = useState(false);

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
      const [p, c, m, n, t, o, providers] = await Promise.allSettled([
        meApi.profile(),
        creditsApi.balance(),
        membershipApi.me(),
        notificationsApi.list({ limit: RECENT_MESSAGES_LIMIT }),
        ticketsApi.list({ limit: 1 }),
        ordersApi.list(),
        authApi.oauthProviders(),
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
      if (o.status === 'fulfilled') setRecentOrders(o.value.items.slice(0, RECENT_ORDER_LIMIT));
      if (providers.status === 'fulfilled') setOauthProviders(providers.value);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const linkedProvider = searchParams.get('oauthLinked');
    if (!linkedProvider) return;
    const providerName = oauthProviders.find((item) => item.id === linkedProvider)?.name ?? linkedProvider;
    message.success(`已绑定 ${providerName}`);
    navigate('/account', { replace: true });
  }, [message, navigate, oauthProviders, searchParams]);

  /** 取消自动续费：已付周期保留，到期后不再发放下一周期权益。 */
  const cancelMembership = () => {
    modal.confirm({
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
      <PersonalPage
        title="账户设置"
        description="管理你的资料、安全与数据。"
        className="account-page"
      >
        {/* 与工单 / 积分等个人页一致: 空态用居中的引导块, 而不是一条通栏提示 */}
        <StateEmpty
          title="登录后管理账户"
          desc="账户设置与你的账号绑定；登录后可以修改昵称、查看积分与会员、导出数据。"
          action={<StateButton onClick={openLogin}>登录/注册</StateButton>}
        />
      </PersonalPage>
    );
  }

  if (loading) {
    return (
      <PersonalPage title="账户设置" description="管理你的资料、安全与数据。" className="account-page">
        <StateSkeleton variant="panel" count={4} />
      </PersonalPage>
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

  /**
   * 改密。返回是否成功: 弹窗只在成功时关闭,
   * 校验失败 (密码太短 / 两次不一致) 停在原地让用户改, 而不是丢掉已填内容。
   */
  const changePassword = async (): Promise<boolean> => {
    const hasPassword = profile?.hasPassword ?? true;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      message.warning(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return false;
    }
    if (hasPassword && !oldPassword) {
      message.warning('请输入当前密码');
      return false;
    }
    if (newPassword !== confirmPassword) {
      message.warning('两次输入的新密码不一致');
      return false;
    }
    setChanging(true);
    try {
      await meApi.changePassword(hasPassword ? oldPassword : undefined, newPassword);
      message.success(hasPassword ? '密码已修改，请重新登录' : '密码已设置，请重新登录');
      setPwdOpen(false);
      // 后端已把 tokenVersion + 1，旧 token 全部失效 —— 主动登出比等 401 更干净
      logout();
      navigate('/login', { replace: true });
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : '修改失败');
      return false;
    } finally {
      setChanging(false);
    }
  };

  /** 打开改密弹窗时清空上次输入, 避免残留已失效的密码 */
  const openPassword = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwdOpen(true);
  };

  const linkOAuth = async (provider: OAuthProviderInfo) => {
    setLinkingProvider(provider.id);
    try {
      const { url } = await authApi.linkOauth(provider.id, '/account');
      window.location.assign(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '绑定失败');
      setLinkingProvider(null);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await meApi.exportData();
      downloadJson(data, exportFilenameOf(profile?.id));
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
    if (deleteConfirm !== DELETE_CONFIRM_WORD) {
      message.warning(`请输入确认词「${DELETE_CONFIRM_WORD}」`);
      return;
    }
    if ((profile?.hasPassword ?? true) && !deletePassword) {
      message.warning('请输入当前密码');
      return;
    }
    setDeleting(true);
    try {
      await meApi.deleteAccount(profile?.hasPassword ? deletePassword : undefined, deleteConfirm);
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
      // 顶栏铃铛持有独立状态，广播后立即刷新，不必等 60s 轮询
      window.dispatchEvent(new Event('notifications:changed'));
      message.success('已全部标为已读');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const counts = profile?.counts;

  /**
   * 昵称有改动才允许保存。之前按钮恒为实心紫、恒可点, 点一次只弹一句
   * 「昵称已更新」, 用户分不清是自己没改还是没存上。
   */
  const nameDirty = name.trim().length > 0 && name.trim() !== (profile?.name ?? '');

  return (
    <PersonalPage
      className="account-page"
      title="账户设置"
      description="管理资料、安全与数据；积分、订单与工单可从卡片直接进入。"
      extra={
        <Button icon={<BarChart3 size={15} />} onClick={() => navigate('/stats')}>
          创作数据
        </Button>
      }
    >
      <AccountIdentityCard
        profile={profile}
        unread={unread}
        name={name}
        nameDirty={nameDirty}
        savingName={savingName}
        onNameChange={setName}
        onSaveName={() => void saveName()}
        onNavigate={navigate}
      />

      {/* ── 积分与会员 ─────────────────────────────────────────── */}
      <AccountAssetsCard
        credits={credits}
        membership={membership}
        cancelling={cancelling}
        onCancelMembership={cancelMembership}
        onNavigate={navigate}
      />

      {/* ── 我的数据 ───────────────────────────────────────────── */}
      <AccountStatsCard counts={counts} ticketTotal={ticketTotal} onNavigate={navigate} />

      {/* ── 最近订单 / 最近消息 ───────────────────────────────── */}
      {/* 两列并排: 单列铺满 1120 时每行两侧都是空白, 上下叠起来又多滚一屏 */}
      <div className="account-split">
        <AccountOrdersCard orders={recentOrders} onNavigate={navigate} />
        <AccountMessagesCard
          messages={messages}
          unread={unread}
          onOpenMessage={(notification) => void openMessage(notification)}
          onMarkAllRead={() => void markAllRead()}
        />
      </div>

      <AccountSecurityCard
        hasPassword={profile?.hasPassword ?? true}
        oauthProviders={oauthProviders}
        linkedOAuthProviders={profile?.linkedOAuthProviders ?? []}
        linkingProvider={linkingProvider}
        exporting={exporting}
        onChangePassword={openPassword}
        onLinkOAuth={(provider) => void linkOAuth(provider)}
        onExportData={() => void exportData()}
        onDeleteAccount={() => void openDelete()}
      />

      <AccountPasswordModal
        open={pwdOpen}
        changing={changing}
        hasPassword={profile?.hasPassword ?? true}
        oldPassword={oldPassword}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        onOldPasswordChange={setOldPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onOk={() => void changePassword()}
        onCancel={() => setPwdOpen(false)}
      />

      <AccountDeleteModal
        open={deleteOpen}
        deleting={deleting}
        hasPassword={profile?.hasPassword ?? true}
        preview={preview}
        previewLoading={previewLoading}
        deletePassword={deletePassword}
        deleteConfirm={deleteConfirm}
        onPasswordChange={setDeletePassword}
        onConfirmChange={setDeleteConfirm}
        onOk={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </PersonalPage>
  );
}
