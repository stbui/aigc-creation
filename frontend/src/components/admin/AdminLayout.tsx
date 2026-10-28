import { ChevronDown, LogOut, Menu, Rows3, Rows4, Search, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Input,
  Layout,
  Modal,
  Tooltip,
  type InputRef,
} from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { adminSearchApi } from '../../lib/api';
import { hasUnsavedChanges } from '../../lib/unsaved-guard';
import type { AdminSearchGroup } from '../../types/api';
import { APP_ENV, IS_PROD } from '../../lib/constants';
import { ADMIN_MENU, findAdminMenuItem, type AdminMenuItem } from './adminNav';
import { AdminAlertBell } from './AlertCenter';

/**
 * 非生产环境才显示的环境标识, 防止误在生产执行测试操作。
 *
 * 文案来自各档位 env 文件的 VITE_ENV_LABEL（构建时注入），
 * 回落规则与 APP_ENV 对齐：development→开发 / test→测试 / 其他非生产→预发。
 * 显式给 label 的好处是「测试」与「预发」在界面上不会混为一谈 ——
 * 测试环境可以随便造脏数据，预发环境的数据往往要给客户看。
 */
function EnvironmentBadge() {
  if (IS_PROD) return null;
  const fallback = APP_ENV === 'development' ? '开发' : APP_ENV === 'test' ? '测试' : '预发';
  const label = import.meta.env.VITE_ENV_LABEL || fallback;
  return (
    <span className="adm-env-tag" title={`当前环境: ${APP_ENV} (${label})`}>
      <span className="adm-env-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

interface Props {
  children: ReactNode;
}

/**
 * 列表密度偏好。
 *
 * 后台大部分页面是「扫一眼找异常」的表格。运营在 1080p 上更希望一屏多看
 * 几行，财务核对时又需要宽松行高。做成全局开关而不是每个表格各配一次：
 * 偏好跟着人走，换页面不用重新设置。
 */
const DENSITY_KEY = 'huojue.admin.density';

/**
 * 按路径查侧栏菜单项 (2026-10-20 新增)。
 *
 * 供 AdminDashboardPage 的 NotImplementedPage 判定「这条 catch-all 命中的是
 * planned 待建模块, 还是纯打错的 URL」—— 两种情况的正确文案完全不同。
 * 复用 MENU 这一个数据源, 不另建路径表, 否则菜单改名就会与异常页文案脱节。
 */
export { findAdminMenuItem } from './adminNav';

/**
 * 顶栏全局搜索 (B7)。
 *
 * 交互规则的三处取舍:
 *   1. **少于 2 个字符不发请求**。后端同样会返回空组 —— 两边一致,
 *      是为了让「打字过程中不闪错误」这件事不依赖某一边的实现。
 *   2. **每类只显示前 5 条 + 该类总数**。顶栏的用途是「跳过去」,
 *      翻页留给各列表页(那里本来就有完整筛选)。
 *   3. **点击即跳转并清空关键词**。继续保留关键词会让下一次打开面板
 *      看到上次的结果, 分不清是缓存还是新搜索。
 */
function GlobalSearch({ canSearch, onNavigate }: { canSearch: boolean; onNavigate: (to: string) => void }) {
  const [keyword, setKeyword] = useState('');
  const [groups, setGroups] = useState<AdminSearchGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<InputRef>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  const q = keyword.trim();
  const hits = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ groupKey: group.key, ...item }))),
    [groups],
  );
  const activeHit = hits[activeIndex];
  const shortcut = useMemo(
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'),
    [],
  );

  /*
   * ⌘K / Ctrl+K 是后台设计稿约定的搜索入口。
   *
   * 之前只支持鼠标点击输入框: 运营在任意列表页想搜一条订单都得先把视线移回顶栏。
   * 快捷键在任何页面都直接聚焦搜索框；面板本身再支持 ↑↓ 与 Enter, 键盘可完成
   * 「唤起 → 搜索 → 打开结果」整条链路。
   */
  useEffect(() => {
    if (!canSearch) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSearch]);

  useEffect(() => {
    setActiveIndex(0);
  }, [groups]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!canSearch || q.length < 2) {
      setGroups([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // 300ms 防抖: 逐字符发请求在 SQLite 上就是每敲一个字五次全表 LIKE
    const timer = window.setTimeout(() => {
      adminSearchApi
        .search(q, controller.signal)
        .then((r) => {
          setGroups(r.groups);
          setError(null);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : '搜索失败');
          setGroups([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, canSearch, retryNonce]);

  // 点击面板外关闭: 用 pointerdown 而不是 Input 的 onBlur ——
  // onBlur 会先于点击触发, 面板在点击生效前就消失, 结果永远点不中
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const go = (to: string) => {
    onNavigate(to);
    setKeyword('');
    setGroups([]);
    setOpen(false);
  };

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  /*
   * 面板从「1 个字符」起就要打开。
   *
   * 之前 `panelOpen = open && q.length >= 2`: 输入第一个字时既不请求也不开面板,
   * 屏幕上**什么都不发生**, 用户以为搜索坏了就放弃了。现在先给规则提示,
   * 到 2 个字符再真正搜索。
   */
  const panelOpen = open;

  return (
    <div className="adm-search-wrap" ref={wrapRef}>
      <Input
        ref={inputRef}
        className="adm-search"
        prefix={<Search size={15} />}
        placeholder={canSearch ? '搜索用户 / 订单 / 工单 / 任务 / 素材' : '无搜索权限'}
        allowClear
        disabled={!canSearch}
        value={keyword}
        role="combobox"
        aria-label="后台全局搜索"
        aria-keyshortcuts="Meta+K Control+K"
        aria-expanded={panelOpen}
        aria-controls="adm-global-search-results"
        aria-activedescendant={
          panelOpen && activeHit ? `adm-search-hit-${activeIndex}` : undefined
        }
        aria-busy={loading}
        autoComplete="off"
        suffix={
          <span className="adm-search-shortcut" aria-hidden="true">
            {shortcut}
          </span>
        }
        onChange={(e) => {
          setKeyword(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onPressEnter={() => {
          if (activeHit) go(activeHit.link);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (hits.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((index) => (index + 1) % hits.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
          }
        }}
      />

      {panelOpen && (
        <div className="adm-search-panel" id="adm-global-search-results">
          <div className="adm-search-head">
            <span>全局搜索</span>
            <span className="adm-search-head-hint">
              {q.length >= 2 && !loading && !error ? `${total} 条结果` : '用户 · 订单 · 工单 · 任务 · 素材'}
            </span>
          </div>
          {q.length < 2 ? (
            <div className="adm-search-intro">
              <Search size={20} aria-hidden="true" />
              <strong>输入至少 2 个字符开始搜索</strong>
              <span>支持用户、订单、工单、任务与素材</span>
            </div>
          ) : loading && groups.length === 0 ? (
            <div className="adm-search-skeleton" aria-label="搜索中" role="status">
              {[0, 1, 2].map((row) => (
                <div key={row} className="adm-search-skeleton-row">
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="adm-search-hint is-error" role="status">
              <span>搜索失败：{error}</span>
              <button type="button" onClick={() => setRetryNonce((n) => n + 1)}>
                重新搜索
              </button>
            </div>
          ) : total === 0 ? (
            <div className="adm-search-intro" role="status">
              <Search size={20} aria-hidden="true" />
              <strong>没有匹配结果</strong>
              <span>试试邮箱、订单号或任务 ID 的后几位</span>
            </div>
          ) : (
            <div role="listbox" aria-label="搜索结果">
              {groups.filter((g) => g.items.length > 0).map((g) => (
                <div key={g.key} className="adm-search-group" role="group" aria-label={g.label}>
                  <div className="adm-search-group-title" aria-hidden>
                    {g.label}
                    <span>{g.total}</span>
                  </div>
                  {g.items.map((hit) => {
                    const index = hits.findIndex(
                      (item) => item.groupKey === g.key && item.id === hit.id,
                    );
                    const selected = index === activeIndex;
                    return (
                      <button
                        key={`${g.key}-${hit.id}`}
                        id={`adm-search-hit-${index}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`adm-search-item${selected ? ' is-active' : ''}`}
                        ref={selected ? activeItemRef : undefined}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(hit.link)}
                      >
                        <span className="adm-search-item-title">{hit.title}</span>
                        <span className="adm-search-item-sub">{hit.subtitle}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="adm-search-footer" aria-hidden>
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> 选择
                </span>
                <span>
                  <kbd>Enter</kbd> 打开
                </span>
                <span>
                  <kbd>Esc</kbd> 关闭
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminLayout({ children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdmin();
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** 紧凑表格：一屏多看几行，偏好存本地 */
  const [compact, setCompact] = useState(
    () => localStorage.getItem(DENSITY_KEY) === 'compact',
  );
  /** 窄屏 (≤900px) 时侧栏不再是一列图标, 改为抽屉导航 */
  const [isNarrow, setIsNarrow] = useState(false);
  /** 有未保存变更时, 待跳转的目标路径; 非 null 即弹确认框 */
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  // 窄屏自动折叠: 后台最小使用宽度 1280, 更窄时侧栏收为图标栏
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  /*
   * 窄屏下侧栏变成"只有一列图标、不能展开"的半残状态: 之前的折叠按钮只管 collapsed,
   * 而抽屉的 open 状态全仓没有任何地方置 true。手机上因此**没有任何导航入口**。
   * 这里在 ≤900px 时把折叠按钮改为打开抽屉。
   */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // 按权限过滤: 无权项不渲染
  const groups = useMemo(
    () =>
      ADMIN_MENU.map((g) => ({
        ...g,
        items: g.items.filter((it) => it.permission === null || can(it.permission)),
      })).filter((g) => g.items.length > 0),
    [can],
  );

  // 精确匹配, 不做前缀匹配 —— 否则 /admin/users 会同时激活「平台概览」(/admin)
  const activePath = location.pathname.replace(/\/$/, '') || '/admin';

  // 待建模块也允许点击: 跳到占位页给出明确反馈, 而不是点了没反应
  // (完全禁用会让用户以为页面坏了, 也不如明确告知「尚未开放」)
  const go = (to: string) => {
    if (hasUnsavedChanges()) {
      setLeaveTo(to);
      return;
    }
    navigate(to);
    setMobileNavOpen(false);
  };

  /*
   * 站内链接统一拦截。侧栏按钮走 `go`, 页面内的 <Link>/<a> 走这里 ——
   * 编辑页有未保存变更时先确认再放行, 避免"点一下导航, 半天的修改没了"。
   * 站外链接、锚点、带修饰键的点击 (新标签打开) 一律不拦。
   */
  const onClickCapture = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    const href = anchor?.getAttribute('href') ?? '';
    if (!href.startsWith('/')) return;
    const here = `${window.location.pathname}${window.location.search}`;
    if (href === here) return;
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    setLeaveTo(href);
  };

  const navList = (
    <nav className="adm-sider-nav">
      {groups.map((g) => (
        <div key={g.name} className="adm-sider-group">
          <div className="adm-sider-group-title">{collapsed ? '' : g.name}</div>
          {g.items.map((it) => {
            const Icon = it.icon;
            const isActive = activePath === it.path;
            const btn = (
              <button
                key={it.path}
                type="button"
                className={`adm-sider-item${isActive ? ' is-active' : ''}${it.planned ? ' is-planned' : ''}`}
                onClick={() => go(it.path)}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? it.label + (it.planned ? ' (待开放)' : '') : undefined}
              >
                <Icon size={18} className="adm-sider-item-icon" />
                {!collapsed && <span className="adm-sider-item-label">{it.label}</span>}
                {!collapsed && it.planned && <span className="adm-sider-item-tag">待建</span>}
              </button>
            );
            return collapsed ? (
              <Tooltip key={it.path} title={it.label} placement="right">
                {btn}
              </Tooltip>
            ) : (
              btn
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <Layout className={`adm-layout${compact ? ' is-compact' : ''}`} onClickCapture={onClickCapture}>
      <a className="adm-skip-link" href="#adm-main">
        跳到主要内容
      </a>
      <Layout.Header className="adm-header">
        <div className="adm-header-left">
          <button
            type="button"
            className="adm-collapse-btn"
            onClick={() => (isNarrow ? setMobileNavOpen(true) : setCollapsed((c) => !c))}
            aria-label={isNarrow ? '打开导航菜单' : collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <Menu size={18} />
          </button>
          <Link to="/admin" className="adm-brand" aria-label="货觉 AI 运营后台首页">
            <img className="adm-brand-mark" src="/brand/huojue-mark.svg" alt="" />
            <span className="adm-brand-name">
              货觉<span>运营后台</span>
            </span>
          </Link>
          <EnvironmentBadge />
        </div>

        <div className="adm-header-right">
          <Tooltip title={compact ? '切换为宽松列表' : '切换为紧凑列表'}>
            <button
              type="button"
              className="adm-icon-btn"
              aria-label={compact ? '切换为宽松列表' : '切换为紧凑列表'}
              aria-pressed={compact}
              onClick={() => {
                const next = !compact;
                setCompact(next);
                localStorage.setItem(DENSITY_KEY, next ? 'compact' : 'comfortable');
              }}
            >
              {compact ? <Rows3 size={17} /> : <Rows4 size={17} />}
            </button>
          </Tooltip>
          <GlobalSearch canSearch={can('data.search')} onNavigate={navigate} />
          <AdminAlertBell />
          <Dropdown
            menu={{
              items: [
                { key: 'email', label: me?.email ?? '', icon: <User size={14} />, disabled: true },
                { type: 'divider' as const },
                {
                  key: 'frontend',
                  label: '返回前台',
                  onClick: () => navigate('/workbench'),
                },
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
            <button type="button" className="adm-user" aria-label="打开用户菜单">
              <Avatar size={26} className="adm-user-avatar">
                {(me?.email ?? 'A').charAt(0).toUpperCase()}
              </Avatar>
              <span className="adm-user-name">{me?.roleLabel ?? '加载中'}</span>
              <ChevronDown className="adm-user-chevron" size={14} />
            </button>
          </Dropdown>
        </div>
      </Layout.Header>

      <Layout className="adm-body">
        <div className={`adm-sider${collapsed ? ' is-collapsed' : ''}`}>{navList}</div>

        <Drawer
          title="导航菜单"
          placement="left"
          size={280}
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          className="adm-mobile-drawer"
          extra={
            <Button type="text" icon={<X size={16} />} onClick={() => setMobileNavOpen(false)} />
          }
        >
          <div className="adm-sider is-mobile">{navList}</div>
        </Drawer>

        <Layout.Content id="adm-main" className="adm-content" tabIndex={-1}>
          {children}
        </Layout.Content>
      </Layout>

      {/* 未保存变更的离开确认: 用 antd Modal, Esc 可关、焦点被限制在框内 */}
      <Modal
        open={leaveTo !== null}
        title="有未保存的变更"
        okText="放弃变更并离开"
        cancelText="留下继续编辑"
        okButtonProps={{ danger: true }}
        onOk={() => {
          const to = leaveTo;
          setLeaveTo(null);
          if (to) navigate(to);
        }}
        onCancel={() => setLeaveTo(null)}
      >
        当前页面有修改还没保存，离开后这些修改会丢失。
      </Modal>
    </Layout>
  );
}

/**
 * 概览加载态: 保持布局稳定, 避免内容跳动。
 *
 * 2026-10-20: 与 `AdminWidgets.tsx` 的 `AdminListLoading` 是同一个东西
 * (同 class 同结构), 此处是第二份实现。现改为转出, 避免两处各改各的。
 */
export { AdminListLoading as AdminPageLoading } from './AdminWidgets';
