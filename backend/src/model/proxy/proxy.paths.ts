/**
 * 中转入口的路径与授权规则 —— 代理子系统里**唯一**决定「这个请求能不能发出去」的地方。
 *
 * 移植自 open-ai-canvas `internal/handler/security.go` 的 `authorizeCustomRelay` /
 * `authorizeSystemProxy` / `shortSystemProxyPath` 与 `auth.go` 的短路径逻辑。
 *
 * 三条硬约束：
 *   1. **白名单而不是黑名单**：中转只放行协议真正声明过的端点，未登记的路径直接 403。
 *      上游若是通用 OpenAI 网关，放行任意路径等于给攻击者一个开放的出站代理；
 *   2. **路径先规范化再判定**：解码百分号、拒绝反斜杠与空字节、要求 `path.Clean`
 *      不变形，否则 `..%2f` 之类可以绕过路径族匹配；
 *   3. **短路径必须让出保留前缀**：`/api/v1/tasks/*` 之类的业务路由不能因为
 *      没命中具体处理器就被当成渠道 id —— 那会把「接口不存在」变成「渠道不存在」。
 */

/** 短路径中转不可占用的顶级路径段（已有业务路由或系统保留） */
const RESERVED_API_PREFIXES = new Set([
  'account',
  'admin',
  'agent',
  'aigc-label',
  'ai',
  'announcements',
  'assets',
  'auth',
  'capabilities',
  'channels',
  'credits',
  'generate',
  'health',
  'invoices',
  'marketing',
  'me',
  'membership',
  'mobile-upload',
  'model-catalog',
  'models',
  'notifications',
  'orders',
  'payments',
  'products',
  'projects',
  'prompt-tools',
  'public',
  'stats',
  'tasks',
  'test',
  'tickets',
  'uploads',
]);

/** 中转的协议族：决定端口白名单、鉴权头与默认版本前缀 */
export type ProxyFamily = 'openai' | 'claude' | 'gemini' | 'minimax-video' | 'agnes';

export interface ProtocolProxyRule {
  family: ProxyFamily;
  /**
   * 允许 POST 的路径后缀（规范化后按 `endsWith` 匹配）；
   * `null` 表示该协议走专用判定（gemini / minimax / agnes），不看这个字段。
   */
  endpoints: string[] | null;
  /** 缺失版本前缀时补的默认值：Gemini 是 `/v1beta`，其余 `/v1` */
  defaultPrefix: string;
}

/** OpenAI 兼容的默认端点集（与参考实现 `openAIPostEndpoints` 对齐） */
const OPENAI_ENDPOINTS = [
  '/chat/completions',
  '/responses',
  '/images/generations',
  '/images/edits',
  '/audio/speech',
  '/messages',
];

/** 各协议对端点集的收窄：键是协议 id（插件 provider.id） */
const ENDPOINT_OVERRIDES: Record<string, string[]> = {
  'chat-completion': ['/chat/completions'],
  'openai-response': ['/responses'],
  'claude-api': ['/messages'],
  'openai-image': ['/images/generations', '/images/edits'],
  'grok-image': ['/images/generations', '/images/edits'],
  'volcengine-ark-image': ['/images/generations'],
  'volcengine-ark-agent-plan-image': ['/images/generations'],
  'openai-audio': ['/audio/speech'],
  'minimax-text-native': ['/text/chatcompletion_v2'],
};

const GEMINI_PROTOCOLS = new Set(['gemini-generate-content', 'gemini-image', 'gemini-veo']);
const MINIMAX_VIDEO_PROTOCOLS = new Set(['minimax-video']);
const AGNES_PROTOCOLS = new Set(['agnes-video', 'agnes-video-v20']);
const CLAUDE_PROTOCOLS = new Set(['claude-api']);

/**
 * 解析协议的代理规则；`null` = 该协议不允许经中转调用。
 *
 * 拒绝面（不用白名单猜的几种）：
 *   · 需要签名的协议（`requiresSecretKey`：AWS SigV4 / 火山 v4 / 腾讯 TC3）——
 *     中转只能注入静态头，重放签名必然失败，还会把「签名错误」伪装成上游故障；
 *   · 异步轮询协议（视频 / 队列类）—— 用户直连时拿不到任务归属与轮询凭证，
 *     这些能力必须走 `/generate` 任务链路；
 *   · 没有声明 create 路径的协议。
 */
export function protocolProxyRule(input: {
  protocol: string;
  capabilities: string[];
  async: boolean;
  requiresSecretKey: boolean;
  /** 清单里可能不声明 create（仅运营展示用），缺失时按「不可中转」处理 */
  create?: string;
}): ProtocolProxyRule | null {
  const protocol = String(input.protocol ?? '').trim();
  if (!protocol) return null;
  if (input.requiresSecretKey) return null;
  if (!String(input.create ?? '').trim()) return null;

  if (GEMINI_PROTOCOLS.has(protocol)) {
    return { family: 'gemini', endpoints: null, defaultPrefix: '/v1beta' };
  }
  if (MINIMAX_VIDEO_PROTOCOLS.has(protocol)) {
    return { family: 'minimax-video', endpoints: null, defaultPrefix: '/v1' };
  }
  if (AGNES_PROTOCOLS.has(protocol)) {
    return { family: 'agnes', endpoints: null, defaultPrefix: '/v1' };
  }
  if (CLAUDE_PROTOCOLS.has(protocol)) {
    return { family: 'claude', endpoints: ['/messages'], defaultPrefix: '/v1' };
  }
  // 异步协议一律不走中转：任务归属、轮询与结果下载都在任务链路里
  if (input.async) return null;
  // 视频能力当前全部是异步协议；即使将来出现同步视频，也不在代理白名单里
  if (input.capabilities.includes('video')) return null;

  return {
    family: 'openai',
    endpoints: ENDPOINT_OVERRIDES[protocol] ?? OPENAI_ENDPOINTS,
    defaultPrefix: '/v1',
  };
}

const GEMINI_GENERATE_PATH = /(?:^|\/)models\/([^/:]+):(generateContent|streamGenerateContent|predictLongRunning)$/;
const MINIMAX_QUERY_PATH = /^\/v2\/query\/video_generation\/[^/]+$/;

/**
 * 规范化上游路径：解码、拒绝危险字符、要求 `path.Clean` 不变形。
 *
 * 变形即拒绝（而不是替用户清洗）：`/a/../b` 与 `/a%2f..%2fb` 在上游是不同的
 * 路由，替调用方改写路径会让「他想访问什么」和「我们发了什么」对不上。
 */
export function normalizeProxyPath(raw: string): string {
  const value = String(raw ?? '').trim() || '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ProxyPathError('请求路径无效');
  }
  if (decoded.includes('\\') || decoded.includes('\u0000')) {
    throw new ProxyPathError('请求路径无效');
  }
  const cleaned = cleanPath(decoded);
  if (cleaned !== decoded && cleaned !== `/${decoded.replace(/^\//, '')}`) {
    throw new ProxyPathError('请求路径无效');
  }
  return cleaned;
}

/** 拒绝越权路径时抛这个；控制器据此回 403（而不是被当成 500） */
export class ProxyPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyPathError';
  }
}

function cleanPath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

export interface ShortProxyPath {
  channelId: string;
  providerPath: string;
}

/**
 * 解析短路径 `/api/v1/{channelId}/{providerPath}`。
 *
 * 保留前缀、非法字符与「只有渠道 id 没有后续路径」一律返回 `null`，
 * 由控制器回 404 —— 这与业务路由自身的 404 语义一致。
 */
export function parseShortProxyPath(rawPath: string): ShortProxyPath | null {
  const path = String(rawPath ?? '').trim();
  if (!path.startsWith('/') || path.length < 3) return null;
  const remainder = path.slice(1);
  const separator = remainder.indexOf('/');
  if (separator <= 0 || separator === remainder.length - 1) return null;
  const channelId = remainder.slice(0, separator);
  const providerPath = remainder.slice(separator);
  if (/[?#\\]/.test(channelId) || providerPath.includes('\\')) return null;
  if (RESERVED_API_PREFIXES.has(channelId.toLowerCase())) return null;
  return { channelId, providerPath };
}

/** 是否为保留前缀（短路径控制器用它决定「继续找业务路由」） */
export function isReservedApiPrefix(segment: string): boolean {
  return RESERVED_API_PREFIXES.has(String(segment ?? '').toLowerCase());
}

/**
 * 是否为可能由中转处理的路径 —— 供 `main.ts` 决定「这条请求要不要交给 JSON body-parser」。
 *
 * 中转要原样转发上百 KB 到数十 MB 的 JSON（多模态 messages 内嵌 base64），
 * 全局 body-parser 的 100KB 上限会在处理器之前就 413；因此中转路径必须跳过
 * 全局解析，由 `readProxyBody` 按 `MODEL_PROXY_*` 上限自行读取。
 *
 * 判定与短路径控制器共用同一份保留前缀清单：**保留前缀 = 业务路由**，
 * 其余两段及以上路径 = 中转地域。新增业务路由若忘了登记保留前缀，
 * 该路由的请求体不会被解析 —— 这个后果会在第一次跑该接口时立刻暴露。
 */
export function isProxyRequestPath(rawPath: string, apiPrefix = 'api/v1'): boolean {
  const path = String(rawPath ?? '').split('?')[0];
  const prefix = `/${String(apiPrefix ?? '').replace(/^\/+|\/+$/g, '')}/`;
  if (!path.startsWith(prefix)) return false;
  const segments = path.slice(prefix.length).split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (segments[0].toLowerCase() === 'ai') {
    // `/ai/models` 是普通业务接口（DTO 校验、100KB 上限），不是中转
    return !(segments.length === 2 && segments[1].toLowerCase() === 'models');
  }
  if (segments.length < 2) return false;
  return !isReservedApiPrefix(segments[0]);
}

export interface SystemProxyAuthorization {
  /** 从路径提取到的模型名（Gemini 的 `:generateContent` 形式） */
  modelFromPath: string;
  /** 本次请求对应的协议族 */
  family: ProxyFamily;
  defaultPrefix: string;
}

/**
 * 系统渠道中转的协议授权。
 *
 * @param protocol 渠道模型声明的协议 id
 * @param metadata 该协议的注册表元数据（能力 / 异步 / 签名需求）
 * @param method   请求方法
 * @param path     已规范化的上游路径
 */
export function authorizeSystemProxy(input: {
  protocol: string;
  metadata: { capabilities: string[]; async: boolean; requiresSecretKey: boolean; create?: string } | null;
  method: string;
  path: string;
  /**
   * 渠道 `apiFormat` 对应的鉴权族。
   *
   * 只为 `GET /models` 服务：该请求不涉及任何模型条款，协议 / 渠道模型都可能
   * 无从判断（上游模型清单是渠道级端点），此时按渠道格式决定密钥写哪个头。
   */
  fallbackFamily?: ProxyFamily;
}): SystemProxyAuthorization {
  const method = String(input.method ?? '').toUpperCase();
  const path = input.path;

  // `GET /models` 对任何协议都放行：它是上游模型清单，不涉及模型条款
  if (method === 'GET' && path === '/models') {
    const family = input.fallbackFamily ?? 'openai';
    return { modelFromPath: '', family, defaultPrefix: family === 'gemini' ? '/v1beta' : '/v1' };
  }

  if (!input.metadata) throw new ProxyPathError('当前系统渠道的协议尚未注册，无法中转');
  const rule = protocolProxyRule({ protocol: input.protocol, ...input.metadata });
  if (!rule) throw new ProxyPathError('该协议不支持经中转调用，请使用生成任务');

  if (rule.family === 'gemini') {
    const match = GEMINI_GENERATE_PATH.exec(path);
    if (method !== 'POST' || !match) throw new ProxyPathError('系统渠道不允许访问该上游接口');
    return { modelFromPath: match[1], family: rule.family, defaultPrefix: rule.defaultPrefix };
  }
  if (rule.family === 'minimax-video') {
    if (method === 'GET' && MINIMAX_QUERY_PATH.test(path)) {
      return { modelFromPath: '', family: rule.family, defaultPrefix: rule.defaultPrefix };
    }
    if (method !== 'POST' || path !== '/v2/video_generation') {
      throw new ProxyPathError('系统渠道不允许访问该上游接口');
    }
    return { modelFromPath: '', family: rule.family, defaultPrefix: rule.defaultPrefix };
  }
  if (rule.family === 'agnes') {
    if (method === 'GET' && path === '/agnesapi') {
      return { modelFromPath: '', family: rule.family, defaultPrefix: rule.defaultPrefix };
    }
    if (method !== 'POST' || path !== '/videos') {
      throw new ProxyPathError('系统渠道不允许访问该上游接口');
    }
    return { modelFromPath: '', family: rule.family, defaultPrefix: rule.defaultPrefix };
  }

  if (method !== 'POST') throw new ProxyPathError('系统渠道不允许使用该请求方法');
  const endpoints = rule.endpoints ?? [];
  if (!endpoints.some((endpoint) => path === endpoint || path.endsWith(endpoint))) {
    throw new ProxyPathError('当前接口类型不允许访问该上游接口');
  }
  return { modelFromPath: '', family: rule.family, defaultPrefix: rule.defaultPrefix };
}

/** 自定义中转支持的调用格式（与参考实现一致：openai / gemini / claude） */
export type CustomRelayFormat = 'openai' | 'gemini' | 'claude';

const CUSTOM_GEMINI_PATH = /(?:^|\/)models\/[^/:]+:(generateContent|streamGenerateContent|predictLongRunning)$/;
const CUSTOM_VIDEO_TASK_PATH = /(?:^|\/)video\/generations\/[^/]+$/;
const CUSTOM_XAI_VIDEO_TASK_PATH = /(?:^|\/)videos\/[^/]+$/;
const CUSTOM_VIDEO_CONTENT_PATH = /(?:^|\/)videos\/[^/]+\/content$/;
const CUSTOM_ARK_VIDEO_TASK_PATH = /(?:^|\/)contents\/generations\/tasks\/[^/]+$/;
const CUSTOM_GEMINI_OPERATION_PATH = /(?:^|\/)(?:models\/[^/]+\/)?operations\/[^/]+$/;
const CUSTOM_NOVITA_RESULT_PATH = /(?:^|\/)async\/task-result$/;
const CUSTOM_MINIMAX_TASK_PATH = /(?:^|\/)v2\/query\/video_generation\/[^/]+$/;
const CUSTOM_AGNES_PATH = '/agnesapi';

/** 自定义中转禁止在查询串里携带的密钥参数（与请求头凭证重复，且会被日志记录） */
const SECRET_QUERY_KEYS = new Set(['key', 'api_key', 'access_token', 'token']);

/**
 * 系统渠道中转：从客户端查询串里剥掉密钥参数后保留其余部分。
 *
 * 这是**剥离**不是拒绝：系统渠道的凭证由服务端注入，客户端把 `?key=` 带上来
 * 只是历史 SDK 习惯；原样转发会把用户以为的私钥写进上游访问日志。其余参数
 * （`alt=sse`、`video_id` 等）必须保留，否则会改变请求语义。
 */
export function stripSecretQuery(query: URLSearchParams): URLSearchParams {
  const cleaned = new URLSearchParams();
  for (const [key, value] of query.entries()) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase().trim())) continue;
    cleaned.append(key, value);
  }
  return cleaned;
}

/** MiniMax 视频结果查询路径（没有模型名，只能按协议判定） */
export function isMinimaxVideoQueryPath(path: string): boolean {
  return /^\/v2\/query\/video_generation\/[^/]+$/.test(String(path ?? ''));
}

/**
 * 自定义渠道的上游路径授权。
 *
 * 用户自带地址与密钥，但**出站目标仍是我们发出的**：必须按调用格式收窄到
 * 生成类端点，否则这个接口就是一台开放代理（可被用来扫描内网、刷他人额度）。
 */
export function authorizeCustomRelay(input: {
  method: string;
  path: string;
  query: URLSearchParams;
  format: CustomRelayFormat;
  contentType: string;
}): void {
  const method = String(input.method ?? '').toUpperCase();
  const path = input.path;
  const format = input.format;
  for (const key of input.query.keys()) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase().trim())) {
      throw new ProxyPathError('自定义渠道地址不允许在查询参数中携带密钥');
    }
  }

  if (method === 'GET') {
    if (format === 'openai' && path === CUSTOM_AGNES_PATH) {
      const videoId = input.query.get('video_id');
      const modelName = input.query.get('model_name');
      if (input.query.size === 2 && videoId?.trim() && modelName?.trim()) return;
      throw new ProxyPathError('Agnes 视频查询必须提供 video_id 和 model_name');
    }
    if (CUSTOM_NOVITA_RESULT_PATH.test(path)) {
      if (input.query.size === 1 && input.query.get('task_id')?.trim()) return;
      throw new ProxyPathError('自定义渠道不允许访问该上游接口');
    }
    let allowed = path === '/models' || path.endsWith('/models');
    if (format === 'openai') {
      allowed =
        allowed ||
        CUSTOM_VIDEO_TASK_PATH.test(path) ||
        CUSTOM_XAI_VIDEO_TASK_PATH.test(path) ||
        CUSTOM_VIDEO_CONTENT_PATH.test(path) ||
        CUSTOM_ARK_VIDEO_TASK_PATH.test(path) ||
        CUSTOM_MINIMAX_TASK_PATH.test(path);
    } else if (format === 'gemini') {
      allowed = allowed || CUSTOM_GEMINI_OPERATION_PATH.test(path);
    }
    if (input.query.size !== 0 || !allowed) {
      throw new ProxyPathError('自定义渠道不允许访问该上游接口');
    }
    return;
  }

  if (method !== 'POST') throw new ProxyPathError('自定义渠道不允许使用该请求方法');
  const mediaType = mediaTypeOf(input.contentType);
  if (!mediaType) throw new ProxyPathError('自定义渠道生成请求类型无效');

  if (format === 'openai') {
    const multipartAllowed =
      mediaType === 'multipart/form-data' &&
      (path.endsWith('/images/edits') || path.endsWith('/videos'));
    const jsonAllowed =
      mediaType === 'application/json' &&
      [
        '/responses',
        '/chat/completions',
        '/images/generations',
        '/images/edits',
        '/audio/speech',
        '/video/generations',
        '/videos/generations',
        '/videos',
        '/contents/generations/tasks',
        '/video/create',
        '/v2/video_generation',
      ].some((endpoint) => path.endsWith(endpoint));
    if (input.query.size !== 0 || (!multipartAllowed && !jsonAllowed)) {
      throw new ProxyPathError('自定义渠道不允许访问该上游接口');
    }
    return;
  }

  if (format === 'claude') {
    if (mediaType !== 'application/json' || !path.endsWith('/messages')) {
      throw new ProxyPathError('Claude 自定义渠道只允许 application/json 的 /messages 请求');
    }
    return;
  }

  if (mediaType !== 'application/json') {
    throw new ProxyPathError('Gemini 自定义渠道生成请求必须使用 application/json');
  }
  if (!CUSTOM_GEMINI_PATH.test(path)) {
    throw new ProxyPathError('自定义渠道不允许访问该上游接口');
  }
  if (input.query.size === 0) return;
  if (input.query.size === 1 && input.query.get('alt') === 'sse' && path.endsWith(':streamGenerateContent')) {
    return;
  }
  throw new ProxyPathError('自定义渠道不允许使用该查询参数');
}

/** 从 `Content-Type` 取媒体类型（不引入 mime 依赖：这里只需要主类型） */
export function mediaTypeOf(contentType: string): string {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/**
 * 从请求体提取模型名。
 *
 * 支持 JSON 与 multipart：OpenAI 图像编辑等端点的 `model` 在表单字段里，
 * 只读 JSON 会把它们判成「没指定模型」而拒绝。
 */
export function requestModel(contentType: string, body: Buffer): string {
  const mediaType = mediaTypeOf(contentType);
  if (mediaType.startsWith('multipart/')) {
    const value = multipartField(body, contentType, ['model']);
    return value.replace(/^models\//, '').trim();
  }
  try {
    const payload = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const model = payload?.model;
    return typeof model === 'string' ? model.replace(/^models\//, '').trim() : '';
  } catch {
    return '';
  }
}

/** 从请求体提取视频时长（秒）：`seconds` 优先，其次 `duration` */
export function requestVideoSeconds(contentType: string, body: Buffer): number {
  const mediaType = mediaTypeOf(contentType);
  if (mediaType.startsWith('multipart/')) {
    const raw = multipartField(body, contentType, ['seconds', 'duration']);
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  try {
    const payload = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    for (const key of ['seconds', 'duration']) {
      const value = Number.parseInt(String(payload?.[key] ?? ''), 10);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {
    /* 非 JSON 请求体没有时长字段 */
  }
  return 0;
}

/**
 * 极简 multipart 字段读取：只在内存里按边界切分，不引第三方解析器。
 *
 * 调用方已按中转体积上限读过 body，因此这里不会面对任意大的输入；
 * 找不到字段或边界损坏时返回空串（由上层判「未提供」）。
 */
function multipartField(body: Buffer, contentType: string, names: string[]): string {
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!boundary) return '';
  const delimiter = Buffer.from(`--${boundary}`);
  let offset = body.indexOf(delimiter);
  while (offset >= 0) {
    const partStart = offset + delimiter.length;
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd < 0) break;
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next < 0) break;
    const headers = body.slice(partStart, headerEnd).toString('utf8');
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    if (nameMatch && names.includes(nameMatch[1])) {
      return body.slice(headerEnd + 4, next).toString('utf8').trim();
    }
    offset = next;
  }
  return '';
}

/** 从 Gemini 路径取模型名（`models/gemini-2.5-pro:generateContent`） */
export function geminiModelFromPath(path: string): string {
  const match = GEMINI_GENERATE_PATH.exec(path);
  return match ? match[1].replace(/^models\//, '') : '';
}
