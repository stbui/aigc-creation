# Task ID: 9

**Title:** 按能力模态统一任务分派并支持文本产出

**Status:** pending

**Dependencies:** 3, 6

**Priority:** high

**Description:** generate.service 删除 video/其余图像二分，按能力自身 modality 分派 image/text/video；接入 TEXT_PROVIDER；文本任务产出写 GenerationTask.outputText，保留扣费、失败退款、心跳与孤儿回收。

**Details:**

落点：backend/src/generate/generate.service.ts、generate.controller.ts、tasks.controller.ts、providers/providers.module.ts、frontend 类型。文本不生成 Asset，aigcMeta 记录 {labeled:false,reason:'text'}。用测试用能力定义验证新增文本能力无需再改分派分支；不新增 C 端文本入口。

**Test Strategy:**

单测三种模态走同一生命周期；文本成功写 outputText；文本通道失败退款且无伪产出；图像/视频回归不变；测试用能力定义不进入生产清单。
