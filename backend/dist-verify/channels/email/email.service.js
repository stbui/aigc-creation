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
var EmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const console_email_provider_1 = require("./console-email.provider");
const http_email_provider_1 = require("./http-email.provider");
const aliyun_email_provider_1 = require("./aliyun-email.provider");
const template_1 = require("../template");
/**
 * 邮件门面 —— 依据 `EMAIL_PROVIDER` 选实现，业务代码只依赖本服务。
 *
 * 选择规则：
 *   EMAIL_PROVIDER=http   且 EMAIL_API_URL 非空                → HttpEmailProvider
 *   EMAIL_PROVIDER=aliyun 且 AccessKey + 发信地址齐全          → AliyunEmailProvider
 *   其余（含未配置、填错、凭据不全）                            → ConsoleEmailProvider + 启动 WARN
 *
 * 填了真实通道但凭据不全时**明确告警并回落控制台**，而不是启动失败：
 * 邮件不是核心链路（忘记密码仍可用短信/联系客服），为一个可选通道打挂
 * 整个服务不划算。但 `status()` 会如实返回 `delivers: false`，后台与
 * `/health` 能看出「这个环境其实没在发信」。
 */
let EmailService = EmailService_1 = class EmailService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(EmailService_1.name);
        /** 请求的 `EMAIL_PROVIDER` 与实际选中的实现不一致（填了 http 但缺 URL） */
        this.misconfigured = false;
        const from = process.env.EMAIL_FROM || 'noreply@huojue.local';
        const wanted = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
        const apiUrl = (process.env.EMAIL_API_URL || '').trim();
        const apiKey = (process.env.EMAIL_API_KEY || '').trim();
        if (wanted === 'http' && apiUrl) {
            this.provider = new http_email_provider_1.HttpEmailProvider(apiUrl, apiKey, from);
            if (!apiKey) {
                this.logger.warn('EMAIL_PROVIDER=http 但 EMAIL_API_KEY 为空：请求将不带鉴权头');
            }
        }
        else if (wanted === 'aliyun') {
            const accessKeyId = (process.env.ALIYUN_ACCESS_KEY_ID || '').trim();
            const accessKeySecret = (process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim();
            // 发信地址必须是控制台已配置的那个，缺失时不能用 EMAIL_FROM 猜
            const accountName = (process.env.ALIYUN_DM_ACCOUNT_NAME || '').trim();
            if (accessKeyId && accessKeySecret && accountName) {
                this.provider = new aliyun_email_provider_1.AliyunEmailProvider(accessKeyId, accessKeySecret, accountName, (process.env.ALIYUN_DM_FROM_ALIAS || '').trim(), (process.env.ALIYUN_DM_ADDRESS_TYPE || '1').trim());
            }
            else {
                this.provider = new console_email_provider_1.ConsoleEmailProvider(from);
                this.misconfigured = true;
                this.logger.warn('EMAIL_PROVIDER=aliyun 但缺少 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_DM_ACCOUNT_NAME，' +
                    '已回落控制台通道（不会真实投递）');
            }
        }
        else {
            this.provider = new console_email_provider_1.ConsoleEmailProvider(from);
            if (wanted === 'http') {
                this.misconfigured = true;
                this.logger.warn('EMAIL_PROVIDER=http 但 EMAIL_API_URL 为空，已回落控制台通道（不会真实投递）');
            }
        }
    }
    onModuleInit() {
        if (this.provider.delivers) {
            this.logger.log(`邮件通道: ${this.provider.name}（真实投递）`);
        }
        else {
            this.logger.warn('邮件通道: console（**不会真实投递**，正文写入 logs/outbox/email-*.log）。' +
                '生产环境请配置 EMAIL_PROVIDER=aliyun + ALIYUN_ACCESS_KEY_ID/SECRET + ALIYUN_DM_ACCOUNT_NAME，' +
                '或 EMAIL_PROVIDER=http + EMAIL_API_URL + EMAIL_API_KEY');
        }
    }
    status() {
        return {
            provider: this.provider.name,
            delivers: this.provider.delivers,
            from: this.provider.from,
            configured: !this.misconfigured,
        };
    }
    async send(message) {
        /*
         * 生产环境不允许「以为在发、其实没发」。
         * 填了真实通道但凭据不全时构造函数会回落 console —— 开发档保留这层便利
         * (正文落 logs/outbox 可查), 生产档则直接判投递失败, 让调用方如实报错。
         */
        if (this.misconfigured && process.env.NODE_ENV === 'production') {
            const error = '邮件通道配置不完整（已回落 console），生产环境拒绝假装投递';
            this.logger.error(`${error}: ${message.to}`);
            return { ok: false, provider: this.provider.name, delivered: false, error };
        }
        try {
            const result = await this.provider.send(message);
            if (!result.ok) {
                this.logger.error(`邮件投递失败 provider=${result.provider} to=${message.to} error=${result.error}`);
            }
            return result;
        }
        catch (err) {
            // 通道异常绝不上抛：调用点（如忘记密码）对外的响应必须是恒定的，
            // 否则「发信失败」会变成一个可被利用的账号存在性探测信号
            this.logger.error(`邮件通道异常 provider=${this.provider.name}: ${err.message}`);
            return {
                ok: false,
                provider: this.provider.name,
                delivered: false,
                error: err.message,
            };
        }
    }
    /**
     * 密码重置邮件。
     *
     * 正文里只放**一次性链接**，不放邮箱、不放昵称以外的账号信息：
     * 邮件会在客户端长期留存，任何 PII 都可能在日后被翻出来。
     */
    async sendPasswordReset(params) {
        const vars = {
            name: params.name || '用户',
            resetUrl: params.resetUrl,
            expiresMinutes: params.expiresMinutes,
            ip: params.ip || '未知',
            year: new Date().getFullYear(),
        };
        const text = (0, template_1.renderTemplate)([
            '{{name}}，你好：',
            '',
            '我们收到了重置货觉AI账号密码的请求。请在 {{expiresMinutes}} 分钟内打开下面的链接设置新密码：',
            '',
            '{{resetUrl}}',
            '',
            '如果不是你本人操作，请忽略本邮件，你的密码不会被修改。',
            '请求来源 IP：{{ip}}',
            '',
            '—— 货觉AI 团队',
        ].join('\n'), vars);
        /*
         * HTML 正文单独取一份变量表: 昵称与 IP 是外部输入, 必须转义
         * (否则昵称里写 `<a href=...>` 会在邮件客户端渲染成真链接);
         * resetUrl 由本服务生成, 字符集受控, 转义会把 `&` 变成 `&amp;`
         * 显示在正文里, 故不转义。
         */
        const htmlVars = {
            name: (0, template_1.escapeHtml)(vars.name),
            resetUrl: vars.resetUrl,
            expiresMinutes: String(vars.expiresMinutes),
            ip: (0, template_1.escapeHtml)(vars.ip),
            year: String(vars.year),
        };
        const html = (0, template_1.renderTemplate)([
            '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#171a2b">',
            '<h2 style="font-size:18px;margin:0 0 16px">重置货觉AI账号密码</h2>',
            '<p style="color:#4e5969;line-height:1.7">{{name}}，你好：</p>',
            '<p style="color:#4e5969;line-height:1.7">我们收到了重置密码的请求。请在 {{expiresMinutes}} 分钟内点击下面的按钮设置新密码：</p>',
            '<p style="margin:24px 0"><a href="{{resetUrl}}" style="display:inline-block;background:#5546d8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">设置新密码</a></p>',
            '<p style="color:#86909c;font-size:12px;line-height:1.7">按钮无法点击时，复制以下链接到浏览器打开：<br>{{resetUrl}}</p>',
            '<p style="color:#86909c;font-size:12px;line-height:1.7">如果不是你本人操作，请忽略本邮件，密码不会被修改。请求来源 IP：{{ip}}</p>',
            '<p style="color:#86909c;font-size:12px;margin-top:24px">—— 货觉AI 团队 · {{year}}</p>',
            '</div>',
        ].join(''), htmlVars);
        return this.send({
            to: params.to,
            subject: '【货觉AI】重置密码',
            text,
            html,
        });
    }
};
exports.EmailService = EmailService;
exports.EmailService = EmailService = EmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EmailService);
//# sourceMappingURL=email.service.js.map