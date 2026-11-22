# AGENTS.md

本文件是 Codex、Claude Code、Cursor 等 agent 的跨线协作入口。只写分工、边界、交接与验证，不复制 `CLAUDE.md` 的事实源表，也不替代 `docs/` 下的领域文档。

## 0. 读法与优先级

1. 用户当轮指令。
2. 本文件：跨线协作、目录归属、交接规则。
3. `CLAUDE.md`：仓库不变量、单一事实源表、易腐化数量。
4. `docs/development-workflow.md`：十三阶段流程、授权边界、Git 工作流。
5. `docs/README.md` 指向的领域文档。

文档分工（同一事实只维护一处）：

| 文件 | 只写 |
| --- | --- |
| `README.md` | 对外产品介绍、能力概览、快速启动 |
| 本文件 | 线路分工、文件归属、并行与交接 |
| `CLAUDE.md` | 仓库不变量、单一事实源、易腐化数量、环境踩坑 |
| `docs/development-workflow.md` | 阶段执行卡、闸口、证据标准、Git 工作流 |
| `docs/README.md` | 文档索引、命名与放置规则 |

- 实现与现行文档冲突时，以代码为准，并在本次改动范围内同步文档。
- 本文件与 `CLAUDE.md` 冲突时先停下说明，不自行择一；确认后同批修正两份文件。
- 任何线都不得绕过 `CLAUDE.md` 的单一事实源表另建一份实现。

## 1. 仓库地图

| 区域 | 技术栈 | 主要入口 |
| --- | --- | --- |
| 后端 | NestJS + Prisma + SQLite | `backend/src/`、`backend/prisma/`、`backend/plugins/` |
| 前端 | React + Vite + shadcn | `frontend/src/`、`frontend/src/admin-ui/`、`frontend/src/ui/` |
| 测试 | Vitest + Playwright + HTTP 冒烟 | `backend/scripts/`、`frontend/tests/`、`test/` |
| Agent | Node + OpenAI Codex SDK | `agent/src/` |
| 浏览器扩展 | Chrome MV3 | `extension/` |
| 基础设施 | Docker Compose + CI | `start.sh`、`docker-compose*.yml`、`.github/workflows/` |

目录级细则：`backend/AGENTS.md`、`frontend/AGENTS.md`、`test/AGENTS.md`。它们只补充各自目录，跨线规则仍以本文件为准。

先读 `CLAUDE.md` 的「单一事实源」表，再按任务域读 `docs/README.md` 指向的文档。不要从记忆里猜路径、数量或状态名。

## 2. 三条主线

### A. 后端线

主责：接口、鉴权与权限、能力注册、模型路由、计费与退款、支付、存储、环境校验；数据库结构经 S2 数据线落地。

- 可改：`backend/src/**`、`backend/plugins/**`、`backend/src/**/*.spec.ts`；`backend/prisma/**` 默认走 S2 数据线
- 不主动改：`frontend/src/**`、`frontend/tests/**`、`test/**`、根目录锁文件
- 事实源：能力 `capabilities/definitions/`、权限 `admin/permissions.ts`、账单 `model/billing/`、任务 `model/tasks/`、协议 `plugins/<plugin>/manifest.json`
- 验证：`cd backend && npm run build && npm test`；按域补 `npm run verify:<x>` 或测试档 `node scripts/smoke-<x>.js`
- 交付：接口契约、DTO 白名单、权限校验、失败与退款路径、同目录 `*.spec.ts`

后端线不得用本地占位、假模型结果或 mock 数据掩盖线路缺失；无可用线路时必须失败并退款。

### B. 前端线

主责：C 端页面、后台页面、组件层、设计令牌、交互状态、接口消费与路由。

- 可改：`frontend/src/**`、`frontend/scripts/**`、`frontend/src/**/__tests__/**`
- 不主动改：`backend/src/**`、`backend/prisma/**`、`frontend/tests/**`、`test/**`
- 组件边界：后台页面只从 `admin-ui/radar` 取件；C 端页面只从 `src/ui` 取件；不得绕过组件层直连原子件。
- 视觉边界：颜色只引 `var(--token)`，不写裸 hex；最小字号 12px；页面样式只放本页独占选择器。
- 验证：`cd frontend && npm run typecheck && npm test && npm run build:prod`；涉及页面链路时再跑 `npm run e2e`
- 交付：五态（空 / loading / 有数据 / 失败 / 无权限或未登录）、接口失败的真实反馈、同目录 Vitest 用例

前端不得用本地假数据兜底接口缺失，也不得把原始错误通过 `StateError` 的 `detail` 透给 C 端用户。

### C. 测试线

主责：测试策略、跨端契约用例、L2 断言、L3 HTTP 冒烟、L4 浏览器 E2E、测试数据隔离与现场清理。

- 可改：`docs/testing.md`、`test/**`、`frontend/tests/**`、`backend/scripts/smoke-*.js`、`backend/scripts/verify-*.ts`、`backend/scripts/probe-environments.ts`
- 不主动改：业务实现文件；测试轮只出报告，不在同一轮顺手修业务代码
- 分层：L1 构建与类型、L1.5 前端单测、L1.6 后端单测、L2 架构与纯逻辑、L3 HTTP 冒烟、L4 Playwright
- 验证：先确认 `NODE_ENV=test` 与库路径，再跑对应层级；测试档用 `./start.sh --env test`
- 交付：命令、关键输出、落库或落盘证据；失败项登记缺陷卡；未验项写清原因

业务线负责与实现同目录的 L1.5 / L1.6 单测；测试线负责跨端契约、L2 / L3 / L4 与测试策略。两边不得用同一份断言互相「修绿」。

## 3. 需要补充的支撑线

三条主线只覆盖业务实现。并行开发还需要下面几条支撑线；P0 不先做，前后端会在接口、schema 和锁文件上互相踩。

### S1. 契约与集成线（P0，先行）

主责：冻结跨端契约、定义合并顺序、维护共享入口与依赖版本。

- 共享文件：`docs/api-contract.md`、`docs/error-copy.md`、`backend/src/capabilities/definitions/index.ts`、`frontend/src/App.tsx`、`frontend/src/components/admin/adminNav.ts`、`package.json`、各包 `package.json` 与锁文件
- 契约内容：方法、路径、鉴权、权限点、请求 / 响应信封、错误码、分页、幂等键、状态机
- 冻结卡片与变更规则：`docs/api-contract.md` §5
- 合并顺序：契约 → 数据 → 后端 → 前端 → 测试 → 文档 → 基础设施
- 验证：`npm run verify:deps`、`npm run verify:conventions`、`npm run verify:env-sync`

功能线不要直接改共享入口；需要时向集成线提交变更说明，由集成线串行合并。

### S2. 数据与迁移线（P0）

主责：Prisma schema、迁移、种子、测试库重置与库路径。

- 可改：`backend/prisma/**`、`backend/scripts/migrate-*.js`、`backend/scripts/seed-*.ts`、`backend/scripts/reset-test-env.js`、`backend/scripts/db-url.js`
- 规则：计费字段一律快照；`db push` 不可回滚；改 schema 同批更新 `docs/database.md` 与相关测试
- 验证：`cd backend && node -e "console.log(require('./scripts/db-url').resolveDbPath())"`；`NODE_ENV=test npm run db:reset:test`；`npm run prisma:generate`

其他线不得直接改 `schema.prisma`。需要新字段时先由数据线落 schema 与迁移，再通知后端 / 前端消费。

### S3. 基础设施与发布线（P1）

主责：环境变量、启动脚本、容器、CI、版本与发布门禁。

- 可改：`start.sh`、`docker-compose*.yml`、Dockerfile、`.github/workflows/**`、`backend/src/config/**`、`.env.*`、`scripts/check-node-version.mjs`、`scripts/verify-compose.mjs`
- 环境变量四处同批：`ENV_SPECS`、`backend/.env.example`、三档 env、`docs/environments.md`
- 验证：`npm run check:node`、`npm run verify:env-sync`、`npm run verify:compose`；生产镜像按 CI 的 `docker-build` 验证

### S4. 安全与合规评审（P1，横向）

主责：钱、权限、合规、密钥与个人信息相关改动的独立复核。它不是文件所有者，但必须参与评审。

- 重点文件：`backend/src/auth/**`、`backend/src/admin/permissions.ts`、`backend/src/payments/**`、`backend/src/model/billing/**`、`backend/src/storage/**`、`backend/src/aigc-label/**`
- 必查：越权与未登录、权限点与路由一致、支付回调验签与幂等、退款语义、签名 URL、AIGC 标识、上传限制、日志脱敏
- 交付：拒绝路径用例、二次确认或原因字段（仅确有业务依据时）、风险与回滚说明

### S5. 文档与可观测性（P1）

主责：文档索引、测试清单、日志与追踪口径。文档与代码同批更新，不做事后补写。

- 可改：`docs/README.md`、`docs/observability.md`、`backend/src/common/logger/**`、`backend/src/health/**`；`docs/testing.md` 的内容归测试线，S5 只做索引同步
- 规则：单次测试结果随提交说明记录，不写进 `docs/testing.md`；文档只写现状，规划内容标「规划中」
- 验证：`rg` 全仓引用；涉及数量时同批跑 `npm run verify:conventions`

### S6. Agent 与扩展线（P2，独立排期）

主责：`agent/` 与 `extension/` 两个独立产品面，不与主站前后端混在同一线程。

- 验证：`npm --prefix agent test`；扩展按 `extension/README.md` 手工加载并走关键链路，新增脚本同批登记 `docs/testing.md`
- 边界：不把 agent 的会话状态或扩展的采集逻辑写进主站后端；需要接口时先走 S1 契约

## 4. 文件归属与并行规则

- 同一时间一个文件只归一条线修改。两条线同时需要同一文件时，由 S1 集成线串行合并。
- 根目录与各包 `package.json`、锁文件、共享入口一律走 S1；不要手工编辑锁文件。
- 每个线程只做一件事。需要改代码时使用独立 worktree，不在同一个 checkout 里并行改两个任务。
- 合并前先同步基线：未推送分支用 `git rebase main`，已推送或有协作者用 `git merge main`；冲突解决后重跑受影响闸口。
- 跨线依赖先写契约，不在生产代码里放临时 mock 或双份字段。前端可以先用契约类型和失败态开发，但不能伪造成功数据。

### 4.1 T3 Code 线程编排

一个任务建议按下面顺序开线程；除契约线外，每条改代码的线都用 `New worktree`，不要共用 checkout。

| 顺序 | 线程 | 起点 | 交付 |
| --- | --- | --- | --- |
| 1 | 契约 / 集成 | 当前仓库 | 接口、字段、错误码、权限点、状态机、合并顺序 |
| 2 | 数据 / 迁移 | 独立 worktree | schema、迁移、种子、测试库重置 |
| 3 | 后端 | 独立 worktree | 实现、DTO、权限、退款与失败路径、L1.6 单测 |
| 4 | 前端 | 独立 worktree | 页面、组件、五态、接口消费、L1.5 单测 |
| 5 | 测试 | 独立 worktree | L2 / L3 / L4 用例、证据、缺陷卡 |
| 6 | 基础设施 / 文档 | 独立 worktree | CI、compose、env、文档索引与覆盖矩阵 |

契约线未冻结前，后端和前端只做不跨界的准备（读文档、列清单、写类型草稿），不要各写一套字段后等合并时对账。

## 5. 跨线契约

并行开工前，S1 至少要冻结这些内容：

- 接口：方法、路径、鉴权、权限点、请求体、响应信封、错误码
- 数据：字段名、类型、可空性、默认值、金额单位与精度、时间格式
- 状态：任务、账单、工单、支付的状态名与合法迁移
- 分页与筛选：参数名、默认值、上限、排序白名单
- 幂等与并发：幂等键、重复提交、并发回调、SQLite 单写者退避

契约变更必须同批更新 `docs/api-contract.md`、`docs/error-copy.md` 和受影响的测试。前端不得自行猜字段；测试不得按实现反推断言。

## 6. 常用命令与闸口

```bash
npm ci                 # 根工具链
npm run setup          # 四个包依赖 + Prisma Client
npm run dev            # 开发档
npm run dev:test       # 测试档
npm run check          # 版本、依赖、约定、环境同步、lint、build、单测
```

按线补充：

```bash
cd backend && npm run build && npm test
cd frontend && npm run typecheck && npm test && npm run build:prod
cd frontend && npm run e2e
cd test && npm test
npm --prefix agent test
```

规则：

- 测试一律连测试档：`NODE_ENV=test` → `backend/test.db`、`uploads-test/`、`backups-test/`、`logs/test/`。不要写 `dev.db`。
- 先跑红再修订；不得为了让测试变绿而放宽断言。
- `npm run check` 不包含 Playwright 全量 E2E 与 Docker 构建；PR 仍要满足 CI 的 `quality`、`e2e-smoke`、`docker-build`。
- 未获用户当轮明确授权，不主动 build、不跑测试；先做只读检查并列出待执行命令。用户说「跑」只跑不改；用户说「改」只做最小修订。

## 7. 完成定义

一条线的工作只有同时满足以下条件才算完成：

- 改动落在单一事实源，没有第二份实现或临时兜底。
- 跨线契约已同步，前后端字段与错误码一致。
- 相关 L1 / L1.5 / L1.6 通过；涉及接口或页面时补 L3 / L4。
- 文档与代码同批更新；数量变化跑过 `npm run verify:conventions`。
- 新增或改名文档已同步 `docs/README.md` 索引与全仓引用。
- 交付说明包含命令、关键输出、落库或落盘证据；未验项写明原因。
- 没有夹带无关重构、调试日志、密钥、`.env` 真实值、`*.db`、`uploads/` 或 `logs/`。
- 钱、权限、合规相关改动已由 S4 复核，并写清风险与回滚方式。

## 8. 交接格式

每条线结束或阻塞时，按这个格式交接：

```text
线：后端 / 前端 / 测试 / 契约 / 数据 / 基础设施
范围：
改动：file:line，逐条对应 REQ / BUG
契约：新增或变更的接口、字段、错误码
验证：命令 + 关键输出
未验：原因与前置条件
阻塞：需要哪条线先完成什么
```

PR 描述按 `.github/pull_request_template.md`，不要另写一套。提交与推送需用户当轮明确授权；默认只起草提交说明。

## 9. 常见踩坑

- 同一 checkout 里多个线程共享分支，改代码时必须用独立 worktree。
- SQLite 单写者：脚本直连库时后端同时写会撞 `database is locked`，测试脚本已有退避重试，不要绕过。
- 后台页面直连 `admin-ui` 原子件、C 端页面直连后台组件，都会破坏组件边界。
- 小于 12px 的字号、C 端 `StateError` 传 `detail`、四包版本不一致，都会被 `verify:conventions` 拦下。
- 能力、插件、provider、后台菜单、壳内路由的数量写进 `CLAUDE.md` 后必须同批更新；脚本会按代码实际数量校验。
- `db push` 不能靠 git 回滚；数据库结构变更必须先备份并在副本演练。
- 没有可用模型线路时，必须失败并退款；不要用占位图、假成功或本地生成补缺。
