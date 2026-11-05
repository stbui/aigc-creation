# 模型层架构（渠道 → 前台模型 → 路由 → 计费）

> 范围：`backend/src/model/**` 与它对外暴露的 `/models`、`/admin/channels`、`/admin/logical-models`、
> `/admin/api-logs`、`/admin/billing-orders`、`/admin/finance`、`/ai/*` 中转。
> 本文只写**当前实际实现**，每条约束都能在代码里核对；设计动机与取舍见 `docs/channel-model-design.md`。
>
> 旧的「模态 × 协议 × 厂商」三层（`src/providers/**`、`GATEWAY_*` 环境变量、`/admin/model-config`、
> `/admin/model-channels`、`ModelCallLog`）已在 P6 整体删除，本文不再描述它们。

## 1. 一句话

前台按 **逻辑模型 id** 选模型；后端用内存目录快照把它解析成**唯一一条可执行线路**
（渠道模型 + 价格档）；协议适配器按插件的请求/响应映射发上游；积分在**创建任务时预留**，
按结果**结算或原路退还**。没有任何一步允许「拿不到真实结果就给个替代品」。

## 2. 分层总览

```
C 端                                   后台
GET  /models                           /admin/channels          渠道 · 渠道模型 · 价格档
POST /models/available                 /admin/logical-models    前台模型 · revision · 线路 · 模拟
POST /models/:id/quote                 /admin/user-groups       可见范围 · 倍率 · 货币换算
POST /generate { logicalModelId }      /admin/plugins           协议插件（安装 / 校验 / 卸载）
                                       /admin/api-logs          逐次上游调用
                                       /admin/billing-orders    生成账单（挂账单人工处置）
                                       /admin/finance           财务口径汇总
        │
        ▼
TaskAdmissionService ──► RouterService ──► BillingService.reserve
   （准入七步）           （目录快照选路）        （建账单 + 预留积分，同一事务）
        │
        ▼
TaskWorkerService（领取 / 轮询 / 切线 / 收尾）
   └─► TaskExecutorService ──► ProtocolExecutor ──► 上游 HTTP
                                   │
                                   └─► ApiCallLog（每次调用必落一行）

旁路：RouteCatalogService（30s 快照，版本失效）· RouteHealthService（进程内冷却）
      CreditWalletService（批次 FEFO 与账户余额唯一写入口）
```

**依赖方向单向**：任务层 → 路由/计费 → 渠道运行时 → 协议层。协议层（`protocol/**`）不 import 渠道、
账单或任务，只认识「请求形态 + 上游响应」；插件清单同样只声明形状，宿主负责执行。

## 3. 四个事实源

| 内容 | 唯一事实源 | 说明 |
| --- | --- | --- |
| 协议形状 | `backend/plugins/<plugin>/manifest.json`（107 个可用包，随代码入库） | 启动期由 `PluginManifestStore` 扫描、`ProtocolRegistry` 注册。仓库里不再有手写协议实现 |
| 渠道与线路供给 | `ModelChannel` / `ChannelModel` / `ChannelModelPriceTier` | 一条渠道可挂任意模态的模型；**渠道模型才是线路的最小单位** |
| 前台模型 | `LogicalModel` + `LogicalModelRevision` + `LogicalModelRoute` | 保存即发布新 revision（不可原地改），线路优先级 / 权重挂在 revision 下 |
| 价格 | 前台模型 `pricePolicy`：`unified`（统一价）或 `channel`（渠道价格档） | 运行时一律由账单快照记录实际用的档位与版本 |

**命名空间必须分清**：

| 表 | 字段 | 取值 | 用途 |
| --- | --- | --- | --- |
| `ChannelModel` | `capability` | `image` / `text` / `video` / `audio` | 供应侧模态 |
| `LogicalModel` | `capability` | C 端能力 id（`free_create` / `expand` / …） | 能力可用性按这个判定 |

把两者混用会在准入阶段直接表现为「有这个能力的模型，但模型不可用」。

**渠道模型 `protocol` 存的是插件声明里的 provider id，不是插件 id**。
例：`plugins/openai-images/manifest.json` 声明 `contributes.providers[0].id = "openai-image"`，
渠道模型必须写 `openai-image`；写成 `openai-images` 会在派发时报
`channel_unavailable`：「协议 openai-images 尚未注册执行器」。后台协议下拉读的就是注册表，正常操作不会踩到。

## 4. 数据模型

| 模型 | 作用 | 关键点 |
| --- | --- | --- |
| `ModelChannel` | 渠道：基址 / 凭证（加密）/ 并发 / 排序 / 启停 | 软删除并清空凭证，历史账单仍能关联 |
| `ChannelModel` | 渠道模型：`modelKey`、`protocol`、能力合同（`capabilityConfigJson`）、计费模式、价格档 | 每个模型可单独启停；`priceConfigured` 表示至少一个启用且已配价的有效档 |
| `ChannelModelPriceTier` | 价格档：选择器（尺寸 / 分辨率 / 质量 / 时长）→ 单价 | 改价递增 `priceVersion`，账单记录所用版本 |
| `LogicalModel` | 前台模型：C 端可见的身份 + 能力 + 价格策略 + 激活 revision | `enabled` / 归档控制目录可见性 |
| `LogicalModelRevision` | 一次发布：能力合同（产品视角）+ 默认参数 | 不可原地改，改配置 = 新 revision |
| `LogicalModelRoute` | revision 下的一条线路：`channelModelId` + `priority` + `weight` + 启停 | 分组可见范围在 `UserGroup` 侧配置 |
| `RouteAttempt` | 一次任务尝试：`routeId` / `channelModelId` / 派发状态 / 失败码 | 切线判定与排障的唯一证据 |
| `BillingOrder` | 生成账单：状态机 + 价格快照 + 用量 + 金额 | `reserved → running → settled / refunded`，异常停 `uncertain` |
| `CreditAccount` / `CreditLot` | 账户（可用 / 预留）与批次（到期时间） | 恒满足 `available == Σ lot.remaining`；扣减按 FEFO |
| `CreditLedgerEntry` | 流水：`grant / purchase / admin_adjust / refund_reclaim / reserve / consume / refund / expire` | 每次余额变化必有一条 |
| `CreditReservationItem` | 预留明细：账单 → 批次 → 金额 | 退款按它**原路**退回原批次，不造新批次 |
| `ApiCallLog` | 每次上游 HTTP：请求类型 / 渠道 / 模型 / 状态 / 耗时 / 错误 / 用量 | 只 INSERT；是结算读 Token 用量的来源 |
| `GenerationTask` | 任务：状态 `queued / running / succeeded / failed / cancelled`、`logicalModelId` / `routeId` / `channelModelId` 快照 | 任务一旦建成，供应侧字段不再随后台改价换线而变 |

## 5. 请求时序

### 5.1 建任务（`task-admission.service.ts`，顺序不可调换）

| # | 检查 | 失败码 |
| --- | --- | --- |
| 1 | 能力存在且启用（`CapabilityControl`，无行 = 启用） | `40005` + 下线原因 |
| 2 | 输入数量（`inputs` 0/1/2）与模态 | `40001` |
| 3 | 会员并发上限 | `40003` |
| 4 | 项目 / 素材归属 | `40001` / `403` |
| 5 | 遮罩与参数白名单（`sanitizeParams` + 能力合同） | `40001` |
| 6 | 解析 `logicalModelId` 并选中线路（`RouterService.resolve`） | `40005`（缺失 / 已下线 / 参数不匹配） |
| 7 | 遮罩任务必须有带 edits 的线路 | `42205` |
| 8 | 计价（`BillingService.draft`）并**建任务 + 建单 + 预留，同一事务** | `40201`（余额不足） |

- 扣费发生在**建任务时**，任务快照 `creditCost` 与账单金额同源。
- 任何一步失败都不产生任务，也不动积分。
- 并发 / 余额不足排在选路之后：用户先看到「这个模型能不能跑」，再看到「钱够不够」。
- **建任务与预留是一个 Prisma 事务**：账单要挂 `taskId`，直觉上只能「先建任务再预留」，
  但那样进程在两步之间崩溃会留下「排队中但没有账单」的任务（用户已授权、任务却永远不动）。
  三步合并后，余额不足整批回滚、崩溃整体回滚，要么全有要么全无。

**多图产出（`outputPlan`）**：能力插件可声明 `outputPlan(params)`，把一次提交拆成 N 个任务（当前只有商品详情图：勾选几个模块出几张版块图）。**按张计费**：每张任务都有一条自己的账单，各扣一份 `creditCost`（勾 6 个模块 = 6 × 单价，接口返回的 `creditCost` 是合计）；其余任务 `parentTaskId` 指向父任务，整批共享 `batchId / batchIndex / batchSize` 参数：

- 调度领取与单图任务同一条规则（`billingOrderId` 已挂上），不再有「零价兄弟」特例；
- 某张切线时只换它自己的账单；同批其它图不受影响；
- 父任务失败 / 取消会中止尚未派发的兄弟任务，并**按各自账单退回**它们自己的预留（已打到上游的不碰，留给它自己收尾）；某张图自己失败只退它自己那份；
- 一次失败只发一条站内信，金额是整批实际退回的合计；
- 删除父任务会连带删除整批（`GenerateService.removeTask`），避免留下缺原图的孤立残片；
- 预留失败（余额不够付整批）时已预留的部分全部退回再删任务，不会出现「只付了前几张的钱」。

### 5.2 执行（`task-worker.service.ts`）

```
queued ──CAS 领取──► running（写租约）
running ──租约过期──► recover（按 attempt.dispatchState 分流）
running ──nextPollAt 到期──► 回查上游
每 15s 续租，租约 45s；进程被杀后最迟 45s 被接管
```

- 每步只做一件事就把执行位让出去，长轮询不占进程。
- 本进程并发上限来自 `MODEL_ACTIVE_TASK_LIMIT`（默认 2，代码内上限另有一层节流）。
- 轮询间隔与总时限按能力模态固定：图像 3s / 15min，视频 5s / 60min，文本 1s / 10min，音频 2s / 20min。

### 5.3 一次尝试（`task-executor.service.ts`）

```
拼请求（插件表达式求值）→ 发送 → 解析响应 / 轮询 → 取媒体 → 魔数判格式
     │                                                    │
     └──────────── 必落 ApiCallLog ───────────────────────┘
```

失败码归一（顺序即优先级）：

| 失败码 | 含义 | 能否切线 |
| --- | --- | --- |
| `channel_unavailable` | 请求没发出去（协议未注册 / 渠道被停用 / 取不到凭证） | 能 |
| `upstream_401` / `403` | 凭证级拒绝 | 能（冷却渠道 10min） |
| `upstream_404` | 这个模型在这家渠道不存在 | 能（冷却该渠道模型 10min，不连坐渠道） |
| `upstream_429` | 限流 | 能（冷却 `Retry-After` 或 30s） |
| `upstream_5xx` / 超时 / 连接中断 / 解析失败 | 上游**可能已受理** | **不能**，判「结果不明」 |

## 6. 选路（`router.service.ts`）

1. 意图归一：能力 + 输入 + 选项 → `ModelRequestIntent`，图片参数按合同校验。
2. 产品能力合同匹配（revision 的 `productSpec`）—— 不匹配直接拒绝，不尝试线路。
3. 候选池过滤：线路启用、`weight > 0`、本轮未试过、未冷却、分组可见、
   `matchCapability` 通过、`channel` 价格策略下必须命中价格档。
4. **只保留最高 priority 一层**：高优先级只要还有可用线路，低优先级不分流。
5. 同层按 `weight` 加权随机（`crypto` 随机 + 拒绝采样，不做取模偏差）。

选路结果 `RoutedModel` 一次性带给下游：任务快照、账单、调用日志都从这**同一次解析**取值，
不允许任何一层替换供应侧字段 —— 否则会出现「目录显示 A、实际走 B」。

**目录快照**（`route-catalog.service.ts`）：

- TTL 30s；数据库短暂不可用时沿用旧快照，最多 5min；首次装载失败直接报错（不把空目录当「全部不可用」）。
- 装载期剔除：渠道或模型停用、`unified + token` 但协议不支持 Token 计量、`channel` 策略但无有效价格档、能力配置非法。
- 本进程写入（渠道 / 模型 / 价格 / 分组）后立即 `invalidateLocal()`；多进程最多滞后一个 TTL。

## 7. 失败语义

| 场景 | 任务结果 | 账单 / 积分 |
| --- | --- | --- |
| 准入阶段拦下（下线 / 参数 / 余额） | 任务不创建 | 不动 |
| 有线路但全部 `rejected_no_job` | `failed` + `42204`（遮罩任务 `42205`） | 按预留明细原路全额退还 |
| 上游 5xx / 超时 / 连接中断 | `failed` + `42206`（结果不明） | **不切线、不自动退款**，账单停 `uncertain`，等人工核对 |
| 进程崩溃后回收 | `failed` + `42202` | 退款 |
| AIGC 标识失败 | `failed` + `42203`（fail-closed） | 退款 |
| 成功 | `succeeded` | 结算（Token 模式按上游 usage 补扣 / 退差额） |

**切线必须换账单**：新线路的价格档可能与原线路不同，沿用旧账单等于「按 A 的价收、走 B 的线路」。
旧账单退款后**标记为 `refundReason='route_switch'`** —— 这笔钱只是从旧线路的预授权挪到新线路的
预授权，用户没拿回钱、平台也没多收，**不计入财务口径的「已退」**（否则一次 9 分换 4 分的
成功任务会显示净收入 −5）。失败通知里的「已退回 N 积分」同样跳过这一类。

冷却（`route-health.service.ts`）只对**明确可归因**的失败生效；超时与 5xx 一律不冷却 ——
上游抖动时关 10 分钟会把一次偶发故障放大成整段时间不可用。冷却只存进程内存（本仓没有 Redis），
多实例各自判定，不影响正确性。

## 8. 计费

四条不可违背的规则（`billing.service.ts`）：

1. **建任务 + 建单 + 预留同一事务**：先建任务后预留失败会留下永远不结算的账单与「排队但无账单」的任务。
2. 已结算账单不允许自动退款；已退款账单不允许再结算。
3. Token 结算以上游 usage 为准；上游没给用量时，视频按提交时的公式快照，其余显式失败转人工 ——
   绝不按预授权金额静默结清。
4. `chargeLimit` 生效时按上限截断（Token）或直接拒绝（按秒）；自动扣费不能突破用户授权。

钱包（`credit-wallet.service.ts`）：

- `CreditAccount.available == Σ CreditLot.remaining` 恒成立，任何改动必须在同一事务里两边一起动。
- 预留：可用 → 预留，并记 `CreditReservationItem`（哪个批次被冻结了多少）。
- 退款：按 `CreditReservationItem` **原路**退回原批次（保留原到期时间），不新建永久批次。
- 结算：按 FEFO 从批次扣减并记 `consume`；预授权多收的部分同步退回。
- 用户分组倍率与货币换算（`user-group.service.ts`）在同一处折算，目录展示价与账单必须用同一组因子。

**退款归类（`BillingOrder.refundReason`）**：`failure` / `manual` / `proxy_timeout` / `auto_sweep`
都算真实退款；`route_switch`（线路切换的内部重预留）**不计入「已退」**，也不进失败通知的
「已退回积分」。财务页的「已退」与「净收入」都按这个口径算。

**兜底清扫（`billing-sweeper.service.ts`）**：

- 代理账单（`taskId=''`）无条件兜底：`reserved` 超 30 分钟退款，`running` 超 60 分钟转人工；
- 任务账单只在后台打开 **`generate.billingAutoRefund`（冻结积分自动退回，默认关闭）** 时处理，
  口径与「待核对」队列一致（uncertain / running 超 40 分钟 / 任务已失败但仍预留），
  已出作品或正在补交付（`pendingResult` / `mediaRecoveryError`）的订单排除；
- 开关默认关闭：待核对订单可能已在上游产生费用，退与不退是运营口径，不是技术默认。

## 9. 后台页面与接口

| 页面 | 前缀 | 要点 |
| --- | --- | --- |
| 渠道工作台 | `/admin/channels` | 双视图：**按渠道**（左侧渠道导航 + 右侧选中渠道的详情，主从布局；左列承载新建 / 导入 / 导出全部 / 排序，详情头部承载编辑 / 复制 / 导出 / 停用·启用 / 删除，渠道模型与价格档、协议连通性测试；新建时 API Key 必填 —— 没有凭证的渠道只是永远 401 的线路；自定义请求头用结构化编辑器逐行增删，系统托管的头在提交前拦下）与**全部模型**（跨渠道列出全部线路，含停用项，按能力 / 状态 / 渠道筛选，筛选一变即回第一页；按显示名 → 模型标识 → 渠道名排序，同一模型在不同渠道的行相邻，工具条给「N 个模型 · M 个可用」计数；行内可直接改启停，**停用前出确认**说明前台模型会切到其它线路；「编辑」一步跳到该渠道并打开这条模型的编辑器，点渠道名只跳回该渠道的配置视图）；渠道与渠道内模型**排序**（`PUT .../order` 带 `expectedIds` 乐观并发，顺序被动过即 `40900` 整单拒绝）；模型编辑走弹窗（右侧详情区保持稳定视图），清单带关键字 / 能力 / 状态（含「未定价」）筛选与分页，并含 24h 稳定性列（与「全部模型」同一数据源），行内可**复制模型**（副本默认停用）；停用前出影响范围确认，**批量删除**与**统一调价**在详情区内联；**上游目录**导入走弹窗（搜索、全选/取消全选、已存在标记，默认只预选本地没有的模型）；**线路当前状态**（`GET /admin/channels/health`：启停 / 协议 / 冷却）、**线路历史表现**（`GET /admin/channel-models/health`：24h / 7d 成功率、P95、最近样本，按渠道模型出表）。渠道与渠道模型删除均保留业务确认，但不填写原因，操作仍写审计 |
| 前台模型 | `/admin/logical-models` | 保存即发布 revision；线路优先级 / 权重；`POST /:id/simulate` 回答「这组参数会落到哪条线路、为什么没落」 |
| 用户分组 | `/admin/user-groups` | 可见渠道集合、倍率、货币换算、按模型覆盖 |
| 插件 | `/admin/plugins` | 内置包只读；上传包可校验 / 安装 / 卸载；每项带**当前环境可用性**（停用 / 宿主引擎未内置 / 只贡献支付短信等非模型能力）与人话原因 |
| 调用记录 | `/admin/model-calls`（数据源 `/admin/api-logs`） | 逐次上游 HTTP，含后台连通性测试（`billable=false`）；`GET /admin/api-logs/export` 导出 CSV（不含请求 / 响应体） |
| 生成账单 | `/admin/billing-orders` | `uncertain` 只能人工 `settle` / `refund`，必须填原因并写审计；**「待核对」队列**（`?status=review`：uncertain ∪ running 超 40 分钟 ∪ reserved 但任务已失败/取消）让运营一眼看到该处置哪些单；**批量核对** `POST /admin/billing-orders/batch-resolve` 逐条独立处置，单条失败不影响其余并回显失败原因 |
| 财务分析 | `/admin/finance` | `GET /admin/analytics/finance`：实收只算已结算，挂账单单列 |

C 端目录接口：`GET /models`（可选身份，登录后按分组过滤并折算价格）、`POST /models/available`、
`POST /models/:id/quote`。三者都无副作用。

## 10. 代理中转（`src/model/proxy/**`）

| 入口 | 鉴权 | 说明 |
| --- | --- | --- |
| `ALL /ai/system/:channelId/*path` | 登录态 + 授权规则 | 用系统渠道凭证转发到该渠道的上游 |
| `ALL /ai/:channelId/*path` | 登录态 + 授权规则 | 短路径形式，等价入口 |
| `ALL /ai/custom` | 登录态 | 用户自带凭证的中转（`custom-relay*`），走独立计费与调用日志 |

三条硬约束（`proxy.paths.ts`）：

1. **白名单而不是黑名单**：只放行协议真正声明过的端点，未登记路径直接 403 ——
   上游若是通用 OpenAI 网关，放行任意路径等于给攻击者一个开放出站代理。
2. **路径先规范化再判定**：解码百分号、拒绝反斜杠与空字节、要求 `path.Clean` 不变形。
3. **短路径让出保留前缀**：`/api/v1/tasks/*` 等业务路由不能被当成渠道 id。

请求 / 响应体积与超时上限见 `MODEL_PROXY_*` 环境变量（`src/config/env.validation.ts`）。

## 11. 扩展 SOP

### 新增一种协议（新厂商接入）

1. 在 `backend/plugins/<plugin-id>/` 放 manifest（或后台上传安装）。声明
   `contributes.providers[].id`、`capabilities`、`auth`、`create` / `poll` / `response` 映射。
2. 重启进程，或在后台「插件」页启用它 —— `PluginProtocolService.registerAll()` 每次从库里读停用集合后重建注册表；后台协议下拉按能力过滤即可见。
3. 后台渠道工作台新建渠道 → 添加渠道模型（协议选 provider id）→ 配价格档。
4. 跑 `npm run verify:plugin-manifests` 与 `npm run verify:protocol-runtime`。

### 新增一台前台模型

1. `/admin/logical-models` 新建：能力、价格策略、能力合同、默认参数。
2. 挂线路（渠道模型 + priority + weight），保存即发布新 revision。
3. 用 `simulate` 验证一组真实参数会落到期望线路，再跑 `verify:route-catalog`。

### 新增一项能力

1. `backend/src/capabilities/definitions/<id>.ts` 导出 `CapabilityPlugin`，在 `definitions/index.ts` 聚合。
2. 装配期 `assertCapabilityIntegrity` 校验；不用改前端（工作台、侧栏、表单由这份数据渲染）。
3. 之后仍需在后台为这项能力配前台模型，否则 `runtime.effective = unavailable`。

## 12. 环境变量

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `MODEL_SECRET_KEY` | 空 | 渠道凭证加密密钥（生产必须显式提供） |
| `MODEL_PLUGIN_DIR` | `plugins` | 随代码入库的插件目录（不可卸载） |
| `MODEL_PLUGIN_INSTALL_DIR` | `plugins-installed` | 后台上传插件的安装目录（可卸载） |
| `MODEL_PROVIDER_CATALOG_URL` | 空 | 服务商目录（推荐模型 / 上游模型清单）来源 |
| `MODEL_ACTIVE_TASK_LIMIT` | 2 | 本进程同时执行的任务数 |
| `MODEL_HTTP_TIMEOUT_MS` | 120000 | 单次上游请求超时 |
| `MODEL_MEDIA_TIMEOUT_MS` | 180000 | 媒体下载超时 |
| `MODEL_WORKER_INTERVAL_MS` | 1000 | 调度节拍 |
| `MODEL_LEASE_MS` | 120000 | 任务租约（代码内含 45s 的下限保护） |
| `MODEL_SLOT_WAIT_MS` | 60000 | 渠道并发槽等槽上限；超时即切线 / `429` |
| `MODEL_ALLOW_PRIVATE_UPSTREAMS` / `MODEL_ALLOWED_PRIVATE_UPSTREAM_HOSTS` | false / 空 | 是否允许私网上游（本地联调才开） |
| `MODEL_PROXY_*` | 见 env.validation | 中转的开关、体积、超时、并发 |
| `ASSET_PUBLIC_BASE` | 空 | 参考图回传基址；留空取 `http://localhost:<PORT>` |

**生成通道不再有 `GATEWAY_*` 环境变量**：渠道、模型、价格全部在后台配置。
零配置 = 没有可用线路 = 能力 `unavailable`，提交直接被拦（`40005`），已有任务执行失败并退款。

## 13. 运行期约束与排障

1. **改动模型层后不看目录快照就等于没改**：路由读的是 30s 快照。同进程写入会自动失效；
   跨进程最多滞后 30s，排障时先等一拍或重启。
2. **界面说可用、提交 42204**：对照 `RouteAttempt.failureCode`。最常见是协议 id 写成插件 id（见 §3）。
3. **账单停在 `uncertain` 不是 bug**：它表示「上游可能已经做了这件事」，只能人工核对后
   `settle` / `refund`，两条路径都写审计。
4. **冷却只反映本进程**：`/health` 与 `/admin/channels/health` 都只报当前实例看到的状态。
5. **单实例内存额度**：任务并发、冷却、快照都是进程级。多实例部署时按实例数放大上游配额。
6. **后台「调用记录」与「生成账单」口径不同**：前者逐次 HTTP，后者按任务聚合（含创建与多次轮询）。

## 14. 相关文档

- 设计动机与迁移方案：`docs/channel-model-design.md`
- 三环境与变量矩阵：`docs/environments.md`
- 接口清单与错误码：`docs/api-contract.md`
- 积分扣费与退款口径：`docs/commerce-design.md`
- 测试闸口与已知缺口：`docs/testing.md`
