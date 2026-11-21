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

/** 确认态里的说明行（普通 / 告警两种语气） */
const DESC = 'mx-0 mt-0 mb-5 text-[13px] leading-[21px]';

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
      <MonitorSmartphone size={36} className="mb-3 text-brand" />
      <h1 className="mx-0 mt-0 mb-2 text-lg font-semibold text-foreground">
        确认在这台设备上登录？
      </h1>

      {scanError ? (
        <p className={`${DESC} text-danger-text`}>{scanError}</p>
      ) : (
        <>
          <div className="mb-3.5 w-full space-y-1.5 rounded-md bg-muted px-3.5 py-3 text-left">
            <div className="flex justify-between gap-3 text-xs leading-5 text-[color:var(--text-desc)]">
              <span>IP 地址</span>
              <strong className="font-semibold text-[color:var(--text-body)]">
                {scan?.desktop?.ip ?? '未知'}
              </strong>
            </div>
            <div className="flex justify-between gap-3 text-xs leading-5 text-[color:var(--text-desc)]">
              <span>设备</span>
              {/* UA 可能很长: 允许换行而不是撑破卡片 */}
              <strong className="max-w-[220px] text-right font-semibold text-[color:var(--text-body)] [overflow-wrap:anywhere]">
                {scan?.desktop?.ua ?? '未知'}
              </strong>
            </div>
          </div>
          <p className={`${DESC} text-[color:var(--text-muted)]`}>
            如果这不是你自己的设备，请不要确认 —— 确认后该设备将直接登录你的账号。
          </p>
        </>
      )}

      <div className="mt-auto flex w-full flex-col gap-2.5">
        <Button className="w-full" size="lg" disabled={busy} onClick={() => onDecide(false)}>
          不是我，取消
        </Button>
        <Button
          variant="default"
          className="w-full login-submit"
          size="lg"
          disabled={Boolean(scanError) || !scan || busy}
          onClick={() => onDecide(true)}
        >
          {busy && <span className="state-spinner is-small" aria-hidden />}
          确认登录
        </Button>
      </div>
    </QrConfirmCard>
  );
}
