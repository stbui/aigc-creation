/**
 * 投递通道的展示层映射：provider id → 中文名，历史配置错误 → 运营可读文案。
 *
 * 后台的「消息通知」与「邮箱配置」两页共用同一份口径：通道名或错误转写各写一份，
 * 迟早会出现「一处说阿里云、一处说未知通道」。因此放在 `src/lib` 而不是任一页面目录，
 * 页面按各自约定从 `utils` 转出。
 */

export const EMAIL_PROVIDER_LABELS: Record<string, string> = {
  env: '部署环境配置',
  smtp: 'SMTP 邮箱',
  console: '本地记录',
  http: '自定义邮件接口',
  aliyun: '阿里云邮件推送',
  'aliyun-dm': '阿里云邮件推送',
  disabled: '邮件通知已关闭',
  unknown: '未知通道',
};

export const SMS_PROVIDER_LABELS: Record<string, string> = {
  env: '部署环境配置',
  console: '本地记录',
  http: '自定义短信接口',
  'aliyun-sms': '阿里云短信服务',
  disabled: '短信通知已关闭',
  unknown: '未知通道',
};

/** 历史配置错误 → 运营可读文案。未知错误保留原文，便于服务商排障。 */
export const EMAIL_ERROR_COPY: Record<string, string> = {
  '邮件通知已关闭': '邮件通知已关闭，请先启用并保存配置。',
  '邮件通道配置不完整': '邮件投递配置不完整，请补全后重试。',
  '生产环境未配置真实邮件通道，邮件未投递': '生产环境尚未配置可实际发送的邮件通道，邮件未投递。',
  'HTTP API 地址未配置，已回落 console': '邮件接口地址尚未配置，请补全后重试。',
  '阿里云 AccessKey 或发信地址未配置，已回落 console':
    '阿里云 AccessKey 或发信地址尚未配置，请补全后重试。',
  'SMTP 服务器、端口、账号或客户端授权码尚未配置，请补全后重试。':
    'SMTP 服务器、端口、登录账号或客户端授权码尚未配置，请补全后重试。',
  '控制台通道只写本地 outbox，不会真实投递': '当前为本地记录模式，邮件不会实际发送。',
};

/** 将后端通道标识转换为后台可读名称，避免直接暴露实现细节。 */
export function deliveryProviderLabel(
  provider: string,
  channel: 'email' | 'sms' = 'email',
): string {
  const labels = channel === 'sms' ? SMS_PROVIDER_LABELS : EMAIL_PROVIDER_LABELS;
  return labels[provider] ?? (channel === 'sms' ? '其他短信通道' : '其他邮件通道');
}

/** 将历史配置错误转换为运营可读文案；未知错误保留原文，便于服务商排障。 */
export function emailErrorText(
  error: string | null | undefined,
  fallback = '请检查邮箱配置后重试。',
): string {
  const text = String(error ?? '').trim();
  if (!text) return fallback;
  return (
    EMAIL_ERROR_COPY[text] ??
    text
      .replace(/HTTP API/g, '自定义邮件接口')
      .replace(/console/g, '本地记录')
      .replace(/outbox/g, '本地记录')
      .replace(/回落/g, '切换为')
  );
}
