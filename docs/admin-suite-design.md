# 后台总体设计（全域 · RBAC · 信息架构）

后台管理端 `/admin` 的总体设计：域地图、角色权限、合规专项、数据模型分组、API 分组与统一规范。分域细节见另三份文档。

| 项 | 事实源 |
| --- | --- |
| 侧栏分组与页面清单 | `frontend/src/components/admin/adminNav.ts` 的 `ADMIN_MENU` |
| 权限点与内置角色 | `backend/src/admin/permissions.ts` |
| 高危动作清单 | 同上 `HIGH_RISK_PERMISSIONS` |
| 功能与页面细节 | `docs/admin-console-design.md` / `docs/admin-detailed-design.md` / `docs/admin-ui-design.md` |
| 交易域 | `docs/commerce-design.md` |
| 后台需求 | `docs/admin-prd.md` |

---

## 1. 域名地图

| 域 | 模块 | 界面 |
| --- | --- | --- |
| 总览 | 平台概览 | `/admin` |
| 运营 | 用户 / 素材 / 任务 / 工单 | `/admin/users` · `/admin/assets` · `/admin/tasks` · `/admin/tickets` |
| 内容 | 法务文档 / 站内消息 / AI 标识 | `/admin/legal` · `/admin/notifications` · `/admin/aigc-label` |
| 交易 | 商品 / 会员套餐 / 订单 / 积分账本 / 能力消耗价 / 优惠券 / 限时活动 / 邀请与签到 | `/admin/products` 等 8 页 |
| 财务 | 支付充值 / 发票 | `/admin/payments` · `/admin/invoices` |
| 系统 | 角色权限 / 系统设置 / 存储配置 / 定时任务 / 操作审计 | `/admin/roles` 等 5 页 |
| 模型 | 渠道工作台 / 前台模型 / 用户分组 / 插件 / 能力管控 / 调用记录 / 生成账单 / 财务分析 | `/admin/channels` · `/admin/logical-models` · `/admin/user-groups` · `/admin/plugins` · `/admin/capabilities` · `/admin/model-calls` · `/admin/billing-orders` · `/admin/finance` |
| 数据安全 | 数据备份 / 保留期清理 | `/admin/backups` · `/admin/retention` |

合计 34 页、8 组。菜单项的 `permission` 字段决定可见性，外壳 `AdminBoardLayout` 只渲染当前角色有权限的项。

### 1.1 分组理由

分组不是按代码目录，而是按**误改的代价**：

| 组 | 理由 |
| --- | --- |
| 内容 | 发给全体用户的话（法务正文、站内消息、AI 标识样式），每条都会烙印到每个账号或每张产出图上，误改比调错价格更难挽回 |
| 交易 / 财务 | 「卖什么、卖了多少」与「钱已收进来之后的动作」不是同一批人；退款、对账、开票归财务 |
| 模型 | 生成链路的生产关键配置，排障时不能淹没在通用系统设置里 |
| 数据安全 | 只在出事时进，使用频率与日常运营不同，独立成组避免误触 |

### 1.2 合规专项（AIGC 内容标识）

《人工智能生成合成内容标识办法》要求生成内容同时具备**显式标识**（用户可感知）与**隐式标识**（文件元数据）。实现见 `backend/src/common/aigc-label.ts`：

| 能力 | 实现 |
| --- | --- |
| 显式标识 | 产出图合成可配置角标（文案/字体/字号/配色/位置/缩放/不透明度），默认值在 `common/aigc-label.config.ts` 的 `AIGC_LABEL_DEFAULTS` |
| 隐式标识 | PNG 写 `tEXt` + `iTXt`（XMP）、JPEG 写 APP1 XMP，逐 chunk 重算 CRC32，声明 `DigitalSourceType=trainedAlgorithmicMedia` |
| 顺序约束 | 先合成角标再写元数据。反序会打乱偏移、损坏图片 |
| 失败策略 | 显式标识失败 → 任务 `failed/42203` 并退款（fail-closed，未标识产出不落库）；元数据写入失败 → 告警但仍落库（fail-open） |
| 关闭影响 | 后台可整体关闭可见角标，此时**隐式标识照常写入**且产出不重编码；若隐式写入也失败（webp/gif 等无写入路径的格式），仍按失败退款 |
| 样式存储 | `AigcLabelConfig` 单行（`id='default'`）：`specJson` 样式 + `pngBase64` 浏览器 Canvas 渲染的位图 + `specKey` 过期判定 |

中文字标必须预渲染成位图：Jimp 内置字体只有 ASCII，服务端不引入字体依赖，改样式时由浏览器 Canvas 以 2x 渲染 PNG 随 spec 原子提交。

`remove_watermark`（去除水印）能力存在被用于剥离他人图片 AIGC 标识的合规敞口，管控手段是后台「能力管控」页：可整体下线并必填原因，下线后 C 端不可提交、任务在扣费前被拦截（`40005`）。当前 `compliance.*` 三个权限点（`compliance.read` / `compliance.gate` / `compliance.takedown`）为预留点，尚无端点消费；能力上下线实际走 `capability.write`。

---

## 2. RBAC

### 2.1 三个内置角色

| 角色 | code | 定位 | 权限点数 |
| --- | --- | --- | ---: |
| 平台管理员 | `admin` | 全部权限 | 66 |
| 运营 | `operator` | 用户/项目/素材/任务只读或受限写、营销、消息、工单、法务只读、模型侧只读 | 33 |
| 财务 | `finance` | 商品/订单/退款/积分调整/发票/对账，模型成本与生成账单只读、账单可处置 | 27 |

**为什么必须拆**：财务能退款 = 能改钱，运营能删用户 = 能毁数据。两种权限绑在一个布尔位上，出了事无法区分是谁做的，审计日志也失去意义。

`operator` 的模型侧只有读权限（`channel.read` / `channel.model_read` / `logical_model.read` / `user_group.read` / `plugin.read` / `billing_order.read` / `model.analytics_read`）与调用记录 `model.call_read`；写渠道、渠道模型（含凭证与价格档）、前台模型、分组与插件一律拒绝。`channel.test` 同时覆盖存储 / 通知探测与模型渠道连通性测试，只探测、不写配置；渠道模型本身的编辑仍受 `channel.model_write` 管控。`finance` 额外持有 `billing_order.resolve`，可对 `uncertain` 账单人工结算或退款。

### 2.2 权限点

66 个，命名格式 `<模块>.<动作>`，定义在 `backend/src/admin/permissions.ts` 的 `PERMISSIONS`，按角色存为 `AdminRole.permissions` 的 JSON 数组字符串。

| 模块 | 权限点 |
| --- | --- |
| 平台 | `platform.dashboard` |
| 用户 | `user.read` / `user.write` / `user.disable` / `user.delete` / `user.reset_password` |
| 项目与素材 | `project.read` / `project.delete` / `asset.read` / `asset.hide` / `asset.delete` |
| 任务 | `task.read` / `task.retry` / `task.cancel` / `task.delete` |
| 商品 | `product.read` / `product.write` / `product.price` / `product.publish` |
| 订单与支付 | `order.read` / `order.mark_paid` / `order.refund` / `payment.read` / `payment.write` / `payment.operate` / `finance.dashboard` / `invoice.write` / `finance.reconcile` |
| 积分 | `credit.read` / `credit.adjust` |
| 合规与内容 | `compliance.read` / `compliance.gate` / `compliance.takedown` / `content.read` |
| 能力 | `capability.read` / `capability.write` |
| 渠道与线路 | `channel.read` / `channel.write` / `channel.test` / `channel.model_read` / `channel.model_write` |
| 前台模型与分组 | `logical_model.read` / `logical_model.write` / `user_group.read` / `user_group.write` |
| 插件 | `plugin.read` / `plugin.write` |
| 账单与台账 | `billing_order.read` / `billing_order.resolve` / `model.call_read` / `model.analytics_read` |
| 增长与服务 | `marketing.write` / `message.write` / `ticket.read` / `ticket.handle` |
| 法务 | `legal.read` / `legal.write` |
| 系统 | `setting.read` / `setting.write` / `role.read` / `role.write` / `audit.read` |
| 数据工具 | `data.export` / `data.search` / `backup.read` / `backup.run` |

### 2.3 强制规则

| 规则 | 实现 |
| --- | --- |
| 兜底默认拒 | `PermissionGuard` 比对 `role.permissions`，未命中即 403 `40301`；后端是唯一安全边界，前端 `AdminContext.can()` 只用于隐藏按钮 |
| 孤儿权限点 | 权限点从清单移除后，角色里残留的值 `getPermissions()` 读取时过滤，比对不上即等同无权；过滤只在内存生效，不回写库（回写属管理动作，由角色页显式保存完成） |
| 防提权 | 只有 `admin` 能授予 `admin`，否则 403 `40301`；不能变更自己的角色，否则 400 `40001` |
| 最后一个 admin | 禁用与降级前统计 `status='active'` 的 admin 数，`≤1` 时返回 409 `40901` |
| 高危动作留痕 | 写操作必须留痕；普通管理写操作由 `AuditInterceptor` 自动生成 `AdminAuditLog.reason`，只有退款、发票驳回、能力下架等确有业务语义的动作由 DTO 要求原因。前端只对业务操作做二次确认 |

高危权限点：`user.delete` / `user.reset_password` / `asset.delete` / `project.delete` / `order.refund` / `credit.adjust` / `compliance.takedown` / `capability.write` / `channel.write` / `channel.model_write` / `logical_model.write` / `user_group.write` / `plugin.write` / `billing_order.resolve` / `setting.write` / `legal.write` / `role.write` / `backup.run`。审计链路：`AdminGuard`（身份）→ `PermissionGuard`（权限点）→ controller → `AuditInterceptor`（落库）。

---

## 3. 服务与触达域

| 域 | 模块 | 关键约束 |
| --- | --- | --- |
| 工单 | C 端 `/tickets` + 后台工单中心 | 状态机只在 `tickets.service.ts` 的 `TRANSITIONS` 定义；越权一律 404；客服回复即受理并自动认领 |
| 站内消息 | `notifications`（`@Global()`） | `notify()` 永不抛异常；模板缺失回落内置文案；已接支付成功、任务失败退款、会员到期、工单回复四类事件 |
| 法务文档 | `legal` | 四类固定 slug（`user-agreement` / `privacy-policy` / `minors-policy` / `account-rules`），按 `(slug, version)` 版本化，已发布版本不可原地覆盖，升版本才可改文本 |
| 操作审计 | `AdminAuditLog` + `AuditInterceptor` | 写操作留审计；普通管理动作的原因由系统按动作与结果自动生成，只有退款、发票驳回、能力下架等真实业务原因由调用方提供；AI 标识、能力上下线、渠道 / 前台模型 / 价格写入、账单处置均落审计 |

**与订单的边界**：工单是沟通与记录通道，退款等财务动作一律跳转到订单模块执行，避免两处都能改钱。

---

## 4. 数据模型分组

`backend/prisma/schema.prisma` 共 43 个模型：

| 域 | 模型 |
| --- | --- |
| 用户与权限 | `User` / `OAuthIdentity` / `AdminRole` / `AdminAuditLog` / `SystemSetting` |
| 创作 | `Project` / `Asset` / `GenerationTask` |
| 交易 | `Product` / `Order` / `OrderItem` / `Payment` / `Refund` |
| 权益 | `CreditAccount` / `CreditLot` / `CreditLedgerEntry` / `CreditReservationItem` / `MembershipPlan` / `Membership` / `MembershipUsage` |
| 增长 | `Coupon` / `Campaign` / `InviteRelation` / `InviteRewardRule` / `CheckinRecord` / `CheckinRule` |
| 财务 | `Invoice` / `ReconciliationBatch` / `ReconciliationItem` |
| 身份安全 | `AccountToken` / `LoginLog` / `LoginSession` |
| 内容与合规 | `LegalDocument` / `ConsentRecord` / `Notification` / `MessageTemplate` / `AigcLabelConfig` |
| 服务 | `Ticket` / `TicketReply` |
| 模型层 | `ModelChannel` / `ChannelModel` / `ChannelModelPriceTier` / `LogicalModel` / `LogicalModelRevision` / `LogicalModelRoute` / `RouteAttempt` / `UserGroup` / `UserGroupChannel` / `BillingOrder` / `ApiCallLog` / `CapabilityControl` |
| 运维 | `BackupRecord` / `CleanupLog` / `PluginPlatformState` / `UserPluginState` / `RouteCatalogVersion` |

SQLite provider 不支持 Prisma enum，`kind` / `status` / `type` 一律 String 存储，取值范围由 DTO 白名单强制约束。计费相关字段以**快照**为准（`GenerationTask.creditCost`、`OrderItem.priceCentsSnapshot`），不事后按当前价重算。

`CapabilityControl` 无行 = 能力启用（默认全开，不预置行）。`AigcLabelConfig` 单行 `id='default'`。`AdminRole` 三个内置角色不可删除，但权限点均可调整（含 `admin`），权限存 JSON 数组字符串。

---

## 5. API 分组

前缀 `/api/v1/admin/*`，统一 `JwtAuthGuard + AdminGuard + 权限点校验`；批量动作沿用各领域的动作权限，导出另行叠加 `data.export`。

| 组 | 控制器 |
| --- | --- |
| 身份与概览 `/admin`、`/admin/me`、`/admin/overview`、`/admin/permissions` | `admin.controller.ts` |
| 用户 `/admin/users*` | `users.controller.ts` |
| 项目与素材 `/admin/projects*`、`/admin/assets*` | `assets-admin.controller.ts` |
| 任务 `/admin/tasks*` | `tasks-admin.controller.ts` |
| 工单 `/admin/tickets*` | `tickets-admin.controller.ts` |
| 交易与积分 `/admin/products*`、`/admin/orders*`、`/admin/payments*`、`/admin/credits*`、`/admin/credit-prices*` | `commerce.controller.ts` |
| 营销 `/admin/coupons*`、`/admin/campaigns*`、`/admin/invites*`、`/admin/checkin*` | `marketing.controller.ts` |
| 法务 `/admin/legal*` | `legal.controller.ts` |
| 消息 `/admin/notifications*` | `notifications.controller.ts` |
| 发票 `/admin/invoices*` | `invoices-admin.controller.ts` |
| 支付域 `/admin/payments*`（渠道 / 商品 / 订单 / 对账） | `admin/payments/payment-admin.controller.ts` |
| 渠道 `/admin/channels*`、`/admin/channel-models*` | `model/channels/channel.controller.ts` |
| 前台模型 `/admin/logical-models*` | `model/catalog/admin-logical-model.controller.ts` |
| 用户分组 `/admin/user-groups*` | `model/user-groups/user-group.controller.ts` |
| 插件 `/admin/plugins*` | `model/plugins/plugin.controller.ts` |
| 调用记录 `/admin/api-logs*` | `model/billing/billing-admin.controller.ts`（`admin/api-logs`） |
| 生成账单 `/admin/billing-orders*` | `model/billing/billing-admin.controller.ts`（`admin/billing-orders`） |
| 财务分析 `/admin/analytics*` | `model/billing/analytics.controller.ts` |
| 能力管控 `/admin/capabilities*` | `capability.controller.ts` |
| 系统 `/admin/settings*`、`/admin/roles*`、`/admin/storage`、`/admin/scheduler*`、`/admin/backups*`、`/admin/retention*`、`/admin/audit-logs` | 对应 controller |
| 数据工具 `/admin/search`、批量、导出、导入 | `search.controller.ts` + 各列表 controller |

---

## 6. 统一设计规范

后台页面必须锁死下列规范，否则会重演「硬编码色值」式漂移。

| 层 | 规范 |
| --- | --- |
| 外壳 | 单一 `admin-ui/shell/AdminBoardLayout`（上左右：顶栏 + 侧栏 + 内容区）。**禁止**复用 `AppLayout` / `SideRail` / `PromoBar`（C 端语义） |
| 组件底座 | 页面**只从 `admin-ui/primitives` 取件**（`PageHeader` / `FilterBar` / `StatCard` / `Panel` / `EmptyState` / `StatusTag` / 表单控件 / `AdminDataTable`），底层是 shadcn 原子件（`admin-ui/components/ui`）；后台树内**不引 antd**，也不要把通用组件退回自绘 `div/button/input`。`.adm-*` 只剩外壳骨架三个类（`adm-layout` / `adm-content` / `adm-skip-link`），页面内不新增 |
| 侧栏 | 分组折叠菜单，图标 lucide 20px，选中态 `var(--brand)` + `var(--brand-bg)`；数据源 `adminNav.ts` |
| 列表页 | 页头（标题 + 主操作）→ 筛选条 → 表格 → 分页；`rowKey="id"`、`size="small"` |
| 详情 | 一律抽屉，不跳独立路由，便于保留筛选态 |
| 危险操作 | `ConfirmDialog`（shadcn `AlertDialog` 阻塞式确认弹窗），写明影响条数；退款、发票驳回、能力下架等确有业务依据要求的动作必须填原因，普通管理写操作不要求填写审计原因 |
| 空态 / 加载 | 空态给真实说明；列表 loading 与失败态走 `Skeleton` / `Result` |
| 颜色 | 只用 `global.css` 已有 token，禁裸 hex |
| 数字 | 金额内部存分、展示 `¥` 两位小数；积分整数千分位 |
| 时间 | 统一 `YYYY-MM-DD HH:mm` |
| 批量 | 勾选 → 批量条 → 确认 → 结果弹窗（失败项排最前）→ 刷新；翻页或改筛选清空选择 |
| 导出 | 统一 `common/csv.ts`（UTF-8 BOM + RFC4180 + 公式注入防护），CSV 不走 JSON 信封 |
| 响应式 | 后台最小宽度 1280，窄于则横向滚动，**不做移动端适配** |

---

## 7. 范围内明确不做

| 项 | 原因 |
| --- | --- |
| 多租户 / 企业席位 / 代理分销 | 单轨制：`User` 不加 `orgId`，`Product` 不加 `seats`。改为多租户要改全部查询，须在有真实付费数据后单独评估 |
| 邮件 / 短信真实投递的界面 | 通道实现由环境变量决定（`EMAIL_PROVIDER` / `SMS_PROVIDER`），后台只读展示生效实现，无写入端点 |
| 第三方内容安全 API 送审 | 未接入即如实显示「未接入」，不做假审核记录 |
| 支付渠道启停的前端入口 | 后台「支付充值 / 支付渠道」标签可启停适配器并维护版本化配置（密钥留空即沿用）；凭据本身仍不从页面回显 |
| 后台数据分析看板 | `platform.dashboard` 只做概览聚合；漏斗 / 留存 / LTV 无独立页面 |
