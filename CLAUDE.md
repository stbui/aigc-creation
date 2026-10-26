# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库工作时提供上下文。

## 先读这里

- **章节结构**：项目概览 → 技术栈 → 目录结构 → 常用命令 → 架构要点 → 开发约定 → 环境注意事项 → 工作纪律 → 文档索引。前四节建立坐标，深入某一域时直接跳到对应小节。
- **事实源优先级**：代码 > 现行文档（`docs/environments.md` / `model-architecture.md` / `testing.md`）> 历史快照（2026-10-19 的 PRD 与后台设计稿，结论已被 B0–B8 取代）。本文件里的数量类描述若与代码不符，**以代码为准并顺手改这里**。
- **单一事实源**：下列内容只在一处定义，改动改源头，不要在别处复制一份。

| 内容 | 唯一事实源 |
| --- | --- |
| 能力清单 / 字段 / 默认积分价 | `backend/src/capabilities/definitions/<id>.ts`（由 `definitions/index.ts` 聚合） |
| 运行期生效积分价 | `CreditPriceService.resolve()`；业务代码**不读** `creditCost` |
| 权限点 | `backend/src/admin/permissions.ts` |
| 退款与站点设置默认值 | `backend/src/admin/settings.dto.ts` 的 `SETTING_DEFS` |
| 工单状态机 | `backend/src/tickets/tickets.service.ts` 的 `TRANSITIONS` |
| 厂商与推荐模型 | `backend/src/providers/vendors/vendor.catalog.ts` / `vendor.presets.ts` |
| 启动期环境变量 | `backend/src/config/env.validation.ts` 的 `ENV_SPECS`；网关通道变量另见 `providers/channel-config.defs.ts` |
| 设计令牌 | `frontend/src/styles/global.css` 的 `:root` |
| AIGC 角标默认样式（文案/字号/配色/位置/缩放） | `backend/src/common/aigc-label.config.ts` 的 `AIGC_LABEL_DEFAULTS`；运行期由后台「AI 标识」页覆盖 |
| 后台侧栏与页面分组 | `frontend/src/components/admin/AdminLayout.tsx` 的 `MENU` |
| 测试清单与覆盖矩阵 | `docs/testing.md`；文档分类地图见 `docs/README.md` |

## 账号

可用的管理员账号
admin@huojue.local	44dXY9gja4VMmTfENyxg
ops@huojue.local	ksUTeX8t3GCnLyuLby6n

可用的测试账号
test@admin.com
dev@admin.com
uat@admin.com

## 开发要点
- 优先使用成熟开源库，如果不满足需求才考虑自研
- 页面注释参照 JSDoc
- 开发阶段，不写兼容代码
- 工业级代码，完整产品
- 后台页面不要设计移动端


## 项目概览

**货觉AI · MVP**（2026-10-19 定名；内部代号 `ecom-vision-mvp`，仓库目录 `aigc-creation`）—— 面向电商团队的智能视觉创作平台，页面结构与功能对标 **极画AI 工作台**（https://ijihua.cn/workbench）。

> 品牌唯一事实源：`docs/brand/brand-basics.md`（定位/口号/色板/字体/logo 规范/落地清单）；取名与商标冲突核查：`docs/brand/naming.md`。改色/改形/改口号属品牌级变更，须先改上述文件再动代码。

当前形态 = **C 端创作站 + 独立后台管理端 + 商业运营域 + 账户合规/服务域**：

- **16 项能力**（全部 `real`，0 `mock` / 0 `planned`，13 项进工作台）。2026-10-25 起**本地图像生成算法全部删除**：图像、文本、视频都只允许真实模型产出；无模型线路即失败并退款，不交付伪结果。
- **生成通道**为「模态 × 协议 × 厂商」三层可插拔。`auto/remote` 只调度真实模型线路，存量 `route=local` 明确判不可用；新写入不再接受 `local`。
- **后台管理端**（`/admin`）28 个页面，权限点 + 审计 + 定时任务 + 备份 + 存储切换。
- **商业域**：商品 / 订单 / 支付 / 退款 / 积分账本 / 会员 / 优惠券 / 限时活动 / 邀请签到 / 发票 / 渠道对账。
- **账户与合规域**：找回密码 / 短信登录 / **扫码登录** / 自助注销与数据导出 / 法务版本化与同意留痕 / 站内消息 / AIGC 标识（可见角标样式后台可配）/ 限流 / 健康检查 / 请求追踪。
- **服务域**：工单（C 端 `/tickets` + 后台工单中心）、后台全局搜索、批量动作与 CSV 导入导出。

## 技术栈

| 层 | 技术 | 版本（运行时依赖精确锁定；e2e / @types 例外） |
| --- | --- | --- |
| 后端 | NestJS + Prisma + **自研 node:sqlite driver adapter** | 12.1.3 / 7.10.0 |
| 配置 | @nestjs/config（零依赖手写 validate） | 12.0.1 |
| 日志 | 自研 AppFileLogger（落盘 + 轮转 + 脱敏） | 无新增依赖 |
| 数据库 | SQLite（`backend/dev.db`），`node:sqlite` 内置模块 | 需 Node ≥ 22.5 |
| 图像 | Jimp（仅上传校验 / 尺寸探测 / AIGC 角标，不生成图片） | 1.6.1 |
| 鉴权/加密 | jsonwebtoken / bcryptjs | 9.0.3 / 3.0.3 |
| 前端 | Vite + React + antd + lucide-react + react-router-dom | 8.3.4 / 19.3.0 / 6.6.6 / 1.57.0 / 7.18.4 |
| 前端其他 | qrcode（邀请海报 / 扫码登录）/ Playwright（e2e） | 1.5.4 / `^1.64.1`（仅 e2e 允许 `^`） |
| 语言 | TypeScript | 后端 5.7.2 / 前端 7.0.2 |

**版本必须精确锁定**。本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，依赖实际是用 `curl` + `tar` 直装 registry 装出来的，安装器不解析 semver 一律取 latest —— 详见「环境注意事项」第 4 条。

TS 配置差异（勿统一）：后端 `strict: false` / `strictNullChecks: false` / CommonJS / ES2021；前端 `strict: true` / ESNext / bundler 解析 / `jsx: react-jsx`。

**云存储是可选依赖**：`STORAGE_BACKEND` 支持 `local`（默认）/ `oss` / `minio`，但 `ali-oss`、`minio` 两个 SDK **当前不在依赖里**，切云端前需先装包；本地路径零云依赖。

## 目录结构

```
aigc-creation/
├── start.sh                  # 一键启动（--env development|test|prod；处理端口占用/CORS/建表/种子）
├── README.md                 # 现状速查（只写现状）：页面结构 / 能力清单 / 启动 / 接口 / 复刻规格 / 环境坑
├── docs/
│   ├── README.md             # ★ 文档地图（需求/产品/技术/测试/品牌/规划 六类 + 状态）
│   ├── environments.md       # ★ 技术：三环境体系（变量矩阵/加载优先级/生产门禁/Docker/排查）
│   ├── model-architecture.md # ★ 技术：通道分层 / 协议矩阵 / 调度 / 扩展 SOP
│   ├── testing.md            # ★ 测试：四层测试、闸口清单、覆盖矩阵、已知红灯
│   ├── development-workflow.md # ★ Agent 执行手册：十三阶段执行卡 / 闸口命令 / 证据标准 / 交人边界
│   ├── brand/                # ★ 品牌唯一事实源 + 取证截图
│   ├── admin-*.md            # 需求 + 产品：后台 PRD / 功能 / 详细 / 界面 / 总体设计
│   ├── commerce-design.md    # 产品：支付 / 积分 / 订单 / 商品
│   ├── prd.md · gap-analysis.md · refactor-dedup.md
│   ├── <页面>*-design.md     # 产品：1:1 规格与实拍审计（workbench / topnav / login / asset-library ...）
│   └── *-ref/ · screenshots/ · research/   # 取证截图与一次性调研（不参与分类）
├── docker-compose.yml        # 本地编排：默认=dev，--profile test=test（不同卷、不同库）
├── .run/                     # backend.log / frontend.log（gitignore）
├── backend/                  # NestJS 服务，端口 4100（测试档同端口），全局前缀 /api/v1
│   ├── prisma/schema.prisma  # SQLite provider；无 enum，状态类字段一律 String + DTO 白名单
│   ├── prisma.config.ts      # Prisma 7 连接配置（datasource url 移出 schema；按 NODE_ENV 选档）
│   ├── Dockerfile            # ★ 三阶段镜像（node:24-slim；deps → build → prod）
│   ├── scripts/              # seed* / smoke*（28 个）/ verify* / probe / db-url
│   ├── .env.development      # ★ 开发档（入库）
│   ├── .env.test             # ★ 测试档（入库；独立库/目录/端口/密钥）
│   ├── .env.production.example # ★ 生产样例（复制为 .env.production，含凭据故不入库）
│   ├── .env.example          # 环境变量总清单（唯一事实源在 src/config/env.validation.ts）
│   ├── src/
│   │   ├── main.ts           # 前缀/CORS/静态资源/ValidationPipe/拦截器/异常过滤/PORT/HOST
│   │   ├── config/           # ★ ConfigModule + env-files.ts（三环境档位）+ env.validation.ts
│   │   ├── common/           # guards（jwt/权限）/ 限流 / 签名 URL / AIGC 标识 / 请求追踪
│   │   │                     # filters / AppFileLogger / AppError / csv / test-support
│   │   ├── capabilities/     # ★ registry 门面 + definitions/<id>.ts（能力唯一事实源）
│   │   ├── providers/        # ★ modality（叶子）/ unified / vendors / protocols / 各协议实现
│   │   ├── prisma/           # prisma.service + 自研 node-sqlite-adapter.ts
│   │   ├── generate/         # 任务创建 + 轮询（generate / tasks controller）
│   │   ├── auth/ projects/ assets/ stats/ storage/
│   │   ├── admin/            # 后台：guards / 权限点 / 审计 / 调度 / 备份 / 各管理 controller
│   │   │                     # 渠道对账也在 admin/（reconciliation.controller/service）
│   │   ├── credits/ orders/ membership/ marketing/ products/
│   │   ├── payments/         # ★ 支付三层：沙箱 / 支付宝 RSA2 / 微信 v3 + 回调
│   │   ├── invoices/         # 发票申请 / 开具 / 可打印 HTML
│   │   ├── account/          # ★ 账户自助：/me、改密、数据导出、注销（生命周期唯一实现）
│   │   ├── legal/            # ★ 法务文档：slug + version 版本化，公开只读最新已发布
│   │   ├── aigc-label/       # ★ AIGC 可见角标配置：运行时素材（3s 缓存）/ 后台读写 / 公开只读
│   │   ├── notifications/    # ★ 站内消息：模板渲染 + 业务事件通知（@Global，永不抛异常）
│   │   ├── tickets/          # 工单：状态机（TRANSITIONS）唯一事实源
│   │   ├── channels/         # 邮件 / 短信通道（console ⇄ HTTP 适配器）
│   │   ├── health/           # /health（db/storage/channels 分项）+ /health/ready
│   │   └── prompt-tools/ mobile-upload/
│   ├── uploads/{original,generated}/   # 静态服务 GET /uploads/*（UPLOAD_DIR 可改）
│   ├── logs/                 # AppFileLogger 产物：app-<日期>.log + .error.log（gitignore）
│   ├── backups/              # 后台备份产物（BACKUP_DIR 可改）
│   └── dev.db                # 开发库（test.db / prod 库各自独立）
└── frontend/                 # Vite SPA，端口 5100（测试档同端口）
    ├── Dockerfile            # ★ 三阶段：deps → build(--mode production) → nginx
    ├── nginx.conf.template   # ★ SPA 回退 + /api 反代 + /uploads 直出（envsubst 模板）
    ├── playwright*.ts / tests/ # e2e 配置与用例（`e2e/` 只是脚手架示例，不是用例目录）
    ├── .env.development      # ★ 开发档（入库）
    ├── .env.test             # ★ 测试档（入库）
    ├── .env.production.example # ★ 生产样例（VITE_API_BASE 跨域时才需改）
    └── src/
        ├── App.tsx           # 27 条壳内路由 + 8 条独立页 + /admin/* 子应用（见下）
        ├── components/       # AppLayout / SideRail / RailPreview / ToolShell / QrLoginPanel / admin/AdminLayout ...
        ├── pages/            # 34 个 C 端页面 + pages/admin/ 28 个后台页面
        ├── lib/              # api.ts（request 拆信封）/ http.ts / auth.ts / capabilities.ts
        │                     # aigc-label.ts（角标参数拉取 + CSS 还原）/ constants.ts 含 APP_ENV / IS_PROD / API_BASE
        ├── context/          # AuthContext / AdminContext（权限点）/ CreditsContext
        ├── hooks/            # useToolTask / useProject / useCapabilities / usePollAbort / useCreditLabel / useAigcLabel / 上传相关
        ├── styles/global.css # ★ 设计令牌 + 全站规则
        └── types/api.d.ts
```

## 常用命令

```bash
# 推荐：一键启动（自动避开端口占用、自动建表 + 种子、前后端同时起）
./start.sh                  # 开发环境
                            # 可选 --build / --skip-db / --with-thumbs / --install
                            #      --backend-only / --frontend-only / --no-follow
                            #      --daemon（后台，PID 记 .run/start.pids）/ --stop（只停）
                            # 源码比 dist/main.js 新时自动 nest build（不再拿旧构建起服务）
                            #      --env test | --env prod
./start.sh --env test       # 测试环境（独立库 test.db；端口同开发 4100/5100，两档不能并行）
./start.sh --env prod       # 生产环境（需 backend/.env.production 存在）

# 手动启动
cd backend
npm run prisma:push         # 建表（首次或 schema 变更后）
npm run seed                # 预置开发账号（需 SEED_USER_EMAIL；未设置则不建任何账号，幂等）
npm run build               # nest build
PORT=4101 node dist/main.js # 不要用 nest start（触发安全守卫拒绝清空 dist）
                            # 端口被占时用 ./start.sh，它会停掉占用进程并固定在 4100

# 三环境专属命令（后端）
npm run start:test          # NODE_ENV=test node dist/main.js
npm run db:push:test        # 建测试库表
npm run db:reset:test       # ★ 删测试库+测试目录 → 重建 → 重灌种子（带安全门禁）
npm run seed:test           # 只灌测试库种子
npm run db:migrate:provider # 存量 GenerationTask.provider 'mock' → 'pending'（一次性、幂等；跑前打印影响行数）
npm run db:migrate:tool-idempotency # 存量库补幂等字段/索引（非破坏、可重复；不要用 accept-data-loss）

# 种子（按需组合；seed:all = 开发账号（未设 SEED_USER_EMAIL 则跳过）+ 角色 + 后台管理员 + 商品 + 会员 + 营销 + 法务 + 消息模板）
npm run seed:admin          # 后台管理员（默认 admin@huojue.local，密码仅打印一次）
npm run seed:roles          # 后台角色与权限点
npm run seed:commerce       # 商品（积分包）
npm run seed:membership     # 会员套餐
npm run seed:marketing      # 优惠券 / 活动 / 邀请签到规则
npm run seed:legal          # 三份法务文档 v1 **草稿**（不自动发布；已发布的不会被覆盖；不在 seed:all 内）
npm run seed:messages       # 五条站内消息模板（只补缺失，不覆盖已改文案）

# 三环境构建（前端）
npm run dev                 # vite --mode development（5100）
npm run dev:test            # vite --mode test（5100）
npm run build:prod          # tsc --noEmit && vite build --mode production
npm run typecheck           # tsc --noEmit
npm run e2e                 # Playwright

# 环境体系自检（74 项断言，不连数据库）
cd backend && npx ts-node -T scripts/probe-environments.ts

# Docker（本地编排，dev + test 两个 profile）
docker compose up -d --build                # 开发（13001 / 15173）
docker compose --profile test up -d --build # 开发 + 测试并行（容器端口 13001/13101 各自独立）
docker compose down -v                      # 连数据卷一起删

# 冒烟验证（需后端已启动；28 个脚本）
cd backend
node scripts/smoke-auth.js                    # 注册/登录/改密后旧 token 失效
node scripts/smoke-capability-runtime.js       # runtime/model-only 契约 + 上下线 + 限时免费
node scripts/smoke-admin.js                   # 后台身份/权限/审计
node scripts/smoke-commerce.js                # 商品/订单/支付/退款/积分
node scripts/smoke-membership.js              # 会员订阅与月度积分
node scripts/smoke-membership-order.js        # 会员下单→支付→激活唯一路径（无订单拒绝/重复激活/退款）
node scripts/smoke-payments.js                # 57 项：渠道回调入账/幂等/金额不符/CSV 对账/发票/支付渠道状态只读
node scripts/smoke-marketing.js               # 优惠券/活动/邀请/签到
node scripts/smoke-model-channels.js          # 模型线路 CRUD/排序/测试
node scripts/smoke-storage.js                 # 存储后端切换
node scripts/smoke-backup.js                  # 备份/校验/下载/清理
node scripts/smoke-scheduler.js               # 定时任务手动触发
node scripts/smoke-account.js                 # 账户自助：/me / 改密失效旧 token / 导出 / 注销保留订单
node scripts/smoke-notifications.js           # 站内消息：支付成功通知 / 广播 / 用户隔离 / 法务版本化
node scripts/smoke-aigc.js                    # AIGC 标识：PNG chunk CRC / JPEG XMP / 可见角标像素差
node scripts/smoke-signed-url.js             # 签名 URL：另起带密钥实例验证 403/200/篡改/过期/HEAD
node scripts/smoke-rate-limit.js             # 限流：短信 1/分、寻找回 3/时、伪造 XFF 无效
node scripts/smoke-health-tracing.js         # 健康分项 + X-Request-Id 回显 + 日志 [rid=] 串联
node scripts/smoke-tickets-search.js         # 42 项：工单状态机/越权 404/全局搜索/批量/CSV 导入导出
node scripts/smoke-refund-rules.js            # 19 项：退款时间窗 40905/比例 40906/已消耗积分 40907/会员终止
node scripts/smoke-qr-login.js                # 20 项：扫码≠授权/一次性兑换 consumed/过期/登录审计

# 架构与链路闸口（不依赖后台 UI，直接跑服务层/脚本）
npx ts-node -T scripts/verify-architecture-layers.ts   # 分层依赖方向
npx ts-node -T scripts/verify-capability-extensibility.ts
npx ts-node -T scripts/verify-credit-deduction.ts
npx ts-node -T scripts/verify-failover.ts            # 多渠道故障转移：切线路时真的换 baseUrl/token/model
npx ts-node -T scripts/verify-video-pipeline.ts
npx ts-node -T scripts/verify-payment-signatures.ts  # 44 项：支付宝 RSA2 / 微信 v3 AES-GCM 按公开规范独立复算（含退款响应验签、沙箱退款不造渠道单号）

# 依赖一致性审计
npm run verify:deps:critical                # 日常用：只查运行时关键链
npm run verify:deps                          # 全量 + 列出已记录无害项
node scripts/verify-deps.js --quiet           # 仅结论，有致命问题 exit 1（可接 CI）
```

**开发账号（非演示账号）**：2026-10-22 起前端不再硬编码任何账号密码，登录页也没有「填充演示账号」。预置账号完全由环境变量决定：`SEED_USER_EMAIL=dev@example.com npm run seed`（密码可由 `SEED_USER_PASSWORD` 指定，未指定则随机生成并**只打印一次**）；未设置 `SEED_USER_EMAIL` 时 `npm run seed` **什么都不建并 exit 0**。可选初始积分 `SEED_USER_CREDITS`（默认 0，不再有「演示账号自带 100 积分」）。首次上传时前端自动创建「默认项目」。后台账号另外用 `npm run seed:admin` 生成，与普通账号是两套（见「环境注意事项」第 8 条）。

冒烟脚本的后端地址：多数用 `API_BASE`（默认 `http://localhost:4100`），`smoke-model-channels.js` 用 `SMOKE_BASE`（默认 3005），`smoke-marketing.js` 用 `MARKETING_API_BASE`（默认 4100，含 `/api/v1`）。**测试档与开发档端口相同（4100），跑测试档前必须先停掉开发档**（`./start.sh --env test` 会自动停），否则脚本打到的是开发库上的实例。

**环境相关的完整说明见 `docs/environments.md`** —— 变量矩阵、加载优先级、生产门禁、Docker 与排查清单。

注意：冒烟与 seed 脚本**连的是当前 `NODE_ENV` 对应的库**（`scripts/db-url.js`）。
在测试环境跑它们必须先 `NODE_ENV=test`，否则会往开发库写数据。

## 架构要点

### 能力清单：插件化单一事实源

能力清单**只在 `backend/src/capabilities/definitions/<id>.ts` 定义**，由 `definitions/index.ts` 聚合，经 `capability.registry.ts` 门面导出，再通过 `GET /api/v1/capabilities` 下发给前端。侧栏、卡片、表单、统计分布全部由这份数据渲染 —— **新增能力不需要改前端**。

2026-10-20 起每项能力是**自包含对象**：元信息、提示词（`buildPrompt`）、模态（`modality`）、积分价（`creditCost`）都在一处声明。2026-10-25 起不再有本地实现句柄。装配期由 `assertCapabilityIntegrity` 校验，漏声明即启动失败。

新增一项能力只需两步：

1. 在 `capabilities/definitions/` 下新建 `<id>.ts`，导出一个 `CapabilityPlugin`
2. 在 `definitions/index.ts` 的 `CAPABILITY_PLUGINS` 数组里加 import + 一项

`CapabilityPlugin` 关键字段：`id / name / group / summary / sidebarHint / badge / mode / modality / buildPrompt / creditCost / inputs(0|1|2) / inWorkbench / help / params[]`。`ParamType = enum | number | text | boolean`。**不存在 `localImpl` / `localFallback`**。

`mode` 语义（实现程度）：

- `real` — **已接入真实模型能力**，界面标「已接入」
- `mock` — (2026-10-22 已移除) 过去标记「本地只画占位图」，那批占位实现已全部删除
- `planned` — 参考站有、本项目未实现，界面标「规划中」且不可提交（当前 0 项）

`modality` 语义（产出介质），与 `mode` **正交**：`image` / `text` / `video`。当前 15 项 image + 1 项 video（图生视频）；`text` 用于提示词工具等非能力项。新任务的 `task.provider` 恒为 `gateway`（建任务初值 `pending`）；`local` 只表示 2026-10-25 前的历史产出，结果卡仍如实标注为历史本地结果。

**当前分布**（16 项）：

- **全部 16 项 `real`，全部只能由模型生成**：15 项图像 + 1 项视频。
- 分组：`ecommerce_gen` 6 / `ai_retouch` 8 / `ai_video` 2（自由创作与图生视频）

新增能力时按实际实现程度声明 `mode`：已接真实模型即 `real`；未实现写 `planned`，不得补本地占位或伪模型结果。

> ⚠️ 界面标注看的是 **`runtime.effective`**（见下），不是 `mode`。`mode` 只回答「代码实现到什么程度」；没有模型线路时一律如实报 `unavailable`。

### 能力运行时真相（`runtime`）

`GET /capabilities` 的每项能力追加 `runtime: { enabled, route, remoteAvailable, localQuality, effective, reason }`：

| `effective` | 含义 |
| --- | --- |
| `remote` | 有可用模型线路，按下去走真实模型 |
| `disabled` | 后台已下线（`CapabilityControl.enabled=false`） |
| `unavailable` | 没有可用模型线路（或存在已停用的存量 `route=local`）：不可提交/任务失败并退款 |

- 由 `capabilities/capability-availability.service.ts` 合成，3s 缓存，后台写入即 `invalidate()`。
- **没有 `CapabilityControl` 行 = 启用**（默认全开，不预置 16 行）。
- 下架必须填原因；`generate.service` 在**扣费之前**拦截并返回 `40005`，原因原样下发到 C 端。
- `effective` 是**事前预期**；新任务实际来源恒为 `gateway`，失败不会回落本地产出。
- 后台「能力管控」页（`/admin/capabilities`）读写；权限 `capability.read` / `capability.write`（高危，需填原因 + 审计）。

**积分价**：`creditCost` 是代码默认值，运行时一律经 `CreditPriceService.resolve()` 取生效价（后台可改）。业务代码**不要直接读 `creditCost`**，否则后台调价不生效。

**限时免费**：进行中的 `Campaign(type='limited_free')` 命中的能力，`resolve()` 直接返回 0（优先于后台覆盖价），缓存 3s 到点自动恢复，**不需要调度任务把价格改回来**。改价页会显示 `source: 'campaign'` —— 运营据此才知道「改了价没生效」是活动在起作用。

### 生成通道：模态 × 协议 × 厂商

> 完整分层、协议矩阵、请求时序、扩展 SOP 与现状问题见 **`docs/model-architecture.md`**；本节只保留必须记住的约束。

依赖方向单向（勿反转）：**应用层 → 统一能力层（unified）→ 厂商层（vendors）→ 协议层（protocols）→ `modality.ts`（叶子）**。

```
generate.service / prompt-tools
  └─ 按 modality 选统一能力（image / text / video）
       └─ 厂商通道（vendor.catalog：7 家，跨模态共享基址与凭据）
            └─ 协议实现（端点、尺寸写法、响应字段）
                 └─ modality（image | text | video，叶子模块，不依赖任何层）
```

**协议清单**（协议名**跨模态复用**，任何「按协议名推断能力」的写法都是错的，必须看 `(modality, protocol)` 二元组）：

| 模态 | 协议 | 端点 | 形态 | 参考图回传 |
| --- | --- | --- | --- | --- |
| image | `openai` | `POST {base}/v1/images/generations` | 同步，一次阻塞到出图 | base64 data URL |
| image | `volcengine` | `POST {base}/images/generations` | 同步 | 公网 URL |
| image | `minimax` | `POST {base}/v1/image_generation` | 同步 | 公网 URL（仅 1 张） |
| text | `openai-chat` | `POST {base}/v1/chat/completions` | 同步 | 协议层不声明；多模态识图由工具层构造 base64 content 块 |
| video | `minimax-video` | `POST {base}/v1/video_generation` → `GET /v1/query/video_generation` → `GET /v1/files/retrieve` → 下载 | 异步四段式 | 公网 URL |

`modelverse` 保留为 `openai` 的**历史别名**（存量配置兼容），新配置请用 `openai`。默认协议：image 为 `openai`、text 为 `openai-chat`；`gateway.config.ts` 的空值兜底必须与之一致 —— 两处默认值不同会让「后台看到的默认」与「实际生效的默认」打架，极难排查。

**图像协议的实测差异（2026-10-20 查官方文档 + 实跑取证）**：

| 厂商 | 尺寸写法 | 响应结构 | 错误识别 |
| --- | --- | --- | --- |
| 优云智算 / 硅基流动 / OpenAI | `size: "2048x1152"` | `data[0].url` | `error.message` |
| 火山方舟 | `size: "2K"`（档位，不接受像素） | `data[0].url` | `error.message` |
| MiniMax | `aspect_ratio: "16:9"`（无 size 字段） | `data.image_urls[]`（**data 是对象**） | **HTTP 200 也可能是失败**，错误只在 `base_resp.status_code` |

火山方舟与 MiniMax 是踩坑高发区：按 OpenAI 的 `data[0].url` 去取 MiniMax 会得到 `undefined`；MiniMax 失败不识别就会把「失败响应」当成「无产出图」，丢掉真实错误原因。

共用骨架（鉴权 / 参考图编码 / 下载 / 魔数嗅判）在 `image-provider-base.ts` 的 `BaseImageProvider`，各协议子类只声明端点、尺寸写法、响应字段三处差异 —— 新增厂商不必重抄。

**格式必须按字节魔数判定，不能看 URL 后缀**。多家返回的链接形如 `.../d8021...` **无扩展名**，而 `generate.service` 按 `format` 决定落库扩展名与存储 mime，猜错会把 PNG 字节以 `image/jpeg` 入库。故用 `sniffImageFormat()`（魔数判定）。

**图像 / 文本协议当前都是同步的**：一次请求阻塞到出结果，不存在「提交任务 + 轮询」的图像协议。`ProtocolSpec.mode` 与 `pollEndpoint?` 作为通用异步契约字段保留（视频走独立的 `VIDEO_PROTOCOL_SPECS`，四段式异步）。因此图像通道的 `GATEWAY_{MODALITY}_POLL_MS` / `_MAX_POLLS` 不参与出图，实际由视频协议与 `ChannelScheduler` 的冷却判定使用。

### 失败策略：所有模态都不回落本地

| 模态 / 能力 | 失败时 | 错误码 |
| --- | --- | --- |
| image，无可用线路或存量 `route=local` | 任务失败并退款 | `42204` |
| image，有线路但全部失败 | 任务失败并退款 | `42201` |
| image，带遮罩但没有 edits 协议线路 | 任务失败并退款 | `42205` |
| text | 返回 502 + 可读错误 | HTTP 502 |
| video | 如实失败并退款 | 视频路由错误码 |

本地图像生成算法已于 2026-10-25 删除。失败后不会合成、裁剪或占位出图；`generate.service` 按任务快照统一退款。

**未知协议必须走失败路径**：`CapabilityRouterProvider.pickProtocol()` 对未知协议抛错，由调度器记为该线路失败并尝试下一条；全部失败时任务 `42201`，未知协议原因写入 `ModelCallLog.reason`，不静默换协议。

### 厂商目录与后台模型配置

`providers/vendors/vendor.catalog.ts` 是厂商唯一事实源（一家厂商一条），`vendor.presets.ts` 派生出「模态 × 厂商」视图供后台下拉使用。选厂商自动填「基址 + 协议 + 推荐模型」，令牌手填，填完仍可微调。

已内置 7 家：`modelverse`（优云智算，image+text）/ `siliconflow`（硅基流动，image+text）/ `openai`（官方，image+text）/ `volcengine`（火山方舟，image）/ `minimax`（image+video）/ `deepseek`（仅 text）/ `moonshot`（仅 text）。

**DeepSeek / Moonshot 只进文本通道**：两者标称「OpenAI 兼容」指 `/v1/chat/completions` 的**文本**兼容，**没有图像生成端点**。把它们配到生图通道必然 404，最终按线路失败处理并退款。

后台「模型配置」还提供：通道增删改、连通性测试（`POST /admin/model-config/test`）、单通道测试、调用记录（`ModelCallLog`，含回落原因）。多渠道灾备由 `channel-scheduler.ts` 负责：按 `priority` 升序选通道、跳过冷却中的通道、失败记一笔并试下一条，连续失败达阈值即熔断冷却（刻意不做权重随机 —— 灾备需要确定性，排障要能说出「刚才走的是哪条」）。

**通道配置优先级：环境变量 > 后台 `ModelChannelConfig`（DB）> 代码默认**。按模态各配一套前缀（`IMAGE` / `TEXT` / `VIDEO`）：

| 变量（以 `GATEWAY_IMAGE_*` 为例） | 默认 | 作用 |
| --- | --- | --- |
| `GATEWAY_{IMAGE,TEXT,VIDEO}_BASE_URL` | 空 | 该模态网关基址；留空表示未接入 |
| `..._TOKEN` / `..._MODEL` | 空 | Bearer token / 指定模型（留空用预设默认） |
| `..._PROVIDER` | image、video = `openai`；text = `openai-chat` | 通道协议 |
| `..._VENDOR` | 空 | 厂商预设标识，仅用于回看配置来源 |
| `..._ENABLED` | false | 强制尝试远程；**基址或令牌非空即视为开启** |
| `..._TIMEOUT_MS` / `..._POLL_MS` / `..._MAX_POLLS` | 图/文 120000 / 2000 / 60；视频 600000 / 2000 / 300 | 超时 / 轮询间隔 / 次数 |
| `GATEWAY_ROUTE_<能力ID大写>` | `auto` | 单能力路由：`auto` / `remote`；存量 `local` 只读并判不可用 |
| `ASSET_PUBLIC_BASE` | 空 | 参考图回传基址（网关需能拉取本站图片） |

存量单前缀 `GATEWAY_BASE_URL` / `GATEWAY_TOKEN` 等**仅对 image 模态**继续生效（legacy 回落），新配置请用模态前缀。默认零配置时能力显示不可用，不会本地生成。参考图以**站内 URL** 形式回传（`params.inputImages`），不传本地磁盘路径。

### 配置层（@nestjs/config）+ 三环境体系

`ConfigModule` 是 `AppModule.imports` 的**第一项**（`isGlobal`，注册顺序错不会立刻报错，只会运行期注入到 undefined）。

校验用**零依赖手写** `validateEnv`（`src/config/env.validation.ts`），不引 joi —— 依赖树纪律见「环境注意事项」第 4 条。三条硬约束：

1. **`validateEnv` 绝不改写 `process.env`**，只产出配置树。故 `jwt.service` / `gateway.config` / `storage.service` / `model-config.service` 里直接读 `process.env.X` 的代码行为 1:1 未变。
2. **类型错误即启动失败**。`PORT=abc` 旧代码会变 NaN 传给 `app.listen()` 静默绑随机端口，现在直接抛 `EnvValidationError` 并指名变量（`main.ts` 捕获后按清单多行打印 + `exit 1`）。
3. **默认值逐项抄自现有硬编码兜底值**，不擅自改默认行为。

`ENV_SPECS` 是**启动期校验变量**的唯一事实源，`.env.example` 与之对齐；除日志/存储外还包括 `BACKUP_DIR`、`STORAGE_BACKEND`、`OSS_*`、`MINIO_*`。

网关通道变量是例外：`GATEWAY_{MODALITY}_*` 与 `GATEWAY_ROUTE_<ID>` 由 `providers/channel-config.defs.ts` 按模态/能力**动态生成**，不经过 `validateEnv`（因此不写进 `ENV_SPECS`）；改这类键名要同步 `channel-config.defs.ts`。

**三环境（开发 / 测试 / 生产）—— 完整说明见 `docs/environments.md`，此处只列必须记住的：**

| 项 | development | test | production |
| --- | --- | --- | --- |
| env 文件 | `.env.development` | `.env.test` | `.env.production`（不入库） |
| 数据库 | `file:./dev.db` | `file:./test.db` | 必须 ≠ `file:./dev.db` |
| 上传目录 | `uploads` | `uploads-test` | 绝对路径 + 卷 |
| 备份目录 | `backups` | `backups-test` | 绝对路径 + 卷 |
| 日志目录 | `logs` | `logs/test` | 绝对路径 + 卷 |
| 端口（后端/前端） | 4100 / 5100 | 4100 / 5100（同开发，两档不能并行） | 由 env 文件决定 |

档位选择逻辑在 `src/config/env-files.ts`（Nest 侧）与 `scripts/db-url.js`（脚本侧，**必须与前者逐字一致**，否则会出现「Nest 连 test.db、seed 往 dev.db 塞数据」的错位）。两条硬规则：

- **`test` / `production` 刻意不回落 `.env` 与 `.env.local`**。共享 `.env` 里的 `DATABASE_URL=file:./dev.db` 一旦被继承，隔离形同虚设且**无任何报错**。
- **空串 ≠ 未设置**。`CORS_ORIGINS=""` 会让 `loadEnvFiles` 跳过覆盖，`.env` 里的值静默失效。按需注入变量，别无脑导出空串。

`production` 的两条**拒绝启动**门禁（非告警）：`JWT_SECRET` 未设置、`DATABASE_URL` 仍是开发默认值。`main.ts` 启动日志第一屏回显生效的环境名 / 库路径 / 上传目录 —— 「以为在测、实际连着开发库」是这套体系最需要防的乌龙。

**新增任何与环境相关的变量时**，同步改这四处：后端 `ENV_SPECS`、`backend/.env.example`、三档 `.env.development` / `.env.test` / `.env.production.example`、`scripts/db-url.js`（仅当影响库路径）；用户可见的行为变化再补 `docs/environments.md`。

### 合规与安全基础设施（AIGC 标识 / 签名 URL / 限流 / 健康 / 追踪）

| 能力 | 实现 | 关键约束 |
| --- | --- | --- |
| AIGC 标识 | `common/aigc-label.ts` | 图像 PNG 插 `tEXt`+`iTXt`(XMP)、JPEG 插 APP1 XMP，**逐 chunk 重算 CRC32**；声明 `DigitalSourceType=trainedAlgorithmicMedia`（GB 45438-2025）。**顺序必须先合成角标再写元数据**，反过来会打乱偏移损坏图 |
| 角标样式 | `common/aigc-label.config.ts` + `aigc-label/aigc-label.service.ts` | 默认值 `AIGC_LABEL_DEFAULTS`（`enabled` 开关 + 文案/字体/字号/字重/字距/字色/底色+不透明度/圆角/内边距/圆点位 `dotColor`/四角位置/缩放百分比/宽高上下限/边距/整体不透明度）。运行期由后台「AI 标识」页覆盖，3s 缓存 + 保存即 `invalidate()`；**读失败回退默认值不抛错**（配置读不到也要能打标识）。`enabled` 不进 `specKey`（不影响位图） |
| 角标位图 | `scripts/gen-aigc-label.mjs` → `common/aigc-label-badge.ts`（内置默认） + `AigcLabelConfig.pngBase64`（后台自定义） | Jimp 内置字体只有 ASCII，中文角标**必须**是预渲染位图。内置默认由 Playwright + 系统 Chrome 生成（`tsc` 不复制图片，运行时读路径必 ENOENT），改内置文案/配色须重跑脚本；后台改样式则由**浏览器 Canvas** 现场渲染 PNG 存库（零字体依赖），服务端只做缩放/定位/透明度合成。`specKey` 只哈希渲染字段，样式改了但位图未重存会被标 `stale`（仍用它，后台提示重存） |
| 签名 URL | `common/signed-url.service.ts` + `signed-asset.middleware.ts` | HMAC-SHA256(`key\|exp[\|uid]`)，`ASSET_SIGNING_SECRET` 空 = 保持公开。**`sourceUrl` 保持干净，另发 `signedUrl`**；展示字段走 `displayUrl()`，前端统一 `assetSrc()` |
| 限流 | `common/rate-limit.guard.ts` + `@RateLimit` | 单机内存固定窗口，多规则同时生效；超限 `42901`+`Retry-After`；**默认不信任 `X-Forwarded-For`**（`RATE_LIMIT_TRUST_PROXY=1` 才信任） |
| 健康 | `health/` | `/health` 分项（db/storage/channels，存储探测缓存 30s）、`/health/ready` 只看 DB，未就绪 503 |
| 追踪 | `common/request-context.ts` | `AsyncLocalStorage` 贯穿 `requestId`；响应头回写并**回显客户端合法值**；异常信封带 `requestId`；日志统一 `[rid=...]` 前缀（过滤器里不要再加一次） |

两条失败策略**刻意不对称**（别「统一」掉）：显式角标失败 → 任务 `failed/42203` 并退款（未标识产出不落库，**fail-closed**）；元数据写入失败 → 告警但仍落库（**fail-open**，不该因元数据丢了用户的图）。视频无 ffmpeg，只写 API 字段 `aigc.method='api-only'` + 前端播放器角标。

**可见角标可配置，也可整体关闭**：外观项（文案、字体、字号、字重、字距、字色、底色与不透明度、圆角、内边距、圆点色、位置、缩放、边距、整体不透明度）全部走后台配置；`enabled`（默认 `true`）控制是否在产出图上合成角标。`dotColor` 为空串表示不画圆点（文案仍在）。改配置属高危动作：权限 `setting.write`，必须填原因，写 `AdminAuditLog`（`aigc.label_update`）。

关闭只停用**显式**标识：隐式标识（XMP / IPTC `DigitalSourceType=trainedAlgorithmicMedia`）照常写入，`meta.visible=false` 并带 `warning`。两条守卫不可去掉：① 关闭时若隐式标识写入失败（含 webp/gif 这类无写入路径的格式），**抛 `AigcVisibleLabelError` 让任务失败并退款** —— 否则等于交付一张完全无标识的 AI 图；② 关闭后产出不重编码（PNG/JPEG 直接插元数据），像素与模型原图逐字节一致。按《人工智能生成合成内容标识办法》，显式标识属法定义务，默认保持开启；关闭入口与风险提示在后台页面显式呈现。

`POST /api/v1/test/rate-limit/reset` 是**测试专用**：`NODE_ENV!=='test'` 返回 404（不承认存在），且需 `x-test-token` == `RATE_LIMIT_RESET_TOKEN`。它只把限流窗口从「进程生命周期」收窄成「脚本作用域」，断言仍打在同一个 guard 上 —— 不是把限流测掉了。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `ASSET_SIGNING_SECRET` | 空 | `/uploads/*` 签名密钥；空 = 公开。生产档若为空会 WARN，长度不足 32 拒绝启动 |
| `RATE_LIMIT_ENABLED` | true | 全站限流开关（仅本地压测可关，关闭时打 WARN） |
| `RATE_LIMIT_TRUST_PROXY` | false | 是否信任 `X-Forwarded-For`（反代后需要） |
| `RATE_LIMIT_AUTH_PER_MIN` | 10（测试档 200） | 登录/注册配额，请求期读取 |
| `RATE_LIMIT_RESET_TOKEN` | 空 | 测试重置入口令牌（仅测试档有意义） |
| `ERROR_WEBHOOK_URL` | 空 | 异常上报地址（留空只落本地日志） |
| `EMAIL_PROVIDER` / `EMAIL_API_URL` / `EMAIL_API_KEY` / `EMAIL_FROM` | `console` | console = 不投递，正文落 `logs/outbox/`；`http` 才真实调用 |
| `SMS_PROVIDER` / `SMS_API_URL` / `SMS_API_KEY` / `SMS_SIGN` / `SMS_TEMPLATE` | `console` | 同上 |
| `PAYMENT_PROVIDER` | `sandbox` | `alipay` / `wechat` 需配对密钥；**密钥缺失返回 503，绝不静默回落沙箱** |

### 日志落盘（AppFileLogger）

应用层自己管文件，不依赖 `start.sh` 的 stdout 重定向 —— 后者每次启动会 `: > backend.log` 清空现场。

| 能力 | 实现 |
| --- | --- |
| 落盘 | `backend/logs/app-<日期>.log`（全量）+ `app-<日期>.error.log`（仅 error/fatal） |
| 轮转 | 跨日换文件；单文件超 `LOG_MAX_FILE_MB` 切 `.1/.2`，当日分片用尽后复用最后一片 |
| 保留 | `LOG_RETENTION_DAYS` 天，启动时 + 每日首次写入时清理；只删符合自家命名的文件 |
| 脱敏 | 写入前打码 `token/secret/password/api_key/authorization/Bearer`，任务 id 一类短标识不误伤 |
| 双写 | `LOG_CONSOLE=1`（默认）时同时输出控制台，不破坏 `.run/backend.log` 这条既有排错路径 |
| 降级 | 目录不可用 / 写失败 → 静默降级为纯控制台，绝不因日志故障打挂业务 |

用 `fs.appendFileSync` 而非 `createWriteStream`：stream 缓冲在 `kill -9` 时会丢，而「进程崩了」正是最需要日志的时刻。

**未做**：`process.env.X` → `ConfigService` 的全量收敛。当前两者并存且语义等价，收敛是独立的重构批次。

`AllExceptionsFilter` 由 AppModule 的 `APP_FILTER` 注册（需要注入 logger 才能落盘），`main.ts` **不得**再加 `useGlobalFilters`，两者并存会执行两次。`ResponseInterceptor` 无 DI 需求，仍走 `useGlobalInterceptors`。

### 统一响应信封

所有成功响应由 `ResponseInterceptor` 包成 `{ code: 0, data, message: '' }`，前端 `lib/api.ts` 的 `request()` 负责剥离。异常走 `AllExceptionsFilter` + `AppError(code, message, httpStatus)`。全局 `ValidationPipe({ whitelist: true, transform: true })`，校验错误压平成单条中文消息（`main.ts: flattenValidationErrors`）。

**跨模块引用的错误码**（其余错误码就近定义在各自 service）：

| 码 | 含义 | 定义处 |
| --- | --- | --- |
| `40001` | 参数 / 校验错误（DTO 错误由此统一压平） | `main.ts` |
| `40002` | 积分不足；生成链路转成 402 语义 | `credits/credit.service.ts` |
| `40005` | 能力已下线，原因随响应下发 | `generate/generate.service.ts` |
| `40301` | 无权访问 / 无权执行（越权、批量动作权限） | 多处（支付、发票、批量处理器等） |
| `40905` / `40906` / `40907` | 退款：超时间窗 / 超可退比例 / 积分已消耗且扣不回 | `orders/order.service.ts` |
| `40908` | 该订单有退款仍在渠道处理中（`Refund.status='processing'`），不接受新的退款 | 同上 |
| `42202` / `42203` | 任务中断回收失败 / AIGC 显式角标失败（均退款） | `generate/generate.service.ts` |
| `42204` | 无可用模型线路、或存量 `route=local`（任务失败，退款，不交付任何产出） | `providers/capability-router.provider.ts` 抛 `NoModelChannelError`，`generate.service` 落码 |
| `42205` | 任务带遮罩但所有通道的协议都没有图像编辑端点（`maskSupport !== 'edits'`），**不忽略遮罩整图重绘**（任务失败，退款） | 同上，抛 `MaskUnsupportedError`，`generate.service` 落码 |
| `42901` | 触发限流，附 `Retry-After` | `common/rate-limit.guard.ts` |
| `50301` / `50302` | 支付通道未配置（缺凭据，绝不回落沙箱）/ **渠道退款未完成**（HTTP 502；订单状态与积分不变，可用同一退款单重试） | `payments/payment.factory.ts` / `orders/order.service.ts` |

### 后台管理端（`/admin`）

独立外壳（`AdminShell` + `components/admin/AdminLayout`），与 C 端 `AppLayout` 完全分离：C 端侧栏/顶导/促销条都是消费级语义，不能复用。

**权限链**：`AdminGuard`（身份）→ `PermissionGuard`（权限点）→ controller → `AuditInterceptor`（落 `AdminAuditLog`）。权限点 54 个，定义在 `src/admin/permissions.ts`，角色存 `AdminRole`。**前端 `AdminContext.can()` 只用于隐藏无权限按钮，不是安全边界**；真正的校验必须在后端。

28 个页面，侧栏分 8 组（`AdminLayout.tsx` 的 `MENU` 是唯一事实源）：

| 分组 | 页面 |
| --- | --- |
| 总览 | 平台概览 |
| 运营 | 用户管理 / 素材管理 / 任务监控 / 工单处理 |
| 内容 | 法务文档 / 站内消息 / AI 标识 |
| 交易 | 商品管理 / 订单管理 / 积分账本 / 能力消耗价 / 优惠券 / 限时活动 / 邀请与签到 |
| 财务 | 支付渠道 / 发票管理 / 渠道对账 |
| 系统 | 角色权限 / 系统设置 / 存储配置 / 定时任务 / 操作审计 |
| 模型 | 模型配置 / 调用记录 / 能力管控 |
| 数据安全 | 数据备份 / 保留期清理 |

分组理由（代码注释里有同样说明）：「内容」是**发给全体用户的话**（法务文本、站内消息、AI 标识都会烙印到每个账号 / 每张产出图上），误改一条协议比调错一次价格更难挽回；「财务」是钱已收进来之后的动作，与「卖什么 / 卖了多少」不是同一批人；「模型」是生成链路的生产关键配置，排障时不能淹没在通用系统设置里；「数据安全」只在出事时进，频率与日常运营不同。

**AI 标识页（`/admin/aigc-label`）**：顶部「显示可见角标」开关（关闭时给出法律风险提示），左侧编辑样式（文案、字体族/字号/字重/字距/字色、底色与不透明度、圆角、内边距、圆点色、位置、缩放、边距、整体不透明度），右侧两层预览 —— 上层是 CSS 还原的角标外观，下层是 Canvas 按服务端同一套几何规则画在示例底图上（关闭态预览显示「可见角标已关闭」而非空白）。保存时**浏览器 Canvas 以 2x 渲染 PNG**，与 spec 一起原子提交（服务端不栅格化中文，也就不引入字体依赖）；关闭时仍然渲染并保存位图，重新开启即恢复原样式。权限：读 `setting.read`、写 `setting.write`；保存必须填原因。

**支付渠道页（`/admin/payment-channels`，只读）**：展示当前生效通道（`PAYMENT_PROVIDER`）、各通道凭据是否齐全、缺失的变量名与渠道回调地址，并对三类静默故障给告警：真实通道缺凭据（发起支付 503）、生产仍走沙箱、未配 `PAYMENT_NOTIFY_BASE` 导致回调地址不可公网访问。数据直接复用 `PaymentProviderFactory.status()` 与 `PaymentsService.notifyUrl()`，不另写一套通道判定。与「存储配置」同一安全边界：**凭据只从环境变量读，页面无写端点**，切换通道须改 env 并重启。权限：`payment.read`（管理员 / 财务可见）。

**模型配置页（2026-10-21 起含「可用模型」）**：页签为「线路管理 / 可用模型 / 逐能力路由 / 全局设置」。线路管理按模态分组展示线路（厂商、协议、模型、地址、健康、顺序），编辑走右侧抽屉；支持新增/删除/排序/启停、测草稿（未保存也能测）、多渠道主备。某模态一旦有线路，旧版 `gateway.<modality>.*` 的 baseUrl/token/model/provider 不再参与调度（超时/轮询仍生效）。权限：读 `model.config_read`、写 `channel.route`、测试 `channel.test`（运营默认有测试权）。

模型可发现性（2026-10-21）：模型清单有两条来源，**内置预设**（`vendor.catalog.ts`，离线可用带中文说明）与**厂商实时清单**（`POST /admin/model-channels/models`，用线路已保存令牌请求协议的 `modelListEndpoints`）。三处消费同一份结果：编辑抽屉的 `ModelPicker`（Select + 预设标签 + 一键拉取，支持手填自定义名）、线路表「默认模型」列的 Popover（该厂商其它可选模型）、独立「可用模型」页签（按 模态 × 厂商 总览）。拉取需 `channel.test`；令牌只在请求内使用，不落库、不进审计。

> 后台通用骨架已改为 **antd 原生组件**（`PageHeader/FilterBar/StatCard/Panel/CollapsiblePanel/Empty/StatusTag` 走 `Typography/Flex/Card/Collapse/Tag`，`ConfirmAction` 走 `Modal/Alert/Input`，列表 loading/失败态走 `Skeleton/Result`）；模型配置页则是整页 antd 化（`Tabs / Table / Form / Drawer / Segmented / Statistic`）。各列表页表单控件也已迁移到 `Button/Input/InputNumber/Select/Switch/Segmented/Checkbox/AutoComplete/Upload/ColorPicker/Slider`，`adm-*` 仅用于业务布局 class，改动时不要反过来把通用组件退回自绘 `div/button/input/select/textarea`。

高危动作（删除 / 重置密码 / 退款 / 手动调整积分 / 模型配置写入 / 角色与系统设置写入 / 手动备份）要求填写操作原因并写审计日志（`HIGH_RISK_PERMISSIONS`）。定时任务由 `SchedulerService` 轮询执行、后台可手动触发：订单超时关闭、积分到期回收、会员到期与月度积分、数据备份、保留期清理、活动到期收尾。备份支持手动/定时、SHA-256 校验、下载、按份数裁剪。

**工单（`tickets`，2026-10-21）**：C 端 `/tickets` 页 + `POST/GET /tickets`、`POST /tickets/:id/replies`、`POST /tickets/:id/close`；后台 `/admin/tickets`（`stats` / `export` / 列表 / 详情 / 回复 / `PATCH` 改状态或指派）。

- 状态机只在 `src/tickets/tickets.service.ts` 的 `TRANSITIONS` 里定义（`open → processing → resolved/closed`、`resolved → closed/open`、`closed → open`），跳步返回 400。**新增状态必须同时补边**，否则该状态永远进不去。
- 越权一律 **404 而非 403**（不泄露 id 存在）；用户回复使 `resolved` 回落 `open`；`closed` 后用户不能回复、后台可重开。
- 客服回复即受理（`open → processing` 并自动认领 `assigneeId`）；`assigneeId: null` = 取消指派，只能指派给启用中的后台账号。

**全局搜索**（`GET /admin/search?q=`，权限 `data.search`）：用户 / 订单 / 工单 / 任务 / 素材五组各前 5 条 + 总数，接在 `AdminLayout` 顶栏搜索框。`q` 长度 < 2 直接返回空组（否则五个 `LIKE` 全表扫描）。落点按「哪个界面能立刻看到它」定：工单 `/admin/tickets?id=`、素材 `/admin/assets?q=<id>`。

**批量与 CSV**：

- `POST /admin/{users,assets,tasks,orders}/batch`（`ids ≤ 100`，`common/batch.ts` 的 `runBatch` 串行执行、去重），逐条返回 `{ id, ok, message?, data? }`，**不包事务** —— 一条失败不该回滚另外 99 条。路由挂较弱读权限，处理器内用 `AdminRoleService.hasPermission()` 再判动作权限（403 `40301`）。
- CSV 统一走 `common/csv.ts`：UTF-8 **BOM** + RFC4180 + 公式注入前导 `'`。导出 `/admin/{users,assets,tickets,orders,payments,credits}/export`（`data.export`）；导入 `POST /admin/credits/import`（`data.import`，按**邮箱**匹配，逐行报结果）。前端 `downloadCsv()` 独立于 `request()`，CSV 不走 JSON 信封。
- 前端四个列表页同一套交互：勾选 → `.adm-bulk-bar` → 必要时 `ConfirmAction` → `BatchResultModal`（失败项排最前）→ 刷新。**翻页 / 改筛选一律清空选择**，避免对看不见的行下手。

### 商业域：积分 / 会员 / 订单 / 营销

- **积分**：`CreditLot`（批次，含到期时间）+ `CreditLedger`（流水：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim`）。消耗按 **FEFO**（先到期先扣，NULL 视为最晚到期）跨批次扣减，余额不足整体回滚并报 `40002`（前端按 402 语义处理）。
- **生成计费**：`generate.service` 在**创建任务时**扣积分，`task.creditCost` 记录快照；失败/取消按快照**原额退还**，不重新取价。扣费与建任务不能同事务，故失败退款是对该代价的兜底。
- **会员**：`MembershipPlan` → `Membership`（订单支付后生效）/ `MembershipUsage`；到期由调度任务处理并按月发积分。
- **交易**：`Product`（积分包/套餐）→ `Order` / `OrderItem` → `Payment`；退款走 `Refund`，同时回收已发积分（`reclaimForOrder`）。后台可标记已支付、退款；退款属高危动作，需填写原因。
- **退款规则**（后台「系统设置 → 退款」，`SETTING_DEFS` + `order.service.refund`）：`refund.windowDays`（默认 7，0 = 不限，超时 40905）、`refund.maxRatioBps`（默认 10000 = 实付全额，按实付**向下取整**，超出 40906）、`refund.allowConsumedTask`（关闭后积分已消耗且扣不回即拒退，40907）。**校验顺序不可反**：先硬约束「金额 ≤ 实付 - 已退」（40001/400）再走可配规则（409），否则参数错会被伪装成规则拦截。同一订单有 `processing` 退款时再发起返回 40908。会员单全额退款终止会员周期（响应带 `membershipTerminated`）。
- **退款真的打回渠道**（2026-10-22）：`PaymentProvider.refund()` 三实现 —— 沙箱直接成功、支付宝 `alipay.trade.refund`（响应必须验签，缺签/验签失败一律不给「成功」）、微信 `POST /v3/refund/domestic/refunds`。两段式顺序不可反：**校验 → 落 `Refund(status='processing')`（用它的 id 作渠道幂等键 `outRefundNo`）→ 调渠道 → 成功才回收积分/迁移订单状态/累加 `refundedCents`**。渠道失败置 `failed` 并抛 `50302`，**订单状态与积分不变**；微信返回 `PROCESSING` 时保持 `processing`、同样不动本地账（本仓库没有退款回调端点，需人工到商户后台确认）。`channel='manual'`（后台标记已支付）不调渠道。**绝不允许「只改库、假装退过钱」**。
- **支付通道**（`payments`）：`PaymentsService`（编排）→ `PaymentProvider`（沙箱 / 支付宝 RSA2 / 微信 v3）→ `node:crypto`。凭据缺失返回 **503**，绝不静默降级为沙箱；沙箱回调在生产拒收。回调三道闸：验签 → 金额核对（不符落对账差异、不置 paid、回执失败让渠道重试）→ 幂等（`payTransactionId @unique`）。`ackSuccess` 与 `ok` 语义不同：非成功交易状态回执成功以停止重试。
- **对账**（`admin/reconciliation.service.ts`）：CSV 手写 RFC4180 解析 + 表头别名，金额单位按表头是否含 `cent|分` 判定；差异五类 `matched|amount_mismatch|missing_local|missing_channel|duplicate`。**处置只改状态与备注，不改钱**。
- **发票**（`invoices`）：一单一票（`orderId @unique`），金额取 `paidCents - refundedCents` 快照；输出可打印 HTML（零 PDF 依赖）。开具/驳回需填原因并写审计。
- **营销**：`Coupon`（优惠券）/ `Campaign`（限时活动）/ `InviteRelation` + `InviteRewardRule`（邀请）/ `CheckinRecord` + `CheckinRule`（签到）；C 端接口在 `marketing.controller.ts`。

### 其他能力模块

- **提示词工具**（`prompt-tools`）：AI 润色、图片转提示词。走 text 模态，通道不可用返回 502，**不回落**。
- **手机上传**（`mobile-upload`）：创建一次性会话 + 令牌，手机扫码上传、桌面端接收，避免把素材先传到聊天工具。
- **存储**（`storage`）：`local`（默认）/ `oss` / `minio`，按 `STORAGE_BACKEND` 切换；后台上报状态与连通性探测。切云端前需先装对应 SDK。
- **账户自助**（`account`，2026-10-21）：`/me` 路径下只认令牌身份，路由层没有「别人的账号」这个概念。改密后 `tokenVersion + 1`，**该账号全部旧 token 立即失效（含当前这把）**。注销的实现在 `account-lifecycle.service.ts`，后台用户管理与 C 端自助共用同一份，行为与注销确认页的承诺逐条对应：**清除**作品 / 素材 / 项目 / 积分批次（含对象存储文件）、终止生效中的会员；**保留**订单 / 支付 / 退款 / 发票 / 积分流水（法定留存，流水断开批次引用），并匿名化与状态置 `deleted`。
- **法务文档**（`legal`）：三类固定 slug（`user-agreement` / `privacy-policy` / `minors-policy`），按 `(slug, version)` 版本化。已发布版本**不可原地覆盖**（`upsert` 返回 409），改文本须升版本号再发布；发布时同 slug 的其他已发布版本自动置 `archived`，保证 `current()` 唯一。前台 `LegalPage` 读接口，读不到时用内置文本兜底。
- **扫码登录**（`auth/qr-login.service.ts`，2026-10-21）：桌面建码 → 手机（已登录）扫码 → 手机确认 → 桌面轮询换 JWT，票据 120 秒有效。三条不可放松的约束：**票据只存 SHA-256**（二维码会被截图/投屏，明文入库等于长期会话钥匙）、**扫码 ≠ 授权**（`scan` 只到 `scanned`，绑定账号必须 `confirm`）、**兑换一次性**（条件更新 `confirmed → consumed` 抢占，并发轮询只有一个拿到 token）。手机端确认前必须展示发起端 IP + UA。
- **站内消息**（`notifications`，`@Global()`）：`notify()` **永不抛异常**（写库失败只 WARN），模板缺失回落到代码内置文案。已接入四个业务事件：支付成功（`order.service.markPaid`）、任务失败退款（`generate.service.refundForFailure`，**仅在退款真的成功时**）、会员到期（调度任务，先查后更才能拿到 userId）、工单回复（B7 接入）。变量只替换 `{name}` 形式占位符。

### 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 能力清单（公开免登录），前端全部渲染依据 |
| POST | `/api/v1/auth/register` | 注册，**直接返回 `accessToken`**（注册即登录） |
| POST | `/api/v1/auth/login` | 登录，返回 `{ accessToken, user }` |
| POST/GET | `/api/v1/auth/qr/create`、`/auth/qr/status` | 扫码登录：桌面建码 / 轮询换 token（公开，`status` 首次兑换即作废） |
| POST | `/api/v1/auth/qr/{scan,confirm}` | 手机端（需登录）标记已扫 / 确认授权；**扫码≠授权**，确认才绑定账号 |
| GET/POST | `/api/v1/projects` | 项目列表 / 创建 |
| POST | `/api/v1/assets/upload` | 上传素材（multipart：`file` + `projectId` 均必填），返回含宽高 |
| GET | `/api/v1/assets` | 素材库列表（`kind`/`capability`/`limit`/`offset`） |
| DELETE | `/api/v1/assets/:id` | 删除素材（生成图连带删除产出它的任务） |
| POST | `/api/v1/generate` | 创建生成任务，返回 `{ taskId, status, creditCost }`，异步执行 |
| GET | `/api/v1/tasks/:id` | 轮询任务，`outputAsset.sourceUrl` 为结果图 |
| GET | `/api/v1/tasks` | 任务列表（含 `outputAsset`，历史页缩略图依赖它） |
| DELETE | `/api/v1/tasks/:id` | 删除作品（连带产物与磁盘文件） |
| GET | `/api/v1/stats/overview` | 数据中心聚合（含按能力缩略图） |
| GET | `/api/v1/credits/{balance,lots,ledger}` | 积分余额 / 批次 / 流水 |
| GET | `/api/v1/membership/plans`、`/me` | 会员套餐 / 我的会员 |
| POST | `/api/v1/membership/{subscribe,cancel}` | 订阅 / 取消自动续费（取消后 `status='cancelled'`，已付周期保留至 `expiresAt`，到期由调度任务失效；续费可重新激活并顺延） |
| GET | `/api/v1/products/:sku` | 商品详情（结算页用） |
| GET | `/api/v1/orders/:id`、POST `/pay`、POST `/cancel` | 订单详情 / 发起沙箱支付 / 用户取消未支付订单（仅 `pending → cancelled`，幂等；已支付只能走退款） |
| POST | `/api/v1/payments/:orderId/intent` | 发起真实渠道支付（返回 `redirect` 跳转或 `qrcode` 扫码） |
| POST | `/api/v1/payments/callback/:channel` | **渠道异步回调（公开，无信封，`@Res()` 直写）**，验签 + 金额核对 + 幂等 |
| GET | `/api/v1/payments/:orderId/status` | 支付状态轮询 |
| POST/GET | `/api/v1/invoices`、`/invoices/:id/file` | 申请开票（一单一票）/ 列表 / 取可打印 HTML |
| GET | `/api/v1/marketing/{popup,invites,checkin}` | 营销弹窗 / 邀请 / 签到 |
| GET | `/api/v1/marketing/campaigns` | 进行中的限时价 / 限时免活动（公开；只回真正更便宜且商品在售的） |
| POST | `/api/v1/prompt-tools/{polish,image-to-prompt}` | 提示词润色 / 图片转提示词 |
| POST/GET/DELETE | `/api/v1/mobile-upload/sessions*` | 手机上传会话 |
| GET/PATCH/DELETE | `/api/v1/me` | 账户资料 / 更正昵称 / 自助注销（密码 + 确认词） |
| POST | `/api/v1/me/{password,export}` | 改密（成功后旧 token 全失效）/ 个人信息导出 JSON |
| GET | `/api/v1/me/deletion-preview` | 注销影响面（项目 / 作品 / 素材 / 订单 / 消息） |
| GET | `/api/v1/legal`、`/legal/:slug` | 法务文档概览 / 最新已发布正文（公开免登录） |
| GET/POST | `/api/v1/notifications`、`/notifications/:id/read`、`/read-all` | 我的站内消息 / 标记已读 |
| GET | `/api/v1/aigc-label` | 生效的可见角标参数（公开；前端视频播放器角标用） |
| GET/PUT | `/api/v1/admin/aigc-label` | 读 / 改角标样式（`setting.read` / `setting.write`，PUT 需原因 + 审计 `aigc.label_update`） |
| GET/POST | `/api/v1/tickets`、`/tickets/:id`、`/tickets/:id/replies`、`/tickets/:id/close` | 我的工单 / 详情 / 回复 / 关闭（越权 404） |
| GET | `/api/v1/admin/tickets`、`/tickets/stats`、`/tickets/export` | 工单列表 / 状态计数 / CSV 导出 |
| GET/POST/PATCH | `/api/v1/admin/tickets/:id`、`/tickets/:id/replies` | 工单详情与回复 / 改状态或指派（`ticket.handle`） |
| GET | `/api/v1/admin/search?q=` | 全局搜索五组各前 5 条（`data.search`，`q` < 2 返回空） |
| POST | `/api/v1/admin/{users,assets,tasks,orders}/batch` | 批量动作，逐条结果（≤ 100 条，`data.batch`） |
| GET | `/api/v1/admin/{users,assets,tickets,orders,payments,credits}/export` | CSV 导出（BOM，`data.export`） |
| POST | `/api/v1/admin/credits/import` | 积分 CSV 导入（multipart，按邮箱匹配，`data.import`） |
| GET/PUT/POST | `/api/v1/admin/legal*` | 法务版本列表 / 新建草稿 / 发布（`legal.write`，发布需填原因） |
| GET/POST | `/api/v1/admin/notifications/{broadcast,templates}` | 全站广播 / 消息模板（`message.write`） |
| GET | `/api/v1/admin/notifications/channels` | 邮件 / 短信**实际生效实现**（`provider` / `delivers` / `configured`，不含凭据；`message.write`） |
| GET | `/api/v1/health`、`/health/ready` | 健康分项（db/storage/channels）/ 就绪探针（未就绪 503），均免登录 |
| POST | `/api/v1/test/rate-limit/reset` | **仅测试档**（其他环境 404）+ `x-test-token`，清空限流计数 |
| GET | `/api/v1/admin/{me,overview,permissions}` | 后台身份 / 概览 / 权限点 |
| GET/PATCH/POST/DELETE | `/api/v1/admin/users*`、`assets*`、`tasks*` | 用户 / 素材 / 任务管理 |
| GET/PUT/POST | `/api/v1/admin/{credit-prices,products,orders,payments,credits}*` | 交易与积分管理 |
| POST | `/api/v1/admin/orders/:id/refund` | 渠道退款（**先调渠道再改本地账**；渠道失败 `50302` 且订单/积分不变，在途退款 `40908`，`order.refund` 权限 + 必填原因 + 审计） |
| GET/PUT/POST | `/api/v1/admin/{coupons,campaigns,marketing-rules}*` | 营销管理 |
| GET/POST | `/api/v1/admin/{reconciliation,invoices}*` | 对账导入 / 批次与明细 / 差异处置 / 导出；发票审核与开具 |
| GET | `/api/v1/admin/payment-channels` | 支付渠道状态（只读：生效通道 / 凭据缺失项 / 回调地址 / 风险告警，`payment.read`） |
| GET/POST/PATCH/DELETE | `/api/v1/admin/model-channels*` | 模型线路 CRUD / 排序 / 测试；写需 `channel.route`，测试需 `channel.test` |
| GET/PUT | `/api/v1/admin/capabilities*` | 能力上下线；下架必须填原因，写需 `capability.write`（高危，走审计） |
| GET/POST | `/api/v1/admin/{model-config,model-calls,storage,scheduler,backups,audit-logs,roles,settings}*` | 系统与模型管理 |
| GET | `/uploads/*` | 静态图片（Express 静态中间件，不受 `/api/v1` 前缀影响） |

JWT TTL 默认 7 天（`JWT_TTL` 可覆盖；本地 MVP 无 refresh，生产应恢复短 TTL + refresh）。

### 前端路由

三类外壳：

- **独立页（无侧栏，8 条）**：`/`（landing）、`/sitemap.html`、`/legal/:slug`、`/login`（含扫码登录页签）、`/qr-login`（手机端扫码确认）、`/forgot-password`、`/reset-password`、`/mobile-upload`
- **C 端 Shell 内（27 条）**：`/workbench`、`/product-kit`、`/product-detail`、`/viral-clone`、`/free-creation`、`/multi-image-fusion`、`/product-sku`、`/local-redraw`、`/background-remove`、`/watermark-remove`、`/product-retouch`、`/image-translate`、`/image-expand`、`/product-recolor`、`/rotate-angle`、`/tools/:capability`、`/works`、`/library`、`/stats`、`/invitations`、`/packages`、`/checkout/:sku`、`/credits`、`/orders`、`/account`、`/tickets`、`/my-works`
- **后台子应用**：`/admin/*`（28 页，独立 Shell 与鉴权）

未匹配 → `NotFoundPage`（`App.tsx` 的 `path="*"`）；`/admin/*` 必须注册在 catch-all 之前，否则会被吞进 C 端 Shell。**C 端路由已对外开放**（2026-10-19）：未登录可直接浏览，需要身份的动作唤起登录弹窗，`/login` 仅作深链接兜底。

前端 `VITE_API_BASE` **默认留空**，走同源：开发态由 Vite 代理 `/api` 与 `/uploads` 到 `VITE_API_PROXY`，生产态由 Nginx 反代。跨域部署时才填绝对地址，且后端 `CORS_ORIGINS` 必须包含它。

### 数据模型要点

42 个模型，按域分组：

- **用户与权限**：`User` / `AdminRole` / `AdminAuditLog` / `SystemSetting`
- **创作**：`Project` / `Asset` / `GenerationTask`
- **交易**：`Product` / `Order` / `OrderItem` / `Payment` / `Refund`
- **权益**：`CreditLot` / `CreditLedger` / `MembershipPlan` / `Membership` / `MembershipUsage`
- **增长**：`Coupon` / `Campaign` / `InviteRelation` / `InviteRewardRule` / `CheckinRecord` / `CheckinRule`
- **财务**：`Invoice` / `ReconciliationBatch` / `ReconciliationItem`
- **身份安全**：`AccountToken`（一次性令牌：重置密码等）/ `LoginLog` / `LoginSession`（扫码登录票据，**只存 SHA-256 哈希**，`confirmed → consumed` 一次性兑换）
- **内容与合规**：`LegalDocument`（按 slug + version 版本化）/ `ConsentRecord`（同意留痕）/ `Notification` / `MessageTemplate` / `AigcLabelConfig`（单行 `id='default'`：`specJson` 样式 + `pngBase64` 浏览器渲染位图 + `specKey` 过期判定）
- **服务**：`Ticket`（`ticketNo @unique`，状态机见 `tickets.service.ts`）/ `TicketReply`
- **模型通道**：`ModelChannel` / `ModelChannelConfig` / `ModelCallLog` / `CapabilityControl`（能力上下线，无行 = 启用）
- **运维**：`BackupRecord` / `CleanupLog`

SQLite provider 不支持 Prisma enum，因此 `kind` / `status` / `capability` / `type` 一律 String 存储，取值范围在 DTO / service 层用白名单强制约束。`Asset.kind` = `original` | `generated`；`Asset.outputOfTask` 是 1:1 反向关系。计费相关字段以**快照**为准（`GenerationTask.creditCost`、`OrderItem.priceCentsSnapshot` / `creditsSnapshot`），不要事后按当前价重算。

Jimp 仅用于上传校验、尺寸探测和 AIGC 角标合成，不参与生成图内容；生成图文字由模型决定。

## 开发约定

### 常见改动：从哪下手

| 要做什么 | 必改的文件 | 同步/校验 |
| --- | --- | --- |
| 新增一项能力 | `capabilities/definitions/<id>.ts` + `definitions/index.ts` | 启动期 `assertCapabilityIntegrity` 校验；`verify-capability-bootstrap.ts` / `-extensibility.ts` |
| 新增厂商 | `providers/vendors/vendor.catalog.ts` 加一条（`vendor.presets.ts` 自动派生） | 选厂商自动填基址/协议/推荐模型；`verify-vendor-aggregation.ts` |
| 新增协议 | `providers/protocols/protocol.spec.ts` 加协议形状 + `provider-factory.ts` 加一行映射 + 对应 provider 实现 | 图像能力继承 `BaseImageProvider` 只声明端点/尺寸/响应字段三处差异；未知协议**显式抛错**，不静默回落 |
| 新增后台页 | `admin/permissions.ts` 权限点 → 后端 controller 挂 `@RequirePermission` → `AdminLayout.tsx` 的 `MENU` → `pages/admin/*.tsx` → `AdminDashboardPage.tsx` 路由 → `lib/api.ts` + `types/api.d.ts` | 前端 `AdminContext.can()` 只隐藏按钮，权限必须在后端 |
| 新增环境变量 | `config/env.validation.ts` 的 `ENV_SPECS` + `.env.example` + 三档 env；通道类再加 `providers/channel-config.defs.ts` | `probe-environments.ts`；`docs/environments.md` |
| 调整积分价 / 退款规则 | 默认值在 `definitions/<id>.ts` 的 `creditCost` / `settings.dto.ts` 的 `SETTING_DEFS` | 运行时一律走 `CreditPriceService.resolve()` 与设置读取，不在业务代码里写死 |

### 样式：语义化 token，禁止硬编码色值

全站样式在 `frontend/src/styles/global.css` 的 `:root` 定义令牌（含主题/暗色块），页面**一律引用 `var(--token)`，不写裸 hex**。

核心令牌：

```
品牌紫（唯一主色 #5546d8）  --brand / --brand-light（仅渐变浅端）/ --brand-hover / --brand-bg
中性色（单一冷灰族）        --text-strong #171a2b / --text-body #4e5969 / --text-muted #667085
                            --text-desc #86909c / --border #e5e7ef / --surface #f2f4f7
圆角（只用这 5 档 + 胶囊）  --radius-tag 4 / --radius-control 8 / --radius-card 12
                            --radius-panel 16 / --radius-hero 24 / --radius-pill 999
```

**已发生过的真实 bug 警示**：`--color-primary` 曾是蓝色 `#2563eb`，与紫系页面混用导致 hover 时蓝紫跳变，2026-10-18 已归位为品牌紫。新增颜色前先查 `global.css` 是否已有语义合适的 token；确需新增则定义 token 并全站替换，不留同义簇。

### 1:1 复刻纪律

页面大量逐页 1:1 复刻自参考站实拍（computed styles，1920×1080）。改动复刻页时：参考站产物 CSS 的字面值是唯一基准，实拍值完整保留在 README 各页「复刻说明」与代码注释中，可按页回退。注意 2026-10-17 存在一次明确的取舍：设计一致性收口**有意偏离**部分页面的参考站实拍值（暖灰改冷灰、`#6C5CE7` → `#5546D8`、hero 副标题 17→16px），这是用户「统一优先于逐页 1:1」的决策，不要「修正」回去。

### 本仓库已初始化 git

根目录有 `.git`（当前仅有 `master` 分支，未配置远端）。历史与回滚可用，但**不要代为 commit**（见「工作纪律」）。

### README 只写现状

`README.md` 记录**当前**的页面结构、能力清单、目录树、启动方式、环境坑与复刻规格。**不往 README 追加逐轮改动与验证记录**：改动的取舍与真实验证结果随提交说明记录，闸口清单与已知红灯维护在 `docs/testing.md`。

改动功能/样式/环境约定后仍应同步 README 的现状章节 —— 但如果与代码冲突，**以代码为准并顺手改 README**，能力事实以 `backend/src/capabilities/definitions/` 为准。

## 环境注意事项（踩坑，务必遵守）

1. **开发档后端固定 4100**（全局前缀 `/api/v1`），前端固定 5100。
   - 端口已被其它进程占用时，直接 `node dist/main.js` 会 `EADDRINUSE`；
   - 若占用者不是本项目，前端登录会**静默 404**（`Cannot POST /api/v1/auth/login`，对方返回自己的响应格式，不报错）。
   - 正确做法：`./start.sh`（端口固定，占用即停掉占用进程再起，不回退到 4101/5101）。
   - 生产档不自动杀进程：端口被占直接失败，需人工确认（线上端口上的东西可能不是本项目）。
2. **不要用 `nest start`** —— 会触发安全守卫拒绝清空 `dist`。用 `npm run build` + `node dist/main.js`。
3. **CORS 只放行 5100 / 4173**（默认），前端必须用 5100（三档同一端口）。
   - `CORS_ORIGINS`：逗号分隔显式白名单，**给定时覆盖其余规则**（生产用这个）。
   - `CORS_ALLOW_PRIVATE_LAN=1`：额外放行私有网段任意端口（`10.` / `172.16-31.` / `192.168.`，供手机同 WiFi 调试）。
   - 排错顺序：先看后端启动日志那行 `CORS origins: ...`，再核对浏览器地址栏 host:port。**`localhost` 与 `127.0.0.1` 在 CORS 判定上是不同来源，不能互换。**
4. **依赖安装会超时**。本机 npm 走 broker 代理，大批量安装触发 5 分钟硬超时，历史上用 `curl` + `tar` 直装 registry。因此 `node_modules` 里的**嵌套副本无法由 npm 自动重现**：
   - `multer/node_modules/type-is@1.6.18` + 其下 `media-typer@0.3.0`
   - `webpack/node_modules/mime-types@2.1.35`
   - `@nestjs/config/node_modules/dotenv@18.0.3`

   其中 `media-typer` 最关键：**错版会让 multer 静默不解析 multipart**（不报错，只是收不到文件）。新增依赖后重跑 `npm run verify:deps:critical`。当前状态（2026-10-20 实测）：致命 0 / 已记录无害 73 / 提示级 9 / 必需嵌套副本 5:5 就位。工具维护 `ACCEPTED_PINS`（刻意的精确 pin 偏差）与 `KNOWN_BENIGN`（已验证无影响的偏差簇，附依据）两份清单。

   `@nestjs/config` 那一项的原因：它精确 pin `dotenv@18.0.3`，而顶层 `dotenv@17.4.2` 是 prisma / `@prisma/config` 的，两者不能共用同一份。
5. **Node ≥ 22.5**（依赖内置 `node:sqlite`）。
6. **`@nestjs/config` 是纯 ESM，本项目是 CommonJS**。`dist` 里是 `require('@nestjs/config')`，靠 Node ≥ 22.12 的 `require(esm)` 能力工作（当前本机 Node 26.4.0，实测通过）。
   - 若日后 Node 版本下探到 < 22.12，会直接 `ERR_REQUIRE_ESM`；此时要么升 Node，要么退回 `@nestjs/config@4.x`（CJS + lodash，但 peer 只声明支持 NestJS ≤ 11，需手工处理 peer 冲突）。
   - 它的传递依赖 `dotenv` / `dotenv-expand` / `es-toolkit` 本身全是 CJS，ESM 面只有顶层这一个包，所以风险可控。
7. **`/uploads` 必须在前端代理里**。素材 `sourceUrl` 是 `/uploads/<key>`；开发态 Vite 若不代理它，会把该路径当 SPA 路由返回 `index.html` —— **HTTP 200 但 Content-Type 是 text/html**，图片静默破图，网络面板全绿，极易误判成「上传失败」。`vite.config.ts` 已同时代理 `/api` 与 `/uploads`，新增代理规则时勿漏。
8. **普通账号与后台管理员是两套**。2026-10-22 起不再有硬编码的演示凭据（`DEMO_CREDENTIALS` 已删除）：普通账号由 `npm run seed` + `SEED_USER_EMAIL` 决定，且**永远不给 admin 角色**；后台账号用 `npm run seed:admin` 生成：默认 `admin@huojue.local`，密码为 20 位随机串，**仅在本次运行输出一次**，不写库、不落盘；重复执行不会重置密码（改密走后台用户管理）。冒烟脚本一律自注册临时账号，不依赖任何预置凭据。

## 工作纪律

- **不要代为 commit**。用户保留提交权；只在明确要求时提交。
- **不要运行 `tsc` / `build` 自测**（除非用户明确要求）。用户自验；AI 跑闸口不得擅自改码。
- 交付时给**精炼结构化摘要**：file:line 引用 + 校验结果，结论优先。中文输出，禁用 emoji。
- 代码与文档冲突时，**以实际代码为权威源**，文档散文次之。
- 验证铁律：**先跑红再最小修订**，要求真实运行证据（node / tsc / 浏览器实际执行），不信 checklist 自评。
- 「跑」= 执行闸口/build/test，「改」= 修复，「继续」= 推进下一批；不要用单字指令的实际动作去猜测扩大改动范围。

## 文档索引

文档按类型分六类（需求 / 产品 / 技术 / 测试 / 品牌 / 规划），完整地图与状态见 **`docs/README.md`**。标记：**现行** = 与代码同步维护；**快照** = 2026-10-19 设计稿，结论已被 B0–B8 取代；**规划** = 未实施。

**需求文档**

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `docs/prd.md` | 整站产品需求（含 C 端） | 快照 |
| `docs/admin-prd.md` | 后台管理系统需求 | 快照（已落地） |
| `docs/gap-analysis.md` | 功能缺口全量审计（GAP-xx 取证索引） | 快照（已补齐） |
| `docs/agent-prd.md` | AI 智能体产品需求 | 规划（不在本轮范围） |

**产品文档**

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `docs/admin-suite-design.md` | 后台总体设计（全域 / RBAC / 路线图） | 设计依据（已落地） |
| `docs/admin-console-design.md` / `admin-detailed-design.md` / `admin-ui-design.md` | 后台功能 / 详细 / 界面设计 | 设计依据（已落地） |
| `docs/commerce-design.md` | 支付 / 积分 / 订单 / 商品 | 设计依据（已落地） |
| `docs/workbench-design.md` / `topnav-design.md` / `login-design.md` / `asset-library-design.md` | 页面级 1:1 规格与实拍审计 | 现行 |
| `docs/multi-image-fusion-spec.md` / `free-creation-parity-audit.md` | 多图融合规格 / 自由创作偏差清单 | 现行 |

**技术文档**

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `docs/environments.md` | 三环境变量矩阵、加载优先级、生产门禁、Docker、排查 | **现行事实源** |
| `docs/model-architecture.md` | 模型通道分层、协议矩阵、调度与配置、请求时序、扩展 SOP | **现行事实源** |
| `docs/layout-unification.md` / `typography-components-details.md` / `refactor-dedup.md` | 布局统一 / 字体细节 / 重复代码抽取 | 实施记录 |
| `docs/agent-technical-design.md` | AI 智能体技术方案 | 规划 |

**测试文档**

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `docs/testing.md` | 四层测试、28 个冒烟 + 22 个 verify/probe 脚本清单、覆盖矩阵、已知红灯、数据清理 | **现行事实源** |
| `docs/development-workflow.md` | **Agent 执行手册**：指令映射（跑 / 改 / 继续）、十三阶段执行卡（目标 / 动作 / 命令 / 退出检查 / 交人）、agent 自主边界与禁令、闸口命令矩阵、证据与交付摘要模板、缺陷卡模板、hotfix、完成定义 | **现行事实源**：agent 自动推进流程时按本文执行 |

**品牌规范**

| 文档 | 内容 |
| --- | --- |
| `docs/brand/brand-basics.md` | 品牌唯一事实源（色板 / 字体 / logo / 口号） |
| `docs/brand/naming.md` | 取名与商标冲突核查 |
