import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquarePlus, X } from 'lucide-react';
import type { Ticket, TicketStatus, TicketType } from '../../types/api';
import {
  EMPTY_TICKET_FORM,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TYPE_OPTIONS,
  type TicketFilterValue,
  type TicketFormState,
} from './constants';
import { ticketsApi } from './api';
import { useAuth, useDocumentMeta } from './hooks';
import { formatDateTime } from './utils';
import { Button, PersonalPage, StateButton, StateEmpty, StateError, StateSkeleton } from './components';
import { TicketCard } from './TicketCard';
import { TicketComposeForm } from './TicketComposeForm';
import { TicketFilters } from './TicketFilters';
import { TicketThread } from './TicketThread';

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
 *
 * 分层（见 `docs/frontend-module-conventions.md`）:
 * 路由级状态与写操作留在本文件，列表卡 / 筛选条 / 新建表单 / 对话线各自成组件，
 * 常量、接口、hook、纯函数分别走 `constants` / `api` / `hooks` / `utils`。
 */
export function TicketsPage() {
  useDocumentMeta('我的工单 · 货觉AI', '提交问题反馈并跟踪客服处理进度。');
  const { token, openLogin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<TicketStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 列表状态筛选; 只影响当前视图, 不改动已加载的数据 */
  const [filter, setFilter] = useState<TicketFilterValue>('all');
  /** 已加载条数（加载更多时作为 offset） */
  const loadedCountRef = useRef(0);

  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('id'));
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  /** 已发起详情请求的工单 id：写 URL 会让 effect 重跑，用它挡住第二次请求 */
  const requestedDetailIdRef = useRef<string | null>(null);

  /** 新建表单 */
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState<TicketFormState>(EMPTY_TICKET_FORM);
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
    const subject = searchParams.get('subject')?.trim();
    setForm((prev) => ({ ...prev, type, ...(subject ? { subject } : {}) }));
    setComposing(true);
    const next = new URLSearchParams(searchParams);
    next.delete('type');
    next.delete('compose');
    next.delete('subject');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async (opts?: { append?: boolean }) => {
    const append = Boolean(opts?.append);
    const offset = append ? loadedCountRef.current : 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await ticketsApi.list({ limit: 20, offset });
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      loadedCountRef.current = offset + res.items.length;
      setTotal(res.total);
      setStatusCounts(res.statusCounts ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '工单列表加载失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      loadedCountRef.current = 0;
      setTotal(0);
      setStatusCounts({});
      setLoading(false);
      return;
    }
    void load();
  }, [token, load]);

  const openDetail = useCallback(
    async (id: string) => {
      // 先标记再写 URL：openDetail 会改 searchParams 触发下面的 effect 重跑，
      // 此刻详情尚未返回、detail?.id 还是 null，只能靠这个 ref 防止重复请求。
      requestedDetailIdRef.current = id;
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
    if (!id) {
      // 关闭详情时复位，保证再次点开同一张工单仍能正常加载
      requestedDetailIdRef.current = null;
      return;
    }
    if (!token) return;
    // 详情已加载、或本轮已发起过请求，都不再发第二次。
    // openDetail 依赖 searchParams，放进依赖会在写 URL 后重复触发 —— 只按 id 变化触发
    if (detail?.id === id || requestedDetailIdRef.current === id) return;
    void openDetail(id);
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
      setForm(EMPTY_TICKET_FORM);
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

  const visibleItems = useMemo(
    () => (filter === 'all' ? items : items.filter((t) => t.status === filter)),
    [items, filter],
  );

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
        className="ticket-page"
        title={detail.subject}
        description={
          <>
            {detail.ticketNo} · {detail.typeLabel} · 优先级 {PRIORITY_LABELS[detail.priority]} · 提交于{' '}
            {formatDateTime(detail.createdAt)}
            {detail.status === 'resolved' && ' · 客服认为已解决，如仍有问题请继续回复'}
          </>
        }
        extra={<span className={`ticket-status is-${detail.status}`}>{STATUS_LABELS[detail.status]}</span>}
        /* 详情是同页二级视图: 返回要回到本页列表, 而不是浏览器的上一页 */
        onBack={closeDetail}
      >
        {detailError && <p className="ticket-error">{detailError}</p>}

        {detailLoading && <StateSkeleton variant="row" count={2} />}

        <TicketThread
          detail={detail}
          reply={reply}
          busy={busy}
          onReplyChange={setReply}
          onSendReply={() => void sendReply()}
          onCloseTicket={() => void closeTicket()}
        />
      </PersonalPage>
    );
  }

  return (
    <PersonalPage
      className="ticket-page"
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
        <TicketComposeForm
          form={form}
          formError={formError}
          submitting={submitting}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onCancel={() => setComposing(false)}
          onSubmit={() => void submit()}
        />
      )}

      {loading && <StateSkeleton variant="row" count={3} />}
      {!loading && error && (
        <StateError
          title="工单加载失败"
          desc="没能取回你的工单列表，重试一次即可。"
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
        <>
          <TicketFilters
            filter={filter}
            counts={statusCounts}
            loaded={items.length}
            onChange={setFilter}
          />

          {visibleItems.length === 0 ? (
            <p className="ticket-filter-empty">该状态下还没有工单</p>
          ) : (
            <div className="ticket-list">
              {visibleItems.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  active={activeId === t.id}
                  onOpen={() => void openDetail(t.id)}
                />
              ))}
            </div>
          )}
          {!loading && items.length > 0 && items.length < total && (
            <div className="ticket-load-more">
              <Button loading={loadingMore} onClick={() => void load({ append: true })}>
                加载更多工单（已加载 {items.length} / {total}）
              </Button>
            </div>
          )}
        </>
      )}
    </PersonalPage>
  );
}
