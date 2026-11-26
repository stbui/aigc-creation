import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { microcreditsToCredits, projectEntry } from '../credits/credit.service';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AuthUserCacheService } from '../common/auth-user-cache.service';

/** 与注册/重置保持一致的成本因子，否则同一账号的哈希强度会漂移 */
const BCRYPT_ROUNDS = 10;

export interface UpdateProfileInput {
  name?: string;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly authUsers: AuthUserCacheService,
  ) {}

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        passwordHash: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        mustChangePassword: true,
        tempPasswordExpiresAt: true,
        oauthIdentities: {
          select: { provider: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw new AppError(40401, '账号不存在', 404);
    /*
     * 五个计数合并为一次 SQLite 查询：此前 Promise.all 里是 5 次 count，
     * 压测显示 /me 单请求要打 6 次库（含 user 查询），是鉴权路径的主要开销。
     *
     * 口径逐字对应原先的 count where：
     *   · 「作品」= 有可见产出的任务,「素材」= 可见素材 —— 与「我的作品」
     *     计数行和素材库「共 N 个素材」严格同口径（不加条件的版本会让失败
     *     任务和后台下架的素材把数虚高）。
     *   · outputAssetId 上有 @unique（1:1）且 project 为必填关系，JOIN 不改变计数。
     *   · "Order" 是 SQL 保留字，必须加双引号（schema 无 @@map，表名即模型名）。
     *   · 所有 camelCase 列名都加双引号：SQLite 未加引号也能匹配，但 PostgreSQL
     *     会把未加引号的标识符折叠成小写（ownerId → ownerid）而报列不存在。
     *   · COUNT(*) 在两方言都返回 bigint/bigint 字符串，必须 Number() 转换。
     */
    const [row] = await this.prisma.$queryRaw<Array<{
      projects: bigint;
      tasks: bigint;
      assets: bigint;
      orders: bigint;
      unread: bigint;
    }>>`
      SELECT
        (SELECT COUNT(*) FROM Project
          WHERE "ownerId" = ${userId} AND "deletedAt" IS NULL) AS projects,
        (SELECT COUNT(*) FROM GenerationTask t
          JOIN Project p ON p.id = t."projectId"
          JOIN Asset a ON a.id = t."outputAssetId"
          WHERE t."ownerId" = ${userId} AND p."deletedAt" IS NULL
            AND a.status = 'visible') AS tasks,
        (SELECT COUNT(*) FROM Asset a
          JOIN Project p ON p.id = a."projectId"
          WHERE a."ownerId" = ${userId} AND a.status = 'visible'
            AND p."deletedAt" IS NULL) AS assets,
        (SELECT COUNT(*) FROM "Order" WHERE "userId" = ${userId}) AS orders,
        (SELECT COUNT(*) FROM Notification
          WHERE "userId" = ${userId} AND "readAt" IS NULL) AS unread
    `;
    const projects = Number(row.projects);
    const tasks = Number(row.tasks);
    const assets = Number(row.assets);
    const orders = Number(row.orders);
    const unread = Number(row.unread);
    const { passwordHash, oauthIdentities, ...profile } = user;
    return {
      ...profile,
      hasPassword: Boolean(passwordHash),
      linkedOAuthProviders: [...new Set(oauthIdentities.map((item) => item.provider))],
      counts: { projects, tasks, assets, orders },
      unread,
    };
  }

  /**
   * 资料更正。
   *
   * 只允许改昵称：邮箱是登录标识且已用于订单与发票，改它等于换账号；
   * 手机号要走短信验证（绑号是安全动作，不能凭空改）。
   */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const data: { name?: string } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new AppError(40001, '昵称不能为空', 400);
      if (name.length > 20) throw new AppError(40001, '昵称最多 20 个字符', 400);
      data.name = name;
    }
    if (Object.keys(data).length === 0) {
      throw new AppError(40001, '没有需要更新的字段', 400);
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true },
    });
    return user;
  }

  /**
   * 修改密码。
   *
   * 成功后 `tokenVersion + 1`：**该账号此前签发的所有 token 立即失效**，
   * 包括当前这把 —— 调用方要重新登录。这不是体验倒退，是安全要求：
   * 改密的动机通常就是"怀疑密码泄露"，旧会话还必须能继续用等于没改。
   */
  async changePassword(userId: string, newPassword: string, oldPassword?: string) {
    if (newPassword.length < 6) throw new AppError(40001, '新密码至少 6 位', 400);
    if (oldPassword === newPassword) {
      throw new AppError(40001, '新密码不能与当前密码相同', 400);
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(40401, '账号不存在', 404);

    if (user.passwordHash) {
      if (!oldPassword) throw new AppError(40001, '请输入当前密码', 400);
      const ok = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!ok) throw new AppError(40001, '当前密码不正确', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        // 用户已自行改密，强制改密标记与临时密码有效期一并清除。
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
      },
    });
    await this.authUsers.invalidate(userId);
    return { changed: true };
  }

  /**
   * 数据导出（个人信息可携带权）。
   *
   * 只导出**本人产生的内容**，不含他人数据，也不含内部风控字段
   * （passwordHash / tokenVersion 之类对用户无意义，反而是泄露面）。
   * 素材只给元信息与站内地址，不打包二进制 —— 那需要流式打包与临时文件，
   * 属于独立的导出任务，不该由一次同步请求承担。
   */
  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true, createdAt: true },
    });
    if (!user) throw new AppError(40401, '账号不存在', 404);

    const [projects, assets, tasks, orders, credits, ledger, memberships, notifications] =
      await Promise.all([
        this.prisma.project.findMany({ where: { ownerId: userId, deletedAt: null } }),
        this.prisma.asset.findMany({
          where: { ownerId: userId, project: { deletedAt: null } },
          select: {
            id: true,
            kind: true,
            capability: true,
            format: true,
            width: true,
            height: true,
            sourceUrl: true,
            createdAt: true,
          },
        }),
        this.prisma.generationTask.findMany({
          where: { ownerId: userId, project: { deletedAt: null } },
          select: {
            id: true,
            capability: true,
            status: true,
            creditCost: true,
            params: true,
            errorCode: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        this.prisma.order.findMany({
          where: { userId },
          select: {
            orderNo: true,
            status: true,
            totalCents: true,
            paidCents: true,
            discountCents: true,
            membershipPlanId: true,
            createdAt: true,
            paidAt: true,
          },
        }),
        // 批次与流水在库里是 BigInt 微积分，导出前必须投影成积分口径，
        // 否则 `JSON.stringify` 会在 BigInt 上直接抛错（导出接口 500）
        this.prisma.creditLot.findMany({ where: { userId } }),
        this.prisma.creditLedgerEntry.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 2000,
        }),
        this.prisma.membership.findMany({ where: { userId } }),
        this.prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      account: user,
      projects,
      assets,
      tasks,
      orders,
      credits: {
        lots: credits.map((lot) => ({
          id: lot.id,
          source: lot.source,
          orderId: lot.orderId,
          totalCredits: microcreditsToCredits(lot.totalMicrocredits),
          remainingCredits: microcreditsToCredits(lot.remainingMicrocredits),
          expireAt: lot.expireAt,
          createdAt: lot.createdAt,
        })),
        ledger: ledger.map(projectEntry),
      },
      memberships,
      notifications,
    };
  }

  /**
   * 自助注销。
   *
   * 需要密码 + 确认词「注销」两道：注销不可自助恢复，误触的代价是
   * 全部作品与积分清零。确认词不是形式 —— 它把"点错按钮"与"真的要注销"分开。
   */
  async deleteAccount(userId: string, password: string | undefined, confirm: string) {
    if (confirm !== '注销') {
      throw new AppError(40001, '请输入确认词「注销」', 400);
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(40401, '账号不存在', 404);

    if (user.passwordHash) {
      if (!password) throw new AppError(40001, '请输入密码', 400);
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw new AppError(40001, '密码不正确', 400);
    }

    // 后台账号不允许自助注销: 会让最后一个管理员把系统锁死在外面
    if (user.role !== 'user') {
      throw new AppError(40003, '后台账号不能自助注销，请联系管理员', 403);
    }

    return this.lifecycle.softDelete(userId);
  }
}
