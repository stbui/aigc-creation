import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { JwtService } from '../common/jwt.service';
import { EmailService } from '../channels/email/email.service';
import { SmsService } from '../channels/sms/sms.service';
import { maskEmail, maskPhone } from '../channels/channel.types';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SmsSendDto } from './dto/sms-send.dto';
import { SmsLoginDto } from './dto/sms-login.dto';
import { AccountTokenService } from './account-token.service';
import { normalizePhone } from './phone';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  /** 后台角色: 'user' | 'admin' | 'operator' | 'finance' */
  role: string;
  /** 手机号（已脱敏展示由前端决定；未绑定为 null） */
  phone?: string | null;
}

/** 请求来源，用于登录审计。由 controller 从 `req` 中提取 */
export interface RequestContext {
  ip?: string;
  ua?: string;
}

/** bcrypt 成本因子。注册与改密必须一致，否则同一账号的哈希强度会漂移 */
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccountTokenService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  // 注册后直接签发 token (前端 LoginPage 注册模式同样消费 accessToken 自动登录)
  async register(dto: RegisterDto): Promise<{ accessToken: string; user: PublicUser }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new AppError(40001, '该邮箱已注册', 400);
    }

    /*
     * 昵称在提交前 trim 并拒绝纯空白。
     *
     * DTO 的 @MinLength(1) 只保证"有一个字符", 空格同样满足 —— 不在这里拦,
     * 用户列表里就会出现一片看不见的名字, 且没有任何报错可追。
     */
    const name = (dto.name ?? '').trim();
    if (!name) {
      throw new AppError(40001, '请输入昵称', 400);
    }

    /*
     * 手机号（可选）。填了必须带验证码：
     * 短信登录是按号码找账号的，号码没有经过验证就被绑定，等于允许
     * 「把别人的号码绑到我名下」—— 号码主人日后用短信登录会进到陌生账号。
     */
    let phone: string | null = null;
    if (dto.phone) {
      phone = normalizePhone(dto.phone);
      if (!phone) throw new AppError(40001, '手机号格式不正确', 400);
      if (!dto.smsCode) throw new AppError(40002, '请先获取并填写短信验证码', 400);

      const taken = await this.prisma.user.findUnique({ where: { phone } });
      if (taken) throw new AppError(40001, '该手机号已被其他账号绑定', 400);

      const verified = await this.tokens.verifySmsCode({
        type: AccountTokenService.TYPE.SMS_VERIFY,
        phone,
        code: dto.smsCode,
      });
      if (!verified.ok) throw new AppError(40003, verified.reason, 400);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name,
          ...(phone ? { phone, phoneVerifiedAt: new Date() } : {}),
        },
      });
      /*
       * 同意记录 (B4)。只在前端确实给了版本号时落库 —— 不替用户补一个
       * 「默认同意」：那会在合规审查时变成一条**伪造的证据**。
       */
      if (dto.consentVersion) {
        await this.prisma.consentRecord
          .create({
            data: {
              userId: user.id,
              kind: 'register',
              slug: 'user-agreement',
              version: dto.consentVersion,
            },
          })
          .catch((e: Error) => {
            // 同意记录写失败不该阻断注册: 账号已经建好, 抛错会让用户重试时撞邮箱唯一约束
            this.logger.warn(`同意记录写入失败 user=${user.id}: ${e.message}`);
          });
      }

      const accessToken = JwtService.sign({
        sub: user.id,
        email: user.email,
        tv: user.tokenVersion,
      });
      return { accessToken, user: this.toPublic(user) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // 并发下邮箱/手机号唯一约束仍可能撞上；按字段给出可读原因
        const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
        throw new AppError(
          40001,
          target.includes('phone') ? '该手机号已被其他账号绑定' : '该邮箱已注册',
          400,
        );
      }
      throw err;
    }
  }

  async login(dto: LoginDto, ctx: RequestContext = {}): Promise<{ accessToken: string; user: PublicUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      await this.recordLogin({ email: dto.email, ctx, success: false, reason: 'bad_credentials' });
      throw new AppError(40101, '邮箱或密码错误', 401);
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordLogin({
        userId: user.id,
        email: dto.email,
        ctx,
        success: false,
        reason: 'bad_credentials',
      });
      throw new AppError(40101, '邮箱或密码错误', 401);
    }

    // 已注销/已禁用账号拒绝登录: 与 AdminGuard 的判定同源, 避免后台禁用后
    // 用户仍能凭旧密码重新登录拿到 token (后台判定虽然会拦, 但 C 端登录页
    // 会表现为"登录成功但一切请求 403", 体验上无法解释)。
    if (user.status === 'disabled') {
      await this.recordLogin({
        userId: user.id,
        email: dto.email,
        ctx,
        success: false,
        reason: 'disabled',
      });
      throw new AppError(40302, '账号已被禁用', 403);
    }
    if (user.status === 'deleted') {
      await this.recordLogin({
        userId: user.id,
        email: dto.email,
        ctx,
        success: false,
        reason: 'deleted',
      });
      throw new AppError(40302, '账号已注销', 403);
    }

    // 记录最近登录时间 (后台用户列表展示用)。失败不影响登录本身。
    await this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);
    await this.recordLogin({
      userId: user.id,
      email: dto.email,
      ctx,
      success: true,
      reason: 'password',
    });

    const accessToken = JwtService.sign({
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    });
    return { accessToken, user: this.toPublic(user) };
  }

  // ────────────────────────────────────────────────────────────────────
  // 忘记密码 / 重置密码
  // ────────────────────────────────────────────────────────────────────

  /**
   * 申请密码重置邮件。
   *
   * **恒定返回 `{ requested: true }`**，不区分邮箱是否存在、账号是否被禁用、
   * 邮件是否真的投递成功 —— 任何一个分支返回不同结果，这个接口就变成了
   * 「账号批量探测工具」。真实投递情况只进服务端日志。
   */
  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext = {}): Promise<{ requested: true }> {
    const email = String(dto.email || '').trim().toLowerCase();

    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user || user.status !== 'active') {
        // 静默返回：账号不存在 / 已禁用时**不签发令牌**，也不发信
        this.logger.log(`忘记密码: 邮箱 ${maskEmail(email)} 无可重置账号，静默返回`);
        return { requested: true };
      }

      const { raw } = await this.tokens.issue({
        type: AccountTokenService.TYPE.PASSWORD_RESET,
        userId: user.id,
        ttlMs: AccountTokenService.RESET_TTL_MS,
        ip: ctx.ip,
      });

      const resetUrl = `${this.webBase()}/reset-password?token=${encodeURIComponent(raw)}`;
      const result = await this.email.sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresMinutes: Math.round(AccountTokenService.RESET_TTL_MS / 60_000),
        ip: ctx.ip,
      });

      this.logger.log(
        `忘记密码: 已为 ${maskEmail(user.email)} 签发重置令牌（delivered=${result.delivered}, provider=${result.provider}）`,
      );
    } catch (err) {
      // 任何内部错误都不外抛：外抛的差异同样构成账号存在性信号
      this.logger.error(`忘记密码处理异常: ${(err as Error).message}`);
    }

    return { requested: true };
  }

  /**
   * 用一次性令牌重置密码。
   *
   * 成功后 `tokenVersion + 1`：**该账号此前签发的所有 token 立即失效**
   * （包括攻击者可能已经拿到的会话），这是改密后必须成立的语义。
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const consumed = await this.tokens.consume({
      type: AccountTokenService.TYPE.PASSWORD_RESET,
      raw: dto.token,
    });

    if (!consumed.ok) {
      const message =
        consumed.reason === 'expired'
          ? '重置链接已过期，请重新申请'
          : consumed.reason === 'used'
            ? '重置链接已被使用，请重新申请'
            : '重置链接无效';
      throw new AppError(40004, message, 400);
    }

    const user = await this.prisma.user.findUnique({ where: { id: consumed.userId! } });
    if (!user) throw new AppError(40004, '重置链接无效', 400);
    if (user.status !== 'active') throw new AppError(40302, '账号不可用，请联系客服', 403);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    // 同一用户的其它未使用令牌一并作废（多个重置链接同时生效没有意义）
    await this.prisma.accountToken
      .updateMany({
        where: { userId: user.id, type: AccountTokenService.TYPE.PASSWORD_RESET, usedAt: null },
        data: { usedAt: new Date() },
      })
      .catch(() => undefined);

    this.logger.log(`密码已重置: ${maskEmail(user.email)}，旧会话已失效`);
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────────────
  // 短信验证码 / 短信登录
  // ────────────────────────────────────────────────────────────────────

  /**
   * 发送短信验证码。
   *
   * 与忘记密码同样**恒定返回 `{ sent: true }`**：
   *   - `login`  用途下，号码未注册时静默不发送（返回一致）；
   *   - `verify` 用途下，号码已被占用时静默不发送；
   * 真实发送结果只进日志与 `delivered` 字段（仅用于开发态提示，不区分存在性）。
   */
  async sendSmsCode(
    dto: SmsSendDto,
    ctx: RequestContext = {},
  ): Promise<{ sent: true; delivered: boolean }> {
    const phone = normalizePhone(dto.phone);
    if (!phone) return { sent: true, delivered: false };

    try {
      const owner = await this.prisma.user.findUnique({ where: { phone } });

      if (dto.purpose === 'login') {
        if (!owner || owner.status !== 'active') {
          this.logger.log(`短信登录验证码: ${maskPhone(phone)} 无可登录账号，静默返回`);
          return { sent: true, delivered: false };
        }
        const { raw } = await this.tokens.issue({
          type: AccountTokenService.TYPE.SMS_LOGIN,
          userId: owner.id,
          phone,
          ttlMs: AccountTokenService.SMS_TTL_MS,
          ip: ctx.ip,
        });
        const result = await this.sms.sendLoginCode({
          to: phone,
          code: raw,
          expiresMinutes: Math.round(AccountTokenService.SMS_TTL_MS / 60_000),
        });
        return { sent: true, delivered: result.delivered };
      }

      // purpose === 'verify'（注册时验证号码归属）
      if (owner) return { sent: true, delivered: false };
      const { raw } = await this.tokens.issue({
        type: AccountTokenService.TYPE.SMS_VERIFY,
        phone,
        ttlMs: AccountTokenService.SMS_TTL_MS,
        ip: ctx.ip,
      });
      const result = await this.sms.sendLoginCode({
        to: phone,
        code: raw,
        expiresMinutes: Math.round(AccountTokenService.SMS_TTL_MS / 60_000),
      });
      return { sent: true, delivered: result.delivered };
    } catch (err) {
      this.logger.error(`发送短信验证码异常: ${(err as Error).message}`);
      return { sent: true, delivered: false };
    }
  }

  /** 短信验证码登录。验证码一次性，成功后顺手把号码标记为已验证 */
  async smsLogin(
    dto: SmsLoginDto,
    ctx: RequestContext = {},
  ): Promise<{ accessToken: string; user: PublicUser }> {
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new AppError(40001, '手机号格式不正确', 400);

    const verified = await this.tokens.verifySmsCode({
      type: AccountTokenService.TYPE.SMS_LOGIN,
      phone,
      code: dto.code,
    });
    if (!verified.ok) {
      await this.recordLogin({
        email: maskPhone(phone),
        ctx,
        success: false,
        reason: 'sms_code',
      });
      throw new AppError(40103, verified.reason, 400);
    }

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new AppError(40101, '该手机号未注册', 401);
    if (user.status === 'disabled') throw new AppError(40302, '账号已被禁用', 403);
    if (user.status === 'deleted') throw new AppError(40302, '账号已注销', 403);

    await this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() },
      })
      .catch(() => undefined);
    await this.recordLogin({
      userId: user.id,
      email: user.email,
      ctx,
      success: true,
      reason: 'sms',
    });

    const accessToken = JwtService.sign({
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    });
    return { accessToken, user: this.toPublic(user) };
  }

  /**
   * 为**已在别处确认过身份**的账号签发会话 (扫码登录用)。
   *
   * 为什么单独开一个方法而不是让扫码登录直接调 `JwtService.sign`:
   * 账号状态检查 (禁用/注销)、`lastLoginAt`、登录审计这三件事必须在
   * **每一条**登录路径上都发生。少一处, 后台的「最近登录」就会漏掉
   * 扫码登录的用户, 禁用账号也能从扫码入口溜进来。
   *
   * `reason` 写进 LoginLog, 后台据此区分「密码 / 短信 / 扫码」。
   */
  async issueSessionFor(
    userId: string,
    ctx: RequestContext = {},
    reason = 'qr',
  ): Promise<{ accessToken: string; user: PublicUser }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(40101, '账号不存在', 401);
    if (user.status === 'disabled') throw new AppError(40302, '账号已被禁用', 403);
    if (user.status === 'deleted') throw new AppError(40302, '账号已注销', 403);

    await this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);
    await this.recordLogin({ userId: user.id, email: user.email, ctx, success: true, reason });

    const accessToken = JwtService.sign({
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    });
    return { accessToken, user: this.toPublic(user) };
  }

  // ────────────────────────────────────────────────────────────────────

  /** 登录审计落库。失败只记日志——审计写不进去不该阻断登录本身 */
  private async recordLogin(params: {
    userId?: string;
    email: string;
    ctx: RequestContext;
    success: boolean;
    reason: string;
  }): Promise<void> {
    try {
      await this.prisma.loginLog.create({
        data: {
          userId: params.userId ?? null,
          email: params.email,
          ip: params.ctx.ip ?? null,
          ua: (params.ctx.ua ?? '').slice(0, 500) || null,
          success: params.success,
          reason: params.reason,
        },
      });
    } catch (err) {
      this.logger.warn(`登录审计写入失败: ${(err as Error).message}`);
    }
  }

  /** 重置链接的前端基址。未配置时按开发端口兜底 */
  private webBase(): string {
    return (process.env.WEB_BASE_URL || 'http://localhost:5100').replace(/\/+$/, '');
  }

  private toPublic(user: {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    role: string;
    phone?: string | null;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      role: user.role,
      phone: user.phone ?? null,
    };
  }
}
