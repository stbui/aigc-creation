import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB,
  REWARD_STATUS_META,
  REWARD_STATUS_OPTIONS,
  TAB_OPTIONS,
  type RewardStatus,
} from '../constants';
import { checkinSummaryNote, inviteSummaryNote, resolveTab, userLabel } from '../utils';

/**
 * 邀请与签到两张流水表的展示口径（`/admin/marketing-rules?tab=invites|checkins`）。
 *
 * 锁住三件事：
 *   1. 状态文案只有一份，筛选下拉与表格状态列不能各写各的；
 *   2. 地址栏 `?tab=` 的非法值必须回落规则页，不能停在空白标签；
 *   3. 摘要文案必须写清「全量」口径，否则会被读成当前筛选结果的计数。
 */

describe('页签', () => {
  it('规则配置是默认标签，两张流水在后', () => {
    expect(TAB_OPTIONS.map((tab) => tab.value)).toEqual(['rules', 'invites', 'checkins']);
    expect(DEFAULT_TAB).toBe('rules');
  });

  it('非法 tab 回落规则页', () => {
    expect(resolveTab('invites')).toBe('invites');
    expect(resolveTab('checkins')).toBe('checkins');
    expect(resolveTab('nope')).toBe(DEFAULT_TAB);
    expect(resolveTab(null)).toBe(DEFAULT_TAB);
  });
});

describe('邀请奖励状态', () => {
  const ALL: RewardStatus[] = ['pending', 'granted', 'rejected'];

  it('三种状态都有标签与色调', () => {
    for (const status of ALL) {
      expect(REWARD_STATUS_META[status].label).toBeTruthy();
      expect(REWARD_STATUS_META[status].tone).toBeTruthy();
      expect(REWARD_STATUS_META[status].hint).toBeTruthy();
    }
  });

  it('筛选下拉的文案取自同一张表', () => {
    expect(REWARD_STATUS_OPTIONS).toEqual(
      ALL.map((value) => ({ value, label: REWARD_STATUS_META[value].label })),
    );
  });

  it('待发放不是失败态，不用 danger 色', () => {
    expect(REWARD_STATUS_META.pending.tone).toBe('warn');
  });
});

describe('用户与摘要文案', () => {
  it('缺姓名时只显示邮箱，不留分隔符', () => {
    expect(userLabel('张三', 'z@e.com')).toBe('张三 · z@e.com');
    expect(userLabel('', 'z@e.com')).toBe('z@e.com');
    expect(userLabel(null, 'z@e.com')).toBe('z@e.com');
  });

  it('邀请摘要标明全量口径', () => {
    expect(inviteSummaryNote({ pending: 3, granted: 12 })).toBe(
      '全量待发放 3 · 全量已发放 12',
    );
  });

  it('签到摘要给出可对账的累计发放', () => {
    expect(checkinSummaryNote({ count: 40, creditsIssued: 260 })).toBe(
      '累计 40 次签到 · 累计发放 260 积分',
    );
  });
});
