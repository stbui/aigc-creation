/**
 * 厂商层对外入口 (2026-10-20 架构重构)。
 *
 * 三层架构:
 * ```
 *   统一模型能力层  providers/unified/
 *        ↓
 *   厂商层          providers/vendors/   ← 本入口
 *        ↓
 *   协议层          providers/protocols/
 * ```
 *
 * 装配期校验在**模块加载时**执行 —— 任何一层与另一层的引用断裂
 * (厂商引用了不存在的协议、协议模态与通道模态不符、派生视图与协议层漂移)
 * 都会让进程启动即失败, 而不是等到用户点了某个能力才在运行时静默失败。
 */

import { assertArchitectureIntegrity } from './vendor.integrity';

// ⚠️ 必须在本模块导出之前执行 —— 断言要拦住的是"导出出去的目录本身有问题"
assertArchitectureIntegrity();

export {
  VENDOR_CATALOG,
  findVendor,
  channelOf,
  vendorsFor,
  baseUrlOf,
  specOf,
  type VendorDef,
  type VendorChannel,
} from './vendor.catalog';

export {
  VENDOR_PRESETS,
  PROTOCOL_OPTIONS,
  PROTOCOL_OPTIONS_BY_MODALITY,
  findPreset,
  presetsFor,
  defaultModelFor,
  protocolSupports,
  protocolSupportsImage,
  type VendorPreset,
} from './vendor.presets';

export {
  assertArchitectureIntegrity,
  assertCatalogIntegrity,
  collectCatalogIssues,
  collectViewDriftIssues,
} from './vendor.integrity';
