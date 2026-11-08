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
var AdminSettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminSettingsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const settings_service_1 = require("../common/settings.service");
const setting_defs_1 = require("../common/setting-defs");
const image_formats_1 = require("../common/image-formats");
/**
 * 后台系统设置 —— 写路径。
 *
 * 读路径（业务侧读生效值）在 `common/settings.service.ts`；这里是**唯一**
 * 写 SystemSetting 表的地方。
 *
 * 三条设计约束，都来自实际踩过的坑：
 *
 * 1. **kv 提交**。`SETTING_DEFS` 是唯一事实源，写入按它校验白名单与类型，
 *    未知键直接 400。此前用 DTO 逐字段装饰器 + 驼峰↔点号映射表，
 *    「加一项设置要改 4 处」，任一处漏改就静默漂移。
 *
 * 2. **落库走事务**。此前逐条 `await`，第 3 条失败时前 2 条已持久化 ——
 *    页面报错说「保存失败」，配置却已生效，运营无从判断该重试还是回滚。
 *
 * 3. **能改回去**。`clears` 删掉 SystemSetting 行即回落代码默认值 ——
 *    此前只有 create/update，没有 delete，页面却在报告 `overridden`
 *    并渲染「已自定义」徽标：告诉运营这个值被改过，却不给他任何办法改回去。
 */
let AdminSettingsService = AdminSettingsService_1 = class AdminSettingsService {
    constructor(prisma, settings) {
        this.prisma = prisma;
        this.settings = settings;
        this.logger = new common_1.Logger(AdminSettingsService_1.name);
    }
    /** 分组读取全部设置项 + 当前生效值 */
    async readAll() {
        const rows = await this.prisma.systemSetting.findMany();
        const byKey = new Map(rows.map((r) => [r.key, r]));
        const groups = {};
        for (const def of setting_defs_1.SETTING_DEFS) {
            const row = byKey.get(def.key);
            const overridden = row !== undefined;
            const groupKey = def.key.split(".")[0];
            const group = (groups[groupKey] ??= {
                key: groupKey,
                label: setting_defs_1.SETTING_GROUP_LABELS[def.group] ?? def.group,
                items: [],
            });
            group.items.push({
                ...def,
                value: overridden ? this.parseValue(row.value, def) : def.default,
                overridden,
                updatedBy: row?.updatedBy ?? null,
                updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
            });
        }
        return { groups: Object.values(groups) };
    }
    /**
     * 批量写入 / 恢复默认。
     *
     * @param settings 要设置的键值对。键必须是 SETTING_DEFS 里的键
     * @param clears   要恢复默认的键：删除 SystemSetting 行 → 回落代码默认值
     * @param actor    操作人标识（写入 SystemSetting.updatedBy，供审计追溯）
     */
    async updateAll(settings, clears = [], actor) {
        const entries = Object.entries(settings ?? {});
        const clearList = Array.from(new Set(clears ?? []));
        if (entries.length === 0 && clearList.length === 0) {
            throw new app_exception_1.AppError(40001, "没有需要更新的设置项", 400);
        }
        // ── 先全部校验，一个不通过就整批拒绝 ────────────────────────────────
        // 部分成功会让运营误以为整批生效。校验必须覆盖清单项 ——
        // 否则「恢复一个不存在的键」会静默成功。
        const normalized = entries.map(([key, value]) => {
            const def = (0, setting_defs_1.findSettingDef)(key);
            if (!def)
                throw new app_exception_1.AppError(40001, `未知设置项: ${key}`, 400);
            if (def.readOnly)
                throw new app_exception_1.AppError(40001, `${def.label} 为只读项, 不可修改`, 400);
            return { key, def, value: this.validate(def, value) };
        });
        for (const key of clearList) {
            const def = (0, setting_defs_1.findSettingDef)(key);
            if (!def)
                throw new app_exception_1.AppError(40001, `未知设置项: ${key}`, 400);
            if (def.readOnly)
                throw new app_exception_1.AppError(40001, `${def.label} 为只读项, 不可修改`, 400);
        }
        // 同一键既在 settings 又在 clears 里 —— 以 clears 为准（恢复默认），
        // 但这是调用方的 bug，必须让调用方看见而不是静默择一。
        const overlap = normalized
            .filter((n) => clearList.includes(n.key))
            .map((n) => n.key);
        if (overlap.length > 0) {
            throw new app_exception_1.AppError(40001, `同一设置项不能同时设置与恢复默认: ${overlap.join(", ")}`, 400);
        }
        // ── 记录改动前后的值（审计要的就是这个） ──────────────────────────
        const before = await this.prisma.systemSetting.findMany({
            where: { key: { in: [...normalized.map((n) => n.key), ...clearList] } },
        });
        const beforeByKey = new Map(before.map((r) => [r.key, r]));
        // ── 事务落库 ───────────────────────────────────────────────────────
        const actorName = actor ?? "admin";
        const changes = [];
        await this.prisma.$transaction(async (tx) => {
            for (const { key, def, value } of normalized) {
                const prev = beforeByKey.get(key);
                const prevValue = prev ? this.parseValue(prev.value, def) : def.default;
                const data = { value: String(value), updatedBy: actorName };
                if (prev) {
                    await tx.systemSetting.update({ where: { key }, data });
                }
                else {
                    await tx.systemSetting.create({ data: { key, ...data } });
                }
                changes.push({
                    key,
                    label: def.label,
                    before: prevValue,
                    after: value,
                    action: "update",
                });
            }
            for (const key of clearList) {
                const def = (0, setting_defs_1.findSettingDef)(key);
                const prev = beforeByKey.get(key);
                if (!prev) {
                    // 本来就是默认值 —— 无事可做，但要在审计里如实体现
                    changes.push({
                        key,
                        label: def.label,
                        before: def.default,
                        after: def.default,
                        action: "clear",
                    });
                    continue;
                }
                const prevValue = this.parseValue(prev.value, def);
                await tx.systemSetting.delete({ where: { key } });
                changes.push({
                    key,
                    label: def.label,
                    before: prevValue,
                    after: def.default,
                    action: "clear",
                });
            }
        });
        // 写入即失效缓存，让新值立刻生效（不等 3s TTL）
        this.settings.invalidate();
        this.logger.log(`设置变更 by ${actorName}: ${changes
            .map((c) => `${c.key} ${String(c.before)}→${String(c.after)}`)
            .join(", ")}`);
        return {
            updated: normalized.map((n) => n.key),
            cleared: clearList,
            changes,
        };
    }
    /** 读取单个设置的有效值 (供后台内部消费) */
    async get(key) {
        return this.settings.get(key);
    }
    /**
     * 退款规则快照 (时间窗 / 可退比例 / 是否允许已消耗积分退款)。
     *
     * 退款接口在**提交那一刻**读取并冻结规则；这里转调公共 SettingsService，
     * 让调用方继续只依赖后台设置服务，不必同时注入两个服务。
     */
    async refundRules() {
        return this.settings.refundRules();
    }
    /**
     * 按 SettingDef 校验并归一化值。
     *
     * 与读路径共用 `validateSettingValue` —— 读写的合法性判断必须一致。
     */
    validate(def, raw) {
        if (def.key === "upload.allowedTypes") {
            // 允许类型是「后端认识的格式」的子集。写入一个后端不认识的格式
            // (如 gif) 会让页面显示「已允许 GIF」而上传依然被拒 —— 分叉。
            const unknown = (0, image_formats_1.unknownAllowedExts)(String(raw ?? ""));
            if (unknown.length > 0) {
                throw new app_exception_1.AppError(40001, `不支持的文件类型: ${unknown.join(", ")}（仅支持 jpg,jpeg,png,webp）`, 400);
            }
            if (!String(raw ?? "").trim()) {
                throw new app_exception_1.AppError(40001, "至少要允许一种文件类型", 400);
            }
        }
        return (0, setting_defs_1.validateSettingValue)(def, raw);
    }
    /** 解析库里的字符串值为目标类型（坏值回落到代码默认值） */
    parseValue(raw, def) {
        try {
            return (0, setting_defs_1.validateSettingValue)(def, raw);
        }
        catch {
            return def.default;
        }
    }
};
exports.AdminSettingsService = AdminSettingsService;
exports.AdminSettingsService = AdminSettingsService = AdminSettingsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService])
], AdminSettingsService);
//# sourceMappingURL=settings.service.js.map