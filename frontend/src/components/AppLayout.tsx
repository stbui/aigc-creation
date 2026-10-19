import { useMemo, useState, type ReactNode } from 'react';
import { Layout, Button, Avatar, Dropdown } from 'antd';
import { Sparkles, ChevronDown, LogOut, User as UserIcon, Wallet } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { MODE_LABELS } from '../lib/constants';
import { toolPath } from '../lib/capabilities';
import { useAuth } from '../context/AuthContext';
import { SideRail, SIDEBAR_WIDTH } from './SideRail';
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
  const { token, email, logout } = useAuth();
  const [navOpen, setNavOpen] = useState<string | null>(null);

  const go = (to: string) => {
    if (to === '#') return;
    navigate(to);
  };

  // 参考站顶导只有「电商生图▾ / AI修图▾」两项（README 页面结构表已登记）,
  // registry 里的第三组 ai_video（自由创作）在参考站无对应顶导入口, 只走侧栏与落地页。
  // 故这里按顺序取前两组 —— 是有意的信息架构裁剪, 不是遗漏; 若参考站新增顶导分组,
  // 改 registry 顺序即可自动生效, 不要在前端写死组名。
  const topGroups = useMemo(() => groups.slice(0, 2), [groups]);

  return (
    <Layout className="app-layout">
      <PromoBar />
      <Header className="app-header">
        <Link to="/workbench" className="app-brand">
          <span className="app-brand-mark">
            <Sparkles size={18} />
          </span>
          <span className="app-brand-text">电商视觉工坊</span>
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
              menu={{
                items: items
                  .filter((c) => c.group === g.id)
                  .map((c) => ({
                    key: c.id,
                    label: (
                      <span className="app-topnav-item-row">
                        <CapabilityIcon id={c.id} size={14} />
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
          <Link to="/stats" className="app-topnav-item">
            数据中心
          </Link>
        </nav>

        <div className="app-header-right">
          <span className="app-quota">
            <Wallet size={14} />
            本地算力 · 不限次数
          </span>
          {token ? (
            <Dropdown
              menu={{
                items: [
                  { key: 'email', label: email ?? '', icon: <UserIcon size={14} />, disabled: true },
                  { type: 'divider' as const },
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
            <Button type="primary" size="small" onClick={() => navigate('/login')}>
              登录/注册
            </Button>
          )}
        </div>
      </Header>

      <Layout className="app-body">
        <div className="app-sider-wrap" style={{ width: SIDEBAR_WIDTH }}>
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
    </Layout>
  );
}
