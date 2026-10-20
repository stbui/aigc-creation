import { readFile } from 'fs/promises';
import { extname } from 'path';
import { gatewayConfig } from './gateway.config';
import { GatewayUnavailableError, type GatewayResult } from './gateway.types';
import { sniffImageFormat } from './image-format';
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
  const base = quality === '2k' ? 2048 : 1024;
  const w = rw >= rh ? base : Math.round((base * rw) / rh);
  const h = rw >= rh ? Math.round((base * rh) / rw) : base;
  return { field: 'size', value: `${Math.round(w / 64) * 64}x${Math.round(h / 64) * 64}` };
}

/** 协议形状 —— 转发到协议层, 本文件不再自带副本 */
export type { ProtocolSpec as ProtocolShape } from './protocols/protocol.spec';

const MAX_REF_BYTES = 4 * 1024 * 1024;

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

  get enabled(): boolean {
    return gatewayConfig().enabled;
  }

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
    const spec = this.spec;
    const model = cfg.model || spec.defaultModel;

    const refs =
      spec.refStyle === 'base64'
        ? await refImagesAsBase64(inputPaths, spec.maxRefImages, MAX_REF_BYTES)
        : refImagesAsUrl(inputPaths, cfg.assetBase, spec.maxRefImages, toSiteUrl);

    const body: Record<string, unknown> = {
      model,
      prompt: prompt || String(params.prompt ?? ''),
      n: 1,
      ...spec.buildRefField(refs),
    };
    const size = buildSize(spec.sizeStyle, params.ratio, params.size);
    if (size) body[size.field] = size.value;

    const json = await this.post(cfg.baseUrl, cfg.token, spec.endpoint(cfg.baseUrl), body);

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

    return {
      buffer,
      // 按字节魔数判格式, 不看 URL 后缀 —— 火山/MiniMax 返回的链接常无扩展名
      format: sniffImageFormat(buffer),
      taskId: String(json?.id ?? json?.created ?? ''),
      model,
      prompt,
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

  protected async download(url: string): Promise<Buffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new GatewayUnavailableError('下载产出图失败', `HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof GatewayUnavailableError) throw e;
      throw new GatewayUnavailableError('下载产出图失败', (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 磁盘绝对路径 → 站内相对路径 (/uploads/xxx) */
function toSiteUrl(abs: string): string {
  const marker = '/uploads/';
  const i = abs.indexOf(marker);
  if (i >= 0) return abs.slice(i);
  const parts = abs.split('/');
  return `/uploads/${parts[parts.length - 1]}`;
}
