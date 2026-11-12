/**
 * 扫码登录确认页的 hooks —— 目录内文件的唯一 hooks 入口。
 */

import { useCallback, useEffect, useState } from 'react';

import type { QrStatusResult } from '../../types/api';
import { useApp } from '../../ui';
import { authApi } from './api';

/** 登录态: 未登录先引导到登录页 */
export { useAuth } from '../../context/AuthContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 全局反馈 (message) */
export { useApp } from '../../ui';

/**
 * 扫码票据状态。
 *
 * 已登录时调 scan 取发起端信息（IP / UA）供用户判断；确认或取消走 confirm，
 * 这是唯一真正绑定账号的一步。票据只在 URL 上，不经过任何存储。
 */
export function useQrLogin(ticket: string, token: string | null) {
  const { message } = useApp();
  const [scan, setScan] = useState<QrStatusResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<'confirmed' | 'cancelled' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await authApi.qrScan(ticket);
        if (!cancelled) setScan(response);
      } catch (cause) {
        if (!cancelled) setScanError((cause as Error).message || '二维码无效或已过期');
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
      } catch (cause) {
        void message.error((cause as Error).message || '操作失败，请回到电脑刷新二维码');
      } finally {
        setBusy(false);
      }
    },
    [ticket, message],
  );

  return { scan, scanError, result, busy, decide };
}
