import { ShieldAlert } from 'lucide-react';

import { QrConfirmCard } from './QrConfirmCard';

/** 缺少 ticket：二维码无效。 */
export function QrInvalidState() {
  return (
    <QrConfirmCard>
      <ShieldAlert size={36} className="mb-3 text-danger-text" />
      <h1 className="mx-0 mt-0 mb-2 text-lg font-semibold text-foreground">二维码无效</h1>
      <p className="mx-0 mt-0 mb-5 text-[13px] leading-[21px] text-[color:var(--text-muted)]">
        请回到电脑端重新生成二维码后再扫。
      </p>
    </QrConfirmCard>
  );
}
