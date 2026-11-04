"use strict";
/**
 * 声明式清单的响应解析。
 *
 * 移植自 open-ai-canvas `internal/protocol/manifest_adapter.go` 的解析部分。
 * 上游返回形态极不统一（JSON 路径、Markdown 图片、HTML video 标签、裸 base64、
 * 二进制附件、逐帧 JSON 音频流），这里逐一收敛成统一的 `ProtocolCreateResult`。
 *
 * 解析函数只读数据、不抛网络或数据库异常；唯一会抛错的是「响应根本不是
 * 期望形态」（非 JSON、空二进制、流里没有音频），由调用方记为该次尝试失败。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeObject = decodeObject;
exports.normalizeStatus = normalizeStatus;
exports.manifestError = manifestError;
exports.manifestResponseString = manifestResponseString;
exports.manifestResponseMedia = manifestResponseMedia;
exports.firstPathJSONValue = firstPathJSONValue;
exports.firstNonNilPathValue = firstNonNilPathValue;
exports.mediaPathValues = mediaPathValues;
exports.decodeJSONFrames = decodeJSONFrames;
exports.streamedJSONAudioCreateResult = streamedJSONAudioCreateResult;
exports.binaryPayloadCreateResult = binaryPayloadCreateResult;
exports.detectBinaryMimeType = detectBinaryMimeType;
exports.parseAgentResponse = parseAgentResponse;
exports.pickQueueAhead = pickQueueAhead;
const expression_1 = require("./expression");
const node_crypto_1 = require("node:crypto");
const request_1 = require("./request");
/** 流式音频响应上限：64MB，超限直接判失败，避免把内存打满 */
const MAX_STREAMED_JSON_AUDIO_BYTES = 64 << 20;
/** 把响应体解析成 JSON 对象；非对象直接报错 */
function decodeObject(body) {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`协议响应不是 JSON：${error.message}`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('协议响应必须是 JSON 对象');
    }
    return payload;
}
/** 上游状态文案归一；不认识的返回空串，由调用方决定默认值 */
function normalizeStatus(raw) {
    switch (String(raw ?? '').trim().toLowerCase()) {
        case 'queued':
        case 'pending':
        case 'created':
        case 'submitted':
        case 'in_queue':
        case 'task_status_queued':
            return 'pending';
        case 'running':
        case 'processing':
        case 'in_progress':
        case 'executing':
        case 'task_status_running':
            return 'processing';
        case 'succeeded':
        case 'success':
        case 'completed':
        case 'complete':
        case 'done':
        case 'task_status_succeed':
            return 'succeeded';
        case 'cancelled':
        case 'canceled':
        case 'aborted':
            return 'cancelled';
        case 'failed':
        case 'failure':
        case 'error':
        case 'expired':
            return 'failed';
        default:
            return '';
    }
}
/**
 * 错误路径命中判定。
 *
 * 字符串 `''` / `0` / `ok` / `success` / `succeeded` / `true`、数字 0、布尔 false
 * 都视为「没有错误」；其余非空值都算错误。
 */
function manifestError(payload, paths) {
    for (const path of paths ?? []) {
        const value = (0, expression_1.manifestPathValue)(payload, path);
        if (value === null || value === undefined)
            continue;
        if (typeof value === 'string') {
            if (['', '0', 'ok', 'success', 'succeeded', 'true'].includes(value.trim().toLowerCase()))
                continue;
            return true;
        }
        if (typeof value === 'number' || typeof value === 'bigint') {
            if (Number(value) === 0)
                continue;
            return true;
        }
        if (typeof value === 'boolean') {
            if (!value)
                continue;
            return true;
        }
        return true;
    }
    return false;
}
/** 响应映射求值为字符串：数组会拼成一个串（部分上游把文本分成多段返回） */
function manifestResponseString(template, env) {
    if (template === undefined || template === null)
        return '';
    let value;
    try {
        value = (0, expression_1.evaluateManifestValue)(template, env);
    }
    catch {
        return '';
    }
    return (0, expression_1.manifestArray)(value)
        .map((item) => (0, expression_1.manifestString)(item).trim())
        .filter((text) => text !== '')
        .join('');
}
/** 响应映射求值为媒体引用 */
function manifestResponseMedia(template, env, kind, ephemeral) {
    if (template === undefined || template === null)
        return [];
    let value;
    try {
        value = (0, expression_1.evaluateManifestValue)(template, env);
    }
    catch {
        return [];
    }
    return (0, request_1.mediaReferencesFromManifestValue)(value, kind, ephemeral);
}
function firstPathJSONValue(payload, paths) {
    for (const path of paths ?? []) {
        const value = (0, expression_1.manifestPathValue)(payload, path);
        if (value === null || value === undefined)
            continue;
        if (typeof value === 'string') {
            if (value.trim() !== '')
                return value.trim();
            continue;
        }
        try {
            const encoded = JSON.stringify(value);
            if (encoded)
                return encoded;
        }
        catch {
            // 循环引用等不可序列化值：跳过，继续下一个路径
        }
    }
    return '';
}
function firstNonNilPathValue(payload, paths) {
    for (const path of paths) {
        const value = (0, expression_1.manifestPathValue)(payload, path);
        if (value !== null && value !== undefined)
            return value;
    }
    return null;
}
const MD_IMAGE_PATTERN = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const HTML_VIDEO_PATTERN = /<video[^>]+src=['"]([^'"]+)['"]/gi;
/**
 * 从单个路径提取媒体地址：字符串里可能是 Markdown 图片或 HTML video，
 * 数组元素可能是字符串或带 url 字段的对象。
 */
function mediaPathValues(payload, path) {
    const value = (0, expression_1.manifestPathValue)(payload, path);
    if (typeof value === 'string') {
        const text = value.trim();
        if (text === '')
            return [];
        const mdMatches = [...text.matchAll(MD_IMAGE_PATTERN)].map((match) => match[1]).filter(Boolean);
        if (mdMatches.length > 0)
            return mdMatches;
        const videoMatches = [...text.matchAll(HTML_VIDEO_PATTERN)].map((match) => match[1]).filter(Boolean);
        if (videoMatches.length > 0)
            return videoMatches;
        return [text];
    }
    if (!Array.isArray(value))
        return [];
    const result = [];
    for (const item of value) {
        if (typeof item === 'string') {
            if (item.trim() !== '')
                result.push(item.trim());
            continue;
        }
        if (item && typeof item === 'object') {
            for (const key of ['url', 'file_url', 'fileUrl', 'video_url', 'videoUrl', 'image_url', 'imageUrl']) {
                const candidate = item[key];
                if (typeof candidate === 'string' && candidate.trim() !== '') {
                    result.push(candidate.trim());
                    break;
                }
            }
        }
    }
    return result;
}
/**
 * 拆分连续 JSON 帧。
 *
 * 豆包单向 TTS 用 HTTP chunked 连续输出 JSON 对象，网关还可能包一层
 * `data:` 行。先用括号扫描按序解析；解析不出时退回逐行 SSE 解析。
 */
function decodeJSONFrames(body) {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    const frames = [];
    let rest = text;
    let consumedAll = true;
    for (;;) {
        rest = rest.replace(/^\s+/, '');
        if (rest === '')
            break;
        const end = scanJsonValueEnd(rest);
        if (end < 0) {
            consumedAll = false;
            break;
        }
        const frame = safeParseObject(rest.slice(0, end));
        if (!frame) {
            consumedAll = false;
            break;
        }
        frames.push(frame);
        rest = rest.slice(end);
    }
    if (consumedAll && rest.trim() === '' && frames.length > 0)
        return frames;
    const lineFrames = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\r$/, '').replace(/^data:/, '').trim();
        if (line === '' || line === '[DONE]')
            continue;
        const frame = safeParseObject(line);
        if (!frame)
            throw new Error('流式 JSON 音频响应无法解析');
        lineFrames.push(frame);
    }
    if (frames.length === 0)
        return lineFrames;
    return frames.concat(lineFrames);
}
/** 返回从 0 开始的第一个完整 JSON 值的结束下标；不是 JSON 起点返回 -1 */
function scanJsonValueEnd(text) {
    if (text[0] !== '{' && text[0] !== '[')
        return -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{' || char === '[')
            depth += 1;
        else if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0)
                return index + 1;
        }
    }
    return -1;
}
function safeParseObject(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
}
function decodeStreamedAudioBase64(value) {
    const text = String(value ?? '').trim();
    if (text === '')
        return Buffer.alloc(0);
    try {
        return Buffer.from(text, 'base64');
    }
    catch (error) {
        throw new Error(`流式音频片段不是合法 base64：${error.message}`);
    }
}
function streamedAudioMIMEType(format) {
    switch (String(format ?? '').trim().toLowerCase()) {
        case 'wav':
            return 'audio/wav';
        case 'ogg_opus':
        case 'ogg':
            return 'audio/ogg';
        case 'pcm':
            return 'audio/pcm';
        default:
            return 'audio/mpeg';
    }
}
/** 逐帧 JSON 音频流 → 单个音频结果 */
function streamedJSONAudioCreateResult(body, format) {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    if (bytes.length === 0)
        throw new Error('流式音频响应为空');
    if (bytes.length > MAX_STREAMED_JSON_AUDIO_BYTES) {
        throw new Error(`流式音频响应超过 ${MAX_STREAMED_JSON_AUDIO_BYTES} 字节`);
    }
    const frames = decodeJSONFrames(bytes);
    const chunks = [];
    let usage = null;
    for (const frame of frames) {
        const code = (0, expression_1.manifestString)(firstNonNilPathValue(frame, ['code', 'status_code', 'statusCode'])).trim().toLowerCase();
        if (code !== '' && !['0', 'ok', 'success', 'succeeded'].includes(code)) {
            const message = (0, expression_1.manifestString)(firstNonNilPathValue(frame, ['message', 'msg', 'error.message'])).trim();
            throw new Error(`流式音频合成失败（code ${code}）：${message || '上游返回失败状态'}`);
        }
        const chunk = (0, request_1.firstPathValue)(frame, 'data', 'audio', 'audio.data');
        if (chunk !== '')
            chunks.push(decodeStreamedAudioBase64(chunk));
        const rawUsage = firstNonNilPathValue(frame, ['usage']);
        if (rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage))
            usage = rawUsage;
    }
    const audio = Buffer.concat(chunks);
    if (audio.length === 0)
        throw new Error('流式音频响应不含音频数据');
    const mimeType = streamedAudioMIMEType(format);
    return {
        status: 'succeeded',
        result: { audios: [{ dataUrl: `data:${mimeType};base64,${audio.toString('base64')}`, mimeType }], usage: usage ?? undefined },
    };
}
/**
 * 二进制响应体 → 单个媒体结果。
 * MIME 一律按字节魔数判定：上游常直接返回无扩展名链接或裸字节，
 * 按 URL 后缀猜会把 PNG 当 JPEG 存储。
 */
function binaryPayloadCreateResult(resultKind, body) {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'binary') : body;
    if (bytes.length === 0)
        throw new Error('二进制响应体为空');
    const mimeType = detectBinaryMimeType(bytes);
    const reference = {
        dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
        mimeType,
        kind: resultKind,
    };
    const result = {};
    if (resultKind === 'audio')
        result.audios = [reference];
    else if (resultKind === 'image')
        result.images = [reference];
    else if (resultKind === 'video')
        result.videos = [reference];
    else
        throw new Error(`二进制响应需要 resultKind 为 image / video / audio，收到 "${resultKind}"`);
    return { status: 'succeeded', result };
}
/** 字节魔数识别常见媒体类型；识别不了按二进制流处理 */
function detectBinaryMimeType(bytes) {
    const ascii = (start, length) => bytes.subarray(start, start + length).toString('latin1');
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')
        return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP')
        return 'image/webp';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE')
        return 'audio/wav';
    if (ascii(4, 4) === 'ftyp') {
        const brand = ascii(8, 4).toLowerCase();
        if (brand.startsWith('m4a') || brand.startsWith('mp4a'))
            return 'audio/mp4';
        return 'video/mp4';
    }
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        return 'video/webm';
    }
    if (ascii(0, 4) === 'OggS')
        return 'audio/ogg';
    if (ascii(0, 3) === 'ID3')
        return 'audio/mpeg';
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
        return 'audio/mpeg';
    if (ascii(0, 4) === '%PDF')
        return 'application/pdf';
    return 'application/octet-stream';
}
/** 工具调用响应解析：文本、推理与工具调用列表 */
function parseAgentResponse(body, response) {
    const payload = decodeObject(body);
    const result = {
        text: (0, request_1.firstPathValue)(payload, ...(response.textPaths ?? [])),
        reasoning: (0, request_1.firstPathValue)(payload, ...(response.reasoningPaths ?? [])),
        toolCalls: [],
    };
    const toolCallsPath = String(response.toolCallsPath ?? '').trim();
    if (toolCallsPath === '')
        return result;
    const rawCalls = (0, expression_1.manifestPathValue)(payload, toolCallsPath);
    const calls = Array.isArray(rawCalls) ? rawCalls : [];
    calls.forEach((item, index) => {
        if (!item || typeof item !== 'object')
            return;
        const call = {
            id: (0, request_1.firstPathValue)(item, ...(response.toolCallIdPaths ?? [])),
            name: (0, request_1.firstPathValue)(item, ...(response.toolCallNamePaths ?? [])),
            arguments: firstPathJSONValue(item, response.toolCallArgumentsPaths),
            thoughtSignature: (0, request_1.firstPathValue)(item, ...(response.toolCallThoughtSignaturePaths ?? [])),
        };
        if (call.name.trim() === '')
            return;
        if (call.id.trim() === '')
            call.id = syntheticAgentToolCallId(body, index);
        result.toolCalls.push(call);
    });
    return result;
}
/** 上游没给工具调用 id 时生成稳定 id：同样响应重启后仍是同一个 */
function syntheticAgentToolCallId(body, index) {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    const digest = (0, node_crypto_1.createHash)('sha256').update(`${text}#${index}`).digest('hex');
    return `call_${digest.slice(0, 16)}`;
}
/** 共用：把响应映射的原始字段整理成 PollResult 需要的形状 */
function pickQueueAhead(template, env) {
    if (template === undefined || template === null)
        return -1;
    try {
        const value = (0, expression_1.evaluateManifestValue)(template, env);
        if (value === null || value === undefined)
            return -1;
        return Math.max(0, (0, expression_1.manifestInt)(value));
    }
    catch {
        return -1;
    }
}
//# sourceMappingURL=response.js.map