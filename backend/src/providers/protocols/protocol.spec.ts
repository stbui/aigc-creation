/**
 * 模态类型来自**叶子模块** `../modality`。
 *
 * ⚠️ 不在此处定义: 模态被统一能力层 / 协议层 / 厂商层三方使用, 若定义在
 * 协议层, 统一能力层就得依赖协议层 —— 破坏「统一层是叶子」的分层前提。
 * 故抽到独立叶子模块, 三层都单向依赖它。
 *
 * ⚠️ **转发必须拆成 type 与 value 两句**:
 * `export type { Modality, MODALITIES } from '../modality';` 会把 **MODALITIES
 * 这个数组常量也降级成纯类型导出** —— 于是它在下游 (`model-config.service.ts`
 * 的三处) 一被当值用就报 TS1362 "cannot be used as a value because it was
 * exported using 'export type'"。
 * 而 `Modality` 本身是类型, 用 `export type` 转发是对的。
 * 两类东西不能用同一句转发, 故必须拆开。
 *
 * ⚠️ **本文件内部还要用 `Modality` 这个类型** (ProtocolSpec.modality 字段),
 * 故必须**同时 import 进来** —— `export ... from` 只是「再导出」,
 * 并不会把符号引入本文件作用域, 只有 import 才会。
 */
import type { Modality } from '../modality';

export type { Modality } from '../modality';
export { MODALITIES } from '../modality';

/**
 * 协议归一层 —— 各家 API 形状差异的收敛点 (2026-10-20 架构重构)。
 *
 * ## 三层架构中的位置
 *
 * ```
 *   统一模型能力层 (文/图/视)
 *        ↓
 *   厂商层 (a 厂 / b 厂 / c 厂)  ← 厂商 = 身份 + 凭据 + 模型清单
 *        ↓  一个厂商可复用多个协议
 *   协议层 (本文件)              ← 协议 = 请求/响应形状
 * ```
 *
 * ## 厂商与协议为什么必须分开
 *
 * 「厂商」是**身份**问题 (谁的账号、拿谁的 key、买谁家的模型);
 * 「协议」是**形状**问题 (请求体长什么样、响应从哪个字段掏结果)。
 * 二者不是一对一的:
 *   - 优云智算 / 硅基流动 / OpenAI 官方 → 三家厂商, 同一个 OpenAI 兼容协议
 *   - 火山方舟 → 一家厂商, 自成一套协议
 *   - DeepSeek / Moonshot / 硅基流动 → 三家厂商, 同一个 chat/completions 协议
 *
 * 把两者揉在一起 (改造前 VendorPreset 同时带 protocol 与 baseUrl)
 * 的后果是: 换一个厂商要复制一份协议描述, 于是 **同一份协议被抄了 N 遍**,
 * 抄漏一处就是"某厂商行为与其它同协议厂商不一致", 极难排查。
 *
 * 故本层定义「协议形状」, 厂商层只**引用**协议标识。
 */

/** 通道协议标识。**跨模态复用同一名字**, 故必须与模态组合才唯一。 */
export type GatewayProtocol =
  | 'aigc' // 自研异步任务契约 (POST /generation/tasks + 轮询)
  | 'openai' // OpenAI 兼容生图 (同步): POST {base}/v1/images/generations
  | 'volcengine' // 火山方舟: POST {base}/images/generations, size 用档位
  | 'minimax' // MiniMax: POST {base}/v1/image_generation, 用 aspect_ratio
  | 'openai-chat' // OpenAI 兼容文本: POST {base}/v1/chat/completions
  | 'minimax-video'; // MiniMax 视频: POST {base}/v1/video_generation + 轮询 + 取文件

/**
 * 协议形状 —— 一个协议的完整请求/响应契约。
 *
 * 改造前这套信息散落两处: `ProtocolShape` (provider 实现里) 与
 * `VendorPreset` (预设表里), 两者对 sizeStyle / maxRefImages / refStyle
 * **各写一份**。后果是: 改预设不改实现 → 后台界面显示「最多 10 张参考图」,
 * 实际请求只传 1 张, 而用户看不出任何异常。
 *
 * 现在本接口是这些事实的**唯一声明处**, 厂商只引用 protocol 标识。
 */
export interface ProtocolSpec {
  /** 协议标识 */
  protocol: GatewayProtocol;
  /** 该协议服务哪个模态 —— 决定它能不能被某模态的通道引用 */
  modality: Modality;
  /** 展示名 (错误信息里说清是哪个厂家的通道) */
  label: string;
  /**
   * 同步 or 异步。
   *
   * ⚠️ 必须显式区分: 同步协议一次 POST 就出结果; 异步协议是
   * 「提交任务 → 轮询 → 下载」三段式, 轮询参数与超时策略完全不同。
   * 把两者塞进同一形状会导致实现里出现 `if (mode === 'async')` 的分支蔓延。
   *
   * 首批只有 aigc 自研网关是异步的 —— 它是本项目原协议, 保留兼容。
   */
  mode: 'sync' | 'async';
  /**
   * 端点拼接: 传 baseUrl 返回完整 URL。
   *
   * ⚠️ baseUrl 一律是**厂商根域** (不含 /v1), 由本层统一补版本段 ——
   * 各家官方给的 base_url 形状不一致 (OpenAI 给 `.../v1`、DeepSeek 根域
   * 不带 `/v1`), 照抄会拼出 `/v1/v1/chat/completions`。
   */
  endpoint(baseUrl: string): string;
  /**
   * 异步协议的轮询端点 (仅 mode='async' 需要)。
   *
   * 传 taskId 返回查询该任务的完整 URL。
   */
  pollEndpoint?(baseUrl: string, taskId: string): string;
  /** 尺寸参数的表达方式 —— 各家对「多大」的写法完全不同 */
  sizeStyle: SizeStyle;
  /** 一次请求最多几张参考图; 超出由 provider 截断 */
  maxRefImages: number;
  /** 参考图的传法 */
  refStyle: 'base64' | 'url';
  /** 该协议下的默认模型 (厂商可覆盖) */
  defaultModel: string;
  /** 从响应里挖产出 (url 或 base64) */
  extract(json: any): { url?: string; b64?: string };
  /** 从响应里挖错误信息; 无错误返回 null */
  extractError(json: any): string | null;
  /** 参考图字段名: 单张/多张/该协议特有结构 */
  buildRefField(refs: string[]): Record<string, unknown>;
  /**
   * 连通性探测的路径 (2026-10-20)。
   *
   * ## 为什么要有它
   *
   * 改造前后台「测试连通性」按**模态**硬编码探测路径:
   *   image → /generation/tasks   ← 这是 aigc 自研网关的路径!
   *   text  → /v1/chat/completions
   *   video → /v1/videos
   *
   * 而 5 个图像协议的真实端点各不相同:
   *   aigc → /generation/tasks    openai → /v1/images/generations
   *   volcengine → /images/generations   minimax → /v1/image_generation
   *
   * 于是配了 `openai` 协议时, 探测打的是 `/generation/tasks` —— 那个路径在
   * 优云智算/硅基流动/OpenAI 官方**根本不存在**。更糟的是探测把 4xx
   * 当作「网络可达」→ **测试显示通过, 但生成必然 404**。
   *
   * 这正是「探测通过 ≠ 实际能调通」的根源, 也是本项目最忌讳的静默不实。
   *
   * 故探测路径必须**由协议层声明** —— 与生成端点同源, 改一处两处都对。
   * 缺省取 `endpoint()` 的路径 (大多数协议探测打自己的生成端点即可)。
   */
  probePath?(baseUrl: string): string;
  /**
   * 可用模型列表端点 (2026-10-20, 可选)。
   *
   * ## 用途: 区分「网络可达」与「模型可用」
   *
   * 光靠探测只能证明「网络通」, 证明不了「模型名写对了」。
   * 而模型名写错是**最高频**的配错 (抄旧教程、填了已下线的模型) ——
   * 症状是探测通过但生成必然失败, 且用户完全看不出原因。
   *
   * 故若该协议提供模型列表, 测试时拉一次并检查配置的模型名在不在列表里。
   *
   * ## 为什么是**候选列表**而不是单个路径
   *
   * 同一个协议被多家厂商复用, 而各家的模型列表路径**不统一** (取证):
   *   openai 兼容 → {base}/v1/models
   *   deepseek    → {base}/models        ← 没有 /v1!
   *   volcengine  → {base}/models
   *   硅基流动     → {base}/v1/models
   *
   * `openai-chat` 协议同时服务 优云智算/硅基流动/OpenAI官方/DeepSeek/Moonshot
   * 五家, 其中 DeepSeek 的路径与另外四家不同。写死单个路径必然对某家不对。
   *
   * 故按「候选列表」声明, **依次尝试直到某个返回 200** ——
   * 比在协议层复制厂商信息更干净 (协议层本就不该知道有 DeepSeek 这家厂商),
   * 也比"猜一个统一路径"更诚实 (猜错 = 静默漏检)。
   */
  modelListEndpoints?(baseUrl: string): string[];
}

/** 尺寸参数的表达方式 —— 各家对「多大」的写法完全不同 */
export type SizeStyle =
  | 'openai-wh' // size: "1024x1024"
  | 'volc-tier' // size: "2K" (档位, 不接受精确像素)
  | 'ratio-only'; // 只给 aspect_ratio: "16:9", 像素由服务端定 (MiniMax)

/**
 * 视频协议形状 —— 视频生成是**四段式**契约, 与图像差异过大, 故独立成接口。
 *
 * ## 为什么不给图像的 ProtocolSpec 加字段了事
 *
 * 图像同步协议是「一次 POST → 拿到 url 或 base64」; 视频是:
 *   1. POST 提交任务   → { task_id }
 *   2. GET  轮询状态   → { status: Preparing|Queueing|Processing|Success|Fail, file_id? }
 *   3. GET  取文件地址 → { file: { download_url } }      ← 这一段是 MiniMax 特有
 *   4. GET  下载视频字节
 *
 * 若硬塞进 ProtocolSpec, 会出现一堆 `if (modality === 'video')` 的可选字段,
 * 而图像侧永远用不到它们 —— 正是本项目要消灭的"两个真相源"变形。
 * 故 video 独立成形状, 由 VideoProtocolSpec 声明。
 */
export interface VideoProtocolSpec {
  /** 协议标识 */
  protocol: string;
  /** 展示名 */
  label: string;
  /** 提交端点 */
  submitEndpoint(baseUrl: string): string;
  /**
   * 轮询端点 —— 传 taskId 返回完整 URL。
   *
   * ⚠️ MiniMax v1 用**查询参数**而非路径段:
   *   GET {base}/v1/query/video_generation?task_id=xxx
   * 故本函数的 taskId 需自行拼进 query string。
   */
  pollEndpoint(baseUrl: string, taskId: string): string;
  /**
   * 取文件地址端点 (仅当轮询终态只给 file_id 时需要)。
   *
   * ⚠️ MiniMax v1 的 Success 响应只给 `file_id`, 真正的下载地址在
   * `GET {base}/v1/files/retrieve?file_id=xxx` 的 `file.download_url` 里。
   * 少这一步就拿不到视频字节。
   */
  fileEndpoint?(baseUrl: string, fileId: string): string;
  /** 从提交响应里取任务 id */
  extractTaskId(json: any): string | undefined;
  /** 从轮询响应里取状态 (原样, 大小写敏感) */
  extractStatus(json: any): string | undefined;
  /** 终态判定: 返回 'success' | 'failed' | 'pending' */
  classifyStatus(status: string | undefined): 'success' | 'failed' | 'pending';
  /** 终态成功后取 file_id (用于换取下载地址) */
  extractFileId(json: any): string | undefined;
  /** 从取文件响应里取下载地址 */
  extractDownloadUrl(json: any): string | undefined;
  /** 从响应里挖错误信息; 无错误返回 null */
  extractError(json: any): string | null;
  /** 该协议下的默认模型 */
  defaultModel: string;
  /** 视频时长/分辨率等可选参数 → 请求体字段 */
  buildParams?(params: Record<string, any>): Record<string, unknown>;
  /** 首帧参考图的字段名 (图生视频用) */
  firstFrameField?: string;
  /**
   * 连通性探测的路径 (2026-10-20)。
   *
   * 缺省取 submitEndpoint 的路径 —— 视频协议四段式, 探测打提交端点即可
   * (打轮询端点需要 taskId, 探测时没有)。
   */
  probePath?(baseUrl: string): string;
  /**
   * 可用模型列表端点候选 (2026-10-20, 可选)。
   *
   * 语义与 ProtocolSpec.modelListEndpoints 相同: 用于区分「网络可达」与
   * 「模型名写对了」。MiniMax 视频的模型清单未取证到公开端点, 故不声明 ——
   * **不臆造**。
   */
  modelListEndpoints?(baseUrl: string): string[];
}

/**
 * 视频协议目录 —— 全部视频协议形状的单一事实源。
 *
 * ⚠️ 与图像的 PROTOCOL_SPECS 分开维护: 视频是四段式契约, 与图像的
 * 「一次 POST 出结果」根本不同, 塞进同一形状会逼出大量分支。
 */
export const VIDEO_PROTOCOL_SPECS: VideoProtocolSpec[] = [
  {
    protocol: 'minimax-video',
    label: 'MiniMax 视频生成',
    submitEndpoint: (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/v1/video_generation`,
    pollEndpoint: (baseUrl, taskId) =>
      `${baseUrl.replace(/\/+$/, '')}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
    fileEndpoint: (baseUrl, fileId) =>
      `${baseUrl.replace(/\/+$/, '')}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
    extractTaskId: (json) => {
      const id = json?.task_id ?? json?.id;
      return typeof id === 'string' && id ? id : undefined;
    },
    extractStatus: (json) => {
      const s = json?.status;
      return typeof s === 'string' ? s : undefined;
    },
    /*
     * ⚠️ MiniMax v1 的状态枚举**首字母大写** (Preparing/Queueing/Processing/
     * Success/Fail), 与图像侧的 success/failed 小写风格不同。
     * 故这里做大小写无关比较 —— 顺带兼容未来可能的 v2 风格 (succeeded/failed)。
     */
    classifyStatus: (status) => {
      const s = String(status ?? '').toLowerCase();
      if (!s) return 'pending';
      if (['success', 'succeeded', 'completed', 'done', 'finished'].includes(s)) return 'success';
      if (['fail', 'failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(s)) return 'failed';
      return 'pending';
    },
    extractFileId: (json) => {
      const id = json?.file_id;
      return typeof id === 'string' && id ? id : undefined;
    },
    extractDownloadUrl: (json) => {
      const url = json?.file?.download_url;
      return typeof url === 'string' && url ? url : undefined;
    },
    extractError: (json) => {
      // ⚠️ MiniMax 失败也返回 HTTP 200, 错误只在 base_resp 里
      const br = json?.base_resp;
      if (br && br.status_code !== undefined && Number(br.status_code) !== 0) {
        return `status ${br.status_code}: ${String(br.status_msg ?? '').slice(0, 250)}`;
      }
      if (json?.error) return String(json.error.message ?? JSON.stringify(json.error)).slice(0, 250);
      return null;
    },
    defaultModel: 'MiniMax-Hailuo-2.3',
    // 视频参数: duration(秒) / resolution(1080P|720P|2K) / prompt
    buildParams: (params) => {
      const out: Record<string, unknown> = {};
      const duration = Number(params.duration);
      if (Number.isFinite(duration) && duration > 0) out.duration = duration;
      if (params.resolution) out.resolution = String(params.resolution);
      return out;
    },
    // 图生视频: 首帧参考图字段 (v1 用 first_frame_image, 不是 OpenAI 的 image)
    firstFrameField: 'first_frame_image',
  },
];

/** 按标识取视频协议形状 */
export function videoProtocolSpec(protocol: string): VideoProtocolSpec | undefined {
  return VIDEO_PROTOCOL_SPECS.find((p) => p.protocol === protocol);
}

/**
 * 协议目录 —— 全部协议形状的单一事实源。
 *
 * ⚠️ 这里是**唯一**声明 sizeStyle / maxRefImages / refStyle 的地方。
 * 厂商层只引用 protocol 标识, 不重复声明这些字段 —— 重复声明就是
 * "界面显示 10 张实际传 1 张"这类漂移的根源。
 */
export const PROTOCOL_SPECS: ProtocolSpec[] = [
  {
    protocol: 'aigc',
    modality: 'image',
    label: 'aigc 自研网关（异步轮询）',
    mode: 'async',
    endpoint: (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/generation/tasks`,
    pollEndpoint: (baseUrl, taskId) =>
      `${baseUrl.replace(/\/+$/, '')}/generation/tasks/${encodeURIComponent(taskId)}`,
    sizeStyle: 'openai-wh',
    maxRefImages: 10,
    refStyle: 'url',
    defaultModel: '',
    // 异步协议的产出在**轮询终态**的响应里, 字段别名极多 (见 gateway-image.provider)
    extract: (json) => {
      const pick = (o: any, keys: string[]): string | undefined => {
        for (const k of keys) {
          if (o && typeof o[k] === 'string' && o[k].startsWith('http')) return o[k];
        }
        return undefined;
      };
      const direct = pick(json, ['outputUrl', 'resultUrl', 'imageUrl', 'url', 'sourceUrl']);
      if (direct) return { url: direct };
      for (const key of ['outputs', 'assets', 'images', 'files', 'results']) {
        const arr = json?.[key];
        if (Array.isArray(arr) && arr.length > 0) {
          const first = arr[0];
          const u = typeof first === 'string' ? first : pick(first, ['url', 'sourceUrl', 'imageUrl']);
          if (u) return { url: u };
        }
      }
      return {};
    },
    extractError: (json) => {
      const e = json?.error;
      if (!e) return null;
      return `${e.code ?? e.type ?? 'unknown'}: ${String(e.message ?? '').slice(0, 250)}`;
    },
    buildRefField: (refs) => (refs.length ? { inputImages: refs } : {}),
    // 自研网关没有「模型列表」概念 (模型由本项目能力层定义), 故不声明
  },
  {
    protocol: 'openai',
    modality: 'image',
    label: 'OpenAI 兼容（生图）',
    mode: 'sync',
    endpoint: (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/v1/images/generations`,
    sizeStyle: 'openai-wh',
    maxRefImages: 3,
    refStyle: 'base64',
    defaultModel: 'gpt-image-2',
    extract: (json) => {
      const first = json?.data?.[0];
      if (!first) return {};
      const url = first.url ?? first.image_url;
      const b64 = first.b64_json ?? first.base64;
      return {
        url: typeof url === 'string' && url ? url : undefined,
        b64: typeof b64 === 'string' && b64 ? b64 : undefined,
      };
    },
    extractError: (json) => {
      const e = json?.error;
      if (!e) return null;
      return `${e.code ?? e.type ?? 'unknown'}: ${String(e.message ?? '').slice(0, 250)}`;
    },
    // 单张用 image, 多张用 images —— qwen-image 系列文档标注支持 1~3 张
    buildRefField: (refs) => {
      if (!refs.length) return {};
      return refs.length === 1 ? { image: refs[0] } : { images: refs };
    },
    // 模型列表候选: OpenAI 兼容标准形状 {base}/v1/models (取证: OpenAI 官方 / 硅基流动官方文档)
    // 次选 /models: 兼容部分厂商把列表挂在根路径
    modelListEndpoints: (baseUrl) => {
      const b = baseUrl.replace(/\/+$/, '');
      return [`${b}/v1/models`, `${b}/models`];
    },
  },
  {
    protocol: 'volcengine',
    modality: 'image',
    mode: 'sync',
    label: '火山方舟',
    // baseUrl 已含 /api/v3, 故只追加 /images/generations
    endpoint: (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/images/generations`,
    sizeStyle: 'volc-tier',
    // Seedream 5.0 支持多图生图 (2~10 张参考图)
    maxRefImages: 10,
    refStyle: 'url',
    defaultModel: 'doubao-seedream-5-0-pro-260628',
    extract: (json) => {
      const first = json?.data?.[0];
      if (!first) return {};
      const url = first.url ?? first.image_url;
      const b64 = first.b64_json ?? first.base64;
      return {
        url: typeof url === 'string' && url ? url : undefined,
        b64: typeof b64 === 'string' && b64 ? b64 : undefined,
      };
    },
    extractError: (json) => {
      const e = json?.error;
      if (!e) return null;
      return `${e.code ?? e.type ?? 'unknown'}: ${String(e.message ?? '').slice(0, 250)}`;
    },
    // 单张用 image, 多张用 image 数组 (Ark 支持数组形式的多图输入)
    buildRefField: (refs) => (refs.length ? { image: refs.length === 1 ? refs[0] : refs } : {}),
    // 模型列表: {base}/models (取证: 火山官方 GET /api/v3/models, baseUrl 已含 /api/v3)
    modelListEndpoints: (baseUrl) => [`${baseUrl.replace(/\/+$/, '')}/models`],
  },
  {
    protocol: 'minimax',
    modality: 'image',
    mode: 'sync',
    label: 'MiniMax',
    endpoint: (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/v1/image_generation`,
    sizeStyle: 'ratio-only',
    // 官方文档: subject_reference 只支持单张参考图
    maxRefImages: 1,
    refStyle: 'url',
    defaultModel: 'image-01',
    extract: (json) => {
      // 真实形状: data.image_urls: string[]
      const urls = json?.data?.image_urls ?? json?.data?.image_base64;
      if (Array.isArray(urls) && urls.length > 0) {
        const first = urls[0];
        return typeof first === 'string'
          ? /^https?:/.test(first)
            ? { url: first }
            : { b64: first } // image_base64 形态直接就是裸 base64
          : {};
      }
      // 兜底: 兼容可能出现的 OpenAI 形状
      const first = json?.data?.[0];
      if (first?.url) return { url: first.url };
      return {};
    },
    extractError: (json) => {
      // ⚠️ MiniMax 失败也返回 HTTP 200, 错误只在 base_resp 里
      const br = json?.base_resp;
      if (br && br.status_code !== undefined && Number(br.status_code) !== 0) {
        return `status ${br.status_code}: ${String(br.status_msg ?? '').slice(0, 250)}`;
      }
      if (json?.error) return String(json.error.message ?? JSON.stringify(json.error)).slice(0, 250);
      return null;
    },
    buildRefField: (refs) =>
      refs.length ? { subject_reference: [{ type: 'character', image_file: refs[0] }] } : {},
  },
  {
    protocol: 'openai-chat',
    modality: 'text',
    mode: 'sync',
    label: 'OpenAI 兼容（对话补全）',
    endpoint: (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
    sizeStyle: 'openai-wh',
    maxRefImages: 0,
    refStyle: 'url',
    defaultModel: 'gpt-4o',
    // 文本协议不产图片, extract/extractError 由文本 provider 自行处理;
    // 此处保留形状是为了让 ProtocolSpec 对两个模态结构一致。
    extract: () => ({}),
    extractError: (json) => {
      const e = json?.error;
      if (!e) return null;
      return `${e.code ?? e.type ?? 'unknown'}: ${String(e.message ?? '').slice(0, 250)}`;
    },
    buildRefField: () => ({}),
    /*
     * 模型列表候选 (取证):
     *   openai / 硅基流动 / 优云智算 → {base}/v1/models
     *   deepseek                      → {base}/models    ← 没有 /v1!
     *   moonshot                      → {base}/v1/models
     * 同一协议服务五家厂商, 路径不统一, 故按候选依次尝试 (见 ProtocolSpec 注释)。
     */
    modelListEndpoints: (baseUrl) => {
      const b = baseUrl.replace(/\/+$/, '');
      return [`${b}/v1/models`, `${b}/models`];
    },
  },
];

/** 按标识取协议形状 */
export function protocolSpec(protocol: string): ProtocolSpec | undefined {
  return PROTOCOL_SPECS.find((p) => p.protocol === protocol);
}

/**
 * 某模态下可用的协议。
 *
 * ⚠️ 判定依据是 PROTOCOL_SPECS 而非「是否有厂商引用它」——
 * 一个协议可能已实现但暂时没有厂商使用 (如新接的厂商), 二者要区分开。
 */
export function protocolsFor(modality: Modality): ProtocolSpec[] {
  return PROTOCOL_SPECS.filter((p) => p.modality === modality);
}
