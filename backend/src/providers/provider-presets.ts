/**
 * 厂商预设 —— **转发层** (2026-10-20 架构重构后)。
 *
 * ## 本文件已不再是数据源
 *
 * 改造前这里既声明数据又对外暴露契约, 且把**厂商身份**与**协议形状**揉在一起:
 * `VendorPreset` 同时带 `protocol`(形状) 与 `baseUrl`/`models`(身份)。
 * 后果是:
 *   - 同一份协议描述被抄了 N 遍 (三家 OpenAI 兼容厂商各抄一遍 sizeStyle)
 *   - 同一家的不同模态被拆成两条预设 (siliconflow / siliconflow-text),
 *     迫使运维填两遍基址与令牌
 *
 * 现在的分层:
 * ```
 *   vendors/vendor.catalog.ts   ← 数据源: 一家厂商一条 (含各模态通道)
 *   protocols/protocol.spec.ts  ← 协议形状的唯一声明处
 *   vendors/vendor.presets.ts   ← 对外视图: 模态 × 厂商 = 一条 (形状不变)
 *   provider-presets.ts (本文件) ← 转发, 供既有调用点继续 import
 * ```
 *
 * ⚠️ 本文件只做 re-export, **不得再声明任何数据** ——
 * 保留两个数据源就等于回到改造前的重复问题。
 */

/** 模态类型 (定义在协议层 —— 转发层不得定义被转发的东西, 否则形成自引用) */
export type { Modality } from './protocols/protocol.spec';

export { MODALITIES } from './protocols/protocol.spec';

/** 协议标识与协议形状 (定义在协议层) */
export type {
  GatewayProtocol,
  ProtocolSpec,
  SizeStyle,
  VideoProtocolSpec,
} from './protocols/protocol.spec';

export {
  PROTOCOL_SPECS,
  protocolSpec,
  protocolsFor,
  // 视频协议形状 (2026-10-20): 后台「测试连通性」需按协议取探测端点,
  // 视频协议在独立目录, 故一并转发, 避免调用方直接 import 协议层。
  VIDEO_PROTOCOL_SPECS,
  videoProtocolSpec,
} from './protocols/protocol.spec';

/** 厂商目录 (数据源) 与派生视图 (对外契约) */
export {
  VENDOR_CATALOG,
  VENDOR_PRESETS,
  PROTOCOL_OPTIONS,
  PROTOCOL_OPTIONS_BY_MODALITY,
  findPreset,
  findVendor,
  presetsFor,
  defaultModelFor,
  protocolSupports,
  protocolSupportsImage,
  vendorsFor,
  channelOf,
  baseUrlOf,
  specOf,
} from './vendors/vendor.presets';

export type { VendorDef, VendorChannel, VendorPreset } from './vendors/vendor.presets';
