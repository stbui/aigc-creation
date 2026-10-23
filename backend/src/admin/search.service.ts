import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 后台全局搜索。
 *
 * ## 为什么是「每类取前 5」而不是统一分页
 *
 * 运营在顶栏搜索时手里通常只有一条线索：一个邮箱、一个订单号、一个工单号。
 * 他要的是「跳过去」而不是「在搜索结果里继续翻页」。统一分页会把 5 类结果
 * 拍平成一条混合流，反而要滚很久才找到真正要的那一类。
 *
 * 每类取 5 条、给出该类总数，用户点「查看全部」再带条件跳到对应列表页 ——
 * 列表页本来就有完整筛选，不必在搜索里重建一套。
 *
 * ## 匹配范围
 *
 * 只匹配**人能记住的字段**（邮箱、昵称、订单号、工单号、任务 id、素材地址）。
 * 不搜 params / content 这类长文本：LIKE 全表扫描在 SQLite 上代价高，
 * 且命中率低 —— 用户记不住自己三个月前写的提示词。
 */

/** 每类返回条数 */
const PER_GROUP = 5;

export interface SearchHit {
  id: string;
  /** 主标题（供列表第一行） */
  title: string;
  /** 副标题（补充信息：状态、金额、时间） */
  subtitle: string;
  /** 前端点击跳转的后台路径 */
  link: string;
}

@Injectable()
export class AdminSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(rawQuery: string) {
    const q = (rawQuery ?? '').trim().slice(0, 80);
    if (q.length < 2) {
      /*
       * 单字符搜索返回空而不是报错：用户在输入过程中会连续触发请求，
       * 前几个字符被拒会让搜索框看起来「时好时坏」。
       * 真正需要拒的是**空串** —— 空串会把各表前 5 条全捞出来。
       */
      return { query: q, groups: emptyGroups(), total: 0 };
    }

    const [users, userCount, orders, orderCount, tickets, ticketCount, tasks, taskCount, assets, assetCount] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { OR: [{ email: { contains: q } }, { name: { contains: q } }, { id: q }] },
          orderBy: { createdAt: 'desc' },
          take: PER_GROUP,
          select: { id: true, email: true, name: true, role: true, status: true },
        }),
        this.prisma.user.count({
          where: { OR: [{ email: { contains: q } }, { name: { contains: q } }, { id: q }] },
        }),
        this.prisma.order.findMany({
          where: { OR: [{ orderNo: { contains: q } }, { id: q }] },
          orderBy: { createdAt: 'desc' },
          take: PER_GROUP,
          select: {
            id: true,
            orderNo: true,
            status: true,
            paidCents: true,
            totalCents: true,
            createdAt: true,
            user: { select: { email: true } },
          },
        }),
        this.prisma.order.count({ where: { OR: [{ orderNo: { contains: q } }, { id: q }] } }),
        this.prisma.ticket.findMany({
          where: { OR: [{ ticketNo: { contains: q } }, { subject: { contains: q } }, { id: q }] },
          orderBy: { createdAt: 'desc' },
          take: PER_GROUP,
          select: { id: true, ticketNo: true, subject: true, status: true, createdAt: true },
        }),
        this.prisma.ticket.count({
          where: { OR: [{ ticketNo: { contains: q } }, { subject: { contains: q } }, { id: q }] },
        }),
        this.prisma.generationTask.findMany({
          where: { OR: [{ id: { contains: q } }, { capability: { contains: q } }] },
          orderBy: { createdAt: 'desc' },
          take: PER_GROUP,
          select: {
            id: true,
            capability: true,
            status: true,
            createdAt: true,
            owner: { select: { email: true } },
          },
        }),
        this.prisma.generationTask.count({
          where: { OR: [{ id: { contains: q } }, { capability: { contains: q } }] },
        }),
        this.prisma.asset.findMany({
          where: { OR: [{ id: { contains: q } }, { sourceUrl: { contains: q } }] },
          orderBy: { createdAt: 'desc' },
          take: PER_GROUP,
          select: { id: true, sourceUrl: true, kind: true, capability: true, createdAt: true },
        }),
        this.prisma.asset.count({
          where: { OR: [{ id: { contains: q } }, { sourceUrl: { contains: q } }] },
        }),
      ]);

    const groups = [
      {
        key: 'users',
        label: '用户',
        total: userCount,
        items: users.map<SearchHit>((u) => ({
          id: u.id,
          title: `${u.name} (${u.email})`,
          subtitle: `${roleLabel(u.role)} · ${statusLabel(u.status)}`,
          link: `/admin/users?q=${encodeURIComponent(u.email)}`,
        })),
      },
      {
        key: 'orders',
        label: '订单',
        total: orderCount,
        items: orders.map<SearchHit>((o) => ({
          id: o.id,
          title: o.orderNo,
          subtitle: `${o.user?.email ?? ''} · ¥${yuan(o.paidCents > 0 ? o.paidCents : o.totalCents)} · ${o.status}`,
          link: `/admin/orders?orderNo=${encodeURIComponent(o.orderNo)}`,
        })),
      },
      {
        key: 'tickets',
        label: '工单',
        total: ticketCount,
        items: tickets.map<SearchHit>((t) => ({
          id: t.id,
          title: `${t.ticketNo} ${t.subject}`,
          subtitle: t.status,
          link: `/admin/tickets?id=${encodeURIComponent(t.id)}`,
        })),
      },
      {
        key: 'tasks',
        label: '任务',
        total: taskCount,
        items: tasks.map<SearchHit>((t) => ({
          id: t.id,
          title: `${t.capability} · ${t.id.slice(0, 10)}`,
          subtitle: `${t.owner?.email ?? ''} · ${t.status}`,
          link: `/admin/tasks?id=${encodeURIComponent(t.id)}`,
        })),
      },
      {
        key: 'assets',
        label: '素材',
        total: assetCount,
        items: assets.map<SearchHit>((a) => ({
          id: a.id,
          title: a.sourceUrl.split('/').pop() ?? a.id,
          subtitle: `${a.kind}${a.capability ? ` · ${a.capability}` : ''}`,
          // 素材页没有详情抽屉, 但列表的 keyword 同时匹配 id 与能力名 ——
          // 用 q 带过去即可让目标素材成为列表里唯一一行
          link: `/admin/assets?q=${encodeURIComponent(a.id)}`,
        })),
      },
    ];

    return { query: q, groups, total: groups.reduce((s, g) => s + g.total, 0) };
  }
}

function emptyGroups() {
  return [
    { key: 'users', label: '用户', total: 0, items: [] as SearchHit[] },
    { key: 'orders', label: '订单', total: 0, items: [] as SearchHit[] },
    { key: 'tickets', label: '工单', total: 0, items: [] as SearchHit[] },
    { key: 'tasks', label: '任务', total: 0, items: [] as SearchHit[] },
    { key: 'assets', label: '素材', total: 0, items: [] as SearchHit[] },
  ];
}

const ROLE_LABELS: Record<string, string> = {
  user: '普通用户',
  admin: '管理员',
  operator: '运营',
  finance: '财务',
};
const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  disabled: '已禁用',
  deleted: '已注销',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
