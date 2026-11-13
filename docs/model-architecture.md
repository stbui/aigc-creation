# 模型层架构（渠道 → 能力绑定 → 选路 → 计费）

> 范围：`backend/src/model/**` 与它对外暴露的 `/models`、`/admin/channels`、`/admin/capabilities`、
> `/admin/api-logs`、`/admin/billing-orders`、`/admin/finance`、`/ai/*` 中转。
> 本文只写**当前实际实现**，每条约束都能在代码里核对；设计动机见
> `docs/channel-model-automation-design.md`（本轮重构）与 `docs/channel-model-design.md`（上一轮移植）。
>
> 前台模型层（`LogicalModel` / `LogicalModelRevision` / `LogicalModelRoute`）已于 2026-11-13 删除：
> 渠道模型直接作为售卖供给，按能力绑定后由运行时自动切换线路。

## 1. 一句话

C 端按 **能力 + 模型分组** 选模型；后端用能力目录快照把它解析成**一条可执行的渠道模型线路**；
协议适配器按插件映射发上游；积分在**创建任务时按能力售价预留**，按结果结算或原路退还。
没有任何一步允许「拿不到真实结果就给个替代品」。

## 2. 分层总览

```
C 端                                    后台
GET  /models?capability=                /admin/channels          渠道 · 商品 · 成本档
POST /models/available                  /admin/capabilities      能力上下线 · 候选池 · 能力售价 · 模拟
POST /models/quote                      /admin/user-groups       可见范围 · 倍率 · 货币换算
POST /generate { capability, modelKey } /admin/plugins           协议插件（安装 / 校验 / 卸载）
                                        /admin/api-logs          逐次上游调用
                                        /admin/billing-orders    生成账单（挂账单人工处置）
                                        /admin/finance           财务口径汇总
        │
        ▼
TaskAdmissionService ──► RouterService ──► BillingService.reserve
   （准入八步）          （能力目录选路）      （按能力价建账单 + 预留，同一事务）
        │
        ▼
TaskWorkerService（领取 / 轮询 / 切线 / 收尾）
   └─► TaskExecutorService ──► ProtocolExecutor ──► 上游 HTTP
                                   │
                                   └─► ApiCallLog（每次调用必落一行）

旁路：CapabilityCatalogService（30s 快照，版本失效）· RouteScoreService（24h 健康分层）
      RouteHealthService（进程内冷却）· CreditWalletService（批次 FEFO 唯一写入口）
```

**依赖方向单向**：任务层 → 路由/计费 → 渠道运行时 → 协议层。协议层（`protocol/**`）不 import
渠道、账单或任务，只认识「请求形态 + 上游响应」。

## 3. 四个事实源

| 内容 | 唯一事实源 | 说明 |
| --- | --- | --- |
| 协议形状 | `backend/plugins/<plugin>/manifest.json` | 启动期由 `PluginManifestStore` 扫描、`ProtocolRegistry` 注册；仓库里没有手写协议实现 |
| 渠道与供给 | `ModelChannel` / `ChannelModel` / `ChannelModelPriceTier` | 一条渠道挂任意模态的商品；**渠道模型才是线路最小单位** |
| 售卖配置 | `CapabilityModelBinding` | 「某 C 端能力允许使用哪些商品」，后台的「选模型」结果与运行时唯一候选来源 |
| 价格 | `CapabilityPricing` | 能力级售价：固定价 / 按秒 / Token；**切换线路不改价** |
| 模型分组 | `ChannelModel.modelGroupKey` | 读取时聚合，不落表；空串回落 `modelKey` |

**命名空间必须分清**：

| 表 | 字段 | 取值 | 用途 |
| --- | --- | --- | --- |
| `ChannelModel` | `capability` | `image` / `text` / `video` / `audio` | 供应侧模态 |
| `CapabilityModelBinding` | `capabilityId` | C 端能力 id（`free_create` / `expand` / …） | 能力可用性与候选池按这个判定 |

把两者混用会在准入阶段直接表现为「有这个能力的模型，但模型不可用」。

**渠道模型 `protocol` 存的是插件声明里的 provider id，不是插件 id**。
例：`plugins/openai-images/manifest.json` 声明 `contributes.providers[0].id = "openai-image"`，
渠道模型必须写 `openai-image`；写成 `openai-images` 会报 `channel_unavailable`。

## 4. 数据模型

| 模型 | 作用 | 关键点 |
| --- | --- | --- |
| `ModelChannel` | 渠道：基址 / 凭证（加密）/ 并发 / 排序 / 启停 | 软删除并清空凭证，历史账单仍能关联 |
| `ChannelModel` | 商品：`modelKey`、`modelGroupKey`、`protocol`、能力合同、成本档、启停 | 每个商品可单独启停；`priceConfigured` 表示至少一个成本档 |
| `ChannelModelPriceTier` | 成本档：选择器 → 成本单价 | `sale*` 字段不再参与生成计费；成本用于毛利 |
| `CapabilityModelBinding` | 能力 ↔ 商品：`enabled` / `priority` / `weight` | 唯一售卖方配置；删除直接删行 |
| `CapabilityPricing` | 能力售价：`billingMode` + 四项单价（微积分） | 缺行时固定价能力回落 `creditCost`；Token 能力必须显式配置 |
| `RouteAttempt` | 一次任务尝试：`capabilityId` / `modelKey` / `channelModelId` / 派发状态 / 失败码 | 切线判定与排障的唯一证据 |
| `BillingOrder` | 生成账单：状态机 + 能力价快照 + 成本快照 + 用量 + 金额 | `reserved → running → settled / refunded`，异常停 `uncertain` |
| `CreditAccount` / `CreditLot` | 账户（可用 / 预留）与批次（到期时间） | 恒满足 `available == Σ lot.remaining`；扣减按 FEFO |
| `CreditLedgerEntry` | 流水：`grant / purchase / admin_adjust / refund_reclaim / reserve / consume / refund / expire` | 每次余额变化必有一条 |
| `CreditReservationItem` | 预留明细：账单 → 批次 → 金额 | 退款按它**原路**退回原批次 |
| `ApiCallLog` | 每次上游 HTTP：请求类型 / 渠道 / 模型 / 状态 / 耗时 / 错误 / 用量 | 只 INSERT；是结算读 Token 用量的来源 |
| `GenerationTask` | 任务：`capability` / `modelKey` / `channelModelId` / `channelId` 快照 | 任务建成后供应侧字段不再随后台改配置而变 |

## 5. 请求时序

### 5.1 建任务（`task-admission.service.ts`，顺序不可调换）

| # | 检查 | 失败码 |
| --- | --- | --- |
| 1 | 能力存在且启用（`CapabilityControl`，无行 = 启用） | `40005` + 下线原因 |
| 2 | 输入数量（`inputs`）与模态 | `40001` |
| 3 | 会员权益解析（`maxConcurrent` 写入任务快照，提交阶段不拒绝） | — |
| 4 | 项目 / 素材归属 | `40001` / `403` |
| 5 | 遮罩与参数白名单（`sanitizeParams` + 能力定义） | `40001` |
| 6 | 解析 `capability + modelKey` 并选中线路（`RouterService.resolve`） | `40005`（模型不存在 / 无可用线路 / 参数不匹配） |
| 7 | 遮罩任务必须有带 edits 的线路 | `42205` |
| 8 | 按 `CapabilityPricing` 计价并**建任务 + 建单 + 预留，同一事务** | `40201`（余额不足） |

- 扣费发生在**建任务时**，任务快照 `creditCost` 与账单金额同源。
- 任何一步失败都不产生任务，也不动积分。
- 建任务与预留是同一个 Prisma 事务：余额不足整批回滚、进程崩溃整体回滚。
- 会员并发按**任务（图片）**计数，但不在提交阶段拒绝：`maxConcurrent` 随任务参数落库（`__memberConcurrency`），worker 领取时要求「该用户当前 `running` 任务数 < 上限」，超出部分留在 `queued` 下一批继续。`parentTaskId` 只用于批次归属，不参与并发折算。

**多图产出（`outputPlan`）**：能力插件可声明 `outputPlan(params)`，把一次提交拆成 N 个任务
（当前商品主图、商品详情图与带货图文在用）。**按张计费**：每张任务一条自己的账单，各扣一份
`creditCost`；其余任务 `parentTaskId` 指向父任务，共享 `batchId / batchIndex / batchSize`。
某张切线只换它自己的账单；模块失败互不连坐，只有后台显式终止 / 整批取消才会中止未派发的兄弟任务并各自退款。

### 5.2 执行（`task-worker.service.ts`）

```
queued ──CAS 领取──► running（写租约）
running ──租约过期──► recover（按 attempt.dispatchState 分流）
running ──nextPollAt 到期──► 回查上游
每 15s 续租，租约 45s；进程被杀后最迟 45s 被接管
```

- 每步只做一件事就把执行位让出去，长轮询不占进程。
- 本进程执行位上限来自 `MODEL_ACTIVE_TASK_LIMIT`（默认 64，范围 1–64）。领取排队任务时同时检查用户 `maxConcurrent` 与渠道 `concurrencyLimit`；任一已满就跳过该任务，留在队列等下一轮，不判失败。例如 20 张、套餐并发 10、渠道并发 8 → 8 / 8 / 4 三批。
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
| `outbound_dns_failed` / `outbound_proxy_invalid` / `outbound_connection_refused` / `outbound_network_unreachable` / `outbound_invalid_url` / `outbound_blocked_host` | 请求在写出前失败 | 能（不计冷却） |
| `upstream_5xx` / 超时 / 建连后中断 / 解析失败 | 上游**可能已受理** | **不能**，判「结果不明」 |

**建连前与建连后的分界必须以证据为准**：`ECONNREFUSED`、`ENOTFOUND`、`EAI_AGAIN`、
`ENETUNREACH`、`EHOSTUNREACH` 等 errno 归 `rejected_no_job`；`ECONNRESET`、`socket hang up`、
超时、5xx 或响应解析失败可能发生在请求已写出之后，不能自动重发。

## 6. 选路（`router.service.ts`）

1. 意图归一：能力 + 输入 + 选项 → `ModelRequestIntent`；线路合同未启用的参数先剔除
   （`restrictIntentToSpec`），再按能力合同匹配。
2. 候选池：绑定启用、商品与渠道启用、`weight > 0`、本轮未试过、未冷却、分组可见、
   `matchCapability` 通过。
3. **分组优先**：用户选中的 `modelKey` 分组 `groupRank=0`；同能力其它分组 `groupRank=1`，
   只有选中分组全部失败后才跨分组兜底。
4. **健康分层**：`effectivePriority = healthTier × 1000 + binding.priority`；
   24h 成功率 < 50% → 2，50%–90% → 1，≥90% 或无样本 → 0。健康分层优先于手工优先级。
5. 只保留最优层（`groupRank` 与 `effectivePriority` 都最小），同层按 `weight` 加权随机
   （crypto + 拒绝采样）。

选路结果 `RoutedModel` 一次性带给下游：任务快照、账单、调用日志都从这**同一次解析**取值，
不允许任何一层替换供应侧字段 —— 否则会出现「目录显示 A、实际走 B」。

**能力目录快照**（`capability-catalog.service.ts`）：

- TTL 30s；数据库短暂不可用时沿用旧快照，最多 5min；首次装载失败直接报错。
- 装载期剔除：绑定停用、商品或渠道停用、软删除、能力配置非法。
- 本进程写入（渠道 / 商品 / 绑定 / 定价 / 分组）后立即 `invalidateLocal()`；多进程最多滞后一个 TTL。
- 健康分层由 `RouteScoreService` 读 `ChannelModelMetricsService` 的 24h 聚合，进程内缓存 30s。

**模型分组**：同一能力下 `modelGroupKey` 相同的商品合并成一个 C 端选项；`modelGroupKey` 为空时
取 `modelKey`。分组没有主键、没有 revision，展示名取绑定优先级最高、排序最靠前的商品。

## 7. 失败语义

| 场景 | 任务结果 | 账单 / 积分 |
| --- | --- | --- |
| 准入阶段拦下（下线 / 参数 / 余额） | 任务不创建 | 不动 |
| 有线路但全部 `rejected_no_job`（含建连前网络失败） | `failed` + `42204`（遮罩任务 `42205`） | 按预留明细原路全额退还 |
| 建连后 5xx / 超时 / 连接中断 / 解析失败 | `failed` + `42206`（结果不明） | **不切线、不自动退款**，账单停 `uncertain`，等人工核对 |
| 进程崩溃后回收 | `failed` + `42202` | 退款 |
| AIGC 标识失败 | `failed` + `42203`（fail-closed） | 退款 |
| 成功 | `succeeded` | 结算（Token 模式按上游 usage 补扣 / 退差额） |

`uncertain` 的唯一业务含义是「请求可能已经到达上游，结果无法确认」。因此
`ECONNREFUSED`、DNS 解析失败、TCP 不可达等可证明请求未写出的错误不得进入该状态。

**切线仍替换账单**：售价在能力级，切换线路金额不变；替换账单用于把供应快照与成本档更新为
实际线路。旧账单退款后标记 `refundReason='route_switch'`，**不计入财务口径的「已退」**。

冷却（`route-health.service.ts`）只对**明确可归因**的失败生效；超时与 5xx 一律不冷却。
冷却只存进程内存，多实例各自判定。上游恢复后可直接调用
`POST /admin/channels/health/reset`（`channel.write`）手动解除。

## 8. 计费

四条不可违背的规则（`billing.service.ts`）：

1. **建任务 + 建单 + 预留同一事务**。
2. 已结算账单不允许自动退款；已退款账单不允许再结算。
3. Token 结算以上游 usage 为准；上游没给用量时，视频按提交时的公式快照，其余显式失败转人工。
4. `chargeLimit` 生效时按上限截断（Token）或直接拒绝（按秒）。

价格口径：

- 生成链路售价来自 `CapabilityPricing`，`CreditPriceService` 负责后台覆盖价、分组倍率、
  货币换算与限时免费；C 端按钮价、报价与账单同源。
- 渠道价格档的 `sale*` 不再参与生成计费；`cost*` 作为成本快照写入 `BillingOrder` 与
  `RouteAttempt`，用于毛利分析。成本缺失时 `costConfigured=false`，不按 0 记账。
- 中转入口（`/ai/system/*`、`/ai/custom`）仍按渠道价格档计费，与生成链路分开。

钱包（`credit-wallet.service.ts`）：

- `CreditAccount.available == Σ CreditLot.remaining` 恒成立，任何改动必须在同一事务里两边一起动。
- 预留：可用 → 预留，并记 `CreditReservationItem`。
- 退款：按 `CreditReservationItem` **原路**退回原批次（保留原到期时间），不新建永久批次。
- 结算：按 FEFO 从批次扣减并记 `consume`；预授权多收的部分同步退回。

**兜底清扫（`billing-sweeper.service.ts`）**：代理账单无条件兜底；任务账单只在后台打开
`generate.billingAutoRefund` 时处理，已出作品或正在补交付的订单排除。

## 9. 后台页面与接口

| 页面 | 前缀 | 要点 |
| --- | --- | --- |
| 模型商品 | `/admin/channels` | 供应商主从视图 + 商品台账；导入上游商品时可勾选「可承接能力」，导入后直接写入绑定；商品台账支持「绑定到能力」与批量绑定；成本档用于毛利，售价在能力页配置 |
| 能力与模型 | `/admin/capabilities` | 能力上下线 + 候选池 + 能力售价 + 路由模拟；候选池可添加 / 移除商品、调优先级 / 权重；定价支持按次 / 按秒 / Token |
| 用户分组 | `/admin/user-groups` | 可见渠道集合、倍率、货币换算、按模型覆盖 |
| 插件 | `/admin/plugins` | 内置包只读；上传包可校验 / 安装 / 卸载；每项带当前环境可用性 |
| 调用记录 | `/admin/model-calls` | 逐次上游 HTTP；`GET /admin/api-logs/export` 导出 CSV |
| 生成账单 | `/admin/billing-orders` | `uncertain` 只能人工 `settle` / `refund`，必须填原因；支持批量核对 |
| 财务分析 | `/admin/finance` | `GET /admin/analytics/finance`：实收只算已结算，挂账单单列 |

C 端目录接口：`GET /models?capability=`（可选身份，登录后按分组过滤并折算价格）、
`POST /models/available`、`POST /models/quote`。三者都无副作用。

后台能力接口：`GET/PUT /admin/capabilities/:id/models`、`GET/PUT /admin/capabilities/:id/pricing`、
`POST /admin/capabilities/:id/simulate`、`GET /admin/channel-models/:id/capabilities`、
`POST /admin/channel-models/:id/publish`。

## 10. 代理中转（`src/model/proxy/**`）

| 入口 | 鉴权 | 说明 |
| --- | --- | --- |
| `ALL /ai/system/:channelId/*path` | 登录态 + 授权规则 | 用系统渠道凭证转发到该渠道的上游 |
| `ALL /ai/:channelId/*path` | 登录态 + 授权规则 | 短路径形式，等价入口 |
| `ALL /ai/custom` | 登录态 | 用户自带凭证的中转，走独立计费与调用日志 |

三条硬约束（`proxy.paths.ts`）：

1. **白名单而不是黑名单**：只放行协议真正声明过的端点，未登记路径直接 403。
2. **路径先规范化再判定**：解码百分号、拒绝反斜杠与空字节、要求 `path.Clean` 不变形。
3. **短路径让出保留前缀**：`/api/v1/tasks/*` 等业务路由不能被当成渠道 id。

## 11. 扩展 SOP

### 新增一种协议（新厂商接入）

1. 在 `backend/plugins/<plugin-id>/` 放 manifest（或后台上传安装）。声明
   `contributes.providers[].id`、`capabilities`、`auth`、`create` / `poll` / `response` 映射。
2. 重启进程，或在后台「插件」页启用它。
3. 后台「模型商品」新建供应商 → 导入 / 新建商品（协议选 provider id）→ 绑定到能力。
4. 跑 `npm run verify:plugin-manifests` 与 `npm run verify:protocol-runtime`。

### 新增一台可售模型

1. `/admin/channels` 导入上游商品，或手工新建商品并声明能力合同。
2. 导入弹窗勾选可承接能力（或商品台账「绑定到能力」）；系统自动补默认能力定价。
3. `/admin/capabilities` 调整优先级 / 权重与售价，用「模拟选路」验证会落到期望线路。

### 新增一项能力

1. `backend/src/capabilities/definitions/<id>.ts` 导出 `CapabilityPlugin`，在 `definitions/index.ts` 聚合。
2. 装配期 `assertCapabilityIntegrity` 校验；不用改前端。
3. 在后台把商品绑定到这项能力并设置售价，否则 `runtime.effective = unavailable`。

## 12. 环境变量

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `MODEL_SECRET_KEY` | 空 | 渠道凭证加密密钥（生产必须显式提供） |
| `MODEL_PLUGIN_DIR` | `plugins` | 随代码入库的插件目录（不可卸载） |
| `MODEL_PLUGIN_INSTALL_DIR` | `plugins-installed` | 后台上传插件的安装目录（可卸载） |
| `MODEL_PROVIDER_CATALOG_URL` | 空 | 服务商目录来源 |
| `MODEL_ACTIVE_TASK_LIMIT` | 64 | 本进程同时执行的任务数上限（1–64） |
| `MODEL_HTTP_TIMEOUT_MS` | 120000 | 单次上游请求超时 |
| `MODEL_MEDIA_TIMEOUT_MS` | 180000 | 媒体下载超时 |
| `MODEL_WORKER_INTERVAL_MS` | 1000 | 调度节拍 |
| `MODEL_LEASE_MS` | 120000 | 任务租约（代码内含 45s 下限保护） |
| `MODEL_SLOT_WAIT_MS` | 60000 | 渠道并发槽等槽上限；超时即切线 / `429` |
| `MODEL_ALLOW_PRIVATE_UPSTREAMS` / `MODEL_ALLOWED_PRIVATE_UPSTREAM_HOSTS` | false / 空 | 是否允许私网上游（本地联调才开） |
| `MODEL_PROXY_*` | 见 env.validation | 中转的开关、体积、超时、并发 |
| `ASSET_PUBLIC_BASE` | 空 | 参考图回传基址；留空取 `http://localhost:<PORT>` |

**生成通道没有 `GATEWAY_*`**：渠道、商品、绑定、售价全部在后台配置。零绑定 = 能力
`unavailable`，提交直接被拦（`40005`）。

## 13. 运行期约束与排障

1. **改动模型层后不看目录快照就等于没改**：路由读的是 30s 快照。同进程写入会自动失效；
   跨进程最多滞后 30s。
2. **界面说可用、提交 42204**：对照 `RouteAttempt.failureCode`。最常见是协议 id 写成插件 id，
   或绑定已停用 / 商品被渠道停用。
3. **账单停在 `uncertain` 不是 bug**：它只表示「请求可能已经到达上游，结果无法确认」，
   只能人工核对后 `settle` / `refund`。
4. **冷却只反映本进程**：`/admin/channels/health` 只报当前实例看到的状态。
5. **健康分层有 30s 延迟**：刚恢复的线路最多 30s 后才回到健康层，不需要人工干预。
6. **后台「调用记录」与「生成账单」口径不同**：前者逐次 HTTP，后者按任务聚合。

## 14. 相关文档

- 本轮重构方案：`docs/channel-model-automation-design.md`
- 上一轮移植记录：`docs/channel-model-design.md`
- 三环境与变量矩阵：`docs/environments.md`
- 接口清单与错误码：`docs/api-contract.md`
- 积分扣费与退款口径：`docs/commerce-design.md`
- 测试闸口与已知缺口：`docs/testing.md`
