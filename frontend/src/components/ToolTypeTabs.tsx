import { Link } from 'react-router-dom';

/** 商品图三个工作台入口 */
export type ToolTypeKey = 'product-kit' | 'product-detail' | 'viral-clone';

const TOOL_TABS: Array<{ key: ToolTypeKey; label: string; path: string }> = [
  { key: 'product-kit', label: '商品主图', path: '/product-kit' },
  { key: 'product-detail', label: '商品详情', path: '/product-detail' },
  { key: 'viral-clone', label: '爆款复刻', path: '/viral-clone' },
];

/**
 * 业务类型入口（商品主图 / 商品详情 / 爆款复刻）。
 *
 * 这是**跨页导航**，不是页签：右栏「功能示例 / 创作结果」才是同一页内的面板页签。
 * 因此这里用 `<Link>` + `aria-current="page"`，读屏会读出「当前页」，
 * 右键 / 新标签页 / 浏览器默认行为也都保留。参考站只在窄屏显示这组入口
 * （桌面端 `display: none`），显隐交给 `pk-editor-tabs` 的样式。
 */
export function ToolTypeTabs({ active }: { active: ToolTypeKey }) {
  return (
    <nav className="pk-editor-tabs" aria-label="业务类型">
      {TOOL_TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.key}
            to={tab.path}
            aria-current={selected ? 'page' : undefined}
            className={`pk-editor-tab${selected ? ' pk-editor-tab-active' : ''}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
