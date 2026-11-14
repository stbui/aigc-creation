/**
 * 积分明细页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 流水类型 / 批次状态 / 来源文案与分页步长集中定义，桌面表格与窄屏列表共用。
 */

import type { CreditLot } from '../../types/api';

/** 页面标题与描述（主态 / 访客态两套描述） */
export const CREDITS_PAGE_META = {
  title: '积分明细',
  description: '积分按批次发放并可能有有效期；余额由后端账本实时汇总。',
  guestDescription: '查看余额、批次与每一笔积分流水。',
} as const;

export type Tab = 'ledger' | 'lots';

export type LedgerFilter =
  | 'all'
  | 'income'
  | 'expense'
  | 'purchase'
  | 'consume'
  | 'admin_adjust'
  | 'expire';

export const SOURCE_LABEL: Record<string, string> = {
  purchase: '购买',
  grant: '赠送',
  admin_adjust: '客服调整',
};

/**
 * 流水类型 → 中文。**兜底文案**, 只在业务类型缺失（`other`）时展示。
 *
 * ⚠ 这是「动作」口径而非「业务」口径: `consume` 覆盖全平台生成, 包括文本/音频
 * 代理计费。因此这里保持「生成消耗」, 不写「创意生图扣费」—— 后者由
 * `BUSINESS_TYPE_LABEL.creative_image` 承载。若两处都写「创意生图扣费」,
 * 一次文本调用扣费会被误标成生图扣费, 比不显示更糟。
 */
export const LEDGER_LABEL: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  refund_reclaim: '退款扣回',
  reserve: '预授权冻结',
  refund: '预授权退回',
  expire: '积分过期',
  admin_adjust: '客服调整',
};

/**
 * 业务类型 → 中文（展示口径, 优先级高于 `LEDGER_LABEL`）。
 *
 * 扣费类只有一个 `creative_image`: 电商生图 / AI修图 / AI视频三组能力在产品
 * 口径上统一叫「创意生图扣费」, 不按能力再细分。
 */
export const BUSINESS_TYPE_LABEL: Record<string, string> = {
  checkin_streak: '连续签到奖励',
  new_user_gift: '新用户赠送',
  purchase: '购买获得',
  membership_grant: '会员月度积分',
  invite_reward: '邀请奖励',
  creative_image: '创意生图扣费',
  credit_expire: '积分过期',
  admin_adjust: '客服调整',
  refund: '退款相关',
  other: '其他',
};

export const LOT_STATUS: Record<CreditLot['status'], string> = {
  active: '可用',
  expired: '已过期',
  exhausted: '已用尽',
};

/** 每页条数: 桌面表格与窄屏列表共用, 换结构不改分页节奏 */
export const PAGE_SIZE = 20;

export const LEDGER_FILTER_OPTIONS: Array<{ value: LedgerFilter; label: string }> = [
  { value: 'all', label: '全部流水' },
  { value: 'income', label: '只看收入' },
  { value: 'expense', label: '只看支出' },
  { value: 'purchase', label: '购买获得' },
  { value: 'consume', label: '生成消耗' },
  { value: 'admin_adjust', label: '客服调整' },
  { value: 'expire', label: '积分过期' },
];
