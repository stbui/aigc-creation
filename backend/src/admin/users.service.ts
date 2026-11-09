import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AccountLifecycleService } from "../account/account-lifecycle.service";
import { lockAndAssertActiveAdminMutable } from "../account/last-admin.guard";
import { AppError } from "../common/app.exception";
import { runBatch } from "../common/batch";
import { CSV_EXPORT_MAX_ROWS, toCsv } from "../common/csv";
import { SignedUrlService } from "../common/signed-url.service";
import { StorageService } from "../storage/storage.service";
import type { StorageBackend } from "../storage/storage.provider";
import { getCapability } from "../capabilities/capability.registry";
import { MembershipService } from "../membership/membership.service";
import { CreditService } from "../credits/credit.service";
import { UserGroupService } from "../model/user-groups/user-group.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ROLE_LABELS, USER_STATUS_LABELS } from "./permissions";
import { buildPage, paginate, type PageResult } from "./dto/page-query.dto";
import type {
  ChangeUserRoleDto,
  ChangeUserStatusDto,
  UserListQueryDto,
} from "./dto/user.dto";

/** 用户列表可排序的列 */
const SORTABLE = ["createdAt", "lastLoginAt", "email", "name"] as const;

/** 重置密码时的随机字符集: 去掉易混淆的 0O / 1lI */
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
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
    // 当前会员判定必须复用 C 端口径：投影可能指向未来周期，不能只看 expiresAt。
    private readonly membership: MembershipService,
    // 余额与分组必须复用 C 端同一份服务：后台另算一套必然与账单口径漂移。
    private readonly credit: CreditService,
    private readonly groups: UserGroupService,
    // 重置密码 / 禁用后通知本人；notify() 永不抛异常，不阻断主流程。
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 用户列表。
   *
   * 统计口径说明: 项目/任务/素材数按"项目未软删"聚合, 不逐用户查询。
   * 已注销用户 (status='deleted') 默认不在列表里 —— 运营要找的是活跃账号;
   * 需要查历史时可显式传 status=deleted。
   */
  async list(query: UserListQueryDto): Promise<PageResult<unknown>> {
    const page = buildPage(query, [...SORTABLE], "createdAt:desc");
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
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const counts = await this.usageCounts(items.map((user) => user.id));

    return paginate(
      items.map((u) => {
        const usage = counts.get(u.id) ?? { projects: 0, tasks: 0, assets: 0 };
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          roleLabel: ROLE_LABELS[u.role] ?? u.role,
          status: u.status,
          statusLabel: USER_STATUS_LABELS[u.status] ?? u.status,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          projectCount: usage.projects,
          taskCount: usage.tasks,
          assetCount: usage.assets,
        };
      }),
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
  async exportCsv(query: UserListQueryDto): Promise<{
    csv: string;
    total: number;
    limit: number;
    truncated: boolean;
  }> {
    const page = buildPage(query, [...SORTABLE], "createdAt:desc");
    const where = this.listWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        // 导出必须跟随屏幕上的排序；固定 createdAt 会与列表口径对不上。
        orderBy: page.orderBy,
        take: CSV_EXPORT_MAX_ROWS,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const counts = await this.usageCounts(rows.map((user) => user.id));
    const csv = toCsv(
      [
        { label: "用户 ID", value: (u) => u.id },
        { label: "邮箱", value: (u) => u.email },
        { label: "昵称", value: (u) => u.name },
        { label: "角色", value: (u) => ROLE_LABELS[u.role] ?? u.role },
        {
          label: "状态",
          value: (u) => USER_STATUS_LABELS[u.status] ?? u.status,
        },
        { label: "项目数", value: (u) => counts.get(u.id)?.projects ?? 0 },
        { label: "任务数", value: (u) => counts.get(u.id)?.tasks ?? 0 },
        { label: "素材数", value: (u) => counts.get(u.id)?.assets ?? 0 },
        { label: "注册时间", value: (u) => u.createdAt },
        { label: "最后登录", value: (u) => u.lastLoginAt ?? "" },
      ],
      rows,
    );
    return {
      csv,
      total,
      limit: CSV_EXPORT_MAX_ROWS,
      truncated: total > CSV_EXPORT_MAX_ROWS,
    };
  }

  /**
   * 全局用户统计（跟随筛选条件）。
   *
   * 列表顶部的「正常 / 受限 / 管理身份」如果按当前页计算，翻页就会变，
   * 运营很容易把它当成全站数字。这里用与列表完全相同的 where 做聚合。
   */
  async stats(query: UserListQueryDto) {
    const where = this.listWhere(query);
    const [total, byRoleRows, byStatusRows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ["role"], where, _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const byRole: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const row of byRoleRows) byRole[row.role] = row._count._all;
    for (const row of byStatusRows) byStatus[row.status] = row._count._all;
    return { total, byRole, byStatus };
  }

  /**
   * 批量启用 / 禁用。
   *
   * 逐条走 `changeStatus`，因此「不能禁用自己」「至少保留一个管理员」
   * 这些规则对批量同样生效 —— 批量不是绕过单条规则的通道，
   * 恰恰相反，批量最需要的正是这些规则的逐条校验。
   */
  async batchStatus(
    ids: string[],
    status: "active" | "disabled",
    actorId: string,
  ) {
    return runBatch(ids, (id) => this.changeStatus(id, { status }, actorId));
  }

  /**
   * 用户详情: 基本信息 + 三项统计 + 最近任务 + 最近素材 + 会员权益。
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
      },
    });
    if (!user) throw new AppError(40400, "用户不存在", 404);

    const [
      recentTasks,
      recentAssets,
      taskStats,
      currentMembership,
      resolvedMembership,
      membershipHistory,
      membershipUsage,
      usageCounts,
      creditBalance,
      groupAccess,
      orderCount,
      ticketCount,
      invoiceCount,
    ] = await Promise.all([
      this.prisma.generationTask.findMany({
        where: { ownerId: id, project: { deletedAt: null } },
        orderBy: { createdAt: "desc" },
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
        where: { ownerId: id, project: { deletedAt: null } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          sourceUrl: true,
          kind: true,
          width: true,
          height: true,
        },
      }),
      this.prisma.generationTask.groupBy({
        by: ["status"],
        where: { ownerId: id, project: { deletedAt: null } },
        _count: { _all: true },
      }),
      // 与 C 端 MembershipService.resolve() 保持同一口径:
      // cancelled 只表示关闭自动续费, 到期前仍享有已付费周期权益。
      this.prisma.membership.findFirst({
        where: {
          userId: id,
          status: { in: ["active", "grace", "cancelled"] },
          expiresAt: { gt: new Date() },
        },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { expiresAt: "desc" },
      }),
      this.membership.resolve(id),
      this.membership.historyOf(id, 10),
      this.prisma.membershipUsage.aggregate({
        where: { userId: id },
        _sum: { savedCents: true },
        _count: { _all: true },
      }),
      this.usageCounts([id]).then(
        (counts) => counts.get(id) ?? { projects: 0, tasks: 0, assets: 0 },
      ),
      // 余额/分组复用 C 端服务，避免后台另算一套与账单口径漂移。
      this.credit.balanceOf(id),
      this.groups.accessForUser(id),
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.ticket.count({ where: { userId: id } }),
      this.prisma.invoice.count({ where: { userId: id } }),
    ]);

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
      /** 当前可用积分与到期信息；与 C 端 /credits/balance 同源 */
      credit: {
        balance: creditBalance.balance,
        expiringSoon: creditBalance.expiringSoon,
        activeLots: creditBalance.activeLots,
        nearestExpiry: creditBalance.nearestExpiry,
      },
      /** 计费分组（会员套餐映射，无有效会员落默认分组） */
      group: {
        code: groupAccess.group.code,
        name: groupAccess.group.name,
        ratioBasisPoints: groupAccess.group.ratioBasisPoints,
      },
      stats: {
        projects: usageCounts.projects,
        tasks: usageCounts.tasks,
        assets: usageCounts.assets,
        orders: orderCount,
        tickets: ticketCount,
        invoices: invoiceCount,
        taskStatus: {
          succeeded: statusCount["succeeded"] ?? 0,
          failed: statusCount["failed"] ?? 0,
          running: statusCount["running"] ?? 0,
          queued: statusCount["queued"] ?? 0,
        },
      },
      recentTasks: recentTasks.map((t) => {
        const def = getCapability(t.capability);
        return {
          id: t.id,
          capability: t.capability,
          capabilityName: def?.name ?? t.capability,
          mode: def?.mode ?? "unknown",
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
      membership: {
        isMember: resolvedMembership.isMember,
        planCode: resolvedMembership.planCode,
        planName: resolvedMembership.planName,
        status: resolvedMembership.isMember
          ? currentMembership?.status ?? "active"
          : null,
        startAt: resolvedMembership.isMember
          ? currentMembership?.startAt ?? null
          : null,
        expiresAt: resolvedMembership.isMember
          ? resolvedMembership.expiresAt
          : null,
        monthlyCredits: resolvedMembership.isMember
          ? resolvedMembership.monthlyCredits
          : 0,
        cancelAtPeriodEnd: resolvedMembership.isMember
          ? resolvedMembership.cancelAtPeriodEnd
          : false,
        savedCents: membershipUsage._sum.savedCents ?? 0,
        discountedOrders: membershipUsage._count._all,
      },
      membershipHistory,
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
      throw new AppError(40001, "不能禁用或启用自己", 400);
    }
    if (user.status === "deleted") {
      throw new AppError(40001, "已注销用户无需禁用", 400);
    }
    await this.prisma.$transaction(async (tx) => {
      // 末位管理员检查与状态写入必须在同一写事务，count 后再 update 会被并发绕过。
      if (user.role === "admin" && user.status === "active" && dto.status === "disabled") {
        await lockAndAssertActiveAdminMutable(tx, id);
      }
      await tx.user.update({
        where: { id },
        data: { status: dto.status },
      });
    });

    // 通知失败不影响处置结果；notify() 自身永不抛异常。
    await this.notifications.notify({
      userId: id,
      type: dto.status === "disabled" ? "account_disabled" : "account_enabled",
      fallbackTitle: dto.status === "disabled" ? "账号已被禁用" : "账号已恢复",
      fallbackBody:
        dto.status === "disabled"
          ? "你的账号已被管理员禁用，当前登录已失效。如有疑问请联系客服。"
          : "你的账号已恢复，可以重新登录使用。",
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
  async changeRole(
    id: string,
    dto: ChangeUserRoleDto,
    actor: { id: string; role: string },
  ) {
    const user = await this.findUser(id);

    if (id === actor.id) {
      throw new AppError(40001, "不能变更自己的角色", 400);
    }
    if (user.status === "deleted") {
      throw new AppError(40001, "已注销用户无需变更角色", 400);
    }
    if (user.role === dto.role) {
      throw new AppError(40001, "目标角色与当前一致", 400);
    }

    // 防提权: 只有 admin 能授予 admin
    if (dto.role === "admin" && actor.role !== "admin") {
      throw new AppError(40301, "只有管理员可以授予管理员角色", 403);
    }

    await this.prisma.$transaction(async (tx) => {
      // 已禁用的 admin 不提供管理入口，降级它不会减少可用管理员数量。
      if (user.role === "admin" && user.status === "active") {
        await lockAndAssertActiveAdminMutable(tx, id);
      }
      await tx.user.update({ where: { id }, data: { role: dto.role } });
    });
    return { id, role: dto.role, roleLabel: ROLE_LABELS[dto.role] ?? dto.role };
  }

  /**
   * 重置密码: 生成一次性临时密码, 明文仅本次返回。
   *
   * 不提供「查看现有密码」的能力 —— 密码是单向哈希, 本就不存在明文。
   */
  async resetPassword(id: string) {
    const user = await this.findUser(id);
    if (user.status === "deleted") {
      throw new AppError(40001, "已注销用户无需重置密码", 400);
    }

    const password = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    /*
     * 一并自增 tokenVersion: 管理员重置密码通常意味着「怀疑账号被盗」，
     * 此时旧会话必须立即失效，否则重置密码只防住了下一次登录。
     *
     * mustChangePassword 强制用户用临时密码登录后先改密；tempPasswordExpiresAt
     * 防止临时密码长期有效。两者与密码写入同一事务，避免只改了一半。
     */
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        mustChangePassword: true,
        tempPasswordExpiresAt: expiresAt,
      },
    });

    await this.notifications.notify({
      userId: id,
      type: "password_reset",
      fallbackTitle: "登录密码已被重置",
      fallbackBody:
        "管理员已重置你的登录密码。请使用临时密码登录，并立即设置新密码；临时密码 24 小时内有效。",
    });

    return {
      id,
      email: user.email,
      // 明文只在这里出现一次, 不入库、不落盘、不入审计
      tempPassword: password,
      mustChangePassword: true,
      expiresAt,
      notice: "此密码仅显示一次, 关闭后无法再次查看；用户下次登录后必须先修改密码",
    };
  }

  /**
   * 强制下线：账号保持可用，只让已签发的会话立即失效。
   *
   * 与禁用不同，用户仍可用原密码重新登录 —— 适用于「怀疑 token 泄露」
   * 或客服要求「把我在别的设备踢下线」。
   */
  async logoutAll(id: string, actorId: string) {
    const user = await this.findUser(id);
    if (id === actorId) {
      throw new AppError(40001, "不能强制自己下线", 400);
    }
    if (user.status === "deleted") {
      throw new AppError(40001, "已注销用户无需强制下线", 400);
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { tokenVersion: { increment: 1 } },
      }),
      // 扫码登录票据也一并作废；未确认的扫码请求不应在下次打开时继续有效。
      this.prisma.loginSession.deleteMany({ where: { userId: id } }),
    ]);
    return { id, revoked: true };
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
        orderBy: { createdAt: "desc" },
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
  async remove(id: string, hard: boolean, confirm: string | undefined, actorId: string) {
    const user = await this.findUser(id);

    if (id === actorId) {
      throw new AppError(40001, "不能删除自己的账号", 400);
    }
    if (user.status === "deleted") {
      throw new AppError(40001, "该用户已注销，无需重复删除", 400);
    }
    if (hard) {
      if (confirm !== "删除") {
        throw new AppError(40001, "物理删除需要确认词「删除」", 400);
      }

      /*
       * 有资金记录的用户**不允许物理删除**。
       *
       * 订单 / 支付 / 退款 / 发票 / 积分流水受会计与消费者权益相关法规的留存
       * 约束，且都以 userId 指向用户行。用户行一删，这些记录就变成指向不存在
       * 账号的孤儿数据 —— 既对不了账，也举不了证，比"留着账号"更糟。
       * 这类账号只能走注销（软删除）：匿名化 + 保留资金记录。
       */
      /*
       * 预检查也放进删除事务：资金记录可能在事务外检查后被并发写入，
       * 只有与删除处于同一事务，才能保证「有资金记录就不物理删除」不被竞态绕过。
       */
      const deleted = await this.prisma.$transaction(async (tx) => {
        await lockAndAssertActiveAdminMutable(tx, id);
        const [
          orderCount,
          paymentCount,
          refundCount,
          invoiceCount,
          ledgerCount,
          billingCount,
        ] = await Promise.all([
          tx.order.count({ where: { userId: id } }),
          tx.payment.count({ where: { userId: id } }),
          tx.refund.count({ where: { userId: id } }),
          tx.invoice.count({ where: { userId: id } }),
          tx.creditLedgerEntry.count({ where: { userId: id } }),
          tx.billingOrder.count({ where: { userId: id } }),
        ]);
        if (
          orderCount +
            paymentCount +
            refundCount +
            invoiceCount +
            ledgerCount +
            billingCount >
          0
        ) {
          throw new AppError(
            40001,
            `该账号存在 ${orderCount} 笔订单、${paymentCount} 笔支付、${refundCount} 笔退款、` +
              `${invoiceCount} 张发票、${billingCount} 笔生成账单、${ledgerCount} 条积分流水，` +
              "依法不能物理删除；请改用注销（保留资金记录）",
            400,
          );
        }

        // 文件坐标要在记录删掉之前取出（删完就查不到了）
        const assets = await tx.asset.findMany({
          where: { ownerId: id },
          select: { storageBackend: true, storageKey: true },
        });
        const counts = await tx.user.findUnique({
          where: { id },
          select: {
            _count: { select: { projects: true, tasks: true, assets: true } },
          },
        });

        // 先删子表再删用户: SQLite 无外键级联, 手工保证顺序
        await tx.generationTask.deleteMany({ where: { ownerId: id } });
        await tx.asset.deleteMany({ where: { ownerId: id } });
        await tx.project.deleteMany({ where: { ownerId: id } });
        // 无资金记录时下列表也不会有资金语义，随人一起清掉
        await tx.membershipUsage.deleteMany({ where: { userId: id } });
        await tx.membership.deleteMany({ where: { userId: id } });
        // CreditReservationItem 没有外键/Cascade，必须先按 lotId 清掉再删批次
        const lots = await tx.creditLot.findMany({
          where: { userId: id },
          select: { id: true },
        });
        await tx.creditReservationItem.deleteMany({
          where: { lotId: { in: lots.map((lot) => lot.id) } },
        });
        await tx.creditLot.deleteMany({ where: { userId: id } });
        await tx.creditAccount.deleteMany({ where: { userId: id } });
        await tx.inviteRelation.deleteMany({
          where: { OR: [{ inviterId: id }, { inviteeId: id }] },
        });
        await tx.checkinRecord.deleteMany({ where: { userId: id } });
        await tx.ticketReply.deleteMany({ where: { ticket: { userId: id } } });
        await tx.ticket.deleteMany({ where: { userId: id } });
        await tx.loginSession.deleteMany({ where: { userId: id } });
        await tx.notification.deleteMany({ where: { userId: id } });
        // 账号安全域的子表: 令牌 / OAuth 身份 / 插件状态随人走;
        // 登录、同意与上游调用审计断开关联但**保留**记录，避免删除后失去举证链。
        await tx.accountToken.deleteMany({ where: { userId: id } });
        await tx.oAuthIdentity.deleteMany({ where: { userId: id } });
        await tx.userPluginState.deleteMany({ where: { userId: id } });
        await tx.loginLog.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
        await tx.consentRecord.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
        await tx.apiCallLog.updateMany({
          where: { userId: id },
          data: { userId: "" },
        });
        await tx.user.delete({ where: { id } });

        return {
          assets,
          counts: counts?._count ?? { projects: 0, tasks: 0, assets: 0 },
        };
      });

      // 文件在事务之后删: 按写入时的后端逐个删, 失败不阻塞。
      // removedFiles 只统计真正成功的删除；失败的留在响应里供运营排查。
      let removedFiles = 0;
      let failedFiles = 0;
      for (const a of deleted.assets) {
        if (!a.storageKey) continue;
        const backend = (a.storageBackend as StorageBackend) ?? "local";
        const provider = this.storage.get(backend);
        if (!provider) {
          failedFiles += 1;
          continue;
        }
        try {
          await provider.delete(a.storageKey);
          removedFiles += 1;
        } catch {
          failedFiles += 1;
        }
      }

      return {
        id,
        hard: true,
        deleted: deleted.counts,
        removedFiles,
        failedFiles,
      };
    }

    // 软删: 与 C 端自助注销走同一份实现 (AccountLifecycleService)。后者会在
    // 自己的事务内执行末位管理员保护，避免后台预检查与写入之间的竞态。
    await this.lifecycle.softDelete(id);
    return { id, hard: false };
  }

  /** 账号注销后遗留的孤儿数据清理说明, 供前端展示 */
  async impactPreview(id: string) {
    const user = await this.findUser(id);
    const [
      projects,
      tasks,
      assets,
      orders,
      payments,
      refunds,
      invoices,
      billingOrders,
      creditLedgerEntries,
    ] = await Promise.all([
      this.prisma.project.count({ where: { ownerId: id } }),
      this.prisma.generationTask.count({ where: { ownerId: id } }),
      this.prisma.asset.count({ where: { ownerId: id } }),
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.payment.count({ where: { userId: id } }),
      this.prisma.refund.count({ where: { userId: id } }),
      this.prisma.invoice.count({ where: { userId: id } }),
      this.prisma.billingOrder.count({ where: { userId: id } }),
      this.prisma.creditLedgerEntry.count({ where: { userId: id } }),
    ]);
    const retained = {
      orders,
      payments,
      refunds,
      invoices,
      billingOrders,
      creditLedgerEntries,
    };
    return {
      email: user.email,
      projects,
      tasks,
      assets,
      retained,
    };
  }

  /**
   * 列表 / 统计 / 导出共用的筛选条件（三处各写一份必然漂移）。
   *
   * 关键词与分群都可能产生 OR，因此统一收进 `AND` 数组；直接把两个 `OR`
   * 挂在 where 顶层会互相覆盖，表现为「输入关键词后分群条件静默失效」。
   */
  private listWhere(query: UserListQueryDto): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    const and: Array<Record<string, unknown>> = [];

    const keyword = String(query.keyword ?? "").trim();
    if (keyword) {
      // 与顶栏全局搜索同口径：邮箱 / 昵称 / 手机号模糊，用户 ID 精确匹配。
      and.push({
        OR: [
          { email: { contains: keyword } },
          { name: { contains: keyword } },
          { phone: { contains: keyword } },
          { id: keyword },
        ],
      });
    }

    if (query.role) where["role"] = query.role;
    // 未指定 status 时默认排除 deleted, 避免注销账号长期占据列表
    if (query.status) {
      where["status"] = query.status;
    } else {
      where["status"] = { not: "deleted" };
    }

    if (query.segment === "never_login") {
      and.push({ lastLoginAt: null });
    } else if (query.segment === "inactive_30d") {
      and.push({
        OR: [
          { lastLoginAt: null },
          { lastLoginAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        ],
      });
    } else if (query.segment === "no_tasks") {
      // 与列表的「任务数」同口径：软删项目下的任务不算。
      and.push({ tasks: { none: { project: { deletedAt: null } } } });
    }

    if (query.membership === "member") {
      and.push({
        memberships: {
          some: {
            status: { in: ["active", "grace", "cancelled"] },
            expiresAt: { gt: new Date() },
          },
        },
      });
    } else if (query.membership === "non_member") {
      and.push({
        memberships: {
          none: {
            status: { in: ["active", "grace", "cancelled"] },
            expiresAt: { gt: new Date() },
          },
        },
      });
    }

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      const from = this.parseDate(query.from);
      const to = this.parseDate(query.to);
      if (from) createdAt["gte"] = from;
      if (to) createdAt["lte"] = to;
      if (Object.keys(createdAt).length > 0) where["createdAt"] = createdAt;
    }

    if (and.length > 0) where["AND"] = and;
    return where;
  }

  /** 用户可见统计: 软删项目及其任务、素材不计入，按用户批量聚合避免 N+1。 */
  private async usageCounts(userIds: string[]) {
    const ids = [...new Set(userIds)];
    const counts = new Map<string, { projects: number; tasks: number; assets: number }>();
    if (ids.length === 0) return counts;

    const [projects, tasks, assets] = await Promise.all([
      this.prisma.project.groupBy({
        by: ["ownerId"],
        where: { ownerId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.generationTask.groupBy({
        by: ["ownerId"],
        where: { ownerId: { in: ids }, project: { deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.asset.groupBy({
        by: ["ownerId"],
        where: { ownerId: { in: ids }, project: { deletedAt: null } },
        _count: { _all: true },
      }),
    ]);

    for (const id of ids) counts.set(id, { projects: 0, tasks: 0, assets: 0 });
    for (const row of projects) {
      const count = counts.get(row.ownerId);
      if (count) count.projects = row._count._all;
    }
    for (const row of tasks) {
      const count = counts.get(row.ownerId);
      if (count) count.tasks = row._count._all;
    }
    for (const row of assets) {
      const count = counts.get(row.ownerId);
      if (count) count.assets = row._count._all;
    }
    return counts;
  }

  private async findUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!user) throw new AppError(40400, "用户不存在", 404);
    return user;
  }

  private generateTempPassword(): string {
    let out = "";
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
