import { Link } from 'react-router-dom';

import { A } from './constants';

interface LandingFooterProps {
  /** 能力运行时可见性：已下线工具不再出现在页脚 */
  canUse: (capability: string) => boolean;
}

/** 页脚：品牌、工具 / 积分 / 支持三列链接与版权说明。 */
export function LandingFooter({ canUse }: LandingFooterProps) {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <strong>货觉AI · 电商视觉创作平台</strong>
          <p>好图，好卖 —— 商品图 · 详情页 · 营销视觉，一站生成</p>
          <div className="landing-footer-logos">
            <img src={`${A}/logos/t_y01.png`} alt="客户 logo" width={190} height={40} loading="lazy" />
            <img src={`${A}/logos/t_y02.png`} alt="客户 logo" width={160} height={38} loading="lazy" />
            <img src={`${A}/logos/t_y03.png`} alt="客户 logo" width={93} height={28} loading="lazy" />
          </div>
        </div>
        <div className="landing-footer-col">
          <h4>AI工具</h4>
          {canUse('main_image') && <Link to="/product-kit">商品主图</Link>}
          {canUse('hot_remake') && <Link to="/viral-clone">爆款复刻</Link>}
          <Link to="/workbench">更多工具</Link>
        </div>
        <div className="landing-footer-col">
          <h4>积分套餐</h4>
          <Link to="/packages">积分购买</Link>
          <Link to="/credits">积分明细</Link>
          <Link to="/works">任务记录</Link>
        </div>
        <div className="landing-footer-col">
          <h4>支持与服务</h4>
          <Link to="/tickets?type=consultation&compose=1">帮助中心</Link>
          <Link to="/tickets?type=complaint&compose=1">投诉举报</Link>
        </div>
      </div>
      <p className="landing-footer-copy">
        © 2026 货觉AI · 页面用于产品展示，案例素材版权归各自权利人所有。
      </p>
    </footer>
  );
}
