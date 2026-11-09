import { ADMIN_MENU } from '../components/admin/adminNav';

/**
 * 命令面板的静态命令注册表。
 *
 * 命令只做导航（含页面内的 `?create=1` 预置），不直接执行写操作。权限点
 * 用于前端过滤；真正的写操作仍由目标页调用原接口，后端逐请求校验。
 */
export interface AdminCommand {
  key: string;
  title: string;
  keywords: string;
  /** null = 所有后台角色可见；数组 = 拥有任一权限即可见 */
  permissions: string[] | null;
  path: string;
  section: 'navigate' | 'create' | 'view';
}

function menuPermissions(permission: string | string[] | null): string[] | null {
  if (permission === null) return null;
  return Array.isArray(permission) ? permission : [permission];
}

const NAV_COMMANDS: AdminCommand[] = ADMIN_MENU.flatMap((group) =>
  group.items.map((item) => ({
    key: `nav:${item.path}`,
    title: item.label,
    keywords: `${group.name} ${item.label} ${item.path}`,
    permissions: menuPermissions(item.permission),
    path: item.path,
    section: 'navigate' as const,
  })),
);

const CREATE_COMMANDS: AdminCommand[] = [
  {
    key: 'create:product',
    title: '新建商品',
    keywords: '商品 SKU 积分包 新建',
    permissions: ['product.write'],
    path: '/admin/products?create=1',
    section: 'create',
  },
  {
    key: 'create:coupon',
    title: '新建优惠券',
    keywords: '优惠券 满减 折扣 新建',
    permissions: ['marketing.write'],
    path: '/admin/coupons?create=1',
    section: 'create',
  },
  {
    key: 'create:campaign',
    title: '新建限时活动',
    keywords: '活动 限时 免费 新建',
    permissions: ['marketing.write'],
    path: '/admin/campaigns?create=1',
    section: 'create',
  },
  {
    key: 'create:backup',
    title: '数据备份',
    keywords: '备份 数据库 快照',
    permissions: ['backup.run'],
    path: '/admin/backups',
    section: 'create',
  },
];

const VIEW_COMMANDS: AdminCommand[] = [
  {
    key: 'view:ticket-open',
    title: '待回复工单',
    keywords: '工单 待回复 未指派',
    permissions: ['ticket.read'],
    path: '/admin/tickets?status=open&assigneeId=unassigned',
    section: 'view',
  },
  {
    key: 'view:ticket-processing',
    title: '处理中工单',
    keywords: '工单 处理中',
    permissions: ['ticket.read'],
    path: '/admin/tickets?status=processing',
    section: 'view',
  },
  {
    key: 'view:task-failed',
    title: '失败任务',
    keywords: '任务 失败 错误码',
    permissions: ['task.read'],
    path: '/admin/tasks?status=failed',
    section: 'view',
  },
  {
    key: 'view:refund-processing',
    title: '退款处理中',
    keywords: '订单 退款 渠道 处理中',
    permissions: ['order.read'],
    path: '/admin/orders?refundState=processing',
    section: 'view',
  },
  {
    key: 'view:billing-uncertain',
    title: '账单结果不明',
    keywords: '账单 uncertain 人工核对',
    permissions: ['billing_order.read'],
    path: '/admin/billing-orders?status=uncertain',
    section: 'view',
  },
  {
    key: 'view:invoice-pending',
    title: '待开具发票',
    keywords: '发票 待开',
    permissions: ['invoice.write'],
    path: '/admin/invoices?status=pending',
    section: 'view',
  },
];

export const ADMIN_COMMANDS: AdminCommand[] = [
  ...NAV_COMMANDS,
  ...CREATE_COMMANDS,
  ...VIEW_COMMANDS,
];

export function filterAdminCommands(
  commands: AdminCommand[],
  canAny: (...permissions: string[]) => boolean,
): AdminCommand[] {
  return commands.filter((command) => {
    if (command.permissions === null) return true;
    return canAny(...command.permissions);
  });
}

/** 命令匹配：标题、关键词、路径任一命中即可 */
export function matchAdminCommands(commands: AdminCommand[], query: string): AdminCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands.slice(0, 30);
  return commands
    .filter((command) =>
      `${command.title} ${command.keywords} ${command.path}`.toLowerCase().includes(q),
    )
    .slice(0, 30);
}

export const COMMAND_SECTION_LABELS: Record<AdminCommand['section'], string> = {
  navigate: '跳转',
  create: '新建',
  view: '视图',
};
