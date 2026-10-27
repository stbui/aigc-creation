import { readFile } from 'fs/promises';
import { extname } from 'path';
import { gatewayConfig } from './gateway.config';
import {
  GatewayUnavailableError,
  ImageEditUnsupportedError,
  MaskUnsupportedError,
  type GatewayResult,
} from './gateway.types';
import { detectImageFormat, readImageDimensions } from './image-format';
import { protocolSpec, type ProtocolSpec } from './protocols/protocol.spec';

/**
 * 多协议图像通道的公共基座（2026-10-20）。
 *
 * 背景: 已接入四家厂商，实测发现**协议有多种形状**（见 protocols/protocol.spec.ts），
 * 但它们共用同一套骨架：
 *   - 配置每次调用时读（构造期快照会让后台改完配置永不生效）
 *   - Bearer 鉴权 + POST JSON + 阻塞到出图
 *   - 参考图按厂商要求以 base64 或 URL 传入
 *   - 从响应里挖出图片字节，按**字节魔数**判格式（第三方 URL 不可信）
 *
 * 差异只在三处：端点路径、尺寸参数写法、响应字段位置。
 * 故把骨架收在此处，各协议子类只声明这三个差异 —— 避免三份近乎相同的
 * 400 行实现各自漂移（且新增厂商时不必再抄一遍鉴权/下载/魔数）。
 *
 * ## 2026-10-20 架构重构: 能力字段改由协议层供给
 *
 * 改造前本类自带一份 `ProtocolShape` (sizeStyle / maxRefImages / refStyle …),
 * 而 `VendorPreset` 里**又抄了一份**。两处各写各的, 后果是:
 * 改预设不改实现 → 后台界面显示「最多 10 张参考图」, 实际请求只传 1 张,
 * 而用户在界面上看不出任何异常。
 *
 * 现在协议形状的**唯一声明处**是 `protocols/protocol.spec.ts`。
 * 本类按 `protocol` 标识去那里取, 不再自带副本。
 *
 * ⚠️ 依赖方向必须是单向的: 本文件 → protocol.spec, **不得**反向。
 * `sniffImageFormat` 已抽到独立的 image-format.ts, 否则
 * modelverse → 本文件 → modelverse 会成循环依赖。
 */

/** 参考图 → data URL（对方要求 base64 时用） */
export async function refImagesAsBase64(inputPaths: string[], max: number, maxBytes: number): Promise<string[]> {
  const out: string[] = [];
  for (const p of inputPaths.filter(Boolean).slice(0, max)) {
    try {
      const buf = await readFile(p);
      // 超体积跳过该张而非让整个请求失败: 少参考一张好过整单失败
      if (buf.length > maxBytes) continue;
      out.push(`data:${mimeOf(p)};base64,${buf.toString('base64')}`);
    } catch {
      /* 单张读失败跳过, 同上 */
    }
  }
  return out;
}

/** 参考图 → 站内 URL（对方要求 URL 时用） */
export function refImagesAsUrl(inputPaths: string[], assetBase: string, max: number, toAssetUrl: (abs: string) => string): string[] {
  return inputPaths.filter(Boolean).slice(0, max).map((p) => `${assetBase.replace(/\/+$/, '')}${toAssetUrl(p)}`);
}

function mimeOf(p: string): string {
  const e = extname(p).toLowerCase();
  return e === '.jpg' || e === '.jpeg' ? 'image/jpeg' : e === '.webp' ? 'image/webp' : e === '.gif' ? 'image/gif' : 'image/png';
}

export function summarizeJson(json: unknown): string {
  try {
    const s = JSON.stringify(json);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(json).slice(0, 200);
  }
}

/**
 * 尺寸换算。
 *
 * 三种表达方式对应三种厂商写法, 换算逻辑不同故显式分支而非塞进配置:
 *   openai-wh  → "1024x1024" / "2048x1152"（精确像素）
 *   volc-tier  → "1K" / "2K" / "4K"（档位; Seedream 不接受精确像素）
 *   ratio-only → 不传像素, 只传 aspect_ratio（MiniMax 自定分辨率）
 */
export function buildSize(
  style: 'openai-wh' | 'volc-tier' | 'ratio-only',
  ratio: string | undefined,
  quality: string | undefined,
): { field: string; value: string } | null {
  const [rw, rh] = String(ratio ?? '1:1')
    .split(':')
    .map((n) => Number(n) || 1);
  if (style === 'ratio-only') {
    // aspect_ratio 只接受 w:h 形式
    return { field: 'aspect_ratio', value: `${rw}:${rh}` };
  }
  if (style === 'volc-tier') {
    // 档位: 画质直接映射为 1K/2K/4K, 比例由服务端在档位内处理
    return { field: 'size', value: quality === '4k' ? '4K' : quality === '2k' ? '2K' : '1K' };
  }
  // 4K 只在云端可选（前端按 runtime.remoteAvailable 放开），换算必须真的给到 4096，
  // 否则选了 4K 实际出 1024 —— 静默降级成用户看不出来的谎
  const base = quality === '4k' ? 4096 : quality === '2k' ? 2048 : 1024;
  const w = rw >= rh ? base : Math.round((base * rw) / rh);
  const h = rw >= rh ? Math.round((base * rh) / rw) : base;
  return { field: 'size', value: `${Math.round(w / 64) * 64}x${Math.round(h / 64) * 64}` };
}

/**
 * 参考站字段 → 通道尺寸字段。
 *
 * 各工具页仍同时提交旧字段（ratio/size）以兼容存量调用方；新接入的
 * targetImageRatio（扩图）、imageRatio（重绘/精修/旋转）和 resolution（抠图）
 * 必须也能直接生效，否则 API 调用方只发参考站字段时会静默落回 1:1/1K。
 */
function channelRatio(params: Record<string, any>): string | undefined {
  const value = params.targetImageRatio || params.imageRatio || params.ratio;
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function channelQuality(params: Record<string, any>): string | undefined {
  const value = params.resolution || params.size;
  return value === undefined || value === null || value === '' ? undefined : String(value).toLowerCase();
}

/** 协议形状 —— 转发到协议层, 本文件不再自带副本 */
export type { ProtocolSpec as ProtocolShape } from './protocols/protocol.spec';

const MAX_REF_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = Number(process.env.GATEWAY_MAX_OUTPUT_BYTES) || 50 * 1024 * 1024;

export abstract class BaseImageProvider {
  /**
   * 协议标识 —— 形状从协议层取。
   *
   * ⚠️ 构造期**只记标识**, 不快照形状: 协议形状是编译期常量, 无需每调用读;
   * 但配置 (baseUrl/token/timeout) 必须每次调用读, 见下方 cfg getter。
   */
  constructor(protected readonly protocolId: string) {}

  /** 该协议的形状 (来自协议层唯一声明处) */
  protected get spec(): ProtocolSpec {
    const s = protocolSpec(this.protocolId);
    if (!s) {
      throw new GatewayUnavailableError(
        `未知通道协议 "${this.protocolId}"`,
        '该协议未在 protocol.spec.ts 的 PROTOCOL_SPECS 中声明',
      );
    }
    return s;
  }

  private get cfg() {
    return gatewayConfig();
  }

  /**
   * 本次调用使用的**通道级**凭据 (2026-10-20 多渠道)。
   *
   * ## 为什么需要它
   *
   * 改造前 provider 只从 `gatewayConfig()` 读全局配置 —— 那意味着一家厂商
   * 一套 baseUrl/token/model。多渠道调度器选出了第二条通道, 但 provider
   * 仍用第一条的凭据去请求 → **"切换通道"是假的**: 第一家挂了切过去,
   * 发的还是第一家的地址, 照样失败。
   *
   * 故调度器选中某条通道时, 把它的凭据注入进来, 覆盖全局配置。
   * 未注入时 (单通道路径 / 本地调用) 仍读全局, 行为与改造前一致。
   *
   * ⚠️ 用**每次调用时设置**而非构造期传参: provider 实例由工厂按协议创建,
   * 一条通道一个实例的话工厂要按 priority 缓存实例, 反而复杂。
   */
  private channelCreds?: { baseUrl: string; token: string; model: string };

  /** 注入通道级凭据 (由调度器在调用前设置) */
  withChannel(creds: { baseUrl: string; token: string; model: string }): this {
    this.channelCreds = creds;
    return this;
  }

  /** 清掉通道级凭据, 恢复读全局配置 */
  clearChannel(): this {
    this.channelCreds = undefined;
    return this;
  }

  get enabled(): boolean {
    return gatewayConfig().enabled;
  }

  /**
   * @param maskPath 遮罩 PNG 的**本地磁盘路径**（可选）。
   *
   * ⚠️ 只有声明 `maskSupport: 'edits'` 的协议能接收。其它协议收到遮罩时
   * 必须抛 `MaskUnsupportedError`，**不得**忽略后照常整图生成 ——
   * 那是「用户涂了 A 区域、模型改了整张图」的静默不实。
   */
  async generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
    prompt: string,
    maskPath?: string,
    requireImageEdit = false,
  ): Promise<GatewayResult> {
    const cfg = this.cfg;
    // 通道级凭据优先于全局配置 (多渠道下每家地址/令牌/模型都不同)
    const creds = this.channelCreds ?? cfg;
    if (!creds.baseUrl && !creds.token) {
      throw new GatewayUnavailableError('未配置网关', '网关基址与令牌均为空, 或通道被显式关闭');
    }
    const spec = this.spec;
    const model = creds.model || spec.defaultModel;
    const promptText = prompt || String(params.prompt ?? '');

    const useEditEndpoint = Boolean(maskPath) || (requireImageEdit && inputPaths.length > 0);
    if (useEditEndpoint && (spec.maskSupport !== 'edits' || !spec.maskEndpoint)) {
      throw maskPath
        ? new MaskUnsupportedError(`${spec.label} (${spec.protocol}) 没有图像编辑端点`)
        : new ImageEditUnsupportedError(`${spec.label} (${spec.protocol}) 没有图像编辑端点`);
    }

    if (useEditEndpoint) {
      return this.generateWithEdit(creds, spec, model, inputPaths[0], maskPath, promptText, params);
    }

    const refs =
      spec.refStyle === 'base64'
        ? await refImagesAsBase64(inputPaths, spec.maxRefImages, MAX_REF_BYTES)
        : refImagesAsUrl(inputPaths, cfg.assetBase, spec.maxRefImages, toSiteUrl);

    const body: Record<string, unknown> = {
      model,
      prompt: promptText,
      n: 1,
      ...spec.buildRefField(refs),
    };
    const size = buildSize(spec.sizeStyle, channelRatio(params), channelQuality(params));
    if (size) body[size.field] = size.value;

    const json = await this.post(creds.baseUrl, creds.token, spec.endpoint(creds.baseUrl), body);

    const err = spec.extractError(json);
    if (err) {
      throw new GatewayUnavailableError(`${spec.label}返回错误`, err);
    }
    const { url, b64 } = spec.extract(json);
    if (!url && !b64) {
      throw new GatewayUnavailableError('响应缺少产出图', summarizeJson(json));
    }
    const buffer = b64
      ? Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : await this.download(url!);
    if (!buffer.length) throw new GatewayUnavailableError('产出图为空', summarizeJson(json));
    const format = detectImageFormat(buffer);
    if (!format) throw new GatewayUnavailableError('通道返回的不是受支持图片', '响应内容无法通过图片魔数校验');

    return {
      buffer,
      // 按字节魔数判格式, 不看 URL 后缀 —— 火山/MiniMax 返回的链接常无扩展名
      format,
      taskId: String(json?.id ?? json?.created ?? ''),
      model,
      prompt,
    };
  }

  /**
   * 带遮罩的图像编辑（OpenAI 兼容 `/v1/images/edits`，2026-10-22）。
   *
   * ## 为什么不能复用 JSON 的 generate
   *
   * `images/edits` 是 **multipart/form-data**：`image` / `mask` 必须是文件段，
   * 而不是 base64 字符串。把 base64 塞进 JSON 的 `image` 字段只有部分兼容
   * 实现接受，官方端点会直接 400。故这里单独走一条通道，不把两种编码方式
   * 混进同一个 body 构造里。
   *
   * ## 用第一张输入图
   *
   * 遮罩是「在同一张图上重绘」。协议层不声明多图+遮罩的语义（各家不一致），
   * 故只取 `inputPaths[0]` —— 局部重绘的能力定义本就是 `inputs: 1`，
   * 多张也不会走到这里。
   *
   * 失败语义与 generate 完全一致：HTTP 非 2xx / 业务错误 / 无产出图都抛
   * `GatewayUnavailableError`，由路由器决定换通道还是判失败。
   */
  private async generateWithEdit(
    creds: { baseUrl: string; token: string; model: string },
    spec: ProtocolSpec,
    model: string,
    imagePath: string | undefined,
    maskPath: string | undefined,
    promptText: string,
    params: Record<string, any>,
  ): Promise<GatewayResult> {
    if (!imagePath) {
      throw new GatewayUnavailableError('缺少待编辑的原图', '遮罩重绘需要 1 张输入图');
    }
    const imageBuf = await readFile(imagePath).catch(() => null);
    if (!imageBuf) throw new GatewayUnavailableError('读取原图失败', imagePath);
    const maskBuf = maskPath ? await readFile(maskPath).catch(() => null) : undefined;
    if (maskPath && !maskBuf) throw new GatewayUnavailableError('读取遮罩失败', maskPath);

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', promptText);
    form.append('n', '1');
    form.append('image', new Blob([imageBuf], { type: mimeOf(imagePath) }), fileNameOf(imagePath));
    if (maskBuf) {
      // 遮罩必须是 PNG（OpenAI 文档硬要求），且与 image 同尺寸 —— 前端按原图尺寸生成
      form.append('mask', new Blob([maskBuf], { type: 'image/png' }), 'mask.png');
    }
    /*
     * “原比例”要翻译成原图的**具体像素比**。
     *
     * 第一版直接省略 size，期待服务端沿用底图比例；实测 a6api 的 edits 通道
     * 会按默认正方形出图，960×1280 的水壶变成 1254×1254，两侧出现大片留白。
     * 故从文件头读尺寸，转换为 `宽:高` 后再走既有尺寸换算。
     */
    // 未声明比例的能力（手动去水印 / 图片翻译）同样应保持输入图画幅，
    // 不能把「没有 ratio 字段」误当成默认正方形。
    const requestedRatio = channelRatio(params) ?? 'original';
    const dimensions = requestedRatio === 'original' ? readImageDimensions(imageBuf) : null;
    const editRatio = dimensions ? `${dimensions.width}:${dimensions.height}` : requestedRatio;
    if (editRatio !== 'original') {
      const size = buildSize(spec.sizeStyle, editRatio, channelQuality(params));
      if (size) form.append(size.field, size.value);
    }

    const json = await this.postMultipart(creds.baseUrl, creds.token, spec.maskEndpoint!(creds.baseUrl), form);

    const err = spec.extractError(json);
    if (err) throw new GatewayUnavailableError(`${spec.label}返回错误`, err);
    // b64_json 优先（edits 端点最常见形态），url 兜底 —— spec.extract 两种都认
    const { url, b64 } = spec.extract(json);
    if (!url && !b64) throw new GatewayUnavailableError('响应缺少产出图', summarizeJson(json));
    const buffer = b64
      ? Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : await this.download(url!);
    if (!buffer.length) throw new GatewayUnavailableError('产出图为空', summarizeJson(json));
    const format = detectImageFormat(buffer);
    if (!format) throw new GatewayUnavailableError('通道返回的不是受支持图片', '响应内容无法通过图片魔数校验');

    return {
      buffer,
      format,
      taskId: String(json?.id ?? json?.created ?? ''),
      model,
      prompt: promptText,
    };
  }

  private async post(baseUrl: string, token: string, url: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new GatewayUnavailableError('提交失败', `HTTP ${res.status} ${text.slice(0, 300)}`);
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new GatewayUnavailableError('响应不是合法 JSON', text.slice(0, 300));
      }
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      const msg = (e as Error).message || String(e);
      throw new GatewayUnavailableError(/abort/i.test(msg) ? '调用超时' : '请求失败', msg);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * multipart 提交（2026-10-22，遮罩重绘用）。
   *
   * ⚠️ **不要手写 `Content-Type`**：boundary 由 fetch 根据 FormData 自动生成，
   * 自己写 `multipart/form-data` 反而缺 boundary，服务端无法解析出任何文件段
   * （表现为「收不到 image」而不是明确的格式错误）。
   */
  private async postMultipart(baseUrl: string, token: string, url: string, form: FormData): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers, body: form, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new GatewayUnavailableError('提交失败', `HTTP ${res.status} ${text.slice(0, 300)}`);
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new GatewayUnavailableError('响应不是合法 JSON', text.slice(0, 300));
      }
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      const msg = (e as Error).message || String(e);
      throw new GatewayUnavailableError(/abort/i.test(msg) ? '调用超时' : '请求失败', msg);
    } finally {
      clearTimeout(timer);
    }
  }

  protected async download(url: string): Promise<Buffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      let current = this.assertSafeDownloadUrl(url);
      // 手动跟随重定向：每一跳都重新做协议/私网校验，避免公网地址 302 到内网。
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        const res = await fetch(current, { signal: ctrl.signal, redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location || redirects === 3) {
            throw new GatewayUnavailableError('下载产出图失败', '重定向次数过多或缺少 Location');
          }
          current = this.assertSafeDownloadUrl(new URL(location, current).toString());
          continue;
        }
        if (!res.ok) throw new GatewayUnavailableError('下载产出图失败', `HTTP ${res.status}`);
        const declared = Number(res.headers.get('content-length') ?? 0);
        if (declared > MAX_OUTPUT_BYTES) {
          throw new GatewayUnavailableError('产出图过大', `${declared} bytes`);
        }
        if (!res.body) return Buffer.from(await res.arrayBuffer());
        const reader = res.body.getReader();
        const chunks: Buffer[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_OUTPUT_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new GatewayUnavailableError('产出图过大', `超过 ${MAX_OUTPUT_BYTES} bytes`);
          }
          chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
      }
      throw new GatewayUnavailableError('下载产出图失败', '重定向次数过多');
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      throw new GatewayUnavailableError('下载产出图失败', (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 通道返回的下载 URL 不能直接打进任意地址。公网通道返回私网/回环地址时
   * 拒绝，避免被上游响应诱导访问本机管理端口。本地联调（网关基址本身也是
   * 回环/私网）仍允许，保证 stub provider 测试不被误伤。
   */
  private assertSafeDownloadUrl(raw: string): string {
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new GatewayUnavailableError('产出图地址无效', String(raw).slice(0, 200));
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new GatewayUnavailableError('产出图地址协议不允许', target.protocol);
    }
    if (!isPrivateHost(target.hostname)) return target.toString();

    const baseUrl = this.channelCreds?.baseUrl || this.cfg.baseUrl;
    let basePrivate = false;
    try {
      basePrivate = Boolean(baseUrl) && isPrivateHost(new URL(baseUrl).hostname);
    } catch {
      basePrivate = false;
    }
    if (!basePrivate) {
      throw new GatewayUnavailableError('产出图地址指向私网', target.hostname);
    }
    return target.toString();
  }
}

/**
 * 文件名（multipart 文件段需要）。
 *
 * 只用 basename 且固定保留原扩展名 —— 文件段的名字会进入对方的日志与
 * 内容嗅探，带完整路径没有好处。
 */
function fileNameOf(p: string): string {
  const base = p.split('/').pop() || 'image';
  return base.slice(-64);
}

/** 磁盘绝对路径 → 站内相对路径 (/uploads/xxx) */
function toSiteUrl(abs: string): string {
  const marker = '/uploads/';
  const i = abs.indexOf(marker);
  if (i >= 0) return abs.slice(i);
  const parts = abs.split('/');
  return `/uploads/${parts[parts.length - 1]}`;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return true;
  }
  const match = /^172\.(\d{1,3})\./.exec(host);
  if (match) {
    const octet = Number(match[1]);
    return octet >= 16 && octet <= 31;
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}
