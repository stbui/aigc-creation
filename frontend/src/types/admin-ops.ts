import type { Project } from "./api";
import type { AdminTaskRouteAttempt } from "./task-route";

/** 列表行。字段与后端 tasks-admin.service list() 返回一一对应 */
export interface AdminTask {
  id: string;
  capability: string;
  capabilityName: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  errorCode: string | null;
  creditCost: number;
  /** 由哪个失败任务重试而来 (null = 用户首次发起) */
  retriedFromId: string | null;
  user: { id: string; email: string };
  project: { id: string; name: string };
  /** updatedAt - createdAt; running 任务的该值仍在增长 */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
}

/** 拥堵指标。刻意不受列表筛选影响 —— 它的用途是回答"系统现在堵不堵" */
export interface AdminTaskCongestion {
  queued: number;
  running: number;
  failedLastHour: number;
  runningThreshold: number;
}

export interface AdminTaskListResult {
  result: {
    items: AdminTask[];
    total: number;
    page: number;
    pageSize: number;
  };
  congestion: AdminTaskCongestion;
  capabilities: Array<{ capability: string; count: number }>;
  /** 近 24 小时失败任务按错误码聚合，用于「同因」快捷筛选 */
  failureGroups: Array<{ errorCode: string; count: number }>;
}

/** 任务详情 */
export interface AdminTaskDetail {
  id: string;
  capability: string;
  capabilityName: string;
  status: AdminTask["status"];
  errorCode: string | null;
  creditCost: number;
  retriedFromId: string | null;
  user: { id: string; email: string };
  project: { id: string; name: string };
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  /** 状态流转节点；at=null 表示后端无可靠时间，不编造中间节点。 */
  timeline: Array<{
    key: string;
    label: string;
    at: string | null;
    done: boolean;
  }>;
  params: Record<string, unknown>;
  /** 线路尝试；旧版后端响应可能缺失此字段，前端按空数组兼容 */
  routeAttempts?: AdminTaskRouteAttempt[];
  /** 输入素材, 已按 inputAssetIds 原序排列 (多图能力依赖顺序语义) */
  inputAssets: Array<{
    id: string;
    sourceUrl: string;
    width: number | null;
    height: number | null;
    kind: string;
  }>;
  outputAsset: {
    id: string;
    sourceUrl: string;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
  } | null;
}

/* ────────────────────────────────────────────────────────────────
   数据备份 (admin-prd.md §3.19 B-96~B-101)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/backups */
export interface AdminBackup {
  id: string;
  filename: string;
  sizeBytes: number;
  /** SHA-256 十六进制, 64 位 */
  sha256: string;
  trigger: "manual" | "scheduled";
  status: "pending" | "succeeded" | "failed";
  errorMessage: string | null;
  sourceSizeBytes: number | null;
  /** B-97: 无验证记录的备份视为无效 */
  verified: boolean;
  verifiedAt: string | null;
  verifyReport: string | null;
  verifyWarnings: string | null;
  createdAt: string;
}

/** GET /api/v1/admin/backups/stats */
export interface AdminBackupStats {
  total: number;
  succeeded: number;
  verified: number;
  /** 未验证份数 —— 需提醒运维尽快验证 */
  unverified: number;
  failed: number;
  totalBytes: number;
  totalMb: number;
  lastSuccessAt: string | null;
  /** 超过 24 小时无成功备份即视为异常 */
  stale: boolean;
}

/** GET /api/v1/admin/retention/logs */
export interface AdminCleanupLog {
  id: string;
  target: string;
  deletedCount: number;
  retentionDays: number;
  trigger: "manual" | "scheduled";
  skippedCount: number;
  detail: string;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

/* ────────────────────────────────────────────────────────────────
   素材管理 + 存储后端 (admin-prd.md §3.4 B-21~27 / §3.11 B-62/63)
   ──────────────────────────────────────────────────────────────── */

/** 存储后端标识 */
export type StorageBackendId = "local" | "oss" | "minio";

/** 素材上架状态。hidden = 已下架, 用户端不可见但记录与文件保留 */
export type AssetStatus = "visible" | "hidden";

/** GET /api/v1/admin/assets */
export interface AdminAssetListResult {
  items: Array<{
    id: string;
    kind: "original" | "generated";
    capability: string | null;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
    status: AssetStatus;
    /** 可访问 URL。本地为 /uploads/key, 云端为签名 URL(会过期, 不入库) */
    sourceUrl: string;
    /** 写入时的后端 —— 切换默认后端后老素材仍从这里读 */
    storageBackend: StorageBackendId;
    /** 存储内相对 key, 唯一真相, 不含域名 */
    storageKey: string | null;
    ownerId: string;
    ownerEmail: string;
    projectId: string;
    projectName: string;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/v1/admin/assets/stats */
export interface AdminAssetStats {
  total: number;
  totalBytes: number;
  totalMb: number;
  byStatus: Record<string, number>;
  byBackend: Record<string, number>;
  byKind: Record<string, number>;
}

/** GET /api/v1/admin/projects */
export interface AdminProjectListResult {
  items: AdminProject[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminProject extends Project {
  ownerEmail: string;
  ownerName: string;
  assetCount: number;
  taskCount: number;
}

/** GET /api/v1/admin/storage/status */
export interface AdminStorageStatus {
  active: StorageBackendId;
  backends: Array<{
    backend: StorageBackendId;
    available: boolean;
    configured: boolean;
    active: boolean;
    /** 脱敏凭据, 永不返回明文 (B-63) */
    masked?: string;
    endpoint?: string;
    probeMessage?: string;
    probeLatencyMs?: number;
  }>;
  credentialSource: string;
  /** PRD 约束: 凭据走环境变量, 界面不可编辑 */
  editable: false;
}

/* ────────────────────────────────────────────────────────────────
   营销中心 (admin-prd.md §3.12 B-64~B67 / M11)
   ──────────────────────────────────────────────────────────────── */

/** 券类型: full_cut 满减 | discount 折扣 | fixed 固定额 */
export type CouponType = "full_cut" | "discount" | "fixed";
/** 券适用范围: all 全站 | product 指定商品 | new_user 仅新用户首单 */
export type CouponScope = "all" | "product" | "new_user";
export type CouponStatus = "on" | "off";
export type CampaignType = "limited_price" | "limited_free" | "popup";
export type CampaignStatus = "draft" | "active" | "ended" | "off";

/** GET /api/v1/admin/coupons */
export interface AdminCoupon {
  id: string;
  code: string;
  name: string;
  type: CouponType;
  /** 语义随 type: full_cut/fixed 为减免分; discount 为折扣万分比 (8500 = 85折) */
  value: number;
  thresholdCents: number;
  scope: CouponScope;
  productIds: string[];
  /** 0 = 不限量 */ totalCount: number;
  usedCount: number;
  /** 待支付预占数量与关联订单总数 */ pendingReserved: number; orderCount: number;
  /** 0 = 不限 */ perUserLimit: number;
  validFrom: string;
  validTo: string;
  /** 人工设置的两态开关 (写入用同一字段) */
  status: CouponStatus;
  createdAt: string;
  /* ── 后端派生字段 (marketing.service.ts toCouponView) ────────────── */
  /** 展示用面额: 折扣转「8.5 折」, 其余为「¥10.00」 */
  valueLabel: string;
  /** 「满 100.00 元可用」或「无门槛」 */
  thresholdLabel: string;
  typeLabel: string;
  scopeLabel: string;
  /** 剩余可核销数量。null = 不限量 */
  remaining: number | null;
  /**
   * 五态生效判定, **优先于 status 展示**。
   * 拆成两个字段是因为读语义与写语义不同: status 是人工开关,
   * effective 是含时间窗与限量的派生结果。把过期显示成「已停用」会让运营
   * 去找不存在的误操作 —— 过期是自然结果, 停用是人为决定, 处置完全不同。
   */
  effective: "on" | "off" | "expired" | "not_started" | "sold_out";
  updatedAt: string;
}

/** POST/PATCH /api/v1/admin/coupons */
export interface UpsertCouponPayload {
  /** 创建必填; 更新留空表示不改 (改券码等于让已发出的券集体失效) */
  code?: string;
  name: string;
  type: CouponType;
  value: number;
  thresholdCents?: number;
  scope?: CouponScope;
  productIds?: string[];
  totalCount?: number;
  perUserLimit?: number;
  validFrom?: string;
  validTo?: string;
  status?: CouponStatus;
}

/** GET /api/v1/admin/campaigns */
export interface AdminCampaign {
  id: string;
  name: string;
  type: CampaignType;
  payload: {
    productId?: string;
    priceCents?: number;
    capabilityIds?: string[];
    title?: string;
    body?: string;
    ctaText?: string;
    ctaUrl?: string;
  };
  startAt: string;
  endAt: string;
  /** 人工设置的状态 */
  status: CampaignStatus;
  statusLabel: string;
  /**
   * 派生生效态, **优先于 status 展示**。
   * status='active' 但时间窗未到时对用户就是不生效, 混为一谈会让运营
   * 以为活动已在跑而实际没有曝光。
   */
  effective: "draft" | "live" | "scheduled" | "ended" | "off";
  audience: { onlyNewUsers?: boolean }; orderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCampaignPayload {
  name: string;
  type: CampaignType;
  payload?: AdminCampaign["payload"];
  startAt: string;
  endAt: string;
  status?: CampaignStatus;
  onlyNewUsers?: boolean;
}

/** GET /api/v1/admin/invites */
export interface AdminInviteListResult {
  items: Array<{
    id: string;
    inviteCode: string;
    inviterEmail: string;
    inviterName: string;
    inviteeEmail: string;
    inviteeName: string;
    boundAt: string;
    rewardStatus: "pending" | "granted" | "rejected";
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary: {
    pending: number;
    granted: number;
  };
}

/** GET /api/v1/admin/checkin (签到记录) */
export interface AdminCheckinListResult {
  items: Array<{
    id: string;
    userEmail: string;
    userName: string;
    day: string;
    /** 本次实际发放 (含连签加成), 快照值 */
    credits: number;
    /** 当时的连续天数快照 */
    streak: number;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary: {
    count: number;
    /** 累计发放积分, 与 CreditLedger 对账用 */
    creditsIssued: number;
  };
}

/** GET /api/v1/admin/invites/rules */
export interface InviteRule {
  inviterCredits: number;
  inviteeCredits: number;
  triggerOn: "first_pay" | "register";
  valid: boolean;
  updatedAt: string | null;
  configured: boolean;
}

/**
 * GET /api/v1/admin/checkin/rules
 *
 * ⚠ 字段名以**后端实际返回**为准 (用 curl 核对过):
 *   bonusRules 而非 bonuses; enabled 而非 valid;
 *   另有 maxStreak / dailyCap / configured 三个字段我最初漏了。
 * 写前端类型时必须实测接口, 不能只看 DTO 类名推断。
 */
export interface CheckinRule {
  baseCredits: number;
  /** 连续加成项 */
  bonusRules: Array<{ day: number; bonus: number }>;
  /** 连续签到上限天数, 0 = 不限 */
  maxStreak: number;
  /** 每日签到可得积分上限, 0 = 不限 */
  dailyCap: number;
  enabled: boolean;
  updatedAt: string | null;
  /** 是否已配置过 (false 表示从未保存, 展示用代码默认值) */
  configured: boolean;
}

/* ────────────────────────────────────────────────────────────────
   营销中心 · C 端 (M11)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/marketing/invites */
export interface MyInvites {
  /** 本人邀请码。首次访问时惰性生成并落库 */
  inviteCode: string;
  rule: InviteRule;
  /** 规则已配置且至少有一项奖励 > 0。为 false 时页面须如实说明不发积分 */
  enabled: boolean;
  metrics: {
    totalInvited: number;
    rewardedCount: number;
    pendingCount: number;
    /** 已发放关系的累计收益。未发放的不计入 —— 展示未到账的收益属虚假宣传 */
    earnedCredits: number;
    /** 待发放关系的预估收益, 随规则变化, 展示时须标注为估算 */
    pendingCredits: number;
  };
  relations: Array<{
    id: string;
    boundAt: string;
    rewardStatus: "pending" | "granted" | "rejected";
    /** 已打码的被邀请人标识 */
    inviteeName: string;
  }>;
}

/** GET /api/v1/marketing/checkin */
export interface CheckinStatus {
  rule: CheckinRule;
  /** 本地日期 YYYY-MM-DD */
  today: string;
  checkedIn: boolean;
  todayCredits: number;
  /** 当前连续签到天数 (今天没签不立即算断签) */
  streak: number;
  nextStreak: number;
  nextCredits: number;
  /** 未来 7 天逐日可得, 让用户看清连签路线 */
  forecast: Array<{ day: string; streak: number; credits: number }>;
  /** 服务端当前时间戳 —— 倒计时基准, 不得用本地时间自减 */
  serverNow: string;
}

/** POST /api/v1/marketing/quote */
export interface MarketingQuote {
  subtotalCents: number;
  /** 会员加油包折扣（非会员为 0），与券/活动优惠分开展示 */
  memberDiscountCents: number;
  /** 券 / 限时活动优惠（不含会员折扣） */
  discountCents: number;
  payableCents: number;
  appliedSource: "coupon" | "campaign" | null;
  appliedCouponCode: string | null;
  appliedCampaignId: string | null;
  /** 券与活动不叠加时的明确说明, 避免用户以为算错了 */
  notStackedNotice: string | null;
  coupons: Array<{
    id: string;
    code: string;
    name: string;
    discountCents: number;
    valueLabel: string;
    thresholdLabel: string;
  }>;
  items: Array<{
    productId: string;
    name: string;
    priceCents: number;
    credits: number;
    quantity: number;
    available: boolean;
  }>;
}

/**
 * GET /api/v1/marketing/popup (匿名可访问)
 *
 * `serverNow` 必须用于倒计时基准: 直接用本地时间倒计时在用户改系统时间、
 * 或跨时区访问时会算出错误剩余时间, 造成"活动已结束却仍显示可领"的假承诺。
 */
export interface PopupCampaign {
  id: string;
  title: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  startAt: string;
  endAt: string;
  serverNow: string;
}

/**
 * 进行中的限时活动（`GET /marketing/campaigns`）。
 *
 * 只含真正影响价格的两种：限时价（带目标商品与生效活动价）与限时免费
 * （带免费覆盖的能力）。商品下架、活动价不低于原价的活动后端已过滤掉，
 * 前端拿到即可直接展示，不再二次判断 —— 判定口径只有后端一份。
 */
export interface PromoCampaign {
  id: string;
  name: string;
  type: "limited_price" | "limited_free";
  startAt: string;
  endAt: string;
  /** 限时价活动的目标商品 */
  product?: { id: string; sku: string; name: string; priceCents: number };
  /** 实际生效的活动价（分），限时价活动才有 */
  priceCents?: number;
  /** 限时免费覆盖的能力 id */
  capabilityIds?: string[];
}

/* ────────────────────────────────────────────────────────────────
   定时任务 (admin-prd.md §3.18 B-90 / M9.5)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/scheduler/status */
export interface AdminSchedulerTask {
  /** 任务标识, 如 'order-expire' | 'credit-expire' | 'backup' */
  name: string;
  label: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastSuccess: boolean | null;
  lastError: string | null;
  /** 连续失败次数。> 0 即任务已停止生效 */
  consecutiveFailures: number;
  totalRuns: number;
}

export interface AdminSchedulerStatus {
  tasks: AdminSchedulerTask[];
  /** 允许手动触发的任务名。只有幂等低风险的才开放 */
  manuallyRunnable: string[];
  /** 当前有连续失败的任务名, 前端据此置顶告警 */
  failing: string[];
}

