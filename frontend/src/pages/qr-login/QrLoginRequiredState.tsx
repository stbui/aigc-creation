import { MonitorSmartphone } from 'lucide-react';

import { Button } from './components';
import { QrConfirmCard } from './QrConfirmCard';

interface QrLoginRequiredStateProps {
  onLogin: () => void;
}

/** 手机未登录：引导登录后回到本页。 */
export function QrLoginRequiredState({ onLogin }: QrLoginRequiredStateProps) {
  return (
    <QrConfirmCard>
      <MonitorSmartphone size={36} className="qr-confirm-icon" />
      <h1 className="qr-confirm-title">请在手机上登录后确认</h1>
      <p className="qr-confirm-desc">
        扫码登录需要你在手机上有一个已登录的账号。登录后会自动回到本页，二维码在 2 分钟内有效。
      </p>
      <Button type="primary" size="large" block className="login-submit" onClick={onLogin}>
        去登录
      </Button>
    </QrConfirmCard>
  );
}
