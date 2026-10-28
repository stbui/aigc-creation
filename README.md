# 货觉AI

面向电商团队的智能视觉创作平台：上传商品图或输入提示词，由真实模型通道产出可上架的主图、详情图、修图结果与短视频。

- 后端：NestJS 12 + Prisma 7 + 自研 `node:sqlite` driver adapter（零原生编译依赖）
- 前端：Vite 8 + React 19 + antd 6 + lucide-react
- 图像生成：仅真实模型通道（OpenAI 兼容 / 火山方舟 / MiniMax）；无可用线路时任务失败 `42204` 并退款，不生成伪结果
- 视频生成：MiniMax 四段式异步，同样只走模型通道（未配通道时如实标注不可用）
- Jimp 1.6 仅用于上传图片校验、尺寸探测与 AIGC 角标合成，不承担任何图像生成

> **本文定位**：只写现状——页面结构、能力清单、目录、启动、接口与环境约束。代码与本文冲突时以代码为准，并顺手改本文。

**配套文档**：
`CLAUDE.md`（目录树、能力与通道约束速查）｜
`docs/README.md`（需求 / 产品 / 技术 / 测试 / 规划五类地图）｜
`docs/api-contract.md`（响应信封、错误码、接口全表）｜
`docs/environments.md`（三环境变量与门禁）｜
`docs/model-architecture.md`（通道分层与协议矩阵）｜
`docs/testing.md`（测试分层、闸口清单与覆盖矩阵）｜
`docs/development-workflow.md`（交付流程与证据标准）。

## 阅读顺序

| 想了解 | 看这些章节 |
| --- | --- |
| 产品长什么样 | 页面结构 → 能力清单 → 工具页规格 |
| 怎么跑起来 | 启动（含端口、CORS、工作台缩略图种子） |
| 接口契约 | 接口 → `docs/api-contract.md`（完整表） |
| 外部模型怎么接 | 接入真实模型 → `docs/model-architecture.md` |
| 踩过的环境坑 | 环境注意事项 |

## 页面结构

| 区域 | 内容 |
| --- | --- |
| 顶部导航 | 品牌｜首页｜电商生图▾｜AI修图▾｜AI视频▾｜我的作品｜购买套餐｜邀请有奖｜联系客服｜算力位｜用户菜单。「联系客服」直达 `/tickets?type=consultation&compose=1`；未登录点「登录/注册」唤起登录弹窗，不跳页 |
| 侧边能力轨 | 宽度随视口在 176px 横排 / 100px 垂直轨之间切换（≤900px 收起为汉堡抽屉）；条目含 24×24 图标 + 能力名；hover 弹出预览卡（`radius 16px`，`shadow 0 10px 24px rgba(35,39,74,.16)`），显示该能力最近一次真实产出，无产出时显示一句话说明 |
| 营销首页 `/` | 七段结构：hero（双层渐变 + 40px/500 `#171A2B` 标题）/ 业务场景 3 卡 / 修图工具 8 入口 / 套餐与加油包（真实价目 4 卡 + 加油包 tab）/ 优秀案例（7 tab × 16 图网格）/ 产品特性 / 页脚。全站免鉴权、无侧栏；资源自托管于 `public/landing/`；能力入口按可见性口径过滤 |
| 工作台 `/workbench` | 212px 浅蓝渐变 hero（标题 32px/500 + 副标题 17px `#667085`，右侧真实产出拼贴）+ 12 张工具卡（radius16 / 2:1 缩略图 / 40×40 白底浮图标块 / 免费角标 / 单行省略描述）+ 数据区 3 面板（2:1 双面板 + 通栏创作数据） |
| 商品主图 `/product-kit` | 上传商品图（≤5 张，点击/拖拽/粘贴）+ 生成设置（名称/品牌/平台/语言）+ 商品描述（AI 分析/放大编辑）+ 自定义配置（白底/场景/卖点/其他四类计数，按计数批量生成）+ 高级设置（比例 8 项 / 画质）+ 渐变提交；右侧结果网格 |
| 商品详情 `/product-detail` | 上传 + 生成设置 + 商品描述 + 包含模块（多选，16 选 ≤10，已选 N/10）+ 高级设置（仅画质）；按模块选择渲染详情长图 |
| 爆款复刻 `/viral-clone` | 上传商品图（≤5 张）+ 上传参考图（≤1 张）+ 生成设置（名称/品牌选填/平台/语言）+ 复刻要求（文本域 ≤1000 字）+ 复刻程度（参考风格/高度复刻）+ 高级设置；商品图、参考图与要求一起进入模型提示词 |
| 自由创作 `/free-creation` | 上传参考图（≤4 张选填，缩略图 80×80 + 排序箭头）+ 创作提示词（必填，AI 润色/图片转提示词，≤4000 字，框高随左栏撑满）+ 高级设置；右侧结果栏按每行 3/4/5/6 张展示本页成功产出，点缩略图开整屏查看器（缩放、拖拽、翻页、下载、右键菜单） |
| 多图融合 `/multi-image-fusion` | 两步流：场景网关（15 场景 2 组：表面附着 7 + 空间摆放 8）→ 工作区（主体图 1 张 + 搭配图 1-5 张 + AI 分析 + 变体张数 + 高级设置）；结果联络图 + 重新生成/一键下载 |
| 商品SKU图 `/product-sku` | SKU 模板图（≤1 张 + 模板上拖拽框选最多 3 个变体区域）+ 使用步骤卡 + SKU 清单编辑器（名称/颜色，按行批量提交，框选坐标随任务提交）+ 高级设置；结果多图并列 + 一键下载 |
| 局部重绘 `/local-redraw` | 上传（≤1 张）+ 重绘区域（画布涂抹导出遮罩 PNG 随任务提交；未涂抹时用位置枚举作提示词兜底）+ 描述（≤1000 字）+ 高级设置；必须配支持图像编辑的线路，否则 `42205` 并退款 |
| 一键抠图 `/background-remove` | 上传（≤1 张）+ 背景颜色（透明底棋盘格默认 / 白 / 浅蓝 / 蓝 / 红 / 深红 / 自定义 HEX）+ 高级设置（比例默认原比例） |
| 去除水印 `/watermark-remove` | 上传（≤1 张）+ 处理方式（自动识别/指定区域 + 五宫格位置）；无高级设置，附合规提示 |
| 产品精修 `/product-retouch` | 上传 + 精修模式（6 项，默认综合精修）+ 补充要求（≤200 字）+ 高级设置 |
| 图片翻译 `/image-translate` | 上传 + 目标语言（10 项，默认简体中文）+ 保护商品主体开关（默认开）+ 高级设置（仅画质） |
| 智能扩图 `/image-expand` | 上传 + 原图占比（100/80/60/50 快捷 + 1-99% 自由输入，默认 80）+ 原图位置（九宫格，默认居中）+ 高级设置 |
| 商品换色 `/product-recolor` | 上传 + 商品颜色（白默认 / 浅蓝 / 蓝 / 红 / 深红 / 自定义 HEX）+ 高级设置 |
| 旋转角度 `/rotate-angle` | 上传（JPG/PNG/WebP）+ 主体/摄像头双 tab 预览 + 三个滑杆（旋转 -90..90 / 倾斜 -30..60 / 缩放 0.8..1.2）+ 高级设置 |
| 工具页 `/tools/:capability` | 上传区（单图/双图按能力声明，PNG/JPEG/WebP、单张 ≤10MB）+ 按参数声明自动渲染的表单 + 结果区（尺寸/格式/重新生成/清空）；创意生图走 `?capability=creative_image`，提交不会误写成 `free_create` |
| 我的作品 `/works` | 全部生成任务，状态筛选、预览、再做一张、删除；失败任务可原地重试（沿用原任务的 `capability` / `inputAssetIds` / `params`，重试前二次确认积分消耗） |
| 素材库 `/library`（别名 `/asset-library`） | 原图与生成图，kind/能力筛选、分组、分页、删除 |
| 数据中心 `/stats` | 6 项指标 + 近 7 天产出柱状图 + 按能力分布（含成功率）+ 最近任务 |
| 登录 / 注册（弹窗 + `/login`） | 三 tab：扫码登录 / 短信登录 / 账号登录；表单下方按后端 `GET /auth/oauth/providers` 渲染第三方登录按钮（Google / GitHub / generic，未配置整块不显示），回调落到 `/auth/oauth/callback` 用 60 秒票据换会话 |
| 账户设置 `/account` | 资料 / 改密（成功后全部旧 token 失效）/ 会员状态与取消续费 / 数据导出 JSON / 注销影响面与注销 |
| 订单 `/orders` | 订单列表与支付；未支付订单可主动取消（`pending → cancelled`）；已支付订单只能走退款 |
| 我的工单 `/tickets` | 提交工单（类型/标题/内容/优先级）+ 工单线程（状态、客服回复、追评）+ 已关闭工单只读；支持 `?type=consultation\|complaint&compose=1` 直达表单 |
| 站点地图 `/sitemap.html` | 公开能力入口 + 账户 / 商业 / 支持页面真实链接 |

**卡片缩略图**：取该能力最近一次成功产出（`GET /stats/overview` 的 `byCapability[].thumbnailUrl`），所以卡片里是用户自己真实生成的结果；没有产出时显示设计化空态，不放假示例图。

## 能力清单（16 项，12 项进工作台）

能力清单只在后端 `src/capabilities/definitions/<id>.ts` 逐项声明，由 `capability.registry.ts` 门面聚合，通过 `GET /api/v1/capabilities` 下发给前端；侧栏、卡片、表单、统计分布全部由这份数据渲染，新增能力不需要改前端。

当前 16 项全部 `real`，0 `mock` / 0 `planned`。新任务产出恒来自模型通道（`task.provider='gateway'`）；`local` 只表示历史产出。能力当前能否提交看 `runtime.effective`，不靠 `mode` 猜。

**入口可见性口径**（`frontend/src/lib/capabilities.ts` 的 `isCapabilityVisible()`）：`planned` 与运营下线的能力（`runtime.effective === 'disabled'`）从顶导 / 侧栏 / 工作台 / 首页案例页签 / 站点地图一并隐藏；`unavailable`（代码已实现、但此刻无可用通道）保留入口，页面内说明原因并只拦截已登录用户的提交——访客点击仍走登录流程。

| 分组 | 能力 | 实现程度 | 模态 | 默认积分 | 工作台 | 说明 |
| --- | --- | --- | --- | ---: | --- | --- |
| 电商生图 | 商品主图 | real | image | 10 | 是 | 商品图 + 名称/品牌/平台/语言/描述/四类变体计数/比例/画质 |
| | 商品详情图 | real | image | 10 | 是 | 名称/品牌/平台/语言/描述/包含模块 16 选 ≤10/SKU/画质 |
| | 爆款复刻 | real | image | 10 | 是 | 名称/品牌选填/平台/语言/复刻要求/复刻程度/比例/画质 |
| | 创意生图 | real | image | 10 | 是 | 提示词 + 比例；必须配图像通道 |
| | 多图融合 | real | image | 40 | 否 | 场景 15 项/变体张数/比例/画质；主体与搭配图交给模型融合 |
| | 商品SKU图 | real | image | 0 | 否 | 模板图 + 最多 3 个框选区域 + SKU 名称/颜色；按行批量提交 |
| AI修图 | 局部重绘 | real | image | 5 | 是 | 画布涂抹遮罩 / 6 位置兜底 / 描述 / 比例 / 画质 |
| | 智能扩图 | real | image | 5 | 是 | 原图占比 1-99% / 九宫格位置 / 比例 / 画质 |
| | 一键抠图 | real | image | 0 | 是 | 背景颜色 7 项含自定义 HEX / 比例 |
| | 去除水印 | real | image | 0 | 是 | 自动识别或指定区域 + 五宫格位置 |
| | 图片翻译 | real | image | 5 | 是 | 目标语言 10 项 / 保护商品主体开关 |
| | 产品精修 | real | image | 5 | 是 | 精修模式 6 项 / 补充要求 ≤200 字 |
| | 商品换色 | real | image | 5 | 是 | 商品颜色 6 项含自定义 HEX |
| | 旋转角度 | real | image | 5 | 是 | yaw -90..90 / pitch -30..60 / zoom 0.8..1.2 |
| AI视频 | 自由创作 | real | image | 10 | 否 | 参考图 0~4 张 + 创作提示词 + 比例 / 画质 |
| | 图生视频 | real | video | 20 | 否 | MiniMax 四段式异步；未配视频通道时 `unavailable` |

`creditCost` 是代码默认值，运行时一律经 `CreditPriceService.resolve()` 取生效价（后台可调，限时活动可为 0）。页面展示的消耗数与实际扣费一致。

无可用模型线路时任务失败 `42204` 并退款，不交付占位图或本地合成的伪模型结果。

## 目录结构

```
aigc-creation/
├── start.sh                    # 一键启动（--env development|test|prod；端口占用即停 + 建表 + 种子）
├── README.md                   # 本文：现状速查
├── docs/                       # 分类文档，地图见 docs/README.md
├── docker-compose.yml          # 本地编排（默认 dev；--profile test 测试档，端口同开发不能并行）
├── docker-compose.production.yml # 生产单机编排（自动建表 / 健康探针 / 持久卷）
├── test/                       # 零依赖仿真模型网关（本地联调与失败注入）
├── backend/                    # NestJS 服务，端口 4100（测试档同端口），全局前缀 /api/v1
│   ├── prisma/schema.prisma    # 43 个模型；SQLite 无 enum，状态类字段 String + DTO 白名单
│   ├── prisma.config.ts        # Prisma 7 连接配置（datasource url 移出 schema，按 NODE_ENV 选档）
│   ├── scripts/                # seed-* / smoke-*（21 个）/ verify-* / probe / db-url
│   ├── src/
│   │   ├── capabilities/       # ★ 能力唯一事实源（definitions/<id>.ts → registry → GET /capabilities）
│   │   ├── providers/          # ★ 模态 × 协议 × 厂商（modality / unified / vendors / protocols）
│   │   ├── generate/           # 任务创建、轮询、扣费与失败退款
│   │   ├── admin/              # 后台：权限点 / 审计 / 调度 / 备份 / 对账 / 各管理 controller
│   │   ├── auth/ account/ legal/ aigc-label/ notifications/ tickets/
│   │   ├── credits/ orders/ payments/ invoices/ membership/ marketing/ products/
│   │   ├── common/             # JWT 守卫 / 限流 / 签名 URL / AIGC 标识 / 文件日志 / 请求追踪 / CSV
│   │   ├── config/             # 三环境档位（env-files.ts）+ 启动期校验（ENV_SPECS）
│   │   └── health/ channels/ storage/ stats/ projects/ assets/ prompt-tools/ mobile-upload/
│   ├── uploads/{original,generated}/   # 静态服务 GET /uploads/*（UPLOAD_DIR 可改）
│   └── dev.db                  # 开发库（test.db / 生产库各自独立）
└── frontend/                   # Vite SPA，端口 5100（测试档同端口）
    ├── playwright*.ts / tests/ # e2e 配置与用例（`e2e/` 只是脚手架示例）
    ├── vitest.config.ts        # 单元 / 组件测试（jsdom，`npm test`）
    └── src/
        ├── **/__tests__/       # Vitest 用例（*.test.ts / *.test.tsx）
        ├── pages/              # 35 个 C 端页面 + pages/admin/ 28 个后台页面
        ├── components/         # AppLayout / SideRail / RailPreview / ToolShell / admin/AdminLayout ...
        ├── lib/                # api.ts（拆信封）/ http.ts / auth.ts / capabilities.ts / constants.ts
        ├── context/ hooks/     # AuthContext / AdminContext（权限点）/ CreditsContext；useToolTask 等
        └── styles/global.css   # ★ 设计令牌（全站唯一色值来源）
```

逐模块注释的完整目录树见 `CLAUDE.md`「目录结构」。

## 启动

**前置**：Node ≥ 22.5（依赖内置 `node:sqlite`）

推荐直接用一键启动脚本（自动处理端口占用、建表 + 种子、前后端同时起）：

```bash
./start.sh                 # 开发档：后端 4100 / 前端 5100
./start.sh --env test      # 测试档：独立库 test.db，端口同开发（两档不能并行）
./start.sh --daemon        # 后台运行（PID 记在 .run/start.pids）
./start.sh --stop          # 停止后台服务
```

源码比 `backend/dist/main.js` 新时脚本会自动 `nest build`，不会拿旧构建起服务。

手动启动：

```bash
# 1) 后端
cd backend
npm run prisma:push        # 建表（首次或 schema 变更后）
npm run seed               # 预置开发账号（需 SEED_USER_EMAIL；未设置则不建任何账号，幂等）
npm run build              # nest build
node dist/main.js          # http://localhost:4100/api/v1（不要用 nest start）

# 2) 前端（另开终端）
cd frontend
npm run dev                # http://localhost:5100
```

前端 `VITE_API_BASE` **默认留空 = 同源**：开发态由 Vite 把 `/api` 与 `/uploads` 代理到 `VITE_API_PROXY`，生产态由 Nginx 反代；只有跨域部署才填绝对地址（此时后端 `CORS_ORIGINS` 必须包含它）。三环境变量矩阵见 `docs/environments.md`。

### 端口固定：被占用时自动停掉，不换端口

端口写死，`./start.sh` 发现被占用会先停掉占用进程再启动（先 TERM，2 秒不退再 KILL，并打印被杀的 PID 与命令行）。换端口会连带改前端代理与 CORS 来源，结果是「看起来起来了，浏览器访问的还是旧实例」。

```bash
./start.sh                 # 开发：4100 / 5100，占用即停
./start.sh --env test      # 测试：4100 / 5100，占用即停，会停掉开发档
./start.sh --env prod      # 生产：只认 .env.production，端口被占直接失败，不自动杀进程
```

生产档刻意不自动杀进程：线上端口上的东西可能不是本项目，静默杀掉代价太大，只报错让人确认。

### Docker 部署

```bash
# 本地开发 / 测试（首次自动建表；migrate 退出 0 属正常）
# 两档默认都占 4100/5100，不能同时运行；并行需覆盖 *_TEST_HOST_PORT
docker compose up -d --build
docker compose --profile test up -d --build

# 生产：先填 backend/.env.production 并 chmod 600
docker compose -f docker-compose.production.yml up -d --build
```

生产默认只监听 `127.0.0.1:5100`，由外层反代终结 TLS；后端不映射宿主机端口。自动建表、健康探针、数据卷、备份恢复、升级回滚与排障见 `docs/docker-deployment.md`。

只匹配 LISTEN 状态的进程，客户端连接不算（否则会把代理 `/api` 的前端 dev server 一起误杀）。手工排查：

```bash
lsof -nP -iTCP:4100 -sTCP:LISTEN    # 谁占着后端
lsof -nP -iTCP:5100 -sTCP:LISTEN    # 谁占着前端
```

### 工作台缩略图种子

工作台卡片与 hero 作品集展示的是每项能力最近一次真实产出。新库没有产出时卡片为空态，用种子脚本走真实 API 逐能力生成一遍（幂等，已有成功产出的能力会跳过）。凭据没有默认值，必须显式提供：

```bash
cd backend
SEED_EMAIL=you@example.com SEED_PASSWORD='…' API=http://localhost:4100 \
  npx ts-node -T scripts/seed-workbench-thumbs.ts
```

### CORS

允许来源由环境变量决定（`backend/src/common/cors-allow-list.ts`），启动日志会打印实际生效的白名单：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `CORS_ORIGINS` | 逗号分隔的显式白名单，给定时覆盖其余规则（生产用这个） | 未设置 |
| `CORS_ALLOW_PRIVATE_LAN` | `1`/`true` 时额外放行私有网段任意端口（`10.` / `172.16-31.` / `192.168.`，供手机同 WiFi 调试） | 关闭 |

未设置任何变量时，默认放行本机开发入口：`http://{localhost,127.0.0.1,[::1]}:5100`（三档统一）。

浏览器端报错排查顺序：先看后端启动日志那行 `CORS origins: ...`，再确认浏览器地址栏的 host:port 是否在列表内——`localhost` 与 `127.0.0.1` 在 CORS 判定上是不同来源，不能互换。

开发账号由环境变量决定：`SEED_USER_EMAIL=dev@example.com npm run seed`（`SEED_USER_PASSWORD` 可指定密码，未指定则随机生成并只打印一次；未设置邮箱时脚本什么都不建）。可选初始积分 `SEED_USER_CREDITS`（默认 0）。登录页不预填任何凭据。后台管理员另用 `npm run seed:admin` 生成，两者是两套账号。首次上传时前端会自动创建「默认项目」。

登录令牌 TTL 默认 7 天（本地 MVP 无 refresh 机制，`JWT_TTL` 环境变量可覆盖；生产应恢复短 TTL + refresh）。

## 环境注意事项

> 环境体系的完整说明（变量矩阵、加载优先级、生产门禁、Docker、排查清单）见 `docs/environments.md`；新增环境变量要同步的位置见 `CLAUDE.md`。

### 端口 / CORS / 代理 / 浏览器巡检

开发档后端固定 4100（全局前缀 `/api/v1`），前端固定 5100。若端口已被其它进程占用，直接 `node dist/main.js` 会 `EADDRINUSE` 失败；若占用者不是本项目，前端登录会静默 404（`Cannot POST /api/v1/auth/login`，对方返回自己的响应格式）。正确启动方式是 `./start.sh`；手工启动则要自己先释放端口。

后端 CORS 只放行 5100（三档同一端口），前端必须用 5100。显式设置 `VITE_API_BASE` 后前端走直连绝对地址而非 Vite 代理，preflight 会被后端 CORS 拒——换端口无效，除非同步把新来源加进 `CORS_ORIGINS`。

补充约束：

- Vite 8 绑 IPv6 `::1`，`127.0.0.1:5100` 不通；curl / Playwright 必须用 `localhost`。
- token 的 localStorage key 是 `ecom_vision_token`（`frontend/src/lib/auth.ts`）。
- Playwright 巡检必须同一 context 内顺序 `goto`：`browser.newPage()` 每次新建 context，localStorage 不共享。

### 依赖安装与嵌套副本

本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，因此依赖用 `curl` + `tar` 直装。`package.json` 已锁定为实际验证通过的精确版本，但 `node_modules` 里的嵌套副本无法由 npm 自动重现：

- `multer/node_modules/type-is@1.6.18` + 其下 `media-typer@0.3.0`（最关键：错版会让 multer 静默不解析 multipart）
- `webpack/node_modules/mime-types@2.1.35`
- `@nestjs/config/node_modules/dotenv@18.0.3`（它精确 pin 18.0.3，而顶层 `dotenv@17.4.2` 属 prisma 链）

审计工具：

```bash
npm run verify:deps            # 全量审计 + 列出已记录无害项及依据
npm run verify:deps:critical   # 只查运行时关键链（推荐日常使用）
node scripts/verify-deps.js --quiet   # 仅输出结论，有致命问题则 exit 1
```

工具按 Node 的真实解析顺序判断（嵌套副本优先、顶层兜底），并维护 `ACCEPTED_PINS`（刻意的精确 pin 偏差）与 `KNOWN_BENIGN`（已验证无影响的偏差簇）两份清单。新增依赖后重跑一次。

## 接口

> 完整接口表（后台管理、商业域、账户与合规、服务域）见 `docs/api-contract.md`「主要接口」；这里只列 C 端主链路。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 能力清单（公开免登录），含 `mode` 与 `runtime`，前端全部渲染依据 |
| POST | `/api/v1/auth/{register,login}` | 注册（直接返回 `accessToken`）/ 登录 `{ accessToken, user }` |
| POST/GET | `/api/v1/auth/qr/{create,status}` | 扫码登录：桌面建码 / 轮询换 token（公开） |
| GET/POST | `/api/v1/auth/oauth/*` | 第三方登录（Google / GitHub / generic）：已启用 provider 列表、authorize / callback、用 60 秒票据换会话 |
| GET/POST | `/api/v1/projects` | 项目列表 / 创建 |
| POST | `/api/v1/assets/upload` | 上传素材（multipart：`file` + `projectId`，均必填），返回含宽高 |
| GET | `/api/v1/assets` | 素材库列表（`kind`/`capability`/`limit`/`offset`） |
| DELETE | `/api/v1/assets/:id` | 删除素材（生成图连带删除产出它的任务） |
| POST | `/api/v1/generate` | 创建生成任务，返回 `{ taskId, status, creditCost }`，异步执行 |
| GET | `/api/v1/tasks/:id` | 轮询任务，`outputAsset.sourceUrl` 为结果图 |
| GET | `/api/v1/tasks` | 任务列表（含 `outputAsset`） |
| DELETE | `/api/v1/tasks/:id` | 删除作品（连带产物与磁盘文件） |
| GET | `/api/v1/stats/overview` | 数据中心聚合（汇总/能力分布/近 7 天/最近任务） |
| GET | `/api/v1/credits/{balance,lots,ledger}` | 积分余额 / 批次 / 流水（FEFO 扣减） |
| GET/POST | `/api/v1/orders*`、`/payments/*` | 订单（含取消未支付单）、沙箱支付、真实渠道支付意图与回调 |
| GET/PATCH/DELETE | `/api/v1/me` | 账户资料 / 更正 / 自助注销；`/me/{password,export}` 改密与导出 |
| GET/POST | `/api/v1/legal*`、`/notifications*`、`/tickets*` | 法务正文 / 站内消息 / 工单 |
| GET | `/uploads/*` | 静态图片（签名开启时需 `sig` 参数） |

所有成功响应统一信封 `{ code: 0, data, message: '' }`，前端 `lib/api.ts` 的 `request()` 负责剥离；异常走 `AppError` + `AllExceptionsFilter`，跨模块错误码表见 `docs/api-contract.md`。

生成图内的文字由模型能力决定，不由本地字体渲染；完整中文参数记录在任务里，结果卡片 meta 行可见。

## 接入真实模型

模型接入是配置，不是改代码：

1. 后台 `/admin/model-config` 新增线路（选厂商自动填基址 / 协议 / 推荐模型，令牌手填），或按模态配置 `GATEWAY_{IMAGE,TEXT,VIDEO}_*` 环境变量。优先级：环境变量 > 后台 DB > 代码默认。
2. 同模态多线路按 `priority` 升序做主备；失败记一笔并试下一条，连续失败达阈值熔断冷却（`channel-scheduler.ts`）。
3. 生效范围看 `GET /capabilities` 的 `runtime.effective`：有可用模型线路为 `remote`，否则为 `unavailable`；不出现 `effective='local'`。

失败策略统一为「显式失败 + 退款」：无可用线路 `42204`，线路全部失败 `42201`，遮罩任务没有支持 edits 的线路 `42205`；文本返回 502、视频如实失败。任何模态都不回落本地算法，也不编造产出。

`mode` 只表示代码实现程度（`real` / `planned`），与单次请求无关——新任务的 `task.provider` 恒为 `gateway`；建任务初值 `pending`。

**本地联调：仿真模型网关**（`test/`，零依赖）——没有真实凭据时用它把渠道配置测通：

```bash
cd test && node server.js     # http://127.0.0.1:3900
```

文本协议填 `openai-chat` / 模型 `gpt-4o`，图像填 `openai` / 模型 `gpt-image-2`（或 `minimax` / `image-01`），视频填 `minimax-video` / 模型 `MiniMax-Hailuo-2.3`；基址只填根域，不要带 `/v1`。产物是真实 PNG 与可解码 MP4（内容为仿真画面），支持 `[[fail]]` / `[[401]]` / `[[429]]` 失败注入。详见 `test/README.md`。

## 工具页规格

### 共享外壳

前 4 个工具页（商品主图 / 商品详情 / 爆款复刻 / 自由创作）共用同一外壳：左输入栏 432px + 右结果栏（grid `432px 1fr` `gap 16`，输入栏 `form-scroll` 内部滚动、底部提交区 `margin-top auto` 推底），结果栏白底 `radius 16`；卡片白底 `radius 16 / padding 16 / gap 16`（表单卡间距 10）；必填星号 `::before` `#EB5757`；输入项 400×32（`radius 4`、边 `#E5E7EF`、`padding 5px 12px`）；上传区 400×160 虚线框；主按钮 400×40 `linear-gradient(90deg,#8064F6,#5546D8)`（文案 14px/700）；结果空态 160×160 插画 + 「效果图预览」。

各页特有结构：

| 页面 | 特有结构 |
| --- | --- |
| product-kit | 自定义配置四类计数（展开多次生成）；结果网格 1:1 卡片 |
| product-detail | 包含模块 16 选 ≤10（2 列 × 192，选项 192×66，复选框 14×14 `accent #625DF5`） |
| viral-clone | 参考图单张上传区（无计数器）；复刻要求卡（textarea 400×80 `rows 3 / maxlength 1000`）；复刻程度卡（2 列 × 192，选项 192×86，圆点 14×14：未选 `border 1px #C9CDD4` / 选中 `border 4px #625DF5` + 白底） |
| free-creation | 参考图 ≤4 张（ready 态去边框底色，缩略图 `repeat(auto-fill,80px)` 80×80 + 排序箭头 18×18 圆形 + 添加卡）；提示词工具按钮（12px `#5546D8`）；高级设置 popover 带头部（h2 16px/20 + 关闭 24×24）；提示词框撑满左栏剩余高度（下限 140px）；结果网格固定每行 3~6 张，点开为整屏查看器，含右键菜单（查看大图 / 用作参考图 / 新标签打开 / 复制地址 / 下载原图 / 删除作品） |

后 10 个工具页沿用同一套共享外壳（`components/ToolShell.tsx` + `components/ToolWidgets.tsx`，`upload={null}` 的页面自备上传区）。

| 页面 | 结构 |
| --- | --- |
| multi-image-fusion | 两步流：场景网关（15 场景 2 组：表面附着 7 + 空间摆放 8）→ 工作区（返回场景列表 / 主体图 1 张 / 搭配图 1-5 张 / AI 分析 / 变体张数 4-1 / 高级设置 / 结果区重新生成 + 一键下载）；场景与变体数进入模型提示词 |
| product-sku | 模板图卡（≤1 张，从素材库导入 + 手机上传 + 模板图上拖拽框选最多 3 个区域）+ 使用步骤卡（4 步）+ SKU 行编辑器（名称/颜色）按行批量提交 N 个任务，框选坐标与 SKU 信息进入模型提示词 |
| local-redraw | 画布涂抹导出遮罩 PNG，最多 3 个区域并逐区填写描述/参考图；必须配支持 edits 的图像线路，无线路 `42204`、无编辑协议 `42205`，均退款 |
| background-remove | 背景颜色卡 7 项：透明底（棋盘格，默认）/ 白 / 浅蓝 rgb(130,206,243) / 蓝 rgb(57,136,233) / 红 rgb(255,11,34) / 深红 rgb(168,0,27) / 自定义；背景色与透明底要求进入模型参数 |
| watermark-remove | 上传 + 处理方式（自动识别 / 指定区域 + 五宫格位置）；区域遮罩与处理方式进入模型参数，通道不支持遮罩时 `42205` 并退款 |
| product-retouch | 精修模式 6 项（综合精修默认 / 质感增强 / 瑕疵修复 / 色彩校正 / 提升清晰度 / 材质强化）+ 补充要求 ≤200 字；模式与要求映射为模型提示词 |
| image-translate | 目标语言 select 10 项（zh-CN 默认）+ 保护商品主体开关（默认开）；目标语言与开关进入模型提示词 |
| image-expand | 原图占比（100/80/60/50 + 1-99% 自由输入，默认 80）+ 原图位置九宫格（居中默认）；占比与位置作为参数和提示词发送给模型 |
| product-recolor | 商品颜色（白默认 / 浅蓝 / 蓝 / 红 / 深红 / 自定义）；目标颜色进入模型提示词 |
| rotate-angle | 主体 / 摄像头双 tab（主体：3D 立方体前/后/左/右/上/下；摄像头：轨道线 12×15° + 指针 + 4 箭头）；滑杆 yaw -90..90 / pitch -30..60 / zoom 0.8..1.2；角度参数进入模型提示词 |

**统一约束**：

- 局部重绘与去除水印的画布遮罩随任务提交；未涂抹时退回位置枚举，并在卡片明示「那只是提示词里的一句话，不限定重绘范围」。
- 手机上传：自由创作 / 多图融合已接 `mobile-upload` 扫码上传；其余页面提示直接拖拽上传。
- AI 分析：未接入视觉模型时如实提示，不展示假分析结果。
- 分辨率 1K/2K 可选；4K 仅在 `runtime.remoteAvailable` 时放开。
- 积分消耗按 `CreditPriceService.resolve()` 的生效价，不是页面文案的硬编码。
- 商品名 / 品牌 / 描述 / 复刻要求 / 创作提示词以中文原文发送给模型，完整参数同时落库并在结果卡片 meta 行可见。

## 文档维护约定

- 本文只写现状：页面结构、能力清单、目录树、启动、接口随代码更新；与代码冲突时以代码为准并顺手改这里。
- 变更过程与单次验证结果不写进本文——测试清单、覆盖矩阵与已知红灯见 `docs/testing.md`，单次运行结果随提交说明记录。
- 完整接口表与错误码在 `docs/api-contract.md`，目录树与架构约束在 `CLAUDE.md`，本文不重复；新增文档的命名与放置规则见 `docs/README.md`。
