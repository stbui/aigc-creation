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
var SmsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const console_sms_provider_1 = require("./console-sms.provider");
const http_sms_provider_1 = require("./http-sms.provider");
const aliyun_sms_provider_1 = require("./aliyun-sms.provider");
/**
 * 阿里云短信端点。
 *
 * 不传地域（或 cn-hangzhou）时走中心域名 `dysmsapi.aliyuncs.com`；
 * 其他地域（如 ap-southeast-1）用 `dysmsapi.<region>.aliyuncs.com`。
 * 这里只接受地域 id 形式，不接收任意 URL —— 一个可写的端点会变成
 * 「把验证码发到别人的服务器」的入口。
 */
function aliyunSmsEndpoint(region) {
    if (!region || region === 'cn-hangzhou')
        return 'https://dysmsapi.aliyuncs.com/';
    // 只认地域 id（ap-southeast-1 这类），不认任意字符串 —— 防止把验证码发去别处
    if (!/^[a-z0-9-]+$/.test(region)) {
        throw new Error(`ALIYUN_SMS_REGION 取值非法（应为地域 id，如 ap-southeast-1）：${region}`);
    }
    return `https://dysmsapi.${region}.aliyuncs.com/`;
}
/**
 * 短信门面 —— 依据 `SMS_PROVIDER` 选实现：
 *   console（默认）/ http（通用网关）/ aliyun（阿里云 SendSms）。
 *
 * 与 EmailService 同构：填了 `http` 但缺 URL、或填了 `aliyun` 但缺
 * AccessKey/模板号 → 告警 + 回落控制台，`status()` 如实报告 `delivers: false`。
 * 回落而不是启动失败：短信是可选中通道，但「以为在发、其实没发」必须看得见。
 */
let SmsService = SmsService_1 = class SmsService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(SmsService_1.name);
        this.misconfigured = false;
        const sign = process.env.SMS_SIGN || '货觉AI';
        const wanted = (process.env.SMS_PROVIDER || 'console').toLowerCase();
        const apiUrl = (process.env.SMS_API_URL || '').trim();
        const apiKey = (process.env.SMS_API_KEY || '').trim();
        const template = (process.env.SMS_TEMPLATE || '').trim();
        if (wanted === 'http' && apiUrl) {
            this.provider = new http_sms_provider_1.HttpSmsProvider(apiUrl, apiKey, sign, template);
            if (!apiKey)
                this.logger.warn('SMS_PROVIDER=http 但 SMS_API_KEY 为空：请求将不带鉴权头');
        }
        else if (wanted === 'aliyun') {
            const accessKeyId = (process.env.ALIYUN_ACCESS_KEY_ID || '').trim();
            const accessKeySecret = (process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim();
            const signName = (process.env.ALIYUN_SMS_SIGN_NAME || '').trim();
            const templateCode = (process.env.ALIYUN_SMS_TEMPLATE_CODE || '').trim();
            const region = (process.env.ALIYUN_SMS_REGION || '').trim();
            if (accessKeyId && accessKeySecret && templateCode) {
                this.provider = new aliyun_sms_provider_1.AliyunSmsProvider(accessKeyId, accessKeySecret, signName || sign, templateCode, aliyunSmsEndpoint(region), region || undefined);
                if (!signName)
                    this.logger.warn('SMS_PROVIDER=aliyun 但 ALIYUN_SMS_SIGN_NAME 为空：使用默认签名「' + sign + '」');
            }
            else {
                this.provider = new console_sms_provider_1.ConsoleSmsProvider(sign);
                this.misconfigured = true;
                this.logger.warn('SMS_PROVIDER=aliyun 但缺少 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_SMS_TEMPLATE_CODE，' +
                    '已回落控制台通道（不会真实投递）');
            }
        }
        else {
            this.provider = new console_sms_provider_1.ConsoleSmsProvider(sign);
            if (wanted === 'http') {
                this.misconfigured = true;
                this.logger.warn('SMS_PROVIDER=http 但 SMS_API_URL 为空，已回落控制台通道（不会真实投递）');
            }
        }
    }
    onModuleInit() {
        if (this.provider.delivers) {
            this.logger.log(`短信通道: ${this.provider.name}（真实投递）`);
        }
        else {
            this.logger.warn('短信通道: console（**不会真实投递**，验证码写入 logs/outbox/sms-*.log）。' +
                '生产环境请配置 SMS_PROVIDER=aliyun + ALIYUN_ACCESS_KEY_ID/SECRET + ALIYUN_SMS_SIGN_NAME + ALIYUN_SMS_TEMPLATE_CODE，' +
                '或 SMS_PROVIDER=http + SMS_API_URL + SMS_API_KEY');
        }
    }
    status() {
        return {
            provider: this.provider.name,
            delivers: this.provider.delivers,
            sign: this.provider.sign,
            configured: !this.misconfigured,
        };
    }
    async send(message) {
        /*
         * 生产环境不允许「以为在发、其实没发」。
         * 填了真实通道但凭据不全时构造函数会回落 console —— 开发档保留这层便利
         * (验证码落 logs/outbox 可查), 生产档则直接判投递失败, 让调用方如实报错。
         */
        if (this.misconfigured && process.env.NODE_ENV === 'production') {
            const error = '短信通道配置不完整（已回落 console），生产环境拒绝假装投递';
            this.logger.error(`${error}: ${message.to.slice(0, 3)}****`);
            return { ok: false, provider: this.provider.name, delivered: false, error };
        }
        try {
            const result = await this.provider.send(message);
            if (!result.ok) {
                this.logger.error(`短信投递失败 provider=${result.provider} to=${message.to.slice(0, 3)}**** error=${result.error}`);
            }
            return result;
        }
        catch (err) {
            this.logger.error(`短信通道异常 provider=${this.provider.name}: ${err.message}`);
            return {
                ok: false,
                provider: this.provider.name,
                delivered: false,
                error: err.message,
            };
        }
    }
    /** 登录验证码短信。正文不带任何账号信息，只说明用途与时效 */
    sendLoginCode(params) {
        return this.send({
            to: params.to,
            code: params.code,
            text: `【${this.provider.sign}】验证码 ${params.code}，${params.expiresMinutes} 分钟内有效。` +
                '请勿转告他人，如非本人操作请忽略。',
        });
    }
};
exports.SmsService = SmsService;
exports.SmsService = SmsService = SmsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SmsService);
//# sourceMappingURL=sms.service.js.map