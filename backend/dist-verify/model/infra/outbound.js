"use strict";
/**
 * 出站请求边界 —— 所有访问上游模型的 HTTP 都必须经过这里。
 *
 * 迁移自 open-ai-canvas `internal/outbound/outbound.go`，保留其全部安全判定：
 * 1. **SSRF**：只允许 http/https；禁止 URL 内嵌凭据；域名解析后逐个 IP 判定，
 *    拒绝 loopback / 私网 / 链路本地 / 组播 / 未指定地址；重定向每跳复验，最多 5 次。
 * 2. **自定义渠道更严**：禁止 fragment；HTTP 只允许部署者显式放行的可信主机；
 *    额外拒绝保留用途网段（0.0.0.0/8、100.64/10、198.18/15、240/4 等）。
 * 3. **自定义请求头**：≤ 32 项、总计 ≤ 16KB；禁止覆盖鉴权、协议、hop-by-hop、
 *    `x-canvas-*`、`x-forwarded-*`；值中不允许控制字符。
 * 4. **代理**：渠道级 proxyUrl 支持 socks5 / socks5h / http / https，允许私网与凭据
 *    （它是管理员配置的出口，不是用户可控的上游）。
 *
 * 为什么不用全局 `fetch`：`fetch` 无法在 DNS 解析后、建立连接前介入，也就无法做
 * 「解析结果非法即拒绝」的 SSRF 防护，也无法按渠道指定代理。这里基于
 * `node:http` / `node:https` 的 `lookup` 钩子实现，零新增依赖。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_HEADER_BYTES = exports.MAX_HEADER_COUNT = exports.MAX_REDIRECTS = exports.OutboundError = void 0;
exports.configureOutboundPolicy = configureOutboundPolicy;
exports.allowedPrivateUpstreamHost = allowedPrivateUpstreamHost;
exports.validateOutboundUrl = validateOutboundUrl;
exports.validateCustomRelayUrl = validateCustomRelayUrl;
exports.validateProxyUrl = validateProxyUrl;
exports.resolveOutboundHost = resolveOutboundHost;
exports.normalizeOutboundHeaders = normalizeOutboundHeaders;
exports.encodeOutboundHeaders = encodeOutboundHeaders;
exports.parseOutboundHeaders = parseOutboundHeaders;
exports.outboundRequest = outboundRequest;
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const net = __importStar(require("node:net"));
const tls = __importStar(require("node:tls"));
const promises_1 = require("node:dns/promises");
/** 出站错误：`code` 供上层映射业务错误码，`reason` 供日志与调用记录 */
class OutboundError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'OutboundError';
    }
}
exports.OutboundError = OutboundError;
exports.MAX_REDIRECTS = 5;
exports.MAX_HEADER_COUNT = 32;
exports.MAX_HEADER_BYTES = 16 * 1024;
const MAX_PROXY_URL_BYTES = 512;
const MAX_CUSTOM_RELAY_URL_BYTES = 4096;
const DEFAULT_USER_AGENT = 'ecom-vision/1.0';
/** 自定义渠道额外拒绝的保留用途网段（对齐参考实现 blockedCustomRelayPrefixes） */
const BLOCKED_CUSTOM_RELAY_V4 = [
    ['0.0.0.0', 8],
    ['100.64.0.0', 10],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['240.0.0.0', 4],
];
const outboundPolicy = { allowPrivateUpstreams: false, allowedPrivateUpstreamHosts: [] };
/** 启动期注入策略；重复调用以最后一次为准（测试用） */
function configureOutboundPolicy(policy) {
    outboundPolicy.allowPrivateUpstreams = Boolean(policy.allowPrivateUpstreams);
    outboundPolicy.allowedPrivateUpstreamHosts = (policy.allowedPrivateUpstreamHosts ?? [])
        .map((item) => normalizeHost(item))
        .filter(Boolean);
}
/** 精确定点放行的可信私网主机名 */
function allowedPrivateUpstreamHost(host) {
    const normalized = normalizeHost(host);
    if (!normalized)
        return false;
    return outboundPolicy.allowedPrivateUpstreamHosts.includes(normalized);
}
function normalizeHost(host) {
    return String(host ?? '').trim().toLowerCase().replace(/\.$/, '');
}
/** 校验系统渠道 / 模型上游地址 */
async function validateOutboundUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl ?? '').trim());
    }
    catch {
        throw new OutboundError('外部服务地址无效', 'invalid_url');
    }
    if (!parsed.hostname)
        throw new OutboundError('外部服务地址无效', 'invalid_url');
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new OutboundError('外部服务地址只支持 http/https', 'invalid_url');
    }
    if (parsed.username || parsed.password) {
        throw new OutboundError('外部服务地址不允许包含认证信息', 'invalid_url');
    }
    await resolveOutboundHost(parsed.hostname, false);
    return parsed;
}
/** 校验用户自定义渠道地址：规则更严，且 HTTP 仅限可信主机 */
async function validateCustomRelayUrl(rawUrl) {
    const text = String(rawUrl ?? '').trim();
    if (text.length > MAX_CUSTOM_RELAY_URL_BYTES) {
        throw new OutboundError('自定义渠道地址过长', 'invalid_url');
    }
    let parsed;
    try {
        parsed = new URL(text);
    }
    catch {
        throw new OutboundError('自定义渠道地址无效', 'invalid_url');
    }
    if (!parsed.hostname)
        throw new OutboundError('自定义渠道地址无效', 'invalid_url');
    const scheme = parsed.protocol.toLowerCase();
    if (scheme !== 'https:' && scheme !== 'http:') {
        throw new OutboundError('自定义渠道地址只支持 http/https', 'invalid_url');
    }
    if (scheme === 'http:' && !allowedPrivateUpstreamHost(parsed.hostname)) {
        throw new OutboundError('自定义渠道 HTTP 仅允许访问已配置的可信上游主机', 'invalid_url');
    }
    if (parsed.username || parsed.password) {
        throw new OutboundError('自定义渠道地址不允许包含认证信息', 'invalid_url');
    }
    if (parsed.hash) {
        throw new OutboundError('自定义渠道地址不允许包含片段', 'invalid_url');
    }
    await resolveOutboundHost(parsed.hostname, true);
    return parsed;
}
/** 校验渠道代理地址（允许私网与凭据） */
function validateProxyUrl(rawUrl) {
    const text = String(rawUrl ?? '').trim();
    if (!text)
        return null;
    if (text.length > MAX_PROXY_URL_BYTES) {
        throw new OutboundError('渠道代理地址过长', 'proxy_invalid');
    }
    let parsed;
    try {
        parsed = new URL(text);
    }
    catch {
        throw new OutboundError('渠道代理地址无效', 'proxy_invalid');
    }
    const scheme = parsed.protocol.toLowerCase();
    if (!['socks5:', 'socks5h:', 'http:', 'https:'].includes(scheme)) {
        throw new OutboundError('渠道代理只支持 socks5/socks5h/http/https', 'proxy_invalid');
    }
    if (!parsed.hostname)
        throw new OutboundError('渠道代理地址无效', 'proxy_invalid');
    if (parsed.hash)
        throw new OutboundError('渠道代理地址不允许包含片段', 'proxy_invalid');
    return parsed;
}
/** 解析域名并按策略校验；返回全部地址（任一非法即整体拒绝） */
async function resolveOutboundHost(hostname, strictRelay) {
    const host = normalizeHost(hostname);
    if (!host)
        throw new OutboundError('外部服务域名无效', 'invalid_url');
    // 自定义渠道不允许仅凭全局逃生开关放行私网，必须显式点名主机
    const allowPrivate = strictRelay
        ? allowedPrivateUpstreamHost(host)
        : outboundPolicy.allowPrivateUpstreams || allowedPrivateUpstreamHost(host);
    if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost'))) {
        throw new OutboundError('不允许访问本机或内网地址', 'blocked_host');
    }
    let addresses;
    try {
        addresses = await (0, promises_1.lookup)(host, { all: true, verbatim: true });
    }
    catch {
        throw new OutboundError('外部服务域名解析失败，请检查渠道域名和后端 DNS 配置', 'dns_failed');
    }
    if (!addresses || addresses.length === 0) {
        throw new OutboundError('外部服务域名没有可用地址，请检查渠道域名和后端 DNS 配置', 'dns_failed');
    }
    if (!allowPrivate) {
        for (const item of addresses) {
            if (blockedOutboundIp(item.address)) {
                throw new OutboundError('不允许访问本机、内网或链路本地地址', 'blocked_host');
            }
            if (strictRelay && blockedCustomRelayIp(item.address)) {
                throw new OutboundError('不允许访问保留地址或特殊用途地址', 'blocked_host');
            }
        }
    }
    return addresses.map((item) => item.address);
}
function blockedOutboundIp(address) {
    try {
        return ipIsForbidden(address, false);
    }
    catch {
        return true;
    }
}
function blockedCustomRelayIp(address) {
    try {
        return ipIsForbidden(address, true);
    }
    catch {
        return true;
    }
}
/** IP 判定：loopback / 私网 / 链路本地 / 组播 / 未指定；strict 时追加保留网段 */
function ipIsForbidden(address, strict) {
    const family = net.isIP(address);
    if (family === 4) {
        const value = ipv4ToInt(address);
        const inRange = (base, bits) => {
            const mask = bits === 0 ? 0 : (~0 >>> 0) << (32 - bits);
            return (value & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
        };
        if (inRange('127.0.0.0', 8))
            return true; // loopback
        if (inRange('10.0.0.0', 8))
            return true;
        if (inRange('172.16.0.0', 12))
            return true;
        if (inRange('192.168.0.0', 16))
            return true;
        if (inRange('169.254.0.0', 16))
            return true; // link-local
        if (inRange('0.0.0.0', 8))
            return true; // unspecified / 本网
        if (inRange('224.0.0.0', 4))
            return true; // multicast
        if (strict) {
            for (const [base, bits] of BLOCKED_CUSTOM_RELAY_V4) {
                if (inRange(base, bits))
                    return true;
            }
        }
        return false;
    }
    if (family === 6) {
        const normalized = address.toLowerCase();
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
        if (mapped)
            return ipIsForbidden(mapped[1], strict);
        if (normalized === '::' || normalized === '::1')
            return true;
        if (/^f[cd][0-9a-f]{2}:/.test(normalized))
            return true; // unique local fc00::/7
        if (/^fe[89ab][0-9a-f]:/.test(normalized))
            return true; // link-local fe80::/10
        if (/^ff[0-9a-f]{2}:/.test(normalized))
            return true; // multicast
        if (strict) {
            // 自定义中转额外拒绝保留/文档网段，与参考实现保持一致：
            // 100::/64（discard-only）与 2001:db8::/32（documentation）
            if (ipv6InPrefix(normalized, '100::', 64))
                return true;
            if (ipv6InPrefix(normalized, '2001:db8::', 32))
                return true;
        }
        return false;
    }
    return true;
}
/** IPv6 是否落在指定前缀内；地址/前缀均按 `::` 压缩形式解析 */
function ipv6InPrefix(address, prefix, bits) {
    const shift = BigInt(128 - bits);
    return ipv6ToBigInt(address) >> shift === ipv6ToBigInt(prefix) >> shift;
}
function ipv6ToBigInt(address) {
    let text = String(address ?? '').toLowerCase();
    const zone = text.indexOf('%');
    if (zone >= 0)
        text = text.slice(0, zone);
    // 内嵌 IPv4（如 `::ffff:192.168.0.1`、`2001:db8::192.168.0.1`）先换成两个十六进制组
    const embedded = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
    if (embedded) {
        const value = ipv4ToInt(embedded[2]);
        text = `${embedded[1]}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
    }
    const halves = text.split('::');
    if (halves.length > 2)
        throw new Error(`无效 IPv6：${address}`);
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 && missing !== 0)
        throw new Error(`无效 IPv6：${address}`);
    const groups = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail];
    if (groups.length !== 8)
        throw new Error(`无效 IPv6：${address}`);
    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/.test(group))
            throw new Error(`无效 IPv6：${address}`);
        value = (value << 16n) + BigInt(parseInt(group, 16));
    }
    return value;
}
function ipv4ToInt(address) {
    const parts = address.split('.').map((item) => Number(item));
    if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
        throw new Error(`无效 IPv4：${address}`);
    }
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
/** 自定义请求头校验：名称/值/数量/总量/保留头，全部在此收口 */
function normalizeOutboundHeaders(headers) {
    if (!headers)
        return [];
    if (headers.length > exports.MAX_HEADER_COUNT) {
        throw new OutboundError(`自定义请求头最多支持 ${exports.MAX_HEADER_COUNT} 项`, 'invalid_url');
    }
    const seen = new Set();
    const result = [];
    let total = 0;
    for (const item of headers) {
        const name = String(item?.name ?? '').trim();
        const value = String(item?.value ?? '').trim();
        if (!name && !value)
            continue;
        if (!name || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
            throw new OutboundError('自定义请求头名称无效，请使用标准 HTTP Header 名称', 'invalid_url');
        }
        const canonical = canonicalHeaderName(name);
        const lower = canonical.toLowerCase();
        if (blockedOutboundHeader(lower)) {
            throw new OutboundError(`请求头 ${canonical} 由系统管理，不允许自定义`, 'invalid_url');
        }
        if (seen.has(lower)) {
            throw new OutboundError(`自定义请求头不能重复：${canonical}`, 'invalid_url');
        }
        for (let index = 0; index < value.length; index += 1) {
            const code = value.charCodeAt(index);
            if (code === 9 || (code >= 32 && code !== 127))
                continue;
            throw new OutboundError(`请求头 ${canonical} 的值包含非法控制字符`, 'invalid_url');
        }
        if (name.length > 128 || value.length > 4096) {
            throw new OutboundError('单个自定义请求头名称或值过长', 'invalid_url');
        }
        total += name.length + value.length;
        if (total > exports.MAX_HEADER_BYTES) {
            throw new OutboundError('自定义请求头总大小不能超过 16KB', 'invalid_url');
        }
        seen.add(lower);
        result.push({ name: canonical, value });
    }
    return result;
}
function canonicalHeaderName(name) {
    return name
        .split('-')
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
        .join('-');
}
function blockedOutboundHeader(lowerName) {
    const blocked = [
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        'host',
        'content-length',
        'content-type',
        'accept',
        'connection',
        'proxy-connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'trailer',
        'upgrade',
        'forwarded',
        'x-goog-api-key',
    ];
    return blocked.includes(lowerName) || lowerName.startsWith('x-canvas-') || lowerName.startsWith('x-forwarded-');
}
/** 自定义请求头 → JSON（写入渠道 `headersJson` 前先规范化） */
function encodeOutboundHeaders(headers) {
    return JSON.stringify(normalizeOutboundHeaders(headers));
}
function parseOutboundHeaders(raw) {
    if (!String(raw ?? '').trim())
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new OutboundError('渠道自定义请求头配置损坏', 'invalid_url');
    }
    if (!Array.isArray(parsed))
        throw new OutboundError('渠道自定义请求头配置损坏', 'invalid_url');
    return normalizeOutboundHeaders(parsed.map((item) => ({ name: String(item?.name ?? ''), value: String(item?.value ?? '') })));
}
async function outboundRequest(rawUrl, options = {}) {
    const method = (options.method ?? 'GET').toUpperCase();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const proxy = validateProxyUrl(options.proxyUrl ?? '');
    let current = String(rawUrl ?? '');
    for (let redirect = 0; redirect <= exports.MAX_REDIRECTS; redirect += 1) {
        const target = options.strictRelay
            ? await validateCustomRelayUrl(current)
            : await validateOutboundUrl(current);
        const response = await sendOnce(target, method, options, proxy, timeoutMs);
        if (![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            if (options.stream)
                return response;
            return await readBody(response, options.maxBodyBytes);
        }
        // 代理透传不允许重定向，避免把内部地址暴露给调用方
        if (options.strictRelay) {
            response.resume();
            throw new OutboundError('自定义渠道请求不允许重定向', 'network');
        }
        const location = response.headers.location;
        response.resume();
        if (!location)
            throw new OutboundError('外部服务重定向缺少 Location', 'network');
        current = new URL(String(location), target).toString();
    }
    throw new OutboundError('外部服务重定向次数过多', 'network');
}
/** 单跳发送：直连 / HTTP(S) 代理 CONNECT / SOCKS5 三种路径 */
async function sendOnce(target, method, options, proxy, timeoutMs) {
    const headers = { ...(options.headers ?? {}) };
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
        headers['User-Agent'] = DEFAULT_USER_AGENT;
    }
    if (options.body !== undefined && options.body !== null) {
        headers['Content-Length'] = String(Buffer.byteLength(options.body));
    }
    const isHttps = target.protocol === 'https:';
    const requestOptions = { method, headers, agent: false };
    if (proxy && ['socks5:', 'socks5h:'].includes(proxy.protocol)) {
        const socket = await openSocksTunnel(target, proxy);
        requestOptions.createConnection = () => isHttps
            ? tls.connect({ socket, servername: target.hostname })
            : socket;
    }
    else if (proxy) {
        const tunnel = await openHttpTunnel(target, proxy);
        requestOptions.createConnection = () => isHttps
            ? tls.connect({ socket: tunnel, servername: target.hostname })
            : tunnel;
    }
    else {
        requestOptions.lookup = guardedLookup(target.hostname, Boolean(options.strictRelay));
    }
    const requestFn = isHttps ? https.request : http.request;
    requestOptions.host = target.hostname;
    requestOptions.port = target.port || (isHttps ? 443 : 80);
    requestOptions.path = `${target.pathname}${target.search}`;
    return new Promise((resolve, reject) => {
        const request = requestFn(requestOptions, (response) => resolve(response));
        request.setTimeout(timeoutMs, () => {
            request.destroy(new OutboundError('外部服务请求超时', 'timeout'));
        });
        request.on('error', (error) => {
            reject(error instanceof OutboundError ? error : new OutboundError(`外部服务请求失败：${error.message}`, 'network'));
        });
        if (options.body !== undefined && options.body !== null)
            request.write(options.body);
        request.end();
    });
}
/** DNS 钩子：解析结果非法时拒绝连接（SSRF 的最后一道闸） */
function guardedLookup(hostname, strictRelay) {
    return (host, lookupOptions, callback) => {
        const family = typeof lookupOptions === 'number' ? lookupOptions : lookupOptions?.family;
        (0, promises_1.lookup)(host || hostname, { all: true, verbatim: true })
            .then((addresses) => {
            const allowed = addresses.filter((item) => !ipIsForbidden(item.address, strictRelay));
            const filtered = family ? allowed.filter((item) => item.family === family) : allowed;
            if (filtered.length === 0) {
                callback(new OutboundError('不允许访问本机、内网或链路本地地址', 'blocked_host'));
                return;
            }
            if (lookupOptions?.all) {
                callback(null, filtered.map((item) => ({ address: item.address, family: item.family })));
                return;
            }
            callback(null, filtered[0].address, filtered[0].family);
        })
            .catch(() => callback(new OutboundError('外部服务域名解析失败', 'dns_failed')));
    };
}
/** HTTP(S) 代理隧道：CONNECT 后返回裸 socket */
function openHttpTunnel(target, proxy) {
    const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
    const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    const headers = { Host: `${target.hostname}:${targetPort}` };
    if (proxy.username || proxy.password) {
        const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
        headers['Proxy-Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    const requestModule = proxy.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = requestModule.request({
            host: proxy.hostname,
            port: proxyPort,
            method: 'CONNECT',
            path: `${target.hostname}:${targetPort}`,
            headers,
            agent: false,
        });
        request.on('connect', (response, socket) => {
            if (response.statusCode !== 200) {
                socket.destroy();
                reject(new OutboundError(`代理隧道建立失败：HTTP ${response.statusCode}`, 'proxy_invalid'));
                return;
            }
            resolve(socket);
        });
        request.on('error', (error) => reject(new OutboundError(`代理连接失败：${error.message}`, 'network')));
        request.end();
    });
}
/** SOCKS5 隧道：无认证或用户名密码认证，域名交给代理解析（socks5h 语义） */
function openSocksTunnel(target, proxy) {
    const proxyPort = Number(proxy.port || 1080);
    const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    const username = decodeURIComponent(proxy.username || '');
    const password = decodeURIComponent(proxy.password || '');
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: proxy.hostname, port: proxyPort });
        let stage = 'greeting';
        let buffer = Buffer.alloc(0);
        const fail = (message) => {
            socket.destroy();
            reject(new OutboundError(message, 'proxy_invalid'));
        };
        socket.on('connect', () => {
            socket.write(Buffer.from(username ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
        });
        socket.on('error', (error) => reject(new OutboundError(`SOCKS 代理连接失败：${error.message}`, 'network')));
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            if (stage === 'greeting') {
                if (buffer.length < 2)
                    return;
                const method = buffer[1];
                buffer = buffer.subarray(2);
                if (method === 0x00) {
                    stage = 'connect';
                    socket.write(buildSocksConnect(target.hostname, targetPort));
                }
                else if (method === 0x02 && username) {
                    stage = 'auth';
                    socket.write(Buffer.concat([
                        Buffer.from([0x01, Buffer.byteLength(username)]),
                        Buffer.from(username, 'utf8'),
                        Buffer.from([Buffer.byteLength(password)]),
                        Buffer.from(password, 'utf8'),
                    ]));
                }
                else {
                    fail('SOCKS 代理不支持所选认证方式');
                }
                return;
            }
            if (stage === 'auth') {
                if (buffer.length < 2)
                    return;
                if (buffer[1] !== 0x00)
                    return fail('SOCKS 代理认证失败');
                buffer = buffer.subarray(2);
                stage = 'connect';
                socket.write(buildSocksConnect(target.hostname, targetPort));
                return;
            }
            if (stage === 'connect') {
                if (buffer.length < 10)
                    return;
                if (buffer[1] !== 0x00)
                    return fail(`SOCKS 代理连接失败：状态 ${buffer[1]}`);
                stage = 'done';
                socket.removeAllListeners('data');
                // 已读入的多余字节属于上游响应，交还 socket
                if (buffer.length > 10)
                    socket.unshift(buffer.subarray(10));
                resolve(socket);
            }
        });
    });
}
function buildSocksConnect(hostname, port) {
    const portBuffer = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
    if (net.isIP(hostname) === 4) {
        return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), Buffer.from(hostname.split('.').map(Number)), portBuffer]);
    }
    if (net.isIP(hostname) === 6) {
        const segments = expandIpv6(hostname);
        return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x04]), segments, portBuffer]);
    }
    const name = Buffer.from(hostname, 'utf8');
    return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, portBuffer]);
}
function expandIpv6(address) {
    const [head, tail = ''] = address.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    const parts = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
    const buffer = Buffer.alloc(16);
    parts.forEach((part, index) => buffer.writeUInt16BE(parseInt(part || '0', 16), index * 2));
    return buffer;
}
async function readBody(response, maxBodyBytes) {
    const chunks = [];
    let total = 0;
    return new Promise((resolve, reject) => {
        response.on('data', (chunk) => {
            total += chunk.length;
            if (maxBodyBytes && total > maxBodyBytes) {
                response.destroy(new OutboundError('上游响应体超过大小限制', 'network'));
                return;
            }
            chunks.push(chunk);
        });
        response.on('end', () => {
            const body = Buffer.concat(chunks);
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body, text: body.toString('utf8') });
        });
        response.on('error', (error) => {
            reject(error instanceof OutboundError ? error : new OutboundError(`读取上游响应失败：${error.message}`, 'network'));
        });
    });
}
//# sourceMappingURL=outbound.js.map