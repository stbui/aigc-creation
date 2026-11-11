# 后台管理端 · 详细设计

后台各模块的页面结构、接口、数据流与边界处理。本文只写**怎么做**，不重复**做什么**（功能与定位见 `docs/admin-console-design.md`，信息架构与 RBAC 见 `docs/admin-suite-design.md`，视觉规格见 `docs/admin-ui-design.md`）。

| 项 | 事实源 |
| --- | --- |
| 后端模块注册与守卫顺序 | `backend/src/admin/admin.module.ts` |
| 权限点与内置角色 | `backend/src/admin/permissions.ts` |
| 菜单分组 | `frontend/src/components/admin/adminNav.ts` |
| 通用组件与列表 hook | `frontend/src/admin-ui/primitives/index.ts`（控件 + hook 统一出口） |
| 请求层 | `frontend/src/lib/api.ts` 的 `adminApi` |

---

## 0. 通用设计

### 0.1 目录结构

```
backend/src/admin/
├── admin.module.ts                  # 模块装配（守卫在此注册）
├── admin.guard.ts                   # 后台身份 + 账号状态（每次查库）
├── permission.guard.ts              # 权限点校验
├── admin.decorator.ts               # @RequirePermission
├── permissions.ts                   # 权限点单一事实源
├── admin-role.service.ts            # 角色读取、权限过滤、hasPermission
├── admin.controller.ts              # /admin/me /overview /permissions
├── overview.service.ts              # 平台概览聚合
├── users.controller.ts / users.service.ts
├── assets-admin.controller.ts / assets-admin.service.ts   # 项目与素材
├── tasks-admin.controller.ts / tasks-admin.service.ts
├── tickets-admin.controller.ts
├── notifications.controller.ts
├── commerce.controller.ts / commerce-admin.service.ts     # 商品/订单/支付/积分
├── marketing.controller.ts
├── invoices-admin.controller.ts
├── payments/payment-admin.controller.ts             # 支付域：渠道/商品/订单/对账
├── capability.controller.ts
├── roles.controller.ts / settings.service.ts / ../common/setting-defs.ts
├── storage.controller.ts / scheduler.controller.ts / scheduler.service.ts
├── backup.controller.ts / backup.service.ts / retention.controller.ts
└── search.controller.ts / search.service.ts
```

模型层的后台接口不在这里：渠道 / 前台模型 / 用户分组 / 插件 / 账单 / 分析 / 调用记录分别由 `backend/src/model/**` 下的 controller 提供（`channel.controller.ts`、`admin-logical-model.controller.ts`、`user-group.controller.ts`、`plugin.controller.ts`、`billing-admin.controller.ts`、`analytics.controller.ts`），路由与权限见 `docs/model-architecture.md` 的「后台页面 / 接口」表。

```text
frontend/src/admin-ui/              # 后台 UI（shadcn · radix 底座）
├── components/ui/                  # shadcn 原子件（只被 primitives 引用）
├── shell/AdminBoardLayout.tsx      # 外壳（shadcn Sidebar：全高侧栏 + 内容区顶栏）
├── primitives/                     # 页面唯一取用层：layout / form / display / fields / table / overlay / drawer / batch-result / duty-* / chart
├── providers/                      # Toast / Confirm / AdminUIProvider
├── hooks/useAdminList.ts           # useAdminList / useAdminResource / useAdminUrlFilterSync / useAdminDetailParam
└── lib/                            # cn（官方 cn 包 + 补登表）、density（DensityContext）、format（时间 / 金额 / 字节）

frontend/src/components/admin/
├── adminNav.ts                     # ADMIN_MENU 单一事实源
├── AlertCenter.tsx                 # 告警来源聚合（告警中心页）
├── DutyContext.tsx                 # 概览首屏值班塔的数据轮询
└── statusMeta.ts                   # 状态 → 文案 / 色调映射

frontend/src/pages/admin/            # 32 个页面 + channels/、payments/ 子目录
```

### 0.2 守卫链

| 环节 | 职责 | 拒绝响应 |
| --- | --- | --- |
| `AdminGuard` | 解 Bearer token 后**查库**取 `role` / `status` | 401 `40101`；`disabled` / `deleted` → 403 `40302`；非后台角色 → 403 `40301` |
| `PermissionGuard` | 读 `@RequirePermission` 元数据，比对 `AdminRole.permissions` | 403 `40301`（不回显所需权限名；端点漏声明权限点时**拒绝**而非放行） |

执行顺序：`AdminGuard` → `PermissionGuard` → controller。两者内部对非 `/admin` 路径直接放行，C 端链路不受影响。

**为什么每次查库**：token TTL 7 天，若只信 token 内的角色，降权或禁用后旧 token 仍可用 7 天。SQLite 单文件、admin 接口低频，开销可忽略。

### 0.3 权限点命名

`<模块>.<动作>`，67 个，完整清单见 `permissions.ts` 的 `PERMISSIONS`（分组表见 `docs/admin-suite-design.md` §2.2）。三条约束：

1. 权限点从清单移除后，角色里残留的值比对不上即等同无权（兜底默认拒），`AdminRoleService.getPermissions()` 读取时过滤；过滤只在内存生效，不回写库。
2. 三个内置角色不可删除，但权限点均可调整（含 `admin`）：批量更新会校验未知权限点与角色是否存在，不阻止裁剪；整批写入在同一事务中完成，改动因守卫每次请求查库而立即生效。
3. 前端 `AdminContext.can()` 只隐藏按钮，**不是安全边界**。

### 0.4 列表页通用模式

`admin-ui/hooks/useAdminList.ts` 的 `useAdminList` 统一处理分页、筛选、刷新与失败态（随 `admin-ui/primitives` 导出）：

```ts
const { data, total, loading, error, reload, setPage, setFilters } = useAdminList(fetcher, {
  pageSize: 20,
});
```

| 组件 | 用途 |
| --- | --- |
| `adminPagination({ total, page, pageSize, onChange })` | 标准分页配置 |
| `adminMiniPagination(...)` | 小表格 / 抽屉内分页 |
| `AdminListLoading` / `AdminListError` / `AdminStaleError` | 三种加载态；`StaleError` 用于「有旧数据但本次刷新失败」 |
| `useAdminResource(fetcher, deps)` | 非列表型单次拉取（表单初值、统计卡） |

页面结构统一：`PageHeader`（标题 + 主操作）→ 筛选条 → 表格 → 分页。表格一律 `rowKey="id"`、`size="small"`。

### 0.5 详情浮层

`AdminDrawer` 统一宽度、标题、底部操作区与关闭行为，详情不跳独立路由——保留列表筛选态比省一层路由更重要。

`AdminModal` 与 `AdminDrawer` 共用同一套懒加载取数、竞态丢弃与失败重试，只换浮层形态：内容包含并排区块、宽表格或大图预览时改用居中弹窗（`width` 默认 960，任务详情 1120），避免抽屉把每一段都挤成两行。两者都在 `admin-ui/primitives/DetailDialog`，页面从 barrel 取件。

### 0.6 高危操作确认

`ConfirmDialog`（shadcn `AlertDialog` 组合壳，`admin-ui/primitives/overlay`）用于删除、退款、重置密码、手动调整积分、渠道 / 前台模型写入、角色与系统设置写入、备份。文案必须写明**影响量**（`impact` 数组，如「将删除 12 个素材」），不能只写「确定删除吗」。业务原因输入只用于确有业务依据要求的动作（如退款、发票驳回、能力下架）；普通管理写操作不要求填写原因。2026-10-30 起不再要求输入确认词（`requireTyping` / `typingText` 仅保留入参兼容）。

### 0.7 批量动作

`common/batch.ts` 的 `runBatch(ids, handler)`：

- `ids` 去重，上限 100；
- **串行**执行，**不包事务**——一条失败不该回滚另外 99 条；
- 逐条返回 `{ id, ok, message?, data? }`；
- 前端批量动作完成后用 toast 汇报成功 / 失败条数，不再弹逐条结果框。

路由挂较弱读权限，处理器内再用 `AdminRoleService.hasPermission()` 判动作权限（`40301`）。

### 0.8 CSV

`common/csv.ts`：UTF-8 **BOM** + RFC4180 引号转义 + 公式注入前导 `'`（`=` `+` `-` `@` 开头）。前端 `downloadCsv()` 独立于 `request()`，CSV 不走 JSON 信封。导入按行返回结果，避免一行错整批失败。

### 0.9 前端权限

`AdminContext` 从 `GET /admin/permissions` 取当前角色的权限点集合，暴露 `can(permission)`。仅用于隐藏无权限的按钮与菜单项。

---

## 1. 平台概览 `/admin`

### 1.1 页面结构

顶部指标卡（用户 / 任务 / 素材 / 交易）+ 趋势折线 + 交易概览 + 最近任务列表。

### 1.2 接口

`GET /admin/overview?days=7`（`platform.dashboard`）。一段响应里给三段数据：

| 段 | 字段 |
| --- | --- |
| `totals` | `users` / `newUsers` / `projects` / `tasks` / `succeeded` / `failed` / `running` / `pending` / `successRate` / `assets` / `originals` / `generated` |
| `trend` | 按日任务序列，长度由 `days` 决定 |
| `window` | 窗口口径任务量 / 成功率 / 失败原因 Top 6 / 窗口营收与新增用户 |
| `comparison` | 上一等长窗口的同口径数字，用于环比 |
| `commerce` | `orders` / `gmvCents` / `gmvWindowCents` / `pendingCents` / `refundedCents` / `refundedWindowCents` / `paymentSuccessRate` / `members` / `credits` / `channelMix` / `revenueTrend` |

### 1.3 口径

- 金额一律整数分，后端不做展示层格式化，避免「接口返回元、页面再乘 100」的口径漂移。
- `paymentSuccessRate` 无支付流水时返回 `null` 而非 `0`：`0%` 会被误读为「支付全挂了」。
- 任务状态分布是全量，不受 `days` 窗口影响；趋势、「新增」、`window` 与 `comparison` 受窗口影响。
- 环比用紧邻的等长窗口，不用累计做分母；上一窗口为 0 时前端显示「新增」或「—」，不显示 ∞%。
- 只统计现有表，不出现无数据支撑的指标。
- **30 秒内存缓存**：`overview` 按 `days` 缓存 30 秒，响应带 `generatedAt`，页面明确展示「数据截至」；切换窗口或点刷新不会击穿到全量重算。

---

## 2. 用户管理 `/admin/users`

### 2.1 接口

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/users?keyword&role&status&from&to&segment&membership&page&pageSize&sort` | `user.read` |
| GET | `/admin/users/stats` | `user.read` |
| GET | `/admin/users/:id` | `user.read` |
| GET | `/admin/users/:id/logins` | `user.read` |
| GET | `/admin/users/:id/impact` | `user.delete` |
| PATCH | `/admin/users/:id/status` | `user.disable` |
| PATCH | `/admin/users/:id/role` | `user.write` |
| POST | `/admin/users/:id/password` | `user.reset_password` |
| POST | `/admin/users/:id/logout-all` | `user.disable` |
| DELETE | `/admin/users/:id` | `user.delete` |
| GET | `/admin/users/export` | `user.read + data.export` |
| POST | `/admin/users/batch` | `user.disable`（仅启停） |

### 2.2 规则

- **禁用立即生效**：`AdminGuard` 与 `JwtAuthGuard` 每次请求查库校验 `status`，不走 token 内快照；两处同时比对 `tokenVersion`，改密/重置后旧后台 token 也立即失效。
- **角色变更**：`user` / `admin` / `operator` / `finance` 四个值（`USER_ROLES`）；最后一个 `admin` 不可降级，服务层断言后返回 409。禁用与角色变更不要求填写原因。
- **重置密码**：生成一次性强密码（24 小时有效），只在本次响应里出现一次，不落库。用户登录后 `mustChangePassword=true`，改密前只能访问 `/me` 与 `/me/password`；自助改密或邮件重置会清除该标记。
- **强制下线**：`POST /:id/logout-all` 递增 `tokenVersion` 并清理扫码登录会话；账号仍可正常登录，与「禁用」区分。
- **删除**：走 `account-lifecycle.service.ts`，与 C 端自助注销同一份实现。清除作品 / 素材 / 项目 / 积分批次与对象存储文件，终止生效中的会员；保留订单 / 支付 / 退款 / 发票 / 积分流水（流水断开批次引用），账号匿名化并置 `deleted`。删除前用 `impact` 预览将清除与保留的量；管理端固定走软注销，不提供批量删除。
- **列表口径**：关键词与顶栏全局搜索一致（邮箱 / 昵称 / 手机号模糊 + 用户 ID 精确）；支持注册时间范围、从未登录 / 30 天未登录 / 无可见任务分群、会员状态筛选。顶部统计由 `GET /stats` 返回，跟随同一组筛选条件，不是当前页口径。
- **导出**：跟随当前排序与全部筛选条件；超过 5000 行时截断，并通过 `X-Export-Total` / `X-Export-Limit` / `X-Export-Truncated` 响应头告知调用方。

---

## 3. 项目与素材 `/admin/assets`

### 3.1 接口

`projects`（列表 / 删除）、`assets/stats`、`assets`（列表）、`assets/:id/impact`、`assets/:id/status`、`assets/batch-status`、`assets/batch`、`assets/export`、`assets/:id`（删除）。

### 3.2 规则

- 素材按 `kind`（`original` / `generated`）、能力、用户、时间筛选；列表要同时支持缩略图网格与表格视图。
- **下架**置 `Asset.status='hidden'`，C 端列表过滤。这是后台唯一会改变 C 端可见性的动作。
- **删除**连带磁盘文件与对象存储对象；生成图删除时连带删除产出它的任务。
- 图片地址走 `displayUrl()` / 签名 URL 服务，不暴露磁盘路径。

---

## 4. 任务监控 `/admin/tasks`

### 4.1 接口

`GET /admin/tasks`、`/admin/tasks/stats`、`/admin/tasks/capabilities`、`/admin/tasks/export`、`/admin/tasks/:id`、`POST /admin/tasks/:id/retry`、`POST /admin/tasks/:id/cancel`、`POST /admin/tasks/batch`。

AI 分析标签查询 `GET /admin/api-logs?source=tool&operation=image_to_prompt`（`model.call_read`），不需要新增任务接口。

### 4.2 规则

- **全链路详情**：宽弹窗按同一 `taskId` 集中展示用户提交、参数 / 输入素材、线路尝试、模型调用、产出和账单终态。`GET /admin/tasks/:id`（`task.read`）返回任务及按 `routeRun / attemptNumber` 排序的 `routeAttempts`；最近 20 次模型调用走 `/admin/api-logs?taskId=`（`model.call_read`），并深链 `/admin/model-calls?taskId=` 查看全部；账单走 `/admin/billing-orders?taskId=`（`billing_order.read`），并深链 `/admin/billing-orders?taskId=`。无对应权限时不请求，只显示权限边界。
- **排障语义**：`dispatchState` 回答请求是否可能到达上游，账单终态回答钱是否已处理。建连前网络失败可安全切线；全部线路都未接单时任务以 `42204` 失败并自动退款。`refunded + system:preconnection-reconcile` 明确显示“无需人工复核”；只有 `reviewable=true` 才进入待核对队列。`submission_unknown` 且账单仍为 `reviewable` 时才需人工确认，不能把网络拒绝误判为上游已接单。
- **重试不复用旧记录**：用原参数与原输入新建任务，再复用 `GenerateService.enqueue` 触发执行。原地复活会绕过 `GenerationTask.outputAssetId @unique` 的一产出约束。
- **终止**把 `running` 置 `failed` + `cancelled_by_admin`，按任务快照退款。
- 统计条显示各状态计数，积压（`pending` / `running`）超阈值标红。
- **导出** CSV 与列表共用 `listWhere`，筛什么导什么，上限 5000 行，需 `task.read + data.export`。
- **性能**：能力筛选项的全表 `groupBy` 缓存 60 秒；拥堵指标仍实时查询。`GenerationTask` 增加 `[status, createdAt]` 与 `[ownerId, createdAt]` 组合索引，服务「状态 + 时间窗」和用户详情时间线。
- 告警链接 `?status=failed|running` 会作为列表初始筛选；页面已打开时 URL 变化也会同步过去。
- **AI 分析是同步调用，不是任务**：图片转提示词只写 `ApiCallLog`（`source=tool`、`operation=image_to_prompt`、`billable=false`），没有轮询、任务状态、重试或取消。`?tab=ai-analysis` 下按状态 / 用户 / 时间筛选真实上游调用，展示耗时、Token、错误与请求号；无 `model.call_read` 时不显示标签也不发请求，并深链 `/admin/model-calls?source=tool&operation=image_to_prompt` 查看完整记录。

---

## 5. 工单处理 `/admin/tickets`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/tickets?status&assigneeId&keyword&page` | 列表 |
| GET | `/admin/tickets/stats` | 各状态计数 |
| GET | `/admin/tickets/:id` | 详情含回复流 |
| POST | `/admin/tickets/:id/replies` | 回复；客服首次回复即 `open → processing` 并自动认领 |
| PATCH | `/admin/tickets/:id` | 改状态或指派 |
| GET | `/admin/tickets/export` | CSV 导出 |

状态机只在 `tickets.service.ts` 的 `TRANSITIONS` 定义（`open → processing → resolved/closed`、`resolved → closed/open`、`closed → open`），跳步返回 400。指派只能给启用中的后台账号，`assigneeId: null` 表示取消指派。越权访问一律 404 而非 403，不泄露 id 是否存在。

**退款的边界**：工单只做沟通与流转，退款到订单模块执行，避免两处都能改钱。

---

## 7. 站内消息 `/admin/notifications`

`GET /admin/notifications/channels`（实际生效的邮件 / 短信实现：`provider` / `delivers` / `configured`，不含凭据）、`POST /admin/notifications/broadcast`（全站广播）、`GET|POST /admin/notifications/templates`。

- 模板只替换 `{name}` 形式占位符，缺失时回落代码内置文案。
- `notify()` 永不抛异常：写库失败只 WARN，业务事件不能因为通知失败而回滚。
- 已接业务事件：支付成功、任务失败退款（**仅退款真的成功时**）、会员到期、工单回复。
- 权限 `message.write`。

---

## 8. AI 标识 `/admin/aigc-label`

`GET|PUT /admin/aigc-label`（`setting.read` / `setting.write`）。

### 8.1 数据

`AigcLabelConfig` 单行（`id='default'`）：`specJson` 样式 + `pngBase64` 位图 + `specKey` 过期判定。默认值在 `common/aigc-label.config.ts` 的 `AIGC_LABEL_DEFAULTS`，运行期 3s 缓存，保存即 `invalidate()`；读失败回退默认值不抛错（配置坏了也要能打标识）。

### 8.2 渲染分工

服务端不栅格化中文：Jimp 内置字体只有 ASCII。保存时由浏览器 Canvas 以 2x 渲染 PNG，与 `specJson` 原子提交；服务端只做缩放、定位、透明度合成。内置默认位图由 `scripts/gen-aigc-label.mjs` 生成，改内置文案或配色必须重跑。

`specKey` 只哈希渲染相关字段（`enabled` 不入哈希，不影响位图）。样式改了但位图未重存会被标 `stale`：仍用旧位图，页面提示重存。

### 8.3 与生成链路的接口

- 顺序：先合成角标，再写元数据。反序会打乱偏移损坏图片。
- 显式标识失败 → 任务 `failed/42203` 并退款；元数据写入失败 → 告警但仍落库。
- 关闭可见角标时隐式标识照常写入；若隐式标识也无写入路径（webp / gif），仍按失败退款。

---

## 9. 商品与消耗价

`/admin/products`（`product.read` / `product.write` / `product.publish` / `product.delete`）与 `/admin/capabilities?tab=pricing`（`product.price`，旧地址 `/admin/credit-prices` 重定向到此）。

- 商品 SKU 存 `Product`，价格与积分以快照字段落到 `OrderItem`（`priceCentsSnapshot` / `creditsSnapshot`）。
- 删除只对**没有历史订单**的 SKU 开放：`OrderItem.productId` 是 RESTRICT 外键，且退款与积分回收要回查 SKU 原价与发放积分；有订单时返回 409 并提示改为下架。列表每项带 `orderCount`，前端在打开确认框前就拦下。
- **能力消耗价**读写走 `CreditPriceService`，返回生效价与来源（`default` / `override` / `campaign`）。业务代码不读 `creditCost`，否则后台调价不生效。
- 限时免活动命中的能力 `resolve()` 直接返回 0，优先于后台覆盖价；页面显示 `source: 'campaign'`，运营据此判断「改了价没生效」是活动在起作用。
- 上下架用 `product.publish` 单列权限：能改价不等于能发布。

---

## 10. 订单管理 `/admin/orders`

### 10.1 状态机

```ts
pending → paid | cancelled
paid → refunded | partial_refunded
partial_refunded → refunded | partial_refunded
```

未支付订单 30 分钟自动关闭（`ORDER_TTL_MINUTES`），由调度任务执行。已支付订单只能走退款，不能取消。

### 10.2 后台动作

| 动作 | 说明 | 权限 |
| --- | --- | --- |
| 标记已支付 | `channel='manual'`，用于线下收款核销；不调渠道 | `order.mark_paid` |
| 退款 | 先校验 → 落 `Refund(processing)` → 调渠道 → 成功后才回收积分与迁移状态 | `order.refund` |
| 批量 / 导出 | `orders/batch` / `orders/export` | 对应订单动作权限 / `order.read + data.export` |

列表支持按退款状态筛选（`?refundState=processing|failed|succeeded`）。退款状态挂在 `Refund` 行上，一笔订单可能多次部分退款；告警中心正是用它把「渠道已受理但本地未落账」的订单捞出来。

**列表带「退款状态」列**（`refundState`）：渠道异步退款时订单仍是 `paid`，只看订单状态看不出「钱在处理中」——筛得到却看不出是哪单。列值与筛选口径**同源**（筛选用 `some` 命中任意一笔退款单，列取其中最需要人管的那个：处理中 > 失败 > 成功），保证「筛得到的行，列上一定看得到原因」。同一笔退款的渠道重试是同一行改状态，不会留下多行。

### 10.3 退款被拒时的两类拒绝

`40001`（金额超上限）是**硬约束**，只有改金额能解；`40905` / `40906` / `40907` 是**可配规则**（时间窗 / 比例上限 / 已消耗积分），要去「系统设置 → 退款」改规则。状态码只能分 400 与 409，分不出是哪条规则，因此前端 `ApiError` 带后端业务码（响应体 `code`），退款失败时按码给出可执行的下一步，并在退款弹窗里给出规则设置的深链入口（`/admin/settings?group=refund`）。**绝不允许两类拒绝在 UI 上同形** —— 运营只能反复改金额试。

### 10.4 退款顺序不可反

1. 硬约束校验：金额 ≤ 实付 − 已退（`40001`）。
2. 可配规则：时间窗 `40905`、比例 `40906`、本次退款应回收份额已消耗且扣不回 `40907`。积分只从本订单批次回收，不跨订单挪用；部分退款按累计退款比例的本次份额校验。
3. 已有 `processing` 退款 → `40908`。
4. 落 `Refund(status='processing')`，用它的 id 作渠道幂等键 `outRefundNo`。
5. 调渠道：失败置 `failed` 并抛 `50302`，**订单状态与积分不变**。渠道结果未知时复用原退款号重试；人工核销为失败后必须新建退款单。成功才回收积分、迁移订单状态、累加 `refundedCents`。

会员单全额退款只撤销该订单对应的周期并重算当前会员；仍有其他已付周期时不会整体终止，只有最后一期被撤才返回 `membershipTerminated=true`。退款成功响应还带 `invoiceFollowUp`：仅当待开票票面超过剩余可开票金额时要求驳回，仍可覆盖时不产生告警；已开票需线下冲红并登记。渠道异步处理中返回 `invoiceFollowUp: null`。**绝不允许「只改库、假装退过钱」**。

---

## 11. 支付与财务

### 11.1 支付充值 `/admin/payments`

三标签共用一个页面（`frontend/src/pages/admin/payments/`）：**支付渠道 / 支付对账 / 支付异常**。URL 的 `?tab=` 是标签的事实源，非法值回落到「支付渠道」；旧路由 `/admin/payment-channels` 与 `/admin/reconciliation` 改为重定向。

**商品与订单不在这里**：充值商品就是 `Product` 表，统一在「商品管理」（`/admin/products`）维护；支付订单就是 `Order` 表，统一在「订单管理」（`/admin/orders`）查看与操作。两边各有一套列表时字段与动作必然分叉，运营会按页面而不是按数据判断状态。

| 标签 | 接口 | 规则 |
| --- | --- | --- |
| 支付渠道 | `GET /admin/payments/providers`、`GET/PUT /admin/payments/settings`、`POST /admin/payments/providers/:providerId/instances`、`PUT /admin/payments/providers/:providerId/instances/:instanceId/config`、`PATCH /admin/payments/providers/:providerId/instances/order`、旧兼容入口 `PUT /admin/payments/providers/:id/config` | 每个服务商实例一份**版本化 + 加密**配置（`PaymentProviderConfig`），追加写不覆盖。密钥字段只回「是否已配置」，留空表示沿用旧值；身份类字段（商户号等）锁定不可改。支付设置包含 `defaultCurrency` / `alipaySource` / `wechatSource`，字段均可选，PUT 只更新实际提交项。保存不要求填写原因 |
| 支付对账 | `GET/POST /admin/payments/reconciliations*` | T+1 自动对账（每天 10:15 跑昨日账单）；差异分八类（含同一商户单多交易号的 `duplicate_charge`），已支付未入账经签名查单二次确认后**自动补发积分**（幂等） |
| 支付异常 | `GET/POST /admin/payments/exceptions*` | 真资金差异的认领、重试原路退款、人工核销与结案，`finance.reconcile` |

支付异常面板必须把退款失败拆成两种资金语义：`definitive` 表示渠道已明确拒绝，可新建退款单重试；`unknown` 或历史数据无 `failureKind` 表示结果未知，只能复用原退款单号重试或到渠道后台核对。自动退款处于 `auto_refund_pending` 时展示「确认退款成功 / 确认退款失败」；只有运营到渠道商户后台核实后才能核销，核销依据必填，渠道退款单号可选。成功后异常单置 `refunded`，失败后保留 `manual_review`，两者都**不改已取消订单状态，也不回收/恢复积分**。普通订单的 `processing` 退款只允许在订单详情走人工核销，不展示再次发起退款入口。

**查单 / 关单在订单管理**：`POST /admin/payments/orders/:id/query` 与 `/:id/close` 的入口在 `/admin/orders`（列表与详情抽屉），使用 `payment.operate`，不要求填写变更原因。关单前始终先向渠道查单；已入账订单关单返回 `409`。**本页与订单页都不把「关单」当退款**：退款在订单管理，涉及积分与优惠券回滚，放在支付域会让人以为「关单 = 退款」。

对账运行状态只有 `running` / `completed` / `failed`；旧的 `imported` / `resolved` 语义已随新模型下线（人工处置走订单退款流程，不在页面上改钱）。

### 11.2 发票

`/admin/invoices`（`invoice.write`）。同一订单保留历史但最多一张有效票（`activeOrderId @unique`），金额取申请时 `paidCents - refundedCents` 快照；输出可打印 HTML（零 PDF 依赖）。开具不要求填写原因；驳回要求填写原因，原因会回显给用户。存在 `processing` 退款时禁止开具；开具事务内重新校验订单状态和剩余可开票余额，退款后票面超余额必须驳回重提。`GET /admin/invoices/export` 导出同一 `status` / `keyword` 口径的 CSV（金额同时给分与元，`invoice.write + data.export`）。

---

## 12. 积分账本 `/admin/credits`

`GET /admin/credits/...`（余额总览、批次、流水）、`POST /admin/credits/adjust`（`credit.adjust`）、`POST /admin/credits/import`（`credit.adjust`）、`GET /admin/credits/export`（`credit.read + data.export`）。

- 余额 = `CreditLot` 未用完且未过期的批次之和。
- 消耗按 **FEFO**（先到期先扣，`NULL` 视为最晚到期）跨批次扣减；余额不足整体回滚并报 `40002`（前端按 402 语义处理）。
- 流水类型：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim`。人工增减落 `admin_adjust`，不要求填写原因。
- CSV 导入按**邮箱**匹配用户，逐行返回结果（匹配不到、格式错误都单独报，不整批回滚）。

---

## 13. 营销

| 页面 | 接口 | 规则 |
| --- | --- | --- |
| 优惠券 | `/admin/coupons*`（`marketing.write`） | 满减 / 折扣 / 固定额；发放范围、门槛、有效期、每人限用、总量；限量名额由 pending 订单预占、支付时核销、取消/超时释放，核销走 `Order.couponId`；无关联订单可删除，有订单只能停用；`GET /admin/coupons/export` 按同一筛选导出 CSV（`marketing.write + data.export`，路由在 `:id` 之前） |
| 限时活动 | `/admin/campaigns*` | 类型 `limited_price` / `limited_free` / `popup`；进行中的限时免费活动让 `resolve()` 返回 0；到期由调度任务收尾；列表/筛选/导出统一按派生生效态 `effective`（`draft/live/scheduled/ended/off`），人工 `status` 参数保留兼容；上线前校验结束时间未过、商品在架、活动价低于原价、能力 ID 有效；无关联订单**与**免费账单（`BillingOrder.promotionId`）才可删除，有引用只能下线；`GET /admin/campaigns/export` 按同一筛选导出 CSV（`marketing.write + data.export`） |
| 邀请与签到 | `/admin/invites*`、`/admin/checkin*` | 邀请奖励在被邀请人**首次付费**才触发；签到规则含基础积分与连签加成 |

C 端读取接口在 `marketing.controller.ts`（公开的 `/marketing/campaigns` 只回真正更便宜且在售的活动）。

---

## 14. 系统设置 `/admin/settings`

`GET|PATCH /admin/settings`（`setting.read` / `setting.write`）。默认值与键名只在 `backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` 定义，包括：站点信息、上传限制、生成超时与轮询、退款规则（`refund.windowDays` / `refund.maxRatioBps` / `refund.allowConsumedTask`）、备份频次与保留份数。

设置图片先走 `POST /admin/settings/upload`（multipart 字段 `file`，`setting.write`）：服务端校验图片、写入当前存储后端并返回 `{ value, previewUrl, width, height, sizeBytes }`。`value` 是稳定存储引用，只有用户保存设置时才写入 `payment.helpImage`，上传动作本身不改配置。

规则：

- 写入载荷为 `{ settings: Record<key, value>, clears?: string[] }`；`settings` 用点号键，`clears` 删除运行时覆盖并回落代码默认值。
- 写入前按 `SETTING_DEFS` 做类型与范围校验，非法值整体拒绝；同一键不能同时出现在 `settings` 与 `clears`。
- 只读项（`readOnly`）不渲染可编辑控件，只展示当前值并给出 `linkTo` 入口。
- 退款规则的读取方是 `order.service.refund`，规则对象由后台控制器取好后传入，订单域不依赖 admin 层。
- 保存不要求填写变更原因。
- **分组深链**：`?group=<分组键>` 直达某一组配置（如 `/admin/settings?group=refund`）。分组是本页唯一的页内状态，切换页签时用 `replace` 写回地址栏（不压历史），URL 上的分组不存在时回落到首个分组。退款规则被拒时运营要改的就是那一组，深链省掉「先进设置再在八个页签里找『退款』」。

### 14.1 角色权限 `/admin/roles`

`GET /admin/roles`（`role.read`）返回三个内置角色的**库内实际权限点**（不是代码默认值，否则页面显示与实际不符）；`PATCH /admin/roles`（`role.write`，高危）批量保存本次页面改动。

规则：

- 角色不可增删改名，`builtIn` 恒为 `true`；三个角色的权限点都能改，包括 `admin`。
- 请求体为 `{ roles: [{ code, permissions }] }`。
- 未知权限点整体拒绝（400 `40001`），不静默丢弃 —— 否则调用方会以为保存成功。
- 多角色改动在一个事务中写入，避免部分角色已生效、部分失败的半保存状态。
- 改动立即生效：`AdminGuard` / `PermissionGuard` 每次请求查库，不需要重启或重新登录。操作者把自己权限改没了也会当场生效（可由其他 admin 恢复）。
- 前端 `AdminRolesPage` 用 `can('role.write')` 控制可编辑态，按 69 个权限点分组勾选，高危权限点单独标注。

---

## 15. 存储配置 `/admin/storage`

`GET /admin/storage/status`（当前后端、容量、连通性）、`POST /admin/storage/probe`（探测）、`POST /admin/storage/active?backend=`（切换）。

- 后端：`local`（默认）/ `oss` / `minio`，由 `STORAGE_BACKEND` 决定初始值。
- 切换**只影响新上传**：`Asset.storageBackend` 记录写入时的后端，老素材仍从原后端读。
- 后端未就绪（SDK 未安装或凭据缺失）时，上传直接失败并给出明确文案，不静默写本地盘。
- 云端 SDK 是可选依赖，切之前必须先装包。

---

## 16. 定时任务 `/admin/scheduler`

`GET /admin/scheduler/status`、`POST /admin/scheduler/run?name=`（`setting.write`）。

| 任务 | 作用 |
| --- | --- |
| `order-expire` | 未支付订单超时关闭 |
| `credit-expire` | 积分批次到期回收 |
| `membership` | 会员到期失效与月度积分发放 |
| `backup` | 定时备份 |
| `cleanup` | 保留期清理 |
| `campaign-expire` | 活动到期收尾 |
| `task-recover` | 中断任务回收与会员补发 |

- 单轮检查里**每个任务独立 try/catch**：一个任务抛错不该连累其它任务（早期用一个大 try 包住全部，备份失败会连带跳过订单超时关闭）。
- 有重入保护：上一轮未结束不重复触发。
- 执行状态（上次时间、耗时、是否成功、连续失败次数）放内存，不落库。
- 手动触发只允许幂等任务。

---

## 17. 模型层后台

模型层后台共 7 页，按「供应侧 → 协议 → 能力与模型 → 人群 → 排障」排列：`/admin/channels` · `/admin/plugins` · `/admin/capabilities` · `/admin/user-groups` · `/admin/model-calls` · `/admin/billing-orders` · `/admin/finance`。能力与模型页同时承载能力上下线与模型商品消费配置，旧地址 `/admin/logical-models` 重定向到 `/admin/capabilities`。接口实现分布在 `backend/src/model/**` 与 `backend/src/admin/capability.controller.ts`。

### 17.1 模型商品（原渠道工作台） `/admin/channels`

默认进入「商品台账」：把渠道模型作为商品跨供应商展示，行上直接标出消费它的能力；「供应商」视图通过 `?view=channels` 进入，保留凭证、端点、并发、代理与线路健康配置。底层仍是渠道（凭证加密存储）+ 渠道模型（模态 / 接入方式 / 权重 / 优先级 / 售价）。

新建供应商支持「服务商预设」：选协议后自动带出 Base URL 与凭证字段名；保存后自动打开上游导入，形成「接入供应商 → 选商品并统一配置」两步；

商品台账支持勾选后批量上架 / 下架（逐条调用启停接口，缺类型 / 接入方式 / 售价的会被跳过）；

停用 / 删除商品或供应商的确认框会显示受影响的能力（按消费关系反查）；

供应商支持「默认商品配置」：在供应商表单里预设类型、接入方式、计费与售价（可勾选套用后自动启用），保存后「新建商品」与「从供应商同步商品」自动套用，免去逐条配置；只支持图像与文本，视频 / 音频仍需逐条配置。

上游导入支持「导入后统一配置」：勾选商品后可选填类型、接入方式与售价，作为本次导入的覆盖配置；省略时使用供应商默认配置，仍未配置则只建骨架行。配置应用由后端完成（`ModelCatalogService.import`），不再由前端「导入后逐条回写」；配置失效时该商品回落为骨架行，不阻断整次导入。

| 能力 | 接口（前缀 `/admin/channels`） | 权限点 |
| --- | --- | --- |
| 渠道列表 / 详情 / 创建 / 更新 / 删除 / 复制 | `GET /`、`GET /:id`、`POST /`、`PATCH /:id`、`DELETE /:id`、`POST /:id/duplicate` | `channel.read` / `channel.write` |
| 排序、整包导出 / 导入 | `PUT /order`、`POST /export`、`POST /import` | `channel.write` |
| 线路健康 | `GET /health` | `channel.read` |
| 解除线路冷却（本进程） | `POST /health/reset` | `channel.write` |
| 协议下拉 | `GET /protocols` | `channel.model_read` |
| 渠道模型 CRUD / 排序 / 启停 / 批量删除 | `GET|POST /:id/models*`、`PATCH /:id/models/:modelId*`、`DELETE /:id/models/:modelId`、`POST /:id/models/batch-delete` | `channel.model_read` / `channel.model_write` |
| 上游模型目录读取与导入 | `POST /:id/models/fetch`、`POST /:id/models/import` | `channel.model_read` / `channel.model_write` |
| 连通性测试（可测未保存草稿） | `POST /:id/models/test` | `channel.model_write` |
| 跨渠道只读视图 | `GET /admin/channel-models` | `channel.model_read` |

规则：

- `ChannelModel.protocol` 存**插件声明的 provider id**（如 `openai-image`），不是插件 id（`openai-images`）；下拉读协议注册表，手写库或导入时才可能写错，表现为派发报 `channel_unavailable`。
- 凭证只以密文落库（`MODEL_SECRET_KEY` 派生密钥）；读取接口只回显掩码。上游模型目录与连通性测试都在服务端使用已保存凭证发请求，密钥不进浏览器。
- 连通性测试走与正式任务相同的协议、出站策略与鉴权，差异只有「不建任务、不扣费」；结果写 `ApiCallLog`（`billable=false`），后台「调用记录」页可查。测试接受未保存的表单草稿，不必先保存再回来点测试；编辑弹窗另提供「保存并测试」，一次完成落库与连通性验证。
- 写入后主动失效目录快照（`CatalogVersionService`），不等 TTL 自然过期。
- `channel.write` / `channel.model_write` 覆盖渠道凭证与价格档：后端没有「只改线路不改价」的独立权限点，前端也不宣称有。

### 17.2 能力与模型中的消费配置 `/admin/capabilities`

页面语言以「能力消费模型商品」为主：能力卡片下直接列它消费的模型商品、用户实付与售卖状态。底层仍是 C 端可见身份（`LogicalModel`）+ 发布快照（`LogicalModelRevision`）+ 线路（`LogicalModelRoute`），运营不需要理解这三层；新建售卖配置时可从商品台账选择可用商品，自动带入名称、编号与服务来源。

页面入口统一为 `/admin/capabilities`；旧地址 `/admin/logical-models` 重定向并保留 query/hash。能力上下线与模型 CRUD 共用同一个卡片工作台，但写操作分别受 `capability.write` / `logical_model.write` 控制。

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 列表 / 详情 | `GET /admin/logical-models`、`/:id`（`includeArchived` 可选） | `logical_model.read` |
| 创建 / 更新 / 归档 | `POST /admin/logical-models`、`PATCH /:id`、`DELETE /:id` | `logical_model.write` |
| 选路模拟 | `POST /admin/logical-models/:id/simulate` | `logical_model.read` |

规则：

- 保存即发布一条 revision；任务建单时快照该 revision 的线路与价格，事后改配置不会改已建任务。
- 图像能力的遮罩支持声明在 `capabilityConfig.maskSupported`，下发为 `inputs.mask`；未声明的模型收到遮罩请求返回 `42205`。
- `simulate` 用系统分组身份跑一遍真实选路，返回命中线路与原因，不建任务、不扣费。

### 17.3 用户分组 `/admin/user-groups`

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 列表 / 详情 | `GET /admin/user-groups`、`/:id` | `user_group.read` |
| 创建 / 更新 / 删除 | `POST /admin/user-groups`、`PATCH /:id`、`DELETE /:id` | `user_group.write` |

- 分组决定倍率（`ratioBasisPoints`）、货币兑换、可见渠道与按模型的覆盖价格。
- 本仓没有 `users.user_group` 列：分组由会员套餐的 `userGroupCode` 映射，没有有效会员的用户落在 `default`，默认分组不可删除。
- 写入必须同时失效分组缓存与目录快照，否则出现「展示按新倍率、扣费按旧倍率」。

### 17.4 插件 `/admin/plugins`

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 列表 / 详情 | `GET /admin/plugins`、`/:id` | `plugin.read` |
| 启停 | `PATCH /admin/plugins/:id` | `plugin.write` |
| 校验 / 安装 / 卸载 | `POST /admin/plugins/:id/verify`、`POST /admin/plugins/install`、`DELETE /admin/plugins/:id` | `plugin.write` |
| 服务商目录 | `GET /admin/provider-catalog`、`POST /refresh`、`POST /:id/verify`、`POST /:id/install`（`provider-catalog.controller.ts`） | `plugin.read` / `plugin.write` |

- 插件是协议来源：启停即重建协议注册表，渠道模型可选的协议列表随之变化。
- 内置插件在 `backend/plugins/`（107 个可用包 / 115 个 provider，另有 3 个 `src-*` 源目录镜像不参与运行），后台上传安装的落在 `MODEL_PLUGIN_INSTALL_DIR`。

### 17.5 调用记录 `/admin/api-logs`

`GET /admin/api-logs`（`model.call_read`）记录每次上游调用：`requestKind`（task / tool / test / proxy）、渠道、模型、协议、耗时、结果、`RouteAttempt.failureCode` 与错误摘要，可按状态 / 类型 / 渠道 / 任务 / 用户 / 模型筛选。用于回答「这次扣的是谁、走的是哪条线路、为什么失败」。

`GET /admin/api-logs/export`（`model.call_read + data.export`）导出同一筛选口径的 CSV；列表与导出共用一个查询构造函数，不会出现两个口径，导出**不含请求体 / 响应体**，上限 5000 行。路由必须声明在 `:id` 之前。

### 17.6 生成账单 `/admin/billing-orders` 与财务分析 `/admin/finance`

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 账单列表 / 详情 | `GET /admin/billing-orders`、`/:id` | `billing_order.read` |
| 人工核对 | `POST /admin/billing-orders/:id/resolve`（`action: settle \| refund`，高危） | `billing_order.resolve` |
| 财务汇总 | `GET /admin/analytics/finance` | `model.analytics_read` |

- 账单状态机：`reserved / running / settled / refunded / uncertain`。`uncertain`（超时、5xx、连接中断）不自动退款、不切线，只能人工 `settle` 或 `refund`。
- 财务口径固定三条：实收 = 已结算账单实际金额；已退 = 订单退款金额；净收入 = 实收 − 已退。预留 / 运行 / 待核对单列为「挂账」，**不计入实收**。
- **与概览页的「订单收入」不是同一笔账**：财务页单位是**积分**（内部计价单位，已结算账单口径），概览页「订单收入」单位是**元**（订单实付口径，Σ `Order.paidCents`）。两者都曾叫「收入 / 营收」，同名不同义会让人把两处的数字对在一起，对不上就以为其中一处坏了。概览页的营收标签带「（元）」、财务页的说明写明「与概览页的订单收入（元）不是同一笔账」，并在概览页给出财务页入口。**两个口径的差异是事实，不允许合并成一个数。**

---

## 18. 能力上下线接口 `/admin/capabilities`

`GET /admin/capabilities`（`capability.read`）、`PUT /admin/capabilities/:id`（`capability.write`，高危）。

- 18 项能力的上下线与原因；列表按分组渲染为卡片网格（卡片展示实现程度与开关状态，运行结论仅用于筛选），`CapabilityControl` 无行 = 启用。
- 下架后 C 端 `runtime.effective='disabled'`；`generate.service` 在**扣费之前**拦截并返回 `40005`，原因原样透传到 C 端。
- 只覆盖「上下线」这一层：能力的名称、分组、参数、默认价仍以 `definitions/<id>.ts` 为准，后台不能改代码里的 `mode`。
- 保存即 `invalidate()`，无需等缓存过期。

---

## 19. 数据备份与保留期清理

### 19.1 备份 `/admin/backups`

| 接口 | 说明 |
| --- | --- |
| `GET /admin/backups` / `:id` | 列表与详情 |
| `GET /admin/backups/stats` | 总量与最新一份 |
| `POST /admin/backups` | 手动备份（`backup.run`，高危） |
| `POST /admin/backups/:id/verify` | SHA-256 校验 |
| `GET /admin/backups/:id/download` | 下载 |
| `DELETE /admin/backups/:id` | 删除单份 |
| `POST /admin/backups/prune` | 按份数裁剪 |

- 产物落 `BACKUP_DIR`，单份带 SHA-256 供校验。
- 手动备份与保留份数裁剪不要求填写变更原因；重复点击由前端 busy 状态防抖，不承诺跨请求幂等。
- 到期数据清理与清理留痕统一走 `/admin/retention/*`，不在备份控制器保留第二套入口。
- **列表筛选深链**：`?filter=failed|succeeded|unverified|verified`。告警中心的四条备份告警都带筛选维度（最近一次失败 → `failed`，过期 → `succeeded`，未验证 → `unverified`），点进去直接看到出问题的那几行，而不是一个混着全部记录的列表再自己翻。筛选在客户端做（备份记录量级小），筛选态写回地址栏。

### 19.2 保留期清理 `/admin/retention`

`GET /admin/retention/targets`（各目标默认可清理量）、`GET /admin/retention/preview?target=&retentionDays=`（按用户当前草稿天数重新计数）、`GET /admin/retention/logs`、`POST /admin/retention/cleanup`。执行结果落 `CleanupLog`；确认前必须按实际天数重新预览，避免「以为删的是过期日志，实际删了活跃文件」。

---

## 20. 数据工具

### 20.1 全局搜索

`GET /admin/search?q=`（`data.search`）：用户 / 订单 / 工单 / 任务 / 素材五组各前 5 条 + 总数。`q` 长度 < 2 直接返回空组——否则五个 `LIKE` 会全表扫描。落点按「哪个界面能立刻看到它」定：工单 `/admin/tickets?id=`、素材 `/admin/assets?q=<id>`。

**当前后台外壳未挂载前端入口**：2026-11 外壳重建时移除了顶栏搜索与命令面板，前端封装一并删除；后端接口与权限保留，后续重新接入时在顶栏挂回入口即可。

### 20.2 导出

`/admin/{users,assets,tickets,orders,payments,credits}/export`（领域读权限 + `data.export`）。CSV 走 `common/csv.ts`，前端独立下载不走信封。

### 20.3 导入

`POST /admin/credits/import`（`credit.adjust`，multipart）。按邮箱匹配用户，逐行报结果。

### 20.4 批量

`/admin/{users,assets,tasks,orders}/batch`（使用各领域对应的动作权限），规则见 §0.7。

---

## 21. 后台与基础设施的交界

| 项 | 关系 |
| --- | --- |
| 健康检查 | `/health` 与 `/health/ready` 免登录，不经过后台守卫 |
| 限流 | 后台接口不额外限流；登录 / 注册的限流在 `RateLimitGuard` |
| 请求追踪 | 日志带 `requestId`，可用它串起一次请求的完整处理链路 |
| 日志 | `AppFileLogger` 落盘并脱敏，后台排障看 `.run` 之外的 `backend/logs/` |
| 环境 | 后台所有凭据类页面只读，改配置走 env（见 `docs/environments.md`） |

---

## 22. 告警中心 `/admin/alerts`

### 22.1 数据源与口径

`GET /admin/alerts`（只要求后台身份，来源在 service 内按角色权限过滤）。返回 `generatedAt`、`total` 与 `items[]`（`key` / `severity` / `category` / `title` / `detail` / `count` / `link`）。

| 来源 | 触发条件 | 升级为 `critical` | 所需权限 |
| --- | --- | --- | --- |
| 工单 | `status='open'` 数量 > 0（`processing` 已受理，不再告警） | 最早一条等待 ≥ 24 小时 | `ticket.read` |
| 任务失败 | 近 24 小时 `failed` > 0 | 失败 ≥ 10 个 | `task.read` |
| 任务积压 | `running` > 50 | — | `task.read` |
| 对账差异 | `status='open'` 的差异 > 0 | ≥ 5 笔 | `payment.read` |
| 退款卡单 | `Refund.status='processing'` 且创建超过 30 分钟（渠道异步退款、无回调） | 最早一笔 ≥ 24 小时 | `order.read` |
| 备份失败/过期 | 最近一次失败，或无成功备份超过 48 小时 | 最近一次失败 | `backup.read` |
| 备份未验证 | `succeeded && !verified` > 0 | — | `backup.read` |
| 发票 | `status='pending'` > 0 | — | `invoice.write` |

### 22.2 交互

- 顶栏铃铛显示待处理**条目数**（不是底层记录数），点击展开前 5 条，底部进完整页面；每 60 秒轮询，页面隐藏时跳过。
- 不引入「已读」状态：计数即「当前待处理数」，事项处理后自然消失，避免「点过就算解决」。
- 没有待处理项时不产生条目，也不显示 0 角标；接口失败保留上一次数据并给重试。
- `?status=open` / `?status=failed` / `?status=running` 直达对应列表筛选。
- 退款告警链接到 `/admin/orders?refundState=processing`；订单列表新增退款状态筛选（`processing` / `failed` / `succeeded`），筛选的是 `Refund` 行，订单本身可能仍是 `paid`。

---

## 23. 明确不做

| 项 | 原因 |
| --- | --- |
| 第三方内容安全送审台账 | 未接入就如实显示「未接入」，不做假审核记录；`content.read` 为预留权限点 |
| 公告中心 | 站内消息只覆盖定向通知与广播，不建公告定时发布与撤回 |
| 工单 SLA 计时 | 无客服排班与工时口径，建了只会给出假指标 |
| 自定义角色 | 三个内置角色覆盖实际分工，权限点可调、角色不新增 |
| 数据分析看板 | 无漏斗 / 留存 / LTV 页面，概览只做现有表聚合 |
| 多租户与席位 | 单轨制，`User` 不加 `orgId` |
