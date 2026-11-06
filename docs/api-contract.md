# API 契约

> 接口清单按「谁在用」分组列出，实现以 controller 为准。本文件只记录跨模块约定：响应信封、错误码、鉴权时长与两类例外。

## 1. 统一响应信封

- 所有成功响应由 `ResponseInterceptor` 包成 `{ code: 0, data, message: '' }`；前端 `lib/api.ts` 的 `request()` 负责剥离。
- 异常走 `AllExceptionsFilter` + `AppError(code, message, httpStatus)`，信封同样携带 `requestId`（见 `docs/runtime-infrastructure.md`）。
- 全局 `ValidationPipe({ whitelist: true, transform: true })`，DTO 校验错误由 `main.ts` 的 `flattenValidationErrors` 压平成**单条中文消息**。

两类响应**不走信封**（前端对应走独立下载 / 直写通道）：

| 场景 | 原因 |
| --- | --- |
| CSV 导出 `GET /admin/*/export` | 返回文件流；前端 `downloadCsv()` 独立于 `request()` |
| 渠道回调 `GET/POST /payments/callback/:providerId/:configId` | 用 `@Res()` 直写渠道要求的回执格式，不能套 `{ code, data }`；易支付与 ZPay 走 GET |

## 2. 跨模块错误码

其余错误码就近定义在各自 service；下表是**跨模块引用**的那部分。

| 码 | 含义 | 定义处 |
| --- | --- | --- |
| `40001` | 参数 / 校验错误（DTO 错误由此统一压平） | `main.ts` |
| `40002` | 积分不足；生成链路转成 402 语义 | `credits/credit.service.ts` |
| `40005` | 能力已下线，原因随响应下发 | `generate/generate.service.ts` |
| `40301` | 无权访问 / 无权执行（越权、批量动作权限） | 多处（支付、发票、批量处理器等） |
| `40302` | 第三方登录命中的本地账号非 `active` | `auth/oauth/` |
| `40905` / `40906` / `40907` | 退款：超时间窗 / 超可退比例 / 积分已消耗且扣不回 | `orders/order.service.ts` |
| `40908` | 该订单有退款仍在渠道处理中（`Refund.status='processing'`），不接受新的退款 | 同上 |
| `40900` | 排序列表已变化：`expectedIds` 与库中不一致，整单拒绝，需重新加载后再保存 | `model/channels/channel.service.ts` |
| `42201` | 有线路但全部失败（任务失败，退款） | `model/tasks/task-lifecycle.service.ts` |
| `42202` / `42203` | 任务中断回收失败 / AIGC 显式角标失败（均退款） | 同上 |
| `42204` | 无可用线路：所有线路都明确未接单（含 DNS / 代理 / TCP 建连前网络失败），或存量 `route=local`（任务失败，退款，不交付任何产出） | `model/tasks/task-worker.service.ts` |
| `42205` | 带遮罩但所有线路都不支持遮罩重绘，**不忽略遮罩整图重绘**（任务失败，退款） | `model/tasks/task-admission.service.ts` / `task-worker.service.ts` |
| `42206` | 请求可能已到达上游，但建连后超时 / 中断 / 5xx / 解析失败导致结果不明，转人工核对：**不切线、不退款**，冻结保留。建连前 DNS / 代理 / TCP 失败不得使用此码 | `model/tasks/task-lifecycle.service.ts` |
| `42901` | 触发限流，附 `Retry-After` | `common/rate-limit.guard.ts` |
| `50301` / `50302` | 支付通道未配置（缺凭据，绝不回落沙箱）/ **渠道退款未完成**（HTTP 502；订单状态与积分不变，可用同一退款单重试） | `payments/payment.factory.ts` / `orders/order.service.ts` |

## 3. 主要接口

### 3.1 公开与 C 端主链路

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 能力清单（公开免登录），前端全部渲染依据 |
| POST | `/api/v1/auth/register` | 注册，**直接返回 `accessToken`**（注册即登录） |
| POST | `/api/v1/auth/login` | 登录，返回 `{ accessToken, user }` |
| POST/GET | `/api/v1/auth/qr/create`、`/auth/qr/status` | 扫码登录：桌面建码 / 轮询换 token（公开，`status` 首次兑换即作废） |
| GET | `/api/v1/auth/oauth/providers` | 已启用的第三方登录 provider 列表（公开；留空则登录页不渲染按钮） |
| GET | `/api/v1/auth/oauth/:provider/authorize`、`/auth/oauth/:provider/callback` | 第三方登录跳转与回调（公开；`state` 10 分钟过期，回调只下发 60 秒票据） |
| POST | `/api/v1/auth/oauth/complete` | 用短时票据换正式 `accessToken`（票据是 60 秒 JWT，服务端不存消费记录） |
| POST | `/api/v1/auth/qr/{scan,confirm}` | 手机端（需登录）标记已扫 / 确认授权；**扫码≠授权**，确认才绑定账号 |
| GET/POST | `/api/v1/projects` | 项目列表 / 创建 |
| POST | `/api/v1/assets/upload` | 上传素材（multipart：`file` + `projectId` 均必填；可选来源字段 `sourceSite`/`sourceTitle`/`sourcePageUrl`，仅扩展采集时带），返回含宽高 |
| GET | `/api/v1/assets` | 素材库列表（`kind`/`capability`/`limit`/`offset`） |
| PATCH | `/api/v1/assets/move` | 批量移动素材到另一项目（`{ ids: string[], projectId }`，≤100），返回 `{ moved, missing, projectId }`；只改素材分组，不动任务归属 |
| DELETE | `/api/v1/assets/:id` | 删除素材（生成图连带删除产出它的任务） |
| POST | `/api/v1/generate` | 创建生成任务，返回 `{ taskId, status, creditCost, batchId?, batchSize? }`，异步执行。`logicalModelId` 必填（前台模型 id，来自 `/models`）；`status` 初值 `queued`，词表 `queued / running / succeeded / failed / cancelled`。能力声明了 `outputPlan` 时（当前只有商品详情图）一次提交拆成 N 个任务：每张各建一条账单、各扣一份价（**按张计费**），返回的 `creditCost` 是本次合计；`taskId` 是父任务，其余任务 `parentTaskId` 指向它，`batchId` 标识整批；删除父任务会连带删除整批 |
| GET | `/api/v1/tasks/:id` | 轮询任务，`outputAsset.sourceUrl` 为结果图；`errorCode` 取 `42201`–`42206` |
| GET | `/api/v1/tasks` | 任务列表（含 `outputAsset`，历史页缩略图依赖它） |
| GET | `/api/v1/tasks/page` | 任务列表分页（`projectId` / `capability` / `limit` / `offset`），返回 `{ items, total, limit, offset }`。**必须注册在 `/tasks/:id` 之前**，否则 `page` 会被当成 id |
| DELETE | `/api/v1/tasks/:id` | 删除作品（连带产物与磁盘文件） |
| GET | `/api/v1/stats/overview` | 数据中心聚合（含按能力缩略图） |
| GET | `/api/v1/models` | 前台模型目录（匿名可读；带 token 时按会员分组过滤线路并折算价格，不暴露渠道字段） |
| POST | `/api/v1/models/available` | 按请求意图（`capability` / `inputs` / `options`）筛选可用模型 |
| POST | `/api/v1/models/:id/quote` | 前台模型报价，返回 `{ quote: { amountMicrocredits, billingMode, estimated, ... } }`；`estimated=true` 表示按估算用量报价 |
| GET | `/api/v1/model-catalog` | 渠道模型目录（供应视角）：`models` 恒为空数组，模型在 `channels[].models` 内；渠道名恒为空串，不带凭证 |
| POST | `/api/v1/model-catalog/available` | 按请求意图筛选可用的渠道模型 |
| POST | `/api/v1/model-catalog/quote` | 渠道模型报价（`channelId` + `modelKey` + 意图），供渠道工作台预览价格 |
| GET | `/api/v1/channels/system` | 系统渠道连接信息（匿名可读）。**非管理员视角只给「有哪些渠道、怎么连」**：`name` / `userId` / `catalogProviderId` 固定空串（渠道名会泄漏供应商与中转站身份），`baseUrl` 改写为中转入口 `/api/v1/ai/system/{channelId}`，`apiKey` 恒为 `'system'`（服务端注入真实凭证），`concurrencyLimit` / `hasApiKey` / `hasSecretKey` 恒为 0 / false。**管理员**（实时查库判角色）额外拿到渠道真实名称与上游地址，但凭证任何情况都不下发 |
| GET | `/api/v1/credits/{balance,lots,ledger}` | 积分余额 / 批次 / 流水 |
| GET | `/api/v1/membership/plans`、`/me` | 会员套餐 / 我的会员 |
| POST | `/api/v1/membership/{subscribe,cancel}` | 订阅 / 取消自动续费（取消后 `status='cancelled'`，已付周期保留至 `expiresAt`，到期由调度任务失效；续费可重新激活并顺延） |
| GET | `/api/v1/products/:sku` | 商品详情（结算页用） |
| GET | `/api/v1/orders/:id`、POST `/pay`、POST `/cancel` | 订单详情 / 发起沙箱支付 / 用户取消未支付订单（仅 `pending → cancelled`，幂等；已支付只能走退款） |
| POST | `/api/v1/payments/:orderId/intent` | 发起真实渠道支付（返回 `redirect` 跳转或 `qrcode` 扫码） |
| GET/POST | `/api/v1/payments/callback/:providerId/:configId` | **渠道异步回调（公开，无信封，`@Res()` 直写）**，验签 + 金额核对 + 幂等；易支付与 ZPay 使用 GET，PayPal/Stripe 使用 POST |
| GET | `/api/v1/payments/:orderId/status` | 支付状态轮询 |
| POST/GET | `/api/v1/invoices`、`/invoices/:id/file` | 申请开票 / 列表 / 取可打印 HTML。同一订单保留完整申请历史；同一时刻最多一张有效票（服务层校验 + 数据库唯一占用键兜底），只有 `rejected` 可重新申请，`red_flushed` 不可重提 |
| GET | `/api/v1/marketing/{popup,invites,checkin}` | 营销弹窗 / 邀请 / 签到 |
| GET | `/api/v1/marketing/campaigns` | 进行中的限时价 / 限时免活动（公开；只回真正更便宜且商品在售的） |
| POST | `/api/v1/prompt-tools/{polish,image-to-prompt}` | 提示词润色 / 图片转提示词 |
| POST/GET/DELETE | `/api/v1/mobile-upload/sessions*` | 手机上传会话 |
| GET/PATCH/DELETE | `/api/v1/me` | 账户资料 / 更正昵称 / 自助注销（密码 + 确认词） |
| POST | `/api/v1/me/{password,export}` | 改密（成功后旧 token 全失效）/ 个人信息导出 JSON |
| GET | `/api/v1/me/deletion-preview` | 注销影响面（项目 / 作品 / 素材 / 订单 / 消息） |
| GET | `/api/v1/legal`、`/legal/:slug` | 法务文档概览 / 最新已发布正文（公开免登录） |
| GET/POST | `/api/v1/notifications`、`/notifications/:id/read`、`/read-all` | 我的站内消息 / 标记已读 |
| GET | `/api/v1/aigc-label` | 生效的可见角标参数（公开；前端视频播放器角标用） |
| GET/POST | `/api/v1/tickets`、`/tickets/:id`、`/tickets/:id/replies`、`/tickets/:id/close` | 我的工单 / 详情 / 回复 / 关闭（越权 404） |
| GET | `/api/v1/health`、`/health/ready` | 健康分项（db/storage/channels）/ 就绪探针（未就绪 503），均免登录 |
| POST | `/api/v1/test/rate-limit/reset` | **仅测试档**（其他环境 404）+ `x-test-token`，清空限流计数 |
| GET | `/uploads/*` | 静态图片（Express 静态中间件，不受 `/api/v1` 前缀影响）；带 `?w=&h=` 时返回方形 JPEG 缩略图（本地存储按需生成并缓存，失败回落原文件） |

### 3.2 后台

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/{me,overview,permissions}` | 后台身份 / 概览 / 权限点 |
| GET | `/api/v1/admin/alerts` | 告警中心：按当前角色权限聚合待处理工单 / 失败任务 / 对账差异 / 退款卡单 / 备份 / 发票（只要求后台身份） |
| GET/PATCH/POST/DELETE | `/api/v1/admin/users*`、`assets*`、`tasks*` | 用户 / 素材 / 任务管理 |
| GET/PUT/POST | `/api/v1/admin/{credit-prices,products,orders,payments,credits}*` | 交易与积分管理 |
| GET/POST/PATCH | `/api/v1/admin/membership-plans*` | 会员套餐列表 / 新建 / 改价改权益 / 上下架（`product.read` / `product.write`，写操作自动写审计；下架不影响存量会员） |
| POST | `/api/v1/admin/orders/:id/refund` | 渠道退款（**先调渠道再改本地账**；渠道失败 `50302` 且订单/积分不变，在途退款 `40908`，`order.refund` 权限 + 必填原因 + 审计） |
| POST | `/api/v1/admin/orders/:id/refunds/:refundId/confirm` | 异步退款最终人工核销：`{ outcome: 'succeeded' \| 'failed', providerRefundId?, reason }`。`succeeded` 原子回收积分并推进订单；`failed` 只关闭退款单，订单与积分不变；两者均要求原因、写审计，`order.refund` |
| GET/PUT/POST | `/api/v1/admin/{coupons,campaigns,marketing-rules}*` | 营销管理 |
| GET/POST | `/api/v1/admin/invoices*` | 发票列表 / 开具 / 驳回；`POST /:id/red-flush` 登记已开具发票冲红，请求体 `{ reason }`（必填）。读 / 写统一使用 `invoice.write`，冲红保留历史并写审计 |
| GET | `/api/v1/admin/payments/providers` | 支付适配器视图列表（沙箱 / 支付宝 / 微信）：启用状态、是否配置齐、缺哪几项、checkoutMode、关单分钟、配置版本、字段元数据、风险告警。**只回配置状态不回密钥明文**（`secretConfigured` 只给布尔），`payment.read` |
| PUT | `/api/v1/admin/payments/providers/:id/config` | 保存支付适配器配置（版本化 + 加密 + 追加写）。请求体 `{ enabled, closeAfterMinutes, values }`，保存写审计但不要求填写原因；密钥字段留空表示沿用旧值，身份类字段锁定不可改，`payment.write` |
| GET/PUT | `/api/v1/admin/payments/settings` | 后台默认币种设置，读 `payment.read` / 写 `payment.write`，写操作自动写审计 |
| GET/POST/PUT | `/api/v1/admin/payments/products*` | 充值商品列表 / 新建 / 改（价格按分存，展示按元解析；库存 / 周期 / 限时策略随类型切换），`product.read` / `product.write` |
| GET | `/api/v1/admin/payments/orders` | 支付订单列表（服务端分页，默认 30）：筛选 `status` / `providerId` / `keyword` / `timeField` / `from` / `to` / `sort`，`payment.read` |
| GET | `/api/v1/admin/payments/orders/:id` | 订单详情（含最近 50 次支付尝试），`payment.read` |
| POST | `/api/v1/admin/payments/orders/:id/query` | 向渠道查单并同步状态（关单前必先查单），`payment.operate`，写操作自动写审计 |
| POST | `/api/v1/admin/payments/orders/:id/close` | 关闭未支付订单（**不等于退款**），已入账返回 `409`；`payment.operate`，写操作自动写审计 |
| GET | `/api/v1/admin/payments/orders/export.csv` | 支付订单导出（`payment.read` + `data.export` + 审计） |
| GET/POST | `/api/v1/admin/payments/reconciliations` | 对账运行列表 / 手动执行。列表筛 `providerId` / `status`（`running` / `completed` / `failed`）/ `from` / `to`；执行请求体 `{ providerId, billDate, retryFailed? }`，`finance.reconcile`，写操作自动写审计 |
| GET | `/api/v1/admin/payments/reconciliations/:id/items` | 对账差异明细（按 `result` 筛，默认 50 条/页），`payment.read` |
| POST | `/api/v1/admin/payments/reconciliations/import` | 渠道账单 CSV 兜底导入（multipart `file` + `providerId` / `billDate`），`finance.reconcile`，写操作自动写审计 |
| GET | `/api/v1/admin/payments/reconciliations/export.csv`、`/:id/items/export.csv` | 对账汇总 / 明细导出（`payment.read` + `data.export` + 审计） |
| GET/POST/PATCH/DELETE | `/api/v1/admin/channels*`、`/admin/channel-models` | 渠道 / 渠道模型 / 价格档 / 复制 / 导入导出 / 连通性测试；写需 `channel.write` / `channel.model_write`，测试写 `ApiCallLog(billable=false)`。渠道与渠道模型删除（含单删、批量删除）保留业务确认，但不要求原因；审计仍记录操作人、动作与结果 |
| GET | `/api/v1/admin/channel-models?channelId=&includeDisabled=` | 跨渠道模型视图（一行 = 一条渠道模型，条目带 `channelName` / `channelEnabled`）。`includeDisabled=1` 含已停用线路 —— 后台「全部模型」视图要用；不传时只给启用线路（前台模型的线路选择器用，停用线路进了下拉会让人以为选了就能用），`channel.model_read` |
| GET/PUT | `/api/v1/admin/channels/order`、`/api/v1/admin/channels/:id/models/order` | 渠道排序 / 渠道内模型排序。`GET` 返回当前顺序的 id 数组；`PUT` 请求体 `{ ids, expectedIds }` —— `expectedIds` 是**读取时看到的顺序**，与库中不一致说明期间有人改过，整单拒绝 **409**（`code 40900`，「排序列表已变化，请重新加载后再保存」），不做部分落库。权限 `channel.write` / `channel.model_write`，写审计 `channel.order` / `channel_model.order` |
| GET | `/api/v1/admin/channels/protocols` | 可选协议目录（按 `capability` 过滤）；渠道模型表单的协议来源，`channel.model_read` |
| GET | `/api/v1/admin/channels/health` | 线路健康（一行 = 一条渠道模型：能力 / 启停 / 协议是否已注册 / 进程内冷却截止），值班塔与渠道工作台共用，`channel.read` |
| GET | `/api/v1/admin/channel-models/health?channelId=` | 线路**历史表现**：一行 = 一条渠道模型，给 24h / 7d 两个窗口的成功率与 P95 耗时 + 最近 10 条终态样本，`channel.model_read`。与 `/admin/channels/health` 的分工：后者是「现在」（启停 / 协议 / 冷却），本端点是「过去」（成功率 / 耗时），值班时两个都要看。成功率 = `success` ÷ 终态次数（`pending` / `canceled` 不计入分母），**无终态样本时为 `null`**（不是 0 ——「没数据」与「全失败」要分得开）；P95 用最近邻法（不插值），样本被采样上限截断时 `sampled=true` |
| POST | `/api/v1/admin/channels/:id/models/batch-reprice` | 批量调价：只改**已启用规格的售价**，不动成本价 / 启停 / 上游键。请求体 `{ models: [{ modelId, priceVersion, priceTiers: [{ id, priceVersion, prices }] }] }`，单次 ≤ 100 个模型。`priceVersion` 是乐观并发令牌：任一模型或规格版本过期 → **整批拒绝**（40001，不部分落库）；`prices` 必须恰好是当前计费方式的全部售价字段（按次/按时长 → `unitPriceMicrocredits`；Token 非视频 → 输入/输出/缓存三项；Token 视频 → 仅输出），少一项或多夹一项都拒绝；规格缺成本价或售价未配置时拒绝。成功返回 `{ updated }`，自动写审计 `channel_model.batch_reprice`，`channel.model_write` |
| GET/POST/PATCH/DELETE | `/api/v1/admin/logical-models*` | 前台模型列表 / 保存（新 revision + 线路重建）/ 归档；`logical_model.read` / `logical_model.write` |
| POST | `/api/v1/admin/logical-models/:id/simulate` | 路由模拟（只读）：返回产品能力匹配结果与逐条线路的判定原因；需 `logical_model.read`。入参 `capability` 是**模态**（`image` / `video` / `text`），不是产品能力 id（`expand` / `main_image`）——两层命名空间不能混；省略时**按模型自己的能力合同取模态**，传了产品能力 id 也按省略处理（模型是权威源，客户端不该改） |
| GET/POST/PATCH/DELETE | `/api/v1/admin/user-groups*` | 用户分组（倍率 / 可见渠道 / 按模型覆盖）；`user_group.read` / `user_group.write`，`code` 创建后不可改 |
| GET/PATCH/POST/DELETE | `/api/v1/admin/plugins*`、`/plugins/:id/verify`、`/plugins/install` | 插件清单 / 启停（立即重注册协议）/ 契约校验 / 上传安装（multipart `file`，`origin='installed'`）/ 卸载（内置包 40001，仍被渠道模型引用 40909）；`plugin.read` / `plugin.write`，装卸写审计。清单每项带 `availability: { available, reason }`：本环境不可用时 `reason` 是**人话**说明（停用 / 声明了本仓未内置的 `host:<engine>` 引擎 / 只贡献支付短信等非模型能力而本仓独立实现），不允许「插件列在那里但就是不工作」这种静默缺失 |
| GET/POST | `/api/v1/admin/provider-catalog`、`/refresh`、`/:id/{verify,install}` | 服务商目录（插件包上游清单）：未配置 `MODEL_PROVIDER_CATALOG_URL` 时返回空态与原因；安装走与上传安装同一套校验；`plugin.read` / `plugin.write` |
| GET | `/api/v1/admin/analytics/finance?from&to` | 财务汇总：实收 = 已结算 `actualAmountMicrocredits`，已退 = `refundedAmountMicrocredits`，净收入 = 实收 − 已退；预留 / 运行 / 待核对单列挂账**不计入实收**；区间默认 30 天、上限 366 天，`model.analytics_read` |
| GET/POST | `/api/v1/admin/billing-orders*`、`/billing-orders/:id/resolve`、`/billing-orders/batch-resolve` | 生成账单列表 / 详情 / 人工核对（`settle` \| `refund`）。单条与批量请求均必须带 `reason`（≤ 500 字），批量同一次操作共享 `reviewBatchId`；写操作自动写审计，`billing_order.read` / `billing_order.resolve`；列表支持 `?status=review`「待核对」队列口径；批量核对逐条独立处置并回显失败原因 |
| GET | `/api/v1/admin/api-logs` | 上游调用记录（`ApiCallLog`）：含 `billable=false` 的连通性测试；筛选状态 / 类型 / 渠道 / 模型 / 时间，附汇总统计，`model.call_read` |
| GET | `/api/v1/admin/api-logs/export` | 调用记录 CSV（与列表同筛选口径，上限 5000 行；**不含请求体 / 响应体**），`model.call_read + data.export` + 审计 |
| GET/PUT | `/api/v1/admin/capabilities*` | 能力上下线；下架请求必须带原因（后台页面统一生成并下发 C 端），写需 `capability.write`（高危，走审计） |
| GET/PUT | `/api/v1/admin/aigc-label` | 读 / 改角标样式（`setting.read` / `setting.write`，PUT 自动写审计 `aigc.label_update`） |
| GET | `/api/v1/admin/tickets`、`/tickets/stats`、`/tickets/export` | 工单列表 / 状态计数 / CSV 导出 |
| GET/POST/PATCH | `/api/v1/admin/tickets/:id`、`/tickets/:id/replies` | 工单详情与回复 / 改状态或指派（`ticket.handle`） |
| GET | `/api/v1/admin/search?q=` | 全局搜索五组各前 5 条（`data.search`，`q` < 2 返回空） |
| POST | `/api/v1/admin/{users,assets,tasks,orders}/batch` | 批量动作，逐条结果（≤ 100 条，使用各领域动作权限） |
| GET | `/api/v1/admin/{users,assets,tickets,orders,payments,credits,tasks,audit-logs,invoices,coupons,campaigns}/export` | CSV 导出（BOM，领域读权限 + `data.export`；上限 5000 行，筛选口径与列表一致）。调用记录是 `/admin/api-logs/export` |
| POST | `/api/v1/admin/credits/import` | 积分 CSV 导入（multipart，按邮箱匹配，`credit.adjust`） |
| GET/PUT/POST | `/api/v1/admin/legal*` | 法务版本列表 / 新建草稿 / 发布（`legal.write`，写操作自动写审计） |
| GET/POST | `/api/v1/admin/notifications/{broadcast,templates}` | 全站广播 / 消息模板（`message.write`） |
| GET | `/api/v1/admin/notifications/channels` | 邮件 / 短信**实际生效实现**（`provider` / `delivers` / `configured`，不含凭据；`message.write`） |
| GET/POST | `/api/v1/admin/{storage,scheduler,backups,audit-logs,roles,settings}*` | 系统管理 |

#### 任务全链路查询口径

`GET /api/v1/admin/tasks/:id`（`task.read`）在任务基础字段、输入素材、参数、产出和状态时间线之外，返回 `routeAttempts`：按 `routeRun ASC, attemptNumber ASC` 排序的线路派发快照，包含逻辑模型、线路、渠道模型、`status`、`dispatchState`、上游请求号、失败码 / 失败原因和起止时间。该数组是任务排障数据，不包含账单金额或上游请求 / 响应正文。

任务详情抽屉把分散在同一 `taskId` 下的数据组成集中排障页，但保留各自权限边界：

- `GET /admin/tasks/:id`：提交时间、任务状态、参数、线路尝试、产出，`task.read`。
- `GET /admin/api-logs?taskId=`：模型调用摘要及全部调用深链，`model.call_read`；最近 20 条用于抽屉内定位，完整列表在 `/admin/model-calls?taskId=`。
- `GET /admin/billing-orders?taskId=`：积分预留、结算、退款与人工核对结果，`billing_order.read`；详情抽屉最多加载 100 条，完整列表在 `/admin/billing-orders?taskId=`。

资金终态以 `BillingOrder` 为准，不能仅凭 `RouteAttempt.dispatchState` 判断是否需要人工复核：`reviewable=true` 才进入待核对队列；`refunded` 且 `resolvedBy=system:preconnection-reconcile` 表示建连前网络失败已由系统自动退款，应显示“无需人工复核”。`refundReason=route_switch` 是换线内部重预留，不计入真实退款。

当前是**任务级追踪**，统一以 `taskId` 关联。若请求在创建 `GenerationTask` 之前就失败（前端、网关、鉴权等），库中没有 `taskId`，不会出现在该详情页；这类入口级排障需另接 `traceId` 与网关请求日志。

#### 交易与发票处置约束

- **账单人工核对只处理可核对项**：列表和详情返回同一口径的 `reviewable`；任务仍在执行、已有作品或正在补交付的账单不得处置。`reason` 必填，批量操作每次共享同一个 `reviewBatchId`，但每条账单仍独立事务处置。
- **异步退款不能提前销账**：`processing` 退款单在人工确认前不改订单金额、状态和积分。确认失败只把退款单置为 `failed` 并保留渠道证据；确认成功与同步退款复用同一原子记账路径。
- **发票历史不可覆盖**：订单与发票是一对多；驳回后可重新申请，旧记录仍保留。已开具发票可登记 `red_flushed`，必须填写原因、记录操作人和时间，冲红后不能再次申请。

### 3.3 模型中转（代理）

中转接口**不走响应信封**：成功时原样透传上游状态码、内容类型（含 SSE 流）与 body；失败才用本仓信封 `{ code, message }` 写出（`writeProxyError`）。全部需登录（`JwtAuthGuard`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| 任意 | `/api/v1/ai/system/:channelId/*path` | 系统渠道中转：按渠道转发到上游，`*path` 至少一段。**仅 POST 计费**（`BillingOrder.taskId=''`，`reserved → running → settled / refunded / uncertain`）；GET 等只透传 |
| 任意 | `/api/v1/:channelId/*path` | 短路径中转：等价于 `/ai/system/:channelId/*path`，渠道 id 前置；命中保留前缀时 404 |
| 任意 | `/api/v1/ai/custom` | 用户自带上游中转：地址 / 格式 / key 全部由请求头给出，**不计费** |
| POST | `/api/v1/ai/models` | 自定义渠道模型列表。这是**普通业务接口**（DTO 校验 + 信封，body 上限 100KB），不是中转 |

自定义中转的请求头：

| 头 | 用途 |
| --- | --- |
| `x-canvas-upstream-url` | 上游 base URL（必填，严格 SSRF 校验） |
| `x-canvas-upstream-format` | `openai` / `gemini` / `claude` |
| `x-canvas-upstream-key` | 上游密钥，≤ 512 字节且禁 CRLF |
| `x-canvas-headers` | 额外头，base64 的 JSON `[{ name, value }]` |
| `x-canvas-scene` | 账单 / 调用记录的场景标识（缺省 `proxy`） |
| `x-idempotency-key` | 幂等键：同键复用同一张预留账单 |

请求处理顺序固定，**不要重排**：身份 → 分组渠道访问 → 限流 → body 上限 → 提取 `model` / 协议 → 协议授权 → SSRF → 剥离客户端 `key` / `api_key` / `access_token` / `token` → 渠道自定义头 → 并发槽 → （仅 POST）预留计费并置 `running` → 上游请求 → 状态码 / 调用日志 / 流式透传 → 结算 / `uncertain` / 退款。先预留再请求保证「上游已扣费」与「本地已挂账」不会出现空隙；反过来（先请求后计费）在流式响应下无法回滚。

| 状态 / 码 | 含义 |
| --- | --- |
| `503` / `50303` | `MODEL_PROXY_ENABLED=false`，或并发槽等待超时 |
| `404` / `40401` | 系统渠道不存在 / 已停用 |
| `403` / `40301` | 该渠道未授权该模型或协议；自定义中转 SSRF 校验拒绝 |
| `400` / `40001` | 缺 `model` / 协议非法 / 请求体超限（413）/ 上游密钥格式错误 |
| `401` / `40101` | 自定义中转 `x-canvas-upstream-key` 缺失或非法 |
| `429` / `42901` | 并发槽已满（系统渠道按渠道并发，自定义按用户 `MODEL_PROXY_CUSTOM_CONCURRENCY`） |
| `502` / `50201` | 上游不可达 / 响应读取失败 / 内容类型不支持 |

## 4. 鉴权与时长

JWT TTL 默认 7 天（`JWT_TTL` 可覆盖；本地 MVP 无 refresh，生产应恢复短 TTL + refresh）。

三类令牌的寿命各不相同，不要混用：

| 令牌 | 寿命 | 用途 |
| --- | --- | --- |
| 登录 JWT | 7 天（`JWT_TTL`） | 常规接口鉴权 |
| 第三方登录短时票据 | 60 秒 | 回调 → `POST /auth/oauth/complete` 换正式 JWT，不存消费记录 |
| 扫码登录票据 | 120 秒 | 桌面轮询换 JWT，库内只存 SHA-256，兑换一次性 |

## 5. 相关文档

- 错误码背后的业务规则：`docs/commerce-design.md`（退款 / 支付）、`docs/model-architecture.md`（`42204` / `42205`）
- 限流、追踪、签名 URL：`docs/runtime-infrastructure.md`
- 后台接口的权限点与页面归属：`docs/admin-console-design.md`
