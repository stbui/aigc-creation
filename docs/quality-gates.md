# 闸口与证据标准

本文规定闸口矩阵、按改动域选专项、证据三件套与完成定义。阶段流程与执行卡见 [`development-workflow.md`](development-workflow.md)，授权边界见 [`agent-execution.md`](agent-execution.md)，提交与 PR 见 [`git-workflow.md`](git-workflow.md)。

执行任何闸口前先确认用户当轮授权（「跑 / 验证 / 检查」）；未授权时只列出待执行命令。

## 1. 闸口矩阵（命令级）

「全量」指按 `docs/testing.md` 第 3 节清单逐组执行；仓库**没有**一键全量业务冒烟（无 `smoke:all` / `gate:all`），不得在交付摘要里声称「全量通过」而不附逐组结果。根目录 `npm run check` 只覆盖 Node 版本、依赖审计、仓库约定、Prisma schema 校验、构建、后端 / 前端 / agent 单测与仿真网关测试。

| 层 | 命令 | 何时跑 | 备注 |
| --- | --- | --- | --- |
| 工程门禁 | `npm run check` | 阶段 6、9、10 | 根目录执行；静态（含 Prisma schema）、构建、单测（L1 / L1.5 / L1.6）+ 仿真网关，不含业务冒烟 |
| L1 后端 | `cd backend && npm run build` | 阶段 6、9、10 | 需授权；不用 `nest start` |
| L1 前端 | `cd frontend && npm run typecheck` / `npm run build:prod` | 阶段 6、9、10 | 需授权 |
| L2 架构 | `cd backend && npx ts-node -T scripts/verify-*.ts` | 阶段 6、7、10 | 按改动域挑；`probe-environments.ts` 不连库 |
| L3 冒烟 | `cd backend && NODE_ENV=test API_BASE=http://127.0.0.1:4100 node scripts/smoke-*.js` | 阶段 7、10 | 先起测试档（同端口，会停开发档）；其他变量见 [`development-workflow.md`](development-workflow.md) §2.7 |
| L4 E2E | `cd frontend && npm run e2e` | 阶段 7、10 | 生产不跑 |
| 依赖 | `cd backend && npm run verify:deps:critical` | 依赖变动时 | 新增依赖后必跑 |
| 生产 | 只读接口 + `probe-environments.ts` | 阶段 13 | 不跑写入用例、不跑 E2E |

## 2. 按改动域选专项

完整清单与覆盖矩阵见 `docs/testing.md` 第 3、4 节：

| 改动域 | 必跑 |
| --- | --- |
| 能力 / 生成 | `smoke-capability-runtime`、相关页面冒烟、`verify-credit-deduction`、`verify-route-catalog`、`verify-task-runtime` |
| 模型层 | `verify-plugin-manifests`、`verify-model-consistency`、`verify-channel-flow`、`verify-protocol-runtime`、`verify-billing`、`verify-task-runtime`，以及 `frontend npm run e2e -- admin-model-suite` |
| 中转 / 插件 / 财务 | `verify-proxy-runtime`（`VERIFY_HTTP=0` 只跑纯逻辑段）；改 `src/model/proxy/**`、`src/model/plugins/**`、`finance-analytics`、`billing-sweeper` 时必跑 |
| 交易与权益 | `smoke-commerce`、`smoke-payments`、`smoke-membership*`、`smoke-refund-rules` |
| 账户与合规 | `smoke-auth`、`smoke-account`、`smoke-qr-login`、`smoke-aigc`、`smoke-signed-url` |
| 后台与运维 | `smoke-admin`、`smoke-backup`、`smoke-scheduler`、`smoke-storage`、`smoke-tickets-search` |
| 依赖变动 | `npm run verify:deps:critical` |
| 环境体系 | `npx ts-node -T scripts/probe-environments.ts`（74 项，不连库） |

## 3. 证据三件套与交付摘要

任何结论必须能复查，三件套缺一不算：

1. **命令**：可直接照抄，含环境变量与端口。
2. **关键输出**：状态码、错误码、金额、`routeId` / `channelModelId`、通过 / 失败数。
3. **落库或落盘记录**：库里的 `status`、流水条数、文件魔数与扩展名。

截图只作补充；「我点了没问题」「应该可以」不算证据。没跑的写「未验」，不写「已通过」。生产证据只允许来自只读操作。

**交付摘要模板**（阶段 11 直接套用）：

```
结论
<一句话：做什么、成没成>

改动
- <file:line> — <对应 REQ/BUG 编号>

验证
- `<命令>` → <通过/失败数>；失败项：<关键输出>

未验
- <项> — 原因与所需条件

未修 / 降级
- <项> — 原因与后续轮次
```

## 4. 完成定义

一件事算完成，需同时满足：

1. 阶段 1 的验收标准逐条通过，产品确认单已签。
2. 每条需求 / 缺陷都有对应用例，脚本或 E2E 留在仓库里。
3. 受影响域闸口全绿；失败项已在 `docs/testing.md` §5「已知缺口与验证边界」登记并有结论。
4. 单一事实源没有产生第二份实现；文档与代码一致。
5. 交付摘要三件套可复查；未验边界已写明。
6. 缺陷全部 `closed`，或有原因、风险、轮次的 `deferred`。
7. 测试数据已清理，没有残留把下一轮伪造成通过。
8. 涉及部署的变更已完成发布与观察，或写明「未发布」及原因。
