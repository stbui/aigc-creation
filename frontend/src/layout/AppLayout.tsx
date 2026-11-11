import './AppLayout.css';
import type { ReactNode } from 'react';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { useMobileNav } from './hooks';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { PromoBar } from './PromoBar';
import { GuestPromoDialog } from './GuestPromoDialog';

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  children: ReactNode;
}

/**
 * C 端应用外壳。
 *
 * 只负责组合：推广条 / 顶部导航（`AppHeader`）/ 左侧导航（`AppSidebar`）/
 * 主内容区。移动抽屉的开关状态由 `useMobileNav` 托管，顶栏负责唤起、侧栏负责关闭。
 */
export function AppLayout({ groups, items, children }: Props) {
  const { mobileOpen, openMobileNav, closeMobileNav } = useMobileNav();

  // 下架/规划中的能力不进顶导与侧栏（由各组件内部过滤）。
  return (
    <div className="app-layout">
      <a className="skip-to-content" href="#main-content">
        跳到主要内容
      </a>
      <PromoBar />
      <GuestPromoDialog />
      <AppHeader
        groups={groups}
        items={items}
        mobileNavOpen={mobileOpen}
        onOpenMobileNav={openMobileNav}
      />

      <div className="app-body">
        <AppSidebar
          groups={groups}
          items={items}
          mobileOpen={mobileOpen}
          onCloseMobile={closeMobileNav}
        />
        <main className="app-content" id="main-content" data-route-stage tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
