import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 一次性账号令牌（密码重置 / 短信验证码）。
 *
 * ## 为什么单独成服务而不是写进 AuthService
 *
 * 「签发 → 校验 → 消费」是一段需要**原子性**的逻辑（防并发重放）与明确的
 * 过期/次数上限，和业务动作（发邮件、改密码）是两层关注点。抽出来后，
 * 忘记密码与短信登录共用同一份实现，安全属性只需要在一个地方证明。
 *
 * ## 三条实现要点
 *
 * 1. **只存 HMAC，不存明文。** 重置令牌是 32 字节随机串，6 位验证码只有
 *    100 万种可能：库泄露后裸 sha256 可离线穷举，故统一用 `JWT_SECRET`
 *    作密钥做 HMAC。
 * 2. **消费是条件更新。** `updateMany({ id, usedAt: null })` 的返回计数才是
 *    「本次抢到了」的唯一凭据；先查后改会让两个并发请求都通过。
 * 3. **失败计数。** 短信验证码错误累计到 5 次即作废，防止在线穷举；
 *    密码重置令牌是长随机串，穷举不可行，但同样计数以留下痕迹。
 */
/**
 * 消费/校验结果。
 *
 * 刻意写成**单个接口 + 可选字段**而不是可辨识联合：
 * 后端 tsconfig 关了 `strictNullChecks`，`if (!result.ok)` 无法把联合
 * 收窄到失败分支（布尔字面量判别依赖 strict 模式）。用可选字段后，
 * 调用方拿到的是 `reason?: string`，语义不变且编译通过。
 */
export interface ConsumeResult {
  ok: boolean;
  reason?: 'invalid' | 'expired' | 'used' | 'attempts';
  id?: string;
  userId?: string | null;
  phone?: string | null;
}

export interface SmsVerifyResult {
  ok: boolean;
  reason?: string;
  userId?: string | null;
}

@Injectable()
export class AccountTokenService {
  /** 令牌类型常量（SQLite 无 enum，取值以此为准） */
  static readonly TYPE = {
    PASSWORD_RESET: 'password_reset',
    SMS_LOGIN: 'sms_login',
    SMS_VERIFY: 'sms_verify',
  } as const;

  static readonly RESET_TTL_MS = 30 * 60 * 1000;
  static readonly SMS_TTL_MS = 5 * 60 * 1000;
  /** 单个验证码允许的失败次数，超过即作废 */
  static readonly MAX_ATTEMPTS = 5;

  constructor(private readonly prisma: PrismaService) {}

  /** 32 字节随机串，base64url（可直接放进 URL，无需再编码） */
  static newResetToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** 6 位数字验证码。`randomInt` 用 CSPRNG，`Math.random` 不可用于安全场景 */
  static newSmsCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** HMAC-SHA256，输出 64 位十六进制 */
  static hash(raw: string): string {
    const secret = process.env.JWT_SECRET || 'dev-ecom-vision-secret-2024-do-not-use-in-prod';
    return createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  }

  private static safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * 签发令牌。同一 (userId|phone, type) 的**旧令牌立即作废**：
   * 用户连续点两次「发送验证码」时，只有最后收到的那条能用，
   * 避免旧验证码在 5 分钟内仍可登录。
   */
  async issue(params: {
    type: string;
    userId?: string;
    phone?: string;
    ttlMs: number;
    ip?: string;
    /** 是否作废旧令牌，默认 true */
    revokePrevious?: boolean;
  }): Promise<{ raw: string; expiresAt: Date }> {
    const raw =
      params.type === AccountTokenService.TYPE.PASSWORD_RESET
        ? AccountTokenService.newResetToken()
        : AccountTokenService.newSmsCode();
    const expiresAt = new Date(Date.now() + params.ttlMs);

    if (params.revokePrevious !== false) {
      await this.prisma.accountToken.updateMany({
        where: {
          type: params.type,
          usedAt: null,
          ...(params.userId ? { userId: params.userId } : {}),
          ...(params.phone ? { phone: params.phone } : {}),
        },
        data: { usedAt: new Date() },
      });
    }

    await this.prisma.accountToken.create({
      data: {
        type: params.type,
        userId: params.userId ?? null,
        phone: params.phone ?? null,
        tokenHash: AccountTokenService.hash(raw),
        expiresAt,
        requestedIp: params.ip ?? null,
      },
    });

    return { raw, expiresAt };
  }

  /**
   * 校验并消费。
   *
   * @returns `ok: false` 时 `reason` 为 `invalid`（不存在/不匹配）、
   *          `expired`、`used`、`attempts`（失败次数超限）
   */
  async consume(params: {
    type: string;
    raw: string;
    userId?: string;
    phone?: string;
  }): Promise<ConsumeResult> {
    const tokenHash = AccountTokenService.hash(String(params.raw || '').trim());
    const record = await this.prisma.accountToken.findUnique({ where: { tokenHash } });

    if (!record || record.type !== params.type) return { ok: false, reason: 'invalid' };
    if (params.userId && record.userId !== params.userId) return { ok: false, reason: 'invalid' };
    if (params.phone && record.phone !== params.phone) return { ok: false, reason: 'invalid' };
    if (record.usedAt) return { ok: false, reason: 'used' };
    if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

    // 条件更新: 只有仍未被消费的那一行会被更新，count 即「本次抢到」
    const claimed = await this.prisma.accountToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return { ok: false, reason: 'used' };

    return { ok: true, id: record.id, userId: record.userId, phone: record.phone };
  }

  /**
   * 「按手机号 + 类型」校验验证码。
   *
   * 与 `consume` 分开的原因：短信验证码要支持**错误计数**，而消费是
   * 无条件成功路径。这里逐条比对、失败时给对应记录 +1，达到上限直接作废。
   */
  async verifySmsCode(params: {
    type: string;
    phone: string;
    code: string;
  }): Promise<SmsVerifyResult> {
    const now = new Date();
    const candidates = await this.prisma.accountToken.findMany({
      where: {
        type: params.type,
        phone: params.phone,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (candidates.length === 0) return { ok: false, reason: '验证码已过期，请重新获取' };

    const target = AccountTokenService.hash(String(params.code || '').trim());
    for (const candidate of candidates) {
      if (AccountTokenService.safeEqualHex(candidate.tokenHash, target)) {
        const claimed = await this.prisma.accountToken.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) continue;
        return { ok: true, userId: candidate.userId };
      }
    }

    // 全部不匹配: 给最新一条记一次失败，超限即作废
    const latest = candidates[0];
    const attempts = latest.attempts + 1;
    await this.prisma.accountToken.update({
      where: { id: latest.id },
      data:
        attempts >= AccountTokenService.MAX_ATTEMPTS
          ? { attempts, usedAt: now }
          : { attempts },
    });

    return {
      ok: false,
      reason:
        attempts >= AccountTokenService.MAX_ATTEMPTS
          ? '验证码错误次数过多，请重新获取'
          : '验证码不正确',
    };
  }
}
