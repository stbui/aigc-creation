"use strict";
/**
 * 后台插件管理：清单展示、系统级启停、协议校验。
 *
 * 移植自 open-ai-canvas `internal/app/plugins.go` 的管理端部分（安装 / 卸载在 P6）。
 *
 * 三条约束：
 * 1. **启停写库并立即重注册**：`PluginPlatformState` 是唯一开关，内存不存第二份；
 *    `PluginProtocolService.registerAll()` 每次都从库里读停用集合，重启后同样生效。
 * 2. **停用不改清单**：插件仍出现在列表里（能看到它贡献了什么），只是协议不注册、
 *    依赖它的渠道模型路由不可用。删包是另一回事，不能在「停用」里悄悄做。
 * 3. **校验只验证声明**：构造适配器并检查 provider 契约，不发送任何上游请求 ——
 *    校验一个插件不应该消耗运营账号的额度，也不应该把凭证发出去。
 */
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
exports.PluginAdminService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const app_exception_1 = require("../../common/app.exception");
const prisma_service_1 = require("../../prisma/prisma.service");
const catalog_version_service_1 = require("../infra/catalog-version.service");
const json_1 = require("../domain/json");
const manifest_adapter_1 = require("../protocol/manifest-adapter");
const package_1 = require("../protocol/package");
const plugin_protocols_service_1 = require("../protocol/plugin-protocols.service");
const registry_1 = require("../protocol/registry");
const plugin_manifest_store_1 = require("./plugin-manifest.store");
let PluginAdminService = class PluginAdminService {
    constructor(prisma, manifests, protocols, registry, catalogVersion) {
        this.prisma = prisma;
        this.manifests = manifests;
        this.protocols = protocols;
        this.registry = registry;
        this.catalogVersion = catalogVersion;
    }
    async list() {
        const states = await this.prisma.pluginPlatformState.findMany();
        const stateById = new Map(states.map((state) => [state.pluginId, state]));
        const items = this.manifests.list().map((plugin) => this.toView(plugin, stateById.get(plugin.manifest.metadata.id)));
        return {
            items,
            summary: {
                total: items.length,
                enabled: items.filter((item) => item.enabled).length,
                disabled: items.filter((item) => !item.enabled).length,
                providers: items.reduce((sum, item) => sum + item.providers.length, 0),
                capabilityStats: this.manifests.capabilityStats(),
                backendStats: this.manifests.backendStats(),
                protocol: this.protocols.status(),
            },
        };
    }
    /** 是否已安装该插件（服务商目录据此标记「已安装」） */
    hasPlugin(id) {
        return Boolean(this.manifests.get(id));
    }
    async get(id) {
        const plugin = this.manifests.get(id);
        if (!plugin)
            throw notFound();
        const state = await this.prisma.pluginPlatformState.findUnique({
            where: { pluginId: plugin.manifest.metadata.id },
        });
        return this.toView(plugin, state ?? undefined);
    }
    /** 系统级启停：写库 → 重注册协议 → 失效目录（协议集合变了，路由快照必须重载） */
    async setEnabled(id, enabled, actorUserId) {
        const plugin = this.manifests.get(id);
        if (!plugin)
            throw notFound();
        await this.prisma.pluginPlatformState.upsert({
            where: { pluginId: plugin.manifest.metadata.id },
            create: {
                pluginId: plugin.manifest.metadata.id,
                source: plugin.origin,
                enabled,
                updatedBy: actorUserId,
            },
            update: { enabled, updatedBy: actorUserId },
        });
        await this.protocols.registerAll();
        this.catalogVersion.invalidate();
        return this.get(plugin.manifest.metadata.id);
    }
    /**
     * 安装上传的插件包（zip，`yingce.plugin/package-v1`）。
     *
     * 顺序：解析校验 → 拒 `host:` 后端 → 拒同名 → 写临时目录 → 原子改名 → 重扫描 → 重注册。
     * 先把内容写进 `.tmp-*` 再 `rename`，是为了让「装到一半失败」不留半个包：
     * 半包会被扫描器当成有效插件（manifest 已写），卸载时又删不干净。
     *
     * 已存在的插件**不允许覆盖**：覆盖式安装会让「谁把这份包换掉了」无从追溯，
     * 正确做法是先卸载再安装（两次操作各自留审计）。
     */
    async install(zip, actorUserId) {
        if (!zip || zip.length === 0)
            throw new app_exception_1.AppError(40001, '请上传插件包文件（字段名 file）', 400);
        let pkg;
        try {
            pkg = (0, package_1.parsePluginPackage)(zip);
        }
        catch (error) {
            throw new app_exception_1.AppError(40001, `插件包无效：${messageOf(error)}`, 400);
        }
        const id = pkg.manifest.metadata.id;
        const backend = String(pkg.manifest.runtime?.backend ?? 'declarative').trim().toLowerCase();
        // 宿主无法执行任意进程：只接受声明式与随宿主提供的后端
        if (backend.startsWith('host:')) {
            throw new app_exception_1.AppError(40001, `当前环境不支持 ${backend} 后端的插件`, 400);
        }
        if (this.manifests.get(id)) {
            throw new app_exception_1.AppError(40909, `插件 ${id} 已存在，不允许覆盖安装（先卸载再安装）`, 409);
        }
        const root = this.manifests.installDirectory();
        (0, node_fs_1.mkdirSync)(root, { recursive: true });
        const temp = (0, node_path_1.join)(root, `.tmp-${id}-${(0, node_crypto_1.randomBytes)(6).toString('hex')}`);
        const target = (0, node_path_1.join)(root, id);
        try {
            for (const [name, content] of pkg.files) {
                if (content === null)
                    continue;
                // 包解析阶段已校验过，这里再做一次防御：路径归一后必须仍在临时目录内
                const safe = (0, package_1.validatePluginPackagePath)(name);
                const destination = (0, node_path_1.join)(temp, safe);
                if (!destination.startsWith(`${temp}${node_path_1.sep}`)) {
                    throw new app_exception_1.AppError(40001, `插件包路径非法：${name}`, 400);
                }
                (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(destination), { recursive: true });
                (0, node_fs_1.writeFileSync)(destination, content);
            }
            (0, node_fs_1.renameSync)(temp, target);
        }
        catch (error) {
            (0, node_fs_1.rmSync)(temp, { recursive: true, force: true });
            if (error instanceof app_exception_1.AppError)
                throw error;
            throw new app_exception_1.AppError(50001, `插件安装失败：${messageOf(error)}`, 500);
        }
        this.manifests.scan();
        await this.protocols.registerAll();
        this.catalogVersion.invalidate();
        return this.get(id);
    }
    /**
     * 卸载上传安装的插件。
     *
     * 内置插件不可卸载（它随代码存在，删了下次发布又会回来）。
     * 仍有渠道模型引用它贡献的协议时拒绝 —— 静默让这些模型的线路失效，
     * 表现为「部分任务突然选不到模型」，比直接报错难查得多。
     */
    async uninstall(id, actorUserId) {
        const plugin = this.manifests.get(id);
        if (!plugin)
            throw notFound();
        if (plugin.origin !== 'installed') {
            throw new app_exception_1.AppError(40001, '内置插件不可卸载（随代码发布，卸载后下次发布仍会恢复）', 400);
        }
        const protocols = (plugin.manifest.contributes?.providers ?? [])
            .map((provider) => String(provider.id ?? '').trim())
            .filter(Boolean);
        if (protocols.length > 0) {
            const used = await this.prisma.channelModel.count({
                where: { protocol: { in: protocols }, deletedAt: null },
            });
            if (used > 0) {
                throw new app_exception_1.AppError(40909, `仍有 ${used} 个渠道模型引用该插件的协议，请先改配或删除它们`, 409);
            }
        }
        (0, node_fs_1.rmSync)(plugin.directory, { recursive: true, force: true });
        await this.prisma.pluginPlatformState.deleteMany({ where: { pluginId: id } });
        this.manifests.scan();
        await this.protocols.registerAll();
        this.catalogVersion.invalidate();
        return { id, removed: true };
    }
    /**
     * 校验：逐个 provider 构造适配器并检查契约，结果落库供页面展示。
     * 构造失败不影响其它 provider —— 一个插件里有多个 provider 时，要能指出坏在哪一个。
     */
    async verify(id, actorUserId) {
        const plugin = this.manifests.get(id);
        if (!plugin)
            throw notFound();
        const result = verifyManifest(plugin);
        await this.prisma.pluginPlatformState.upsert({
            where: { pluginId: plugin.manifest.metadata.id },
            create: {
                pluginId: plugin.manifest.metadata.id,
                source: plugin.origin,
                enabled: true,
                verifyJson: JSON.stringify(result),
                updatedBy: actorUserId,
            },
            update: { verifyJson: JSON.stringify(result), updatedBy: actorUserId },
        });
        return result;
    }
    toView(plugin, state) {
        const manifest = plugin.manifest;
        const providers = manifest.contributes?.providers ?? [];
        const contributes = manifest.contributes ?? {};
        const providerViews = providers.map((provider) => ({
            id: provider.id,
            label: provider.label,
            kind: provider.kind ?? 'generation',
            capabilities: provider.capabilities ?? [],
            scopes: provider.scopes ?? [],
            registered: this.registry.has(provider.id),
        }));
        return {
            id: manifest.metadata.id,
            name: manifest.metadata.name,
            version: manifest.metadata.version,
            vendor: manifest.metadata.vendor,
            description: manifest.metadata.description,
            documentation: manifest.metadata.documentation,
            apiVersion: manifest.apiVersion,
            source: state?.source ?? plugin.origin,
            origin: plugin.origin,
            removable: plugin.origin === 'installed',
            installable: manifest.metadata.installable,
            enabled: state ? state.enabled : true,
            activeProtocols: providerViews.filter((provider) => provider.registered).length,
            runtime: {
                backend: String(manifest.runtime?.backend ?? 'declarative').trim() || 'declarative',
                web: String(manifest.runtime?.web ?? '').trim(),
            },
            availability: pluginAvailability(plugin, state?.enabled ?? true),
            surfaces: manifest.surfaces ?? [],
            permissions: manifest.permissions ?? [],
            configuration: manifest.configuration?.fields ?? [],
            providers: providerViews,
            contributions: {
                providers: providers.length,
                smsProviders: contributes.smsProviders?.length ?? 0,
                paymentProviders: contributes.paymentProviders?.length ?? 0,
                workflows: contributes.workflows?.length ?? 0,
                canvasNodes: contributes.canvasNodes?.length ?? 0,
                transforms: contributes.transforms?.length ?? 0,
                commands: contributes.commands?.length ?? 0,
                assetSources: contributes.assetSources?.length ?? 0,
                usageObservers: contributes.usageObservers?.length ?? 0,
                aiCapabilities: contributes.aiCapabilities?.length ?? 0,
                agents: contributes.agents?.length ?? 0,
                importExport: contributes.importExport?.length ?? 0,
            },
            verify: decodeVerify(state?.verifyJson),
            updatedAt: state ? state.updatedAt.toISOString() : null,
            updatedBy: state?.updatedBy ?? '',
        };
    }
};
exports.PluginAdminService = PluginAdminService;
exports.PluginAdminService = PluginAdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plugin_manifest_store_1.PluginManifestStore,
        plugin_protocols_service_1.PluginProtocolService,
        registry_1.ProtocolRegistry,
        catalog_version_service_1.CatalogVersionService])
], PluginAdminService);
/* ────────────────────────── 纯函数 ────────────────────────── */
/**
 * 判定插件在**当前环境**是否可用，并给出人话原因。
 *
 * 设计文档 §7.3：「宿主无法用 TS 复刻的插件在后台标『当前环境不可用』并
 * 展示原因，不允许静默消失」。
 *
 * 本仓的判定分三类：
 *
 *  1. **停用**：管理员关掉了系统级开关 —— 这是**主动**停用，不是环境问题，
 *     原因说「已被管理员停用」；
 *  2. **`host:<engine>` 后端**：清单要求宿主原生执行引擎，本仓没有内置，
 *     所以这个 provider 不会注册（见 `PluginProtocolService.registerAll`）；
 *  3. **`rpc` / `wasm` 后端且没有 provider 贡献**：这类插件贡献的是支付 /
 *     短信等**非模型能力**。本仓的支付与短信通道是独立实现的
 *     （`src/payments/**` 的 sandbox / 支付宝 / 微信，`src/channels/**` 的
 *     sms / email），不读插件清单 —— 所以这些插件在当前环境**不会生效**。
 *
 * 关键点：第 3 类不是「插件坏了」，而是「宿主用另一套实现覆盖了它」。
 * 必须说清楚，否则运营会以为装了这个插件就能用对应的支付方式。
 */
function pluginAvailability(plugin, enabled) {
    if (!enabled) {
        return { available: false, reason: '已被管理员停用（系统级开关关闭）' };
    }
    const backend = String(plugin.manifest.runtime?.backend ?? 'declarative').trim() || 'declarative';
    const contributes = plugin.manifest.contributes ?? {};
    const providerCount = (contributes.providers ?? []).length;
    if (backend.startsWith('host:')) {
        return {
            available: false,
            reason: `该插件声明了 \`${backend}\` 宿主执行引擎，本环境未内置该引擎，协议不会注册`,
        };
    }
    if (providerCount === 0) {
        // 没有 provider 贡献 = 它只贡献非模型能力。本仓的支付 / 短信是独立实现，
        // 不读插件清单，因此这些插件在当前环境不生效。
        const surfaces = [];
        if ((contributes.paymentProviders ?? []).length > 0)
            surfaces.push('支付');
        if ((contributes.smsProviders ?? []).length > 0)
            surfaces.push('短信');
        const what = surfaces.length > 0 ? surfaces.join(' / ') : '非模型能力';
        return {
            available: false,
            reason: `该插件只贡献${what}，且后端为 \`${backend}\`；` +
                '本环境的支付与短信通道是独立实现的，不读取插件清单，因此这份贡献不会生效',
        };
    }
    return { available: true, reason: '' };
}
function notFound() {
    return new app_exception_1.AppError(40400, '插件不存在', 404);
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '');
}
function verifyManifest(plugin) {
    const providers = plugin.manifest.contributes?.providers ?? [];
    const checked = [];
    for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index];
        try {
            (0, manifest_adapter_1.createManifestAdapter)(plugin.manifest, index);
            checked.push({ id: provider.id, ok: true, reason: '' });
        }
        catch (error) {
            checked.push({ id: provider.id, ok: false, reason: error.message });
        }
    }
    const failed = checked.filter((item) => !item.ok);
    return {
        ok: failed.length === 0,
        checkedAt: new Date().toISOString(),
        reason: checked.length === 0
            ? '插件未贡献任何 provider（仅声明支付 / 短信 / 工作流等非模型能力）'
            : failed.length === 0
                ? '全部 provider 契约有效'
                : `${failed.length} 个 provider 契约无效`,
        providers: checked,
    };
}
function decodeVerify(raw) {
    if (!raw)
        return null;
    const parsed = (0, json_1.decodeJsonLoose)(raw, null);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.ok !== 'boolean')
        return null;
    return parsed;
}
//# sourceMappingURL=plugin.admin.service.js.map