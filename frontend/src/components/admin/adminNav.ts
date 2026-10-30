/**
 * 后台导航的单一数据源。
 *
 * 侧栏、页头面包屑和「待开放」兜底页都从这里取名称与分组。集中在一处，
 * 改菜单文案时不会出现「侧栏叫 A、页头叫 B」的错位。
 */
export interface AdminMenuItem {
  path: string;
  label: string;
  /** 折叠态字形（默认取标签前两字）；仅当前两字会与别的项撞车时才需要显式给 */
  short?: string;
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
        permission: 'platform.dashboard',
      },
      {
        path: '/admin/alerts',
        label: '告警中心',
        // 所有后台角色都可进入；具体来源在接口内按权限过滤
        permission: null,
      },
    ],
  },
  {
    name: '运营',
    items: [
      { path: '/admin/users', label: '用户管理', permission: 'user.read' },
      { path: '/admin/assets', label: '素材管理', permission: 'asset.read' },
      { path: '/admin/tasks', label: '任务监控', permission: 'task.read' },
      { path: '/admin/tickets', label: '工单处理', permission: 'ticket.read' },
    ],
  },
  {
    name: '内容',
    items: [
      { path: '/admin/legal', label: '法务文档', permission: 'legal.read' },
      {
        path: '/admin/notifications',
        label: '站内消息',
        permission: 'message.write',
      },
      { path: '/admin/aigc-label', label: 'AI 标识', permission: 'setting.read' },
    ],
  },
  {
    name: '交易',
    items: [
      { path: '/admin/products', label: '商品管理', permission: 'product.read' },
      { path: '/admin/orders', label: '订单管理', permission: 'order.read' },
      { path: '/admin/credits', label: '积分账本', permission: 'credit.read' },
      // 「能力消耗价」与「能力管控」前两字相同，折叠态各给一个能区分的字形
      { path: '/admin/credit-prices', label: '能力消耗价', short: '定价', permission: 'product.price' },
      { path: '/admin/coupons', label: '优惠券', permission: 'marketing.write' },
      { path: '/admin/campaigns', label: '限时活动', permission: 'marketing.write' },
      {
        path: '/admin/marketing-rules',
        label: '邀请与签到',
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
        permission: 'payment.read',
      },
      { path: '/admin/invoices', label: '发票管理', permission: 'invoice.write' },
      {
        path: '/admin/reconciliation',
        label: '渠道对账',
        permission: 'payment.read',
      },
    ],
  },
  {
    name: '系统',
    items: [
      { path: '/admin/roles', label: '角色权限', permission: 'audit.read' },
      { path: '/admin/settings', label: '系统设置', permission: 'setting.read' },
      { path: '/admin/storage', label: '存储配置', permission: 'setting.read' },
      { path: '/admin/scheduler', label: '定时任务', permission: 'setting.read' },
      { path: '/admin/audit-logs', label: '操作审计', permission: 'audit.read' },
    ],
  },
  {
    name: '模型',
    items: [
      {
        path: '/admin/model-config',
        label: '模型配置',
        permission: 'model.config_read',
      },
      { path: '/admin/model-calls', label: '调用记录', permission: 'model.call_read' },
      { path: '/admin/capabilities', label: '能力管控', short: '管控', permission: 'capability.read' },
    ],
  },
  {
    name: '数据安全',
    items: [
      { path: '/admin/backups', label: '数据备份', permission: 'backup.read' },
      { path: '/admin/retention', label: '保留期清理', permission: 'backup.read' },
    ],
  },
];

export function findAdminMenuItem(path: string): AdminMenuItem | undefined {
  return ADMIN_MENU.flatMap((group) => group.items).find((item) => item.path === path);
}

export function findAdminMenuGroup(path: string): AdminMenuGroup | undefined {
  return ADMIN_MENU.find((group) => group.items.some((item) => item.path === path));
}
