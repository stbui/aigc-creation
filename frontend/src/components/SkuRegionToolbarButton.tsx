import type { ReactNode } from 'react';

/**
 * SKU 区域编辑器工具条上的图标按钮。
 *
 * 2026-11-15 从 `SkuRegionEditorModal` 抽出：工具条与底部操作条共用同一形态
 * （图标 + aria-label + active 态），抽出后两处不再各写一遍 className 判断。
 */
interface Props {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}

export function SkuRegionToolbarButton({ active, disabled, label, onClick, children }: Props) {
  return (
    <button
      type="button"
      className={active ? 'active' : undefined}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
