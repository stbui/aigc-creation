import { gatewayConfigOf } from './gateway.config';
import { GatewayUnavailableError } from './gateway.types';
import { defaultModelFor } from './provider-presets';
import type { TextMessage, TextProvider, TextProviderResult } from './text-provider.interface';

/**
 * OpenAI 兼容「文生文」客户端 —— POST {base}/v1/chat/completions。
 *
 * 一个实现覆盖四家厂商 (DeepSeek / Moonshot / 硅基流动 / OpenAI 官方),
 * 因为它们在该端点上的**请求与响应形状完全一致**:
 *   请求 { model, messages:[{role,content}], temperature?, max_tokens?, stream:false }
 *   响应 { id, model, choices:[{ message:{ role, content } }], usage:{...} }
 * 差异只在基址与模型名 —— 那是配置项, 不是代码分支。
 *
 * ⚠️ **基址归一化是本文件最容易出错的地方**:
 * 各家官方文档给的 base_url 形状不一致 (OpenAI 给 `https://api.openai.com/v1`,
 * Moonshot 给 `https://api.moonshot.cn/v1`, DeepSeek 根域**不带** /v1),
 * 若照抄就与 provider-presets 的约定冲突。故配置里一律存**根域**,
 * `/v1` 由本文件统一补 —— 详见 provider-presets.ts 的 VendorPreset.baseUrl 注释。
 *
 * ⚠️ **stream 必须显式关掉**: 默认不传时各家行为不一致 (部分厂商默认流式),
 * 而流式响应是 `text/event-stream` 而非 JSON, 会让下面的 JSON.parse 直接失败。
 * 故每次都写死 `stream: false`。
 *
 * 失败一律抛 GatewayUnavailableError, 由上层路由决定回落策略 ——
 * 本类不做任何静默降级。
 */

/** 各模态默认模型缺省时的兜底 */
const DEFAULT_MODEL_BY_VENDOR: Record<string, string> = {
  deepseek: 'deepseek-chat',
  moonshot: 'kimi-k2.5',
  'siliconflow-text': 'deepseek-ai/DeepSeek-V3',
  'openai-text': 'gpt-4o',
};

/** max_tokens 上下限 (各厂商上限不同, 取公共安全区间的交集) */
const MAX_TOKENS_MIN = 1;
const MAX_TOKENS_MAX = 8192;
const DEFAULT_MAX_TOKENS = 2048;
const TEMPERATURE_MAX = 2;

export class OpenAiChatTextProvider implements TextProvider {
  /**
   * 配置**每次调用时读取**, 不做构造期快照 —— 与图像 provider 同理由:
   * 后台改完配置后常驻实例若持有旧值, 改动永不生效 (走 gateway.config 的 3s 缓存)。
   */
  private get cfg() {
    return gatewayConfigOf('text');
  }

  get enabled(): boolean {
    return gatewayConfigOf('text').enabled;
  }

  async generate(
    capability: string,
    messages: TextMessage[],
    params: Record<string, any>,
  ): Promise<TextProviderResult> {
    const cfg = this.cfg;
    if (!cfg.enabled) {
      throw new GatewayUnavailableError(
        '未配置文生文网关',
        '文生文基址与令牌均为空, 或该通道被显式关闭',
      );
    }
    if (!messages.length) {
      throw new GatewayUnavailableError('请求缺少消息', 'messages 为空, 无法生成');
    }

    const model = cfg.model || defaultModelFor('text', 'openai-chat') || DEFAULT_MODEL_BY_VENDOR.deepseek;

    const body: Record<string, unknown> = {
      model,
      messages,
      // 显式关流: 见文件头说明, 部分厂商不传时默认流式, 响应就不是 JSON 了
      stream: false,
    };

    // 参数透传: 只带**显式提交过**的项, 不替调用方猜默认值。
    // 理由: 各家对 temperature/max_tokens 的默认值不同, 强行统一会覆盖用户意图。
    const maxTokens = clampInt(params.maxTokens, MAX_TOKENS_MIN, MAX_TOKENS_MAX, DEFAULT_MAX_TOKENS);
    if (params.maxTokens !== undefined && params.maxTokens !== null && params.maxTokens !== '') {
      body.max_tokens = maxTokens;
    }
    if (params.temperature !== undefined && params.temperature !== null && params.temperature !== '') {
      const t = Number(params.temperature);
      if (Number.isFinite(t)) body.temperature = Math.min(Math.max(t, 0), TEMPERATURE_MAX);
    }

    const url = `${cfg.baseUrl}/v1/chat/completions`;
    const json = await this.request(cfg.token, url, body);

    const err = extractError(json);
    if (err) {
      throw new GatewayUnavailableError(`文生文通道返回错误(${err.code ?? 'unknown'})`, err.message);
    }

    const text = extractContent(json);
    if (!text) {
      throw new GatewayUnavailableError('响应缺少文本内容', summarize(json));
    }

    return {
      kind: 'text',
      text,
      // 文本没有本地兜底, 故来源恒为 gateway
      source: 'gateway',
      // 以服务商回报的模型名为准: 请求时填的可能是别名, 回报才是实际跑的
      model: String(json?.model ?? model),
      taskId: String(json?.id ?? '') || undefined,
      usage: extractUsage(json),
    };
  }

  private async request(token: string, url: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // 429/401/402 等要单独点名: 运营看到 "HTTP 429" 不知道是限流还是配置错
        throw new GatewayUnavailableError(
          `文生文提交失败(${describeStatus(res.status)})`,
          `HTTP ${res.status} ${text.slice(0, 300)}`,
        );
      }
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        // 非 JSON 而 HTTP 200 —— 最可能是对方默认流式返回了 SSE
        throw new GatewayUnavailableError(
          '响应不是合法 JSON',
          text.slice(0, 300) + (text.startsWith('data:') ? '（疑似流式响应）' : ''),
        );
      }
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      const msg = (e as Error).message || String(e);
      throw new GatewayUnavailableError(
        /abort/i.test(msg) ? '文生文调用超时' : '文生文请求失败',
        msg,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 从响应里挖正文。
 *
 * 兼容两种形状: 标准 `choices[0].message.content`, 与部分厂商在
 * 思考模式下把正文放在 `choices[0].text` (completions 风格)。
 * content 可能是数组 (多模态分块), 故按字符串拼回去。
 */
function extractContent(json: any): string {
  const choice = json?.choices?.[0];
  if (!choice) return '';
  const raw = choice?.message?.content ?? choice?.text ?? '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('')
      .trim();
  }
  return '';
}

interface ExtractedError {
  code?: string;
  message: string;
}

/** 统一挖错误: 兼容 {error:{message,code}} 与 {code,message} 两种形状 */
function extractError(json: any): ExtractedError | null {
  const e = json?.error;
  if (typeof e === 'string') return { message: e.slice(0, 300) };
  if (e && typeof e === 'object') {
    return {
      code: e.code !== undefined ? String(e.code) : e.type !== undefined ? String(e.type) : undefined,
      message: String(e.message ?? JSON.stringify(e)).slice(0, 300),
    };
  }
  // 硅基流动等厂商直接在顶层回 {code, message} 而非嵌套 error
  if (json?.code !== undefined && json?.message !== undefined) {
    return { code: String(json.code), message: String(json.message).slice(0, 300) };
  }
  return null;
}

function extractUsage(json: any): TextProviderResult['usage'] {
  const u = json?.usage;
  if (!u || typeof u !== 'object') return undefined;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    totalTokens: num(u.total_tokens),
  };
}

/** 给常见状态码一个人话说明, 让运营不必去查文档 */
function describeStatus(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return '鉴权失败, 令牌无效或无权限';
    case 402:
      return '账户余额不足';
    case 404:
      return '端点不存在, 检查基址是否多写了 /v1 或路径';
    case 429:
      return '触发限流或余额不足';
    default:
      return `HTTP ${status}`;
  }
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function summarize(json: unknown): string {
  try {
    const s = JSON.stringify(json);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(json).slice(0, 200);
  }
}