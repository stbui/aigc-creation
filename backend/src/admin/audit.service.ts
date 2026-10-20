import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPage, paginate, type PageResult } from './dto/page-query.dto';
import type { AuditListQueryDto } from './dto/audit.dto';

const SORTABLE = ['createdAt', 'action'] as const;

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 审计日志查询。
   *
   * 只读: 后端不提供任何删除接口, 表设计上也只允许 INSERT。
   * 已知不足 —— 管理员仍可直接操作数据库删除 (彻底解决需独立存储或哈希链)。
   */
  async list(query: AuditListQueryDto): Promise<{
    result: PageResult<unknown>;
    actions: Array<{ action: string; count: number }>;
  }> {
    const page = buildPage(query, [...SORTABLE], 'createdAt:desc');

    const where: Record<string, unknown> = {};
    if (query.actorId) where['actorId'] = query.actorId;
    if (query.action) where['action'] = query.action;
    if (query.targetId) where['targetId'] = query.targetId;
    if (query.success !== undefined) where['success'] = query.success;
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      const from = this.parseDate(query.from);
      const to = this.parseDate(query.to);
      if (from) createdAt['gte'] = from;
      if (to) createdAt['lte'] = to;
      if (Object.keys(createdAt).length > 0) where['createdAt'] = createdAt;
    }

    const [items, total, actionGroups] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: page.orderBy,
      }),
      this.prisma.adminAuditLog.count({ where }),
      // 动作筛选项: 从库里的实际数据聚合, 避免前端硬编码一份会过期的清单
      this.prisma.adminAuditLog.groupBy({ by: ['action'], _count: { _all: true } }),
    ]);

    // 操作人信息单独查: AdminAuditLog.actorId 是裸 String 无外键关系 ——
    // 系统产生的记录 (actorId='unknown') 不对应任何 User, 建立关系会在删除用户时
    // 留下悬空引用。分开查还能顺带处理「用户已注销/已删除」的降级展示。
    const actorIds = Array.from(new Set(items.map((r) => r.actorId)));
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, email: true, name: true },
    });
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return {
      result: paginate(
        items.map((row) => {
          const actor = actorById.get(row.actorId);
          return {
            id: row.id,
            createdAt: row.createdAt,
            actorId: row.actorId,
            actorEmail: actor?.email ?? '(系统或已删除)',
            actorName: actor?.name ?? '',
            actorRole: row.actorRole,
            action: row.action,
            targetType: row.targetType,
            targetId: row.targetId,
            detail: this.safeParse(row.detail),
            reason: row.reason,
            ip: row.ip,
            success: row.success,
          };
        }),
        total,
        page,
      ),
      actions: actionGroups
        .map((g) => ({ action: g.action, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** 单条详情: 含操作前后的完整 detail */
  async detail(id: string) {
    const row = await this.prisma.adminAuditLog.findUnique({ where: { id } });
    if (!row) return null;
    const actor = await this.prisma.user.findUnique({
      where: { id: row.actorId },
      select: { email: true, name: true },
    });
    return {
      id: row.id,
      createdAt: row.createdAt,
      actorId: row.actorId,
      actorEmail: actor?.email ?? '(系统或已删除)',
      actorName: actor?.name ?? '',
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      detail: this.safeParse(row.detail),
      reason: row.reason,
      ip: row.ip,
      success: row.success,
    };
  }

  private safeParse(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
      return { raw };
    }
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}