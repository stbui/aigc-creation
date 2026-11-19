/**
 * 系统设置的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/api`）在此统一 re-export，业务文件一律从 `./types` 取；
 * 本目录派生的结构与展示结构也定义于此。新增引用时在这里补一行 re-export。
 */

import type { AdminSettings } from '../../../types/api';

export type {
  AdminSettings,
  AdminSettingValue,
  AdminSystemPerformance,
} from '../../../types/api';

/** 一个配置分组（含其全部配置项）。 */
export type AdminSettingGroup = AdminSettings['groups'][number];

/** 单个配置项：控件渲染、草稿与变更摘要共用这一个形状。 */
export type SettingItem = AdminSettingGroup['items'][number];

/** 五个显式路由对应的页签键；页面不识别路径参数或查询参数。 */
export type SettingsTabKey = 'generate' | 'upload' | 'backup' | 'performance' | 'security';

/** 有实际配置面板的页签（系统性能是只读快照，安全页只有静态说明）。 */
export type SettingsConfigTabKey = Exclude<SettingsTabKey, 'performance' | 'security'>;

/** 配置页签的标题、副标题与「生效与影响」清单。 */
export interface ConfigTabMeta {
  title: string;
  note: string;
  effects: string[];
}

/** 保存确认里的「本次变更」一行。 */
export interface SettingChange {
  key: string;
  label: string;
  from: string;
  to: string;
  effect: string;
}
