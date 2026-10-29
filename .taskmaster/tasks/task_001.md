# Task ID: 1

**Title:** 建立改造基线与一次性迁移工具

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** 备份并导出当前 ModelChannel、ModelChannelConfig 与能力清单；实现旧配置盘点脚本与 migrate-channel-model-v2.ts（默认 dry-run，--apply 写库，写库前强制备份，幂等），并给出回滚演练步骤。

**Details:**

落点：backend/scripts/migrate-channel-model-v2.ts、package.json scripts、backend/backups/。盘点项：GATEWAY_BASE_URL/GATEWAY_TOKEN/GATEWAY_{MODALITY}_{BASE_URL,TOKEN,MODEL,PROVIDER}、ModelChannelConfig 中的线路键、ModelChannel.protocol='modelverse'。迁移创建线路时 token=''、enabled=false，并逐条报告待补录凭据。写库前导出 channel-model-v2-<timestamp>.json，导出失败即中止。不执行 --apply，执行留给任务 5。

**Test Strategy:**

dry-run 前后 DB 行数与字段完全不变；--apply 前备份文件存在且 JSON 可解析；重复执行 --apply 不新增/不重复删除；报告覆盖每条旧键与待补录线路。
