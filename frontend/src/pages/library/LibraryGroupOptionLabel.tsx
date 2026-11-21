/** 分组选项的标签原子：名称 + 计数，两层 ToggleGroup 共用 */
export interface LibraryGroupOptionLabelProps {
  label: string;
  count: number;
}

export function LibraryGroupOptionLabel({ label, count }: LibraryGroupOptionLabelProps) {
  return (
    <>
      {label}
      <em className="text-xs not-italic text-muted-foreground group-data-[state=on]:text-brand-hover">{count}</em>
    </>
  );
}
