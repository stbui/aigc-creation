# Task ID: 10

**Title:** 实现调度权重、并发上限与每分钟限流

**Status:** pending

**Dependencies:** 6, 7

**Priority:** high

**Description:** 候选集按 priority 分组，同组按 weight 加权随机；按 channelId 维护进程内信号量与每分钟滑动窗口；全部被限流/冷却时返回独立的 unavailableReason，并记录跳过原因。

**Details:**

落点：channel-scheduler.ts、channel.types.ts（或等价）、model-channel DTO/页面。weight 1-100，maxConcurrency=0 不限，rateLimitPerMin=0 不限。每次调度记录候选、权重、随机结果、跳过原因、最终通道；多实例口径写入 docs/model-architecture.md，不引入 Redis。

**Test Strategy:**

固定随机种子/大样本验证权重分布；maxConcurrency 达上限时跳过；rateLimitPerMin 窗口内跳过；0 表示不限；全部限流时原因不同于全部失败；attempts 含 skippedReason。
