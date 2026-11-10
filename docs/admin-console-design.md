# 后台管理端 · 功能设计

后台各页面的职责、可用动作与数据口径。信息架构与角色权限见 `docs/admin-suite-design.md`，字段级细节见 `docs/admin-detailed-design.md`，界面规格见 `docs/admin-ui-design.md`。

| 项 | 事实源 |
| --- | --- |
| 侧栏分组与页面 | `frontend/src/components/admin/adminNav.ts` 的 `ADMIN_MENU` |
| 页面组件 | `frontend/src/pages/admin/*` |
| 后端控制器 | `backend/src/admin/*.controller.ts` |
| 权限点 | `backend/src/admin/permissions.ts` |
| 访问入口 | C 端顶栏用户菜单「进入运营后台」；`/admin/*` 在 `App.tsx` 中注册于 catch-all 之前 |

## 1. 定位与边界

**是**：平台运营方（管理员 / 运营 / 财务）使用的内部控制台。

**不是**：

- 不是 C 端账号设置页（那是 `/account` `/works` `/library` `/stats` 的职责）。
- 不是公开 UGC 审核平台：素材库按 `ownerId` 私有，无公开内容流。
- 不是支付凭据的查看台：后台可维护支付适配器的版本化配置，但密钥明文永不回显，只给「是否已配置」。
- 不复用 C 端外壳：`AppLayout` / `SideRail` / `PromoBar` 都是消费级语义，后台用独立外壳 `admin-ui/shell/AdminBoardLayout`。

## 2. 信息架构

8 组 31 页，菜单项由 `permission` 字段过滤，`planned` 标记的项置灰但可见（明确告知规划状态而非直接隐藏）。

| 组 | 页面 |
| --- | --- |
| 总览 | 平台概览 / 告警中心 |
| 运营 | 用户管理 / 素材管理 / 任务监控 / 工单处理 |
| 模型与渠道 | 模型商品 / 插件 / 能力与模型 / 用户分组 / 调用记录 |
| 交易 | 商品管理 / 会员套餐 / 订单管理 / 积分账本 / 优惠券 / 限时活动 / 邀请与签到 |
| 财务 | 支付充值 / 发票管理 / 生成账单 / 财务分析 |
| 内容与合规 | 法务文档 / 站内消息 / AI 标识 |
| 系统 | 角色权限 / 系统设置 / 存储配置 / 定时任务 |
| 数据安全 | 数据备份 / 保留期清理 |

分组理由：按**使用频率 + 业务链路**排序，而非代码目录。「模型与渠道」是生成链路的生产关键配置，排障路径要求最短，紧随日常运营放在第 3；组内按供应侧 → 协议 → 能力与模型 → 人群 → 排障排列。「财务」把收钱、开票、生成账单、财务分析收拢到一处，账单口径不再散落在模型组；「交易」仍是「卖什么、卖了多少」，与钱已收进来之后的动作分属不同角色。「内容与合规」是**发给全体用户的话**（法务文本、站内消息、AI 标识都会烙印到每个账号 / 每张产出图上），误改一条协议比调错一次价格更难挽回。「数据安全」只在出事时进，频率与日常运营不同，留在末尾。

详情一律用抽屉，不新增独立路由，便于保留列表筛选态。

## 3. 模块功能

### 3.1 平台概览 `/admin`

`overview.service.ts` 一次聚合返回三段数据：

| 段 | 内容 |
| --- | --- |
| `totals` | 用户总数与窗口内新增、项目数、任务总数 / 成功 / 失败 / 进行中 / 成功率、素材总量 / 原始 / 生成 |
| `trend` | 按日任务趋势（`days` 参数，默认 7 天） |
| `window` | 窗口口径任务量 / 成功率 / 失败原因 Top 6 / 窗口营收与新增用户 |
| `comparison` | 上一等长窗口的同口径数字，用于环比 |
| `commerce` | 订单计数、累计 GMV、窗口内 GMV、待付金额、退款（累计与窗口）、支付成功率、会员活跃与新增、积分发放与消耗、收入渠道构成、营收趋势 |

金额一律整数分，后端不做展示层格式化。支付成功率无流水时返回 `null` 而非 `0`——`0%` 会被误读为「全挂了」。右下角列出最近任务，带能力名、状态、错误码、耗时与缩略图。响应带 `generatedAt`，接口按 `days` 做 30 秒内存缓存，页面显示「数据截至」。

### 3.2 用户管理 `/admin/users`

| 动作 | 说明 |
| --- | --- |
| 列表 | 邮箱 / 昵称 / 角色 / 状态 / 注册时间 / 最近登录 / 项目数与任务数；支持关键字、角色、状态筛选与排序 |
| 启用 / 禁用 | `User.status` 改动后旧 token 立即失效（`AdminGuard` 与 `JwtAuthGuard` 均查库校验） |
| 角色变更 | `user` / `admin` / `operator` / `finance`；最后一个 `admin` 不可降级，服务层断言返回 409 |
| 重置密码 | 生成一次性密码，仅当次响应可见 |
| 删除 | 走与 C 端自助注销同一份 `account-lifecycle.service.ts`：清除作品 / 素材 / 项目 / 积分批次与对象存储文件，保留订单 / 支付 / 退款 / 发票 / 流水并匿名化 |
| 登录记录 | `GET /admin/users/:id/logins` |
| 影响面预览 | `GET /admin/users/:id/impact`，删除前展示将清除与保留的量 |
| 批量 / 导出 | 批量启停（≤100 条，逐条结果）、CSV 导出；刻意不提供批量删除 |

### 3.3 项目与素材 `/admin/assets`

| 模块 | 能力 |
| --- | --- |
| 项目 | `GET /admin/projects` 分页；`DELETE /admin/projects/:id` 连带素材与任务 |
| 素材 | 缩略图 / kind / 能力 / 尺寸 / 格式 / 体积 / 所属用户与项目 / 上传时间；按 kind、能力、用户、时间筛选；统计接口 `assets/stats` |
| 下架 | `PATCH /admin/assets/:id/status` 置 `hidden`，C 端列表过滤；影响面预览 `assets/:id/impact` |
| 删除 | 连带磁盘文件，二次确认列出删除量 |
| 批量 / 导出 | `assets/batch` / `assets/batch-status` / `assets/export` |

### 3.4 任务监控 `/admin/tasks`

列表带任务 ID / 能力 / 状态 / 用户 / 项目 / 耗时 / errorCode。详情弹窗是任务的集中排障入口，按 `taskId` 串起：用户提交时间 → 积分预留 / 结算 → 线路尝试 → 模型调用 → 产出 → 退款 / 人工核对。任务与线路来自 `GET /admin/tasks/:id`（`task.read`）；最近 20 次模型调用来自 `/admin/api-logs?taskId=`（`model.call_read`）；账单来自 `/admin/billing-orders?taskId=`（`billing_order.read`）。无对应权限时仅展示权限说明，不发起请求，并可分别深链到调用记录页和账单列表。

线路尝试按 `routeRun / attemptNumber` 展示，运营可直接区分“建连前网络失败、可安全切线”“上游已接单”“上游未接单”“结果待确认”。资金是否已处理必须以账单终态为准：系统对账退款显示“无需人工复核”，仅 `reviewable=true` 进入待人工核对。失败任务可重试（用原参数新建任务，不复用旧 ID，避免 `outputAssetId @unique` 约束被绕过），运行中任务可终止（置 `failed` + `cancelled_by_admin`）。`GET /admin/tasks/stats` 给各状态计数，积压数量在顶部标红。

### 3.5 工单处理 `/admin/tickets`

`GET /admin/tickets`、`/:id`、`POST /:id/replies`、`PATCH /:id`（改状态或指派）、`stats`、`export`。状态机只在 `tickets.service.ts` 的 `TRANSITIONS` 定义；客服回复即 `open → processing` 并自动认领 `assigneeId`；`assigneeId: null` 表示取消指派，只能指派给启用中的后台账号。

**与订单的边界**：工单是沟通与记录通道，退款等财务动作一律到订单模块执行，避免两处都能改钱。

### 3.6 法务文档 `/admin/legal`

四类固定 slug：`user-agreement` / `privacy-policy` / `minors-policy` / `account-rules`（`LEGAL_SLUGS`）。按 `(slug, version)` 版本化：`PUT` 新建草稿，`POST /:slug/:version/publish` 发布。已发布版本不可原地覆盖，改文本须升版本号；发布时同 slug 的其他已发布版本自动归档，保证「当前生效」唯一。读 `legal.read`、写 `legal.write`。

### 3.7 站内消息 `/admin/notifications`

`broadcast` 全站广播、`templates` 模板读写、`channels` 展示邮件 / 短信**实际生效实现**（`provider` / `delivers` / `configured`，不含凭据）。模板只替换 `{name}` 形式占位符，缺失时回落代码内置文案。权限 `message.write`。

### 3.8 AI 标识 `/admin/aigc-label`

顶部「显示可见角标」开关（关闭时给法律风险提示）；左侧编辑样式（文案、字体族 / 字号 / 字重 / 字距 / 字色、底色与不透明度、圆角、内边距、圆点色、位置、缩放、边距、整体不透明度），右侧两层预览——CSS 还原的外观与 Canvas 按服务端同一套几何规则画在示例底图上的效果。保存时浏览器 Canvas 以 2x 渲染 PNG，与 `specJson` 原子提交。关闭状态下仍渲染并保存位图，重新开启即恢复原样式。读 `setting.read`、写 `setting.write`。

### 3.9 交易与积分

| 页面 | 功能 |
| --- | --- |
| 商品管理 | 积分包 SKU 新建 / 编辑 / 上下架 / 删除（只删没有历史订单的 SKU，有订单的 409 提示改为下架，对账靠快照与 SKU 保留）；`product.publish` 控制上下架，`product.delete` 控制删除 |
| 会员套餐 | 套餐列表、新建、改价 / 改权益 / 上下架；编码不可改，已付会员按 `perksSnapshot` 保留原权益 |
| 订单管理 | 列表与详情、标记已支付、发起渠道退款（`order.refund`，必填原因） |
| 积分账本 | 用户余额总览、批次与流水、人工增减（`credit.adjust`）、CSV 导入导出（导入走 `credit.adjust`，导出走 `credit.read + data.export`，按邮箱匹配逐行报结果） |
| 能力与模型 · 能力消耗价页签 | 读写运行时积分价，生效来源显示 `override` / `campaign`；限时免活动命中时显示活动来源，运营据此判断「改了价没生效」是活动在起作用 |

计费口径详见 `docs/commerce-design.md`。

### 3.10 财务

| 页面 | 功能 | 权限 |
| --- | --- | --- |
| 支付充值（三标签） | ①**支付渠道**：沙箱 / 支付宝 / 微信的启停、版本化配置（密钥留空即沿用，身份字段锁定）、关单分钟、缺失项与风险告警；②**支付对账**：T+1 自动对账的执行与运行记录、差异明细、导出；③**支付异常**：真资金差异的认领、重试原路退款与人工结案。**商品在「商品管理」、订单与退款在「订单管理」**：充值商品就是 `Product`，支付订单就是 `Order`，查单 / 关单入口在订单页 | 读 `payment.read`；改渠道配置 `payment.write`；查单 / 关单 `payment.operate`；执行对账 / 异常处置 `finance.reconcile`；导出叠加 `data.export` |
| 发票管理 | 审核与开具、驳回；金额取 `paidCents - refundedCents` 快照，输出可打印 HTML；CSV 导出与列表同口径（金额同时给分与元，`invoice.write + data.export`） | `invoice.write` |

支付域留在本页的三件事合成一个页面：渠道配置决定能不能收钱，对账是钱与事实的核对，异常队列承接需要人工兜底的真实差异 —— 拆成多个侧栏入口会让人以为它们互相独立。商品与订单分别回到 `Product` / `Order` 自己的页面（`/admin/products`、`/admin/orders`），不再在支付域维护第二套列表与动作。旧路由 `/admin/payment-channels` 与 `/admin/reconciliation` 改为重定向，不 404。

对账处置权只给财务：人工处置会让「账对不上」从看板上消失，但**对账本身不提供改钱入口** —— 补发由系统自动完成，人工处理（重复扣款等）走订单退款流程。

### 3.11 系统

| 页面 | 功能 |
| --- | --- |
| 角色权限 | 查看与调整三个内置角色的权限点（含 `admin`，批量更新只校验权限点合法与角色存在，不阻止裁剪）；角色本身不可删除；多角色改动单事务提交，避免半保存；改动因守卫每次请求查库而立即生效；高危权限点单独标注；有未保存勾选时吸附显示保存条，站内跳转先确认 |
| 系统设置 | 站点 / 上传 / 生成 / 退款规则等分组配置，默认值定义在 `common/setting-defs.ts` 的 `SETTING_DEFS` |
| 存储配置 | 当前后端、容量统计、连通性探测、切换新上传的后端（已写入的素材仍按写入时记录的后端读取）；后端未就绪（SDK 未装或凭据缺失）时上传直接失败，不静默回退本地盘 |
| 定时任务 | 各任务上次 / 下次执行、结果、手动触发 |

### 3.12 模型

| 页面 | 功能 |
| --- | --- |
| 模型商品 `/admin/channels` | 默认商品台账：渠道模型作为商品跨供应商展示，带消费能力、健康与售价；供应商视图保留渠道（凭证加密存储）与渠道模型（模态 / 接入方式 / 权重 / 优先级 / 售价）配置。支持测草稿、连通性测试、从供应商拉取实时模型清单（令牌只在请求内使用，不落库） |
| 能力与模型 `/admin/capabilities` | 以能力为主实体：卡片展示 18 项能力的运行状态与上下线动作，并内联消费的模型商品、用户实付与售卖状态。底层维护 `LogicalModel` + 发布快照（revision）+ 线路（route），可用「消费测试」只读验证落点；旧地址 `/admin/logical-models` 重定向到本页并保留 query/hash |
| 用户分组 `/admin/user-groups` | 分组决定倍率、可见渠道与按模型的覆盖价格；没有有效会员的用户落在 `default` 分组，默认分组不可删除 |
| 插件 `/admin/plugins` | 协议来源：启停即重注册协议，渠道模型可选的协议列表随之变化；支持安装、校验与查看服务商目录 |
| 调用记录 `/admin/model-calls` | `ApiCallLog` 列表与详情：能力、协议、渠道、耗时、结果、`RouteAttempt.failureCode` 与错误摘要；CSV 导出与列表同口径（`model.call_read + data.export`），不含请求体 / 响应体 |
| 生成账单 `/admin/billing-orders` | `BillingOrder` 列表与详情；`uncertain` 账单只能人工结算或退款 |
| 财务分析 `/admin/finance` | 实收 = 已结算账单、已退 = 订单退款、净收入 = 实收 − 已退；预留 / 运行 / 待核对单列为「挂账」，不计入实收 |
| 能力与模型的上下线 | 下架原因由页面统一生成；下线后 C 端 `runtime.effective=disabled`，任务在扣费前被拦截并返回 `40005`。能力开关与售卖配置分别校验 `capability.write` / `logical_model.write`，不做混合保存 |

读 `channel.read` / `channel.model_read` / `logical_model.read` / `user_group.read` / `plugin.read` / `billing_order.read` / `model.call_read` / `model.analytics_read`；写 `channel.write` / `channel.model_write` / `logical_model.write` / `user_group.write` / `plugin.write`，账单处置 `billing_order.resolve`。`channel.test` 覆盖存储 / 通知探测与模型渠道连通性测试，只探测、不写配置。运营只读，不可写；财务可读账单与财务分析并处置挂账单。

### 3.13 数据安全

| 页面 | 功能 |
| --- | --- |
| 数据备份 | 手动 / 定时备份、SHA-256 校验、下载、按份数裁剪、清理日志 |
| 保留期清理 | 各目标（文件、日志、记录）可清理量预览与执行，结果落 `CleanupLog` |

备份与清理均属高危动作，执行前需二次确认。

### 3.14 全局能力

| 能力 | 实现 |
| --- | --- |
| 角色工作台 | `GET /admin/workbench` 按权限返回工单 / 任务 / 退款 / 对账 / 发票 / 账单 / 备份七组待办，每组前 5 条实体行；`admin` 可用 `?view=operator\|finance` 预览视角，视图不放大范围。`/admin` 首屏按 `roleView` 渲染，管理员可切换视角 |
| 全局搜索 | 后端保留 `GET /admin/search?q=`（用户 / 订单 / 工单 / 任务 / 素材五组各前 5 条 + 总数，`q` 长度 < 2 返回空组）；当前后台外壳**未挂载前端入口**，前端封装已随 2026-11 外壳重建移除。接入时在顶栏重新挂入口即可，接口与权限不变 |
| 保存视图 | 工单 / 任务 / 订单 / 生成账单 / 发票支持内置视图与本机保存；存储键 `huojue.admin.views.<userId>.<pageKey>`，不落库 |
| 上下文直达 | 工单关联订单带 `intent=refund&returnTo=` 打开退款弹窗；任务账单带 `intent=settle&returnTo=`；动作完成后回来源并显示结果条；`returnTo` 只接受站内 `/admin` 路径 |
| 工单处理增强 | 列表行内认领；抽屉支持回复模板、内部备注（`visibility=internal`，不推送不下发）、指派下拉、上一条/下一条、转交财务（内部备注 + 指派 + `processing`，不改钱） |
| 告警中心 | `GET /admin/alerts` 聚合待处理工单 / 失败任务 / 对账差异 / 退款卡单 / 备份 / 发票；按角色权限过滤来源，无待处理项不产生条目；顶栏 60 秒轮询，页面隐藏时暂停 |
| 筛选深链 | 用户 / 素材 / 任务 / 工单 / 订单 / 商品 / 调用记录 / 发票 / 优惠券 / 活动 / 积分账本 / 对账批次 / 能力与模型 / 告警的已生效筛选会写回地址栏（`replace`，不含分页），刷新或转发链接即复现同一口径；列表上方回显可逐条清除的筛选标签；导出同样取已生效筛选（含工单归属），而不是输入框草稿 |
| 详情深链 | 用户 / 订单 / 任务 / 工单 / 模型调用的详情浮层与地址栏 `?id=` 双向同步：从列表打开会写回 URL，刷新或转发可恢复同一条详情，关闭即移除 id；任务详情中的项目入口切回同页列表时同步应用 `projectId` 筛选 |
| 关联直达 | 工单提交人 / 订单用户 / 任务用户 / 用户详情 / 积分明细中的关联字段可直达已支持的用户、订单、任务、积分与素材筛选；工单里的关联订单、任务里的重试来源分别用订单号、任务 ID 打开；只使用目标列表真实支持的查询键，不造前端私有筛选 |
| 对账筛选 | 批次列表按渠道、运行状态、账单日（单日）在服务端过滤；渠道与账单日同时是「执行对账」的入参，页面只保留这一套条件，执行成功后列表切到本次执行条件；分页总数与筛选同口径，日期按渠道营业日而非导入时间 |
| 能力定位 | 能力与模型支持按名称 / ID / 模型关键词、分组与运行结论筛选；运行结论筛选直接用于定位暂不可用或已下线能力 |
| 未保存保护 | 邀请与签到、保留期清理等页面级草稿会拦截站内跳转与刷新；商品、优惠券、活动、法务、消息模板、模型线路、工单回复与积分调整/导入等编辑抽屉关闭前确认是否放弃修改 |
| 批量动作 | `POST /admin/{users,assets,tasks,orders}/batch`，`ids ≤ 100`，串行执行、不包事务，逐条返回 `{ id, ok, message?, data? }` |
| CSV 导出 | `common/csv.ts`：UTF-8 BOM + RFC4180 + 公式注入前导 `'`；不走 JSON 信封 |
| CSV 导入 | 仅积分导入，按邮箱匹配，逐行报结果 |

## 4. 权限链

```
JwtAuthGuard（身份）→ AdminGuard（后台身份 + 账号状态）→ PermissionGuard（权限点）→ Controller
```

- **每次查库**：token TTL 7 天，若只信 token，管理员降权或被禁用后旧 token 仍可用 7 天。SQLite 单文件、admin 接口低频，查库成本可忽略。
- **兜底默认拒**：`PermissionGuard` 未命中权限点即 403 `40301`。
- **前端 `AdminContext.can()` 只用于隐藏按钮**，不是安全边界。
- **批量与导出**：路由挂较弱读权限，处理器内用 `AdminRoleService.hasPermission()` 再判动作权限。

## 5. 数据访问约束

| 约束 | 说明 |
| --- | --- |
| 平台级聚合独立 | C 端 `stats/overview` 强制按 `ownerId` 过滤，后台看板用独立的 admin 聚合，不复用 |
| 能力清单不落库 | 能力的名称、分组、参数、默认价仍以 `definitions/<id>.ts` 为准；后台只写「上下线」与「运行期价格」两类覆盖 |
| 凭据只从环境变量读 | 支付通道、模型凭据、对象存储密钥均无写入端点；界面只展示是否齐备与脱敏值 |
| 金额与积分用快照 | 退款按订单快照计算，人工调整写流水，不按当前价重算 |
| 删除走统一生命周期 | 用户删除与 C 端自助注销共用 `account-lifecycle.service.ts`，两条路径行为一致 |

## 6. 前端落地

| 层 | 约定 |
| --- | --- |
| 路由 | `/admin/*` 在 `App.tsx` 中必须注册在 catch-all 之前，否则会被 C 端 `Shell` 吞掉 |
| 外壳 | `admin-ui/shell/AdminBoardLayout.tsx` + `components/admin/adminNav.ts`（菜单单一事实源） |
| 页面 | `pages/admin/` 31 个页面 + `channels/`、`payments/` 子目录 |
| 请求 | `lib/api.ts` 的 `adminApi` 分组复用 `request()`（信封剥离、401 广播） |
| 类型 | `types/api.d.ts` 的 `Admin*` 段 |
| 组件 | 通用骨架走 `admin-ui/primitives`（`PageHeader` / `FilterBar` / `StatCard` / `Panel` / `EmptyState` / `StatusTag` / `ConfirmDialog`），底层是 shadcn 原子件；后台树内不引 antd，`adm-*` 只剩外壳骨架三个类（`adm-layout` / `adm-content` / `adm-skip-link`） |
| 样式 | 只用 `global.css` 的 token，禁裸 hex；不做移动端适配 |

## 7. 明确不做

| 不做 | 理由 |
| --- | --- |
| 多租户 / 企业席位 / 代理分销 | 单轨制，`User` 不加 `orgId`；改多租户要动全部查询，须有真实付费数据后再评估 |
| 自定义角色 | 三个内置角色覆盖实际分工；权限点可调，角色本身不新增 |
| 支付渠道凭据回显 | 后台可维护版本化配置，但密钥字段只回「是否已配置」，明文永不回显；留空表示沿用旧值 |
| 第三方内容安全送审记录 | 未接入即如实显示「未接入」，不做假审核 |
| 数据分析看板（漏斗 / 留存 / LTV） | 无独立页面；概览只做现有表的聚合 |
