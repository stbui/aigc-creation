import { useNavigate } from 'react-router-dom';

/** 商品图三个工作台入口 */
export type ToolTypeKey = 'product-kit' | 'product-detail' | 'viral-clone';

const TOOL_TABS: Array<{ key: ToolTypeKey; label: string; path: string }> = [
  { key: 'product-kit', label: '商品主图', path: '/product-kit' },
  { key: 'product-detail', label: '商品详情', path: '/product-detail' },
  { key: 'viral-clone', label: '爆款复刻', path: '/viral-clone' },
];

/**
 * 业务类型切换 tab（商品主图 / 商品详情 / 爆款复刻）。
 *
 * 这是跨页导航；右栏「功能示例 / 创作结果」是同一页内的面板页签，两者
 * 不应都叫 Tabs。参考站只在窄屏显示这组 tab（桌面端 `display: none`），
 * 显隐交给 `pk-editor-tabs` 的样式。
 */
export function ToolTypeTabs({ active }: { active: ToolTypeKey }) {
  const navigate = useNavigate();

  return (
    <div className="pk-editor-tabs" role="tablist" aria-label="业务类型">
      {TOOL_TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`pk-editor-tab${selected ? ' pk-editor-tab-active' : ''}`}
            onClick={() => {
              if (!selected) navigate(tab.path);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
