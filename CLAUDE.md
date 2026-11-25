# CLAUDE.md

本文件是仓库的常驻作业上下文，Claude Code 会自动读取，Codex / Cursor 等经根 `AGENTS.md` 指向阅读。只保留**坐标、硬约束、踩坑**；跨线分工见 `AGENTS.md`，阶段流程见 `docs/development-workflow.md`，执行边界、闸口与 Git 分别见 `docs/agent-execution.md`、`docs/quality-gates.md`、`docs/git-workflow.md`，文档索引见 `docs/README.md`。

## 0. 仓库不变量

1. 模型调用只有 `backend/src/model/**` 一条链路。
2. 能力清单只在 `backend/src/capabilities/definitions/` 定义。
3. 组件只有 shadcn 一套：后台页面从 `admin-ui/radar` 取件，C 端页面从 `src/ui` 取件。

指令优先级见根 `AGENTS.md` §0；本节只说明事实冲突时的取值顺序。

## 1. 先读这里

**事实源优先级：代码 > 现行文档 > 本文件中的叙述。** 数量、路径、状态名与代码冲突时，以代码为准，并在本次任务范围内同步文档。

| 内容 | 唯一事实源 |
| --- | --- |
| 能力清单 / 字段 / 默认积分价 | `backend/src/capabilities/definitions/<id>.ts`，由同目录 `index.ts` 聚合 |
| 运行期生效积分价 | `CapabilityPricing`（后台「能力与模型 → 售价」）；运行时经 `CapabilityCatalogService` 快照读取，业务代码不直接读 `creditCost` |
| 协议与推荐模型 | `backend/plugins/<plugin>/manifest.json`；Provider 目录见 `src/model/plugins/provider-catalog.service.ts` |
| 渠道 / 能力绑定 / 能力售价 | 数据库与后台配置；代码里没有默认线路表 |
| 权限点 | `backend/src/admin/permissions.ts` |
| 账单状态机 | `backend/src/model/billing/billing.service.ts` 的 `BILLING_STATUSES` |
| 工单状态机 | `backend/src/tickets/tickets.service.ts` 的 `TRANSITIONS` |
| 启动期环境变量 | `backend/src/config/env.validation.ts` 的 `ENV_SPECS` |
| 三环境档位 / 库与目录 | `backend/src/config/env-files.ts`、`backend/scripts/db-url.js`、`docs/environments.md` |
| 数据库表结构 | `backend/prisma/schema.prisma` |
| 跨请求缓存 / 默认 TTL | `backend/src/cache/cache.module.ts` 的 `CacheModule`；业务侧注入 `CACHE_MANAGER` |
| 后台菜单与分组 | `frontend/src/components/admin/adminNav.ts` 的 `ADMIN_MENU` |
| 设计令牌 | `frontend/src/styles/tokens.css` 的 `:root`；`admin.css` 的 `@theme inline` 只做语义桥接 |
| 错误码与响应信封 | `docs/api-contract.md`；用户文案见 `docs/error-copy.md` |
| 测试清单与覆盖矩阵 | `docs/testing.md` |
| 文档分类地图 | `docs/README.md` |

**易腐化数量**：改相关代码后复核此表；`src-*` 镜像、测试文件与辅助文件不计入有效数量。

| 数字 | 事实源 | 排除项 |
| --- | --- | --- |
| 107 个插件包 / 115 个 provider | `backend/plugins/*/manifest.json` | 3 个 `src-*` 镜像目录（`src-a6api` / `src-antigravity-proxy` / `src-metaso-h3`）不参与运行 |
| 17 项能力 / 16 image + 1 video / 14 项进工作台 | `definitions/index.ts` 的 `CAPABILITY_PLUGINS` | `*.spec.ts`、`*-options.ts`、`*.templates.ts` 不是能力定义 |
| 36 个后台菜单入口 / 7 个分组 | `adminNav.ts` 的 `ADMIN_MENU` | 外壳、概览内容组件与测试目录不是菜单页 |
| 35 条壳内路由 | `frontend/src/App.tsx` 的 `Shell()` 内全部 `<Route>`（含裸外壳 2 页 + catch-all 2 条，业务路由 31 条） | `/login` 等 6 条独立页与 `/admin/*` 在 `App()` 层、不在 Shell 内，不属本口径 |

本地账号：development / test 的后台预设为 `admin@admin.com` / `123456789`；普通账号由 `seed` 创建，不能获得 admin 角色。production 不设默认密码，必须显式提供 `ADMIN_PASSWORD` 或使用一次性随机密码。

## 2. 系统地图

**货觉AI**（技术标识 `huojue`）是 C 端智能视觉创作站 + 独立后台管理端，另含商业、账户合规与服务域。图像、文本、视频只允许真实模型产出；没有可用线路时失败并退款。

```text
backend/src/
  capabilities/     registry 门面 + definitions/<id>.ts
  model/            渠道 / 能力绑定 / 选路 / 任务 / 账单 / 代理 / 媒体
  generate/         生成任务入口；执行实现位于 model/tasks
  admin/            后台接口、权限、调度、备份
  config/ common/   环境校验、错误、日志、限流、追踪、CSV
  cache/            全局缓存模块（CACHE_MANAGER，内存 store）
  payments/ credits/ orders/ membership/ marketing/ products/
  account/ auth/ assets/ projects/ storage/ tickets/ notifications/
backend/plugins/    内置协议插件清单；后台上传包另存 plugins-installed
frontend/src/
  admin-ui/         后台 shadcn 原子件、radar 组件层、外壳、providers
  ui/               C 端组件取用层
  pages/admin/      后台页面
  pages/<域>/       C 端功能目录：index/page/components/api/hooks/utils/constants
  components/ layout/ lib/ context/ hooks/ styles/
extension/          Chrome MV3 图片采集扩展
docs/               需求 / 产品 / 技术 / 测试 / 规划；入口见 docs/README.md
  design/           前端设计：admin/ 后台、web/ C 端页面、standards/ 跨端规范
```

运行期产物 `backend/uploads`、`backend/logs`、`backend/backups` 不入库。`backend/src/channels/` 是短信 / 邮件通知出口，不是模型渠道。

## 3. 硬约束

### 3.1 能力

- `CapabilityPlugin` 的装配期完整性由 `assertCapabilityIntegrity` 校验；漏声明即启动失败。
- `mode` 与实际实现一致；当前能力全部为 `real`。不存在 `localImpl` / `localFallback`，也不得用本地占位或伪模型结果补缺。
- `modality` 与 `mode` 正交；`text` 用于提示词工具等非能力项。
- 界面可用性看 `GET /capabilities` 的 `runtime.effective`：`remote` 可用，`disabled` 已下线，`unavailable` 没有可用绑定且不可提交。没有 `CapabilityControl` 行视为启用。
- 一次提交产出 N 张时声明 `outputPlan`。准入层按计划拆成 N 个独立任务，共享 `batchId / batchIndex / batchSize`；每张各建一张账单、各扣一份价、各自退款。要多样化版式就拆任务，不用提示词拼多图。
- 新能力还要在后台绑定可用商品并配置售价；否则即使定义存在，运行时仍是 `unavailable`。

### 3.2 模型链路

- 唯一链路：渠道 → 渠道模型（商品）→ 能力绑定 → 能力目录选路 → 任务执行 → 账单。建任务必须携带 `capability` + `modelKey`。
- `ChannelModel.capability` 是供应侧模态（`image/text/video/audio`）；`CapabilityModelBinding.capabilityId` 是 C 端能力 id，例如 `free_create`。混用会表现为“有模型但能力不可用”。
- 渠道模型的 `protocol` 填插件声明的 **provider id**，不是插件目录名。例如 `plugins/openai-images` 声明 `openai-image`，则填后者。
- 售价在能力级；切换线路不改价。渠道价格档只表达成本与毛利，不参与生成扣费。
- 只有 `rejected_no_job`（请求尚未写出上游）可以切线。全部线路在建连前失败落 `42204`，遮罩无 edits 线路为 `42205`，按预留明细原路退款。
- 建连后的超时、5xx、连接中断或响应解析失败属于**结果不明**：落 `42206`，不切线、不自动退款，账单保持 `uncertain`，等待人工 `settle` / `refund` 并填写原因。
- 文本工具走同一条真实模型链路，但不建生成任务与账单；无可用线路或全部失败返回 HTTP 502，错误码 `50201`，不拼模板文案。
- 选路过滤、健康分层、冷却、目录快照和扩展 SOP 见 `docs/model-architecture.md`。改动模型层后，若当前进程仍持有旧快照，不能把旧结果当作验证证据。

### 3.3 积分与商业域

- 建任务、建账单、积分预留必须在同一事务；任务快照 `creditCost` 与账单金额同源。失败或取消按快照原额退还。
- 积分扣减使用 FEFO 跨批次扣减，退款按 `CreditReservationItem` 原路退回原批次并保留原到期时间。
- 恒等式：`CreditAccount.available + reserved == Σ CreditLot.remaining`。
- 已结算账单不得自动退款；已退款账单不得再结算。`uncertain` 只能人工处置。
- 退款先落 `Refund(status='processing')` 再调用渠道，渠道成功后才能改订单与本地账。渠道失败返回 `50302` 时，订单与积分保持不变。
- 退款校验顺序不可反：先校验“金额 ≤ 实付 - 已退”，再执行时间窗、比例、已消费任务等可配规则。
- 对账只改状态与备注，不改资金金额；发票金额取 `paidCents - refundedCents` 快照。
- 商品、订单、优惠券、支付、退款、对账的完整规则见 `docs/commerce-design.md`。

### 3.4 后台与前端

- 权限链为 `AdminGuard` → `PermissionGuard` → controller。前端 `AdminContext.can()` 只隐藏入口，安全边界必须在后端。
- 后台页面只从 `admin-ui/radar` barrel 取件，不直连 `admin-ui/components/ui`；原子件仅供 radar 组合。
- 后台组件底座是 radix，官方 `new-york` 风格，组合使用 `asChild`。新增官方件用 `shadcn add`，完成后必须运行 `frontend/scripts/post-shadcn.mjs`。
- 类名合并只走 `admin-ui/lib/cn.ts`；修改 `admin.css` 的 `@theme inline` 后，同步补登 `cn` 的 token 合并表。
- 后台不做移动端与响应式设计。页面关键节点使用 `data-testid="admin-*"`，表单控件使用 `aria-label`；e2e 按 test id、label 与角色查询，不追 Tailwind 类名。
- C 端页面只从 `frontend/src/ui` 取件。C 端路由公开可浏览；需要身份的动作唤起登录，`/login` 只作深链接兜底。
- `/admin/*` 必须注册在 catch-all 之前；`VITE_API_BASE` 默认留空走同源代理。

## 4. 常见改动入口

| 目标 | 首先修改 | 必须同步 |
| --- | --- | --- |
| 新增能力 | `capabilities/definitions/<id>.ts` + `definitions/index.ts` | 完整性校验；后台绑定商品、设置售价 |
| 一次提交多张产出 | 能力定义中的 `outputPlan` | 拆任务、逐张账单、批次聚合与测试 |
| 接入厂商 | `backend/plugins/<plugin>/manifest.json` | `verify-plugin-manifests`、`verify-protocol-runtime` |
| 新增后台页面 | `permissions.ts` → controller 权限 → `adminNav.ts` → `pages/admin/<域>` → 路由 → `lib/api.ts` | 后端再次校验动作权限 |
| 新增后台 UI 组件 | 查 `components/ui` → `shadcn add` → `post-shadcn.mjs` → 需要时落入 `radar/*` | 页面只从 radar 取件 |
| 新增环境变量 | `ENV_SPECS`、`backend/.env.example`、三档 env | 影响库路径时同步 `scripts/db-url.js`；跑环境探针 |
| 调整积分价 / 退款规则 | 能力售价 `CapabilityPricing`（初始值来自能力定义 `creditCost`）/ `common/setting-defs.ts` | 后台「能力与模型 → 售价」写入；退款规则走设置读取 |
| 新增前端功能目录 | `pages/<域>/` 分层入口 | `docs/design/standards/frontend-module-conventions.md` 与模块导入测试 |
| 新增进程内缓存 | 注入 `CACHE_MANAGER`（`cache/cache.module.ts`） | key 带域前缀、显式 TTL；写操作必须 `del` 对应 key，只缓存可重建的读投影 |

## 5. 命令

构建、测试、lint 与 verify 的完整命令以根目录及子包的 `package.json` 为准；只在用户明确要求执行时运行。

```bash
# 开发启动：固定后端 4100 / 前端 5100；--env test|prod 切档，两档不能并行
./start.sh
./start.sh --env test --daemon
./start.sh --stop

# 仓库门禁
npm run check
npm run lint:ci
npm run verify:conventions
npm run verify:prisma

# 后端
cd backend
npm run build && node dist/main.js       # 不要用 nest start
npm run db:reset:test                    # 仅测试库；带安全门禁
npx ts-node -T scripts/probe-environments.ts
cd .. && npm run verify:deps:critical

# 按包执行
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run typecheck

# 只格式化本次改动
npx biome format --write <files>
```

- 根目录 `npm test` 依次覆盖 backend / frontend / agent / gateway；冒烟与 verify 脚本的前置条件见 `docs/testing.md`。
- 种子、冒烟和测试脚本连接当前 `NODE_ENV` 对应的库。操作测试库前显式设置 `NODE_ENV=test`，否则可能写开发库。
- 后端单测位于 `backend/src/**/*.spec.ts`，使用 Vitest node 环境。需要 SQLite 的 HTTP 集成测试使用临时库，不碰 `dev.db` / `test.db`，也不依赖已启动服务。
- 真实渠道、Docker 与部署级验证不能由单测替代；命令见 `docs/testing.md`、`docs/docker-deployment.md`。

## 6. 约定

- **通用能力优先使用第三方优秀开源库，不重复造轮子**。解析、格式化、加密、签名、队列、文件、图像、日期、CSV 等先查成熟实现；优先选择维护活跃、许可证兼容、安全记录清晰、与当前 Node / CommonJS / 部署环境兼容的库。业务规则、计费、权限、审计与状态机仍在本仓库事实源内实现。
- 只有在许可证或安全要求不满足、运行环境不兼容、维护成本明显更高，或现有库无法通过适配层表达业务语义时才自研；自研必须在技术评审中写明备选库、放弃原因、风险与回滚方式。
- 后台文件按 `index / page / components / api / hooks / utils / constants` 分层，目录外只从入口文件取件。
- 后端与前端 TS 配置刻意不同，不要统一：后端 CommonJS / ES2021，`strict` 与 `strictNullChecks` 为 false；前端 ESNext / bundler，`strict` 为 true。
- 依赖精确锁定，不手工添加 `^` / `~`。安装依赖后运行 `npm run verify:deps:critical`。
- 全站只有一套浅色主题。颜色、圆角、阴影与语义字号只引用 `frontend/src/styles/tokens.css` 的 token，不写裸 hex。
- 后台页面使用 shadcn 语义类（`bg-card` / `text-muted-foreground` / `border-border` 等）。Tailwind 没有 preflight，裸 `border` 会退回 `currentColor`；基础兜底放 `admin.css` 的 `@layer base`。
- 页面不新增 `adm-*` 类；`.adm-*` 仅保留外壳骨架契约。
- 全站最小字号 12px。任何页面、组件、图表刻度或内联样式都不得更小；细则见 `docs/design/standards/typography.md`。
- 状态到文案 / 色调的唯一映射是 `components/admin/statusMeta.ts` 的 `STATUS_META`。
- 开发阶段不保留兼容层或并存实现；数据结构、权限和状态机只在上述事实源维护一份。
- 用户可见文案遵循 `docs/design/standards/copywriting.md`，接口与错误码遵循 `docs/api-contract.md` 与 `docs/error-copy.md`。

## 7. 环境踩坑

1. **Node ≥ 22.12**。SQLite 使用 Prisma 官方 `@prisma/adapter-better-sqlite3`；`@nestjs/config` 是纯 ESM 而项目为 CommonJS，依赖 Node 的 `require(esm)`。低于该版本会 `ERR_REQUIRE_ESM`。
2. **不要用 `nest start`**。安全守卫会拒绝清空 `dist`；使用 `npm run build` + `node dist/main.js`。
3. **端口固定后端 4100、前端 5100**。开发 / 测试 / 生产同端口；开发 / 测试启动时若占用则先停占用进程，不回退端口。
4. **CORS 默认只放行 `http://localhost:5100`**。`localhost` 与 `127.0.0.1` 是不同来源；排障先看启动日志的 `CORS origins:`。`CORS_ORIGINS` 给定时覆盖默认规则，`CORS_ALLOW_PRIVATE_LAN=1` 供手机调试。
5. **`/uploads` 必须同时出现在前端代理中**。漏掉时 Vite 会返回 SPA 的 `index.html`：HTTP 200、`Content-Type: text/html`，图片静默破图。生产 Nginx 同样代理 `/api` 与 `/uploads`。
6. **`test` / `production` 不回落 `.env` 与 `.env.local`**。避免继承 `DATABASE_URL=file:./dev.db` 造成无报错的数据污染。`env-files.ts` 与 `scripts/db-url.js` 的档位规则必须逐字一致。
7. **空串不等于未设置**。例如 `CORS_ORIGINS=""` 会跳过覆盖并静默失效；不要批量导出空值。
8. **`ConfigModule` 必须是 `AppModule.imports` 第一项**。顺序错误可能不立即报错，而是在运行期注入 `undefined`。
9. **新增环境变量同步四处**：`ENV_SPECS`、`backend/.env.example`、三档 env；影响库路径时再加 `scripts/db-url.js`。随后运行环境探针。
10. **嵌套依赖 pin 不可被“正常重装”覆盖**。关键是 `multer` 下的 `type-is@1.6.18` / `media-typer@0.3.0`；错误版本会让 multipart 静默不解析，接口收到 0 个文件。另有 `webpack` 的 `mime-types@2.1.35` 与 `@nestjs/config` 的 `dotenv@18.0.3`。依赖安装遇 5 分钟 broker 超时属已知环境限制。
11. **云存储 SDK 当前不是依赖**。默认使用 local；OSS / MinIO 的连接参数和凭据只在后台存储配置页维护，切云端前需安装 `ali-oss` 或 `minio`。
12. **普通账号与后台管理员是两套**。`seed` 普通账号永远没有 admin 角色；production 必须显式生成后台密码，重复 seed 不重置已有密码。

## 8. 工作纪律

- 用户明确说“跑 / 验证 / 检查”后才执行相应的 build、tsc 或 test；未授权时不自作主张跑闸口。
- 获授权后，先让目标用例或复现步骤呈红，再做最小修复，最后提供真实命令与输出证据；不以 checklist 自评替代运行结果。
- “改”只修复当前问题，“继续”只推进下一批；不借单字指令扩大改动范围。
- 不主动 commit、push 或 tag。用户明确要求才提交；提交信息与分支规则见 `docs/git-workflow.md`。
- 用户保留现有未提交改动。只修改任务相关文件，不清理或覆盖无关 diff。
- 交付使用中文、结论优先、精炼结构化；引用 `file:line` 与校验结果，不使用 emoji。

## 9. 文档指针

- Agent 协作入口：根 `AGENTS.md`（分工与交接）、开发流程四件套（`docs/development-workflow.md` / `agent-execution.md` / `quality-gates.md` / `git-workflow.md`）、`docs/README.md`（索引）。
- 需求与产品边界：`docs/prd.md`、`docs/admin-prd.md`、`docs/admin-*-design.md`。
- 环境、数据库、Docker 与部署：`docs/environments.md`、`docs/docker-deployment.md`。
- 模型、选路、失败语义与计费：`docs/model-architecture.md`。
- 接口、统一响应与错误码：`docs/api-contract.md`、`docs/error-copy.md`。
- 后台界面与页面规格：`docs/design/admin/admin-ui-design.md`、`docs/admin-console-design.md`、`docs/admin-detailed-design.md`。
- 商品、订单、支付、退款、积分与会员：`docs/commerce-design.md`。
- 测试闸口、覆盖矩阵与已知缺口：`docs/testing.md`。
- Agent 执行卡与阶段裁剪：`docs/development-workflow.md`。
- Agent 指令映射、禁令、自主边界与失败模式：`docs/agent-execution.md`。
- 闸口命令、证据标准与完成定义：`docs/quality-gates.md`。
- 分支、提交、PR、回滚与 git 权限边界：`docs/git-workflow.md`。
- 后端 NestJS 结构、DTO、异常、鉴权与事务：`docs/backend-nestjs-conventions.md`。
- 前端模块分层：`docs/design/standards/frontend-module-conventions.md`。
- 前端组件角色、Props 与状态契约：`docs/design/standards/frontend-component-language.md`。
- 文案、状态反馈、可访问性与代码风格：`docs/design/standards/copywriting.md`、`docs/design/standards/feedback-states.md`、`docs/design/standards/accessibility.md`、`docs/design/standards/code-style.md`。
- 设计令牌、字号与响应式：`docs/design/standards/design-tokens.md`、`docs/design/standards/typography.md`、`docs/design/standards/responsive-layout.md`。
- 安全、可观测性与发布：`docs/security.md`、`docs/observability.md`、`docs/release.md`。
- 其他文档的类别与放置规则：`docs/README.md`。
