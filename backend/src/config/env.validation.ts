/**
 * 环境变量校验与配置树装配（@nestjs/config 的 `validate` 钩子）。
 *
 * 为什么不用 validationSchema（Joi / class-validator）
 * --------------------------------------------------
 * @nestjs/config 官方校验方案需要额外引入 joi，本项目的依赖纪律是
 * 「版本精确锁定 + 手工直装 + verify-deps 审计」，多一棵依赖树就多一份
 * 漂移风险（README「环境注意事项」第 4 条记录的历史踩坑都源于此）。
 * 因此这里用声明式 schema + 手写 resolver 实现等价的 validate 函数：
 * **零新增依赖**，且错误信息比 Joi 更直指「哪个变量填错了、期望什么」。
 *
 * 本文件的三条硬约束
 * ------------------
 * 1. **绝不改写 process.env。** validate 只产出配置树，现有 5 处直接读
 *    `process.env.X` 的代码（jwt.service / gateway.config / storage.service /
 *    model-config.service / main.ts）行为保持 1:1 不变，不因引入配置层被改语义。
 * 2. **类型错误即启动失败。** `PORT=abc` 这类值在旧代码里会变成 NaN 传给
 *    app.listen()，静默绑到随机端口且极难排查；这里直接抛错并指名变量。
 * 3. **默认值与现有代码逐项一致。** 表中的 default 必须与各处硬编码的兜底
 *    值完全相同，否则等于偷偷改了默认行为。
 */

/** 日志级别，映射到 NestJS LoggerService 的方法优先级 */
export type LogLevel = 'error' | 'warn' | 'log' | 'debug' | 'verbose';

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

/** 声明式配置项。env 为空表示「仅代码内常量，不来自环境变量」 */
interface Spec {
  /** 配置树路径，点号分隔（如 `app.port`），即 ConfigService.get 的入参 */
  key: string;
  /** 环境变量名 */
  env: string;
  type: 'string' | 'number' | 'boolean' | 'csv';
  /** 默认值，必须与现有代码的兜底值逐字一致 */
  def: string | number | boolean | string[];
  /** 允许值白名单（仅对 string 生效） */
  oneOf?: readonly string[];
  /** 数值下界（闭区间），越界视为配置错误 */
  min?: number;
  /** 数值上界（闭区间） */
  max?: number;
}

/**
 * 全部环境变量 —— `.env.example` 的唯一事实源。
 *
 * 新增变量必须同时加到这里，否则它不在配置树里（仍可被 process.env 读到，
 * 但拿不到类型保证，也进不了启动自检摘要）。
 */
export const ENV_SPECS: readonly Spec[] = [
  // ── 应用 ──────────────────────────────────────────────────────────────
  { key: 'app.port', env: 'PORT', type: 'number', def: 4100, min: 1, max: 65535 },
  { key: 'app.host', env: 'HOST', type: 'string', def: '127.0.0.1' },
  { key: 'app.prefix', env: 'API_PREFIX', type: 'string', def: 'api/v1' },
  { key: 'app.env', env: 'NODE_ENV', type: 'string', def: 'development', oneOf: ['development', 'production', 'test'] },

  // ── 数据库（SQLite 文件路径，三环境必须各指各的库）────────────────────
  // 形如 file:./dev.db，相对路径相对进程 cwd（backend/）。默认值与迁移前
  // PrismaService / prisma.config.ts 里硬编码的 'file:./dev.db' 逐字一致。
  { key: 'db.url', env: 'DATABASE_URL', type: 'string', def: 'file:./dev.db' },

  // ── 运行期目录（相对路径相对进程 cwd，绝对路径原样使用）───────────────
  { key: 'path.uploads', env: 'UPLOAD_DIR', type: 'string', def: 'uploads' },
  { key: 'path.backups', env: 'BACKUP_DIR', type: 'string', def: 'backups' },

  // ── CORS（现有 buildCorsAllowList 的默认值，此处只做类型化不参与判定）────
  { key: 'cors.origins', env: 'CORS_ORIGINS', type: 'csv', def: [] },
  { key: 'cors.allowPrivateLan', env: 'CORS_ALLOW_PRIVATE_LAN', type: 'boolean', def: false },

  // ── 鉴权 ──────────────────────────────────────────────────────────────
  { key: 'jwt.secret', env: 'JWT_SECRET', type: 'string', def: 'dev-ecom-vision-secret-2024-do-not-use-in-prod' },
  { key: 'jwt.ttl', env: 'JWT_TTL', type: 'string', def: '7d' },
  // 前端站点基址 —— 邮件里的「重置密码」链接用它拼绝对地址。
  // 与 ASSET_PUBLIC_BASE 分开：后者是给**外部模型网关**拉参考图用的，
  // 需要公网可达；这里只需要用户浏览器能打开。
  { key: 'app.webBase', env: 'WEB_BASE_URL', type: 'string', def: 'http://localhost:5100' },

  // ── 通用 OAuth（第三方登录）───────────────────────────────────────
  // 未配 OAUTH_ENABLED 时，只要凭据齐全就启用；配置后则只放行列出的 provider。
  { key: 'oauth.enabled', env: 'OAUTH_ENABLED', type: 'csv', def: [] },
  // OAuth 回调基址。留空用 WEB_BASE_URL + /api/v1（本地经 Vite 反代可用）。
  { key: 'oauth.callbackBase', env: 'OAUTH_CALLBACK_BASE', type: 'string', def: '' },
  { key: 'oauth.google.clientId', env: 'OAUTH_GOOGLE_CLIENT_ID', type: 'string', def: '' },
  { key: 'oauth.google.clientSecret', env: 'OAUTH_GOOGLE_CLIENT_SECRET', type: 'string', def: '' },
  { key: 'oauth.google.redirectUri', env: 'OAUTH_GOOGLE_REDIRECT_URI', type: 'string', def: '' },
  { key: 'oauth.google.authorizationEndpoint', env: 'OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.google.tokenEndpoint', env: 'OAUTH_GOOGLE_TOKEN_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.google.userinfoEndpoint', env: 'OAUTH_GOOGLE_USERINFO_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.google.scopes', env: 'OAUTH_GOOGLE_SCOPES', type: 'csv', def: ['openid', 'email', 'profile'] },
  { key: 'oauth.github.clientId', env: 'OAUTH_GITHUB_CLIENT_ID', type: 'string', def: '' },
  { key: 'oauth.github.clientSecret', env: 'OAUTH_GITHUB_CLIENT_SECRET', type: 'string', def: '' },
  { key: 'oauth.github.redirectUri', env: 'OAUTH_GITHUB_REDIRECT_URI', type: 'string', def: '' },
  { key: 'oauth.github.authorizationEndpoint', env: 'OAUTH_GITHUB_AUTHORIZATION_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.github.tokenEndpoint', env: 'OAUTH_GITHUB_TOKEN_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.github.scopes', env: 'OAUTH_GITHUB_SCOPES', type: 'csv', def: ['read:user', 'user:email'] },
  { key: 'oauth.generic.name', env: 'OAUTH_GENERIC_NAME', type: 'string', def: 'OAuth 2.0' },
  { key: 'oauth.generic.clientId', env: 'OAUTH_GENERIC_CLIENT_ID', type: 'string', def: '' },
  { key: 'oauth.generic.clientSecret', env: 'OAUTH_GENERIC_CLIENT_SECRET', type: 'string', def: '' },
  { key: 'oauth.generic.redirectUri', env: 'OAUTH_GENERIC_REDIRECT_URI', type: 'string', def: '' },
  { key: 'oauth.generic.authorizationEndpoint', env: 'OAUTH_GENERIC_AUTHORIZATION_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.generic.tokenEndpoint', env: 'OAUTH_GENERIC_TOKEN_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.generic.userinfoEndpoint', env: 'OAUTH_GENERIC_USERINFO_ENDPOINT', type: 'string', def: '' },
  { key: 'oauth.generic.scopes', env: 'OAUTH_GENERIC_SCOPES', type: 'csv', def: ['openid', 'email', 'profile'] },

  // ── 外部消息通道（邮件 / 短信）────────────────────────────────────────
  // 默认 console：不发网络请求，正文写入 logs/outbox/（见 channels/）。
  // 三档实现：console / http（通用网关）/ aliyun（阿里云 SendSms、SingleSendMail）。
  // 填了真实通道却缺凭据会回落 console 并告警，`status().delivers` 如实报 false。
  {
    key: 'channel.email.provider',
    env: 'EMAIL_PROVIDER',
    type: 'string',
    def: 'console',
    oneOf: ['console', 'http', 'aliyun'],
  },
  { key: 'channel.email.apiUrl', env: 'EMAIL_API_URL', type: 'string', def: '' },
  { key: 'channel.email.apiKey', env: 'EMAIL_API_KEY', type: 'string', def: '' },
  { key: 'channel.email.from', env: 'EMAIL_FROM', type: 'string', def: 'noreply@huojue.local' },
  {
    key: 'channel.sms.provider',
    env: 'SMS_PROVIDER',
    type: 'string',
    def: 'console',
    oneOf: ['console', 'http', 'aliyun'],
  },
  { key: 'channel.sms.apiUrl', env: 'SMS_API_URL', type: 'string', def: '' },
  { key: 'channel.sms.apiKey', env: 'SMS_API_KEY', type: 'string', def: '' },
  { key: 'channel.sms.sign', env: 'SMS_SIGN', type: 'string', def: '货觉AI' },
  { key: 'channel.sms.template', env: 'SMS_TEMPLATE', type: 'string', def: '' },

  // 阿里云短信 / 邮件凭据（SMS_PROVIDER=aliyun / EMAIL_PROVIDER=aliyun 时才必需）。
  // AccessKeySecret 只在签名时使用，不落日志、不进审计、不入库。
  { key: 'channel.aliyun.accessKeyId', env: 'ALIYUN_ACCESS_KEY_ID', type: 'string', def: '' },
  { key: 'channel.aliyun.accessKeySecret', env: 'ALIYUN_ACCESS_KEY_SECRET', type: 'string', def: '' },
  /** 短信签名（控制台已审核通过的签名名，不是「短信标题」） */
  { key: 'channel.aliyun.smsSignName', env: 'ALIYUN_SMS_SIGN_NAME', type: 'string', def: '' },
  /** 模板号（SMS_xxxxxxx），模板变量名必须是 code */
  { key: 'channel.aliyun.smsTemplateCode', env: 'ALIYUN_SMS_TEMPLATE_CODE', type: 'string', def: '' },
  /** 地域 id；留空或 cn-hangzhou 走中心域名，其他地域用 dysmsapi.<region>.aliyuncs.com */
  { key: 'channel.aliyun.smsRegion', env: 'ALIYUN_SMS_REGION', type: 'string', def: '' },
  /** 阿里云邮件的发信地址（控制台已配置的那个），缺失即回落 console */
  { key: 'channel.aliyun.dmAccountName', env: 'ALIYUN_DM_ACCOUNT_NAME', type: 'string', def: '' },
  /** 发件人别名（收件箱里显示的名称），留空用发信地址 */
  { key: 'channel.aliyun.dmFromAlias', env: 'ALIYUN_DM_FROM_ALIAS', type: 'string', def: '' },
  /** 1 = 随机账号（发信地址），0 = 批量发信 */
  {
    key: 'channel.aliyun.dmAddressType',
    env: 'ALIYUN_DM_ADDRESS_TYPE',
    type: 'string',
    def: '1',
    oneOf: ['0', '1'],
  },

  // ── 支付通道（B3）──────────────────────────────────────────────────
  // 默认 sandbox：不产生真实资金流转。
  // ⚠ 与邮件/短信不同，支付**不会**在凭据缺失时回落沙箱：
  //   生产环境静默降级的表现是「支付一直成功、账上一分钱没有」。
  //   缺凭据时发起支付返回 503（见 payments/payment.factory.ts）。
  {
    key: 'payment.provider',
    env: 'PAYMENT_PROVIDER',
    type: 'string',
    def: 'sandbox',
    oneOf: ['sandbox', 'alipay', 'wechat'],
  },
  /** 渠道异步通知的基址（渠道能访问到的公网地址）；留空用 HOST:PORT */
  { key: 'payment.notifyBase', env: 'PAYMENT_NOTIFY_BASE', type: 'string', def: '' },
  // 支付宝（网页支付, RSA2）
  { key: 'payment.alipay.appId', env: 'ALIPAY_APP_ID', type: 'string', def: '' },
  { key: 'payment.alipay.privateKey', env: 'ALIPAY_PRIVATE_KEY', type: 'string', def: '' },
  { key: 'payment.alipay.publicKey', env: 'ALIPAY_PUBLIC_KEY', type: 'string', def: '' },
  { key: 'payment.alipay.gateway', env: 'ALIPAY_GATEWAY', type: 'string', def: '' },
  // 微信支付 API v3（Native 扫码）
  { key: 'payment.wechat.mchId', env: 'WECHAT_MCH_ID', type: 'string', def: '' },
  { key: 'payment.wechat.appId', env: 'WECHAT_APP_ID', type: 'string', def: '' },
  { key: 'payment.wechat.apiV3Key', env: 'WECHAT_API_V3_KEY', type: 'string', def: '' },
  { key: 'payment.wechat.serialNo', env: 'WECHAT_SERIAL_NO', type: 'string', def: '' },
  { key: 'payment.wechat.privateKey', env: 'WECHAT_PRIVATE_KEY', type: 'string', def: '' },
  // 回调验签用的是**微信支付平台证书公钥**，不是商户私钥
  { key: 'payment.wechat.platformPublicKey', env: 'WECHAT_PLATFORM_PUBLIC_KEY', type: 'string', def: '' },

  // ── 日志（本文件引入的新配置面）────────────────────────────────────────
  { key: 'log.level', env: 'LOG_LEVEL', type: 'string', def: 'log', oneOf: LOG_LEVELS },
  { key: 'log.dir', env: 'LOG_DIR', type: 'string', def: 'logs' },
  { key: 'log.retentionDays', env: 'LOG_RETENTION_DAYS', type: 'number', def: 14, min: 1, max: 3650 },
  { key: 'log.maxFileMb', env: 'LOG_MAX_FILE_MB', type: 'number', def: 20, min: 1, max: 1024 },
  { key: 'log.maxFilesPerDay', env: 'LOG_MAX_FILES_PER_DAY', type: 'number', def: 5, min: 1, max: 99 },
  { key: 'log.console', env: 'LOG_CONSOLE', type: 'boolean', def: true },
  { key: 'log.errorFile', env: 'LOG_ERROR_FILE', type: 'boolean', def: true },

  // ── 图像生成网关（默认值取自 providers/gateway.config.ts）──────────────
  { key: 'gateway.baseUrl', env: 'GATEWAY_BASE_URL', type: 'string', def: '' },
  { key: 'gateway.token', env: 'GATEWAY_TOKEN', type: 'string', def: '' },
  { key: 'gateway.model', env: 'GATEWAY_MODEL', type: 'string', def: '' },
  {
    key: 'gateway.provider',
    env: 'GATEWAY_PROVIDER',
    type: 'string',
    // 默认 openai: 新部署应走主流协议; 存量 modelverse 值已在
    // CapabilityRouterProvider.pickProtocol 里作为 openai 的历史别名兼容。
    // oneOf 把取值锁死 —— 填错协议的表现会是上游 404,
    // 在启动时就拒掉比在生成时才暴露好得多。
    def: 'openai',
    oneOf: ['openai', 'modelverse', 'volcengine', 'minimax'],
  },
  { key: 'gateway.vendor', env: 'GATEWAY_VENDOR', type: 'string', def: '' },
  { key: 'gateway.enabled', env: 'GATEWAY_ENABLED', type: 'boolean', def: false },
  { key: 'gateway.timeoutMs', env: 'GATEWAY_TIMEOUT_MS', type: 'number', def: 120000, min: 1000 },
  { key: 'gateway.pollMs', env: 'GATEWAY_POLL_MS', type: 'number', def: 2000, min: 100 },
  { key: 'gateway.maxPolls', env: 'GATEWAY_MAX_POLLS', type: 'number', def: 60, min: 1 },
  { key: 'asset.publicBase', env: 'ASSET_PUBLIC_BASE', type: 'string', def: '' },

  // ── 安全与可观测（B5, 2026-10-21）──────────────────────────────────────
  // 限流默认开启：登录/短信/生成/上传都有真实成本，默认关等于默认不设防。
  // 本地压测可临时 RATE_LIMIT_ENABLED=false，生产禁止。
  { key: 'rateLimit.enabled', env: 'RATE_LIMIT_ENABLED', type: 'boolean', def: true },
  // 是否信任反向代理传来的 X-Forwarded-For。默认 false —— 直接暴露的实例
  // 若信任该头，任何人伪造它即可绕开全部按 IP 的限流。
  { key: 'rateLimit.trustProxy', env: 'RATE_LIMIT_TRUST_PROXY', type: 'boolean', def: false },
  // 素材签名密钥。留空 = /uploads 保持公开（默认行为）；设置后要求 HMAC 签名。
  { key: 'asset.signingSecret', env: 'ASSET_SIGNING_SECRET', type: 'string', def: '' },
  // 未处理异常的告警 webhook（可选）。留空则只落盘，不发外部请求。
  { key: 'observability.errorWebhookUrl', env: 'ERROR_WEBHOOK_URL', type: 'string', def: '' },

  // ── 存储（默认值取自 storage/storage.service.ts）──────────────────────
  { key: 'storage.backend', env: 'STORAGE_BACKEND', type: 'string', def: 'local', oneOf: ['local', 'oss', 'minio'] },
  { key: 'storage.ossRegion', env: 'OSS_REGION', type: 'string', def: '' },
  { key: 'storage.ossBucket', env: 'OSS_BUCKET', type: 'string', def: '' },
  { key: 'storage.ossAccessKeyId', env: 'OSS_ACCESS_KEY_ID', type: 'string', def: '' },
  { key: 'storage.ossAccessKeySecret', env: 'OSS_ACCESS_KEY_SECRET', type: 'string', def: '' },
  { key: 'storage.ossEndpoint', env: 'OSS_ENDPOINT', type: 'string', def: '' },
  { key: 'storage.minioEndpoint', env: 'MINIO_ENDPOINT', type: 'string', def: '' },
  { key: 'storage.minioPort', env: 'MINIO_PORT', type: 'number', def: 9000, min: 1, max: 65535 },
  { key: 'storage.minioUseSsl', env: 'MINIO_USE_SSL', type: 'boolean', def: false },
  { key: 'storage.minioAccessKey', env: 'MINIO_ACCESS_KEY', type: 'string', def: '' },
  { key: 'storage.minioSecretKey', env: 'MINIO_SECRET_KEY', type: 'string', def: '' },
  { key: 'storage.minioBucket', env: 'MINIO_BUCKET', type: 'string', def: 'huojue' },
];

/** 配置树（ConfigService.get('app.port') 等的载体） */
export interface AppConfigTree {
  app: { port: number; host: string; prefix: string; env: string };
  db: { url: string };
  path: { uploads: string; backups: string };
  cors: { origins: string[]; allowPrivateLan: boolean };
  jwt: { secret: string; ttl: string };
  log: {
    level: LogLevel;
    dir: string;
    retentionDays: number;
    maxFileMb: number;
    maxFilesPerDay: number;
    console: boolean;
    errorFile: boolean;
  };
  gateway: {
    baseUrl: string;
    token: string;
    model: string;
    enabled: boolean;
    timeoutMs: number;
    pollMs: number;
    maxPolls: number;
  };
  asset: { publicBase: string; signingSecret: string };
  rateLimit: { enabled: boolean; trustProxy: boolean };
  observability: { errorWebhookUrl: string };
  storage: {
    backend: string;
    ossRegion: string;
    ossBucket: string;
    ossAccessKeyId: string;
    ossAccessKeySecret: string;
    ossEndpoint: string;
    minioEndpoint: string;
    minioPort: number;
    minioUseSsl: boolean;
    minioAccessKey: string;
    minioSecretKey: string;
    minioBucket: string;
  };
}

/** 真值判定，与 gateway.config.ts 的 bool() 保持同义 */
function parseBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `环境变量校验未通过（${problems.length} 项）:\n  - ${problems.join('\n  - ')}\n` +
        `请修正 .env 后重启；可对照 backend/.env.example。`,
    );
    this.name = 'EnvValidationError';
  }
}

/** 单项解析。返回字符串表示的值，出错则 push 到 problems */
function resolveOne(spec: Spec, env: NodeJS.ProcessEnv, problems: string[]): string | number | boolean | string[] {
  const raw = env[spec.env];
  const isEmpty = raw === undefined || raw.trim() === '';

  switch (spec.type) {
    case 'string': {
      if (isEmpty) return spec.def as string;
      const value = raw.trim();
      if (spec.oneOf && !spec.oneOf.includes(value)) {
        problems.push(`${spec.env}="${value}" 不是合法取值，允许: ${spec.oneOf.join(' | ')}`);
        return spec.def;
      }
      return value;
    }
    case 'csv': {
      if (isEmpty) return spec.def as string[];
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case 'boolean': {
      if (isEmpty) return spec.def as boolean;
      return parseBool(raw);
    }
    case 'number': {
      if (isEmpty) return spec.def as number;
      const n = Number(raw.trim());
      if (!Number.isFinite(n)) {
        problems.push(`${spec.env}="${raw}" 不是合法数字（期望如 ${spec.def}）`);
        return spec.def as number;
      }
      if (spec.min !== undefined && n < spec.min) {
        problems.push(`${spec.env}=${n} 小于允许下限 ${spec.min}`);
        return spec.def as number;
      }
      if (spec.max !== undefined && n > spec.max) {
        problems.push(`${spec.env}=${n} 超过允许上限 ${spec.max}`);
        return spec.def as number;
      }
      return n;
    }
  }
}

/** 按点号路径写入嵌套对象 */
function assign(tree: Record<string, any>, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split('.');
  let cursor = tree;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * 校验期间收集到的非致命告警。
 *
 * 为什么用模块级数组而不是塞进配置树：validateEnv 的契约是「要么返回一个
 * 干净的对象，要么抛错」，往返回值里塞 `__warnings` 会污染 ConfigService
 * 的命名空间。FileLogger 启动时 flush 这份列表，把告警既写控制台也落盘，
 * 于是「启动期发现问题」和「落盘后能复盘」是同一份证据。
 */
export const startupWarnings: string[] = [];

/**
 * @nestjs/config 的 validate 钩子。
 *
 * 返回值即 ConfigService 的 internal config，故 `config.get('log.level')` 可用。
 * **不修改传入的 env 对象，也不修改 process.env。**
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): AppConfigTree {
  const problems: string[] = [];
  const tree: Record<string, any> = {};

  for (const spec of ENV_SPECS) {
    assign(tree, spec.key, resolveOne(spec, env, problems));
  }

  // 生产环境的默认密钥兜底是一道真实的门禁：dev 常量一旦带到线上，
  // 任何人都能自签 token。开发/测试只告警，避免打断本地零配置启动。
  const usingDevJwtSecret = env.JWT_SECRET === undefined || env.JWT_SECRET.trim() === '';
  if (usingDevJwtSecret && tree.app.env === 'production') {
    problems.push('JWT_SECRET 未设置：生产环境禁止使用内置开发默认密钥，请显式配置一个强随机值');
  }

  // 生产环境连开发库 = 直接污染演示数据，且线上数据落到本地文件上无法备份。
  // 这条同样做成启动失败：拼错一个路径的代价远大于启动多问一句。
  if (tree.app.env === 'production' && tree.db.url === 'file:./dev.db') {
    problems.push(
      'DATABASE_URL 仍是开发库默认值 file:./dev.db：生产环境必须指向独立库文件（如 file:./data/prod.db 或挂载卷）',
    );
  }

  /*
   * 签名密钥太短等于没设：HMAC 的安全性完全取决于密钥熵。
   * 生产要求 ≥ 32 字符（推荐 `openssl rand -base64 32`）；开发/测试只告警。
   */
  const signingSecret = String(tree.asset?.signingSecret ?? '').trim();
  const weakSigningSecret = signingSecret.length > 0 && signingSecret.length < 32;
  if (weakSigningSecret && tree.app.env === 'production') {
    problems.push(
      'ASSET_SIGNING_SECRET 长度不足 32 字符：过短的密钥可被暴力穷举，等价于没有签名（可用 openssl rand -base64 32 生成）',
    );
  }

  // 演示账号的宽松 TTL 只作为告警，不阻断启动。
  const usingDemoTtl = tree.jwt.ttl === '7d';

  // ⚠️ 必须先抛错再入队警告。顺序反了的话, 一次**校验失败**的调用也会把告警
  // 塞进模块级队列, 而那次调用的产物根本不会被使用 —— 于是同一条告警会被
  // AppFileLogger 重复 flush, 且永远对不上是哪次配置触发的。
  if (problems.length > 0) throw new EnvValidationError(problems);

  if (usingDevJwtSecret) {
    startupWarnings.push('JWT_SECRET 未设置，正在使用内置开发默认密钥（生产环境必须显式配置）');
  }
  if (weakSigningSecret) {
    startupWarnings.push('ASSET_SIGNING_SECRET 长度不足 32 字符，签名强度不足（生产环境会拒绝启动）');
  }
  if (signingSecret.length === 0 && tree.app.env === 'production') {
    startupWarnings.push(
      'ASSET_SIGNING_SECRET 未设置：/uploads/* 在生产环境仍公开可访问，任何拿到路径的人都能下载素材',
    );
  }
  if (tree.app.env === 'production' && usingDemoTtl) {
    startupWarnings.push(
      'JWT_TTL=7d 是演示环境的宽松取值：生产建议改短（如 2h/1d）并配套 refresh token',
    );
  }
  // 生产环境若沿用开发库的库名之外、但仍是相对路径，需提醒数据不在挂载卷上
  if (tree.app.env === 'production' && !tree.path.uploads.startsWith('/')) {
    startupWarnings.push(
      `UPLOAD_DIR="${tree.path.uploads}" 是相对路径：容器部署时须挂载持久卷，否则重建镜像即丢全部上传图`,
    );
  }

  return tree as AppConfigTree;
}
