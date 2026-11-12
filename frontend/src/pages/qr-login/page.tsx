import { useNavigate, useSearchParams } from 'react-router-dom';

import { QR_LOGIN_PAGE_META } from './constants';
import { useAuth, useDocumentMeta, useQrLogin } from './hooks';
import { QrConfirmState } from './QrConfirmState';
import { QrInvalidState } from './QrInvalidState';
import { QrLoginRequiredState } from './QrLoginRequiredState';
import { QrResultState } from './QrResultState';

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
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：页壳 `QrConfirmCard`，
 * 无效 / 待登录 / 待确认 / 已处理四态分别是 `QrInvalidState` /
 * `QrLoginRequiredState` / `QrConfirmState` / `QrResultState`；scan / confirm
 * 与忙碌态落 `hooks.ts` 的 `useQrLogin`。
 */
export function QrLoginPage() {
  useDocumentMeta(QR_LOGIN_PAGE_META.title, QR_LOGIN_PAGE_META.description);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const ticket = params.get('ticket') ?? '';
  const { scan, scanError, result, busy, decide } = useQrLogin(ticket, token);

  // 登录后回到本页：把当前完整路径塞进 redirect，登录成功由 LoginPage 负责跳回
  const goLogin = () => {
    const here = `/qr-login?ticket=${encodeURIComponent(ticket)}`;
    navigate(`/login?redirect=${encodeURIComponent(here)}`);
  };

  if (!ticket) return <QrInvalidState />;
  if (!token) return <QrLoginRequiredState onLogin={goLogin} />;
  if (result) return <QrResultState result={result} />;
  return (
    <QrConfirmState
      scan={scan}
      scanError={scanError}
      busy={busy}
      onDecide={(approve) => void decide(approve)}
    />
  );
}
