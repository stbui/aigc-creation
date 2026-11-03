import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  BadgeCheck,
  CalendarCheck,
  Clock3,
  Coins,
  Download,
  Flame,
  Gift,
  Image as ImageIcon,
  Link2,
  ListOrdered,
  ScrollText,
  UserCheck,
  Users,
} from 'lucide-react';
import { myMarketingApi } from './api';
import { Button, Modal, PersonalPage, StateEmpty, StateError, StateSkeleton } from './components';
import { notifyCreditsChanged, useApp, useAuth, useDocumentMeta } from './hooks';
import { RELATION_PAGE_SIZE, REWARD_STATUS } from './constants';
import {
  buildInvitePoster,
  formatBoundDay,
  formatForecastDay,
  formatNumber,
  posterFileName,
  qrColors,
} from './utils';
import type { CheckinStatus, MyInvites } from '../../types/api';

/**
 * 邀请有奖 + 每日签到 (M11 · admin-detailed-design.md §12.3 / §12.4)。
 *
 * 版式沿用参考站 https://ijihua.cn/invitations 的结构, **数据全部换成真实接口**:
 * 邀请码来自 `GET /marketing/invites`(惰性生成并落库), 奖励数字来自真实关系表。
 *
 * ⚠ 诚实性约束 (admin-suite-design.md §3.2):
 *   后台未配置奖励规则时 (rule.configured=false 或两项奖励都为 0), 页面必须
 *   **如实说明不发放积分**, 不得展示「立赚 200 积分」这类空头承诺。
 *   commerce-design.md 已记录过同类缺陷: 营销页上收费展示但兑现不了的承诺
 *   构成虚假宣传 —— 本页的所有数字都必须来自真实数据, 不允许占位值。
 */
export function InvitationsPage() {
  useDocumentMeta('邀请有奖 · 货觉AI', '邀请好友注册并首次付费，双方获得积分奖励。');
  const { message } = useApp();
  const { token, openLogin } = useAuth();
  const [data, setData] = useState<MyInvites | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败必须单独记录 (2026-10-20 修)。
   * 此前失败被压成 `data = null`, 与"没数据"共用同一个分支,
   * 渲染成一段静态文字 —— 用户既看不到原因, 也没有重试入口。
   */
  const [error, setError] = useState<string | null>(null);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 已加载的邀请关系条数（加载更多时作为 offset） */
  const loadedRelationsRef = useRef(0);
  // 邀请海报: 生成结果与弹窗开关。state 必须声明在早退分支之前 (Rules of Hooks)
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  /** 页头二维码: 与海报同一个邀请链接, 让用户不用点开弹窗就能扫码分享 */
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const load = useCallback(() => {
    // guest 不发请求: 邀请码与签到状态都要鉴权, 401 会被渲染成「加载失败」。
    // 不动 loading: 登录后直接进骨架屏, 不会先闪一下「加载失败」
    if (!token) {
      setData(null);
      setCheckin(null);
      loadedRelationsRef.current = 0;
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      myMarketingApi.invites({ limit: RELATION_PAGE_SIZE, offset: 0 }),
      myMarketingApi.checkinStatus(),
    ])
      .then(([inv, ci]) => {
        setData(inv);
        loadedRelationsRef.current = inv.relations.length;
        setCheckin(ci);
      })
      .catch((e: unknown) => {
        // 失败置 null → 渲染失败态, 不回落到任何占位数字
        setData(null);
        setError(e instanceof Error ? e.message : '邀请数据加载失败');
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  /** 加载更多邀请记录；metrics 用最新响应覆盖，relations 追加 */
  const loadMore = useCallback(async () => {
    if (!data || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await myMarketingApi.invites({
        limit: RELATION_PAGE_SIZE,
        offset: loadedRelationsRef.current,
      });
      setData((prev) =>
        prev
          ? {
              ...next,
              relations: [...prev.relations, ...next.relations],
            }
          : next,
      );
      loadedRelationsRef.current += next.relations.length;
    } catch (e) {
      message.error((e as Error).message || '邀请记录加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [data, loadingMore, message]);

  /*
   * 邀请链接带码: `/invitations?inv=CODE`。
   * 绑定动作放在注册**之后** —— 注册接口本身不含 inviteCode, 因为注册那一刻
   * 用户记录还不存在, 无法建立外键关系, 只能在拿到 token 后补绑定。
   * 自邀请在服务端被拒 (bindInvite 返回 bound:false), 前端不提示也不阻断。
   */
  useEffect(() => {
    // 未登录先不绑: 带 ?inv= 的访客注册/登录后 token 到位, 这个 effect 会再跑一次
    if (!token) return;
    const code = new URLSearchParams(window.location.search).get('inv');
    if (!code) return;
    let alive = true;
    myMarketingApi
      .bindInvite(code)
      .then((r) => {
        if (!alive || !r.bound) return;
        message.success('邀请关系已绑定，好友首次付费后自动发放奖励');
        // 绑上即清地址栏: 刷新不重复提交, 也不把码带进后续分享
        window.history.replaceState({}, '', '/invitations');
        load();
      })
      .catch(() => {
        /* 绑定失败不打扰用户: 码填错不该阻断注册后的正常浏览 */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const inviteUrl = data?.inviteCode
    ? `${window.location.origin}/invitations?inv=${data.inviteCode}`
    : '';

  // 二维码只在邀请链接变化时重算; 生成失败保持占位, 不影响邀请码本身可读
  useEffect(() => {
    if (!inviteUrl) {
      setQrUrl(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(inviteUrl, {
      width: 320,
      margin: 1,
      color: qrColors(),
    })
      .then((url) => {
        if (alive) setQrUrl(url);
      })
      .catch(() => {
        if (alive) setQrUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [inviteUrl]);

  const copyLink = async () => {
    if (!data?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      message.success('邀请链接已复制到剪贴板');
    } catch {
      message.info(`复制失败，请手动复制：${inviteUrl}`);
    }
  };

  /**
   * 邀请海报 (B8)。
   *
   * 用 `qrcode` 出二维码 + canvas 合成, 不引图片素材也不走后端渲染:
   * 海报是纯展示物, 服务端生成只会多一次往返和一堆字体依赖。二维码内容
   * 就是邀请链接本身, 好友扫码进站后仍走 `bindInvite` 的绑定流程。
   *
   * 文案随规则变化: 奖励关闭时不写「立赚 N 积分」—— 与页面其余部分同一
   * 条诚实性约束 (管理端没配规则就不许承诺积分)。
   */
  const openPoster = async () => {
    if (!data || !inviteUrl) return;
    setPosterBusy(true);
    try {
      const qr = await QRCode.toDataURL(inviteUrl, {
        width: 520,
        margin: 1,
        color: qrColors(),
      });
      /* 文案跟随真实规则: 邀请人奖励为 0 时写「立赚 0 积分」等于空头承诺 */
      const claim = !enabled
        ? '邀请好友一起用货觉AI'
        : rule.inviterCredits > 0
          ? `邀请好友，立赚 ${rule.inviterCredits} 积分`
          : `好友注册得 ${rule.inviteeCredits} 积分`;
      const url = await buildInvitePoster({
        qrDataUrl: qr,
        code: data.inviteCode,
        claim,
      });
      setPosterUrl(url);
      setPosterOpen(true);
    } catch {
      message.error('海报生成失败，请稍后重试');
    } finally {
      setPosterBusy(false);
    }
  };

  const downloadPoster = () => {
    if (!posterUrl || !data) return;
    const a = document.createElement('a');
    a.href = posterUrl;
    a.download = posterFileName(data.inviteCode);
    a.rel = 'noopener';
    a.click();
  };

  const doCheckin = async () => {
    if (!checkin || checkin.checkedIn || submitting) return;
    setSubmitting(true);
    try {
      const r = await myMarketingApi.checkin();
      if (r.alreadyCheckedIn) message.info('今天已经签过到了');
      else {
        message.success(`签到成功，获得 ${r.credits} 积分`);
        // 顶栏余额由 CreditsContext 持有：不发广播会一直显示签到前的数字
        notifyCreditsChanged();
      }
      load();
    } catch {
      message.error('签到失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * guest 态: 顶导对未登录用户也展示本站入口, 进来后此前会直接请求两次
   * 需鉴权的接口并把 401 渲染成「邀请数据加载失败」。
   */
  if (!token) {
    return (
      <PersonalPage title="邀请有奖" description="邀请好友注册，双方都能获得积分；每天签到也能领积分。">
        <StateEmpty
          title="登录后查看邀请与签到"
          desc="邀请链接、邀请人数与每日签到都与账号绑定；带邀请码进入的新用户注册后会自动绑定。"
          action={<Button type="primary" onClick={openLogin}>登录/注册</Button>}
        />
      </PersonalPage>
    );
  }

  /*
   * 加载态此前直接渲染 `<h2>加载中…</h2>` —— 拿标题当加载指示器,
   * 语义错位 (标题是内容结构, 不是状态提示), 且整页塌成一个 h2。
   * 改为骨架屏: 占住下方各区块的形状, 内容到达时零位移。
   */
  if (loading) {
    return (
      <PersonalPage title="邀请有奖" description="邀请好友注册，双方都能获得积分；每天签到也能领积分。">
        <StateSkeleton variant="panel" count={4} />
      </PersonalPage>
    );
  }

  // 加载失败: 如实说明, 不编造任何数字
  if (!data) {
    return (
      <PersonalPage title="邀请有奖" description="邀请好友注册，双方都能获得积分；每天签到也能领积分。">
        <StateError
          title="邀请数据加载失败"
          desc="请确认已登录，且后端服务正常运行。本页数据全部来自真实接口，加载失败时不展示任何占位数字。"
          detail={error ?? undefined}
          onRetry={load}
        />
      </PersonalPage>
    );
  }

  const { rule, metrics, enabled } = data;
  const m = metrics;

  /* 邀请人奖励为 0 时不能写「立赚 0 积分」—— 规则允许只奖励被邀请人 */
  const heroTitle = !enabled
    ? '邀请好友一起用货觉AI'
    : rule.inviterCredits > 0
      ? `邀请好友立赚 ${rule.inviterCredits} 积分`
      : '邀请好友，注册即得积分';

  const steps = [
    { title: '分享邀请链接', desc: `复制含专属邀请码的链接发送给好友：${data.inviteCode}` },
    {
      title: '好友注册',
      desc:
        rule.inviteeCredits > 0
          ? `好友通过链接注册即得 ${rule.inviteeCredits} 积分`
          : '好友通过链接注册后自动与你的账号绑定',
    },
    {
      title: '奖励自动发放',
      desc:
        !enabled || rule.inviterCredits <= 0
          ? '当前未配置邀请人奖励，分享仅记录邀请关系'
          : rule.triggerOn === 'first_pay'
            ? `好友首次付费成功后，你得 ${rule.inviterCredits} 积分`
            : `好友注册成功后，你得 ${rule.inviterCredits} 积分`,
    },
  ];

  const metricsRow = [
    { label: '累计邀请（人）', value: m.totalInvited, Icon: Users, highlight: false },
    { label: '累计收益（积分）', value: m.earnedCredits, Icon: Coins, highlight: true },
    { label: '已发放（笔）', value: m.rewardedCount, Icon: BadgeCheck, highlight: false },
    { label: '待发放（笔）', value: m.pendingCount, Icon: Clock3, highlight: false },
  ];

  return (
    <PersonalPage
      className="invite-page"
      title="邀请有奖"
      description="分享专属链接，好友完成指定动作后奖励自动到账；每天签到也能积累积分。"
    >
      <section className="invite-hero">
        <div className="invite-hero-copy">
          <h1>{heroTitle}</h1>
          <p>
            {enabled ? (
              <>
                好友通过链接注册并完成
                {rule.triggerOn === 'first_pay' ? '首次付费' : '注册'}后，奖励自动发放到你的积分账户。
              </>
            ) : (
              '邀请奖励规则尚未配置，当前分享链接仅记录邀请关系，不发放积分。'
            )}
          </p>
          <div className="invite-hero-actions">
            <Button type="primary" icon={<Link2 size={15} />} onClick={() => void copyLink()}>
              复制邀请链接
            </Button>
            <Button
              icon={<ImageIcon size={15} />}
              loading={posterBusy}
              onClick={() => void openPoster()}
            >
              查看邀请海报
            </Button>
          </div>
        </div>
        {/* 二维码与「邀请码」并置: 电脑上看链接、面对面时直接让对方扫 */}
        <aside className="invite-hero-qr">
          {qrUrl ? (
            <img src={qrUrl} alt={`邀请二维码，邀请码 ${data.inviteCode}`} />
          ) : (
            <span className="invite-hero-qr-fallback" aria-hidden />
          )}
          <div className="invite-hero-qr-meta">
            <span>邀请码</span>
            <strong>{data.inviteCode}</strong>
          </div>
          <p>扫码注册，自动绑定邀请关系</p>
        </aside>
      </section>

      {/* 签到 (B-67): 与邀请并列 —— 两者都是积分来源, 但触发方式不同 */}
      {checkin && (
        <section className="invite-block">
          <div className="invite-block-head">
            <h2>
              <CalendarCheck size={16} aria-hidden /> 每日签到
            </h2>
            <span className="invite-block-sub">连续签到有额外加成</span>
          </div>

          <div className="invite-checkin">
            <div className="invite-checkin-stats">
              <div className="invite-checkin-stat">
                <span className="invite-metric-label">
                  <Flame size={13} aria-hidden /> 连续签到
                </span>
                <span className="invite-checkin-value">
                  {checkin.streak}
                  <em>天</em>
                </span>
              </div>
              {/* 签到关闭时不能写「今日可得 N 积分」—— 那是一个拿不到的数字 */}
              <div className="invite-checkin-stat">
                <span className="invite-metric-label">
                  <Gift size={13} aria-hidden />{' '}
                  {!checkin.rule.enabled
                    ? '签到状态'
                    : checkin.checkedIn
                      ? '今日已得'
                      : '今日可得'}
                </span>
                <span
                  className={`invite-checkin-value${checkin.rule.enabled ? '' : ' is-text'}`}
                >
                  {!checkin.rule.enabled
                    ? '未开启'
                    : checkin.checkedIn
                      ? checkin.todayCredits
                      : checkin.nextCredits}
                  {checkin.rule.enabled && <em>积分</em>}
                </span>
              </div>
            </div>
            <Button
              type="primary"
              size="large"
              className="invite-checkin-btn"
              onClick={() => void doCheckin()}
              loading={submitting}
              disabled={checkin.checkedIn || !checkin.rule.enabled}
            >
              {checkin.checkedIn
                ? `今日已签到 +${checkin.todayCredits}`
                : checkin.rule.enabled
                  ? '立即签到'
                  : '签到未开启'}
            </Button>
          </div>

          {/* 未来 7 天: 让用户看清连签到第 3/7 天各能多拿多少 */}
          {checkin.rule.enabled && checkin.forecast.length > 0 && (
            <ol className="invite-checkin-days" aria-label="未来 7 天签到可得">
              {checkin.forecast.slice(0, 7).map((f) => {
                const isToday = f.day === checkin.today;
                const isBonus = f.credits > checkin.rule.baseCredits;
                return (
                  <li
                    key={f.day}
                    className={`${isToday ? 'is-today' : ''}${isBonus ? ' is-bonus' : ''}`.trim()}
                  >
                    <span className="invite-checkin-day">
                      {isToday ? '今天' : formatForecastDay(f.day)}
                    </span>
                    <span className="invite-checkin-streak">第 {f.streak} 天</span>
                    <strong>+{f.credits}</strong>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      <section className="invite-block">
        <div className="invite-block-head">
          <h2>
            <Users size={16} aria-hidden /> 数据明细
          </h2>
          <span className="invite-block-sub">只统计已产生的邀请关系</span>
        </div>
        <div className="invite-metrics">
          {metricsRow.map((row) => (
            <div key={row.label} className="invite-metric">
              <span className="invite-metric-label">
                <row.Icon size={13} aria-hidden /> {row.label}
              </span>
              <span className={`invite-metric-value${row.highlight ? ' is-brand' : ''}`}>
                {formatNumber(row.value)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="invite-block">
        <div className="invite-block-head">
          <h2>
            <ListOrdered size={16} aria-hidden /> 邀请步骤
          </h2>
          <span className="invite-block-sub">好友完成指定动作后自动发放</span>
        </div>
        <ol className="invite-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="invite-step">
              <span className="invite-step-no">{i + 1}</span>
              <span className="invite-step-title">{s.title}</span>
              <span className="invite-step-desc">{s.desc}</span>
            </li>
          ))}
        </ol>
      </section>

      {data.metrics.totalInvited > 0 && (
        <section className="invite-block">
          <div className="invite-block-head">
            <h2>
              <UserCheck size={16} aria-hidden /> 邀请记录
            </h2>
            <span className="invite-block-sub">
              共 {data.metrics.totalInvited} 人
              {data.relations.length < data.metrics.totalInvited
                ? `（已显示 ${data.relations.length} 条）`
                : ''}
            </span>
          </div>
          <ul className="invite-relations">
            {data.relations.map((r) => {
              const status = REWARD_STATUS[r.rewardStatus] ?? REWARD_STATUS.pending;
              return (
                <li key={r.id} className="invite-relation">
                  <span className="invite-relation-name">{r.inviteeName}</span>
                  <span className="invite-relation-date">{formatBoundDay(r.boundAt)}</span>
                  <span className={`invite-relation-status ${status.className}`}>
                    {status.label}
                  </span>
                </li>
              );
            })}
          </ul>
          {data.relations.length < data.metrics.totalInvited && (
            <div className="invite-load-more">
              <Button loading={loadingMore} onClick={() => void loadMore()}>
                加载更多记录（已显示 {data.relations.length} / {data.metrics.totalInvited}）
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="invite-block">
        <div className="invite-block-head">
          <h2>
            <ScrollText size={16} aria-hidden /> 规则说明
          </h2>
        </div>
        <ul className="invite-rules">
          <li>
            被邀请人奖励 {rule.inviteeCredits} 积分，
            {rule.inviterCredits > 0
              ? `邀请人奖励 ${rule.inviterCredits} 积分`
              : '当前不设邀请人奖励'}
            ；触发时机为{rule.triggerOn === 'first_pay' ? '被邀请人首次付费' : '被邀请人注册'}。
          </li>
          <li>一个账号只能被一位邀请人绑定；自邀请不生效。</li>
          {/* 待发放为 0 时这条没有信息量, 不占一行 */}
          {m.pendingCount > 0 && (
            <li>
              累计收益只统计已发放的邀请。待发放的 {m.pendingCount} 笔按当前规则预估约{' '}
              {m.pendingCredits} 积分，规则调整后以实际发放为准。
            </li>
          )}
          {!rule.valid && <li>邀请奖励当前已关闭，新绑定不发放积分。</li>}
          {enabled && <li>奖励以积分形式发放，可在积分明细中查看到账流水。</li>}
        </ul>
      </section>

      <Modal
        open={posterOpen}
        onCancel={() => setPosterOpen(false)}
        footer={null}
        width={420}
        centered
        title="邀请海报"
        destroyOnHidden
      >
        {posterUrl && (
          <img src={posterUrl} alt="邀请海报" className="invite-poster-image" />
        )}
        <Button type="primary" block icon={<Download size={15} />} className="invite-poster-download" onClick={downloadPoster}>
          下载海报
        </Button>
        <p className="invite-poster-note">海报含你的专属邀请码，好友扫码注册后自动绑定邀请关系。</p>
      </Modal>
    </PersonalPage>
  );
}
