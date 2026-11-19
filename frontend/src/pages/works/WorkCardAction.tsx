import type { KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * 作品卡浮层里的一个操作原子。
 *
 * 浮层整体是 `<span>`（卡片里不能嵌 `<button>` 包住媒体），动作用
 * `role="button"` / `tabIndex` / 回车与空格键处理 —— 四个操作不再各写一遍。
 *
 * 目标本身是路由时传 `to`，渲染成 `<Link>` 保留链接语义（右键、新标签页、
 * 读屏角色）；视觉仍由 `.my-work-action` 统一。
 */
export interface WorkCardActionProps {
  onActivate?: () => void;
  /** 路由目标；与 `onActivate` 二选一 */
  to?: string;
  /** 删除等破坏性操作用红色 */
  danger?: boolean;
  children: ReactNode;
}

export function WorkCardAction({ onActivate, to, danger, children }: WorkCardActionProps) {
  if (to) {
    return (
      <Link className={`my-work-action${danger ? ' is-danger' : ''}`} to={to}>
        {children}
      </Link>
    );
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate?.();
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      className={`my-work-action${danger ? ' is-danger' : ''}`}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
    >
      {children}
    </span>
  );
}
