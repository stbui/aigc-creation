import type { CapabilityGroup } from '../../types/api';
import { capabilityById } from '../../lib/capabilities';

/**
 * 工作台页面的纯函数与外部工具出口 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里放能力注册表查询、运行时结论与状态文案。
 */

/** 能力注册表查询 / 可见性 / 工具路径 */
export { capabilityById, isCapabilityVisible, toolPath } from '../../lib/capabilities';
/** 运行时结论（运营下线 / 无可用线路） */
export { runtimeOf } from '../../lib/constants';

/** 任务状态 → 用户可读文案 */
export function statusLabel(s: string): string {
  return s === 'succeeded' ? '已完成' : s === 'failed' ? '失败' : '进行中';
}

/**
 * 能力所属分组名（流水表的「业务类型」列）。
 *
 * 直接读后端下发的 groups，不在前端把 group id 硬映射成中文名 ——
 * 后端新增第 4 组时前端零改动。
 */
export function groupNameOf(capability: string, groups: CapabilityGroup[]): string {
  const g = capabilityById(capability)?.group;
  return groups.find((x) => x.id === g)?.name ?? '';
}
