import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gem } from 'lucide-react';

/**
 * 积分商城（1:1 复刻参考站 https://ijihua.cn/packages）
 *
 * 版式证据：参考站产物 CSS 的 `pkg-*` 族共 91 条规则（`.pkg-shop-page` / `.pkg-shop-container` /
 * `.pkg-back-btn` / `.pkg-shop-hero` / `.pkg-grid` / `.pkg-card*` / `.pkg-select-btn` /
 * `.pkg-confirm-*` / `.pkg-result-*`）。本页只落**选包态**（`.pkg-grid` 一层）；
 * 确认弹层与支付结果态依赖登录墙后的真实订单数据，参考站无可见证据，未复刻（见文件末尾说明）。
 *
 * 诚实披露（重要）：
 *   参考站的套餐名称 / 积分数 / 价格都在登录墙之后，本地无证据，**未编造**。
 *   `PACKAGES` 是**版式示例数据**（注释已标注），用于呈现 1:1 版式；
 *   本项目没有积分账户与计费系统，购买按钮一律禁用并明示原因，不做假支付。
 */

interface PackageItem {
  id: string;
  name: string;
  badge?: string;
  points: string;
  unit: string;
  bonus?: string;
  price: string;
  oldPrice?: string;
}

// ── 版式示例数据：非真实定价，仅用于呈现参考站的选包版式 ──
const PACKAGES: PackageItem[] = [
  { id: 'starter', name: '入门包', badge: '新客首选', points: '1,000', unit: '积分', bonus: '额外赠送 100 积分', price: '¥39', oldPrice: '¥59' },
  { id: 'growth', name: '成长包', points: '5,000', unit: '积分', bonus: '额外赠送 800 积分', price: '¥169', oldPrice: '¥199' },
  { id: 'pro', name: '专业包', badge: '高性价比', points: '20,000', unit: '积分', bonus: '额外赠送 4,000 积分', price: '¥599' },
  { id: 'custom', name: '企业定制', points: '面议', unit: '积分', bonus: '按团队规模定制额度', price: '联系顾问' },
];

export function PackagesPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="pkg-shop-page">
      <div className="pkg-shop-container">
        <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>

        <div className="pkg-shop-hero">
          <h1>
            <Gem size={22} />
            积分商城
          </h1>
          <p>积分可用于解锁全部 AI 创作能力，按需购买、长期有效</p>
        </div>

        <div className="pkg-grid">
          {PACKAGES.map((p) => (
            <article
              key={p.id}
              className={`pkg-card${selected === p.id ? ' is-selected' : ''}`}
              onClick={() => setSelected(p.id)}
            >
              <div className="pkg-card-top">
                <span className="pkg-card-name">{p.name}</span>
                {p.badge && <span className="pkg-card-badge">{p.badge}</span>}
              </div>

              <div className="pkg-card-points">
                <strong>{p.points}</strong>
                <span>{p.unit}</span>
              </div>

              {p.bonus && <span className="pkg-card-bonus">{p.bonus}</span>}

              <div className="pkg-card-price">
                <strong>{p.price}</strong>
                {p.oldPrice && <span className="pkg-card-price-old">{p.oldPrice}</span>}
              </div>

              {/* 本地无计费系统：按钮禁用并明示，不做假支付 */}
              <button
                type="button"
                className="pkg-select-btn"
                disabled
                title="本地未接入积分账户与计费，购买流程不可用"
              >
                立即购买
              </button>
            </article>
          ))}
        </div>

        <p className="pkg-shop-disclosure">
          本地版未接入积分账户与支付，套餐名称 / 积分数 / 价格均为<strong>版式示例数据</strong>
          （参考站对应内容在登录墙之后，无可见证据，未复制），购买按钮已禁用。接入真实计费后此处即为下单入口。
        </p>
      </div>
    </div>
  );
}

/**
 * 未复刻清单（参考站有规则但本地无证据/无功能）：
 *   .pkg-confirm-card / .pkg-payment-options(支付宝 #009FE8 · 微信 #24B340) / .pkg-pay-btn
 *   .pkg-result-card / .pkg-wechat-qr / .pkg-result-detail —— 均为下单确认与支付结果态，
 *   需要真实订单/支付回调，本项目无计费系统，不做假流程，故不实现。
 */