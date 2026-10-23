/**
 * AIGC 内容标识（生成式合成内容标识）。
 *
 * 依据
 * ----
 * 《人工智能生成合成内容标识办法》（2025-09-01 施行）与 GB 45438-2025《网络安全
 * 技术 人工智能生成合成内容标识方法》要求 AIGC 产出同时具备两类标识：
 *   · **显式标识**：用户可感知的文字/图形标记（本文件：右下角「AI 生成」角标）；
 *   · **隐式标识**：文件元数据中的合成标识（本文件：PNG tEXt/iTXt + JPEG APP1 XMP，
 *     写入 IPTC `DigitalSourceType = trainedAlgorithmicMedia`）。
 *
 * 为什么手写字节而不是引库
 * ----------------------
 * 项目依赖纪律是「精确锁定 + 手工直装」，exif 类库会带进一串传递依赖，
 * 而这里需要的只是**在正确位置插入一个长度正确的块**：
 *   · PNG：chunk = 长度(4) + 类型(4) + 数据 + CRC32(4)，插在 IEND 之前即可；
 *   · JPEG：APP1 段 = FFE1 + 长度(2) + `http://ns.adobe.com/xap/1.0/\0` + XMP。
 * 两者都是几十行内置能力可覆盖的确定性字节操作，引入依赖反而增加漂移风险。
 *
 * 失败策略（与计划一致）
 * --------------------
 * · **显式角标失败 → 抛错**，由调用方把任务判失败并退款 —— 未标识的产出不许落库；
 * · **隐式元数据失败 → 不抛错**，只回报 `metadata: false` 并告警，图片仍可交付。
 *   理由：元数据是"附在文件里"的合规证据，写不进去至少还有可见角标；
 *   而可见角标写不进去，用户拿到手就是一张无标识的 AI 图，性质完全不同。
 * · **例外：可见角标被后台关闭时，隐式元数据失败同样抛错** —— 此时两类标识
 *   一个都没写进去，再"宽容交付"就等于交付了一张无标识的 AI 图。
 */
import { Jimp, JimpMime } from 'jimp';
import { AIGC_LABEL_PNG_BASE64 } from './aigc-label-badge';
import {
  AIGC_LABEL_DEFAULTS,
  sanitizeAigcLabelSpec,
  type AigcLabelSpec,
} from './aigc-label.config';

/** 显式角标合成失败。调用方必须据此判定任务失败并退款，不能静默交付未标识产出。 */
export class AigcVisibleLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AigcVisibleLabelError';
  }
}

export interface AigcMeta {
  /** 是否完成了任何形式的标识 */
  labeled: boolean;
  /** 隐式标识（文件内嵌元数据）是否写入成功 */
  metadata: boolean;
  /** 显式标识（可见角标）是否合成成功；后台关闭角标时为 false */
  visible: boolean;
  /** 写入方式，便于排障与审计回溯 */
  method: 'png-text+xmp' | 'jpeg-xmp' | 'visible-only' | 'unsupported' | 'api-only';
  /** 需要人工留意的说明：隐式标识失败、或可见角标被后台关闭 */
  warning?: string;
}

/**
 * 可见角标的运行时素材。
 *
 * `badgePng` 由后台页面用浏览器 Canvas 渲染（中文只能这样栅格化），
 * 服务端只做缩放/定位/合成。不传则使用内置默认角标 + 默认几何 ——
 * 冒烟脚本的离线模式与「后台从未配置过」的部署走的都是这条路径。
 */
export interface VisibleLabelRender {
  spec?: Partial<AigcLabelSpec> | null;
  badgePng?: Buffer | null;
}

export interface AigcLabelOptions {
  /** 产出所归属的能力 id，写进 XMP 便于溯源 */
  capability?: string;
  /** 任务 id，写进 XMP（同一张图被转发后仍可追回来源任务） */
  taskId?: string;
  /** 生成时间，默认当前时刻 */
  createdAt?: Date;
  /** 可见角标素材；缺省 = 内置默认角标 */
  visible?: VisibleLabelRender | null;
}

// ─────────────────────────────────────────────────────────────────────
// CRC32（PNG chunk 校验必需；Node 26 虽内置 zlib.crc32，但实现只需 10 行，
// 自己算可避免对 Node 小版本的隐性要求）
// ─────────────────────────────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────
// XMP 报文
// ─────────────────────────────────────────────────────────────────────

const XMP_PACKET = (opts: AigcLabelOptions): string => {
  const iso = (opts.createdAt ?? new Date()).toISOString();
  const tool = ['HuojueAI', opts.capability].filter(Boolean).join(' / ');
  // XMP 是纯文本 XML，注意转义；能力 id 与任务 id 均为 [a-z0-9_] / cuid，无需复杂清洗
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="HuojueAI">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmp:CreatorTool="${tool}"
    xmp:CreateDate="${iso}"
    Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia">
   <dc:creator><rdf:Seq><rdf:li>货觉AI（生成式合成内容）</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">本图片由人工智能模型生成，已按 GB 45438-2025 添加标识</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
};

// ─────────────────────────────────────────────────────────────────────
// PNG
// ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** 找到 IEND chunk 的起始偏移；结构非法返回 -1 */
function findPngIend(buf: Buffer): number {
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'IEND') return off;
    // 长度字段被篡改时继续走会越界，直接放弃（宁可只加显式角标）
    if (len > buf.length) return -1;
    off += 12 + len;
  }
  return -1;
}

function pngTextChunk(keyword: string, text: string): Buffer {
  // tEXt 规定 Latin-1；中文放不进去，中文说明走 iTXt（XMP）与可见角标
  return pngChunk('tEXt', Buffer.concat([Buffer.from(`${keyword}\0`, 'latin1'), Buffer.from(text, 'latin1')]));
}

function pngItxtChunk(keyword: string, text: string): Buffer {
  // iTXt: keyword\0 flag(0) method(0) lang\0 translated\0 text(UTF-8)
  const body = Buffer.concat([
    Buffer.from(`${keyword}\0`, 'latin1'),
    Buffer.from([0, 0]),
    Buffer.from('\0', 'latin1'),
    Buffer.from('\0', 'latin1'),
    Buffer.from(text, 'utf8'),
  ]);
  return pngChunk('iTXt', body);
}

function insertPngMetadata(buf: Buffer, opts: AigcLabelOptions): Buffer {
  const iend = findPngIend(buf);
  if (iend < 0) throw new Error('PNG 结构无法解析（找不到 IEND）');
  const xmp = XMP_PACKET(opts);
  const chunks = Buffer.concat([
    pngTextChunk('Software', 'HuojueAI'),
    pngTextChunk('Comment', 'AI-generated content (AIGC). Labeled per GB 45438-2025.'),
    pngItxtChunk('XML:com.adobe.xmp', xmp),
  ]);
  return Buffer.concat([buf.subarray(0, iend), chunks, buf.subarray(iend)]);
}

// ─────────────────────────────────────────────────────────────────────
// JPEG
// ─────────────────────────────────────────────────────────────────────

const XMP_APP1_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

function insertJpegMetadata(buf: Buffer, opts: AigcLabelOptions): Buffer {
  const xmp = Buffer.from(XMP_PACKET(opts), 'utf8');
  // 已有 XMP（例如云端模型回传时就带了）：不再重复插入，避免段长累加与解析歧义
  const probe = buf.subarray(0, Math.min(buf.length, 4096));
  if (probe.includes(XMP_APP1_HEADER)) return buf;

  const segLen = xmp.length + XMP_APP1_HEADER.length + 2;
  if (segLen > 0xffff) throw new Error('XMP 报文超出 JPEG APP1 段长上限');

  // XMP 应排在 APP0(JFIF) 之后、其它段之前
  let off = 2;
  if (buf[off] === 0xff && buf[off + 1] === 0xe0 && off + 4 <= buf.length) {
    off += 2 + buf.readUInt16BE(off + 2);
  }
  if (off > buf.length) throw new Error('JPEG 结构无法解析（APP0 段越界）');

  const segHead = Buffer.alloc(4);
  segHead[0] = 0xff;
  segHead[1] = 0xe1;
  segHead.writeUInt16BE(segLen, 2);

  return Buffer.concat([buf.subarray(0, off), segHead, XMP_APP1_HEADER, xmp, buf.subarray(off)]);
}

// ─────────────────────────────────────────────────────────────────────
// 显式角标
// ─────────────────────────────────────────────────────────────────────

type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

/**
 * 角标位图缓存。
 *
 * 默认角标恒定；自定义角标在后台保存后变化。按 base64 内容做键，
 * 只留最近 4 份 —— 自定义角标通常只有一份，留余量是为了「刚保存完
 * 还在跑的任务」不至于每次重读。
 */
const badgeCache = new Map<string, JimpImage>();
const BADGE_CACHE_LIMIT = 4;

async function loadBadge(badgePng?: Buffer | null): Promise<JimpImage> {
  const raw = badgePng?.length ? badgePng : Buffer.from(AIGC_LABEL_PNG_BASE64, 'base64');
  const key = raw.toString('base64');
  const cached = badgeCache.get(key);
  if (cached) return cached.clone();

  const image = await Jimp.read(raw);
  if (badgeCache.size >= BADGE_CACHE_LIMIT) {
    badgeCache.delete(badgeCache.keys().next().value as string);
  }
  badgeCache.set(key, image);
  return image.clone();
}

/**
 * 在图片上合成可见角标。
 *
 * 几何规则（全部可配，默认值 = 改造前行为）：
 *   · 宽度 = 图片宽度 × `scalePercent`%，夹在 [minWidthPx, maxWidthPx]；
 *   · 高度按位图比例缩放，且不得超出图片本身（小图不越界）；
 *   · 边距 = 图片宽度 × `marginPercent`%，至少 6px；
 *   · `opacity` 作用于整个角标。
 *
 * `spec.text` 等渲染字段在这里**不参与绘制** —— 文字已经在 badgePng 里。
 */
export async function composeVisibleLabel(
  buffer: Buffer,
  format: string,
  render?: VisibleLabelRender | null,
): Promise<Buffer> {
  try {
    const spec = sanitizeAigcLabelSpec(render?.spec ?? AIGC_LABEL_DEFAULTS);
    // 后台关闭可见角标：原样返回，绝不重编码（关闭前后除元数据外应逐字节一致）
    if (!spec.enabled) return buffer;
    const image = await Jimp.read(buffer);
    const badge = await loadBadge(render?.badgePng);

    const imgW = image.bitmap.width;
    const imgH = image.bitmap.height;

    let targetW = Math.round(
      Math.min(spec.maxWidthPx, Math.max(spec.minWidthPx, (imgW * spec.scalePercent) / 100)),
    );
    targetW = Math.max(1, Math.min(targetW, imgW));
    let targetH = Math.max(
      1,
      Math.round((badge.bitmap.height / Math.max(1, badge.bitmap.width)) * targetW),
    );
    // 小图：高度超出时按高度回缩宽度，保持比例
    if (targetH > imgH) {
      targetH = imgH;
      targetW = Math.max(1, Math.round((badge.bitmap.width / badge.bitmap.height) * targetH));
    }
    badge.resize({ w: targetW, h: targetH });

    if (spec.opacity < 100) badge.opacity(spec.opacity / 100);

    const margin = Math.max(6, Math.round((imgW * spec.marginPercent) / 100));
    const right = Math.max(0, imgW - targetW - margin);
    const bottom = Math.max(0, imgH - targetH - margin);
    const x = spec.position.endsWith('right') ? right : Math.min(margin, Math.max(0, imgW - targetW));
    const y = spec.position.startsWith('bottom')
      ? bottom
      : Math.min(margin, Math.max(0, imgH - targetH));
    image.composite(badge, x, y);

    const isPngOut = /image\/png/i.test(format);
    // getBuffer 的 options 是按 mime 分派的联合类型, 传三元表达式会被推成 never;
    // 分开调用既满足类型, 也把「PNG 无质量参数」这件事写清楚
    return isPngOut ? await image.getBuffer(JimpMime.png) : await image.getBuffer(JimpMime.jpeg, { quality: 92 });
  } catch (e) {
    throw new AigcVisibleLabelError(`可见 AIGC 角标合成失败: ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 对外入口
// ─────────────────────────────────────────────────────────────────────

/**
 * 给一张生成图打上显式 + 隐式标识。
 *
 * 顺序不可交换：**先合成角标，再写元数据**。Jimp 重编码会丢掉自己不认识
 * 的 chunk/段，先写元数据再合成等于把刚写进去的 XMP 又抹掉。
 *
 * @throws AigcVisibleLabelError 显式角标失败（调用方必须让任务失败并退款）
 */
export async function labelGeneratedImage(
  buffer: Buffer,
  format: string,
  opts: AigcLabelOptions = {},
): Promise<{ buffer: Buffer; format: string; meta: AigcMeta }> {
  if (!/^image\//i.test(format)) {
    return {
      buffer,
      format,
      meta: { labeled: false, metadata: false, visible: false, method: 'unsupported' },
    };
  }

  /*
   * Jimp 重编码后实际格式只有 PNG / JPEG 两种:
   * 输入是 PNG 输出 PNG, 其余 (JPEG/WebP/GIF) 一律转 JPEG。
   * 调用方**必须**用返回的 format 落库, 否则会出现「JPEG 字节以 image/webp
   * 入库」——存储后端按 mime 发 Content-Type, 浏览器解码失败。
   *
   * `enabled=false`（后台关闭可见角标）时 composeVisibleLabel 原样返回，
   * 不重编码 —— 少一次有损转换，也保证关闭后产出与模型原图逐字节一致。
   */
  const visibleEnabled = sanitizeAigcLabelSpec(opts.visible?.spec ?? AIGC_LABEL_DEFAULTS).enabled;
  const visibleBuffer = await composeVisibleLabel(buffer, format, opts.visible);
  const visibleWarning = visibleEnabled ? undefined : '可见角标已按后台配置关闭，仅写入隐式标识';

  try {
    if (isPng(visibleBuffer)) {
      return {
        buffer: insertPngMetadata(visibleBuffer, opts),
        format: 'image/png',
        meta: {
          labeled: true,
          metadata: true,
          visible: visibleEnabled,
          method: 'png-text+xmp',
          warning: visibleWarning,
        },
      };
    }
    if (isJpeg(visibleBuffer)) {
      return {
        buffer: insertJpegMetadata(visibleBuffer, opts),
        format: 'image/jpeg',
        meta: {
          labeled: true,
          metadata: true,
          visible: visibleEnabled,
          method: 'jpeg-xmp',
          warning: visibleWarning,
        },
      };
    }
    // webp / gif 等：本仓库没有无依赖的元数据写入方式，如实回报只做了显式标识
    if (!visibleEnabled) {
      throw new AigcVisibleLabelError(
        `不支持的图片格式 ${format}，且可见角标已关闭：两类标识都无法写入`,
      );
    }
    return {
      buffer: visibleBuffer,
      format: 'image/jpeg',
      meta: {
        labeled: true,
        metadata: false,
        visible: true,
        method: 'visible-only',
        warning: `不支持的图片格式 ${format}，仅写入可见角标`,
      },
    };
  } catch (e) {
    if (e instanceof AigcVisibleLabelError) throw e;
    if (!visibleEnabled) {
      // 显式标识已关闭，隐式标识又失败 = 无任何标识，不许静默交付
      throw new AigcVisibleLabelError(`可见角标已关闭且隐式标识写入失败: ${(e as Error).message}`);
    }
    // 隐式标识失败不阻断交付 —— 可见角标已在图上，合规底线仍守住
    return {
      buffer: visibleBuffer,
      format: isPng(visibleBuffer) ? 'image/png' : 'image/jpeg',
      meta: {
        labeled: true,
        metadata: false,
        visible: true,
        method: 'visible-only',
        warning: `隐式标识写入失败: ${(e as Error).message}`,
      },
    };
  }
}

/** 从文件字节里读回标识信息（冒烟脚本与后台核验用） */
export function inspectAigcLabel(buffer: Buffer): {
  format: 'png' | 'jpeg' | 'other';
  hasXmp: boolean;
  hasDigitalSourceType: boolean;
  xmp?: string;
} {
  if (isPng(buffer)) {
    const iend = findPngIend(buffer);
    const scanEnd = iend > 0 ? iend : buffer.length;
    const text = buffer.subarray(0, scanEnd).toString('utf8');
    return {
      format: 'png',
      hasXmp: text.includes('XML:com.adobe.xmp'),
      hasDigitalSourceType: text.includes('trainedAlgorithmicMedia'),
    };
  }
  if (isJpeg(buffer)) {
    const text = buffer.toString('utf8');
    return {
      format: 'jpeg',
      hasXmp: text.includes('http://ns.adobe.com/xap/1.0/'),
      hasDigitalSourceType: text.includes('trainedAlgorithmicMedia'),
    };
  }
  return { format: 'other', hasXmp: false, hasDigitalSourceType: false };
}
