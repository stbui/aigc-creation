# 工作台页面规格（`/workbench`）

工作台是登录后默认落地页：把 12 项电商生图 / 修图能力组织成一条创作流，下方接账号、最近任务与创作数据三块面板。

| 项 | 值 |
| --- | --- |
| 路由 | `/workbench`（壳内页） |
| 页面组件 | `frontend/src/pages/WorkbenchPage.tsx` |
| 样式 | `frontend/src/styles/global.css` 的 `.workbench` / `.wb-*` 区块 |
| 数据来源 | `GET /capabilities`（卡片布局与角标）+ `GET /stats/overview`（登录后） |
| 外壳 | `components/AppLayout.tsx` + `components/SideRail.tsx` |

## 1. 页面结构

```
MainLayout（壳）
├── PromoBar          40px，≤900px 隐藏
├── AppHeader         64px（移动 ≤900px 为 54px）
├── SideRail          176px｜100px 轨（≤1366）｜隐藏 + 抽屉（≤900）
└── 主内容（window 滚动）
    └── .workbench-content
        ├── .wb-workflow-banner   hero
        ├── .wb-tool-grid         12 张能力卡
        └── .wb-data-layout       2:1 双面板 + 通栏数据面板
```

主区滚动方式是 **window 滚动**（不是容器内部滚动）。这影响骨架屏、滚动监听与移动端 Safari 的地址栏收放行为。

## 2. Hero

| 属性 | 值 |
| --- | --- |
| 容器 | `.wb-workflow-banner`，高 212，radius 16，`margin-bottom: 16` |
| 背景 | `#dcecff` + `url('/workbench/bannerbg.png')` `50% / cover no-repeat` |
| 内边距 | `0 100px` |
| 标题 | 「把电商运营，组织成一条工作流」32px / 500 / `#000` / 行高 20 |
| 副标题 | 17px / 400 / `#667085` / 行高 31 / `margin-top: 24` |

Hero 右半幅是本站自有的能力产出拼贴，不做外链图片。素材为空时回退内置 SVG，不请求第三方资源。

## 3. 工具网格

卡片**不由前端写死**：`WorkbenchPage` 用 `workbenchIds`（`lib/capabilities.ts`）从能力清单里挑出 12 项并按数组顺序渲染，标题、角标、描述、缩略图、免费标记都来自注册表。新增或下架能力不需要改这张页面。

### 3.1 网格与断点

| 视口 | 列数 | gap |
| --- | --- | --- |
| > 1100 | 6 | 16 |
| ≤ 1100 | 4 | 16 |
| ≤ 760 | 3 | 16 |
| ≤ 520 | 2 | 8 |

列数由 `global.css` 的 `.wb-tools` 单一规则组统一管辖（1100 / 760 / 520 三档）。同一文件后段的「工作台覆盖层」**不得重复声明 `grid-template-columns`** —— 覆盖层只覆盖值，不重复结构属性，否则会把前面的断点静默压死。

### 3.2 卡片规格

| 元素 | 值 |
| --- | --- |
| 卡片 | `.wb-tool-card`，白底，radius 16，`position: relative`，`align-items: stretch`，`min-width: 0` |
| 缩略图 | `.wb-tool-visual`，2:1，占位底 `#c9c9c9`；hover 时 `scale(1.06)` |
| 图标块 | `.wb-tool-icon` 40×40，白底 radius 8，`box-shadow: 0 2px 6px #6b728040`，**绝对定位跨界**在缩略图与文字区的分界线上（left 15 / bottom 88） |
| 文字区 | `.wb-tool-copy`，`padding: 40px 16px 24px`，固定高 108，`min-width: 0` |
| 标题 | 14px / 600 / `#171a2b` / 行高 16，flex row gap 6 |
| 免费角标 | `#fff` on `#f00024` |
| 描述 | 12px / `#86909c` / 行高 20 / `margin-top: 8`，单行省略 |
| hover | `box-shadow: 0 7px 20px #21234114`，**不上浮** |

缩略图取该能力最近一次真实产出；没有产出时展示空态插画，不伪造示例图。

### 3.3 卡片顺序（12 项）

商品主图 / 商品详情图 / 爆款复刻 / 创意生图 / 局部重绘 / 智能扩图 / 一键抠图（免费）/ 去除水印（免费）/ 图片翻译 / 产品精修 / 商品换色 / 旋转角度。

顺序即 `workbenchIds` 数组顺序，E2E 用 `workspace-pages.spec.ts` 固定。

## 4. 数据区

### 4.1 布局

| 区块 | 规格 |
| --- | --- |
| `.wb-data-layout` | grid `minmax(0, 2fr) minmax(300px, 1fr)`，gap 16，`margin: 16px 0` |
| `.wb-panel.wb-account` | 左栏，radius **12**，`padding: 24` |
| `.wb-panel.wb-recent` | 右栏，radius **16**，`padding: 24` |
| `.wb-panel.wb-dashboard` | 通栏，radius 12，`padding: 24` |

两个面板圆角不同是页面自身的既定规格，改动前先确认整页视觉基线，不要"顺手统一"成同一个值。

### 4.2 游客态

三块面板统一渲染 `.wb-login-prompt`：文案「登录后查看可用积分和创作消费」+ CTA「登录查看」（16px / 400 白字 on `#6254ED`，radius 6，`padding: 8px 16px`，高 39）。

游客态**不请求** `/stats/overview`，避免 401 噪音与无谓的空转；E2E 断言这一条。

### 4.3 登录态

| 面板 | 内容 |
| --- | --- |
| 账号 | `.wb-account-metrics` 三块（`1fr / 1fr / 1.35fr`）+ 积分流水表 `.wb-flow-*`（按能力分组） |
| 最近任务 | `.wb-jobs-list`：缩略图 + 标题 + 状态标签（`completed` / `failed` / `processing`），空态「还没有生成记录，去工作台创建第一条」 |
| 创作数据 | `.wb-dashboard-stats` 六格 + `.wb-trend-chart` 近 7 天产出柱图 |

面板高度随真实数据撑开，不设固定 `min-height`；移动端（`padding: 16`）由媒体查询覆盖，避免残留桌面 268 高度。

## 5. 新客营销弹窗

`frontend/src/components/GuestPromoDialog.tsx`，仅游客首访渲染，关闭后写 `localStorage` 键 `ecom-guest-promo-dismissed-v1`；登录用户不渲染。

- 尺寸 500×427 居中对话框，遮罩 + 1.2s 首访延迟 + 入场动画。
- 权益文案为本站事实：一键抠图免费 / 一键去水印免费 / 作品云端保存 / 素材统一管理。注册不发积分，因此不出现「100 积分」「50 次」这类未兑现的权益。
- 无进行中的活动时显示静态文案，CTA 落到 `/background-remove`；有活动时取 `GET /marketing/popup` 的标题、CTA 与有效期，倒计时按服务端时间计算。

## 6. 侧栏与菜单信息架构

侧栏由 `components/SideRail.tsx` 渲染，菜单分组与顺序的唯一事实源在组件内。默认全部展开：

1. **根区域**：工作台、我的作品
2. **AI视频**：自由创作、图生视频
3. **电商生图**：商品主图、商品详情、爆款复刻、创意生图、多图融合、商品SKU图
4. **AI修图**：局部重绘、一键抠图、去除水印、产品精修、图片翻译、智能扩图、商品换色、旋转角度
5. **数据中心**：数据看板、素材库
6. **底部**：产品建议、联系客服

### 6.1 双态几何

| 元素 | ≥1367（176px 横排） | ≤1366（100px 竖轨） |
| --- | --- | --- |
| 侧栏 | 176px，`padding: 16px 12px 24px` | 100px，`padding: 8px 8px 20px` |
| sections | 139px，gap 16，`padding-top: 8` | 83px，gap 14，`padding-top: 6` |
| 列表 | 133px，gap 4，`padding-top: 4` | 77px，gap 4 |
| 条目 | 133×45，flex row，`padding: 8px 4px`，gap 12 | 77×60，flex column，`padding: 5px 2px`，gap 2 |
| 标签 | 13px / 行高 20 | 10px / 行高 14 |
| 分组标题 | 133×28，14px / 行高 20 | 77×24，12px / 行高 18 |
| 底部入口 | 139×44 | 83×60 |

- 条目 radius 8；active 为 `#f1efff` 底 + `#5546d8` 字，hover 为 `#f7f6ff`。
- 分组标题右侧 14px `ChevronUp`，收起后旋转 180°，`aria-expanded` 与 `aria-controls` 同步。桌面侧栏与移动抽屉同时挂载时，面板 id 用 React `useId()` 加前缀，避免重复 DOM id。
- 菜单图标是 `frontend/public/menu/*.svg`，运行时只请求同源 `/menu/*`。默认 `grayscale + opacity(.62)`，active / hover 用品牌紫 filter。
- 分组标题与底部入口没有额外的折叠按钮。

### 6.2 Hover 预览

`.rail-preview`：376px 宽，`padding: 14px 16px 16px`，gap 12，radius 16，渐变 `linear-gradient(110deg, #fff 0% 38%, #eeedff 100%)`，阴影 `0 10px 24px #23274a29`，左侧 12px 三角箭头，图片 344×172 / radius 10 / cover。右侧空间不足时翻到左侧，箭头同步换向。

图片优先取用户该能力最近一次真实产出；无产出时用内置演示图。

### 6.3 底部入口

- 「产品建议」→ `/tickets?type=other&compose=1&subject=产品建议`，工单页读取 `subject` 预填标题并清除 URL 参数。
- 「联系客服」→ `/tickets?type=consultation&compose=1`，预选「咨询」类型。

`.app-sider-wrap` 的 `top` / `height` 必须跟随 `var(--workspace-topbar-height)`：促销条开启时顶栏实际 104px，写死 64px 会让侧栏底部超出视口 40px，客服入口不可见。

## 7. 响应式

| 视口 | 外壳 | 页面 |
| --- | --- | --- |
| ≥1367 | 侧栏 176px 横排 | 6 列卡片，全宽内容区 |
| 1367–1101 | 侧栏 100px 竖轨 | 6 列 |
| ≤1366 | 侧栏 100px 竖轨，`.app-content` 负 16px 补偿 | 6 列 |
| ≤1100 | 同左 | 4 列 |
| ≤900 | 侧栏 `display:none` + 54px 顶栏 + 汉堡按钮；PromoBar 隐藏并置 `html[data-promo='off']` | 抽屉内 280px 宽完整横排菜单 |
| ≤760 | 同左 | 3 列 |
| ≤520 | 同左 | 2 列，gap 8 |

移动端抽屉用 antd `Drawer` 承载同一个 `SideRail`，点菜单即导航并关闭抽屉；抽屉里恢复横排菜单，不继承 77×60 竖轨。

## 8. 实现约束（改动前必读）

1. **响应式宽度必须 CSS 托管**。侧栏宽度历史上由 JSX inline `style` 注入，inline 会压过所有 `@media`，任何塌缩规则都失效。宽度类响应式只能写进样式表。
2. **`@media` 不增特异性**。媒体查询里的规则与外层静态规则冲突时按源顺序决胜，所以 `.workbench { max-width: none }` 会被文件后方的静态声明反压。移动栅格规则必须排在全部 base 规则之后。
3. **「覆盖层」只覆盖 token 值**。置于区块之后、用于锁定设计值的静态规则，如果重述 `grid-template-columns` 等结构属性，会把同区块前面的断点全部压死。
4. **`html[data-promo]` 是跨组件契约**。隐藏促销条必须同时置 `data-promo='off'`，只写 `display:none` 会让依赖 `--workspace-topbar-height` 计算的页面高度算错 40px。
5. **`<button>` 的 UA 默认样式**。工具卡是 `<button>` + `display:flex; flex-direction:column`，浏览器 UA 给 `button` 设了 `align-items: center`，会让子项不 stretch、按 min-content 定宽、冲出栅格轨并让省略号失效。改用显式 `align-items: stretch` + `min-width: 0`，grid item 同理。
6. **「零溢出」扫描要先等真实内容**。`networkidle` 不等于渲染完成；先 `waitForSelector` 并断言元素数 > 0，再扫 `scrollWidth`。
7. **多视口验证用单 context**。反复登录会撞登录限流（IP 维度），切视口请用 `setViewportSize` 而不是新建 context。

## 9. 验证

| 用例 | 覆盖 |
| --- | --- |
| `frontend/tests/workspace-pages.spec.ts` | 12 卡顺序、游客不请求 `/stats/overview`、首卡进入 `/product-kit`、登录态六格看板、390 两列且无横向溢出 |
| `frontend/tests/sidebar.spec.ts` | 1440 几何与顺序、1280 竖轨、1366/1367 断点、折叠与唯一面板 id、真实工单预填、390 抽屉与无溢出 |
| `frontend/tests/state-contract.spec.ts` | 加载 / 空 / 失败三态 |
