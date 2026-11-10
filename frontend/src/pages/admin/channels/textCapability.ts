/**
 * 文本模型能力合同的默认值与前端校验。
 *
 * 后端 `normalizeModelCapabilityConfig` 对文本模型强制要求完整的 `text`
 * 合同；后台表单不能把空配置提交成 `null`。这里给出可直接保存的保守默认值，
 * 运营可在文本框中按模型能力继续调整。
 */

type JsonRecord = Record<string, unknown>;

const MEGABYTE = 1024 * 1024;

export const DEFAULT_TEXT_CAPABILITY_CONFIG = {
  version: 1,
  text: {
    streaming: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    references: {
      promptMaxChars: 4000,
      maxImages: 4,
      maxImageBytes: 10 * MEGABYTE,
      maxVideos: 0,
      maxVideoBytes: 0,
    },
  },
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createDefaultTextCapabilityConfigJson(): string {
  return JSON.stringify(DEFAULT_TEXT_CAPABILITY_CONFIG, null, 2);
}

/** 与后端保存期校验保持一致，避免表单放行后再收到 400。 */
export function validateTextCapabilityConfigJson(raw: string): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return '请配置文本模型能力参数';

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return '能力配置格式不正确';
  }
  if (!isRecord(document) || !isRecord(document.text)) {
    return '请配置文本模型能力参数';
  }

  const config = document.text;
  if (config.streaming !== undefined && typeof config.streaming !== 'boolean') {
    return '文本流式输出配置必须是布尔值';
  }

  const contextWindowTokens = numberValue(config.contextWindowTokens, 0);
  if (contextWindowTokens < 4096 || contextWindowTokens > 10_000_000) {
    return '文本模型上下文窗口必须在 4096-10000000 Token 之间';
  }

  const maxOutputTokens = numberValue(config.maxOutputTokens, 0);
  if (
    maxOutputTokens < 256 ||
    maxOutputTokens > 1_000_000 ||
    maxOutputTokens >= contextWindowTokens
  ) {
    return '文本模型最大输出 Token 必须小于上下文窗口且在 256-1000000 之间';
  }

  const references = isRecord(config.references) ? config.references : null;
  if (!references) return '请配置文本模型引用限制';

  const promptMaxChars = numberValue(references.promptMaxChars, 0);
  if (promptMaxChars < 1 || promptMaxChars > 1_000_000) {
    return '提示词最大字符数必须在 1-1000000 之间';
  }

  for (const [label, value] of [
    ['最大图片引用数', references.maxImages],
    ['最大视频引用数', references.maxVideos],
  ] as const) {
    const number = numberValue(value, -1);
    if (number < 0 || number > 100) return `${label}必须在 0-100 之间`;
  }

  for (const [label, value] of [
    ['图片素材大小上限', references.maxImageBytes],
    ['视频素材大小上限', references.maxVideoBytes],
  ] as const) {
    if (numberValue(value, -1) < 0) return `${label}不能小于 0`;
  }

  return null;
}
