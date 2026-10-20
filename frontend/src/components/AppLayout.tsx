import { useState, type ReactNode } from 'react';
import { Layout, Button, Avatar, Dropdown, Drawer } from 'antd';
import { ChevronDown, LogOut, Menu, ShieldCheck, User as UserIcon, Wallet } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { MODE_LABELS } from '../lib/constants';
import { toolPath } from '../lib/capabilities';
import { useAuth } from '../context/AuthContext';
import { useAdmin } from '../context/AdminContext';
import { useCredits } from '../context/CreditsContext';
import { SideRail } from './SideRail';
import { CapabilityIcon } from './SideRail';
import { PromoBar } from './PromoBar';

export { CapabilityIcon };

const { Header, Content } = Layout;

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  /** 侧栏 hover 预览用的真实产出图: capability -> sourceUrl */
  thumbs: Record<string, string | null>;
  statsTotal: number;
  children: ReactNode;
}

export function AppLayout({ groups, items, thumbs, statsTotal, children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { token, email, logout, openLogin } = useAuth();
  const { me, loading: adminLoading } = useAdmin();
  const { balance } = useCredits();
  const [navOpen, setNavOpen] = useState<string | null>(null);
  // 移动端导航抽屉 (≤900px 侧栏 display:none, 参考站 390 实测同构)
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  /** 是否展示后台入口: 身份已加载且为后台角色 */
  const isAdminRole = !adminLoading && me !== null;

  const go = (to: string) => {
    if (to === '#') return;
    navigate(to);
  };

  // 参考站顶导实拍 (1280, 2026-10-19) 共 8 项: 首页 + 3 个分组下拉 (电商生图/AI修图/AI视频)
  // + 5 个直链 (我的作品/购买套餐/邀请有奖/联系客服 + 首页本身)。
  // registry 下发的 3 组顺序与参考站顶导一致, 故此处直接渲染全部组、不做 slice 截断 ——
  // 旧注释「参考站只有两个下拉」是 10-17 旧快照, 已被实拍推翻 (docs/topnav-design.md §2.3/P1-1)。
  // 联系客服本地无客服体系, 暂不补 (诚实差异, 见 docs/topnav-design.md §5-2)。
  const topGroups = groups;

  return (
    <Layout className="app-layout">
      <PromoBar />
      <Header className="app-header">
        <Link to="/workbench" className="app-brand">
          {/* 品牌标记: 货觉AI「觉眼」logo (2026-10-19, 见 docs/brand/brand-basics.md) */}
          <span className="app-brand-mark">
            <img src="/brand/huojue-mark.svg" alt="货觉AI" className="app-brand-mark-img" />
          </span>
          <span className="app-brand-text">货觉</span>
          <span className="app-brand-ai">AI</span>
        </Link>

        <nav className="app-topnav">
          <Link to="/" className="app-topnav-item">
            首页
          </Link>
          {topGroups.map((g) => (
            <Dropdown
              key={g.id}
              open={navOpen === g.id}
              onOpenChange={(v) => setNavOpen(v ? g.id : null)}
              /* 下拉皮肤按参考站规格覆写 (radius 12 / 描边 #e5e7f0 / shadow 0 18 42 / pad 10 8 /
                 条目 36 r9 / 13-600 #475467 / icon 20 / hover #f2efff-#5b4df5), 见 global.css */
              classNames={{ root: 'app-topnav-dropdown' }}
              menu={{
                items: items
                  .filter((c) => c.group === g.id)
                  .map((c) => ({
                    key: c.id,
                    label: (
                      <span className="app-topnav-item-row">
                        <CapabilityIcon id={c.id} size={20} />
                        {c.name}
                        {c.mode === 'planned' && <span className="app-mode-tag">{MODE_LABELS.planned}</span>}
                      </span>
                    ),
                    disabled: c.mode === 'planned',
                    onClick: () => go(toolPath(c.id)),
                  })),
              }}
              placement="bottomLeft"
            >
              <Button type="text" className="app-topnav-item" icon={<ChevronDown size={14} />}>
                {g.name}
              </Button>
            </Dropdown>
          ))}
          <Link to="/works" className="app-topnav-item">
            我的作品
          </Link>
          {/* 参考站顶导第 6/7 项 (80px 直链)。本地 /packages、/invitations 路由早已存在却无顶导入口,
              补齐后与参考站同为 7 项 (联系客服无对应体系未补) */}
          <Link to="/packages" className="app-topnav-item">
            购买套餐
          </Link>
          <Link to="/invitations" className="app-topnav-item">
            邀请有奖
          </Link>
          {/* 数据中心不进顶导: 参考站仅侧栏分组, 本地侧栏已有 (SideRail.tsx「数据中心」),
              顶导再放一份是重复入口。见 docs/topnav-design.md P1-3 */}
        </nav>

        <div className="app-header-right">
          {/*
           * 顶导余额。
           *
           * 此前此处是写死的「本地算力 · 不限次数」—— 在真实计费上线后
           * 那句话与「生成要扣积分」直接矛盾, 用户照着它预期会以为生成免费。
           * 现改为读 /credits/balance 的真实余额, 点击进积分明细。
           *
           * 未登录不显示余额数字 (拉不到, 也不该显示一个假的 0)。
           */}
          {token && (
            <Link to="/credits" className="app-quota">
              <Wallet size={14} />
              {balance ? `${balance.balance} 积分` : '积分'}
            </Link>
          )}
          {token ? (
            <Dropdown
              menu={{
                items: [
                  { key: 'email', label: email ?? '', icon: <UserIcon size={14} />, disabled: true },
                  { type: 'divider' as const },
                  // 后台入口仅对后台角色显示。角色来自 /admin/me, 普通用户不请求该端点,
                  // 因此这里用 isAdminRole 静态判断而非读异步状态 —— 未加载时先不显示。
                  ...(isAdminRole
                    ? [
                        {
                          key: 'admin',
                          label: '进入运营后台',
                          icon: <ShieldCheck size={14} />,
                          onClick: () => navigate('/admin'),
                        },
                        { type: 'divider' as const },
                      ]
                    : []),
                  {
                    key: 'logout',
                    label: '退出登录',
                    icon: <LogOut size={14} />,
                    onClick: () => {
                      logout();
                      navigate('/login');
                    },
                  },
                ],
              }}
            >
              <button className="app-user" type="button">
                <Avatar size={26} className="app-user-avatar">
                  {(email ?? 'U').charAt(0).toUpperCase()}
                </Avatar>
                <span className="app-user-email">{email}</span>
              </button>
            </Dropdown>
          ) : (
            /* 参考站 #workspace-logout「登录/注册」是纯文字钮 (13/700 #667085, pad 8, radius 6),
               点开遮罩登录弹窗; 本地原为 antd Button type="primary" → 见 docs/topnav-design.md P2-3。
               2026-10-19「路由对外开放」后改为唤起弹窗, 不再跳独立页。 */
            <button type="button" className="app-guest-login" onClick={openLogin}>
              登录/注册
            </button>
          )}
          <button
            type="button"
            className="app-mobile-toggle"
            aria-label="打开导航菜单"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} />
          </button>
        </div>
      </Header>

      <Layout className="app-body">
        {/* 宽度由 CSS 托管: 桌面 176px 横排 / <1400px 自动塌缩 100px 垂直轨 / ≤900px 隐藏。
            曾经由 JSX inline width 注入, 会压过媒体查询导致响应式失效 (2026-10-19 修正) */}
        <div className="app-sider-wrap">
          <SideRail
            groups={groups}
            items={items}
            thumbs={thumbs}
            activePath={location.pathname}
            statsTotal={statsTotal}
            onNavigate={go}
          />
        </div>
        <Content className="app-content">{children}</Content>
      </Layout>

      <Drawer
        title="导航菜单"
        placement="left"
        width={280}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        className="app-mobile-drawer"
        styles={{ body: { padding: 0 } }}
      >
        <SideRail
          groups={groups}
          items={items}
          thumbs={thumbs}
          activePath={location.pathname}
          statsTotal={statsTotal}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </Drawer>
    </Layout>
  );
}
