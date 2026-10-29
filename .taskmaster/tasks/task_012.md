# Task ID: 12

**Title:** 统一同步与异步协议的任务契约

**Status:** pending

**Dependencies:** 2, 6, 9

**Priority:** medium

**Description:** 把 ProtocolSpec.mode 与视频四段式统一为提交/轮询/取结果/下载抽象；图像与文本协议可声明 async，调度层共享轮询循环；保留按模态的 timeoutMs/pollMs/maxPolls 与 providerTaskId 恢复。

**Details:**

落点：protocols/protocol.spec.ts、protocol.registry.ts、各 provider、channel-scheduler.ts、generate.service.ts。同步协议在一次调用内完成；异步协议返回外部任务 id 并轮询。视频四段式作为 VideoProtocolSpec 适配，不改变既有错误码。

**Test Strategy:**

fake async image/text 协议可完成提交-轮询-落库；轮询超时失败退款；同步协议回归；视频四段式回归；providerTaskId 可在重启后恢复轮询（或明确记录不可恢复边界）。
