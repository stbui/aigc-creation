"use strict";
/**
 * 能力合同（CapabilitySpec）与请求意图（ModelRequestIntent）的公共类型。
 *
 * 移植自 open-ai-canvas `internal/app/model_router_capability.go`。
 *
 * 能力合同有两个来源，结构必须完全一致，否则「后台看到的可选规格」与
 * 「路由实际能承接的规格」会分叉：
 *   1. 渠道模型的能力配置（`ChannelModel.capabilityConfigJson`）→ 线路合同；
 *   2. 前台模型的 revision 快照（`LogicalModelRevision.capabilitySpecJson`）→ 产品合同。
 *
 * 本文件只放类型，不放逻辑，避免各模块互相 import 形成环。
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=spec-types.js.map