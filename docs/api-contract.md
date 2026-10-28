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
| 渠道回调 `POST /payments/callback/:channel` | 用 `@Res()` 直写渠道要求的回执格式，不能套 `{ code, data }` |

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
| `42202` / `42203` | 任务中断回收失败 / AIGC 显式角标失败（均退款） | `generate/generate.service.ts` |
| `42204` | 无可用模型线路、或存量 `route=local`（任务失败，退款，不交付任何产出） | `providers/capability-router.provider.ts` 抛 `NoModelChannelError`，`generate.service` 落码 |
| `42205` | 任务带遮罩但所有通道的协议都没有图像编辑端点（`maskSupport !== 'edits'`），**不忽略遮罩整图重绘**（任务失败，退款） | 同上，抛 `MaskUnsupportedError`，`generate.service` 落码 |
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
| POST | `/api/v1/assets/upload` | 上传素材（multipart：`file` + `projectId` 均必填），返回含宽高 |
| GET | `/api/v1/assets` | 素材库列表（`kind`/`capability`/`limit`/`offset`） |
| DELETE | `/api/v1/assets/:id` | 删除素材（生成图连带删除产出它的任务） |
| POST | `/api/v1/generate` | 创建生成任务，返回 `{ taskId, status, creditCost }`，异步执行 |
| GET | `/api/v1/tasks/:id` | 轮询任务，`outputAsset.sourceUrl` 为结果图 |
| GET | `/api/v1/tasks` | 任务列表（含 `outputAsset`，历史页缩略图依赖它） |
| DELETE | `/api/v1/tasks/:id` | 删除作品（连带产物与磁盘文件） |
| GET | `/api/v1/stats/overview` | 数据中心聚合（含按能力缩略图） |
| GET | `/api/v1/credits/{balance,lots,ledger}` | 积分余额 / 批次 / 流水 |
| GET | `/api/v1/membership/plans`、`/me` | 会员套餐 / 我的会员 |
| POST | `/api/v1/membership/{subscribe,cancel}` | 订阅 / 取消自动续费（取消后 `status='cancelled'`，已付周期保留至 `expiresAt`，到期由调度任务失效；续费可重新激活并顺延） |
| GET | `/api/v1/products/:sku` | 商品详情（结算页用） |
| GET | `/api/v1/orders/:id`、POST `/pay`、POST `/cancel` | 订单详情 / 发起沙箱支付 / 用户取消未支付订单（仅 `pending → cancelled`，幂等；已支付只能走退款） |
| POST | `/api/v1/payments/:orderId/intent` | 发起真实渠道支付（返回 `redirect` 跳转或 `qrcode` 扫码） |
| POST | `/api/v1/payments/callback/:channel` | **渠道异步回调（公开，无信封，`@Res()` 直写）**，验签 + 金额核对 + 幂等 |
| GET | `/api/v1/payments/:orderId/status` | 支付状态轮询 |
| POST/GET | `/api/v1/invoices`、`/invoices/:id/file` | 申请开票（一单一票）/ 列表 / 取可打印 HTML |
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
| GET | `/uploads/*` | 静态图片（Express 静态中间件，不受 `/api/v1` 前缀影响） |

### 3.2 后台

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/{me,overview,permissions}` | 后台身份 / 概览 / 权限点 |
| GET/PATCH/POST/DELETE | `/api/v1/admin/users*`、`assets*`、`tasks*` | 用户 / 素材 / 任务管理 |
| GET/PUT/POST | `/api/v1/admin/{credit-prices,products,orders,payments,credits}*` | 交易与积分管理 |
| POST | `/api/v1/admin/orders/:id/refund` | 渠道退款（**先调渠道再改本地账**；渠道失败 `50302` 且订单/积分不变，在途退款 `40908`，`order.refund` 权限 + 必填原因 + 审计） |
| GET/PUT/POST | `/api/v1/admin/{coupons,campaigns,marketing-rules}*` | 营销管理 |
| GET/POST | `/api/v1/admin/{reconciliation,invoices}*` | 对账导入 / 批次与明细 / 差异处置 / 导出；发票审核与开具 |
| GET | `/api/v1/admin/payment-channels` | 支付渠道状态（只读：生效通道 / 凭据缺失项 / 回调地址 / 风险告警，`payment.read`） |
| GET/POST/PATCH/DELETE | `/api/v1/admin/model-channels*` | 模型线路 CRUD / 排序 / 测试；写需 `channel.route`，测试需 `channel.test` |
| GET/PUT | `/api/v1/admin/capabilities*` | 能力上下线；下架必须填原因，写需 `capability.write`（高危，走审计） |
| GET/PUT | `/api/v1/admin/aigc-label` | 读 / 改角标样式（`setting.read` / `setting.write`，PUT 需原因 + 审计 `aigc.label_update`） |
| GET | `/api/v1/admin/tickets`、`/tickets/stats`、`/tickets/export` | 工单列表 / 状态计数 / CSV 导出 |
| GET/POST/PATCH | `/api/v1/admin/tickets/:id`、`/tickets/:id/replies` | 工单详情与回复 / 改状态或指派（`ticket.handle`） |
| GET | `/api/v1/admin/search?q=` | 全局搜索五组各前 5 条（`data.search`，`q` < 2 返回空） |
| POST | `/api/v1/admin/{users,assets,tasks,orders}/batch` | 批量动作，逐条结果（≤ 100 条，`data.batch`） |
| GET | `/api/v1/admin/{users,assets,tickets,orders,payments,credits}/export` | CSV 导出（BOM，`data.export`） |
| POST | `/api/v1/admin/credits/import` | 积分 CSV 导入（multipart，按邮箱匹配，`data.import`） |
| GET/PUT/POST | `/api/v1/admin/legal*` | 法务版本列表 / 新建草稿 / 发布（`legal.write`，发布需填原因） |
| GET/POST | `/api/v1/admin/notifications/{broadcast,templates}` | 全站广播 / 消息模板（`message.write`） |
| GET | `/api/v1/admin/notifications/channels` | 邮件 / 短信**实际生效实现**（`provider` / `delivers` / `configured`，不含凭据；`message.write`） |
| GET/POST | `/api/v1/admin/{model-config,model-calls,storage,scheduler,backups,audit-logs,roles,settings}*` | 系统与模型管理 |

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
