import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, X } from 'lucide-react';

const DISMISS_KEY = 'ecom-promo-dismissed-v1';

/**
 * 顶部推广条: 复刻参考站工作台顶部的通栏促销位 (双节爆单加油包那条的位置)。
 * 内容用我们自己的真实卖点 (本地算法 / 不限次数 / 能力数量), 不照搬对方活动文案,
 * 不做虚假倒计时。关闭状态写入 localStorage, 不再弹出。
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

  useEffect(() => {
    if (!dismissed) return;
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* 隐私模式等场景下写入失败, 不影响本次会话 */
    }
  }, [dismissed]);

  // 推广条占据 40px 布局高度; product-kit 工作台需要精确撑满视口,
  // 关闭时通过 html[data-promo] 让 CSS 修正高度计算
  useEffect(() => {
    document.documentElement.dataset.promo = dismissed ? 'off' : 'on';
    return () => {
      delete document.documentElement.dataset.promo;
    };
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div className="app-promo">
      <div className="app-promo-inner">
        <span className="app-promo-badge">
          <Gift size={13} />
          新人福利
        </span>
        <span className="app-promo-text">本地算法不限次数，12 项电商视觉能力全部可试</span>
        <button type="button" className="app-promo-cta" onClick={() => navigate('/product-kit')}>
          立即体验
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
