# Task ID: 13

**Title:** 完成协议与厂商扩展试点

**Status:** pending

**Dependencies:** 2, 12

**Priority:** medium

**Description:** 先取证再实现：在 Google Gemini（图像+文本，generateContent）或快手可灵（视频，异步创建/查询/下载）中选定一个试点，写探测脚本记录真实请求/响应/错误，再接入协议注册表、factory、vendor presets、后台预设与校验脚本。

**Details:**

落点：vendors/vendor.catalog.ts、vendor.presets.ts、vendor.integrity.ts、protocols/protocol.registry.ts、provider 实现、backend/scripts 探测脚本、docs/model-architecture.md。未取得真实响应前不得标记 real 或写入能力清单。新增依赖需评估 verify:deps:critical，优先零新增依赖。

**Test Strategy:**

探测脚本保存真实响应样本与错误结构；注册表/厂商完整性校验通过；后台预设可选且协议已实现；真实调用成功或给出可读失败原因；verify-vendor-aggregation 通过。
