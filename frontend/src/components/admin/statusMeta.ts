/**
 * 跨页面共用的状态语义映射（文案与色调的单一事实源）。
 *
 * 覆盖任务、账号、角色、订单、商品、发票这些「同一个状态词在各页含义一致」的
 * 状态。文案随页面语境不同时（如 `pending` 在发票页是「待开具」），页面通过
 * `<StatusTag label="…">` 覆盖文案，色调查表 —— 不复制整张映射。
 *
 * 各自带独立状态机的领域（生成账单 `reserved/settled/uncertain`）在域内
 * `constants.ts` 定义文案；色调用量仍从这里取，只有语义确实不同时显式覆盖
 * （见 `billing-orders/constants.ts` 的 `refunded`）。
 *
 * 双编码：色块 + 中文文字。只靠颜色对色觉障碍用户不可读，只靠颜色也让扫视
 * 效率低下。未登记的状态回退到原值而不是隐藏 —— 隐藏会让「未知状态」看起来
 * 像「正常」。
 */

export type TagTone = 'success' | 'danger' | 'warn' | 'brand' | 'muted';

export const STATUS_META: Record<string, { label: string; tone: TagTone }> = {
  // 任务状态 (后端 Prisma GenerationTask.status)
  succeeded: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  running: { label: '进行中', tone: 'brand' },
  queued: { label: '排队中', tone: 'warn' },
  cancelled: { label: '已取消', tone: 'muted' },
  // 账号状态 (后端 Prisma User.status)
  active: { label: '正常', tone: 'success' },
  disabled: { label: '已禁用', tone: 'warn' },
  deleted: { label: '已注销', tone: 'muted' },
  // 角色。四种角色使用不同色调快速区分；角色文字仍是无障碍识别的主要依据。
  user: { label: '用户', tone: 'muted' },
  admin: { label: '管理员', tone: 'brand' },
  operator: { label: '运营', tone: 'success' },
  finance: { label: '财务', tone: 'warn' },
  // 订单状态。任务状态改用 `queued` 后，`pending` 只服务订单与发票，
  // 两页都通过 <StatusTag label="待支付/待开具"> 覆盖文案。
  pending: { label: '等待', tone: 'warn' },
  paid: { label: '已支付', tone: 'success' },
  refunded: { label: '已退款', tone: 'danger' },
  partial_refunded: { label: '部分退款', tone: 'warn' },
  // 生成账单状态（后端 BILLING_STATUSES）。账单页用域内文案（「计费中」等），
  // 色调用这里的值；`refunded` 在账单里是终态，账单页显式改为 warn。
  reserved: { label: '已预留', tone: 'brand' },
  settled: { label: '已结算', tone: 'success' },
  uncertain: { label: '结果不明', tone: 'danger' },
  // 商品状态 (后端 Prisma Product.status)
  offline: { label: '已下架', tone: 'muted' },
  // 发票状态。`pending` 复用库存量条的「等待」色，发票页用 `label="待开具"` 覆盖文案
  issued: { label: '已开具', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
  red_flushed: { label: '已冲红', tone: 'muted' },
};
