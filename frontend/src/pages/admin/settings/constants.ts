/**
 * 系统设置的选项表与页签元信息。
 *
 * 本目录派生的类型统一从 `./types` 取；纯函数（`isSettingsTabKey` /
 * `settingGroupPath` / `displayValue` 等）统一走 `./utils`，此处不放函数 / 请求 / 组件。
 */

import type { ConfigTabMeta, SettingsConfigTabKey, SettingsTabKey } from './types';

/** 系统设置下各配置分组的独立路由。 */
export const SETTINGS_ROUTE_PREFIX = '/admin/settings';

/** 已拆成独立工作台、不再出现在系统设置页签中的配置域。 */
export const HIDDEN_SETTING_GROUP_KEYS = new Set([
  'email',
  'payment',
  'refund',
  'retention',
]);

export const SETTINGS_TABS: ReadonlyArray<{ value: SettingsTabKey; label: string }> = [
  { value: 'generate', label: '运行与生成' },
  { value: 'upload', label: '上传限制' },
  { value: 'backup', label: '备份' },
  { value: 'security', label: '安全' },
];

/** 图片格式白名单控件的固定选项；读入时把 jpeg 归一为 jpg。 */
export const IMAGE_FORMAT_OPTIONS = [
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
] as const;

/** 三个配置页签的标题、说明与生效影响清单（状态文案与动作判定集中在此）。 */
export const CONFIG_TAB_META: Record<SettingsConfigTabKey, ConfigTabMeta> = {
  generate: {
    title: '冻结积分退回',
    note: '控制失败或中断任务冻结积分的自动退回。',
    effects: [
      '保存后，账单清扫任务在下一轮检查时读取新开关；清扫间隔为 5 分钟。',
      '关闭时，冻结积分不会自动退回，符合条件的订单保留在待核对队列，由后台人工处理。',
      '恢复默认只删除运行时覆盖，不修改现有订单、任务和积分账本。',
    ],
  },
  upload: {
    title: '图片上传限制',
    note: '约束单张图片的大小、像素总量和可解析格式。',
    effects: [
      '保存后，从下一次上传请求开始使用新限制；已上传图片和进行中的上传不受影响。',
      '网页端按同一组限制预检格式、文件大小与像素总量；后端仍会复核真实文件头和像素数。',
      '恢复默认只删除运行时覆盖，不重写或删除已上传文件。',
    ],
  },
  backup: {
    title: '自动备份周期',
    note: '控制计划备份的到期判断，不改变备份文件的保留份数。',
    effects: [
      '调度器每 10 分钟检查一次；保存后在下一个检查周期按新周期判断是否到期。',
      '是否到期从最近一次成功备份时间起计算；缩短周期后可能在下一次检查立即触发。',
      '修改周期不会补做此前错过的备份，也不会删除已有备份文件。',
    ],
  },
};
