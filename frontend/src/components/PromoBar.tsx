import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, X } from 'lucide-react';
import { myMarketingApi } from '../lib/api';
import type { PopupCampaign } from '../types/api';

const DISMISS_KEY = 'ecom-promo-dismissed-v1';

/**
 * 顶部推广条: 参考站工作台顶部的通栏促销位。
 *
 * 双数据源, 优先级明确:
 *   1. **DB 真实活动** (GET /marketing/popup) —— 后台「营销中心」配置的弹窗位活动。
 *      有生效活动就展示活动, 文案与倒计时均来自服务端。
 *   2. 静态卖点条 —— 仅在无生效活动时作为兜底, 且**不含倒计时**
 *      (admin-suite-design.md §3.2: 「倒计时数据必须来自 DB, 不得前端自减」;
 *       本文件早期注释同样声明"不做虚假倒计时", 两条约束都必须守住)。
 *
 * ⚠ **倒计时基准是 serverNow 而非本地时间**:
 * 用户改系统时间或跨时区访问时, 直接用 Date.now() 算剩余会得到错误的
 * "已结束" 或 "还剩 8 小时", 构成假承诺。做法: 加载时算一次
 * 偏移量 = serverNow − 本地 now, 之后按偏移推进。
 *
 * 布局契约: 推广条占 40px, 通过 html[data-promo] 让 CSS 修正高度计算
 * (global.css 的 height calc 契约)。窄屏 ≤900px 隐藏 —— 参考站移动态
 * 390 实测无促销条。**必须走 JS matchMedia 而非 CSS display:none**,
 * 否则 data-promo 契约与实际渲染不符, product-kit / 多图融合页会矮 40px。
 */
export function PromoBar() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [campaign, setCampaign] = useState<PopupCampaign | null>(null);

  useEffect(() => {
    if (!dismissed) return;
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* 隐私模式等场景下写入失败, 不影响本次会话 */
    }
  }, [dismissed]);

  // 拉真实活动。失败静默回落到静态条: 促销位挂掉不该让整个顶部报错
  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    myMarketingApi
      .popup()
      .then((c) => {
        if (alive) setCampaign(c ?? null);
      })
      .catch(() => {
        if (alive) setCampaign(null);
      });
    return () => {
      alive = false;
    };
  }, [dismissed]);

  const { remainText, expired } = useCountdown(campaign);

  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /*
   * 活动过期后**隐藏整条**, 不显示「00:00」—— 那会让用户以为还有机会。
   * 也不回落静态条: 刚过期就换成卖点条, 等于用兜底掩盖"活动已结束"的事实。
   * 是否有新活动由下一次页面加载重新拉取决定。
   */
  const hidden = dismissed || narrow || expired;

  useEffect(() => {
    document.documentElement.dataset.promo = hidden ? 'off' : 'on';
    return () => {
      delete document.documentElement.dataset.promo;
    };
  }, [hidden]);

  if (hidden) return null;

  const goCampaign = () => {
    const url = campaign?.ctaUrl;
    // ctaUrl 后端已限定站内相对路径, 前端再兜一层: 拒绝 "//" 开头的协议相对地址,
    // 否则配置一旦被绕过就会把用户引离本站
    if (url && url.startsWith('/') && !url.startsWith('//')) {
      navigate(url);
      return;
    }
    navigate('/packages');
  };

  return (
    <div className="app-promo">
      <div className="app-promo-inner">
        <span className="app-promo-badge">
          <Gift size={13} />
          {campaign ? '限时活动' : '货觉新人礼'}
        </span>
        <span className="app-promo-text">
          {campaign
            ? `${campaign.title}${campaign.body ? ` · ${campaign.body}` : ''}`
            : '本地算法不限次数，12 项电商视觉能力全部可试'}
          {campaign && remainText ? ` · 剩余 ${remainText}` : ''}
        </span>
        <button type="button" className="app-promo-cta" onClick={goCampaign}>
          {campaign?.ctaText ?? '立即体验'}
        </button>
      </div>
      <button
        type="button"
        className="app-promo-close"
        aria-label="关闭推广"
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * 倒计时。基准取服务端 `serverNow`, 本地只负责走秒。
 *
 * 偏移量用 useMemo 一次算定: 若每次渲染重算, 已过去的秒数会被抵消,
 * 倒计时永远停在起点 —— 这是倒计时最常见的实现缺陷。
 */
function useCountdown(campaign: PopupCampaign | null) {
  const [remainText, setRemainText] = useState('');
  const [expired, setExpired] = useState(false);

  const skewMs = useMemo(() => {
    if (!campaign) return 0;
    return new Date(campaign.serverNow).getTime() - Date.now();
  }, [campaign]);

  useEffect(() => {
    if (!campaign) {
      setRemainText('');
      setExpired(false);
      return;
    }

    const tick = () => {
      const serverNow = Date.now() + skewMs;
      const left = new Date(campaign.endAt).getTime() - serverNow;
      if (left <= 0) {
        setRemainText('');
        setExpired(true);
        return;
      }
      setExpired(false);

      const totalSec = Math.floor(left / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const pad = (n: number) => String(n).padStart(2, '0');

      setRemainText(d > 0 ? `${d} 天 ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [campaign, skewMs]);

  return { remainText, expired };
}