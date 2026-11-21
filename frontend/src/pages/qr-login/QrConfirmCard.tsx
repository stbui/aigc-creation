import type { ReactNode } from 'react';

/** 扫码确认页的统一页壳：居中卡片。 */
export function QrConfirmCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4 py-6">
      <div className="flex w-full max-w-[380px] flex-col items-center rounded-xl bg-card px-6 py-8 text-center shadow-[0_20px_60px_rgba(23,26,43,0.08)]">
        {children}
      </div>
    </div>
  );
}
