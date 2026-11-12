import type { ReactNode } from 'react';

/** 扫码确认页的统一页壳：居中卡片。 */
export function QrConfirmCard({ children }: { children: ReactNode }) {
  return (
    <div className="qr-confirm-page">
      <div className="qr-confirm-card">{children}</div>
    </div>
  );
}
