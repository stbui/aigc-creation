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
- 不是支付渠道配置台：凭据只从环境变量读，后台只读展示与告警。
- 不复用 C 端外壳：`AppLayout` / `SideRail` / `PromoBar` 都是消费级语义，后台用独立 `AdminLayout`。

## 2. 信息架构

8 组 29 页，菜单项由 `permission` 字段过滤，`planned` 标记的项置灰但可见（明确告知规划状态而非直接隐藏）。

| 组 | 页面 |
| --- | --- |
| 总览 | 平台概览 / 告警中心 |
| 运营 | 用户管理 / 素材管理 / 任务监控 / 工单处理 |
| 内容 | 法务文档 / 站内消息 / AI 标识 |
| 交易 | 商品管理 / 订单管理 / 积分账本 / 能力消耗价 / 优惠券 / 限时活动 / 邀请与签到 |
| 财务 | 支付渠道 / 发票管理 / 渠道对账 |
| 系统 | 角色权限 / 系统设置 / 存储配置 / 定时任务 / 操作审计 |
| 模型 | 模型配置 / 调用记录 / 能力管控 |
| 数据安全 | 数据备份 / 保留期清理 |

分组理由：「内容」是**发给全体用户的话**（法务文本、站内消息、AI 标识都会烙印到每个账号 / 每张产出图上），误改一条协议比调错一次价格更难挽回；「财务」是钱已收进来之后的动作，与「卖什么 / 卖了多少」不是同一批人；「模型」是生成链路的生产关键配置，排障时不能淹没在通用系统设置里；「数据安全」只在出事时进，频率与日常运营不同。

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

金额一律整数分，后端不做展示层格式化。支付成功率无流水时返回 `null` 而非 `0`——`0%` 会被误读为「全挂了」。右下角列出最近任务，带能力名、状态、通道、错误码、耗时与缩略图。响应带 `generatedAt`，接口按 `days` 做 30 秒内存缓存，页面显示「数据截至」。

### 3.2 用户管理 `/admin/users`

| 动作 | 说明 |
| --- | --- |
| 列表 | 邮箱 / 昵称 / 角色 / 状态 / 注册时间 / 最近登录 / 项目数与任务数；支持关键字、角色、状态筛选与排序 |
| 启用 / 禁用 | `User.status` 改动后旧 token 立即失效（`AdminGuard` 与 `JwtAuthGuard` 均查库校验） |
| 角色变更 | `user` / `admin` / `operator` / `finance`；最后一个 `admin` 不可降级，服务层断言返回 409 |
| 重置密码 | 生成一次性密码，仅当次响应可见，写审计 |
| 删除 | 走与 C 端自助注销同一份 `account-lifecycle.service.ts`：清除作品 / 素材 / 项目 / 积分批次与对象存储文件，保留订单 / 支付 / 退款 / 发票 / 流水并匿名化 |
| 登录记录 | `GET /admin/users/:id/logins` |
| 影响面预览 | `GET /admin/users/:id/impact`，删除前展示将清除与保留的量 |
| 批量 / 导出 | 批量启停与软删（≤100 条，逐条结果）、CSV 导出 |

### 3.3 项目与素材 `/admin/assets`

| 模块 | 能力 |
| --- | --- |
| 项目 | `GET /admin/projects` 分页；`DELETE /admin/projects/:id` 连带素材与任务 |
| 素材 | 缩略图 / kind / 能力 / 尺寸 / 格式 / 体积 / 所属用户与项目 / 上传时间；按 kind、能力、用户、时间筛选；统计接口 `assets/stats` |
| 下架 | `PATCH /admin/assets/:id/status` 置 `hidden`，C 端列表过滤；影响面预览 `assets/:id/impact` |
| 删除 | 连带磁盘文件，二次确认列出删除量 |
| 批量 / 导出 | `assets/batch` / `assets/batch-status` / `assets/export` |

### 3.4 任务监控 `/admin/tasks`

列表带任务 ID / 能力 / 状态 / 通道 / 用户 / 项目 / 耗时 / errorCode；详情抽屉给输入素材、参数 JSON、产出图与完整错误码。失败任务可重试（用原参数新建任务，不复用旧 ID，避免 `outputAssetId @unique` 约束被绕过），运行中任务可终止（置 `failed` + `cancelled_by_admin`）。`GET /admin/tasks/stats` 给各状态计数，积压数量在顶部标红。

### 3.5 工单处理 `/admin/tickets`

`GET /admin/tickets`、`/:id`、`POST /:id/replies`、`PATCH /:id`（改状态或指派）、`stats`、`export`。状态机只在 `tickets.service.ts` 的 `TRANSITIONS` 定义；客服回复即 `open → processing` 并自动认领 `assigneeId`；`assigneeId: null` 表示取消指派，只能指派给启用中的后台账号。

**与订单的边界**：工单是沟通与记录通道，退款等财务动作一律到订单模块执行，避免两处都能改钱。

### 3.6 法务文档 `/admin/legal`

四类固定 slug：`user-agreement` / `privacy-policy` / `minors-policy` / `account-rules`（`LEGAL_SLUGS`）。按 `(slug, version)` 版本化：`PUT` 新建草稿，`POST /:slug/:version/publish` 发布。已发布版本不可原地覆盖，改文本须升版本号；发布时同 slug 的其他已发布版本自动归档，保证「当前生效」唯一。读 `legal.read`、写 `legal.write`，发布必填原因。

### 3.7 站内消息 `/admin/notifications`

`broadcast` 全站广播、`templates` 模板读写、`channels` 展示邮件 / 短信**实际生效实现**（`provider` / `delivers` / `configured`，不含凭据）。模板只替换 `{name}` 形式占位符，缺失时回落代码内置文案。权限 `message.write`。

### 3.8 AI 标识 `/admin/aigc-label`

顶部「显示可见角标」开关（关闭时给法律风险提示）；左侧编辑样式（文案、字体族 / 字号 / 字重 / 字距 / 字色、底色与不透明度、圆角、内边距、圆点色、位置、缩放、边距、整体不透明度），右侧两层预览——CSS 还原的外观与 Canvas 按服务端同一套几何规则画在示例底图上的效果。保存时浏览器 Canvas 以 2x 渲染 PNG，与 `specJson` 原子提交。关闭状态下仍渲染并保存位图，重新开启即恢复原样式。读 `setting.read`、写 `setting.write`，保存必填原因，审计动作 `aigc.label_update`。

### 3.9 交易与积分

| 页面 | 功能 |
| --- | --- |
| 商品管理 | SKU 增删改、上下架、消耗价表；`product.publish` 控制上下架 |
| 订单管理 | 列表与详情、标记已支付、发起渠道退款（`order.refund`，必填原因） |
| 积分账本 | 用户余额总览、批次与流水、人工增减（`credit.adjust`）、CSV 导入导出（`data.import` / `data.export`，按邮箱匹配逐行报结果） |
| 能力消耗价 | 读写运行时积分价，生效来源显示 `override` / `campaign`；限时免活动命中时显示活动来源，运营据此判断「改了价没生效」是活动在起作用 |

计费口径详见 `docs/commerce-design.md`。

### 3.10 财务

| 页面 | 功能 | 权限 |
| --- | --- | --- |
| 支付渠道（只读） | 生效通道、各通道凭据是否齐全、缺失变量名、回调地址；三类静默故障告警：真实通道缺凭据（发起支付 503）、生产仍走沙箱、未配 `PAYMENT_NOTIFY_BASE` 导致回调不可公网访问 | `payment.read` |
| 发票管理 | 审核与开具、驳回；金额取 `paidCents - refundedCents` 快照，输出可打印 HTML | `invoice.write` |
| 渠道对账 | CSV 导入（RFC4180 + 表头别名，金额单位按表头含 `cent|分` 判定）、批次与明细、五类差异、处置只改状态与备注不改钱、导出 | `finance.reconcile` |

对账处置权只给财务：处置会让「账对不上」从看板上消失。

### 3.11 系统

| 页面 | 功能 |
| --- | --- |
| 角色权限 | 查看与调整三个内置角色的权限点（含 `admin`，`updatePermissions` 只校验权限点合法与角色存在，不阻止裁剪）；角色本身不可删除；改动因守卫每次请求查库而立即生效；高危权限点单独标注 |
| 系统设置 | 站点 / 上传 / 生成 / 退款规则等分组配置，默认值定义在 `settings.dto.ts` 的 `SETTING_DEFS` |
| 存储配置 | 当前后端、容量统计、连通性探测、切换新上传的后端（已写入的素材仍按写入时记录的后端读取）；后端未就绪（SDK 未装或凭据缺失）时上传直接失败，不静默回退本地盘 |
| 定时任务 | 各任务上次 / 下次执行、结果、手动触发 |
| 操作审计 | 按操作人 / 动作 / 时间筛选，详情含原因、IP、请求 ID；只读，无删除接口 |

### 3.12 模型

| 页面 | 功能 |
| --- | --- |
| 模型配置 | 页签「线路管理 / 可用模型 / 逐能力路由 / 全局设置」。线路按模态分组，支持增删改、排序、启停、测草稿、连通性测试、多渠道主备；「可用模型」合并内置预设与厂商实时清单（`POST /admin/model-channels/models`，令牌只在请求内使用，不落库不进审计） |
| 调用记录 | `ModelCallLog` 列表与详情：通道、模型、耗时、结果、回落原因与错误摘要 |
| 能力管控 | 16 项能力的上下线，下架必填原因；下线后 C 端 `runtime.effective=disabled`，任务在扣费前被拦截并返回 `40005` |

读 `model.config_read`、写 `channel.route` / `model.config_write`、测试 `channel.test`。运营可读可测，不可写。

### 3.13 数据安全

| 页面 | 功能 |
| --- | --- |
| 数据备份 | 手动 / 定时备份、SHA-256 校验、下载、按份数裁剪、清理日志 |
| 保留期清理 | 各目标（文件、日志、记录）可清理量预览与执行，结果落 `CleanupLog` |

备份与清理均属高危动作，写审计。

### 3.14 全局能力

| 能力 | 实现 |
| --- | --- |
| 全局搜索 | `GET /admin/search?q=` 用户 / 订单 / 工单 / 任务 / 素材五组各前 5 条 + 总数；`q` 长度 < 2 直接返回空组，避免五个 `LIKE` 全表扫描 |
| 告警中心 | `GET /admin/alerts` 聚合待处理工单 / 失败任务 / 对账差异 / 退款卡单 / 备份 / 发票；按角色权限过滤来源，无待处理项不产生条目；顶栏 60 秒轮询，页面隐藏时暂停 |
| 批量动作 | `POST /admin/{users,assets,tasks,orders}/batch`，`ids ≤ 100`，串行执行、不包事务，逐条返回 `{ id, ok, message?, data? }` |
| CSV 导出 | `common/csv.ts`：UTF-8 BOM + RFC4180 + 公式注入前导 `'`；不走 JSON 信封 |
| CSV 导入 | 仅积分导入，按邮箱匹配，逐行报结果 |

## 4. 权限链与审计

```
JwtAuthGuard（身份）→ AdminGuard（后台身份 + 账号状态）→ PermissionGuard（权限点）→ Controller → AuditInterceptor
```

- **每次查库**：token TTL 7 天，若只信 token，管理员降权或被禁用后旧 token 仍可用 7 天。SQLite 单文件、admin 接口低频，查库成本可忽略。
- **兜底默认拒**：`PermissionGuard` 未命中权限点即 403 `40301`。
- **前端 `AdminContext.can()` 只用于隐藏按钮**，不是安全边界。
- **批量与导出**：路由挂较弱读权限，处理器内用 `AdminRoleService.hasPermission()` 再判动作权限。
- **审计**：高危动作（`HIGH_RISK_PERMISSIONS`）必须填原因，落 `AdminAuditLog`（含 IP 与请求 ID），审计页只读。

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
| 外壳 | `components/admin/AdminLayout.tsx` + `adminNav.ts`（菜单单一事实源） |
| 页面 | `pages/admin/` 29 个页面 + `modelConfig/` 子组件目录 |
| 请求 | `lib/api.ts` 的 `adminApi` 分组复用 `request()`（信封剥离、401 广播） |
| 类型 | `types/api.d.ts` 的 `Admin*` 段 |
| 组件 | 通用骨架走 antd（`PageHeader` / `FilterBar` / `StatCard` / `Panel` / `Empty` / `StatusTag` / `ConfirmAction`）；`adm-*` 只作业务布局 class |
| 样式 | 只用 `global.css` 的 token，禁裸 hex；不做移动端适配 |

## 7. 明确不做

| 不做 | 理由 |
| --- | --- |
| 多租户 / 企业席位 / 代理分销 | 单轨制，`User` 不加 `orgId`；改多租户要动全部查询，须有真实付费数据后再评估 |
| 自定义角色 | 三个内置角色覆盖实际分工；权限点可调，角色本身不新增 |
| 支付渠道切换的前端入口 | 切换须改 env 并重启，页面只读 + 风险告警 |
| 第三方内容安全送审记录 | 未接入即如实显示「未接入」，不做假审核 |
| 独立审计存储 / hash 链 | 当前审计只读且无删除接口；防篡改需独立存储，非本期范围 |
| 数据分析看板（漏斗 / 留存 / LTV） | 无独立页面；概览只做现有表的聚合 |
