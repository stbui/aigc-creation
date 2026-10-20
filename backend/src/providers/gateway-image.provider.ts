import { basename } from 'path';
import { gatewayConfig } from './gateway.config';
import { GatewayUnavailableError, type GatewayResult } from './gateway.types';

/**
 * 真实模型网关客户端 —— 对接 aigc 网关的异步任务契约:
 *   POST {base}/generation/tasks   { type:'image', prompt, model?, params? }  → 任务 id
 *   GET  {base}/generation/tasks/:id                                        → 轮询直到终态
 *
 * 容错设计 (对接真实第三方服务必须假设它会失败):
 *   - 响应字段做多别名兼容 (id/taskId、status/state、outputUrl/resultUrl/assets[0].url ...)
 *   - 非 2xx / 网络异常 / 轮询超时 / 终态失败, 一律抛 GatewayUnavailableError,
 *     由 CapabilityRouter 统一回落本地算法, 不让用户拿不到图
 *   - 参考图以 URL 形式回传 (网关侧需能拉取), 基址由 ASSET_PUBLIC_BASE 指定
 */

/** 从磁盘绝对路径推导站内相对路径 (/uploads/xxx.png) */
function toAssetUrl(absPath: string): string {
  const marker = `${'/'}uploads${'/'}`;
  const i = absPath.indexOf(marker);
  if (i >= 0) return absPath.slice(i);
  return `/uploads/${basename(absPath)}`;
}

function pick<T = unknown>(obj: Record<string, any>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

/** 从网关响应里挖出任务 id */
function extractTaskId(json: any): string | undefined {
  const direct = pick<string>(json ?? {}, ['taskId', 'id', 'runId', 'jobId']);
  if (direct) return String(direct);
  const data = json?.data ?? json?.result ?? json?.payload;
  if (data && typeof data === 'object') return extractTaskId(data);
  return undefined;
}

/** 从网关响应里挖出终态 */
function extractStatus(json: any): string {
  const raw = pick<string>(json ?? {}, ['status', 'state', 'taskStatus']);
  if (!raw) return 'unknown';
  return String(raw).toLowerCase();
}

/** 从网关响应里挖出产出图 URL */
function extractOutputUrl(json: any): string | undefined {
  const direct = pick<string>(json ?? {}, [
    'outputUrl',
    'resultUrl',
    'imageUrl',
    'url',
    'sourceUrl',
    'output',
    'result',
  ]);
  if (typeof direct === 'string' && direct.startsWith('http')) return direct;
  const arrays = [json?.outputs, json?.assets, json?.images, json?.files, json?.results];
  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      const u = typeof first === 'string' ? first : pick<string>(first ?? {}, ['url', 'sourceUrl', 'imageUrl']);
      if (u) return u;
    }
  }
  const data = json?.data ?? json?.result ?? json?.payload;
  if (data && typeof data === 'object') return extractOutputUrl(data);
  return undefined;
}

export class GatewayImageProvider {
  /**
   * 配置**每次调用时读取**, 不做构造期快照。
   *
   * 2026-10-20 起配置来源含后台可编辑的 DB 覆盖 (ModelChannelConfig),
   * 构造期快照会让后台改完配置后本进程仍用旧值, 且实例常驻不重建 ⇒ 永不生效。
   * 读取走 gateway.config 的 3s 缓存, 不产生额外压力。
   */
  private get cfg() {
    return gatewayConfig();
  }

  /** 网关是否配置到可以尝试远程 */
  get enabled(): boolean {
    return gatewayConfig().enabled;
  }

  /**
   * 提交一次生成并等到终态, 返回图片字节。
   * 失败一律抛 GatewayUnavailableError, 由路由器决定回落。
   */
  async generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
    prompt: string,
  ): Promise<GatewayResult> {
    const cfg = this.cfg;
    if (!cfg.enabled) {
      throw new GatewayUnavailableError('未配置网关', '网关基址与令牌均为空, 或通道被显式关闭');
    }

    const { buildGatewayRequest } = await import('./gateway-prompt');
    const body = buildGatewayRequest(capability, inputPaths, params, prompt, {
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      model: cfg.model,
      assetBase: cfg.assetBase,
    });

    const created = await this.request('POST', '/generation/tasks', body, '提交任务失败');
    const taskId = extractTaskId(created);
    if (!taskId) throw new GatewayUnavailableError('响应缺少任务 id', summarize(created));

    const deadline = Date.now() + this.cfg.timeoutMs;
    let last: any = null;
    for (let i = 0; i < this.cfg.maxPolls && Date.now() < deadline; i += 1) {
      await sleep(this.cfg.pollMs);
      last = await this.request('GET', `/generation/tasks/${encodeURIComponent(taskId)}`, undefined, '查询任务失败');
      const status = extractStatus(last);
      if (['succeeded', 'success', 'completed', 'done', 'finished'].includes(status)) {
        const url = extractOutputUrl(last);
        if (!url) throw new GatewayUnavailableError('任务成功但未返回产出图', summarize(last));
        const buffer = await this.download(url);
        const format = url.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
        return {
          buffer,
          format,
          taskId,
          model: pick<string>(last, ['model', 'modelName']),
          prompt: pick<string>(last, ['prompt', 'optimizedPrompt']) ?? prompt,
        };
      }
      if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(status)) {
        throw new GatewayUnavailableError(`任务终态为 ${status}`, summarize(last));
      }
    }
    throw new GatewayUnavailableError('轮询超时', `taskId=${taskId} last=${summarize(last)}`);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, failLabel = '请求失败'): Promise<any> {
    const url = `${this.cfg.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(5000, this.cfg.timeoutMs));
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new GatewayUnavailableError(failLabel, `HTTP ${res.status} ${text.slice(0, 180)}`);
      }
      const text = await res.text();
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new GatewayUnavailableError('响应不是合法 JSON', text.slice(0, 180));
      }
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      const msg = (e as Error).message || String(e);
      throw new GatewayUnavailableError(failLabel, msg);
    } finally {
      clearTimeout(timer);
    }
  }

  private async download(url: string): Promise<Buffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new GatewayUnavailableError('下载产出图失败', `HTTP ${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      throw new GatewayUnavailableError('下载产出图失败', (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function summarize(json: unknown): string {
  try {
    const s = JSON.stringify(json);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(json).slice(0, 200);
  }
}

export { toAssetUrl };
