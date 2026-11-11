import './AppSidebar.css';
import { Drawer } from '../ui';
import { Link, useLocation } from 'react-router-dom';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { SideRail } from './SideRail';

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

/**
 * 左侧导航栏。
 *
 * 桌面端为 sticky 侧栏；≤900px 侧栏隐藏，由顶栏汉堡按钮打开抽屉，
 * 抽屉内补齐顶导隐藏后的高频入口，点击任一入口即关闭。
 */
export function AppSidebar({ groups, items, mobileOpen, onCloseMobile }: Props) {
  const activePath = useLocation().pathname;

  return (
    <>
      {/* 宽度由 CSS 管理，别用内联宽度覆盖媒体查询 */}
      <div className="app-sider-wrap">
        <SideRail groups={groups} items={items} activePath={activePath} />
      </div>

      <Drawer
        title="导航菜单"
        placement="left"
        size={280}
        open={mobileOpen}
        onClose={onCloseMobile}
        className="app-mobile-drawer"
        styles={{ body: { padding: 0 } }}
      >
        {/* 移动端补齐顶导隐藏后的高频入口 */}
        <nav className="app-mobile-links" aria-label="快捷导航">
          <Link to="/" onClick={onCloseMobile}>
            首页
          </Link>
          <Link to="/packages" onClick={onCloseMobile}>
            购买套餐
          </Link>
          <Link to="/invitations" onClick={onCloseMobile}>
            邀请有奖
          </Link>
        </nav>
        <SideRail
          groups={groups}
          items={items}
          activePath={activePath}
          onNavigate={onCloseMobile}
        />
      </Drawer>
    </>
  );
}
