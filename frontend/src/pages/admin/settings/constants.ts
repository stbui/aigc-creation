/**
 * AdminSettingsPage 的本地常量与类型。
 */

import { DatabaseBackup, MessagesSquare, Network, Scale, type LucideIcon } from 'lucide-react';

import type { AdminSettings } from '../../../types/api';

export type SettingItem = AdminSettings['groups'][number]['items'][number];

/** 「相关管理入口」条目：权限点与侧栏菜单保持一致，无权限时不渲染 */
export interface RelatedEntry {
  to: string;
  label: string;
  description: string;
  permission: string;
  icon: LucideIcon;
}

export const RELATED_ENTRIES: RelatedEntry[] = [
  {
    to: '/admin/channels',
    label: '模型商品',
    description: '供应商、模型商品与接入方式',
    permission: 'channel.read',
    icon: Network,
  },
  {
    to: '/admin/backups',
    label: '数据备份',
    description: '备份频次、恢复验证与保留份数',
    permission: 'backup.read',
    icon: DatabaseBackup,
  },
  {
    to: '/admin/legal',
    label: '法务文档',
    description: '用户协议 / 隐私政策 / 未成年人保护 / 账号规则',
    permission: 'legal.read',
    icon: Scale,
  },
  {
    to: '/admin/tickets',
    label: '工单处理',
    description: '用户投诉、举报与咨询的受理和答复',
    permission: 'ticket.read',
    icon: MessagesSquare,
  },
];
