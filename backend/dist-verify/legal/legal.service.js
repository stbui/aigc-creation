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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegalService = exports.LEGAL_SLUG_LABELS = exports.LEGAL_STATUSES = exports.LEGAL_SLUGS = void 0;
exports.isLegalSlug = isLegalSlug;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("../common/app.exception");
const prisma_service_1 = require("../prisma/prisma.service");
/**
 * 法务文档。
 *
 * 四类固定 slug —— 与前端 `LegalPage` 的深链接、注册页的协议链接一致。
 * 新增一类要走一次全站文案核对（页脚 + 注册 + 下单都要挂），
 * 所以这里用白名单硬约束，而不是"后端接受任意 slug、前端自己碰运气"。
 *
 * `account-rules`（账号规则）2026-10-22 补齐：注册页与站点地图一直在链
 * `/legal/account-rules.html`，而白名单里没有它 —— 点进去只能落前端内置兜底文本，
 * 后台既看不到也改不了。链接指向的文本必须能在后台维护，否则只是"看起来有"。
 */
exports.LEGAL_SLUGS = ['user-agreement', 'privacy-policy', 'minors-policy', 'account-rules'];
exports.LEGAL_STATUSES = ['draft', 'published', 'archived'];
exports.LEGAL_SLUG_LABELS = {
    'user-agreement': '用户协议',
    'privacy-policy': '隐私政策',
    'minors-policy': '未成年人保护',
    'account-rules': '账号规则',
};
function isLegalSlug(v) {
    return exports.LEGAL_SLUGS.includes(v);
}
let LegalService = class LegalService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /**
     * 取某 slug 的**最新已发布**版本。
     *
     * 「最新」按 publishedAt 而不是 version 字符串排序：version 可能是
     * `v2` / `2026-10-21` 混用，字典序会给出错误答案。publishedAt 为空
     * （历史数据）时退回 createdAt。
     *
     * 一条都没发布时返回 null 而不是抛错 —— 调用方（前端 LegalPage）
     * 有内置兜底文本，抛错会导致页面直接白屏。
     */
    async current(slug) {
        if (!isLegalSlug(slug)) {
            throw new app_exception_1.AppError(40004, `未知的法务文档: ${slug}`, 404);
        }
        const doc = await this.prisma.legalDocument.findFirst({
            where: { slug, status: 'published' },
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        });
        if (!doc)
            return null;
        return {
            slug: doc.slug,
            version: doc.version,
            title: doc.title,
            content: doc.content,
            publishedAt: doc.publishedAt ?? doc.createdAt,
        };
    }
    /** 四类文档的当前版本概览（前端页脚 / 注册页取版本号用） */
    async index() {
        /*
         * 一次查询取齐四类 slug 的已发布版本，再按 LEGAL_SLUGS 顺序回填。
         * 旧实现是 for 循环里逐个 findFirst（4 次往返），页脚每次渲染都打一遍；
         * 结果集很小，合并成一条 IN 查询既保持「每类只取最新」的语义，也少 3 次 DB 往返。
         */
        const docs = await this.prisma.legalDocument.findMany({
            where: { slug: { in: [...exports.LEGAL_SLUGS] }, status: 'published' },
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
            select: { slug: true, version: true, title: true, publishedAt: true, createdAt: true },
        });
        const latest = new Map();
        for (const doc of docs) {
            if (!latest.has(doc.slug))
                latest.set(doc.slug, doc);
        }
        return exports.LEGAL_SLUGS.map((slug) => {
            const doc = latest.get(slug);
            return {
                slug,
                label: exports.LEGAL_SLUG_LABELS[slug],
                version: doc?.version ?? null,
                title: doc?.title ?? exports.LEGAL_SLUG_LABELS[slug],
                publishedAt: doc?.publishedAt ?? null,
            };
        });
    }
    /** 后台：某 slug 的全部版本（含草稿与历史） */
    async versions(slug) {
        if (slug && !isLegalSlug(slug)) {
            throw new app_exception_1.AppError(40004, `未知的法务文档: ${slug}`, 400);
        }
        return this.prisma.legalDocument.findMany({
            where: slug ? { slug } : {},
            orderBy: [{ slug: 'asc' }, { createdAt: 'desc' }],
        });
    }
    /**
     * 后台：新建或按 (slug, version) 覆盖草稿。
     *
     * 已发布的版本**不允许原地改正文**：用户同意过的那一版必须保持可举证。
     * 要改就升 version 新建一行，再把旧的置 archived。
     */
    async upsert(input, operatorId) {
        if (!isLegalSlug(input.slug)) {
            throw new app_exception_1.AppError(40004, `未知的法务文档: ${input.slug}`, 400);
        }
        const status = input.status ?? 'draft';
        if (!exports.LEGAL_STATUSES.includes(status)) {
            throw new app_exception_1.AppError(40001, `未知状态: ${status}`, 400);
        }
        const existing = await this.prisma.legalDocument.findUnique({
            where: { slug_version: { slug: input.slug, version: input.version } },
        });
        if (existing?.status === 'published' && status !== 'archived') {
            throw new app_exception_1.AppError(40901, `版本 ${input.version} 已发布，不可覆盖。请提升版本号新建一版`, 409);
        }
        const data = {
            title: input.title,
            content: input.content,
            status,
            publishedAt: status === 'published' ? new Date() : existing?.publishedAt ?? null,
            publishedBy: status === 'published' ? operatorId : existing?.publishedBy ?? null,
        };
        return existing
            ? this.prisma.legalDocument.update({ where: { id: existing.id }, data })
            : this.prisma.legalDocument.create({
                data: { slug: input.slug, version: input.version, ...data },
            });
    }
    /**
     * 发布某个 (slug, version)。
     *
     * 同 slug 的其他已发布版本自动置 archived —— 保证「当前生效版本」唯一，
     * 否则 `current()` 会变成按时间碰运气。
     */
    async publish(slug, version) {
        if (!isLegalSlug(slug)) {
            throw new app_exception_1.AppError(40004, `未知的法务文档: ${slug}`, 400);
        }
        const doc = await this.prisma.legalDocument.findUnique({
            where: { slug_version: { slug, version } },
        });
        if (!doc)
            throw new app_exception_1.AppError(40004, '版本不存在', 404);
        await this.prisma.$transaction([
            this.prisma.legalDocument.updateMany({
                where: { slug, status: 'published', NOT: { id: doc.id } },
                data: { status: 'archived' },
            }),
            this.prisma.legalDocument.update({
                where: { id: doc.id },
                data: { status: 'published', publishedAt: new Date() },
            }),
        ]);
        return this.prisma.legalDocument.findUnique({ where: { id: doc.id } });
    }
};
exports.LegalService = LegalService;
exports.LegalService = LegalService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LegalService);
//# sourceMappingURL=legal.service.js.map