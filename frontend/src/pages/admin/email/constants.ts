/**
 * 独立邮箱配置页的稳定键、通道说明与业务事件分组。
 *
 * 这里只声明展示层元数据；真正的类型、默认值与校验仍由后端
 * `SETTING_DEFS` 与系统设置接口负责。
 */

import {
  CircleX,
  Cloud,
  Code2,
  Coins,
  CreditCard,
  Crown,
  Megaphone,
  MessagesSquare,
  Server,
  ServerCog,
  Terminal,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import type { AdminSettings } from '../../../types/api';

export type EmailSettingItem = AdminSettings['groups'][number]['items'][number];
export type EmailProvider = 'env' | 'smtp' | 'console' | 'http' | 'aliyun';

export const EMAIL_GROUP_KEY = 'email';

export const EMAIL_KEYS = {
  enabled: 'email.enabled',
  provider: 'email.provider',
  from: 'email.from',
  fromAlias: 'email.fromAlias',
  smtpHost: 'email.smtpHost',
  smtpPort: 'email.smtpPort',
  smtpSecure: 'email.smtpSecure',
  smtpUser: 'email.smtpUser',
  smtpPassword: 'email.smtpPassword',
  httpApiUrl: 'email.httpApiUrl',
  httpApiKey: 'email.httpApiKey',
  aliyunAccessKeyId: 'email.aliyunAccessKeyId',
  aliyunAccessKeySecret: 'email.aliyunAccessKeySecret',
  aliyunDmAccountName: 'email.aliyunDmAccountName',
  aliyunDmAddressType: 'email.aliyunDmAddressType',
  eventWelcome: 'email.events.welcome',
  eventPaymentSuccess: 'email.events.paymentSuccess',
  eventCreditGranted: 'email.events.creditGranted',
  eventTicketReply: 'email.events.ticketReply',
  eventTaskFailed: 'email.events.taskFailed',
  eventMembershipExpired: 'email.events.membershipExpired',
  eventBroadcast: 'email.events.broadcast',
} as const;

export const ALL_EMAIL_KEYS = new Set<string>(Object.values(EMAIL_KEYS));

export interface ProviderMeta {
  value: EmailProvider;
  label: string;
  shortLabel: string;
  description: string;
  detail: string;
  icon: LucideIcon;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    value: 'env',
    label: '部署环境配置',
    shortLabel: '部署环境',
    description: '沿用部署环境中已配置的邮件服务',
    detail:
      '适合由运维统一管理邮件服务凭据。本页仍可设置发件地址和发件人名称，并控制业务邮件开关。',
    icon: ServerCog,
  },
  {
    value: 'console',
    label: '本地记录',
    shortLabel: '本地记录',
    description: '仅记录邮件内容，不实际发送',
    detail:
      '适用于开发和联调。邮件只会保存为本地记录，不会送达用户收件箱，也不能用于验证真实发信能力。',
    icon: Terminal,
  },
  {
    value: 'smtp',
    label: 'SMTP 邮箱',
    shortLabel: 'SMTP',
    description: '通过 163、腾讯企业邮等邮箱服务发送',
    detail:
      '163 邮箱推荐参数：服务器 smtp.163.com，端口 465，开启 SSL/TLS 直连，账号填写完整邮箱地址，密码填写客户端授权码。请先在 163 网页版开启 SMTP 服务。',
    icon: Server,
  },
  {
    value: 'http',
    label: '自定义邮件接口',
    shortLabel: '邮件接口',
    description: '通过已完成对接的邮件服务接口发送',
    detail:
      '需填写接口地址和访问密钥。系统会按约定格式提交发件地址、收件人、主题与正文。',
    icon: Code2,
  },
  {
    value: 'aliyun',
    label: '阿里云邮件推送',
    shortLabel: '阿里云',
    description: '通过阿里云邮件推送服务发送',
    detail:
      '需填写已启用的 AccessKey 和已审核的发信地址。建议使用仅授予邮件推送权限的最小权限子账号。',
    icon: Cloud,
  },
];

const EMAIL_PROVIDER_LABELS: Record<string, string> = {
  env: '部署环境配置',
  smtp: 'SMTP 邮箱',
  console: '本地记录',
  http: '自定义邮件接口',
  aliyun: '阿里云邮件推送',
  'aliyun-dm': '阿里云邮件推送',
  disabled: '邮件通知已关闭',
  unknown: '未知通道',
};

const SMS_PROVIDER_LABELS: Record<string, string> = {
  env: '部署环境配置',
  console: '本地记录',
  http: '自定义短信接口',
  'aliyun-sms': '阿里云短信服务',
  disabled: '短信通知已关闭',
  unknown: '未知通道',
};

/** 将后端通道标识转换为后台可读名称，避免直接暴露实现细节。 */
export function deliveryProviderLabel(provider: string, channel: 'email' | 'sms' = 'email'): string {
  const labels = channel === 'sms' ? SMS_PROVIDER_LABELS : EMAIL_PROVIDER_LABELS;
  return labels[provider] ?? (channel === 'sms' ? '其他短信通道' : '其他邮件通道');
}

const EMAIL_ERROR_COPY: Record<string, string> = {
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

export function providerMeta(provider: string): ProviderMeta {
  return PROVIDERS.find((item) => item.value === provider) ?? PROVIDERS[0];
}

export function isEmailProvider(value: unknown): value is EmailProvider {
  return PROVIDERS.some((item) => item.value === value);
}

export interface EventGroupMeta {
  title: string;
  note: string;
  icon: LucideIcon;
  items: Array<{ key: string; icon: LucideIcon }>;
}

export const EVENT_GROUPS: EventGroupMeta[] = [
  {
    title: '账号与安全',
    icon: UserPlus,
    note:
      '注册欢迎邮件可单独控制；注册验证码与找回密码属于安全邮件，仅受邮件总开关控制，不受本组业务开关影响。',
    items: [{ key: EMAIL_KEYS.eventWelcome, icon: UserPlus }],
  },
  {
    title: '交易与积分',
    icon: CreditCard,
    note:
      '支付成功或积分到账后通知用户。邮件发送失败不会影响支付结果、积分入账或订单状态。',
    items: [
      { key: EMAIL_KEYS.eventPaymentSuccess, icon: CreditCard },
      { key: EMAIL_KEYS.eventCreditGranted, icon: Coins },
    ],
  },
  {
    title: '服务通知',
    icon: MessagesSquare,
    note:
      '用户工单获得公开回复、生成任务失败或会员到期时发送通知。内部备注不会触发邮件。',
    items: [
      { key: EMAIL_KEYS.eventTicketReply, icon: MessagesSquare },
      { key: EMAIL_KEYS.eventTaskFailed, icon: CircleX },
      { key: EMAIL_KEYS.eventMembershipExpired, icon: Crown },
    ],
  },
  {
    title: '运营触达',
    icon: Megaphone,
    note:
      '开启后，后台发送活动消息时可选择同时发送邮件；每次发送仍需在消息通知页手动勾选。',
    items: [{ key: EMAIL_KEYS.eventBroadcast, icon: Megaphone }],
  },
];

export interface EmailFieldCopy {
  label: string;
  hint: string;
  placeholder?: string;
}

const EMAIL_FIELD_COPY: Record<string, EmailFieldCopy> = {
  [EMAIL_KEYS.from]: {
    label: '发件地址',
    hint:
      '用户在收件箱中看到的发件邮箱。选择 SMTP 邮箱时留空将使用 SMTP 登录账号；163 邮箱应填写完整邮箱地址。',
    placeholder: 'yourname@163.com',
  },
  [EMAIL_KEYS.fromAlias]: {
    label: '发件人名称',
    hint: '显示在邮件客户端中的发件名称，例如“货觉AI”。留空时仅显示发件地址。',
    placeholder: '例如：货觉AI',
  },
  [EMAIL_KEYS.smtpHost]: {
    label: 'SMTP 服务器',
    hint: '163 邮箱填写 smtp.163.com。其他邮箱请使用服务商提供的官方 SMTP 服务器地址。',
    placeholder: 'smtp.163.com',
  },
  [EMAIL_KEYS.smtpPort]: {
    label: 'SMTP 端口',
    hint: '163 邮箱 SSL 直连使用 465。若服务商要求 STARTTLS，通常使用 587 并关闭 SSL/TLS 直连。',
  },
  [EMAIL_KEYS.smtpSecure]: {
    label: 'SSL/TLS 直连',
    hint: '465 端口应开启；587 等 STARTTLS 端口应关闭。端口与加密方式不匹配时通常会连接失败。',
  },
  [EMAIL_KEYS.smtpUser]: {
    label: 'SMTP 登录账号',
    hint: '填写完整邮箱地址，例如 yourname@163.com。该账号用于 SMTP 身份认证。',
    placeholder: 'yourname@163.com',
  },
  [EMAIL_KEYS.smtpPassword]: {
    label: 'SMTP 客户端授权码',
    hint:
      '填写 163 网页版“设置 → POP3/SMTP/IMAP”中生成的客户端授权码，不能使用网页登录密码。授权码加密保存，页面不会回显明文。',
    placeholder: '请输入客户端授权码',
  },
  [EMAIL_KEYS.httpApiUrl]: {
    label: '邮件接口地址',
    hint: '填写已完成对接的邮件服务发送接口地址。选择自定义邮件接口时必填。',
    placeholder: '请输入完整的接口地址',
  },
  [EMAIL_KEYS.httpApiKey]: {
    label: '接口访问密钥',
    hint:
      '用于调用邮件发送接口。密钥加密保存，页面不会回显明文；留空表示保持当前密钥不变。',
    placeholder: '请输入接口访问密钥',
  },
  [EMAIL_KEYS.aliyunAccessKeyId]: {
    label: '阿里云 AccessKey ID',
    hint:
      '阿里云邮件推送的身份标识。建议使用仅授予邮件推送权限的子账号。密钥加密保存，页面不会回显明文。',
    placeholder: '请输入 AccessKey ID',
  },
  [EMAIL_KEYS.aliyunAccessKeySecret]: {
    label: '阿里云 AccessKey Secret',
    hint:
      '阿里云邮件推送的访问密钥。密钥加密保存，页面不会回显明文；留空表示保持当前密钥不变。',
    placeholder: '请输入 AccessKey Secret',
  },
  [EMAIL_KEYS.aliyunDmAccountName]: {
    label: '阿里云发信地址',
    hint:
      '填写阿里云邮件推送控制台已完成审核的发信地址。未配置时无法使用阿里云通道。',
    placeholder: '请输入已审核的发信地址',
  },
  [EMAIL_KEYS.aliyunDmAddressType]: {
    label: '阿里云地址类型',
    hint:
      '用于阿里云邮件推送的发信类型。通常选择“随机账号”；仅在服务商明确要求批量发信时切换。',
  },
  [EMAIL_KEYS.eventWelcome]: {
    label: '注册欢迎邮件',
    hint: '用户注册成功后发送欢迎与账号使用提示。验证码和找回密码不受此开关影响。',
  },
  [EMAIL_KEYS.eventPaymentSuccess]: {
    label: '支付成功邮件',
    hint: '订单支付成功后发送金额、订单号与到账信息。邮件失败不影响支付与积分入账。',
  },
  [EMAIL_KEYS.eventCreditGranted]: {
    label: '积分到账邮件',
    hint: '积分实际到账后通知用户。邮件失败不影响积分入账。',
  },
  [EMAIL_KEYS.eventTicketReply]: {
    label: '工单回复邮件',
    hint: '客服公开回复工单后通知用户；内部备注不会触发邮件。',
  },
  [EMAIL_KEYS.eventTaskFailed]: {
    label: '任务失败邮件',
    hint: '生成任务失败且积分处理完成后通知用户。',
  },
  [EMAIL_KEYS.eventMembershipExpired]: {
    label: '会员到期邮件',
    hint: '会员到期后通知用户。',
  },
  [EMAIL_KEYS.eventBroadcast]: {
    label: '活动广播邮件',
    hint: '后台发送活动消息时可选择同时发送邮件；实际发送仍以消息通知页的勾选项为准。',
  },
};

export function emailFieldCopy(
  key: string,
  fallback: { label: string; description: string },
): EmailFieldCopy {
  return EMAIL_FIELD_COPY[key] ?? { label: fallback.label, hint: fallback.description };
}

export const ALIYUN_ADDRESS_TYPE_LABELS: Record<string, string> = {
  '1': '随机账号（推荐）',
  '0': '批量发信',
};

/** 本轮协议内可见的邮件配置项。邮箱分组独立后，系统设置页不再渲染它。 */
export function emailSettingItems(settings: AdminSettings | null): EmailSettingItem[] {
  return settings?.groups.find((group) => group.key === EMAIL_GROUP_KEY)?.items ?? [];
}

/**
 * 只按保存配置能否组成有效通道判断“就绪”，不把尚未拉到的运行状态算进来。
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

