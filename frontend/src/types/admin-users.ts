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
  /** 没有任何资金记录时才允许物理删除 */
  hardDeleteAllowed: boolean;
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
