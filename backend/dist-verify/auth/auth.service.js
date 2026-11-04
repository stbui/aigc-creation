"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const jwt_service_1 = require("../common/jwt.service");
const email_service_1 = require("../channels/email/email.service");
const sms_service_1 = require("../channels/sms/sms.service");
const channel_types_1 = require("../channels/channel.types");
const account_token_service_1 = require("./account-token.service");
const phone_1 = require("./phone");
/** bcrypt 成本因子。注册与改密必须一致，否则同一账号的哈希强度会漂移 */
const BCRYPT_ROUNDS = 10;
let AuthService = AuthService_1 = class AuthService {
    constructor(prisma, tokens, email, sms) {
        this.prisma = prisma;
        this.tokens = tokens;
        this.email = email;
        this.sms = sms;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    // 注册后直接签发 token (前端 LoginPage 注册模式同样消费 accessToken 自动登录)
    async register(dto) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing) {
            throw new app_exception_1.AppError(40001, '该邮箱已注册', 400);
        }
        /*
         * 昵称在提交前 trim 并拒绝纯空白。
         *
         * DTO 的 @MinLength(1) 只保证"有一个字符", 空格同样满足 —— 不在这里拦,
         * 用户列表里就会出现一片看不见的名字, 且没有任何报错可追。
         */
        const name = (dto.name ?? '').trim();
        if (!name) {
            throw new app_exception_1.AppError(40001, '请输入昵称', 400);
        }
        /*
         * 手机号（可选）。填了必须带验证码：
         * 短信登录是按号码找账号的，号码没有经过验证就被绑定，等于允许
         * 「把别人的号码绑到我名下」—— 号码主人日后用短信登录会进到陌生账号。
         */
        let phone = null;
        if (dto.phone) {
            phone = (0, phone_1.normalizePhone)(dto.phone);
            if (!phone)
                throw new app_exception_1.AppError(40001, '手机号格式不正确', 400);
            if (!dto.smsCode)
                throw new app_exception_1.AppError(40002, '请先获取并填写短信验证码', 400);
            const taken = await this.prisma.user.findUnique({ where: { phone } });
            if (taken)
                throw new app_exception_1.AppError(40001, '该手机号已被其他账号绑定', 400);
            const verified = await this.tokens.verifySmsCode({
                type: account_token_service_1.AccountTokenService.TYPE.SMS_VERIFY,
                phone,
                code: dto.smsCode,
            });
            if (!verified.ok)
                throw new app_exception_1.AppError(40003, verified.reason, 400);
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
                    .catch((e) => {
                    // 同意记录写失败不该阻断注册: 账号已经建好, 抛错会让用户重试时撞邮箱唯一约束
                    this.logger.warn(`同意记录写入失败 user=${user.id}: ${e.message}`);
                });
            }
            const accessToken = jwt_service_1.JwtService.sign({
                sub: user.id,
                email: user.email,
                tv: user.tokenVersion,
            });
            return { accessToken, user: this.toPublic(user) };
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                // 并发下邮箱/手机号唯一约束仍可能撞上；按字段给出可读原因
                const target = String(err.meta?.target ?? '');
                throw new app_exception_1.AppError(40001, target.includes('phone') ? '该手机号已被其他账号绑定' : '该邮箱已注册', 400);
            }
            throw err;
        }
    }
    async login(dto, ctx = {}) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user) {
            await this.recordLogin({ email: dto.email, ctx, success: false, reason: 'bad_credentials' });
            throw new app_exception_1.AppError(40101, '邮箱或密码错误', 401);
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
            throw new app_exception_1.AppError(40101, '邮箱或密码错误', 401);
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
            throw new app_exception_1.AppError(40302, '账号已被禁用', 403);
        }
        if (user.status === 'deleted') {
            await this.recordLogin({
                userId: user.id,
                email: dto.email,
                ctx,
                success: false,
                reason: 'deleted',
            });
            throw new app_exception_1.AppError(40302, '账号已注销', 403);
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
        const accessToken = jwt_service_1.JwtService.sign({
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
    async forgotPassword(dto, ctx = {}) {
        const email = String(dto.email || '').trim().toLowerCase();
        try {
            const user = await this.prisma.user.findUnique({ where: { email } });
            if (!user || user.status !== 'active') {
                // 静默返回：账号不存在 / 已禁用时**不签发令牌**，也不发信
                this.logger.log(`忘记密码: 邮箱 ${(0, channel_types_1.maskEmail)(email)} 无可重置账号，静默返回`);
                return { requested: true };
            }
            const { raw } = await this.tokens.issue({
                type: account_token_service_1.AccountTokenService.TYPE.PASSWORD_RESET,
                userId: user.id,
                ttlMs: account_token_service_1.AccountTokenService.RESET_TTL_MS,
                ip: ctx.ip,
            });
            const resetUrl = `${this.webBase()}/reset-password?token=${encodeURIComponent(raw)}`;
            const result = await this.email.sendPasswordReset({
                to: user.email,
                name: user.name,
                resetUrl,
                expiresMinutes: Math.round(account_token_service_1.AccountTokenService.RESET_TTL_MS / 60_000),
                ip: ctx.ip,
            });
            this.logger.log(`忘记密码: 已为 ${(0, channel_types_1.maskEmail)(user.email)} 签发重置令牌（delivered=${result.delivered}, provider=${result.provider}）`);
        }
        catch (err) {
            // 任何内部错误都不外抛：外抛的差异同样构成账号存在性信号
            this.logger.error(`忘记密码处理异常: ${err.message}`);
        }
        return { requested: true };
    }
    /**
     * 用一次性令牌重置密码。
     *
     * 成功后 `tokenVersion + 1`：**该账号此前签发的所有 token 立即失效**
     * （包括攻击者可能已经拿到的会话），这是改密后必须成立的语义。
     */
    async resetPassword(dto) {
        const consumed = await this.tokens.consume({
            type: account_token_service_1.AccountTokenService.TYPE.PASSWORD_RESET,
            raw: dto.token,
        });
        if (!consumed.ok) {
            const message = consumed.reason === 'expired'
                ? '重置链接已过期，请重新申请'
                : consumed.reason === 'used'
                    ? '重置链接已被使用，请重新申请'
                    : '重置链接无效';
            throw new app_exception_1.AppError(40004, message, 400);
        }
        const user = await this.prisma.user.findUnique({ where: { id: consumed.userId } });
        if (!user)
            throw new app_exception_1.AppError(40004, '重置链接无效', 400);
        if (user.status !== 'active')
            throw new app_exception_1.AppError(40302, '账号不可用，请联系客服', 403);
        const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
        await this.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash, tokenVersion: { increment: 1 } },
        });
        // 同一用户的其它未使用令牌一并作废（多个重置链接同时生效没有意义）
        await this.prisma.accountToken
            .updateMany({
            where: { userId: user.id, type: account_token_service_1.AccountTokenService.TYPE.PASSWORD_RESET, usedAt: null },
            data: { usedAt: new Date() },
        })
            .catch(() => undefined);
        this.logger.log(`密码已重置: ${(0, channel_types_1.maskEmail)(user.email)}，旧会话已失效`);
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
    async sendSmsCode(dto, ctx = {}) {
        const phone = (0, phone_1.normalizePhone)(dto.phone);
        if (!phone)
            return { sent: true, delivered: false };
        try {
            const owner = await this.prisma.user.findUnique({ where: { phone } });
            if (dto.purpose === 'login') {
                if (!owner || owner.status !== 'active') {
                    this.logger.log(`短信登录验证码: ${(0, channel_types_1.maskPhone)(phone)} 无可登录账号，静默返回`);
                    return { sent: true, delivered: false };
                }
                const { raw } = await this.tokens.issue({
                    type: account_token_service_1.AccountTokenService.TYPE.SMS_LOGIN,
                    userId: owner.id,
                    phone,
                    ttlMs: account_token_service_1.AccountTokenService.SMS_TTL_MS,
                    ip: ctx.ip,
                });
                const result = await this.sms.sendLoginCode({
                    to: phone,
                    code: raw,
                    expiresMinutes: Math.round(account_token_service_1.AccountTokenService.SMS_TTL_MS / 60_000),
                });
                return { sent: true, delivered: result.delivered };
            }
            // purpose === 'verify'（注册时验证号码归属）
            if (owner)
                return { sent: true, delivered: false };
            const { raw } = await this.tokens.issue({
                type: account_token_service_1.AccountTokenService.TYPE.SMS_VERIFY,
                phone,
                ttlMs: account_token_service_1.AccountTokenService.SMS_TTL_MS,
                ip: ctx.ip,
            });
            const result = await this.sms.sendLoginCode({
                to: phone,
                code: raw,
                expiresMinutes: Math.round(account_token_service_1.AccountTokenService.SMS_TTL_MS / 60_000),
            });
            return { sent: true, delivered: result.delivered };
        }
        catch (err) {
            this.logger.error(`发送短信验证码异常: ${err.message}`);
            return { sent: true, delivered: false };
        }
    }
    /** 短信验证码登录。验证码一次性，成功后顺手把号码标记为已验证 */
    async smsLogin(dto, ctx = {}) {
        const phone = (0, phone_1.normalizePhone)(dto.phone);
        if (!phone)
            throw new app_exception_1.AppError(40001, '手机号格式不正确', 400);
        const verified = await this.tokens.verifySmsCode({
            type: account_token_service_1.AccountTokenService.TYPE.SMS_LOGIN,
            phone,
            code: dto.code,
        });
        if (!verified.ok) {
            await this.recordLogin({
                email: (0, channel_types_1.maskPhone)(phone),
                ctx,
                success: false,
                reason: 'sms_code',
            });
            throw new app_exception_1.AppError(40103, verified.reason, 400);
        }
        const user = await this.prisma.user.findUnique({ where: { phone } });
        if (!user)
            throw new app_exception_1.AppError(40101, '该手机号未注册', 401);
        if (user.status === 'disabled')
            throw new app_exception_1.AppError(40302, '账号已被禁用', 403);
        if (user.status === 'deleted')
            throw new app_exception_1.AppError(40302, '账号已注销', 403);
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
        const accessToken = jwt_service_1.JwtService.sign({
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
    async issueSessionFor(userId, ctx = {}, reason = 'qr') {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new app_exception_1.AppError(40101, '账号不存在', 401);
        if (user.status === 'disabled')
            throw new app_exception_1.AppError(40302, '账号已被禁用', 403);
        if (user.status === 'deleted')
            throw new app_exception_1.AppError(40302, '账号已注销', 403);
        await this.prisma.user
            .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
            .catch(() => undefined);
        await this.recordLogin({ userId: user.id, email: user.email, ctx, success: true, reason });
        const accessToken = jwt_service_1.JwtService.sign({
            sub: user.id,
            email: user.email,
            tv: user.tokenVersion,
        });
        return { accessToken, user: this.toPublic(user) };
    }
    // ────────────────────────────────────────────────────────────────────
    /** 登录审计落库。失败只记日志——审计写不进去不该阻断登录本身 */
    async recordLogin(params) {
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
        }
        catch (err) {
            this.logger.warn(`登录审计写入失败: ${err.message}`);
        }
    }
    /** 重置链接的前端基址。未配置时按开发端口兜底 */
    webBase() {
        return (process.env.WEB_BASE_URL || 'http://localhost:5100').replace(/\/+$/, '');
    }
    toPublic(user) {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            role: user.role,
            phone: user.phone ?? null,
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        account_token_service_1.AccountTokenService,
        email_service_1.EmailService,
        sms_service_1.SmsService])
], AuthService);
//# sourceMappingURL=auth.service.js.map