import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { A } from './constants';

interface LandingFooterProps {
  /** 能力运行时可见性：已下线工具不再出现在页脚 */
  canUse: (capability: string) => boolean;
}

/**
 * 页脚：品牌、工具 / 积分 / 支持三列链接与版权说明。
 *
 * 三列链接是路由跳转，用原生 `Link` + 字号/颜色类，不套按钮外观；
 * 这也是四列（品牌 + 3 组）里唯一需要在外壳之外独立排版的一块。
 */
export function LandingFooter({ canUse }: LandingFooterProps) {
  return (
    <footer className="mt-24 bg-card px-8 pt-8 pb-7 max-[640px]:px-5">
      <div className="mx-auto grid max-w-[1226px] grid-cols-[2fr_1fr_1fr_1fr] gap-6 max-[640px]:grid-cols-1">
        <div>
          <strong className="block text-base text-foreground">
            货觉AI · 电商视觉创作平台
          </strong>
          <p className="mt-2 text-[13px] text-muted-foreground">
            好图，好卖 —— 商品图 · 详情页 · 营销视觉，一站生成
          </p>
          <div className="mt-5 flex items-center gap-4">
            {[
              { src: `${A}/logos/t_y01.png`, w: 190, h: 40 },
              { src: `${A}/logos/t_y02.png`, w: 160, h: 38 },
              { src: `${A}/logos/t_y03.png`, w: 93, h: 28 },
            ].map((logo) => (
              <img
                key={logo.src}
                src={logo.src}
                alt="客户 logo"
                width={logo.w}
                height={logo.h}
                loading="lazy"
                className="h-4.5 w-auto object-contain"
              />
            ))}
          </div>
        </div>

        <FooterColumn title="AI工具">
          {canUse('main_image') && <FooterLink to="/product-kit">商品主图</FooterLink>}
          {canUse('hot_remake') && <FooterLink to="/viral-clone">爆款复刻</FooterLink>}
          <FooterLink to="/workbench">更多工具</FooterLink>
        </FooterColumn>

        <FooterColumn title="积分套餐">
          <FooterLink to="/packages">积分购买</FooterLink>
          <FooterLink to="/credits">积分明细</FooterLink>
          <FooterLink to="/works">任务记录</FooterLink>
        </FooterColumn>

        <FooterColumn title="支持与服务">
          <FooterLink to="/tickets?type=consultation&compose=1">帮助中心</FooterLink>
          <FooterLink to="/tickets?type=complaint&compose=1">投诉举报</FooterLink>
        </FooterColumn>
      </div>

      <p className="mx-auto mt-6 max-w-[1226px] text-xs text-muted-foreground">
        © 2026 货觉AI · 页面用于产品展示，案例素材版权归各自权利人所有。
      </p>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h4 className="mb-0.5 text-sm font-semibold text-foreground">{title}</h4>
      {children}
    </div>
  );
}

/** 页脚链接：13px 次要文字，悬停转品牌紫（路由跳转，不是按钮） */
function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-[13px] text-muted-foreground no-underline transition-colors hover:text-brand"
    >
      {children}
    </Link>
  );
}