/**
 * 后台导航的单一数据源。
 *
 * 侧栏、页头面包屑和「待开放」兜底页都从这里取名称与分组。集中在一处，
 * 改菜单文案时不会出现「侧栏叫 A、页头叫 B」的错位。
 */
import {
  Activity,
  AlertTriangle,
  BellRing,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Coins,
  Crown,
  DatabaseBackup,
  FileSpreadsheet,
  FileText,
  HandCoins,
  HardDrive,
  Images,
  LayoutDashboard,
  ListTree,
  Mail,
  MessagesSquare,
  MessageSquareText,
  Network,
  Package,
  Puzzle,
  ReceiptText,
  Settings,
  Share2,
  ShieldCheck,
  Tag,
  Ticket,
  Trash2,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface AdminMenuItem {
  path: string;
  label: string;
  /** 侧栏字形；折叠态只留它，展开态显示在标签左侧 */
  icon: LucideIcon;
  /** 单一权限点，或拥有任一权限点即可见 */
  permission: string | string[] | null;
  /** 尚未实现的模块：置灰但可见，明确告知规划状态而非直接隐藏 */
  planned?: boolean;
}

export interface AdminMenuGroup {
  name: string;
  items: AdminMenuItem[];
}

export const ADMIN_MENU: AdminMenuGroup[] = [
  {
    name: "总览",
    items: [
      {
        path: "/admin",
        label: "平台概览",
        icon: LayoutDashboard,
        permission: "platform.dashboard",
      },
      {
        path: "/admin/alerts",
        label: "告警中心",
        icon: BellRing,
        // 所有后台角色都可进入；具体来源在接口内按权限过滤
        permission: null,
      },
    ],
  },
  {
    name: "运营与内容",
    items: [
      {
        path: "/admin/users",
        label: "用户管理",
        icon: Users,
        permission: "user.read",
      },
      {
        path: "/admin/tasks",
        label: "任务监控",
        icon: Activity,
        permission: "task.read",
      },
      {
        path: "/admin/tickets",
        label: "工单处理",
        icon: MessagesSquare,
        permission: "ticket.read",
      },
      {
        path: "/admin/assets",
        label: "素材管理",
        icon: Images,
        permission: "asset.read",
      },
      {
        path: "/admin/notifications",
        label: "站内消息",
        icon: MessageSquareText,
        permission: "message.write",
      },
      {
        path: "/admin/templates",
        label: "写真模板",
        icon: Images,
        permission: "template.read",
      },
      {
        path: "/admin/aigc-label",
        label: "AI 标识",
        icon: Tag,
        permission: "setting.read",
      },
    ],
  },
  {
    name: "模型与能力",
    items: [
      // 供应侧 → 能力 → 扩展 → 人群 → 排障
      {
        path: "/admin/channels",
        label: "模型商品",
        icon: Network,
        permission: "channel.read",
      },
      {
        path: "/admin/capabilities",
        label: "能力与模型",
        icon: Boxes,
        permission: ["capability.read", "logical_model.read", "product.price"],
      },
      {
        path: "/admin/plugins",
        label: "插件",
        icon: Puzzle,
        permission: "plugin.read",
      },
      {
        path: "/admin/user-groups",
        label: "用户分组",
        icon: UsersRound,
        permission: "user_group.read",
      },
      {
        path: "/admin/model-calls",
        label: "调用记录",
        icon: ListTree,
        permission: "model.call_read",
      },
    ],
  },
  {
    name: "商品与交易",
    items: [
      {
        path: "/admin/products",
        label: "商品管理",
        icon: Package,
        permission: "product.read",
      },
      {
        path: "/admin/membership-plans",
        label: "会员套餐",
        icon: Crown,
        permission: "product.read",
      },
      {
        path: "/admin/orders",
        label: "订单管理",
        icon: ReceiptText,
        permission: "order.read",
      },
      {
        path: "/admin/credits",
        label: "积分账本",
        icon: Coins,
        permission: "credit.read",
      },
      {
        path: "/admin/coupons",
        label: "优惠券",
        icon: Ticket,
        permission: "marketing.write",
      },
      {
        path: "/admin/campaigns",
        label: "限时活动",
        icon: CalendarClock,
        permission: "marketing.write",
      },
      {
        path: "/admin/marketing-rules",
        label: "邀请与签到",
        icon: Share2,
        permission: "marketing.write",
      },
    ],
  },
  {
    name: "资金与财务",
    items: [
      {
        path: "/admin/payments?tab=providers",
        label: "收款设置",
        icon: Wallet,
        permission: "payment.read",
      },
      {
        path: "/admin/payments?tab=reconciliation",
        label: "交易核对",
        icon: ClipboardCheck,
        permission: "payment.read",
      },
      {
        path: "/admin/payments?tab=exceptions",
        label: "异常处理",
        icon: AlertTriangle,
        permission: "payment.read",
      },
      {
        path: "/admin/payment-rules",
        label: "支付与退费",
        icon: HandCoins,
        permission: "setting.read",
      },
      // 开票 → 生成账单 → 分析：支付配置已拆为独立运营入口
      {
        path: "/admin/invoices",
        label: "发票管理",
        icon: FileText,
        permission: "invoice.write",
      },
      {
        path: "/admin/billing-orders",
        label: "生成账单",
        icon: FileSpreadsheet,
        permission: "billing_order.read",
      },
      {
        path: "/admin/finance",
        label: "财务分析",
        icon: TrendingUp,
        // 账单口径的财务汇总：实收只算已结算，挂账单列
        permission: "model.analytics_read",
      },
    ],
  },
  {
    name: "系统",
    items: [
      {
        path: "/admin/roles",
        label: "角色权限",
        icon: ShieldCheck,
        permission: "role.read",
      },
      {
        path: "/admin/settings",
        label: "系统设置",
        icon: Settings,
        permission: "setting.read",
      },
      {
        path: "/admin/email",
        label: "邮箱配置",
        icon: Mail,
        permission: "setting.read",
      },
      {
        path: "/admin/storage",
        label: "存储配置",
        icon: HardDrive,
        permission: "setting.read",
      },
      {
        path: "/admin/scheduler",
        label: "定时任务",
        icon: Clock,
        permission: "setting.read",
      },
    ],
  },
  {
    name: "数据与安全",
    items: [
      {
        path: "/admin/backups",
        label: "数据备份",
        icon: DatabaseBackup,
        permission: "backup.read",
      },
      {
        path: "/admin/retention",
        label: "保留期清理",
        icon: Trash2,
        permission: "backup.read",
      },
    ],
  },
];

export function findAdminMenuItem(path: string): AdminMenuItem | undefined {
  return ADMIN_MENU.flatMap((group) => group.items)
    .sort((a, b) => menuPathSpecificity(b.path) - menuPathSpecificity(a.path))
    .find((item) => isAdminMenuPathActive(item.path, path));
}

export function findAdminMenuGroup(path: string): AdminMenuGroup | undefined {
  const item = findAdminMenuItem(path);
  if (!item) return undefined;
  return ADMIN_MENU.find((group) => group.items.includes(item));
}

/** 子路由（如 `/admin/email/preview`）也应点亮并定位到对应主菜单。 */
export function isAdminMenuPathActive(itemPath: string, path: string): boolean {
  const item = splitAdminPath(itemPath);
  const current = splitAdminPath(path);

  // `/admin` 是所有后台页面的前缀，但只能精确匹配概览，否则会抢占面包屑。
  if (item.pathname === '/admin') return current.pathname === '/admin';

  const pathMatched =
    current.pathname === item.pathname || current.pathname.startsWith(`${item.pathname}/`);
  if (!pathMatched) return false;
  if (item.search.size === 0) return true;

  // 带查询参数的菜单项必须命中全部参数；额外的筛选参数（如 status=failed）
  // 不改变所属菜单，因此允许存在。
  return [...item.search].every(([key, value]) => current.search.get(key) === value);
}

function splitAdminPath(path: string): { pathname: string; search: URLSearchParams } {
  const queryIndex = path.indexOf('?');
  const rawPathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const search = queryIndex === -1 ? '' : path.slice(queryIndex + 1);
  return {
    pathname: rawPathname.replace(/\/$/, '') || '/admin',
    search: new URLSearchParams(search),
  };
}

function menuPathSpecificity(path: string): number {
  const { pathname, search } = splitAdminPath(path);
  return pathname.length * 100 + search.size;
}
