# AI 带货图文（shoppable-carousel）复刻 —— 实测取证与设计

> 参考站：`https://www.designkit.cn/shoppable-carousel?from=product_kit_web`（2026-11-03 取证）
>
> 本文记录参考站实测值与本站取值。第 1–7 节是**参考站实测**，本站现状见 §11。
> 本站取值一律映射到 `frontend/src/styles/tokens.css` 的 `var(--token)`。
>
> 本站外框已与商品主图 / 商品详情 / 写真模板统一：左栏为白色圆角卡、提交区独立成卡；右栏网格铺在页面底色上。第 1/3/5 节的 416px、通栏白底、固定底栏等数值是参考站实测，不是本站现状。

---

## 1. 页面骨架

参考站 DOM（实测 class 前缀 `social-media-*`）：

```
div.social-media-page-J-DPOa            1440×900  @0,0     ← 页面根，不滚动
├─ div.social-media-pageHeaderShell      1440×54   @0,0     ← 顶栏（含 logo / 标题 / 新建任务 / VIP 入口）
└─ (1440-54) 主体，flex 两栏
   ├─ aside.social-media-sidebar-l9jmVL  416×846   @0,54    ← 左配置栏，白底，右侧 1px 边 + 阴影
   │  └─ div.social-media-sidebarScroll    415×721   @0,54    ← 内部滚动区（scrollH 826 > clientH 721）
   │     └─ 5 个 section.social-media-sidebarSection
   └─ section.social-media-showcase       1024×846  @416,54  ← 右模板区，底色 #f6f7fa
      ├─ header.social-media-recipeHeader  1013×111  @416,54  ← 分类 tab 区（border-bottom 1px）
      │  └─ nav.social-media-recipeCategories 965×88 @440,76
      └─ div.social-media-recipeBody      1013×735  @416,165 ← 内部滚动区（scrollH 3573）
         └─ div.social-media-showcaseTemplateList  grid 3 列
```

**滚动归属（关键）**：`document.documentElement.scrollHeight === window.innerHeight`（1440 下 900=900；1920 下 1080=1080）→ **window 不滚动**。可滚动容器只有两个，都是**主区内部滚动**：

| 容器 | clientH | scrollH | 说明 |
| --- | --- | --- | --- |
| `.social-media-sidebarScroll` | 721 | 826 | 左栏内容区（1440×900 实测） |
| `.social-media-recipeBody` | 735 | 3573 | 右栏模板网格区 |

> 本站落地：左栏 `.sc-form-scroll`（内部滚动），右栏 `.sc-showcase`（flex 列：「创作灵感 / 创作结果」页签 + 网格滚动区），页面根不滚动。

## 2. 分栏宽度与栅格（两视口实测）

| 节点 | 1440×900 | 1920×1080 | 备注 |
| --- | --- | --- | --- |
| 顶栏 `pageHeaderShell` | 1440×54 @0,0 | 1920×54 @0,0 | 高 54 固定 |
| 左栏 `sidebar` | **416**×846 @x=0 | **416**×1026 @x=0 | **固定 416px，不随视口变** |
| 右栏 `showcase` | 1024×846 @x=416 | 1504×1026 @x=416 | 剩余宽度 |
| 网格 `showcaseTemplateList` | 954 宽 @x=440 | 1434 宽 @x=440 | 左右各 24 内边距 |
| 网格列数 | **3**（`307.33px 307.34px 307.34px`） | **4**（`346.5px ×4`） | `repeat(auto-fill, minmax(...))` 自适应 |
| 网格 gap | 16 | 16 | 行/列均 16 |
| 卡片 | 307×193 | 347×210 | `padding 7px 7px 9px`，`border-radius 16` |

> 1440 宽下右栏 1024 - 48 内边距 = 976 可用，卡片最小宽阈值落在 3 列；1920 下 1504 - 48 = 1456 → 4 列。
> 本站按同样规则：模板网格用 `repeat(auto-fill, minmax(300px, 1fr))`，gap 16。

## 3. 左栏五区块（实测）

左栏内边距 `padding 18px 16px 24px 24px`（内容区 x=24，宽 364），区块间距 `margin-top 24px`。

### 3.1 上传图片
| 节点 | 实测 |
| --- | --- |
| 区块标题 | `h2.social-media-sectionTitle`，15px，`#0f172a`，`margin-bottom 12px` |
| 拖拽框 `uploadDropzone` | 364×104，`border 2px dashed #eaedf2`，`border-radius 12` |
| 上传按钮 | 360×100，`gap 10`，`padding 18px 8px` |
| 图标块 | 12×12 圆角 8，底 `#f3f5f7` |
| 提示文案 | 「同一产品，最多5张。」14px，`#929499` |
| **张数上限** | **5 张**（文案明示） |

### 3.2 生成设置（2×2 网格 + 一个开关块）
`grid-template-columns: 177px 177px`，`gap 12px 10px`。四个下拉：

| # | 字段 | 参考站默认值 | 选项（全量实测） |
| --- | --- | --- | --- |
| 1 | 投放平台 | **TikTok** | TikTok / 抖音 / 小红书 / Instagram（4） |
| 2 | 目标市场 | **美国** | 美国 / 欧洲 / 中国 / 俄罗斯 / 东南亚 / 西班牙 / 德国 / 日本（8） |
| 3 | 输出语言 | **英文** | 英文 / 中文 / 俄语 / 西语 / 德语 / 日语 / 韩语 / 葡萄牙语（8） |
| 4 | 画面比例 | **3:4** | 1:1 / 4:5 / 9:16 / 3:4（4） |

下拉控件：`height 40`，`padding 0 12px`，`border-radius 8`，底 `rgba(0,30,89,.04)`，箭头 `#616366`。

> **本站主动偏离（默认值）**：投放平台 / 目标市场 / 输出语言默认改为 **抖音 / 中国 / 中文**——面向国内电商团队。选项清单与顺序不变，只换初值。前端 `constants.ts` 的 `DEFAULT_PLATFORM` / `DEFAULT_MARKET` / `DEFAULT_LANGUAGE` 与后端 `definitions/shoppable_carousel.ts` 的 `default` 必须同值。

第五块 **「图片不加文字」开关**：`padding 12px`，底 `rgba(0,30,89,.04)`，`border-radius 10`；标题 14px `#1c1d1f`；描述 12px `#8d919b`「图片突出产品使用场景，不添加文字。」；开关 `shadcn Switch` 28×16，**默认关**（未勾选态 `bg #ebedf2`）。

### 3.3 商品卖点 & 生成要求
| 节点 | 实测 |
| --- | --- |
| 标题 | 「商品卖点&生成要求」15px |
| 「AI 帮写」按钮 | 76×26，`padding 3px 8px 3px 3px`，`border-radius 79.75px`（胶囊），文字 12px `#3388ff`，图标 20×20 圆底 `#f1f8ff` |
| textarea | 364×116（`min-height 116`），`padding 6px 12px`，底 `#f9fafb`，`border-radius 12`，字号 13px `#374151` |
| placeholder | 「建议包含以下信息生成更精准：1.产品名称 2.核心卖点 3.适用人群 4.期望场景 5.具体参数」 |
| **字数上限** | **未设 maxLength**（实测 `maxLength` 为 -1）；由 `min-height` + 内部滚动兜（scrollH 129 > clientH 114） |

### 3.4 生成模式（两选一卡片）
`grid-template-columns: 177px 177px`，`gap 10`。每卡 177×88，`padding 12`，`border-radius 10`：

| 模式 | 标题 | 描述 | 选中态实测 |
| --- | --- | --- | --- |
| AI 智能生成 | 14px `#1c1d1e` | 「根据商品特点和卖点，自动设计图文内容和排版。」12px `#929499` | `bg #f1f8ff`，`border 1px solid #3388ff` |
| 模板生成 | 14px `#1c1d1e` | 「参考模板生成，从右侧选择一个模板。」12px `#929499` | `bg #fff`，`border 1px solid rgba(0,0,0,.08)` |

- 默认选中 **AI 智能生成**（`aria-pressed=true`）。
- 切到「模板生成」后 `aria-pressed` 互换，**右栏模板网格保持可见**（实测切回 AI 后 `showcaseDisplay: flex`，49 张卡仍全部可见）—— 参考站右栏**始终是模板区**，模式只影响生成策略。

### 3.5 附加功能
| 节点 | 实测 |
| --- | --- |
| 标题 | 「附加功能」15px `#1c1d1f` |
| 行 | 高 36，`gap 12`，左文字 14px `#616366`「社媒帖子发布文案」，右侧开关 28×16 |
| 默认 | **开**（Switch checked，底 `#5c6066`） |

## 4. 底部数量步进器与主按钮

实测 DOM：`<button aria-label="减少张数" disabled>−</button><output aria-live="polite">6</output><button aria-label="增加张数">+</button>`

| 项 | 实测 |
| --- | --- |
| 默认值 | **6** |
| 减号 | 默认 disabled（到下界） |
| 加号 | 连续点击至 **10** 后 disabled |
| **取值范围** | **6 – 10**（步进器下界不可破；实测序列 6→7→8→9→10，`−` 在 6 时 disabled） |
| 步进按钮 | 24×24 |

主按钮：
| 项 | 实测 |
| --- | --- |
| 文案 | 「生成带货图文」+ 右侧「90」（参考站以「美豆」计价，**本站不沿用**） |
| 尺寸 | 367×46，`x=24`，`y=834` |
| 禁用态 | **表单为空时按钮不禁用**（`disabled: false`），点击后 toast「请先上传至少一张图片。」 |
| 背景 | `#1c1d1f` 圆角（未选中文字为白） |

> 参考站的「积分/美豆」与本站积分体系不一致：**本站不显示「90」，改显示 `useCreditLabel` 的「本次消耗 N 积分」**，且按实际张数算总价（与 `ProductKitPage` 的 `creditLabel` 口径一致）。

## 5. 右栏分类 tab

| 项 | 实测 |
| --- | --- |
| 容器 | `nav.social-media-recipeCategories`，`column-gap 20`，`flex-wrap: wrap`，`margin-top 10` |
| tab 高度 | 44，`padding 6px 0 18px` |
| 选中态 | 「全部模板」`class=social-media-categoryActive`，文字 `#1c1d1e`；未选 `#616266` |
| **完整清单（11 项，含首项）** | 全部模板 / 男装/女装/运动服饰 / 鞋包/配饰 / 运动器械/户外装备 / 家具/家装 / 日用/家纺 / 五金/工具/汽摩 / 3C数码/家电 / 美妆/个护 / 健康/保健 / 玩具/盲盒 |
| 换行 | 10 项在第一行（1440 下 `玩具/盲盒` 折到第二行 @y=120） |

> 本站模板分类与参考站一致 —— 已在 `backend/src/capabilities/definitions/shoppable-carousel.templates.ts` 落库为 `SHOPPABLE_CAROUSEL_CATEGORIES`（10 个业务分类）+ 页面级「全部模板」。

## 6. 模板卡结构（实测）

```
article.social-media-card-W4j04q      307×193   padding 7px 7px 9px   bg #fff   radius 16   border 1px rgba(0,0,0,.08)
├─ div.social-media-gallery            291×127   gap 4   bg #f5f7f9   radius 10   overflow hidden
│  ├─ div.social-media-imageSlot        94×127   （×3）
│  │  └─ img                            ——  竖图，object-fit 裁切
│  └─ ...
├─ div.social-media-cardContent        291×48
│  └─ span.social-media-details         291×39
│     ├─ span.social-media-title        「沉浸开箱试穿」14px
│     └─ span.social-media-description   「开箱静物 → 多场景上身 → 细节收尾」12px，title 属性同文
├─ button.social-media-selectButton     305×191   覆盖整卡的透明按钮（absolute）
├─ button.social-media-useButton        50×30     「选用」bg #1c1d1f  白字  radius 8  —— 默认 opacity 0
└─ button.social-media-previewButton    28×28     眼睛图标 bg #f3f5f7  radius 6  —— 默认 opacity 0
```

交互态实测：

| 态 | 边框 | 阴影 | 备注 |
| --- | --- | --- | --- |
| 默认 | `1px solid rgba(0,0,0,.08)` | none | 「选用」「预览」按钮 opacity 0（hover 才显） |
| hover | `1px solid #cfd1d6` | none | 卡片边框加深 |
| 选中 | `1px solid #1c1d1e` | `inset 0 0 0 .5px #1c1d1e` | class 加 `social-media-selected` |

- 选中后「选用」按钮文案**仍是「选用」**（不变成「已选用」），模式自动切到「模板生成」（实测 `aria-pressed` 由 `[false,true]` 变为 `[true,false]` 后再变回）。

## 7. 顶栏与历史记录

| 项 | 实测 |
| --- | --- |
| 顶栏内容 | `带货图文`（副标题）+「新建任务」按钮 +「1.1元开通会员」入口 |
| 「新建任务」按钮 | 102×32 @227,11，带 `+` 图标 |
| **历史记录区** | **参考站该页无历史记录区**。全页扫描「历史」文本节点命中 0 条；「新建任务」点击后无弹层、无路由变化（URL 不变，`overlays: []`） |
| 历史记录 | 参考站无 |

> **主动偏离**：参考站顶栏「新建任务」无可见行为，也没有历史记录区。本站落地为：顶栏「新建任务」= 清空当前表单回到空态；历史记录放在右栏「创作结果」页签（真实数据来自 `GET /tasks`，按批次聚合）。

## 8. 五态实测口径

| 态 | 参考站表现 | 本站落地 |
| --- | --- | --- |
| 首次空态 | 左栏空表单 + 右栏 49 张模板卡；无结果区 | 左栏空表单 + 「创作灵感」模板网格；「创作结果」页签空态文案 |
| 生成中 | 按钮 loading（未截图取证） | `useResultGallery` 占位卡（`.pk-result-generating`） |
| 有结果 | 参考站**无结果展示区**（右栏恒为模板区） | 切到「创作结果」页签显示生成结果 |
| 失败 | 未取证（需真实账号 + 扣费） | `useGenerateError` 如实报错，`40005` / `42204` 原样呈现 |
| 未登录 / 通道不可用 | 参考站不校验登录（空表单也点得动） | 本站：未登录点提交走登录弹窗；能力 `runtime.effective !== 'remote'` 时按钮禁用并给原因 |

## 9. 与本站设计令牌的映射

参考站品牌色（`#3388ff` 蓝系、`#1c1d1f` 近黑、`#f6f7fa` 灰底）**一律不沿用**。映射到 `frontend/src/styles/tokens.css` 的 `:root`：

| 参考站实测 | 本站令牌 | 值 | 说明 |
| --- | --- | --- | --- |
| 选中蓝 `#3388ff` / `#f1f8ff` | `--brand` / `--brand-bg` | `#5546d8` / `#f1efff` | 品牌紫唯一主色 |
| 强调文字 `#1c1d1f` / `#1c1d1e` | `--text-strong` | `#171a2b` | 标题 |
| 描述 `#929499` / `#8d919b` | `--text-muted` / `--text-desc` | `#667085` | 小字（对比度达标） |
| 次要文字 `#616366` / `#616266` | `--text-muted` | `#667085` | — |
| 正文 `#374151` | `--text-body` | `#4e5969` | — |
| 卡片白 `#fff` | `--card-bg` | `#ffffff` | — |
| 页面灰底 `#f6f7fa` | `--page-bg` | `#f6f7fb` | — |
| 网格底 `#f5f7f9` | `--surface-soft` | `#f7f8fa` | 缩略图沟槽底 |
| 边框 `rgba(0,0,0,.08)` | `--border` | `#e5e7ef` | 卡片描边 |
| hover 边 `#cfd1d6` | `--border-hover` | `#c9cddb` | — |
| 虚线上传框 `#eaedf2` | `--border` | `#e5e7ef` | — |
| 圆角 16（卡）/ 12（框）/ 10 / 8（控件）/ 胶囊 | `--radius-panel` / `--radius-card` / `--radius-control` / `--radius-pill` | 16 / 12 / 8 / 999 | 五档圆角制 |
| 输入底 `rgba(0,30,89,.04)` | `--surface-soft` | `#f7f8fa` | — |
| 文本域底 `#f9fafb` | `--surface-soft` | `#f7f8fa` | — |
| 步骤按钮 24×24 | `--radius-control` | 8px | — |
| 主按钮底 `#1c1d1f` | `--brand`（渐变按钮制） | `#5546d8` | 本站主按钮为品牌紫渐变，沿用 `pk-primary-btn` 口径 |
| 「美豆 90」计价 | `useCreditLabel` → 「本次消耗 N 积分」 | — | 不沿用参考站计价单位 |

字号：参考站最小 12px，与本站「最小 12px」硬规范一致。

## 10. 已知缺口

1. 参考站「生成中」「失败」两态未取证 —— 需要真实登录账号 + 可用模型通道 + 真实扣费。本站这两态由既有 `useResultGallery` / `useGenerateError` 链路覆盖，行为由本站后端决定，不照搬参考站。
2. 参考站「AI 帮写」按钮的填充行为未取证（需登录触发文本通道）。本站接入既有 `promptToolsApi.polish`（真实文本通道），失败如实报错、不拼接模板文案。
3. 参考站模板缩略图的**懒加载策略**未取证 —— 49 张卡一次性渲染在视口内，无 `IntersectionObserver` 证据。本站按「先渲染首屏 + `loading="lazy"`」实现。

---

## 11. 实现状态与已知差异

### 12.1 当前页面结构

- 左栏配置栏（416px）：上传、生成设置、商品卖点、生成模式、附加功能；底栏固定「张数 + 高级设置 + 生成」单行。
- 右栏「创作灵感 / 创作结果」两个页签（复用 `OutputTabsPane`）：灵感页 = 分类 tab + 模板网格；结果页 = 完整批次列表（`ShoppableCarouselResultList`，含删除 / 下载 / 大图）。
- 模板网格 `minmax(250px, 1fr)`：1440 → 3 列，1920 → 4 列。

### 12.2 与参考站的结构差异（由站点外壳决定）

| 项 | 参考站 | 本站 | 原因 |
| --- | --- | --- | --- |
| 左栏起始 x | 0 | 176 | C 端左侧能力轨占 176px |
| 右栏宽 | 1024 / 1504 | 848 / 1328 | 同上（1440 与 1920 两档） |
| 模板卡宽 | 307 / 347 | 256 / 308 | 同上（列数已对齐为 3 / 4） |
| 顶部 | logo + 标题 + 新建任务 | 站点导航 + 页内 54px 头 | 本站是全站外壳 |
| 品牌色 | 近黑选中态 | 品牌紫选中态 | 全站令牌统一 |
| 默认投放口径 | TikTok / 美国 / 英文 | 抖音 / 中国 / 中文 | 面向国内电商团队 |
| 主按钮 | 367×46，空表单可点 | 自适应宽×40，表单不完整即置灰 | 沿用本站工具页族按钮与校验口径 |

### 12.3 计费与五态

- 一次提交 N 张 → N 个独立任务、各一张账单、各扣一份积分；失败按张退款，不连坐。
- 五态：空态给左栏空表单 + 模板网格；生成中给占位卡与按钮禁用；有结果按批次一行；失败在扣费前返回 `40001` / `40005`，无线路 `42204`，余额不变。

### 12.4 新增独立工作台页的必做两步

路由（`App.tsx`）与入口映射（`frontend/src/lib/capabilities.ts` 的 `toolPath`）缺一不可。只加路由不加映射，页面存在但侧栏、顶栏、工作台卡片与首页案例都会落到 `/tools/<id>` 通用工具页。
