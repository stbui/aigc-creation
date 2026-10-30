# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库工作时提供上下文。定位：**建立坐标 + 单向约束 + 易踩坑**；实现细节指路到代码与 `docs/`，不在此复述。

## 先读这里

- **事实源优先级**：代码 > 现行文档（`docs/environments.md` / `model-architecture.md` / `api-contract.md` / `testing.md` / `prd.md`）。本文件的数量类描述若与代码不符，**以代码为准并顺手改这里**。
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
| AIGC 角标默认样式 | `backend/src/common/aigc-label.config.ts` 的 `AIGC_LABEL_DEFAULTS`；运行期由后台「AI 标识」页覆盖 |
| 后台侧栏与页面分组 | `frontend/src/components/admin/adminNav.ts` 的 `ADMIN_MENU` |
| 接口清单 / 错误码 / 响应信封 | `docs/api-contract.md` |
| 测试清单与覆盖矩阵 | `docs/testing.md`；文档分类地图见 `docs/README.md` |

## 账号

开发 / 测试后台预设账号
admin@admin.com	123456789

生产环境不设默认账号密码，必须通过 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 或 `seed:admin` 生成并保存一次性密码。

可用的测试账号
test@admin.com
dev@admin.com
uat@admin.com

## 开发要点

- 优先使用成熟开源库，如果不满足需求才考虑自研
- 页面注释参照 JSDoc
- 开发阶段，不写兼容代码
- 工业级代码，完整产品
- 后台页面不要设计移动端，不做响应式设计

## 项目概览

**货觉AI**（内部代号 `ecom-vision-mvp`，仓库目录 `aigc-creation`）—— 面向电商团队与个人卖家的智能视觉创作平台。

当前形态 = **C 端创作站 + 独立后台管理端 + 商业运营域 + 账户合规/服务域**：

- **16 项能力**（全部 `real`，0 `mock` / 0 `planned`，12 项进工作台）。**图像、文本、视频都只允许真实模型产出**：无模型线路即失败并退款，不交付伪结果。
- **生成通道**为「模态 × 协议 × 厂商」三层可插拔。`auto/remote` 只调度真实模型线路，存量 `route=local` 明确判不可用；新写入不再接受 `local`。
- **后台管理端**（`/admin`）29 个页面，权限点 + 审计 + 定时任务 + 备份 + 存储切换。
- **商业域**：商品 / 订单 / 支付 / 退款 / 积分账本 / 会员 / 优惠券 / 限时活动 / 邀请签到 / 发票 / 渠道对账。
- **账户与合规域**：找回密码 / 短信登录 / 扫码登录 / 第三方登录（OAuth2 / OIDC）/ 自助注销与数据导出 / 法务版本化与同意留痕 / 站内消息 / AIGC 标识 / 限流 / 健康检查 / 请求追踪。
- **服务域**：工单、后台全局搜索、批量动作与 CSV 导入导出。

## 技术栈

| 层 | 技术 | 版本（运行时依赖精确锁定；e2e / @types 例外） |
| --- | --- | --- |
| 后端 | NestJS + Prisma + **自研 node:sqlite driver adapter** | 12.1.3 / 7.10.0 |
| 配置 | @nestjs/config（零依赖手写 validate） | 12.0.1 |
| 日志 | 自研 AppFileLogger（落盘 + 轮转 + 脱敏） | 无新增依赖 |
| 数据库 | SQLite（`backend/dev.db`），`node:sqlite` 内置模块 | 需 Node ≥ 22.12 |
| 图像 | Jimp（仅上传校验 / 尺寸探测 / AIGC 角标，不生成图片） | 1.6.1 |
| 鉴权/加密 | jsonwebtoken / bcryptjs | 9.0.3 / 3.0.3 |
| 前端 | Vite + React + antd + lucide-react + react-router-dom | 8.3.4 / 19.3.0 / 6.6.6 / 1.57.0 / 7.18.4 |
| 前端其他 | qrcode（邀请海报 / 扫码登录）/ Playwright（e2e） | 1.5.4 / `^1.64.1`（仅 e2e 允许 `^`） |
| 前端测试 | Vitest + jsdom + Testing Library | 5.0.5 / 30.1.3 / 16.3.3 |
| 语言 | TypeScript | 后端 5.7.2 / 前端 7.0.2 |

**版本必须精确锁定**。本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，依赖实际是用 `curl` + `tar` 直装 registry 装出来的 —— 详见「环境注意事项」第 4 条。

TS 配置差异（勿统一）：后端 `strict: false` / `strictNullChecks: false` / CommonJS / ES2021；前端 `strict: true` / ESNext / bundler 解析 / `jsx: react-jsx`。

**云存储是可选依赖**：`STORAGE_BACKEND` 支持 `local`（默认）/ `oss` / `minio`，但 `ali-oss`、`minio` 两个 SDK **当前不在依赖里**，切云端前需先装包。

## 目录结构

```
aigc-creation/
├── start.sh                  # 一键启动（--env development|test|prod；处理端口占用/CORS/建表/种子）
├── README.md                 # 现状速查：页面结构 / 能力清单 / 启动 / 接口 / 页面规格 / 环境坑
├── docs/                     # 需求 / 产品 / 技术 / 测试 / 规划五类，地图见 docs/README.md
│   ├── prd.md                # ★ 需求：整站产品需求、数据模型、非功能要求
│   ├── environments.md       # ★ 技术：三环境变量矩阵 / 加载优先级 / 生产门禁 / Docker / 排查
│   ├── model-architecture.md # ★ 技术：通道分层 / 协议矩阵 / 调度 / 扩展 SOP
│   ├── api-contract.md       # ★ 技术：响应信封 / 错误码 / 接口清单 / 令牌时长
│   ├── runtime-infrastructure.md # ★ 技术：AIGC 标识 / 签名 URL / 限流 / 健康 / 追踪 / 日志
│   ├── testing.md            # ★ 测试：四层测试、闸口清单、覆盖矩阵、已知缺口
│   ├── development-workflow.md # ★ Agent 执行手册：执行卡 / 闸口命令 / 证据标准 / 交人边界
│   ├── admin-*.md            # 需求 + 产品：后台 PRD / 功能 / 详细 / 界面 / 总体设计
│   ├── commerce-design.md    # 产品：支付 / 积分 / 订单 / 商品 / 会员 / 营销
│   ├── <页面>-design.md      # 产品：C 端页面规格（workbench / topnav / login / library）
│   └── agent-*.md            # 规划：AI 智能体需求与集成方案（未实施）
├── docker-compose.yml        # 本地编排：默认=dev，--profile test=test（不同卷、不同库）
├── docker-compose.production.yml # 生产单机编排：migrate 门禁 / 健康探针 / 持久卷 / 仅本机监听
├── backend/                  # NestJS 服务，端口 4100（测试档同端口），全局前缀 /api/v1
│   ├── prisma/schema.prisma  # SQLite provider；无 enum，状态类字段一律 String + DTO 白名单
│   ├── prisma.config.ts      # Prisma 7 连接配置（datasource url 移出 schema；按 NODE_ENV 选档）
│   ├── Dockerfile            # 三阶段镜像（node:24-slim；deps → build → prod）
│   ├── scripts/              # seed* / smoke* / verify* / db-url
│   ├── .env.development / .env.test / .env.production.example  # 三档 env（前两份入库）
│   ├── .env.example          # 环境变量总清单（唯一事实源在 src/config/env.validation.ts）
│   └── src/
│       ├── main.ts           # 前缀/CORS/静态资源/ValidationPipe/拦截器/异常过滤/PORT/HOST
│       ├── config/           # ConfigModule + env-files.ts（三环境档位）+ env.validation.ts
│       ├── common/           # guards / 限流 / 签名 URL / AIGC 标识 / 请求追踪 / 日志
│       │                     # filters / AppError / csv / batch / test-support
│       ├── capabilities/     # registry 门面 + definitions/<id>.ts（能力唯一事实源）
│       ├── providers/        # modality（叶子）/ unified / vendors / protocols / 各协议实现
│       ├── generate/         # 任务创建 + 轮询（generate / tasks controller）
│       ├── admin/            # 后台：guards / 权限点 / 审计 / 调度 / 备份 / 各管理 controller
│       ├── payments/         # 支付三层：沙箱 / 支付宝 RSA2 / 微信 v3 + 回调
│       ├── account/ legal/ aigc-label/ notifications/ tickets/ channels/ health/
│       ├── auth/ projects/ assets/ stats/ storage/ invoices/ prompt-tools/ mobile-upload/
│       └── credits/ orders/ membership/ marketing/ products/
└── frontend/                 # Vite SPA，端口 5100（测试档同端口）
    ├── Dockerfile            # 三阶段：deps → build(--mode production) → nginx
    ├── nginx.conf.template   # SPA 回退 + /api 反代 + /uploads 直出（envsubst 模板）
    ├── .env.development / .env.test / .env.production.example
    └── src/
        ├── App.tsx           # 28 条壳内路由 + 9 条独立页 + /admin/* 子应用
        ├── components/       # AppLayout / SideRail / ToolShell / QrLoginPanel / admin/AdminLayout
        ├── pages/            # 35 个 C 端页面 + pages/admin/ 29 个后台页面
        ├── lib/              # api.ts（request 拆信封）/ http / auth / capabilities / aigc-label / constants
        ├── context/          # AuthContext / AdminContext（权限点）/ CreditsContext
        ├── hooks/            # useToolTask / useProject / useCapabilities / usePollAbort / 上传相关
        └── styles/global.css # 设计令牌 + 全站规则
```

`backend/uploads`（UPLOAD_DIR）、`backend/logs`（LOG_DIR）、`backend/backups`（BACKUP_DIR）均为运行期产物，不入库。

## 常用命令

```bash
# 启动（推荐；端口固定 4100/5100，占用即停掉占用进程再起）
./start.sh                  # 开发；--env test | --env prod 切换档位（两档端口相同，不能并行）
                            # 可选 --build / --skip-db / --with-thumbs / --install
                            #      --backend-only / --frontend-only / --no-follow
                            #      --daemon（PID 记 .run/start.pids）/ --stop（只停）

# 工程门禁（根目录；Node 版本 + 依赖审计 + 构建 + 前端/agent 单测 + 仿真网关）
npm run check

# 手动
cd backend && npm run build && node dist/main.js   # 不要用 nest start（会拒绝清空 dist）
npm run prisma:push         # 建表（首次或 schema 变更后）
npm run db:reset:test       # ★ 删测试库+测试目录 → 重建 → 重灌种子（带安全门禁）
npm run seed                # 需 SEED_USER_EMAIL；未设置则什么都不建
npm run seed:admin          # 后台管理员（dev/test 预设 admin@admin.com / 123456789；生产随机密码）

# 前端
cd frontend
npm run dev                 # vite --mode development（5100）
npm run build:prod          # tsc --noEmit && vite build --mode production
npm run typecheck           # tsc --noEmit
npm test                    # Vitest（jsdom，无需起服务）
npm run e2e                 # Playwright
```

- **种子与冒烟都连当前 `NODE_ENV` 对应的库**（`scripts/db-url.js`）：在测试档跑必须先 `NODE_ENV=test`，否则写的是开发库。
- 冒烟 / verify 脚本按域分组，完整清单与执行前置见 `docs/testing.md`；依赖一致性审计用 `npm run verify:deps:critical`。
- 环境体系自检：`cd backend && npx ts-node -T scripts/probe-environments.ts`。
- Docker 与生产编排见 `docs/docker-deployment.md`；其余命令见 `docs/environments.md`。

## 架构要点

### 能力清单：插件化单一事实源

能力清单**只在 `backend/src/capabilities/definitions/<id>.ts` 定义**，由 `definitions/index.ts` 聚合，经 `capability.registry.ts` 门面导出，再通过 `GET /api/v1/capabilities` 下发给前端。侧栏、卡片、表单、统计分布全部由这份数据渲染 —— **新增能力不需要改前端**。

新增一项能力只需两步：新建 `<id>.ts` 导出 `CapabilityPlugin`，再在 `CAPABILITY_PLUGINS` 数组里加一项。装配期由 `assertCapabilityIntegrity` 校验，漏声明即启动失败。

关键字段：`id / name / group / summary / sidebarHint / badge / mode / modality / buildPrompt / creditCost / inputs(0|1|2) / inWorkbench / help / params[]`。**不存在 `localImpl` / `localFallback`**。

- `mode`（实现程度）：`real` 已接真实模型；`mock` / `planned` 保留枚举但当前 0 项。
- `modality`（产出介质），与 `mode` 正交：`image` / `text` / `video`。当前 15 项 image + 1 项 video；`text` 用于提示词工具等非能力项。
- 新任务 `task.provider` 恒为 `gateway`（初值 `pending`）；`local` 只表示存量历史产出的来源。
- 新增能力时按实际实现程度声明 `mode`：未实现写 `planned`，不得补本地占位或伪模型结果。

### 能力运行时真相（`runtime`）

`GET /capabilities` 每项追加 `runtime: { enabled, route, remoteAvailable, localQuality, effective, reason }`：

| `effective` | 含义 |
| --- | --- |
| `remote` | 有可用模型线路，按下去走真实模型 |
| `disabled` | 后台已下线（`CapabilityControl.enabled=false`） |
| `unavailable` | 没有可用模型线路（或存在已停用的存量 `route=local`）：不可提交 / 任务失败并退款 |

- 由 `capability-availability.service.ts` 合成，3s 缓存，后台写入即 `invalidate()`；**没有 `CapabilityControl` 行 = 启用**。
- 下架必须填原因；`generate.service` 在**扣费之前**拦截并返回 `40005`，原因原样下发到 C 端。
- 界面标注看 `effective`，不看 `mode`；`effective` 是事前预期，实际失败不回落本地产出。
- **积分价**运行时一律走 `CreditPriceService.resolve()`（后台可改）；**限时免费**命中进行中的 `Campaign(type='limited_free')` 时直接返回 0，优先级高于后台覆盖价，缓存 3s 到点自动恢复。

### 生成通道：模态 × 协议 × 厂商

> 完整分层、请求时序、扩展 SOP 见 **`docs/model-architecture.md`**；本节只保留必须记住的约束。

依赖方向单向（勿反转）：**应用层 → 统一能力层（unified）→ 厂商层（vendors）→ 协议层（protocols）→ `modality.ts`（叶子）**。

**协议清单**（协议名**跨模态复用**，任何「按协议名推断能力」的写法都是错的，必须看 `(modality, protocol)` 二元组）：

| 模态 | 协议 | 端点 | 形态 | 参考图回传 |
| --- | --- | --- | --- | --- |
| image | `openai` | `POST {base}/v1/images/generations` | 同步，一次阻塞到出图 | base64 data URL |
| image | `volcengine` | `POST {base}/images/generations` | 同步 | 公网 URL |
| image | `minimax` | `POST {base}/v1/image_generation` | 同步 | 公网 URL（仅 1 张） |
| text | `openai-chat` | `POST {base}/v1/chat/completions` | 同步 | 协议层不声明；多模态识图由工具层构造 base64 content 块 |
| video | `minimax-video` | `POST {base}/v1/video_generation` → `/v1/query/video_generation` → `/v1/files/retrieve` → 下载 | 异步四段式 | 公网 URL |

`modelverse` 保留为 `openai` 的**历史别名**，新配置请用 `openai`。默认协议：image 为 `openai`、text 为 `openai-chat`；`gateway.config.ts` 的空值兜底必须与之一致 —— 两处默认值不同会让「后台看到的默认」与「实际生效的默认」打架，极难排查。

**图像协议的实测差异（踩坑高发区）**：

| 厂商 | 尺寸写法 | 响应结构 | 错误识别 |
| --- | --- | --- | --- |
| 优云智算 / 硅基流动 / OpenAI | `size: "2048x1152"` | `data[0].url` | `error.message` |
| 火山方舟 | `size: "2K"`（档位，不接受像素） | `data[0].url` | `error.message` |
| MiniMax | `aspect_ratio: "16:9"`（无 size 字段） | `data.image_urls[]`（**data 是对象**） | **HTTP 200 也可能是失败**，错误只在 `base_resp.status_code` |

按 OpenAI 的 `data[0].url` 去取 MiniMax 会得到 `undefined`；MiniMax 失败不识别就会把「失败响应」当成「无产出图」，丢掉真实错误原因。共用骨架在 `image-provider-base.ts` 的 `BaseImageProvider`，各协议子类只声明端点 / 尺寸写法 / 响应字段三处差异。

**格式必须按字节魔数判定，不能看 URL 后缀**。多家返回的链接 `.../d8021...` **无扩展名**；`generate.service` 按 `format` 决定落库扩展名与存储 mime，猜错会把 PNG 字节以 `image/jpeg` 入库 —— 用 `sniffImageFormat()`。

**图像 / 文本协议当前都是同步的**：不存在「提交任务 + 轮询」的图像协议。`ProtocolSpec.mode` / `pollEndpoint?` 作为通用异步契约字段保留（视频走独立的 `VIDEO_PROTOCOL_SPECS`），故图像通道的 `GATEWAY_{MODALITY}_POLL_MS` / `_MAX_POLLS` 不参与出图。

### 失败策略：所有模态都不回落本地

| 模态 / 能力 | 失败时 | 错误码 |
| --- | --- | --- |
| image，无可用线路或存量 `route=local` | 任务失败并退款 | `42204` |
| image，有线路但全部失败 | 任务失败并退款 | `42201` |
| image，带遮罩但没有 edits 协议线路 | 任务失败并退款 | `42205` |
| text | 返回 502 + 可读错误 | HTTP 502 |
| video | 如实失败并退款 | 视频路由错误码 |

本地图像生成算法已于 2026-10-25 删除；失败后不会合成、裁剪或占位出图，`generate.service` 按任务快照统一退款。

**未知协议必须走失败路径**：`CapabilityRouterProvider.pickProtocol()` 对未知协议抛错，由调度器记为该线路失败并尝试下一条；全部失败时任务 `42201`，原因写入 `ModelCallLog.reason`，不静默换协议。

### 厂商目录与后台模型配置

`vendor.catalog.ts` 是厂商唯一事实源（一家一条），`vendor.presets.ts` 派生「模态 × 厂商」视图。已内置 7 家：`modelverse` / `siliconflow` / `openai`（image+text）、`volcengine`（image）、`minimax`（image+video）、`deepseek` / `moonshot`（仅 text）。

**DeepSeek / Moonshot 只进文本通道**：两者标称「OpenAI 兼容」指 `/v1/chat/completions` 的**文本**兼容，**没有图像生成端点**，配到生图通道必然 404。

**通道配置优先级：环境变量 > 后台 `ModelChannelConfig`（DB）> 代码默认**。某模态一旦有线路，旧版 `gateway.<modality>.*` 的 baseUrl/token/model/provider 不再参与调度（超时 / 轮询仍生效）。存量单前缀 `GATEWAY_BASE_URL` / `GATEWAY_TOKEN` 仅对 image 继续生效；默认零配置时能力显示不可用，**不会本地生成**。

多渠道灾备由 `channel-scheduler.ts` 负责：按 `priority` 升序选通道、跳过冷却中的通道、失败记一笔并试下一条，连续失败达阈值即熔断冷却（刻意不做权重随机 —— 排障要能说出「刚才走的是哪条」）。变量矩阵见 `docs/model-architecture.md` §8 与 `docs/environments.md`。

### 配置层 + 三环境体系

`ConfigModule` 是 `AppModule.imports` 的**第一项**（`isGlobal`；顺序错不会立刻报错，只会运行期注入到 undefined）。校验用**零依赖手写** `validateEnv`（`src/config/env.validation.ts`），三条硬约束：

1. **绝不改写 `process.env`**，只产出配置树（直接读 `process.env.X` 的存量代码行为 1:1 未变）。
2. **类型错误即启动失败**（`PORT=abc` 直接抛 `EnvValidationError` 并指名变量，不再静默绑随机端口）。
3. **默认值逐项抄自现有硬编码兜底值**，不擅自改默认行为。

`ENV_SPECS` 是启动期校验变量的唯一事实源。网关变量 `GATEWAY_{MODALITY}_*` / `GATEWAY_ROUTE_<ID>` 由 `providers/channel-config.defs.ts` 动态生成，**不经过 `validateEnv`**；改键名要同步该文件。

**三环境（开发 / 测试 / 生产）完整说明见 `docs/environments.md`**，只列必须记住的：

- 档位逻辑在 `src/config/env-files.ts`（Nest 侧）与 `scripts/db-url.js`（脚本侧，**必须逐字一致**，否则出现「Nest 连 test.db、seed 往 dev.db 塞数据」）。
- **`test` / `production` 刻意不回落 `.env` 与 `.env.local`**：共享 `.env` 的 `DATABASE_URL=file:./dev.db` 一旦被继承，隔离形同虚设且**无任何报错**。
- **空串 ≠ 未设置**：`CORS_ORIGINS=""` 会让 `loadEnvFiles` 跳过覆盖，值静默失效。按需注入，别无脑导出空串。
- `production` 的**拒绝启动**门禁（非告警）：`JWT_SECRET` 未设置、`DATABASE_URL` 仍是开发默认值。
- 启动日志第一屏回显环境名 / 库路径 / 上传目录 ——「以为在测、实际连着开发库」是这套体系最需要防的乌龙。
- **新增环境变量**同步四处：`ENV_SPECS`、`.env.example`、三档 env、`scripts/db-url.js`（仅影响库路径时）。

### 后台管理端（`/admin`）

独立外壳（`AdminShell` + `components/admin/AdminLayout`），与 C 端 `AppLayout` 完全分离：C 端侧栏/顶导/促销条都是消费级语义，不能复用。

**权限链**：`AdminGuard`（身份）→ `PermissionGuard`（权限点）→ controller → `AuditInterceptor`（落 `AdminAuditLog`）。权限点定义在 `src/admin/permissions.ts`。**前端 `AdminContext.can()` 只用于隐藏无权限按钮，不是安全边界**；真正的校验必须在后端。

29 个页面、8 个侧栏分组以 `adminNav.ts` 的 `ADMIN_MENU` 为准；页面功能、接口与交互见 `docs/admin-console-design.md` / `admin-detailed-design.md`。

- 高危动作（删除 / 重置密码 / 退款 / 手动调整积分 / 模型配置写入 / 角色与系统设置写入 / 手动备份）须填原因并写审计（`HIGH_RISK_PERMISSIONS`）。
- 批量动作：`ids ≤ 100`，`runBatch` 串行、**不包事务**，逐条返回结果；路由挂较弱读权限，处理器内再判动作权限。
- CSV 统一走 `common/csv.ts`（BOM + RFC4180 + 公式注入前导 `'`）；前端 `downloadCsv()` 不走 JSON 信封。
- 后台通用骨架已是 antd 原生组件，`adm-*` 仅用于业务布局 class；改动时不要退回自绘 `div/button/input/select`。

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
- **提示词工具**：走 text 模态，通道不可用返回 502，**不回落**。

### 前端路由与接口

- 完整路由表即 `frontend/src/App.tsx`；页面清单见 `README.md`「页面结构」，后端接口见 `docs/api-contract.md`。
- **`/admin/*` 必须注册在 catch-all 之前**，否则会被吞进 C 端 Shell；未匹配落 `NotFoundPage`（`path="*"`）。
- **C 端路由对外开放**：未登录可浏览，需要身份的动作唤起登录弹窗，`/login` 仅作深链接兜底。
- 前端 `VITE_API_BASE` **默认留空**走同源：开发态 Vite 代理 `/api` 与 `/uploads`，生产态 Nginx 反代。跨域部署才填绝对地址，且后端 `CORS_ORIGINS` 必须包含它。

## 开发约定

### 常见改动：从哪下手

| 要做什么 | 必改的文件 | 同步/校验 |
| --- | --- | --- |
| 新增一项能力 | `capabilities/definitions/<id>.ts` + `definitions/index.ts` | 启动期 `assertCapabilityIntegrity`；`verify-capability-*` |
| 新增厂商 | `providers/vendors/vendor.catalog.ts` 加一条 | `vendor.presets.ts` 自动派生；`verify-vendor-aggregation` |
| 新增协议 | `protocol.spec.ts` 加协议形状 + `provider-factory.ts` 加映射 + provider 实现 | 图像能力继承 `BaseImageProvider` 只声明三处差异；未知协议**显式抛错** |
| 新增后台页 | `admin/permissions.ts` → controller 挂 `@RequirePermission` → `adminNav.ts` → `pages/admin/*.tsx` → 路由 → `lib/api.ts` | 前端 `can()` 只隐藏按钮，权限必须在后端 |
| 新增环境变量 | `ENV_SPECS` + `.env.example` + 三档 env；通道类再加 `channel-config.defs.ts` | `probe-environments.ts`；`docs/environments.md` |
| 调整积分价 / 退款规则 | `definitions/<id>.ts` 的 `creditCost` / `settings.dto.ts` 的 `SETTING_DEFS` | 运行时走 `resolve()` 与设置读取，不写死 |

### 样式：语义化 token，禁止硬编码色值

全站样式在 `frontend/src/styles/global.css` 的 `:root` 定义令牌（含主题/暗色块），页面**一律引用 `var(--token)`，不写裸 hex**：

```
品牌紫（唯一主色 #5546d8）  --brand / --brand-light（仅渐变浅端）/ --brand-hover / --brand-bg
中性色（单一冷灰族）        --text-strong #171a2b / --text-body #4e5969 / --text-muted #667085
                            --text-desc #86909c / --border #e5e7ef / --surface #f2f4f7
圆角（只用这 5 档 + 胶囊）  --radius-tag 4 / --radius-control 8 / --radius-card 12
                            --radius-panel 16 / --radius-hero 24 / --radius-pill 999
```

**色值冲突的真实 bug 警示**：`--color-primary` 曾是蓝色 `#2563eb`，与紫系页面混用导致 hover 时蓝紫跳变，现已归位为品牌紫。新增颜色前先查是否已有语义合适的 token；确需新增则定义 token 并全站替换，不留同义簇。

**设计一致性优先**：品牌紫 `#5546D8`、冷灰中性色族、五档圆角优先于任何单页的局部数值。判断「某页与其它页不一致」时先按全站令牌校准；页面规格文档与 `global.css` 冲突时以 `global.css` 为准。

### 仓库约定

- 根目录有 `.git`（`main` 分支，未配置远端）；历史与回滚可用，但**不要代为 commit**。
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

文档分五类（需求 / 产品 / 技术 / 测试 / 规划），**完整地图与命名放置规范见 `docs/README.md`**。标记：**现行** = 与代码同步维护；**规划** = 未实施，不得写成现状。

| 类别 | 文档 |
| --- | --- |
| 需求 | `docs/prd.md`（整站）、`admin-prd.md`（后台）、`agent-prd.md`（规划） |
| 产品 | `admin-suite/console/detailed/ui-design.md`、`commerce-design.md`、`workbench/topnav/login/library-design.md` |
| 技术 | `environments.md`、`docker-deployment.md`、`model-architecture.md`、`api-contract.md`、`runtime-infrastructure.md`、`typography.md`、`agent-integration-design.md`（规划） |
| 测试 | `docs/testing.md`（四层测试、闸口清单、覆盖矩阵、已知缺口） |
| 流程 | `docs/development-workflow.md`（Agent 执行手册：指令映射、执行卡、闸口矩阵、证据标准、交人边界） |
