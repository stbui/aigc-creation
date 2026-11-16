import { useCallback, useEffect, useState } from 'react';
import { adminNotificationsApi } from './api';
import { useToast } from './hooks';
import type { DeliveryChannelStatus, EmailTestResult } from './types';
import { emailErrorText } from './utils';

/**
 * 邮件通道的运行状态与测试发信。
 *
 * 与 `useEmailConfig` 分开是因为两者的失败含义不同：配置没拉到就没法编辑，
 * 而通道状态读不到只影响「现在到底能不能真发」的判断，配置仍然可以保存。
 * 共用一份 error 会让后者把整页顶进错误态。
 *
 * `canInspect` 为假时直接短路，一次请求都不发 —— 无测试发信权限的账号看不到
 * 通道状态，也不该因为别人的状态接口报错而被挡在页面外。
 */
export function useEmailChannel(canInspect: boolean) {
  const toast = useToast();
  const [channel, setChannel] = useState<DeliveryChannelStatus | null>(null);
  const [loading, setLoading] = useState(canInspect);
  const [error, setError] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);

  const reload = useCallback(async () => {
    if (!canInspect) {
      setChannel(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    try {
      const next = await adminNotificationsApi.channels();
      setChannel(next.email);
      setError(false);
    } catch {
      setChannel(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canInspect]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 测试发信。
   *
   * 三条结果分开提示：服务商受理 ≠ 用户收到、本地记录 = 根本没发、失败 = 要
   * 去查配置。文案由后端 `ok` / `delivered` 决定，前端不重推结论。
   */
  const sendTest = async (to: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await adminNotificationsApi.testEmail(to);
      setTestResult(result);
      if (result.ok) {
        if (result.delivered) {
          toast.success(
            '测试邮件已提交至邮件服务商',
            '请检查收件箱与垃圾邮件目录；服务商受理不代表最终送达。',
          );
        } else {
          toast.warning('测试邮件已记录在本地', '当前通道不会实际发送邮件。');
        }
      } else {
        toast.error('测试邮件发送失败', emailErrorText(result.error));
      }
    } catch (cause) {
      toast.error(
        '测试邮件发送失败',
        cause instanceof Error ? cause.message : '请检查通道配置后重试。',
      );
    } finally {
      setTesting(false);
    }
  };

  return { channel, loading, error, testing, testResult, reload, sendTest };
}

export type EmailChannelState = ReturnType<typeof useEmailChannel>;
