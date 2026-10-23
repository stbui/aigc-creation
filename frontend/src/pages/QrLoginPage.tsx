import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button } from 'antd';
import { CheckCircle2, MonitorSmartphone, ShieldAlert, XCircle } from 'lucide-react';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { QrStatusResult } from '../types/api';

/**
 * 手机端扫码确认页（B8）。
 *
 * 二维码内容就是本页的 URL（`/qr-login?ticket=...`），手机相机扫开即进入。
 * 页面职责：
 *   1. 未登录 → 引导登录后回到本页（票据在 URL 上，不经过任何存储）
 *   2. 已登录 → 调 scan 拿到**发起端信息**并展示出来，等用户自己判断
 *   3. 用户点确认/取消 → 调 confirm，这是唯一真正绑定账号的一步
 *
 * 为什么一定要展示发起端信息：扫码登录的信任模型是「我认出这台设备是我自己的」。
 * 不展示就等于让用户凭空白点确认 —— 攻击者把自己的二维码发给受害者，受害者
 * 一点确认，攻击者的电脑就登进了受害者的账号。
 */
export function QrLoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = useAuth();
  const ticket = params.get('ticket') ?? '';

  const [scan, setScan] = useState<QrStatusResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<'confirmed' | 'cancelled' | null>(null);
  const [busy, setBusy] = useState(false);

  // 登录后回到本页：把当前完整路径塞进 redirect，登录成功由 LoginPage 负责跳回
  const goLogin = () => {
    const here = `/qr-login?ticket=${encodeURIComponent(ticket)}`;
    navigate(`/login?redirect=${encodeURIComponent(here)}`);
  };

  useEffect(() => {
    if (!ticket || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authApi.qrScan(ticket);
        if (!cancelled) setScan(res);
      } catch (e) {
        if (!cancelled) setScanError((e as Error).message || '二维码无效或已过期');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket, token]);

  const decide = useCallback(
    async (approve: boolean) => {
      setBusy(true);
      try {
        await authApi.qrConfirm(ticket, approve);
        setResult(approve ? 'confirmed' : 'cancelled');
      } catch (e) {
        void message.error((e as Error).message || '操作失败，请回到电脑刷新二维码');
      } finally {
        setBusy(false);
      }
    },
    [ticket, message],
  );

  if (!ticket) {
    return (
      <div className="qr-confirm-page">
        <div className="qr-confirm-card">
          <ShieldAlert size={36} className="qr-confirm-icon is-warn" />
          <h1 className="qr-confirm-title">二维码无效</h1>
          <p className="qr-confirm-desc">请回到电脑端重新生成二维码后再扫。</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="qr-confirm-page">
        <div className="qr-confirm-card">
          <MonitorSmartphone size={36} className="qr-confirm-icon" />
          <h1 className="qr-confirm-title">请在手机上登录后确认</h1>
          <p className="qr-confirm-desc">
            扫码登录需要你在手机上有一个已登录的账号。登录后会自动回到本页，二维码在 2 分钟内有效。
          </p>
          <Button type="primary" size="large" block className="login-submit" onClick={goLogin}>
            去登录
          </Button>
        </div>
      </div>
    );
  }

  if (result) {
    const ok = result === 'confirmed';
    return (
      <div className="qr-confirm-page">
        <div className="qr-confirm-card">
          {ok ? (
            <CheckCircle2 size={36} className="qr-confirm-icon is-ok" />
          ) : (
            <XCircle size={36} className="qr-confirm-icon is-warn" />
          )}
          <h1 className="qr-confirm-title">{ok ? '已确认登录' : '已取消登录'}</h1>
          <p className="qr-confirm-desc">
            {ok ? '请回到电脑端，页面会自动进入。' : '电脑端不会登录。如需登录请重新扫码。'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="qr-confirm-page">
      <div className="qr-confirm-card">
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
          <Button block size="large" disabled={busy} onClick={() => void decide(false)}>
            不是我，取消
          </Button>
          <Button
            type="primary"
            block
            size="large"
            className="login-submit"
            loading={busy}
            disabled={Boolean(scanError) || !scan}
            onClick={() => void decide(true)}
          >
            确认登录
          </Button>
        </div>
      </div>
    </div>
  );
}
