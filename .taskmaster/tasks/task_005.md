# Task ID: 5

**Title:** 执行迁移并完成回滚演练

**Status:** pending

**Dependencies:** 1, 3, 4

**Priority:** high

**Description:** 在开发库执行 dry-run、备份后 --apply，核对 token 未从 env 复制、enabled=false、modelverse 改写、旧键删除；随后按备份恢复做一次回滚演练并记录。

**Details:**

执行前确认开发库路径与备份目录。核对项：新建线路 token=''、enabled=false；协议 modelverse→openai；ModelChannelConfig 仅保留运行参数与路由键；能力 runtime.effective=unavailable 且原因指向未配置线路。回滚：恢复 JSON 备份、npm run prisma:push、重启并抽查。

**Test Strategy:**

迁移报告逐条可核对；回滚后 ModelChannel/ModelChannelConfig 与备份一致；回滚后系统可启动且无旧键读取；演练记录写入 docs/testing.md。
