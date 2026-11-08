"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AccountTokenService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountTokenService = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AccountTokenService = AccountTokenService_1 = class AccountTokenService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /** 32 字节随机串，base64url（可直接放进 URL，无需再编码） */
    static newResetToken() {
        return (0, crypto_1.randomBytes)(32).toString('base64url');
    }
    /** 6 位数字验证码。`randomInt` 用 CSPRNG，`Math.random` 不可用于安全场景 */
    static newSmsCode() {
        return String((0, crypto_1.randomInt)(0, 1_000_000)).padStart(6, '0');
    }
    /** HMAC-SHA256，输出 64 位十六进制 */
    static hash(raw) {
        const secret = process.env.JWT_SECRET || 'dev-ecom-vision-secret-2024-do-not-use-in-prod';
        return (0, crypto_1.createHmac)('sha256', secret).update(raw, 'utf8').digest('hex');
    }
    static safeEqualHex(a, b) {
        if (a.length !== b.length)
            return false;
        try {
            return (0, crypto_1.timingSafeEqual)(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
        }
        catch {
            return false;
        }
    }
    /**
     * 签发令牌。同一 (userId|phone, type) 的**旧令牌立即作废**：
     * 用户连续点两次「发送验证码」时，只有最后收到的那条能用，
     * 避免旧验证码在 5 分钟内仍可登录。
     */
    async issue(params) {
        const raw = params.type === AccountTokenService_1.TYPE.PASSWORD_RESET
            ? AccountTokenService_1.newResetToken()
            : AccountTokenService_1.newSmsCode();
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
                tokenHash: AccountTokenService_1.hash(raw),
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
    async consume(params) {
        const tokenHash = AccountTokenService_1.hash(String(params.raw || '').trim());
        const record = await this.prisma.accountToken.findUnique({ where: { tokenHash } });
        if (!record || record.type !== params.type)
            return { ok: false, reason: 'invalid' };
        if (params.userId && record.userId !== params.userId)
            return { ok: false, reason: 'invalid' };
        if (params.phone && record.phone !== params.phone)
            return { ok: false, reason: 'invalid' };
        if (record.usedAt)
            return { ok: false, reason: 'used' };
        if (record.expiresAt.getTime() < Date.now())
            return { ok: false, reason: 'expired' };
        // 条件更新: 只有仍未被消费的那一行会被更新，count 即「本次抢到」
        const claimed = await this.prisma.accountToken.updateMany({
            where: { id: record.id, usedAt: null },
            data: { usedAt: new Date() },
        });
        if (claimed.count !== 1)
            return { ok: false, reason: 'used' };
        return { ok: true, id: record.id, userId: record.userId, phone: record.phone };
    }
    /**
     * 「按手机号 + 类型」校验验证码。
     *
     * 与 `consume` 分开的原因：短信验证码要支持**错误计数**，而消费是
     * 无条件成功路径。这里逐条比对、失败时给对应记录 +1，达到上限直接作废。
     */
    async verifySmsCode(params) {
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
        if (candidates.length === 0)
            return { ok: false, reason: '验证码已过期，请重新获取' };
        const target = AccountTokenService_1.hash(String(params.code || '').trim());
        for (const candidate of candidates) {
            if (AccountTokenService_1.safeEqualHex(candidate.tokenHash, target)) {
                const claimed = await this.prisma.accountToken.updateMany({
                    where: { id: candidate.id, usedAt: null },
                    data: { usedAt: now },
                });
                if (claimed.count !== 1)
                    continue;
                return { ok: true, userId: candidate.userId };
            }
        }
        // 全部不匹配: 给最新一条记一次失败，超限即作废
        const latest = candidates[0];
        const attempts = latest.attempts + 1;
        await this.prisma.accountToken.update({
            where: { id: latest.id },
            data: attempts >= AccountTokenService_1.MAX_ATTEMPTS
                ? { attempts, usedAt: now }
                : { attempts },
        });
        return {
            ok: false,
            reason: attempts >= AccountTokenService_1.MAX_ATTEMPTS
                ? '验证码错误次数过多，请重新获取'
                : '验证码不正确',
        };
    }
};
exports.AccountTokenService = AccountTokenService;
/** 令牌类型常量（SQLite 无 enum，取值以此为准） */
AccountTokenService.TYPE = {
    PASSWORD_RESET: 'password_reset',
    SMS_LOGIN: 'sms_login',
    SMS_VERIFY: 'sms_verify',
};
AccountTokenService.RESET_TTL_MS = 30 * 60 * 1000;
AccountTokenService.SMS_TTL_MS = 5 * 60 * 1000;
/** 单个验证码允许的失败次数，超过即作废 */
AccountTokenService.MAX_ATTEMPTS = 5;
exports.AccountTokenService = AccountTokenService = AccountTokenService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AccountTokenService);
//# sourceMappingURL=account-token.service.js.map