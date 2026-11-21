# 模型渠道与网关方案

状态：基于当前代码的目标设计稿。本文用于统一领域语言、数据流和后台配置流程；现有实现已经覆盖其中大部分运行时能力，但追踪链和配置审计仍需要补齐。

## 1. 先统一模型

用户提出的链路：

```text
前台 → 生图 → 模型 → 模型路由 → 模型网关 → 模型供应商
```

在系统里应展开为：

```text
用户
  │ 选择能力 + 模型分组 + 输入参数
  ▼
能力（生图 / 重绘 / 图生视频）
  │ 生成统一请求意图
  ▼
模型分组（前台模型选项）
  │ 解析能力绑定，得到候选线路
  ▼
路由决策
  │ 选择渠道模型，并生成不可变的路由尝试
  ▼
模型网关
  │ 凭证、协议、请求、出站、轮询、结果、日志、计费
  ▼
渠道模型 → 渠道 → 供应商
```

必须坚持以下区分：

| 概念 | 回答的问题 | 当前主要事实源 |
| --- | --- | --- |
| 能力 | 用户想完成什么业务动作？ | `CapabilityPlugin` / 能力定义 |
| 模型分组 | 用户选择哪个前台模型选项？ | `ChannelModel.modelGroupKey` 派生 |
| 供应商 | 外部服务是谁提供的？ | 目前主要来自渠道名称 / 目录来源，建议补充供应商维度 |
| 渠道 | 用哪个账号、地址、区域或出口访问供应商？ | `ModelChannel` |
| 渠道模型 | 该渠道上实际调用哪个 SKU？ | `ChannelModel` |
| 路由线路 | 本次请求允许走哪些供应侧候选？ | `CapabilityModelBinding` + 健康/分组策略 |
| 协议 | 请求和响应如何翻译？ | 插件 manifest + `ProtocolRegistry` |
| 调用 | 实际发出了哪些 HTTP 请求？ | `ApiCallLog` |
| 任务 | 用户的一次异步生成生命周期是什么？ | `GenerationTask` |
| 尝试 | 任务在某条线路上发生了什么？ | `RouteAttempt` |

当前代码已经删除了旧的 `LogicalModel / LogicalModelRevision / LogicalModelRoute` 层。不要重新引入同名层来承载相同职责；前台选择应继续使用“能力 + 模型分组”，供应侧执行由渠道模型和能力绑定完成。

## 2. 总体模块划分

模型网关是一个深模块，对上只暴露统一的生成执行接口，对下隐藏不同供应商的协议、鉴权、轮询和媒体处理。

```text
┌────────────────────────────────────────────────────────────────┐
│ 产品层：生图页面 / 提示词工具 / 其他生成入口                   │
│ 只知道 capability、modelKey、intent、inputs、idempotencyKey   │
└───────────────────────────────┬────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────┐
│ 统一模型网关接口                                                │
│ admit → quote/reserve → dispatch → poll/recover → settle       │
└───────┬───────────────┬────────────────┬───────────────────────┘
        ▼               ▼                ▼
  能力目录/意图       路由决策          任务与计费
  match/spec       priority/weight    attempt/billing
        │               │                │
        └───────────────┴────────────────┘
                        ▼
              渠道运行时装配
       解密凭证 / 并发槽 / 代理 / 出站安全
                        ▼
                  协议适配器
             manifest / request / response
                        ▼
                    上游 HTTP
```

模块职责边界：

| 模块 | 应负责 | 不应负责 |
| --- | --- | --- |
| 能力定义 | 输入、参数、输出和意图归一 | 供应商 URL、API Key、具体上游字段 |
| 能力目录 | 读取绑定并形成可用快照 | 发起上游请求、改写用户请求 |
| 路由模块 | 候选过滤、健康分层、优先级、权重、切线 | 协议字段翻译、凭证解密 |
| 渠道运行时 | 读取渠道、校验启停、解密凭证、组装出口 | 决定业务能力和用户售价 |
| 协议适配器 | 把统一请求翻译为上游请求、解析响应 | 读数据库、直接发网络请求、扣费 |
| 出站模块 | SSRF、代理、超时、体积、连接错误分类 | 选择模型、解析业务响应 |
| 任务执行器 | create/poll/result/media 生命周期 | 决定前台展示价格 |
| 计费模块 | 预留、结算、退款、结果不明 | 重试上游请求 |
| 观测模块 | 记录和查询链路事实 | 以日志推断缺失的状态机事实 |

## 3. 前台到上游的完整流程

### 3.1 前台目录和模型选择

1. 生图页面先确定能力，例如 `main_image` 或 `free_create`。
2. 前台根据能力请求模型目录；接口只返回模型分组、展示信息、能力参数合同和价格摘要。
3. 用户选择模型分组，不直接选择供应商、渠道或上游模型键。
4. 用户修改尺寸、质量、参考图数量等参数时，前台发送统一意图请求获取可用性和报价。
5. 前台提交时仍需带能力、模型分组、意图和幂等键；服务端不信任前台传来的渠道、价格或供应商字段。

当前对应接口：

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| 普通目录 | `GET /models?capability=` | 前台模型分组目录 |
| 参数可用性 | `POST /models/available` | 按统一请求意图过滤 |
| 报价 | `POST /models/quote` | 无副作用报价 |
| 渠道视图目录 | `GET /model-catalog` | 供应视角，主要用于联调或特定选型 |
| 后台路由模拟 | `POST /admin/capabilities/:id/simulate` | 展示每条候选线路的入选/排除原因 |

### 3.2 建任务与预留

```text
请求进入
  ↓
身份 / 能力 / 输入素材归属 / 参数白名单
  ↓
把前台参数归一成 ModelRequestIntent
  ↓
按能力 + 模型分组解析候选线路
  ↓
选价格档，计算能力售价和成本快照
  ↓
同一事务：创建 GenerationTask + BillingOrder + 余额预留
  ↓
返回 taskId、traceId、状态和展示价格
```

这一步的硬约束：

- 路由解析、价格解析和任务快照必须来自同一次目录快照。
- 供应侧字段必须快照到任务和账单；后台后续停用、改价或换线路不能改变已建任务的事实。
- 幂等键命中时返回原任务，不能再次预留积分。
- 任务创建成功后，前台只依赖 `taskId` 和状态查询，不依赖 worker 的内存状态。

### 3.3 Worker 执行和网关派发

```text
queued
  │ CAS 领取并写 lease
  ▼
running
  │ 创建 selected / not_sent 的 RouteAttempt
  ▼
prepare(channelModelId)
  │ 读取渠道与渠道模型、校验启停、解密凭证、加载协议
  ▼
协议 buildCreate
  │ 生成统一的 ProtocolRequestSpec
  ▼
出站层发送
  │ 记录 request/response/bytes/status/duration
  ▼
解析 create
  ├─ 同步成功 → 结果落盘 → 结算
  ├─ 异步 accepted → 写 providerRequestId → 等待 poll
  ├─ 明确未接单 → 安全切线
  └─ 结果不明 → 停止重发，进入 uncertain / 人工核对
```

异步轮询必须继续使用同一任务、同一 `RouteAttempt` 和同一 `providerRequestId`。轮询请求可以有多条 `ApiCallLog`，但不能被误识别成新的生成任务或新的路由尝试。

### 3.4 结果和计费

```text
成功：下载/校验/持久化媒体 → 写产物 → 读取 usage → settle
明确未发送失败：切线；没有可用线路时全额退款
结果不明：账单 uncertain；禁止自动切线；人工 settle/refund
产物回收失败：保留上游结果快照，重试回收，不重新派发
```

## 4. 路由模型

### 4.1 候选线路组成

一条候选线路必须同时满足：

1. 能力绑定启用。
2. 渠道模型启用，所属渠道启用且未删除。
3. 协议已注册、已启用，并声明支持该能力。
4. 渠道模型能力合同匹配当前意图。
5. 用户分组可见，模型分组匹配用户选择。
6. 不在本次任务已经失败的线路集合中。
7. 未被进程内健康冷却阻断，且权重为正。

### 4.2 选择顺序

```text
用户选中的模型分组
        ↓ 组内优先
健康分层（健康线路优先）
        ↓
手工 priority
        ↓
同层 weight 加权随机
```

选路必须输出一个 `RoutedModel` 快照，至少包括：能力、模型分组、渠道模型、渠道、协议、目录版本、能力合同、价格快照和本次意图。下游不得再次用 `modelKey` 反查并替换这些字段。

### 4.3 故障切换判定

| 结果 | 是否切线 | 原因 |
| --- | --- | --- |
| 协议未注册、渠道停用、模型停用、凭证缺失 | 是 | 请求未发送 |
| 401 / 403 / 404 / 429 | 是 | 上游明确拒绝；按错误类型冷却 |
| DNS、代理、连接拒绝、网络不可达 | 是 | 建连前失败 |
| 5xx、超时、连接中断、响应解析失败 | 否 | 上游可能已经受理 |
| 异步任务轮询超时 | 否 | 已经存在上游任务 |

切线只改变当前任务的渠道模型和账单供应快照，不改变用户选择的模型分组、能力售价和任务的业务身份。

## 5. 模型配置体系

配置应该按“从协议到可售模型”的顺序组织，而不是把所有字段堆在一个模型表单中。

### 5.1 配置层级

```text
插件 / 协议
  ↓
供应商
  ↓
渠道连接（账号 / Base URL / 区域 / 代理 / 并发）
  ↓
渠道模型（上游 SKU / 能力 / 协议 / 合同）
  ↓
价格档（规格选择器 / 上游 SKU / 成本 / 售价）
  ↓
能力绑定（可售能力 / priority / weight）
  ↓
用户分组可见范围
  ↓
路由健康和运行策略
```

### 5.2 当前后台页面映射

| 操作人员要做的事 | 页面 | 关键结果 |
| --- | --- | --- |
| 启用 OpenAI 等协议 | `/admin/plugins` | 协议进入注册表 |
| 配置账号、地址、密钥、代理、并发 | `/admin/channels` | 形成可访问渠道 |
| 同步或手工添加上游 SKU | `/admin/channels` | 形成渠道模型 |
| 配置图像能力合同和规格 | `/admin/channels` | 模型能够匹配请求意图 |
| 配置成本档和价格档 | `/admin/channels` | 可计算成本和供应侧价格 |
| 把模型发布到生图能力 | `/admin/capabilities` | 形成候选池 |
| 调整主备、灰度比例 | `/admin/capabilities` | 修改 priority / weight |
| 验证具体请求会走哪条线 | `/admin/capabilities` | 路由模拟结果可解释 |
| 查看每次实际调用 | `/admin/model-calls` | 定位到任务、线路和上游请求 |
| 处理未知结果和费用 | `/admin/billing-orders` | 人工 settle / refund |

### 5.3 建议增加的供应商维度

当前 `ModelChannel` 更接近“供应商连接实例”，但产品文案里经常把它叫供应商，容易导致以下问题：同一供应商的多个账号无法聚合统计、渠道名称变化会改变供应商口径、插件 vendor 被误认为真实供应商。

建议新增一个轻量的供应商主数据概念：

```text
ModelSupplier
  id / code / displayName / icon / enabled

ModelChannel
  supplierId / name / accountLabel / baseUrl / credentials / proxy / concurrency

ChannelModel
  channelId / providerModelKey / modelGroupKey / capability / protocol
```

插件的 `vendor` 只表示协议或插件作者，不替代 `ModelSupplier`。迁移时可先用 `catalogProviderId` 或人工映射填充，不能把目录来源直接当成真实供应商事实。

## 6. 数据可追溯方案

### 6.1 追踪标识的分工

| 标识 | 生命周期 | 用途 |
| --- | --- | --- |
| `traceId` | 一次前台提交 / 一批关联任务 | 串起一次业务调用链，跨 HTTP、worker、轮询持续存在 |
| `requestId` | 一次 HTTP 请求 | 定位一次前端请求或后台操作 |
| `taskId` | 一张生成任务 | 生成、重试、产物和账单的业务主体 |
| `routeAttemptId` | 一次任务在一条线路上的尝试 | 区分首选线路、切线线路和恢复执行 |
| `providerRequestId` | 上游接收后的任务号 | 在供应商侧反查真实任务 |
| `billingOrderId` | 一次平台计费事实 | 关联预留、结算、退款和用量 |
| `apiCallLogId` | 一次 HTTP 调用 | 关联 create、poll、result、cancel 等物理请求 |

推荐查询路径：

```text
traceId
  └─ GenerationTask
      ├─ BillingOrder
      └─ RouteAttempt
          └─ ApiCallLog
              └─ providerRequestId
                  └─ 上游控制台 / 供应商查询
```

### 6.2 当前实现的追踪缺口

当前表已经有 `ApiCallLog.traceId`、`ApiCallLog.requestId`、`GenerationTask.taskId`、`RouteAttempt` 和 `providerRequestId`，但任务执行日志目前没有稳定地从任务快照写入 `traceId`，`RouteAttempt` 也还没有 `traceId` / `routeAttemptId` 关联字段。异步任务执行时不能再依赖原始 HTTP 的 AsyncLocalStorage；如果不把入口请求的标识写入任务，worker 后续的 create/poll 调用就无法完整串链。

### 6.3 建议的数据补强

第一阶段只补最小必要字段：

```text
GenerationTask
  traceId                  // 建任务时从请求上下文快照
  admissionRequestId       // 建任务对应的入口 requestId

ApiCallLog
  routeAttemptId            // 精确归属某次线路尝试
  phase                    // upload/create/poll/result/cancel/agent/proxy
  traceId                  // 任务调用使用 task.traceId；同步中转使用当前上下文
  attemptNumber / routeRun  // 查询和排序更直接
```

第二阶段补“为什么这样选”和“当时配置是什么”：

```text
RouteAttempt
  selectionSnapshotJson     // 候选数、健康层、priority、weight、目录版本、排除原因摘要
  channelSnapshotJson       // 不含密钥的渠道 / 渠道模型 / 协议元数据快照

ModelConfigAudit
  entityType / entityId / action / beforeJson / afterJson
  actorId / reason / traceId / occurredAt
```

规则：

- 任何快照和审计都不得包含 API Key、Secret Key、签名头或解密后的自定义头。
- `ApiCallLog` 只记录“实际发生过的调用”；路由模拟和候选排除记录在 `selectionSnapshotJson` 或独立诊断结果中，不能伪装成上游调用。
- 任务、尝试、调用、账单使用同一条链路标识，但各自保留自己的状态机，不能用一张日志表替代状态事实。
- 配置更新必须追加审计记录；更新后的运行时目录版本用于判断快照是否需要刷新。

### 6.4 后台追踪页

建议新增统一入口：`/admin/model-traces/:traceId`，从任务详情、调用记录、账单和失败提示都可以进入。

页面按时间线展示：

```text
提交请求
  → 能力 / 意图 / 模型分组
  → 路由候选与选中原因
  → 任务与预留账单
  → attempt #1 / channel A / create
  → 401 / rejected_no_job
  → attempt #2 / channel B / create
  → providerRequestId
  → poll × N
  → 媒体落盘
  → 结算 / 退款 / uncertain
```

每个节点都应显示稳定 ID、状态、时间、耗时、供应商/渠道/渠道模型、协议、错误码和下一步链接；凭证与敏感请求头永不展示。

## 7. 模型网关能力清单

### 必须具备

1. 统一请求合同：能力、模型分组、意图、素材、输出选项、幂等键。
2. 能力合同匹配：尺寸、质量、比例、输入数量、操作类型等参数校验。
3. 路由候选池：绑定、启停、分组可见、健康、priority、weight。
4. 协议适配：JSON、表单、multipart、二进制、同步、异步和轮询。
5. 凭证隔离：数据库密文、运行时解密、绝不进入任务快照和调用报文。
6. 出站安全：SSRF 防护、代理、超时、体积上限、私网规则和错误分类。
7. 故障语义：明确未发送可切线，可能已发送必须进入结果不明。
8. 媒体处理：临时 URL / 内联数据 / 上游二进制的下载、魔数校验和持久化。
9. 并发和租约：用户、渠道、进程执行位和任务恢复。
10. 计费衔接：预留、Token/按秒用量、结算、退款和人工核对。
11. 可观测性：trace、task、attempt、provider request、billing、HTTP 调用完整关联。
12. 运维工具：协议校验、渠道连通性测试、路由模拟、健康重置和配置审计。

### 不应放进模型网关

- 生图页面的业务表单和文案。
- 具体业务能力的提示词拼接规则。
- 供应商价格策略的运营决策。
- API Key 的前端管理或明文导出。
- 用“换一家供应商”掩盖结果不明。
- 以模型名猜协议、以协议名猜供应商。

## 8. 实施顺序

### P0：术语和运行事实冻结

- 将后台文案统一为“供应商 / 渠道 / 渠道模型 / 模型分组 / 线路”。
- 在接口和日志中明确 `modelKey` 是分组键，`providerModelKey` 是上游键。
- 清理仍引用 `LogicalModel` 的文档和测试说明，保留历史迁移说明。

### P1：补齐异步链路追踪

- `GenerationTask` 写入 `traceId` 和入口 `requestId`。
- `ApiCallLog` 写入 `traceId`、`routeAttemptId`、`phase`、`routeRun`、`attemptNumber`。
- worker、poll、媒体恢复和账单结算全部沿用任务快照中的 trace。
- 增加“按 trace 查看任务 → 尝试 → 调用 → 账单”的后台查询接口。

### P2：配置可解释性和审计

- 路由尝试持久化选路快照和非敏感渠道快照。
- 新增模型配置审计记录，记录操作者、前后值、原因和关联 trace。
- 后台路由模拟和真实运行共用一套候选判定函数，避免“模拟选 A、实际选 B”。

### P3：供应商主数据和渠道工作台收敛

- 引入供应商主数据，渠道变成供应商下的连接实例。
- 渠道工作台按“连接 → 同步模型 → 配合同合同 → 绑定能力 → 模拟路由”分步呈现。
- 供应商级健康、成本、成功率和用量聚合，渠道级保留账号和出口排障能力。

### P4：网关运营闭环

- 统一 trace 详情页。
- 失败码、切线、结果不明、计费状态建立可操作的后台筛选。
- 增加配置发布前检查：协议、凭证、能力合同、价格档、绑定、用户可见性和健康线路。
- 用仿真上游覆盖同步成功、异步轮询、401 切线、429 冷却、超时 uncertain、媒体回收失败等链路。

## 9. 验收标准

### 配置验收

- 新增一个 OpenAI 图像渠道，能够完成：协议启用 → 渠道配置 → 模型同步 → 能力绑定 → 路由模拟 → 前台目录出现。
- 同一供应商配置两个渠道时，前台只出现一个模型分组，后台可以分别控制两条线路。
- 停用协议、渠道、渠道模型、能力绑定中的任意一层，路由模拟都能说明具体阻断原因。

### 运行验收

- 一次生图可以从 `traceId` 查到 task、billing、route attempt、create/poll 调用和 provider request id。
- 401 / 404 / 429 能安全切线，且每次尝试分别记录；超时和 5xx 不自动重发。
- 轮询不会产生新的 task 或 route attempt；媒体下载失败不会重新创建上游任务。
- 账单状态和任务状态可以独立解释；任务用 `failed + stage=uncertain`，账单用 `uncertain`，并记录人工处置人和原因。

### 安全验收

- 任何 trace、审计、调用详情、导出都不包含 API Key、Secret Key 和鉴权头。
- 客户端传入模型名不能绕过能力绑定、用户分组或渠道启停。
- 所有模型上游请求统一通过出站模块，插件和业务能力不能直接发网络请求。

## 10. 细化为可实施规格

本节把前面的架构原则固定成开发时可以直接对照的接口、状态和验收规则。除非特别标注“新增”，字段名沿用当前代码中的名称。

### 10.1 关键不变量

以下规则是跨模块的接口契约，不应由某个页面或单个调用方自行解释：

1. 前台只提交 `capability`、`modelKey`、统一意图、输入素材和幂等键；前台不能指定 `channelId`、`channelModelId`、`providerModelKey`、协议或价格。
2. `modelKey` 在生成链路中表示模型分组键；`providerModelKey` 只允许出现在供应侧和上游请求中。
3. 路由只返回一次 `RoutedModel`；任务、账单和第一次 `RouteAttempt` 必须使用同一结果，不能下游重新按模型名查线路。
4. 所有供应侧字段在任务创建或线路切换时快照；历史任务不读取当前配置来“刷新”已经发生的事实。
5. `RouteAttempt` 表示一次线路尝试，`ApiCallLog` 表示一次物理 HTTP 调用；一次异步尝试可以有一个 create 和多个 poll，但不能因此产生多个任务或多个线路尝试。
6. 只有能够证明请求没有被上游接收的失败才允许自动切线；请求已写出但结果未知时必须停止自动重发。
7. 任务状态、尝试状态、调用状态和账单状态分别维护；任何一个状态不能通过推断另一个状态来替代。
8. 配置保存与配置发布分离：保存可以保留未完成配置，只有发布检查通过的配置才能进入前台目录。

### 10.2 领域对象关系

```text
ModelSupplier（建议 P3 引入）
  └─< ModelChannel
       └─< ChannelModel
            └─< ChannelModelPriceTier

CapabilityDefinition
  └─< CapabilityModelBinding >─ ChannelModel

Capability + modelKey + intent
  └─ RouterService
       └─ RoutedModel
            └─ GenerationTask
                 ├─ BillingOrder
                 ├─ RouteAttempt × N
                 │    └─ ApiCallLog × N
                 └─ Asset × N
```

P3 之前不强制新增 `ModelSupplier` 表。可以先在 `ModelChannel` 增加 `supplierCode` / `accountLabel` 的展示字段，但不能把插件的 `vendor` 或渠道 `name` 当成稳定供应商主键。

### 10.3 API 契约

#### 前台目录

```ts
type ModelIntent = {
  capability: string;              // 产品能力，如 main_image
  modelKey?: string;               // 模型分组键；为空表示默认模型
  operation?: string;              // text_to_image / image_to_image
  inputs?: { image?: number; video?: number };
  options?: Record<string, unknown>; // size / quality / ratio / duration
};

GET /models?capability=main_image
→ { models: ModelGroup[] }

POST /models/available
body: ModelIntent
→ { models: Array<ModelGroup & { available: true }> }

POST /models/quote
body: ModelIntent
→ { quote: {
     capability, modelKey, billingMode,
     amountMicrocredits, currency,
     intent, catalogVersion
   } | null }
```

目录响应不能下发 `channelId`、`channelModelId`、`providerModelKey`、Base URL 或供应商密钥。后台供应视图可以显示渠道信息，但必须和前台目录使用不同的响应类型。

#### 生成提交

```ts
POST /generate
headers:
  Idempotency-Key: string
body: {
  projectId: string;
  capability: string;
  modelKey?: string;
  inputAssetIds: string[];
  params: Record<string, unknown>;
}
→ {
     taskId: string;
     traceId: string;
     status: 'queued';
     modelKey: string;
     creditCost: number;
     billingOrderId?: string;
   }
```

当前实现已经支持 `taskId`、`status`、`creditCost` 和幂等返回，但 `AdmissionResult` 尚未返回 `traceId` / `billingOrderId`；服务端也尚未把入口请求标识快照到 `GenerationTask`。实施 M1 时再补齐这两个返回字段。服务端必须从 `X-Request-Id` / `requestContext` 生成或取得 `traceId`，不能由前台指定供应侧追踪字段。`Idempotency-Key` 的重复请求必须返回同一个任务，不得二次预留。

#### 后台路由模拟

```ts
POST /admin/capabilities/:capabilityId/simulate
body: {
  modelKey?: string;
  inputs?: unknown;
  options?: Record<string, unknown>;
}
→ {
     selectedChannelModelId: string;
     selectedModelKey: string;
     candidates: number;
     groups: Array<{
       modelKey: string;
       lines: Array<{
         channelModelId: string;
         channelId: string;
         enabled: boolean;
         channelEnabled: boolean;
         groupVisible: boolean;
         capabilityMatched: boolean;
         healthTier: number;
         priority: number;
         weight: number;
         eligible: boolean;
         matchReasons: string[];
       }>;
     }>;
   }
```

模拟结果的每个 `matchReasons` 必须来自运行时实际使用的候选判定函数；不允许页面自己根据几个启停字段拼接“看起来合理”的原因。

#### 追踪查询（新增）

```text
GET /admin/model-traces/:traceId
GET /admin/model-traces?taskId=&providerRequestId=&billingOrderId=&status=&from=&to=
```

返回按时间排序的聚合视图：`trace`、入口请求、任务、模型分组、路由决策、路由尝试、调用、上游任务号、产物、账单和人工处理记录。详情接口可以返回脱敏后的请求/响应预览，但不能返回鉴权头。

### 10.4 数据库补强字段

#### `GenerationTask`（新增字段）

当前实现已经有 `modelKey`、`channelModelId`、`channelId`、`routeRun`、`providerRequestId` 等供应侧字段；下表只列追踪和展示快照新增项。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `traceId` | `String` | 一次前台提交或批次的稳定链路标识，必填；历史数据允许空串 |
| `admissionRequestId` | `String` | 创建任务的入口 HTTP 请求标识，异步 worker 不可重新读取入口上下文 |
| `modelDisplayName` | `String` | 建任务时的前台展示名快照，避免模型改名后历史任务变名 |
| `protocol` | `String` | 首次选中的协议快照，便于快速排障 |
| `providerModelKey` | `String` | 首次派发线路的上游模型键快照，不向 C 端下发 |
| `catalogVersion` | `Int` | 路由解析时的目录版本 |

已有的 `modelKey`、`channelModelId`、`channelId`、`routeRun` 继续保留；发生切线时只更新“当前线路”字段，历史线路必须从 `RouteAttempt` 查询。

#### `RouteAttempt`（新增）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `traceId` | `String` | 与任务相同，便于无 join 查询 |
| `selectionSnapshotJson` | `String` | 本次选路的非敏感摘要：候选数、分组、健康层、priority、weight、目录版本 |
| `channelSnapshotJson` | `String` | 渠道、渠道模型、协议和上游键快照；不含密钥 |
| `failurePhase` | `String` | `admission` / `prepare` / `create` / `poll` / `result` / `settle` |
| `switchedFromAttemptId` | `String` | 切线来源尝试；首选线路为空串 |

#### `ApiCallLog`（新增）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `traceId` | `String` | 任务调用取任务快照；同步中转取当前入口请求上下文 |
| `routeAttemptId` | `String` | 精确归属一次线路尝试；渠道级 GET 可为空串 |
| `phase` | `String` | `upload` / `create` / `poll` / `result` / `cancel` / `agent` / `proxy` |
| `routeRun` | `Int` | 手动重试轮次 |
| `attemptNumber` | `Int` | 当前轮次的线路尝试序号 |
| `requestSent` | `Boolean` | 是否进入实际出站发送阶段 |
| `safeToRetry` | `Boolean` | 平台根据证据计算的切线安全标记 |

日志表仍然只允许追加；调用落库失败不能伪造成功状态，Token 结算需要把“调用日志缺失”视为不可安全结算。

### 10.5 状态机和迁移矩阵

#### 任务状态

当前实现的任务状态没有独立的 `uncertain` 枚举值。结果不明使用 `status=failed`、`errorCode=42206`、`stage=uncertain` 表达；真正的资金不确定状态在 `BillingOrder.status=uncertain`。这是刻意把“任务是否继续执行”和“账单是否可以结算”分开，后续不要擅自把两者合并成一个状态。

```text
queued → running → succeeded
                 ├→ failed（明确失败）
                 ├→ failed + stage=uncertain（结果不明）
                 └→ cancelled
```

允许迁移：

| 当前 | 下一状态 | 触发条件 |
| --- | --- | --- |
| `queued` | `running` | worker 租约 CAS 成功 |
| `queued` | `cancelled` | 尚未派发时人工取消 |
| `running` | `succeeded` | 产物持久化和结算完成 |
| `running` | `failed` | 明确未接单、所有线路耗尽或本地恢复失败 |
| `running` | `failed + stage=uncertain` | 上游可能已接收但平台无法确认结果；同时账单转 `uncertain` |
| `running` | `cancelled` | 已确认取消且不再执行 |
| `failed + stage=uncertain` | 不直接恢复执行 | 人工处理的是账单和上游事实，不重新派发原任务 |

不允许 `failed → running` 原地复活；后台重试必须新建任务并通过 `retriedFromId` 关联。

#### 路由尝试状态

```text
selected → dispatching → accepted → succeeded
       └→ rejected_no_job →（创建下一条尝试或终止）
       └→ submission_unknown → uncertain
accepted → failed / uncertain
```

关键区别：`status=failed` 不能单独证明可以切线，必须同时看 `dispatchState`。`submission_unknown` 是禁止自动重发的保护状态。

#### 账单状态

```text
reserved → running → settled
                   ├→ refunded
                   └→ uncertain → settled / refunded
```

线路切换产生新账单或供应侧快照时，旧账单使用 `refundReason=route_switch`，不能计入真实退款统计。

### 10.6 一次生图的时序

```text
Browser                API / Admission       Catalog / Router       Worker / Gateway       Supplier
   │                         │                     │                      │                  │
   │ POST /models/available  │                     │                      │                  │
   │────────────────────────>│                     │                      │                  │
   │                         │────────────────────>│                      │                  │
   │<────────────────────────│  model groups      │                      │                  │
   │                         │                     │                      │                  │
   │ POST /generate          │                     │                      │                  │
   │────────────────────────>│ validate + intent  │                      │                  │
   │                         │────────────────────>│ resolve RoutedModel  │                  │
   │                         │<────────────────────│                      │                  │
   │                         │ reserve + create task                     │                  │
   │<────────────────────────│ taskId + traceId    │                      │                  │
   │                         │                     │                      │                  │
   │                         │                     │       claim task      │                  │
   │                         │                     │                      │                  │
   │                         │                     │                      │ prepare channel │
   │                         │                     │                      │─────────────────>│
   │                         │                     │                      │ build + send    │
   │                         │                     │                      │─────────────────>│
   │                         │                     │                      │<─────────────────│
   │                         │                     │                      │ log create      │
   │                         │                     │                      │                  │
   │ GET /tasks/:id          │                     │                      │                  │
   │────────────────────────>│                     │                      │                  │
   │<────────────────────────│ status / assets    │                      │                  │
```

异步供应商在 create 返回 `providerRequestId` 后，worker 释放执行槽并等待 `nextPollAt`；每次 poll 都写 `ApiCallLog.phase=poll`，但不创建新 `RouteAttempt`。

### 10.7 后台配置流程

#### 阶段一：协议准备

1. 插件清单通过 manifest 校验。
2. 插件启用，协议进入 `ProtocolRegistry`。
3. 后台协议目录显示协议能力、鉴权要求、同步/异步、上传和轮询能力。

#### 阶段二：渠道连接

1. 选择供应商（当前可先填写供应商名称，P3 再主数据化）。
2. 填写渠道名称、Base URL、API Key、Secret Key、代理和并发上限。
3. 服务端校验 URL、协议要求、凭证字段和私网策略。
4. 保存为草稿；凭证只存密文，页面只显示“已配置”。
5. 点击“测试连接”时必须显示实际测试协议、模型键、耗时和结果，并写调用记录；测试失败不自动发布。

#### 阶段三：渠道模型

1. 从上游拉取模型或手工录入模型。
2. 设置本站模型键 `modelKey`、前台分组键 `modelGroupKey` 和上游模型键 `providerModelKey`。
3. 选择协议；协议能力必须覆盖渠道模型能力。
4. 配置能力合同：操作、输入素材数、尺寸/比例/质量等参数。
5. 配置价格档：选择器、上游 SKU、成本价、售价和启用状态。
6. 通过“模型可运行检查”：渠道启用、协议已注册、合同合法、至少一个有效价格档（按业务要求）、凭证完整。

#### 阶段四：能力发布

1. 把渠道模型绑定到 `main_image` / `detail_image` 等能力。
2. 设置 `priority` 和 `weight`。
3. 用真实意图执行路由模拟，查看每条线路为什么入选或排除。
4. 点击发布；发布后递增目录版本并失效本地快照。
5. 前台目录确认模型分组出现，再进行真实生成验收。

### 10.8 配置发布检查

发布前统一返回结构化检查结果，不要只返回第一条错误：

```ts
type PublishCheck = {
  ok: boolean;
  blocking: Array<{
    code: string;
    path: string;
    message: string;
  }>;
  warnings: Array<{
    code: string;
    path: string;
    message: string;
  }>;
};
```

最低检查项：

| 检查 | 阻断条件 | 示例错误码 |
| --- | --- | --- |
| 协议 | 未注册、已停用或不支持该能力 | `protocol_unavailable` |
| 渠道 | 删除、停用、Base URL 无效 | `channel_unavailable` |
| 凭证 | 声明必填字段未配置 | `credential_missing` |
| 模型合同 | capability / operation / 参数声明非法 | `capability_contract_invalid` |
| 价格档 | 没有启用且完整的有效档位 | `price_tier_missing` |
| 能力绑定 | 绑定能力不存在或已下线 | `capability_unavailable` |
| 用户可见性 | 所有分组均不可见 | `visibility_empty` |
| 健康 | 最近连续失败且无可用备用线路 | warning；不默认阻断 |

### 10.9 追踪详情页查询模型

页面不应该直接拼接 8 张表；后端提供一个只读聚合投影：

```ts
type ModelTraceView = {
  traceId: string;
  entry: {
    requestId: string;
    userId: string;
    source: 'generate' | 'proxy' | 'admin-test' | 'worker';
    createdAt: string;
  };
  tasks: Array<{
    taskId: string;
    status: string;
    capability: string;
    modelKey: string;
    channelModelId: string;
    channelId: string;
    routeRun: number;
    createdAt: string;
  }>;
  attempts: Array<{
    id: string;
    taskId: string;
    routeRun: number;
    attemptNumber: number;
    channelName: string;
    modelKey: string;
    providerModelKey: string;
    status: string;
    dispatchState: string;
    providerRequestId: string;
    failureCode: string;
    startedAt: string;
    completedAt?: string;
  }>;
  calls: Array<{
    id: string;
    routeAttemptId: string;
    phase: string;
    method: string;
    path: string;
    status: string;
    statusCode: number;
    durationMs: number;
    providerRequestId: string;
    safeToRetry: boolean;
    createdAt: string;
  }>;
  billing: Array<{
    id: string;
    status: string;
    amountMicrocredits: number;
    actualAmountMicrocredits: number;
    refundReason: string;
    updatedAt: string;
  }>;
};
```

列表接口先只返回摘要和分页游标；详情接口才返回脱敏后的报文预览。查询条件优先使用 `traceId`、`taskId`、`providerRequestId`、`billingOrderId`，不要允许用任意上游 URL 做模糊全文搜索。

### 10.10 失败场景处理表

| 场景 | RouteAttempt | Task | BillingOrder | 用户看到的结果 |
| --- | --- | --- | --- | --- |
| 协议未注册 | `failed / rejected_no_job` | 继续切线或失败 | 原单退款 | 当前线路不可用 |
| 渠道停用 | `failed / rejected_no_job` | 继续切线或失败 | 原单退款 | 当前线路不可用 |
| 上游 401 | `failed / rejected_no_job` | 冷却后切线 | 原单转线路切换退款 | 已切换备用线路 |
| 上游 429 | `failed / rejected_no_job` | 按 Retry-After 冷却并切线 | 原单转线路切换退款 | 已切换备用线路 |
| 上游 5xx | `failed / submission_unknown` | `failed + stage=uncertain` | `uncertain` | 正在核对结果 |
| 上游超时 | `failed / submission_unknown` | `failed + stage=uncertain` | `uncertain` | 正在核对结果 |
| 轮询超时 | `failed / submission_unknown` | `failed + stage=uncertain` | `uncertain` | 正在核对结果 |
| 媒体下载失败 | attempt 保持 accepted | running / recover | 不变 | 正在补交付 |
| 结果落盘成功但结算失败 | attempt succeeded | succeeded 或待结算告警 | `uncertain` | 作品可见，账单待处理 |

表中的“用户看到的结果”是产品层文案，不等于内部错误码；内部必须保留错误码、上游状态、是否已发送和是否可安全重试。

### 10.11 开发任务拆分

#### M1：追踪基础

- Prisma 增加任务 `traceId` / `admissionRequestId`。
- 建任务时快照 `currentRequestId()`，生成批次子任务继承同一 `traceId`。
- worker 读任务快照，不依赖 AsyncLocalStorage。
- 增加 trace 查询聚合模块和只读接口。

#### M2：调用归属

- `RouteAttempt` 增加 `traceId` 和快照字段。
- `TaskExecutorService.logCall()` 增加 `routeAttemptId`、`phase`、轮次和尝试号。
- create、poll、result、upload、cancel 统一写 phase。
- 中转调用 phase 固定为 `proxy`，没有 routeAttempt 时写空串。

#### M3：配置发布检查

- 提取 `PublishCheckService`，后台发布和真实路由共用检查函数。
- 返回全部 blocking / warning，不让前端按错误字符串猜逻辑。
- 发布成功才递增 `RouteCatalogVersion`；草稿编辑不影响正在运行任务。

#### M4：后台工作台

- 渠道页增加供应商、连接状态、模型状态、绑定能力和发布状态列。
- 模型页增加“上游键 / 前台分组键”明确分栏。
- 能力页增加路由模拟、发布前检查和线路影响面。
- 调用记录、账单和任务详情互相提供深链。

#### M5：测试和迁移

- 新增同步生图、异步轮询、401 切线、429 切线、5xx uncertain、媒体回收失败的端到端测试。
- 给旧任务的新增字段提供空值兼容；新建任务强制写入。
- 运行期确认所有上游 HTTP 仍只能经过 `outbound`。

### 10.12 最小可交付版本（MVP）

如果要控制第一期范围，建议只做以下六项：

1. `GenerationTask.traceId` 和 `admissionRequestId`。
2. `RouteAttempt` 与 `ApiCallLog` 的精确关联。
3. `/admin/model-traces/:traceId` 只读详情。
4. 生图渠道配置的发布前检查。
5. 后台模型字段明确区分 `modelKey` / `modelGroupKey` / `providerModelKey`。
6. 端到端验证一条 OpenAI 生图线路及一条备用线路。

暂不在 MVP 做：供应商主数据、跨供应商成本中心、复杂灰度发布、多实例分布式冷却、事件总线和完整配置版本回滚。这些都会扩大迁移面，但不影响先把数据流追踪闭环。
