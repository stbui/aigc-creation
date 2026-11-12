/**
 * 数据中心页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 日期格式化、近 7 天汇总与柱高换算都不依赖 React，便于单独校验。
 */

import type { StatsOverview } from '../../types/api';
import { WEEKDAYS } from './constants';

/** `2026-10-30` → 周几。按本地时间解析, 避免 UTC 偏移把日期挪一天 */
export function weekdayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : WEEKDAYS[parsed.getDay()];
}

/** 最近创作时间: 同年只留 MM-DD HH:mm, 跨年才补年份 */
export function formatTaskTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const options: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return date.toLocaleString('zh-CN', options);
}

/** 数据刷新时间戳 */
export function formatUpdatedAt(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export interface TrendSummary {
  /** 近 7 天总创作次数 */
  total: number;
  /** 单日峰值 */
  peak: number;
  /** 有创作的天数 */
  activeDays: number;
  /** 日均创作次数 */
  dailyAvg: number;
}

/** 近 7 天趋势汇总 —— KPI 卡与趋势图共用同一组数字 */
export function trendSummaryOf(days: StatsOverview['last7Days']): TrendSummary {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const peak = Math.max(0, ...days.map((day) => day.count));
  const activeDays = days.filter((day) => day.count > 0).length;
  return {
    total,
    peak,
    activeDays,
    dailyAvg: days.length ? total / days.length : 0,
  };
}

/** 趋势柱高：0 次不占高，其它至少 4%，保证小值可见 */
export function barHeightOf(count: number, peak: number): number {
  return count === 0 ? 0 : Math.max(4, Math.round((count / Math.max(1, peak)) * 100));
}
