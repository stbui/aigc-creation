import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { myMarketingApi } from './api';
import { PersonalPage, StateSkeleton } from './components';
import { notifyCreditsChanged, useApp, useAuth, useDocumentMeta } from './hooks';
import { RELATION_PAGE_SIZE, type CheckinStatus, type MyInvites } from './constants';
import {
  buildInvitePoster,
  buildInviteSteps,
  inviteHeroTitle,
  posterFileName,
  qrColors,
} from './utils';
import { InviteCheckinBlock } from './InviteCheckinBlock';
import { InviteErrorState } from './InviteErrorState';
import { InviteGuestState } from './InviteGuestState';
import { InviteHero } from './InviteHero';
import { InviteMetricsBlock } from './InviteMetricsBlock';
import { InvitePosterModal } from './InvitePosterModal';
import { InviteRelationsBlock } from './InviteRelationsBlock';
import { InviteRulesBlock } from './InviteRulesBlock';
import { InviteStepsBlock } from './InviteStepsBlock';

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
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：`InviteHero` / `InviteCheckinBlock` /
 * `InviteMetricsBlock` / `InviteStepsBlock` / `InviteRelationsBlock` / `InviteRulesBlock` /
 * `InvitePosterModal`，访客与失败态分别是 `InviteGuestState` / `InviteErrorState`；
 * 文案派生落 `utils.ts`，取数、绑定、签到与海报等写操作仍留在本文件。
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
      .then(([invites, status]) => {
        setData(invites);
        loadedRelationsRef.current = invites.relations.length;
        setCheckin(status);
      })
      .catch((cause: unknown) => {
        // 失败置 null → 渲染失败态, 不回落到任何占位数字
        setData(null);
        setError(cause instanceof Error ? cause.message : '邀请数据加载失败');
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
    } catch (cause) {
      message.error((cause as Error).message || '邀请记录加载失败');
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
      .then((result) => {
        if (!alive || !result.bound) return;
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
      const claim = !data.enabled
        ? '邀请好友一起用货觉AI'
        : data.rule.inviterCredits > 0
          ? `邀请好友，立赚 ${data.rule.inviterCredits} 积分`
          : `好友注册得 ${data.rule.inviteeCredits} 积分`;
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
    const anchor = document.createElement('a');
    anchor.href = posterUrl;
    anchor.download = posterFileName(data.inviteCode);
    anchor.rel = 'noopener';
    anchor.click();
  };

  const doCheckin = async () => {
    if (!checkin || checkin.checkedIn || submitting) return;
    setSubmitting(true);
    try {
      const result = await myMarketingApi.checkin();
      if (result.alreadyCheckedIn) {
        message.info('今天已经签过到了');
      } else {
        message.success(`签到成功，获得 ${result.credits} 积分`);
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
    return <InviteGuestState onLogin={openLogin} />;
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
    return <InviteErrorState onRetry={load} />;
  }

  const { rule, metrics, enabled } = data;
  const heroTitle = inviteHeroTitle(rule, enabled);
  const steps = buildInviteSteps(rule, enabled, data.inviteCode);

  return (
    <PersonalPage
      className="invite-page"
      title="邀请有奖"
      description="分享专属链接，好友完成指定动作后奖励自动到账；每天签到也能积累积分。"
    >
      <InviteHero
        enabled={enabled}
        rule={rule}
        heroTitle={heroTitle}
        inviteCode={data.inviteCode}
        qrUrl={qrUrl}
        posterBusy={posterBusy}
        onCopyLink={() => void copyLink()}
        onOpenPoster={() => void openPoster()}
      />

      {/* 签到 (B-67): 与邀请并列 —— 两者都是积分来源, 但触发方式不同 */}
      {checkin && (
        <InviteCheckinBlock
          checkin={checkin}
          submitting={submitting}
          onCheckin={() => void doCheckin()}
        />
      )}

      <InviteMetricsBlock metrics={metrics} />
      <InviteStepsBlock steps={steps} />

      {metrics.totalInvited > 0 && (
        <InviteRelationsBlock
          relations={data.relations}
          totalInvited={metrics.totalInvited}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
        />
      )}

      <InviteRulesBlock rule={rule} enabled={enabled} metrics={metrics} />

      <InvitePosterModal
        open={posterOpen}
        posterUrl={posterUrl}
        onClose={() => setPosterOpen(false)}
        onDownload={downloadPoster}
      />
    </PersonalPage>
  );
}
