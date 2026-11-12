# 后台界面规格

后台管理端 `/admin` 的视觉与布局规格：令牌、外壳几何、通用结构与页面原型。功能与接口见 `docs/admin-console-design.md` 与 `docs/admin-detailed-design.md`。

> **当前实现：shadcn/ui（`new-york` 风格，radix 底座）**，2026-11-02 推倒重建。
> 后台曾先后经历 antd、自建组件套件、shadcn 三轮换装，**前两轮的组件与样式已全部删除**，
> 仓库内不再有残留引用。历史决策过程见 `docs/README.md`；本文只写现状。
>
> 后台 31 个页面全部走 shadcn 原子件（`admin-ui/components/ui/*`），经 `admin-ui/primitives/*`
> 这一层组合件供给页面。C 端（前台）不复用这套组合件，页面只从 `frontend/src/ui` 兼容层取件；
> 该层底层同样复用 `admin-ui/components/ui` 的 shadcn/radix 原子件，**antd 已从依赖与源码中移除**。

| 项 | 事实源 |
| --- | --- |
| 外壳组件 | `frontend/src/admin-ui/shell/AdminBoardLayout.tsx` |
| 菜单数据 | `frontend/src/components/admin/adminNav.ts`（8 组 / 31 条） |
| 页面取用层 | `frontend/src/admin-ui/primitives/index.ts`（页面**只从这里**取件） |
| 基础件 | `frontend/src/admin-ui/components/ui/`（shadcn CLI 生成，`scripts/post-shadcn.mjs` 后处理） |
| 类名合并 | `frontend/src/admin-ui/lib/cn.ts`（官方 `cn` 包的 `createCn` + 项目 token 补登） |
| 状态色 | `frontend/src/components/admin/statusMeta.ts`（`STATUS_META`） |
| 样式 | `tokens.css` 的 `:root` 令牌 + `frontend/src/styles/admin.css`（后台 Tailwind 入口 + `@theme inline` 桥接） |
| 跨页微规格 | `docs/typography.md` |

---

## 0. 设计原则

| 原则 | 说明 |
| --- | --- |
| 令牌复用 | 只用 `tokens.css` 的 token，不写裸 hex；shadcn 语义类经 `admin.css` 的 `@theme inline` 桥接过来 |
| 密度优先 | 后台是长时间使用的工具，信息密度高于 C 端营销页；表格行高与间距取紧凑档 |
| 少装饰 | 无渐变、无插画，阴影仅用于浮层与卡片 |
| 操作可见 | 关键操作紧邻数据行，不藏进菜单深处 |
| 状态双编码 | 状态用色块 + 文字，不只靠颜色（色觉障碍可达性） |
| 反馈三态 | 任何拉取有加载 / 成功 / 失败三态，失败给可读原因与重试 |
| 一套组件 | 页面只从 `primitives` 取件；同一形态（如筛选条、表格）只有一份实现 |

## 1. 令牌

### 1.1 语义映射

后台页面写的是 shadcn 语义类，底层由 `admin.css` 的 `@theme inline` 映射到 `tokens.css` 的令牌：

| 用途 | shadcn 类 | 项目 token |
| --- | --- | --- |
| 页面底 | `bg-page` | `--page-bg` `#f6f7fb` |
| 卡片与面板 | `bg-card` | `--card-bg` `#ffffff` |
| 主色 | `bg-primary` / `text-brand` | `--brand` `#5546d8` |
| 悬停淡底 | `bg-accent` | `--brand-bg` `#f1efff` |
| 链接 | `text-brand` / 500 | `--brand` `#5546d8` |
| 正文 | `text-foreground` | `--text-strong` `#171a2b` |
| 次要文字 | `text-muted-foreground` | `--text-body` `#4e5969` |
| 描边 | `border-border` / `border-input` | `--border` `#e5e7ef` |
| 灰底块 | `bg-muted` / `bg-secondary` | `--surface` `#f2f4f7` |
| 成功 | `bg-success-soft` / `text-success-text` | `--success-soft-bg` / `--success-text` |
| 警告 | `bg-warn-soft` / `text-warn-text` | `--warn-bg` / `--warn-text` |
| 危险 | `bg-danger-soft` / `text-danger-text` | `--danger-soft-bg` / `--danger-text` |
| 卡片投影 | `shadow-card` | `--shadow-card`（`tokens.css` 定义，`cn.ts` 补登） |

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

外壳由 `admin-ui/shell/AdminBoardLayout` 实现，基于 shadcn `Sidebar` 组合，无值班带：

```
Sidebar 232px（折叠 60px，≤1280px 自动折叠；h-svh 全高）
├── 品牌头：56px，标记 + 「货觉AI 运营后台」
├── 导航：8 个分组（总览 / 运营 / 模型与渠道 / 交易 / 财务 / 内容与合规 / 系统 / 数据安全），可折叠，按权限点过滤；导航区自身滚动
└── 底：账号菜单（品牌紫头像 + 邮箱 / 角色，菜单含返回前台 / 退出登录）

SidebarInset（内容区）
├── Topbar 56px：折叠开关 + 分隔线 + 面包屑（分组 / 页面），右侧告警铃铛 + 环境标识
└── Content（.adm-content）：padding 18 / 26 / 56，子块铺满内容区（不设统一限宽），横向滚动限在该区内
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
| 顶栏 | 高 56px（`data-testid="admin-header"`），内容区顶部：折叠开关 + 面包屑（分组 / 页面），右侧告警铃铛与环境标识 |
| 导航滚动区 | `data-testid="admin-nav-scroll"`，自身滚动（`overflow-y-auto`），品牌头与底部账号菜单不参与 |
| 底部区 | 侧栏底、上边框分隔；账号菜单固定在底部，折叠态只留头像 |
| 分组标题 | 12px / 600 `text-muted-foreground` / `tracking-wider`，可点击折叠/展开；首次进入默认展开全部分组，之后沿用写入 `localStorage` 的用户偏好；侧栏折叠态隐藏标题并改用分隔线 |
| 菜单项 | 高 34px，圆角 8px，13px / 500 文字，padding `0 10px`，左侧 16px 图标 + 10px 间距 |
| 悬停 | 底 `bg-sidebar-accent`，字 `text-sidebar-accent-foreground` |
| 选中 | 底 `bg-sidebar-accent`、字 `text-sidebar-accent-foreground` / 600，左侧 3px 品牌色竖条 |
| 折叠态 | 只留图标并居中，`tooltip` 给全称；分组之间用分隔线代替标题；`Ctrl/Cmd + B` 与顶栏开关均可切换 |
| 规划项 | 标「待建」小胶囊（`planned` 字段） |

菜单按权限过滤：无权项不渲染，整组为空时整组隐藏。

### 2.3 顶栏右侧与账号菜单

| 项 | 规格 |
| --- | --- |
| 告警铃铛 | `AdminAlertBell`，角标是待处理事项数；点击展开最近告警，可跳对应页面 |
| 环境标识 | 灰底胶囊 + 橙点，**仅非生产显示**，避免误在生产执行测试操作 |
| 用户菜单 | 位于侧栏底部：品牌紫头像 + 邮箱 / 角色两行；展开后头部复显身份，菜单含返回前台、退出登录（危险色）；折叠态只留头像 |

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

`primitives/layout.PageHeader`：轻量标题卡，品牌色左边线定位；标题 + 副标题在左，操作在右。标题 `h1` / 20px / 600，副标题 13px `text-muted-foreground`（不截断 —— 它通常是一句话说明「这一页在管什么」）。操作区右对齐、可换行。

正文与表格链接默认使用品牌紫、500 字重；悬停显示下划线并转到 `--brand-hover`。整行可点击条目与图片链接用 `text-inherit no-underline` 保留其容器语义，不受该默认值影响。

### 3.2 FilterBar

`primitives/display.FilterBar`：筛选条与页头同宽，`flex-wrap` 自然换行，`FilterActions` 用 `ml-auto` 把「查询 / 重置」推到最右。`AppliedFilters` 独占一行（`basis-full`）回显已生效条件，每条可单独清除。

**文案口径**

- 带清除的下拉：触发器与菜单里的复位项写同一句「全部 + 字段」（`全部状态` / `全部类型` / `全部渠道`）。只写「全部」时，五个下拉并排就分不清哪一格管什么；只写「状态」时，触发器又看不出当前是「不筛」还是「筛了某个值」。`SelectField` 因此让 `placeholder` 缺省取 `clearLabel`，只写一处就不会写岔。
- 搜索框：直接列可搜字段，用 ` / ` 分隔（`券码 / 名称`、`商品编号 / 名称 / 供应商`），不加「搜索」前缀 —— 筛选条里的输入框本来就是搜索，前缀只是把有限的宽度用在废话上。可搜字段的顺序按运营的心智排（先精确的编号，再名称，最后描述性字段）。

**提交时机**

按控件性质分两档，不要在同一条筛选条里混用：

| 控件 | 时机 | 理由 |
| --- | --- | --- |
| 输入框 / 下拉 / 日期范围（服务端筛选） | **草稿 + 「查询」**（回车等价） | 五个条件逐个改动会连发五次请求；草稿态还让「已生效条件」与「正在编辑的值」分得开，`AppliedFilters` 芯片回显的是后者 |
| 分段控件、单选切换（告警级别、备份类型、视图切换） | 立即 | 一次点击就是一个决策，再加一个「查询」是多余的一步 |
| 纯客户端过滤（列表一次取全量，前端过滤） | 立即 | 不发请求，没有代价 |

一条筛选条只能有一种时机：工单页原先四个下拉是即选即生效、关键词却要按「查询」，而「查询」按钮实际上不管那四个下拉 —— 运营按了查询，以为是它生效的。下拉改成草稿后，`applyFilters` 一次提交全部条件。

芯片与草稿必须同源：清除芯片时同时清掉对应的草稿值，否则下拉还停在上一次选中的值，与列表对不上；从地址栏进入（`?status=open`）时草稿也要跟着走。

### 3.3 表格

`primitives/table.AdminDataTable` —— 排序、批量勾选上限、固定操作列、行展开、分页、密度只有这一份实现。

- 表格放在 `Panel` 内（白底卡片），表头 `bg-muted/40` + 12px / 600 `text-foreground`，行 hover `bg-muted/50`。
- 行高由单元格结构决定，**同一张表内必须一致**：单元格最多三行（主值 + 说明 + 标识），实测行高按 1 行 44px / 2 行 58~63px / 3 行 76px 分档。一行 198px 夹在一堆 58px 里，视线会被那一行截断 —— 那正是「标签逐个平铺」撑出来的。
- 贴着行数上限的内容必须折叠：标签列表（一个插件声明 8 个 Provider）只直显前两个 + 「+N」，悬停看全量与各自的注册状态；长文本用 `truncate` / `line-clamp-2` + `title`。**折叠的是展示，不是事实**：`+N` 的提示里要能看到被折掉的每一项及其状态。
- 名称与徽标同处一行时，名称 `min-w-0 truncate`、徽标 `shrink-0`：反过来写会把徽标挤出列外，或者逼名称换行把行撑高。
- 数值列：**单值**（金额、积分、条数、次数、耗时）`align: 'right'` + `tabular-nums`，让一列数字按个位对齐；**复合单元格**（金额 + 优惠说明、耗时 + 轮询次数）保持左对齐 —— 靠右的中文说明读起来是断的。
- 固定列（右侧操作列）用 `sticky right-0` + 不透明底色，否则内容会从列后透出。
- 操作列直显最多两个动作，其余收进 `RowMenu`（「更多」）。四个动作平铺会把操作列撑到 200px，右侧固定列抢走正文宽度。
- 行内动作按钮统一 `sm`（32px）：与 `RowMenu` 触发器（`icon-sm`，32px）等高，也与筛选条、工具栏的按钮同档。`xs`（24px）只用于抽屉、卡片、设置项这类非表格的密集场景 —— 表格里混用两档时，24px 的文字按钮旁边站一个 32px 的「⋯」，高度对不齐最扎眼。实测所有表行高 ≥44px，32px 按钮不会把行撑高。
- 高频动作留列上，低频与不可撤销的进菜单：插件表是「详情 / 启用停用」直显，「校验 / 卸载」收进菜单；任务表是「详情 + 重试·终止」直显，「删除」收进菜单。
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

**加载态按「真实内容是什么」分派，只有两条路：**

| 真实内容 | 加载态 | 谁负责 |
| --- | --- | --- |
| `<table>` / `AdminDataTable` | 表格骨架（真实列宽 + 行高 + 末尾「加载中…」） | **表格自己**：把 `loading` 传下去 |
| 卡片网格 / 面板列表 / 表单 | `SkeletonCards` / `SkeletonBody` | 页面或所在面板 |

两条禁令，都是现网踩过的：

- **面板里是表格时，不要在面板层再写一遍骨架。** `plugins` 与 `user-groups` 曾写 `loading && rows.length === 0 ? <SkeletonBody rows={4}/> : <XxxTable loading={loading}/>` —— 表格本来就自带骨架，这段短路让**更差的那个**永远生效：4 根 36px 等宽灰条既没有列宽、也没有行高，数据到位时整张表横竖都跳一次。删掉短路、让 `loading` 传到表格，形态立刻与另外 12 个表格页一致。
- **不许用一行「加载中…」当加载态。** 它只有 24px，真实内容是 N×56px 的列表项，等于没占位（`channels` 的供应商列表曾如此）。`TableSkeleton` 末尾的「加载中…」是**骨架的附注**，不是骨架本身。

`SkeletonBody` 的行高固定 36px，与表格行（44px 起）、列表项（56px 起）并不等值 —— 它占的是「大致位置」，不追求像素级同构；真正的像素级同构只有表格骨架做得到，这也是表格必须走自己那条路的原因。

### 3.5 详情浮层（抽屉 / 弹窗）

默认用 `AdminDrawer`，不跳独立路由。详情 id 与地址栏 `?id=` 同步，便于刷新与转发。内容需要并排区块、宽表格或大图预览时用 `AdminModal`（默认 960，任务详情 1120）—— 两者共用同一套取数生命周期，只是浮层形态不同。

`AdminDrawer` / `AdminModal` 自己拉数据（列表只带摘要字段），`children` 是**渲染函数**而不是元素：详情到达前根本不渲染空壳。关闭即清空 —— 下次打开的可能是另一条记录，留着上一条的数据会让第一次渲染闪一下旧内容。

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
| 页面内高危动作（删除渠道、退款） | `ConfirmDialog` | shadcn `AlertDialog` 组合壳（阻塞式弹窗）；`impact` 逐条列出连带影响 |
| 跨页面复用的二次确认（离开未保存页、批量动作） | `useConfirm()` | shadcn Dialog；需要原因时聚焦输入框，原因随业务动作提交 |

`ConfirmDialog` 只组合 AlertDialog 的标题 / 影响范围 / 附加表单 / 底部动作，弹层行为（焦点锁定、Esc、关闭后焦点归位）由 radix 提供。点击确认不自动关闭，由调用方在请求成功后再收起。`overlay.tsx` 不再保留手写的贴底确认条。

### 3.7 指标卡

`primitives/layout.StatCard`：`Card` 承载，最小高 92px。数值 22px / 600 / `tabular-nums` —— 等宽数字才能让一排卡片上的数字对齐成列。警示变体走 `border-warn-soft` / `border-danger-soft` 淡底。

栅格用 `[grid-template-columns:repeat(auto-fit,minmax(170~190px,1fr))]`，不要写死 `2xl:grid-cols-5` —— 1440px 下断点不触发，5 张卡会排成 3+2。

### 3.8 批量条与结果

勾选后出现批量条（已选 N 项 + 动作 + 取消选择）。执行后用 **toast 汇报成功 / 失败条数**，不再弹二次结果框 —— 批量动作在前置确认里已经确认过一次，失败时运营可回到列表按状态筛选处理。

### 3.9 提示条

`primitives/display.Notice`：`Alert` 承载，五档 tone（`info` / `success` / `warn` / `danger` / `locked`）。`danger` 走 `role="alert"`，其余 `role="status"` —— 颜色不是唯一的严重性信号。

`StaleError` 是刷新失败但手上有旧数据时的提示条（`Alert` + 重试按钮），文案明确写出「下面是上一次成功获取的数据」。

## 4. 页面原型

31 个页面归为四类。同一类共享布局，只变列与操作，新增页面照原型走。

| 原型 | 页面 | 结构 |
| --- | --- | --- |
| 看板页 | 平台概览 | 值班条 + 指标卡栅格 + 趋势图 + 交易概览 + 最近任务列表 |
| 告警页 | 告警中心 | 级别统计卡 + 级别筛选 + 告警卡片列表 + 口径说明 |
| 列表页 | 用户 / 素材 / 任务 / 工单 / 订单 / 积分 / 优惠券 / 活动 / 邀请与签到 / 商品 / 发票 / 支付订单 / 支付对账 / 调用记录 / 数据备份 | 页头 → 筛选条 → 批量条（可选）→ 表格 → 分页；行操作走抽屉或确认弹窗 |
| 配置页 | 系统设置 / 存储配置 / AI 标识 / 角色权限 / 能力与模型 / 模型商品 / 用户分组 / 定时任务 / 保留期清理 / 站内消息 | 分区表单或页签；底部署固定操作条（保存 / 重置），供应商用列表 + 抽屉，能力与模型用分组卡片 + 商品售卖抽屉 |
| 标签页 | 支付充值（支付渠道 / 充值商品 / 支付订单 / 支付对账） | 页头 → 提示条 → 分段页签（`SegmentedTabs`，`?tab=` 同步 URL）→ 每个标签自持数据与筛选 |

### 4.1 各页特殊约定

| 页面 | 约定 |
| --- | --- |
| 平台概览 | 首屏是 `DutyStrip`（值班条）：100 根产出刻度 + 四个计数 + 「接手最早异常」主动作；趋势图用 `TrendBarChart`（Recharts 真坐标轴，非 CSS 自绘） |
| 模型商品 | 默认「商品台账」：跨供应商平铺商品，列为 商品 / 供应商 / 类型 / 消费能力 / 健康 / 售价 / 状态 / 操作；顶部状态条可点筛选；新建供应商可选服务商预设（自动带 Base URL / 凭证字段名），保存后自动打开上游导入；弹窗可统一填类型 / 接入方式 / 售价；勾选商品后可批量上架 / 下架；行操作收进「编辑 + ⋯」。切到「供应商」视图是主从布局：左列供应商导航与渠道级入口，右侧详情内联商品清单（模态 / 接入方式 / 权重 / 优先级 / 售价）；商品编辑走弹窗；停用与删除走 `ConfirmDialog`；健康列、连通性测试与线路健康面板保留 |
| AI 标识 | 左编辑、右预览两栏；上层是 CSS 还原的角标外观，下层是 Canvas 按服务端几何规则画在示例底图上的效果；关闭态预览显示「可见角标已关闭」而非空白；顶部开关配法律风险提示 |
| 能力与模型 | 18 项能力按分组排成卡片网格；每卡直接展示运行状态、实现程度、能力上下线动作以及消费的模型商品，商品行展示用户实付、计费方式、可用商品数与编辑 / 测试消费 / 移除售卖动作；售卖配置走 `Drawer`，新建时可从商品台账选择可用商品并自动带入名称 / 编号 / 服务来源；消费测试结果在抽屉内展开。下线走 `ConfirmDialog` 列业务影响，下线原因统一生成并下发 C 端；孤儿售卖单元单独列在表格区，不因缺少能力定义而丢失 |
| 商品管理 | 统计卡 + 筛选条（关键词 / 状态 / 发放方式，客户端即时生效，`?status=` `?grantType=` `?q=` 同步 URL）+ 商品卡片网格 + 客户端分页；卡片自上而下为身份（SKU / 状态 / 名称 / 说明）、数字面板（积分 / 售价 / 划线价·折合单价）、规格行与页脚动作（编辑 / 上下架 / 删除），点卡片主体打开编辑抽屉；删除只对无历史订单的 SKU 生效，有订单时提示改为下架；统计卡始终基于完整目录，不随筛选变化 |
| 支付充值 | 五标签共页，`?tab=` 同步 URL 且非法值回落到「支付渠道」；筛选是**草稿 → 应用**两段式（草稿改完点「查询」才生效，避免「改了没生效」的误判）；刷新只重取当前筛选下的数据，不重置筛选与分页；渠道配置抽屉里密钥字段是密码框 + 「留空即沿用」提示，身份字段禁用；对账页只展示结果、**不提供改钱入口** |
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
| 对比度 | 正文与次要文字只在 `--text-strong` / `--text-body` 之上 |

## 6. 已知限制

| 项 | 现状 |
| --- | --- |
| 移动端 | 不做适配；侧栏 ≤1280 折叠为图标栏，表格横向滚动 |
| 告警阅读状态 | 告警计数是「当前待处理数」，不记录谁点过；事项处理后自然消失，不提供「已读」标记 |
| 自定义主题 | 不支持；品牌色只由 `tokens.css` 的 `:root` 与 `admin.css` 的 `@theme inline` 决定 |
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
| `SegmentedGroup` | `ToggleGroup` / `ToggleGroupItem`（`spacing={1}` 保持胶囊间隙） |
| `Meter` | `Progress` |
| `PageSkeleton` / `SkeletonPanel` / `SkeletonBody` / `SkeletonStats` / `SkeletonCards` / `SkeletonTabs` / `SkeletonDutyStrip` / `Skeleton` | `Skeleton` / `Card` / `CardHeader` / `CardContent` / `TabsList` |
| `StatusTag` / `AdminDataTable` | `Badge` / `Table` |
| `ModalDialog` / `Drawer` / `RowMenu` | `Dialog` / `Sheet` / `DropdownMenu` |
| `ChoiceButton`（AI 标识页） | `Toggle` |
| 筛选胶囊（商品状态条 / 失败错误码 / 模板标签 / 权限矩阵） | `Toggle` |
| 加载指示（按钮内 / 行内） | `Spinner` |

表格里的**文字入口**（工单标题、券码、供应商名）用 `Button variant="link"`，不要
裸 `<button>` + `hover:underline`：链接变体自带 `underline-offset`、focus ring 与
禁用态，颜色仍由 `text-brand` 覆盖。加载指示统一 `Spinner`，不要再手写
`Loader2 + animate-spin` —— 尺寸、`role="status"` 与旋转动画只维护一处。

反过来，**内容型触发器**（整卡点击层 `absolute inset-0`、图片缩略图、侧栏树节点、
标签胶囊）保持原生 `button`：`Button` 的固定高度、内边距与 `hover` 底色会把卡片
整块染色，套上去只能靠覆盖类打架，不如不套。

`Panel` 的标题仍渲染原生 `h2`（不套 `CardTitle` 的 `div`）：分区标题的 heading
语义要留给读屏与 `getByRole('heading')` 的页面断言。

### 7.3 组合件目录

| 文件 | 内容 |
| --- | --- |
| `layout.tsx` | `PageHeader` / `Panel` / `StatCard` / `SaveBar` / `EmptyState` / `ListError` / `StaleError` |
| `form.tsx` | `FormField` / `TextField` / `TextAreaField` / `NumberField` / `SelectField` / `SwitchField` / `ClearableField` / `ActionButton` / `ToneBadge` / `SegmentedTabs` / `SegmentedGroup` |
| `display.tsx` | `FilterBar` / `FilterActions` / `AppliedFilters` / `StatusTag` / `Notice` / `Meter` / `Descriptions` / `Pagination` |
| `skeleton.tsx` | `PageSkeleton` / `SkeletonPanel` / `SkeletonBody` / `SkeletonStats` / `SkeletonCards` / `SkeletonTabs` / `SkeletonDutyStrip` / `Skeleton` |
| `fields.tsx` | `CheckboxField` / `FilePicker` / `HelpTip` / `IconButton` / `ColorField` / `RangeField` / `SuggestField` |
| `table.tsx` | `AdminDataTable` |
| `overlay.tsx` | `ModalDialog` / `Drawer` / `ConfirmDialog`（shadcn `AlertDialog` 组合壳）/ `RowMenu` |
| `DetailDialog.tsx` | `AdminDrawer` / `AdminModal`（懒加载详情浮层，共用取数生命周期） |
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
- `--destructive` → `--danger-text`；`--border` 直接沿用 `tokens.css` 的 `--border`；
- 业务语义色 `--success-*` / `--warn-*` / `--danger-*` → `tokens.css` 里对应的 `--success-*` / `--warn-*` / `--danger-*`。

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

页面不写裸色值：新颜色先在 `tokens.css` 的 `:root` 定义令牌，再在 `styles/admin.css`
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
| `admin-header` / `admin-sider` / `admin-nav-scroll` | 外壳 |
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
- `node e2e/audit/sweep-admin.mjs`：32 条路由逐页打开，控制台错误 0；
- `node e2e/audit/shot-admin.mjs`：概览 / 设置 / 渠道 / 用户 / 订单 / 积分 / 告警截图落 `/tmp`。
