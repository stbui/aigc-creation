/**
 * 邮箱配置的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import {
  EMAIL_ERROR_COPY,
  EMAIL_FIELD_COPY,
  EMAIL_GROUP_KEY,
  EMAIL_KEYS,
  EMAIL_PROVIDER_LABELS,
  EVENT_GROUPS,
  PROVIDERS,
  SMS_PROVIDER_LABELS,
} from './constants';
import type {
  AdminSettings,
  EmailFieldCopy,
  EmailPageTab,
  EmailProvider,
  EmailRuntimeState,
  EmailSettingItem,
  EmailTemplateMeta,
} from './types';

export { cn } from '~/admin-ui/lib/cn';

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

export function providerMeta(provider: string) {
  return PROVIDERS.find((item) => item.value === provider) ?? PROVIDERS[0];
}

export function isEmailProvider(value: unknown): value is EmailProvider {
  return PROVIDERS.some((item) => item.value === value);
}

export function emailFieldCopy(
  key: string,
  fallback: { label: string; description: string },
): EmailFieldCopy {
  return EMAIL_FIELD_COPY[key] ?? { label: fallback.label, hint: fallback.description };
}

/** 本轮协议内可见的邮件配置项。邮箱分组独立后，系统设置页不再渲染它。 */
export function emailSettingItems(settings: AdminSettings | null): EmailSettingItem[] {
  return settings?.groups.find((group) => group.key === EMAIL_GROUP_KEY)?.items ?? [];
}

/**
 * 只按保存配置能否组成有效通道判断「就绪」，不把尚未拉到的运行状态算进来。
 * env 的真实 provider 在环境变量中，页面无法读取，因此返回未知。
 */
export function providerConfigState(
  provider: string,
  value: (key: string) => unknown,
  configured: (key: string) => boolean,
): { ready: boolean | null; message: string } {
  if (provider === 'env') {
    return { ready: null, message: '由部署环境配置决定，请以实际投递状态为准' };
  }
  if (provider === 'console') {
    return { ready: true, message: '无需外部凭据；邮件仅记录，不会实际发送' };
  }
  if (provider === 'smtp') {
    const port = Number(value(EMAIL_KEYS.smtpPort));
    const missing = [
      !String(value(EMAIL_KEYS.smtpHost) ?? '').trim() && 'SMTP 服务器',
      (!Number.isInteger(port) || port < 1 || port > 65535) && '有效 SMTP 端口',
      !String(value(EMAIL_KEYS.smtpUser) ?? '').trim() && 'SMTP 登录账号',
      !configured(EMAIL_KEYS.smtpPassword) && 'SMTP 客户端授权码',
    ].filter(Boolean);
    return {
      ready: missing.length === 0,
      message:
        missing.length === 0
          ? 'SMTP 服务器、账号与客户端授权码已配置'
          : `请补充 ${missing.join('、')}`,
    };
  }
  if (provider === 'http') {
    const ready = Boolean(String(value(EMAIL_KEYS.httpApiUrl) ?? '').trim());
    return {
      ready,
      message: ready ? '邮件接口地址已配置' : '请补充邮件接口地址',
    };
  }
  const missing = [
    !configured(EMAIL_KEYS.aliyunAccessKeyId) && '阿里云 AccessKey ID',
    !configured(EMAIL_KEYS.aliyunAccessKeySecret) && '阿里云 AccessKey Secret',
    !String(value(EMAIL_KEYS.aliyunDmAccountName) ?? '').trim() && '阿里云发信地址',
  ].filter(Boolean);
  return {
    ready: missing.length === 0,
    message:
      missing.length === 0
        ? '阿里云邮件推送凭据与发信地址已配置'
        : `请补充 ${missing.join('、')}`,
  };
}

/** 生成界面展示用的准确占位符写法。 */
export function templatePlaceholder(meta: EmailTemplateMeta, key: string): string {
  return meta.syntax === 'double' ? `{{${key}}}` : `{${key}}`;
}

/** 用示例值渲染预览；未知变量原样保留，便于发现拼写错误。 */
export function renderEmailTemplatePreview(meta: EmailTemplateMeta, text: string): string {
  const values = new Map(meta.variables.map((variable) => [variable.key, variable.example]));
  const pattern = meta.syntax === 'double' ? /\{\{\s*(\w+)\s*\}\}/g : /\{(\w+)\}/g;
  return text.replace(pattern, (whole, key: string) => values.get(key) ?? whole);
}

/** 合法分区白名单；非法值一律回落到投递配置。 */
export function emailPageTab(value: string | null): EmailPageTab {
  return value === 'usage' || value === 'templates' ? value : 'delivery';
}

/** 设置值 → 输入框文本：`null` / `undefined` 视为「未填写」。 */
export function settingValueText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * 投递配置的派生状态。
 *
 * 概览卡、右侧「配置状态」清单与「业务用途」标签页计数读的是同一份结果：
 * 三处各算一遍的话，`provider` 回退规则或事件键集合迟早会有一处漏改，
 * 出现「概览说已启用、清单说没启用」这种对不上的情况。
 */
export function emailRuntimeState(
  value: (key: string) => unknown,
  configured: (key: string) => boolean,
): EmailRuntimeState {
  const providerValue = value(EMAIL_KEYS.provider);
  const provider: EmailProvider = isEmailProvider(providerValue) ? providerValue : 'env';
  const eventKeys = EVENT_GROUPS.flatMap((group) => group.items.map((item) => item.key));
  return {
    enabled: Boolean(value(EMAIL_KEYS.enabled)),
    provider,
    from: String(value(EMAIL_KEYS.from) ?? '').trim(),
    alias: String(value(EMAIL_KEYS.fromAlias) ?? '').trim(),
    providerState: providerConfigState(provider, value, configured),
    eventKeys,
    enabledEventCount: eventKeys.filter((key) => Boolean(value(key))).length,
  };
}
