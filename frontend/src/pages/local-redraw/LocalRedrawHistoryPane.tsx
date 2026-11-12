import { memo } from 'react';
import { ChevronRight, ChevronUp, History } from 'lucide-react';

import type { ToolHistoryTask } from './hooks';
import { Drawer, ToolHistoryGrid } from './components';

interface LocalRedrawHistoryPaneProps {
  tasks: ToolHistoryTask[];
  loading: boolean;
  error: string | null;
  /** 桌面右栏是否收起；页面根类 `history-collapsed` 依赖它 */
  collapsed: boolean;
  /** 窄屏抽屉开关；选中历史产出后由页面关闭 */
  drawerOpen: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
  onRetry: () => void;
}

/**
 * 局部重绘历史栏：桌面右栏 + 收起后的浮动按钮 + 窄屏抽屉。
 *
 * 用 `memo` 隔离：页面每输入一个描述字符都会重渲染，而历史数据与折叠态
 * 都没变时应跳过这棵子树（最多 24 张历史卡）。
 */
export const LocalRedrawHistoryPane = memo(function LocalRedrawHistoryPane({
  tasks,
  loading,
  error,
  collapsed,
  drawerOpen,
  onToggle,
  onExpand,
  onOpenDrawer,
  onCloseDrawer,
  onRetry,
}: LocalRedrawHistoryPaneProps) {
  const toggleLabel = collapsed ? '展开历史记录' : '收起历史记录';

  return (
    <>
      <aside className="redraw-history-pane" aria-label="局部重绘历史记录">
        <div className="redraw-history-head">
          <h2>
            <History size={15} />
            历史记录
          </h2>
          <button
            type="button"
            className="redraw-history-collapse"
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            title={toggleLabel}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        <div className="redraw-history-scroll">
          <ToolHistoryGrid
            tasks={tasks}
            loading={loading}
            error={error}
            emptyText=""
            onRetry={onRetry}
          />
        </div>
      </aside>

      <button
        type="button"
        className="redraw-history-float-toggle"
        aria-label="历史记录"
        title="历史记录"
        onClick={() => {
          // 桌面端右栏收起后，浮动按钮把右栏展开；窄屏没有右栏，改用抽屉。
          if (window.matchMedia('(max-width: 1180px)').matches) onOpenDrawer();
          else onExpand();
        }}
      >
        <History size={16} />
      </button>

      <Drawer
        title="历史记录"
        open={drawerOpen}
        onClose={onCloseDrawer}
        size={320}
        styles={{ body: { padding: 12 } }}
      >
        <ToolHistoryGrid
          tasks={tasks}
          loading={loading}
          error={error}
          emptyText=""
          onRetry={onRetry}
        />
      </Drawer>
    </>
  );
});
