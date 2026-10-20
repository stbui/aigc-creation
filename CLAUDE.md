# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库工作时提供上下文。

## 项目概览

**货觉AI · MVP**（2026-10-19 定名；内部代号 `ecom-vision-mvp`，仓库目录 `aigc-creation`）—— 面向电商团队的智能视觉创作平台，页面结构与功能对标 **极画AI 工作台**（https://ijihua.cn/workbench）。

> 品牌唯一事实源：`docs/brand/brand-basics.md`（定位/口号/色板/字体/logo 规范/落地清单）；取名与商标冲突核查：`docs/brand/naming.md`。改色/改形/改口号属品牌级变更，须先改上述文件再动代码。

当前形态 = **C 端创作站 + 独立后台管理端 + 商业运营域**：

- **16 项能力**（9 `real` / 7 `mock` / 0 `planned`，13 项进工作台）。`real` 中 8 项为图像（7 项 Jimp 本地真实算法 + 自由创作已接云端模型），1 项为视频（图生视频走 MiniMax，无本地兜底）。
- **生成通道**为「模态 × 协议 × 厂商」三层可插拔，图像按能力路由并可自动回落本地；文本/视频无本地兜底，失败如实报错。
- **后台管理端**（`/admin`）16 个页面，权限点 + 审计 + 定时任务 + 备份 + 存储切换。
- **商业域**：商品 / 订单 / 支付 / 退款 / 积分账本 / 会员 / 优惠券 / 限时活动 / 邀请签到。

## 技术栈

| 层 | 技术 | 版本（运行时依赖精确锁定，无 `^` / `~`） |
| --- | --- | --- |
| 后端 | NestJS + Prisma + **自研 node:sqlite driver adapter** | 12.1.3 / 7.10.0 |
| 配置 | @nestjs/config（零依赖手写 validate） | 12.0.1 |
| 日志 | 自研 AppFileLogger（落盘 + 轮转 + 脱敏） | 无新增依赖 |
| 数据库 | SQLite（`backend/dev.db`），`node:sqlite` 内置模块 | 需 Node ≥ 22.5 |
| 图像 | Jimp（8 项本地实现，含自由创作兜底） | 1.6.1 |
| 鉴权/加密 | jsonwebtoken / bcryptjs | 9.0.3 / 3.0.3 |
| 前端 | Vite + React + antd + lucide-react + react-router-dom | 8.3.4 / 19.3.0 / 6.6.6 / 1.57.0 / 7.18.4 |
| 前端其他 | qrcode（分享二维码）/ Playwright（e2e） | 1.5.4 / `^1.64.1`（仅 e2e 允许 `^`） |
| 语言 | TypeScript | 后端 5.7.2 / 前端 7.0.2 |

**版本必须精确锁定**。本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，依赖实际是用 `curl` + `tar` 直装 registry 装出来的，安装器不解析 semver 一律取 latest —— 详见「环境注意事项」第 4 条。

TS 配置差异（勿统一）：后端 `strict: false` / `strictNullChecks: false` / CommonJS / ES2021；前端 `strict: true` / ESNext / bundler 解析 / `jsx: react-jsx`。

**云存储是可选依赖**：`STORAGE_BACKEND` 支持 `local`（默认）/ `oss` / `minio`，但 `ali-oss`、`minio` 两个 SDK **当前不在依赖里**，切云端前需先装包；本地路径零云依赖。

## 目录结构

```
aigc-creation/
├── start.sh                  # 一键启动（--env development|test|prod；处理端口占用/CORS/建表/种子）
├── README.md                 # 115KB 详档：逐页复刻说明 + 历轮验证记录 + 环境踩坑
├── docs/
│   ├── environments.md       # ★ 三环境体系（变量矩阵/加载优先级/生产门禁/Docker/排查）
│   ├── brand/                # ★ 品牌唯一事实源 + 取证截图
│   ├── admin-*.md            # 后台：PRD / 功能设计 / 详细设计 / 界面设计 / 总体设计
│   ├── commerce-design.md    # 支付 / 积分 / 订单 / 商品
│   ├── prd.md · gap-analysis.md · refactor-dedup.md
│   └── <页面>*-design.md     # 1:1 规格与实拍审计（workbench / topnav / login / asset-library ...）
├── docker-compose.yml        # 本地编排：默认=dev，--profile test=test（不同卷、不同库）
├── .run/                     # backend.log / frontend.log（gitignore）
├── backend/                  # NestJS 服务，默认端口 3001，全局前缀 /api/v1
│   ├── prisma/schema.prisma  # SQLite provider；无 enum，状态类字段一律 String + DTO 白名单
│   ├── prisma.config.ts      # Prisma 7 连接配置（datasource url 移出 schema；按 NODE_ENV 选档）
│   ├── Dockerfile            # ★ 三阶段镜像（node:24-slim；deps → build → prod）
│   ├── scripts/              # seed* / smoke*（15 个）/ verify* / probe / db-url
│   ├── .env.development      # ★ 开发档（入库）
│   ├── .env.test             # ★ 测试档（入库；独立库/目录/端口/密钥）
│   ├── .env.production.example # ★ 生产样例（复制为 .env.production，含凭据故不入库）
│   ├── .env.example          # 环境变量总清单（唯一事实源在 src/config/env.validation.ts）
│   ├── src/
│   │   ├── main.ts           # 前缀/CORS/静态资源/ValidationPipe/拦截器/异常过滤/PORT/HOST
│   │   ├── config/           # ★ ConfigModule + env-files.ts（三环境档位）+ env.validation.ts
│   │   ├── common/           # guards / interceptors / filters / AppFileLogger / AppError
│   │   ├── capabilities/     # ★ registry 门面 + definitions/<id>.ts（能力唯一事实源）
│   │   ├── providers/        # ★ modality（叶子）/ unified / vendors / protocols / 各协议实现
│   │   ├── prisma/           # prisma.service + 自研 node-sqlite-adapter.ts
│   │   ├── generate/         # 任务创建 + 轮询（generate / tasks controller）
│   │   ├── auth/ projects/ assets/ stats/ storage/
│   │   ├── admin/            # 后台：guards / 权限点 / 审计 / 调度 / 备份 / 各管理 controller
│   │   ├── credits/ orders/ membership/ marketing/ products/
│   │   └── prompt-tools/ mobile-upload/
│   ├── uploads/{original,generated}/   # 静态服务 GET /uploads/*（UPLOAD_DIR 可改）
│   ├── logs/                 # AppFileLogger 产物：app-<日期>.log + .error.log（gitignore）
│   ├── backups/              # 后台备份产物（BACKUP_DIR 可改）
│   └── dev.db                # 开发库（test.db / prod 库各自独立）
└── frontend/                 # Vite SPA，端口 5173（测试档 5273）
    ├── Dockerfile            # ★ 三阶段：deps → build(--mode production) → nginx
    ├── nginx.conf.template   # ★ SPA 回退 + /api 反代 + /uploads 直出（envsubst 模板）
    ├── playwright*.ts / e2e/ # e2e 配置与用例
    ├── .env.development      # ★ 开发档（入库）
    ├── .env.test             # ★ 测试档（入库）
    ├── .env.production.example # ★ 生产样例（VITE_API_BASE 跨域时才需改）
    └── src/
        ├── App.tsx           # 25 条壳内路由 + 5 条独立页 + /admin/* 子应用（见下）
        ├── components/       # AppLayout / SideRail / RailPreview / ToolShell / admin/AdminLayout ...
        ├── pages/            # 29 个 C 端页面 + pages/admin/ 16 个后台页面
        ├── lib/              # api.ts（request 拆信封）/ http.ts / auth.ts / capabilities.ts
        │                     # constants.ts 含 APP_ENV / IS_PROD / API_BASE（构建时注入）
        ├── context/          # AuthContext / AdminContext（权限点）/ CreditsContext
        ├── hooks/            # useToolTask / useProject / useCapabilities / usePollAbort
        ├── styles/global.css # ★ 设计令牌 + 全站规则
        └── types/api.d.ts
```

## 常用命令

```bash
# 推荐：一键启动（自动避开端口占用、自动建表 + 种子、前后端同时起）
./start.sh                  # 开发环境
                            # 可选 --build / --skip-db / --with-thumbs / --install
                            #      --backend-only / --frontend-only / --no-follow
                            #      --env test | --env prod
./start.sh --env test       # 测试环境（独立库 test.db / 3101 / 5273，可与开发并行）
./start.sh --env prod       # 生产环境（需 backend/.env.production 存在）

# 手动启动
cd backend
npm run prisma:push         # 建表（首次或 schema 变更后）
npm run seed                # provision 演示账号（幂等）
npm run build               # nest build
PORT=3002 node dist/main.js # 不要用 nest start（触发安全守卫拒绝清空 dist）

# 三环境专属命令（后端）
npm run start:test          # NODE_ENV=test node dist/main.js
npm run db:push:test        # 建测试库表
npm run db:reset:test       # ★ 删测试库+测试目录 → 重建 → 重灌种子（带安全门禁）
npm run seed:test           # 只灌测试库种子

# 种子（按需组合；seed:all = 演示账号 + 角色 + 商业 + 会员 + 营销）
npm run seed:admin          # 后台管理员（默认 admin@huojue.local，密码仅打印一次）
npm run seed:roles          # 后台角色与权限点
npm run seed:commerce       # 商品（积分包）
npm run seed:membership     # 会员套餐
npm run seed:marketing      # 优惠券 / 活动 / 邀请签到规则

# 三环境构建（前端）
npm run dev                 # vite --mode development（5173）
npm run dev:test            # vite --mode test（5273）
npm run build:prod          # tsc --noEmit && vite build --mode production
npm run typecheck           # tsc --noEmit
npm run e2e                 # Playwright

# 环境体系自检（74 项断言，不连数据库）
cd backend && npx ts-node -T scripts/probe-environments.ts

# Docker（本地编排，dev + test 两个 profile）
docker compose up -d --build                # 开发（13001 / 15173）
docker compose --profile test up -d --build # 开发 + 测试并行
docker compose down -v                      # 连数据卷一起删

# 冒烟验证（需后端已启动；15 个脚本）
cd backend
node scripts/smoke-capabilities.js            # 全能力：真做 9 / mock 7 / 失败 0
node scripts/smoke-main-image-variants.js
node scripts/smoke-detail-sections.js
node scripts/smoke-viral-clone.js
node scripts/smoke-free-creation.js
node scripts/smoke-multi-fusion.js
node scripts/smoke-sku.js
node scripts/smoke-gateway-channel.js         # 58 项断言：四协议路由/回落/请求体/预设完整性
node scripts/smoke-admin.js                   # 后台身份/权限/审计
node scripts/smoke-commerce.js                # 商品/订单/支付/退款/积分
node scripts/smoke-membership.js              # 会员订阅与月度积分
node scripts/smoke-marketing.js               # 优惠券/活动/邀请/签到
node scripts/smoke-storage.js                 # 存储后端切换
node scripts/smoke-backup.js                  # 备份/校验/下载/清理
node scripts/smoke-scheduler.js               # 定时任务手动触发

# 架构与链路闸口（不依赖后台 UI，直接跑服务层/脚本）
npx ts-node -T scripts/verify-architecture-layers.ts   # 分层依赖方向
npx ts-node -T scripts/verify-capability-extensibility.ts
npx ts-node -T scripts/verify-credit-deduction.ts
npx ts-node -T scripts/verify-video-pipeline.ts

# 依赖一致性审计
npm run verify:deps:critical                # 日常用：只查运行时关键链
npm run verify:deps                          # 全量 + 列出已记录无害项
node scripts/verify-deps.js --quiet           # 仅结论，有致命问题 exit 1（可接 CI）
```

**演示账号**：`admin@demo.com` / `demo1234`（登录页「填充演示账号」按钮即用此凭据）。首次上传时前端自动创建「默认项目」。**它不是后台管理员**（见「环境注意事项」第 8 条）。

**环境相关的完整说明见 `docs/environments.md`** —— 变量矩阵、加载优先级、生产门禁、Docker 与排查清单。

注意：冒烟与 seed 脚本**连的是当前 `NODE_ENV` 对应的库**（`scripts/db-url.js`）。
在测试环境跑它们必须先 `NODE_ENV=test`，否则会往开发库写数据。

## 架构要点

### 能力清单：插件化单一事实源

能力清单**只在 `backend/src/capabilities/definitions/<id>.ts` 定义**，由 `definitions/index.ts` 聚合，经 `capability.registry.ts` 门面导出，再通过 `GET /api/v1/capabilities` 下发给前端。侧栏、卡片、表单、统计分布全部由这份数据渲染 —— **新增能力不需要改前端**。

2026-10-20 起每项能力是**自包含对象**：元信息、提示词（`buildPrompt`）、本地实现句柄（`localImpl`）、模态（`modality`）、积分价（`creditCost`）都在一处声明。装配期由 `assertCapabilityIntegrity` 校验，漏声明即启动失败。

新增一项能力只需两步：

1. 在 `capabilities/definitions/` 下新建 `<id>.ts`，导出一个 `CapabilityPlugin`
2. 在 `definitions/index.ts` 的 `CAPABILITY_PLUGINS` 数组里加 import + 一项

`CapabilityPlugin` 关键字段：`id / name / group / summary / sidebarHint / badge / mode / modality / buildPrompt / localImpl? / creditCost / inputs(0|1|2) / inWorkbench / help / params[]`。`ParamType = enum | number | text | boolean`。

`mode` 语义（实现程度）：

- `real` — **已接入真实实现**，界面标「已接入」。含 Jimp 本地真实算法与已接云端模型的能力
- `mock` — 依赖真实模型但尚未接入，本地参数化占位图，界面标注「占位效果」
- `planned` — 参考站有、本项目未实现，界面标「规划中」且不可提交（当前 0 项）

`modality` 语义（产出介质），与 `mode` **正交**：`image` / `text` / `video`。当前 15 项 image + 1 项 video（图生视频）；`text` 用于提示词工具等非能力项。**`real` ≠「本地算法」**：单次请求走云端还是本地回落，以 `task.provider` 为准（`gateway` / `local`），结果卡按它显示徽标（绿=真实模型 / 琥珀=本地算法），不靠 `mode` 猜。

**当前分布**（16 项）：

- `real` 9：商品主图 / 商品详情图 / 智能扩图 / 一键抠图 / 产品精修 / 商品换色 / 旋转角度 / 自由创作 / 图生视频
- `mock` 7：爆款复刻 / 创意生图 / 局部重绘 / 去水印 / 图片翻译 / 多图融合 / 商品SKU图
- 分组：`ecommerce_gen` 6 / `ai_retouch` 8 / `ai_video` 2（自由创作与图生视频）

把某能力接上真实模型后，只需把 registry 里的 `mode` 从 `mock` 改成 `real`，界面「占位」标注自动消失。

**积分价**：`creditCost` 是代码默认值，运行时一律经 `CreditPriceService.resolve()` 取生效价（后台可改）。业务代码**不要直接读 `creditCost`**，否则后台调价不生效。

### 生成通道：模态 × 协议 × 厂商

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
| image | `aigc`（自研网关） | `POST {base}/generation/tasks` + `GET /generation/tasks/:id` | 异步任务 + 轮询 | 站内 URL（`ASSET_PUBLIC_BASE`） |
| image | `openai` | `POST {base}/v1/images/generations` | 同步，一次阻塞到出图 | base64 data URL |
| image | `volcengine` | `POST {base}/images/generations` | 同步 | 公网 URL |
| image | `minimax` | `POST {base}/v1/image_generation` | 同步 | 公网 URL（仅 1 张） |
| text | `openai-chat` | `POST {base}/v1/chat/completions` | 同步 | base64（多模态识图） |
| video | `minimax-video` | `POST {base}/v1/video_generation` + 轮询 | 异步任务 | 公网 URL |

`modelverse` 保留为 `openai` 的**历史别名**（存量配置兼容），新配置请用 `openai`。默认协议是 `openai`；`gateway.config.ts` 的空值兜底与之保持一致 —— 两处默认值不同会让「后台看到的默认」与「实际生效的默认」打架，极难排查。

**四个图像协议的实测差异（2026-10-20 查官方文档 + 实跑取证）**：

| 厂商 | 尺寸写法 | 响应结构 | 错误识别 |
| --- | --- | --- | --- |
| 优云智算 / 硅基流动 / OpenAI | `size: "2048x1152"` | `data[0].url` | `error.message` |
| 火山方舟 | `size: "2K"`（档位，不接受像素） | `data[0].url` | `error.message` |
| MiniMax | `aspect_ratio: "16:9"`（无 size 字段） | `data.image_urls[]`（**data 是对象**） | **HTTP 200 也可能是失败**，错误只在 `base_resp.status_code` |

后三项是踩坑高发区：按 OpenAI 的 `data[0].url` 去取 MiniMax 会得到 `undefined`；MiniMax 失败不识别就会把「失败响应」当成「无产出图」，丢掉真实错误原因。

共用骨架（鉴权 / 参考图编码 / 下载 / 魔数嗅判）在 `image-provider-base.ts` 的 `BaseImageProvider`，各协议子类只声明端点、尺寸写法、响应字段三处差异 —— 新增厂商不必重抄。

**格式必须按字节魔数判定，不能看 URL 后缀**。多家返回的链接形如 `.../d8021...` **无扩展名**，而 `generate.service` 按 `format` 决定落库扩展名与存储 mime，猜错会把 PNG 字节以 `image/jpeg` 入库。故用 `sniffImageFormat()`（魔数判定）。

**aigc 网关契约**：`POST /api/v1/generation/tasks` → 任务 id；`GET /api/v1/generation/tasks/:id` → 轮询终态；需 Bearer token。客户端对响应字段做了多别名兼容（`id/taskId`、`status/state`、`outputUrl/resultUrl/assets[0].url/outputs[0].url/data.*`），第三方改字段不会直接打挂。

### 回落策略：按模态区分（勿扩大「必回落」）

| 模态 | 远端失败时 | 理由 |
| --- | --- | --- |
| image | 回落 `MockImageProvider`（本地 Jimp），打 WARN | 本地算法真能出图，用户不白屏 |
| text | **不回落**，返回 502 + 可读错误 | 编模板文案会让用户误以为是模型产出 |
| video | **不回落**，如实失败 | 本地不存在「生成视频」这回事 |

因此「失败必回落、用户始终拿得到图」只适用于**图像**能力；文本/视频**没有本地兜底**，校验器也只对 `image` 模态强制要求 `localImpl`。

**未知协议必须回落，不能让图像任务失败**：`CapabilityRouterProvider.pickProtocol()` 对未知协议抛错，但该调用**必须在 `try` 内** —— 放外面会让异常穿透到 `generate.service`，任务直接 `failed`。放进 `try` 后它与通道失败走同一条回落路径，同时把「未知协议 xxx」写进 `ModelCallLog.reason`，静默失败照样看得见。

### 厂商目录与后台模型配置

`providers/vendors/vendor.catalog.ts` 是厂商唯一事实源（一家厂商一条），`vendor.presets.ts` 派生出「模态 × 厂商」视图供后台下拉使用。选厂商自动填「基址 + 协议 + 推荐模型」，令牌手填，填完仍可微调。

已内置 7 家：`modelverse`（优云智算，image+text）/ `siliconflow`（硅基流动，image+text）/ `openai`（官方，image+text）/ `volcengine`（火山方舟，image）/ `minimax`（image+video）/ `deepseek`（仅 text）/ `moonshot`（仅 text）。

**DeepSeek / Moonshot 只进文本通道**：两者标称「OpenAI 兼容」指 `/v1/chat/completions` 的**文本**兼容，**没有图像生成端点**。把它们配到生图通道必然 404 → 回落本地，恰好制造本该消除的静默失败。

后台「模型配置」还提供：通道增删改、连通性测试（`POST /admin/model-config/test`）、单通道测试、调用记录（`ModelCallLog`，含回落原因）。通道健康检查与自动降级由 `channel-scheduler.ts` 负责。

### 配置层（@nestjs/config）+ 三环境体系

`ConfigModule` 是 `AppModule.imports` 的**第一项**（`isGlobal`，注册顺序错不会立刻报错，只会运行期注入到 undefined）。

校验用**零依赖手写** `validateEnv`（`src/config/env.validation.ts`），不引 joi —— 依赖树纪律见「环境注意事项」第 4 条。三条硬约束：

1. **`validateEnv` 绝不改写 `process.env`**，只产出配置树。故 `jwt.service` / `gateway.config` / `storage.service` / `model-config.service` 里直接读 `process.env.X` 的代码行为 1:1 未变。
2. **类型错误即启动失败**。`PORT=abc` 旧代码会变 NaN 传给 `app.listen()` 静默绑随机端口，现在直接抛 `EnvValidationError` 并指名变量（`main.ts` 捕获后按清单多行打印 + `exit 1`）。
3. **默认值逐项抄自现有硬编码兜底值**，不擅自改默认行为。

`ENV_SPECS` 是环境变量的唯一事实源，`.env.example` 与之对齐。除日志/网关/存储外，还包括 `BACKUP_DIR`、`STORAGE_BACKEND`、`OSS_*`、`MINIO_*`。

**三环境（开发 / 测试 / 生产）—— 完整说明见 `docs/environments.md`，此处只列必须记住的：**

| 项 | development | test | production |
| --- | --- | --- | --- |
| env 文件 | `.env.development` | `.env.test` | `.env.production`（不入库） |
| 数据库 | `file:./dev.db` | `file:./test.db` | 必须 ≠ `file:./dev.db` |
| 上传目录 | `uploads` | `uploads-test` | 绝对路径 + 卷 |
| 备份目录 | `backups` | `backups-test` | 绝对路径 + 卷 |
| 日志目录 | `logs` | `logs/test` | 绝对路径 + 卷 |
| 端口（后端/前端） | 3001 / 5173 | 3101 / 5273 | 由 env 文件决定 |

档位选择逻辑在 `src/config/env-files.ts`（Nest 侧）与 `scripts/db-url.js`（脚本侧，**必须与前者逐字一致**，否则会出现「Nest 连 test.db、seed 往 dev.db 塞数据」的错位）。两条硬规则：

- **`test` / `production` 刻意不回落 `.env` 与 `.env.local`**。共享 `.env` 里的 `DATABASE_URL=file:./dev.db` 一旦被继承，隔离形同虚设且**无任何报错**。
- **空串 ≠ 未设置**。`CORS_ORIGINS=""` 会让 `loadEnvFiles` 跳过覆盖，`.env` 里的值静默失效。按需注入变量，别无脑导出空串。

`production` 的两条**拒绝启动**门禁（非告警）：`JWT_SECRET` 未设置、`DATABASE_URL` 仍是开发默认值。`main.ts` 启动日志第一屏回显生效的环境名 / 库路径 / 上传目录 —— 「以为在测、实际连着开发库」是这套体系最需要防的乌龙。

**新增任何与环境相关的变量时**，同步改这三处：后端 `ENV_SPECS`、各档 `.env.{env}`、`scripts/db-url.js`（若影响库路径）。

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

### 后台管理端（`/admin`）

独立外壳（`AdminShell` + `components/admin/AdminLayout`），与 C 端 `AppLayout` 完全分离：C 端侧栏/顶导/促销条都是消费级语义，不能复用。

**权限链**：`AdminGuard`（身份）→ `PermissionGuard`（权限点）→ controller → `AuditInterceptor`（落 `AdminAuditLog`）。权限点约 50 个，定义在 `src/admin/permissions.ts`，角色存 `AdminRole`。**前端 `AdminContext.can()` 只用于隐藏无权限按钮，不是安全边界**；真正的校验必须在后端。

16 个页面（按侧栏分组）：平台概览；用户管理 / 素材管理 / 任务监控；优惠券 / 限时活动 / 邀请与签到 / 能力消耗价（商品、订单、积分账本为 planned）；角色权限 / 系统设置 / 存储配置 / 定时任务 / 操作审计；模型配置 / 调用记录；数据备份（保留期清理为 planned）。

高危动作（删除 / 退款 / 调价 / 手动调整积分）要求填写操作原因并写审计日志。定时任务由 `SchedulerService` 轮询执行、后台可手动触发：订单超时关闭、积分到期回收、会员到期与月度积分、数据备份、保留期清理、活动到期收尾。备份支持手动/定时、SHA-256 校验、下载、按份数裁剪。

### 商业域：积分 / 会员 / 订单 / 营销

- **积分**：`CreditLot`（批次，含到期时间）+ `CreditLedger`（流水：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim`）。消耗按 **FEFO**（先到期先扣，NULL 视为最晚到期）跨批次扣减，余额不足整体回滚并报 `40002`（前端按 402 语义处理）。
- **生成计费**：`generate.service` 在**创建任务时**扣积分，`task.creditCost` 记录快照；失败/取消按快照**原额退还**，不重新取价。扣费与建任务不能同事务，故失败退款是对该代价的兜底。
- **会员**：`MembershipPlan` → `Membership`（订单支付后生效）/ `MembershipUsage`；到期由调度任务处理并按月发积分。
- **交易**：`Product`（积分包/套餐）→ `Order` / `OrderItem` → `Payment`；退款走 `Refund`，同时回收已发积分（`reclaimForOrder`）。后台可标记已支付、退款，均需原因。
- **营销**：`Coupon`（优惠券）/ `Campaign`（限时活动）/ `InviteRelation` + `InviteRewardRule`（邀请）/ `CheckinRecord` + `CheckinRule`（签到）；C 端接口在 `marketing.controller.ts`。

### 其他能力模块

- **提示词工具**（`prompt-tools`）：AI 润色、图片转提示词。走 text 模态，通道不可用返回 502，**不回落**。
- **手机上传**（`mobile-upload`）：创建一次性会话 + 令牌，手机扫码上传、桌面端接收，避免把素材先传到聊天工具。
- **存储**（`storage`）：`local`（默认）/ `oss` / `minio`，按 `STORAGE_BACKEND` 切换；后台上报状态与连通性探测。切云端前需先装对应 SDK。

### 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 能力清单（公开免登录），前端全部渲染依据 |
| POST | `/api/v1/auth/register` | 注册，**直接返回 `accessToken`**（注册即登录） |
| POST | `/api/v1/auth/login` | 登录，返回 `{ accessToken, user }` |
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
| POST | `/api/v1/membership/{subscribe,cancel}` | 订阅 / 取消 |
| GET | `/api/v1/products/:sku` | 商品详情（结算页用） |
| GET | `/api/v1/orders/:id`、POST `/pay` | 订单详情 / 发起支付 |
| GET | `/api/v1/marketing/{popup,invites,checkin}` | 营销弹窗 / 邀请 / 签到 |
| POST | `/api/v1/prompt-tools/{polish,image-to-prompt}` | 提示词润色 / 图片转提示词 |
| POST/GET/DELETE | `/api/v1/mobile-upload/sessions*` | 手机上传会话 |
| GET | `/api/v1/admin/{me,overview,permissions}` | 后台身份 / 概览 / 权限点 |
| GET/PATCH/POST/DELETE | `/api/v1/admin/users*`、`assets*`、`tasks*` | 用户 / 素材 / 任务管理 |
| GET/PUT/POST | `/api/v1/admin/{credit-prices,products,orders,payments,credits}*` | 交易与积分管理 |
| GET/PUT/POST | `/api/v1/admin/{coupons,campaigns,marketing-rules}*` | 营销管理 |
| GET/POST | `/api/v1/admin/{model-config,model-calls,storage,scheduler,backups,audit-logs,roles,settings}*` | 系统与模型管理 |
| GET | `/uploads/*` | 静态图片（Express 静态中间件，不受 `/api/v1` 前缀影响） |

JWT TTL 默认 7 天（`JWT_TTL` 可覆盖；本地 MVP 无 refresh，生产应恢复短 TTL + refresh）。

### 前端路由

三类外壳：

- **独立页（无侧栏）**：`/`（landing）、`/sitemap.html`、`/legal/:slug`、`/login`、`/mobile-upload`
- **C 端 Shell 内（25 条）**：`/workbench`、`/product-kit`、`/product-detail`、`/viral-clone`、`/free-creation`、`/multi-image-fusion`、`/product-sku`、`/local-redraw`、`/background-remove`、`/watermark-remove`、`/product-retouch`、`/image-translate`、`/image-expand`、`/product-recolor`、`/rotate-angle`、`/tools/:capability`、`/works`、`/library`、`/stats`、`/invitations`、`/packages`、`/checkout/:sku`、`/credits`、`/orders`、`/my-works`
- **后台子应用**：`/admin/*`（16 页，独立 Shell 与鉴权）

未匹配 → 重定向业务首页。**C 端路由已对外开放**（2026-10-19）：未登录可直接浏览，需要身份的动作唤起登录弹窗，`/login` 仅作深链接兜底。

前端 `VITE_API_BASE` **默认留空**，走同源：开发态由 Vite 代理 `/api` 与 `/uploads` 到 `VITE_API_PROXY`，生产态由 Nginx 反代。跨域部署时才填绝对地址，且后端 `CORS_ORIGINS` 必须包含它。

### 数据模型要点

29 个模型，按域分组：

- **用户与权限**：`User` / `AdminRole` / `AdminAuditLog` / `SystemSetting`
- **创作**：`Project` / `Asset` / `GenerationTask`
- **交易**：`Product` / `Order` / `OrderItem` / `Payment` / `Refund`
- **权益**：`CreditLot` / `CreditLedger` / `MembershipPlan` / `Membership` / `MembershipUsage`
- **增长**：`Coupon` / `Campaign` / `InviteRelation` / `InviteRewardRule` / `CheckinRecord` / `CheckinRule`
- **模型通道**：`ModelChannel` / `ModelChannelConfig` / `ModelCallLog`
- **运维**：`BackupRecord` / `CleanupLog`

SQLite provider 不支持 Prisma enum，因此 `kind` / `status` / `capability` / `type` 一律 String 存储，取值范围在 DTO / service 层用白名单强制约束。`Asset.kind` = `original` | `generated`；`Asset.outputOfTask` 是 1:1 反向关系。计费相关字段以**快照**为准（`GenerationTask.creditCost`、`OrderItem.priceCents`），不要事后按当前价重算。

Jimp 内置字体仅含 ASCII，故生成图内文案为英文（如 `AI MAIN IMAGE - taobao`、`(MOCK) - needs real model`）；中文只出现在界面层。

## 开发约定

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

根目录有 `.git`（当前分支 `master`，默认分支 `main`；已有提交 `537d34b`）。历史与回滚可用，但**不要代为 commit**（见「工作纪律」）。

### README 是活的详档

`README.md`（115KB）记录逐页复刻说明、每轮验证记录与闸口结果、设计收拢审计证据、环境踩坑。**改动功能/样式/环境约定后应同步更新 README 对应章节** —— 这是本项目既有的工作方式，不要只改代码。

README 中早期的能力数量描述（15 项 / 7+8）已落后于 registry；**能力事实以 `backend/src/capabilities/definitions/` 为准**。

## 环境注意事项（踩坑，务必遵守）

1. **本机 3001 端口被 aigc 网关占用**（另一个项目 `/Users/bright/github/aigc`，同样用 `3001` + `/api/v1` 前缀）。
   - 直接 `node dist/main.js` 会 `EADDRINUSE`；
   - 若 3001 上跑的是网关，前端登录会**静默 404**（`Cannot POST /api/v1/auth/login`，网关返回自己的响应格式，不报错）。
   - 正确做法：`PORT=3002 node dist/main.js`，前端 `VITE_API_PROXY=http://localhost:3002 npx vite --port 5173 --strictPort`。
   - 或直接用 `./start.sh`（自动挑空闲端口并同步注入 CORS）。
2. **不要用 `nest start`** —— 会触发安全守卫拒绝清空 `dist`。用 `npm run build` + `node dist/main.js`。
3. **CORS 只放行 5173 / 4173**（默认），前端必须用 5173，用 5174 会被拦（测试档放行 5273）。
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
6. **`@nestjs/config` 是纯 ESM，本项目是 CommonJS**。`dist` 里是 `require('@nestjs/config')`，靠 Node ≥ 22.12 的 `require(esm)` 能力工作（当前 Node 22.22.2，实测通过）。
   - 若日后 Node 版本下探到 < 22.12，会直接 `ERR_REQUIRE_ESM`；此时要么升 Node，要么退回 `@nestjs/config@4.x`（CJS + lodash，但 peer 只声明支持 NestJS ≤ 11，需手工处理 peer 冲突）。
   - 它的传递依赖 `dotenv` / `dotenv-expand` / `es-toolkit` 本身全是 CJS，ESM 面只有顶层这一个包，所以风险可控。
7. **`/uploads` 必须在前端代理里**。素材 `sourceUrl` 是 `/uploads/<key>`；开发态 Vite 若不代理它，会把该路径当 SPA 路由返回 `index.html` —— **HTTP 200 但 Content-Type 是 text/html**，图片静默破图，网络面板全绿，极易误判成「上传失败」。`vite.config.ts` 已同时代理 `/api` 与 `/uploads`，新增代理规则时勿漏。
8. **演示账号不是管理员**。`admin@demo.com / demo1234` 的凭据硬编码在前端（`DEMO_CREDENTIALS`，登录页有填充按钮），任何访问者都能拿到，故**刻意不给 admin 角色**。后台账号用 `npm run seed:admin` 生成：默认 `admin@huojue.local`，密码为 20 位随机串，**仅在本次运行输出一次**，不写库、不落盘；重复执行不会重置密码（改密走后台用户管理）。

## 工作纪律

- **不要代为 commit**。用户保留提交权；只在明确要求时提交。
- **不要运行 `tsc` / `build` 自测**（除非用户明确要求）。用户自验；AI 跑闸口不得擅自改码。
- 交付时给**精炼结构化摘要**：file:line 引用 + 校验结果，结论优先。中文输出，禁用 emoji。
- 代码与文档冲突时，**以实际代码为权威源**，文档散文次之。
- 验证铁律：**先跑红再最小修订**，要求真实运行证据（node / tsc / 浏览器实际执行），不信 checklist 自评。
- 「跑」= 执行闸口/build/test，「改」= 修复，「继续」= 推进下一批；不要用单字指令的实际动作去猜测扩大改动范围。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/environments.md` | 三环境变量矩阵、加载优先级、生产门禁、Docker、排查 |
| `docs/brand/brand-basics.md` | 品牌唯一事实源（色板/字体/logo/口号） |
| `docs/brand/naming.md` | 取名与商标冲突核查 |
| `docs/prd.md` / `docs/gap-analysis.md` | 产品需求 / 功能缺口全量审计 |
| `docs/admin-prd.md` / `admin-console-design.md` / `admin-detailed-design.md` / `admin-ui-design.md` / `admin-suite-design.md` | 后台需求、功能、详细、界面、总体设计 |
| `docs/commerce-design.md` | 支付 / 积分 / 订单 / 商品 |
| `docs/agent-prd.md` / `agent-technical-design.md` | AI 智能体产品与技术方案（规划中） |
| `docs/workbench-design.md` / `topnav-design.md` / `login-design.md` / `asset-library-design.md` | 页面级 1:1 规格与实拍审计 |
| `docs/multi-image-fusion-spec.md` / `free-creation-parity-audit.md` | 多图融合规格 / 自由创作偏差清单 |
| `docs/layout-unification.md` / `typography-components-details.md` / `refactor-dedup.md` | 布局统一 / 字体细节 / 重复代码抽取 |
