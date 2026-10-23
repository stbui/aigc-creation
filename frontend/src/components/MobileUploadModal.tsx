import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import { mobileUploadApi } from '../lib/api';
import { useProject } from '../hooks/useProject';
import type { MobileUploadAsset } from '../types/api';

/**
 * 手机上传二维码弹窗 —— 1:1 复刻参考站 (ijihua.cn/free-creation) 的
 * `mobile-upload-modal` 弹窗。
 *
 * ## 参考站实拍数值 (2026-10-20 取证: 线上样式表 index-glaqVozH.css)
 *
 *   backdrop   inset 0, 背景 #14122180, grid 居中, padding 20
 *   modal      宽 min(440px, 100vw-40px), 圆角 20, 白底, 阴影 0 24px 80px #1c163b3d
 *              padding 30px 30px 26px, 居中
 *   close      32x32 圆形, 底 #f4f4f7, 色 #666, 绝对定位 top/right 14px
 *   h2         20px, 色 #24212f, margin 10px 0 8px
 *   p          13px, 色 #777181, 行高 1.65, 居中
 *   small      12px, 色 #9893a3
 *   qr-box     250x250, 底 #faf9fd, 边框 #ebe8f4, 圆角 14, 居中
 *   qr-state   13px, 色 #777181, flex 居中 gap 8
 *   waiting    色 #6550c9, 13px, flex 居中 gap 7, margin-top 14
 *   refresh    底 #765ce7, 白字, 圆角 8, padding 8px 14px, margin-top 14
 *
 * ## 文案 (取自参考站 bundle 反混淆)
 *
 *   标题「手机上传」/ 说明「使用手机扫描二维码…」/ 等待「手机扫码上传」
 *   状态「等待扫码完成」/ 过期「二维码已失效，请重新生成二维码」/ 「取消手机上传」
 *
 * ## 流程
 *
 *   电脑端建会话 → 渲染二维码 → 手机扫码打开落地页选图上传
 *   → 电脑端轮询会话状态 → 拿到全部素材 → 一次性回填参考图位
 */

/** 轮询间隔 (毫秒) —— 1.2s 与全站生成任务轮询一致 */
const POLL_MS = 1200;

export interface MobileUploadModalProps {
  open: boolean;
  /**
   * 手机端收到图片后回调。
   *
   * ⚠️ 参考站支持一次多张, 故这里传**数组**且**顺序即构图顺序** ——
   * 电脑端按此顺序把图片放进参考图位。
   */
  onReceived: (assets: MobileUploadAsset[]) => void;
  onCancel: () => void;
}

export function MobileUploadModal({ open, onReceived, onCancel }: MobileUploadModalProps) {
  const { message } = App.useApp();
  const { ensureProject } = useProject();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  /** 已回调过, 防止轮询里重复 onReceived */
  const deliveredRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const openedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 关闭时清掉定时器, 否则会在弹窗关闭后继续发请求
  useEffect(() => stopPolling, [stopPolling]);

  /** 轮询会话状态 */
  const poll = useCallback(
    (id: string) => {
      timerRef.current = window.setTimeout(async () => {
        try {
          const st = await mobileUploadApi.status(id);
          if (st.status === 'received' && (st.assets?.length ?? 0) > 0) {
            if (!deliveredRef.current) {
              deliveredRef.current = true;
              stopPolling();
              onReceived(st.assets);
            }
            return;
          }
          if (st.status === 'expired') {
            setExpired(true);
            stopPolling();
            return;
          }
          poll(id);
        } catch {
          // 轮询失败不弹窗刷屏 (每 1.2s 一次) —— 下一轮继续试
          poll(id);
        }
      }, POLL_MS);
    },
    [onReceived, stopPolling],
  );

  /** 建会话 + 生成二维码 */
  const start = useCallback(async () => {
    setLoading(true);
    setExpired(false);
    deliveredRef.current = false;
    try {
      const projectId = await ensureProject();
      const s = await mobileUploadApi.create(projectId);
      setSessionId(s.sessionId);
      setExpiresAt(s.expiresAt);

      // 二维码内容 = 手机端页面地址 (带 sessionId 与 token)
      const url = buildMobilePageUrl(s.sessionId, s.token);
      const dataUrl = await QRCode.toDataURL(url, {
        width: 240,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#171A2B', light: '#FFFFFF' },
      });
      setQrDataUrl(dataUrl);
      poll(s.sessionId);
    } catch (e) {
      message.error((e as Error).message || '二维码生成失败');
    } finally {
      setLoading(false);
    }
  }, [ensureProject, message, poll]);

  // 打开时建会话; 关闭时重置
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      void start();
    }
    if (!open) {
      openedRef.current = false;
      deliveredRef.current = false;
      stopPolling();
      setSessionId(null);
      setQrDataUrl(null);
      setExpired(false);
    }
  }, [open, start, stopPolling]);

  const close = () => {
    stopPolling();
    // 通知后端清理会话 (失败不打扰用户 —— 会话本就有 TTL 兜底)
    if (sessionId) {
      void mobileUploadApi.cancel(sessionId).catch(() => undefined);
    }
    onCancel();
  };

  const remainSec = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0;

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width={440}
      centered
      className="mum-modal"
      closeIcon={null}
      styles={{
        body: { padding: 0 },
        // 参考站 backdrop: #14122180 (不带模糊)。antd 默认是 45% 纯黑, 比参考站更重。
        mask: { background: '#14122180' },
      }}
      title={null}
    >
      <div className="mum">
        <button type="button" className="mum-close" aria-label="取消手机上传" onClick={close}>
          <X size={16} />
        </button>

        <h2 className="mum-title">手机上传</h2>
        <p className="mum-desc">使用手机扫描二维码，选择或拍摄图片上传到电脑</p>

        {loading && !qrDataUrl ? (
          <div className="mum-qr-box">
            <div className="mum-qr-state">
              <Spin size="small" />
              <span>正在生成二维码…</span>
            </div>
          </div>
        ) : expired ? (
          <>
            <div className="mum-qr-box">
              <div className="mum-qr-state is-error">二维码已失效，请重新生成二维码</div>
            </div>
            <button type="button" className="mum-refresh" onClick={() => void start()}>
              <RefreshCw size={13} />
              刷新二维码
            </button>
          </>
        ) : (
          <>
            <div className="mum-qr-box">
              {qrDataUrl && <img src={qrDataUrl} alt="手机上传二维码" />}
            </div>
            <div className="mum-waiting">
              <Spin size="small" />
              <span>手机扫码上传 · 等待扫码完成</span>
            </div>
            {remainSec > 0 && <small className="mum-expiry">{remainSec} 秒后失效</small>}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * 手机端页面地址。
 *
 * ⚠️ **用当前页面的 origin 而不是写死 localhost**:
 * 手机扫码后要能真的打开这个地址 —— 本地开发时前端跑在 5100,
 * 写死端口在反向代理/换端口的部署下就会指错地方。
 * 取 `window.location.origin` 保证与用户当前访问的站点一致。
 */
function buildMobilePageUrl(sessionId: string, token: string): string {
  const origin = window.location.origin;
  return `${origin}/mobile-upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
}
