import type { LucideIcon } from 'lucide-react';
import type { AdminSettings } from '../../../types/api';

/**
 * 邮箱配置的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/api`）在此统一 re-export，业务文件一律从 `./types` 取；
 * 本目录派生的结构类型、通道元数据形状与模板目录形状也定义于此。
 */

/* 外部类型统一转出 */
export type {
  AdminSettingValue,
  AdminSettings,
  DeliveryChannelStatus,
  EmailTestResult,
  MessageTemplateItem,
} from '../../../types/api';

/** 邮箱分组下的一条配置项（由 `AdminSettings` 派生，不重复声明字段）。 */
export type EmailSettingItem = AdminSettings['groups'][number]['items'][number];

export type EmailProvider = 'env' | 'smtp' | 'console' | 'http' | 'aliyun';

/** 页面三个分区；`?tab=` 只认 `usage` / `templates`，其余一律回落到投递配置。 */
export type EmailPageTab = 'delivery' | 'usage' | 'templates';

export interface ProviderMeta {
  value: EmailProvider;
  label: string;
  shortLabel: string;
  description: string;
  detail: string;
  icon: LucideIcon;
}

export interface EventGroupMeta {
  title: string;
  note: string;
  icon: LucideIcon;
  items: Array<{ key: string; icon: LucideIcon }>;
}

export interface EmailFieldCopy {
  label: string;
  hint: string;
  placeholder?: string;
}

export interface EmailTemplateVariable {
  key: string;
  label: string;
  example: string;
}

export interface EmailTemplateMeta {
  code: string;
  label: string;
  description: string;
  icon: LucideIcon;
  syntax: 'single' | 'double';
  defaultSubject: string;
  defaultBody: string;
  variables: EmailTemplateVariable[];
  /** 安全邮件必须保留的变量；保存前由页面与后端共同校验。 */
  requiredVariable?: string;
}

export interface EmailTemplateGroup {
  key: string;
  title: string;
  note: string;
  templates: EmailTemplateMeta[];
}

/** 模板编辑草稿（只含可编辑的三项，其余取自目录元数据）。 */
export interface EmailTemplateDraft {
  subject: string;
  body: string;
  enabled: boolean;
}

/** 投递配置的派生状态：概览卡、配置状态清单与标签页计数共用一份。 */
export interface EmailRuntimeState {
  enabled: boolean;
  provider: EmailProvider;
  from: string;
  alias: string;
  providerState: { ready: boolean | null; message: string };
  eventKeys: string[];
  enabledEventCount: number;
}
