import type { KeyboardEvent, ReactNode } from 'react';

/**
 * 作品卡浮层里的一个操作原子。
 *
 * 浮层整体是 `<span>`（卡片里不能嵌 `<button>` 包住媒体），这里统一补上
 * `role="button"` / `tabIndex` / 回车与空格键处理 —— 四个操作不再各写一遍。
 */
export interface WorkCardActionProps {
  onActivate: () => void;
  /** 删除等破坏性操作用红色 */
  danger?: boolean;
  children: ReactNode;
}

export function WorkCardAction({ onActivate, danger, children }: WorkCardActionProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      className={danger ? 'is-danger' : undefined}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
    >
      {children}
    </span>
  );
}
