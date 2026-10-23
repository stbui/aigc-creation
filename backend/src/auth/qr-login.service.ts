import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { AuthService, type PublicUser, type RequestContext } from './auth.service';

/**
 * 扫码登录 (B8)。
 *
 * 流程:
 *
 *   桌面                          手机 (已登录)                    服务端
 *   POST /auth/qr/create  ────────────────────────────────────> 建会话, 返回票据
 *   展示二维码 ──(扫)──> POST /auth/qr/scan    ───────────────> pending → scanned
 *                        (展示「哪台设备在请求登录」)
 *                        POST /auth/qr/confirm ───────────────> scanned → confirmed (绑 userId)
 *   GET /auth/qr/status ───────────────────────────────────────> confirmed → 签发 JWT, → consumed
 *
 * 三条必须守住的约束:
 *
 * 1. **票据只存哈希**。二维码会被截图、投屏、转发。库里的明文票据等于一把
 *    长期有效的会话钥匙 —— 一次备份泄漏就是全量账号沦陷。存 SHA-256 后,
 *    泄漏者拿到的是无法反推的摘要; 票据本身 256 bit 随机, 不需要加盐。
 *
 * 2. **扫码 ≠ 授权**。`scan` 只把状态推到 `scanned`, 真正绑定账号的是手机端
 *    显式点的「确认」。少了这一步, 任何扫到码的人都能登录任意桌面端。
 *
 * 3. **兑换是一次性的**。`status` 用条件更新 `confirmed → consumed` 抢占,
 *    两个并发轮询只有一个能拿到 token; 抢不到的那个返回 `consumed` 而不是
 *    再签一个 —— 否则一个二维码能换出 N 个会话。
 *
 * 为什么有效期只有 2 分钟: 够扫 + 够点确认, 又短到「截图发出去再被别人用」
 * 基本来不及。过期由轮询顺带发现 (`status` 会把超时的会话置 `expired`),
 * 不需要额外调度任务。
 */

/** 票据有效期 */
export const QR_TTL_SECONDS = 120;

/** 建议轮询间隔。前端照此设置定时器, 服务端不对轮询频率做业务假设 */
export const QR_POLL_INTERVAL_MS = 1500;

/** 过期会话保留时长: 超过后连行一起删, 不无限堆积 */
const QR_RETENTION_MS = 24 * 3600 * 1000;

export type QrStatus = 'pending' | 'scanned' | 'confirmed' | 'consumed' | 'expired' | 'cancelled';

@Injectable()
export class QrLoginService {
  private readonly logger = new Logger(QrLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * 桌面端建码。
   *
   * 顺带清一次过期会话: 扫码登录是低频操作, 每次建码删一批的成本可以忽略,
   * 比单开一个调度任务更简单, 也不会因为没配调度器而无限堆积。
   */
  async create(ctx: RequestContext = {}) {
    const ticket = randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = new Date(now + QR_TTL_SECONDS * 1000);

    await this.prisma.loginSession
      .deleteMany({ where: { expiresAt: { lt: new Date(now - QR_RETENTION_MS) } } })
      .catch((e: Error) => this.logger.warn(`清理过期扫码会话失败: ${e.message}`));

    await this.prisma.loginSession.create({
      data: {
        tokenHash: this.hash(ticket),
        expiresAt,
        ip: ctx.ip ?? null,
        // UA 可能很长且含任意字符, 截断后入库 —— 它只用于手机端展示, 不参与判定
        ua: (ctx.ua ?? '').slice(0, 500) || null,
      },
    });

    return {
      ticket,
      expiresAt,
      ttlSeconds: QR_TTL_SECONDS,
      pollIntervalMs: QR_POLL_INTERVAL_MS,
    };
  }

  /**
   * 手机端扫码。
   *
   * 只标记「有人扫到了」, **不绑定账号**。扫码方是谁在这里不重要 ——
   * 重要的是确认那一步 (见 `confirm`)。返回桌面端来源, 供手机端展示
   * 「设备 X 请求登录」, 让人自己判断是不是自己发起的。
   */
  async scan(ticket: string, ctx: RequestContext = {}) {
    const row = await this.requireLive(ticket);

    if (row.status === 'scanned') return this.describe(row);

    if (row.status !== 'pending') {
      throw new AppError(40908, '二维码当前状态不可扫码，请刷新二维码', 409);
    }

    // 条件更新: 两台手机同时扫同一个码, 只有一台能把 pending 推进到 scanned
    const moved = await this.prisma.loginSession.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'scanned', scannedAt: new Date() },
    });
    if (moved.count === 0) {
      // 抢输了说明状态已被别的请求改掉, 重新读一次给出真实状态
      const latest = await this.prisma.loginSession.findUnique({ where: { id: row.id } });
      if (latest && latest.status !== 'pending') return this.describe(latest);
      throw new AppError(40908, '二维码状态已变化，请刷新后重试', 409);
    }

    void ctx;
    return this.describe({ ...row, status: 'scanned' });
  }

  /**
   * 手机端确认/拒绝。
   *
   * `approve !== false` 即视为同意 —— 前端会显式传 true/false, 缺省当作同意,
   * 这样「只调 confirm 不传字段」的旧客户端也能完成登录。
   */
  async confirm(ticket: string, userId: string, approve = true) {
    const row = await this.requireLive(ticket);

    // 幂等: 同一个账号重复确认已确认的会话, 直接返回当前状态
    if (row.status === 'confirmed' && row.userId === userId) return this.describe(row);

    if (row.status !== 'pending' && row.status !== 'scanned') {
      throw new AppError(40908, '二维码当前状态不可确认，请重新获取二维码', 409);
    }

    const moved = await this.prisma.loginSession.updateMany({
      where: { id: row.id, status: { in: ['pending', 'scanned'] } },
      data: approve
        ? { status: 'confirmed', userId, confirmedAt: new Date() }
        : { status: 'cancelled', userId, confirmedAt: new Date() },
    });
    if (moved.count === 0) {
      throw new AppError(40908, '二维码状态已变化，请重新获取二维码', 409);
    }

    return this.describe({
      ...row,
      status: approve ? 'confirmed' : 'cancelled',
    });
  }

  /**
   * 桌面端轮询。
   *
   * 状态原样返回; 一旦 `confirmed`, **本次调用即兑换会话**并转 `consumed`。
   * 兑换失败会把状态放回 `confirmed`, 让下一次轮询还能再试 —— 不能因为
   * 一次瞬时故障就把用户的二维码烧掉。
   */
  async status(ticket: string, ctx: RequestContext = {}) {
    const row = await this.requireSession(ticket);

    if ((row.status === 'pending' || row.status === 'scanned') && row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.loginSession.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: 'expired' },
      });
      return { status: 'expired' as QrStatus, expiresAt: row.expiresAt };
    }

    if (row.status !== 'confirmed') {
      return {
        status: row.status as QrStatus,
        expiresAt: row.expiresAt,
        // 已扫描时把设备信息一并回给桌面端, 便于提示「请确认是你本人操作」
        scannedAt: row.scannedAt ?? null,
      };
    }

    if (!row.userId) {
      // 数据自相矛盾 (confirmed 却没有 userId), 不能签发会话
      this.logger.error(`扫码会话 ${row.id} 状态为 confirmed 但缺少 userId`);
      throw new AppError(40908, '二维码状态异常，请重新获取', 409);
    }

    // 抢占: 一个二维码只能换一次会话
    const claimed = await this.prisma.loginSession.updateMany({
      where: { id: row.id, status: 'confirmed' },
      data: { status: 'consumed', consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { status: 'consumed' as QrStatus, expiresAt: row.expiresAt };
    }

    try {
      const session = await this.auth.issueSessionFor(row.userId, ctx, 'qr');
      return {
        status: 'confirmed' as QrStatus,
        expiresAt: row.expiresAt,
        accessToken: session.accessToken,
        user: session.user as PublicUser,
      };
    } catch (e) {
      // 放回 confirmed: 账号被禁用这类失败会再次失败, 但瞬时 DB 故障不该烧掉码
      await this.prisma.loginSession
        .updateMany({ where: { id: row.id, status: 'consumed' }, data: { status: 'confirmed' } })
        .catch(() => undefined);
      throw e;
    }
  }

  // ────────────────────────────────────────────────────────────────────

  private hash(ticket: string): string {
    return createHash('sha256').update(ticket).digest('hex');
  }

  /** 扫码/确认用: 票据必须存在且未过期 */
  private async requireLive(ticket: string) {
    const row = await this.requireSession(ticket);
    if (row.status === 'expired' || row.expiresAt.getTime() <= Date.now()) {
      if (row.status === 'pending' || row.status === 'scanned') {
        await this.prisma.loginSession.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: 'expired' },
        });
      }
      throw new AppError(40908, '二维码已过期，请刷新后重试', 409);
    }
    return row;
  }

  private async requireSession(ticket: string) {
    const row = await this.prisma.loginSession.findUnique({
      where: { tokenHash: this.hash(ticket) },
    });
    if (!row) throw new AppError(40400, '二维码不存在或已失效', 404);
    return row;
  }

  private describe(row: {
    status: string;
    expiresAt: Date;
    ip?: string | null;
    ua?: string | null;
    createdAt?: Date;
    scannedAt?: Date | null;
  }) {
    return {
      status: row.status as QrStatus,
      expiresAt: row.expiresAt,
      /**
       * 发起端信息。手机端必须把它显示出来: 扫码登录的信任模型是
       * 「我看到一台设备在请求登录, 并且认出这是我自己的设备」。
       */
      desktop: {
        ip: row.ip ?? null,
        ua: row.ua ?? null,
        createdAt: row.createdAt ?? null,
      },
      scannedAt: row.scannedAt ?? null,
    };
  }
}
