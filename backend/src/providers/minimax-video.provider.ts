import { gatewayConfigOf } from './gateway.config';
import { GatewayUnavailableError } from './gateway.types';
import { videoProtocolSpec, type VideoProtocolSpec } from './protocols/protocol.spec';
import { sniffVideoFormat } from './video-format';
import type { VideoOutcome } from './unified/unified.provider';

/**
 * 视频通道 —— 统一模型能力层的 VideoProvider 实现 (2026-10-20)。
 *
 * ## 为什么视频需要独立的 provider 而不能复用图像基座
 *
 * 图像同步协议是「一次 POST → 拿 url/base64」; 视频是**四段式**:
 *   1. POST 提交任务   → { task_id }
 *   2. GET  轮询状态   → { status, file_id? }
 *   3. GET  取下载地址 → { file: { download_url } }   ← MiniMax 特有
 *   4. GET  下载视频字节
 *
 * 硬塞进 BaseImageProvider 会出现 `if (isVideo)` 分支蔓延 —— 正是本项目
 * 要消灭的"两个真相源"变形。故视频独立成类, 协议形状由协议层声明。
 *
 * ## 配置读取时机
 *
 * ⚠️ 与图像侧一致: 配置**每次调用时读取**, 不做构造期快照。
 * 后台「模型配置」页改完立即生效, 不需要重启进程。
 */
export class MinimaxVideoProvider {
  constructor(private readonly protocolId: string = 'minimax-video') {}

  private get cfg() {
    return gatewayConfigOf('video');
  }

  /**
   * 通道级凭据 (2026-10-20 多渠道) —— 与图像/文本 provider 的同名机制对称。
   *
   * 视频是**最需要**多渠道的模态: 没有本地兜底, 单次生成 1~2 分钟,
   * 唯一那家一挂用户就彻底拿不到片。少了这个注入, 「切到备用通道」
   * 仍会用主通道的 baseUrl/token 请求, 照样失败且看不出原因。
   */
  private channelCreds?: { baseUrl: string; token: string; model: string };

  withChannel(creds: { baseUrl: string; token: string; model: string }): this {
    this.channelCreds = creds;
    return this;
  }

  clearChannel(): this {
    this.channelCreds = undefined;
    return this;
  }

  get enabled(): boolean {
    return gatewayConfigOf('video').enabled;
  }

  private get spec(): VideoProtocolSpec {
    const s = videoProtocolSpec(this.protocolId);
    if (!s) {
      throw new GatewayUnavailableError(
        `未知视频通道协议 "${this.protocolId}"`,
        '该协议未在 protocol.spec.ts 的 VIDEO_PROTOCOL_SPECS 中声明',
      );
    }
    return s;
  }

  /**
   * 提交一次视频生成并等到终态, 返回视频字节。
   *
   * 失败一律抛 GatewayUnavailableError, 由路由层决定是否回落 ——
   * 与图像侧同一约定: provider 不做静默降级, 否则调用记录里会出现
   * 「显示成功但内容是兜底模板」的情况。
   */
  async generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
    prompt: string,
  ): Promise<VideoOutcome> {
    /*
     * 凭据 (baseUrl/token/model) 可被通道覆盖; 超时/轮询/素材基址始终取全局 ——
     * 那些是**运行时参数**而非通道身份, 按通道分开配只会让排障更乱
     * (同一家厂商两条通道的超时理应一致)。
     */
    const global = this.cfg;
    const creds = this.channelCreds ?? global;
    if (!creds.baseUrl && !creds.token) {
      throw new GatewayUnavailableError('未配置视频通道', '视频通道基址与令牌均为空, 或通道被显式关闭');
    }
    const spec = this.spec;
    const model = creds.model || spec.defaultModel;

    // ── 1. 提交任务 ────────────────────────────────────────────────
    const body: Record<string, unknown> = {
      model,
      prompt: prompt || String(params.prompt ?? ''),
      ...(spec.buildParams ? spec.buildParams(params) : {}),
    };
    // 图生视频: 首帧参考图走 URL (对方要能回拉)
    if (inputPaths.length > 0 && spec.firstFrameField) {
      body[spec.firstFrameField] = `${global.assetBase.replace(/\/+$/, '')}${toSiteUrl(inputPaths[0])}`;
    }

    const created = await this.request('POST', spec.submitEndpoint(creds.baseUrl), body, '提交视频任务失败');
    const err = spec.extractError(created);
    if (err) {
      throw new GatewayUnavailableError(`${spec.label}返回错误`, err);
    }
    const taskId = spec.extractTaskId(created);
    if (!taskId) {
      throw new GatewayUnavailableError('响应缺少任务 id', summarize(created));
    }

    // ── 2. 轮询状态 ────────────────────────────────────────────────
    const deadline = Date.now() + global.timeoutMs;
    let last: any = null;
    let fileId: string | undefined;
    for (let i = 0; i < global.maxPolls && Date.now() < deadline; i += 1) {
      await sleep(global.pollMs);
      last = await this.request('GET', spec.pollEndpoint(creds.baseUrl, taskId), undefined, '查询视频任务失败');
      const status = spec.extractStatus(last);
      const kind = spec.classifyStatus(status);
      if (kind === 'success') {
        fileId = spec.extractFileId(last);
        break;
      }
      if (kind === 'failed') {
        throw new GatewayUnavailableError(`视频任务终态为 ${status}`, summarize(last));
      }
    }
    if (!fileId) {
      throw new GatewayUnavailableError('视频轮询超时', `taskId=${taskId} last=${summarize(last)}`);
    }

    // ── 3. 取下载地址 ──────────────────────────────────────────────
    let downloadUrl: string | undefined;
    if (spec.fileEndpoint) {
      const fileJson = await this.request('GET', spec.fileEndpoint(creds.baseUrl, fileId), undefined, '取视频下载地址失败');
      downloadUrl = spec.extractDownloadUrl(fileJson);
      if (!downloadUrl) {
        throw new GatewayUnavailableError('未返回视频下载地址', summarize(fileJson));
      }
    } else {
      // 无第三段协议: 轮询响应里直接带 url
      downloadUrl = spec.extractDownloadUrl(last);
      if (!downloadUrl) {
        throw new GatewayUnavailableError('未返回视频下载地址', summarize(last));
      }
    }

    // ── 4. 下载视频字节 ────────────────────────────────────────────
    const buffer = await this.download(downloadUrl);
    if (!buffer.length) {
      throw new GatewayUnavailableError('产出视频为空', `taskId=${taskId}`);
    }

    return {
      kind: 'video',
      buffer,
      // 按字节魔数判格式, 不看 URL 后缀 —— 第三方链接常无扩展名或带签名参数
      format: sniffVideoFormat(buffer),
      source: 'gateway',
      model,
      taskId,
      durationMs: toDurationMs(params.duration),
    };
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown, failLabel = '请求失败'): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = this.channelCreds?.token ?? this.cfg.token;
    if (token) headers.Authorization = `Bearer ${token}`;
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
      throw new GatewayUnavailableError(/abort/i.test(msg) ? '调用超时' : failLabel, msg);
    } finally {
      clearTimeout(timer);
    }
  }

  private async download(url: string): Promise<Buffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new GatewayUnavailableError('下载产出视频失败', `HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      throw new GatewayUnavailableError('下载产出视频失败', (e as Error).message);
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

/** 秒 → 毫秒 (视频时长以毫秒落库) */
function toDurationMs(seconds: unknown): number | null {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}

/** 磁盘绝对路径 → 站内相对路径 (/uploads/xxx) */
function toSiteUrl(abs: string): string {
  const marker = '/uploads/';
  const i = abs.indexOf(marker);
  if (i >= 0) return abs.slice(i);
  const parts = abs.split('/');
  return `/uploads/${parts[parts.length - 1]}`;
}
