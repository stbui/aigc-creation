import type { AdminRole, TaskStatus, UserStatus } from './api';

/** GET /api/v1/admin/users/:id/impact */
export interface AdminUserImpact {
  email: string;
  projects: number;
  tasks: number;
  assets: number;
  /** 注销后按法务要求匿名保留的资金记录数量 */
  retained: {
    orders: number;
    payments: number;
    refunds: number;
    invoices: number;
    billingOrders: number;
    creditLedgerEntries: number;
  };
}

/** 后台用户详情中的当前会员权益，口径与 C 端会员判定一致 */
export interface AdminUserMembership {
  isMember: boolean;
  planCode: string;
  planName: string;
  status: 'active' | 'grace' | 'expired' | 'cancelled' | null;
  startAt: string | null;
  expiresAt: string | null;
  monthlyCredits: number;
  /** 已取消自动续费，但到期前权益仍有效 */
  cancelAtPeriodEnd: boolean;
  savedCents: number;
  discountedOrders: number;
}

export interface AdminUserMembershipHistoryItem {
  id: string;
  planCode: string;
  planName: string;
  status: string;
  startAt: string;
  expiresAt: string;
  monthlyCredits: number;
}

export interface AdminUserMembershipFields {
  membership: AdminUserMembership;
  membershipHistory: AdminUserMembershipHistoryItem[];
}

/** GET /api/v1/admin/users/:id —— 用户一屏全貌 */
export interface AdminUserDetail extends AdminUserMembershipFields {
  /** 绑定的手机号（未绑定为 null） */
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  id: string;
  email: string;
  name: string;
  role: AdminRole | 'user';
  roleLabel: string;
  status: UserStatus;
  statusLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** 当前可用积分、累计获得/消耗与到期信息（与 C 端 /credits/balance 同源） */
  credit?: {
    balance: number;
    expiringSoon: number;
    totalEarned: number;
    totalConsumed: number;
    activeLots: number;
    nearestExpiry: string | null;
  };
  /** 计费分组（会员套餐映射，无有效会员落默认分组） */
  group?: {
    code: string;
    name: string;
    ratioBasisPoints: number;
  };
  stats: {
    projects: number;
    tasks: number;
    assets: number;
    orders: number;
    tickets: number;
    invoices: number;
    taskStatus: {
      total: number;
      succeeded: number;
      failed: number;
      running: number;
      queued: number;
      cancelled: number;
      successRate: number | null;
    };
  };
  /** 消费聚合与最近订单 */
  spending: AdminUserSpending;
  recentOrders: AdminUserRecentOrder[];
  /** 生成聚合：按能力、状态与近 30 天趋势 */
  generation: AdminUserGeneration;
  recentTasks: Array<{
    id: string;
    capability: string;
    capabilityName: string;
    mode: string;
    status: TaskStatus;
    createdAt: string;
    thumbnailUrl: string | null;
  }>;
  recentAssets: Array<{
    id: string;
    sourceUrl: string;
    kind: string;
    width: number | null;
    height: number | null;
  }>;
}

/** 后台用户详情的消费聚合（金额均为整数分） */
export interface AdminUserSpending {
  /** 已支付订单实付之和 */
  paidCents: number;
  /** 已成功退款的金额之和 */
  refundedCents: number;
  /** 净消费 = 实付 - 退款 */
  netCents: number;
  paidOrders: number;
  /** 渠道退款处理中的金额；尚未写回订单 refundedCents */
  refundingCents: number;
  refundingOrders: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  orderStatus: {
    total: number;
    pending: number;
    paid: number;
    cancelled: number;
    refunded: number;
    partialRefunded: number;
  };
}

/** 后台用户详情里的最近订单 */
export interface AdminUserRecentOrder {
  id: string;
  orderNo: string;
  status: string;
  channel: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  itemName: string | null;
  createdAt: string;
  paidAt: string | null;
}

/** 后台用户详情的生成聚合 */
export interface AdminUserGeneration {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  cancelled: number;
  /** 无已结束任务时为 null */
  successRate: number | null;
  last30d: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
  };
  trend: Array<{
    date: string;
    total: number;
    succeeded: number;
    failed: number;
  }>;
  byCapability: Array<{
    capability: string;
    capabilityName: string;
    modality: string;
    count: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
  }>;
}
