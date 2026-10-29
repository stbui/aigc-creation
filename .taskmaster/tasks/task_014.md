# Task ID: 14

**Title:** 测试、闸口与文档收口

**Status:** pending

**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13

**Priority:** high

**Description:** 补齐后端单测/集成、前端单测与 e2e，新增/更新 verify 脚本与覆盖矩阵；同步 model-architecture、environments、api-contract、testing、admin 文档、README 与 CLAUDE.md；记录迁移与回滚演练。

**Details:**

闸口：backend npm run build、相关 verify-*、前端 npm run typecheck、npm test、npm run e2e、npm run verify:deps:critical。文档删除双轨描述，写入唯一配置源、调度权重/限流/半开、协议注册表与迁移步骤。验收用例覆盖 PRD 的 10 条。

**Test Strategy:**

全部闸口真实执行并留存输出；10 条验收用例逐条通过；文档与代码一致；全仓 grep 不再出现 GATEWAY_BASE_URL/GATEWAY_TOKEN/legacyKey/materialize 等旧路径（迁移脚本与历史文档除外）。
