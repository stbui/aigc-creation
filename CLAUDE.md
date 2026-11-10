# CLAUDE.md

本文件是 Claude Code 在本仓库的作业上下文。定位：**坐标 + 硬约束 + 踩坑**；实现细节指路到代码与 `docs/`，不在此复述。

**三句话记住这个仓库**：
1. 模型调用只有 `backend/src/model/**` 一条链路。
2. 能力清单只在 `capabilities/definitions/` 定义。
3. 后台组件只有 shadcn 一套，页面只从 `admin-ui/primitives` 取件。

## 先读这里

- **事实源优先级**：代码 > 现行文档（`docs/environments.md` / `model-architecture.md` / `api-contract.md` / `testing.md` / `prd.md`）。本文件的数量类描述若与代码不符，**以代码为准并顺手改这里**。
- **单一事实源**：下列内容只在一处定义，改动改源头，不要在别处复制一份。

| 内容 | 唯一事实源 |
| --- | --- |
| 能力清单 / 字段 / 默认积分价 | `backend/src/capabilities/definitions/<id>.ts`（由 `definitions/index.ts` 聚合） |
| 运行期生效积分价 | `CreditPriceService.resolve()`；业务代码**不读** `creditCost` |
| 权限点 | `backend/src/admin/permissions.ts` |
| 退款与站点设置默认值 | `backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` |
| 工单状态机 | `backend/src/tickets/tickets.service.ts` 的 `TRANSITIONS` |
| 协议与推荐模型 | `backend/plugins/<plugin>/manifest.json`；服务商目录见 `src/model/plugins/provider-catalog.service.ts` |
| 渠道 / 前台模型 / 价格档 | 数据库（后台「渠道工作台」「能力与模型」「用户分组」）—— 代码里没有默认线路表 |
| 账单状态机 | `backend/src/model/billing/billing.service.ts` 的 `BILLING_STATUSES` |
| 启动期环境变量 | `backend/src/config/env.validation.ts` 的 `ENV_SPECS` |
| 设计令牌 | `frontend/src/styles/global.css` 的 `:root`；shadcn 语义变量经 `frontend/src/styles/admin.css` 的 `@theme inline` 桥接，不另定义色值 |
| AIGC 角标默认样式 | `backend/src/common/aigc-label.config.ts` 的 `AIGC_LABEL_DEFAULTS`；运行期由后台「AI 标识」页覆盖 |
| 后台侧栏与页面分组 | `frontend/src/components/admin/adminNav.ts` 的 `ADMIN_MENU` |
| 接口清单 / 错误码 / 响应信封 | `docs/api-contract.md` |
| 测试清单与覆盖矩阵 | `docs/testing.md`；文档分类地图见 `docs/README.md` |

**数量口径（最易腐化，改代码后必须复核）**：本文件的数字以下表口径为准，与代码不符以代码为准并顺手改这里。

| 数字 | 事实源 | 易错排除项 |
| --- | --- | --- |
| 107 包 / 115 provider | `backend/plugins/*/manifest.json` 的 `contributes.providers` | 3 个 `src-*` 镜像目录由 `plugin-manifest.store.ts` 跳过（`src-a6api` / `src-antigravity-proxy` / `src-metaso-h3`），不计入可用包；含它们的目录总数是 110 / 119 |
| 18 能力 / 14 进工作台 / 17 image + 1 video | `definitions/index.ts` 的 `CAPABILITY_PLUGINS` | `*.spec.ts`、`*-options.ts`、`*.templates.ts` 同目录但不是能力定义 |
| 32 页 / 8 分组 | `adminNav.ts` 的 `ADMIN_MENU` | `AdminShell.tsx`、`dashboard/AdminDashboardContent.tsx`、`__tests__/` 不算菜单页 |
| 34 条壳内路由 | `App.tsx` 的 `Shell()` 内 `<Routes>` | catch-all 与另两组 `<Routes>`（3 条裸外壳页 / 6 条独立页）不计入 |

## 账号

- **后台管理员（development / test）**：`admin@admin.com` / `123456789`。
- **普通测试账号**：`test@admin.com`、`dev@admin.com`、`uat@admin.com`。
- **生产环境不设默认账号密码**：必须通过 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 或 `seed:admin` 生成并保存一次性密码。

## 开发要点

- **组件优先用 shadcn，禁止重复造轮子**：先查 `admin-ui/components/ui` 是否已有；缺的用 `shadcn add` 拉官方件（**拉完必须跑 `frontend/scripts/post-shadcn.mjs`** 改写 `cn` 引用）；官方确实没有、或改造成本明显高于收益才手写。手写件按用途落进 `admin-ui/primitives/layout|form|display|table|overlay|fields`，再从 `primitives/index.ts` 导出。
- 优先使用成熟开源库，不满足需求才考虑自研。
- 页面注释参照 JSDoc。
- 开发阶段不写兼容代码。
- 工业级代码，完整产品。
- 后台页面不做移动端、不做响应式设计。

## 项目概览

**货觉AI**（技术标识 `huojue`，仓库目录 `aigc-creation`）—— 面向电商团队与个人卖家的智能视觉创作平台。

当前形态 = **C 端创作站 + 独立后台管理端 + 商业运营域 + 账户合规/服务域**：

- **C 端创作站**：18 项能力（全部 `real`；17 image + 1 video；14 项进工作台）。**图像、文本、视频都只允许真实模型产出**：无模型线路即失败并退款，不交付伪结果。
- **生成通道**：唯一链路是 `src/model/**` —— 渠道 → 渠道模型 → 前台模型 revision/线路 → 路由/冷却 → 任务执行 → 账单。建任务必带 `logicalModelId`（来自 `GET /models`）；协议来自 `plugins/` 内置插件清单，代码里没有手写协议实现。旧三层（`src/providers/**`、`GATEWAY_*`、`ModelCallLog`、`/admin/model-config`）已整体删除，**不存在并存期**。
- **后台管理端**（`/admin`）：32 个页面、8 个侧栏分组，权限点 + 定时任务 + 备份 + 存储切换。
- **商业域**：商品 / 订单 / 支付 / 退款 / 积分账本 / 会员 / 优惠券 / 限时活动 / 邀请签到 / 发票 / 支付对账。
- **账户与合规域**：找回密码 / 短信登录 / 扫码登录 / 第三方登录（OAuth2 / OIDC）/ 自助注销与数据导出 / 法务版本化与同意留痕 / 站内消息 / AIGC 标识 / 限流 / 健康检查 / 请求追踪。
- **服务域**：工单、后台全局搜索、批量动作与 CSV 导入导出。

## 技术栈

| 层 | 技术 | 版本（全仓依赖精确锁定，无 `^` / `~`） |
| --- | --- | --- |
| 后端 | NestJS + Prisma + **自研 node:sqlite driver adapter** | 12.1.3 / 7.10.0 |
| 配置 | @nestjs/config（零依赖手写 validate） | 12.0.1 |
| 日志 | 自研 AppFileLogger（落盘 + 轮转 + 脱敏） | 无新增依赖 |
| 数据库 | SQLite（`backend/dev.db`），`node:sqlite` 内置模块 | 需 Node ≥ 22.12 |
| 图像 | Jimp（仅上传校验 / 尺寸探测 / AIGC 角标，不生成图片） | 1.6.1 |
| 鉴权/加密 | jsonwebtoken / bcryptjs | 9.0.3 / 3.0.3 |
| 前端 | Vite + React + lucide-react + react-router-dom | 8.3.4 / 19.3.0 / 1.57.0 / 7.18.4 |
| 前台 UI | `frontend/src/ui` 兼容层（页面只从该 barrel 取件），底层复用 `admin-ui/components/ui` 的 shadcn/radix 原子件 | 自持，antd 已移除 |
| 前端其他 | qrcode（邀请海报 / 扫码登录）/ @tanstack/react-table（后台表格）/ recharts（图表）/ Playwright（e2e） | 1.5.4 / 9.3.1 / 3.10.1 / 1.64.1 |
| 后台 UI | shadcn/ui 源码自持（`radix-ui` 底座，`new-york`）+ cva + `cn`（官方包）+ Tailwind v4 + tw-animate-css；CLI `shadcn` 只用于 `add` 拉件 | 自持 / 1.8.1 / 0.7.1 / 0.5.1 / 4.3.3 / 1.4.0 / 4.23.0 |
| 前端测试 | Vitest + jsdom + Testing Library | 5.0.5 / 30.1.3 / 16.3.3 |
| 后端测试 | Vitest + @nestjs/testing + supertest（node 环境） | 5.0.5 / 12.1.3 / 7.1.4 |
| 语言 | TypeScript | 后端 5.7.2 / 前端 7.0.2 |

**版本必须精确锁定**。本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，依赖实际是用 `curl` + `tar` 直装 registry 装出来的 —— 详见「环境注意事项」第 4 条。

TS 配置差异（勿统一）：后端 `strict: false` / `strictNullChecks: false` / CommonJS / ES2021；前端 `strict: true` / ESNext / bundler 解析 / `jsx: react-jsx`。

**云存储是可选依赖**：`STORAGE_BACKEND` 支持 `local`（默认）/ `oss` / `minio`，但 `ali-oss`、`minio` 两个 SDK **当前不在依赖里**，切云端前需先装包。

## 目录结构

```
aigc-creation/
├── start.sh                  # 一键启动（--env development|test|prod；处理端口占用/CORS/建表/种子）
├── README.md                 # 现状速查：页面结构 / 能力清单 / 启动 / 接口 / 环境坑
├── docs/                     # 需求 / 产品 / 技术 / 测试 / 规划五类，地图见 docs/README.md
│   ├── prd.md                # ★ 需求：整站产品需求、数据模型、非功能要求
│   ├── environments.md       # ★ 技术：三环境变量矩阵 / 加载优先级 / 生产门禁 / Docker / 排查
│   ├── model-architecture.md # ★ 技术：渠道/前台模型/路由/计费/代理 / 选路与失败语义 / 扩展 SOP
│   ├── api-contract.md       # ★ 技术：响应信封 / 错误码 / 接口清单 / 令牌时长
│   ├── runtime-infrastructure.md # ★ 技术：AIGC 标识 / 签名 URL / 限流 / 健康 / 追踪 / 日志
│   ├── testing.md            # ★ 测试：四层测试、闸口清单、覆盖矩阵、已知缺口
│   ├── development-workflow.md # ★ Agent 执行手册：执行卡 / 闸口命令 / 证据标准 / 交人边界
│   ├── admin-*.md            # 需求 + 产品：后台 PRD / 总体 / 功能 / 详细 / 界面
│   ├── commerce-design.md    # 产品：支付 / 积分 / 订单 / 商品 / 会员 / 营销
│   ├── <页面>-design.md      # 产品：C 端页面规格（landing / workbench / topnav / login / library / packages）
│   ├── channel-model-design.md / payment-refactor-design.md # 设计记录（已实施 / 部分实施）
│   └── agent-*.md            # 规划：AI 智能体需求与集成方案（未实施）
├── docker-compose.yml        # 本地编排：默认=dev，--profile test=test（不同卷、不同库）
├── docker-compose.production.yml # 生产单机编排：migrate 门禁 / 健康探针 / 持久卷 / 仅本机监听
├── extension/                # Chrome MV3 扩展：电商页图片一键采集到素材库（README 为唯一说明）
├── backend/                  # NestJS 服务，端口 4100（测试档同端口），全局前缀 /api/v1
│   ├── prisma/schema.prisma  # SQLite provider；无 enum，状态类字段一律 String + DTO 白名单
│   ├── prisma.config.ts      # Prisma 7 连接配置（datasource url 移出 schema；按 NODE_ENV 选档）
│   ├── Dockerfile            # 三阶段镜像（node:24-slim；deps → build → prod）
│   ├── scripts/              # seed* / smoke* / verify* / db-url
│   ├── vitest.config.mts     # 后端 Vitest（node 环境；src 下 *.spec.ts）
│   ├── tsconfig.spec.json    # 测试专用类型检查（不参与 nest build）
│   ├── .env.development / .env.test / .env.production.example  # 三档 env（前两份入库）
│   ├── .env.example          # 环境变量总清单（唯一事实源在 src/config/env.validation.ts）
│   └── src/
│       ├── main.ts           # 前缀/CORS/静态资源/ValidationPipe/拦截器/异常过滤/PORT/HOST
│       ├── config/           # ConfigModule + env-files.ts（三环境档位）+ env.validation.ts
│       ├── common/           # guards / 限流 / 签名 URL / AIGC 标识 / 请求追踪 / 日志
│       │                     # filters / AppError / csv / batch / test-support
│       ├── capabilities/     # registry 门面 + definitions/<id>.ts（能力唯一事实源）
│       ├── model/            # 模型层唯一实现：channels / catalog / routing / intent / protocol
│       │                     # tasks / billing / user-groups / plugins / proxy / media
│       ├── generate/         # 建任务入口（controller + DTO）+ 任务查询，实现落在 model/tasks
│       ├── admin/            # 后台：guards / 权限点 / 调度 / 备份 / 各管理 controller
│       ├── payments/         # 支付三层：沙箱 / 支付宝 RSA2 / 微信 v3 + 回调
│       ├── account/ legal/ aigc-label/ notifications/ channels/ health/
│       │                     # ↑ channels 是通知出口（sms / email），不是模型渠道
│       ├── auth/ projects/ assets/ stats/ storage/ invoices/ prompt-tools/ mobile-upload/
│       └── credits/ orders/ membership/ marketing/ products/
└── frontend/                 # Vite SPA，端口 5100（测试档同端口）
    ├── Dockerfile            # 三阶段：deps → build(--mode production) → nginx
    ├── nginx.conf.template   # SPA 回退 + /api 反代 + /uploads 直出（envsubst 模板）
    ├── .env.development / .env.test / .env.production.example
    └── src/
        ├── App.tsx           # 34 条壳内路由（两组别名：/asset-library→/library、/my-works→/works）+ 3 条裸外壳页 + 6 条独立页 + /admin/* 子应用
        ├── admin-ui/         # 后台 UI：components/ui（shadcn 原子件）· primitives（页面唯一取用层）· shell · providers · hooks · lib
        ├── components/       # AppLayout / SideRail / ToolShell / QrLoginPanel / admin/（adminNav + AlertCenter + DutyContext + statusMeta）
        ├── pages/            # 15 个单文件页面（登录 / 工作台 / 订单 / 工单 / 工具页 / 法务 …）
        │   ├── admin/        # 后台 32 页：按域目录组织，含 AdminDashboardPage.tsx
        │   └── <域>/          # 21 个 C 端域目录，按 index / page / components / api / hooks / utils / constants 分层
        │                     #   product-kit / shoppable-carousel / product-detail / viral-clone / library / account …
        ├── lib/              # api.ts（request 拆信封）/ http / auth / capabilities / aigc-label / money / poll / zip
        ├── context/          # AuthContext / AdminContext（权限点）/ CreditsContext
        ├── hooks/            # useToolTask / useProject / useCapabilities / usePollAbort / 上传相关
        └── styles/           # global.css（设计令牌 + 全站规则）+ admin.css（后台 Tailwind 入口 + shadcn 语义桥接）
```

`backend/uploads`（UPLOAD_DIR）、`backend/logs`（LOG_DIR）、`backend/backups`（BACKUP_DIR）均为运行期产物，不入库。

## 常用命令

```bash
# 启动（推荐；端口固定 4100/5100，占用即停掉占用进程再起）
./start.sh                  # 开发；--env test | --env prod 切换档位（两档端口相同，不能并行）
                            # 可选 --build / --skip-db / --with-thumbs / --install
                            #      --backend-only / --frontend-only / --no-follow
                            #      --daemon（PID 记 .run/start.pids）/ --stop（只停）

# 工程门禁（根目录；Node 版本 + 依赖审计 + 构建 + 后端/前端/agent 单测 + 仿真网关）
npm run check

# 后端
cd backend && npm run build && node dist/main.js   # 不要用 nest start（会拒绝清空 dist）
npm run prisma:push         # 建表（首次或 schema 变更后）
npm run db:reset:test       # ★ 删测试库+测试目录 → 重建 → 重灌种子（带安全门禁）
npm run seed                # 需 SEED_USER_EMAIL；未设置则什么都不建
npm run seed:admin          # 后台管理员（dev/test 预设 admin@admin.com / 123456789；生产随机密码）
npm test                    # 先 tsc -p tsconfig.spec.json，再 Vitest（node，无需起服务）
npm run test:typecheck      # 只做 spec 类型检查
npm run test:watch          # 后端 watch
npm run test:coverage       # 后端覆盖率（v8）

# 前端
cd frontend
npm run dev                 # vite --mode development（5100）
npm run build:prod          # tsc --noEmit && vite build --mode production
npm run typecheck           # tsc --noEmit
npm test                    # Vitest（jsdom，无需起服务）
npm run e2e                 # Playwright
```

- **种子与冒烟都连当前 `NODE_ENV` 对应的库**（`scripts/db-url.js`）：在测试档跑必须先 `NODE_ENV=test`，否则写的是开发库。
- **后端单测/集成约定**：`backend/src/**/*.spec.ts`，Vitest node 环境。纯函数与可 mock 的 service 逻辑直接测；需要真实 SQLite 的 HTTP 集成用 `@nestjs/testing` + `supertest` + 临时库（参考 `payments.integration.spec.ts`），不碰 dev.db/test.db、不依赖已启动服务。真实渠道与部署级链路仍走 `scripts/verify-*` / `smoke-*`，两者不互相替代。
- 根目录 `npm test` 依次跑 `test:backend` / `test:frontend` / `test:agent` / `test:gateway`；只跑后端用 `npm --prefix backend test`。
- 冒烟 / verify 脚本按域分组，完整清单与执行前置见 `docs/testing.md`；依赖一致性审计用 `npm run verify:deps:critical`。
- 环境体系自检：`cd backend && npx ts-node -T scripts/probe-environments.ts`。
- Docker 与生产编排见 `docs/docker-deployment.md`；其余命令见 `docs/environments.md`。

## 架构要点

### 能力清单：插件化单一事实源

能力清单**只在 `backend/src/capabilities/definitions/<id>.ts` 定义**，由 `definitions/index.ts` 聚合，经 `capability.registry.ts` 门面导出，再通过 `GET /api/v1/capabilities` 下发给前端。侧栏、卡片、表单、统计分布全部由这份数据渲染 —— **新增能力不需要改前端**。

新增一项能力只需两步：新建 `<id>.ts` 导出 `CapabilityPlugin`，再在 `CAPABILITY_PLUGINS` 数组里加一项。装配期由 `assertCapabilityIntegrity` 校验，漏声明即启动失败。

关键字段：`id / name / group / summary / sidebarHint / badge / mode / modality / model / buildPrompt / outputPlan / creditCost / inputs(0|1|2) / inWorkbench / help / params[]`。**不存在 `localImpl` / `localFallback`**。

**一次提交出 N 张 → 声明 `outputPlan`，由准入层拆任务**：不声明 = 一次生成一张。声明后 `model/tasks/task-admission.service.ts` 按返回值把一次提交拆成 N 个独立任务，**每张各建一张账单、各扣一份 `creditCost`**，失败 / 取消各自按账单退款，共享 `batchId / batchIndex / batchSize`，前端按批次聚合成「一次生成」。当前 `detail_image`（按勾选模块数）与 `shoppable_carousel`（按张数 6–10）用到。一个任务只调一次上游、产不出不同版式 —— 要多样版式必须拆任务，不要试图用提示词拼多图。

- `mode`（实现程度）：`real` 已接真实模型；`mock` / `planned` 保留枚举但当前 0 项。
- `modality`（产出介质），与 `mode` 正交：当前 **17 项 `image` + 1 项 `video`**（合计 18）；`text` 用于提示词工具等非能力项。
- 新任务 `status` 初值 `queued`；单次实际线路以任务快照的 `routeId` / `channelModelId` 为准。
- 新增能力时按实际实现程度声明 `mode`：未实现写 `planned`，不得补本地占位或伪模型结果。

### 能力运行时真相（`runtime`）

`GET /capabilities` 每项追加 `runtime: { enabled, remoteAvailable, effective, reason }`：

| `effective` | 含义 |
| --- | --- |
| `remote` | 有可用模型线路，按下去走真实模型 |
| `disabled` | 后台已下线（`CapabilityControl.enabled=false`） |
| `unavailable` | 该能力没有配到任何可用的前台模型 / 线路：不可提交 |

- 由 `capability-availability.service.ts` 合成，3s 缓存，后台写入即 `invalidate()`；**没有 `CapabilityControl` 行 = 启用**。
- 下架原因由后台按统一下线提示自动生成并原样下发 C 端（不再要求人工填写）；`generate.service` 在**扣费之前**拦截并返回 `40005`。
- 界面标注看 `effective`，不看 `mode`；`effective` 是事前预期，实际失败不回落本地产出。
- **积分价**运行时一律走 `CreditPriceService.resolve()`（后台可改）；**限时免费**命中进行中的 `Campaign(type='limited_free')` 时直接返回 0，优先级高于后台覆盖价，缓存 3s 到点自动恢复。

### 生成通道：渠道 → 前台模型 → 路由 → 账单

> 完整分层、请求时序、选路规则、失败语义、计费口径见 **`docs/model-architecture.md`**；
> 设计动机见 `docs/channel-model-design.md`。本节只留必须记住的约束。

**四张表就是四个事实源**：`ModelChannel`（渠道，凭证加密）→ `ChannelModel` + `ChannelModelPriceTier`（供应侧线路 + 模型价格档）→ `LogicalModel` + `LogicalModelRevision` + `LogicalModelRoute`（C 端可见身份 + 发布快照 + 线路）。**代码里没有任何内置线路**，零配置 = 能力 `unavailable`。

**命名空间必须分清**：`ChannelModel.capability` 是供应侧模态（`image/text/video/audio`）；`LogicalModel.capability` 是 C 端能力 id（`free_create` / `expand` / …）。混用表现为「有这个能力的模型，但模型不可用」。

**渠道模型 `protocol` 存的是插件声明里的 provider id，不是插件 id**。`plugins/openai-images/manifest.json` 声明 `providers[0].id = "openai-image"`，渠道模型必须写 `openai-image`；写成 `openai-images` 派发时报 `channel_unavailable`（「协议尚未注册执行器」）。后台下拉读注册表，正常操作不会踩到 —— 手写库或导入时会。

**任务状态与错误码**：`queued / running / succeeded / failed / cancelled`（`pending` 废止）；`42201` 生成失败 / `42202` 中断 / `42203` 标识失败 / `42204` 无可用线路 / `42205` 遮罩无 edits 线路 / `42206` **结果不明**。

### 选路与失败语义

选路（`router.service.ts`）：产品能力合同匹配 → 候选池过滤（启用 / 权重 > 0 / 本轮未试 / 未冷却 / 分组可见 / `channel` 策略须命中价格档）→ **只保留最高 `priority` 一层** → 同层按 `weight` 加权随机（crypto + 拒绝采样）。选出来的 `RoutedModel` 一次带给任务快照、账单、调用日志，**下游任何一层都不许替换供应侧字段**。

**切线只发生在 `rejected_no_job`**（请求没发出去 / DNS、代理、网络不可达、TCP 连接被拒 / 401 / 403 / 404 / 429）。建连前网络失败可安全换线；全部线路都失败时落 `42204` 并自动退款。超时、5xx、**建连后中断**一律判 **结果不明**（`42206`）：不切线、不自动退款，账单停 `uncertain` 等人工核对 —— 上游可能已经把图生成了，切线会二次计费、自动退款会白送一次产出。`ECONNREFUSED` 等建连前 errno 永远不能落 `42206`。

**冷却只对明确可归因的失败生效**：401/403 冷却渠道 10min，404 冷却该渠道模型 10min，429 冷却 `Retry-After` 或 30s；建连前网络失败可以换线但不写冷却；**超时、5xx 与建连后中断永不冷却**（上游抖动时关 10 分钟会把一次偶发故障放大成整段不可用）。冷却存进程内存，多实例各自判定。

**切线必须换账单**：新线路的价格档可能不同，沿用旧账单等于「按 A 的价收、走 B 的线路」。

### 目录快照与例外

`route-catalog.service.ts` 是唯一读供给的入口：TTL 30s，库短暂不可用时沿用旧快照最多 5min，首次装载失败直接报错（**不把空目录当「全部不可用」**）。本进程写入后 `invalidateLocal()`，多进程最多滞后一个 TTL。排障第一条：**改完模型层不看快照就等于没改**。

**格式按字节魔数判定，不看 URL 后缀**（`src/model/media/image-format.ts`）：多家返回的链接无扩展名，猜错会把 PNG 字节以 `image/jpeg` 入库。

**文本工具**（提示词润色 / 图文互转）不走任务与账单，但走同一条真实链路：无可用线路或全部失败抛 `50201`（HTTP 502），**不拼接模板文案**；每次尝试写一条 `ApiCallLog`（`source='tool'`、`billable=false`）。

### 计费与钱包

- **建任务 + 建单 + 预留同一事务**：先建任务后预留失败会留下永远不结算的账单与「排队但无账单」的任务。扣费在**建任务时**，任务快照 `creditCost` 与账单金额同源。
- 已结算账单不许自动退款、已退款账单不许再结算。**`uncertain` 只能人工 `settle` / `refund`**，必须填原因。
- Token 结算以上游 usage 为准；上游没给用量时，视频按提交时的公式快照，其余显式失败转人工 —— **绝不按预授权金额静默结清**。
- `CreditAccount.available == Σ CreditLot.remaining` 恒成立；退款按 `CreditReservationItem` **原路**退回原批次（保留原到期时间），不造新批次。
- 用户分组倍率与货币换算在同一处折算，**目录展示价与账单必须用同一组因子**。

### 配置层 + 三环境体系

`ConfigModule` 是 `AppModule.imports` 的**第一项**（`isGlobal`；顺序错不会立刻报错，只会运行期注入到 undefined）。校验用**零依赖手写** `validateEnv`（`src/config/env.validation.ts`），三条硬约束：

1. **绝不改写 `process.env`**，只产出配置树（直接读 `process.env.X` 的存量代码行为 1:1 未变）。
2. **类型错误即启动失败**（`PORT=abc` 直接抛 `EnvValidationError` 并指名变量，不再静默绑随机端口）。
3. **默认值逐项抄自现有硬编码兜底值**，不擅自改默认行为。

`ENV_SPECS` 是启动期校验变量的唯一事实源。模型层的 `MODEL_*`（密钥 / 插件目录 / 并发 / 超时 / 租约 / 私网上游 / 代理）全部经由它校验，**没有 `GATEWAY_*`**。

**三环境（开发 / 测试 / 生产）完整说明见 `docs/environments.md`**，只列必须记住的：

- 档位逻辑在 `src/config/env-files.ts`（Nest 侧）与 `scripts/db-url.js`（脚本侧，**必须逐字一致**，否则出现「Nest 连 test.db、seed 往 dev.db 塞数据」）。
- **`test` / `production` 刻意不回落 `.env` 与 `.env.local`**：共享 `.env` 的 `DATABASE_URL=file:./dev.db` 一旦被继承，隔离形同虚设且**无任何报错**。
- **空串 ≠ 未设置**：`CORS_ORIGINS=""` 会让 `loadEnvFiles` 跳过覆盖，值静默失效。按需注入，别无脑导出空串。
- `production` 的**拒绝启动**门禁（非告警）：`JWT_SECRET` 未设置、`DATABASE_URL` 仍是开发默认值。
- 启动日志第一屏回显环境名 / 库路径 / 上传目录 ——「以为在测、实际连着开发库」是这套体系最需要防的乌龙。
- **新增环境变量**同步四处：`ENV_SPECS`、`.env.example`、三档 env、`scripts/db-url.js`（仅影响库路径时）。

### 后台管理端（`/admin`）

独立外壳（`AdminShell` 鉴权链 + `admin-ui/shell/AdminBoardLayout`），与 C 端 `AppLayout` 完全分离：C 端侧栏/顶导/促销条都是消费级语义，不能复用。

**权限链**：`AdminGuard`（身份）→ `PermissionGuard`（权限点）→ controller。权限点定义在 `src/admin/permissions.ts`。**前端 `AdminContext.can()` 只用于隐藏无权限按钮，不是安全边界**；真正的校验必须在后端。

32 个页面、8 个侧栏分组以 `adminNav.ts` 的 `ADMIN_MENU` 为准；页面功能、接口与交互见 `docs/admin-console-design.md` / `admin-detailed-design.md`。

- 退款、手动调整积分、权限与系统设置、调价等确有业务依据要求的动作需填写原因；删除渠道 / 渠道模型只保留业务影响确认，不要求原因。
- 批量动作：`ids ≤ 100`，`runBatch` 串行、**不包事务**，逐条返回结果；路由挂较弱读权限，处理器内再判动作权限。
- CSV 统一走 `common/csv.ts`（BOM + RFC4180 + 公式注入前导 `'`）；前端 `downloadCsv()` 不走 JSON 信封。
- **后台组件是一套 shadcn**（2026-11-02 推倒重建：旧组件套件 / kit / 转发层全部删除，无并存、无开关、无回滚）。
  - **底座是 radix（`radix-ui` 统一包 1.8.1），官方 `new-york` 风格**。`frontend/components.json` 决定底座与别名：`style: "new-york"`、`ui → ~/admin-ui/components/ui`、`utils → ~/admin-ui/lib/cn`。`shadcn add` 会连同底座一起装；**不要引回 `@base-ui/react`**。
  - 组合写法是 radix 的 `asChild`（不是 Base UI 的 `render={<button/>}`）。Base UI 专属的 `indeterminate: boolean` / TooltipProvider `delay` / 无 `PopoverAnchor` 等差异已不适用。
  - **类名合并只走 `admin-ui/lib/cn.ts`**：实现是官方 npm 包 `cn` 的 `createCn`，在默认合并表上补登本项目 `@theme` 自造 token（`shadow-card`、`brand` / `success-*` / `warn-*` / `danger-*` 颜色组）。改 `styles/admin.css` 的 `@theme inline` 时必须同步补登，否则 `shadow-none` 盖不掉 `shadow-card`。`shadcn add` 之后必须跑 `scripts/post-shadcn.mjs`，它统一把组件的 `import { cn } from 'cn'` 改写成本文件。
  - **页面只从 `admin-ui/primitives` 取件**（barrel：`primitives/index.ts`），不直连 `components/ui`。原子件（`components/ui/*` 只被 primitives 引用）。
  - **没有转发层**：`admin-ui/shadcn`、`admin-ui/controls`、`admin-ui/widgets`、`admin-ui/primitives/DataTable|Dialog`、`components/admin/PageHeader|AdminWidgets` 均已删除。新增控件按用途落进 `primitives/layout|form|display|table|overlay|fields`，再从 barrel 导出。
  - 颜色仍只在一处定义：`styles/global.css` 的 `:root` 是令牌源，`styles/admin.css` 的 `@theme inline` 把 shadcn 语义变量（`--background` / `--primary` / `--ring` …）桥接到那些令牌；改品牌色不改 shadcn 侧。页面只写 shadcn 类（`bg-card` / `text-muted-foreground` / `border-border` / `bg-accent` / `text-brand` / `bg-warn-soft`），旧套件那套 `text-text-tertiary` / `border-border-table` 词汇已随 vendor 一并删除。
  - Tailwind 只引 `theme.css` + `utilities.css`，**没有 preflight**：裸 `border` 会退回 `currentColor`，故兜底写在 `styles/admin.css` 的 `@layer base`（unlayered 规则会压过所有 `@layer`，`border-transparent` 就失效）。
  - 高危动作确认：页面内用 `ConfirmDialog`（shadcn `AlertDialog` 的组合壳，阻塞式弹窗）；需要跨页面复用的二次确认走 `useConfirm()`（`providers/ConfirmProvider`，shadcn Dialog）。
- **外壳**：`admin-ui/shell/AdminBoardLayout` —— shadcn `Sidebar` 组合：全高侧栏 232（折叠 60，≤1280 自动折叠；品牌头 + 分组导航 + 底部账号菜单）+ 内容区（56px 顶栏：折叠开关 + 分组 / 页面面包屑 + 告警铃铛 / 环境标识）。导航区自身滚动，内容区独立滚动；无值班带。值班塔只出现在概览首屏（`primitives/duty-strip` 与 `duty-tower`）。`.adm-*` 只剩外壳骨架三个类（`adm-layout` / `adm-content` / `adm-skip-link`），规则在 **`styles/admin.css`** 的 `@layer base`（不再在 `global.css`）；值班塔改用 Tailwind 工具类，没有 `adm-tower*` / `adm-dot` / `adm-empty-inline` 了。页面内新增 `adm-*` 类是错的。
- **共享件**：表格 `primitives/table`（密度走 `admin-ui/lib/density` 的 `DensityContext`，由外壳下发）；状态色 `components/admin/statusMeta.ts`（`STATUS_META` 是状态→文案/色调的唯一映射）。
- **e2e 锚点**：共享控件与页面关键节点挂 `data-testid="admin-*"`，表单控件用 `aria-label`；测试一律 `getByTestId` / `getByLabel` / 角色名，不追 Tailwind 工具类与已删除的 `adm-*` 类。

### 商业域

积分 / 会员 / 订单 / 营销的完整设计见 `docs/commerce-design.md`。四条不可违背的规则：

1. 积分按 **FEFO** 跨批次扣减，余额唯一由批次汇总推导；生成任务在**创建时**扣费并快照 `task.creditCost`，失败/取消按快照**原额退还**。
2. 退款**先校验、再落 `Refund(status='processing')`、再调渠道、成功才动本地账**；渠道失败 `50302` 且订单与积分不变。**绝不允许「只改库、假装退过钱」**。
3. 退款校验顺序不可反：先硬约束「金额 ≤ 实付 - 已退」（40001），再走可配规则（`refund.windowDays` / `maxRatioBps` / `allowConsumedTask` → 409）。
4. 对账处置**只改状态与备注，不改钱**；发票金额取 `paidCents - refundedCents` 快照。

### 其他模块要点

- **账户自助**：`/me` 只认令牌身份；改密后 `tokenVersion + 1`，该账号全部旧 token 立即失效。注销实现（`account-lifecycle.service.ts`）后台与 C 端共用同一份：清除作品/素材/项目/积分批次，保留订单/支付/退款/发票/流水并匿名化。
- **法务**：四类固定 slug（`LEGAL_SLUGS`）按 `(slug, version)` 版本化；**已发布版本不可原地覆盖**，改文本须升版本。
- **扫码登录**：票据只存 SHA-256、扫码 ≠ 授权、兑换一次性；手机端确认前展示发起端 IP + UA。
- **第三方登录**：`accessToken` 不进 URL，只下发 60 秒票据；只有 `emailVerified` 的邮箱才自动绑定已有账号；`returnTo` 只接受站内绝对路径。
- **站内消息**：`notify()` **永不抛异常**，模板缺失回落内置文案；已接支付成功、任务失败退款、会员到期、工单回复。
- **工单**：状态机只在 `TRANSITIONS` 定义，**新增状态必须同时补边**；越权一律 **404 而非 403**。
- **提示词工具**：走 text 模态渠道模型，无可用线路或全部失败返回 502（`50201`），**不拼接模板文案**。

### 前端路由与接口

- 完整路由表即 `frontend/src/App.tsx`；页面清单见 `README.md`「页面结构」，后端接口见 `docs/api-contract.md`。
- **`/admin/*` 必须注册在 catch-all 之前**，否则会被吞进 C 端 Shell；未匹配落 `NotFoundPage`（`path="*"`）。
- **C 端路由对外开放**：未登录可浏览，需要身份的动作唤起登录弹窗，`/login` 仅作深链接兜底。
- 前端 `VITE_API_BASE` **默认留空**走同源：开发态 Vite 代理 `/api` 与 `/uploads`，生产态 Nginx 反代。跨域部署才填绝对地址，且后端 `CORS_ORIGINS` 必须包含它。

## 开发约定

### 常见改动：从哪下手

| 要做什么 | 必改的文件 | 同步/校验 |
| --- | --- | --- |
| 新增一项能力 | `capabilities/definitions/<id>.ts` + `definitions/index.ts` | 启动期 `assertCapabilityIntegrity`；`verify-capability-bootstrap`。之后还要在后台配前台模型，否则 `runtime.effective = unavailable` |
| 一次提交要多张产出 | 在 `definitions/<id>.ts` 声明 `outputPlan` | 准入层按返回值拆任务、每张各扣一份 `creditCost`，共享 `batchId` 供前端聚合；不要靠提示词拼多图 |
| 接入一家厂商 | 新增 `backend/plugins/<plugin>/manifest.json`（或后台上传安装） | `verify-plugin-manifests` / `verify-protocol-runtime`；协议下拉按能力过滤自动可见 |
| 新增后台页 | `admin/permissions.ts` → controller 挂 `@RequirePermission` → `adminNav.ts` → `pages/admin/<域>/` → 路由 → `lib/api.ts` | 前端 `can()` 只隐藏按钮，权限必须在后端 |
| 新增 / 复用 UI 组件 | 先查 `admin-ui/components/ui`；缺的 `shadcn add` 后跑 `scripts/post-shadcn.mjs`；官方没有才手写进 `admin-ui/primitives/*` | 页面只从 `primitives` barrel 取件；禁止重复实现已有控件 |
| 拆分 / 新增后台功能目录 | `pages/<域>/` 下按 `index` / `page` / `components` / `api` / `hooks` / `utils` / `constants` 分层，目录内只从入口文件取外部依赖 | `docs/frontend-module-conventions.md`；`admin-modules.test.ts` 具名导入对账 |
| 新增环境变量 | `ENV_SPECS` + `.env.example` + 三档 env | `probe-environments.ts`；`docs/environments.md` |
| 调整积分价 / 退款规则 | `definitions/<id>.ts` 的 `creditCost` / `common/setting-defs.ts` 的 `SETTING_DEFS` | 运行时走 `resolve()` 与设置读取，不写死 |

### 样式：语义化 token，禁止硬编码色值

全站样式在 `frontend/src/styles/global.css` 的 `:root` 定义令牌（单一浅色主题，当前**没有**暗色块），页面**一律引用 `var(--token)`，不写裸 hex**：

```
品牌紫（唯一主色 #5546d8）  --brand / --brand-light（仅渐变浅端）/ --brand-hover / --brand-bg
中性色（单一冷灰族）        --text-strong #171a2b / --text-body #4e5969 / --text-muted #667085
                            --text-desc = --text-muted（同值别名）/ --border #e5e7ef / --surface #f2f4f7
圆角（只用这 5 档 + 胶囊）  --radius-tag 4 / --radius-control 8 / --radius-card 12
                            --radius-panel 16 / --radius-hero 24 / --radius-pill 999
```

**色值冲突的真实 bug 警示**：`--color-primary` 曾是蓝色 `#2563eb`，与紫系页面混用导致 hover 时蓝紫跳变，现已归位为品牌紫。新增颜色前先查是否已有语义合适的 token；确需新增则定义 token 并全站替换，不留同义簇。

**最小字号 12px（全站硬规范）**：任何页面、组件、图表刻度与内联样式都不得出现小于 12px 的文字 —— Tailwind `text-[10px]` / `text-[11px]`、CSS `font-size: 11px`、内联 `fontSize: 10` 一律禁止。字号规格见 `docs/typography.md`。

**设计一致性优先**：品牌紫 `#5546D8`、冷灰中性色族、五档圆角优先于任何单页的局部数值。判断「某页与其它页不一致」时先按全站令牌校准；页面规格文档与 `global.css` 冲突时以 `global.css` 为准。

### 仓库约定

- 根目录有 `.git`，远端 `origin` 指向 `github.com/stbui/aigc-creation`；`main` 是集成分支，功能与修复从 `main` 切 `feat/*` / `fix/*` 分支、走 PR、CI 绿后合并。**默认不要代为 commit / push / tag**；用户当轮明确说「提交」/「推送」时才执行，提交权在仓库所有者。
- 提交信息按 Conventional Commits：`<type>(<scope>): <中文 subject>`，body 写取舍理由；分支、PR、合并与回滚规则见 `docs/development-workflow.md` §9。
- `README.md` **只写现状**：页面结构、能力清单、目录树、启动方式、环境坑。不追加逐轮改动与验证记录；闸口清单与已知缺口维护在 `docs/testing.md`。与代码冲突时以代码为准并顺手改 README。

## 环境注意事项（踩坑，务必遵守）

1. **开发档后端固定 4100**（全局前缀 `/api/v1`），前端固定 5100。
   - 端口被其它进程占用时直接 `node dist/main.js` 会 `EADDRINUSE`；若占用者不是本项目，前端登录会**静默 404**（对方返回自己的响应格式，不报错）。
   - 正确做法：`./start.sh`（占用即停掉占用进程再起，不回退端口）。生产档不自动杀进程，需人工确认。
2. **不要用 `nest start`** —— 会触发安全守卫拒绝清空 `dist`。用 `npm run build` + `node dist/main.js`。
3. **CORS 默认只放行 5100**，前端必须用 5100（三档同一端口）。
   - `CORS_ORIGINS` 逗号分隔白名单，**给定时覆盖其余规则**；`CORS_ALLOW_PRIVATE_LAN=1` 放行私有网段任意端口（手机调试）。
   - 排错：先看后端启动日志 `CORS origins: ...`，再核对浏览器地址栏。**`localhost` 与 `127.0.0.1` 在 CORS 判定上是不同来源**。
4. **依赖安装会超时**。本机 npm 走 broker 代理，大批量安装触发 5 分钟硬超时，历史上用 `curl` + `tar` 直装 registry。因此 `node_modules` 里的**嵌套副本无法由 npm 自动重现**：
   - `multer/node_modules/type-is@1.6.18` + 其下 `media-typer@0.3.0`
   - `webpack/node_modules/mime-types@2.1.35`
   - `@nestjs/config/node_modules/dotenv@18.0.3`

   其中 `media-typer` 最关键：**错版会让 multer 静默不解析 multipart**（不报错，只是收不到文件）。新增依赖后重跑 `npm run verify:deps:critical`。工具维护 `ACCEPTED_PINS`（刻意的 pin 偏差）与 `KNOWN_BENIGN`（已验证无害的偏差簇）两份清单。

   `@nestjs/config` 那项的原因：它精确 pin `dotenv@18.0.3`，而顶层 `dotenv@17.4.2` 属 prisma / `@prisma/config`，两者不能共用。
5. **Node ≥ 22.12**（`node:sqlite` 可用，且满足下面 `require(esm)` 的要求）。
6. **`@nestjs/config` 是纯 ESM，本项目是 CommonJS**。靠 Node ≥ 22.12 的 `require(esm)` 工作；若下探到 < 22.12 会 `ERR_REQUIRE_ESM`，只能升 Node 或退回 `@nestjs/config@4.x`（需手工处理 peer 冲突）。
7. **`/uploads` 必须在前端代理里**。不代理时 Vite 会把它当 SPA 路由返回 `index.html` —— **HTTP 200 但 Content-Type 是 text/html**，图片静默破图，极易误判成「上传失败」。`vite.config.ts` 已同时代理 `/api` 与 `/uploads`。
8. **普通账号与后台管理员是两套**。普通账号由 `npm run seed` + `SEED_USER_EMAIL` 决定，**永远不给 admin 角色**；后台账号在 development / test 使用固定预设 `admin@admin.com / 123456789`，production 必须显式提供 `ADMIN_PASSWORD` 或使用 seed 生成的一次性随机密码。重复执行不重置已有账号密码。

## 工作纪律

- **不要代为 commit**。用户保留提交权；只在明确要求时提交。
- **不要运行 `tsc` / `build` 自测**（除非用户明确要求）。用户自验；AI 跑闸口不得擅自改码。
- 交付时给**精炼结构化摘要**：file:line 引用 + 校验结果，结论优先。中文输出，禁用 emoji。
- 代码与文档冲突时，**以实际代码为权威源**，文档散文次之。
- 验证铁律：**先跑红再最小修订**，要求真实运行证据（node / tsc / 浏览器实际执行），不信 checklist 自评。
- 「跑」= 执行闸口/build/test，「改」= 修复，「继续」= 推进下一批；不要用单字指令的实际动作去猜测扩大改动范围。

## 文档索引

文档分五类（需求 / 产品 / 技术 / 测试 / 规划；下表「流程」在 `docs/README.md` 归技术类），**分类地图与命名放置规范见 `docs/README.md`**。标记：**现行** = 与代码同步维护；**规划** = 未实施，不得写成现状。

| 类别 | 文档 |
| --- | --- |
| 需求 | `prd.md`（整站）、`admin-prd.md`（后台） |
| 产品 | 后台：`admin-suite-design.md` / `admin-console-design.md` / `admin-detailed-design.md` / `admin-ui-design.md`；商业：`commerce-design.md`；C 端：`landing` / `workbench` / `topnav` / `login` / `library` / `packages-design.md`；`shoppable-carousel-design.md`（+ 模板来源 `shoppable-carousel-template-sources.md`）；品牌：`brand/brand-basics.md` |
| 技术 | `environments.md`、`docker-deployment.md`、`model-architecture.md`、`api-contract.md`、`runtime-infrastructure.md`、`frontend-module-conventions.md`、`typography.md` |
| 测试 | `docs/testing.md`（四层测试、闸口清单、覆盖矩阵、已知缺口） |
| 流程 | `docs/development-workflow.md`（Agent 执行手册：指令映射、执行卡、闸口矩阵、证据标准、交人边界） |
| 规划 / 设计记录 | `agent-prd.md`、`agent-integration-design.md`、`canvas-port-design.md`（规划）；`admin-workflow-design.md`（P0 已实施）、`channel-model-design.md`（已实施）、`payment-refactor-design.md`（部分实施） |
