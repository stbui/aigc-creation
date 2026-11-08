"use strict";
/**
 * 内置插件清单库 —— 启动期扫描 `MODEL_PLUGIN_DIR/<id>/manifest.json`。
 *
 * 这批包随代码入库（110 个），是渠道模型可选的协议来源。这里只做三件事：
 * 读取、校验、索引；**不执行**包内任何代码，也不解压运行时产物。
 *
 * 失败策略：随代码发布的包解析失败属于发布阻断，直接启动失败并指名文件。
 * 用户上传的插件走另一条链路（安装时校验、失败只回滚那一个包），不要混用。
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
var PluginManifestStore_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManifestStore = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const manifest_1 = require("../protocol/manifest");
let PluginManifestStore = PluginManifestStore_1 = class PluginManifestStore {
    constructor(config) {
        this.config = config;
        this.log = new common_1.Logger(PluginManifestStore_1.name);
        this.plugins = new Map();
    }
    onModuleInit() {
        this.scan();
    }
    /** 重新扫描目录（后台安装/卸载插件后调用） */
    scan() {
        const loaded = new Map();
        const builtinDir = this.builtinDirectory();
        if ((0, node_fs_1.existsSync)(builtinDir)) {
            this.loadDirectory(loaded, builtinDir, 'builtin');
        }
        else {
            // 内置目录缺失只告警：用户可能只部署了上传的插件，不带源码目录
            this.log.warn(`插件目录不存在，跳过加载：${builtinDir}`);
        }
        const installDir = this.installDirectory();
        if ((0, node_fs_1.existsSync)(installDir))
            this.loadDirectory(loaded, installDir, 'installed');
        this.plugins.clear();
        for (const [id, plugin] of loaded)
            this.plugins.set(id, plugin);
        const installed = this.list().filter((plugin) => plugin.origin === 'installed').length;
        this.log.log(`已加载插件 ${this.plugins.size} 个（内置 ${this.plugins.size - installed} / 上传 ${installed}）`);
    }
    /** 内置插件目录（随代码入库，只读） */
    builtinDirectory() {
        return (0, node_path_1.resolve)(this.config.get('model.pluginDir') ?? 'plugins');
    }
    /** 后台上传插件的安装目录 */
    installDirectory() {
        return (0, node_path_1.resolve)(this.config.get('model.pluginInstallDir') ?? 'plugins-installed');
    }
    /**
     * 扫描单个目录。
     *
     * 两个目录的失败策略**不同**，这是有意的：
     *   · 内置包解析失败 = 发布阻断，直接抛错（带病启动会让渠道模型莫名其妙不可用）；
     *   · 上传包解析失败 = 用户数据损坏，记警告并跳过（一个坏包不能让整站起不来）。
     */
    loadDirectory(target, directory, origin) {
        for (const entry of (0, node_fs_1.readdirSync)(directory).sort()) {
            // 点开头的是安装过程中的临时目录与系统垃圾文件，不是插件
            if (entry.startsWith('.'))
                continue;
            const pluginDir = (0, node_path_1.join)(directory, entry);
            if (!(0, node_fs_1.statSync)(pluginDir).isDirectory())
                continue;
            const manifestPath = (0, node_path_1.join)(pluginDir, 'manifest.json');
            if (!(0, node_fs_1.existsSync)(manifestPath))
                continue;
            let manifest;
            try {
                manifest = (0, manifest_1.decodeManifest)((0, node_fs_1.readFileSync)(manifestPath));
            }
            catch (error) {
                if (origin === 'builtin') {
                    throw new Error(`内置插件清单无效（${manifestPath}）：${error.message}`);
                }
                this.log.warn(`上传插件清单无效，已跳过（${manifestPath}）：${error.message}`);
                continue;
            }
            /*
             * 上游在 plugin-packages 下为少数插件同时保留了「源目录」`src-<id>` 与
             * 「打包目录」`<id>`，两边的 manifest 内容一致、id 相同。上游按 zip 安装，
             * 从不按目录扫描，所以不会撞车；本仓按目录扫描，必须显式跳过源目录镜像，
             * 否则启动期会因「id 重复」直接失败。
             */
            if (origin === 'builtin' && entry.startsWith('src-') && manifest.metadata.id !== entry)
                continue;
            if (target.has(manifest.metadata.id)) {
                if (origin === 'builtin') {
                    throw new Error(`内置插件 id 重复：${manifest.metadata.id}（${manifestPath}）`);
                }
                // 上传包与内置 id 相撞：安装时已拦，这里只可能是手工拷贝，内置优先
                this.log.warn(`上传插件与已有插件 id 重复，已忽略：${manifest.metadata.id}（${manifestPath}）`);
                continue;
            }
            target.set(manifest.metadata.id, { manifest, directory: pluginDir, manifestPath, origin });
        }
    }
    get(pluginId) {
        return this.plugins.get(String(pluginId ?? '').trim()) ?? null;
    }
    list() {
        return [...this.plugins.values()].sort((left, right) => left.manifest.metadata.id.localeCompare(right.manifest.metadata.id));
    }
    /** 全部 provider 贡献（协议注册的输入） */
    providers() {
        const result = [];
        for (const plugin of this.list()) {
            const providers = plugin.manifest.contributes?.providers ?? [];
            providers.forEach((provider, index) => {
                result.push({ pluginId: plugin.manifest.metadata.id, manifest: plugin.manifest, provider, index });
            });
        }
        return result;
    }
    /** 能力统计：后台插件页首屏用 */
    capabilityStats() {
        const stats = { text: 0, image: 0, video: 0, audio: 0 };
        for (const item of this.providers()) {
            for (const capability of item.provider.capabilities ?? []) {
                if (stats[capability] !== undefined)
                    stats[capability] += 1;
            }
        }
        return stats;
    }
    /** 按清单字段统计后端类型，用于「当前环境不可用」的提示 */
    backendStats() {
        const stats = {};
        for (const plugin of this.list()) {
            const backend = String(plugin.manifest.runtime?.backend ?? 'declarative').trim() || 'declarative';
            stats[backend] = (stats[backend] ?? 0) + 1;
        }
        return stats;
    }
};
exports.PluginManifestStore = PluginManifestStore;
exports.PluginManifestStore = PluginManifestStore = PluginManifestStore_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PluginManifestStore);
//# sourceMappingURL=plugin-manifest.store.js.map