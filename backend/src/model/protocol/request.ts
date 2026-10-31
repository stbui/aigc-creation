/**
 * 声明式清单的请求求值。
 *
 * 逐条移植 open-ai-canvas `internal/protocol/manifest_request.go` 与
 * `image_parameters.go` 的 `ApplyImageParameters`。职责只有一件：把清单里的
 * 表达式、查询、文件与变换（transform）代入任务输入，得到一条待发送请求。
 *
 * 所有取值都经过路径白名单与类型规范化 —— 清单来自可上传的插件包，
 * 求值过程不得产生可执行代码、不得拼出绝对 URL（`isRelativePath` 兜底），
 * 否则插件就能把渠道凭证发到自己的服务器。
 */

import {
  evaluateManifestValue,
  interpolateManifestString,
  manifestArray,
  manifestFloat,
  manifestInt,
  manifestPathValue,
  manifestString,
  manifestTruthy,
  type ManifestEnv,
} from './expression';
import type { ManifestAuth, ManifestFilePart, ManifestOperation } from './types';
import type {
  GenerationRequest,
  MediaReference,
  ProtocolRequestFilePart,
  ProtocolRequestSpec,
} from './runtime';
import { imageParameterAccepts, imageParameterAppliesTo, type ImageParameter } from '../domain/image-parameters';

/** 宿主执行上传步骤后写入 `MediaReference.metadata` 的上游素材 ID 键 */
export const MEDIA_UPLOAD_ID_KEY = 'uploadId';

/** 取第一个非空白字符串（Go `defaultValue(value, fallback)`） */
export function defaultValue(value: string | undefined | null, fallback = ''): string {
  return String(value ?? '').trim() === '' ? fallback : String(value);
}

/** 按顺序取对象里第一个非空白字符串字段 */
export function firstString(payload: Record<string, any> | null | undefined, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/** 按路径顺序取第一个非空白字符串值 */
export function firstPathValue(payload: Record<string, any>, ...paths: string[]): string {
  for (const path of paths) {
    const value = manifestPathValue(payload, path);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/** 路径必须是相对路径：以 `/` 开头、无协议、无主机 */
export function isRelativePath(path: string): boolean {
  const text = String(path ?? '').trim();
  if (!text.startsWith('/') || text.startsWith('//')) return false;
  const pathname = text.split('?')[0].split('#')[0];
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  // 任何 `scheme:` 前缀（含 `javascript:`、`data:`）都拒绝
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text);
}

/**
 * 上游模型键的规范化形式：去掉 `模型前缀::`，转小写。
 * 模型级 transform（omit_if_model_contains 等）全部以它为准。
 */
export function manifestModelID(request: GenerationRequest): string {
  const model = String(request.model ?? '').trim();
  const separator = model.lastIndexOf('::');
  return (separator >= 0 ? model.slice(separator + 2) : model).toLowerCase();
}

/** 平台请求的 JSON 形态投影：清单模板只能通过它读取任务输入 */
export function manifestRequestValues(request: GenerationRequest): Record<string, any> {
  const userContent: any[] = [];
  if (String(request.prompt ?? '').trim() !== '') {
    userContent.push({ type: 'text', text: request.prompt });
  }
  for (const image of request.images ?? []) {
    const value = defaultValue(image.url, image.dataUrl);
    if (value !== '') userContent.push({ type: 'image_url', image_url: { url: value } });
  }
  for (const video of request.videos ?? []) {
    const value = defaultValue(video.url, video.dataUrl);
    if (value !== '') userContent.push({ type: 'video_url', video_url: { url: value } });
  }
  for (const audio of request.audios ?? []) {
    const value = defaultValue(audio.url, audio.dataUrl);
    if (value !== '') userContent.push({ type: 'audio_url', audio_url: { url: value } });
  }
  const messages: any[] = [];
  /*
   * `instructions` 是统一的系统指令字段，但多数 OpenAI 系协议只映射 messages。
   * 系统指令必须进入消息数组，否则会被静默丢弃；带独立 system 字段的协议在自己的
   * 模板里过滤 system 角色，不会重复发送。
   */
  const instructions = String(request.instructions ?? '').trim();
  if (instructions !== '' && !hasSystemMessage(request.messages)) {
    messages.push({ role: 'system', content: instructions });
  }
  for (const message of request.messages ?? []) {
    if (!String(message?.role ?? '').trim() || message?.content === undefined || message?.content === null) continue;
    messages.push({ role: message.role, content: message.content });
  }
  if (userContent.length > 0) {
    const mediaCount = (request.images?.length ?? 0) + (request.videos?.length ?? 0) + (request.audios?.length ?? 0);
    messages.push({ role: 'user', content: userContent.length === 1 && mediaCount === 0 ? request.prompt : userContent });
  }

  let inputs = request.inputs ?? [];
  if (inputs.length === 0) {
    inputs = [...(request.images ?? []), ...(request.videos ?? []), ...(request.audios ?? [])];
  }
  const output = {
    count: request.output?.count || request.imageCount || 0,
    duration: request.output?.duration || request.duration || 0,
    aspectRatio: request.output?.aspectRatio || request.aspectRatio || '',
    width: request.output?.width,
    height: request.output?.height,
    resolution: request.output?.resolution || request.resolution || '',
    quality: request.output?.quality || request.quality || '',
    fps: request.output?.fps,
    generateAudio: Boolean(request.output?.generateAudio || request.generateAudio),
    watermark: Boolean(request.output?.watermark || request.watermark),
    format: request.output?.format,
    options: request.output?.options ?? {},
  };

  return {
    capability: request.capability ?? '',
    model: request.model ?? '',
    prompt: request.prompt ?? '',
    instructions: request.instructions ?? '',
    messages,
    inputs: manifestMediaValues(inputs),
    images: manifestMediaValues(request.images ?? []),
    videos: manifestMediaValues(request.videos ?? []),
    audios: manifestMediaValues(request.audios ?? []),
    imageCount: request.imageCount ?? 0,
    duration: request.duration ?? 0,
    aspectRatio: request.aspectRatio ?? '',
    resolution: request.resolution ?? '',
    quality: request.quality ?? '',
    generateAudio: Boolean(request.generateAudio),
    watermark: Boolean(request.watermark),
    operation: request.operation ?? '',
    output,
    providerOptions: request.providerOptions ?? {},
    extra: request.extra ?? {},
  };
}

function hasSystemMessage(messages: Array<{ role?: string }> | undefined): boolean {
  return (messages ?? []).some((message) => String(message?.role ?? '').trim().toLowerCase() === 'system');
}

/** 素材统一投影：清单通过 `request.images[i].value` 取 url / dataUrl */
export function manifestMediaValues(values: MediaReference[]): any[] {
  return values.map((value, index) => {
    const order = value.order === undefined || value.order === 0 ? (index > 0 ? index : 0) : value.order;
    const resolved = defaultValue(value.url, value.dataUrl);
    const uploadId = value.metadata ? manifestString(value.metadata[MEDIA_UPLOAD_ID_KEY]) : '';
    return {
      uploadId,
      id: value.id ?? '',
      url: value.url ?? '',
      dataUrl: value.dataUrl ?? '',
      value: resolved,
      kind: value.kind ?? '',
      role: value.role ?? '',
      mimeType: value.mimeType ?? '',
      name: value.name ?? '',
      order,
      weight: value.weight ?? 0,
      metadata: value.metadata ?? {},
      source: {
        type: value.dataUrl ? 'data' : value.url ? 'url' : 'unknown',
        value: resolved,
        mimeType: value.mimeType ?? '',
      },
      ephemeral: Boolean(value.ephemeral),
    };
  });
}

/**
 * 旧版 `fields` 表达式：`request.x.y | transform` 形式。
 * 新插件一律用 `body` + `$` 操作符，这里只为存量清单保留。
 */
export function manifestExpressionValue(expression: string, request: GenerationRequest, taskId: string): any {
  const trimmed = String(expression ?? '').trim();
  let source = trimmed;
  let transforms: string[] = [];
  const separator = trimmed.indexOf('|');
  if (separator >= 0) {
    source = trimmed.slice(0, separator).trim();
    transforms = trimmed.slice(separator + 1).split('|');
  }
  let value: any;
  if (source === 'taskId') {
    value = taskId;
  } else if (source.startsWith('request.')) {
    value = manifestPathValue(manifestRequestValues(request), source.slice('request.'.length));
  } else {
    value = source;
  }
  for (const transform of transforms) {
    value = applyManifestTransform(value, transform, request);
    if (value === null || value === undefined) break;
  }
  return value;
}

/**
 * 字段变换。`omit_*` 系列返回 null 表示「此字段不下发」，
 * 其余未知变换原样返回 —— 变换拼错不会悄悄改值，只会保留原值。
 */
export function applyManifestTransform(value: any, transform: string, request: GenerationRequest): any {
  const name = String(transform ?? '').trim().toLowerCase();
  if (name === 'bool' || name === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      return text === 'true' || text === '1' || text === 'yes';
    }
    if (typeof value === 'number' || typeof value === 'bigint') return Number(value) !== 0;
    return false;
  }
  if (name === 'int' || name === 'integer') {
    if (typeof value === 'number') return Math.trunc(value);
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.trim(), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
  if (name === 'omit_zero') {
    if (typeof value === 'number' || typeof value === 'bigint') {
      if (Number(value) === 0) return null;
    } else if (typeof value === 'string') {
      const text = value.trim();
      if (text === '0' || text === '') return null;
    }
  }
  const model = manifestModelID(request);
  if (name.startsWith('omit_unless_model_contains:')) {
    const needle = name.slice('omit_unless_model_contains:'.length).trim();
    if (needle === '' || !model.includes(needle)) return null;
  }
  if (name.startsWith('omit_if_model_contains:')) {
    const needle = name.slice('omit_if_model_contains:'.length).trim();
    if (needle !== '' && model.includes(needle)) return null;
  }
  if (name.startsWith('omit_unless_model_equals:')) {
    const target = name.slice('omit_unless_model_equals:'.length).trim();
    if (target === '' || model !== target) return null;
  }
  if (name.startsWith('omit_if_model_equals:')) {
    const target = name.slice('omit_if_model_equals:'.length).trim();
    if (target !== '' && model === target) return null;
  }
  const isString = typeof value === 'string';
  if (name === 'omit_empty' && (!isString || value.trim() === '')) return null;
  if (name === 'omit_auto' && (!isString || value.trim() === '' || ['auto', 'default'].includes(value.trim().toLowerCase()))) {
    return null;
  }
  if (!isString) return value;
  switch (name) {
    case 'trim':
      return value.trim();
    case 'lower':
    case 'lowercase':
      return value.toLowerCase();
    case 'upper':
    case 'uppercase':
      return value.toUpperCase();
    case 'resolution_p':
      return /^\d+$/.test(value.trim()) ? `${value.trim()}p` : value;
    case 'video-resolution':
    case 'video_resolution':
    case 'videoresolution':
      // 兼容已安装的 1.0.1 清单；新插件应声明确切枚举值
      return normalizeLegacyManifestVideoResolution(value);
    default:
      return value;
  }
}

function normalizeLegacyManifestVideoResolution(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return '';
  return /^\d+$/.test(normalized) ? `${normalized}p` : normalized;
}

/**
 * 求值结果是「顺序键对象」时还原成数组。
 * `$indexObject` 造出的 `{"0":..,"1":..}` 必须按数组下发，否则上游收到的是
 * 一个带数字键的对象，多数网关会直接报参数错误。
 */
export function normalizeManifestValue(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeManifestValue);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return value;
    const sequential = keys.every((key, index) => key === String(index));
    if (sequential) {
      return keys.map((key) => normalizeManifestValue(value[key]));
    }
    const result: Record<string, any> = {};
    for (const key of keys) result[key] = normalizeManifestValue(value[key]);
    return result;
  }
  return value;
}

/** 把 `a.b.c` 写进嵌套对象（旧版 fields 使用） */
export function setMapPath(target: Record<string, any>, path: string, value: any): void {
  const parts = String(path ?? '').trim().replace(/^\.+|\.+$/g, '').split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function evaluateManifestStringMap(values: Record<string, any> | undefined, env: ManifestEnv): Record<string, string> | undefined {
  if (!values || Object.keys(values).length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const [key, template] of Object.entries(values)) {
    const text = manifestString(evaluateManifestValue(template, env)).trim();
    if (text !== '') result[key] = text;
  }
  return result;
}

function evaluateManifestQuery(values: Record<string, any> | undefined, env: ManifestEnv): Record<string, string[]> | undefined {
  if (!values || Object.keys(values).length === 0) return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, template] of Object.entries(values)) {
    const value = evaluateManifestValue(template, env);
    for (const item of manifestArray(value)) {
      const text = manifestString(item).trim();
      if (text === '') continue;
      (result[key] ??= []).push(text);
    }
  }
  return result;
}

function evaluateManifestFiles(parts: ManifestFilePart[] | undefined, env: ManifestEnv): ProtocolRequestFilePart[] {
  const result: ProtocolRequestFilePart[] = [];
  for (const part of parts ?? []) {
    const source = evaluateManifestValue(part.source, env);
    const filename = evaluateManifestValue(part.filename, env);
    const mimeType = evaluateManifestValue(part.mimeType, env);
    for (const [index, value] of manifestArray(source).entries()) {
      for (const reference of mediaReferencesFromManifestValue(value, 'file', false)) {
        const name = manifestString(filename).trim() || reference.name || `${part.name}-${index + 1}`;
        const contentType = manifestString(mimeType).trim() || reference.mimeType || '';
        result.push({ name: part.name, filename: name, mimeType: contentType, reference });
      }
    }
  }
  return result;
}

/**
 * 组装一条待发送请求。
 *
 * `extra` 是宿主为单次请求追加的只读变量（如上传步骤的当前 `media`），
 * 不能覆盖 `request` / `taskId` —— 否则插件可以伪造任务输入。
 */
export function buildManifestOperation(
  operation: ManifestOperation,
  auth: ManifestAuth | undefined,
  request: GenerationRequest,
  taskId: string,
  extra?: Record<string, any>,
): ProtocolRequestSpec {
  return buildManifestOperationWithEnv(operation, auth, request, taskId, extra);
}

export function buildManifestOperationWithEnv(
  operation: ManifestOperation,
  auth: ManifestAuth | undefined,
  request: GenerationRequest,
  taskId: string,
  extra?: Record<string, any>,
): ProtocolRequestSpec {
  const env: ManifestEnv = { request: manifestRequestValues(request), taskId };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!(key in env)) env[key] = value;
  }

  let body: any;
  if (operation.body !== undefined && operation.body !== null) {
    body = normalizeManifestValue(evaluateManifestValue(operation.body, env));
  } else if (operation.fields && Object.keys(operation.fields).length > 0) {
    const legacy: Record<string, any> = {};
    for (const [key, expression] of Object.entries(operation.fields)) {
      const value = manifestExpressionValue(expression, request, taskId);
      if (value === null || value === undefined) continue;
      setMapPath(legacy, key, value);
    }
    body = normalizeManifestValue(legacy);
  }

  const pathTemplate = operation.pathTemplate ?? operation.path ?? '';
  const evaluatedPath = manifestString(evaluateManifestValue(pathTemplate, env));
  let path = evaluatedPath.split('{{taskId}}').join(encodeURIComponent(taskId));
  // 上游模型键常含路径分段（如 openai/gpt-image/edit）：逐段转义后保留清单里
  // 故意写出的 `/` 分隔符。
  const escapedModel = encodeURIComponent(String(request.model ?? '')).replace(/%2F/gi, '/');
  path = path.split('{{model}}').join(escapedModel);
  path = interpolateManifestString(path, env);
  if (!isRelativePath(path)) {
    throw new Error(`求值后的请求路径必须是相对路径：${path}`);
  }

  const headers = evaluateManifestStringMap(operation.headers, env);
  const query = evaluateManifestQuery(operation.query, env);
  const files = evaluateManifestFiles(operation.files, env);
  const contentTypeTemplate = operation.contentTypeTemplate ?? operation.contentType ?? '';
  const contentType = defaultValue(manifestString(evaluateManifestValue(contentTypeTemplate, env)), 'application/json');

  return {
    method: String(operation.method ?? '').trim().toUpperCase(),
    path,
    originPath: Boolean(operation.originPath),
    contentType,
    headers,
    query,
    body,
    files: files.length > 0 ? files : undefined,
    auth,
  };
}

/**
 * 把后台声明的图片参数投影进统一请求。
 *
 * 只映射插件声明过的目标（`binding`）；`false` 与 `0` 必须保留，
 * 用 `||` 取值会把「显式关闭」变成「未设置」。
 */
export function applyImageParameters(request: GenerationRequest, definitions: ImageParameter[] | undefined): GenerationRequest {
  if (request.capability !== 'image' || request.imageParameters === undefined || request.imageParameters === null) {
    return request;
  }
  const allowed = new Map<string, ImageParameter>();
  for (const parameter of definitions ?? []) {
    if (imageParameterAppliesTo(parameter, request.model)) allowed.set(parameter.name, parameter);
  }
  const providerOptions = { ...(request.providerOptions ?? {}) };
  const extra = { ...(request.extra ?? {}) };
  for (const [name, value] of Object.entries(request.imageParameters)) {
    const parameter = allowed.get(name);
    if (!parameter || !imageParameterAccepts(parameter, value)) {
      throw new Error(`不支持的图片参数：${name}`);
    }
    if (value === undefined || value === null) continue;
    const binding = parameter.binding ?? '';
    if (binding === 'aspectRatio') request.aspectRatio = manifestString(value);
    else if (binding === 'resolution') request.resolution = manifestString(value);
    else if (binding === 'quality') request.quality = manifestString(value);
    else if (binding === 'imageCount') request.imageCount = Math.trunc(manifestFloat(value));
    else if (binding === 'transparentBackground') extra.transparentBackground = manifestString(value);
    else {
      const parts = binding.split('.');
      if (parts.length !== 3 || parts[0] !== 'providerOptions') {
        throw new Error(`图片参数 ${name} 没有请求绑定`);
      }
      providerOptions[parts[1]] = { ...(providerOptions[parts[1]] ?? {}), [parts[2]]: value };
    }
  }
  return { ...request, providerOptions, extra };
}

/** 按清单声明的规则校验请求；不满足时抛出可读原因 */
export function validateManifestRequest(
  rules: Array<{ assert: any; message: string }> | undefined,
  request: GenerationRequest,
): void {
  if (!rules || rules.length === 0) return;
  const env: ManifestEnv = { request: manifestRequestValues(request) };
  for (const rule of rules) {
    if (!manifestTruthy(evaluateManifestValue(rule.assert, env))) {
      throw new Error(String(rule.message ?? '').trim());
    }
  }
}

/**
 * 从响应值提取媒体引用。
 *
 * 兼容四种上游形态：纯字符串（URL 或 data URL）、对象（`url` / `dataUrl` /
 * `b64_json` 等常见键）、裸 base64（OpenAI / Ark 的 `b64_json`）、以及
 * `ephemeral` 标记的临时地址。
 */
export function mediaReferencesFromManifestValue(value: any, kind: string, ephemeral: boolean): MediaReference[] {
  const result: MediaReference[] = [];
  for (const item of manifestArray(value)) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed === '') continue;
      result.push(trimmed.startsWith('data:') ? { kind, ephemeral, dataUrl: trimmed } : { kind, ephemeral, url: trimmed });
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, any>;
      const reference: MediaReference = {
        id: manifestString(record.id),
        url: manifestString(record.url),
        dataUrl: manifestString(record.dataUrl),
        kind: defaultValue(manifestString(record.kind), kind),
        role: manifestString(record.role),
        mimeType: manifestString(record.mimeType),
        name: manifestString(record.name),
        order: manifestInt(record.order),
        weight: manifestFloat(record.weight),
        ephemeral: ephemeral || manifestTruthy(record.ephemeral),
      };
      if (reference.url === '') {
        reference.url = firstString(record, 'file_url', 'fileUrl', 'image_url', 'imageUrl', 'video_url', 'videoUrl', 'audio_url', 'audioUrl', 'uri');
      }
      if (reference.dataUrl === '') {
        reference.dataUrl = firstString(record, 'data_url', 'b64_json');
      }
      // OpenAI / Ark 常直接返回裸 b64：声明式结果下载要求 data URL
      reference.dataUrl = normalizeManifestInlineDataURL(
        reference.dataUrl ?? '',
        reference.kind ?? '',
        firstString(record, 'output_format', 'mime_type', 'mimeType'),
      );
      if (reference.url !== '' || reference.dataUrl !== '') result.push(reference);
    }
  }
  return result;
}

/** 裸 base64 补全成 data URL；已是 data URL 的原样返回 */
export function normalizeManifestInlineDataURL(value: string, kind: string, formatHint: string): string {
  const text = String(value ?? '').trim();
  if (text === '' || text.startsWith('data:')) return text;
  return `data:${manifestInlineMediaMIME(kind, formatHint)};base64,${text}`;
}

function manifestInlineMediaMIME(kind: string, formatHint: string): string {
  const hint = String(formatHint ?? '').trim().toLowerCase();
  const exact = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'video/mp4',
    'video/webm',
  ];
  if (exact.includes(hint)) return hint;
  const aliases: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'audio/mp3': 'audio/mpeg',
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    mpeg: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  if (aliases[hint]) return aliases[hint];
  const normalizedKind = String(kind ?? '').trim().toLowerCase();
  if (normalizedKind === 'audio') return 'audio/mpeg';
  if (normalizedKind === 'video') return 'video/mp4';
  return 'image/png';
}
