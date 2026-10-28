# 素材库页面（Asset Library）设计规格与实拍审计

> 抓取人：小帮｜抓取日期：2026-10-19｜参考站路由：`https://ijihua.cn/asset-library`｜本地路由：`/library`（2026-10-28 起同时支持 `/asset-library` 别名）
> 抓取方式：Playwright（chromium，`--no-proxy-server` 直连）+ 本地 dev server 登录态实测（演示账号）
> 本地实现现状：`frontend/src/pages/LibraryPage.tsx`（330 行）+ `frontend/src/styles/global.css` §素材库（7416–7791 行）
> 本文件是**设计规格 + 差距审计**，不含代码改动。改动按「裁定在前 → 出偏差清单 → 获批 → 改码」纪律执行。
> 视觉证据：`docs/asset-library-ref/`（参考站与本地同视口对比截图 4 张）

---

## 0. 结论摘要（先看这个）

| # | 发现 | 优先级 | 一句话结论 |
|---|---|---|---|
| 1 | **标题字号/字重不符** | **P1** | 参考站 h1 = 28px/700/lh40（移动端 24px/700）；本地写死 24px/600（`global.css:7432`） |
| 2 | **双重内边距，内容列偏移 24px** | **P1** | `.app-content` padding 24 + `.asset-library-page` padding 24 叠加 → 1280 下内容 x=132/宽1100，参考站 x=108/宽1148（右移 24、窄 48）。与 10-19 上午布局审计「5 页双重 padding」同桶 |
| 3 | **移动端网格断点缺失** | **P1** | 参考站产物显示真实断点为 1200/980/640/380 四档（≤980 三列 + `padding 24 20 44`；≤640 两列 + `gap 10` + `padding 18 12 36`）；本地当时只有 1200→4 列 / 380→1 列，390 下 4 列 68.5px 卡、封面 67²、标题截 3 字 |
| 4 | **空态缺插画** | P2 | 参考站空态 = 160×160 SVG + 「暂无素材」+「快去上传素材吧」；本地纯文案 + 上传按钮，无插画 |
| 5 | page min-height 用未定义变量 | P2 | `calc(100vh - var(--workspace-topbar-height, 64px))`， promo 开启时 chrome 实为 104 → 恒定 40px 死滚动（10-19 布局审计已登记同款） |
| 6 | populated 态版式（5 列卡/分组面板/批量条/加载更多） | ⚠️ 部分对齐 | 网格/卡片规则与产物逐值一致（radius 14、封面 1:1、hover 玻璃底 actions、check 22×22）；但**「卡 207×273」是假对齐** —— 参考站卡片 fluid 无固定宽度，207 是本地双重 padding bug 下的测量值，容器纠正后应为 217 |

**总体判定**：素材库的 populated 态版式复刻质量高（10-17 CSS 产物提取 + 10-18 交互态对拍）；问题集中在**标题规格**（P1-1）、**双重内边距**（P1-2，全站 5 页同桶）、**移动端网格**（P1-3）三处。

---

## 1. 证据基线与置信度声明

| 项 | 值 |
|---|---|
| 参考站可达性 | 200，SPA 客户端渲染；guest 态**不跳登录**，可直接渲染 |
| 参考站可观测态 | **仅空态**（guest 无素材）：标题 + 空态插画 + 两句文案。populated 态（网格/卡片/分组/批量条）**被登录墙挡住，本次未取到实时 DOM** |
| populated 态数据来源 | 2026-10-17 提取的参考站**未混淆 CSS 产物** `/assets/index-*.css`（86 个 `.asset-library-*` 类，字面值可直读），已固化在 `LibraryPage.tsx:19-48` 注释块 |
| 本地实测 | dev server `localhost:5100` + 演示账号 `admin@demo.com`（26 个素材，populated 态真实渲染），1280/1100/390 三视口 |
| 置信度 | 标题/空态/页面级几何 = **参考站实时实测**；populated 态卡片规格 = **CSS 产物字面值 + 本地实测**（无法与参考站登录态交叉验证） |

---

## 2. 参考站结构解剖（1280×800，guest 态实测）

```
main.workspace-route-content        [1196x696 @84,104]  内部滚动, bg #f6f7fb
└─ section.asset-library-page       [1196x696 @84,104]  padding 24 24 56, color #171A2B,
   │                                                  min-height calc(100vh - 64px)
   └─ div.asset-library-shell       [1148x274 @108,128]  (= 1196 - 48)
      ├─ header.asset-library-header [1148x40 @108,128]  flex / space-between / flex-end / gap24 / mb22
      │  └─ h1#asset-library-title   [84x40 @108,128]    28px/700 lh40 #171A2B「素材库」
      │     （guest 态右侧无操作按钮; 登录后应出现, 未取到）
      └─ div.asset-library-state.asset-library-state-empty [1148x212 @108,190]
         │     flex column / center / center / gap8
         ├─ img     [160x160]  https://ijihua.cn/assets/yqempty-CwufBZnL.svg
         ├─ strong  [56x16]    14px/700 #333 lh16「暂无素材」
         └─ span    [84x20]    12px #86909C「快去上传素材吧」
```

**关键实测值**：

| 节点 | 属性 | 参考站值 |
|---|---|---|
| `.asset-library-page` | padding | `24px 24px 56px`（桌面）；**`18px 12px 36px`（390 移动端，响应式收窄）** |
| `.asset-library-header` | 布局 | flex / space-between / align-items flex-end / gap 24 / margin-bottom 22 |
| `#asset-library-title` | 字体 | **28px/700/lh40/#171A2B**（桌面）；**24px/700**（390 移动端降级，字重保持 700） |
| `.asset-library-state-empty` | 布局 | flex column，justify/align center，gap 8，高 212 |
| 空态 strong | 字体 | 14px/700 #333 lh16 |
| 空态 span | 字体 | 12px #86909C |
| 空态插画 | 尺寸 | 160×160 SVG（`yqempty-*.svg`，本站静态资源） |

**populated 态**（10-17 CSS 产物提取，本次无法登录态复核）：`.asset-library-grid` repeat(5) gap16；卡 #fff / border 1px #E4E7EF / radius 14 / shadow `0 5px 16px #2A315709`；封面 aspect-ratio 1 底色 #F1F3F8；content padding `12 13 13`；title 13px/600 #30364A ellipsis；meta 11px/17 #A0A7B6 space-between；check 22×22；hover 玻璃底 actions；groups-panel / load-more / notice 等 86 类全套。

---

## 3. 本地实现对拍（登录态实测 2026-10-19）

| 维度 | 参考站 | 本地实测 | 判定 |
|---|---|---|---|
| page padding（桌面） | 24 24 56 | 24 24 56 | ✅ |
| page padding（390） | **18 12 36** | 24 24 56（无移动变体） | ❌ P2 |
| 标题 | **28px/700 lh40** | **24px/600 lh37.7** | ❌ **P1** |
| 标题（390） | 24px/700 | 24px/600 | ❌ 字重仍错 |
| header 布局 | flex space-between flex-end gap24 mb22 | 同（`global.css:7425`） | ✅ |
| 内容列起点 @1280 | x=108，shell 宽 1148 | **x=132，header 宽 1100** | ❌ **P1 双重 padding** |
| 副标题 | guest 无（登录后未取到） | 「共 26 个素材 · 上传的原图与生成的图片都在这里统一管理」13px | ⚠️ 本地自有（合理，信息量真实） |
| 头部操作 | guest 无（登录后未取到） | 来源筛选/能力筛选/刷新/上传素材（h42、13px、radius11） | ⚠️ 本地自有（登录态本就可操作，规格按 10-17 产物） |
| 分组面板 | populated 态有（CSS 产物） | 有，版式一致；点击「新建分组」诚实提示未接入 | ✅ 已登记诚实差异 |
| 网格（1280） | repeat(5) gap16 | 5×207，卡 207×273，封面 205²，radius 14 | ✅ |
| 卡片标题/meta | 13px/600 / 11px/17 | 13px / 11px | ✅ |
| 批量条/加载更多 | CSS 产物有 | 有（20/26 分页，load-more 出现） | ✅ |
| 空态 | 160 插画 + 暂无素材 + 快去上传素材吧 | 「素材库还是空的」+ 长文案 + 上传第一张按钮，**无插画** | ❌ P2 |
| min-height | calc(100vh - 64px) | calc(100vh - var(--workspace-topbar-height, 64px))，变量未定义 | ⚠️ P2（promo 开启 40px 死滚动，布局审计已登记） |
| 横向溢出 | 0 | 0（1280/1100/390 均无） | ✅ |

---

## 4. 设计发现与修复建议（按优先级，均未动码，待裁定）

### P1-1 标题规格：24px/600 → 28px/700（桌面）/ 24px/700（移动）

**证据**：参考站实测 `#asset-library-title` = 28px/700/lh40/#171A2B（桌面）、24px/700（390）；本地 `global.css:7432-7437` 写死 24px/600。同为页面主标题，工作台 hero 标题是 32px/500——两者不同页不同规格，互不参照；素材库以参考站实拍为准。

**建议修法**：
```css
.asset-library-title { font-size: 28px; font-weight: 700; line-height: 40px; color: var(--text-strong); }
@media (max-width: 700px) { .asset-library-title { font-size: 24px; } }  /* 字重保持 700 */
```

### P1-2 双重内边距：内容列右移 24px、窄 48px

**证据**：参考站 `.workspace-route-content` **无横向 padding**，页面自带的 24px 即唯一内边距（route x=84 + page 24 → shell x=108，宽 1148）。本地 `.app-content` padding 24（`global.css:871`）与 `.asset-library-page` padding 24（`:7421`，从参考站 CSS 产物 1:1 抄来）叠加 → 1280 实测 x=132/宽 1100。

**注意**：这是 10-19 上午《页面布局统一性审计》P1「5 页双重内边距」中的一页（asset-library 24/24/56，effective 48/48/88），同桶还有 my-works / invite / pkg-shop / mif。该审计的修复项（「按 pk 范式逃逸或清零」）尚未执行——**建议作为一批统一处理，不要单独改素材库**，否则页与页之间又会不一致。

**建议修法（二选一，随布局审计批次裁定）**：
- A：页面级 padding 清零，只留 `.app-content` 的 24（但 56px 底 padding 是参考站页面级规格，需保留 → 改为 `padding: 0 0 56px`）
- B：保留页面级 24 24 56，`.app-content` 对该页清零（pk-workspace 的 `margin: -24px -24px -32px` 负 margin 逃逸范式）

### P1-3 移动端网格断点缺失：390 下 4 列 68.5px 卡不可用

**证据**：本地 `.asset-library-grid` 断点仅 1200→4 列 / 380→1 列；390 实测 4×68.5px，封面 67²、标题「自由…」3 字截断、meta「1024×1024 · 121KB」在 11px/67px 宽下完全不可读（截图 `asset-library-ref/local-lib-390.png`）。

**边界说明**：参考站 populated 移动栅格被登录墙挡住，**无法取到参考值**——不能按 1:1 复刻，只能按可用性补断点。

**建议修法**（本地可用性决策，需裁定列数）：
```css
@media (max-width: 700px) { .asset-library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```
（2 列 × ~155px：封面足够大、标题 13px 可读、meta 两段可并排；另建议 390 下 page padding 跟进参考站的 18 12 36 移动变体）

### P2-1 空态插画缺失

参考站空态有 160×160 SVG（`yqempty-*.svg`）+ 「暂无素材 / 快去上传素材吧」；本地空态无插画、文案为自有。建议：保留本地文案（产品语义更完整），**补一张空态插画**（原创 SVG，不引第三方资源，与 ToolEmptyIllustration 同纪律），strong 保持 14px/700 #333。

### P2-2 min-height 变量未定义

`--workspace-topbar-height` 全库未定义（10-19 布局审计 P2 已登记：library 页 fallback 64px 但 promo 开启时 chrome 104px → 恒定 40px 死滚动）。随布局审计批次一定义即可，本次不单独动。

### P3-1 无害重复块

`global.css:7801-7812` 与 `7620-7625` 规则同值（卡片 hover/选中），可顺手清理，不影响渲染。

---

## 5. 裁定项清单 → 已实施（2026-10-19）

| # | 事项 | 建议 | 状态 |
|---|---|---|---|
| 1 | P1-1 标题 28px/700（桌面）/ 24px/700（移动） | 按参考站实拍修正 | ✅ 已实施 |
| 2 | P1-2 双重内边距 | 随布局审计 5 页批次统一处理 | ⏸ 未做（等布局批次二选一裁定） |
| 3 | P1-3 移动端网格 2 列 + page padding 18 12 36 | 可用性决策 | ✅ 已实施（2 列） |
| 4 | P2-1 空态补原创插画 | 保留本地文案 + 补 SVG | ✅ 已实施（复用工具页内联 SVG，未新增资产） |
| 5 | P2-2 min-height 变量 | 随布局审计批次 | ⏸ 未做 |
| 6 | P3-1 重复规则块 | 顺手清理 | ✅ 已实施 |

---

## 6. 实施记录（2026-10-19）

### 6.1 改了什么

| 项 | 文件 | 变更 |
|---|---|---|
| P1-1 标题 | `global.css` | `.asset-library-title` 24px/600 → **28px/700/lh40**；≤700px 降级 **24px/700/lh34**（字重保持 700，与参考站一致） |
| P1-3 移动栅格 | `global.css` | 新增 `@media (max-width:700px)`：网格 **2 列**、`.asset-library-page` padding **18px 12px 36px**、header gap 12、操作区 wrap、标题降级。断点顺序 1200 → 700 → 380，380 仍在最后（≤380 命中两档，靠源码顺序取 1 列） |
| P1-3 附带 | `global.css` | ≤700 卡片 meta 两段原本各自折行（「1024×1024 · 121KB」「生成图」都断成两行，卡高被撑到 248）→ 左段 ellipsis 截断、右段整词不折，实测卡高回落到 **231** |
| P2-1 空态插画 | `LibraryPage.tsx` | `.asset-library-empty` 顶部插入 `<ToolEmptyIllustration />`（160×160）。**不引参考站 `yqempty-*.svg`**，复用工具页同一张内联 SVG（`ToolShell.tsx:410`），与 pk/vc/fc 同款；strong/span/按钮文案保持本地产品语义 |
| P3-1 重复块 | `global.css` | 删除文件末尾重复的 `.asset-library-card:hover/.is-selected` + cover scale 三条规则（与 §素材库 前段 7789-7799 同值；`.is-selection-mode` 覆写靠特异性 (0,3,0) 仍胜出） |

### 6.2 实测

| 视口 | 标题 | page padding | 列数 | 卡片 | 封面 | 横向溢出 |
|---|---|---|---|---|---|---|
| 1280 | 28px/700/lh40 #171A2B | 24 24 56 | 5 × 207.195px | 207×273 | 205² | 无 |
| 701 | 28px/700/lh40 | 24 24 56 | 4 | — | — | 无 |
| 700 | 24px/700/lh34 | 18 12 36 | 2 × 165px | 165×231 | 163² | 无 |
| 390 | 24px/700/lh34 | 18 12 36 | 2 × 165px | 165×231 | 163² | 无（docScrollW=390） |

空态（能力筛选=多图融合，0 条）：插画 **160×160** + strong「素材库还是空的」+ span + 「上传第一张」按钮，容器高 267px。断点边界 701/700 实测互不串档。零 JS 报错。

### 6.3 未做 → 已在布局批次完成（2026-10-19 晚，另见 `docs/layout-unification.md`）

| 项 | 说明 |
|---|---|
| P1-2 双重内边距 | ✅ 已做。1280 内容列由 **132/1100 → 108/1148**，与参考站一致。修法为 `.app-content` 逃逸（`margin: 0 -24px -32px`，限 ≥901px） |
| P2-2 min-height 变量 | ✅ 已做。`--workspace-topbar-height` 原**从未定义**（靠 64px fallback），现统一为 `calc(64px + --promo-topbar-height)` + `html[data-promo='off']` 归零。实测 promo on → min-height 796、off → 836，40px 死滚动消除 |
| P1-3 断点修正 | ✅ 从「可用性猜测」改为**参考站产物真实值**：≤1200 四列 / ≤980 三列 + `padding 24 20 44` / ≤640 两列 + `gap 10` + `padding 18 12 36` / ≤380 一列。原文「参考站取不到移动栅格」的前提不成立，`/tmp/ref-app.css` 里有全套媒体查询 |
| 「卡 207×273 ✅」纠正 | ❌ 原判定是假对齐。参考站卡片 fluid（无固定宽度），207 是本地双重 padding bug 下的测量值；容器纠正后为 **217×283** |

### 6.4 视觉证据

`docs/asset-library-ref/impl-lib-1280.png`（5 列 207 卡 + 28px 标题）、`impl-lib-390.png`（2 列 165 卡 + 18/12/36 padding）、`impl-lib-empty.png`（空态插画）。

---

## 附录 A · 抓取产物清单

| 文件 | 内容 |
|---|---|
| `docs/asset-library-ref/asset-viewport-1280.png` | 参考站素材库桌面态（guest 空态：标题 + 160 插画 + 两句文案） |
| `docs/asset-library-ref/asset-viewport-390.png` | 参考站素材库移动态（390） |
| `docs/asset-library-ref/local-lib-1280.png` | 本地素材库 @1280 登录态（26 素材 populated：分组面板 + 5 列卡 + 加载更多） |
| `docs/asset-library-ref/local-lib-390.png` | 本地素材库 @390（P1-3 实证：4 列 68.5px 卡、标题截断） |
| `/tmp/ijihua-scrape/asset-anatomy.json` | 参考站 DOM 解剖 277 节点（rect + 32 项计算样式） |
| `/tmp/ijihua-scrape/asset-page.html` | 参考站渲染后 HTML |
| `/tmp/ijihua-scrape/scrape-asset.cjs` 等 3 个 | 抓取/测量脚本（可复跑） |

## 附录 B · 与既有审计的交叉引用

- 本文件 P1-2（双重内边距）与 P2-2（min-height 变量）出自 `.workbuddy/memory/2026-10-19-design-audit.md` 的布局统一性审计 P1/P2，属同一修复批次，避免多头改动。
- populated 态规格来源为 `LibraryPage.tsx:19-48` 注释块（10-17 参考站 CSS 产物提取），本次审计未推翻其中任何数值；新增事实仅有：标题 28px/700、page 移动 padding 18 12 36、空态插画与文案。

---

## 7. 2026-10-28 新产物复原记录

参考站构建产物更新后重新复核游客态与登录态，完整提示词与三页验收记录见 `docs/workspace-pages-restoration-prompt.md`。

### 7.1 结论

| 项目 | 结果 |
|---|---|
| 路由 | 本地原 `/library` 保留；新增参考站同路径 `/asset-library` 别名 |
| 游客态 | 不再显示登录墙；显示标题与 160×160 官方空态插画 |
| 游客操作区 | 隐藏来源筛选、能力筛选、刷新、上传与分组面板 |
| 登录态 | 显示完整操作区、分组面板、真实素材网格与批量操作 |
| 资源 | 空态插画下载到 `frontend/public/asset-library/empty.svg`，运行时不请求参考站 |
| 状态区分 | 加载失败、加载中、空态与正常内容保持四条独立分支 |

### 7.2 1440 实测

| 元素 | 参考站 | 本地 |
|---|---|---|
| `.asset-library-page` | `x=176, y=104, 1264×896`，`padding 24 24 56` | 同左 |
| `.asset-library-shell` | `x=200, y=128, w=1216` | 同左 |
| Header | `1216×40` | 同左 |
| 空态 | `200,190,1216×212` | 同左 |
| 空态插画 | `160×160` | `160×160` |

### 7.3 验证

- 1440 / 1280 / 760 / 390 无横向溢出。
- 游客态无 401 请求、无错误文案。
- 真实账号上传 PNG 后，素材卡片、分组统计、来源筛选与操作区均正常显示。
- 登录态与游客态切换不影响 `/library` 既有入口。
- 新增 `frontend/tests/workspace-pages.spec.ts`：`/asset-library` 与 `/library` 双路径直达、游客零 `/assets` 请求、官方空态资源、操作区隐藏、侧栏高亮和 390 无溢出。
- 1440 主内容区视觉对拍 SSIM `0.999`。
- 390 元素级对拍 SSIM `0.999`；页面 `390×790`，空态 `366×212`。
