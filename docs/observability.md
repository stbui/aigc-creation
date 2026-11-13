# 可观测性规范

目标是让一次故障能沿同一条线索回答三件事：**发生了什么、影响了谁、下一步查哪里**。当前实现由四条线组成：请求日志、调用记录、健康检查与业务告警；没有接入 APM / Prometheus。日志轮转、追踪中间件、健康端点字段与异常外发的实现细节见 [`runtime-infrastructure.md`](runtime-infrastructure.md) §4–6；日志安全边界见 [`security.md`](security.md) §9，状态文案见 [`feedback-states.md`](feedback-states.md)，产品与经营分析口径见 [`analytics-events.md`](analytics-events.md)。

## 1. 四条主线与关联键

| 线 | 事实源 | 关键字段 |
| --- | --- | --- |
| 请求 | `AppFileLogger` 落盘日志 | `requestId` / `userId` / `method` / `path` |
| 调用 | `ApiCallLog` | `taskId` / `billingOrderId` / `channelModelId` / `providerRequestId` |
| 健康 | `/health`、`/health/ready` | 数据库 / 存储 / 各模态线路状态 |
| 业务 | 告警中心、工作台、值班塔 | 阈值来自 `admin/alert-thresholds.ts` |

同一次故障必须能用 `requestId`、`taskId`、`billingOrderId`、`channelModelId` 中的至少一个把四份数据串起来。新增日志或记录时必须带其中一个关联键。

## 2. 日志

实现：`backend/src/common/logger/file-logger.ts`，零新增依赖，同步追加写。

| 项 | 取值 |
| --- | --- |
| 级别 | `error` / `warn` / `log` / `debug` / `verbose`，由 `LOG_LEVEL` 控制 |
| 目录 | `LOG_DIR`，默认 `logs` |
| 单文件上限 | `LOG_MAX_FILE_MB`，默认 20MB |
| 每日分片 | `LOG_MAX_FILES_PER_DAY`，默认 5 |
| 保留 | `LOG_RETENTION_DAYS`，默认 14 天 |
| 错误单独落盘 | `LOG_ERROR_FILE`，默认开启 |
| 控制台 | `LOG_CONSOLE`，默认开启 |

格式为文本行，带级别、上下文与 `[rid=...]`；写入前统一 `maskSecrets`，Bearer / token / secret / password / api_key 等键值替换为 `***`。

规则：

- 在边界记录：入站请求失败、出站调用开始与结果、状态迁移、定时任务结果、退款与支付回调。
- `error` 用于需要人介入的失败，必须带堆栈或可行动的原因；`warn` 用于可自愈或已降级；`log` 用于业务里程碑；`debug` 用于排障细节。
- 不记录请求体原文、完整凭证、验证码、支付密文、用户密码、模型提示词与响应正文。
- 日志行必须能只靠关联键检索；不要依赖自然语言描述定位。
- 新增敏感字段名必须同步扩展脱敏正则并补测试。
- 未处理异常（5xx）可选外发 `ERROR_WEBHOOK_URL`：只发 message 与堆栈前 8 行，3 秒超时，失败静默；默认关闭，完整堆栈不出境。

## 3. 请求追踪

- 入口中间件生成 `requestId`：优先采用客户端 `X-Request-Id`（仅 `[A-Za-z0-9_-]{8,64}`），否则生成 UUID。
- `requestId` 写入响应头 `X-Request-Id` 与异常响应体；跨域时通过 `Access-Control-Expose-Headers` 暴露。
- 通过 `AsyncLocalStorage` 贯穿异步调用链，日志自动带 `[rid=...]`；不要全局变量或层层传参。
- 鉴权通过后回填 `userId`，供日志与限流使用。
- 前端在 5xx 错误文案中展示请求号（`api.ts` 负责拼接），4xx 不展示。
- 新增后台任务或出站调用时，若脱离请求上下文，必须显式传入 `taskId` / `billingOrderId`，不能依赖 `currentRequestId()`。

## 4. 调用记录（ApiCallLog）

每次上游调用写一条记录，字段包括：`taskId`、`billingOrderId`、`channelId` / `channelModelId`、`source`、`capability`、`operation`、`requestKind`、`status` / `statusCode`、`durationMs`、`tokens`、`mediaCount`、`providerRequestId`。

用途：

- 渠道健康：24 小时成功率、P95、样本数；路由分层与冷却读同一批数据。
- 值班塔与任务监控：成功 / 失败 / 耗时分布。
- 调用记录页：按渠道、模型、任务、状态排障。
- 计费与成本核对。

规则：

- 一次尝试一条记录；重试与切线分别记录，不合并。
- `billable` 必须准确：文本工具为 `false`，生成任务为 `true`。
- 不记录提示词与响应正文；需要复现时靠参数快照与模型版本。
- 状态映射与任务 / 账单状态保持一致，不出现「任务失败但调用记录成功」这类矛盾。
- 默认保留 90 天，经后台「数据保留」手动清理。

## 5. 指标

当前**没有** Prometheus / OpenTelemetry / APM 端点；指标全部从数据库聚合：

- `ChannelModelMetricsService`：近 24 小时成功率、P95、样本数。
- `RouteScoreService`：按成功率划分健康层，供选路使用。
- 值班塔：当日任务量、成功率、P95、失败数。
- 告警中心与工作台：积压、失败、退款、对账、备份等业务计数。

规则：

- 同一指标只在一处计算；页面只渲染接口返回值，不在前端重复聚合。
- 新增阈值只写在 `admin/alert-thresholds.ts`，告警与工作台共用，避免「铃铛 3 条、工作台 2 条」。
- 高基数维度（userId / taskId）不做长期聚合指标，只用于单条查询。

## 6. 健康检查

| 端点 | 用途 | 语义 |
| --- | --- | --- |
| `GET /health` | 人看 | 数据库、存储、三种模态线路状态；永远 200，降级时 `status='degraded'` |
| `GET /health/ready` | 编排系统 | 只检查关键依赖（数据库）；失败返回 503 |

- 存储探测带 30 秒缓存，避免探针把读接口变成外部服务压力源。
- 线路不可用属于业务降级，**不**让实例被摘除；`/health/ready` 不包含线路与存储。
- 容器探针调用 `/health/ready`（`backend/docker/healthcheck.js`）。
- 新增「关键依赖」必须同时改 `/health/ready`；非关键依赖只进 `/health`。

## 7. 告警

告警中心（`GET /admin/alerts`）与角色工作台共用同一批阈值，缓存 30 秒。当前覆盖：

| 类别 | 触发 | 级别 |
| --- | --- | --- |
| 工单 | 待回复超 24h | warning / critical |
| 任务 | 近 24h 失败 ≥ 10、运行中积压 > 50 | warning / critical |
| 账单 | 结果不明 ≥ 5 笔或挂账超 24h | warning / critical |
| 退款 | 渠道处理中超过 30min，超 24h 升级 | warning / critical |
| 对账 | 差异 ≥ 5 笔 | warning / critical |
| 备份 | 无记录 / 失败 / 超 48h / 未验证 | info / warning / critical |
| 发票 | 待开具、退款后待处置 | warning |

规则：

- 每条告警必须有可点击的处理入口，不能只给一句描述。
- 告警与工作台不得重复计算；阈值只改 `alert-thresholds.ts`。
- 告警只做站内铃铛与页面，**业务告警没有短信 / 邮件 / Webhook 外发**；未处理异常可另行通过 `ERROR_WEBHOOK_URL` 外发（见 §2）。

## 8. 定时任务

`SchedulerService` 在启动后 5 秒首轮、之后每 10 分钟轮询；任务状态存内存，单个任务失败不连累其它任务，带重入保护。

当前任务：订单超时关闭、积分到期回收、积分账实核对、数据备份、活动到期收尾、会员到期与月度积分、中断任务补发。

规则：

- 每个任务独立 `try/catch`，记录最近执行时间、耗时、成功与否、连续失败次数。
- 状态放内存，不落库；需要长期留痕的任务自己写表（如 `CleanupLog`）。
- 单实例假设；多实例部署会重复执行，当前没有分布式锁。
- 新增任务必须同时补：中文标签、失败告警、幂等保证、手动触发入口。
- 数据保留清理目前**未接入调度**，只能从后台手动触发（见 §12）。

## 9. 前端错误

- `ErrorBoundary` 捕获渲染异常并 `console.error`，页面展示可读兜底；5xx 由请求层拼请求号。
- 没有集中式前端错误上报（无 Sentry / APM）。
- 规则：不把堆栈与内部错误原文展示给用户；用户报障时提供请求号；不在控制台打印凭证或用户输入。

## 10. 排障路径

1. 从用户描述拿 `requestId`、`taskId` 或订单号。
2. 日志按 `rid=` 检索，确认入站请求与异常堆栈。
3. `ApiCallLog` 按 `taskId` 查调用尝试：渠道、模型、状态码、耗时、上游 requestId。
4. 查任务与账单状态：`queued/running/succeeded/failed/cancelled`、`reserved/settled/uncertain`。
5. 查线路健康与冷却，确认是否 `42204` / `42206`。
6. 对照告警中心与工作台，判断是单点故障还是面状故障。
7. 涉及资金：按 `billingOrderId` 核对预留、结算、退款与积分流水。

常见结论：

- `42204` 无可用线路：看绑定、渠道启用、健康分层、冷却。
- `42206` 结果不明：不切线、不退款，查上游调用记录后人工 settle / refund。
- 支付回调异常：查通知入站记录、验签结果、幂等命中与订单状态。
- 退款卡单：查 `Refund.status='processing'` 与渠道查单结果。

## 11. 新增可观测点检查清单

- [ ] 日志是否带 `requestId` / `taskId` / `billingOrderId` 之一？
- [ ] 是否记录了必要的失败原因，同时避免凭证、请求体与提示词？
- [ ] 是否新增了指标？计算是否只在后端一处？
- [ ] 是否新增告警？阈值是否写在 `alert-thresholds.ts`？
- [ ] 是否新增关键依赖？是否只影响 `/health/ready` 的判定？
- [ ] 新增高增长表是否配置保留期与清理入口？
- [ ] 新增定时任务是否幂等、有标签、有失败告警与手动触发入口？

## 12. 已知缺口

- **无 Prometheus / OpenTelemetry / APM**：指标靠数据库聚合，无法做实时面板与跨服务追踪。
- **无结构化日志与访问日志**：文本行便于人读，不便于集中检索；未开启逐请求 access log。
- **日志只在本地文件**：没有集中收集、转发或长期归档。
- **告警只站内可见**：业务告警没有短信、邮件、Webhook 外发，夜间故障依赖人主动看；未处理异常可通过 `ERROR_WEBHOOK_URL` 外发，但默认关闭且只发摘要。
- **无前端错误上报**：`ErrorBoundary` 只写控制台，用户端崩溃无法聚合分析。
- **调度器无分布式锁**：多实例会重复执行；状态存内存，重启即丢。
- **数据保留清理未接入调度**：`TASK_LABELS` 保留了 `cleanup` 标签，但 `tick()` 未调用，只能手动触发；`retention.controller.ts` 注释所称「与调度任务共用同一条路径」目前不成立。
- **无统一后台操作审计日志**：高危动作依赖各域业务表与原因字段，没有一张可全局检索的 admin audit 表。
- **调用记录默认只留 90 天**：跨季度的质量回归与成本分析需要另行导出。
