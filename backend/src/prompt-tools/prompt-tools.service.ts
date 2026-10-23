import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TEXT_PROVIDER } from '../providers/providers.module';
import { Inject } from '@nestjs/common';
import type { TextProvider, TextMessage } from '../providers/text-provider.interface';
import { AppError } from '../common/app.exception';
import type { StorageBackend } from '../storage/storage.provider';

/**
 * 提示词工具服务 —— AI 润色 / 图片转提示词。
 *
 * ## 定位
 *
 * 这两个功能**不产出图片**, 产出的是一段文字, 故走文生文通道 (TEXT_PROVIDER),
 * 不进 generate 任务体系 —— 没有任务、没有轮询、没有积分扣减, 是同步调用。
 *
 * ## 为什么不复用 generate 任务
 *
 * generate 的产物是 Asset + GenerationTask, 面向"生成一张图并留档"。
 * 润色产出的是**待填入表单的文本**, 不是作品; 若走任务体系, 用户每按一次
 * 润色就多一条任务记录, 作品列表会被"润色"刷屏, 语义完全不对。
 *
 * ## 与本项目既有约定的一致性
 *
 * 1. **无本地兜底**: 文本没有"本地算法"可言, 通道不可用即如实报错,
 *    不编造一段模板文案。调用方 (前端) 负责把错误呈现给用户。
 * 2. **来源如实标记**: 返回体带 source (恒为 gateway) 与 model (渠道回报的
 *    实际模型名), 前端可据此显示"由 XX 模型生成", 不含糊。
 * 3. **提示词构造不写死在本文件**: 改写指令的措辞属于业务策略, 与通道调用
 *    分离, 便于运营后续调整而不动调用链。
 *
 * ## ⚠️ 已知缺口: 未写 ModelCallLog
 *
 * 图像链路的每次调用都写一条 ModelCallLog (后台「模型调用记录」页可查耗时/成败/
 * 回落原因), 但那表结构是**图像专用** (outputBytes / width / height)。
 * 记文本调用需先给表加 modality 与 token 用量字段 —— 属 schema 变更,
 * 不在本次改动范围内。
 *
 * 后果要说清: **本模块的调用在后台调用记录里看不到**。排障时可查的证据是
 * 应用日志 (AppFileLogger) 与返回体里的 model 字段, 不是调用记录表。
 * 这不构成"静默失败" —— 失败会抛错给前端, 用户看得见。
 */
@Injectable()
export class PromptToolsService {
  private readonly log = new Logger(PromptToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(TEXT_PROVIDER) private readonly text: TextProvider,
  ) {}

  /**
   * AI 润色 —— 把用户的原始提示词改写得更专业、更完整。
   *
   * @param text 原始提示词
   * @param textOnly 是否仅润色文字 (不增删画面要素)
   */
  async polish(text: string, textOnly = false): Promise<PromptToolResult> {
    const system = textOnly
      ? '你是资深电商视觉提示词工程师。请在**不改变画面主体、场景、光线、构图**的前提下，' +
        '把用户的描述润色为更专业、更有画面感的电商视觉提示词。' +
        '只改写措辞与语序，不新增画面要素，不删减已有要素。'
      : '你是资深电商视觉提示词工程师。请把用户的描述补全为一段完整、专业、' +
        '可直接用于文生图的电商视觉提示词：补齐主体细节、场景、光线、镜头、质感与风格，' +
        '但**不得臆造用户未提及的品牌、价格、销量、功效承诺等事实性信息**。' +
        '输出一段连贯的中文提示词，不要分点，不要解释，不要加引号。';

    const result = await this.text.generate(
      'prompt_polish',
      [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      { maxTokens: 1024, temperature: 0.7 },
    );

    return {
      text: result.text.trim(),
      source: result.source,
      model: result.model,
      usage: result.usage,
    };
  }

  /**
   * 图片转提示词 —— 让多模态模型看图并写出可用于生图的描述。
   *
   * ## 图片怎么传给模型
   *
   * 走 **base64 data URL 内联**, 不传公网 URL:
   *   网关要回拉 URL 时, 本站素材地址在本地开发是 `http://localhost:4100/...`,
   *   网关服务器根本拉不到 —— 会静默超时或返回"图里没有内容"。
   *   base64 内联没有回拉环节, 是开发与生产都成立的唯一稳法。
   *   (已在 modelverse + gpt-4o-mini 实测: base64 图被正确识别。)
   *
   * ## 素材读取的归属校验
   *
   * 只读**当前用户自己的**素材: 别人的素材 id 猜出来也读不到,
   * 避免把站内接口变成任意图片读取代理。
   */
  async imageToPrompt(ownerId: string, assetId: string, extra?: string): Promise<PromptToolResult> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || asset.ownerId !== ownerId) {
      throw new AppError(40400, '素材不存在或无权限', 404);
    }

    const buffer = await this.readAssetBytes(asset.storageKey, asset.storageBackend);
    if (!buffer) {
      throw new AppError(40400, '素材文件已丢失，无法解析', 404);
    }

    // 视觉模型的图片输入有大小上限, 超大图直接传会被网关拒 (400)。
    // 故超过阈值时按比例缩到阈值内 —— 缩略图足够模型识别画面内容。
    const dataUrl = await this.toDataUrl(buffer, asset.format);

    const system =
      '你是资深的电商视觉分析师。请分析这张图片, 写出一段可用于文生图模型的**中文提示词**。' +
      '要求: 客观描述画面里真实存在的内容 (主体/材质/颜色/构图/光线/场景/风格), ' +
      '不要臆造图片里没有的东西, 不要写品牌名/价格/销量等事实性信息, ' +
      '不要分点, 输出纯一段连贯中文。';

    const userText = extra
      ? `请在客观描述的基础上, 额外关注: ${extra}`
      : '请客观描述这张图片, 输出一段可直接用于生图的中文提示词。';

    const result = await this.text.generate(
      'image_to_prompt',
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      { maxTokens: 1024, temperature: 0.5 },
    );

    return {
      text: result.text.trim(),
      source: result.source,
      model: result.model,
      usage: result.usage,
    };
  }

  /**
   * 读素材字节。
   *
   * ⚠️ 必须按**素材记录里的 storageBackend** 取 provider ——
   * 切换默认后端后老素材仍存在原后端, 用当前默认后端读会全部读不到
   * (与 storage.service.ts 的同款约定)。
   */
  private async readAssetBytes(
    storageKey: string | null,
    backend: string | null,
  ): Promise<Buffer | null> {
    if (!storageKey) return null;
    const provider = this.storage.get((backend as StorageBackend) ?? this.storage.activeBackend);
    if (!provider) return null;
    try {
      return await provider.get(storageKey);
    } catch (e) {
      this.log.warn(`读取素材字节失败 (key=${storageKey}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 字节 → data URL。
   *
   * ⚠️ **格式按字节魔数判定, 不看扩展名/URL 后缀** ——
   * 第三方上传的图可能没有扩展名, 按后缀猜会把 PNG 当 JPEG 标,
   * 模型侧可能因格式不符而拒收 (实测踩过: 优云智算返回的 OSS 链接无扩展名)。
   */
  private async toDataUrl(buffer: Buffer, declaredFormat?: string | null): Promise<string> {
    const mime = sniffImageMime(buffer) ?? (declaredFormat ? `image/${declaredFormat}` : 'image/png');
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
}

/** 提示词工具的返回形状 */
export interface PromptToolResult {
  /** 产出的文本 */
  text: string;
  /** 来源 (恒为 gateway —— 文本无本地兜底) */
  source: string;
  /** 渠道回报的实际模型名 */
  model?: string;
  /** 分词用量 */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * 按字节魔数判定图片 MIME。
 *
 * 与前端/图像 provider 里的同名函数同源 (modelverse-image.provider.ts 的
 * sniffImageFormat) —— **只有魔数可靠**, 扩展名与 URL 后缀都可能是错的。
 */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
    return 'image/gif';
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand.startsWith('hei') || brand.startsWith('mif1')) return 'image/heic';
  }
  return null;
}
