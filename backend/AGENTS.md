# backend/AGENTS.md

适用于 `backend/` 目录树。根 `AGENTS.md` 负责跨线协作，本文件负责后端落地；冲突时本文件优先，但不得覆盖 `CLAUDE.md` 的仓库不变量与单一事实源。

## 1. 责任与边界

主责：HTTP 接口、鉴权与权限、能力注册、模型路由、任务执行、计费与退款、支付、存储、通知、后台接口、环境校验。

- 本线拥有：`src/**`、`plugins/**`、`src/**/*.spec.ts`
- 本线不主动改：`frontend/**`、`test/**`、`docs/**`（契约与测试文档按交接同批更新）
- `prisma/**` 与迁移默认归数据线；只有任务明确属于数据线时，后端线才改 `prisma/schema.prisma`
- 冒烟与验证脚本归测试线；后端线负责让它们通过，不负责改断言

## 2. 先读

按顺序读：

1. 根 `CLAUDE.md`：仓库不变量、单一事实源、易腐化数量
2. `docs/model-architecture.md`：能力 → 选路 → 任务 → 协议 → 渠道 → 计费
3. `docs/database.md`：Prisma / SQLite、金额精度、状态、迁移与种子
4. `docs/security.md`：鉴权链、令牌、SSRF、上传、支付回调、日志脱敏
5. `docs/api-contract.md` 与 `docs/error-copy.md`：响应信封、错误码、用户文案
6. `docs/backend-nestjs-conventions.md`：模块分层、Controller / Service 边界、DTO、异常、鉴权、事务与测试口径
7. `docs/testing.md`：L1–L4 分层、脚本清单与覆盖矩阵

## 3. 分层与目录

依赖方向不可反转：`capabilities/definitions` → `model/intent` → `model/routing` → `model/tasks` → `model/protocol` → `model/channels` → `model/billing`。

| 目录 | 职责 |
| --- | --- |
| `src/capabilities/` | 能力定义、参数、完整性校验；新能力只在这里声明 |
| `src/model/` | 渠道、模型、选路、任务、协议、代理、计费 |
| `src/generate/` | 生成任务入口；执行实现仍在 `model/tasks` |
| `src/admin/` | 后台接口、权限、调度、备份、对账 |
| `src/auth/`、`src/account/` | 登录、令牌、账户与注销 |
| `src/payments/`、`src/orders/` | 支付适配器、回调、订单与退款 |
| `src/credits/`、`src/membership/` | 积分批次、会员与权益 |
| `src/assets/`、`src/storage/` | 素材、上传、签名 URL、存储后端 |
| `src/config/`、`src/common/` | 环境校验、错误、日志、限流、追踪、CSV |
| `prisma/schema.prisma` | 数据库结构唯一事实源（数据线维护） |
| `plugins/<plugin>/manifest.json` | 协议与推荐模型的唯一事实源 |

## 4. 硬约束

- 改源头，不改调用点：能力补 `definitions/<id>.ts` 并由 `index.ts` 聚合；权限补 `admin/permissions.ts`；账单状态补 `BILLING_STATUSES`；工单状态补 `TRANSITIONS`；环境变量补 `ENV_SPECS`。
- 不建第二份实现：运行期积分价只走 `CreditPriceService.resolve()`；业务代码不直接读 `creditCost`；错误码挂在定义处。
- 无可用线路必须失败并退款，不交占位图、假成功或本地生成结果。
- 新增字段必须有 DTO 白名单；金额与计费字段一律快照；状态迁移只走状态机。
- 后台接口必须校验权限点；越权、未登录、资源不存在按 `docs/security.md` 的语义返回，不靠前端隐藏按钮。
- 支付适配器必须验签、幂等、区分 `definitive` / `unknown` 退款语义；回调重复只入账一次。
- SQLite 单写者：事务与并发路径要考虑 `database is locked`；脚本直连库时有退避重试，不要绕过。
- `db push` 不可回滚；生产结构变更必须先备份并在副本演练，不能靠 git 回滚。
- 不提交密钥、真实 `.env`、`*.db`、`uploads/`、`logs/`、`dist/`。日志不打印明文凭证、令牌、支付密钥。

## 5. 验证

```bash
cd backend
npm run build          # prisma generate + nest build
npm test               # spec 类型检查 + vitest（src/**/*.spec.ts）
npm run verify:<name>  # L2 / 纯逻辑或同进程起 Nest 的专项断言
NODE_ENV=test node scripts/smoke-<name>.js  # L3，需先起测试档后端
```

测试前先确认库路径：

```bash
cd backend
node -e "console.log(require('./scripts/db-url').resolveDbPath())"
```

测试档固定 `NODE_ENV=test` → `backend/test.db`、`uploads-test/`、`backups-test/`、`logs/test/`。不要写 `dev.db`，不要同时跑开发档与测试档（端口都是 4100 / 5100）。

按改动域补：

- 能力 / 协议：`npx ts-node -T scripts/verify-capability-bootstrap.ts`、`npm run verify:plugin-manifests`、`npm run verify:protocol-runtime`
- 模型 / 渠道 / 选路：`npm run verify:model-consistency`、`npm run verify:channel-flow`、`npm run verify:route-catalog`
- 计费 / 任务：`npm run verify:billing`、`npm run verify:credits`、`npm run verify:task-runtime`
- 支付：`npm run verify:payment-signatures`、`npm run verify:payment-bills`、`npm run smoke:payments`
- 后台 / 安全：测试档 `node scripts/smoke-admin.js`、`smoke-auth.js`、`smoke-signed-url.js`、`smoke-rate-limit.js`

## 6. 完成定义

- 改动只落在单一事实源，没有第二份实现或临时兜底。
- 接口字段、错误码、权限点与 `docs/api-contract.md` / `docs/error-copy.md` 一致。
- 新增能力、插件、provider、后台菜单或路由时，同批更新 `CLAUDE.md` 的易腐化数量。
- L1 `build` 与相关 L1.6 单测通过；涉及 HTTP / 资金 / 权限时补 L2 / L3。
- 交付说明包含 `file:line`、命令、关键输出、落库或落盘证据、未验边界。

## 7. 常见踩坑

- 测试档手工启动用 `NODE_ENV=test node dist/main.js`，不要用 `nest start`。
- 冒烟基址按脚本选：多数 `API_BASE`，营销用 `MARKETING_API_BASE`，`verify-asset-filters.js` / `verify-prompt-tools.js` 用 `VERIFY_BASE`。
- `plugins/src-*` 是镜像目录，不参与运行；修运行时问题不要改镜像冒充修复。
- 测试失败先定性脚本错还是实现错，不得为了让用例变绿而放宽断言。
- 只改一端时，未到场端的复核结论写进交付说明，不要假设前端会兜住接口缺失。

## 8. 线程启动提示词

```text
你是本仓库的「后端线」线程。开始前按顺序读根 AGENTS.md、backend/AGENTS.md、CLAUDE.md，以及任务对应的 docs/ 文档。

目标：<一句话>
范围：只改 backend/src/** 与 backend/plugins/**；需要 schema 时先交给数据线；需要同步的 docs/ 与 CLAUDE.md 数量按交接同批更新。
先做：列出改动点（file:line）、单一事实源、接口 / 错误码 / 权限点假设、验证命令；等我确认后再实施。
实现：最小改动；补 DTO 白名单、权限校验、失败与退款路径、同目录 *.spec.ts。
验证：npm run build && npm test；按域补 verify-* / smoke-*，全部使用 NODE_ENV=test。
禁止：改前端、改断言、假成功、占位图、未授权 commit / push。
交付：改动清单 + 命令 + 关键输出 + 未验边界。
```
