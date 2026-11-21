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
      <MonitorSmartphone size={36} className="mb-3 text-brand" />
      <h1 className="mx-0 mt-0 mb-2 text-lg font-semibold text-foreground">
        请在手机上登录后确认
      </h1>
      <p className="mx-0 mt-0 mb-5 text-[13px] leading-[21px] text-[color:var(--text-muted)]">
        扫码登录需要你在手机上有一个已登录的账号。登录后会自动回到本页，二维码在 2 分钟内有效。
      </p>
      <Button variant="default" size="lg" className="w-full login-submit" onClick={onLogin}>
        去登录
      </Button>
    </QrConfirmCard>
  );
}
