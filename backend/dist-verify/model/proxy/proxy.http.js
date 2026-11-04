"use strict";
/**
 * 中转的 HTTP 边界：读请求体、写响应、流式透传与密钥脱敏。
 *
 * 使用 `@Res()` 直接写响应是**刻意**的：中转要原样透传上游状态码与
 * `text/event-stream`，而全局 `ResponseInterceptor` 会把返回值包成
 * `{code,data,message}` 信封。控制器拿到原始响应对象后自行结束连接，
 * 不入信封 —— 与参考实现的 `c.Data(...)` / `c.Writer` 等价。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayStreamRedactor = exports.ProxyBodyTooLargeError = void 0;
exports.readProxyBody = readProxyBody;
exports.writeProxyResponse = writeProxyResponse;
exports.writeProxyError = writeProxyError;
exports.copyProxyResponseHeaders = copyProxyResponseHeaders;
exports.isEventStream = isEventStream;
exports.beginEventStream = beginEventStream;
exports.copyUpstreamStream = copyUpstreamStream;
exports.copyRedactedStream = copyRedactedStream;
exports.readUpstreamBody = readUpstreamBody;
exports.allowsBinaryResponse = allowsBinaryResponse;
exports.redactSecret = redactSecret;
/** 读不到请求体 / 超过上限时抛这个；控制器映射为 413 */
class ProxyBodyTooLargeError extends Error {
    constructor(message = '请求体超过中转上限') {
        super(message);
        this.name = 'ProxyBodyTooLargeError';
    }
}
exports.ProxyBodyTooLargeError = ProxyBodyTooLargeError;
/**
 * 读取请求体。
 *
 * JSON / 表单已由全局 body-parser 解析，`rawBody` 是 Nest 的 `rawBody: true`
 * 留下的原始字节（`JSON.stringify(req.body)` 会改变键顺序与数字格式，不能代替）；
 * multipart / 二进制未被解析，只能读流。两条路径都受同一个上限约束。
 */
async function readProxyBody(req, limitBytes) {
    const raw = req.rawBody;
    if (Buffer.isBuffer(raw)) {
        if (raw.length > limitBytes)
            throw new ProxyBodyTooLargeError();
        return raw;
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > limitBytes)
        throw new ProxyBodyTooLargeError();
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        // 不 `req.destroy()`：销毁请求会让调用方没机会回 413（客户端只看到连接重置）。
        // 调用方写完 413 后再自行 `req.resume()` 丢弃剩余字节。
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            req.pause();
            reject(error);
        };
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > limitBytes) {
                fail(new ProxyBodyTooLargeError());
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled)
                return;
            settled = true;
            resolve(Buffer.concat(chunks));
        });
        req.on('error', (error) => fail(error));
    });
}
/**
 * 写一个完整的响应（非流式）。
 *
 * `Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff` 不是可选项：
 * 前者防止中间层缓存含用户数据的生成结果，后者阻止浏览器把上游返回的
 * 二进制当 HTML 执行。
 */
function writeProxyResponse(res, input) {
    res.statusCode = input.statusCode;
    if (input.contentType)
        res.setHeader('Content-Type', input.contentType);
    if (input.disposition)
        res.setHeader('Content-Disposition', input.disposition);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(input.body.length));
    res.end(input.body);
}
/**
 * 中转自身产生的错误（尚未产生上游响应）。
 *
 * 用本仓统一信封 `{code, data, message}`：中转是给 SDK 调用的接口，但错误
 * 若与全站其它接口不同形，前端排障与运营日志会多出一套解析分支。
 */
function writeProxyError(res, status, code, message) {
    if (res.headersSent) {
        res.destroy();
        return;
    }
    const body = Buffer.from(JSON.stringify({ code, data: null, message }), 'utf8');
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
}
/** 复制上游的可透传响应头；只白名单复制，避免 `set-cookie` / `server` 泄漏 */
function copyProxyResponseHeaders(res, headers) {
    for (const key of ['content-type', 'cache-control', 'content-disposition']) {
        const value = headers[key];
        if (typeof value === 'string' && value !== '')
            res.setHeader(key, value);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
}
/** 响应是否为事件流（SSE） */
function isEventStream(headers) {
    const value = headers['content-type'];
    const mediaType = String(Array.isArray(value) ? value[0] : value ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    return mediaType === 'text/event-stream';
}
/** SSE 响应头：必须显式关闭 Nginx 缓冲，否则事件流会被攒成整段 */
function beginEventStream(res, statusCode) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders?.();
}
/**
 * 把上游响应逐块写入客户端，同时按上限捕获一份用于日志。
 *
 * @returns `{ captured, exceeded }`；`exceeded=true` 表示超过上限、
 *          已中断连接 —— 调用方必须按「结果不明」处理计费
 */
async function copyUpstreamStream(source, res, limitBytes) {
    const captured = [];
    let total = 0;
    let exceeded = false;
    return new Promise((resolve) => {
        const finish = () => {
            if (exceeded)
                res.destroy();
            resolve({ captured: Buffer.concat(captured), exceeded });
        };
        source.on('data', (chunk) => {
            total += chunk.length;
            if (total > limitBytes) {
                exceeded = true;
                source.destroy();
                finish();
                return;
            }
            captured.push(chunk);
            res.write(chunk);
        });
        source.on('end', () => {
            res.end();
            finish();
        });
        source.on('error', finish);
        // 客户端提前断开：不再继续写，但上游请求仍要收尾（不把客户端断开算成上游失败）
        res.on('close', () => {
            if (!res.writableEnded)
                source.destroy();
        });
    });
}
/**
 * 带脱敏的流式透传：自定义中转的上游可能把用户自己的 Key 回显在报文里。
 *
 * 与 `copyUpstreamStream` 的唯一区别是每块先过 `RelayStreamRedactor`，
 * 并在结束时 flush 尾部的待定字节 —— 不 flush 会丢掉最后一段正文。
 */
async function copyRedactedStream(source, res, limitBytes, redactor) {
    const captured = [];
    let total = 0;
    let exceeded = false;
    return new Promise((resolve) => {
        const finish = () => {
            const tail = redactor.push(null, true);
            if (tail.length > 0) {
                captured.push(tail);
                if (!exceeded)
                    res.write(tail);
            }
            if (exceeded)
                res.destroy();
            else
                res.end();
            resolve({ captured: Buffer.concat(captured), exceeded });
        };
        source.on('data', (chunk) => {
            total += chunk.length;
            if (total > limitBytes) {
                exceeded = true;
                source.destroy();
                finish();
                return;
            }
            const output = redactor.push(chunk);
            if (output.length > 0) {
                captured.push(output);
                res.write(output);
            }
        });
        source.on('end', finish);
        source.on('error', finish);
        res.on('close', () => {
            if (!res.writableEnded)
                source.destroy();
        });
    });
}
/** 按上限读完上游响应体；超限返回 `null` */
async function readUpstreamBody(source, limitBytes) {
    const chunks = [];
    let total = 0;
    return new Promise((resolve, reject) => {
        source.on('data', (chunk) => {
            total += chunk.length;
            if (total > limitBytes) {
                source.destroy();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        source.on('end', () => resolve(Buffer.concat(chunks)));
        source.on('error', reject);
    });
}
/** 二进制响应是否允许透传（视频 / 音频下载） */
function allowsBinaryResponse(contentType) {
    const mediaType = String(contentType ?? '').split(';')[0].trim().toLowerCase();
    return (mediaType.startsWith('video/') ||
        mediaType.startsWith('audio/') ||
        mediaType.startsWith('image/') ||
        mediaType === 'application/octet-stream');
}
/** 把密钥从报文里抹掉：上游错误信息经常原样回显 `Authorization` */
function redactSecret(text, secret) {
    const value = String(secret ?? '');
    if (value === '')
        return text;
    return text.split(value).join('[REDACTED]');
}
/**
 * 流式脱敏器：保留可能跨块出现的密钥前缀，避免「密钥被拆成两块」时漏抹。
 *
 * 参考实现 `relayStreamRedactor` 的等价移植：每次只吐出确定安全的部分，
 * 尾部最多保留 `len(secret)-1` 字节等待下一块。
 */
class RelayStreamRedactor {
    constructor(secret) {
        this.pending = Buffer.alloc(0);
        this.secret = Buffer.from(String(secret ?? ''));
    }
    push(chunk, final = false) {
        this.pending = Buffer.concat([this.pending, chunk ?? Buffer.alloc(0)]);
        if (this.secret.length === 0) {
            const result = this.pending;
            this.pending = Buffer.alloc(0);
            return result;
        }
        this.pending = Buffer.from(redactSecret(this.pending.toString('binary'), this.secret.toString('binary')), 'binary');
        if (final) {
            const result = this.pending;
            this.pending = Buffer.alloc(0);
            return result;
        }
        const keep = this.prefixSuffixLength(this.pending, this.secret);
        const cut = this.pending.length - keep;
        const result = this.pending.subarray(0, cut);
        this.pending = Buffer.from(this.pending.subarray(cut));
        return Buffer.from(result);
    }
    prefixSuffixLength(data, secret) {
        const limit = Math.min(secret.length - 1, data.length);
        for (let length = limit; length > 0; length -= 1) {
            if (data.subarray(data.length - length).equals(secret.subarray(0, length)))
                return length;
        }
        return 0;
    }
}
exports.RelayStreamRedactor = RelayStreamRedactor;
//# sourceMappingURL=proxy.http.js.map