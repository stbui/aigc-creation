import type { ReactNode } from 'react';

/** 表单字段容器 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** 校验错误文案（高危操作的必填原因用） */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {error ? (
        <p className="text-[11px] leading-4 text-rose-600">{error}</p>
      ) : (
        hint && <p className="text-[11px] leading-4 text-text-tertiary">{hint}</p>
      )}
    </div>
  );
}
