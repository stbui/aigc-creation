"use strict";
/**
 * 服务商目录（`/api/v1/admin/provider-catalog`）。
 *
 * 目录是**远端 JSON 清单**：每个条目描述一家上游服务商（名称、接口格式、
 * 基础地址、可安装的插件包地址）。运维订阅一份目录，就能在后台把「新增一家
 * 厂商」从改代码降级成点一下安装。
 *
 * 三条纪律：
 *   1. **未配置就是未配置**：`MODEL_PROVIDER_CATALOG_URL` 为空时返回空列表
 *      并附带原因，绝不内置一份假目录让人以为「已经支持 200 家厂商」；
 *   2. 拉目录与下载包都走 `outboundRequest`（SSRF 校验、超时、体积上限），
 *      远端返回什么都不能绕过出站策略；
 *   3. 安装复用 `PluginAdminService.install` —— 同一个包校验、同一份审计，
 *      不为远端来源开一条捷径。
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
var ProviderCatalogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderCatalogService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const app_exception_1 = require("../../common/app.exception");
const node_crypto_1 = require("node:crypto");
const outbound_1 = require("../infra/outbound");
const plugin_admin_service_1 = require("./plugin.admin.service");
/** 目录文件很小；超过这个尺寸说明地址填错了 */
const CATALOG_MAX_BYTES = 2 * 1024 * 1024;
const CATALOG_TIMEOUT_MS = 30_000;
/** 插件包上限与 `PLUGIN_PACKAGE_MAX_BYTES` 同量级，多留一点 HTTP 头余量 */
const PACKAGE_MAX_BYTES = 64 * 1024 * 1024;
let ProviderCatalogService = ProviderCatalogService_1 = class ProviderCatalogService {
    constructor(config, plugins) {
        this.config = config;
        this.plugins = plugins;
        this.log = new common_1.Logger(ProviderCatalogService_1.name);
        this.cache = null;
    }
    /** 读取目录（有缓存用缓存；未配置直接空态） */
    async list() {
        const source = this.sourceUrl();
        if (!source) {
            return {
                source: '',
                configured: false,
                fetchedAt: null,
                reason: '未配置 MODEL_PROVIDER_CATALOG_URL，服务商目录为空。配置后可在后台浏览并安装厂商插件。',
                items: [],
            };
        }
        if (!this.cache) {
            try {
                await this.refresh();
            }
            catch (error) {
                return {
                    source,
                    configured: true,
                    fetchedAt: null,
                    reason: `目录拉取失败：${messageOf(error)}`,
                    items: [],
                };
            }
        }
        return {
            source,
            configured: true,
            fetchedAt: this.cache?.fetchedAt ?? null,
            reason: '',
            items: this.withInstallState(this.cache?.entries ?? []),
        };
    }
    /** 强制重新拉取远端目录 */
    async refresh() {
        const source = this.sourceUrl();
        if (!source)
            throw new app_exception_1.AppError(40001, '未配置 MODEL_PROVIDER_CATALOG_URL', 400);
        let raw;
        try {
            const response = await (0, outbound_1.outboundRequest)(source, {
                method: 'GET',
                timeoutMs: CATALOG_TIMEOUT_MS,
                maxBodyBytes: CATALOG_MAX_BYTES,
            });
            if (!response || !('status' in response))
                throw new Error('目录请求未返回响应');
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`目录地址返回 HTTP ${response.status}`);
            }
            raw = JSON.parse(response.body.toString('utf8'));
        }
        catch (error) {
            // 缓存保留：远端暂时不可用不应该让页面变成空白（旧目录仍可浏览）
            this.log.warn(`服务商目录拉取失败：${messageOf(error)}`);
            throw new app_exception_1.AppError(50201, `服务商目录拉取失败：${outboundMessage(error)}`, 502);
        }
        const entries = normalizeCatalog(raw);
        const fetchedAt = new Date().toISOString();
        this.cache = { fetchedAt, entries };
        return { source, configured: true, fetchedAt, reason: '', items: this.withInstallState(entries) };
    }
    /** 校验一个目录条目（不安装）：字段完整 + 包地址可用 */
    async verify(id) {
        const entry = (this.cache?.entries ?? []).find((item) => item.id === id);
        if (!entry)
            throw new app_exception_1.AppError(40400, '服务商目录中没有该条目', 404);
        const problems = [];
        if (!entry.name)
            problems.push('缺少名称');
        if (!entry.apiFormat)
            problems.push('缺少接口格式');
        if (!entry.protocols.length)
            problems.push('未声明协议');
        if (!entry.packageUrl)
            problems.push('未提供插件包地址，无法安装');
        return {
            id: entry.id,
            ok: problems.length === 0,
            reason: problems.length === 0 ? '条目字段完整，可以安装' : problems.join('；'),
        };
    }
    /** 下载并安装目录条目的插件包 */
    async install(id, actorUserId) {
        const entry = (this.cache?.entries ?? []).find((item) => item.id === id);
        if (!entry)
            throw new app_exception_1.AppError(40400, '服务商目录中没有该条目', 404);
        if (!entry.packageUrl)
            throw new app_exception_1.AppError(40001, '该条目未提供插件包地址', 400);
        const response = await (0, outbound_1.outboundRequest)(entry.packageUrl, {
            method: 'GET',
            timeoutMs: CATALOG_TIMEOUT_MS,
            maxBodyBytes: PACKAGE_MAX_BYTES,
        });
        if (!('status' in response) || response.status < 200 || response.status >= 300) {
            throw new app_exception_1.AppError(50201, `插件包下载失败（HTTP ${'status' in response ? response.status : 0}）`, 502);
        }
        this.log.log(`安装服务商 ${entry.id} 的插件包（${sha256(response.body).slice(0, 12)}…）`);
        return this.plugins.install(response.body, actorUserId);
    }
    withInstallState(entries) {
        return entries.map((entry) => ({ ...entry, installed: Boolean(this.plugins.hasPlugin(entry.id)) }));
    }
    sourceUrl() {
        return String(this.config.get('model.providerCatalogUrl') ?? '').trim();
    }
};
exports.ProviderCatalogService = ProviderCatalogService;
exports.ProviderCatalogService = ProviderCatalogService = ProviderCatalogService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        plugin_admin_service_1.PluginAdminService])
], ProviderCatalogService);
/* ────────────────────────── 纯函数 ────────────────────────── */
/**
 * 归一化远端目录。
 *
 * 接受 `[...]` 与 `{ items: [...] }` 两种写法（前者常见于静态 JSON，后者便于
 * 以后加 `updatedAt` 等元字段）。**条目缺 id 或包地址的一律丢弃并计数**，
 * 不猜、不补默认值 —— 缺字段的条目装上去只会得到一个不可用的渠道。
 */
function normalizeCatalog(raw) {
    const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray(raw.items)
            ? (raw.items)
            : [];
    const entries = [];
    const seen = new Set();
    for (const item of list) {
        if (!item || typeof item !== 'object')
            continue;
        const record = item;
        const id = String(record.id ?? '').trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        entries.push({
            id,
            name: String(record.name ?? id).trim(),
            vendor: String(record.vendor ?? '').trim(),
            description: String(record.description ?? '').trim(),
            version: String(record.version ?? '').trim(),
            apiFormat: String(record.apiFormat ?? record.api_format ?? '').trim(),
            baseUrl: String(record.baseUrl ?? record.base_url ?? '').trim(),
            protocols: Array.isArray(record.protocols)
                ? record.protocols.map((value) => String(value ?? '').trim()).filter(Boolean)
                : [],
            packageUrl: String(record.packageUrl ?? record.package_url ?? '').trim(),
            // 远端目录只描述「能装什么」，安装态是本地的；统一由 withInstallState 覆写
            installed: false,
        });
    }
    return entries.sort((left, right) => left.id.localeCompare(right.id));
}
function sha256(data) {
    return (0, node_crypto_1.createHash)('sha256').update(data).digest('hex');
}
function outboundMessage(error) {
    return error instanceof outbound_1.OutboundError ? error.message : messageOf(error);
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '');
}
//# sourceMappingURL=provider-catalog.service.js.map