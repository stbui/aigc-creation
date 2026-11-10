/**
 * 邀请与签到的纯函数 —— 不依赖 React，可单测。
 */

import { DEFAULT_TAB, TAB_OPTIONS, type TabValue } from './constants';
import type {
  AdminCheckinListResult,
  AdminInviteListResult,
  CheckinRule,
} from '../../../types/api';

/* 跨模块深链：列表里的邮箱跳用户页，口径与后台其它页面一致 */
export { adminUserHref } from '../../../lib/admin-links';

/** 地址栏 `?tab=` → 页签。非法值回落规则页，不让页面停在一片空白上 */
export function resolveTab(value: string | null): TabValue {
  return TAB_OPTIONS.some((tab) => tab.value === value) ? (value as TabValue) : DEFAULT_TAB;
}

/** 「姓名 · 邮箱」；缺姓名时只显示邮箱，不留一个孤零零的分隔符 */
export function userLabel(name: string | null | undefined, email: string): string {
  return name ? `${name} · ${email}` : email;
}

/**
 * 邀请关系摘要。
 *
 * `summary` 是后端 groupBy 出的**全量**统计，与当前筛选无关，所以口径必须写进
 * 文案 —— 否则筛「已发放」后看到「待发放 3」会被读成筛选结果里还有 3 条。
 */
export function inviteSummaryNote(summary: AdminInviteListResult['summary']): string {
  return `全量待发放 ${summary.pending} · 全量已发放 ${summary.granted}`;
}

/** 签到摘要。`creditsIssued` 是与积分账本对账的那个数 */
export function checkinSummaryNote(summary: AdminCheckinListResult['summary']): string {
  return `累计 ${summary.count} 次签到 · 累计发放 ${summary.creditsIssued} 积分`;
}

/** 与后端 `UpdateCheckinRuleDto` 保持一致的提交前校验。 */
export function checkinRuleError(rule: CheckinRule): string | null {
  if (!Number.isInteger(rule.baseCredits) || rule.baseCredits < 0 || rule.baseCredits > 100000) {
    return '每日基础积分必须是 0–100000 的整数';
  }
  if (!Number.isInteger(rule.maxStreak) || rule.maxStreak < 0 || rule.maxStreak > 3650) {
    return '连续签到封顶必须是 0–3650 的整数';
  }
  if (!Number.isInteger(rule.dailyCap) || rule.dailyCap < 0 || rule.dailyCap > 1000000) {
    return '每日积分上限必须是 0–1000000 的整数';
  }
  if (rule.bonusRules.length > 50) return '连续加成最多 50 档';

  const seen = new Set<number>();
  for (let index = 0; index < rule.bonusRules.length; index += 1) {
    const item = rule.bonusRules[index];
    if (!Number.isInteger(item.day) || item.day < 2 || item.day > 3650) {
      return `第 ${index + 1} 档连续天数必须是 2–3650 的整数`;
    }
    if (!Number.isInteger(item.bonus) || item.bonus < 0 || item.bonus > 100000) {
      return `第 ${index + 1} 档加成积分必须是 0–100000 的整数`;
    }
    if (seen.has(item.day)) return `连续天数 ${item.day} 重复，请合并或删除重复档位`;
    seen.add(item.day);
  }
  return null;
}
