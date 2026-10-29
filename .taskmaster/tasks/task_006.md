# Task ID: 6

**Title:** 扩展 ModelChannel 健康与调度字段

**Status:** pending

**Dependencies:** 1

**Priority:** high

**Description:** 为 ModelChannel 增加 weight/maxConcurrency/rateLimitPerMin/lastTestedAt/lastTestStatus/lastTestLatencyMs/lastTestError；为 ModelCallLog 增加 channelId/attemptIndex；为 GenerationTask 增加 outputText/providerTaskId；同步 DTO、类型与前端 api.ts。

**Details:**

落点：backend/prisma/schema.prisma、admin/dto/model-channel.dto.ts、channel-repository.ts toView、frontend/src/lib/api.ts。默认值：weight=1、maxConcurrency=0、rateLimitPerMin=0。lastTestStatus 取值 ok|failed|unsupported。用 npm run prisma:push 建表，不新增 migrations 目录。

**Test Strategy:**

prisma db push 成功；旧行读取默认值正确；类型检查通过；DTO 范围校验（weight 1-100、并发/限流 >=0）；outputText 可空且不影响历史任务。
