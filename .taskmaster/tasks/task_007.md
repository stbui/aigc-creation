# Task ID: 7

**Title:** 打通连通性测试、健康状态与手动恢复熔断

**Status:** pending

**Dependencies:** 6

**Priority:** high

**Description:** 连通性测试只持久化 lastTest*，不得修改 failCount/cooldownUntil/lastSuccessAt/lastFailureAt；后端派生 closed/open/half-open；新增 reset-health 接口（channel.route + 必填原因 + 审计）。

**Details:**

落点：admin/model-channel.service.ts/controller.ts、model-config.service.ts testConnection、channel-repository.ts、permissions.ts、前端 API。reset-health 动作名 model.channel_reset_health，审计 detail 不含 token/baseUrl。健康派生：cooldownUntil>now=open；冷却已过且 failCount>=阈值=half-open；否则 closed。

**Test Strategy:**

冷却中线路测试成功不改变 cooldownUntil/failCount；reset-health 清空计数并生成审计；缺 reason 返回 40001；半开判定正确；测试结果含状态/耗时/错误且持久化。
