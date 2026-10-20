import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { getCapability } from '../capabilities/capability.registry';
import { ROLE_LABELS, USER_STATUS_LABELS } from './permissions';
import { buildPage, paginate, type PageResult } from './dto/page-query.dto';
import type {
  ChangeUserRoleDto,
  ChangeUserStatusDto,
  UserListQueryDto,
} from './dto/user.dto';

/** 用户列表可排序的列 */
const SORTABLE = ['createdAt', 'lastLoginAt', 'email', 'name'] as const;

/** 重置密码时的随机字符集: 去掉易混淆的 0O / 1lI */
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 用户列表。
   *
   * 统计口径说明: 项目/任务/素材数用 `_count` 关联查询, 不做 N+1。
   * 已注销用户 (status='deleted') 默认不在列表里 —— 运营要找的是活跃账号;
   * 需要查历史时可显式传 status=deleted。
   */
  async list(query: UserListQueryDto): Promise<PageResult<unknown>> {
    const page = buildPage(query, [...SORTABLE], 'createdAt:desc');

    const where: Record<string, unknown> = {};
    if (query.keyword) {
      // 前缀优先: 走索引更快; 用户习惯是输入邮箱开头
      where['email'] = { contains: query.keyword };
    }
    if (query.role) where['role'] = query.role;
    // 未指定 status 时默认排除 deleted, 避免注销账号长期占据列表
    if (query.status) {
      where['status'] = query.status;
    } else {
      where['status'] = { not: 'deleted' };
    }

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      const from = this.parseDate(query.from);
      const to = this.parseDate(query.to);
      if (from) createdAt['gte'] = from;
      if (to) createdAt['lte'] = to;
      if (Object.keys(createdAt).length > 0) where['createdAt'] = createdAt;
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: page.orderBy,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { projects: true, tasks: true, assets: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(
      items.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        roleLabel: ROLE_LABELS[u.role] ?? u.role,
        status: u.status,
        statusLabel: USER_STATUS_LABELS[u.status] ?? u.status,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        projectCount: u._count.projects,
        taskCount: u._count.tasks,
        assetCount: u._count.assets,
      })),
      total,
      page,
    );
  }

  /**
   * 用户详情: 基本信息 + 三项统计 + 最近任务 + 最近素材。
   *
   * 只取最近 20 条而非全量 —— 抽屉是概览用途, 全量会把响应体撑大。
   */
  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { projects: true, tasks: true, assets: true } },
      },
    });
    if (!user) throw new AppError(40400, '用户不存在', 404);

    const [recentTasks, recentAssets] = await Promise.all([
      this.prisma.generationTask.findMany({
        where: { ownerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          capability: true,
          status: true,
          createdAt: true,
          outputAsset: { select: { sourceUrl: true } },
        },
      }),
      this.prisma.asset.findMany({
        where: { ownerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, sourceUrl: true, kind: true, width: true, height: true },
      }),
    ]);

    const taskStats = await this.prisma.generationTask.groupBy({
      by: ['status'],
      where: { ownerId: id },
      _count: { _all: true },
    });
    const statusCount: Record<string, number> = {};
    for (const g of taskStats) statusCount[g.status] = g._count._all;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role] ?? user.role,
      status: user.status,
      statusLabel: USER_STATUS_LABELS[user.status] ?? user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      stats: {
        projects: user._count.projects,
        tasks: user._count.tasks,
        assets: user._count.assets,
        taskStatus: {
          succeeded: statusCount['succeeded'] ?? 0,
          failed: statusCount['failed'] ?? 0,
          running: statusCount['running'] ?? 0,
          pending: statusCount['pending'] ?? 0,
        },
      },
      recentTasks: recentTasks.map((t) => {
        const def = getCapability(t.capability);
        return {
          id: t.id,
          capability: t.capability,
          capabilityName: def?.name ?? t.capability,
          mode: def?.mode ?? 'unknown',
          status: t.status,
          createdAt: t.createdAt,
          thumbnailUrl: t.outputAsset?.sourceUrl ?? null,
        };
      }),
      recentAssets: recentAssets.map((a) => ({
        id: a.id,
        sourceUrl: a.sourceUrl,
        kind: a.kind,
        width: a.width,
        height: a.height,
      })),
    };
  }

  /**
   * 禁用/启用。
   *
   * 由于 AdminGuard 每次请求查库校验 status, 被禁用用户的旧 token
   * 在下一次请求即失效, 无需额外的 token 黑名单。
   */
  async changeStatus(id: string, dto: ChangeUserStatusDto, actorId: string) {
    const user = await this.findUser(id);

    if (id === actorId) {
      throw new AppError(40001, '不能禁用或启用自己', 400);
    }
    if (user.status === 'deleted') {
      throw new AppError(40001, '已注销用户无需禁用', 400);
    }
    // 最后一个 admin 被禁用会让系统失去唯一管理入口
    if (user.role === 'admin' && dto.status === 'disabled') {
      const adminCount = await this.prisma.user.count({
        where: { role: 'admin', status: 'active' },
      });
      if (adminCount <= 1) {
        throw new AppError(40901, '至少保留一个启用的管理员', 409);
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
    });

    return { id, status: dto.status };
  }

  /**
   * 角色变更。
   *
   * 两条硬规则:
   *   1. 非 admin 操作者不得把他人提升为 admin —— 防提权
   *   2. 最后一个 admin 不得降级 —— 否则系统失去管理入口
   */
  async changeRole(id: string, dto: ChangeUserRoleDto, actor: { id: string; role: string }) {
    const user = await this.findUser(id);

    if (id === actor.id) {
      throw new AppError(40001, '不能变更自己的角色', 400);
    }
    if (user.status === 'deleted') {
      throw new AppError(40001, '已注销用户无需变更角色', 400);
    }
    if (user.role === dto.role) {
      throw new AppError(40001, '目标角色与当前一致', 400);
    }

    // 防提权: 只有 admin 能授予 admin
    if (dto.role === 'admin' && actor.role !== 'admin') {
      throw new AppError(40301, '只有管理员可以授予管理员角色', 403);
    }

    // 最后一个 admin 保护
    if (user.role === 'admin') {
      const adminCount = await this.prisma.user.count({
        where: { role: 'admin', status: 'active' },
      });
      if (adminCount <= 1) {
        throw new AppError(40901, '至少保留一个管理员', 409);
      }
    }

    await this.prisma.user.update({ where: { id }, data: { role: dto.role } });
    return { id, role: dto.role, roleLabel: ROLE_LABELS[dto.role] ?? dto.role };
  }

  /**
   * 重置密码: 生成一次性临时密码, 明文仅本次返回。
   *
   * 不提供「查看现有密码」的能力 —— 密码是单向哈希, 本就不存在明文。
   */
  async resetPassword(id: string) {
    const user = await this.findUser(id);
    if (user.status === 'deleted') {
      throw new AppError(40001, '已注销用户无需重置密码', 400);
    }

    const password = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });

    return {
      id,
      email: user.email,
      // 明文只在这里出现一次, 不入库、不落盘、不入审计
      tempPassword: password,
      notice: '此密码仅显示一次, 关闭后无法再次查看',
    };
  }

  /**
   * 删除用户。
   *
   * 默认软删 (status='deleted'): 订单受法定留存约束不能随账号删除,
   * 物理删除也只删可删的部分, 订单与支付记录保留、用户信息匿名化。
   *
   * `hard=true` 时物理删除项目/素材/任务/流水; 仍不删订单 (法务要求)。
   */
  async remove(id: string, hard: boolean, confirm?: string) {
    const user = await this.findUser(id);

    const counts = await this.prisma.user.findUnique({
      where: { id },
      select: {
        _count: { select: { projects: true, tasks: true, assets: true } },
      },
    });

    if (hard) {
      if (confirm !== '删除') {
        throw new AppError(40001, '物理删除需要确认词「删除」', 400);
      }
      // 先删子表再删用户: SQLite 无外键级联, 手工保证顺序
      await this.prisma.$transaction([
        this.prisma.asset.deleteMany({ where: { ownerId: id } }),
        this.prisma.generationTask.deleteMany({ where: { ownerId: id } }),
        this.prisma.project.deleteMany({ where: { ownerId: id } }),
        this.prisma.user.delete({ where: { id } }),
      ]);
      return { id, hard: true, deleted: counts?._count ?? { projects: 0, tasks: 0, assets: 0 } };
    }

    // 软删: 置状态 + 匿名化可识别信息, 数据保留供审计与举证
    await this.prisma.user.update({
      where: { id },
      data: {
        status: 'deleted',
        email: `deleted_${id}@anonymized.local`,
        name: '已注销用户',
        passwordHash: '',
      },
    });

    return { id, hard: false };
  }

  /** 账号注销后遗留的孤儿数据清理说明, 供前端展示 */
  async impactPreview(id: string) {
    const user = await this.findUser(id);
    const [projects, tasks, assets] = await Promise.all([
      this.prisma.project.count({ where: { ownerId: id } }),
      this.prisma.generationTask.count({ where: { ownerId: id } }),
      this.prisma.asset.count({ where: { ownerId: id } }),
    ]);
    return { email: user.email, projects, tasks, assets };
  }

  private async findUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!user) throw new AppError(40400, '用户不存在', 404);
    return user;
  }

  private generateTempPassword(): string {
    let out = '';
    for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
      out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    // 保证三类字符齐全, 避免生成的密码被复杂度策略拒绝
    if (!/[A-Z]/.test(out) || !/[a-z]/.test(out) || !/[0-9]/.test(out)) {
      return this.generateTempPassword();
    }
    return out;
  }

  /** ISO 字符串 → Date, 非法返回 undefined 而不是抛错 (非法输入应被忽略而非 500) */
  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}
