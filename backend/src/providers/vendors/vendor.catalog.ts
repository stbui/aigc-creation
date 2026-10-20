import type { Modality } from '../modality';
import { PROTOCOL_SPECS, VIDEO_PROTOCOL_SPECS, type GatewayProtocol, type ProtocolSpec, type VideoProtocolSpec } from '../protocols/protocol.spec';

/** 协议目录索引 —— 按标识查协议形状 */
const PROTOCOL_SPECS_LOOKUP: Record<string, ProtocolSpec> = Object.fromEntries(
  PROTOCOL_SPECS.map((p) => [p.protocol, p]),
);

/**
 * 厂商目录层 —— 厂商作为一级实体 (2026-10-20 架构重构)。
 *
 * ## 三层架构中的位置
 *
 * ```
 *   统一模型能力层 (文/图/视)
 *        ↓
 *   厂商层 (本文件)   ← 身份: 谁家、拿谁的 key、有哪些模型
 *        ↓  一个厂商可复用多个协议
 *   协议层            ← 形状: 请求体长什么样、响应从哪掏
 * ```
 *
 * ## 改造前的问题
 *
 * 厂商层与协议层是**揉在一起**的: `VendorPreset` 同时声明了
 * `protocol` (形状) 与 `baseUrl`/`models` (身份), 于是:
 *   - 同一份协议描述被抄了 N 遍 (优云智算/硅基流动/OpenAI 各抄一遍 sizeStyle)
 *   - 同一家的不同模态被拆成两条预设 (siliconflow / siliconflow-text),
 *     迫使运维填两遍基址与令牌
 *
 * ## 现在的模型
 *
 * **一家厂商一条** (`VendorDef`), 其下按模态声明通道 (`VendorChannel`),
 * 通道只**引用**协议标识与模型清单, **不重复声明**协议层已有的事实
 * (sizeStyle / maxRefImages / refStyle)。
 *
 * 这样:
 *   - 加一家厂商 = 加一条 VendorDef, 不碰任何协议实现
 *   - 改某个协议的行为 = 改协议层一处, 所有用该协议的厂商同步生效
 *   - 一家厂商跨模态 → 天然共享基址与凭据
 */

/** 厂商下的一个模态通道 */
export interface VendorChannel {
  /** 该通道服务哪个模态 */
  modality: Modality;
  /**
   * 引用的协议标识 —— 形状由协议层定义, 此处不重复声明。
   *
   * ⚠️ 必须是协议层已存在的标识: 装配期校验会拦下悬空引用,
   * 否则表现为"选了这个厂商, 生成时报未知协议"。
   */
  protocol: GatewayProtocol;
  /**
   * 该通道的基址 —— **省略则继承厂商级 baseUrl**。
   *
   * 绝大多数通道与厂商同基址 (优云智算的图与文都走 api.modelverse.cn),
   * 只有少数厂商的某模态用不同基址 (火山方舟的 /api/v3 段只对它的方舟端点有意义)。
   * 留这个字段是为了覆盖那类少数情况, 而不是让每条通道都重复填一遍。
   */
  baseUrl?: string;
  /** 该通道可选的模型 (首条为推荐) */
  models: Array<{ id: string; label: string; note?: string }>;
  /** 覆盖协议层的默认模型 (厂商自有默认时用) */
  defaultModel?: string;
  /** 该通道的备注, 展示在预设说明位 */
  note?: string;
}

/**
 * 一家厂商。
 *
 * ⚠️ key 是**厂商级**稳定标识 (如 'siliconflow'), 不是模态级。
 * 改造前同一家拆成 'siliconflow' / 'siliconflow-text' 两条,
 * 运维要在后台填两遍基址与令牌 —— 而它们本来就是同一家。
 */
export interface VendorDef {
  /** 稳定标识, 落配置项用; 不可改, 改了已存配置就对不上 */
  key: string;
  /** 展示名 */
  label: string;
  /**
   * 厂商级基址 —— **根域, 不含 /v1 与具体端点路径**。
   *
   * ⚠️ 必须归一化到根域: 各家官方给的 base_url 形状并不一致
   * (OpenAI 给 `https://api.openai.com/v1`、Moonshot 给 `.../v1`、
   * DeepSeek 根域**不带** /v1), 若照抄各自文档里的值,
   * 协议层统一拼 `/v1/chat/completions` 就会变成 `/v1/v1/...`。
   */
  baseUrl: string;
  /** 该厂商支持的各模态通道 */
  channels: VendorChannel[];
  /** 拿 token 的地址 —— 运营最需要的一个链接 */
  consoleUrl: string;
  /** 厂商级备注 */
  note?: string;
}

/**
 * 厂商目录 —— 全部厂商的单一事实源。
 *
 * 取证来源 (2026-10-20 查各家官方文档, 非凭印象):
 *   - 优云智算 api.modelverse.cn, OpenAI 兼容同步; 已实测出图
 *   - 硅基流动   api.siliconflow.cn, OpenAI 兼容同步 (图与文同基址)
 *   - OpenAI官方 api.openai.com, OpenAI 兼容 (图与文同基址)
 *   - 火山方舟   ark.cn-beijing.volces.com/api/v3, size 用「1K/2K/4K」档位
 *   - MiniMax    api.minimax.io/v1/image_generation, 用 aspect_ratio
 *   - DeepSeek   api.deepseek.com, OpenAI 兼容文本
 *   - Moonshot   api.moonshot.cn, OpenAI 兼容文本
 *
 * ❌ **刻意不含 Kimi/Moonshot 与 DeepSeek 的图像通道**: 两者标称「OpenAI 兼容」,
 * 但那是 `/v1/chat/completions` 的**文本**兼容, **没有图像生成端点**。
 * 放进图像通道必然 404 → 回落本地, 恰好制造本层要消除的那种静默失败。
 */
export const VENDOR_CATALOG: VendorDef[] = [
  {
    key: 'modelverse',
    label: '优云智算 ModelVerse',
    baseUrl: 'https://api.modelverse.cn',
    consoleUrl: 'https://cloud.modelverse.cn/model-api/key',
    note: 'OpenAI 兼容协议, 参考图走 base64, 不要求对方能回拉本站地址。',
    channels: [
      {
        modality: 'image',
        protocol: 'openai',
        models: [
          { id: 'qwen-image-3.0', label: 'Qwen Image 3.0', note: '文生图 + 1~3 张参考图, 本项目当前在用' },
          { id: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro', note: 'Pro 版, 文字渲染更强' },
          { id: 'doubao-seedream-5-0-pro-260628', label: 'Doubao Seedream 5.0 Pro' },
          { id: 'flux-2-pro', label: 'FLUX 2 Pro' },
          { id: 'gpt-image-2', label: 'GPT Image 2' },
        ],
        defaultModel: 'qwen-image-3.0',
      },
      {
        /**
         * 文生文通道 —— 2026-10-20 实测取证后加入。
         *
         * ⚠️ 此前本厂商**只有图像通道**, 目录注释里还写着"OpenAI 兼容"却没列文本端点。
         * 实测 (同一 token 打 POST {base}/v1/chat/completions):
         *   gpt-4o-mini → 200, 返回正常中文, **且接受多模态 image_url (base64) 并能正确识图**
         *   gpt-5       → 200, 但 max_tokens 很小时正文为空 (思考型模型, 需更大额度)
         *   其余 (qwen-plus / deepseek-chat / kimi-k2.5 / gpt-4o / qwen-vl-*) → 400 "not support for model"
         * 故默认模型取 **gpt-4o-mini** —— 它是本厂商下**唯一实测可用且支持视觉**的模型,
         * 正好同时满足 AI润色 (纯文本) 与图片转提示词 (多模态) 两个场景。
         *
         * ⚠️ 「实测可用」不等于「该厂商只支持这一个模型」—— 模型清单随时会变,
         * 故这里只列实测通过的, 不臆造未验证的条目。
         */
        modality: 'text',
        protocol: 'openai-chat',
        models: [
          { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: '实测支持文本 + 多模态识图 (base64)' },
          { id: 'gpt-5', label: 'GPT-5', note: '实测可用, 思考型模型需较大 max_tokens' },
        ],
        defaultModel: 'gpt-4o-mini',
      },
    ],
  },
  {
    key: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '图像与文本同基址 —— 换厂商时只需改一处, 令牌也只需填一次。',
    channels: [
      {
        modality: 'image',
        protocol: 'openai',
        models: [
          { id: 'Kwai-Kolors/Kolors', label: 'Kolors', note: '快手, 生图免费' },
          { id: 'Tongyi-MAI/Z-Image-Turbo', label: 'Z-Image-Turbo', note: '通义, 约 0.1 元/张' },
          { id: 'Qwen/Qwen-Image-Edit-2509', label: 'Qwen Image Edit', note: '支持多图编辑' },
          { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 schnell', note: '生成速度快' },
        ],
      },
      {
        modality: 'text',
        protocol: 'openai-chat',
        models: [
          { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', note: '高性价比通用模型' },
          { id: 'Qwen/Qwen3-32B', label: 'Qwen3 32B', note: '通义, 中文表现好' },
          { id: 'moonshotai/Kimi-K2-Instruct', label: 'Kimi K2 Instruct', note: '长上下文' },
        ],
      },
    ],
  },
  {
    key: 'openai',
    label: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com',
    consoleUrl: 'https://platform.openai.com/api-keys',
    channels: [
      {
        modality: 'image',
        protocol: 'openai',
        models: [
          { id: 'gpt-image-2', label: 'GPT Image 2' },
          { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
          { id: 'gpt-image-1', label: 'GPT Image 1' },
        ],
      },
      {
        modality: 'text',
        protocol: 'openai-chat',
        models: [
          { id: 'gpt-4o', label: 'GPT-4o', note: '通用能力均衡' },
          { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: '低成本大批量' },
        ],
      },
    ],
  },
  {
    key: 'volcengine',
    label: '火山方舟（火山引擎）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    consoleUrl: 'https://console.volcengine.com/ark/region:ark-beijing/apiKey',
    note: '⚠️ size 用「1K/2K/4K」档位而非精确像素, 参考图需公网可达的 URL —— 与 OpenAI 系不同。',
    channels: [
      {
        modality: 'image',
        protocol: 'volcengine',
        models: [
          { id: 'doubao-seedream-5-0-pro-260628', label: 'Doubao Seedream 5.0 Pro', note: '支持框选/点位等交互编辑' },
          { id: 'doubao-seedream-4-5-251128', label: 'Doubao Seedream 4.5', note: '支持组图生成' },
          { id: 'doubao-seedream-4-0-250828', label: 'Doubao Seedream 4.0' },
        ],
      },
    ],
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.io',
    consoleUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    note: '⚠️ 端点为 /v1/image_generation(非 OpenAI 路径), 响应为 data.image_urls[]。',
    channels: [
      {
        modality: 'image',
        protocol: 'minimax',
        models: [{ id: 'image-01', label: 'image-01', note: '文生图 + 单张参考图(character)' }],
      },
      {
        /**
         * 文生视频通道 —— 2026-10-20 官方文档取证后加入。
         *
         * 契约 (v1, 四段式异步):
         *   1. POST {base}/v1/video_generation  { model, prompt, first_frame_image?, duration?, resolution? }
         *      → { task_id, base_resp }
         *   2. GET  {base}/v1/query/video_generation?task_id=xxx
         *      → { status: Preparing|Queueing|Processing|Success|Fail, file_id?, video_width?, video_height? }
         *   3. GET  {base}/v1/files/retrieve?file_id=xxx
         *      → { file: { download_url } }
         *   4. GET  download_url → 视频字节
         *
         * ⚠️ 第 3 段是 MiniMax 特有: 轮询的 Success 响应**只给 file_id**,
         * 真正的下载地址在 files/retrieve 里。少这一步就拿不到视频字节。
         *
         * ⚠️ 状态枚举**首字母大写** (Success/Fail), 与图像侧的小写风格不同;
         * 协议层已做大小写无关归一。
         *
         * ⚠️ 与图像通道**共用同一基址与令牌** —— 这正是厂商聚合的收益:
         * 运营填一次 baseUrl + token, 图与视频两个模态都能用。
         */
        modality: 'video',
        protocol: 'minimax-video',
        models: [
          { id: 'MiniMax-Hailuo-2.3', label: 'Hailuo 2.3', note: '图生视频, 支持 6/10 秒与 1080P' },
          { id: 'S2V-01', label: 'S2V-01', note: '主体参考视频 (subject_reference)' },
        ],
        defaultModel: 'MiniMax-Hailuo-2.3',
      },
    ],
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    note: '⚠️ 官方 base 不带 /v1 (同时接受 https://api.deepseek.com/v1), 本项目统一存根域, /v1 由协议层补。',
    channels: [
      {
        modality: 'text',
        protocol: 'openai-chat',
        models: [
          { id: 'deepseek-chat', label: 'DeepSeek Chat', note: '非思考模式, 日常文案首选' },
          { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', note: '思考模式, 慢但更适合复杂推理' },
        ],
      },
    ],
  },
  {
    key: 'moonshot',
    label: 'Moonshot 月之暗面',
    baseUrl: 'https://api.moonshot.cn',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '⚠️ 官方 base_url 写作 https://api.moonshot.cn/v1, 本项目只存根域以与其它家统一。',
    channels: [
      {
        modality: 'text',
        protocol: 'openai-chat',
        models: [
          { id: 'kimi-k2.5', label: 'Kimi K2.5', note: '长文本与文档理解强' },
          { id: 'moonshot-v1-8k', label: 'Moonshot v1 8k', note: '轻量, 低成本' },
        ],
      },
    ],
  },
];

/** 按标识取厂商 */
export function findVendor(key: string): VendorDef | undefined {
  return VENDOR_CATALOG.find((v) => v.key === key);
}

/**
 * 取厂商在某模态下的通道。
 *
 * 找不到返回 undefined 是**正常**的 —— 厂商可以只支持部分模态
 * (优云智算只有图, DeepSeek 只有文)。
 */
export function channelOf(vendorKey: string, modality: Modality): VendorChannel | undefined {
  return findVendor(vendorKey)?.channels.find((c) => c.modality === modality);
}

/** 某模态下有通道的厂商 (前端「厂商」下拉的数据源, 已按模态过滤) */
export function vendorsFor(modality: Modality): VendorDef[] {
  return VENDOR_CATALOG.filter((v) => v.channels.some((c) => c.modality === modality));
}

/** 通道的生效基址 (未覆盖则继承厂商级) */
export function baseUrlOf(vendor: VendorDef, channel: VendorChannel): string {
  return (channel.baseUrl ?? vendor.baseUrl).replace(/\/+$/, '');
}

/**
 * 通道的生效协议形状 —— 从协议层取, 厂商不重复声明。
 *
 * ⚠️ 视频协议在独立目录 (四段式契约), 故本函数**同时**查两份:
 * 只查 PROTOCOL_SPECS 会让视频通道被误判为"引用了不存在的协议"。
 *
 * 返回 undefined 表示协议标识悬空 (厂商引用了协议层没有的协议) ——
 * 装配期校验会拦下, 但运行时也要能安全降级而不是崩。
 */
export function specOf(channel: VendorChannel): ProtocolSpec | undefined {
  return PROTOCOL_SPECS_LOOKUP[channel.protocol];
}

/** 视频通道的协议形状 (视频协议在独立目录, 类型也不同) */
export function videoSpecOf(channel: VendorChannel): VideoProtocolSpec | undefined {
  return VIDEO_PROTOCOL_SPECS.find((p) => p.protocol === channel.protocol);
}
