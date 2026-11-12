import type { ReactNode } from 'react';

/** 分组选项的标签原子：名称 + 计数，两层 ToggleGroup 共用 */
export function LibraryGroupOptionLabel({ label, count }: { label: ReactNode; count: number }) {
  return (
    <>
      {label}
      <em className="asset-library-group-count">{count}</em>
    </>
  );
}
