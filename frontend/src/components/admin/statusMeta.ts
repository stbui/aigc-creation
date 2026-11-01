/**
 * 状态值的语义色映射（唯一事实源）。
 *
 * 从 `PageHeader.tsx` 抽出来是因为状态标签出现在多处（表格、抽屉、概览卡片）。
 * 映射表若各存一份，同一个 `refunded` 会在一处红、一处灰，排查时会以为是
 * 样式问题。
 *
 * 双编码：色块 + 中文文字。只靠颜色对色觉障碍用户不可读，只靠颜色也让扫视
 * 效率低下。未登记的状态回退到原值而不是隐藏 —— 隐藏会让「未知状态」看起来
 * 像「正常」。
 */

export type TagTone = 'success' | 'danger' | 'warn' | 'brand' | 'muted';

/**
 * tone → 彩色标签（Chip）颜色名。
 *
 * `Chip` 的入参名保留了 BoardUI 的十档写法（`lime` / `rose` / …），实现已折叠到
 * 五档语义色（见 `shadcn/kit/display` 的 `CHIP_COLOR_CLASS`）。放在这里而不是
 * 各页自己写映射：同一套语义色在表格、抽屉、卡片之间必须一一对应。
 * success 用 lime 而不是 green —— 历史上 lime 才是正向态，改名会动 30 多处调用。
 */
export const TONE_CHIP_COLOR: Record<TagTone, 'lime' | 'rose' | 'yellow' | 'purple' | 'neutral'> =
  {
    success: 'lime',
    danger: 'rose',
    warn: 'yellow',
    brand: 'purple',
    muted: 'neutral',
  };

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
  // 角色
  user: { label: '用户', tone: 'muted' },
  admin: { label: '管理员', tone: 'brand' },
  operator: { label: '运营', tone: 'success' },
  finance: { label: '财务', tone: 'success' },
  // 订单状态。任务状态改用 `queued` 后，`pending` 只服务订单与发票，
  // 两页都通过 <StatusTag label="待支付/待开具"> 覆盖文案。
  pending: { label: '等待', tone: 'warn' },
  paid: { label: '已支付', tone: 'success' },
  refunded: { label: '已退款', tone: 'danger' },
  partial_refunded: { label: '部分退款', tone: 'warn' },
  // 商品状态 (后端 Prisma Product.status)
  offline: { label: '已下架', tone: 'muted' },
  // 发票状态。`pending` 复用库存量条的「等待」色，发票页用 `label="待开具"` 覆盖文案
  issued: { label: '已开具', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
};
