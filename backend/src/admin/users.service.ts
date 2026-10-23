import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccountLifecycleService } from '../account/account-lifecycle.service';
import { AppError } from '../common/app.exception';
import { runBatch } from '../common/batch';
import { toCsv } from '../common/csv';
import { SignedUrlService } from '../common/signed-url.service';
import { StorageService } from '../storage/storage.service';
import type { StorageBackend } from '../storage/storage.provider';
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
  constructor(
    private readonly prisma: PrismaService,
    // 注销走 C 端同一份实现: 两处各删各的子表必然漂移,
    // 而漂移方向通常是「后台删干净了、自助注销漏了通知表」
    private readonly lifecycle: AccountLifecycleService,
    private readonly signedUrl: SignedUrlService,
    // 物理删除要连带删对象存储里的文件（只在 local 删会漏掉云上的）
    private readonly storage: StorageService,
  ) {}

  /**
   * 用户列表。
   *
   * 统计口径说明: 项目/任务/素材数用 `_count` 关联查询, 不做 N+1。
   * 已注销用户 (status='deleted') 默认不在列表里 —— 运营要找的是活跃账号;
   * 需要查历史时可显式传 status=deleted。
   */
  async list(query: UserListQueryDto): Promise<PageResult<unknown>> {
    const page = buildPage(query, [...SORTABLE], 'createdAt:desc');
    const where = this.listWhere(query);

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
   * 导出用户 (CSV)。
   *
   * 与列表共用同一个 where 构造器：导出通常就是为了核对列表上看到的数字，
   * 两处各写一份筛选条件，迟早会变成「筛出来 32 个、导出 400 个」。
   *
   * 不导出密码哈希、tokenVersion 这类内部字段 —— 导出文件会被转存、
   * 用邮件发走，只放运营真正需要的列。
   */
  async exportCsv(query: UserListQueryDto): Promise<string> {
    const rows = await this.prisma.user.findMany({
      where: this.listWhere(query),
      orderBy: { createdAt: 'desc' },
      take: 5000,
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
    return toCsv(
      [
        { label: '用户 ID', value: (u) => u.id },
        { label: '邮箱', value: (u) => u.email },
        { label: '昵称', value: (u) => u.name },
        { label: '角色', value: (u) => ROLE_LABELS[u.role] ?? u.role },
        { label: '状态', value: (u) => USER_STATUS_LABELS[u.status] ?? u.status },
        { label: '项目数', value: (u) => u._count.projects },
        { label: '任务数', value: (u) => u._count.tasks },
        { label: '素材数', value: (u) => u._count.assets },
        { label: '注册时间', value: (u) => u.createdAt },
        { label: '最后登录', value: (u) => u.lastLoginAt ?? '' },
      ],
      rows,
    );
  }

  /**
   * 批量启用 / 禁用。
   *
   * 逐条走 `changeStatus`，因此「不能禁用自己」「至少保留一个管理员」
   * 这些规则对批量同样生效 —— 批量不是绕过单条规则的通道，
   * 恰恰相反，批量最需要的正是这些规则的逐条校验。
   */
  async batchStatus(ids: string[], status: 'active' | 'disabled', actorId: string) {
    return runBatch(ids, (id) => this.changeStatus(id, { status }, actorId));
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
        phone: true,
        phoneVerifiedAt: true,
        tokenVersion: true,
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
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt,
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
          thumbnailUrl: this.signedUrl.displayUrl(t.outputAsset?.sourceUrl),
        };
      }),
      recentAssets: recentAssets.map((a) => ({
        id: a.id,
        sourceUrl: this.signedUrl.displayUrl(a.sourceUrl),
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
    /*
     * 一并自增 tokenVersion: 管理员重置密码通常意味着「怀疑账号被盗」，
     * 此时旧会话必须立即失效，否则重置密码只防住了下一次登录。
     */
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    return {
      id,
      email: user.email,
      // 明文只在这里出现一次, 不入库、不落盘、不入审计
      tempPassword: password,
      notice: '此密码仅显示一次, 关闭后无法再次查看',
    };
  }

  /**
   * 最近登录记录（后台用户详情用）。
   *
   * 成功与失败都返回：运营排查「用户说登不上」时，需要看到是密码错、
   * 验证码错，还是账号被禁用 —— 只给成功记录等于什么都没说。
   */
  async recentLogins(id: string, limit = 50) {
    await this.findUser(id);
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const [items, total, failed30d] = await Promise.all([
      this.prisma.loginLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          ip: true,
          ua: true,
          success: true,
          reason: true,
          createdAt: true,
        },
      }),
      this.prisma.loginLog.count({ where: { userId: id } }),
      this.prisma.loginLog.count({
        where: {
          userId: id,
          success: false,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
        },
      }),
    ]);

    return {
      items,
      // `email` 字段不返回: 列表页已知是哪个用户, 再回显一遍等于把 PII 多暴露一次
      total,
      failedLast30Days: failed30d,
    };
  }

  /**
   * 删除用户。
   *
   * 两条路径的分工（与 C 端自助注销同一口径）：
   *
   * - **软删** (`hard=false`)：走 `AccountLifecycleService.softDelete`，清空
   *   项目/任务/素材/积分批次并匿名化账号，订单、支付、退款、发票、积分流水
   *   原样保留（法定留存）。
   * - **物理删** (`hard=true`)：整行删除连带所有子表与对象存储文件。
   *   因此**只对完全没有资金记录的账号开放** —— 有订单/支付/退款/发票/流水时
   *   直接拒绝，请运营改用注销。删掉用户行会让那些记录变成指向不存在账号的
   *   孤儿数据，既对不了账也举不了证。
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

      /*
       * 有资金记录的用户**不允许物理删除**。
       *
       * 订单 / 支付 / 退款 / 发票 / 积分流水受会计与消费者权益相关法规的留存
       * 约束，且都以 userId 指向用户行。用户行一删，这些记录就变成指向不存在
       * 账号的孤儿数据 —— 既对不了账，也举不了证，比"留着账号"更糟。
       * 这类账号只能走注销（软删除）：匿名化 + 保留资金记录。
       */
      const [orderCount, paymentCount, refundCount, invoiceCount, ledgerCount] = await Promise.all([
        this.prisma.order.count({ where: { userId: id } }),
        this.prisma.payment.count({ where: { userId: id } }),
        this.prisma.refund.count({ where: { userId: id } }),
        this.prisma.invoice.count({ where: { userId: id } }),
        this.prisma.creditLedger.count({ where: { userId: id } }),
      ]);
      if (orderCount + paymentCount + refundCount + invoiceCount + ledgerCount > 0) {
        throw new AppError(
          40001,
          `该账号存在 ${orderCount} 笔订单、${paymentCount} 笔支付、${refundCount} 笔退款、` +
            `${invoiceCount} 张发票、${ledgerCount} 条积分流水，依法不能物理删除；请改用注销（保留资金记录）`,
          400,
        );
      }

      // 文件坐标要在记录删掉之前取出（删完就查不到了）
      const assets = await this.prisma.asset.findMany({
        where: { ownerId: id },
        select: { storageBackend: true, storageKey: true },
      });

      // 先删子表再删用户: SQLite 无外键级联, 手工保证顺序
      await this.prisma.$transaction(async (tx) => {
        await tx.generationTask.deleteMany({ where: { ownerId: id } });
        await tx.asset.deleteMany({ where: { ownerId: id } });
        await tx.project.deleteMany({ where: { ownerId: id } });
        // 无资金记录时下列表也不会有资金语义，随人一起清掉
        await tx.membershipUsage.deleteMany({ where: { userId: id } });
        await tx.membership.deleteMany({ where: { userId: id } });
        await tx.creditLot.deleteMany({ where: { userId: id } });
        await tx.inviteRelation.deleteMany({
          where: { OR: [{ inviterId: id }, { inviteeId: id }] },
        });
        await tx.checkinRecord.deleteMany({ where: { userId: id } });
        await tx.ticketReply.deleteMany({ where: { ticket: { userId: id } } });
        await tx.ticket.deleteMany({ where: { userId: id } });
        await tx.loginSession.deleteMany({ where: { userId: id } });
        await tx.notification.deleteMany({ where: { userId: id } });
        // 账号安全域的子表: 令牌随人走; 登录审计断开关联但**保留**记录
        await tx.accountToken.deleteMany({ where: { userId: id } });
        await tx.loginLog.updateMany({ where: { userId: id }, data: { userId: null } });
        await tx.consentRecord.updateMany({ where: { userId: id }, data: { userId: null } });
        await tx.user.delete({ where: { id } });
      });

      // 文件在事务之后删: 按写入时的后端逐个删, 失败不阻塞
      for (const a of assets) {
        if (!a.storageKey) continue;
        const backend = (a.storageBackend as StorageBackend) ?? 'local';
        await this.storage.get(backend)?.delete(a.storageKey).catch(() => undefined);
      }

      return {
        id,
        hard: true,
        deleted: counts?._count ?? { projects: 0, tasks: 0, assets: 0 },
        removedFiles: assets.length,
      };
    }

    // 软删: 与 C 端自助注销走同一份实现 (AccountLifecycleService)
    await this.lifecycle.softDelete(id);
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

  /** 列表 / 导出共用的筛选条件（两处各写一份必然漂移） */
  private listWhere(query: UserListQueryDto): Record<string, unknown> {
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
    return where;
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
