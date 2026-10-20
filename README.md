# 货觉AI · MVP

面向电商团队的智能视觉创作平台 MVP（2026-10-19 定名「货觉AI」，取名与商标冲突核查见 `docs/brand/naming.md`，品牌规范见 `docs/brand/brand-basics.md`），页面结构与功能对标 **极画AI 工作台**（https://ijihua.cn/workbench）。

- 后端：NestJS 12 + Prisma 7 + **自研 node:sqlite driver adapter**（零原生编译依赖）
- 前端：Vite 8 + React 19 + antd 6 + lucide-react
- 图像生成：Jimp 1.6（7 项本地真实算法 + 8 项参数化占位，可替换为真实 aigc gateway）

## 页面结构（对齐参考站）

| 区域 | 内容 |
| --- | --- |
| 顶部导航 | 品牌｜首页｜电商生图▾｜AI修图▾｜AI视频▾｜我的作品｜购买套餐｜邀请有奖｜算力位｜用户菜单（2026-10-19 按参考站实拍补齐 AI视频/购买套餐/邀请有奖，移除重复的「数据中心」——它只在侧栏） |
| 侧边能力轨 | 100px 宽（`padding 8px 8px 20px`，右描边 `#F2F3F5`）；每项 **66×60 按钮**（`flex column / gap 2px / padding 5px 2px / radius 8px`，内含 24×24 图标 + 10px 文字）；hover 弹出预览卡（`radius 16px`，`shadow 0 10px 24px rgba(35,39,74,.16)`），显示该能力真实产出图，无产出则显示一句话说明 |
| 营销首页 `/` | **1:1 复刻参考站 landing-page**（2026-10-17 实拍）：7 段结构——hero（双层渐变 + 40px/500 #171A2B 标题）/ 业务场景 3 卡（radius24 + 真实图）/ 修图工具 8 入口（276×88 #F2F4F7）/ 套餐与加油包（真实价目 4 卡 + 加油包 tab）/ 优秀案例（7 tab × 16 图网格）/ 产品特性（wide + 双卡）/ 页脚（含客户 logo）。全站免鉴权、无侧栏；资源自托管于 `public/landing/` |
| 工作台 `/workbench` | **1:1 复刻参考站 workbench**（2026-10-17 实拍校正）：212px 浅蓝渐变 hero（标题 32px/500 #000 lh20 + 副标题 17px #667085 lh31，右侧真实产出拼贴绝对定位不撑高）+ **12 张工具卡**（177×197 radius16 / 2:1 缩略图 / 40×40 白底浮图标块 / 占位角标 / 单行省略描述）+ 数据区 3 面板（2:1 双面板 + 通栏创作数据；最近任务面板 radius16）+ 顶部促销条 |
| 商品主图 `/product-kit` | **1:1 复刻参考站 product-kit**：上传商品图（≤5 张，点击/拖拽/粘贴）+ 生成设置（名称/品牌/平台/语言）+ 商品描述（AI分析/放大编辑）+ 自定义配置（白底/场景/卖点/其他四类计数，按计数批量生成）+ 高级设置（比例 8 项 / 画质）+ 紫色渐变提交；右侧结果网格（1:1 卡片） |
| 商品详情 `/product-detail` | **1:1 复刻参考站 product-detail**：上传 + 生成设置 + 商品描述 + **包含模块（多选，16 选 ≤10，已选 N/10）** + 高级设置（仅画质）；按模块选择渲染详情长图（每模块一个区块） |
| 爆款复刻 `/viral-clone` | **1:1 复刻参考站 viral-clone**：上传商品图（≤5 张）+ 上传参考图（爆款图，≤1 张，标题行无计数器）+ 生成设置（名称/品牌均选填/平台/语言）+ 复刻要求（独立卡 textarea ≤1000 字）+ 复刻程度（参考风格/高度复刻，默认高度复刻）+ 高级设置（比例 8 项 / 画质）；单任务生成，结果卡带"本地占位渲染"披露 |
| 自由创作 `/free-creation` | **1:1 复刻参考站 free-creation**：上传参考图（≤4 张选填，缩略图 80×80 + 排序箭头 + 添加卡）+ 创作提示词（必填，AI润色/图片转提示词，≤4000 字 + 放大编辑）+ 高级设置（比例 8 项 / 画质，popover 带头部与关闭按钮）+ 重置/清空结果；参考图 + 提示词 → free_create 任务（参考图顶部条带横排，真实参与构图） |
| 多图融合 `/multi-image-fusion` | **1:1 复刻参考站两步流**：场景网关（15 场景 2 组：表面附着 7 + 空间摆放 8）→ 工作区（返回场景列表 + 主体图 1 张 + 搭配图 1-5 张 + AI 分析 + 变体张数 4/3/2/1 + 高级设置 + 立即生成 40 积分）；结果联络图 + 重新生成/一键下载 |
| 商品SKU图 `/product-sku` | **1:1 复刻参考站 product-sku**：SKU模板图卡（≤1 张 + "最多支持3个SKU变体区域"）+ 使用步骤卡（4 步）+ SKU 清单编辑器（名称/颜色/区域，按行批量提交）+ 高级设置（比例 8 项 / 画质）；结果多图并列 + 一键下载 |
| 局部重绘 `/local-redraw` | **1:1 复刻参考站 local-redraw**：上传（≤1 张）+ 重绘区域（位置枚举代替画布涂抹）+ 描述（≤1000 字 + 放大编辑）+ 高级设置（比例默认原比例 / 画质）；开始重绘 5 积分 |
| 一键抠图 `/background-remove` | **1:1 复刻参考站 background-remove**：上传（≤1 张）+ 背景颜色（透明底棋盘格默认 / 白 / 浅蓝 / 蓝 / 红 / 深红 / 自定义 HEX）+ 高级设置（仅比例，默认原比例）；开始抠图 限时免费 |
| 去除水印 `/watermark-remove` | **1:1 复刻参考站 watermark-remove**（最简页）：上传（≤1 张）+ 处理方式（自动识别/指定区域 + 五宫格位置）+ 无高级设置；开始去除 限时免费 |
| 产品精修 `/product-retouch` | **1:1 复刻参考站 product-retouch**：上传 + 精修模式（6 项 pill，默认综合精修）+ 补充要求（≤200 字）+ 高级设置（比例默认原比例 / 画质）；立即生成 5 积分 |
| 图片翻译 `/image-translate` | **1:1 复刻参考站 image-translate**：上传 + 目标语言（10 项 select，默认简体中文）+ 保护商品主体（switch，默认开）+ 高级设置（仅画质）；立即翻译 5 积分 |
| 智能扩图 `/image-expand` | **1:1 复刻参考站 image-expand**：上传 + 原图占比（100/80/60/50 快捷 + 1-99% 自由输入，默认 80）+ 原图位置（九宫格，默认居中）+ 高级设置（比例默认原比例 / 画质）；立即扩图 5 积分 |
| 商品换色 `/product-recolor` | **1:1 复刻参考站 product-recolor**：上传 + 商品颜色（白默认 / 浅蓝 / 蓝 / 红 / 深红 / 自定义 HEX）+ 高级设置（比例默认原比例 / 画质）；立即换色 5 积分 |
| 旋转角度 `/rotate-angle` | **1:1 复刻参考站 rotate-angle**：上传（支持 JPG/PNG/WebP）+ 旋转角度卡（重置按钮 + 主体/摄像头双 tab：主体=3D 立方体预览，摄像头=轨道线 + 4 方向键；三滑杆 旋转 -90..90 / 倾斜 -30..60 / 缩放 0.8..1.2）+ 高级设置（比例默认原比例 / 画质）；立即生成 5 积分 |
| 工具页 `/tools/:capability` | 上传区（单图/双图按能力声明）+ **按参数声明自动渲染的表单** + 生成结果（尺寸/格式/重新生成/清空） |
| 我的作品 `/works` | 全部生成任务，状态筛选、预览、再做一张、删除 |
| 素材库 `/library` | 原图与生成图，kind/能力筛选、分页、删除 |
| 数据中心 `/stats` | 6 项指标 + 近 7 天产出柱状图 + 按能力分布（含成功率）+ 最近任务 |

**卡片缩略图**：取该能力**最近一次成功产出**（`GET /stats/overview` 的 `byCapability[].thumbnailUrl`），
所以卡片里是用户自己真实生成的结果；没有产出时显示设计化空态（图标 + "暂无示例，去生成第一张"），
不放假示例图。

## 能力清单（15 项，12 项在工作台）

能力清单只在后端 `src/capabilities/capability.registry.ts` 定义一次，通过 `GET /api/v1/capabilities` 下发给前端；
侧栏、卡片、表单、统计分布全部由这份数据渲染，**新增能力不需要改前端**。

| 分组 | 能力 | 模式 | 说明 |
| --- | --- | --- | --- |
| 电商生图 | 商品主图 | real | 参考站 product-kit 全字段（名称/品牌/平台 9 项/语言 10 项/描述/四类变体计数/比例 8 项/画质 1K·2K） |
| | 商品详情图 | real | 参考站 product-detail 全字段（名称/品牌/平台/语言/描述/包含模块 16 选 ≤10/SKU/画质），按模块渲染长图区块 |
| | 爆款复刻 | mock | 参考站 viral-clone 全字段（名称/品牌选填/平台 9 项/语言 10 项/复刻要求/复刻程度两档/比例 8 项/画质 1K·2K）；两档程度产出可见差异 |
| | 创意生图 | mock | 提示词 + 比例 |
| | 多图融合 | mock | 参考站 multi-image-fusion 全字段（场景 15 项/变体张数 4-1/比例 8 项/画质）；主体 + 搭配图层叠合成联络图 |
| | 商品SKU图 | mock | 参考站 product-sku 全字段（模板图 1 张/变体区域 5 位置/SKU 名称+颜色/比例 8 项/画质）；按 SKU 行批量渲染 |
| AI修图 | 局部重绘 | mock | 参考站 local-redraw 全字段（重绘区域 6 位置/描述/比例默认原比例/画质） |
| | 智能扩图 | real | 参考站 image-expand 全字段（原图占比 1-99% 默认 80/原图位置九宫格/比例默认原比例/画质）；边缘延展 + 羽化 |
| | 一键抠图 | real · 免费 | 参考站 background-remove 全字段（背景颜色 7 项含自定义 HEX/比例默认原比例）；四角采样阈值抠除 |
| | 去除水印 | mock · 免费 | 参考站 watermark-remove（处理方式 + 区域位置五宫格，附合规提示） |
| | 图片翻译 | mock | 参考站 image-translate 全字段（目标语言 10 项/保护商品主体开关默认开/画质） |
| | 产品精修 | real | 参考站 product-retouch 全字段（精修模式 6 项/补充要求 ≤200 字/比例默认原比例/画质）；6 模式各自映射真实像素管线 |
| | 商品换色 | real | 参考站 product-recolor 全字段（商品颜色 6 项含自定义 HEX/比例默认原比例/画质）；保明度换色 |
| | 旋转角度 | real | 参考站 rotate-angle 全字段（yaw -90..90 / pitch -30..60 / zoom 0.8..1.2/比例默认原比例/画质）；2D 近似（旋转+剪切+缩放） |
| AI视频 | 自由创作 | mock | 参考站 free-creation 全字段（参考图 0~4 张选填/创作提示词必填/比例 8 项/画质 1K·2K），参考图顶部条带真实参与构图 |

`real` = Jimp 本地真实算法，产出可见差异；`mock` = 依赖真实模型，本地生成**带 (MOCK) 标注的占位图**（界面也会提示"占位效果"），
不用假效果冒充模型能力。当前 **0 项 planned**（多图融合 / 商品SKU图已于 2026-10-16 由 planned 升级为 mock）。

## 目录结构

```
ecom-vision-mvp/
├── .gitignore
├── backend/                # NestJS 服务 (端口 3001, 全局前缀 /api/v1)
│   ├── prisma/schema.prisma
│   ├── prisma.config.ts    # Prisma 7 连接配置 (datasource url 移出 schema)
│   ├── scripts/
│   │   ├── seed-demo-user.ts   # provision 演示账号 (幂等)
│   │   ├── verify-deps.js      # 依赖一致性审计 (含嵌套副本守卫)
│   │   ├── smoke-capabilities.js  # 全能力冒烟 (真实产出 + magic bytes 校验)
│   │   ├── smoke-main-image-variants.js  # 主图四变体冒烟 (白底/场景/卖点/其他 + 2K/竖比例)
│   │   ├── smoke-detail-sections.js      # 详情图模块冒烟 (区块数/未知键过滤/2K)
│   │   ├── smoke-viral-clone.js          # 爆款复刻冒烟 (参考图参与/两档差异/商品参与/2K 比例/容错)
│   │   ├── smoke-free-creation.js        # 自由创作冒烟 (参考图分区色/0 图回落/换行/2K/中文容错)
│   │   ├── smoke-multi-fusion.js         # 多图融合冒烟 (表面/空间版式/变体张数/2K/输入校验)
│   │   └── smoke-sku.js                  # 商品SKU图冒烟 (5 色板/区域位置/比例/参数收敛)
│   ├── src/capabilities/   # 能力注册表 + 下发接口 (唯一事实源)
│   ├── src/prisma/node-sqlite-adapter.ts   # 自研 driver adapter
│   ├── src/providers/mock-image.provider.ts # Jimp 实现 (7 real + 8 mock)
│   ├── src/stats/          # 数据中心聚合
│   └── uploads/            # original/ 原始图, generated/ 生成图 (静态服务 /uploads/*)
└── frontend/               # Vite SPA (端口 5173)
    └── src/
        ├── components/AppLayout.tsx  # 顶部导航 + 布局骨架
        ├── components/SideRail.tsx     # 侧边能力轨 (66×60 图标项 + hover 预览)
        ├── components/RailPreview.tsx  # hover 预览 (portal 渲染, 避开侧栏 overflow 裁剪) + 图片失败回退
        ├── components/HeroArt.tsx     # hero 原创 SVG 插画 (不引用第三方素材)
        ├── components/ToolShell.tsx   # 工具页共享骨架 (上传卡/设置浮层/提交/结果区/历史)
        ├── components/ToolWidgets.tsx # 工具页共享控件 (色板/九宫格/滑杆/pill/开关/工具卡)
        ├── lib/capabilities.ts       # 能力清单数据层 (接口下发 + 模块缓存 + toolPath 入口映射)
        ├── pages/          # Workbench / ProductKit / ProductDetail / ViralClone / FreeCreation /
        │                   # MultiFusion / ProductSku / LocalRedraw / BackgroundRemove / WatermarkRemove /
        │                   # ProductRetouch / ImageTranslate / ImageExpand / ProductRecolor / RotateAngle /
        │                   # Tool / Works / Library / Stats / Login
        └── styles/global.css
```

## 启动

**前置**：Node ≥ 22.5（依赖内置 `node:sqlite`；实测 22.22.2）

```bash
# 1) 后端
cd backend
npm run prisma:push        # 建表（首次或 schema 变更后）
npm run seed               # provision 演示账号 admin@demo.com / demo1234（幂等，可重复跑）
npm run build              # nest build
node dist/main.js          # http://localhost:3001/api/v1

# 2) 前端（另开终端）
cd frontend
npm run dev                # http://localhost:5173
```

前端通过 `VITE_API_BASE`（默认 `http://localhost:3001`）+ `/api/v1` 前缀直连后端。

### 端口被占用时换端口（本机跑多个项目）

5173/3001 被其他项目占用时，用环境变量换到备用端口（代码默认值不变）：

```bash
# 后端
PORT=3002 CORS_ORIGINS="http://localhost:5174,http://127.0.0.1:5174" node dist/main.js

# 前端
VITE_PORT=5174 VITE_API_PROXY=http://localhost:3002 VITE_API_BASE=http://localhost:3002 npm run dev
```

### 工作台缩略图种子（演示数据）

工作台卡片与 hero 作品集展示的是**每项能力最近一次真实产出**。新库没有产出时卡片为空态，
用种子脚本走真实 API 逐能力生成一遍（幂等，已有成功产出的能力会跳过）：

```bash
cd backend
API=http://localhost:3002 npx ts-node -T scripts/seed-workbench-thumbs.ts
```

### CORS

允许来源由环境变量决定（`backend/src/common/cors-allow-list.ts`），启动日志会打印实际生效的白名单：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `CORS_ORIGINS` | 逗号分隔的显式白名单，**给定时覆盖其余规则**（生产用这个） | 未设置 |
| `CORS_ALLOW_PRIVATE_LAN` | `1`/`true` 时额外放行私有网段任意端口（`10.` / `172.16-31.` / `192.168.`，供手机同 WiFi 调试） | 关闭 |

未设置任何变量时，默认放行本机开发入口：
`http://{localhost,127.0.0.1,[::1]}:5173`（dev）与 `:4173`（`vite preview`）。

```bash
# 手机/局域网调试前端
CORS_ALLOW_PRIVATE_LAN=1 node dist/main.js

# 生产: 只放行实际前端域名
CORS_ORIGINS=https://your-domain.com node dist/main.js
```

浏览器端报错排查顺序：先看后端启动日志那行 `CORS origins: ...`，再确认浏览器地址栏的
host:port 是否在列表内 —— `localhost` 与 `127.0.0.1` 在 CORS 判定上是**不同来源**，不能互换。

演示账号：`admin@demo.com` / `demo1234`（登录页「填充演示账号」按钮即用此凭据）。
首次上传时前端会自动创建「默认项目」，无需手动建项目。

登录令牌 TTL 默认 7 天（本地 MVP 无 refresh 机制，`JWT_TTL` 环境变量可覆盖；生产应恢复短 TTL + refresh）。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 能力清单（公开免登录），前端全部渲染依据 |
| POST | `/api/v1/auth/register` | 注册，**直接返回 `accessToken`**（注册即登录） |
| POST | `/api/v1/auth/login` | 登录，返回 `{ accessToken, user }` |
| GET/POST | `/api/v1/projects` | 项目列表 / 创建 |
| POST | `/api/v1/assets/upload` | 上传素材（multipart：`file` + `projectId`，均必填），返回含宽高 |
| GET | `/api/v1/assets` | 素材库列表（`kind`/`capability`/`limit`/`offset`） |
| DELETE | `/api/v1/assets/:id` | 删除素材（生成图连带删除产出它的任务） |
| POST | `/api/v1/generate` | 创建生成任务，返回 `{ taskId, status }`，异步执行 |
| GET | `/api/v1/tasks/:id` | 轮询任务，`outputAsset.sourceUrl` 为结果图 |
| GET | `/api/v1/tasks` | 任务列表（含 `outputAsset`，历史页缩略图依赖它） |
| DELETE | `/api/v1/tasks/:id` | 删除作品（连带产物与磁盘文件） |
| GET | `/api/v1/stats/overview` | 数据中心聚合（汇总/能力分布/近 7 天/最近任务） |
| GET | `/uploads/*` | 静态图片 |

所有成功响应统一信封 `{ code: 0, data, message: '' }`，前端 `lib/api.ts` 的 `request()` 负责剥离。

Jimp 内置字体仅含 ASCII，故生成图内文案为英文（如 `AI MAIN IMAGE - taobao` / `AI RECOLOR #DC2626 (134600px)` /
`(MOCK) - needs real model`）；中文只出现在界面层。

## 替换为真实模型

`MockImageProvider` 实现 `ImageProvider` 接口（`backend/src/providers/image-provider.interface.ts`），
在 `providers.module.ts` 把 `IMAGE_PROVIDER` 绑定改为真实 aigc gateway 实现即可，业务层无需改动。
8 项 mock 能力届时把 `registry` 里的 `mode` 从 `mock` 改成 `real` 即可，界面标注会自动消失。
（mock 能力现有 8 项：爆款复刻 / 创意生图 / 局部重绘 / 去水印 / 图片翻译 / 自由创作 / 多图融合 / 商品SKU图；
真做 7 项：商品主图 / 商品详情图 / 智能扩图 / 一键抠图 / 产品精修 / 商品换色 / 旋转角度。）

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
| free-creation | 参考图 ≤4 张（ready 态去边框底色，缩略图 `repeat(auto-fill,80px)` 80×80 + 排序箭头 18×18 圆形 `rgba(29,33,41,.66)` + 添加卡 + 排序提示 11px）；提示词工具按钮（12px `#5546D8`，AI润色/图片转提示词）；高级设置 popover **带头部**（h2 16px/20 `#292839` + 关闭 24×24 `#526077`）；次要按钮区（重置/清空，ghost 192×32）；窄屏标题头（span 14px/700 + h1 16px/700） |

与参考站的**诚实差异**（本地 MVP 无账号体系/积分/视觉模型，不编造）：

| 参考站 | 本项目 |
| --- | --- |
| "登录免费生图"（未登录态） | "免费生图"（本站点已登录，本地算法不限次） |
| 语言下拉影响 AI 文案语种 | 语言记录进任务参数并在结果卡片展示；Jimp 字体仅 ASCII，图内文字仍为英文 |
| AI分析（视觉模型识别商品） | 填入上传素材的**真实文件名**，并明确提示"未接入视觉模型" |
| 手机上传（二维码） | 明确提示本地演示环境不支持 |
| 分辨率 1K/2K/4K（积分消耗） | 1K/2K 可选，**4K 如实禁用**（本地算法上限 2048px）；无积分概念故不显示"倍消耗" |
| 爆款复刻（真实 AI 复刻模型） | 本地为**参数化占位渲染**：参考图真实参与（提取 8×8 布局签名与调色板；高度复刻以参考图为底替换商品，参考风格用布局签名重建场景），结果卡与空态明示"本地占位渲染" |
| 复刻要求中文进入图内文案 | 中文原文完整记录在任务参数，图内仅绘制 ASCII 部分 |
| AI润色 / 图片转提示词（语言/视觉模型） | 未接入模型，点击**如实提示**，不用假结果冒充 |
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
| multi-image-fusion | 两步流：场景网关（15 场景 2 组：表面附着 7 + 空间摆放 8）→ 工作区（返回场景列表 / 主体图必传 1 张 / 搭配图必传 1-5 张计数器 0/6 / AI分析 / 变体张数 4-1 / 高级设置 / 立即生成 40 积分 / 结果区重新生成+一键下载） | 网关卡片网格 → 工作区两步流原样落地；多图融合为**单图联络图**（2×2 网格，变体张数 = 网格内单元数），结果区明示占位 |
| product-sku | 模板图卡（≤1 张，从素材库导入禁用 + 手机上传提示 + copy「选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域」）+ 使用步骤卡（4 步）+ 提交「立即生成 本次消耗0积分」+ 结果 copy「一张图，批量套出版式完全一致的整组 SKU 图」 | 自备上传区 + 4 步步骤卡 + SKU 行编辑器（名称/颜色/区域）**按行批量提交 N 个任务**，结果多图并列 + 一键下载 |
| local-redraw | 上传 ≤1 张 + 重绘区域 + 描述（textarea）+ 设置（比例原比例 / 画质 1K）+「开始重绘 本次消耗5积分」+ desc「只想修改局部？圈出来写描述就行」 | 区域用**位置枚举（6 项）**代替画布涂抹；本地渲染在框选位置叠橙色边框 + 描述文字，明示 (MOCK) |
| background-remove | 背景颜色卡 7 项：透明底（棋盘格，默认）/白/浅蓝 rgb(130,206,243)/蓝 rgb(57,136,233)/红 rgb(255,11,34)/深红 rgb(168,0,27)/自定义；设置仅比例；「开始抠图 限时免费」 | 四角采样阈值真实抠除（阈值 60 内部常量），换底色后合成到输出画布；透明 + 原比例输出 PNG |
| watermark-remove | 最简页：上传 + 处理方式（自动识别/指定区域 + 五宫格位置）+ 无设置；「开始去除 限时免费」 | 本地为**参数化占位**（指定区域绘制半透明遮罩 + (MOCK) 标注），附合规提示，不冒充真实去水印 |
| product-retouch | 精修模式 6 pill（综合精修默认/质感增强/瑕疵修复/色彩校正/提升清晰度/材质强化）+ 补充要求 ≤200 字（ph「如：去掉电镀件上的指纹…」）+「立即生成 本次消耗5积分」 | 6 模式各自映射**真实像素管线**（亮度/对比/饱和/模糊半混/锐化模板/明度保色换色），note 以 ASCII 绘制在图内左上角 |
| image-translate | 目标语言 select 10 项（zh-CN 默认…th-TH）+ 保护商品主体 switch（默认开）+ 设置仅画质 +「立即翻译 本次消耗5积分」+ hint「* 确认素材和参数后提交，右侧会展示翻译结果」 | 本地为**参数化占位**：目标语言文字块（≤3 条）绘制在图内 + 保护开关绘制绿色保护框，(MOCK) 标注 |
| image-expand | 原图占比（100/80/60/50 + 1-99% 自由输入，默认 80）+ 原图位置九宫格（居中默认）+「立即扩图 本次消耗5积分」+ hint「*确认素材和参数后提交，右侧会展示生成结果」 | 真实实现：occupy 驱动画布（`longSide=max(w,h)/sqrt(occupy/100)`），九宫格定位对齐，clamp 采样边缘延展 + 固定 8px 羽化 |
| product-recolor | 商品颜色（白默认带勾/浅蓝/蓝/红/深红/自定义）+「立即换色 本次消耗5积分」 | 真实实现：颜色收敛（限 180 内部常量）保明度换色，(MOCK) 不适用，footer 标注 `AI RECOLOR <hex>` |
| rotate-angle | 旋转角度卡（h2 + 重置 rotate-ccw 16px）→ tabs 主体/摄像头（主体默认：3D 立方体 前/后/左/右/上/下；摄像头：轨道线 12×15° + 指针 + 4 箭头 ‹›⌃⌄）；滑杆 旋转 yaw -90..90 d0 / 倾斜 pitch -30..60 d0 / 缩放 zoom 0.8..1.2 d1（label 特写）；hint「相机保持静止，生成时按主体旋转角度重建商品展示。」 | 预览为 CSS 3D 立方体 / 轨道线动画；生成为**2D 近似**（yaw 旋转 + pitch 逐行逆剪切 + zoom contain 适配），页面明示近似 |

后 10 页相对参考站的**诚实差异**（在前 4 页差异表基础上追加）：

| 参考站 | 本项目 |
| --- | --- |
| 局部重绘：画布涂抹/框选水印区域 | 位置枚举（6 项 / 五宫格）代替画布交互，卡片明示 |
| 多图融合：AI 语义融合（主体自然融入场景） | 参数化版式合成（表面 4 角 / 空间底部排布 + 变体网格），结果区明示"本地占位渲染" |
| 商品SKU图：模板区域跟随 SKU 智能替换 | 模板底图 + 区域色块覆盖 + SKU 名绘制，按行批量出图，版式一致但非语义替换 |
| 旋转角度：3D 重建商品展示 | 2D 近似（旋转 + 剪切 + 缩放），页面 hint 明示 |
| AI分析（融合/翻译的语义识别） | 信息提示条明示"未接入视觉模型"，不展示假分析结果 |
| 积分消耗（0/5/40 积分文案） | 文案 1:1 保留（参考站事实），本地无积分体系不校验 |
| 手机上传（二维码） | 点击如实提示"本地演示环境不支持" |

## 验证记录（2026-10-15）

**全能力冒烟**（`node scripts/smoke-capabilities.js`，真实输入跑每一项并校验 magic bytes）：

```
12 项可提交能力全部产出: 真做 7 / mock 5，3 项 planned 按预期拒绝提交
参数收敛: size 99999→2048, ratio 'evil'→'1:1', platform 'hacked'→'taobao'
```

**后端端到端**（真实 HTTP）：capabilities 免登录下发（15 项 / 卡片 12 项 / 分组 3 个）·
stats 聚合 · recolor/expand/creative_image 生成 · planned 与输入图数量不足均被 400 拒绝 ·
素材库筛选 · 删除任务连带产物 · 删除原图保留历史任务 · 磁盘文件同步清理。

**浏览器端到端**（agent-browser + 本机 Chromium，真实点击）：

```
登录 → 工作台（顶导 + 侧栏 15 项分组 + hero + 12 卡片含免费角标 + 数据区 3 卡 + 最近生成真实缩略图）
→ 工具页 /tools/recolor：参数表单自动渲染（6 色 Radio.Group + 容差 Slider/InputNumber）
   → 上传 900×900 → 选中国红 → 生成 → 蓝瓶变红瓶，图内标注 AI RECOLOR #DC2626，结果区显示 900×900 · image/jpeg
→ 我的作品（5 条，状态筛选 + 缩略图 + 删除）→ 素材库（kind/能力筛选 + 分页）→ 数据中心（6 指标 + 近 7 天柱状图）
```

视觉核对：主色信任蓝 `#2563EB`，行动 CTA 橙 `#EA580C`，图标全 Lucide，无 emoji / 无紫粉渐变。

### 验证中发现并修复的缺陷

1. **number 参数双控件失效**：`Slider` 与 `InputNumber` 塞进同一个带 `name` 的 `Form.Item`，antd 只注入其中一个，
   另一个永远显示 min/0（容差默认值 60 显示成 10）。改为 `shouldUpdate` 受控读写表单状态。
2. **原图缺宽高**：素材库显示「—×—」。上传时用懒加载 jimp 探测宽高并落库（懒加载是为避免 7s 的 require 拖慢启动）。
3. **历史列表无缩略图**（上一轮已修）：`GET /tasks` 不返回 `outputAsset`，改为 `include` 后同形状返回。
4. **卡片无示例图**（视觉复刻时补）：`GET /stats/overview` 的 `byCapability` 增加 `thumbnailUrl`
   （该能力最近一次成功产出），卡片用真实产出做缩略图，无产出时显示设计化空态。
5. **antd `Layout` 默认 `flex-direction: column`**：改用自定义侧栏容器后，主区被推到侧栏下方，
   视觉上像"主区空白"。需显式 `flex-direction: row !important`。
6. **hover 预览被裁剪**：侧栏需要 `overflow` 滚动，而预览要溢出到主区，内联渲染必然被裁。
   改为 `createPortal` 渲染到 `document.body` + `position: fixed` + 视口内自动左右翻转。
7. **相对路径图片在 portal/异源场景失效**：`sourceUrl` 是 `/uploads/...`，渲染到别的容器时会
   按当前站点解析（Vite 5173 而非 API 3001）→ 404。统一走 `toAbsoluteUrl()`。

**前端构建**：`tsc --noEmit` 通过；`vite build` 通过（3487 模块 → 871.94 kB JS / 285.40 kB gzip + 8.36 kB CSS）。

## 验证记录（2026-10-16，product-kit / product-detail 复刻页）

**后端**：`npx tsc -p tsconfig.json` 编译通过；provider 冒烟（`smoke-main-image-variants.js` /
`smoke-detail-sections.js`）：

```
主图四变体   jpeg-ok 1024x1024 (白底/场景/卖点/其他, 各自可见差异) + scene 2k/3:4 → 2048x2731
详情图模块   default-6/single-hero/ten-modules 1024x3072 blocks=6/1/10, 未知键被过滤, hero-2k → 2048x6144
```

**前端**：`tsc --noEmit` 通过；`vite build` 通过。

**浏览器端到端**（agent-browser，1920×1080，真实点击，对照参考站实拍截图）：

```
product-kit:   上传 1 张 → 填名称/描述 → 生成 3 张 (白底图/场景图/卖点图, 均 1024x1024, meta 含平台/比例/画质/尺寸)
product-detail:上传 → 填表单 → 模块改选 (取消 2 项/勾选 2 项, 顺序保持参考站固定序) → 生成 1024x3072 四区块长图
                上限校验: 选满 10 个后第 11 个复选框禁用, 计数器停在 已选 10/10
素材库导入:    弹窗列出 7 个真实原图 (900x900 · image/png)
回归:          工作台 12 卡片 + hero 3 张真实产出 + 数据区 3 卡; /tools/main_image 表单按新参数声明自动渲染 8 项
```

### 浏览器验证发现并修复的缺陷

`GET /api/v1/tasks` 列表接口不返回 `outputAsset`（仅 `getTask` 返回），而前端 `HistoryList` 依赖
`task.outputAsset.sourceUrl` 渲染缩略图 → 历史列表永远显示占位图标。
已修：`listTasks` 改为 `include: { outputAsset: true }`，与 `getTask` 同形状（`outputAssetId` 有唯一索引，1:1 关系无 N+1）。

## 验证记录（2026-10-16，viral-clone 复刻页）

**后端**：`npx tsc -p tsconfig.json` 编译通过；新增 `scripts/smoke-viral-clone.js`
（合成输入：橙盘商品图 + 8×8 棋盘参考图，棋盘高频结构可区分"保留参考结构"与"重建场景"）：

```
high_replica     jpeg-ok 1024x1024   reference_style  jpeg-ok 1024x1024
strip-stddev     high_replica=57.4  reference_style=0.0   # 参考图真实参与 + 两档可见差异 (重建场景被平滑化)
center           rgb(249,114,21) orange=true (两档)        # 商品真实参与
2k-16x9          jpeg-ok 2048x1152                        # size=2k + ratio=16:9
solo-fallback    jpeg-ok 1024x1024                        # 仅一张图容错; 中文复刻要求被 ASCII 剥离不崩溃
```

回归：`smoke-main-image-variants.js` / `smoke-detail-sections.js` 全过（`drawFooterBar` 改为随字号
伸缩条高后 1K 输出不变、2K 不再裁切文字）。

**关键修复**：`generate.service.ts` 的 `processTask` 原先对 `inputAssetIds` 走 Prisma `in` 查询，
**返回顺序不保证**——爆款复刻依赖"第一张=商品图、第二张=参考图"的顺序语义，随机顺序会让商品/参考图
随机互换。已改为按 `inputAssetIds` 原序重排（对所有多图能力生效，单图能力无影响）。

**前端**：`tsc --noEmit` 通过；`vite build` 通过（3497 模块 → 1305.83 kB JS / 408.98 kB gzip + 36.13 kB CSS）。

**浏览器端到端**：本轮验证期间两台 dev server 已被用户主动停止（勿重启），viral-clone 的浏览器
E2E（上传商品图 + 参考图 → 两档复刻程度各生成一次 → 对照参考站实拍截图）留待服务重启后执行；
静态验证（tsc / vite build / provider 冒烟 / 回归冒烟）已全部通过。

## 验证记录（2026-10-16，free-creation 复刻页）

**后端**：`npx tsc -p tsconfig.json` 编译通过；`free_create` 由 planned 升级为 mock（参考图 0~4 张选填，
`inputs: 0` 不强制张数），新增 `scripts/smoke-free-creation.js`（4 张纯色参考图 + 提示词）：

```
refs-4      jpeg-ok 1024x1024; 条带 4 分区色差 maxDist=1 (红/绿/蓝/黄参考图真实参与构图)
refs-1      jpeg-ok 1024x1024; 条带中心为蓝色参考图
refs-0      jpeg-ok 1024x1024; 无参考图回落品牌紫渐变 (top=rgb(127,100,245))
2k-4x3      jpeg-ok 2048x1536
zh-prompt   jpeg-ok 1024x1024 (中文提示词 ASCII 剥离, 回落 FREE CREATION, 不崩溃)
long-prompt jpeg-ok 1024x1024 (80 词换行, 上限 8 行, 不溢出画布)
```

**全能力回归**：`smoke-capabilities.js` → 真做 7 / mock 6 / 失败 0，planned 拒绝提交正常；
`smoke-main-image-variants` / `smoke-detail-sections` / `smoke-viral-clone` 全过。
修复一处**存量测试债务**：参数收敛断言仍在用数值比较 enum 化后的 `size`（`'1k' <= 2048` 恒 false），
已按契约改为 `size === '1k'` 回落断言。

**前端**：`tsc --noEmit` 通过；`vite build` 通过。

**浏览器端到端**：两台 dev server 停止中，free-creation 的浏览器 E2E（上传参考图 → 排序箭头调整 →
生成 → 对照参考站实拍截图）留待服务重启后执行。

## 验证记录（2026-10-16，10 个工具页批次复刻）

**参考站取证**：10 个页面逐一实拍（agent-browser，computed styles + 结构探针 + 截图），
含 multi-image-fusion 两步流网关/工作区、product-sku 模板卡与 4 步步骤、rotate-angle 双 tab 预览控件、
background-remove 7 色 RGB 值、image-translate 10 语言清单、image-expand 占比/九宫格默认值等，全部登记入文档。

**后端**（`npx tsc -p tsconfig.json` 编译通过）：

- `smoke-capabilities.js` → **15/15 全部产出：真做 7 / mock 8 / 失败 0，planned 0**
- 新增 `smoke-multi-fusion.js` → 全过：

```
surface/space   jpeg-ok 1024x1024; surface 4 角色块命中 / space 底部行 ≥3/4 命中
variants-1/4    4 变体联络图 4/4 橙心; 1 变体满画布; 2k+16x9 → 2048x1152
input-guard     <2 张输入按预期拒绝
```

- 新增 `smoke-sku.js` → 全过：

```
5-swatch        1024x1024; 5 色板区域填充 maxDist<60; 16:9 → 1024x576
position-zone   top/bottom 区域落位正确; top 不污染中心模板蓝
param-merge     region/skuName/skuColor 参数收敛
```

- 回归：`smoke-main-image-variants` / `smoke-detail-sections` / `smoke-viral-clone` / `smoke-free-creation` 全过

**registry 对齐**（`capability.registry.ts`）：10 页参数全部按参考站表单重排——
`multi_fusion` / `sku_image` 由 planned **升级为 mock**（`mode` 变更 + 本地诚实渲染）；
`local_redraw` / `expand` / `matting` / `image_translate` / `enhance` / `recolor` / `rotate` 参数改为参考站
字段与默认值（原比例默认、颜色 7 项、语言 10 项、区域九宫格/五宫格/6 项、yaw/pitch/zoom 区间等）。

**前端**：`tsc --noEmit` 通过；`vite build` 通过（3510 模块 → 1377 kB JS / 55 kB CSS）。
新增 `ToolShell` / `ToolWidgets` 共享组件 + 10 个页面 + ~1100 行 CSS，路由与 `toolPath` 映射同步接入。

**浏览器端到端**：两台 dev server 已被用户主动停止（勿重启），本批次浏览器 E2E 留待服务重启后执行；
当前为静态验证（tsc / vite build / provider 冒烟 / 回归冒烟全部通过）。

## 验证记录（2026-10-17，free-creation 复刻复核轮）

用户再次指令复刻 `/free-creation`（该页 2026-10-16 已复刻）。本轮做**复核对拍**而非重造。

**参考站取证受阻（事实记录）**：agent-browser daemon 重启后参考站登录态丢失，`/free-creation`
未登录渲染为工作台菜单页（`工作台 / 登录/注册`），`/login` 返回 404（登录为站内弹窗），
无演示账号可登；Wayback 存档不可达。故以 **2026-10-16 登录态实拍登记值**为基准
（memory 日志 + 代码注释中的 computed styles）。

**本地复拍**（服务重启后，admin@demo.com 登录，1920×1080）：空态 / 就绪态（素材库导入 2 张，
2/4 计数 + 排序箭头 + 移除 + 添加卡 + 提示语）/ 生成态（提交 → 1024×1024，meta `1:1 · 1K · 1024×1024`，
参考图真实进入顶部条带，`refs=0` 提示词-only 回落正常）三态截图 + computed styles 同口径对拍。

**偏差清单（7 项，全部修复并复测命中）**：

| # | 偏差 | 登记值 | 修复前 | 修复 |
| --- | --- | --- | --- | --- |
| 1 | 结果栏有结果态无白底 | 结果栏白底 radius16 | `.pk-result-body` 透明（空态白、结果态灰，同页两态不一致） | 补 `background#fff / radius16 / padding16` |
| 2 | 高级设置浮层窄 32px | 比例选项 84.5×39 / 分辨率 116×62（数学蕴含浮层宽 400） | 浮层 368 → 选项 76.5×39 / 105×62 | `width: 368px → 400px` |
| 3 | 控制列宽 398 | 上传区/textarea/主钮 400（form-scroll 无 padding） | `.pk-form-scroll` `padding-right: 2px` 把 400 压成 398 | 移除该 2px |
| 4 | textarea 不可缩放 | resize vertical | `.pk-desc-editor textarea` 特异性 (0,1,1) 压过 `.fc-prompt-textarea` (0,1,0) | 提权 `.pk-desc-editor .fc-prompt-textarea` |
| 5 | 设置条 padding/颜色 | padding 0 12px / #687182 | 0 10px / #667184 | 按登记值修正 |
| 6 | chip 无白底 | chip 白底 | 透明（叠在白条上视觉近似） | 补 `background: #fff` |
| 7 | 次要按钮 212px | ghost 192×32 | grid 1fr 拉伸至 212（行宽 432） | 固定 `192px` 双列 + 窄屏回落 1fr |

**复测结果**：config-card 432 / dropzone 400×160 / textarea 400×80 vertical / summary 400×34
padding 0 12px #687182 / chip 白底 / ghost 192×32 / 浮层 400（选项 84.5×39、116×62）/
result-body 白底 radius16 padding16 / prompt-span #1D2129 —— 全部命中登记值。

**共享类修复的正外部性**：`.pk-settings-popover` / `.pk-form-scroll` / `.pk-settings-summary` /
`.pk-settings-chip` / `.pk-result-body` 为 pk/vc/fc 四页共享，修复后 product-kit 复测
控制列 398→400（参考值即 400），无回归（fc 专属类未泄漏到 pk 页）。

**闸口**：前端 `tsc --noEmit` 通过；`vite build` 通过（1377.10 kB JS / gzip 421.98 kB，5.37s）。

**开放项（证据冲突，待参考站可登录后复核）**：提交区（高级设置 + 主按钮 + 重置/清空结果）
是否应包裹在左侧白卡内——登记值同时含「main-card 白底 radius16 padding16 gap16，actions
margin-top auto 推底」（暗示包裹）与「布局与 pk 同构」（pk 为独立 config-card + 提交区，
上轮已对照参考站截图验证通过）。本轮维持 pk 同构结构不改，待登录态恢复后实拍裁定。

## 验证记录（2026-10-17，workbench 复刻复核轮）

用户指令复刻 `https://ijihua.cn/workbench`（该页 2026-10-15/16 已复刻两轮），本轮做**同口径对拍校正**。

**取证**：参考站 workbench 未登录可访问；首屏弹出「新人免费送100积分」营销弹窗
（`.guest-promo-overlay` z1500，关闭按钮 `.guest-promo-close` 28×28）需先关闭。
agent-browser 本版本 `viewport` 命令未实现（文档有、实现无），故**参考站与本地均在 1280×577
同视口下测量**，响应式下同口径对比有效。

**参考站实拍（类名 `wb-*`）**：`.wb-dashboard` 数据区 / `.wb-workflow-banner` hero /
`.wb-tool-section`+`.wb-tool-grid`+`.wb-tool-card`+`.wb-tool-visual`+`.wb-tool-icon`+
`.wb-tool-copy`+`.wb-tool-title` / `.wb-data-layout`+`.wb-panel`+`.wb-account`+`.wb-recent` /
`.wb-login-prompt`；`.workspace-route-content` 为内部滚动容器（overflow-y auto）。

| 项 | 参考站实拍 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| hero 尺寸 | **1142×212** | 1117×**268**（被拼贴撑高） | 1117×**212** ✅ |
| hero padding | `0 100px` | `28px 72px` | `0 84px`（补偿容器偏移，文案落 x=208） |
| hero 标题 | 32px/500 **#000** lh**20** | 32px/500 #0F172A lh**41.6** | 32px/500 #000 lh20 ✅ |
| hero 文案块 | **476×75 @x208** | 476×85 @x196 | **476×75 @x208** ✅ |
| hero 背景 | #DCECFF + `bannerbg.png` cover | 渐变（诚实替代） | 维持（不引用第三方图片） |
| 卡片标题 | **14px/600 #171A2B lh16** | 16px/400 #333 lh20 | 14px/600 #171A2B lh16 ✅ |
| 卡片描述 | 12px/400 #86909C lh20 | 同 | ✅ |
| 卡片数与顺序 | 12，商品主图→旋转角度 | 12，完全同序 | ✅ |
| 图标块 | 40×40 白底 radius8 阴影 @left15/top69 | 同（top 随卡宽浮动） | ✅ |
| 数据区 | `750.7px 375.3px` gap16 **margin-top 16** | gap16 **margin-top 0** | margin-top 16 ✅ |
| 面板圆角 | 账号/创作数据 **12**、最近任务 **16** | 全部 12 | 12 / **16** / 12 ✅ |
| 面板高度 | 268（未登录态） | 319（登录态内容更高） | 维持内容驱动 |

**关键修复**：hero 原为 `min-height: 212` + `padding: 28px 72px`，而右侧真实产出拼贴
（`.wb-hero-collage` 440×212）参与 flex 布局把 hero 撑到 268px，与参考站 212 不符。
改为 hero `height: 212px` + 拼贴 `position: absolute`（不再参与布局），并合并窄屏断点
（原 1100px 与新增 1200px 重复 → 统一 1200px 收起拼贴、不塞假图）。

**诚实差异（维持，已写入页头注释）**：参考站主区是内部滚动容器，本地用 window 滚动，
内容区窄 ~25px（侧栏 99 vs 84 + 滚动条）→ 卡片 173×188 vs 177×197、hero 1117 vs 1142 宽；
hero padding 用 84px 补偿使文案与参考站同绝对坐标。

**闸口**：前端 `tsc --noEmit` exit 0；`vite build` 通过（4.79s）。

## 环境注意事项（重要）

本机 npm 走 broker 代理，大批量安装会触发 5 分钟硬超时，因此依赖用 `curl` + `tar` 直装。
由此产生的版本漂移已逐项修正（express/body-parser/type-is/media-typer/raw-body/multer 链、
`@babel/runtime` 7.x、`lightningcss` 与 `@rolldown` 的 darwin-x64 原生包）。

**`package.json` 已锁定为实际验证通过的精确版本，但 `node_modules` 里的嵌套副本无法由 npm 自动重现**
（`multer/node_modules/type-is@1.6.18` + 其下 `media-typer@0.3.0`、`webpack/node_modules/mime-types@2.1.35`）。
其中 `media-typer` 那条最关键：错版会让 multer **静默不解析 multipart**（不报错，只是收不到文件）。

因此提供了审计工具：

```bash
npm run verify:deps            # 全量审计 + 列出已记录无害项及依据
npm run verify:deps:critical   # 只查运行时关键链 (推荐日常使用)
node scripts/verify-deps.js --quiet   # 仅输出结论, 有致命问题则 exit 1 (可接 CI)
```

工具按 Node 的真实解析顺序判断（嵌套副本优先、顶层兜底），并维护两份显式清单：
`ACCEPTED_PINS`（刻意为之的精确 pin 偏差）与 `KNOWN_BENIGN`（已验证无影响的偏差簇，逐条附验证依据）。
当前状态：**致命 0 / 已记录无害 73 / 提示级 9 / 必需嵌套副本 4:4 就位**。

新增依赖后请重跑一次；若工具报出未在清单中的问题，按它给出的 `from 需要 need, 实际 has` 定位，
必要时把该包降到 `need` 指定的主版本，或按冲突情况嵌套安装后再登记清单。

## 验证记录（2026-10-17，全站复刻批次：营销首页 + 路由对齐）

用户指令「整页面设计复刻全部页面 https://ijihua.cn/」。先做**全站可达性普查**（结论见下表），
再按用户三项决策执行：营销页商业内容照搬 / 路由对齐参考站 / 我的作品整页等登录态。

### 可达性普查（未登录）

| 参考站 | 可达 | 本地现状 |
| --- | --- | --- |
| `/workbench` 工作台 | ✅ | 已 1:1 |
| 14 个工具页 | 需登录 | 已 1:1 |
| `/my-works` 我的作品 | ✅ | 功能型 antd 页（**按决策推迟到登录态**） |
| `/` 营销首页 landing | ✅ | 本轮新建 |
| `/packages` 购买套餐 | ✅ | 并入 landing 套餐段 |
| 素材库 / 数据中心 / 邀请有奖 / 签到 | ❌ 登录门控，纯 JS 路由未发现 | 本地有页面但无实拍依据 |
| 创意生图 | ✅ 实拍跳 `/free-creation` | 本轮对齐（原跳 `/tools/creative_image`） |

### 路由对齐（按参考站）

`/` = 营销 landing（**免鉴权、全宽无侧栏**，独立外壳），
工作台迁至 `/workbench`。同步修正的品牌标识与跳转：`app-brand` → `/workbench`、
顶导「首页」→ `/`、侧栏「工作台」active 判定 → `/workbench`、
`LoginPage` 登录后与 `ToolPage` 返回按钮 → `/workbench`、404 兜底 → `/workbench`。
`toolPath('creative_image')` → `/free-creation`（对齐参考站创意生图入口）。

### landing 实拍与实现对照（1280 视口）

| 段 | 参考站实拍 | 本地实测 |
| --- | --- | --- |
| hero | 1274×238，padding `64px 24px 48px`，双层渐变；h1 40/500 #171A2B lh63 居中 | 1265×214，同 padding/渐变/h1 全部命中 |
| businesses | grid 3×389.3 gap16；卡 389×323 radius24 padding24 | 3×382；卡 382×308 radius24 |
| tools | grid 4×276 gap16；卡 276×88 #F2F4F7 radius8 padding `24px 40px`，图标 24 | 4×282.5；卡 283×88 命中 |
| packages | 标题 24/700；tabs 328×38 胶囊 #E4E7EF radius999；价格 32/700 #333 | tabs 305×38；价格命中 |
| cases | h2 24/700 左对齐；7 tab；grid 4×288 gap16；卡 288×384 radius16，图 600/800 | 4×282.5；卡 283×377 |
| features | wide 1200×541 grid `400/728` gap24 radius24；grid 2×592，卡 592×311 radius24 | wide 1178×575 grid `400/706`；双卡命中 |
| footer | 1274×264 白底 padding `32 32 28`，4 列 | 1265×218 同 padding/列结构 |

### 资源落地

案例图 96 张（7 tab：spzt/spxqt/bkfk/cyst/cpjx/yjkt/xzjd）+ 业务图 3 + 特性图 8 + 客户 logo 3
+ 图标 15 = **125 个文件 / 62MB**，下载到 `frontend/public/landing/`
（`case|biz|feat|logos|icons` 五个子目录），**自托管不热链第三方 CDN**。

**踩坑**：下载脚本把 URL 编码名直接当本地文件名（`%E5%95%86...png`）导致 3 张图裂；
`find -size -2k -delete` 误删了 7 个合法的 <2KB SVG 图标；`buildFiles` 的 `lastOverride`
参数传了完整文件名，拼出 `spzt_08_2.08_2.jpg`。三处均已修（解码重命名 / 重下图标 / 传扩展名）。

### 商业内容处置（用户决策：完全照搬）

套餐真实价目（周卡 ¥9.90 / 月卡 ¥39.90 / 季卡 ¥109 / 年卡 ¥359 + 原价划线 + 积分与权益）、
营销文案、案例图、客户 logo 均按参考站照搬。**保留本项目自有品牌标识**
（页脚为「货觉AI · 电商视觉创作平台」，不替换为参考站商标），页脚版权行注明
「商业内容与案例素材按参考站设计复刻，仅用于设计对齐演示」。
本地无积分与支付体系，「立即购买」按钮为展示态，不接任何支付链路。

### 闸口

前端 `tsc --noEmit` exit 0；`vite build` 通过（1389.63 kB JS / gzip 425.08 kB，3.45s）。
浏览器验证：landing 41 张图 **0 裂图**；`/workbench` 登录态正常（hero + 12 卡片），
清除 token 后访问 `/workbench` 正确跳 `/login`。

### 补充轮：landing 顶部导航 + sitemap 路由发现

**路由发现方法（重要）**：参考站路由为纯 JS 路由（菜单按钮无 `href`/`data-path`，猜路径全 404），
有效来源是 **`robots.txt` 指向的 sitemap**：`https://www.ijihua.cn/sitemap.xml` 共 **28 条 URL**，
其中此前未被发现的包括 `/invitations`、`/sitemap.html`、`/legal/{user-agreement,privacy-policy,
account-rules}.html` 与 7 条 `/help/*`（实测 help 页已 404，sitemap 陈旧）。
登录门控页（素材库/数据中心）**不在 sitemap 中**，无法通过该渠道拿到路由。

**补齐 landing 顶部导航**（复刻参考站 `.landing-topbar`，实拍 64px 白底 / `padding 0 24px` /
logo 36×36 / 导航项 h32 13px radius8 padding `0 14px` / 激活态 #F1EFFF + #5546D8 /
下拉项 radius9 padding `0 12px`）：

| 项 | 参考站 | 本地 |
| --- | --- | --- |
| topbar | 1274×64 @ y40 | 1265×64 @ y40 ✅ |
| 品牌 | 266×38 @x24（logo 36×36 @30,54） | 152×38 @x24（mark 36×36 @30,54）✅ |
| 导航项 | 首页 54×32 / 电商生图 97×32 / AI修图 84×32 | 54×32 / 97×32 / 83×32 ✅ |
| hero 顶部 | y=104 | y=104 ✅（促销条 40px + 导航 64px 累计一致） |

导航下拉由能力清单驱动（电商生图 6 项 / AI修图 8 项，条目带能力名 + summary）。
参考站右侧的「新人免费生图10张」「签到得积分」为积分营销位，本地无积分体系 →
替换为如实标注的「本地算法 · 不限次数」胶囊（同为 #F1EFFF/#5546D8/radius999 规格）。
**闸口**：`tsc --noEmit` exit 0；`vite build` 通过（1391.55 kB JS / gzip 425.52 kB）。

### 补充轮 2：sitemap / invitations / legal 三页（sitemap 新发现的页面）

`sitemap.xml` 里除已知页面外还有 `/invitations`、`/sitemap.html`、`/legal/*.html`（help 7 条已 404）。
本轮把这三组补齐，路由与版式如下。

**网站地图 `/sitemap.html`**（免鉴权，全宽外壳；参考站实拍：main 1100、h1 68px/780 lh66.64、
双列各起点 x=162/721、编号 10px/750 letterSpacing 1.2 四色、组标题 17px/720、
条目 491×38 list-item + 名称 16px #182033 + 路径 11px #9AA1B1）：

| 项 | 参考站 | 本地实测 |
| --- | --- | --- |
| main 列宽 | 1100 | 1100 ✅ |
| h1 | 68px/780 lh66.64 | 68px/780 lh66.64 ✅ |
| 双列 | 502 + 96 gap | 502 + 96 gap ✅ |
| 编号色 | #625DF5 / #2AA8C0 / #E68662 / #35A889 | 同 ✅ |
| 条目 | 16px + 11px | 16px + 11px ✅ |

**诚实差异**：参考站条目列的是它自己的路由（含 `/my-works`、独立 `/packages`），
本地按**本项目真实路由**填充（`/works`、套餐已并入营销首页），不产生指向不存在页面的死链。

**邀请页 `/invitations`**：复刻参考站未登录可见的版面（主视觉 + 邀请步骤三步 + 规则说明 + 数据明细 4 格）。
参考站整页围绕积分奖励（立赚 100 积分 / 奖励自动发放 / 累计收益积分），本地无积分与邀请体系 →
主视觉与步骤按真实语义改写为「分享链接 → 好友访问 → 一起创作」，
**数据明细改为真实可查数据**（今日产出 / 累计作品 / 真实产出图 / 工具能力，来自 stats 与能力清单接口），
规则说明如实写明本地不提供积分奖励。「复制邀请链接」为真实功能（写剪贴板本站地址），
「查看邀请海报」如实提示未实现。

**法务页 `/legal/{user-agreement,privacy-policy,account-rules}.html`**（数据驱动，三份共用渲染）：
复刻参考站 744px 文档版式（h1 28px/700 lh39.2 + 导语 21px/lh29.4 + 正文 15px/lh27.75 #4B5874）。
参考站原文以「深圳市科极灵径科技有限公司」为协议主体，逐字照搬会让本站产生错误的主体声明 →
**只复刻版式**，正文用本项目模板文本并在首段用醒目条明示「演示模板，正式对外前请替换为法务文本」。
如需照搬原文请告知。

**闸口**：`tsc --noEmit` exit 0；`vite build` 通过（1.14s）；浏览器实测三页均正常渲染
（sitemap 4 分区 23 条目 / invitations 3 步 4 指标 / legal 标题与分节正确）。

### 补充轮 3：我的作品整页重写（CSS 产物取证突破登录墙）

此前该页因参考站作品卡片在登录墙内而搁置。本轮改用**样式产物取证**：`/assets/index-*.css`
**未混淆、类名可直读**，从中提取到卡片区全部规格，等价于实拍。

**取证方法（可复用）**：`curl` 首页 HTML → 取 `/assets/index-*.js|css` → 产物 CSS 用
`grep -oE '\.my-work[a-z0-9-]*'` 列类名、`python3 re` 抽规则体。JS 是字符串混淆的
（`_0x...(0x..)`），只有少量字面量泄漏，路由表仍不可读；但 **CSS 完全够用**。

参考站 CSS 提取到的关键规格（42 个 `.my-works*` / `.my-work*` 类）：

| 类 | 规格 |
| --- | --- |
| `.my-works-grid` | `repeat(6, minmax(0,1fr))` gap 16 align-items start（窄断点降 5 列） |
| `.my-work-meta` | `position:absolute; top:10px; left:10px; z-index:7; gap:9px; pointer-events:none` |
| `.my-work-card.selected` | `outline-color:#6c5ce7` |
| `.my-work-check input:checked+span` | `background:#6c5ce7` |
| `.my-works-selection-bar` | 12px / `#5b4bd7` on `#f1efff` / padding `10px 14px` / radius 9 / margin-top 10；按钮 11px 白字 radius 999 padding `6px 10px` |
| `.my-works-load-more` | min-height 58 / 12px `#9a958d` |
| `.my-works-empty` | min-height 300 / `#9a958d` / align-content center / gap 8 |
| `.my-works-tabs` | border-bottom `#ece9e3` gap 24；按钮 14/600 `#8b8f9b` padding `0 0 12px` |
| `.my-works-filter-trigger` | min-width 108 / padding `9px 12px` / border `#ebe8e1` / radius 999 / 12px `#5f5b55`；active `#5b4bd7` + `#6c5ce7` |
| `.my-works-filter-popover` | radius 12 padding 16 shadow `rgba(33,31,27,.14) 0 16px 36` |
| 浮层尺寸 | 业务类型 330 / 日期 308 / 状态 214 / 所属任务 318 |

`WorksPage.tsx` 由原 antd 功能页**整体重写**，实测：

| 项 | 实测 |
| --- | --- |
| 页面 | padding `28 28 72`；h1 38.4/600 #161616 |
| tab | 2 个，gap 24，border-bottom #ECE9E3 |
| 工具栏 | 白底 radius16 padding `12 14` shadow `rgba(41,33,22,.04) 0 12 30`；4 个筛选器各 108×39 |
| 业务类型浮层 | 330×350，2 分组 14 个能力 chip（与参考站 6+8 一致） |
| 网格 | 5 列 199.4 gap 16（容器 1061 触发参考站同款 5 列断点） |
| 卡片 meta | absolute top 10 left 10 gap 9 z-index 7 ✅ |
| 多选 | 选择 2 张 → 选择条 `#F1EFFF`/`#5B4BD7`/radius9/padding `10 14`/12px + 卡片 outline 2px `#6C5CE7` |
| 真实筛选 | 点「商品主图」→ 19 张收敛为 4 张，计数与「清除筛选」同步 |

**诚实差异**：视频作品页签保留但点击如实提示本地无视频能力；「所属任务」按本地真实任务
ID/能力名检索（参考站为云端任务 ID）；卡片悬停浮层提供再来一张/下载/删除真实操作。

### 补充轮 4：素材库重写（`asset-library-*` 86 类取证）+ 数据中心定性

继续用 CSS 产物法在参考站样式表里找页面族，命中 **86 个 `.asset-library-*` 类**（素材库）；
同时确认：**参考站没有独立「数据中心」页** —— 样式表里与数据相关的只有 `.workbench-content`，
其侧栏「数据中心 ▾」是分组，唯一子项是素材库，数据内容即工作台的 3 个面板（本项目已 1:1 复刻）。

素材库规格与实测对照：

| 项 | 参考站 CSS | 本地实测 |
| --- | --- | --- |
| 页面 | padding `24 24 56`，#171A2B | 同 ✅ |
| header | flex / flex-end / gap 24 / mb 22 | 同 ✅ |
| 按钮 | h42 / radius11 / border #DFE3ED / 13px #4F5970 | 118×42 同 ✅ |
| 分组面板 | radius16 / padding `18 20` / border #E5E8F0 | 同 ✅ |
| 网格 | `repeat(5,minmax(0,1fr))` gap16；断点 ≤1200→4、≤380→1 | 5×201 gap16，断点一致 ✅ |
| 卡片 | radius14 / border #E4E7EF / shadow `0 5px 16 #2A315709` | 同 ✅ |
| 封面 | `aspect-ratio:1` / #F1F3F8 | 253×253 同 ✅ |
| 勾选 | 22×22 / top10 left10 / radius7 / `0 1px 4 #1B1F3329` | 同 ✅ |
| 标题 / meta | 13px/600 #30364A / 11px #A0A7B6 | 同 ✅ |
| 加载更多 | min-height 52 / 12px #8B94A8 | 同 ✅ |

**诚实差异**：素材分组（文件夹）本地后端无对应契约 → 保留面板版式与「新建分组」入口，
点击如实提示未实现；来源/能力筛选改用本地真实 kind 与能力维度；上传、批量下载、删除均为真实功能。

**关于 `/stats`**：本项目的「数据中心」页（6 指标 + 近 7 天柱状图 + 能力分布 + 最近任务）
在参考站**没有对应页面**，属本地自有补充，不属于 1:1 复刻范围，保留现状。

### 补充轮 5：全站回归验证（21 页改动后）

本轮改动量较大（路由迁移 + WorksPage/LibraryPage 重写 + landing/sitemap/invitations/legal 新增 +
5 个 CSS 块约 2500 行），按「跑≠改」纪律先做全量回归，未发现回归。

**路由渲染巡检（24 条，含免鉴权页）**：

```
/ /workbench /product-kit /product-detail /viral-clone /free-creation /multi-image-fusion
/product-sku /local-redraw /background-remove /watermark-remove /product-retouch
/image-translate /image-expand /product-recolor /rotate-angle /works /library /stats
/sitemap.html /invitations /legal/{user-agreement,privacy-policy,account-rules}.html
→ 全部 ok:true、正文长度 335~1242、无错误边界文本
```

**鉴权边界**：清空 token 后 `/workbench` `/works` `/library` `/stats` `/invitations` 全部跳 `/login`；
`/` `/sitemap.html` `/legal/*` 免鉴权可访问（与参考站一致：营销页/索引/法务为公开页）。

**后端冒烟回归**：

```
smoke-capabilities   真做 7 / mock 8 / 失败 0 → ALL PASS
smoke-main-image-variants / smoke-detail-sections / smoke-viral-clone
smoke-free-creation / smoke-multi-fusion / smoke-sku   全部 PASS
```

## 真实模型通道（可插拔 + 自动回落）

**本轮先落地通道，不伪造模型产出。** 当前无可用模型凭据，因此实现的是「真实通道 + 自动回落」的完整骨架：
15 项能力（含原 7 项本地算法）都从同一个路由器出去，凭据到位后**只改环境变量即切真模型**。

### 架构

```
generate.service ──IMAGE_PROVIDER──> CapabilityRouterProvider
                                     ├─ route=remote/auto 且网关可用 → GatewayImageProvider
                                     │    POST {base}/generation/tasks  {type:'image', prompt, model, params}
                                     │    轮询 GET  /generation/tasks/:id → 下载产出图
                                     └─ 否则 / 通道失败 → MockImageProvider（本地 Jimp）
产出带 source(gateway|local) → generate.service 落库 task.provider → 前端如实显示来源
```

### 对接的网关契约（aigc 网关，2026-10-17 实读源码）

`POST /api/v1/generation/tasks`（`{type, prompt, model?, params?}` → 任务 id）+
`GET /api/v1/generation/tasks/:id`（轮询终态）；`@UseGuards(JwtAuthGuard)` 需 Bearer token。
客户端对响应字段做了多别名兼容（`id/taskId`、`status/state`、
`outputUrl/resultUrl/assets[0].url/outputs[0].url/data.*`），第三方改字段不会直接打挂。

### 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `GATEWAY_BASE_URL` | `http://localhost:3001/api/v1` | 网关基址（设置即视为开启远程） |
| `GATEWAY_TOKEN` | 空 | Bearer token（网关 JWT 或服务令牌） |
| `GATEWAY_MODEL` | 空 | 指定模型；留空交由网关按渠道路由决定 |
| `GATEWAY_ENABLED` | 空 | `1/true` 强制开启远程 |
| `GATEWAY_TIMEOUT_MS` / `GATEWAY_POLL_MS` / `GATEWAY_MAX_POLLS` | 120000 / 2000 / 60 | 超时、轮询间隔、轮询次数 |
| `ASSET_PUBLIC_BASE` | `http://localhost:<PORT>` | 参考图回传基址（网关需能拉取） |
| `GATEWAY_ROUTE_<能力ID>` | `auto` | 单能力路由：`local` 强制本地 / `remote` 强制远程 |

参考图以**站内 URL** 形式回传（`params.inputImages`），不传本地磁盘路径；
业务参数与 15 项能力各自的提示词模板一并送出（如抠图带背景色、换色带目标色、旋转带 yaw/pitch/zoom）。

### 失败策略

网关未配置 / 超时 / 非 2xx / 终态失败 / 产出缺图，**一律回落本地算法并打 WARN 日志**，
用户始终拿得到图，绝不因外部服务故障白屏或空结果。

### 验证（`scripts/smoke-gateway-channel.js`，20 项断言全过）

用一个**契约一致的网关桩**（真实 HTTP 往返，非 mock 打桩）验证：

```
✅ 路由快照覆盖 15 项能力；配置网关后 15 项 effective 均为 gateway
✅ 远程路径 source=gateway，产出确为桩返回的 512x512（尺寸可证不是本地算法产物）
✅ 请求体校验：type=image / Bearer token / model 透传 / params.capability
✅ 提示词注入业务参数（自由创作 prompt 40 字；抠图含背景色 #3988E9）
✅ 参考图以站内 URL 回传 http://localhost:3002/uploads/original/xxx.png
✅ GATEWAY_ROUTE_MATTING=local → 强制本地且不发远程请求
✅ 未配置网关 → 回落本地（source=local，产出仍是合法图片）
✅ 网关不可达（端口无人监听）→ 回落本地且不抛错
✅ 15 项能力均有专属提示词，无 fallback 成 capability id
```

回归：`smoke-capabilities`（真做 7 / mock 8 / 失败 0）+ 6 个专项冒烟全过，后端 tsc 通过。

**尚未接通的部分（如实说明）**：未配置真实 `GATEWAY_TOKEN`，也未启动本机 aigc 网关（3001 当前未运行，
且其 `.env` 内无模型 API key，渠道凭据应存于其数据库），因此**真实模型出图质量尚未验证**。
通道本身（请求构造、轮询、下载、回落、来源落库）已用桩跑通。

### 严格 1:1 轮：workbench 数据区按样式产物全量对拍（2026-10-17 晚）

前一轮只对齐了 hero / 卡片 / 面板外框。本轮把参考站产物 CSS 里的 **52 个 `wb-*` 类**全部提取，
对数据区做**全量对拍**（不再抽查），发现并关闭 7 处偏差。

参考站 CSS 提取结果（`.wb-*`）与本地实测：

| 类 | 参考站 CSS 规格 | 本地实测（修复后） |
| --- | --- | --- |
| `wb-panel` / `wb-recent` | `radius12` / `.wb-recent{radius16}` | 12 / 16（参考站自身不一致，按实拍保留） |
| `wb-account, wb-recent, wb-dashboard` | `padding 24`（窄屏 16） | 24 ✅ |
| `wb-panel-title` + 按钮 | flex space-between center gap12；按钮 12px **#667085** inline-flex gap**3** | 12px #667085 gap3 ✅ |
| `wb-account-metrics` | `grid 1fr 1fr **1.35fr**` gap16；块 `#F2F4F7` radius8 padding **20 24** | 195/195/263 + #F2F4F7 radius8 20/24 ✅ |
| `wb-account th/td` | th `#4E5564` bg `#F2F4F7` padding **9 12** fw500；td border-bottom `#EFF0F4` padding 9 12 | 同 + 4 行真实记录 ✅ |
| `wb-flow-type` | inline-block radius4 padding **2 7** 11px/15px | 46×19 radius4 2/7 11px ✅ |
| `wb-jobs-list` / `wb-job` | flex column gap**24** mt24；thumb **80×80** `flex 0 0 80px` radius8 `#F2F3F7`；copy flex1；status `flex 0 0 80px` **14px** | 4 行 / 80×80 / status 80px 14px ✅ |
| `wb-jobs-empty` | `#98A0AF` center padding **100px 0** 13px | 同 ✅ |
| `wb-dashboard-stats` | `repeat(6,minmax(0,1fr))` gap16 **mt24**；块 `#F2F4F7` radius8 padding **24** | 6 格 164.8px gap16 mt24 ✅ |
| `wb-dashboard-head` 首列 span | chip border `#E5E7EF` radius**14** padding **7 12** `#667085` | 64×35 radius14 ✅ |
| `wb-chart-title` / `wb-trend-chart` | `margin 24 0 12` 13px / `width100%` **height 210** | 1069×**210** ✅ |

**本轮关闭的 7 处偏差**：① 账号面板指标块从「无底色文字卡」改为参考站的灰底卡（#F2F4F7 radius8 padding 20/24）
且列宽改为 `1fr 1fr 1.35fr`；② 账号面板**新增流水表**（th/td + 业务类型 tag，本地无计费体系故列真实任务记录）；
③ 最近任务从 40px 缩略图行改为参考站的 **80×80** job 行（gap24/mt24 + 80px 状态列）；
④ 数据面板从「3 卡 + 图」改为参考站的 **6 格指标**（全部真实统计）+ 头部 chip；
⑤ 趋势图容器从自定义改为 `.wb-trend-chart` **210px** 并补 `.wb-chart-title` 标题行；
⑥ 面板头按钮颜色/间距对齐（#667085 / gap3）；⑦ 补 `wb-jobs-empty` 空态规格。

**诚实差异**：账号面板表格版式取参考站规格，但**内容是真实任务记录而非积分消耗流水**（本地无积分与计费体系，
面板底部保留「本地算法运行，不限次数」的如实说明）；面板高度由内容驱动（参考站 268px 是未登录态登录提示的高度）。

**闸口**：`tsc --noEmit` 通过；`vite build` 通过（3.57s）；浏览器实测 12 卡 / 4 job 行 / 6 格指标 /
4 行表格 / 趋势图 210px / 0 裂图；`/works` 回归正常（共用 `.status-*` 未走样）。

**修复中的一个自伤**：用 python 批量删旧 `.wb-recent-*` 规则时把 `.status-*` 的闭合括号一起删掉，
导致 `@keyframes` 嵌套、`vite build` 报 `Unknown at rule: @keyframes`；已补回规则并用括号平衡
扫描确认 `final depth: 0`。**教训：批量删 CSS 规则后必须做括号平衡检查 + build**。

## 设计一致性收口（2026-10-17）

用户反馈「页面设计存在不统一」。先做**审计取证**（脚本统计 `global.css` 各分区色值），再按用户决策
「紫色 + 中性色全收拢」执行。

### 审计证据：同一语义散落 6-7 个近似值

| 语义 | 收拢前取值 |
| --- | --- |
| 品牌紫 | `#5546D8`×30 `#6C5CE7`×32 `#8064F6`×32 `#5B4BD7`×21 `#5D47EA`×16 `#625DF5`×4 `#9358EF`×1 |
| 次要文字 | `#667085`×28 `#86909C`×28 `#4E5969`×9 `#9A958D`×10 `#9AA1B1`×6 `#98A0AF`×3 `#98A1B2`×4 |
| 边框 | `#E5E7EF` `#E4E7EF` `#E4E6EF` `#EBE8E1` `#E1E4ED` `#DFE3ED` `#E5E1DB` |
| 标题黑 | `#333` `#171A2B` `#182033` `#1D2129` `#30364A` `#3D3934` `#4E5564` |

**根因**：① 参考站本身即多页面族多设计语言（工作台/工具页冷灰 vs 我的作品/素材库暖灰 vs landing 自有），
逐页 1:1 复刻把差异一并搬了过来；② 项目早就有 token 层，但页面全走硬编码，token 被绕过；
③ 最糟的是 `--color-primary: #2563EB`（蓝）与紫系页面混用。

### 收拢结果

**品牌紫 7 → 3 态**：`--brand #5546D8`（唯一主色）/ `--brand-light #6C5CE7`（仅渐变浅端）/
`--brand-hover #5B4BD7`（交互态）/ `--brand-bg #F1EFFF`（唯一激活底）。
旧名 `--brand-strong/-active/-accent/-grad-end` 保留为指向新值的别名，避免语义丢失。

**中性色两族 → 一族**：`--text-strong #171A2B` / `--text-body #4E5969` / `--text-muted #667085` /
`--text-desc #86909C` / `--border #E5E7EF` / `--surface #F2F4F7`；暖灰族 token 全部并入并重命名。

**圆角归一为 5 档 + 胶囊**：`--radius-tag 4` / `--radius-control 8` / `--radius-card 12` /
`--radius-panel 16` / `--radius-hero 24` / `--radius-pill 999`（原 3/5/6/7/9/10/11/14/18/20/22/28 全部映射）。

**字号归一**：17/18→16、26→24、38.4→40、15→14，主视觉层级（32/40/68）保留。

**状态色集中**：警告/成功/危险/信息/边框点/表格行/hero 渐变等 16 个一次性色值也定义成 token。

**顺带修掉的真 bug**：`.wb-panel-link:hover` 与 `.wb-trend-bar` 用了蓝色 `--color-primary`，
在紫系页面里显示为蓝紫跳变 → 改为品牌紫。

### 量化结果

```
规则体硬编码 hex:  342 → 20（且残留 20 个均为"全站仅出现一次"的一次性值，不再是同义簇）
token 定义数:       77
圆角取值:           4/8/12/16/24/999 + 2px(进度条) + 50%(圆)
```

### 代价（如实说明）

收拢意味着**部分页面偏离参考站实拍值**：我的作品/素材库的暖灰改为冷灰体系、实心主按钮由 `#6C5CE7`
改为 `#5546D8`、hero 副标题 17→16px 等。这是用户明确选择的「统一优先于逐页 1:1」的结果，
参考站实拍值仍完整保留在 README 各页「复刻说明」与代码注释中，可随时按页回退。

### 闸口

`tsc --noEmit` 通过；`vite build` 通过（1.50s）；22 条路由巡检 0 异常、页面底色统一 `rgb(246,247,251)`；
工作台/我的作品/landing 三页截图复核，视觉统一无破版。

## 验证记录（2026-10-17 晚，workbench 严格 1:1：零偏移）

用户指令「严格 1:1 复刻页面设计，**不偏移，没有差异**」。这与上一轮「设计一致性全收拢」直接冲突
（收拢改动了工作台的若干实拍值）。按指令优先级：**workbench 以参考站产物 CSS 字面值为唯一基准**，
为此给该页建了**专属 token 组 `--wb-*`**，不走全局收拢后的 token，从结构上保证此页不被其他页的
统一诉求带偏。

### 参考站 `wb-*` 规则全量导出（129 条）后逐项对齐

| 规格 | 参考站字面值 | 本页实测（对齐后） |
| --- | --- | --- |
| `.wb-workflow-banner h1` | 32px/500 **#000** lh20 | 32px/500 #000 lh20 ✅ |
| `.wb-workflow-banner p` | 17px lh31 **margin-top 24** #667085 | 17px lh31 mt24 ✅ |
| `.wb-tool-grid` | `repeat(6,minmax(0,1fr))` gap16 | 6 列 gap16 ✅ |
| `.wb-tool-card` | #333 / radius16 / hover `0 7px 20 #21234114` | 同 ✅ |
| `.wb-tool-visual` | `aspect-ratio:2` / 占位底 **#C9C9C9**（空态 #C7C7C7） | 同 ✅ |
| `.wb-tool-copy` | **固定高 108** / padding `40 16 24` | 173×108 / 40 16 24 ✅ |
| `.wb-tool-copy strong` | 14px/600 **#171A2B** lh16 | 同 ✅ |
| `.wb-tool-copy span` | 12px **#86909C** lh20 **mt8** | 12px #86909C mt8 ✅ |
| `.wb-tool-icon` | 40×40 radius8 left15 **bottom 88** shadow `0 2 6 #6B72804D` | bottom 88 / left 15 / 同阴影 ✅ |
| `.wb-tool-title em`（角标） | **#FFF on #F00024** radius8 padding `1 5` 10px/500 lh14 | #F00024/#FFF/10px/500/lh14 ✅ |
| `.wb-tool-card:hover` | 标题转 **#5546D8** | 已实现 ✅ |
| `.wb-data-layout` | `minmax(0,2fr) minmax(300px,1fr)` gap16 **margin 16px 0** | 同 ✅ |
| `.wb-panel` / `.wb-recent` | radius**12** / radius**16**，padding 24 | 同 ✅ |
| `.wb-panel-title strong` | 16px/600 **#333** lh22 | 同 ✅ |
| `.wb-panel-title button` | 12px **#667085** inline-flex gap**3** padding0 | 同 ✅ |
| `.wb-account-metrics` | `1fr 1fr 1.35fr` gap16；块 #F2F4F7 radius8 padding **20 24** | 同 ✅ |
| `.wb-account-metrics span` | **13px** lh18 block #667085 | 13px ✅ |
| `.wb-account-metrics b` | **22px/600 #333 lh27 margin 8 0** | 22px #333 ✅ |
| `.wb-flow-head` | margin `24 0 12` / 14px | 同 ✅ |
| `.wb-account th/td` | th **#4E5564** bg #F2F4F7 padding `9 12` 500；td border-bottom **#EFF0F4** | 同 ✅ |
| `.wb-flow-type` | radius4 padding `2 7` 11/15；income **#6254ED on #F0EDFF** | 同 ✅ |
| `.wb-job-thumb` | 80×80 flex `0 0 80px` radius8 **#F2F3F7** / 缺图字 **#AFB5C1** | 80×80 #F2F3F7 ✅ |
| `.wb-job-copy b` | **14px/400** lh16 | 14px/400 ✅ |
| `.wb-job-copy > span` | **#86909C mt8 12px** lh20 | 12px mt8 #86909C ✅ |
| `.wb-job-status` | flex `0 0 80px` width 80 14/16；**completed #24A36D · processing #6254ED · failed #F53F3F** | 三态色命中 ✅ |
| `.wb-jobs-empty` | **#98A0AF** center padding `100px 0` 13px | 同 ✅ |
| `.wb-dashboard-stats` | `repeat(6,minmax(0,1fr))` gap16 mt24；块 padding 24 | 6 格 ✅ |
| `.wb-dashboard-head span` | chip #E5E7EF radius**14** padding `7 12` #667085 | 64×35 radius14 ✅ |
| `.wb-chart-title` / `.wb-trend-chart` | margin `24 0 12` 13px / `100%` × **210** | 1069×210 ✅ |

### 本轮修掉的两个结构级偏差

1. **卡片图标定位基准错**：图标原嵌在 `.wb-card-thumb` 内，`bottom:88px` 以缩略图为基准 → 溢出到卡片上方 42px。
   参考站 `.wb-tool-icon` 是 `.wb-tool-card` 的**直接子节点**。已把图标移出缩略图并给卡片加
   `position:relative; overflow:hidden`，实测 bottom 88 / left 15 精确命中。
2. **`.wb-job-name` 被降级**：覆盖层里 `.wb-job-copy > span`（特异性 0,1,1）压过 `.wb-job-name`（0,1,0），
   标题被压成 12px。已改为 `.wb-job-copy > .wb-job-time`，标题恢复参考站的 14px/400。

### 唯一保留的差异（结构性，非样式）

内容区宽度：本地 1117 vs 参考站 1142（侧栏 99 vs 84 + 滚动条），已登记在案；
由此卡片宽 173 vs 177、缩略图 86 vs 88（`aspect-ratio:2` 仍精确），图标 top 66 vs 69（由 `bottom:88` 自动得出，
卡宽回到 177 时即为 69）。这是布局容器差异，不是规格偏差。

### 闸口

`tsc --noEmit` 通过；`vite build` 通过（10.03s）；10 条路由巡检 0 异常。

## 偏差普查报告（2026-10-17 晚）

以参考站产物 CSS（5123 条规则）全量普查 20 个页面族，量化每页「可对齐证据量」，并逐项核对交互态。

### 参考站规则量 vs 我此前的验证覆盖

| 页面 | 参考站规则数 | 此前验证方式 | 覆盖判断 |
| --- | --- | --- | --- |
| 工作台 /workbench | 125 | 产物 CSS 全量对齐 | **已严格 1:1** |
| 我的作品 /works | 218 | 产物 CSS + 空态实拍 | 默认态对齐，交互态本轮补 |
| 素材库 /library | 231 | 产物 CSS | 默认态对齐，交互态本轮补 |
| 营销首页 / | 290 | live DOM 实拍 7 段 | 默认态对齐，交互态本轮补 |
| 邀请 /invitations | 206 | live DOM 实拍 | **结构性偏差**（见下） |
| 自由创作 /free-creation | 94 | live DOM 实拍 | 默认态对齐 |
| 商品详情 /product-detail | 99 | live DOM 实拍 | 默认态对齐 |
| 一键抠图 /background-remove | 110 | live DOM 实拍 | 默认态对齐 |
| 多图融合 /multi-image-fusion | 130 | live DOM 实拍 | 默认态对齐 |
| 局部重绘 /local-redraw | 166 | live DOM 实拍 | 默认态对齐 |
| 爆款复刻 /viral-clone | 157 | live DOM 实拍 | 默认态对齐 |
| 产品精修 /product-retouch | 206 | live DOM 实拍 | 默认态对齐 |
| 商品SKU图 /product-sku | 205 | live DOM 实拍 | 默认态对齐 |
| 商品主图 /product-kit | 60 | live DOM 实拍 | 默认态对齐 |
| 旋转角度 /rotate-angle | 70 | live DOM 实拍 | 默认态对齐 |
| 图片翻译 /image-translate | 35 | live DOM 实拍 | 默认态对齐 |
| 智能扩图 /image-expand | 20 | live DOM 实拍 | 默认态对齐 |
| 商品换色 /product-recolor | 11 | live DOM 实拍 | 默认态对齐 |
| 去水印 /watermark-remove | 1（复用共享外壳） | live DOM 实拍 | 对齐 |
| 工具页共享外壳（12 页共用） | 663 | live DOM 实拍默认态 | **交互态未验** |

### 本轮普查发现并已修的偏差（4 项交互态 + 1 项结构 bug）

| # | 偏差 | 参考站 | 修复 |
| --- | --- | --- | --- |
| 1 | 我的作品筛选器**展开态**配色 | `#24211E` / `#F7FCFF` / `#399DE8`（蓝系；hover 才是紫） | 已修（并给 4 个按钮补 `is-open` class，此前根本没这个状态类） |
| 2 | 素材库卡片 hover / 选中 | `#8275EF` + `translateY(-2px)` + `0 10 25 rgba(77,64,183,.11)`；封面 `scale(1.035)` | 已修（实测 hover 命中） |
| 3 | landing 业务卡 CTA hover | `#5546D8` + `translateY(-1px)` | 已修 |
| 4 | landing 案例 tab 形态 | `padding 8 / radius 8 / 14px`；active = `#5546D8` on `#F1EFFF`（非紫底白字胶囊） | 已修（实测 86×29、选中色命中） |
| 5 | landing 特性区网格第 3 行空占位 | —（我方 bug：4×2 网格塞了 8 张图，主图占 2×2 后溢出到第 3 行） | 改为 5 张图填满 4×2，rows 现为 `167.5px 167.5px` |

### 仍存在的偏差（需你决策，本轮未擅自改）

**A. 结构性：邀请页形态**
参考站 `/invitations` 是**弹窗**（`invitation-dialog-*`：stats-card / records-card / `h3 14px/700` /
白卡 radius16 等 40+ 条 dialog 规则），本项目做成了**独立页面**的 hero + 步骤 + 规则 + 数据格。
是否改为「工作台内弹窗」形态？

**B. 「设计收拢」带来的实拍值偏移**（收拢是你上一轮批准的，但与「严格 1:1」冲突，实测差值如下）：

| 页面 | 项 | 参考站实拍 | 收拢后现值 | 差 |
| --- | --- | --- | --- | --- |
| landing | hero 副标题 | 17px | 16px | 1px |
| landing | 业务卡 CTA 底 | `#6C5CE7` | `#5546D8` | 观感接近 |
| landing | 业务卡尺寸 | 389×323 | 382×305 | 容器宽度所致 |
| landing | 套餐 tabs 宽 | 328 | 305 | 23px |
| library | 卡片标题色 | `#30364A` | `#171A2B` | 观感接近 |
| library | 封面底色 | `#F1F3F8` | `#F2F4F7` | 极微 |
| works | 筛选器高 | 37 | 39 | 2px |

**处置选项**：① 保持现状（全站统一优先）；② 给这几页也建专属 token 组（像 `--wb-*` 那样）
把实拍值锁回去，代价是全站统一性回退；③ 只锁差异明显的（landing CTA/hero 字号），其余不动。

**C. 覆盖缺口（非已知偏差，是未验证）**
工具页共享外壳 663 条规则 + 全站约 180 条 hover/focus/disabled 交互态规则，
我逐页只验过默认态。本轮补了 4 条交互态，其余仍属「未验」而非「已知有偏差」。

## 页面清单 diff 与补齐（2026-10-17 晚）

以参考站 `https://ijihua.cn/sitemap.html`（22 个页面）为基准，与本地路由全量 diff。

### 补齐项

| 参考站路径 | 本地状态 | 处理 |
| --- | --- | --- |
| `/packages` | **完全缺失**（积分商城） | 已新建 `PackagesPage.tsx` + `/packages` 路由 + landing 套餐区入口 |
| `/my-works` | 本地为 `/works`（功能等价、路径不同） | 已加 `/my-works` 路由别名，两个路径都可直达 |

### 已核对为「不缺失」

`/` `/workbench` `/product-kit` `/product-detail` `/viral-clone` `/free-creation`
`/multi-image-fusion` `/product-sku` `/local-redraw` `/background-remove` `/watermark-remove`
`/product-retouch` `/image-translate` `/image-expand` `/product-recolor` `/rotate-angle`
`/works` `/invitations` `/sitemap.html` `/legal/{privacy-policy,user-agreement,account-rules}`

### `/packages` 复刻说明

- **证据**：参考站产物 CSS 的 `pkg-*` 族 **91 条规则**；该页变量真值取自参考站 `:root`
  （`--primary #625DF5` `--line #E6E8EF` `--muted #7D8596` `--text #182033` `--success #18A875`）
- **实测对齐**：container `max-width 1200` / hero h1 `28px` `letter-spacing -0.5` / p `14px #7D8596` /
  grid `repeat(4,1fr)` gap16 / card `radius 18` `padding 24 20` / name `15px/700` /
  points `28px` `#625DF5` / back-btn `13px/600`
- **命名隔离**：`pkg-*` 独立命名空间 + `--pkg-*` token，不复用 `.pk-*`（ProductKit 在用），不受全局收拢影响
- **未复刻（诚实标注）**：`.pkg-confirm-*` / `.pkg-payment-option*`（支付宝 `#009FE8` · 微信 `#24B340`）/
  `.pkg-pay-btn` / `.pkg-result-card` / `.pkg-wechat-qr` —— 下单确认与支付结果态需真实订单与支付回调，
  本地无积分账户与计费系统，**不做假支付**
- **诚实披露**：套餐名称 / 积分数 / 价格在参考站登录墙之后无证据，页面用**版式示例数据**
  （代码注释已标注），购买按钮 `disabled` 并在页面底部明示原因

## 交互态对拍与缺口登记（2026-10-18）

**方法**：参考站产物 CSS 全量对拍（本轮重新拉取，站点已重新部署，新产物 `index-glaqVozH.css` **6389 条规则**，10-17 时为 5123 条）。
用脚本解析双侧规则集，按「类名 + 伪类」匹配参考站全部交互态规则（hover 277 / focus 系 226 / disabled 104 / 状态类 113，去重后 458 条交互规则 + 113 条状态类），分三桶归类。

**对拍结果（参考站 571 条交互态规则 vs 本地 123 条）**：

| 桶 | 条数 | 含义 |
| --- | --- | --- |
| matched | 64 | 本地已有对应交互规则 |
| gap_class_exists | 17 | 本地有该类名但缺交互规则（复核后其中 ~6 条为本地无此类的假阳性，实际 ~11 条真缺口） |
| gap_no_class | 332 | 本地无对应类（命名替代 / 功能未实现 / 外壳未复刻，见下） |
| （其余为默认态差异，不在本轮范围） | 158 | — |

**本轮修复（5 组，全部浏览器实测通过）**：

| # | 修复项 | 参考站规则（字面值） | 验证 |
| --- | --- | --- | --- |
| 1 | 工作台工具卡 hover 严格 1:1 化：去掉本地自建的上浮 `translateY(-2px)` 与过重阴影，对齐参考站 `0 7px 20px #21234114`；补缩略图 `scale(1.06)` | `.wb-tool-card:hover` 及后代 5 条 | ✅ computed 实测 |
| 2 | 素材库筛选按钮 hover 补底色 | `.asset-library-button:hover` → `#5848da` on `#f4f2ff` border `#7668ef` | ✅ |
| 3 | 素材库批量条按钮默认态 + hover 对齐（原为本地自建实底紫白字，参考站为透明底灰字 hover 浅紫） | `.asset-library-batch-bar button` 默认 `#5f687d`/透明，hover `#5545d7` on `#6f61e91a` | ✅ |
| 4 | 多图融合设置摘要 disabled 态 | `.image-output-settings-summary:disabled` → `cursor:not-allowed` | ✅ |
| 5 | landing 套餐卡 / 加油包卡 hover 组（订阅 tab 边框转紫、加油包 tab 转橙、价格随动） | `.home-v2-package-card:hover` 系 6 条 + `--top_up` 系 2 条 | ✅ |

浏览器实测：构建产物 CSS + 复刻 DOM，playwright hover 后读 computed style，**12/12 通过**
（wb 卡 shadow/scale/标题色、套餐卡 shadow/价格色/订阅边框紫、加油包边框橙/价格橙、素材库 button 底色、批量条 color/bg、摘要 disabled cursor）。
闸口：CSS 括号平衡 0；`tsc --noEmit` exit 0；`vite build` 4.35s。

### 追加轮（用户指令「全改」：缺口清单全部执行，3 批次 40 项实测全过）

**批次 1 — 剩余 P1 缺口 + B 类新发现（11/11 实测）**：

| 修复 | 参考站依据 | 备注 |
| --- | --- | --- |
| 工作台图标 hover 简化替代：单层 lucide SVG hover 变品牌紫 | `.wb-tool-icon:before` 双层 mask 切换（紫 mask 显/灰 img 隐） | 本地单层 SVG 无法 1:1 复刻双层，README 登记为简化替代 |
| 素材库卡圆角 16→**14**；hover 边框 `var(--border)` 灰→**#8275ef** + 阴影 `#4d40b71c` | `.asset-library-card` + `:hover,.is-selected` | 10-17 修过的值被设计收拢覆盖，本轮恢复 |
| 封面 hover `scale(1.035)`（10-17 修过又丢失，本轮补回） | `.asset-library-card:hover .asset-library-cover>img` | — |
| 多选模式三规则（hover 不高亮/不放大/边框回归） | `.asset-library-card.is-selection-mode*` | JSX 挂载：本地以「已有选中项」为等价态 |
| 勾选框 radius 8→7；on 态 `#6353eb`；去本地 hover 加深 | `.asset-library-check(.is-checked)` | 本地类名 `on` ↔ 参考 `is-checked` |
| hover 操作按钮：白底灰字胶囊→**深色玻璃底白字**（31px / `#181d34c4` / blur(4px) / radius8 / flex1）；hover `#4e40cfe6`；去删除按钮红色专属 hover | `.asset-library-hover-actions button` | 默认态对齐 |
| landing 套餐卡/加油包卡边框 1px→**2px solid #e5e7ef` | `.home-v2-package-card` | 本地 `--border-soft` 恰好 `#e4e7ef`，仅宽度差 |

**批次 2 — workspace 外壳对拍 + 清除 10-17 遗留「蓝紫混用」bug（13/13 实测）**：

- **修复真 bug**：`--color-primary: #2563eb`（蓝）残留 9 处引用（顶栏/侧栏/登录页/工具页图标/stats 图条），全部改品牌紫 `#5546d8` 系；`:root` 定义同步归位（死变量防复发）。10-17 审计标记过此 bug 但只修了 wb 内部 2 处，外壳一直漏修。
- 顶栏对拍（参考站 `workspace-app-header`）：height 64 显式化；brand mark 28→**36×36**；brand 文字 14/600→**16/700 #171a2b**、gap 8→10；导航 14px→**13px/700 #667085**、padding 0 10→**0 14**、gap 4→10；hover 蓝→**#5546d8 on #f1efff**；用户区 hover slate→**#f1efff**；头像底→**#5546d8**。
- 侧栏色值对拍（参考站 `workspace-side-menu-list`）：item hover **#5546d8 on #f7f6ff**、active **#5546d8 on #f1efff**。
- **结构差异登记（未改骨架）**：参考站新版侧栏已是 48px 横排菜单列表（`side-menu-list`，含 collapse 按钮），本地仍是 10-14 实拍的 100px 垂直能力轨（66×60 + hover 预览卡，预览卡为本地自有功能）——**范式级漂移，需用户裁定是否重构**。

**批次 3 — 工具页共享组件交互态映射对拍（16/16 实测）**：

| 本地类（共享组件） | 参考站对应 | 修复 |
| --- | --- | --- |
| `pk-dropzone` | `.free-upload-zone...:not(.ready):hover` | hover 补 `#f7f6ff` 底 + `#a89bff` 边 + `#5546d814` ring |
| `pk-ai-btn` | `input-pane .ai-analyze-btn` | **默认态形态对齐**：无边框文字链→白底 `#8b73ff` 边 `#6b4eff` 字 radius8；hover `#5b3ff2 on #f7f5ff`；补 `:disabled`（opacity 1 不淡出） |
| `pk-primary-btn` | `.free-actions .primary-btn.ready:hover` | hover `filter brightness`→`translateY(-1px)` + `0 14px 30px #5546d84d`；disabled 维持本地 .55（参考站 free 页为 opacity 1、redraw 页为 .5，本地一类服务多页，取折中已登记） |
| `pk-ratio-option` / `pk-resolution-option` | `.image-output-{ratio,resolution}-option` | 补 `:disabled`（cursor not-allowed / opacity .56）+ `.pk-option-active:disabled`（opacity 1）；画质 .5→.56 |
| `fc-prompt-tool-btn` | 文字链版 `.free-prompt-tool-btn:hover` | hover 字 `#6C5CE7`→**#5546d8** + outline none（本地复刻的是无边框文字版，非胶囊版） |

**同名族零缺口**：`rotate-*` / `multi-image-fusion-*` / `background-*` / `orbit-*` 的交互态本地已全覆盖（脚本对拍 0 gap）。
**仍未修（诚实差异/范围外）**：vv 视频页族、`package-purchase-*` 购买流、`continuous-checkin`、`product-suggestion`、`lightbox`、`auth/oauth` 弹窗、`record/batch/campaign` 族（本地无对应功能）；参考站 viral 族仅 1 条交互态（`.viral-analysis-head button:hover`）且本地无「爆款分析头部」结构，语义不对应未映射。

闸口（每批次）：CSS 括号平衡 0；`tsc --noEmit` exit 0；`vite build` 通过；浏览器 computed-style 实测 40/40。

### 追加轮 2（用户指令「一步到位，全改」：侧栏范式重构 + disabled 分化 + 全站回归）

**侧栏范式重构（最大结构项，25/25 实测 + 全站回归 27/27 路由）**：

- 参考站已从 10-14 旧版「100px 垂直能力轨」换为 **v2 横排菜单**（`workspace-side-menu-v2`）。本轮按 v2 重构：
  容器 176px / padding 16 12 24 24 / border-right `#f2f3f5`；head 32px（仅右侧 collapse 按钮）；
  list grid gap4 / 按钮 **45px 高、padding 8 4、gap 12、13px、radius 8、#333**；
  hover `#5546d8 on #f7f6ff` / active（`.active` + `[aria-current=page]`）`#5546d8 on #f1efff`；
  **折叠态**（`side-menu-collapsed`）：list 3 列、按钮居中、文字 10px lh14、徽标/圆点隐藏。
- `SideRail.tsx` 重写（SIDEBAR_WIDTH 100→176），旧 `side-rail-*`/`rail-item-*` 体系全部替换为
  `workspace-side-menu-*` 体系；`app-sider-wrap` 双线去除（边框由 v2 容器自带）。
- **本地自有功能保留**（参考站无对应，已登记）：hover 产出预览卡、作品数徽标、mock/免费圆点。
  组标题移除（参考站 v1/v2 侧栏均为平铺菜单，无分组标题证据），分组以 16px 间距体现。
- 全站回归：登录 → 21 条登录后路由 + 5 条免鉴权 + 404 兜底 **27/27 正常**；工作台 6 列网格 12 卡、
  free 页提交 disabled opacity 1、kit 页 .55 均在真实 DOM 验证通过。

**pk-primary-btn disabled 分化**：`.fc-actions .pk-primary-btn:disabled → opacity 1`（对齐参考站
`.free-actions .primary-btn:disabled`，自由创作页提交禁用不淡出）；其他工具页维持 .55
（对齐参考站 `redraw-submit:disabled`）——同一本地类服务两页不同参考值，按上下文分化。

**仍未修的判定说明（非遗漏，是无样式载体或不改）**：

| 项 | 处置 | 理由 |
| --- | --- | --- |
| vv 视频页 / `package-purchase-*` 购买流 / `continuous-checkin` 签到 / `product-suggestion` / `record`·`batch`·`campaign` 族 | 不改 | 本地无对应功能（无视频能力/无计费系统/无后端契约），CSS 无 DOM 可挂载；补等于造假功能，违背「不放假效果、不做假支付」铁律 |
| 登录弹窗化（参考站 `auth-*` 60 类为站内弹窗） | 不改 | 本地 `LoginPage` 功能完整且回归验证通过；改弹窗 = AuthContext + 路由守卫 + 全部跳转的流程重构，非样式层作业，且登录态/边界行为已与参考站语义对齐（未登录跳登录、营销页免鉴权） |
| `lightbox` 灯箱 | 不改 | 本地图片预览走 antd `Image.Preview`（AGENTS.md 组件优先约定），参考站为自建灯箱；技术选型差异，已登记 |

至此本轮「全改」清单中**所有有样式载体的项已全部完成**：累计 5 组（10-18 早轮）+ 3 批次（16 组）+
侧栏重构 + disabled 分化，浏览器实测 **75/75 通过**（40 + 25 + 10 回归项），全站 27/27 路由零回归。

**已登记未修（需用户裁定）**：

- **A 邀请页形态**：参考站为 `invitation-dialog-*` 弹窗（76 类），本地为独立页段落（`invite-*` 17 类）
- **B 设计收拢实拍值偏移**：landing hero 副标 17→16、CTA `#6C5CE7`→`#5546D8`、套餐 tabs 328→305、library 标题 `#30364A`→`#171A2B`、封面 `#F1F3F8`→`#F2F4F7`、works 筛选器 37→39；**本轮新发现**：素材库卡片圆角 14→16、landing 套餐卡边框 1px vs 参考站 2px
- **C 覆盖缺口（本次量化后的精确版）**：
  - **应用外壳 `workspace-*`（127 类 / 54 交互态）本地仅 4 类**：本地外壳为早期自建（`app-*`/`rail-*`/`tool-*`），从未按参考站外壳复刻——最大单块缺口，重构属范围决策
  - **工具页命名映射**：参考站 `product-kit-*`/`free-*`/`redraw-*`/`vv-*` 等每页专属类，本地用 `pk-*`/`fc-*`/共享 `tool-*` 等替代（默认态已实拍对齐，交互态未做逐类映射对拍）
  - **本地无对应功能（诚实差异，不造假）**：`vv-*` 视频创作页（65 类）、`package-purchase-*` 购买流程（93 类）、`continuous-checkin` 签到、`product-suggestion` 产品建议、`lightbox` 灯箱、`auth/oauth` 登录弹窗、`record/batch/campaign` 任务记录/批量克隆/活动
  - **工作台图标 hover 双层切换**：参考站 `.wb-tool-icon` 为双层 img（hover 时 `:before` 显 / img 隐），本地为单层 SVG 图标，结构不同无法 1:1，未实现图标 hover 切换
  - **我的作品日期筛选器**：参考站为日历浮层（`my-works-calendar-*`），本地为 pills + 自定义 input，已按 10-17 登记结构实现

## 环境约定（踩坑记录，重要）

**本机 3001 端口被 aigc 网关占用**（另一个项目 `/Users/bright/github/aigc`，同样用 `3001` + `/api/v1` 前缀）。
若直接 `node dist/main.js`，会 `EADDRINUSE` 失败；若 3001 上跑的是网关，前端登录会静默 404
（`Cannot POST /api/v1/auth/login`，网关返回的是自己的响应格式）。正确启动方式：

```bash
# 后端（项目自带 PORT 开关，main.ts:67）
cd backend && PORT=3002 node dist/main.js        # 不要用 nest start：会触发安全守卫拒绝清空 dist
# 前端（vite.config.ts + constants.ts 均支持环境变量）
cd frontend && VITE_API_PROXY=http://localhost:3002 VITE_API_BASE=http://localhost:3002 \
  npx vite --port 5173 --strictPort
```

后端 CORS 只放行 `5173` / `4173`，**前端必须用 5173**（用 5174 会被 CORS 拦）。

补充实测细节（2026-10-19）：

- 用 5174 时 `VITE_API_BASE` 是**直连绝对地址**，不是走 vite 代理，preflight 直接被后端 CORS 拒 —— 换端口无效。
- vite v8 绑 **IPv6 `::1`**，`127.0.0.1:5174` 不通；curl / playwright 必须用 `localhost`。
- 本机 `HTTP_PROXY=127.0.0.1:49705`，curl 必须加 `--noproxy '*'`。
- token 的 localStorage key 是 **`ecom_vision_token`**（`frontend/src/lib/auth.ts:1`）。
- playwright 巡检必须**同一 context 内顺序 `goto`**：`browser.newPage()` 每次新建 context，
  localStorage 不共享（第一版回归 23 条假 FAIL 全是这个原因）。

## 设计系统升级（2026-10-19）

本轮不是继续逐页 1:1 复刻，而是**审计全站设计一致性 + 修真实缺陷**。方法：静态审计（token 覆盖率 /
页面结构）＋ 浏览器实测（24 页元素级 computed style + 截图），**子代理报告的 P0 项逐条复核后才采信**。

### 审计口径修正（前几轮记录有偏差）

| 项 | 旧记录 | 实测 |
| --- | --- | --- |
| `:root` token 数 | 77 | **284**（大量单行多声明，朴素正则会漏采） |
| 硬编码 hex 残留 | 20（"均为一次性值"） | **105 个取值 / 299 次**，其中 12 个取值 182 次是"与 token 同值却写死"的纯遗漏 |
| 圆角阶梯 token 引用 | 未记录 | 6 档 `var()` 引用**全为 0**（定义了但全站绕过） |

### P0：antd 运行时主题色泄漏（本轮新发现类型）

10-18 那轮「清除蓝紫混用」只扫了 `global.css` 里的 hex **字面值**，因此漏掉了**所有"未设 color 的
`<Link>`"** —— 它们继承 antd 6 默认主题链接色 `#1677ff`（CSS 全文 grep 该值**零命中**，是运行时注入），
在紫系全站里是刺眼的蓝。

| 位置 | 症状 | 修法 |
| --- | --- | --- |
| `global.css` `.sitemap-item` | `/sitemap.html` **46 个链接**全蓝 | 补 `color: var(--text-strong)` |
| `LoginPage.tsx:109` | 「填充演示账号」`ant-btn-link` 3 元素蓝 | 加 `.login-demo-fill` class 覆盖 hover/active/focus |
| `global.css` `.landing-brand` | 落地页品牌链接蓝 | 补 `color: inherit` |

浏览器实测：修复前 `/sitemap.html` 46 元素、`/login` 3 元素、`/` 1 元素共 50 处 `rgb(22,119,255)`；
修复后 7 个路由全量扫描 **0 残留**。

> **教训（方法论）**：清蓝必须**渲染层 computed-style 扫描**，静态 grep CSS 永远查不到运行时注入的主题色。

### 复核推翻的两处「P0」（避免误改）

- **`#399de8`（`.my-works-filter-trigger.is-open`）不是 bug** —— 参考站「我的作品筛选器展开态」本就是
  蓝系 `#399DE8`（hover 才是紫），是本项目**主动对齐的 1:1 复刻值**，README「本轮普查发现并已修的偏差」
  第 1 条有记载。**保持不动**。
- **`--fusion-ratio-width/height` 无定义** —— 误报。`MultiFusionPage.tsx:245-246` 用内联 style 注入，
  CSS 注释 L4885 也写明了设计意图。

### 本轮改动（4 项）

| # | 改动 | 位置 | 验证 |
| --- | --- | --- | --- |
| 1 | 3 处 antd 蓝泄漏修复 | `global.css` / `LoginPage.tsx` | 7 路由 0 残留 |
| 2 | `groupOf` 改读后端下发的 `CapabilityGroup.name` | `WorkbenchPage.tsx` + `App.tsx` 传 `groups` | 分组名正确，0 空白单元 |
| 3 | 圆角裸字面 → token | `global.css` **165 条** | 结构零变化，10/10 页圆角集合无新增 |
| 4 | 清理死 token | `global.css` **30 个** | token 定义 284→252，未定义引用项全部有 fallback 或 JS 注入 |

「新增能力零改前端」的残留硬编码经核实**是有意裁剪**，非缺陷，已加注释说明意图，勿误改：

- `AppLayout.tsx:37` `groups.slice(0, 2)` —— 参考站顶导就是「电商生图▾ / AI修图▾」两项
- `LandingPage.tsx:200` / `WorksPage.tsx:181` 过滤前两组 —— 与顶导口径一致（`ai_video` 是倒序第三组，
  用 `slice` 会随 registry 调序而误纳，故写死 id）

**刻意未做**：`--mif-radius-*` 私有圆角阶梯（18/15/14/13/11/9/7/6px，共 28 条裸字面）是多图融合页
按参考站实拍值建立的**专属规格**，归位到全局 6 档会破坏该页 1:1 复刻 —— 与 10-17「统一优先于逐页 1:1」
是相反方向的取舍，需单独裁定。

### 闸口

`tsc --noEmit` exit 0；CSS 花括号平衡 0；结构 diff 证明仅 `border-radius` 值变化；
浏览器 10/10 页圆角回归通过、7 路由蓝残留 0、零 JS 错误。

### 第二批：重复代码抽取（用户指令「改」）

前一批的 4 项里，「ToolShell 收拢」与「重复代码抽取」改动量大，单独一批做。**先做零风险的抽取，
ToolShell 收拢（涉及 5 页外壳重构）留到下一批。**

| 抽取项 | 原状 | 归并到 | 消除 |
| --- | --- | --- | --- |
| 空态插画 SVG | **5 份逐字节相同**（ToolShell + 4 页各一份 `PkEmptyIllustration`） | `ToolShell.ToolEmptyIllustration`（本来就已导出） | 4 份 × 15 行 |
| 流程步骤图标 | `CircleCheckIcon` / `ActivityIcon` / `ImagePlusIcon` **各 3 份手写 SVG** | lucide-react 的 `CircleCheck` / `Activity` / `ImagePlus`（`size={14}`） | **9 个手写组件** |
| 粘贴上传监听 | 同一段 `useEffect + addEventListener('paste')` **5 份** | 新 hook `hooks/usePasteUpload.ts` | 4 份 × 8 行 |
| 参数选项集 | `PLATFORMS`×4 / `LANGUAGES`×2 / `RATIOS`×5 / `RESOLUTION`×6 | 新模块 `lib/optionSets.ts`（从后端下发的 `params` 读回） | **17 张重复表** |

**为什么图标改用 lucide 而不是抽公共组件**：那 9 个手写 SVG 的 path 与 lucide 1.57.0 的
`circle-check` / `activity` / `image-plus` **完全相同**（lucide 就是这套 path），属于重复造轮子，
按项目「优先成熟开源库」纪律直接换库组件。

**为什么选项集要从后端读回**：后端 `capability.registry.ts` 早已是唯一事实源，且这些表已通过
`GET /api/v1/capabilities` 的 `params` 下发（实测 `main_image` 的 `platform` 9 项 / `language` 10 项 /
`ratio` 8 项 / `size` 2 项）。前端重复定义 17 张表本身就是漂移源 —— 例如 `size` 后端只声明
可用的 1K/2K，而前端多写了 4K。**4K 的禁用态保留在 `optionSets.resolutionOptions()` 里作为本地诚实差异**
（本地 Jimp 上限 2048px，界面如实禁用而非隐藏）。

**`usePasteUpload` 顺带修了一个隐性缺陷**：原 5 处监听直接把剪贴板文件透传给上传接口，剪贴板里混入
文本/文件路径时会把非图片 MIME 送上去。新 hook 过滤 `type.startsWith('image/')` 并 `preventDefault()`。

**`usePasteUpload` 的依赖稳定性**：`onFiles` 传的是各页的 `uploadFiles`（`useCallback` 包裹），
引用稳定，不会每次渲染重挂监听。

### 第二批闸口

`tsc --noEmit` exit 0（中途因 `ParamOption` 与 `string[]` 类型不匹配出过 38 个错，逐类修正后清零）；
`vite build` 通过（2.62s）；浏览器实测：比例 8 项 / 画质 3 项含 4K `disabled` / 平台 9 项 / 语言 10 项
**与重构前完全一致**，12 个工具页零溢出、零 JS 错误，10/10 页圆角回归通过。

5 个大页行数：`ProductKit` 780→696、`ProductDetail` 739→660、`ViralClone` 823→740、
`FreeCreation` 671→641、`MultiFusion` 651→647（合计 3642→3384，**-258 行**）。

### 第三批：素材库弹窗 + 高级设置浮层抽取（用户指令「继续」）

剩下两项里，浮层/弹窗抽取风险低于外壳重构，先做；ToolShell 收拢单独一批。

| 抽取项 | 原状 | 归并到 |
| --- | --- | --- |
| 素材库弹窗 | 5 份（ToolShell + 4 页），连 loading / 空态 / 网格的 CSS 类名都相同 | 新组件 `components/AssetLibraryModal.tsx`（含 `useAssetLibrary` hook） |
| 高级设置浮层 | 5 份（ToolShell + 4 页），比例网格 + 画质网格 | 新组件 `components/ToolSettingsPopover.tsx` |

**差异如何表达**（而不是各写一份 JSX）：

- 素材库：各页只提供 `onPick` 回填逻辑。**`onPick` 返回 `false` 表示拒绝**（如超出张数上限），
  弹窗**保持打开**让用户改选 —— 这是从 ViralClone 原逻辑提炼的：它点参考图时直接
  `setLibraryOpen(false)`，而商品图超限时只 `return` 不关闭。原先 5 份行为不一致，
  统一为「拒绝则不关闭」。ToolShell 因参考站该入口是禁用态，用 `readOnly` prop 走只读展示。
- 浮层：`showRatio` / `showResolution`（product-detail 参考站无比例档，故只传画质）、
  `resolutionTitle`（ToolShell 系是「分辨率（积分/权益消耗）」，其余是「分辨率」）、
  `popoverClassName` + `header` + `popoverRole`（free-creation 的 `fc-settings-popover` 带
  专属头部与 `role="dialog"`，是 1:1 实拍值，**不并入通用头部**而是作为 header prop 传入）。

**类名沿用既有约定**：容器是 `pk-settings-shell`、触发按钮是 `pk-settings-summary` +
`.pk-settings-summary-open`，不是直觉上的 `pk-settings` / `pk-settings-trigger` ——
组件必须用 CSS 里已定义的那套，否则样式全丢。

**顺带清掉 4 个未使用 import**：`ChevronDown`（5 处，已收进浮层组件内部）、
`ratioOptions`/`resolutionOptions`（5 处，已收进浮层组件）、`useMemo`/`Minus`（ProductDetail）。
注意 `tsc` 不报未使用（前端 `noUnusedLocals: false`），需自行按「正文引用计数」核查。

### 第三批闸口

`tsc --noEmit` exit 0；`vite build` 通过（3.52s）；浏览器实测 7/7：
6 个工具页浮层可开且项数正确（product-kit / viral-clone / free-creation / rotate / recolor = 比例 8 + 画质 3 含 4K 禁用；
product-detail = 仅画质 3）、free-creation 的 `fc-settings-popover-head` 与 `role="dialog"` 保留、
素材库弹窗真实拉到 7 项网格；10/10 页圆角回归通过、零 JS 错误。

行数：`ProductKit` 696→604、`ProductDetail` 660→584、`ViralClone` 740→664、
`FreeCreation` 641→553、`ToolShell` 576→516（5 页+组件合计 3313→2921，**再减 392 行**；
新增两个组件共 243 行，净减约 149 行）。

### 第四批：ToolShell 收拢（用户指令「全部一批改完」）

**先说结论：没有把 5 个自建页硬塞进 `ToolShell`，而是把「外壳里可复用的三块」抽成组件。**

原因是逐页对比后发现硬套会破坏 1:1 复刻：

| 差异点 | 事实 | 硬套 ToolShell 的后果 |
| --- | --- | --- |
| 上传卡与业务卡 | ProductKit 的「生成设置 / 商品描述」与上传区在**同一张** `pk-config-card` 内；ToolShell 是「上传卡 + children 各占一张」 | DOM 结构变化 → 视觉偏移 |
| 结果网格 class | ProductKit 是 `pk-result-grid`，其余四页各有自己的类（`pk-result-detail-scroll` 等） | 1:1 实拍值被统一 → 破版 |
| 布局体系 | MultiFusion 是 `multi-image-fusion-*` **独立两步流**（场景网关 → 工作区），连骨架都不是 `pk-*` | 完全无法套用 |

所以本批做的是**按可复用边界切**，而不是按「页面」切：

| 抽出 | 原状 | 落点 |
| --- | --- | --- |
| 历史记录区 | **只长在 ToolShell 里**，5 个自建页**全都没有**（功能缺失） | `ToolHistoryPanel`（ToolShell 自己也改用它） |
| 提交区 | ToolShell + 4 页各一份（`pk-submit-actions` / `pk-primary-btn` / 提示行 / 描述） | `ToolSubmitBar` |
| 结果栏空态 | ToolShell + 4 页各一份（插画 + 标题 + 描述 [+ 流程步骤 / mock 披露]） | `ToolEmptyState` + `ToolWorkflowSteps` |

**真正的收益是功能补齐**：5 个自建页此前**完全没有历史记录区**（ToolShell 有，真实拉
`GET /tasks` 按能力过滤）。现全部接入，实测各页拉到真实项数（product-kit 4 / product-detail 2 /
viral-clone 1 / free-creation 2），MultiFusion 在工作区阶段也接上了（0 项 + 空态文案，该能力确无历史产出）。

**MultiFusion 只接历史记录、不套外壳**：它是参考站的两步流，骨架类名体系都不同，
套 `pk-*` 外壳等于放弃该页的 1:1 复刻。

**回退记录**：曾写过一版 `ToolResultPane`（连结果网格一起抽），发现各页网格 class 是逐页 1:1 实拍值，
统一即破版，**已删除该文件**，只保留空态抽取。

### 第四批闸口

`tsc --noEmit` exit 0；`vite build` 通过（2.22s）；浏览器实测 5/5 页：历史区存在且标题正确、
展开后拉到真实项数、提交区与主按钮正常、空态与流程步骤正常、零溢出；MultiFusion 两阶段
（场景网关无历史区 / 工作区有历史区）符合预期；前 3 批功能复验通过（浮层 6 页 + 素材库弹窗）；
10/10 页圆角回归通过、零 JS 错误。

**重复归零**：`pk-submit-actions` / `pk-primary-btn` / `tool-history-card` /
`pk-preview-placeholder` / `pk-workflow-steps` 五个 class 现在**各自只在组件定义处出现 1 次**。

行数：`ToolShell` 516→464、`ProductKit` 604→584、`ProductDetail` 584→564、`ViralClone` 664→644、
`FreeCreation` 553→542；新增 `ToolHistoryPanel`(61) + `ToolSubmitBar`(65) + `ToolEmptyState`(49) = 175 行。

### 四批累计（2026-10-19）

| 批次 | 内容 | 行数变化 |
| --- | --- | --- |
| 第一批 | 3 处 antd 蓝泄漏 + 分组名去硬编码 + 165 条圆角 token + 30 个死 token | token 284→252 |
| 第二批 | 空态 SVG ×5 / 手写图标 ×9 / 粘贴监听 ×5 / 参数选项集 ×17 张表 | 5 页 -258 行 |
| 第三批 | 素材库弹窗 ×5 + 高级设置浮层 ×5 | 再减 392 行（净 -149） |
| 第四批 | 历史记录 ×5（**补功能**）+ 提交区 ×5 + 空态 ×5 | 再减 100 行（新增 175 行组件） |

5 个大页从最初的 3642 行降到 3015 行（**-627 行 / -17%**），且**首次具备历史记录功能**。

---

## 配置层与日志落盘（2026-10-20）

用户指令「完善架构：添加 @nestjs/config，添加日志落盘」。本节记录**为什么这么选**与**实测证据**。

### 依赖选型

| 决策 | 选择 | 否决项与理由 |
| --- | --- | --- |
| 版本 | `@nestjs/config@12.0.1` | `4.x` 是 CJS 且 peer 只声明支持 NestJS ≤ 11，与本项目 12.1.3 冲突；12.x 的 peer 明确写了 `^11 \|\| ^12` |
| 校验方案 | 零依赖手写 `validateEnv` | `validationSchema` 需引 joi，多一棵依赖树 |
| 日志库 | 自研 `AppFileLogger` | `nestjs-pino` 会拖入 sonic-boom / thread-stream / on-exit-leak-free 等一整条链，与「手工直装 + 嵌套副本无法重现」的现实冲突最严重 |

新增传递依赖：`dotenv-expand@13.0.0`、`es-toolkit@1.52.0`（全新）、`dotenv@18.0.3`（**嵌套**在 `@nestjs/config/` 下；顶层 `17.4.2` 属 prisma 链，两者不可共用）。

### 配置层

```
src/config/env.validation.ts   ENV_SPECS —— 环境变量唯一事实源（类型/默认值/白名单/上下界）
src/config/config.module.ts    isGlobal + cache + expandVariables + envFilePath: ['.env.local', '.env']
```

三条硬约束（写在文件头，改动前必读）：

1. **不改写 `process.env`** —— 现有 5 处 `process.env.X` 直读（`jwt.service` / `gateway.config` / `storage.service` / `model-config.service` / `main.ts`）行为 1:1 未变。引入配置层不等于把散落的读取一次性重写，那是独立的重构批次。
2. **类型错误即启动失败**。旧代码 `Number(process.env.PORT)` 遇到 `PORT=abc` 会得到 `NaN` 传给 `app.listen()`，静默绑到随机端口且极难排查；现在抛 `EnvValidationError`，`main.ts` 捕获后按变量逐条打印并 `exit 1`。
3. **默认值逐项抄自现有硬编码兜底值**，不改默认行为。

`AppModule.imports` 里 `ConfigModule` 必须排第一（`isGlobal` 的注册时机），`LoggerModule` 紧随其后——顺序错了不报错，只会运行期注入 `undefined`。

### 日志落盘

原排错路径只有 `start.sh` 的 stdout 重定向到 `.run/backend.log`，三个硬伤：每次启动被 `: >` 清空、直接 `node dist/main.js` 完全不落盘、没有级别与轮转。应用层接管后：

| 能力 | 实现 | 配置项 |
| --- | --- | --- |
| 产物 | `backend/logs/app-<日期>.log` + `app-<日期>.error.log` | `LOG_DIR` |
| 级别 | `error/warn/log/debug/verbose` | `LOG_LEVEL`（默认 `log`） |
| 轮转 | 跨日换文件；超体积切 `.1/.2`，分片用尽后复用最后一片 | `LOG_MAX_FILE_MB` / `LOG_MAX_FILES_PER_DAY` |
| 保留 | 启动时 + 每日首次写入时清理 | `LOG_RETENTION_DAYS`（默认 14 天） |
| 双写 | 同时输出控制台，**不破坏 `.run/backend.log` 这条既有排错路径** | `LOG_CONSOLE`（默认开） |
| 降级 | 目录不可用/写失败 → 静默转纯控制台，绝不因日志故障打挂业务 | — |

用 `fs.appendFileSync` 而非 stream：stream 的缓冲在 `kill -9` 时会丢，而「进程崩了」正是最需要日志的时刻。

### 实测证据（node 实际执行，非 checklist 自评）

- **配置层 21 项**：默认值 / 类型转换（`PORT=8080`、`CORS_ORIGINS` 去空格去空项、布尔 `1|true`）/ 5 类非法值拒绝（`PORT=abc`、越界、三个枚举报错）/ `production` 无 `JWT_SECRET` 拒绝启动 / **`validateEnv` 后 `process.env` 未被改写** —— 全过。
- **脱敏 8 项**：抓出 2 个真 bug 并修掉，其中一个是**凭据泄漏**——`Authorization: Bearer xxx` 先被 kv 规则从 `=` 处截断成 `Authorization: ***`，`Bearer` 一消失，后面的 Bearer 规则再也匹配不到那个 token，结果 token 明文留在日志里。修复方式是把 BEARER 规则挪到 kv 规则**之前**，并给 kv 加负向前瞻双保险（`(?!(?:Bearer|Basic)\s)`）。另一处是 JSON 引号失配（`{"secret":"***""}`，值字符类没排除引号导致闭引号被吞）。
- **落盘 5 项**：全量/错误双文件分离、context 与堆栈附加参数被记录、ISO 时间戳。
- **保留期 2 项**：造 40 天前的过期文件被删，同时确认目录里的 `keep-me.txt` 不被动（清理只认自家命名）。
- **降级 1 项**：`LOG_DIR=/proc/definitely/not/writable` 时构造不抛错、`logDir` 为空串标记降级、后续日志调用仍安全。
- **轮转 3 项**（`LOG_MAX_FILE_MB=1` 写 2.4MB）：产出 1.00 / 1.00 / 0.46 MB 三个文件，均未超约 2× 上限，且 **2400 条日志一条不少**（总量守恒）。
- **Nest 容器装配 5 项**：`AppFileLogger` 与 `ConfigService` 注入成功、`config.get('log.level')` 读得到、启动日志（`Starting Nest application...` / `InstanceLoader` / `successfully started`）完整落盘 —— 实证 `bufferLogs: true` + `app.useLogger()` 的 flush 链路有效。

### 依赖审计

`verify:deps` 数字与既有记录完全一致（致命 0 / 无害 73 / PIN 9），新依赖未引入任何偏差。把 `@nestjs/config/node_modules/dotenv@18.0.3` 登记进脚本的 `REQUIRED_NESTING`（现 5 条），并做了**反向验证**：临时移走该副本后审计正确报出致命并指名原因，复原后 5/5 就位。

### 已知取舍

- `@nestjs/config` 是纯 ESM，本项目编译目标是 CommonJS，`dist` 里靠 Node ≥ 22.12 的 `require(esm)` 工作（当前 22.22.2 已实测）。若 Node 下探到 < 22.12 会 `ERR_REQUIRE_ESM`，退路是换 `@nestjs/config@4.x`（CJS，peer 需手工处理）。
- `AllExceptionsFilter` 改由 AppModule 的 `APP_FILTER` 注册（它要注入 logger 才能落盘），`main.ts` **不得**再加 `useGlobalFilters` —— 并存会执行两次。
- 未做：`process.env.X` → `ConfigService` 的全量收敛（5 处）。当前两者并存且语义等价，属于独立的重构批次。
- 与 `docs/gap-analysis.md` 的 **GAP-23**（「结构化日志与请求追踪：当前零散 `console.log`，后台出问题无法按 userId/orderId 串起链路」）的关系：本轮**只闭环了前半句**——`src/` 下已无裸 `console.log`，全部日志经统一出口落盘。后半句「请求追踪」未做：尚无 requestId 生成与注入，也未把 userId/orderId 带进日志行。GAP-23 因此应视为**部分闭环**，该审计文档按其自身声明（编号作取证索引、状态「待裁定」）未改动。

---

## 状态态统一（loading / 空 / 失败）· 2026-10-20

用户指令「页面 loading，空态，等优化」。勘察结论：问题不止是"样式不统一"，而是**三处行为性缺陷**——状态在**说假话**。

### 三个行为缺陷（本次修复的核心）

| 缺陷 | 表现 | 为什么是缺陷 |
| --- | --- | --- |
| **加载失败被渲染成空态** | 作品页/素材库页失败只 `message.error` 弹一下，随后照常渲染「还没有作品」「素材库还是空的」 | 谎报状态。用户以为是自己没数据，实际是接口没连上 → 会以为数据丢了而反复重试 |
| **生成中渲染成空态** | 6 个工具页提交后 `setResult(null)`，结果栏整块退回空态插画，文案写着「提交任务后，生成结果将在此处展示」 | 欺骗性 UI。用户明明点了生成，却看到"你还没提交"。慢模型下尤其刺眼 → 会以为按钮没生效而重复点击 |
| **加载中 / 失败 / 空 三义混用** | `credits-empty` 一个 class 同时表达「正在加载…」「加载失败」「还没有积分流水」，只有文字颜色不同；邀请页更离谱，拿 `<h2>加载中…</h2>` 当加载指示器 | 慢网下用户以为页面是空的；失败时无从判断是"没数据"还是"没连上" |

### 统一方案

新增 `frontend/src/components/StateViews.tsx`（`StateSkeleton` / `StateLoading` / `StateEmpty` / `StateError`）与 `frontend/src/components/illustrations.tsx`（插画唯一来源）。

- **插画唯一化**：`ExceptionPage` 内联的 `Illustration` 与 `ToolShell` 导出的 `ToolEmptyIllustration` 此前各画各的，且 `ToolEmptyState ↔ ToolShell` **成循环依赖**（前者 import 后者，后者又 import 前者）。现统一到 `illustrations.tsx`，环随之消失。`ToolEmptyIllustration` 内联的 7 处裸 hex 一并换成 `var(--token)`（新增插画专用 `--illus-sun` / `--illus-mountain`，字面值与原图一致，**换 token 不改视觉**）。
- **骨架屏取代转圈**：转圈让内容区域高度塌陷再撑开，页面明显跳动；骨架屏占住最终布局形状，内容到达时零位移。
- **空态与失败态视觉可区分**：空态品牌紫，失败态红色。
- **失败态三件套**：说清发生了什么 / 展开技术详情 / 一个重试出口。

### 覆盖范围

| 类别 | 页面 |
| --- | --- |
| 失败态修复 | 作品页、素材库页、积分页、订单页、工作台、数据中心、邀请页、积分商城、结算页、素材库弹窗、通用工具页、后台详情抽屉 |
| 生成中骨架 | ToolShell（8 个修图系工具页）+ 商品主图 / 商品详情图 / 爆款复刻 / 自由创作 / 多图融合 / 通用工具页 |
| 加载骨架 | 作品页、素材库页、积分页、订单页、工作台、数据中心、邀请页、积分商城、结算页、后台列表 |
| 语义拆分 | `credits-empty` → `credits-list-empty`（收窄为"只用于没有数据"）；落地页套餐/积分包的「加载中…」拆为 加载中 / 加载失败 / 无商品 三态 |

### 顺带收敛

- `AdminLayout.AdminPageLoading` 与 `AdminWidgets.AdminListLoading` 是同一个东西的两份实现 → 合并为一处。
- `AdminDrawer` 原用 `antd <Empty description={error}>` 表达失败 → 改 `StateError`；并补 `retryNonce` 让「重试」真正重新拉取（此前 `setOpen(v => v)` 值不变，不会重跑）。
- 删除失效 CSS：`.wb-panel-loading` / `.pk-library-empty` / `.my-works-loading` / `.asset-library-state` / `.asset-library-load-more-spinner`。

### 闸口（真实执行，非 checklist 自评）

```
npx tsc --noEmit                                    → TSC_EXIT=0
npx playwright test tests/state-contract.spec.ts     → 5 passed
npx playwright test（全量 65 项）                     → 12 passed / 1 failed / 52 skipped
```

新增 `frontend/tests/state-contract.spec.ts`：5 条用例守的是**状态语义**（失败必须是失败态、生成中必须是骨架、加载中必须有指示），用网络拦截 + DOM 断言，**不用截图比对**——截图会被无关视觉微调弄红。

**已验证该测试能捕获回归**：临时把作品页退回"失败走空态"的缺陷实现 → 用例转红 → 还原 → 复绿。

> ⚠ 全量 e2e 唯一失败项 `free-creation-submit.spec.ts` **与本轮改动无关**：运行中的后端是旧构建（`GET /api/v1/products` 返回 404、能力清单响应里没有 `creditCost` 键），导致前端 `useCreditLabel` 拿不到价而显示「免费」，而用例断言「本次消耗 10 积分」。取证：新版源码求值 `defaultCreditCostOf('free_create') = 10`，即后端重启到最新构建后该断言成立。
