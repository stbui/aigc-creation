/**
 * 统一模型能力层 —— 模态化接口 (2026-10-20 架构重构)。
 *
 * ## 三层架构中的位置
 *
 * ```
 *   应用层 (aa / bb / cc 应用)
 *        ↓  只依赖本层的接口, 完全不知道厂商与协议存在
 *   统一模型能力层  ← 本文件
 *        ↓  按模态分流, 每个模态一套接口
 *   厂商层 (a 厂 / b 厂 / c 厂)
 *        ↓  厂商内部再归一协议
 *   协议层 (OpenAI 兼容 / 火山 / MiniMax / …)
 * ```
 *
 * ## 为什么按模态分接口而不是一个大接口
 *
 * 三种模态的产物形状根本不同: 图像是 Buffer + mime, 文本是一段字符串,
 * 视频是 Buffer + 时长。塞进一个 `produce(): Buffer` 的统一接口, 文本就得
 * 编码成 UTF-8 字节再解回来, 视频还要额外挂时长字段, 结果是
 * `if (modality === ...)` 横跨所有实现。
 *
 * 故本层的契约是「**按模态平级**」: 应用层按自己要的模态注入对应接口,
 * 每个接口内部只有自己那种形状, 没有 switch。
 *
 * ## 统一的是什么
 *
 * 统一的是**调用契约** (入参形状、结果形状、来源标记、错误语义),
 * 不是**参数细节**。参数细节 (参考图怎么传、尺寸怎么写) 属于协议层,
 * 由协议 adapter 消化 —— 应用层传的是业务语义 (ratio / size / prompt),
 * 协议层负责翻译成各家的写法。
 *
 * ⚠️ **本文件是这三类接口的唯一声明处**。旧文件
 * (image-provider.interface.ts / text-provider.interface.ts / gateway.types.ts)
 * 已改为 re-export 转发, 不再各自定义 —— 否则会出现两套「图像接口」,
 * 那正是能力层刚清掉的那类重复。
 */

import type { Modality } from '../modality';

/**
 * 产出来源。
 *
 * gateway = 真实模型通道产出; local = 本地算法产出。
 * 由路由器填充, 应用层据此如实显示来源 —— 不把本地算法伪装成模型结果,
 * 这是本项目一贯的约定。
 */
export type ProduceSource = 'gateway' | 'local';

/**
 * 统一的图像产出。
 *
 * ⚠️ `source` 保持**可选**, 与改造前的 ImageProviderResult 一致:
 * 本地算法 provider 直接返回字节, 由路由器补上 `source: 'local'`。
 * 改成必填会迫使本地算法 provider 里 11 处产出点全部改写, 而收益仅是让
 * 类型更严 —— 不值得。真正需要区分来源的只有路由器出口, 那里的 source 必定有值。
 */
export interface ImageOutcome {
  /** 模态判别式 —— 让 ModelOutcome 联合类型可被收窄 */
  kind: 'image';
  buffer: Buffer;
  /** mime, 如 image/jpeg | image/png */
  format: string;
  source?: ProduceSource;
  /** 实际使用的模型名 (渠道回报优先) */
  model?: string;
  /** 渠道侧任务 id, 便于对账排障 */
  taskId?: string;
}

/**
 * 统一的文本产出。
 *
 * ⚠️ 文本**没有**本地兜底: 文本没有「本地算法」概念, 编一段模板文案
 * 会让用户误以为是模型产出。故 source 恒为 'gateway'。
 */
export interface TextOutcome {
  kind: 'text';
  text: string;
  source: ProduceSource;
  model?: string;
  taskId?: string;
  /** 分词用量; 渠道回报才有, 否则 undefined (不能臆造) */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * 统一的视频产出。
 *
 * 视频走 MiniMax 的 `minimax-video` 四段式异步契约（2026-10-20 已落地）；
 * 类型在这里独立声明，让应用层按模态统一处理，不必关心厂商与协议。
 */
export interface VideoOutcome {
  kind: 'video';
  buffer: Buffer;
  /** mime, 如 video/mp4 */
  format: string;
  source: ProduceSource;
  model?: string;
  taskId?: string;
  /** 时长 (毫秒); 渠道回报才有 */
  durationMs?: number | null;
}

/** 统一产出联合类型 —— 应用层按 kind 分派即可, 无需知道模态枚举 */
export type ModelOutcome = ImageOutcome | TextOutcome | VideoOutcome;

/**
 * 图像能力接口。
 *
 * ⚠️ 入参刻意**不含**能力 id: 应用层只表达"我要一张图, 比例 1:1,
 * 带 3 张参考图", 不表达"我要 main_image 这个能力" —— 能力 id 是
 * 应用层自己的业务概念, 由能力注册表 (capabilities 模块) 翻译成
 * 提示词与参数。provider 层不该知道能力这个词。
 */
export interface ImageProvider {
  /**
   * @param maskPath 遮罩 PNG 的本地路径（可选）。
   *
   * 局部重绘用它圈定「只改这里」。**不允许**不支持遮罩的通道忽略它：
   * 忽略的后果是整图重绘，用户涂 A 区域却看到 B 区域被改，
   * 且界面上毫无异常。故通道不接受遮罩时抛 `MaskUnsupportedError`，
   * 由应用层判 `42205` 并退款（见 providers/gateway.types.ts）。
   */
  generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
    maskPath?: string,
  ): Promise<ImageOutcome>;
}

/**
 * 文本消息的一段内容 —— 纯文本或一张图片。
 *
 * ## 为什么文本消息要能带图片 (2026-10-20)
 *
 * 「图片转提示词」这类功能本质是**视觉理解**: 把用户上传的图交给多模态模型,
 * 让它描述画面。若 TextMessage.content 只能是 string, 视觉模型就用不了 ——
 * 它收不到图, 只能凭空编一段描述, 那是把编造说成识图。
 *
 * 故 content 放宽为「文本段 | 图片段」的数组。形状严格对齐 OpenAI 兼容
 * 协议 (chat/completions 的多模态 content 数组), 各家兼容实现都认这个形状。
 *
 * ⚠️ **不引入第二种图片传法**: 官方 OpenAI 兼容协议只有 image_url 一种,
 * 额外发明一套自己的形状就得在协议层做转换, 而收益为零。
 */
export type TextContentPart =
  | { type: 'text'; text: string }
  /** 图片段。url 支持 data: base64 直传 (见 TextMessage 注释) */
  | { type: 'image_url'; image_url: { url: string } };

/**
 * 文本消息 —— 统一能力层的消息形状。
 *
 * 单独导出而非内联在接口里, 是为了让转发层 (text-provider.interface.ts)
 * 能引用同一个类型而不产生「数组套数组」的推导错误。
 *
 * ## content 的两种形态
 *
 *   - `string` —— 纯文本对话 (润色等), 兼容既有全部调用点, 无需改。
 *   - `TextContentPart[]` —— 多模态 (文本 + 图片), 用于图片转提示词。
 *
 * ⚠️ **图片优先用 data: base64 直传, 不用公网 URL**:
 * 网关服务器要回拉本站的 URL, 而本站素材地址在本地开发时是
 * `http://localhost:4100/...` —— 网关根本拉不到, 会静默失败或超时。
 * base64 直传没有回拉环节, 是唯一在开发环境也稳的传法。
 * (已在 modelverse + gpt-4o-mini 上实测: base64 图片被正确识别。)
 */
export interface TextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | TextContentPart[];
}

/**
 * 文本能力接口。
 *
 * ⚠️ 刻意**无本地兜底** —— 见 TextOutcome 的说明。
 */
export interface TextProvider {
  generate(
    capability: string,
    messages: TextMessage[],
    params: Record<string, any>,
  ): Promise<TextOutcome>;
}

/**
 * 视频能力接口。
 *
 * 首批无实现。保留接口是为了让"文/图/视"三模态在类型层就齐备 ——
 * 缺的只是一个实现, 而不是一整层抽象。
 */
export interface VideoProvider {
  generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
  ): Promise<VideoOutcome>;
}

/** 模态 → 该模态的产出类型 (应用层泛型下标用) */
export interface OutcomeByModality {
  text: TextOutcome;
  image: ImageOutcome;
  video: VideoOutcome;
}

export type { Modality };
