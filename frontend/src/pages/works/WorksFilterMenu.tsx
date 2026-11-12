import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * 筛选浮层的统一外壳：触发按钮 + 计数徽标 + 标题说明。
 *
 * 四个筛选器共用同一套开合、选中态与无障碍标记，避免每个筛选器各写一遍
 * `aria-expanded` / 徽标 / 浮层标题。开关动作由调用方提供（通常先关掉其它浮层）。
 */
export interface WorksFilterMenuProps {
  /** 触发按钮文案 */
  label: string;
  /** 触发按钮的选中态（有任何筛选值时为 true） */
  active: boolean;
  /** 浮层是否展开 */
  open: boolean;
  /** 点击触发按钮：调用方负责关闭其它浮层并切换本浮层 */
  onToggle: () => void;
  /** 浮层标题 */
  title: string;
  /** 标题右侧的一句话说明 */
  hint: string;
  /** 浮层形态类名（business / date / status / task） */
  popoverClassName: string;
  /** 触发按钮上的计数徽标；0 或缺省时不渲染 */
  badge?: number;
  children: ReactNode;
}

export function WorksFilterMenu({
  label,
  active,
  open,
  onToggle,
  title,
  hint,
  popoverClassName,
  badge,
  children,
}: WorksFilterMenuProps) {
  return (
    <div className="my-works-filter-wrap">
      <button
        type="button"
        className={`my-works-filter-trigger${active ? ' active' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        {badge ? <span className="my-works-filter-badge">{badge}</span> : null}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className={`my-works-filter-popover ${popoverClassName}`}>
          <div className="my-works-popover-head">
            <strong>{title}</strong>
            <span>{hint}</span>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
