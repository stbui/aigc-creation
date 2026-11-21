import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  CreditCard,
  Gift,
  Home,
  Images,
  LayoutDashboard,
  LogIn,
  Menu,
  MessageCircle,
} from 'lucide-react';

import { NAV_ICONS } from './constants';
import { useAuth, useCapabilities } from './hooks';
import { isCapabilityVisible, toolPath } from './utils';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
} from './components';

/** 顶导文字项密度：32px 高、13px/700、8px 圆角，选中与展开都是品牌淡底 */
const NAV_ITEM =
  'h-8 shrink-0 gap-1 rounded-md px-3.5 text-[13px] font-bold text-muted-foreground hover:bg-brand-bg hover:text-brand data-[state=open]:bg-brand-bg data-[state=open]:text-brand';
const NAV_ITEM_ACTIVE = 'bg-brand-bg text-brand hover:bg-brand-bg hover:text-brand';

const MOBILE_ITEM =
  'h-9 w-full justify-start gap-2 rounded-[9px] px-2 text-xs font-normal text-foreground hover:bg-brand-bg hover:text-brand';

/**
 * 营销首页顶部导航。
 *
 * 2026-11-21 组件层重构：能力分组下拉换成 shadcn `DropdownMenu`（与
 * `layout/AppHeader` 同一交互语法，点击展开、方向键可走），≤900px 的
 * 手写 scrim + 滑入面板换成 shadcn `Sheet`。顶栏本身仍是 64px 三段网格
 * （品牌 266 / 导航自适应 / 右侧动作），≤900px 收成「品牌 + 汉堡」。
 */
export function LandingHeader() {
  const { data } = useCapabilities();
  const { token } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = (data?.items ?? []).filter(isCapabilityVisible);
  const navGroups = (data?.groups ?? []).filter((g) => navItems.some((i) => i.group === g.id));

  // 视口回到桌面宽度时收起抽屉：抽屉是移动端独占，留着一个遮罩层没有意义
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header
      className="relative z-10 grid h-16 grid-cols-[266px_minmax(0,1fr)_182px] items-center bg-card px-8 shadow-[0_1px_var(--color-border-soft)] max-[1024px]:grid-cols-[266px_minmax(0,1fr)_max-content] max-[1024px]:px-5 max-[900px]:flex max-[900px]:h-[54px] max-[900px]:items-center max-[900px]:justify-between max-[900px]:gap-2.5 max-[900px]:px-3.5"
    >
      <Link
        to="/"
        className="flex h-9.5 w-[266px] items-center gap-2.5 px-1.5 text-foreground no-underline max-[900px]:h-[34px] max-[900px]:w-auto max-[900px]:gap-2"
      >
        <img src="/brand/huojue-mark.svg" alt="货觉AI" className="block size-9 max-[900px]:size-8" />
        <span className="text-base font-bold whitespace-nowrap max-[900px]:text-sm">
          货觉<span className="text-brand">AI</span>
        </span>
      </Link>

      <nav className="flex min-w-0 items-center gap-2.5 overflow-x-auto py-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-[900px]:hidden">
        <Button asChild variant="ghost" className={cn(NAV_ITEM, NAV_ITEM_ACTIVE)}>
          <Link to="/">首页</Link>
        </Button>
        {navGroups.map((group) => (
          <DropdownMenu key={group.id}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={NAV_ITEM}>
                {group.name}
                <ChevronDown aria-hidden className="size-[13px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[190px] rounded-xl p-2">
              <DropdownMenuGroup>
                {navItems
                  .filter((item) => item.group === group.id)
                  .map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      asChild
                      className="group h-9 gap-2.5 rounded-[9px] px-3 text-[13px] font-semibold text-muted-foreground"
                    >
                      <Link to={toolPath(item.id)} title={item.summary}>
                        {NAV_ICONS[item.id] && (
                          <img
                            src={NAV_ICONS[item.id]}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            className="size-5 shrink-0 object-contain opacity-65 grayscale transition-[filter,opacity] group-data-[highlighted]:opacity-100 group-data-[highlighted]:grayscale-0"
                          />
                        )}
                        {item.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
        <Button asChild variant="ghost" className={NAV_ITEM}>
          <Link to="/workbench">工作台</Link>
        </Button>
      </nav>

      <div className="flex items-center gap-6 justify-self-end max-[1024px]:gap-3 max-[900px]:hidden">
        <Badge
          variant="outline"
          className="h-8 rounded-full border-[var(--border-brand)] bg-brand-bg px-3 text-[13px] font-bold text-brand max-[1024px]:hidden"
        >
          AI 创作 · 按能力计费
        </Badge>
        <Button asChild variant="ghost" className={NAV_ITEM}>
          <Link to="/works">我的作品</Link>
        </Button>
        <Button asChild variant="ghost" className={NAV_ITEM}>
          <Link to="/stats">数据中心</Link>
        </Button>
        <Button asChild variant="ghost" className="h-8 rounded-md px-2 text-[13px] font-bold">
          <Link to={token ? '/workbench' : '/login'}>
            {token ? '进入工作台' : '登录/注册'}
          </Link>
        </Button>
      </div>

      {/* 汉堡必须是 header 的直系子元素：放进右侧动作区会随该列在 ≤900px 一起隐藏 */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hidden size-8 text-foreground max-[900px]:inline-flex"
        aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <Menu aria-hidden />
      </Button>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="right"
          className="w-[min(320px,calc(100vw-24px))] gap-0 p-0 sm:max-w-[320px]"
        >
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-sm">导航菜单</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5">
            <nav aria-label="移动端导航" className="grid gap-2.5">
              <MobileSection title="快捷入口">
                <MobileLink to="/" icon={<Home size={18} aria-hidden />} onNavigate={closeMenu}>
                  首页
                </MobileLink>
                <MobileLink
                  to="/workbench"
                  icon={<LayoutDashboard size={18} aria-hidden />}
                  onNavigate={closeMenu}
                >
                  工作台
                </MobileLink>
                <MobileLink
                  to="/works"
                  icon={<Images size={18} aria-hidden />}
                  onNavigate={closeMenu}
                >
                  我的作品
                </MobileLink>
              </MobileSection>

              {navGroups.map((group) => (
                <MobileSection key={group.id} title={group.name}>
                  {navItems
                    .filter((item) => item.group === group.id)
                    .map((item) => (
                      <MobileLink
                        key={item.id}
                        to={toolPath(item.id)}
                        icon={
                          NAV_ICONS[item.id] ? (
                            <img src={NAV_ICONS[item.id]} alt="" aria-hidden loading="lazy" />
                          ) : null
                        }
                        onNavigate={closeMenu}
                      >
                        {item.name}
                      </MobileLink>
                    ))}
                </MobileSection>
              ))}

              <MobileSection title="账户服务">
                <MobileLink
                  to="/packages"
                  icon={<CreditCard size={18} aria-hidden />}
                  onNavigate={closeMenu}
                >
                  购买套餐
                </MobileLink>
                <MobileLink
                  to="/invitations"
                  icon={<Gift size={18} aria-hidden />}
                  onNavigate={closeMenu}
                >
                  邀请好友
                </MobileLink>
                <MobileLink
                  to="/tickets?type=consultation&compose=1"
                  icon={<MessageCircle size={18} aria-hidden />}
                  onNavigate={closeMenu}
                >
                  联系客服
                </MobileLink>
                <MobileLink
                  to={token ? '/workbench' : '/login'}
                  icon={<LogIn size={18} aria-hidden />}
                  onNavigate={closeMenu}
                >
                  {token ? '进入工作台' : '登录/注册'}
                </MobileLink>
              </MobileSection>
            </nav>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

/** 抽屉内的一组入口：标题 + 两列网格，组间用分隔线断开 */
function MobileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1 border-b border-border pb-2.5 last:border-b-0">
      <span className="mx-1 text-xs font-bold tracking-[0.04em] text-muted-foreground">{title}</span>
      <div className="grid grid-cols-2 gap-x-1.5 gap-y-1">{children}</div>
    </section>
  );
}

/** 抽屉入口：图标 + 单行省略文案，点击后关闭抽屉 */
function MobileLink({
  to,
  icon,
  children,
  onNavigate,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Button asChild variant="ghost" className={MOBILE_ITEM} onClick={onNavigate}>
      <Link to={to}>
        {icon && (
          <span className="grid size-[18px] shrink-0 place-items-center [&_img]:size-[18px] [&_img]:object-contain [&_svg]:size-[18px]">
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate text-left">{children}</span>
      </Link>
    </Button>
  );
}