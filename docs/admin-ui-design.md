# 后台界面规格

后台管理端 `/admin` 的视觉与布局规格：令牌、外壳几何、通用结构与页面原型。功能与接口见 `docs/admin-console-design.md` 与 `docs/admin-detailed-design.md`。

> **2026-10-30 已整站替换为 BoardUI**，方案与实施记录见 §7。第 0–6 节是旧外壳的视觉规格，其中 `adm-*` 类名与 antd 组件已不存在于代码 —— 现值以 §7 与上表「事实源」为准。

| 项 | 事实源 |
| --- | --- |
| 外壳组件 | `frontend/src/admin-ui/shell/AdminBoardLayout.tsx` |
| 菜单数据 | `frontend/src/components/admin/adminNav.ts` |
| 通用结构 | `frontend/src/admin-ui/widgets/AdminChrome.tsx`（经 `components/admin/PageHeader.tsx` / `AdminWidgets.tsx` 再导出） |
| 基础件 / 表单控件 / 数据表 | `frontend/src/admin-ui/primitives/` · `controls/` · `primitives/DataTable.tsx` |
| 样式 | `global.css` 的 `:root` 令牌 + `frontend/src/styles/boardui.css`（后台 Tailwind 入口） |
| 跨页微规格 | `docs/typography.md` |

---

## 0. 设计原则

| 原则 | 说明 |
| --- | --- |
| 令牌复用 | 只用 `global.css` 的 token，不写裸 hex；`adm-*` 只是业务布局与组件的样式钩子，不加同义色簇 |
| 密度优先 | 后台是长时间使用的工具，信息密度高于 C 端营销页；表格行高与间距取紧凑档 |
| 少装饰 | 无渐变、无插画，阴影仅用于浮层；卡片投影只有一个发丝级值 |
| 操作可见 | 关键操作紧邻数据行，不藏进菜单深处 |
| 状态双编码 | 状态用色块 + 文字，不只靠颜色（色觉障碍可达性） |
| 反馈三态 | 任何拉取有加载 / 成功 / 失败三态，失败给可读原因与重试 |
| 组件底座 | 通用骨架走 antd 原生组件；`adm-btn` / `adm-input` 是挂在 antd `Button` / `Input` 上的 class，不是自绘控件 |

## 1. 令牌

### 1.1 语义映射

| 用途 | token |
| --- | --- |
| 页面底 | `--page-bg` / `--surface` |
| 卡片与面板 | `--card-bg` |
| 主色 | `--brand` `#5546d8`；浅底 `--brand-bg` `#f1efff` |
| 极浅品牌底（主指标卡） | `--brand-bg-tint` `#fbfaff`；描边 `--brand-border-soft` `#ddd9f5` |
| 文字 | `--text-strong` / `--text-body` / `--text-muted` / `--text-desc` |
| 描边 | `--border` `#e5e7ef`；表格发丝线 `--adm-hairline` |
| 成功 | `--success` / `--success-bg` |
| 警告 | `--warn-bg` / `--warn-border` / `--warn-text` |
| 危险 | `--danger-text` / `--danger-soft-bg` |

### 1.2 后台专属 token

在 `global.css` 的后台区块内定义，不复用到 C 端：

| token | 值 | 用途 |
| --- | --- | --- |
| `--adm-page-max` | `1600px` | 内容区最大宽度，居中 |
| `--adm-hairline` | `color-mix(border 72%, transparent)` | 表格与卡片的分隔线 |
| `--adm-card-shadow` | `0 1px 2px (text-strong 4%)` | 卡片唯一投影 |

### 1.3 禁令

- 不新增裸 hex；状态色一律走上表语义 token。
- 不与 C 端共用外壳样式：`app-*` / `wb-*` / `asset-library-*` 不进后台。
- antd 主题 token（`main.tsx` 的 `ANTD_THEME_TOKEN`）与 CSS 变量是两套系统，改品牌色要两边都确认。

## 2. 外壳

### 2.1 骨架

> 现状（2026-10-30 起，P4 收尾后）：外壳由 `admin-ui/shell/AdminBoardLayout` 实现，**无顶栏、无值班带**，Header + Sider 的旧外壳与 `VITE_ADMIN_UI` 回滚开关均已删除。§2.2–§3 是旧外壳的设计记录，保留供回溯，其中的尺寸与类名（`adm-header` / `adm-rail` / `adm-band`）在代码里已不存在。

现行骨架（`AdminBoardLayout.tsx`）：

```
Sider 232px（折叠 60px，≤1280px 自动折叠；sticky，h-screen）
├── 头 56px：折叠按钮 + 品牌（标记 24 + 「货觉 运营后台」）
├── 导航：8 个分组（总览 / 运营 / 内容 / 交易 / 财务 / 系统 / 模型 / 数据安全），按权限点过滤
└── 底：环境标识 + 告警铃 + 密度开关 + 用户菜单

Content（.adm-content）：padding 18 / 26 / 56，子块统一限宽 1600 居中，横向滚动限在该区内
```

旧版骨架（历史）：

```
Header 56px（sticky top:0 z-index:20，padding 0 16）
├── 左：折叠按钮 32×32 + 品牌（标记 28 + 「货觉」15/600 + 「运营后台」次色）
│       + 环境徽标（仅非生产显示）
└── 右：全局搜索 240px + 告警按钮 + 用户菜单（头像 26 + 角色名 + ▾）

Body
├── Sider 240px（collapsed 64px）
└── Content padding 24 28 40，最大宽 1600 居中
```

### 2.2 Header

| 项 | 规格 |
| --- | --- |
| 高度 | 56px，`line-height: normal`（antd `Header` 默认 64px 行高会把行盒撑高） |
| 定位 | `sticky; top: 0; z-index: 20` |
| 内边距 | `0 16px`，左右两组 `gap: 16` |
| 品牌 | 标记 28px + 主名 15px / 600 `--text-strong` + 副名 `--text-muted` / 400 |
| 环境徽标 | 圆角胶囊，12px / 行高 20 / `padding 0 8`，`--warn-bg` + `--warn-border`；**仅非生产环境显示**，避免误在生产执行测试操作 |
| 搜索 | 宽 240px，浅底（`--surface`）输入框，面板最大高 `min(540px, 100dvh - 88px)` |
| 告警 | 36 左右图标按钮，带待处理数量角标；点击展开前 5 条，底部进 `/admin/alerts`。来源按权限过滤，无待处理项时不显示数字（不做假未读） |
| 密度 | 列表密度开关（宽松 / 紧凑），偏好存 `localStorage`，只压表格行高与单元格上下内边距，不改字号。**现行**：开关随外壳移到了侧栏底部，偏好经 `admin-ui/lib/density.ts` 的 `DensityContext` 下发给所有 `AdminDataTable`（不再写 `adm-layout.is-compact` 类） |
| 用户 | 头像 26 + 角色名 + `ChevronDown`；菜单：邮箱（只读）、返回前台、退出登录 |

### 2.3 Sider

| 项 | 规格 |
| --- | --- |
| 宽度 | 240px；折叠 64px（只留图标，居中） |
| 定位 | `sticky; top: 56px; height: calc(100vh - 56px)`，`align-self: flex-start`，独立滚动 |
| 内边距 | `12px 8px 24px`，背景 `--card-bg`，右边框 1px `--border` |
| 分组标题 | 12px / 600 `--text-desc`，`padding: 8px 12px 4px`，不可点击；组间 `margin-top: 12px` |
| 菜单项 | 高 40，圆角 `--radius-control`，图标 18 + 文字 14，gap 10，`padding 0 12` |
| 悬停 | 底 `--brand-bg`，字 `--brand` |
| 选中 | 底 `--brand-bg`，字 `--brand` / 600，左侧 3×18px 圆角指示条 |
| 规划项 | `opacity: .45` + `not-allowed`，右侧「待建」胶囊标记（`planned` 字段） |

菜单按权限过滤：无权项不渲染，整组为空时整组隐藏。

### 2.4 Content

`padding: 24px 28px 40px`，背景 `--page-bg`；直接子块（页头 / 筛选条 / 面板 / 指标卡 / 批量条 / 提示条）统一 `max-width: var(--adm-page-max)` 居中。`id="adm-main"`、`tabIndex={-1}`，配合顶部「跳到主要内容」跳链。

### 2.5 断点

| 视口 | 行为 |
| --- | --- |
| > 1280 | 侧栏展开 240px |
| ≤ 1280 | 自动折叠为 64px 图标栏（可手动展开） |
| ≤ 900 | 侧栏隐藏，折叠按钮改为打开 280px `Drawer` 导航；抽屉内恢复横排菜单 |

后台不再做更窄的适配：< 1280 时表格横向滚动，不做移动端重排（运营用桌面）。

离开页面前若有未保存变更，弹 antd `Modal` 确认，Esc 可关、焦点限制在框内；编辑抽屉关闭时使用同一套确认逻辑。

## 3. 通用结构

### 3.1 PageHeader

| 元素 | 规格 |
| --- | --- |
| 容器 | 底部间距 22px，左右 `gap 20` |
| 面包屑小字 | 11px / 500 `--text-desc`，`margin-bottom 5`，组名加粗 `--text-muted` |
| 标题 | 22px / 650 / 行高 30 / 字距 -0.02em / `--text-strong` |
| 描述 | 13px / 行高 20 / `--text-muted`，最大宽 760 |
| 操作区 | 右对齐，`gap 8`，可换行；可放按钮或 `Segmented` |

### 3.2 FilterBar

筛选条与页头同宽，`adm-filter-input` 216px、`adm-filter-select` 144px，按钮圆角 `--radius-control`、13px。筛选变更即请求，不要求点「查询」；「重置」清空全部条件。

### 3.3 表格

- 表格放在 `adm-panel` 内（白底卡片），表头 `--adm-hairline` 分隔，行 hover / 选中各有独立底色。
- 固定列（右侧操作列）要保证层级：`ant-table-cell-fix-right` 在 hover 与选中态下都保持不透明白底，否则内容会从列后透出。
- 高频核心表（订单、任务、模型线路）把同源信息合并为上下两行，1440px 内容区内不依赖横向滚动即可看到主操作；次要长文本截断并提供悬停完整值。
- 空态给真实说明；分页默认 20 条，`showSizeChanger`。

### 3.4 详情抽屉

一律 `AdminDrawer`，不跳独立路由。详情 id 与地址栏 `?id=` 同步，便于刷新与转发。抽屉内是「基本信息 → 关联数据 → 操作」三段，危险操作固定在底部，不与主要信息混排。关联数据中的用户、订单、任务、积分与素材使用 `adm-link` 直达对应详情或列表的既有筛选，不另做只读副本。可编辑抽屉关闭时若内容有改动，先确认「放弃修改 / 继续编辑」，页面级草稿同时登记离开守卫。

### 3.5 高危确认

`ConfirmAction`：antd `Modal` + `Alert` + 输入确认词。文案写明影响量（「将删除 12 个素材」），不接受「确定要删除吗」这类无信息确认。

### 3.6 指标卡

| 项 | 规格 |
| --- | --- |
| 栅格 | 4 列，`gap 12`，`margin-bottom 16` |
| 卡片 | `min-height 98`，`padding 15 17`，圆角 10，`--adm-card-shadow`，发丝描边 |
| 主卡 | `--brand-bg-tint` 底 + `--brand-border-soft` 描边 + 左侧 3px 品牌条 |
| 警示变体 | `is-warn`（`--warn-bg`）/ `is-danger`（`--danger-soft-bg`） |
| 数值 | 27px / 650 / 行高 34 / 字距 -0.03em |
| 标签 | 12px / 500 `--text-muted`；提示行 12px，行高 18 |

### 3.7 全局搜索面板

搜索框在 Header，面板浮层：分组标题 11px `--text-desc` + 条目（主标题 + 副标题两行），支持键盘上下选择、回车跳转、Esc 关闭；加载态用骨架块，无结果与失败给不同文案。

### 3.8 批量条与结果

勾选后出现 `adm-bulk-bar`（已选 N 项 + 动作 + 取消选择）。执行后 `BatchResultModal` 逐条展示，失败项排最前并带原因。**翻页或改筛选一律清空选择**，避免对看不见的行下手。

## 4. 页面原型

29 个页面归为四类。同一类共享布局，只变列与操作，新增页面照原型走。

| 原型 | 页面 | 结构 |
| --- | --- | --- |
| 看板页 | 平台概览 | 指标卡栅格 + 趋势图 + 交易概览 + 最近任务列表 |
| 告警页 | 告警中心 | 级别统计卡 + 级别筛选 + 告警卡片列表 + 口径说明 |
| 列表页 | 用户 / 素材 / 任务 / 工单 / 订单 / 积分 / 优惠券 / 活动 / 邀请与签到 / 商品 / 能力消耗价 / 发票 / 对账 / 操作审计 / 调用记录 / 数据备份 | 页头 → 筛选条 → 批量条（可选）→ 表格 → 分页；行操作走抽屉或确认弹窗 |
| 配置页 | 系统设置 / 存储配置 / AI 标识 / 角色权限 / 能力管控 / 模型配置 / 定时任务 / 保留期清理 / 法务文档 / 站内消息 | 分区表单或页签；底部署固定操作条（保存 / 重置） |
| 只读诊断页 | 支付渠道 | 状态卡分组 + 风险告警条 + 说明文本，无写入控件 |

### 4.1 各页特殊约定

| 页面 | 约定 |
| --- | --- |
| 平台概览 | 主指标卡用 `is-primary`；成功率无流水时显示「—」而非 0%；积压数字超阈值用 `is-warn` |
| 模型配置 | antd `Tabs`（线路管理 / 可用模型 / 逐能力路由 / 全局设置）+ `Table` + `Drawer` 编辑 + `Segmented`；线路按模态分组，健康状态用 `StatusTag` |
| AI 标识 | 左编辑、右预览两栏；上层是 CSS 还原的角标外观，下层是 Canvas 按服务端几何规则画在示例底图上的效果；关闭态预览显示「可见角标已关闭」而非空白；顶部开关配法律风险提示 |
| 能力管控 | 16 行能力表，下架必须填原因（表单内联校验，不是弹窗里的单行输入） |
| 支付渠道 | 三类风险（真实通道缺凭据 / 生产走沙箱 / 未配回调基址）用 `--warn-bg` 提示条，文案写清后果 |
| 法务文档 | 版本列表 + 编辑器；已发布版本只读，改文本必须「另存为新版本」 |
| 数据备份 | 列表 + 校验结果列（SHA-256 通过 / 不通过），下载与删除分开两类按钮，删除走高危确认 |
| 保留期清理 | 先展示各目标可清理量，再允许执行；执行历史在下方日志区 |

## 5. 可达性

| 项 | 实现 |
| --- | --- |
| 跳链 | 首个可聚焦元素是「跳到主要内容」，指向 `#adm-main` |
| 键盘 | 搜索面板方向键选择、Enter 跳转、Esc 关闭；抽屉与弹窗焦点限制在框内 |
| 图标按钮 | 一律带 `aria-label` |
| 状态 | 颜色 + 文字双编码；`aria-live` 用于加载与结果提示 |
| 对比度 | 正文与次要文字只在 `--text-body` / `--text-muted` 之上；`--text-desc` 只用于 11–12px 辅助信息 |

## 6. 已知限制

| 项 | 现状 |
| --- | --- |
| 移动端 | 不做适配；≤900 只给抽屉导航保证能进页面，表格仍横向滚动 |
| 告警阅读状态 | 告警计数是「当前待处理数」，不记录谁点过；事项处理后自然消失，不提供「已读」标记 |
| 自定义主题 | 不支持；品牌色只由 `global.css` 与 antd token 两处决定 |
| 图表 | 概览趋势为 CSS 自绘柱状图（含网格线与数值标签），不引入图表库 |

## 7. 已实施：BoardUI 整站替换

> 状态：**已完成（2026-10-30）**。外壳、共享控件与 29 个页面全部走 BoardUI；后台树内 `from 'antd'` 为 0，legacy 实现与 `VITE_ADMIN_UI` 开关已删除，无回滚路径。进度与消费审计见 §7.10。
> 来源：BoardUI 免费层（MIT），仓库 `https://github.com/BoardUI/boardui`，commit `ec5c5eb`（2026-10-02）。
> 决策：2026-10-30 选定「C 整站替换」，范围仅 `/admin`，C 端不动；纯 C，不保留值班带。

### 7.1 范围

| 做 | 不做 |
| --- | --- |
| 后台 29 页的 UI 层重写为 BoardUI + React Aria | 不改 C 端、不改后端 / API / 权限 / 审计 / 数据模型 |
| 保留 `/admin/*` 路由、权限链、审计原因、批量 ≤100、CSV、URL 筛选、`?id=` 深链 | 不引入 BoardUI Pro、不启用暗色 / RTL / 移动端布局 |
| 复用 `lib/api.ts`、`context/*`、`hooks/*` 与业务校验 | 不顺手重构 C 端或无关页面 |

### 7.2 工作量基线

| 项 | 现状（2026-10-30 代码） |
| --- | --- |
| 后台页面 | 29 页 / 16,666 行（`frontend/src/pages/admin`） |
| antd 依赖面 | 迁移前基线：44 个文件 `from 'antd'`、约 171 处 `message.*`、29 处 `<Table>`、13 处 Drawer、17 处 Form、49 处 Select、30 处 Tag、24 处 Tooltip、11 处 Card、20 处 Alert、32 处 `App.useApp()`。**迁移后**：`pages/admin` + `components/admin` + `admin-ui` 三个目录 `from 'antd'` 均为 **0**；全仓仍有 48 个文件引 antd，全部在 C 端 |
| BoardUI 免费层缺口 | 无通用 Drawer / Toast / Confirm / Form / Card / Empty / Skeleton / Result / Descriptions / Steps，需先建约 10 个基础件 |
| 测试 | 后台组件单测、共享 `StateViews` 单测、Playwright admin e2e，选择器需重写 |

粗估：1 名熟悉本项目的工程师 6–8 周；含 QA 回归 8–11 周。估算前提是只换 UI 层、不新增产品需求、后端不改。

### 7.3 目标架构

- `frontend/src/vendor/boardui/`：BoardUI 免费层源码，固定 commit `ec5c5eb`，保留 MIT LICENSE 与 `PROVENANCE.md`（来源、抓取日期、只取免费层，并注明 `MIT License © 2026 Mertcan Dundar Esmergul (BoardUI)`）。
- `frontend/src/admin-ui/`：
  - `providers/`：Toast、Confirm、Direction（zh-CN）、light-only theme。
  - `shell/`：`AdminBoardLayout`，复用 `AdminShell` 鉴权链与路由表；单栏结构（导航 + 内容），不含值班带。
  - `primitives/`：BoardUI 缺的 Drawer / Toast / Confirm / Card / Empty / Skeleton / Result / Descriptions / Steps / FormField；DataTable / Pagination / FilterBar 适配层。
  - `pages/`：29 页的页面级布局与业务编排；控件全部取自 `primitives/controls/widgets`，页面内不再出现 `adm-*` 类。
- `frontend/src/styles/boardui.css`：只导入 `tailwindcss/theme.css` + `tailwindcss/utilities.css`，**不导入 preflight**；`@source` 指向 `admin-ui` / `pages/admin` / `components/admin` / `vendor/boardui`（`utilities.css` 用 `source(none)` 关掉自动探测，四个目录缺一个，该目录的工具类就不生成且构建不报错）；`--color-accent-*` 重映射品牌紫 `#5546d8`；不导入 `.dark`。只在 admin 入口 chunk 加载，C 端不下载。三条非显然的约定：
  - **`* { border: 0 solid }` 必须是全局规则，不能收进 `.bui-admin`**：Tailwind 的边框工具类只写宽度，样式靠 preflight；而抽屉 / 弹层 / Toast 渲染在 `body` 的 portal 里，收进作用域会让浮层独自丢掉所有边线，且只在打开弹层时才看得见。宽度为 0 的边框本来不渲染，对现有样式无副作用；global.css 未分层，冲突时仍以它为准。
  - **portal 浮层根节点要挂 `.bui-scope`**：它只带字体与控件重置、不带底色。`bui-scope` 与 `.bui-admin` 的区别是后者还会上页面底色，挂到遮罩上会把半透明遮罩刷成实色。
  - **vendor `theme.css` 的 `:root` 会盖掉同名全站令牌**：目前交集是 `--color-text-secondary` 与 `--shadow-card`，已在文件末尾回写 global.css 原值并注明来由。升级 BoardUI 时重新比对一次两份文件的变量名交集。
- 依赖按 BoardUI 声明的主版本锁，不用 npm latest：必需 `tailwindcss@4.x`、`@tailwindcss/vite@4.x`、`react-aria-components@1.x`、`tailwind-merge@3.x`；按区块再加 `@tanstack/react-table@8.x`、`@internationalized/date@3.x`、`recharts@3.x`、`motion@12.x`、`@remixicon/react@4.9.0`。
- 依赖收口（按 90 个组件文件实测）：`react-aria-components` 被 32 个文件直接 import，属源码硬依赖，**不可绕开**；`motion` 只有 9 个文件用，本次收录的组件里只有 `agent-log` 需要，故锁 `12.x` 保留；`recharts` 只出现在 dashboard 两张图卡，概览趋势图是否引它放 P0 定；`@remixicon/react` 覆盖 39 个文件，**vendor 内保留源码原样**（图标改 lucide 会让 39 个文件全部偏离上游，升级时无法直接覆盖），`admin-ui` 与业务页面一律用 lucide。

### 7.4 迁移方式

- `/admin/*` 路由不变；迁移期曾用 `VITE_ADMIN_UI=legacy|boardui` 双跑，P4 收尾时连同 `admin-ui/lib/flag.ts`、`AdminLayout.tsx`、`*.legacy.tsx` 一并删除 —— **无回滚路径**，这是「纯 C」决策的直接后果。
- `AdminShell`（在 `AdminDashboardPage` 内导出）的鉴权链与 `Routes` 表全程未动，只换了外壳与渲染层。
- `components/admin/PageHeader.tsx` 与 `AdminWidgets.tsx` 保留为单一路径的再导出，29 页 import 与签名不变。

### 7.5 阶段计划

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| P0 依赖沙箱（2–3 人日） | 独立 worktree；分批装依赖；vendor BoardUI；`/_admin-ui-sandbox` 渲染 Button/Table/DatePicker/Toast | C 端无样式回归；typecheck 过；bundle 增量记录 |
| P1 基础件（5–8 人日） | Providers、AdminShell、基础件、DataTable 适配层、Pagination、FilterBar、StatusDot | 五态 / 键盘 / 焦点 / reduced-motion 通过；单测 |
| P2 试点两页（5–7 人日） | 平台概览 + 任务监控，flag 双跑 | 三身份 / 五态 / 三视口；抽屉、审计原因、URL 筛选一致；概览页已承接值班带的刻度、四计数与「接手最早异常」主动作 |
| P3 按原型铺开（15–20 人日） | 看板 1 / 列表约 12 / 配置约 10 / 内容约 3；每类先做模板页再复制 | 每类模板过 G3；批量 / CSV / 导入导出 / 详情深链一致 |
| P4 收尾（已完成，2026-10-30） | 删除 legacy admin；admin 内 antd 引用清零；`global.css` 清死选择器；e2e 选择器重写；文档同步 | admin 三目录 `from 'antd'` = 0；`.adm-*` 364 → 30 条；e2e 七份 spec 全部改锚 `data-testid="admin-*"` |

### 7.6 关键决策

- **表格**：BoardUI 的 Data Table 是客户端 demo；写 `AdminDataTable` 适配层，输入 `columns/rows/total/page/pageSize`，内部 TanStack；服务端分页/排序/筛选由现有 hooks 驱动。parity：批量 ≤100、CSV、展开行、固定操作列、空/载/错、`?id=` 深链、密度。
- **表单**：不引 react-hook-form；用 React Aria 字段校验 + `AdminForm` 薄封装，错误展示与后端错误码对齐；`AdminSettingsPage` 的自定义行布局保留，只换控件。
- **反馈**：约 171 处 `message.*` → `toast`；`Modal.confirm` / `ConfirmAction` → `confirm()`；32 处 `App.useApp()` 移除；以 grep 闸口保证 admin 内 `message.` 清零。
- **图标**：BoardUI 的 Remix 图标换 lucide 等价图标，保持一套 16px/1.5 图标语言；若保留 Remix，只限 vendor 内部。
- **值班带**：不保留（2026-10-30 决策）。外壳改为 BoardUI 单栏结构；`.adm-band-*` 样式已删除，`DutyBand.tsx` **保留**（概览首屏的值班塔 `.adm-tower*` 与 `duration` / `earliestFailure` 格式化工具仍从这里导出）。信息面不跟着丢，按以下三条改挂：
  - 100 根产出刻度 + 四个计数（任务模式为排队 / 异常 / 线路冷却；财务模式为待付 / 退款 / 发票 / 对账）+「接手最早异常」主动作 → 概览页首屏（`admin-ui/widgets/DutyStrip.tsx`）。`DutyContext` 数据层保留，轮询从「外壳常驻」改为「只挂在概览路由」，其余 28 页不再陪着每 30 秒拉一次任务列表。
  - 其余 28 页不再常驻这条带；异常提醒由侧栏告警铃承担。
  - 环境标识、密度切换、用户菜单在侧栏底部（`AdminBoardLayout.tsx` 的 sider 尾部）。
- **权限/审计**：`AdminGuard` / `PermissionGuard` / `AuditInterceptor` 不动；高危动作的原因输入与审计编号逐页保留。
- **视觉方向**：原「值班台」方向卡（`.oil-ui`）已删除，不再另立方向卡；C 的后台视觉即 BoardUI 免费层默认语言 + 品牌紫 `#5546d8` 重映射，以 §7.3 的 `boardui.css` 为唯一落点。
- **文档**：`CLAUDE.md`（后台骨架 / 共享控件两段）、本文档 §2.1 现状、`README.md`、`docs/testing.md` 已同步；`.adm-*` 的迁移叙事只留在本文档，`README.md` 只写现状。

### 7.7 验收与止损

| 风险 | 触发信号 | 止损 |
| --- | --- | --- |
| Tailwind/React Aria 污染 C 端 | C 端页面边框/字体/按钮样式变化 | P0 不通过，停止 C，退回现行 antd 方案 |
| DataTable parity 成本超预期 | P2 后仍无法支持固定列/展开行/批量 | 纯 C 已定，不转 C-lite；G2 决策只在「延长 P1 工期」与「退回现行 legacy 实现」之间选 |
| 表单校验回归 | 配置页无效值可保存/错误不展示 | 每页 G3 必须过；后端校验为最后防线 |
| `message` 替换遗漏 | 页面操作无反馈 | codemod + grep 闸门，admin 内 `message.` 清零 |
| 测试资产重写量大 | e2e 红灯 > 20% | P3 前补 Playwright 选择器约定；按原型分批 |
| 依赖安装超时 | npm 5 分钟硬超时 | 分批安装 + 精确锁版 + `npm run verify:deps:critical` |
| 工作区已有改动被覆盖 | 有未提交的 `global.css` / C 端页面 | P0 用独立 worktree，不在当前工作区直接开工 |

### 7.8 已确认决策（2026-10-30）

| 项 | 结论 | 连带影响 |
| --- | --- | --- |
| 值班带 | 不保留 | 外壳改单栏；刻度 / 四计数 / 主动作移到概览页首屏；环境标识、密度切换、用户菜单留在侧栏底部；`DutyBand.tsx` 与 `--adm-band-*` 在 P4 清理 |
| 路线 | 纯 C，不做 C-lite | 不允许在与 antd 混用的前提下交付中间态；回退单位是整页 flag，不是混合组件 |
| 视觉方向 | 原方向卡已删除，不另立 | 视觉即 BoardUI 默认语言 + 品牌紫重映射，`boardui.css` 为唯一落点；不再有第二份方向文档约束 |

仍待 P0 第一周确认的只有工程参数，不再有产品决策：BoardUI 源码裁剪范围（只 vendor 用到的组件）、`@remixicon/react` 是否保留、`recharts` 是否引入用于概览趋势图。

### 7.9 吸收清单与证据纪律

> 分级口径参照外部实践：每项资产必须写明「吸收方式 + 本项目消费点（file:line）+ 状态」，没有消费点的不 vendor，避免把组件库整体搬进来再找地方用。

| BoardUI 资产 | 吸收方式 | 本项目消费点 | 阶段 |
| --- | --- | --- | --- |
| `app-shell` | 形态吸收 | `admin-ui/shell/AdminBoardLayout.tsx`（已落地，单栏 + 侧栏导航） | P1 |
| `data-table` / `data-grid` | 直接吸收 + 适配层 | 29 处 `<Table>` | P1 / P3 |
| `agent-log` | 直接吸收 | [AdminTasksPage.tsx:815](frontend/src/pages/admin/AdminTasksPage.tsx#L815) 状态流转；列表「进行中」活动行 | P2 |
| `agent-thinking` | 形态吸收 | 任务等待/生成中提示（`role="status"`，reduced-motion 降级） | P3 |
| `notification-center` | 形态吸收 | [AlertCenter.tsx:108](frontend/src/components/admin/AlertCenter.tsx#L108)，保留 60s 轮询与真实告警源 | P1 |
| `settings` | 形态吸收 | [AdminSettingsPage.tsx:164](frontend/src/pages/admin/AdminSettingsPage.tsx#L164) 分区导航，仍留在页面内 | P3 |
| `dashboard` | 形态吸收 | 概览首屏，承接值班带刻度 / 四计数 / 主动作 | P2 |
| `date-picker` / `select` / `segmented-control` / `tabs` / `pagination` / `tooltip` / `badges` / `kbd` / `file-upload` / `tree-view` | 直接吸收 | 筛选条、表单、权限树、CSV 导入 | P3 |
| `styles/typography.css` | 直接吸收但限定作用域 | 并入 `boardui.css` 的 `.bui-admin`，不进 `global.css` | P0 |
| `utils/cx.ts` | 直接吸收 | `admin-ui/lib/cx.ts`（`tailwind-merge`） | P0 |
| `hooks/use-count-up.ts` | 直接吸收 | 概览统计数字滚动，尊重 reduced-motion | P2 |
| `AGENTS.md` 组件纪律 | 形态吸收 | `admin-ui/README.md`：五态、焦点、reduced-motion、命名 | P1 |
| `agent-chat` / `composer-loader` / `landing` / `carousel` / `social-button` / `input-otp` / `medical` / `docs` / `templates` / `brand` / `auth` | 不吸收 | 后台无对应场景 | — |

两条与外部实践刻意不同的判断，须留证：

1. **`react-aria-components` 仍要引**。外部实践在同栈项目里明确拒绝 React Aria 与 motion；本项目走纯 C，vendor 的 90 个组件文件中有 32 个直接 import React Aria，绕开等于重写这些组件，成本高于引依赖。motion 则相反，只有 9 个文件用，本次收录的组件里只有 `agent-log` 需要，锁 `12.x` 保留；其余动效一律 CSS 过渡。
2. **`notification-center` 启用但要限定范围**。外部实践因「无真实推送源」禁用该组件；本项目的 `AlertCenter` 有真实数据源（后台告警 API + 60s 轮询），具备消费证据，因此可吸收其入口形态。但它只服务后台告警，不得借此扩成用户级任务通知或站内消息中心。

另两条纪律：**业务术语不跟着 BoardUI 走**（组件内部可以叫 `agent-log`，对外仍是「任务状态流转」，不引入 thread / agent 这类外部语义）；**每批替换后做消费审计**（逐页 grep `from 'antd'`，未清零的页不得标完成），对应 §7.5 各阶段的退出条件。

### 7.10 实施进度（2026-10-30）

已落地：

| 项 | 位置 |
| --- | --- |
| 依赖（精确锁版） | `tailwindcss@4.3.3`、`@tailwindcss/vite@4.3.3`、`react-aria-components@1.22.1`、`tailwind-merge@3.7.0`、`motion@12.43.0`、`@tanstack/react-table@8.21.3`、`@internationalized/date@3.12.4`、`@remixicon/react@4.9.0` |
| vendor 源码（33 文件） | `frontend/src/vendor/boardui/`，含 MIT LICENSE 与 `PROVENANCE.md` |
| 样式入口 | `frontend/src/styles/boardui.css`（无 preflight，accent 重映射品牌紫，`.bui-admin` 作用域） |
| 构建接入 | `vite.config.ts` 的 Tailwind 插件与 `@` 别名；`tsconfig.json` 的 `paths` |
| 运行时 | `admin-ui/providers/`：Toast、Confirm（含高危原因输入）、`AdminUIProvider` |
| 基础件 | `admin-ui/primitives/`：Drawer、ModalDialog（居中弹窗，与抽屉分工见文件注释）、Panel、EmptyState、Skeleton、Result、Descriptions、Steps、FormField、Notice（info/success/warn/danger/locked） |
| 外壳 | `admin-ui/shell/AdminBoardLayout.tsx`：侧栏导航、⌘K 全局搜索、告警铃、环境标识、密度开关、用户菜单、未保存拦截；无值班带 |
| 共享控件（BoardUI 版） | `admin-ui/widgets/AdminChrome.tsx`：页头、筛选条、已筛选回显、统计卡、可折叠面板、状态标签、空/加载/失败/陈旧态、详情抽屉、页内确认条；签名与旧版逐字一致 |
| 共享控件入口 | `components/admin/PageHeader.tsx` 与 `AdminWidgets.tsx` 是**单一路径**的再导出（指向 `admin-ui/widgets/AdminChrome` 与 `primitives`），数据 hook 只有一份；29 页 import 与签名不变。`*.legacy.tsx` 两份已随 P4 删除 |
| 数据表 | `admin-ui/primitives/DataTable.tsx`：服务端分页/排序/选择（上限 100）、右固定操作列、密度、空/加载/失败态、行内展开（`renderExpanded` + `expandedKeys`） |
| 表单控件 | `admin-ui/controls/`：`TextInput`（allowClear / 回车提交 / `showCount` / `disabled` / `type=date\|datetime-local`）、`SelectBox`（React Aria Select 包成 `string \| undefined` + 「全部」哨兵；**必须渲染静态 `SelectItem` 元素**，vendor 的 `Select.children` 收 `ReactNode`，传 `(item) => …` 渲染函数会被当普通子节点交给 Provider，React 每帧报 function-as-child）、`NumberInput`（含步进）、`TextArea`（含计数与 `disabled`）、`SwitchBox`（把 RAC 的 `isSelected` 收成 `checked`）、`SegmentedBox`（分段切换，单选不可空）、`CheckBox`（含半选）、`FilePick`（只选文件不发请求，选完再点导入）、`HoverTip`（可聚焦的说明气泡） |
| 全局件挂载 | `admin-ui/providers/AdminUIProvider` 统一挂 Toast + Confirm，在 `AdminShell`（`AdminDashboardPage` 内导出）里包住全部 `/admin/*` 路由；两个 Provider 只在真正弹提示 / 确认时才渲染 portal |
| 状态语义映射 | `components/admin/statusMeta.ts`：`STATUS_META` 唯一事实源 |
| 值班条 | `admin-ui/widgets/DutyStrip.tsx`：100 刻度 + 四计数 + 「接手最早异常」，落在概览首屏；`DutyContext` 从外壳移到概览路由，其余 28 页不再轮询 |
| 密度 | `admin-ui/lib/density.ts` 的 `DensityContext`：外壳左栏底部开关写 `localStorage`，`AdminDataTable` 读它决定行高（`h-9` / `h-11`）；表格仍可用 `density` prop 覆盖 |
| 测试锚点 | 共享控件与页面关键节点统一挂 `data-testid="admin-*"`（`admin-filter` / `admin-filter-chip` / `admin-table` / `admin-table-row` / `admin-table-expanded` / `admin-drawer` / `admin-modal` / `admin-confirm-action` / `admin-toast` / `admin-sider` / `admin-panel` / `admin-bulk-bar` / `admin-asset-cell` / `admin-storage-card` / `admin-task-row`）；表单控件用 `aria-label` 而非 `id`，e2e 一律 `getByLabel` / `getByTestId`，不追 Tailwind 工具类 |
| 旧样式清理 | `global.css` 的 `.adm-*`：364 条选择器 → 30 条（外壳骨架 `adm-layout` / `adm-content` / `adm-skip-link`、值班塔 `adm-tower*` / `adm-dot` / `adm-empty-inline`、限宽令牌 `--adm-page-max`）。同时删掉只服务 antd 后台的 4 个令牌（`--brand-bg-tint` / `--brand-border-soft` / `--info-text` / `--info-border`）与 3 个无人引用的 `@keyframes` |

未落地（按 §7.5 继续）：

1. 插件级差异：`SelectBox` 无搜索框（vendor 无 ComboBox），长选项表依赖 React Aria 的首字母跳转；`Image`（预览）/ `Tabs` 的 BoardUI 对应件未封装，图片预览走自绘 lightbox 不引 vendor 件；`Upload` 的「先选文件再提交」由 `FilePick` 覆盖，服务端接收与进度条无对应件。`Dropdown` 不另封装，直接用 vendor 的 `Dropdown` + `DropdownTrigger` + `DropdownPopover`。
2. 概览趋势图仍用 CSS 自绘柱状图，未引 `recharts`。
3. 后台组件单测目前两份：`components/admin/__tests__/AdminWidgets.test.tsx`（`useAdminUrlFilterSync` / `useAdminDetailParam` 两个 URL 契约）与 `admin-ui/primitives/__tests__/DataTable.density.test.tsx`（密度上下文下发与 `density` prop 优先级）。`AdminDataTable` 的排序 / 选择 / 展开交互、`DraftGuard`、`FilterBar` 尚未补单测。`vitest.config.ts` 已补上 `@` → `src/vendor/boardui` 别名（与 `vite.config.ts` 一致），否则任何渲染 vendor 组件的测试都会挂在 import 解析上。

验证状态（P4）：按仓库纪律未运行 `tsc` / 构建，浏览器验收待仓库所有者执行。已做的检查：`pages/admin` + `components/admin` + `admin-ui` 三目录 `from 'antd'` grep 结果为 0；`tests/*.spec.ts` 内无残留 antd / `adm-*` 选择器（C 端 `product-*.spec.ts` 里的 `.ant-*` 属于 C 端，正确）；`pages/admin` + `components/admin` + `admin-ui` 共 63 个源文件一次性交给 esbuild 转译，全部通过（无语法 / 解析错误）；`global.css` 花括号配平（3564 / 3564），删除的 925 条选择器逐条核对「全部含 `adm-`」，无 C 端选择器被误删；`npm test` 全量 18 文件 / 96 用例通过。另用 Playwright 驱动真实 Chrome 带着 admin 令牌逐条打开 29 个后台路由（开发档 5100 + 4100 同时起），逐页断言外壳渲染、内容非空、控制台零报错；正式 e2e 套件（`frontend/tests`）未执行。
