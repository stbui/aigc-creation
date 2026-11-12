/**
 * 我的作品页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `works/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 能力名 / 模态判定 / 日期切日与任务轮询集中可见。
 */

import type { Modality, Task } from '../../types/api';
import { capabilityById } from '../../lib/capabilities';

/** 能力 id → 能力定义 / 展示名 / 工具页路径 */
export { capabilityById, capabilityName, toolPath } from '../../lib/capabilities';
/** 能力清单响应结构（筛选分组从它的 `groups` / `items` 推导） */
export type { CapabilitiesData } from '../../lib/capabilities';
/** 能力运行时状态与任务失败文案 */
export { runtimeOf, taskErrorText } from '../../lib/constants';
/** 轮询到任务终态 (重试链路复用同一份实现) */
export { waitForTask } from '../../lib/poll';
/** 触发浏览器下载（带文件名，走 blob / 直链的既有实现） */
export { triggerDownload } from '../../lib/download';

/** 本地时区的当天零点时间戳 */
export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 切换数组里的某一项：已选则移除，未选则追加。 */
export function toggleInArray<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * 任务产出的模态。
 *
 * 优先取产出文件自己的 `modality`（后端按产出的 mime 推导，是文件的真实形态）；
 * 还没产出（生成中 / 失败）时回落能力注册表里的 `modality` —— 否则视频任务在
 * 生成完成前会掉进「图片作品」，用户刚提交完就找不到它了。
 */
export function taskModality(t: Task): Modality {
  return t.outputAsset?.modality ?? capabilityById(t.capability)?.modality ?? 'image';
}

/** 下载文件名扩展名；跟产出真实格式走，缺省按模态兜底 */
export function outputExtension(task: Task): string {
  const format = (task.outputAsset?.format || '').toLowerCase().replace(/^\./, '');
  if (format) return format;
  return taskModality(task) === 'video' ? 'mp4' : 'jpg';
}

/** 卡片脚注时间：月/日 时:分（本地时区，24 小时制） */
export function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
