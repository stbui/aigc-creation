# 后台界面规格

后台管理端 `/admin` 的视觉与布局规格：令牌、外壳几何、通用结构与页面原型。功能与接口见 `docs/admin-console-design.md` 与 `docs/admin-detailed-design.md`。

> **当前实现：shadcn/ui（`new-york` 风格，radix 底座）**，2026-11-02 推倒重建。
> 后台曾先后经历 antd、自建组件套件、shadcn 三轮换装，**前两轮的组件与样式已全部删除**，
> 仓库内不再有残留引用。历史决策过程见 `docs/README.md`；本文只写现状。
>
> 后台 34 个页面全部走 shadcn 原子件（`admin-ui/components/ui/*`），经 `admin-ui/primitives/*`
> 这一层组合件供给页面。C 端（前台）不复用这套组合件，页面只从 `frontend/src/ui` 兼容层取件；
> 该层底层同样复用 `admin-ui/components/ui` 的 shadcn/radix 原子件，**antd 已从依赖与源码中移除**。

| 项 | 事实源 |
| --- | --- |
| 外壳组件 | `frontend/src/admin-ui/shell/AdminBoardLayout.tsx` |
| 菜单数据 | `frontend/src/components/admin/adminNav.ts`（8 组 / 34 条） |
| 页面取用层 | `frontend/src/admin-ui/primitives/index.ts`（页面**只从这里**取件） |
| 基础件 | `frontend/src/admin-ui/components/ui/`（shadcn CLI 生成，`scripts/post-shadcn.mjs` 后处理） |
| 类名合并 | `frontend/src/admin-ui/lib/cn.ts`（官方 `cn` 包的 `createCn` + 项目 token 补登） |
| 状态色 | `frontend/src/components/admin/statusMeta.ts`（`STATUS_META`） |
| 样式 | `global.css` 的 `:root` 令牌 + `frontend/src/styles/admin.css`（后台 Tailwind 入口 + `@theme inline` 桥接） |
| 跨页微规格 | `docs/typography.md` |

---

## 0. 设计原则

| 原则 | 说明 |
| --- | --- |
| 令牌复用 | 只用 `global.css` 的 token，不写裸 hex；shadcn 语义类经 `admin.css` 的 `@theme inline` 桥接过来 |
| 密度优先 | 后台是长时间使用的工具，信息密度高于 C 端营销页；表格行高与间距取紧凑档 |
| 少装饰 | 无渐变、无插画，阴影仅用于浮层与卡片 |
| 操作可见 | 关键操作紧邻数据行，不藏进菜单深处 |
| 状态双编码 | 状态用色块 + 文字，不只靠颜色（色觉障碍可达性） |
| 反馈三态 | 任何拉取有加载 / 成功 / 失败三态，失败给可读原因与重试 |
| 一套组件 | 页面只从 `primitives` 取件；同一形态（如筛选条、表格）只有一份实现 |

## 1. 令牌

### 1.1 语义映射

后台页面写的是 shadcn 语义类，底层由 `admin.css` 的 `@theme inline` 映射到 `global.css` 的令牌：

| 用途 | shadcn 类 | 项目 token |
| --- | --- | --- |
| 页面底 | `bg-page` | `--page-bg` `#f6f7fb` |
| 卡片与面板 | `bg-card` | `--card-bg` `#ffffff` |
| 主色 | `bg-primary` / `text-brand` | `--brand` `#5546d8` |
| 悬停淡底 | `bg-accent` | `--brand-bg` `#f1efff` |
| 正文 | `text-foreground` | `--text-strong` `#171a2b` |
| 次要文字 | `text-muted-foreground` | `--text-muted` `#667085` |
| 描边 | `border-border` / `border-input` | `--border` `#e5e7ef` |
| 灰底块 | `bg-muted` / `bg-secondary` | `--surface` `#f2f4f7` |
| 成功 | `bg-success-soft` / `text-success-text` | `--success-soft-bg` / `--success-text` |
| 警告 | `bg-warn-soft` / `text-warn-text` | `--warn-bg` / `--warn-text` |
| 危险 | `bg-danger-soft` / `text-danger-text` | `--danger-soft-bg` / `--danger-text` |
| 卡片投影 | `shadow-card` | `--shadow-card`（`global.css` 定义，`cn.ts` 补登） |

### 1.2 圆角

Tailwind v4 的默认阶梯与项目规定对不齐，`admin.css` 的 `@theme inline` 重映射到全站五档：

| Tailwind 类 | 值 | 项目档 |
| --- | --- | --- |
| `rounded-sm` | 4px | `--radius-tag` |
| `rounded-md` | 8px | `--radius-control`（按钮 / 输入框） |
| `rounded-lg` | 12px | `--radius-card`（卡片 / 面板） |
| `rounded-xl` | 16px | `--radius-panel` |
| `rounded-2xl` | 24px | `--radius-hero` |

另加胶囊档 `rounded-full`（状态标签、比例条）。用 `var()` 引用而非抄字面值：圆角档位只定义一处。

### 1.3 禁令

- 不新增裸 hex；状态色一律走上表语义 token。
- 不与 C 端共用外壳样式：`app-*` / `wb-*` / `asset-library-*` 不进后台。
- 页面内不写 `adm-*` 类。`.adm-*` 只剩外壳骨架三个（见 §2.1），是几何契约不是样式装饰。
- 页面不直连 `admin-ui/components/ui/*`（原子件），只从 `primitives` 取。

## 2. 外壳

### 2.1 骨架

外壳由 `admin-ui/shell/AdminBoardLayout` 实现，经典「上左右」结构，无值班带：

```
Topbar 56px（sticky top-0）
├── 左：品牌（标记 24 + 「货觉 运营后台」）+ 当前位置（分组 / 页面）
└── 右：环境标识 + 用户菜单

Sider 232px（折叠 60px，≤1280px 自动折叠；sticky top-0，h-full）
├── 品牌头：56px，标记 + 「货觉 运营后台」
├── 导航：8 个分组（总览 / 运营 / 内容 / 交易 / 财务 / 系统 / 模型 / 数据安全），可折叠，按权限点过滤
└── 底：环境标识、折叠 / 展开按钮、账号菜单

Content（.adm-content）：padding 18 / 26 / 56，子块铺满内容区（不设统一限宽），横向滚动限在该区内
```

`.adm-*` 在仓库里只剩三个类，规则在 `styles/admin.css` 的 `@layer base`：

| 类 | 用途 |
| --- | --- |
| `.adm-layout` | 外壳根，e2e 用它确认后台外壳已挂载 |
| `.adm-content` | 内容区，e2e 量它的宽度与左边缘，验证「内容区 = 视口 − 侧栏」且无横向溢出 |
| `.adm-skip-link` | 键盘用户的跳转入口（`#adm-main`） |

页面内新增 `adm-*` 类是错的。

### 2.2 侧栏细节

| 项 | 规格 |
| --- | --- |
| 顶栏 | 高 56px（`data-testid="admin-topbar"`），左侧品牌 + 当前位置，右侧环境标识与账号 |
| 导航滚动区 | `data-testid="admin-nav-scroll"`，自身滚动（`overflow-y-auto`），顶栏与底部按钮不参与 |
| 底部区 | 侧栏底、上边框分隔；非生产显示环境标识与折叠按钮，账号菜单固定在底部；折叠态只留图标 |
| 分组标题 | 12px / 600 `text-muted-foreground` / `tracking-wider`，可点击折叠/展开；默认只展开当前页面所在组，展开状态记入 `localStorage`；侧栏折叠态隐藏标题并改用分隔线 |
| 菜单项 | 高 34px，圆角 8px，13px 文字，padding `0 10px`，左侧 16px 图标 + 10px 间距 |
| 悬停 | 底 `bg-muted`，字 `text-foreground` |
| 选中 | 底 `bg-accent`、字 `text-accent-foreground` / 500，左侧 3px 品牌色竖条 |
| 折叠态 | 只留图标并居中，`aria-label` / `title` 给全称；分组之间用分隔线代替标题 |
| 规划项 | 标「待建」小胶囊（`planned` 字段） |

菜单按权限过滤：无权项不渲染，整组为空时整组隐藏。

### 2.3 顶栏右侧

| 项 | 规格 |
| --- | --- |
| 环境标识 | 灰底胶囊 + 橙点，**仅非生产显示**，避免误在生产执行测试操作 |
| 用户菜单 | 品牌紫头像 + 邮箱 / 角色两行；展开后头部复显身份，菜单含返回前台、退出登录（危险色） |

### 2.4 内容区

背景 `bg-page`；直接子块（页头 / 筛选条 / 面板 / 指标卡 / 批量条 / 提示条）铺满内容区，不做统一限宽 —— 后台以宽表与「列表 + 详情」双栏为主，限宽只会挤压表格。需要窄版的地方由页面自己约束（`Panel` 的 `narrow`、`SaveBar` 的 `narrow`，宽 760px 左对齐）。`id="adm-main"`、`tabIndex={-1}`，配合顶部「跳到主要内容」跳链。

### 2.5 断点

| 视口 | 行为 |
| --- | --- |
| > 1280 | 侧栏展开 232px |
| ≤ 1280 | 自动折叠为 60px 图标栏（可手动展开） |

后台不做更窄的适配：< 1280 时表格横向滚动，不做移动端重排（运营用桌面）。

离开页面前若有未保存变更，弹确认框，Esc 可关；编辑抽屉关闭时使用同一套确认逻辑（`useUnsavedGuard` / `useDiscardConfirm`）。

## 3. 通用结构

### 3.1 PageHeader

`primitives/layout.PageHeader`：标题 + 副标题在左，操作在右。标题 `h1` / 20px / 600，副标题 13px `text-muted-foreground`（不截断 —— 它通常是一句话说明「这一页在管什么」）。操作区右对齐、可换行。

### 3.2 FilterBar

`primitives/display.FilterBar`：筛选条与页头同宽，`flex-wrap` 自然换行，`FilterActions` 用 `ml-auto` 把「查询 / 重置」推到最右。`AppliedFilters` 独占一行（`basis-full`）回显已生效条件，每条可单独清除。

筛选变更即请求，不要求点「查询」；「重置」清空全部条件。

### 3.3 表格

`primitives/table.AdminDataTable` —— 排序、批量勾选上限、固定操作列、行展开、分页、密度只有这一份实现。

- 表格放在 `Panel` 内（白底卡片），表头 `bg-muted/40`，行 hover `bg-muted/50`。
- 行高由密度决定（紧凑 `h-9` / 宽松 `h-11`），**不由内容撑开** —— 否则换行的那行会明显更高。
- 固定列（右侧操作列）用 `sticky right-0` + 不透明底色，否则内容会从列后透出。
- 操作列直显最多两个动作，其余收进 `RowMenu`（「更多」）。五个动作平铺会把行撑高。
- 批量勾选上限 100（与后端 `common/batch.ts` 的 `MAX_BATCH` 对齐）。
- 分页默认 20 条，可选 20 / 50 / 100。
- **翻页或改筛选一律清空选择**，避免对看不见的行下手。

三态：首次加载无数据 → 骨架；失败且无数据 → 失败态 + 重试；空数据 → 空态。**已有数据时**加载只在表体上叠一层淡化，不让整张表消失再出现。

### 3.4 加载骨架

`primitives/skeleton` —— 骨架件只有这一个来源。

**核心契约：骨架占住位置，不是把版面清空。** 首屏加载时如果把标题、说明、动作区一起换成灰条，页面的版面就消失了：用户刷新一下看到的不是「正在加载」，而是「这页不见了」，回来时又是一片陌生的灰条。所以 `PageSkeleton` 的**页头照常渲染真实文字**，动作区也照常渲染（按钮在加载期间 `disabled`，点不动但位置在），只有数据区换成骨架。

| 形态 | 用途 |
| --- | --- |
| `PageSkeleton` | 页面级：真实页头 + 骨架正文。挂在 `data-testid="admin-page-loading"` |
| `SkeletonPanel` | 整块面板（标题占位 + 内容行），表单 / 列表页用 |
| `SkeletonBody` | 只替内容行，用在**真实面板已经渲染、只有里面在加载**时 |
| `SkeletonStats` | 统计卡一行（会员套餐、概览这类） |
| `SkeletonCards` | 卡片网格（存储后端这类「一格一个后端」的布局） |
| `SkeletonTabs` | 分段页签栏（设置页的分组页签） |
| `SkeletonDutyStrip` | 概览首屏的值班条 |

骨架一律用 **shadcn 原子件拼**：面板是 `Card` + `CardHeader` + `CardContent`，指标卡是 `Card`，每根占位条是 `Skeleton`，页签栏是 `Tabs` + `TabsList`。不手写 `div` —— 手写的话改了 `Panel` 的边框或投影，骨架不会跟着变，两边越走越远。

`PageSkeleton` 的参数与页面真实结构一一对应：`title` / `description` / `actions` 对应页头，`notice` 对应页头与正文之间的固定提示条，`stats` / `panels` / `cards` 对应三个正文区，`panelRows` 是每个面板内的行数，`narrow` 限宽 760（与窄版 `Panel` 一致，数据到位时不会横向跳一下）。

三条约束：

- **`notice` 只放与数据无关的固定提示**（如「凭据不在界面配置」）。随数据出现 / 消失的提示（失败告警、过期位图）不要放进来 —— 那类提示在加载期间本来就无从知晓，强行占位反而是假的。
- **`title` 可以不给**，用在标签页内部这种「页头已经在上面渲染好了」的场景：这时再插一个页头就是重复的标题。
- **`body` 是逃生舱**：页面真实结构不是「统计卡 + 面板 + 卡片」这三段式时（概览页的值班条 + 62/38 双栏、设置页的分组页签），用它自己写骨架。用了 `body` 就不要再传 `stats` / `panels` / `cards` —— 两者同时渲染会多出一段假版面。

**骨架的形状必须与真实版面同构。** 概览页真实是双栏，骨架也画双栏；AIGC 标识页真实是 2×2 面板网格，骨架也画 2×2；备份页真实是 5 张统计卡 + 2 块面板，骨架也给 5 张卡。叠成上下两块的话，数据到位时整页会横向重排一次 —— 那次重排比「先空着」更难受。

`AdminDataTable` 的表格骨架另走一路：`TableSkeleton` 用**真实的 `<table>` 结构**渲染，按 `columns` 的 `width` / `align` / `fixed` 出列宽，所以加载态与加载完成的表格列宽一致，不会横向跳。它同样带 `data-testid="admin-page-loading"` —— 两者不会同时出现（页面骨架时表格还没渲染）。

### 3.5 详情抽屉

一律 `AdminDrawer`，不跳独立路由。详情 id 与地址栏 `?id=` 同步，便于刷新与转发。

`AdminDrawer` 自己拉数据（列表只带摘要字段），`children` 是**渲染函数**而不是元素：详情到达前根本不渲染空壳。关闭即清空 —— 下次打开的可能是另一条记录，留着上一条的数据会让第一次渲染闪一下旧内容。

抽屉内是「基本信息 → 关联数据 → 操作」三段，危险操作固定在底部，不与主要信息混排。可编辑抽屉关闭时若内容有改动，先确认「放弃修改 / 继续编辑」。

**地址栏只有一个写者**：`useAdminUrlFilterSync`（筛选写回）与 `useAdminDetailParam`
（`?id=`）都基于 `window.location.search` 的**实时值**合并，不基于 hook 的
渲染快照。同一轮里两个写者先后落 URL 时，后一个拿到的快照里还没有前一个刚写
进去的键 —— 少了实时值，「从全部模型点编辑」跳回渠道时 `?id=` 会被冲掉，
编辑器永远打不开。

### 3.6 高危确认

两条路径，**不要混用**：

| 场景 | 组件 | 形态 |
| --- | --- | --- |
| 页面内高危动作（删除渠道、退款） | `ConfirmAction` | **贴底操作条，不是弹层** —— 运营要能一边看被影响的行一边确认后果。`impact` 逐条列出连带影响 |
| 跨页面复用的二次确认（离开未保存页、批量动作） | `useConfirm()` | shadcn Dialog；需要原因时聚焦输入框，原因写入审计 |

`ConfirmAction` 曾经被误改成 `AlertDialog`，是违反产品决策的：高危动作不许弹阻塞层。

**确认只属于业务动作，审计页面永远不弹确认。** 操作审计页只查询、展开和导出，导出也直接执行；审计只被动记录业务操作的动作、原因与结果，不能反过来要求用户确认审计本身。高危确认发生在其业务页面，原因由业务操作收集后写入审计。

### 3.7 指标卡

`primitives/layout.StatCard`：`Card` 承载，最小高 92px。数值 22px / 600 / `tabular-nums` —— 等宽数字才能让一排卡片上的数字对齐成列。警示变体走 `border-warn-soft` / `border-danger-soft` 淡底。

栅格用 `[grid-template-columns:repeat(auto-fit,minmax(170~190px,1fr))]`，不要写死 `2xl:grid-cols-5` —— 1440px 下断点不触发，5 张卡会排成 3+2。

### 3.8 批量条与结果

勾选后出现批量条（已选 N 项 + 动作 + 取消选择）。执行后 `BatchResultModal` 逐条展示，**失败项排最前**并带原因 —— 批量操作的失败是常态，只报成功数会让运营以为全都成了。

### 3.9 提示条

`primitives/display.Notice`：`Alert` 承载，五档 tone（`info` / `success` / `warn` / `danger` / `locked`）。`danger` 走 `role="alert"`，其余 `role="status"` —— 颜色不是唯一的严重性信号。

`StaleError` 是刷新失败但手上有旧数据时的提示条（`Alert` + 重试按钮），文案明确写出「下面是上一次成功获取的数据」。

## 4. 页面原型

34 个页面归为四类。同一类共享布局，只变列与操作，新增页面照原型走。

| 原型 | 页面 | 结构 |
| --- | --- | --- |
| 看板页 | 平台概览 | 值班条 + 指标卡栅格 + 趋势图 + 交易概览 + 最近任务列表 |
| 告警页 | 告警中心 | 级别统计卡 + 级别筛选 + 告警卡片列表 + 口径说明 |
| 列表页 | 用户 / 素材 / 任务 / 工单 / 订单 / 积分 / 优惠券 / 活动 / 邀请与签到 / 商品 / 能力消耗价 / 发票 / 支付订单 / 支付对账 / 操作审计 / 调用记录 / 数据备份 | 页头 → 筛选条 → 批量条（可选）→ 表格 → 分页；行操作走抽屉或确认条 |
| 配置页 | 系统设置 / 存储配置 / AI 标识 / 角色权限 / 能力管控 / 渠道工作台 / 前台模型 / 用户分组 / 定时任务 / 保留期清理 / 法务文档 / 站内消息 | 分区表单或页签；底部署固定操作条（保存 / 重置），渠道与前台模型用列表 + 抽屉 |
| 标签页 | 支付充值（支付渠道 / 充值商品 / 支付订单 / 支付对账） | 页头 → 提示条 → 分段页签（`SegmentedTabs`，`?tab=` 同步 URL）→ 每个标签自持数据与筛选 |

### 4.1 各页特殊约定

| 页面 | 约定 |
| --- | --- |
| 平台概览 | 首屏是 `DutyStrip`（值班条）：100 根产出刻度 + 四个计数 + 「接手最早异常」主动作；趋势图用 `TrendBarChart`（Recharts 真坐标轴，非 CSS 自绘） |
| 渠道工作台 | 主从布局：左列是**渠道导航与全部渠道级入口**（新建渠道 / 导入 / 导出全部 / 搜索 / 状态筛选 / 调整顺序），右侧选中渠道的详情内联模型清单（模态 / 协议 / 权重 / 优先级 / 价格档），模型编辑走弹窗；详情头部外露 编辑 / 复制 / 导出 / 停用·启用 / 删除 五个动作，停用与删除走 `ConfirmAction`（写明影响范围），导出只导配置不含凭证；健康列用 `StatusTag`，连通性测试在详情区发起；「全部模型」视图跨渠道平铺同一份数据 |
| 前台模型 | `AdminDataTable` + `Drawer`：模型 → revision → 线路三段；`simulate` 结果在抽屉内展开，不跳页 |
| AI 标识 | 左编辑、右预览两栏；上层是 CSS 还原的角标外观，下层是 Canvas 按服务端几何规则画在示例底图上的效果；关闭态预览显示「可见角标已关闭」而非空白；顶部开关配法律风险提示 |
| 能力管控 | 16 行能力表，下架必须填原因（表单内联校验，不是弹窗里的单行输入） |
| 支付充值 | 四标签共页，`?tab=` 同步 URL 且非法值回落到「支付渠道」；筛选是**草稿 → 应用**两段式（草稿改完点「查询」才生效，避免「改了没生效」的误判）；刷新只重取当前筛选下的数据，不重置筛选与分页；渠道配置抽屉里密钥字段是密码框 + 「留空即沿用」提示，身份字段禁用；对账页只展示结果、**不提供改钱入口** |
| 法务文档 | 版本列表 + 编辑器；已发布版本只读，改文本必须「另存为新版本」 |
| 数据备份 | 列表 + 校验结果列（SHA-256 通过 / 不通过），下载与删除分开两类按钮，删除走高危确认 |
| 保留期清理 | 先展示各目标可清理量，再允许执行；执行历史在下方日志区 |

## 5. 可达性

| 项 | 实现 |
| --- | --- |
| 跳链 | 首个可聚焦元素是「跳到主要内容」，指向 `#adm-main` |
| 键盘 | 搜索面板方向键选择、Enter 跳转、Esc 关闭；radix 浮层负责焦点锁定与归位 |
| 图标按钮 | 一律带 `aria-label` |
| 表格 | 表头 `scope="col"`，排序列给 `aria-sort`；展开行用 `aria-expanded` |
| 状态 | 颜色 + 文字双编码；`aria-live` 用于加载与结果提示 |
| 动效 | `prefers-reduced-motion: reduce` 时统一降级（`admin.css` 的 `@layer base`） |
| 对比度 | 正文与次要文字只在 `--text-strong` / `--text-muted` 之上 |

## 6. 已知限制

| 项 | 现状 |
| --- | --- |
| 移动端 | 不做适配；侧栏 ≤1280 折叠为图标栏，表格横向滚动 |
| 告警阅读状态 | 告警计数是「当前待处理数」，不记录谁点过；事项处理后自然消失，不提供「已读」标记 |
| 自定义主题 | 不支持；品牌色只由 `global.css` 的 `:root` 与 `admin.css` 的 `@theme inline` 决定 |
| 暗色模式 | 不支持。`shadcn add` 后的 `dark:` 变体由 `scripts/post-shadcn.mjs` 整段剥除 |

---

## 7. 组件分层

### 7.1 两层结构

| 层 | 路径 | 谁用 |
| --- | --- | --- |
| shadcn 原子件 | `admin-ui/components/ui/` | **只被 `primitives/` 引用**；页面不直连 |
| 组合件（唯一取用层） | `admin-ui/primitives/`（barrel：`primitives/index.ts`） | 全部后台页面 |

没有转发层：`admin-ui/shadcn`、`admin-ui/controls`、`admin-ui/widgets`、`components/admin/PageHeader|AdminWidgets` 均已删除，页面统一从 `primitives` 取件，primitives 直接包 shadcn 原子件。

### 7.2 组合件与原子件的对应

改观感只改组合件，不碰原子件：

| 组合件 | 底层原子件 |
| --- | --- |
| `Panel` / `StatCard` | `Card` / `CardHeader` / `CardDescription` / `CardContent` |
| `TextField` / `NumberField` | `Input` |
| `TextAreaField` / `SelectField` / `SwitchField` / `CheckboxField` | `Textarea` / `Select` / `Switch` / `Checkbox` |
| `Notice` / `StaleError` | `Alert` |
| `EmptyState` / `ListError` | `Empty`（`EmptyMedia` / `EmptyHeader` / `EmptyContent`） |
| `SegmentedTabs` | `Tabs` / `TabsList` / `TabsTrigger` |
| `Meter` | `Progress` |
| `PageSkeleton` / `SkeletonPanel` / `SkeletonBody` / `SkeletonStats` / `SkeletonCards` / `SkeletonTabs` / `SkeletonDutyStrip` / `Skeleton` | `Skeleton` / `Card` / `CardHeader` / `CardContent` / `TabsList` |
| `StatusTag` / `AdminDataTable` | `Badge` / `Table` |
| `ModalDialog` / `Drawer` / `RowMenu` | `Dialog` / `Sheet` / `DropdownMenu` |

`Panel` 的标题仍渲染原生 `h2`（不套 `CardTitle` 的 `div`）：分区标题的 heading
语义要留给读屏与 `getByRole('heading')` 的页面断言。

### 7.3 组合件目录

| 文件 | 内容 |
| --- | --- |
| `layout.tsx` | `PageHeader` / `Panel` / `StatCard` / `SaveBar` / `EmptyState` / `ListError` / `StaleError` |
| `form.tsx` | `FormField` / `TextField` / `TextAreaField` / `NumberField` / `SelectField` / `SwitchField` / `ClearableField` / `ActionButton` / `ToneBadge` / `SegmentedTabs` / `SegmentedGroup` |
| `display.tsx` | `FilterBar` / `FilterActions` / `AppliedFilters` / `StatusTag` / `Notice` / `Meter` / `Descriptions` / `Pagination` / `EmptyHint` |
| `skeleton.tsx` | `PageSkeleton` / `SkeletonPanel` / `SkeletonBody` / `SkeletonStats` / `SkeletonCards` / `SkeletonTabs` / `SkeletonDutyStrip` / `Skeleton` |
| `fields.tsx` | `CheckboxField` / `FilePicker` / `HelpTip` / `IconButton` / `ColorField` / `RangeField` / `SuggestField` |
| `table.tsx` | `AdminDataTable` |
| `overlay.tsx` | `ModalDialog` / `Drawer` / `ConfirmAction` / `RowMenu` |
| `drawer.tsx` | `AdminDrawer`（懒加载详情抽屉） |
| `batch-result.tsx` | `BatchResultModal` |
| `duty-strip.tsx` / `duty-tower.tsx` | 概览首屏的值班条与值班塔 |
| `chart.tsx` | `TrendBarChart`（Recharts） |

`SegmentedTabs` 与 `SegmentedGroup` 分开是刻意的：前者语义是「切到另一块内容」
（下面跟着 tabpanel），后者是「换过滤维度」（同一块区域换数据）。用错会让读屏用户
以为下面跟着面板。

### 7.4 令牌桥接

`styles/admin.css` 的 `@theme inline` 只做映射，不引入新颜色：

- `--background` / `--card` / `--popover` → `--card-bg`；
- `--foreground` → `--text-strong`；`--muted-foreground` → `--text-muted`；
- `--primary` → `--brand`（#5546d8）；`--accent` → `--brand-bg`（悬停淡底，**不是**品牌强调色）；
- `--destructive` → `--danger-text`；`--border` 直接沿用 `global.css` 的 `--border`；
- 业务语义色 `--success-*` / `--warn-*` / `--danger-*` → `global.css` 里对应的 `--success-*` / `--warn-*` / `--danger-*`。

两条必须记住的实现约束：

1. **`@theme inline`，不是 `@theme`**。普通 `@theme` 会把 `--color-primary` 写进
   `:root`，覆盖 C 端同名变量（`--color-border` 两处差 3 个色阶）。`inline` 不产出
   `:root` 声明，工具类直接内联 `var(--primary)`。
2. **没有 preflight**，裸 `border` 退回 `currentColor`，所以 `[data-slot]` 的描边
   兜底写在 `@layer base`（unlayered 会压过所有 `@layer`，`border-transparent` 就失效）。

新增 shadcn 语义色必须同时补 `admin-ui/lib/cn.ts` 的补登表，否则同名不同值的类
不会被判定为冲突（如 `shadow-card` 与 `shadow-none` 会同时生效）。

### 7.5 类名词汇

全站只有一套：**shadcn 语义类**（`bg-card` / `text-muted-foreground` / `border-border`
/ `bg-accent` / `text-brand` / `bg-success-soft`）。

页面不写裸色值：新颜色先在 `global.css` 的 `:root` 定义令牌，再在 `styles/admin.css`
的 `@theme inline` 桥接成 shadcn 语义变量。

### 7.6 底座与后处理

| 项 | 值 |
| --- | --- |
| 安装方式 | `npx shadcn@latest add <component>`，项目清单 `frontend/components.json` |
| 底座 | `style: "new-york"` → `radix-ui` 1.8.1（统一包） |
| 类名合并 | 官方 npm 包 `cn` 0.5.1（`createCn`） |
| 安装后处理 | `node scripts/post-shadcn.mjs` —— 剥 `dark:` 变体、改写 `cn` 导入路径、检查圆角档 |

组合写法是 radix 的 `asChild`。`shadcn add` 会连同底座一起装；**不要引回 `@base-ui/react`**。

### 7.7 样式入口

`styles/admin.css` 是后台唯一的样式入口，只被后台 chunk 导入，C 端不下载：

- 只引 `theme.css` + `utilities.css`（**无 preflight**）+ `tw-animate-css`；
- `@source` 白名单为 `admin-ui` / `pages/admin` / `components/admin` —— 新增后台目录必须补 `@source`，否则该目录的工具类不生成且构建不报错；
- base 规则限定 `.admin-root` / `.admin-portal`，不写全局元素选择器（唯一的例外是 `border: 0 solid` 兜底，必须全局，否则 portal 浮层会独自丢掉全部边线）。

## 8. 测试契约

### 8.1 e2e 钩子

后台共享控件与页面关键节点挂 `data-testid="admin-*"`；表单控件用 `aria-label`。
测试一律 `getByTestId` / `getByLabel` / 角色名，**不追 Tailwind 工具类**。

| 钩子 | 位置 |
| --- | --- |
| `admin-topbar` / `admin-sider` / `admin-nav-scroll` | 外壳 |
| `admin-panel` / `admin-stat-card` / `admin-save-bar` | 面板 / 指标卡 / 保存条 |
| `admin-filter` / `admin-filter-actions` / `admin-filter-chips` / `admin-filter-chip` | 筛选条 |
| `admin-table` / `admin-table-scroll` / `admin-table-row` / `admin-table-expanded` | 表格 |
| `admin-modal` / `admin-drawer` / `admin-confirm-action` / `admin-confirm-dialog` | 浮层 |
| `admin-toast` | 轻提示 |
| `admin-page-loading` / `admin-desc` | 骨架 / 键值描述 |
| `admin-bulk-bar` / `admin-channel-*` / `admin-storage-*` / `admin-asset-cell` / `admin-task-row` / `admin-alert-row` | 页面自有节点 |

### 8.2 单元测试

具名导入 / 导出对账（`src/test/namedImportAudit.ts`）：后台与 C 端共用一份实现。

这类错**单文件转译看不出来**（esbuild / tsc 单文件只校验语法），Vitest 也看不出来：
Vite 把具名导入改写成对命名空间的属性访问，缺失的名字只会是 `undefined`，不会报错。
所以直接读源码对账：凡 `import { A, B } from './相对路径'` 的每个名字，都必须能在目标模块的导出里找到。

### 8.3 验收方式

- `npx tsc --noEmit`：后台 0 错；
- `npx vitest run`：全量单测；
- `npx playwright test --config=playwright.admin.config.ts`：后台 e2e；
- `node scripts/sweep-admin.mjs`：34 条路由逐页打开，控制台错误 0；
- `node scripts/shot-admin.mjs`：概览 / 设置 / 渠道 / 用户 / 订单 / 积分 / 告警截图落 `/tmp`。
