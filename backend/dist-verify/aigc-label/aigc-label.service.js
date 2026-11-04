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
var AigcLabelService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AigcLabelService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const aigc_label_badge_1 = require("../common/aigc-label-badge");
const aigc_label_config_1 = require("../common/aigc-label.config");
/** 位图体积上限。角标是简单图形，正常只有几 KB；超限基本意味着传错了图 */
const MAX_BADGE_BYTES = 512 * 1024;
/** 位图边长上限（2x 渲染，120px 字号也远小于此） */
const MAX_BADGE_DIM = 4096;
/**
 * AIGC 可见角标配置。
 *
 * 读取走 3 秒缓存：生成链路是热路径，但运营改完样式应当「存完即生效」。
 * 3 秒既避免每张图两次查询，也让保存后的下一张图立刻用上新样式
 * （写操作会主动 invalidate，缓存只是兜底）。
 *
 * ⚠️ 读失败**不抛错**：角标样式读不到时用默认样式照样能打标识，
 * 因一条配置读失败而让整条生成链路失败，是把配置依赖放到了合规之上。
 */
let AigcLabelService = AigcLabelService_1 = class AigcLabelService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(AigcLabelService_1.name);
        this.cache = null;
        this.ttlMs = 3000;
        this.defaultSize = null;
    }
    /** 运行时素材（生成链路调用） */
    async runtime() {
        if (this.cache && Date.now() - this.cache.at < this.ttlMs)
            return this.cache.value;
        let value;
        try {
            const row = await this.prisma.aigcLabelConfig.findUnique({ where: { id: 'default' } });
            value = this.fromRow(row);
        }
        catch (e) {
            // 表不存在 / 库暂不可用：默认样式仍是一张合规的角标
            this.logger.warn(`AIGC 角标配置读取失败，回退默认样式: ${e.message}`);
            value = this.fromRow(null);
        }
        this.cache = { at: Date.now(), value };
        return value;
    }
    /** 后台页面读取 */
    async adminView() {
        const row = await this.ensureTable().catch(() => null);
        const runtime = this.fromRow(row);
        return {
            spec: runtime.spec,
            defaults: aigc_label_config_1.AIGC_LABEL_DEFAULTS,
            badge: {
                source: runtime.source,
                width: runtime.width,
                height: runtime.height,
                stale: runtime.stale,
                pngBase64: runtime.badgePng ? runtime.badgePng.toString('base64') : null,
                updatedBy: row?.updatedBy ?? null,
                updatedAt: row?.updatedAt ?? null,
            },
        };
    }
    /** C 端视频播放器角标用的公开子集（不含位图与几何） */
    async publicSpec() {
        const { spec } = await this.runtime();
        return {
            enabled: spec.enabled,
            text: spec.text,
            textColor: spec.textColor,
            backgroundColor: spec.backgroundColor,
            backgroundOpacity: spec.backgroundOpacity,
            radius: spec.radius,
            dotColor: spec.dotColor,
            position: spec.position,
        };
    }
    /**
     * 保存样式 + 位图。
     *
     * 位图与 spec 一次性写入 —— 分两次请求会出现「文案已改、图上还是旧字」
     * 的中间态，而角标正是用户会截图举报的东西。
     */
    async save(input, actor) {
        const spec = (0, aigc_label_config_1.sanitizeAigcLabelSpec)(input.spec);
        const specKey = (0, aigc_label_config_1.aigcLabelSpecKey)(spec);
        const existing = await this.ensureTable();
        const png = input.badgePngBase64
            ? this.parseBadge(input.badgePngBase64)
            : existing?.pngBase64
                ? Buffer.from(existing.pngBase64, 'base64')
                : null;
        const size = png ? (0, aigc_label_config_1.readPngSize)(png) : null;
        const data = {
            specJson: JSON.stringify(spec),
            specKey,
            pngBase64: png ? png.toString('base64') : null,
            pngWidth: size?.width ?? null,
            pngHeight: size?.height ?? null,
            updatedBy: actor,
        };
        let row;
        try {
            row = await this.prisma.aigcLabelConfig.upsert({
                where: { id: 'default' },
                create: { id: 'default', ...data },
                update: data,
            });
        }
        catch (e) {
            // 最常见的原因是老库还没 `prisma db push`：把 Prisma 的原始报错翻译成可执行的提示
            throw new app_exception_1.AppError(50001, `AIGC 标识配置写入失败（若为老库升级，请先执行 prisma db push）: ${e.message}`, 500);
        }
        this.invalidate();
        return this.fromRow(row);
    }
    invalidate() {
        this.cache = null;
    }
    /** 表可能尚未 push（老库升级），读不到时当作「没有配置」，不要 500 */
    async ensureTable() {
        return this.prisma.aigcLabelConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
    }
    fromRow(row) {
        const spec = (0, aigc_label_config_1.sanitizeAigcLabelSpec)(this.safeJson(row?.specJson));
        const specKey = (0, aigc_label_config_1.aigcLabelSpecKey)(spec);
        if (!row?.pngBase64) {
            const size = this.defaultBadgeSize();
            return {
                spec,
                badgePng: null,
                width: size.width,
                height: size.height,
                source: 'default',
                // 没有自定义位图时用的是内置 PNG（文案固定为「AI 生成」）。
                // 若 spec 已被改过（例如直接调接口只传 spec），位图与配置已经不一致，
                // 同样要标记 stale，否则后台会显示「用的是最新样式」而图上还是旧字。
                stale: specKey !== (0, aigc_label_config_1.aigcLabelSpecKey)(aigc_label_config_1.AIGC_LABEL_DEFAULTS),
            };
        }
        const png = Buffer.from(row.pngBase64, 'base64');
        const parsed = (0, aigc_label_config_1.readPngSize)(png);
        return {
            spec,
            badgePng: png,
            width: row.pngWidth ?? parsed?.width ?? 276,
            height: row.pngHeight ?? parsed?.height ?? 88,
            source: 'custom',
            // 位图按旧 spec 画的：仍用它（总比没有角标强），后台据此提示重存
            stale: row.specKey !== specKey,
        };
    }
    defaultBadgeSize() {
        if (!this.defaultSize) {
            this.defaultSize = (0, aigc_label_config_1.readPngSize)(Buffer.from(aigc_label_badge_1.AIGC_LABEL_PNG_BASE64, 'base64')) ?? {
                width: 276,
                height: 88,
            };
        }
        return this.defaultSize;
    }
    safeJson(raw) {
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    /** 校验并解码位图。接受带 data: 前缀的字符串，前端两种写法都能用 */
    parseBadge(raw) {
        const base64 = String(raw).replace(/^data:image\/png;base64,/, '').trim();
        if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
            throw new app_exception_1.AppError(40001, '角标位图不是合法的 base64', 400);
        }
        const buf = Buffer.from(base64, 'base64');
        if (buf.length === 0 || buf.length > MAX_BADGE_BYTES) {
            throw new app_exception_1.AppError(40001, `角标位图大小需在 1B ~ ${MAX_BADGE_BYTES / 1024}KB 之间`, 400);
        }
        const size = (0, aigc_label_config_1.readPngSize)(buf);
        if (!size) {
            throw new app_exception_1.AppError(40001, '角标位图必须是 PNG（且能解析出 IHDR）', 400);
        }
        if (size.width < 8 || size.height < 8 || size.width > MAX_BADGE_DIM || size.height > MAX_BADGE_DIM) {
            throw new app_exception_1.AppError(40001, `角标位图尺寸需在 8 ~ ${MAX_BADGE_DIM}px 之间`, 400);
        }
        return buf;
    }
};
exports.AigcLabelService = AigcLabelService;
exports.AigcLabelService = AigcLabelService = AigcLabelService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AigcLabelService);
//# sourceMappingURL=aigc-label.service.js.map