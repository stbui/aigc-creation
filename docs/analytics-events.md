# 数据分析事件规范

本文件定义**产品与经营分析**的事件、属性、指标口径与埋点边界。它不负责运行时监控（日志、trace、告警见 [`observability.md`](observability.md)），也不重复财务口径的实现细节（见 `FinanceAnalyticsService` 与 [`commerce-design.md`](commerce-design.md)）。

## 1. 现状与边界

- **没有独立事件存储，也没有客户端埋点 SDK**：当前所有统计都从业务表实时聚合。
- C 端数据中心（`GET /stats/overview`）从 `GenerationTask` / `Asset` / `Project` 聚合。
- 后台财务分析（`GET /admin/analytics/finance`）从 `BillingOrder` 聚合，口径以账单为准。
- 后台概览、渠道健康、值班塔从任务、账单、调用记录聚合。
- 邀请归因来自 `InviteRelation` 与 `User.inviteCode`；没有 UTM、落地页来源或广告点击数据。

因此本文的「事件」定义为**业务表中已经发生的事实**，不是另建一套埋点。新增客户端事件前必须先按 §8 评审。

## 2. 事件命名

- 格式：`<对象>.<过去式动作>`，全小写 + 下划线，例如 `task.succeeded`、`order.paid`。
- 对象取业务名词，不使用页面名或接口名。
- 属性名同样 snake_case；枚举值使用稳定代码，不使用中文展示文案。
- 事件一旦对外使用不得改名；需要新语义时新增事件，不复用旧名。

## 3. 事件目录

| 事件 | 事实源 | 关键属性 |
| --- | --- | --- |
| `user.registered` | `User.createdAt` | `user_id`、`invite_code`（可选） |
| `user.login` | `User.lastLoginAt` | `user_id`、`login_method`（若可判定） |
| `user.deleted` | `User.status='deleted'` | `user_id`、`deleted_at` |
| `task.created` | `GenerationTask` | `task_id`、`capability`、`modality`、`model`、`batch_id` |
| `task.succeeded` | `GenerationTask.status` | `task_id`、`duration_ms`、`model`、`channel_id` |
| `task.failed` | `GenerationTask.status` | `task_id`、`error_code`、`model`、`channel_id` |
| `task.cancelled` | `GenerationTask.status` | `task_id`、`cancel_reason` |
| `billing.reserved` | `BillingOrder` | `billing_order_id`、`amount_microcredits`、`capability`、`scene` |
| `billing.settled` | `BillingOrder.status` | `billing_order_id`、`actual_amount_microcredits` |
| `billing.refunded` | `BillingOrder.status` | `billing_order_id`、`refunded_amount_microcredits`、`refund_reason` |
| `billing.uncertain` | `BillingOrder.status` | `billing_order_id`、`task_id` |
| `order.created` | `Order` | `order_id`、`amount_cents`、`items` |
| `order.paid` | `Order.status` | `order_id`、`paid_cents`、`provider` |
| `order.cancelled` | `Order.status` | `order_id`、`reason` |
| `refund.requested` | `Refund` | `refund_id`、`order_id`、`amount_cents` |
| `refund.completed` | `Refund.status` | `refund_id`、`amount_cents`、`channel` |
| `credit.granted` | `CreditLot` / `CreditLedgerEntry` | `user_id`、`amount_microcredits`、`source` |
| `credit.consumed` | `CreditLedgerEntry` | `user_id`、`amount_microcredits`、`billing_order_id` |
| `credit.expired` | `CreditLot` | `user_id`、`amount_microcredits` |
| `membership.started` | `Membership` | `user_id`、`plan_id`、`start_at` |
| `membership.expired` | `Membership.status` | `user_id`、`plan_id`、`expires_at` |
| `invite.bound` | `InviteRelation` | `inviter_id`、`invitee_id`、`invite_code` |
| `invite.rewarded` | `InviteRelation.rewardStatus` | `inviter_id`、`reward_status` |
| `ticket.created` | `Ticket` | `ticket_id`、`category` |
| `ticket.replied` | `TicketReply` | `ticket_id`、`actor_role` |
| `ticket.closed` | `Ticket.status` | `ticket_id`、`duration_ms` |
| `asset.created` | `Asset` | `asset_id`、`kind`、`modality` |
| `asset.deleted` | `Asset.status` / 删除记录 | `asset_id`、`kind` |

未列出的页面点击、滚动、曝光等行为**当前没有数据**，不得在报表里虚构。

## 4. 事件属性

通用属性：

| 属性 | 说明 |
| --- | --- |
| `event_id` | 事实源主键；派生事件不另造 id |
| `occurred_at` | 业务发生时间，UTC 存储 |
| `actor_id` | 行为主体（通常是 `user_id`） |
| `subject_id` | 被操作对象 id（task / order / refund / ticket） |
| `request_id` | 有请求上下文时关联日志 |
| `capability` / `modality` | 生成类事件必带 |
| `model` / `channel_id` | 生成与计费事件必带 |
| `amount_cents` / `amount_microcredits` | 金额与积分必须带单位后缀 |
| `status` / `error_code` | 状态类事件带稳定代码 |

禁止进入分析数据：

- 邮箱、手机号、IP、User-Agent、身份证件等直接标识。
- 提示词、生成结果 URL、上传原图、商品描述等用户内容。
- 访问令牌、支付凭证、回调原文。

需要区分用户时用内部 `user_id`；对外分析使用不可逆的伪匿名 id。

## 5. 指标口径

每个指标只允许一个定义，页面与报表必须引用同一口径：

| 指标 | 公式 | 说明 |
| --- | --- | --- |
| 生成成功率 | `succeeded / (succeeded + failed)` | 取消不计入分母；`uncertain` 单列，不并入成功或失败 |
| 激活率 | 注册后 24h 内至少一次 `task.succeeded` 的用户 / 同期注册用户 | 分母按注册时间归期 |
| 7 日留存 | 注册第 7 天有任意 `task.created` 的用户 / 第 0 天注册用户 | 自然日，按业务时区 |
| 付费转化率 | 同期有 `order.paid` 的用户 / 同期注册用户 | 需写明归因窗口 |
| 退款率 | 退款完成订单数 / 已支付订单数 | 线路切换产生的旧账单退款不计入 |
| 净收入 | `settled actualAmount - refundedAmount` | 口径与 `FinanceAnalyticsService` 一致；`reserved/running/uncertain` 不计入 |
| 结算成功率 | `settled / (settled + refunded)` | 挂账不计入分母 |
| ARPPU | 净收入 / 付费用户数 | 金额单位统一为分或微积分后再换算 |

规则：

- 时间口径统一用**业务时区**（建议 `Asia/Shanghai`），存储用 UTC；当前 `StatsService` 的 `dayKey` 使用服务器本地时区，新增统计不得沿用该做法。
- 金额用整数分 / 微积分聚合，展示时再换算；禁止浮点累加。
- 同一指标必须复用同一过滤条件（例如素材统计只算 `status='visible'`、项目只算 `deletedAt=null`），不得页面一套、报表一套。
- 失败原因按 `errorCode` 归组，不用错误文案归组。

## 6. 归因

- 当前唯一可用的归因是**邀请关系**：`User.inviteCode` → `InviteRelation.inviterId / inviteeId`。
- 没有 UTM、referrer、广告点击、落地页来源；不得声称能算渠道 ROI。
- 支付渠道（alipay / wechat / sandbox）只是支付方式，不是获客渠道，不能当来源归因。
- 活动参与来自 `Campaign` 与订单关联；活动效果只能按参与与转化算，不能按曝光算。

## 7. 查询与保留

- 分析查询只读，不写业务表；不在统计接口里触发状态变更。
- 单次在线聚合区间上限参考财务分析：默认 30 天、最大 366 天；更大范围走导出或离线。
- 高增长表（`ApiCallLog`）默认保留 90 天；业务事实表按各自保留策略。
- 用户注销后分析数据只保留匿名化维度，不保留可识别身份。

## 8. 新增客户端埋点的门槛

当前没有客户端事件采集。确需新增时，必须先完成：

1. 明确事件名、触发时机、属性白名单、去重键。
2. 说明无法从服务端事实推导的原因。
3. 通过采集同意与隐私评审；提供关闭方式。
4. 上报失败不得阻塞业务；批量、异步、可丢弃。
5. 不采集 §4 禁止项；采样率与保留期写清楚。
6. 落地后补事件契约测试与指标对账。

未满足上述条件的「先埋点再说」一律不做。

## 9. 对账与验证

- 每个指标必须能与事实表对账：同一时间窗内报表总数 = 源表按同一过滤条件的计数。
- 新增指标必须给出至少一个手算样例（小额、边界、退款、取消、结果不明）。
- 跨表指标（如净收入）必须注明来源表与状态过滤，避免把挂账算成收入。
- 定时任务与报表同时改动时，先保证口径不变，再改实现。

## 10. 已知缺口

- **无事件存储与客户端埋点**：页面浏览、点击、曝光、漏斗步骤都没有数据。
- **无 UTM / referrer / 广告归因**：只能算邀请关系，不能算渠道 ROI。
- **无激活 / 留存看板**：指标定义在本文件，但当前没有对应接口与页面。
- **时区口径未统一**：`StatsService` 使用服务器本地日期，跨时区部署会出现日界偏移。
- **无采集同意与关闭机制**：未来接入客户端埋点前必须补。
- **无指标对账测试**：统计接口缺少与源表逐项核对的自动化用例。
- **财务分析为内存聚合**：十万级以内可用，更大数据量需要数仓或预聚合。
