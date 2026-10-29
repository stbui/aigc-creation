/**
 * 运行配置 —— 全部来自环境变量，只在这里解析一次。
 *
 * 设计原则：默认值必须让「什么都不配，直接 node server.js」就能跑通本项目
 * 后台的渠道测试。凡是会影响可达性的项（端口 / 绑定地址 / 公开基址）
 * 都可覆盖，但不强迫先配置。
 */

const DEFAULTS = {
  host: '127.0.0.1',
  port: 3900,
  apiKey: '',
  publicBase: '',
  extraModels: '',
  latencyChatMs: 350,
  latencyImageMs: 700,
  latencyVideoReadyMs: 200,
  failRate: 0,
  fileTtlMs: 60 * 60 * 1000,
  maxStoreMb: 256,
  logLevel: 'info',
  videoMaxSeconds: 6,
  imageMaxPixels: 2_400_000,
};

/** 本网关内置的模型清单（OpenAI `/v1/models` 返回它）。 */
export const BUILTIN_MODELS = [
  // 文本 —— 覆盖本项目协议默认值与厂商预设里出现的模型名
  'gpt-4o',
  // 图像
  'gpt-image-2',
  // 视频
  'MiniMax-Hailuo-2.3',
];

function parseInteger(raw, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function parseNumber(raw, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/**
 * 读取配置。
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {Partial<typeof DEFAULTS>} overrides 测试用：直接覆盖若干项，避免改 process.env
 */
export function loadConfig(env = process.env, overrides = {}) {
  const cfg = {
    host: env.MOCK_HOST?.trim() || overrides.host || DEFAULTS.host,
    port: parseInteger(env.MOCK_PORT, overrides.port ?? DEFAULTS.port, { min: 0, max: 65535 }),
    apiKey: (env.MOCK_API_KEY ?? overrides.apiKey ?? DEFAULTS.apiKey).trim(),
    publicBase: (env.MOCK_PUBLIC_BASE ?? overrides.publicBase ?? DEFAULTS.publicBase)
      .trim()
      .replace(/\/+$/, ''),
    extraModels: (env.MOCK_MODELS ?? overrides.extraModels ?? DEFAULTS.extraModels)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    latencyChatMs: parseInteger(env.MOCK_LATENCY_CHAT_MS, overrides.latencyChatMs ?? DEFAULTS.latencyChatMs, {
      min: 0,
    }),
    latencyImageMs: parseInteger(env.MOCK_LATENCY_IMAGE_MS, overrides.latencyImageMs ?? DEFAULTS.latencyImageMs, {
      min: 0,
    }),
    latencyVideoReadyMs: parseInteger(
      env.MOCK_VIDEO_READY_MS,
      overrides.latencyVideoReadyMs ?? DEFAULTS.latencyVideoReadyMs,
      { min: 0 },
    ),
    failRate: parseNumber(env.MOCK_FAIL_RATE, overrides.failRate ?? DEFAULTS.failRate, { min: 0, max: 1 }),
    fileTtlMs: parseInteger(env.MOCK_FILE_TTL_MS, overrides.fileTtlMs ?? DEFAULTS.fileTtlMs, { min: 60_000 }),
    maxStoreMb: parseInteger(env.MOCK_MAX_STORE_MB, overrides.maxStoreMb ?? DEFAULTS.maxStoreMb, { min: 16 }),
    logLevel: (env.MOCK_LOG_LEVEL ?? overrides.logLevel ?? DEFAULTS.logLevel).trim().toLowerCase(),
    videoMaxSeconds: parseInteger(env.MOCK_VIDEO_MAX_SECONDS, overrides.videoMaxSeconds ?? DEFAULTS.videoMaxSeconds, {
      min: 1,
      max: 30,
    }),
    imageMaxPixels: parseInteger(env.MOCK_IMAGE_MAX_PIXELS, overrides.imageMaxPixels ?? DEFAULTS.imageMaxPixels, {
      min: 10_000,
    }),
    // 保留给脚本使用：安静模式只输出错误
    trustProxy: parseBoolean(env.MOCK_TRUST_PROXY, false),
  };
  if (cfg.publicBase === '/') cfg.publicBase = '';
  return Object.freeze(cfg);
}

/** 模型清单 = 内置 + 环境变量追加，去重保序。 */
export function modelIdsOf(cfg) {
  return [...new Set([...BUILTIN_MODELS, ...cfg.extraModels])];
}
