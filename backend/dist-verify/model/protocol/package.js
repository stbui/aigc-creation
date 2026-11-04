"use strict";
/**
 * 插件包解析 —— `yingce.plugin/package-v1` 容器。
 *
 * 移植自 open-ai-canvas `internal/protocol/package.go`。容器是 zip，限制：
 * 整包 ≤ 48MB、文件数 ≤ 256、单文件 ≤ 16MB、manifest.json ≤ 512KB；
 * 路径只允许 `manifest.json` / `web/` / `backend/` / `assets/` / `docs/` /
 * `README.md` / `LICENSE`；拒绝绝对路径、`..`、反斜杠与符号链接。
 *
 * 为什么自己解析 zip 而不引依赖：本项目依赖安装走直装 registry、版本必须精确
 * 锁定（见 CLAUDE.md「环境注意事项」第 4 条），为一个只用一处的容器格式引入
 * 一棵依赖树不划算。这里只实现 stored / deflate 两种压缩方式，足够覆盖
 * Go `archive/zip` 产出的包。
 *
 * **解析过程绝不执行包内任何内容**：只解压、只校验结构。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLUGIN_PACKAGE_VERSION = exports.PluginPackageError = exports.PLUGIN_MANIFEST_MAX_BYTES = exports.PLUGIN_PACKAGE_MAX_BYTES = void 0;
exports.inspectPluginPackage = inspectPluginPackage;
exports.parsePluginPackage = parsePluginPackage;
exports.parsePluginPackageFiles = parsePluginPackageFiles;
exports.validatePluginPackagePath = validatePluginPackagePath;
const node_zlib_1 = require("node:zlib");
const manifest_1 = require("./manifest");
const types_1 = require("./types");
Object.defineProperty(exports, "PLUGIN_PACKAGE_VERSION", { enumerable: true, get: function () { return types_1.PLUGIN_PACKAGE_VERSION; } });
exports.PLUGIN_PACKAGE_MAX_BYTES = 48 << 20;
exports.PLUGIN_MANIFEST_MAX_BYTES = 512 << 10;
const PLUGIN_PACKAGE_MAX_FILES = 256;
const PLUGIN_PACKAGE_MAX_ENTRY = 16 << 20;
/** 插件包结构错误 */
class PluginPackageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PluginPackageError';
    }
}
exports.PluginPackageError = PluginPackageError;
/** 只读清单、不解压其余文件 —— 启动期与安装校验用 */
function inspectPluginPackage(data) {
    return readPluginPackage(data, () => false);
}
/** 全量解析（安装执行型插件时使用） */
function parsePluginPackage(data) {
    return readPluginPackage(data, () => true);
}
/** 解析指定条目（其余只登记），用于按需展开运行时产物 */
function parsePluginPackageFiles(data, keep) {
    return readPluginPackage(data, keep);
}
function readPluginPackage(data, keep) {
    if (!data || data.length === 0 || data.length > exports.PLUGIN_PACKAGE_MAX_BYTES) {
        throw new PluginPackageError(`插件包大小必须在 1 到 ${exports.PLUGIN_PACKAGE_MAX_BYTES} 字节之间`);
    }
    const entries = readCentralDirectory(data);
    if (entries.length === 0 || entries.length > PLUGIN_PACKAGE_MAX_FILES) {
        throw new PluginPackageError(`插件包文件数必须在 1 到 ${PLUGIN_PACKAGE_MAX_FILES} 之间`);
    }
    const files = new Map();
    let manifestRaw = null;
    for (const entry of entries) {
        const name = validatePluginPackagePath(entry.name);
        if (files.has(name))
            throw new PluginPackageError(`插件包存在重复文件：${name}`);
        if (isDirectory(entry))
            continue;
        if (isSymlink(entry))
            throw new PluginPackageError(`插件包不允许包含符号链接：${name}`);
        if (entry.uncompressedSize > PLUGIN_PACKAGE_MAX_ENTRY) {
            throw new PluginPackageError(`插件包文件 ${name} 超过 ${PLUGIN_PACKAGE_MAX_ENTRY} 字节`);
        }
        if (name !== 'manifest.json' && !keep(name)) {
            files.set(name, null);
            continue;
        }
        if (entry.uncompressedSize === 0 && entry.compressedSize === 0) {
            files.set(name, Buffer.alloc(0));
            continue;
        }
        const content = extractEntry(data, entry);
        if (content.length > PLUGIN_PACKAGE_MAX_ENTRY) {
            throw new PluginPackageError(`插件包文件 ${name} 超过 ${PLUGIN_PACKAGE_MAX_ENTRY} 字节`);
        }
        files.set(name, content);
        if (name === 'manifest.json')
            manifestRaw = content;
    }
    if (!manifestRaw)
        throw new PluginPackageError('插件包必须包含 manifest.json');
    if (manifestRaw.length > exports.PLUGIN_MANIFEST_MAX_BYTES) {
        throw new PluginPackageError(`manifest.json 超过 ${exports.PLUGIN_MANIFEST_MAX_BYTES} 字节`);
    }
    let manifest;
    try {
        manifest = (0, manifest_1.decodeManifest)(manifestRaw);
        (0, manifest_1.validateManifest)(manifest);
    }
    catch (error) {
        if (error instanceof manifest_1.ManifestError)
            throw new PluginPackageError(error.message);
        throw error;
    }
    validatePluginPackageRuntime(manifest, files);
    return { manifest, manifestRaw, files };
}
/** 包内路径白名单与规范化检查 */
function validatePluginPackagePath(rawName) {
    const name = String(rawName ?? '').trim();
    if (!name ||
        name.includes('\\') ||
        name.startsWith('/') ||
        name.includes('\0') ||
        name.split('/').includes('..') ||
        name.startsWith('../') ||
        name === '..') {
        throw new PluginPackageError(`插件包路径无效：${rawName}`);
    }
    // 规范化后必须与原文一致，避免 ./ 与重复分隔符绕过白名单
    const normalized = name
        .split('/')
        .filter((part) => part !== '' && part !== '.')
        .join('/');
    if (normalized !== name)
        throw new PluginPackageError(`插件包路径无效：${rawName}`);
    const allowedRoots = ['web/', 'backend/', 'assets/', 'docs/'];
    const allowedFiles = ['manifest.json', 'README.md', 'LICENSE'];
    if (allowedFiles.includes(name) || allowedRoots.some((root) => name.startsWith(root)))
        return name;
    throw new PluginPackageError(`插件包路径 ${name} 不在允许的目录内`);
}
/** 运行时入口校验：entry 必须落在 web/，rpc / wasm 的 backendEntry 必须存在 */
function validatePluginPackageRuntime(manifest, files) {
    const backend = String(manifest.runtime?.backend ?? '').trim();
    if (backend === 'rpc' || backend === 'wasm') {
        const entry = String(manifest.runtime?.backendEntry ?? '').trim();
        if (!entry.startsWith('backend/') || entry.split('/').includes('..')) {
            throw new PluginPackageError('manifest.runtime.backendEntry 必须指向 backend/ 内部');
        }
        if (!files.has(entry)) {
            throw new PluginPackageError(`manifest.runtime.backendEntry 指向的文件不存在：${entry}`);
        }
        if (backend === 'wasm' && !entry.toLowerCase().endsWith('.wasm')) {
            throw new PluginPackageError('wasm 后端入口必须是 .wasm 文件');
        }
    }
    const entry = String(manifest.entry ?? '').trim();
    if (!entry) {
        if (String(manifest.runtime?.web ?? '').trim()) {
            throw new PluginPackageError('声明 manifest.runtime.web 时必须提供 manifest.entry');
        }
        for (const name of files.keys()) {
            if (name.startsWith('web/'))
                throw new PluginPackageError('插件包包含 web/ 文件时必须声明 manifest.entry');
        }
        return;
    }
    if (!entry.startsWith('web/') || entry.split('/').includes('..')) {
        throw new PluginPackageError('manifest.entry 必须指向 web/ 内部');
    }
    if (!files.has(entry))
        throw new PluginPackageError(`manifest.entry 指向的文件不存在：${entry}`);
    if (manifest.runtime?.web !== 'sandbox' && manifest.runtime?.web !== 'worker') {
        throw new PluginPackageError('上传的 web 插件必须声明 runtime.web 为 sandbox 或 worker');
    }
}
/** 读取 zip 中央目录 */
function readCentralDirectory(data) {
    const eocdOffset = findEndOfCentralDirectory(data);
    if (eocdOffset < 0)
        throw new PluginPackageError('插件包不是有效的 zip 文件');
    const totalEntries = data.readUInt16LE(eocdOffset + 10);
    const directorySize = data.readUInt32LE(eocdOffset + 12);
    const directoryOffset = data.readUInt32LE(eocdOffset + 16);
    if (directoryOffset + directorySize > data.length) {
        throw new PluginPackageError('插件包中央目录越界');
    }
    const entries = [];
    let cursor = directoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
        if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) {
            throw new PluginPackageError('插件包中央目录损坏');
        }
        const versionMadeBy = data.readUInt16LE(cursor + 4);
        const method = data.readUInt16LE(cursor + 10);
        const compressedSize = data.readUInt32LE(cursor + 20);
        const uncompressedSize = data.readUInt32LE(cursor + 24);
        const nameLength = data.readUInt16LE(cursor + 28);
        const extraLength = data.readUInt16LE(cursor + 30);
        const commentLength = data.readUInt16LE(cursor + 32);
        const externalAttributes = data.readUInt32LE(cursor + 38);
        const localOffset = data.readUInt32LE(cursor + 42);
        const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        entries.push({ name, method, compressedSize, uncompressedSize, localOffset, externalAttributes, versionMadeBy });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}
function findEndOfCentralDirectory(data) {
    const minOffset = Math.max(0, data.length - 66 * 1024);
    for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
        if (data.readUInt32LE(offset) === 0x06054b50)
            return offset;
    }
    return -1;
}
function isDirectory(entry) {
    return entry.name.endsWith('/');
}
/** unix 模式下 0xA000 表示符号链接 */
function isSymlink(entry) {
    if ((entry.versionMadeBy >> 8) !== 3)
        return false;
    const mode = entry.externalAttributes >>> 16;
    return (mode & 0xf000) === 0xa000;
}
/** 解压单个条目；stored / deflate 之外一律拒绝 */
function extractEntry(data, entry) {
    const headerOffset = entry.localOffset;
    if (headerOffset + 30 > data.length || data.readUInt32LE(headerOffset) !== 0x04034b50) {
        throw new PluginPackageError(`插件包条目头损坏：${entry.name}`);
    }
    const nameLength = data.readUInt16LE(headerOffset + 26);
    const extraLength = data.readUInt16LE(headerOffset + 28);
    const start = headerOffset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > data.length)
        throw new PluginPackageError(`插件包条目越界：${entry.name}`);
    const payload = data.subarray(start, end);
    if (entry.method === 0)
        return Buffer.from(payload);
    if (entry.method === 8) {
        try {
            return (0, node_zlib_1.inflateRawSync)(payload, { maxOutputLength: PLUGIN_PACKAGE_MAX_ENTRY + 1 });
        }
        catch (error) {
            throw new PluginPackageError(`插件包条目解压失败：${entry.name}（${error.message}）`);
        }
    }
    throw new PluginPackageError(`插件包使用了不支持的压缩方式：${entry.method}`);
}
//# sourceMappingURL=package.js.map