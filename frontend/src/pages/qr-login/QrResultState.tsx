import { CheckCircle2, XCircle } from 'lucide-react';

import { QrConfirmCard } from './QrConfirmCard';

interface QrResultStateProps {
  result: 'confirmed' | 'cancelled';
}

/** 已确认 / 已取消的终态。 */
export function QrResultState({ result }: QrResultStateProps) {
  const confirmed = result === 'confirmed';

  return (
    <QrConfirmCard>
      {confirmed ? (
        <CheckCircle2 size={36} className="mb-3 text-success-text" />
      ) : (
        <XCircle size={36} className="mb-3 text-danger-text" />
      )}
      <h1 className="mx-0 mt-0 mb-2 text-lg font-semibold text-foreground">
        {confirmed ? '已确认登录' : '已取消登录'}
      </h1>
      <p className="mx-0 mt-0 mb-5 text-[13px] leading-[21px] text-[color:var(--text-muted)]">
        {confirmed ? '请回到电脑端，页面会自动进入。' : '电脑端不会登录。如需登录请重新扫码。'}
      </p>
    </QrConfirmCard>
  );
}
