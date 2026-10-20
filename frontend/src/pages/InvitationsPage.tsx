import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { Link2, Image as ImageIcon, Sparkles, CalendarCheck, Gift } from 'lucide-react';
import { myMarketingApi } from '../lib/api';
import { StateError, StateSkeleton } from '../components/StateViews';
import type { CheckinStatus, MyInvites } from '../types/api';

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
  const { message } = App.useApp();
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

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([myMarketingApi.invites(), myMarketingApi.checkinStatus()])
      .then(([inv, ci]) => {
        setData(inv);
        setCheckin(ci);
      })
      .catch((e: unknown) => {
        // 失败置 null → 渲染失败态, 不回落到任何占位数字
        setData(null);
        setError(e instanceof Error ? e.message : '邀请数据加载失败');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * 邀请链接带码: `/invitations?inv=CODE`。
   * 绑定动作放在注册**之后** —— 注册接口本身不含 inviteCode, 因为注册那一刻
   * 用户记录还不存在, 无法建立外键关系, 只能在拿到 token 后补绑定。
   * 自邀请在服务端被拒 (bindInvite 返回 bound:false), 前端不提示也不阻断。
   */
  useEffect(() => {
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
  }, []);

  const copyLink = async () => {
    if (!data?.inviteCode) return;
    const url = `${window.location.origin}/invitations?inv=${data.inviteCode}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('邀请链接已复制到剪贴板');
    } catch {
      message.info(`复制失败，请手动复制：${url}`);
    }
  };

  const doCheckin = async () => {
    if (!checkin || checkin.checkedIn || submitting) return;
    setSubmitting(true);
    try {
      const r = await myMarketingApi.checkin();
      if (r.alreadyCheckedIn) message.info('今天已经签过到了');
      else message.success(`签到成功，获得 ${r.credits} 积分`);
      load();
    } catch {
      message.error('签到失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * 加载态此前直接渲染 `<h2>加载中…</h2>` —— 拿标题当加载指示器,
   * 语义错位 (标题是内容结构, 不是状态提示), 且整页塌成一个 h2。
   * 改为骨架屏: 占住下方各区块的形状, 内容到达时零位移。
   */
  if (loading) {
    return (
      <div className="invite-page">
        <StateSkeleton variant="panel" count={4} />
      </div>
    );
  }

  // 加载失败: 如实说明, 不编造任何数字
  if (!data) {
    return (
      <div className="invite-page">
        <StateError
          title="邀请数据加载失败"
          desc="请确认已登录，且后端服务正常运行。本页数据全部来自真实接口，加载失败时不展示任何占位数字。"
          detail={error ?? undefined}
          onRetry={load}
        />
      </div>
    );
  }

  const { rule, metrics, enabled } = data;
  const m = metrics;

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
        rule.triggerOn === 'first_pay'
          ? `好友首次付费成功后，你得 ${rule.inviterCredits} 积分`
          : `好友注册成功后，你得 ${rule.inviterCredits} 积分`,
    },
  ];

  const metricsRow = [
    { label: '累计邀请（人）', value: m.totalInvited },
    { label: '累计收益（积分）', value: m.earnedCredits },
    { label: '已发放（笔）', value: m.rewardedCount },
    { label: '待发放（笔）', value: m.pendingCount },
  ];

  return (
    <div className="invite-page">
      <section className="invite-hero">
        <div className="invite-hero-copy">
          <h1>{enabled ? `邀请好友立赚 ${rule.inviterCredits} 积分` : '邀请好友一起用货觉AI'}</h1>
          <p>
            {enabled ? (
              <>
                你的专属邀请码：<strong>{data.inviteCode}</strong>。好友通过链接注册并完成
                {rule.triggerOn === 'first_pay' ? '首次付费' : '注册'}后，奖励自动发放到你的积分账户。
              </>
            ) : (
              '邀请奖励规则尚未配置，当前分享链接仅记录邀请关系，不发放积分。'
            )}
          </p>
          <div className="invite-hero-actions">
            <button type="button" className="invite-btn-primary" onClick={() => void copyLink()}>
              <Link2 size={15} /> 复制邀请链接
            </button>
            <button
              type="button"
              className="invite-btn-ghost"
              onClick={() => message.info('邀请海报生成未实现，可直接把上方链接发给好友')}
            >
              <ImageIcon size={15} /> 查看邀请海报
            </button>
          </div>
        </div>
      </section>

      {/* 签到 (B-67): 与邀请并列 —— 两者都是积分来源, 但触发方式不同 */}
      {checkin && (
        <section className="invite-block">
          <h2>
            <CalendarCheck size={16} /> 每日签到
          </h2>
          <div className="invite-metrics">
            <div className="invite-metric">
              <span className="invite-metric-label">
                <Sparkles size={13} /> 连续签到（天）
              </span>
              <span className="invite-metric-value">{checkin.streak}</span>
            </div>
            <div className="invite-metric">
              <span className="invite-metric-label">
                <Gift size={13} /> 今日可得
              </span>
              <span className="invite-metric-value">{checkin.nextCredits}</span>
            </div>
          </div>

          <button
            type="button"
            className="invite-btn-primary"
            onClick={() => void doCheckin()}
            disabled={checkin.checkedIn || submitting || !checkin.rule.enabled}
            style={{ marginTop: 12 }}
          >
            {checkin.checkedIn
              ? `今日已签到 +${checkin.todayCredits}`
              : checkin.rule.enabled
                ? '立即签到'
                : '签到未开启'}
          </button>

          {/* 未来 7 天: 让用户看清连签到第 3/7 天各能多拿多少 */}
          <ul className="invite-rules" style={{ marginTop: 12 }}>
            {checkin.forecast.slice(0, 7).map((f) => (
              <li key={f.day}>
                第 {f.streak} 天（{f.day}）可得 {f.credits} 积分
                {f.credits > checkin.rule.baseCredits ? '（含连签加成）' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="invite-block">
        <h2>邀请步骤</h2>
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

      <section className="invite-block">
        <h2>规则说明</h2>
        <ul className="invite-rules">
          <li>
            邀请人奖励 {rule.inviterCredits} 积分，被邀请人奖励 {rule.inviteeCredits} 积分；触发时机为
            {rule.triggerOn === 'first_pay' ? '被邀请人首次付费' : '被邀请人注册'}。
          </li>
          <li>一个账号只能被一位邀请人绑定；自邀请不生效。</li>
          <li>
            累计收益只统计已发放的邀请。待发放的 {m.pendingCount} 笔按当前规则预估约 {m.pendingCredits}{' '}
            积分，规则调整后以实际发放为准。
          </li>
          {!rule.valid && <li>邀请奖励当前已关闭，新绑定不发放积分。</li>}
          <li>奖励以积分形式发放，可在积分明细中查看到账流水。</li>
        </ul>
      </section>

      <section className="invite-block">
        <h2>数据明细</h2>
        <div className="invite-metrics">
          {metricsRow.map((row) => (
            <div key={row.label} className="invite-metric">
              <span className="invite-metric-label">
                <Sparkles size={13} /> {row.label}
              </span>
              <span className="invite-metric-value">{row.value}</span>
            </div>
          ))}
        </div>
        <p className="invite-metrics-note">
          以上为真实数据，来自 <code>GET /api/v1/marketing/invites</code>，非示例值。
        </p>
      </section>

      {data.relations.length > 0 && (
        <section className="invite-block">
          <h2>邀请记录</h2>
          <ul className="invite-rules">
            {data.relations.map((r) => (
              <li key={r.id}>
                {r.inviteeName} · {new Date(r.boundAt).toLocaleDateString('zh-CN')} ·{' '}
                {r.rewardStatus === 'granted' ? '奖励已发放' : '待发放'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}