/**
 * 能力合同（CapabilitySpec）与请求意图（ModelRequestIntent）的公共类型。
 *
 * 移植自 open-ai-canvas `internal/app/model_router_capability.go`。
 *
 * 能力合同有两个来源，结构必须完全一致，否则「后台看到的可选规格」与
 * 「路由实际能承接的规格」会分叉：
 *   1. 渠道模型的能力配置（`ChannelModel.capabilityConfigJson`）→ 线路合同；
 *   2. 能力绑定后的运行时合同（`ChannelModel.capabilityConfigJson`）→ 可承接范围。
 *
 * 本文件只放类型，不放逻辑，避免各模块互相 import 形成环。
 */

import type { ImageParameter } from '../domain/image-parameters';

/** 输入素材数量约束（图片 / 视频 / 音频 / 蒙版各一条） */
export interface InputConstraint {
  min: number;
  max: number;
}

/**
 * 选项约束：枚举或数值范围二选一，不允许同时声明。
 * `values: ['*']` 表示允许任意自定义值（通配）。
 */
export interface OptionConstraint {
  values?: unknown[];
  min?: number;
  max?: number;
  step?: number;
}

/** 图片尺寸预设：比例口径与像素口径的显式映射，路由不做宽高数值猜测 */
export interface CapabilityImageSizePreset {
  size: string;
  tier: string;
  ratio: string;
  width: number;
  height: number;
}

export interface CapabilityImageSize {
  /** 'size'（像素） | 'aspect_ratio'（比例） */
  parameter: string;
  allowCustom: boolean;
  presets: CapabilityImageSizePreset[];
}

/** 一条线路（或一个前台模型）能承接的能力范围 */
export interface CapabilitySpec {
  /** 图片参数合同（仅 image 使用）；`undefined` 表示走旧版 size/quality/resolution 路径 */
  imageParameters?: ImageParameter[];
  version: number;
  capability: string;
  operations?: string[];
  inputs?: Record<string, InputConstraint>;
  options?: Record<string, OptionConstraint>;
  imageSize?: CapabilityImageSize;
}

/** 一次生成请求归一化后的意图：匹配、计价、选路共用同一份 */
export interface ModelRequestIntent {
  capability: string;
  operation?: string;
  inputs?: Record<string, number>;
  options?: Record<string, unknown>;
}

/** 能力不匹配的具体原因（后台模拟与 C 端提示都读它） */
export interface CapabilityIssue {
  kind: string;
  name: string;
  reason: string;
}

export interface CapabilityMatch {
  matched: boolean;
  reasons: string[];
  issues: CapabilityIssue[];
}
