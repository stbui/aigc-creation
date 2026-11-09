# 后台角色化工作流改进设计

> 文档状态：**P0 已实施（对账保存视图未落地），P1 / P2 规划中**。已落地部分见下方「实施状态」；落地时以代码为准并同步回写 `admin-console-design.md` / `admin-prd.md`。
>
> 范围：后台管理端（`/admin`）的角色工作台、待办聚合、跨页上下文、快捷操作与批量动作。不新增业务能力，不改模型层、支付域与积分账本的资金规则。

## 实施状态

| 项 | 状态 | 代码落点 |
| --- | --- | --- |
| 统一待办 `GET /admin/workbench` | 已实施 | `backend/src/admin/workbench.{controller,service}.ts`、`alert-thresholds.ts` |
| 三种角色首屏与管理员视角切换 | 已实施 | `frontend/src/components/admin/WorkbenchContext.tsx`、`pages/admin/dashboard/AdminDashboardContent.tsx` |
| 工单行内认领、回复模板、内部备注、转交、上一条/下一条 | 已实施 | `pages/admin/tickets/*`、`backend/src/tickets/tickets.service.ts` |
| 上下文直达（工单 ↔ 订单、任务 ↔ 账单、告警 → 实体） | 已实施 | `frontend/src/lib/admin-context-link.ts`、各目标页 |
| 保存视图（工单 / 任务 / 订单 / 生成账单 / 发票） | 已实施 | `frontend/src/lib/admin-saved-views.ts`、`primitives/saved-view-bar.tsx` |
| 命令面板（导航 / 新建 / 视图） | 已移除（2026-11 外壳重建） | 后端 `GET /admin/search` 保留；前端 `GlobalSearch.tsx` / `admin-commands.ts` 已删除，入口未挂载 |
| 任务 `uncertain` 账单禁止重试 | 已实施（后端硬校验） | `backend/src/admin/tasks-admin.service.ts` |
| 告警页实体展开 | 已实施 | `pages/admin/alerts/page.tsx` + `WorkQueue` |
| 对账保存视图、任务同因聚合、批量工单/发票/对账、渠道影响预览、用户 360、快捷键 | P1 / P2，未实施 | 见下文分期 |

## 0. 结论

三句话：

1. **入口从「找模块」改为「处理待办」**：同一个 `/admin`，按 `admin / operator / finance` 三种角色渲染不同首屏，首屏直接给出可动作的队列，而不是先看总量再自己找页面。
2. **动作从「列表 → 详情 → 操作 → 返回」压成「队列直达 + 行内动作 + 返回来源」**：跨页链接携带 `intent` 与 `returnTo`，目标页把抽屉/弹窗准备好，执行完回到原队列。
3. **重复劳动从「每次重新筛选」改为「保存视图 + 命令面板 + 批量」**：高频筛选固化成视图，导航与新建走 `Cmd/Ctrl+K`，同类操作合并批量执行。

硬边界不变：工单仍然不能改钱；退款、积分调整、账单处置仍走原页面、原权限点、原校验与审计。角色工作台只是**视图与入口**，不是新的权限模型。

## 1. 现状与摩擦点

### 1.1 已经具备的能力

| 能力 | 现状 | 事实源 |
| --- | --- | --- |
| 角色与权限 | 三个内置角色，权限点实时查库，前端 `can()` 只隐藏按钮 | `backend/src/admin/permissions.ts:163` |
| 导航 | 8 个侧栏分组，按权限过滤；`ADMIN_MENU` 是单一事实源 | `frontend/src/components/admin/adminNav.ts:59` |
| 概览 | 已按「有无 `task.read`」在任务视角与财务视角之间切换 | `frontend/src/pages/admin/dashboard/AdminDashboardContent.tsx:72` |
| 告警 | 聚合工单/任务/对账/退款/备份/发票，按权限过滤，只报需要动作的状态 | `backend/src/admin/alerts.service.ts:75` |
| 全局搜索 | 后端接口保留；前端入口未挂载（2026-11 外壳重建移除） | `backend/src/admin/search.service.ts:52` |
| 深链 | 详情抽屉与地址栏 `?id=` 双向同步；列表筛选写回 URL | `admin-console-design.md` §3.14 |
| 批量 | 用户/素材/任务/订单支持 `≤100` 条串行批量，逐条返回 | `backend/src/admin/*.controller.ts` |
| 值班带 | 任务视角/财务视角的常驻计数，30 秒轮询，外壳与页面共享快照 | `frontend/src/components/admin/DutyContext.tsx` |

### 1.2 七处主要摩擦

以下步数按「从进入后台到动作完成」的用户可见交互计（点击、输入、开关抽屉）。

| # | 场景 | 现状 | 步数 | 根因 |
| --- | --- | --- | --- | --- |
| 1 | 工单回复 | 侧栏 → 工单 → 筛选待回复 → 找行 → 开抽屉 → 认领 → 输入 → 发送 | 8 | 首屏不给人待办；无回复模板；认领只在抽屉内 |
| 2 | 工单转退款 | 工单详情看到关联订单 → 复制订单号 → 订单页 → 搜索 → 开详情 → 退款 → 回工单 → 回复 | 10+ | 运营无 `order.refund`，也没有「转交财务」通道；跨模块靠人肉搬运 |
| 3 | 失败任务排障 | 任务页 → 筛失败 → 逐条开抽屉读错误码 → 关闭 → 重试 | 4/条 | 没有按 `errorCode` / 线路聚合；批量重试要手工勾选 |
| 4 | 财务日结 | 告警中心 → 支付 → 订单 → 发票 → 生成账单 → 财务分析 | 6 个页面 | 钱相关的待办分散在 5 个页面，没有单一「今天要处理的钱」 |
| 5 | 退款卡单确认 | 告警 → 订单列表（带筛选）→ 找行 → 开详情 → 确认退款结果 | 4 | 告警只给计数和列表链接，不给实体行与动作入口 |
| 6 | 管理员改线路 | 渠道工作台改配置 → 保存 → 去能力与模型检查影响 → 回概览看健康 | 5+ | 保存前没有影响面预览；健康状态与配置页分离 |
| 7 | 重复筛选 | 每次上班重新选状态/类型/优先级/归属 | 4 次选择 | 没有保存视图；搜索只能找实体，不能执行命令 |

另有安全缺口一处：任务详情会展示 `BillingOrder.status='uncertain'`（`frontend/src/pages/admin/tasks/TaskBillingOrders.tsx:75`），但重试入口不检查该状态。结果不明的任务重试会再次真实调用上游，属于二次计费风险。本方案把「账单未结清不得重试」列为 P0。

## 2. 设计原则与硬边界

| 原则 | 落地约束 |
| --- | --- |
| 一个 `/admin`，三种首屏 | 不新增侧栏入口；角色工作台是 `/admin` 的渲染分支，不是新页面 |
| 待办只从真实状态派生 | 不新增「已读」表；工单被回复、退款被确认、差异被处置后自然消失，延续告警中心口径 |
| 动作仍走原端点 | 工作台与命令面板只做跳转和预填；写操作仍由目标页面调用现有接口，权限、原因、二次确认、审计一个不少 |
| 工单不改钱 | 运营看到的退款入口是「转交财务」；财务在订单模块执行。订单模块仍是唯一资金动作入口 |
| 不做第二套列表 | 工作台每类只取前 5 条 + 总数，完整列表回到对应页面；搜索与列表的筛选口径不复制 |
| 权限只在后端定 | 新端点沿用 `AdminIdentityOnly` + service 内按权限过滤；前端 `can()` 只决定展示 |
| 不引入自定义角色 | 仍只有 `admin / operator / finance`，角色工作台不改变权限矩阵 |
| 组件只从 primitives 取 | 新组件落 `admin-ui/primitives`（平铺文件或并入 `display.tsx` / `table.tsx`），由 `primitives/index.ts` 导出；页面不直连 `components/ui` |

## 3. 角色工作台

### 3.1 角色 × 首屏

| 角色 | 首屏要回答的问题 | 默认队列 | 主操作 | 明确不做 |
| --- | --- | --- | --- | --- |
| `operator` | 今天还有哪些用户/任务没人管？ | 待回复工单、我处理中的工单、近 24h 失败任务、冷却线路、待处置素材 | 认领、模板回复、批量重试、下架素材、转交财务/管理员 | 退款、调价、改渠道、删用户 |
| `finance` | 今天哪些钱需要我确认或处置？ | 退款卡单、对账差异、待开票、待付超时订单、`uncertain` 生成账单、支付异常 | 退款、确认退款结果、对账处置、开票、账单结算/退款 | 改线路、删用户、改系统设置 |
| `admin` | 系统哪里不健康、哪里有配置风险？ | 上述全部 + 渠道冷却/协议未注册、能力不可用、备份未验证、定时任务失败、今日高危审计 | 配置、授权、备份、影响预览、转交 | 无（高危动作仍需二次确认与原因） |

`admin` 拥有全部权限，但不应被迫用运营视角工作。首屏额外给「控制塔」区块；`operator` / `finance` 只看到与自身动作相关的队列。

### 3.2 运营工作台

首屏结构：

1. **待办队列**（左 62%）：工单、失败任务、素材处置，按紧急度排序，每行带「年龄」与主操作。
2. **我的处理中**（右 38%）：`assigneeId=me` 且 `status=processing` 的工单，以及本班次已重试/已下架的任务摘要。
3. **线路健康（只读）**：冷却中的渠道模型、协议未注册的线路。运营没有写权限，只能看到「已自动切线 / 需要管理员处理」的结论，不提供测试按钮。
4. **产出条**：保留现有最近产出缩略图，用于确认服务在正常出图。

默认筛选：

- 工单：`status=open & assigneeId=unassigned`，按 `createdAt` 升序（最老的先处理）。
- 我处理中：`status=processing & assigneeId=me`。
- 失败任务：`status=failed & createdAt>=now-24h`，按 `errorCode` 聚合。

### 3.3 财务工作台

首屏结构：

1. **资金待办**：退款卡单、对账差异、待开票、`uncertain` 账单、支付异常，按「金额 × 年龄」排序；每行显示金额、账龄、关联订单/任务。
2. **待付与待确认**：超过支付窗口仍未支付的订单、渠道异步退款需人工确认的订单。
3. **今日收付**：复用现有 `FinanceGrid`（实收、退款、净收入、挂账），不新增口径。
4. **对账入口**：直接带 `tab=reconciliation` 与「待处置」筛选进入，不先看批次列表。

财务首屏不展示任务成功率、能力分布等运营指标；这些在运营工作台与概览下方折叠区。

### 3.4 管理员控制塔

首屏结构：

1. **服务健康**：渠道冷却、协议未注册、能力 `unavailable`、定时任务最近失败、备份未验证/过期、存储水位。
2. **配置漂移**：前台模型无线路、线路指向未注册协议、能力无可用模型、渠道模型权重全为 0。每项给「去修复」深链。
3. **今日风险**：高危权限动作计数（退款、积分调整、角色变更、渠道写入），点击进操作审计并带 `from=今天` 筛选。
4. **角色工作台预览**：管理员可切换查看运营/财务首屏，用同一套数据检查队列是否为空。

其中「服务健康」的渠道冷却与协议注册状态来自 `DutyContext` / 模型层接口，不在工作台端点里重复查询；工作台只负责工单、任务、退款、对账、发票、账单、备份这七类可落 SQL 的待办。

### 3.5 管理员视角切换

- 顶栏增加「视角：管理员 / 运营 / 财务」分段控件，仅 `admin` 可见。
- 切换只影响 `/admin` 首屏布局与默认队列，**不改变权限**：所有写操作仍按当前账号真实权限校验。
- 非 `admin` 角色即使手工拼 `?view=admin`，后端也按真实角色返回，不放大数据范围。
- 视角选择存 `localStorage`（键 `huojue.admin.view.<userId>`），不落库。

### 3.6 首屏版式示意

运营：

```text
┌──────────────────────────────────────────────────────────────┐
│ 今日待办 6 项 / 2 紧急                     [刷新] [保存视图] │
├────────────────────────────────┬─────────────────────────────┤
│ 待回复工单 12   最老 3h        │ 我的处理中 3                │
│ · T2026… 退款未到账 2h [认领]  │ · T2026… 处理中             │
│ · T2026… 图片未生成 4h [认领]  │ · T2026… 待用户补充         │
├────────────────────────────────┴─────────────────────────────┤
│ 近 24h 失败任务 8   错误码聚合 [批量重试]                    │
│ 线路健康：2 条冷却 / 0 条协议缺失（只读）                    │
│ 最近产出缩略图 …                                             │
└──────────────────────────────────────────────────────────────┘
```

财务：

```text
┌──────────────────────────────────────────────────────────────┐
│ 今日资金待办 5 项 / ¥12,480                   [刷新]        │
├──────────────────────────────────────────────────────────────┤
│ 退款卡单 2 笔 ¥680   最老 5h      [逐笔确认]                 │
│ 对账差异 3 笔 ¥1,200             [进入对账]                 │
│ 待开票 4 张 ¥2,300              [进入发票]                 │
│ 待付超时 6 单 ¥3,200            [进入订单]                 │
│ 账单结果不明 1 笔 ¥99           [进入生成账单]             │
├──────────────────────────────────────────────────────────────┤
│ 今日收付：实收 / 退款 / 净收入 / 挂账（复用 FinanceGrid）    │
└──────────────────────────────────────────────────────────────┘
```

管理员：

```text
┌──────────────────────────────────────────────────────────────┐
│ 系统控制塔                     [视角：管理员/运营/财务]      │
├──────────────────────────────────────────────────────────────┤
│ 服务健康：1 条渠道冷却 / 1 个能力不可用 / 备份未验证         │
│ 配置漂移：2 个前台模型无线路 / 1 条线路协议未注册            │
│ 今日风险：高危动作 7 次（退款 3 / 积分调整 2 / 渠道写入 2）  │
├──────────────────────────────────────────────────────────────┤
│ 待办队列：工单 / 任务 / 退款 / 对账 / 发票 / 账单 / 备份     │
└──────────────────────────────────────────────────────────────┘
```

## 4. 三项横向能力

### 4.1 统一待办 `GET /admin/workbench`

告警中心解决「有什么坏了」，工作台解决「先做哪一件」。两者共用同一批查询，避免阈值与计数漂移。

**接口形状**

```ts
interface AdminWorkbench {
  generatedAt: string;
  roleView: "admin" | "operator" | "finance";
  groups: AdminWorkGroup[];
}

interface AdminWorkGroup {
  key:
    | "ticket"
    | "task"
    | "refund"
    | "reconciliation"
    | "invoice"
    | "billing"
    | "backup";
  label: string;
  severity: "critical" | "warning" | "info";
  /** 全量待处理数，不是 items.length */
  count: number;
  /** 涉及金额（分），没有金额语义的组省略 */
  amountCents?: number;
  oldestAt?: string;
  /** 完整列表入口 */
  link: string;
  /** 每类最多 5 条，按紧急度排序 */
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    meta?: Array<{ label: string; value: string; tone?: "danger" | "warn" | "muted" }>;
    /** 带上下文的目标页 */
    target: { path: string; intent?: string };
  }>;
}
```

**数据来源与动作**

| 组 | 查询口径 | 行内容 | 目标页 |
| --- | --- | --- | --- |
| `ticket` | `status=open`，最老优先 | 工单号、标题、等待时长、优先级 | `/admin/tickets?id=&intent=handle` |
| `task` | 近 24h `status=failed` | 能力、`errorCode`、用户、任务 ID | `/admin/tasks?id=&intent=retry` |
| `refund` | `Refund.status=processing` 且超过 30 分钟 | 订单号、金额、账龄 | `/admin/orders?id=&intent=confirmRefund` |
| `reconciliation` | `PaymentReconciliationItem.result NOT IN ('matched','recovered')` | 商户订单号、差异类型、金额 | `/admin/payments?tab=reconciliation&item=` |
| `invoice` | `status=pending`，区分被退款阻断 | 发票号、金额、阻断原因 | `/admin/invoices?id=&intent=issue` |
| `billing` | `BillingOrder.status=uncertain` | 任务、能力、金额、账龄 | `/admin/billing-orders?id=&intent=settle` |
| `backup` | 最近失败/超过 48h/未验证 | 无实体行，只给摘要 | `/admin/backups` |

渠道健康（冷却、协议未注册、能力不可用）**不进工作台聚合查询**：管理员首屏直接复用 `DutyContext` 的渠道快照与 `/admin/capabilities` 的运行状态。协议注册表与进程内冷却只有模型层能判定，放进工作台等于在 admin 域重写一套判定，必然漂移。

**实现约束**

- 阈值抽到 `backend/src/admin/alert-thresholds.ts`；`/admin/alerts` 与 `/admin/workbench` 各自查询，但窗口、分界值与每类条数共用同一份常量，不各写一套。
- 控制器用 `@AdminIdentityOnly()`，service 内按权限过滤来源；`view` 参数只影响 `roleView` 与展示分组，不扩大查询范围。
- 每类 `items` 最多 5 条；完整列表仍由各页面分页接口提供。
- 只读，无写操作；所有动作是带 `intent` 的跳转。
- 30 秒内存缓存，键为 `role + view`；首屏与告警页的实体区块共用 `AdminWorkbenchProvider`，告警铃铛与计数继续读 `/admin/alerts`。两边的阈值都来自 `alert-thresholds.ts`，不各算一套。

**前端**

- 外壳挂 `AdminWorkbenchProvider`（类似 `DutyContext`），60 秒轮询，页面隐藏时暂停；铃铛、`/admin`、`/admin/alerts` 共用。
- 新增 `primitives` 中的 `WorkQueue` / `QueueRow`（平铺文件 `work-queue.tsx`，从 barrel 导出）：统一「严重度色条 + 主标题 + 元信息 + 主操作」的行样式。
- 首屏只渲染当前角色有权查看的组；空组不渲染，避免「0 条待办」的噪音。

### 4.2 上下文直达

**URL 契约**

| 参数 | 含义 | 允许值 |
| --- | --- | --- |
| `id` | 目标实体 id，沿用现有详情深链 | 各页面已支持的实体 id |
| `intent` | 打开后要聚焦的动作 | `handle` / `retry` / `confirmRefund` / `refund` / `settle` / `issue` / `reject` / `hide` / `assign` |
| `from` | 来源，用于返回与结果回写 | `ticket:<id>` / `task:<id>` / `alert:<key>` |
| `returnTo` | 返回地址，仅站内绝对路径 | 以 `/admin/` 开头，禁止 `//` 与外部 origin |

**行为**

1. 目标页加载完实体后，按 `intent` 打开对应抽屉/弹窗，并预填可推导字段：
   - 订单退款：金额默认「可退上限」，原因空；不自动提交。
   - 生成账单处置：选中 `settle` 或 `refund` 页签，展示任务全链路摘要。
   - 工单：展开详情，高亮「认领」；不自动认领（打开页面不应产生写操作）。
   - 任务重试：打开确认框，但 `billing.uncertain` 时禁用并说明原因。
2. 目标页顶部显示 `ContextBanner`：`来自工单 T2026… · 目标：退款` + 「返回来源」。`returnTo` 为空时只显示来源。
3. 动作成功后：
   - 若 `returnTo` 存在，跳回来源并在来源页顶部显示结果条（`?done=refunded`），由来源页渲染「已退款 ¥xx」。
   - 若无 `returnTo`，保持现状：留在目标页并刷新。
4. `returnTo` 与 OAuth 的 `returnTo` 同规则：只接受站内绝对路径，长度上限 512，拒绝 `//`、`http:`、`javascript:`。
5. 权限不足时**不隐藏入口**，而是显示「需要财务权限」+「转交财务」；避免运营看到一个不存在的动作。

**跨角色转交（工单 → 财务）**

现状：运营没有 `order.refund`，工单详情只能看关联订单，退款要靠线下沟通。方案：

- 后端 `TicketReply` 增加 `visibility`（`public` / `internal`，默认 `public`）。内部备注不推送给用户，C 端工单详情不返回。
- 工单详情增加「转交财务」：
  1. 写一条内部备注，模板自动带入订单号、金额、用户诉求；
  2. `assigneeId` 指向启用中的财务账号（`GET /admin/tickets/assignees` 返回后台账号 id/名称/角色）；
  3. 状态置 `processing`（已有状态机允许的边）。
- 财务工作台出现「指派给我的工单」，点进即可看到内部备注和订单直达 `intent=refund`。
- 工单仍然不改钱：转交只是把人和上下文交出去，资金动作在订单模块完成。

完整动线：

```text
运营：工作台/工单 → 转交财务（内部备注 + 指派 + processing）
财务：工作台「指派给我」→ 工单详情 → 关联订单 → 退款弹窗（金额预填）
系统：退款成功 → 返回工单 → 结果条「已退款 ¥xx」+ 内部备注草稿
运营：确认草稿 → 回复用户 → 工单 resolved
```

### 4.3 命令面板、保存视图与快捷键

> **状态（2026-11-09）**：外壳重建后顶栏搜索与命令面板入口已移除，`GlobalSearch.tsx` 与 `lib/admin-commands.ts` 已删除。本节保留为重新接入时的设计依据，不代表当前界面；保存视图与深链部分仍为现状。

**命令面板（在现有 GlobalSearch 上扩展，不新建第二套搜索）**

- 默认模式：实体搜索，沿用 `/admin/search?q=`。
- `>` 前缀：命令模式。命令来自前端静态注册表 `frontend/src/lib/admin-commands.ts`，每项声明 `{ key, title, keywords, permission, path }`。
- 命令分三类：
  - 导航：跳转到任意有权限的侧栏页；
  - 新建：`新建商品` `新建优惠券` `新建活动` `发送站内消息` `手动备份`（目标页用 `?create=1` / `?action=backup` 打开表单）；
  - 视图：应用保存视图（如「待回复工单」「退款卡单」）。
- 命令只做跳转，不直接执行写操作；写操作仍需在目标页确认。
- 最近访问的页面与实体存 `localStorage`，空查询时展示。
- 命令的 `permission` 只用于前端过滤，后端仍逐请求校验。

**保存视图**

- 每页筛选条右侧增加 `SavedViewBar`：内置视图 + 「保存当前筛选」+ 删除。
- 存储：`localStorage`，键 `huojue.admin.views.<userId>.<pageKey>`，值 `{ id, name, filters, createdAt }[]`。与侧栏展开态一样，属于本机偏好，不落库。
- 内置视图（代码常量，不占用户存储）：

| 页面 | 内置视图 |
| --- | --- |
| 工单 | 待回复（`open` + 未指派）、我处理中（`processing` + 我）、高优先级 |
| 任务 | 近 24h 失败、执行中积压、账单结果不明（需新增 `errorCode` 筛选） |
| 订单 | 渠道退款处理中、待支付超时 |
| 支付对账 | 待处置差异 |
| 发票 | 待开具、被退款阻断 |
| 生成账单 | `uncertain` |
| 操作审计 | 今日高危动作 |

- 相对时间视图（「近 24h」）在点击时计算具体时间，不存死日期。
- 应用视图等价于设置现有筛选并走 `useAdminUrlFilterSync`，地址栏仍可分享。

**快捷键**

| 键 | 行为 | 范围 |
| --- | --- | --- |
| `Cmd/Ctrl+K` | 打开命令面板 | 全局 |
| `?` | 快捷键帮助 | 全局，输入框聚焦时禁用 |
| `g` 然后 `u/t/k/o/p/i` | 依次跳转用户/任务/工单/订单/支付/发票 | 全局，输入框聚焦时禁用 |
| `j` / `k` | 下一条/上一条 | 工单、任务列表 |
| `Enter` | 打开当前行 | 工单、任务列表 |
| `Esc` | 关闭抽屉/弹窗 | 全局 |
| `Cmd/Ctrl+Enter` | 提交回复/确认弹窗 | 工单抽屉、退款确认 |

快捷键统一在 `AdminBoardLayout` 的 provider 内实现，`input` / `textarea` / `contenteditable` 聚焦时全部禁用，避免与输入冲突。

## 5. 按域流程改造

### 5.1 工单 `/admin/tickets`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 行内认领 | 列表行直接「认领」，调用现有 `PATCH /admin/tickets/:id`，不打开抽屉 | P0 |
| 回复模板 | 抽屉内模板下拉，支持 `{name}` `{orderNo}` 变量；P0 用代码常量，P1 落表可编辑 | P0 |
| 内部备注 | `TicketReply.visibility='internal'`，不推送、不下发 C 端；用于转交与交接 | P0 |
| 转交财务 | 内部备注 + 指派财务 + `processing`，财务工作台可见 | P0 |
| 上一条/下一条 | 抽屉内按当前筛选队列切换，关掉抽屉才回列表；减少「关-找-开」 | P0 |
| 批量指派/流转 | `POST /admin/tickets/batch`，动作 `assign` / `status`，`ids ≤ 100`，逐条审计 | P1 |
| 指派下拉 | `GET /admin/tickets/assignees` 返回启用中的后台账号，替代只能「认领自己/取消」 | P0 |
| 关联订单动作 | 关联订单卡片增加「转交退款」；财务打开订单时带 `intent=refund` | P0 |
| 回复后结果条 | 从订单返回工单时显示「已退款 ¥xx」，并预填一条内部备注草稿（不自动发送） | P0 |

步数变化：回复 8 → 3；转交退款 10+ → 运营 2 步 + 财务 3 步。

### 5.2 任务 `/admin/tasks`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| `uncertain` 重试保护 | 任务存在 `BillingOrder.status='uncertain'` 时禁用重试，提示「先结算/退款账单」，避免二次计费 | P0 |
| 同因聚合 | 顶部按 `errorCode` / 能力 / 线路聚合失败数，点击即筛；批量重试只作用于同组 | P1 |
| 行内重试 | 失败行直接「重试」，保留详情入口；仍走确认框 | P1 |
| 抽屉动作条 | 底部固定「重试 / 终止 / 查看账单 / 查看调用 / 复制诊断信息」，不用滚到抽屉底部找按钮 | P1 |
| 账单结果不明直达 | 抽屉内 `uncertain` 账单卡直接跳生成账单并带 `intent=settle` | P0 |
| `errorCode` 筛选 | 任务筛选支持错误码，配合内置视图「结果不明」 | P1 |

步数变化：单条排障 4 → 2；同因批量 4×N → 2。

### 5.3 订单与退款 `/admin/orders`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 退款原因模板 | 常用原因（用户申请、重复支付、服务未交付）下拉，可编辑；仍要求最终原因非空 | P0 |
| 退款预填 | 已有「可退上限」预填，补充「剩余可退」「已退金额」「关联工单」 | P0 |
| 退款结果返回 | 从工单来则跳回工单并显示结果条；没有来源则留在详情 | P0 |
| 渠道退款确认入口 | 财务工作台直接打开「确认已退款/确认失败」弹窗，减少列表定位 | P0 |
| 行内动作 | 列表行提供核销/退款/查看；高危动作仍走确认与原因 | P1 |
| 批量退款 | 不做：每单金额与可退上限不同，合在一个弹窗必出错 | 不做 |

### 5.4 支付对账 `/admin/payments?tab=reconciliation`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 差异优先 | 默认落在「待处置差异」，批次列表作为次级页签 | P1 |
| 逐笔直达 | 差异行直接打开订单/支付详情，不需要先复制订单号 | P1 |
| 批量处置 | `POST .../items/batch`，只允许财务，统一原因，逐条结果与审计 | P1 |
| 键盘连点 | `j/k` 切换差异，`Enter` 处置；适合一次核对几十笔 | P2 |

### 5.5 发票 `/admin/invoices`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 待办分组 | 「可开具」「被退款阻断」「已开具」三组，阻断单给原因 | P1 |
| 行内开具/驳回 | 洁净单行内开具；驳回要求原因；被阻断单禁用并说明 | P1 |
| 批量开具 | 只对通过现有校验的洁净单生效，逐条返回；有阻断单时整批跳过并提示 | P1 |
| 订单直达 | 发票行直接打开订单详情，核对 `paidCents - refundedCents` | P1 |

### 5.6 生成账单 `/admin/billing-orders`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| `uncertain` 优先 | 默认排序把待人工核对放最前，显示账龄与金额 | P0 |
| 证据链 | 账单详情并列展示任务全链路、线路尝试、模型调用摘要 | P0 |
| 结算/退款 | 沿用现有动作与原因必填；操作后回到来源任务（若从任务来） | P0 |
| 批量处置 | 不做：属于资金动作，逐单确认 | 不做 |

### 5.7 用户 `/admin/users`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 用户 360 | 详情抽屉增加订单/积分/任务/工单/素材的最近记录与直达入口 | P1 |
| 上下文入口 | 从工单、订单、任务点用户时，带 `?id=&tab=orders` 等意图打开对应区块 | P1 |
| 批量启停 | 已有；补充「影响面预览」（项目/素材/任务数量）后再确认 | P2 |

### 5.8 渠道与模型 `/admin/channels`、`/admin/capabilities`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 影响面预览 | 停用/删除渠道前展示：受影响渠道模型、前台模型/线路、能力、近 24h 调用量 | P1 |
| 健康直达 | 冷却/协议未注册/能力不可用的摘要点击直达具体渠道模型或线路编辑 | P1 |
| 变更后核对 | 保存成功后就地显示「受影响能力及当前 `effective`」，不用再跳能力页 | P1 |
| 测试全部冷却线路 | 只探测、不写配置，`channel.test` 权限；避免逐条点 | P2 |

### 5.9 告警中心 `/admin/alerts`

| 改动 | 说明 | 优先级 |
| --- | --- | --- |
| 分组 | 按工单/任务/资金/系统分组，保留现有严重度筛选 | P0 |
| 展开实体 | 每组展开前 3 条实体行，带目标页与动作意图；完整列表仍走链接 | P0 |
| 与工作台同源 | 告警页与工作台共用 `alert-thresholds.ts`，不各算一套阈值 | P0 |
| 不引入已读 | 事项被处理后自然消失；「我今天看过」不是状态 | 不做 |

## 6. 信息架构与导航

- `ADMIN_MENU` 保持单一事实源，不因角色工作台增删菜单项。
- 侧栏仍按权限过滤；`operator` / `finance` 看不到无权模块，不在侧栏制造灰项。
- `admin` 的侧栏不做裁剪；通过 `/admin` 首屏与命令面板降低「几十个页面里找一页」的成本。
- 不在 P0 增加「常用」动态分组；P2 如确有需要，用本地偏好渲染在侧栏顶部，条目引用现有路径 + 查询，不改 `ADMIN_MENU` 的类型与语义。
- 面包屑、页面标题、路由不变；角色工作台只是 `/admin` 的内容分支。

## 7. 技术设计

### 7.1 后端接口

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /admin/workbench` | `AdminIdentityOnly`，service 内按权限过滤 | 角色首屏与铃铛共用的待办快照；`?view=operator 或 finance` 仅 `admin` 可用，只改展示不改查询范围 |
| `GET /admin/alerts` | 不变 | summary 形态保持兼容；阈值改用 `alert-thresholds.ts` |
| `GET /admin/tickets/assignees` | `ticket.handle` | 启用中的后台账号（id/name/role），供指派与转交 |
| `POST /admin/tickets/batch` | `ticket.handle` + 处理器内动作权限 | 批量指派/流转，`ids ≤ 100`，串行、逐条审计 |
| `POST /admin/invoices/batch` | `invoice.write` | 批量开具/驳回，洁净单才执行 |
| `POST /admin/payments/reconciliations/items/batch` | `finance.reconcile` | 批量处置差异，原因必填 |
| `GET /admin/channels/:id/impact` | `channel.read` | 渠道停用/删除的影响面 |
| `GET /admin/logical-models/:id/impact` | `logical_model.read` | 模型下线/停用的影响面 |
| `GET /admin/search` | `data.search` | 增加发票号、生成账单 ID 两组；仍按各域读权限裁剪 |

所有新写接口遵循现有约定：`{ code, data, message }` 信封、`AppError`、批量串行不包事务、逐条返回 `{ id, ok, message?, data? }`。

### 7.2 数据模型

| 变更 | 内容 | 原因 |
| --- | --- | --- |
| `TicketReply.visibility` | `String @default("public")`，取值 `public` / `internal` | 转交与内部交接；C 端只返回 `public` |
| `Refund` 索引 | `@@index([status, createdAt])` | 工作台与告警每 60 秒查「processing 超过 30 分钟」 |
| `TicketReplyTemplate`（P1） | `id / title / content / sortOrder / enabled / updatedAt` | 回复模板可维护；P0 先用代码常量 |
| `AdminPreference`（P2，可选） | `userId + key + valueJson` | 仅在需要跨设备保存视图时引入；P0 用 `localStorage` |

不做：不改订单、支付、退款、积分、账单表；不新增余额或状态字段。

### 7.3 前端模块

| 模块 | 落点 | 说明 |
| --- | --- | --- |
| 工作台数据 | `frontend/src/components/admin/WorkbenchContext.tsx` | 60 秒轮询，首屏与告警页实体区块共享；铃铛继续读 `/admin/alerts` |
| 角色首屏 | `frontend/src/pages/admin/dashboard/AdminDashboardContent.tsx` | 用 `roleView` 分支替代当前 `isFinance` 二元判断；复用现有 widgets |
| 待办行 | `admin-ui/primitives/work-queue.tsx`（`WorkQueue` + `QueueRow`） | 统一严重度、元信息、主操作 |
| 上下文条 | `admin-ui/primitives/context-banner.tsx` | 来源、目标、返回 |
| 保存视图 | `admin-ui/primitives/saved-view-bar.tsx` + `lib/admin-saved-views.ts` | localStorage + 内置视图常量 |
| 命令面板 | `admin-ui/shell/GlobalSearch.tsx` 扩展 + `lib/admin-commands.ts` | 不新建第二套搜索 |
| 快捷键 | `admin-ui/shell/AdminShortcutsProvider.tsx` | 全局注册，输入框聚焦时禁用 |
| 结果条 | `admin-ui/primitives/action-result-banner.tsx` | `?done=` 渲染，不自动消失（需人确认） |
| 链接构造 | `lib/admin-context-link.ts` | `buildContextLink({ path, id, intent, from, returnTo })`，统一编码与白名单校验 |

页面改动集中在 `pages/admin/{tickets,tasks,orders,payments,invoices,billing-orders,users,channels}/`，不新建路由。

### 7.4 权限与审计

- 不新增权限点；沿用 `ticket.handle`、`order.refund`、`finance.reconcile`、`invoice.write`、`billing_order.resolve`、`channel.*`、`logical_model.*`。
- 工作台返回的 `items` 不含无权字段；`actions` 只给有权限的入口，但前端隐藏不作为安全边界。
- 批量动作逐条写 `AdminAuditLog`，与现有 `runBatch` 口径一致；不写一条汇总日志替代逐条记录。
- 高危动作继续要求原因：退款、积分调整、账单处置、角色/设置变更；工单转交本身不是资金动作，写普通审计即可。
- 内部备注写审计时只记录「写了一条内部备注」，不把正文全文塞进审计详情（可能含用户隐私）。

### 7.5 性能与缓存

- 工作台每类固定 `count + findMany(take: 5)`，不拉全量；按需补索引（见 7.2）。
- 30 秒内存缓存，键 `role:view`；`AdminWorkbenchProvider` 60 秒轮询，页面隐藏时暂停。
- 铃铛与首屏共用 provider，避免同一管理员每 60 秒发两次几乎相同的聚合查询。
- 搜索新增两组查询仍走 `contains`；保持「每类前 5 + 总数」，不扩展成长文本搜索。
- 后台为 SQLite 单文件、管理员低频操作，以上开销可接受；如后续多实例，缓存退化只影响新鲜度，不影响正确性。

## 8. 分期与验收

### 8.1 P0（先做，直接减少步数）

1. `GET /admin/workbench` + `alert-thresholds.ts` 共享阈值 + 三种角色首屏。
2. 工单：行内认领、回复模板（代码常量）、内部备注、转交财务、上一条/下一条、指派下拉。
3. 上下文直达：工单 ↔ 订单退款、任务 ↔ 生成账单、告警 ↔ 实体行；`intent` / `returnTo` / `from` 契约与白名单。
4. 保存视图：工单、任务、订单、对账、发票、账单六页的内置视图 + 本机保存。
5. 命令面板：`>` 命令模式、导航与新建命令、最近访问。
6. 任务 `uncertain` 重试保护。
7. 告警页分组与实体展开，与工作台同源。

### 8.2 P1（把高频批量与角色闭环补齐）

1. 工单批量指派/流转；邀请/签到等页面的保存视图扩展。
2. 任务同因聚合、行内重试、错误码筛选、抽屉动作条。
3. 发票分组/行内开具/批量洁净单；对账差异优先与批量处置。
4. 渠道/模型影响面预览与保存后核对。
5. 用户 360 与跨实体入口。
6. 快捷键 `j/k`、`g` 导航、`Cmd+Enter`。

### 8.3 P2（可选增强）

1. 回复模板管理表与后台 CRUD。
2. SLA 看板与超时升级（工单首响、退款确认、对账处置）。
3. 自动分派/自动重试阈值（必须有上限与审计，不允许无界重试）。
4. 跨设备保存视图（`AdminPreference`）。

### 8.4 验收指标

| 指标 | 现状 | 目标 |
| --- | --- | --- |
| 工单回复交互步数 | 8 | ≤3 |
| 工单转退款完成步数 | 10+ | 运营 ≤2，财务 ≤3 |
| 单条失败任务排障步数 | 4 | ≤2 |
| 财务日结需要打开的页面数 | 6 | 1（工作台），异常再深链 |
| 渠道退款卡单确认步数 | 4 | ≤2 |
| 重复筛选恢复步数 | 4 次选择 | 1 次点击 |
| 高危动作审计覆盖率 | 100% | 100%，批量逐条 |
| 工单内资金动作 | 0 | 0（仍为转交） |

验收方式：

- 纯函数（视图解析、链接白名单、命令注册表）走 Vitest 单测。
- 工作台聚合与权限过滤走 `@nestjs/testing` + 临时 SQLite 集成测试，覆盖三种角色与无权来源。
- 关键动线走 Playwright：告警 → 工单 → 转交 → 财务工作台 → 订单退款 → 返回工单；保存视图应用后刷新仍一致。
- 每项上线前用真实账号在 development 环境走一遍，记录操作步数；不以 checklist 自评替代。

## 9. 风险与不做

| 风险 | 处置 |
| --- | --- |
| 工作台与告警口径漂移 | 阈值统一在 `alert-thresholds.ts`；两边查询各自实现，但窗口与分界值只写一处 |
| 工作台变成「第二套列表」 | 每类最多 5 条，完整列表回原页面；搜索不复制列表筛选 |
| 上下文链接绕过确认/权限 | `intent` 只打开弹窗不自动提交；所有写操作走原端点；`returnTo` 白名单；后端逐请求校验 |
| 内部备注泄露给用户 | C 端查询强制 `visibility='public'`；通知/推送只对 public 回复触发；集成测试覆盖 |
| 转交后无人处理 | 财务工作台「指派给我」置顶；告警中心增加「内部转交超时」作为 P2；不新增「已读」状态 |
| localStorage 视图丢失 | 明确这是本机偏好；内置视图不依赖存储；P2 再评估跨设备表 |
| 管理员视角切换造成越权误解 | 切换只改布局，不改权限；页面标注「视角」而非「角色」 |

不做：

- 自定义角色、多租户、代理分销。
- 移动端与响应式后台。
- 工单内直接退款或调整积分。
- 批量退款。
- 告警「已读/忽略」状态。
- 第二套全局搜索或第二套列表组件。
- 在命令面板里直接执行资金动作。

## 10. 文件落点

### 后端

| 文件 | 改动 |
| --- | --- |
| `backend/src/admin/alert-thresholds.ts`（新） | 告警与工作台共用的阈值 / 窗口 / 每类条数 |
| `backend/src/admin/workbench.controller.ts`（新） | `GET /admin/workbench`，身份即可，service 内按权限过滤 |
| `backend/src/admin/workbench.service.ts`（新） | 组合七类待办、生成 `roleView`、30 秒缓存 |
| `backend/src/admin/alerts.service.ts` | 改用共享阈值；响应形状保持兼容 |
| `backend/src/admin/search.service.ts` | 增加发票、生成账单组；仍按各域读权限裁剪 |
| `backend/src/admin/tickets-admin.controller.ts` / `backend/src/tickets/*` | 回复 `visibility`、指派候选、批量指派/流转 |
| `backend/src/admin/invoices-admin.controller.ts` / `payments/*` | 批量开具、批量对账处置 |
| `backend/src/admin/channels*` / `logical-models*` | `impact` 只读接口 |
| `backend/prisma/schema.prisma` | `TicketReply.visibility`、`Refund` 索引；P1 `TicketReplyTemplate` |

### 前端

| 文件 | 改动 |
| --- | --- |
| `frontend/src/pages/admin/dashboard/AdminDashboardContent.tsx` | `roleView` 三分支；保留现有任务/财务 widgets |
| `frontend/src/components/admin/WorkbenchContext.tsx`（新） | 工作台快照 provider |
| `frontend/src/admin-ui/shell/GlobalSearch.tsx` | 扩展命令模式、最近访问；保留实体搜索 |
| `frontend/src/admin-ui/shell/AdminBoardLayout.tsx` | 挂 provider、视角切换、快捷键入口 |
| `frontend/src/lib/admin-commands.ts`（新） | 命令注册表（导航/新建/视图） |
| `frontend/src/lib/admin-saved-views.ts`（新） | 内置视图 + localStorage 读写 |
| `frontend/src/lib/admin-context-link.ts`（新） | `intent` / `returnTo` / `from` 构造与校验 |
| `frontend/src/admin-ui/primitives/work-queue.tsx`（新） | 待办队列与行 |
| `frontend/src/admin-ui/primitives/context-banner.tsx`（新） | 来源与返回 |
| `frontend/src/admin-ui/primitives/saved-view-bar.tsx`（新） | 视图条 |
| `frontend/src/admin-ui/primitives/action-result-banner.tsx`（新） | 动作结果条 |
| `frontend/src/admin-ui/primitives/index.ts` | 导出新件 |
| `frontend/src/pages/admin/tickets/*` | 行内认领、模板、内部备注、转交、下一条 |
| `frontend/src/pages/admin/tickets/reply-templates.ts`（新） | P0 内置回复模板与变量替换；P1 改为后端模板表 |
| `frontend/src/pages/admin/tasks/*` | `uncertain` 重试保护、同因聚合、动作条 |
| `frontend/src/pages/admin/orders/*` | 原因模板、预填、结果返回 |
| `frontend/src/pages/admin/payments/PaymentsReconciliationTab.tsx` | 差异优先、批量处置 |
| `frontend/src/pages/admin/invoices/*` / `billing-orders/*` | 分组、行内动作、上下文链接 |
| `frontend/src/pages/admin/channels/*` / `capabilities/*` | 影响面预览 |

### 文档

- 本文落地后同步更新 `docs/admin-console-design.md` §3.14（全局能力）与 `docs/admin-prd.md` B-74（内部备注）。
- 若新增接口，补 `docs/api-contract.md` 的后台接口清单。
- 若调整批量动作，补 `docs/testing.md` 的覆盖矩阵。

## 11. 与现有文档的关系

| 文档 | 关系 |
| --- | --- |
| `admin-prd.md` | 本文落实 B-74 内部备注、B-87 批量、B-88 全局搜索、B-89 告警的体验改进；不改变角色权限矩阵 |
| `admin-console-design.md` | 本文是 §3.14 全局能力与各页面动作的改进方案；落地后回写 |
| `admin-detailed-design.md` | 接口与组件细节落地后回写；本文不重复字段级设计 |
| `admin-ui-design.md` | 新组件遵循 shadcn + primitives 规范；不新增 `adm-*` 类 |
| `commerce-design.md` | 资金规则不变；本文只改财务角色的入口与批量，不改退款/对账/账单规则 |
| `testing.md` | 新增工作台聚合、上下文链接、内部备注、保存视图的测试项 |
