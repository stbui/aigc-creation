import { MonitorSmartphone } from 'lucide-react';

import type { QrStatusResult } from '../../types/api';
import { Button } from './components';
import { QrConfirmCard } from './QrConfirmCard';

interface QrConfirmStateProps {
  scan: QrStatusResult | null;
  scanError: string | null;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}

/**
 * 确认态：展示发起端 IP 与 UA，等用户自己判断。
 *
 * 必须展示发起端信息：扫码登录的信任模型是「我认出这台设备是我自己的」。
 * 不展示就等于让用户凭空白点确认 —— 攻击者把自己的二维码发给受害者，
 * 受害者一点确认，攻击者的电脑就登进了受害者的账号。
 */
export function QrConfirmState({ scan, scanError, busy, onDecide }: QrConfirmStateProps) {
  return (
    <QrConfirmCard>
      <MonitorSmartphone size={36} className="qr-confirm-icon" />
      <h1 className="qr-confirm-title">确认在这台设备上登录？</h1>

      {scanError ? (
        <p className="qr-confirm-desc is-warn">{scanError}</p>
      ) : (
        <>
          <div className="qr-confirm-device">
            <div className="qr-confirm-device-row">
              <span>IP 地址</span>
              <strong>{scan?.desktop?.ip ?? '未知'}</strong>
            </div>
            <div className="qr-confirm-device-row">
              <span>设备</span>
              <strong className="qr-confirm-ua">{scan?.desktop?.ua ?? '未知'}</strong>
            </div>
          </div>
          <p className="qr-confirm-desc">
            如果这不是你自己的设备，请不要确认 —— 确认后该设备将直接登录你的账号。
          </p>
        </>
      )}

      <div className="qr-confirm-actions">
        <Button block size="large" disabled={busy} onClick={() => onDecide(false)}>
          不是我，取消
        </Button>
        <Button
          type="primary"
          block
          size="large"
          className="login-submit"
          loading={busy}
          disabled={Boolean(scanError) || !scan}
          onClick={() => onDecide(true)}
        >
          确认登录
        </Button>
      </div>
    </QrConfirmCard>
  );
}
