import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { RotateCw } from 'lucide-react';
import { authApi } from '../lib/api';
import type { QrSessionStatus } from '../types/api';

/**
 * 扫码登录面板（B8）。
 *
 * 桌面端职责只有两件：把票据渲染成二维码、按建议间隔轮询状态。
 * 「扫了」与「授权」是两个不同状态，界面上必须分开展示 —— 用户需要知道
 * 是对方还没确认，还是自己的手机根本没扫成功。
 *
 * 票据有效期只有 2 分钟（`ttlSeconds`），过期后必须显式重试而不是无限轮询：
 * 无限轮询既拿不到结果，也会把限流配额耗光。
 */
export interface QrLoginPanelProps {
  onSuccess: (token: string, email: string, role?: string) => void;
}

interface QrView {
  ticket: string;
  dataUrl: string;
  expiresAt: number;
  pollIntervalMs: number;
}

const STATUS_TEXT: Record<QrSessionStatus, string> = {
  pending: '打开手机上的货觉AI，扫描二维码登录',
  scanned: '已扫码，请在手机上确认登录',
  confirmed: '登录成功，正在进入…',
  consumed: '该二维码已使用，请刷新',
  expired: '二维码已过期，请刷新',
  cancelled: '已在手机上取消登录',
};

export function QrLoginPanel({ onSuccess }: QrLoginPanelProps) {
  const [view, setView] = useState<QrView | null>(null);
  const [status, setStatus] = useState<QrSessionStatus>('pending');
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 轮询回调在定时器里执行, 用 ref 拿最新的 onSuccess 避免重建定时器
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;
  // 每次刷新自增, 让上一轮的异步轮询自行作废
  const epochRef = useRef(0);

  const start = useCallback(async () => {
    const epoch = ++epochRef.current;
    setLoading(true);
    setError(null);
    setStatus('pending');
    try {
      const res = await authApi.qrCreate();
      // 手机扫码后打开确认页; 票据在 URL 上, 服务端只存它的哈希
      const link = `${window.location.origin}/qr-login?ticket=${encodeURIComponent(res.ticket)}`;
      const dataUrl = await QRCode.toDataURL(link, {
        width: 220,
        margin: 1,
        color: { dark: '#171a2b', light: '#ffffff' },
      });
      if (epoch !== epochRef.current) return;
      setView({
        ticket: res.ticket,
        dataUrl,
        expiresAt: new Date(res.expiresAt).getTime(),
        pollIntervalMs: res.pollIntervalMs || 1500,
      });
      setRemaining(Math.max(0, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 1000)));
    } catch (e) {
      if (epoch !== epochRef.current) return;
      setError((e as Error).message || '二维码生成失败');
    } finally {
      if (epoch === epochRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void start();
    return () => {
      // 卸载时让在途轮询作废, 避免对已离开的组件 setState
      epochRef.current += 1;
    };
  }, [start]);

  // 倒计时: 到期即停, 由状态轮询把 expired 回来
  useEffect(() => {
    if (!view) return;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.round((view.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  // 轮询: 拿到 token 或进入终态即停
  useEffect(() => {
    if (!view) return;
    const epoch = epochRef.current;
    let stopped = false;
    let timer = 0;

    const tick = async () => {
      try {
        const res = await authApi.qrStatus(view.ticket);
        if (stopped || epoch !== epochRef.current) return;
        setStatus(res.status);
        if (res.status === 'confirmed' && res.accessToken) {
          stopped = true;
          successRef.current(res.accessToken, res.user?.email ?? '', res.user?.role);
          return;
        }
        if (res.status === 'expired' || res.status === 'cancelled' || res.status === 'consumed') {
          stopped = true;
          return;
        }
      } catch (e) {
        if (stopped || epoch !== epochRef.current) return;
        // 单次失败不打断轮询: 网络抖一下不该让用户重扫
        setError((e as Error).message || '查询登录状态失败');
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), view.pollIntervalMs);
    };

    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [view]);

  const retryable = status === 'expired' || status === 'consumed' || status === 'cancelled';

  return (
    <div className="qr-login-panel">
      <div className="qr-login-stage">
        {loading && !view ? (
          <div className="qr-login-placeholder">正在生成二维码…</div>
        ) : error && !view ? (
          <div className="qr-login-placeholder">{error}</div>
        ) : view ? (
          <>
            <img
              className={`qr-login-image${retryable ? ' is-stale' : ''}`}
              src={view.dataUrl}
              width={220}
              height={220}
              alt="扫码登录二维码"
            />
            {retryable && (
              <button type="button" className="qr-login-overlay" onClick={() => void start()}>
                <RotateCw size={16} />
                刷新二维码
              </button>
            )}
          </>
        ) : null}
      </div>

      <p className={`qr-login-hint${status === 'scanned' ? ' is-active' : ''}`}>
        {STATUS_TEXT[status] ?? ''}
      </p>
      {view && !retryable && remaining > 0 && (
        <p className="qr-login-countdown">{remaining}s 后失效</p>
      )}
      {error && view && <p className="qr-login-error">{error}</p>}

      <button type="button" className="qr-login-refresh" onClick={() => void start()} disabled={loading}>
        <RotateCw size={14} />
        重新生成
      </button>
    </div>
  );
}
