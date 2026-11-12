import { ShieldAlert } from 'lucide-react';

import { QrConfirmCard } from './QrConfirmCard';

/** 缺少 ticket：二维码无效。 */
export function QrInvalidState() {
  return (
    <QrConfirmCard>
      <ShieldAlert size={36} className="qr-confirm-icon is-warn" />
      <h1 className="qr-confirm-title">二维码无效</h1>
      <p className="qr-confirm-desc">请回到电脑端重新生成二维码后再扫。</p>
    </QrConfirmCard>
  );
}
