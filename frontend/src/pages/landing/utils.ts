import { capabilityById, toolPath } from '../../lib/capabilities';
import { CASE_CAPABILITY_MAP } from './constants';

/**
 * 营销首页的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `landing/` 下的文件不从 `src/lib` 直接取东西, 一律经由本文件 ——
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 能力定义查询 (按 id 取能力) */
export { capabilityById } from '../../lib/capabilities';
/** 能力名 (用于限时活动里按 id 显示能力中文名) */
export { capabilityName } from '../../lib/capabilities';
/** 能力运行时可见性判定 (运营下线的整块入口不再展示) */
export { isCapabilityVisible } from '../../lib/capabilities';
/** 统一路径映射 (能力 id → 工具页路径) */
export { toolPath } from '../../lib/capabilities';
/** 套餐卡视觉装饰 (推荐标签等), 与定价无关 */
export { PLAN_VISUALS } from '../../lib/constants';

/**
 * 案例文件按商品去重。
 *
 * 主图与详情图是成对产出 (`spzt_01_1` / `spzt_01_2`), 直接取前 5 张会
 * 让同一件商品出现两次, 案例墙看起来像重复黏贴。去掉配对后缀后按商品保留首张。
 */
export function uniqueCaseFiles(files: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const key = file.replace(/\.[a-z]+$/i, '').replace(/_[12]$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

/** 活动结束时间展示（本地时区，仅展示用，不参与任何判定） */
export function formatCampaignEnd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 案例卡点击目标: 跳对应工具页 (未登录能力走工具页, 由 App 层鉴权兜底)。
 *
 * 必须复用统一路径映射: 手拼 /tools/:id 会让商品主图/详情图等
 * 自定义工作台退化到通用工具页, 用户看不到对应的专属表单。
 */
export function caseTarget(key: string): string {
  const def = capabilityById(CASE_CAPABILITY_MAP[key] ?? '');
  return def ? toolPath(def.id) : '/workbench';
}
