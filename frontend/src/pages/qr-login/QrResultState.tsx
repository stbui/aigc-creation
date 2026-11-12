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
        <CheckCircle2 size={36} className="qr-confirm-icon is-ok" />
      ) : (
        <XCircle size={36} className="qr-confirm-icon is-warn" />
      )}
      <h1 className="qr-confirm-title">{confirmed ? '已确认登录' : '已取消登录'}</h1>
      <p className="qr-confirm-desc">
        {confirmed ? '请回到电脑端，页面会自动进入。' : '电脑端不会登录。如需登录请重新扫码。'}
      </p>
    </QrConfirmCard>
  );
}
