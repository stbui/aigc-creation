import type { Modality } from '../modality';
import {
  VENDOR_CATALOG,
  baseUrlOf,
  channelOf,
  findVendor,
  specOf,
  vendorsFor,
  type VendorChannel,
  type VendorDef,
} from './vendor.catalog';
import { PROTOCOL_SPECS, protocolsFor, VIDEO_PROTOCOL_SPECS, type GatewayProtocol, type SizeStyle } from '../protocols/protocol.spec';

/**
 * 厂商预设 —— **由厂商目录派生的视图** (2026-10-20 架构重构)。
 *
 * ## 为什么要保留这个"视图"概念
 *
 * 改造前 `VendorPreset` 既是数据源又是对外契约: 后台模型配置页直接消费它,
 * 前端类型也照它的形状写。本层把数据源换成厂商目录后, 若直接改掉返回形状,
 * 会连带打断后台页面与前端类型 —— 而那些形状本身并没有错, 只是**来源**变了。
 *
 * 故: 数据源 = 厂商目录 (一家厂商一条); 对外契约 = 本文件派生的视图
 * (模态 × 厂商 = 一条, 与改造前一致)。两者解耦, 改一边不影响另一边。
 *
 * ⚠️ 派生视图里的 `key` 仍按**模态级**命名 (如 'siliconflow-text'),
 * 因为后台已存的 `gateway.text.vendor` 值可能是这种形态, 改了会对不上。
 * 但它的 `vendorKey` 字段会明确指出所属厂商 —— 页面据此可把同一家厂商的
 * 多个模态联动起来 (选一次厂商, 两处基址一起填)。
 */
export interface VendorPreset {
  /** 模态级稳定标识 (落配置项用) */
  key: string;
  /** 所属厂商的标识 —— 同一家厂商跨模态共享基址与凭据 */
  vendorKey: string;
  label: string;
  modality: Modality;
  protocol: GatewayProtocol;
  baseUrl: string;
  models: Array<{ id: string; label: string; note?: string }>;
  /** 尺寸表达方式 —— 来自协议层, 厂商不重复声明 */
  sizeStyle?: SizeStyle;
  sizeField?: string;
  /** 最多几张参考图 —— 来自协议层 */
  maxRefImages?: number;
  /** 参考图传法 —— 来自协议层 */
  refStyle?: 'base64' | 'url';
  consoleUrl: string;
  note?: string;
}

/** 尺寸字段实际名的展示文案 (供前端提示) */
const SIZE_FIELD_TEXT: Record<SizeStyle, string> = {
  'openai-wh': 'size',
  'volc-tier': 'size（档位）',
  'ratio-only': 'aspect_ratio',
};

/** 模态的中文名 (派生视图里区分同一家厂商的多个模态时用) */
const MODALITY_LABEL: Record<Modality, string> = {
  text: '文生文',
  image: '文生图',
  video: '文生视频',
};

/**
 * 模态级 key 的命名规则 —— **必须与重构前逐字一致**。
 *
 * ⚠️ 这是**兼容性硬约束**, 不是风格选择: 后台已存的
 * `gateway.image.vendor` / `gateway.text.vendor` 里存的是这些 key,
 * 改了就对不上 —— 表现为「厂商下拉显示未选择, 运营以为配错而重填一遍」。
 *
 * 规则: 厂商的**首个模态**用裸厂商 key, 其余模态用 `<厂商>-<模态>`。
 * 之所以不是"一律用裸 key"或"一律加后缀", 是因为重构前就是混着来的:
 *   siliconflow(image) / siliconflow-text(text)  ← 同一家, 两种写法
 *   openai(image) / openai-text(text)            ← 同一家, 两种写法
 *   modelverse(image) / deepseek(text)            ← 单模态, 裸 key
 * 沿用同一套规则, 存量 key 才能原样对上。
 */
function presetKey(vendor: VendorDef, channel: VendorChannel): string {
  const isFirst = vendor.channels[0].modality === channel.modality;
  return isFirst ? vendor.key : `${vendor.key}-${channel.modality}`;
}

/**
 * 派生全部预设视图 (模态 × 厂商)。
 *
 * ⚠️ **顺序有语义**: 改造前 VENDOR_PRESETS 的顺序即前端厂商下拉的展示顺序,
 * 且「首个该协议厂商」被 defaultModelFor 用作默认模型来源。
 * 故这里保持「按厂商目录顺序、厂商内按模态顺序」展开, 与改造前一致。
 */
export const VENDOR_PRESETS: VendorPreset[] = VENDOR_CATALOG.flatMap((vendor) =>
  vendor.channels.map((channel) => {
    const spec = specOf(channel);
    /*
     * ⚠️ **只对图像模态暴露** sizeStyle / maxRefImages / refStyle。
     *
     * 文本模态没有这些概念 (无尺寸档位、无参考图), 而协议层的
     * openai-chat 声明了它们只是为了让 ProtocolSpec 对两个模态结构一致。
     * 若原样透出, 后台会给文生文显示「像素尺寸, 如 1024x1024」这种
     * 根本不存在的选项 —— 运营会以为配错了。
     *
     * 视频模态同理: 它走独立的 VideoProtocolSpec (四段式异步),
     * 连 sizeStyle 这个概念都没有 —— 视频参数是 duration / resolution。
     *
     * 这也是与重构前一致的: 老的文本预设根本没声明这三个字段。
     */
    const isImage = channel.modality === 'image';
    return {
      key: presetKey(vendor, channel),
      vendorKey: vendor.key,
      label:
        vendor.channels.length > 1
          ? `${vendor.label}（${MODALITY_LABEL[channel.modality]}）`
          : vendor.label,
      modality: channel.modality,
      protocol: channel.protocol,
      baseUrl: baseUrlOf(vendor, channel),
      models: channel.models,
      sizeStyle: isImage ? spec?.sizeStyle : undefined,
      sizeField: isImage && spec ? SIZE_FIELD_TEXT[spec.sizeStyle] : undefined,
      maxRefImages: isImage ? spec?.maxRefImages : undefined,
      refStyle: isImage ? spec?.refStyle : undefined,
      consoleUrl: vendor.consoleUrl,
      note: channel.note ?? vendor.note,
    };
  }),
);

export function findPreset(key: string): VendorPreset | undefined {
  return VENDOR_PRESETS.find((v) => v.key === key);
}

/** 某模态下的全部预设视图 (前端「厂商」下拉的数据源, 已按模态过滤) */
export function presetsFor(modality: Modality): VendorPreset[] {
  return VENDOR_PRESETS.filter((v) => v.modality === modality);
}

/**
 * (模态, 协议) 下默认推荐模型。
 *
 * 必须带模态: 协议名跨模态复用, 只按 protocol 找会拿到错误模态的模型名
 * (如 openai 协议会先命中生图厂商, 给文生文返回 gpt-image-2)。
 */
export function defaultModelFor(modality: Modality, protocol: GatewayProtocol): string | undefined {
  const p = VENDOR_PRESETS.find((v) => v.modality === modality && v.protocol === protocol);
  return p?.models[0]?.id;
}

/**
 * 该 (模态, 协议) 组合在本项目是否已有真实实现。
 *
 * 存在的意义: 让后台在选择协议时能提示「该组合下本项目尚无对应能力」,
 * 而不是让运营配完才发现 404 回落本地。
 *
 * 判定依据是协议层 (PROTOCOL_SPECS) 而非「是否有厂商预设」——
 * 协议可能已实现但暂时没有厂商使用, 二者要区分开。
 */
export function protocolSupports(modality: Modality, protocol: string): boolean {
  if (modality === 'video') {
    // ⚠️ 视频协议在独立目录 (四段式契约), 不在 PROTOCOL_SPECS 里 ——
    // 只查图像/文本那份会让后台误判「该协议未接入」, 从而把已配好的视频通道
    // 标成 configuredButUnsupported (一个假的红灯)。
    return VIDEO_PROTOCOL_SPECS.some((p) => p.protocol === protocol);
  }
  return protocolsFor(modality).some((p) => p.protocol === protocol);
}

/** @deprecated 用 protocolSupports(modality, protocol) 代替 */
export function protocolSupportsImage(protocol: string): boolean {
  return protocolSupports('image', protocol);
}

/**
 * 可选协议 —— **按模态分组** (数据源改为协议层)。
 *
 * video 组首批为空数组: 未取证任何一家视频端点前, 摆一个占位协议等于
 * 编造契约。空数组本身就是信号 —— 前端据此显示「该模态暂无可选协议」。
 *
 * ⚠️ **2026-10-20 起不再为空**: MiniMax 视频端点已完成官方文档取证
 * (v1 四段式: 提交 → 轮询 → 取文件 → 下载), 故 video 组有了首个真实协议。
 * 该组此前是「取证未完成」的诚实信号, 现在是「已取证」的正常列表 ——
 * 二者不可混淆: 前者说明"还没做", 后者说明"有但只有这些"。
 */
export const PROTOCOL_OPTIONS_BY_MODALITY: Record<
  Modality,
  Array<{ value: GatewayProtocol; label: string; desc: string }>
> = {
  text: PROTOCOL_SPECS.filter((p) => p.modality === 'text').map((p) => ({
    value: p.protocol,
    label: p.label,
    desc: `${p.endpoint('{base}')}, DeepSeek / Moonshot / 硅基流动 / OpenAI 官方`,
  })),
  image: PROTOCOL_SPECS.filter((p) => p.modality === 'image').map((p) => ({
    value: p.protocol,
    label: p.label,
    desc: `${p.endpoint('{base}')}, 优云智算/硅基流动/OpenAI 官方/火山方舟/MiniMax`,
  })),
  video: VIDEO_PROTOCOL_SPECS.map((p) => ({
    value: p.protocol as GatewayProtocol,
    label: p.label,
    desc: `${p.submitEndpoint('{base}')} + 轮询 + 取文件, 异步任务制`,
  })),
};

/** 兼容旧调用点: 全模态协议下拉的扁平并集 */
export const PROTOCOL_OPTIONS: Array<{ value: GatewayProtocol; label: string; desc: string }> = [
  ...PROTOCOL_OPTIONS_BY_MODALITY.text,
  ...PROTOCOL_OPTIONS_BY_MODALITY.image,
];

export { VENDOR_CATALOG, findVendor, channelOf, vendorsFor, baseUrlOf, specOf };
export type { VendorDef, VendorChannel };
