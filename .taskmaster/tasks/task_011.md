# Task ID: 11

**Title:** 实现熔断半开恢复与调度观测

**Status:** pending

**Dependencies:** 6, 7, 10

**Priority:** high

**Description:** 把熔断状态机扩展为 closed/open/half-open；冷却到期只放行一个探测，成功 closed，失败指数退避至上限 30 分钟；每次尝试写 ModelCallLog（channelId/attemptIndex），后台可回放 attempts。

**Details:**

落点：channel-scheduler.ts、image-call-logger.ts、admin/model-call.service.ts、后台调用记录页。冷却基数 max(30s, pollMs*5)，退避 2^(连续开启次数-1)，上限 30m。半开探测期间其他请求跳过并记原因。fallback 字段语义改为「切到下一条线路」，更新注释与文案。

**Test Strategy:**

半开窗口并发请求仅一个进入探测；成功清计数转 closed；失败按指数退避重开；attempts 每次落库且可按 channelId 筛选；无本地产出与伪成功。
