# 顶部导航（Top Navigation）设计规格与实拍审计

> 抓取人：小帮｜抓取日期：2026-10-19｜对象：参考站工作台顶导（ijihua.cn 全站统一外壳）vs 本地 `AppLayout` 顶导
> 抓取方式：Playwright（chromium，`--no-proxy-server` 直连）；参考站 guest 态 + 本地登录态实测
> 本地实现现状：`frontend/src/components/AppLayout.tsx`（Header 段）+ `frontend/src/styles/global.css` §应用骨架（533–671 行）
> 本文件是**设计规格 + 差距审计**，不含代码改动。改动按「裁定在前 → 出偏差清单 → 获批 → 改码」纪律执行。
> 视觉证据：`docs/topnav-ref/`（参考站下拉展开态 / 移动态 / 本地桌面 / 本地移动，4 张）

---

## 0. 结论摘要（先看这个）

| # | 发现 | 优先级 | 一句话结论 |
|---|---|---|---|
| 1 | **AI视频▾ 下拉缺失** | **P1** | 参考站顶导有第三个分组下拉（AI视频▾，含 NEW 角标）；本地 `groups.slice(0,2)` 砍掉了它，且 `AppLayout.tsx:37-41` 的注释「参考站只有两项」已被实拍推翻（后端 registry 本就下发了 3 组） |
| 2 | **购买套餐 / 邀请有奖 / 联系客服 三个导航项缺失** | **P1** | 参考站顶导共 8 项，本地只有 5 项；`/packages`、`/invitations` 路由本地已存在却无顶导入口 |
| 3 | **数据中心 是本地自有 IA** | **P1** | 参考站数据中心在侧栏分组，不进顶导；本地同时放顶导 + 侧栏（重复入口），需裁定去留 |
| 4 | 下拉菜单规格不符（antd 默认 vs 参考站定制） | P2 | 菜单 radius 10 vs 12、无描边、阴影/条目高度/字重/hover 色/宽度（122 vs 137）全不一致 |
| 5 | 顶栏微规格偏差 | P2 | header padding 0 20 vs 0 24（品牌 x=20 vs 24）、基准字号 14 vs 16、guest「登录/注册」是 antd 实底主按钮 vs 参考站纯文字钮 |
| 6 | 营销/增长元素缺失 | P2（产品决策） | 「新人免费生图10张」红丸 CTA、「签到得积分」紫丸、live 人数轮播 badge——本地无积分/签到体系，属诚实差异，仅登记 |
| 7 | 核心规格逐值一致 | ✅ | 64px 头高/y=40/白底/粘性、品牌块 36×36、导航项 13px/700 #667085·radius 8·pad 0 14·h 32、hover #5546d8 on #f1efff、移动端 54px·pad 0 14 |

**总体判定**：本地顶导的**样式基座复刻准确**（导航项规格与 hover 逐值相同）；差距在**信息架构**（少 3 个导航项 + 1 个分组下拉 + 1 个自有入口）与**下拉菜单定制深度**（直接用 antd 默认皮肤）。

---

## 1. 证据基线与置信度声明

| 项 | 值 |
|---|---|
| 参考站顶导 | 全站统一外壳（landing/workspace 同构），guest 态完整可测，无登录墙 |
| 实测状态 | 默认态 / 导航项 hover / 下拉展开态 / 菜单条目 hover / 触发态 / 窄屏 1100·980·900 / 移动 390 |
| 本地实测 | 登录态 1280 + 390，含 antd 下拉展开测量 |
| 置信度 | 全部为**浏览器实时实测**（计算样式 + rect），无推断项 |
| 已知测量伪影 | ~~本地右侧 chip 一度量到 h=72（超出 64 头高）——HMR 刷新瞬间伪影，同刻截图证明视觉正常，已排除~~ **2026-10-19 推翻**：该 72px 是**真缺陷**——antd `<Header>` 默认 `line-height:64px` 被 `.app-quota`/`.app-user` 继承，行盒 64 + padding 8 = 72，上下各溢出 4px。已加 `.app-header{line-height:normal}`，实测回落至 25px / 34px。见 `docs/brand/brand-basics.md` §7.1 |

---

## 2. 参考站顶导解剖（1280×800，实测）

### 2.1 外壳

```
div#promo-topbar.promo-topbar   [1280x40 @0,0]   粉渐变促销条 (y=0..40)
header.landing-topbar           [1280x64 @0,40]  fixed, z 1000, 白底,
  ├─ grid: 266px │ 796px │ 170px, padding 0 24, align center
  └─ border-bottom: 1px #f2f3f5 (rgb 242,243,245)
```

顶导**粘在促销条下方**（y=40），三栏 grid：品牌 266 / 导航 796 / 动作 170。

### 2.2 品牌区（266px）

| 元素 | 实测 |
|---|---|
| `button#workspace-brand-home` | 266×38，pad 1 6，gap 10，透明底 |
| `.workspace-brand-logo` | img 36×36（`/logo.png`） |
| `.workspace-brand-copy` | 「极画」16px/700 #171A2B + `.workspace-brand-suffix`「· AI 电商图」同字号 |

### 2.3 导航区（796px，8 项，gap 8，pad 14 0）

| # | 项 | 宽 | 类型 |
|---|---|---|---|
| 1 | 首页 | 54 | 直链 |
| 2 | 电商生图▾ | 97 | 下拉（挂 live badge） |
| 3 | AI修图▾ | 84 | 下拉 |
| 4 | AI视频▾ | 84 | 下拉（挂 NEW 角标） |
| 5 | 我的作品 | 80 | 直链 |
| 6 | 购买套餐 | 80 | 直链 |
| 7 | 邀请有奖 | 80 | 直链（挂红色副标签「限时加赠500」） |
| 8 | 联系客服 | 80 | 直链 |

**导航项统一样式**：h 32，13px/700 #667085（102,112,133），radius 8，pad 0 14，透明底；**hover = #5546d8 on #f1efff**（实测）。

### 2.4 下拉菜单（展开态实测）

| 元素 | 实测 |
|---|---|
| `.workspace-nav-menu` | absolute，宽 137（内容定），白底，**radius 12**，**border 1px #e5e7f0**，**shadow `0 18px 42px rgba(31,41,55,.14)`**，pad 10 8，grid gap 2，z 120 |
| 菜单条目 | 119×36，radius 9，pad 0 12，gap 10；icon **20×20**（`/static/menu/*.svg`）；文字 13px/600 #475467（71,84,103） |
| 条目 hover | bg **#f2efff**（242,239,255），color **#5b4df5**（91,77,245） |
| 触发态（展开） | 同 hover：#5546d8 on #f1efff |

### 2.5 用户动作区（409px，gap 12，justify flex-end）

| 元素 | 实测 |
|---|---|
| `#workspace-nav-promo`「新人免费生图10张」 | 148×30，**bg #ffe3e3**，radius 16，pad 8 12 8 32；左 icon 24×34；文字 12px/400 **#ff0000** |
| `#workspace-checkin`「签到得积分」 | 112×32，bg #f1efff，radius 999，**border 1px #d8d2ff**，#5546d8，13px/700，pad 7 12，gap 5 |
| `#workspace-workbench`「工作台」 | 55×32，pad 8，radius 6，13px/700 #667085；当前页挂 `.active` |
| `#workspace-logout`「登录/注册」 | 68×32，pad 8，radius 6，13px/700 #667085，**纯文字无底** |

### 2.6 轮播 badge 与 NEW

- `.live-rotator-badge`（挂在电商生图触发钮上）：70×18，absolute，**渐变 270deg #f70017→#f76f00**，radius `10 10 10 2`，border 1px 白，10px/500 白字，条目轮播「电商都在用 / 广大卖家优选」。
- AI视频▾ 挂 NEW 角标（文本实测 "AI视频NEW"）。

### 2.7 窄屏与移动端

| 视口 | 顶导行为 |
|---|---|
| 1100 | grid 266\|616\|170，pad 0 24，全部 8 项一行 |
| 980 | grid 266\|504\|170，pad 0 20 |
| 900 | 导航壳缩至 432×**46**（条目换行/压缩），动作区缩至 170；**仍显示桌面顶导**（滚动按钮 28px 槽位在但 0×0 隐藏） |
| **390** | **54px**，grid 198\|154，pad 0 14，gap 10；品牌 82×34（logo + 极画，suffix 隐藏）；`.workspace-nav-shell` 与 `.landing-top-actions` 均 display:none；`.workspace-mobile-actions` 154×36 = 签到得积分丸（112×32）+ 汉堡（32×36，icon 26×26，radius 10） |

---

## 3. 本地实现对拍（登录态实测）

| 维度 | 参考站 | 本地实测 | 判定 |
|---|---|---|---|
| 头高/位置 | 64px，y=40，fixed | 64px，y=40，sticky | ✅ |
| 布局 | grid 266\|796\|170 | flex（topnav flex:1） | ⚠️ 等效，动作区不固定宽 |
| padding | 0 24 | 0 20（品牌 x=20 vs 24） | ❌ P2 差 4px |
| 基准字号 | 16px | 14px | ❌ P2 |
| 底边线 | 1px #f2f3f5 | 1px var(--color-border) | ⚠️ 需核对色值 |
| 品牌 | logo 36×36 + 极画 + suffix | mark 36×36（#5546d8 圆角块）+「电商视觉工坊」 | ✅ 尺寸同；产品名不同（有意）。**2026-10-19 更新**：已换货觉AI「觉眼」logo + 「货觉」+ 紫色 AI 后缀，见 `docs/brand/brand-basics.md` |
| 导航项数 | 8（3 下拉 + 5 直链） | 5（2 下拉 + 3 直链） | ❌ **P1** |
| 导航项规格 | 13/700 #667085 r8 pad 0 14 h32 | 逐值相同 | ✅ |
| 导航 hover | #5546d8 on #f1efff | 同（`global.css:587`） | ✅ |
| 下拉菜单 | radius 12 / 描边 #e5e7f0 /  shadow 0 18 42 rgba(31,41,55,.14) / pad 10 8 / 条目 36 r9 / 13-600 / icon 20 / hover #f2efff-#5b4df5 / 宽 137 | antd 默认：radius 10 / 无描边 / shadow 0 6 16 rgba(0,0,0,.08)+0 3 6 rgba(0,0,0,.12) / pad 4 / 条目 34 r6 / 14-400 #0f172a / icon 14 / antd hover / 宽 122 | ❌ **P2** |
| 动作区 | 新人红丸 + 签到紫丸 + 工作台 + 登录/注册（纯文字） | 算力丸（145px 紫灰丸）+ 用户（头像+邮箱）或 guest antd 主按钮；无工作台钮 | ❌ P2（红丸/签到/工作台缺失；guest 按钮样式不符） |
| 移动 390 | 54px，pad 0 14，gap 10；brand 82×34；签到丸 + 汉堡 32×36/icon 26/r10 | 54px，pad 0 14，gap 12；brand 142×34（全名）；头像 + 汉堡 36×36/icon 20/r8 | ✅ 骨架一致；⚠️ 右侧内容与汉堡尺寸有差（本地无签到功能，头像替代合理） |

---

## 4. 设计发现与修复建议（按优先级，均未动码，待裁定）

### P1-1 补 AI视频▾ 下拉（第三个分组）

**证据**：参考站顶导第 4 项为 AI视频▾（84px，挂 NEW 角标，菜单含「自由创作」）；后端 `capability.registry.ts:58-60` 本就下发 3 组（ecommerce_gen / ai_retouch / ai_video，顺序与参考站顶导一致）；本地 `AppLayout.tsx:41` `groups.slice(0, 2)` 恰好砍掉 ai_video，且 37-41 行注释「参考站顶导只有两项（README 页面结构表已登记）」**已被本次实拍推翻**（README 表为 10-17 旧快照，参考站现有第三项）。

**建议修法**：`groups.slice(0, 2)` → `groups.slice(0, 3)`（或直接渲染全部组），同步改写 37-41 行注释为本次实拍结论。新增第 4 组时同样自动生效。

### P1-2 补 3 个导航项：购买套餐 / 邀请有奖 / 联系客服

**证据**：参考站 8 项 vs 本地 5 项；`/packages`（PackagesPage）、`/invitations`（InvitationsPage）路由在 `App.tsx:307/316` 已存在却无顶导入口；`/invitations` 仅能在 sitemap 页找到。

**建议修法**：顶导追加三个直链项（规格复用现有 `.app-topnav-item`）：购买套餐 → `/packages`；邀请有奖 → `/invitations`；联系客服 → 本地无客服体系，**建议暂不加**或加一个诚实的「联系客服」占位（邮件/QQ），需产品裁定。参考站「邀请有奖」带红色副标签「限时加赠500」——本地无活动，不加副标签。

**连带注意**：8 项总宽 ≈ 700px，901–1100px 窄档会溢出。参考站在 900 档靠导航壳换行（h 46）消化；本地 `.app-topnav` 无 wrap 处理，补项时需一并加 `flex-wrap: wrap` 或中档隐藏策略（建议 wrap，与参考站同构）。

### P1-3 数据中心入口去留（本地自有 IA）

**证据**：参考站数据中心是**侧栏分组**（`#workspace-menu-section-toggle-data-center`），顶导无此项；本地顶导有「数据中心」且侧栏也有（SideRail.tsx:137-143）——同一页面两个入口。

**建议**：与参考站对齐 = 顶导移除数据中心（保留侧栏）；或保留双入口作为本地 IA 增强。倾向移除顶导项（参考站无，且补 P1-2 三项后顶导已满 8 项，无容量再放自有项）。

### P2-1 下拉菜单定制化（antd → 参考站规格）

现为 antd Dropdown 默认皮肤。建议以 `overlayClassName` + token 覆盖对齐参考站：菜单 radius 12、border 1px #e5e7f0、shadow `0 18px 42px rgba(31,41,55,.14)`、pad 10 8、条目 h 36 radius 9 pad 0 12、文字 13px/600 #475467、icon 20×20、hover bg #f2efff color #5b4df5。antd 6 可用 `Dropdown` 的 `styles`/`classNames` 或主题 token（`colorBgElevated`/`borderRadiusLG` 等）逐项覆盖。

### P2-2 顶栏微规格

- `.app-header` padding `0 20px` → `0 24px`（品牌 x 对齐参考站 24）
- 基准字号 14px → 16px（参考站 header 16px；导航项显式 13px 不受影响，但 Dropdown 触发器内的 antd 按钮字号继承会变，需复测）
- border-bottom 色值核对（目标 #f2f3f5）

### P2-3 guest「登录/注册」样式

参考站为纯文字钮（13px/700 #667085，pad 8，radius 6）；本地是 antd `type="primary"` 实底主按钮。建议改文字钮或 `type="text"` + 定制色，与参考站一致。

### P2-4 营销/增长元素（诚实差异，仅登记）

新人免费生图10张红丸（#ffe3e3 / #ff0000 / radius 16 / 左 icon 24×34）、签到得积分紫丸、live 轮播 badge（红橙渐变 / 10px / 轮播两条文案）——本地无积分与签到体系，不做。若将来做增长功能，规格已在此存档。

### P2-5 顶导「工作台」当前页钮

参考站动作区有「工作台」直链（当前页 `.active`）；本地靠品牌区回工作台。补 P1-2 三项后如动作区仍有容量可加，否则登记为差异。

---

## 5. 待裁定项清单 → 已实施（2026-10-19）

| # | 事项 | 建议 | 状态 |
|---|---|---|---|
| 1 | P1-1 AI视频▾（slice(0,3) + 注释改写） | 按实拍修正 | ✅ 已实施 |
| 2 | P1-2 补购买套餐 / 邀请有奖（+ 窄档 wrap 处理）；联系客服暂不加 | 加两项，客服待产品定 | ✅ 已实施（两项已加；窄档改用「右侧减重」而非 wrap，见 §6） |
| 3 | P1-3 数据中心顶导项去留 | 倾向移除（参考站无，顶导容量让给 P1-2） | ✅ 已实施（顶导移除，侧栏保留） |
| 4 | P2-1 下拉菜单定制化 | 按参考站规格覆盖 antd 默认 | ✅ 已实施 |
| 5 | P2-2/2-3 微规格 + guest 按钮 | 随 P2-1 一批做 | ✅ 已实施（基准字号 14→16 未做，见 §6.3） |
| 6 | P2-4 营销元素 | 不做（无积分体系） | 已登记（不做） |
| 7 | 落地页 390 顶栏 4 行破碎换行 | 导航收汉堡 | ✅ 已实施 |

---

## 6. 实施记录（2026-10-19）

### 6.1 改了什么

| 项 | 文件 | 变更 |
|---|---|---|
| P1-1 补 AI视频▾ | `AppLayout.tsx` | `groups.slice(0,2)` → 直接渲染 `groups`；37-43 行过期注释按实拍改写 |
| P1-2 补两项直链 | `AppLayout.tsx` | 新增 `购买套餐 → /packages`、`邀请有奖 → /invitations`（路由早已存在却无入口） |
| P1-3 去数据中心 | `AppLayout.tsx` | 删除顶导 `数据中心 → /stats`（侧栏 `SideRail.tsx` 保留唯一入口） |
| P2-1 下拉皮肤 | `global.css` + `classNames.root` | radius 12 / border #e5e7f0 / shadow `0 18px 42px rgba(31,41,55,.14)` / pad 10 8 / 条目 36 r9 pad 0 12 / 13-600 #475467 / icon 14→20 / hover #f2efff-#5b4df5；下拉项 icon 由 14 改 20 |
| P2-2 微规格 | `global.css` | header `padding 0 20 → 0 24`（品牌块 x=24，与参考站齐）；新增 `--color-border-soft: #f2f3f5` 承载参考站外壳描边（原 `--color-border` #e2e8f0 偏深） |
| P2-3 guest 钮 | `AppLayout.tsx` + CSS | antd `Button type="primary"` → `.app-guest-login` 纯文字钮（68×32 / pad 8 / r6 / 13-700 #667085 / hover #5546d8 on #f1efff） |
| 窄档收敛 | `global.css` | ≤1199 隐藏 `.app-user-email`；≤1099 隐藏 `.app-quota` |
| 落地页 390 | `LandingPage.tsx` + CSS | ≤900 单行 54px「品牌 + 汉堡」，导航/算力胶囊进 Drawer；`navGroups` 由写死 2 组改为全部 3 组（与外壳同口径） |

### 6.2 两个必须记住的坑

1. **antd cssinjs 注入顺序不可控** → 下拉覆写必须比 `.ant-dropdown .ant-dropdown-menu-item`（0,2,0）更高特异性，写成 `.app-topnav-dropdown .ant-dropdown-menu .ant-dropdown-menu-item`（0,3,0）。第一版只写两层，radius/padding/字号/颜色**全部被 antd 反压**（实测 radius 6 / pad 5px 12px / 14px-400 / #182033），只有 hover 因多了 `:not()+:hover` 侥幸生效。
2. **汉堡不能放进会被隐藏的容器** —— 第一版把 `.landing-mobile-toggle` 放进 `.landing-topbar-right`，而移动端断点恰好 `display:none` 了这个容器 → 按钮 `display:inline-flex` 但 Playwright 判定不可点击。已改为 header 直系子元素。

### 6.3 实测结果（登录态 1280 + 逐档窄屏 + guest）

| 视口 | 导航项数 | 导航总宽 | header scrollW | 文档 scrollW | 溢出 |
|---|---|---|---|---|---|
| 1440 | 7 | 629 | 1440 | 1440 | 无 |
| 1280 | 7 | 629 | 1280 | 1280 | 无 |
| 1200 | 7 | 629 | 1200 | 1200 | 无 |
| 1100 | 7 | 629 | 1100 | 1100 | 无 |
| 1024 | 7 | 629 | 1024 | 1024 | 无 |
| 980 | 7 | 629 | 980 | 980 | 无 |
| 901 | 7 | 629 | 901 | 901 | 无 |

> 补项前 ≤980 会 `headerScrollW 1023 > 980` → 文档级横向滚动 42px；两档「右侧减重」后全档归零。**未采用 wrap**：64px 定高顶栏换行会破版，参考站 900 档是把导航壳压到 46px 实现的，本地没必要为此改顶栏高度。

下拉皮肤实测：`radius 12px` / `border 1px solid rgb(229,231,240)` / `shadow rgba(31,41,55,.14) 0 18px 42px` / `pad 10px 8px` / 条目 `h36 r9 pad 0 12` / `13px/600` / `rgb(71,84,103)` / icon 20 / hover `rgb(242,239,255)` + `rgb(91,77,245)` —— 与 §2.4 逐值一致。

落地页 390：顶栏 `54px` 单行、品牌标记 36×36 @x20、文本 48px @x64、汉堡 32×36 @x344、`docScrollW=390`；抽屉 20 个条目 / 4 个分组。

### 6.4 未做 / 新发现

| 项 | 说明 |
|---|---|
| 基准字号 14 → 16（P2-2 残余） | 参考站 header 基准 16px。本地改 `body` 基准字号会波及全站继承链，且与已定的「antd `fontSize` 保持 14」冲突，需单独一轮做影响面评估，不在本批 |
| 联系客服 | 本地无客服体系（无工单/IM/邮箱入口），补一个死链更差；保持不补 |
| **guest 态根本看不到应用外壳** | 实测发现：`/login` 是**顶层路由**（在 `<Routes>` 外层，不进 `Shell`），而 `Shell` 下所有页面都被 `RequireAuth` 包裹 → 未登录访问 `/works` 会跳 `/login`，`AppLayout` 根本不渲染。所以 P2-3 改的 guest「登录/注册」钮**当前是不可达分支**（代码已正确，等能力清单公开后自动生效）。参考站的外壳对 guest 是公开的，这是本地与参考站的一处结构差异，需要产品决定是否放开 |
| P2-5 顶导「工作台」当前页钮 | 动作区 1200 档余量仅 83px，不加；品牌块本身可回工作台 |

### 6.5 视觉证据

`docs/topnav-ref/impl-topnav-1280-7items.png`（7 项）、`impl-dropdown-1280.png`（下拉皮肤）、`impl-topnav-901-narrow.png`（窄档）、`impl-landing-390-fixed.png`（落地页 390 修复后）、`impl-landing-390-drawer.png`（移动抽屉）。

---

## 附录 A · 抓取产物清单

| 文件 | 内容 |
|---|---|
| `docs/topnav-ref/ref-topnav-dropdown.png` | 参考站电商生图下拉展开态（菜单 137 / 条目 hover #f2efff） |
| `docs/topnav-ref/ref-topnav-390.png` | 参考站移动顶栏（54px / 品牌 + 签到丸 + 汉堡） |
| `docs/topnav-ref/local-topnav-1280.png` | 本地桌面顶栏（登录态：算力丸 + 头像邮箱 + 5 导航项） |
| `docs/topnav-ref/local-topnav-390.png` | 本地移动顶栏（54px / 品牌 + 头像 + 汉堡） |
| `/tmp/ijihua-scrape/topnav-out.txt`、`topnav2.cjs` | 全量计算样式导出 + 复跑脚本 |

## 附录 B · 与既有审计的交叉引用

- 顶导所属的四层外壳（促销条 40 / 顶导 64 / 侧栏双态 / 主区滚动）整体审计见 `docs/workbench-design.md`；本轮只深入顶导层。
- P1-1 修正的 stale 注释位于 `AppLayout.tsx:37-41`，其依据的「README 页面结构表」为 10-17 快照——本次按「实拍 > 文档」纪律改写。
- 导航项规格（13/700/#667085/r8/pad 0 14/h32、hover #5546d8 on #f1efff）与本地 `global.css:574-590` 逐值一致，本轮未发现回归。
