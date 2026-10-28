# 工作台 / 我的作品 / 素材库页面复原提示词

## 1. 任务目标

按参考站 1:1 复原以下三页的页面布局、样式、交互与真实功能：

- 工作台：`https://ijihua.cn/workbench`
- 我的作品：`https://ijihua.cn/my-works`
- 素材库：`https://ijihua.cn/asset-library`

目标代码（用户给定产物）：

- JS：`https://ijihua.cn/assets/index-Do3-_JpH.js`
- CSS：`https://ijihua.cn/assets/index-lrpwPXNE.css`

复核时参考站已更新构建产物，实际抓取使用：

- JS：`https://ijihua.cn/assets/index-B4lo6Cz6.js`
- CSS：`https://ijihua.cn/assets/index-DDOEXtwn.css`

本地实现文件：

- `frontend/src/pages/WorkbenchPage.tsx`
- `frontend/src/pages/WorksPage.tsx`
- `frontend/src/pages/LibraryPage.tsx`
- `frontend/src/App.tsx`
- `frontend/src/styles/global.css` 末尾「2026-10-28 复原」区块
- `backend/src/capabilities/definitions/image_to_video.ts`

## 2. 必须遵守的边界

1. 复用真实鉴权、积分、统计、任务、作品、素材、项目、上传与能力注册表接口。
2. 不用固定图片、假任务、假积分或假作品填充登录态；无数据时展示真实空态。
3. 游客可以直达三页，不弹被动登录墙；需要身份的动作仍由现有鉴权链路处理。
4. 参考站图片与图标必须下载到本地 `public/`，运行时不请求参考站资源。
5. 不回滚商品 SKU、多图融合等既有 WIP；不提交 Git。
6. 只修改与三页复原直接相关的代码与文档，保持既有业务能力不退化。
7. 参考站左侧导航、顶栏、促销条不属于本轮重写范围，沿用本地现有外壳。

## 3. 工作台规格

### 3.1 布局

1440×1000 实测：

- `.app-content` / 主内容区：`x=176, y=104, w=1264`。
- `.workbench-content`：`padding: 24px 24px 64px`。
- Hero：`x=200, y=128, 1216×212`，`padding: 0 100px`，圆角 16。
- 工具卡：6 列，`189.33×202.67`，`gap: 16`；第一行 `y=356`，第二行 `y=574.67`。
- 卡片缩略图 `189×95`（2:1）；图标 `40×40`，`left: 15px`，`bottom: 88px`。
- 卡片文字区高 108，`padding: 40px 16px 24px`。
- 数据区：`account 800×268`、`recent 400×268`、通栏 `dashboard 1216×268`。
- 游客数据面板：`min-height: 220px`，`gap: 16px`。
- 游客登录按钮：`#6254ed`，圆角 6，`padding: 8px 16px`，文字 16px。

390×844 实测：

- `.workbench-content`：`390×2263`，页面从 `y=54` 开始。
- Hero：`370×160`，`padding: 18px 20px`。
- 工具网格 2 列，卡片 `181×199`，gap 8。
- 三个数据面板均为 `370×252`：登录引导 220 + 上下各 16 padding。
- 桌面 `min-height: 268px` 不得带入移动端，否则三面板合计会高出参考站 48px。

### 3.2 固定 12 卡

顺序与能力 id：

1. `main_image` 商品主图
2. `detail_image` 商品详情图
3. `hot_remake` 爆款复刻
4. `creative_image` 创意生图
5. `local_redraw` 局部重绘
6. `expand` 智能扩图
7. `matting` 一键抠图
8. `remove_watermark` 去除水印
9. `image_translate` 图片翻译
10. `enhance` 产品精修
11. `recolor` 商品换色
12. `rotate` 旋转角度

卡图与图标：

- `main_image` → `spzt.webp` / `m_spzt.svg`
- `detail_image` → `spxq.webp` / `m_spxq.svg`
- `hot_remake` → `bkfk.webp` / `m_bkfk.svg`
- `creative_image` → `cyst.webp` / `m_cyst.svg`
- `local_redraw` → `jbch.webp` / `m_jbch.svg`
- `expand` → `znkt.webp` / `m_znkt.svg`
- `matting` → `bjxc.webp` / `m_bjxc.svg`
- `remove_watermark` → `qcsy.webp` / `m_qcsy.svg`
- `image_translate` → `tpfy.webp` / `m_tpfy.svg`
- `enhance` → `cpjx.webp` / `m_cpjx.svg`
- `recolor` → `sphs.webp` / `m_sphs.svg`
- `rotate` → `xzjd.webp` / `m_jdxz.svg`

AI 视频不在参考站工作台 12 卡内，因此 `image_to_video.inWorkbench = false`；能力仍保留在侧栏与工具页。

### 3.3 交互与功能

- 点击卡片进入对应能力工具页。
- 卡片 hover 时缩略图轻微放大，白色图标块切换为紫色 mask 图标。
- 卡片保留运行时禁用/不可用逻辑与原因提示。
- 游客态三个数据面板显示参考站文案与「登录查看」按钮。
- 游客不请求 `/stats/overview`；登录后才拉取真实统计。
- 登录态保留真实积分、累计生成、素材库存、最近任务、6 格数据中心与 7 日趋势。

### 3.4 游客新人福利弹层（复制 + 改）

组件：`frontend/src/components/GuestPromoDialog.tsx`，由 `AppLayout` 挂载，仅游客可见。

复制参考站的交互与几何：

- 首访延迟 1.2s 出现；遮罩 `#0f121ea8`、`padding: 16px`、`z-index: 1500`。
- 对话框 `width: min(500px, 100vw - 24px)`、`aspect-ratio: 500 / 427`、入场动画 `0.22s ease-out`。
- 关闭按钮 28×28，位于对话框右上 `top: -32px; right: 0`；支持点击遮罩、Esc 与按钮关闭。
- CTA 热区 `width: 32%; height: 12%; left: 34%; bottom: 8.5%`，即 160×51（500px 宽时）。
- 倒计时为 `HH:MM:SS` 数字块，基准使用服务端 `serverNow`，不按本地时间自减。

本地化改写（不得回退）：

| 参考站 | 本地 |
|---|---|
| 新用户免费送 100 积分 | 注册流程不发积分，不展示该承诺 |
| 送 10 张商品图片 / 50 次抠图 / 50 次去水印 / 50 次产品精修 | 一键抠图免费、一键去水印免费、作品云端保存、素材统一管理 |
| 立即领取 | 无假领取动作；无活动时 CTA 为「免费体验」→ `/background-remove` |

真实数据口径：

- 有生效活动时，标题、CTA、`endAt`、`serverNow` 全部取 `GET /api/v1/marketing/popup`。
- 没有生效活动时展示静态真实权益，**不显示倒计时**。
- 关闭后写入 `ecom-guest-promo-dismissed-v1`，刷新不再重复弹出；登录用户不渲染。
- 底图 `frontend/public/guest-promo/alertbg.webp` 已本地化，并移除参考站积分、次数与「立即领取」文字；运行时零参考站请求。

## 4. 我的作品规格

### 4.1 布局与样式

1440×1000 实测：

- `.my-works-page`：`x=176, y=104, 1264×936`，`padding: 28px 28px 72px`。
- 标题容器：`x=204, y=132, 900×58`。
- H1：40px/600，行高 58px。
- tabs：`x=204, y=216, 1208×33`，`gap: 24`，底部 1px `#ece9e3`。
- 当前 tab：`#6254ed`，文字 14px/600，按钮高 32。
- 工具栏：`x=204, y=265, 1208×72`，`padding: 12px 14px`，圆角 16。
- 筛选 chip：108×37.5，12px，`#5f5b55`，边框 `#ebe8e1`。
- 下载按钮：97×33，背景 `#6c5ce7`，圆角 999，内部 15×15 方框 + 12px 文案。
- 数量行：`y=355`，13px `#4d4943`；右侧排序文案 12px `#96918a`。
- 空态：`y=387.5, 1208×300`。
- 空态图标：72×72，`#aaa69e`。
- 空态标题：18px/700 `#3d3934`。
- 空态说明：13px `#9a958d`。

390×844 实测：

- `.my-works-page`：`390×780`，`padding: 16px 16px 52px`。
- 标题容器：`x=16, y=70, 358×35`；H1 28px/600，行高 35px。
- tabs：`x=16, y=123, 358×33`，gap 18。
- 工具栏：`x=16, y=172, 358×154`，`flex-wrap: wrap`。
- 筛选器两列：每个 `159×37.5`；下载按钮 `328×33`。
- 数量行 `y=344`，空态 `x=16, y=376.5, 358×300`。

### 4.2 结构

```text
.my-works-page
├── .my-works-intro
│   └── h1 我的作品
├── .my-works-tabs
├── .my-works-toolbar
├── .my-works-count-row
└── .my-works-empty / .my-works-grid
```

标题与 tabs 必须是兄弟节点；tabs 不能放进 `.my-works-intro`，否则工具栏会整体下移 7px 以上。

### 4.3 交互与功能

- 图片作品 / 视频作品切换。
- 业务类型、日期、状态、所属任务四类筛选。
- 选择下载、清除筛选、任务重试、图片大图预览。
- 游客直接展示筛选器、0 张作品与空态，不显示登录墙。
- 登录后使用真实任务列表；加载失败与「没有作品」分开呈现。

## 5. 素材库规格

### 5.1 布局与样式

1440×1000 实测：

- `.asset-library-page`：`x=176, y=104, 1264×896`，`padding: 24px 24px 56px`。
- `.asset-library-shell`：`x=200, y=128, w=1216`。
- 标题：28px/700，行高 40。
- 游客空态：`x=200, y=190, 1216×212`。
- 空态插画：160×160。
- 空态标题：14px/700 `#333`。
- 空态说明：12px `#86909c`。

### 5.2 交互与功能

- 游客显示标题与官方空态插画，不显示上传/筛选操作区与分组面板。
- 登录且已有素材时显示来源筛选、能力筛选、刷新、上传、分组面板、网格和批量操作。
- 素材网格使用真实素材接口；继续使用分页拉取、选择、下载、删除、分组筛选与能力跳转。
- 增加参考站同路径别名 `/asset-library`；本地既有 `/library` 保持兼容。

## 6. 验收标准

1. 1440、1280、760、390 四档无横向溢出、无 `pageerror`。
2. 工作台固定渲染 12 张卡；6 列 / 4 列 / 2 列响应式正确。
3. 我的作品与素材库游客态布局与参考站几何一致。
4. 工作台游客态不发统计请求；登录态能显示真实统计。
5. 我的作品、素材库登录态能读取真实数据，不出现 401 文案或假数据。
6. TypeScript、Vitest、前端生产构建、后端构建、`git diff --check` 全部通过。
7. `frontend/tests/workspace-pages.spec.ts` 的游客态、登录态、双路径和 390 响应式回归全部通过；`frontend/tests/sidebar.spec.ts` 的侧栏双断点、折叠与底部入口回归全部通过。

## 7. 保留差异

- 顶栏与促销条沿用本地现有实现；侧栏已于 2026-10-28 按新产物单独复原：176px / 100px 双态、分组标题、本地菜单图标、底部产品建议与联系客服、376px hover 预览。精确实拍与差异见 `docs/workbench-design.md` §11。
- 侧栏断点为 `≤1366px` 100px 竖轨 / `≥1367px` 176px 横排；本地在 `≤900px` 继续使用汉堡 Drawer（参考站到 ≤768px 才隐藏侧栏）。
- 侧栏保留本地两个真实入口：图生视频（`/tools/image_to_video`）与数据看板（`/stats`）；商品详情在侧栏按参考站显示为“商品详情”。
- 参考站工作台主区使用内部滚动容器；本地使用 window 滚动。
- 登录态数据面板使用本地真实统计字段，不复制参考站不可见的内部数据结构。
- 参考站部分按钮/文案会随活动与账号状态变化；本轮以 2026-10-28 游客态和真实空账号登录态为准。
- 参考站公开页约 1.2 秒后会弹出「新用户免费送 100 积分」营销遮罩；本地保留其布局、动效与关闭交互，但权益改为真实可兑现的一键抠图/去水印免费、作品与素材管理，且不伪造积分、次数或领取结果。

## 8. 本轮实施记录

- 工作台改为新的 `.workbench-content`、12 卡与三类数据面板结构，并本地化 banner、卡图、图标。
- 工作台 AI 视频移出固定卡片位，能力入口保留。
- 我的作品删除游客登录墙，修正标题/tabs/toolbar/空态结构与样式。
- 素材库删除游客登录墙，使用参考站 160px 官方空态插画；登录后才显示操作区与分组。
- 增加 `/asset-library` 路由别名。
- 真实登录态验证：工作台积分/统计/最近任务、作品空态、素材上传后网格与分组均正常。
- 新增游客新人福利弹层：本地化底图、真实权益、DB 活动倒计时、关闭持久化与登录态抑制。
- 新增 `frontend/tests/workspace-pages.spec.ts`，固化 11 条回归：12 卡顺序、卡片导航、游客零私有请求、登录态真实面板、双素材库路径、官方空态资源、390 无溢出，以及弹层尺寸/倒计时/关闭持久化/真实 CTA。
- 左侧菜单复原：改用参考站分组结构（工作台/我的作品 + AI视频/电商生图/AI修图/数据中心 + 底部入口），下载 18 个菜单图标到 `frontend/public/menu/`，hover 预览对齐 376×236；修复促销条开启时侧栏高度少算 40px 的问题。新增 `frontend/tests/sidebar.spec.ts`，固化 1440/1280/1366/1367、折叠、唯一面板 id、工单预填与 390 Drawer 共 6 条回归。
- 视觉对拍（1440，裁掉外壳与对应活动弹层）：我的作品 SSIM `0.997`，素材库 `0.999`，工作台 `0.950`；剩余差异主要来自字体抗锯齿和参考站外壳文案。
- 390 收口：修正我的作品页面 `16px 16px 52px` 内边距、两列筛选器与全宽下载按钮；修正工作台移动端面板高度 `268 → 252`。元素尺寸与参考站一致，移动端底屏 SSIM `0.996`。
