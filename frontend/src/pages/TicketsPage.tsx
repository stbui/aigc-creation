import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Select } from 'antd';
import { ChevronDown, MessageSquarePlus, Send, X } from 'lucide-react';
import { ticketsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PersonalPage } from '../components/PersonalPage';
import { StateButton, StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '../types/api';

/**
 * 我的工单 / 反馈。
 *
 * ## 为什么不是「联系客服」弹窗
 *
 * 工单是**有状态、有历史**的：用户提交后要能回来看到客服回复、继续追问、
 * 最后确认关闭。弹窗关掉就找不到对话, 用户只能重复提交, 客服也会重复处理。
 *
 * ## 列表 + 详情同页
 *
 * 工单量少（单个用户通常个位数）, 用列表切片切换详情比抽屉更适合移动端:
 * 桌面端与手机走同一套布局, 不必为后台抽屉那套交互再写一份移动适配。
 */

const TYPE_OPTIONS: Array<{ value: TicketType; label: string }> = [
  { value: 'bug', label: '功能异常' },
  { value: 'complaint', label: '投诉' },
  { value: 'consultation', label: '咨询' },
  { value: 'invoice', label: '发票问题' },
  { value: 'other', label: '其他' },
];

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: '低',
  normal: '中',
  high: '高',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TicketsPage() {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('id'));
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  /** 新建表单 */
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState<{
    type: TicketType;
    subject: string;
    content: string;
    priority: TicketPriority;
  }>({ type: 'consultation', subject: '', content: '', priority: 'normal' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * 从首页页脚 / 顶导的「投诉举报」「帮助中心」直达时带 `?type=...&compose=1`。
   * 打开表单并预选类型后清掉参数: 后续进入某张工单详情会写 `?id=`,
   * 若保留 type 会在每次 URL 变化时把表单重新弹出来。
   */
  useEffect(() => {
    const typeParam = searchParams.get('type');
    if (typeParam === null && searchParams.get('compose') !== '1') return;
    const type = TYPE_OPTIONS.some((o) => o.value === typeParam)
      ? (typeParam as TicketType)
      : 'consultation';
    setForm((prev) => ({ ...prev, type }));
    setComposing(true);
    const next = new URLSearchParams(searchParams);
    next.delete('type');
    next.delete('compose');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ticketsApi.list();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '工单列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void load();
  }, [token, load]);

  const openDetail = useCallback(
    async (id: string) => {
      setActiveId(id);
      // 把 id 写进 URL: 刷新后仍停在同一张工单, 也便于站内消息直接链接过来
      const next = new URLSearchParams(searchParams);
      next.set('id', id);
      setSearchParams(next, { replace: true });
      setDetailLoading(true);
      setDetailError(null);
      try {
        setDetail(await ticketsApi.detail(id));
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : '工单详情加载失败');
      } finally {
        setDetailLoading(false);
      }
    },
    [searchParams, setSearchParams],
  );

  /** 站内消息 / 外部链接带 ?id= 进来时直接展开 */
  useEffect(() => {
    const id = searchParams.get('id');
    if (!id || !token) return;
    if (detail?.id === id) return;
    void openDetail(id);
    // openDetail 依赖 searchParams, 放进依赖会在写 URL 后重复触发 —— 只按 id 变化触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, token]);

  const closeDetail = () => {
    setActiveId(null);
    setDetail(null);
    setReply('');
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    setSearchParams(next, { replace: true });
  };

  const submit = async () => {
    const subject = form.subject.trim();
    const content = form.content.trim();
    if (subject.length < 2) {
      setFormError('标题至少 2 个字，写清楚"哪一步出了什么问题"最省来回。');
      return;
    }
    if (content.length < 5) {
      setFormError('问题描述至少 5 个字');
      return;
    }
    if (!token) {
      openLogin();
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const t = await ticketsApi.create({ ...form, subject, content });
      setComposing(false);
      setForm({ type: 'consultation', subject: '', content: '', priority: 'normal' });
      await load();
      await openDetail(t.id);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async () => {
    if (!detail) return;
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    try {
      const updated = await ticketsApi.reply(detail.id, text);
      setDetail(updated);
      setReply('');
      void load();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '回复失败');
    } finally {
      setBusy(false);
    }
  };

  const closeTicket = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = await ticketsApi.close(detail.id);
      setDetail(updated);
      void load();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '关闭失败');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <PersonalPage title="我的工单" description="提交问题反馈并跟踪客服处理进度。">
        <StateEmpty
          title="登录后查看工单"
          desc="工单与你的账号绑定；登录后可以提交问题、查看客服回复并继续追问。"
          action={<StateButton onClick={openLogin}>登录/注册</StateButton>}
        />
      </PersonalPage>
    );
  }

  if (detail) {
    return (
      <PersonalPage
        className="orders-page"
        title={detail.subject}
        description={
          <>
            {detail.ticketNo} · {detail.typeLabel} · 提交于 {fmt(detail.createdAt)}
            {detail.status === 'resolved' && ' · 客服认为已解决，如仍有问题请继续回复'}
          </>
        }
        extra={<span className={`ticket-status is-${detail.status}`}>{STATUS_LABELS[detail.status]}</span>}
        showBack={false}
      >
        <button type="button" className="pkg-back-btn ticket-detail-back" onClick={closeDetail}>
          ← 返回工单列表
        </button>

        {detailError && <p className="ticket-error">{detailError}</p>}

        {detailLoading && <StateSkeleton variant="row" count={2} />}

        <div className="ticket-thread">
          <div className="ticket-msg is-user">
            <div className="ticket-msg-head">
              <span>我</span>
              <span>{fmt(detail.createdAt)}</span>
            </div>
            <div className="ticket-msg-body">{detail.content}</div>
          </div>
          {(detail.replies ?? []).map((r) => (
            <div
              key={r.id}
              className={`ticket-msg ${r.authorType === 'admin' ? 'is-admin' : 'is-user'}`}
            >
              <div className="ticket-msg-head">
                <span>{r.authorType === 'admin' ? '货觉客服' : '我'}</span>
                <span>{fmt(r.createdAt)}</span>
              </div>
              <div className="ticket-msg-body">{r.content}</div>
            </div>
          ))}
        </div>

        {detail.status === 'closed' ? (
          <p className="orders-sub">该工单已关闭，如需继续请新建工单。</p>
        ) : (
          <div className="ticket-reply">
            <Input.TextArea
              rows={4}
              maxLength={2000}
              value={reply}
              disabled={busy}
              onChange={(e) => setReply(e.target.value)}
              placeholder="补充说明或继续追问…"
              showCount
            />
            <div className="ticket-reply-actions">
              <Button
                type="primary"
                icon={<Send size={14} />}
                disabled={busy || !reply.trim()}
                loading={busy}
                onClick={() => void sendReply()}
              >
                发送
              </Button>
              <Button disabled={busy} onClick={() => void closeTicket()}>
                问题已解决，关闭工单
              </Button>
            </div>
          </div>
        )}
      </PersonalPage>
    );
  }

  return (
    <PersonalPage
      className="orders-page"
      title="我的工单"
      description="提交问题、投诉或咨询，客服回复会出现在这里，也会推送站内消息。"
      extra={
        <Button
          type="primary"
          icon={composing ? <X size={15} /> : <MessageSquarePlus size={15} />}
          onClick={() => setComposing((v) => !v)}
        >
          {composing ? '收起表单' : '提交新工单'}
        </Button>
      }
    >
      {composing && (
        <section className="ticket-compose">
          <label>
            问题类型
            <Select
              value={form.type}
              onChange={(value) => setForm({ ...form, type: value })}
              options={TYPE_OPTIONS}
            />
          </label>
          <label>
            优先级
            <Select
              value={form.priority}
              onChange={(value) => setForm({ ...form, priority: value })}
              options={(['low', 'normal', 'high'] as TicketPriority[]).map((p) => ({
                value: p,
                label: PRIORITY_LABELS[p],
              }))}
            />
          </label>
          <label className="is-full">
            标题
            <Input
              maxLength={80}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="一句话说明问题，如：生成的主图保存后是空白"
            />
          </label>
          <label className="is-full">
            详细描述
            <Input.TextArea
              rows={5}
              maxLength={2000}
              showCount
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="复现步骤、涉及的能力或订单号。信息越具体，客服越不必来回追问。"
            />
          </label>
          {formError && <p className="ticket-error is-full">{formError}</p>}
          <div className="ticket-compose-actions">
            <Button onClick={() => setComposing(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void submit()}>
              提交工单
            </Button>
          </div>
        </section>
      )}

      {loading && <StateSkeleton variant="row" count={3} />}
      {!loading && error && (
        <StateError
          title="工单加载失败"
          desc="没能取回你的工单列表，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      )}
      {!loading && !error && items.length === 0 && (
        <StateEmpty
          title="还没有工单"
          desc="遇到问题随时提交，客服回复会出现在这里，也会推送站内消息。"
          action={<StateButton onClick={() => setComposing(true)}>提交新工单</StateButton>}
        />
      )}

      {items.length > 0 && (
        <div className="ticket-list">
          {items.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ticket-card${activeId === t.id ? ' is-active' : ''}`}
              onClick={() => void openDetail(t.id)}
            >
              <span className="ticket-card-main">
                <span className="ticket-card-title">{t.subject}</span>
                <span className="ticket-card-sub">
                  {t.ticketNo} · {t.typeLabel} · {fmt(t.createdAt)}
                  {t.replyCount ? ` · ${t.replyCount} 条回复` : ''}
                </span>
              </span>
              <span className={`ticket-status is-${t.status}`}>{STATUS_LABELS[t.status]}</span>
              <ChevronDown size={14} className="ticket-card-arrow" />
            </button>
          ))}
        </div>
      )}
    </PersonalPage>
  );
}
