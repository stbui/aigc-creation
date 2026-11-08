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
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("./app.exception");
const setting_defs_1 = require("./setting-defs");
/**
 * 系统设置的运行时读取 —— **业务侧读设置值只走这里**。
 *
 * 放在 `common/` 而不是 `admin/`，是因为上传校验、移动端上传、生成链路
 * 都要读这些值；留在 admin 层会让业务模块反向依赖后台模块。
 *
 * 优先级链 (与模型通道配置同构):
 *   代码默认值 (setting-defs.ts)  →  DB 运行时覆盖 (SystemSetting 表)
 *
 * **为什么有缓存**: 上传校验在每次上传时都要读上限，生成任务创建也要读，
 * 每读一次就查一次库不可接受。缓存 3s 意味着「后台改完最多 3 秒生效」，
 * 这个延迟对运营完全可接受；后台写入后调 `invalidate()` 立即失效。
 * 参照物是 `credit-price.service.ts` 的同一套模式。
 */
const CACHE_TTL_MS = 3000;
let SettingsService = SettingsService_1 = class SettingsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(SettingsService_1.name);
        /** key → 生效值（已按 SettingDef 归一化） */
        this.cache = new Map();
        /** key → 上次修改的操作人，供设置页显示「上次由 X 改」 */
        this.actorCache = new Map();
        this.cacheAt = 0;
    }
    /** 后台改设置后立即失效缓存。不调也能等 TTL，但改设置应即时生效 */
    invalidate() {
        this.cache.clear();
        this.actorCache.clear();
        this.cacheAt = 0;
    }
    /**
     * 读取单个设置的有效值。
     *
     * 未知键抛 404 —— 调用方传错键名时应当立刻暴露，而不是静默拿到 undefined
     * 然后在下游算出一个奇怪的值。
     */
    async get(key) {
        const def = (0, setting_defs_1.findSettingDef)(key);
        if (!def)
            throw new app_exception_1.AppError(40400, `未知设置项: ${key}`, 404);
        if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
            await this.refresh();
        }
        const cached = this.cache.get(key);
        return (cached === undefined ? def.default : cached);
    }
    /** 读取数值型设置；值非法时回落定义里的默认值 */
    async getNumber(key) {
        const def = (0, setting_defs_1.findSettingDef)(key);
        const fallback = typeof def?.default === 'number' ? def.default : 0;
        try {
            const v = await this.get(key);
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        }
        catch {
            return fallback;
        }
    }
    /** 读取布尔型设置 */
    async getBoolean(key) {
        const def = (0, setting_defs_1.findSettingDef)(key);
        const fallback = def?.default === true;
        try {
            const v = await this.get(key);
            if (typeof v === 'boolean')
                return v;
            return v === 'true';
        }
        catch {
            return fallback;
        }
    }
    /** 一次性读全部设置项的生效值（含缓存） */
    async getAll() {
        if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
            await this.refresh();
        }
        const out = {};
        for (const def of setting_defs_1.SETTING_DEFS) {
            const v = this.cache.get(def.key);
            out[def.key] = v === undefined ? def.default : v;
        }
        return out;
    }
    /** 某项的最后修改人 / 修改时间 */
    async getMeta(key) {
        if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
            await this.refresh();
        }
        return this.actorCache.get(key) ?? { updatedBy: null, updatedAt: null };
    }
    /**
     * 退款规则快照。
     *
     * 三项一次读齐再交给调用方 —— 让服务层只负责「按规则判」，
     * 不必知道设置存在哪个表、键叫什么。规则在**提交那一刻**读取并冻结：
     * 运营在退款过程中改了设置，本次退款仍按提交时的规则判定。
     */
    async refundRules() {
        const [windowDays, maxRatioBps, allowConsumedTask] = await Promise.all([
            this.get('refund.windowDays'),
            this.get('refund.maxRatioBps'),
            this.get('refund.allowConsumedTask'),
        ]);
        return { windowDays, maxRatioBps, allowConsumedTask };
    }
    /**
     * 刷新缓存：一次 findMany 覆盖全部设置项。
     *
     * 只取本模块定义的键 —— SystemSetting 表里还混着 `creditPrice.*`
     * （积分价有自己的缓存与键空间），全表扫进来再丢弃是白读。
     */
    async refresh() {
        const known = new Set(setting_defs_1.SETTING_DEFS.map((d) => d.key));
        const rows = await this.prisma.systemSetting.findMany();
        const cache = new Map();
        const actors = new Map();
        for (const row of rows) {
            if (!known.has(row.key))
                continue;
            const def = (0, setting_defs_1.findSettingDef)(row.key);
            if (!def)
                continue;
            cache.set(row.key, (0, setting_defs_1.parseSettingValue)(row.value, def));
            actors.set(row.key, { updatedBy: row.updatedBy, updatedAt: row.updatedAt });
        }
        this.cache = cache;
        this.actorCache = actors;
        this.cacheAt = Date.now();
    }
    /**
     * 解析库里的字符串值为目标类型。
     *
     * 存量数据可能格式不合法 (手工改过库), 此时回退到代码默认值 ——
     * 一个坏配置不应让整页设置加载失败。
     */
    parseValue(raw, def) {
        return (0, setting_defs_1.parseSettingValue)(raw, def);
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SettingsService);
//# sourceMappingURL=settings.service.js.map