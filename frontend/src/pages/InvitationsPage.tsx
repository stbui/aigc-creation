import { useCallback, useEffect, useState } from 'react';
import { App, Button, Modal } from 'antd';
import QRCode from 'qrcode';
import { Link2, Image as ImageIcon, Sparkles, CalendarCheck, Gift, Download } from 'lucide-react';
import { myMarketingApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PersonalPage } from '../components/PersonalPage';
import { StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
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
  // 邀请海报: 生成结果与弹窗开关。state 必须声明在早退分支之前 (Rules of Hooks)
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);

  const load = useCallback(() => {
    // guest 不发请求: 邀请码与签到状态都要鉴权, 401 会被渲染成「加载失败」。
    // 不动 loading: 登录后直接进骨架屏, 不会先闪一下「加载失败」
    if (!token) {
      setData(null);
      setCheckin(null);
      return;
    }
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
  }, [token]);

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
        color: { dark: '#171a2b', light: '#ffffff' },
      });
      const url = await buildInvitePoster({
        qrDataUrl: qr,
        code: data.inviteCode,
        claim: enabled && rule.inviterCredits > 0 ? `邀请好友，立赚 ${rule.inviterCredits} 积分` : '邀请好友一起用货觉AI',
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
    a.download = `货觉AI-邀请海报-${data.inviteCode}.png`;
    a.rel = 'noopener';
    a.click();
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
    <PersonalPage
      className="invite-page"
      title="邀请有奖"
      description="分享专属链接，好友完成指定动作后奖励自动到账；每天签到也能积累积分。"
    >
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

          <Button
            type="primary"
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

/**
 * 合成邀请海报 (640×880 PNG data URL)。
 *
 * 用 canvas 手绘而不是拼模板图: 文案随奖励规则变化 (规则关闭时不能承诺积分),
 * 拼图就得为每种状态准备一张模板。字体用系统栈, 中文在各平台都不会缺字。
 */
async function buildInvitePoster(opts: {
  qrDataUrl: string;
  code: string;
  claim: string;
}): Promise<string> {
  const W = 640;
  const H = 880;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 canvas');

  const font = (size: number, weight = '400') =>
    `${weight} ${size}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

  // 背景: 品牌紫渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#5546d8');
  grad.addColorStop(1, '#8064f6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(44, '700');
  ctx.fillText('货觉AI', W / 2, 88);
  ctx.font = font(18);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText('电商智能视觉创作平台', W / 2, 124);

  // 白色主卡
  roundRect(ctx, 40, 160, W - 80, H - 240, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.fillStyle = '#171a2b';
  ctx.font = font(28, '700');
  ctx.fillText(opts.claim, W / 2, 246);

  // 二维码 (520px 源图缩到 260, 保证高清屏不糊)
  const img = await loadImage(opts.qrDataUrl);
  const qrSize = 260;
  ctx.drawImage(img, (W - qrSize) / 2, 292, qrSize, qrSize);

  ctx.fillStyle = '#4e5969';
  ctx.font = font(18);
  ctx.fillText('用手机扫码注册，自动绑定邀请关系', W / 2, 596);

  // 邀请码胶囊
  roundRect(ctx, 120, 626, W - 240, 78, 18);
  ctx.fillStyle = '#f2f4f7';
  ctx.fill();
  ctx.fillStyle = '#5546d8';
  ctx.font = font(26, '700');
  ctx.fillText(`邀请码 ${opts.code}`, W / 2, 676);

  ctx.fillStyle = '#86909c';
  ctx.font = font(15);
  ctx.fillText('货觉AI · 商品主图 / 详情图 / 抠图 / 精修，一站式完成', W / 2, 762);

  return canvas.toDataURL('image/png');
}

/** 圆角矩形路径。不用 ctx.roundRect: 老版本 Safari 没有这个方法 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('二维码图片加载失败'));
    img.src = src;
  });
}