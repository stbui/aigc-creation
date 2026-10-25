# 货觉AI · MVP

面向电商团队的智能视觉创作平台 MVP（2026-10-19 定名「货觉AI」，取名与商标冲突核查见 `docs/brand/naming.md`，品牌规范见 `docs/brand/brand-basics.md`），页面结构与功能对标 **极画AI 工作台**（https://ijihua.cn/workbench）。

- 后端：NestJS 12 + Prisma 7 + **自研 node:sqlite driver adapter**（零原生编译依赖）
- 前端：Vite 8 + React 19 + antd 6 + lucide-react
- 图像生成：Jimp 1.6（11 项本地真实算法；配通道后按能力路由到云端，失败时回落本地。**另有 4 项图像能力（创意生图 / 局部重绘 / 图片翻译 / 自由创作）本地没有实现，不回落：没通道即任务失败 `42204` 并退款**）
- 视频生成：MiniMax 四段式异步，**无本地兜底**（未配通道时如实标注不可用）

> **本文定位**：**只写现状**——页面结构、能力清单、目录、启动、接口、环境坑与复刻规格。代码与本文冲突时以代码为准。

**配套文档**：`CLAUDE.md`（接口全表、目录树、架构约束速查）｜`docs/README.md`（需求/产品/技术/测试/品牌/规划六类地图）｜`docs/environments.md`（三环境变量与门禁）｜`docs/model-architecture.md`（通道分层与协议矩阵）｜`docs/testing.md`（闸口清单与已知红灯）。

## 阅读顺序

| 想了解 | 看这些章节 |
| --- | --- |
| 产品长什么样 | 页面结构 → 能力清单 → 复刻页说明 |
| 怎么跑起来 | 启动（含换端口、CORS、工作台缩略图种子） |
| 接口契约 | 接口（完整表在 `CLAUDE.md`） |
| 外部模型怎么接 | 接入真实模型（现行做法）→ `docs/model-architecture.md` |
| 踩过的环境坑 | 环境注意事项（踩坑记录） |

## 页面结构（对齐参考站）

| 区域 | 内容 |
| --- | --- |
| 顶部导航 | 品牌｜首页｜电商生图▾｜AI修图▾｜AI视频▾｜我的作品｜购买套餐｜邀请有奖｜联系客服｜算力位｜用户菜单（2026-10-19 按参考站实拍补齐 AI视频/购买套餐/邀请有奖，移除重复的「数据中心」——它只在侧栏；「联系客服」直达 `/tickets?type=consultation&compose=1`） |
| 侧边能力轨 | 100px 宽（`padding 8px 8px 20px`，右描边 `#F2F3F5`）；每项 **66×60 按钮**（`flex column / gap 2px / padding 5px 2px / radius 8px`，内含 24×24 图标 + 10px 文字）；hover 弹出预览卡（`radius 16px`，`shadow 0 10px 24px rgba(35,39,74,.16)`），显示该能力真实产出图，无产出则显示一句话说明 |
| 营销首页 `/` | **1:1 复刻参考站 landing-page**（2026-10-17 实拍）：7 段结构——hero（双层渐变 + 40px/500 #171A2B 标题）/ 业务场景 3 卡（radius24 + 真实图）/ 修图工具 8 入口（276×88 #F2F4F7）/ 套餐与加油包（真实价目 4 卡 + 加油包 tab）/ 优秀案例（7 tab × 16 图网格）/ 产品特性（wide + 双卡）/ 页脚（含客户 logo + 真实站内链接）。全站免鉴权、无侧栏；资源自托管于 `public/landing/`；能力入口按下方可见性口径过滤 |
| 工作台 `/workbench` | **1:1 复刻参考站 workbench**（2026-10-17 实拍校正）：212px 浅蓝渐变 hero（标题 32px/500 #000 lh20 + 副标题 17px #667085 lh31，右侧真实产出拼贴绝对定位不撑高）+ **12 张工具卡**（177×197 radius16 / 2:1 缩略图 / 40×40 白底浮图标块 / 免费角标 / 单行省略描述）+ 数据区 3 面板（2:1 双面板 + 通栏创作数据；最近任务面板 radius16）+ 顶部促销条 |
| 商品主图 `/product-kit` | **1:1 复刻参考站 product-kit**：上传商品图（≤5 张，点击/拖拽/粘贴）+ 生成设置（名称/品牌/平台/语言）+ 商品描述（AI分析/放大编辑）+ 自定义配置（白底/场景/卖点/其他四类计数，按计数批量生成）+ 高级设置（比例 8 项 / 画质）+ 紫色渐变提交；右侧结果网格（1:1 卡片） |
| 商品详情 `/product-detail` | **1:1 复刻参考站 product-detail**：上传 + 生成设置 + 商品描述 + **包含模块（多选，16 选 ≤10，已选 N/10）** + 高级设置（仅画质）；按模块选择渲染详情长图（每模块一个区块） |
| 爆款复刻 `/viral-clone` | **1:1 复刻参考站 viral-clone**：上传商品图（≤5 张）+ 上传参考图（爆款图，≤1 张，标题行无计数器）+ 生成设置（名称/品牌均选填/平台/语言）+ 复刻要求（独立卡 textarea ≤1000 字）+ 复刻程度（参考风格/高度复刻，默认高度复刻）+ 高级设置（比例 8 项 / 画质）；单任务生成，本地为真实版式重建算法，云端可用时走模型复刻 |
| 自由创作 `/free-creation` | **1:1 复刻参考站 free-creation**：上传参考图（≤4 张选填，缩略图 80×80 + 排序箭头 + 添加卡）+ 创作提示词（必填，AI润色/图片转提示词，≤4000 字 + 放大编辑，框高随左栏剩余高度撑满、下限 140px，仍可手动拖高）+ 高级设置（比例 8 项 / 画质，popover 带头部与关闭按钮）；右侧结果栏网格展示本页全部成功产出（每行 3/4/5/6 张可调，选择记忆在本机）；点缩略图开整屏查看器（1~4 倍缩放、拖拽、←/→ 翻页、Esc 关闭、下载原图）；缩略图与查看器内图片均可右键（查看大图 / 用作参考图 / 新标签打开 / 复制地址 / 下载原图 / 删除作品，删除二次确认）；参考图 + 提示词 → free_create 任务（参考图顶部条带横排，真实参与构图） |
| 多图融合 `/multi-image-fusion` | **1:1 复刻参考站两步流**：场景网关（15 场景 2 组：表面附着 7 + 空间摆放 8）→ 工作区（返回场景列表 + 主体图 1 张 + 搭配图 1-5 张 + AI 分析 + 变体张数 4/3/2/1 + 高级设置 + 立即生成 40 积分）；结果联络图 + 重新生成/一键下载 |
| 商品SKU图 `/product-sku` | **1:1 复刻参考站 product-sku**：SKU模板图卡（≤1 张 + 模板上拖拽框选最多 3 个变体区域）+ 使用步骤卡（4 步）+ SKU 清单编辑器（名称/颜色，按行批量提交，框选坐标随任务提交）+ 高级设置（比例 8 项 / 画质）；结果多图并列 + 一键下载 |
| 局部重绘 `/local-redraw` | **1:1 复刻参考站 local-redraw**：上传（≤1 张）+ 重绘区域（**画布涂抹**导出遮罩 PNG 后随任务提交；未涂抹时用位置枚举作提示词兜底）+ 描述（≤1000 字 + 放大编辑）+ 高级设置（比例默认原比例 / 画质）；开始重绘 5 积分 |
| 一键抠图 `/background-remove` | **1:1 复刻参考站 background-remove**：上传（≤1 张）+ 背景颜色（透明底棋盘格默认 / 白 / 浅蓝 / 蓝 / 红 / 深红 / 自定义 HEX）+ 高级设置（仅比例，默认原比例）；开始抠图 限时免费 |
| 去除水印 `/watermark-remove` | **1:1 复刻参考站 watermark-remove**（最简页）：上传（≤1 张）+ 处理方式（自动识别/指定区域 + 五宫格位置）+ 无高级设置；开始去除 限时免费 |
| 产品精修 `/product-retouch` | **1:1 复刻参考站 product-retouch**：上传 + 精修模式（6 项 pill，默认综合精修）+ 补充要求（≤200 字）+ 高级设置（比例默认原比例 / 画质）；立即生成 5 积分 |
| 图片翻译 `/image-translate` | **1:1 复刻参考站 image-translate**：上传 + 目标语言（10 项 select，默认简体中文）+ 保护商品主体（switch，默认开）+ 高级设置（仅画质）；立即翻译 5 积分 |
| 智能扩图 `/image-expand` | **1:1 复刻参考站 image-expand**：上传 + 原图占比（100/80/60/50 快捷 + 1-99% 自由输入，默认 80）+ 原图位置（九宫格，默认居中）+ 高级设置（比例默认原比例 / 画质）；立即扩图 5 积分 |
| 商品换色 `/product-recolor` | **1:1 复刻参考站 product-recolor**：上传 + 商品颜色（白默认 / 浅蓝 / 蓝 / 红 / 深红 / 自定义 HEX）+ 高级设置（比例默认原比例 / 画质）；立即换色 5 积分 |
| 旋转角度 `/rotate-angle` | **1:1 复刻参考站 rotate-angle**：上传（支持 JPG/PNG/WebP）+ 旋转角度卡（重置按钮 + 主体/摄像头双 tab：主体=3D 立方体预览，摄像头=轨道线 + 4 方向键；三滑杆 旋转 -90..90 / 倾斜 -30..60 / 缩放 0.8..1.2）+ 高级设置（比例默认原比例 / 画质）；立即生成 5 积分 |
| 工具页 `/tools/:capability` | 上传区（单图/双图按能力声明）+ **按参数声明自动渲染的表单** + 生成结果（尺寸/格式/重新生成/清空）；创意生图固定走 `/tools/creative_image`（不再复用自由创作页，避免点 A 能力却提交成 `free_create`） |
| 我的作品 `/works` | 全部生成任务，状态筛选、预览、再做一张、删除；**失败任务可原地重试**（沿用原任务的 `capability` / `inputAssetIds` / `params`，重试前二次确认积分消耗，重试卡即时进入进行中） |
| 素材库 `/library` | 原图与生成图，kind/能力筛选、分页、删除 |
| 数据中心 `/stats` | 6 项指标 + 近 7 天产出柱状图 + 按能力分布（含成功率）+ 最近任务 |
| 账户设置 `/account` | 资料（昵称 / 手机号）/ 改密（成功后全部旧 token 失效）/ 会员状态与**取消续费**（取消后已付周期仍有效至 `expiresAt`，到期不自动续费）/ 数据导出 JSON / 注销影响面与注销 |
| 订单 `/orders` | 订单列表与支付；**未支付订单可主动取消**（`pending → cancelled`，二次确认；已支付订单只能走退款） |
| 我的工单 `/tickets` | 提交工单（类型 / 标题 / 内容 / 优先级）+ 工单线程（状态、客服回复、追评）+ 已关闭工单只读；支持 `?type=consultation\|complaint&compose=1` 直达对应类型的填写表单 |
| 站点地图 `/sitemap.html` | 公开能力入口 + 账户 / 商业 / 支持页面真实链接（套餐、积分、订单、账户、邀请、工单、未成年人保护、投诉入口） |

**卡片缩略图**：取该能力**最近一次成功产出**（`GET /stats/overview` 的 `byCapability[].thumbnailUrl`），
所以卡片里是用户自己真实生成的结果；没有产出时显示设计化空态（图标 + "暂无示例，去生成第一张"），
不放假示例图。

## 能力清单（16 项，13 项在工作台）

能力清单只在后端 `src/capabilities/definitions/<id>.ts` 逐项声明、由 `capability.registry.ts` 门面聚合，通过 `GET /api/v1/capabilities` 下发给前端；
侧栏、卡片、表单、统计分布全部由这份数据渲染，**新增能力不需要改前端**。

> 下表是 2026-10-16 的逐页字段快照（字段说明仍准确），**实现程度以代码为准：16 项全部 `real`，0 `mock` / 0 `planned`**（2026-10-22 删除全部占位实现）。
> 单次请求走云端还是本地回落看 `task.provider`，能力当前能给出什么看 `runtime.effective`，都不靠 `mode` 猜。

**入口可见性口径**（`frontend/src/lib/capabilities.ts` 的 `isCapabilityVisible()`）：`planned` 与运营下线的能力（`runtime.effective === 'disabled'`）**从顶导 / 侧栏 / 工作台 / 首页案例页签 / 站点地图一并隐藏**；`unavailable`（代码已实现、但此刻无可用通道）**保留入口**，页面内说明原因并只拦截已登录用户的提交 —— 访客点击仍走登录流程，不会在登录前就被能力状态置灰。

| 分组 | 能力 | 模式 | 说明 |
| --- | --- | --- | --- |
| 电商生图 | 商品主图 | real | 参考站 product-kit 全字段（名称/品牌/平台 9 项/语言 10 项/描述/四类变体计数/比例 8 项/画质 1K·2K） |
| | 商品详情图 | real | 参考站 product-detail 全字段（名称/品牌/平台/语言/描述/包含模块 16 选 ≤10/SKU/画质），按模块渲染长图区块 |
| | 爆款复刻 | real | 参考站 viral-clone 全字段（名称/品牌选填/平台 9 项/语言 10 项/复刻要求/复刻程度两档/比例 8 项/画质 1K·2K）；本地为真实版式重建算法（提取参考图配色/结构 → 重绘 → 换主体），两档程度产出可见差异 |
| | 创意生图 | real · 仅云端 | 提示词 + 比例；本地没有实现，必须配图像通道 |
| | 多图融合 | real | 参考站 multi-image-fusion 全字段（场景 15 项/变体张数 4-1/比例 8 项/画质）；主体 + 搭配图层叠合成联络图（B6 起真实合成：背景提取 / 投影 / 版式变体） |
| | 商品SKU图 | real | 参考站 product-sku 全字段（模板图 1 张/画布框选最多 3 个变体区域/SKU 名称+颜色/比例 8 项/画质）；云端按框选坐标只替换框内，本地兜底同样映射框选坐标 |
| AI修图 | 局部重绘 | real · 仅云端 | 参考站 local-redraw 全字段（画布涂抹遮罩 / 6 位置兜底 / 描述 / 比例默认原比例 / 画质）；本地没有实现，必须配 **openai 协议**的图像通道（`maskSupport: 'edits'`），其它协议判 `42205` 并退款 |
| | 智能扩图 | real | 参考站 image-expand 全字段（原图占比 1-99% 默认 80/原图位置九宫格/比例默认原比例/画质）；边缘延展 + 羽化 |
| | 一键抠图 | real · 免费 | 参考站 background-remove 全字段（背景颜色 7 项含自定义 HEX/比例默认原比例）；四角采样阈值抠除 |
| | 去除水印 | real · 免费 | 参考站 watermark-remove（处理方式 + 区域位置五宫格，附合规提示）；B6 起本地镜像修补 + 羽化融合，**压在商品主体上的水印本地去不掉** |
| | 图片翻译 | real · 仅云端 | 参考站 image-translate 全字段（目标语言 10 项/保护商品主体开关默认开/画质）；本地没有实现（OCR 路径已删除），必须配图像通道 |
| | 产品精修 | real | 参考站 product-retouch 全字段（精修模式 6 项/补充要求 ≤200 字/比例默认原比例/画质）；6 模式各自映射真实像素管线 |
| | 商品换色 | real | 参考站 product-recolor 全字段（商品颜色 6 项含自定义 HEX/比例默认原比例/画质）；保明度换色 |
| | 旋转角度 | real | 参考站 rotate-angle 全字段（yaw -90..90 / pitch -30..60 / zoom 0.8..1.2/比例默认原比例/画质）；2D 近似（旋转+剪切+缩放） |
| AI视频 | 自由创作 | real · 仅云端 | 参考站 free-creation 全字段（参考图 0~4 张选填/创作提示词必填/比例 8 项/画质 1K·2K）；已接云端模型，本地没有实现 |
| | 图生视频 | real | MiniMax 文生视频协议（四段式异步），**无本地兜底**：未配视频通道时 `runtime.effective='unavailable'`，如实标注而非假装 |

`real` = 已接入真实实现（Jimp 本地算法或云端模型）；当前 **16 项全部 real，0 mock / 0 planned**。
2026-10-22 起占位实现全部删除、`mock` 这一档从类型里移除：本地没有算法的能力（创意生图 / 局部重绘 / 图片翻译 / 自由创作）显式 `localFallback: false`，没通道即任务失败 `42204` 并退款，不用假效果冒充模型能力。

## 目录结构

```
aigc-creation/
├── start.sh                    # 一键启动（--env development|test|prod；端口占用即停 + 建表 + 种子）
├── README.md                   # 本文：现状速查 + 逐轮执行记录
├── docs/                       # 分类文档，地图见 docs/README.md
├── docker-compose.yml          # 本地编排（默认 dev，--profile test 并行测试档）
├── backend/                    # NestJS 服务，端口 4100（测试档同端口），全局前缀 /api/v1
│   ├── prisma/schema.prisma    # 42 个模型；SQLite 无 enum，状态类字段 String + DTO 白名单
│   ├── prisma.config.ts        # Prisma 7 连接配置（datasource url 移出 schema，按 NODE_ENV 选档）
│   ├── scripts/                # seed-* / smoke-*（28 个）/ verify-* / probe / db-url
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
    └── src/
        ├── pages/              # 34 个 C 端页面 + pages/admin/ 28 个后台页面
        ├── components/         # AppLayout / SideRail / RailPreview / ToolShell / admin/AdminLayout ...
        ├── lib/                # api.ts（拆信封）/ http.ts / auth.ts / capabilities.ts / constants.ts
        ├── context/ hooks/     # AuthContext / AdminContext（权限点）/ CreditsContext；useToolTask 等
        └── styles/global.css   # ★ 设计令牌（全站唯一色值来源）
```

逐模块注释的完整目录树见 `CLAUDE.md`「目录结构」。

## 启动

**前置**：Node ≥ 22.5（依赖内置 `node:sqlite`）

推荐直接用一键启动脚本（自动挑空闲端口、同步 CORS、建表 + 种子）：

```bash
./start.sh                 # 开发档：后端 4100 / 前端 5100
./start.sh --env test      # 测试档：独立库 test.db，端口同开发（两档不能并行）
./start.sh --daemon        # 后台运行（PID 记在 .run/start.pids，脚本随即返回）
./start.sh --stop          # 停止后台服务（按 PID 记录 + 仅本仓库进程的端口兜底）
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

端口写死，`./start.sh` 发现被占用会**先停掉占用进程再启动**（`free_port`：先 TERM，2 秒不退再 KILL，并打印被杀的 PID 与命令行）。不再回退到 4101/5101 —— 换端口会连带改前端代理与 CORS 来源，结果是「看起来起来了，浏览器访问的还是旧实例」，改的代码像没生效。

```bash
./start.sh                 # 开发：4100 / 5100，占用即停
./start.sh --env test      # 测试：4100 / 5100（同开发），占用即停，会停掉开发档
./start.sh --env prod      # 生产：只认 .env.production，端口被占直接失败，不自动杀进程
```

生产档刻意不自动杀进程：线上端口上的东西可能不是本项目，静默杀掉代价太大，只报错让人确认。

只匹配 **LISTEN** 状态的进程，客户端连接不算（否则会把代理 `/api` 的前端 dev server 一起误杀）。手工排查：

```bash
lsof -nP -iTCP:4100 -sTCP:LISTEN    # 谁占着后端
lsof -nP -iTCP:5100 -sTCP:LISTEN    # 谁占着前端
```

### 工作台缩略图种子

工作台卡片与 hero 作品集展示的是**每项能力最近一次真实产出**。新库没有产出时卡片为空态，
用种子脚本走真实 API 逐能力生成一遍（幂等，已有成功产出的能力会跳过）。凭据没有默认值，必须显式提供：

```bash
cd backend
SEED_EMAIL=you@example.com SEED_PASSWORD='…' API=http://localhost:4100 \
  npx ts-node -T scripts/seed-workbench-thumbs.ts
```

### CORS

允许来源由环境变量决定（`backend/src/common/cors-allow-list.ts`），启动日志会打印实际生效的白名单：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `CORS_ORIGINS` | 逗号分隔的显式白名单，**给定时覆盖其余规则**（生产用这个） | 未设置 |
| `CORS_ALLOW_PRIVATE_LAN` | `1`/`true` 时额外放行私有网段任意端口（`10.` / `172.16-31.` / `192.168.`，供手机同 WiFi 调试） | 关闭 |

未设置任何变量时，默认放行本机开发入口：
`http://{localhost,127.0.0.1,[::1]}:5100`（dev）与 `:4173`（`vite preview`）。

```bash
# 手机/局域网调试前端
CORS_ALLOW_PRIVATE_LAN=1 node dist/main.js

# 生产: 只放行实际前端域名
CORS_ORIGINS=https://your-domain.com node dist/main.js
```

浏览器端报错排查顺序：先看后端启动日志那行 `CORS origins: ...`，再确认浏览器地址栏的
host:port 是否在列表内 —— `localhost` 与 `127.0.0.1` 在 CORS 判定上是**不同来源**，不能互换。

开发账号由环境变量决定：`SEED_USER_EMAIL=dev@example.com npm run seed`（`SEED_USER_PASSWORD` 可指定密码，未指定则随机生成并只打印一次；未设置邮箱时脚本什么都不建）。可选初始积分 `SEED_USER_CREDITS`（默认 0）。登录页不再预填任何凭据。后台管理员另用 `npm run seed:admin` 生成，两者是两套账号。
首次上传时前端会自动创建「默认项目」，无需手动建项目。

登录令牌 TTL 默认 7 天（本地 MVP 无 refresh 机制，`JWT_TTL` 环境变量可覆盖；生产应恢复短 TTL + refresh）。

## 环境注意事项（踩坑记录，重要）

> 环境体系的完整说明（变量矩阵、加载优先级、生产门禁、Docker、排查清单）见 `docs/environments.md`；新增环境变量要同步的四处见 `CLAUDE.md`。

### 端口 / CORS / 代理 / 浏览器巡检

**开发档后端固定 4100**（全局前缀 `/api/v1`），前端固定 5100。
若端口已被其它进程占用，直接 `node dist/main.js` 会 `EADDRINUSE` 失败；若占用者不是本项目，前端登录会静默 404
（`Cannot POST /api/v1/auth/login`，对方返回的是自己的响应格式）。正确启动方式：

```bash
./start.sh          # 端口被占时自动停掉占用进程，端口本身不变
```

手工启动（跳过 start.sh）则要自己先释放端口：

```bash
lsof -nP -iTCP:4100 -sTCP:LISTEN     # 确认占用者
cd backend && node dist/main.js      # 不要用 nest start：会触发安全守卫拒绝清空 dist
cd frontend && npm run dev           # 走 vite 代理，VITE_API_BASE 留空 = 同源
```

后端 CORS 只放行 `5100` / `4173`（三档同一端口），**前端必须用 5100**。手工换端口时后端 CORS 会拦，
除非同步把新来源加进 `CORS_ORIGINS` —— 这也是 `start.sh` 不再自动换端口的原因。

补充实测细节（2026-10-19，仍有效）：

- 显式设置 `VITE_API_BASE` 后前端走**直连绝对地址**而非 vite 代理，preflight 直接被后端 CORS 拒 —— 换端口无效，除非同步把新来源加进 `CORS_ORIGINS`。
- vite v8 绑 **IPv6 `::1`**，`127.0.0.1:5100` 不通；curl / playwright 必须用 `localhost`。
- 本机 `HTTP_PROXY=127.0.0.1:49705`，curl 必须加 `--noproxy '*'`。
- token 的 localStorage key 是 **`ecom_vision_token`**（`frontend/src/lib/auth.ts`）。
- playwright 巡检必须**同一 context 内顺序 `goto`**：`browser.newPage()` 每次新建 context，
  localStorage 不共享（第一版回归 23 条假 FAIL 全是这个原因）。

### 依赖安装与嵌套副本

本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，因此依赖用 `curl` + `tar` 直装。
由此产生的版本漂移已逐项修正（express/body-parser/type-is/media-typer/raw-body/multer 链、
`@babel/runtime` 7.x、`lightningcss` 与 `@rolldown` 的 darwin-x64 原生包）。

**`package.json` 已锁定为实际验证通过的精确版本，但 `node_modules` 里的嵌套副本无法由 npm 自动重现**：

- `multer/node_modules/type-is@1.6.18` + 其下 `media-typer@0.3.0`（最关键：错版会让 multer **静默不解析 multipart**，不报错、只是收不到文件）
- `webpack/node_modules/mime-types@2.1.35`
- `@nestjs/config/node_modules/dotenv@18.0.3`（它精确 pin 18.0.3，而顶层 `dotenv@17.4.2` 属 prisma 链，两者不能共用）

因此提供了审计工具：

```bash
npm run verify:deps            # 全量审计 + 列出已记录无害项及依据
npm run verify:deps:critical   # 只查运行时关键链（推荐日常使用）
node scripts/verify-deps.js --quiet   # 仅输出结论，有致命问题则 exit 1（可接 CI）
```

工具按 Node 的真实解析顺序判断（嵌套副本优先、顶层兜底），并维护两份显式清单：
`ACCEPTED_PINS`（刻意为之的精确 pin 偏差）与 `KNOWN_BENIGN`（已验证无影响的偏差簇，逐条附验证依据）。
当前状态（2026-10-20 实测）：**致命 0 / 已记录无害 73 / 提示级 9 / 必需嵌套副本 5:5 就位**。

新增依赖后请重跑一次；若工具报出未在清单中的问题，按它给出的 `from 需要 need, 实际 has` 定位，
必要时把该包降到 `need` 指定的主版本，或按冲突情况嵌套安装后再登记清单。

## 接口

> 完整接口表（后台管理、商业域、账户与合规、服务域，约 60 条）见 `CLAUDE.md`「主要接口」；这里只列 C 端主链路。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 能力清单（公开免登录），含 `mode` 与 `runtime`，前端全部渲染依据 |
| POST | `/api/v1/auth/{register,login}` | 注册（直接返回 `accessToken`）/ 登录 `{ accessToken, user }` |
| POST/GET | `/api/v1/auth/qr/{create,status}` | 扫码登录：桌面建码 / 轮询换 token（公开） |
| GET/POST | `/api/v1/projects` | 项目列表 / 创建 |
| POST | `/api/v1/assets/upload` | 上传素材（multipart：`file` + `projectId`，均必填），返回含宽高 |
| GET | `/api/v1/assets` | 素材库列表（`kind`/`capability`/`limit`/`offset`） |
| DELETE | `/api/v1/assets/:id` | 删除素材（生成图连带删除产出它的任务） |
| POST | `/api/v1/generate` | 创建生成任务，返回 `{ taskId, status, creditCost }`，异步执行 |
| GET | `/api/v1/tasks/:id` | 轮询任务，`outputAsset.sourceUrl` 为结果图 |
| GET | `/api/v1/tasks` | 任务列表（含 `outputAsset`，历史页缩略图依赖它） |
| DELETE | `/api/v1/tasks/:id` | 删除作品（连带产物与磁盘文件） |
| GET | `/api/v1/stats/overview` | 数据中心聚合（汇总/能力分布/近 7 天/最近任务） |
| GET | `/api/v1/credits/{balance,lots,ledger}` | 积分余额 / 批次 / 流水（FEFO 扣减） |
| GET/POST | `/api/v1/orders*`、`/payments/*` | 订单（含 `POST /orders/:id/cancel` 取消未支付单）、沙箱支付、真实渠道支付意图与回调 |
| GET/PATCH/DELETE | `/api/v1/me` | 账户资料 / 更正 / 自助注销；`/me/{password,export}` 改密与导出 |
| GET/POST | `/api/v1/legal*`、`/notifications*`、`/tickets*` | 法务正文 / 站内消息 / 工单（公开或需登录，见 CLAUDE.md） |
| GET | `/uploads/*` | 静态图片（签名开启时需 `sig` 参数） |

所有成功响应统一信封 `{ code: 0, data, message: '' }`，前端 `lib/api.ts` 的 `request()` 负责剥离；异常走 `AppError` + `AllExceptionsFilter`，跨模块错误码表见 `CLAUDE.md`「统一响应信封」。

Jimp 内置字体仅含 ASCII，故生成图内文案为英文（如 `AI MAIN IMAGE - taobao` / `AI RECOLOR #DC2626 (134600px)`）；
中文只出现在界面层。

## 接入真实模型（现行做法）

> 本节 2026-10-20 重写。下一章「真实模型通道」是 2026-10-17 的初版单网关实现，**仅作演进记录**；现行分层与协议矩阵以 `docs/model-architecture.md` 为准，速查见 `CLAUDE.md`「生成通道」。

模型接入是**配置**，不是改代码：

1. 后台 `/admin/model-config` 新增线路（选厂商自动填基址 / 协议 / 推荐模型，令牌手填），或按模态配置 `GATEWAY_{IMAGE,TEXT,VIDEO}_*` 环境变量。优先级：**环境变量 > 后台 DB > 代码默认**。
2. 同模态多线路按 `priority` 升序做主备；失败记一笔并试下一条，连续失败达阈值熔断冷却（`channel-scheduler.ts`）。
3. 生效范围看 `GET /capabilities` 的 `runtime.effective`：有可用通道为 `remote`，否则走本地真实算法 `local`；本地没有实现的能力（创意生图 / 局部重绘 / 图片翻译 / 自由创作）与视频/文本无本地兜底时为 `unavailable`。

回落策略按能力区分（勿统一）：本地是**真实算法**的图像能力失败回落本地 Jimp，用户不白屏；本地**没有实现**的（创意生图 / 局部重绘 / 图片翻译 / 自由创作）失败即任务失败 `42204` 并退款，**绝不交付占位图**；文本返回 502、视频如实失败，**不编造产出**。

`mode` 只表示代码实现程度（`real` / `planned`），与「本次请求走云端还是本地」无关——后者看 `task.provider`（`gateway` / `local`；建任务时的初值是 `pending`，表示尚未执行）。

**本地联调：仿真模型网关**（`test/`，零依赖）——没有真实凭据时用它把渠道配置测通：

```bash
cd test && node server.js     # http://127.0.0.1:3900
```

文本协议填 `openai-chat` / 模型 `gpt-4o`，图像填 `openai` / 模型 `gpt-image-2`（或 `minimax` / `image-01`），视频填 `minimax-video` / 模型 `MiniMax-Hailuo-2.3`；基址只填根域，不要带 `/v1`。产物是真实 PNG 与可解码 MP4（内容为仿真画面），支持 `[[fail]]` / `[[401]]` / `[[429]]` 失败注入。详见 `test/README.md`。

## 复刻页说明（14 个工具页）

### 共享外壳（前 4 页 1:1 复刻）

四个页面按参考站 **computed styles 实拍值** 1:1 复刻（1920×1080）：左输入栏 432px + 右结果栏
（grid `432px 1fr` `gap 16`，输入栏 `form-scroll` 内部滚动、底部提交区 `margin-top auto` 推底），
结果栏白底 `radius 16`；卡片白底 `radius 16 / padding 16 / gap 16`（`form-scroll` 卡间距 10）；
必填星号 `::before` `#EB5757`；输入项 400×32（`radius 4`、边 `#E5E7EF`、`padding 5px 12px`）；
上传区 400×160 虚线框；主按钮 400×40 `linear-gradient(90deg,#8064F6,#5546D8)`（文案 14px/700）；
结果空态 160×160 插画 + "效果图预览"。

各页差异实拍值：

| 页面 | 特有结构 |
| --- | --- |
| product-kit | 自定义配置四类计数（展开多次生成）；结果网格 1:1 卡片 |
| product-detail | 包含模块 16 选 ≤10（2 列 × 192，选项 192×66，复选框 14×14 `accent #625DF5`） |
| viral-clone | 参考图单张上传区（图标下移 20，无计数器）；复刻要求卡（textarea 400×80 `rows 3 / maxlength 1000`）；复刻程度卡（2 列 × 192，选项 192×86，圆点 14×14：未选 `border 1px #C9CDD4` / 选中 `border 4px #625DF5` + 白底，默认高度复刻） |
| free-creation | 参考图 ≤4 张（ready 态去边框底色，缩略图 `repeat(auto-fill,80px)` 80×80 + 排序箭头 18×18 圆形 `rgba(29,33,41,.66)` + 添加卡 + 排序提示 11px）；提示词工具按钮（12px `#5546D8`，AI润色/图片转提示词）；高级设置 popover **带头部**（h2 16px/20 `#292839` + 关闭 24×24 `#526077`）；窄屏标题头（span 14px/700 + h1 16px/700）。**有意偏离参考站**（用户要求）：次要按钮区（重置/清空）已移除；提示词框 80px 固定 → 撑满左栏剩余高度（下限 140px）；结果网格改固定每行 3~6 张（参考站 auto-fill），缩略图点开为整屏查看器而非 860px 弹窗，新增参考站没有的图片右键菜单 |

与参考站的**诚实差异**（不编造能力，做不到就如实标注）：

| 参考站 | 本项目 |
| --- | --- |
| "登录免费生图"（未登录态） | "免费生图"（本站已登录体系，本地算法不限次；云端通道按能力积分价扣费） |
| 语言下拉影响 AI 文案语种 | 语言记录进任务参数并在结果卡片展示；Jimp 字体仅 ASCII，图内文字仍为英文 |
| AI分析（视觉模型识别商品） | 填入上传素材的**真实文件名**，并明确提示"未接入视觉模型" |
| 手机上传（二维码） | 自由创作 / 多图融合已接 `mobile-upload` 扫码上传；未接入的页面提示直接拖拽上传 |
| 分辨率 1K/2K/4K（积分消耗） | 1K/2K 可选；**4K 仅在 `runtime.remoteAvailable` 时放开**，本地算法上限 2048px，否则如实禁用 |
| 爆款复刻（真实 AI 复刻模型） | 本地为**真实版式重建算法**：参考图真实参与（提取 8×8 布局签名与调色板；高度复刻以参考图为底替换商品，参考风格用布局签名重建场景）；云端可用时走模型复刻 |
| 复刻要求中文进入图内文案 | 中文原文完整记录在任务参数，图内仅绘制 ASCII 部分 |
| AI润色 / 图片转提示词（语言/视觉模型） | 已接 `prompt-tools`，走文本通道；未配通道时返回 502 并如实报错，**不回落本地拼文案** |
| 参考图为必填 | 选填（标题无必填星号，0 张也可纯提示词创作；后端 `inputs: 0` 不强制张数） |
| 「重置」等次要按钮（登录后可见） | 桌面端常驻显示（本站已登录），功能真实可用 |

图内中文限制：Jimp 内置字体仅 ASCII，商品名/品牌/描述/复刻要求/创作提示词以 ASCII 安全方式进入图内文字（中文部分被过滤），
完整中文记录在任务参数里，结果卡片 meta 行可见。

### 工具页批次（10 页，2026-10-16）

后 10 个工具页沿用同一套共享外壳（`components/ToolShell.tsx` + `components/ToolWidgets.tsx`，
与参考站一致的卡片/表单/提交/结果区/历史记录结构；`upload={null}` 的页面自备上传区）：
`multi-image-fusion` / `product-sku` / `local-redraw` / `background-remove` / `watermark-remove` /
`product-retouch` / `image-translate` / `image-expand` / `product-recolor` / `rotate-angle`。

各页实拍值与实现：

| 页面 | 参考站结构（实拍） | 本项目实现 |
| --- | --- | --- |
| multi-image-fusion | 两步流：场景网关（15 场景 2 组：表面附着 7 + 空间摆放 8）→ 工作区（返回场景列表 / 主体图必传 1 张 / 搭配图必传 1-5 张计数器 0/6 / AI分析 / 变体张数 4-1 / 高级设置 / 立即生成 40 积分 / 结果区重新生成+一键下载） | 网关卡片网格 → 工作区两步流原样落地；多图融合为**单图联络图**（2×2 网格，变体张数 = 网格内单元数），本地为真实场景版式合成 |
| product-sku | 模板图卡（≤1 张，从素材库导入 + 手机上传 + 模板图上真实拖拽框选最多 3 个区域）+ 使用步骤卡（4 步）+ 提交「立即生成 本次消耗0积分」+ 结果 copy「一张图，批量套出版式完全一致的整组 SKU 图」 | 自备上传区 + 画布框选 + 4 步步骤卡 + SKU 行编辑器（名称/颜色）**按行批量提交 N 个任务**，框选坐标进入提示词与本地兜底，结果多图并列 + 一键下载 |
| local-redraw | 上传 ≤1 张 + 重绘区域 + 描述（textarea）+ 设置（比例原比例 / 画质 1K）+「开始重绘 本次消耗5积分」+ desc「只想修改局部？圈出来写描述就行」 | 区域用**位置枚举（6 项）**代替画布涂抹；本地没有实现，必须配图像通道，没通道即任务失败 `42204` 并退款 |
| background-remove | 背景颜色卡 7 项：透明底（棋盘格，默认）/白/浅蓝 rgb(130,206,243)/蓝 rgb(57,136,233)/红 rgb(255,11,34)/深红 rgb(168,0,27)/自定义；设置仅比例；「开始抠图 限时免费」 | 四角采样阈值真实抠除（阈值 60 内部常量），换底色后合成到输出画布；透明 + 原比例输出 PNG |
| watermark-remove | 最简页：上传 + 处理方式（自动识别/指定区域 + 五宫格位置）+ 无设置；「开始去除 限时免费」 | 本地**真实算法**（2026-10-21 起）：区域掩膜 + 外环采样 + 迭代中值填充 + 羽化融合；压在商品主体上的水印本地去不掉，页面如实说明，附合规提示 |
| product-retouch | 精修模式 6 pill（综合精修默认/质感增强/瑕疵修复/色彩校正/提升清晰度/材质强化）+ 补充要求 ≤200 字（ph「如：去掉电镀件上的指纹…」）+「立即生成 本次消耗5积分」 | 6 模式各自映射**真实像素管线**（亮度/对比/饱和/模糊半混/锐化模板/明度保色换色），note 以 ASCII 绘制在图内左上角 |
| image-translate | 目标语言 select 10 项（zh-CN 默认…th-TH）+ 保护商品主体 switch（默认开）+ 设置仅画质 +「立即翻译 本次消耗5积分」+ hint「* 确认素材和参数后提交，右侧会展示翻译结果」 | 本地没有实现（OCR 路径已删除），必须配图像通道；没通道即任务失败 `42204` 并退款 |
| image-expand | 原图占比（100/80/60/50 + 1-99% 自由输入，默认 80）+ 原图位置九宫格（居中默认）+「立即扩图 本次消耗5积分」+ hint「*确认素材和参数后提交，右侧会展示生成结果」 | 真实实现：occupy 驱动画布（`longSide=max(w,h)/sqrt(occupy/100)`），九宫格定位对齐，clamp 采样边缘延展 + 固定 8px 羽化 |
| product-recolor | 商品颜色（白默认带勾/浅蓝/蓝/红/深红/自定义）+「立即换色 本次消耗5积分」 | 真实实现：颜色收敛（限 180 内部常量）保明度换色，footer 标注 `AI RECOLOR <hex>` |
| rotate-angle | 旋转角度卡（h2 + 重置 rotate-ccw 16px）→ tabs 主体/摄像头（主体默认：3D 立方体 前/后/左/右/上/下；摄像头：轨道线 12×15° + 指针 + 4 箭头 ‹›⌃⌄）；滑杆 旋转 yaw -90..90 d0 / 倾斜 pitch -30..60 d0 / 缩放 zoom 0.8..1.2 d1（label 特写）；hint「相机保持静止，生成时按主体旋转角度重建商品展示。」 | 预览为 CSS 3D 立方体 / 轨道线动画；生成为**2D 近似**（yaw 旋转 + pitch 逐行逆剪切 + zoom contain 适配），页面明示近似 |

后 10 页相对参考站的**诚实差异**（在前 4 页差异表基础上追加）：

| 参考站 | 本项目 |
| --- | --- |
| 局部重绘：画布涂抹/框选水印区域 | **已实现画布涂抹**（画笔/橡皮/笔刷大小/清空，导出遮罩随任务提交）；未涂抹时退回 6 项位置枚举，卡片明示「那只是提示词里的一句话，不限定重绘范围」；通道协议不支持遮罩时判 `42205` 并退款，不静默整图重绘 |
| 多图融合：AI 语义融合（主体自然融入场景） | 本地**真实合成**（2026-10-21 起：背景提取 / 投影 / 版式变体 + 变体网格），仍非语义融合，结果区明示产出走云端还是本地 |
| 商品SKU图：模板区域跟随 SKU 智能替换 | 模板底图 + 区域色块覆盖 + SKU 名绘制，按行批量出图，版式一致但非语义替换 |
| 旋转角度：3D 重建商品展示 | 2D 近似（旋转 + 剪切 + 缩放），页面 hint 明示 |
| AI分析（融合/翻译的语义识别） | 信息提示条明示"未接入视觉模型"，不展示假分析结果 |
| 积分消耗（0/5/40 积分文案） | 文案 1:1 保留；实际扣费按 `CreditPriceService.resolve()` 的生效价（后台可调、限时活动可为 0），不是页面文案的硬编码 |
| 手机上传（二维码） | 自由创作 / 多图融合已接 `mobile-upload` 扫码上传；其余页面点击提示直接拖拽上传 |

## 文档维护约定

- 本文**只写现状**：页面结构、能力清单、目录树、启动、接口随代码更新；与代码冲突时以代码为准并顺手改这里。
- 变更过程与逐轮验证结果不写进本文——闸口清单、覆盖矩阵与已知红灯见 `docs/testing.md`，单次运行结果随提交说明记录。
- 完整接口表、目录树与架构约束收敛在 `CLAUDE.md`，本文不重复；新增文档的命名与放置规则见 `docs/README.md` 第 9 节。
