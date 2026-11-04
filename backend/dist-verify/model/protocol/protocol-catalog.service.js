"use strict";
/**
 * 协议目录 —— 后台「渠道模型」表单的协议来源与保存校验的单一入口。
 *
 * 两个数据源按优先级合并：
 *   1. `ProtocolRegistry`：已注册的运行时适配器（P2 起内置 + 插件编译产物）；
 *   2. `PluginManifestStore`：随代码入库的插件清单（P1 阶段只有它可用）。
 *
 * 为什么保存期必须校验协议能力：DeepSeek / Moonshot 标称「OpenAI 兼容」只指
 * `/v1/chat/completions` 的**文本**兼容，把它们配到生图通道必然 404 —— 这类
 * 错误在保存时就能判定，不该等到用户任务失败退款。
 *
 * 能力匹配看 `capability`，不看协议名：同名协议可能跨模态复用。
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
exports.ProtocolCatalogService = exports.USER_SURFACE = exports.ADMIN_SURFACE = void 0;
const common_1 = require("@nestjs/common");
const json_1 = require("../domain/json");
const plugin_manifest_store_1 = require("../plugins/plugin-manifest.store");
const registry_1 = require("./registry");
/** 后台渠道可挂载的表面（参考实现 `ManifestSurface`） */
exports.ADMIN_SURFACE = 'admin.system-channel';
exports.USER_SURFACE = 'user.custom-channel';
let ProtocolCatalogService = class ProtocolCatalogService {
    constructor(registry, plugins) {
        this.registry = registry;
        this.plugins = plugins;
        this.cache = null;
    }
    /** 插件安装/卸载后调用 */
    invalidate() {
        this.cache = null;
    }
    /** 全部可选协议（可按能力 / 挂载表面过滤） */
    list(capability, surface = exports.ADMIN_SURFACE) {
        const result = [];
        for (const entry of this.entries().values()) {
            if (!entry.selectable)
                continue;
            if (capability && !entry.capabilities.includes(capability))
                continue;
            if (surface && entry.surfaces.length > 0 && !entry.surfaces.includes(surface))
                continue;
            result.push(entry);
        }
        return result.sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'));
    }
    get(id) {
        return this.entries().get(String(id ?? '').trim()) ?? null;
    }
    /**
     * 保存渠道模型时的协议校验：必须存在、必须是生成类、能力必须匹配。
     * 返回协议元数据（含是否需要 Secret Key），由调用方做凭证校验。
     */
    require(id, capability) {
        const entry = this.get(id);
        if (!entry)
            throw new json_1.ModelDomainError(`未知的模型请求协议：${id}`);
        if (entry.kind === 'processing') {
            throw new json_1.ModelDomainError('处理类协议不能作为生成渠道模型');
        }
        if (capability && !entry.capabilities.includes(capability)) {
            throw new json_1.ModelDomainError(`协议 ${entry.label} 不支持 ${capability} 能力`);
        }
        return entry;
    }
    entries() {
        if (this.cache)
            return this.cache;
        const result = new Map();
        // 1. 插件清单（基础层；同名 protocol 合并能力，先到先得）
        for (const item of this.plugins.providers()) {
            const provider = item.provider;
            const id = String(provider.id ?? '').trim();
            if (!id)
                continue;
            const existing = result.get(id);
            if (existing) {
                for (const capability of provider.capabilities ?? []) {
                    if (!existing.capabilities.includes(capability))
                        existing.capabilities.push(capability);
                }
                continue;
            }
            result.set(id, {
                id,
                label: String(provider.label ?? id),
                capabilities: [...(provider.capabilities ?? [])],
                kind: String(provider.kind ?? 'generation'),
                async: Boolean(provider.poll),
                requiresSecretKey: Boolean(String(provider.auth?.secretField ?? '').trim()),
                source: 'manifest',
                pluginId: item.pluginId,
                selectable: true,
                surfaces: [...(provider.scopes ?? [])],
                imageParameters: [...(provider.imageParameters ?? [])],
            });
        }
        // 2. 已注册的运行时适配器覆盖同名清单项
        for (const metadata of this.registry.list()) {
            const existing = result.get(metadata.id);
            result.set(metadata.id, {
                id: metadata.id,
                label: metadata.label,
                capabilities: metadata.capabilities,
                kind: metadata.kind,
                async: metadata.async,
                requiresSecretKey: existing?.requiresSecretKey ?? false,
                source: 'registry',
                pluginId: metadata.pluginId ?? (metadata.source === 'builtin' ? 'builtin' : ''),
                selectable: true,
                surfaces: existing?.surfaces ?? [],
                imageParameters: metadata.imageParameters ?? existing?.imageParameters ?? [],
            });
        }
        this.cache = result;
        return result;
    }
};
exports.ProtocolCatalogService = ProtocolCatalogService;
exports.ProtocolCatalogService = ProtocolCatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [registry_1.ProtocolRegistry,
        plugin_manifest_store_1.PluginManifestStore])
], ProtocolCatalogService);
//# sourceMappingURL=protocol-catalog.service.js.map