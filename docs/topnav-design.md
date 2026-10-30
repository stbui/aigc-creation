# 顶部导航规格（应用外壳）

全站统一的顶部外壳：品牌区、分组导航（按能力分组自动派生）、用户动作区。落地页与壳内页共用同一套视觉口径。

| 项 | 值 |
| --- | --- |
| 组件 | `frontend/src/components/AppLayout.tsx` |
| 样式 | `frontend/src/styles/global.css` 的 `.app-header` / `.app-topnav*` 区块 |
| 数据 | `GET /capabilities` 的分组与能力名派生导航下拉 |
| 高度契约 | `--workspace-topbar-height: calc(64px + var(--promo-topbar-height))` |

## 1. 外壳结构

```
PromoBar  40px（≤900px 隐藏，并置 html[data-promo='off']）
AppHeader 64px（≤900px 54px）sticky top:0 z-index 20
├── .app-brand          36×36 标记 + 「货觉」+ 紫色 AI 后缀
├── .app-topnav         flex:1，8 个导航项
└── .app-header-right   消息铃铛 / 算力胶囊 / 用户菜单｜游客「登录 / 注册」
```

`--workspace-topbar-height` 是跨组件契约：侧栏的 `top`/`height`、多图融合页与 pk 工作区的 `calc` 都读它。促销条显隐必须同步更新这个变量（由 `html[data-promo]` 驱动），只写 `display:none` 会让依赖它的页面高度算错 40px。

## 2. 规格

### 2.1 Header

| 属性 | 值 |
| --- | --- |
| 高度 | 64px（≤900px 54px） |
| 定位 | `sticky; top: 0; z-index: 20` |
| 背景 | `var(--color-card)` |
| 下边框 | `1px solid var(--color-border-soft)`（`#f2f3f5`） |
| 内边距 | `0 24px` |
| 布局 | flex，gap 24，`align-items: center` |
| 行高 | `normal` |

`line-height: normal` 是必需的：antd `<Header>` 默认 `line-height: 64px`，会被 `.app-quota` / 用户菜单继承，把行盒撑到 64px 再加 padding 即 72px，上下各溢出 4px。

### 2.2 品牌区

| 元素 | 值 |
| --- | --- |
| 容器 | `.app-brand`，flex gap 10，`flex-shrink: 0`，指向 `/workbench` |
| 标记 | `.app-brand-mark` 36×36，radius 8，SVG 自带渐变容器（不再铺底色） |
| 主名 | 「货觉」16px / 700 / `#171a2b` |
| 后缀 | `.app-brand-ai`「AI」，品牌紫，700 |

### 2.3 导航

8 个导航项，顺序：首页 → 电商生图▾ → AI修图▾ → AI视频▾ → 我的作品 → 购买套餐 → 邀请有奖 → 联系客服。

| 类型 | 目标 | 说明 |
| --- | --- | --- |
| 首页 | `/` | 直链 |
| 三个分组下拉 | 各能力工具页 | 分组来自后端注册表（`ecommerce_gen` / `ai_retouch` / `ai_video`），**有几组渲染几组**，不写死数量 |
| 我的作品 | `/works` | 直链 |
| 购买套餐 | `/packages` | 直链 |
| 邀请有奖 | `/invitations` | 直链 |
| 联系客服 | `/tickets?type=consultation&compose=1` | 直链，进站内工单并预选「咨询」类型 |

数据中心**不进顶导**：侧栏已有唯一入口（`SideRail.tsx`「数据中心」分组），顶导再放一份是重复入口。新增顶导项前先确认容量 —— 8 项在 901–1100 档已接近饱和。

### 2.4 导航项样式

| 属性 | 值 |
| --- | --- |
| 文字 | 13px / 700 / `#667085` |
| 高度 | 32px，`padding: 0 14px` |
| 圆角 | `var(--radius-control)`（8） |
| 间距 | `.app-topnav` gap 10 |
| hover | `#5546d8` 文字 on `#f1efff` 底 |
| 换行 | `white-space: nowrap`，`flex: none` |

窄档不换行：64px 定高顶栏一旦换行就破版，靠「右侧减重」腾宽度 —— ≤1199 隐藏 `.app-user-email`，≤1099 隐藏 `.app-quota` 与 `.app-header-divider`。

### 2.5 分组下拉

| 元素 | 值 |
| --- | --- |
| 容器 | `.app-topnav-dropdown .ant-dropdown-menu`，`min-width: 137px`，`padding: 10px 8px`，radius 12，`border: 1px solid #e5e7f0`，`box-shadow: 0 18px 42px rgba(31,41,55,.14)` |
| 条目 | 高 36，radius 9，`padding: 0 12px`；图标 20×20 |
| 文字 | 13px / 600 / `#475467` |
| 条目 hover | 底 `#f2efff`，字 `#5b4df5` |
| 触发器 | 与导航项同规格，右侧 `ChevronDown` 14px |
| 禁用项 | `mode === 'planned'` 的能力置灰不可点 |

条目内容：能力图标 + 能力名（+ 规划中标签）。点击导航到 `toolPath(id)`。

**覆写特异性**：antd cssinjs 注入顺序不可控，下拉覆写必须高于 `.ant-dropdown .ant-dropdown-menu-item`（0,2,0），写成 `.app-topnav-dropdown .ant-dropdown-menu .ant-dropdown-menu-item`（0,3,0）。少写一层会被 antd 反压，只剩 hover 因为多了 `:not()` 侥幸生效。

### 2.6 用户动作区

| 状态 | 内容 |
| --- | --- |
| 已登录 | 消息铃铛 + `.app-quota` 算力胶囊（指向 `/credits`）+ 1px 分割线 + 用户菜单（头像 / 邮箱、账户设置、我的工单、进入运营后台、退出登录） |
| 游客 | `.app-guest-login`：68×32，`padding: 8px`，radius 6，13px / 700 / `#667085`，**纯文字无底**；hover `#5546d8` on `#f1efff` |

游客按钮不得用 antd 实底主按钮：外壳里唯一的实底主色留给页面内的提交动作。

已登录动作区统一为 32px 控件带，间距 8（2026-10-30 收拢）：

| 元素 | 值 |
| --- | --- |
| 铃铛 | `.app-notif-trigger` 32×32，radius 8；icon 18；未读角标 16×16 / 10px / 600 / 2px 白描边 |
| 算力胶囊 | `.app-quota` 高 32，`padding: 0 12px`，白底 + `1px solid var(--border)`，radius pill；图标 14 `--text-desc`；数字 13 / 700 `--text-strong` + tabular-nums；「积分」12 / `--text-muted`；hover 字色与描边转 `--brand`、底 `--brand-bg` |
| 分割线 | `.app-header-divider` 1×16 `var(--border)`，仅出现在算力胶囊与用户菜单之间 |
| 用户菜单 | `.app-user` 高 32，`padding: 0 8px 0 4px`，radius 8；头像 28；邮箱 13 `--text-body`，`max-width: 168px` 超长省略；右侧 `ChevronDown` 14 `--text-desc`，展开旋转 180°；hover / 展开底 `#f1efff` |

右侧只保留一处「有量」的信息（余额），其余控件默认中性，强调色只出现在交互态。

## 3. 移动端

| 视口 | 行为 |
| --- | --- |
| > 900 | 完整桌面顶栏 |
| ≤ 900 | 顶栏 54px，`padding: 0 14px`；`.app-topnav`、`.app-quota`、`.app-header-divider`、`.app-user-email`、`.app-sider-wrap` 全部 `display:none`；右侧只留消息铃铛、头像（含展开箭头）与 `.app-mobile-toggle` 汉堡（36×36，icon 20，radius 8） |

汉堡点击打开 antd `Drawer` 承载完整的 `SideRail`；抽屉内恢复 280px 宽横排菜单，点菜单即导航并关闭抽屉。

**汉堡必须是 header 直系子元素**：放进任何会在移动断点被 `display:none` 的容器里，按钮即使自身 `display:inline-flex` 也不可点击。

移动端品牌不显示 AI 后缀，只留标记与主名。

## 4. 实现约束

1. 导航项数量由能力分组派生，新增分组自动进下拉；不要在组件里写死组数或组名。
2. 下拉皮肤全部写在 `global.css`，组件只给 `classNames.root`；不要在 JSX 里塞内联样式。
3. 顶部高度只通过 `--workspace-topbar-height` 传递，页面里不要另外 `calc(100vh - 64px)`。
4. `html[data-promo]` 与 PromoBar 的显隐必须由同一处 `matchMedia` 逻辑驱动。

## 5. 验证

| 用例 | 覆盖 |
| --- | --- |
| `frontend/tests/sidebar.spec.ts` | 顶栏/侧栏几何、断点、抽屉 |
| `frontend/tests/workspace-pages.spec.ts` | 游客态导航与登录墙 |
| `frontend/tests/product-capabilities.spec.ts` | 分组下拉的能力入口与上下文 |
