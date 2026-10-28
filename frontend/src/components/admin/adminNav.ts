import {
  Activity,
  BadgeCheck,
  BellRing,
  CalendarClock,
  Coins,
  CreditCard,
  DatabaseBackup,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Gift,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Package,
  Power,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  SlidersHorizontal,
  TicketPercent,
  Timer,
  Users,
  Waypoints,
} from 'lucide-react';

/**
 * 后台导航的单一数据源。
 *
 * 侧栏、页头面包屑和「待开放」兜底页都从这里取名称与分组。集中在一处，
 * 改菜单文案时不会出现「侧栏叫 A、页头叫 B」的错位。
 */
export interface AdminMenuItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: string | null;
  /** 尚未实现的模块：置灰但可见，明确告知规划状态而非直接隐藏 */
  planned?: boolean;
}

export interface AdminMenuGroup {
  name: string;
  items: AdminMenuItem[];
}

export const ADMIN_MENU: AdminMenuGroup[] = [
  {
    name: '总览',
    items: [
      {
        path: '/admin',
        label: '平台概览',
        icon: LayoutDashboard,
        permission: 'platform.dashboard',
      },
      {
        path: '/admin/alerts',
        label: '告警中心',
        icon: BellRing,
        // 所有后台角色都可进入；具体来源在接口内按权限过滤
        permission: null,
      },
    ],
  },
  {
    name: '运营',
    items: [
      { path: '/admin/users', label: '用户管理', icon: Users, permission: 'user.read' },
      { path: '/admin/assets', label: '素材管理', icon: FolderOpen, permission: 'asset.read' },
      { path: '/admin/tasks', label: '任务监控', icon: Activity, permission: 'task.read' },
      { path: '/admin/tickets', label: '工单处理', icon: MessagesSquare, permission: 'ticket.read' },
    ],
  },
  {
    name: '内容',
    items: [
      { path: '/admin/legal', label: '法务文档', icon: Scale, permission: 'legal.read' },
      {
        path: '/admin/notifications',
        label: '站内消息',
        icon: BellRing,
        permission: 'message.write',
      },
      { path: '/admin/aigc-label', label: 'AI 标识', icon: BadgeCheck, permission: 'setting.read' },
    ],
  },
  {
    name: '交易',
    items: [
      { path: '/admin/products', label: '商品管理', icon: Package, permission: 'product.read' },
      { path: '/admin/orders', label: '订单管理', icon: Receipt, permission: 'order.read' },
      { path: '/admin/credits', label: '积分账本', icon: Coins, permission: 'credit.read' },
      { path: '/admin/credit-prices', label: '能力消耗价', icon: Coins, permission: 'product.price' },
      { path: '/admin/coupons', label: '优惠券', icon: TicketPercent, permission: 'marketing.write' },
      { path: '/admin/campaigns', label: '限时活动', icon: Megaphone, permission: 'marketing.write' },
      {
        path: '/admin/marketing-rules',
        label: '邀请与签到',
        icon: Gift,
        permission: 'marketing.write',
      },
    ],
  },
  {
    name: '财务',
    items: [
      {
        path: '/admin/payment-channels',
        label: '支付渠道',
        icon: CreditCard,
        permission: 'payment.read',
      },
      { path: '/admin/invoices', label: '发票管理', icon: FileText, permission: 'invoice.write' },
      {
        path: '/admin/reconciliation',
        label: '渠道对账',
        icon: FileSpreadsheet,
        permission: 'payment.read',
      },
    ],
  },
  {
    name: '系统',
    items: [
      { path: '/admin/roles', label: '角色权限', icon: KeyRound, permission: 'audit.read' },
      { path: '/admin/settings', label: '系统设置', icon: Settings, permission: 'setting.read' },
      { path: '/admin/storage', label: '存储配置', icon: HardDrive, permission: 'setting.read' },
      { path: '/admin/scheduler', label: '定时任务', icon: CalendarClock, permission: 'setting.read' },
      { path: '/admin/audit-logs', label: '操作审计', icon: ScrollText, permission: 'audit.read' },
    ],
  },
  {
    name: '模型',
    items: [
      {
        path: '/admin/model-config',
        label: '模型配置',
        icon: SlidersHorizontal,
        permission: 'model.config_read',
      },
      { path: '/admin/model-calls', label: '调用记录', icon: Waypoints, permission: 'model.call_read' },
      { path: '/admin/capabilities', label: '能力管控', icon: Power, permission: 'capability.read' },
    ],
  },
  {
    name: '数据安全',
    items: [
      { path: '/admin/backups', label: '数据备份', icon: DatabaseBackup, permission: 'backup.read' },
      { path: '/admin/retention', label: '保留期清理', icon: Timer, permission: 'backup.read' },
    ],
  },
];

export function findAdminMenuItem(path: string): AdminMenuItem | undefined {
  return ADMIN_MENU.flatMap((group) => group.items).find((item) => item.path === path);
}

export function findAdminMenuGroup(path: string): AdminMenuGroup | undefined {
  return ADMIN_MENU.find((group) => group.items.some((item) => item.path === path));
}
