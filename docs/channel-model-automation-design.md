# 模型渠道能力重构实现方案（去掉前台模型层）

> 状态：已实施（2026-11-13）：前台模型三层已删除，`CapabilityModelBinding` / `CapabilityPricing` / 能力目录选路 / 后台能力绑定页已落地；单元、集成、构建与真实仿真网关链路验证通过。
> 日期：2026-11-12
> 决策：删除 `LogicalModel` / `LogicalModelRevision` / `LogicalModelRoute` 三层；渠道模型（商品）即售卖供给，通过「能力 ↔ 渠道模型」绑定直接对 C 端提供模型选项；同能力内跨模型、跨渠道自动切换。
> 关联：`docs/model-architecture.md`、`docs/channel-model-design.md`、`docs/api-contract.md`、`docs/testing.md`、`CLAUDE.md`

## 1. 范围

### 1.1 现状问题

当前模型层是四层：`ModelChannel` → `ChannelModel`（商品）→ `LogicalModel`（按 C 端能力建的售卖单元）→ `LogicalModelRevision` + `LogicalModelRoute`。供应与售卖被拆成两套事实：

1. **配置重复**：每个上游模型先建商品，再按能力手建前台模型，再逐条挑线路、配 `priority` / `weight`；同一批模型服务多个能力时重复多轮。
2. **候选池被人为截断**：选路只读当前前台模型 revision 下的线路（`route-catalog.service.ts`），没有绑定进来的同能力商品永远不参与。
3. **模型身份与供应线路耦合**：C 端选的是 `logicalModelId`，一个售卖身份背后挂若干线路；新增渠道模型必须回头改前台模型，否则模型不可售。
4. **两套能力合同**：渠道模型有 `capabilityConfigJson`，前台模型 revision 又存一份 `capabilitySpecJson`，两份合同漂移时表现为「商品能测、售卖不能生成」。
5. **两套价格口径**：前台模型支持 `unified` / `channel`，渠道价格档又维护成本与售价；展示价与实扣价容易分叉。
6. **新增渠道无法闭环**：拉取、导入、定价、上架、绑定能力分散在渠道与能力两个页面。

### 1.2 本方案做

- 删除前台模型三层，渠道模型直接作为售卖供给。
- 用 `CapabilityModelBinding` 表达「某能力可以使用哪些商品」，这是唯一的售卖方配置。
- C 端按「能力 + 模型标识」选模型；模型标识是读取时按 `modelGroupKey` 聚合出来的展示分组，不落表。
- 同能力候选池覆盖全部已绑定商品，按健康度分层、可跨模型跨渠道自动切换。
- 售价收口到能力级（`CapabilityPricing` + `CreditPriceService`），渠道价格档只保留成本。
- 渠道导入时一次完成「建商品 + 识别能力 + 绑能力」。

### 1.3 本方案不做

- 不保留 `LogicalModel` 的任何兼容层、别名或双写。
- 不改变失败判定：只有 `rejected_no_job` 切线；超时、5xx、建连后中断判 `42206`，不切线、不自动退款（`docs/model-architecture.md`）。
- 不改变冷却键与时长：401/403 冷却渠道 10 分钟，404 冷却渠道模型 10 分钟，429 按 `Retry-After` 或 30 秒。
- 不改变钱包、预留、结算、退款与积分批次规则。
- 不做跨能力、跨模态兜底（图像失败不退到视频）。
- 不引入 Redis：健康分层用进程内缓存 + 30 秒 TTL，多实例各自判定。

## 2. 目标形态

### 2.1 三个动作

```
配渠道（凭证 / 端点 / 代理 / 并发）
   ↓
选模型（拉取上游目录 → 勾选 → 识别模态与可承接能力 → 绑到能力）
   ↓
自动售卖与切换（能力候选池 → 健康分层 → 失败切线）
```

### 2.2 实体收敛

| 旧实体 | 处理 | 新归属 |
| --- | --- | --- |
| `ModelChannel` | 保留 | 供应来源与凭证 |
| `ChannelModel` | 保留 | 可售商品：模态、协议、能力合同、成本档、启停 |
| `ChannelModelPriceTier` | 保留但改口径 | 只保留成本（`cost*`）；售价移到能力级 |
| `LogicalModel` | 删除 | 能力定义 + `CapabilityPricing` |
| `LogicalModelRevision` | 删除 | 能力定义即合同 |
| `LogicalModelRoute` | 删除 | `CapabilityModelBinding` 即候选池 |
| `RouteAttempt` | 改列 | 记录实际尝试的 `channelModelId` / `channelId` |

### 2.3 两个关键决策

**决策一：模型分组只读派生，不建表。**

C 端看到的「模型」是同一能力下、`modelGroupKey` 相同的渠道模型集合。`modelGroupKey` 为空时取 `modelKey`，因此同一上游模型挂在多条渠道时只有一个 C 端选项，底层自动切换。分组不需要主键、不需要 revision、不需要发布流程。

**决策二：售价按能力统一，渠道价格档只记成本。**

去掉前台模型后，`unified` / `channel` 双价格策略失去承载点。若继续按渠道售价计费，自动切换会让同一次操作在不同线路下价格不同，报价与实扣必然分叉。因此：

- 一个能力只有一个对外售价（固定价或 Token 价），由 `CapabilityPricing` 维护；
- 运行时仍由 `CreditPriceService` 解析覆盖价、分组倍率、货币换算与限时免费，保持「运行期生效积分价」单一事实源；
- 渠道价格档的 `cost*` 用于成本快照与毛利，`sale*` 不再参与计费与展示，按 P4 清理；
- 自动切换不改变用户应付金额，因此不需要替换账单。

如果产品后续需要「同一个能力按模型分级定价」，应新增独立的分级价表，而不是恢复前台模型层。

## 3. 数据模型

### 3.1 删除

```prisma
// 整表删除
LogicalModel
LogicalModelRevision
LogicalModelRoute
```

`GenerationTask` / `RouteAttempt` / `BillingOrder` 上对应的 `logicalModelId`、`logicalModelRevisionId`、`routeId`、`pricePolicy` 一并删除。

### 3.2 新增：能力 ↔ 商品绑定

```prisma
/// 能力候选池：某 C 端能力允许使用哪些渠道模型。
/// 既是后台的「选模型」结果，也是运行时唯一的候选来源。
model CapabilityModelBinding {
  id             String  @id @default(cuid())
  /// C 端能力 id：free_create / main_image / ...
  capabilityId   String
  channelModelId String
  enabled        Boolean @default(true)
  /// 手工分层：数字越小越优先；自动健康分层在此基础上叠加
  priority       Int     @default(0)
  /// 同层加权随机
  weight         Int     @default(100)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([capabilityId, channelModelId])
  @@index([capabilityId, enabled])
  @@index([channelModelId])
}
```

不建软删除：绑定是配置关系；任务与账单引用的是派发后的 `channelModelId` 快照，不引用绑定 id。删除绑定直接删行。

### 3.3 新增：能力定价

```prisma
/// 能力级售价：一个能力一套价格，切换线路不改价。
model CapabilityPricing {
  capabilityId                 String   @id
  /// 'fixed_request' | 'per_second' | 'token'
  billingMode                  String   @default("fixed_request")
  unitPriceMicrocredits        BigInt   @default(0)
  inputTokenPriceMicrocredits  BigInt   @default(0)
  outputTokenPriceMicrocredits BigInt   @default(0)
  cachedTokenPriceMicrocredits BigInt   @default(0)
  updatedBy                    String   @default("")
  updatedAt                    DateTime @updatedAt
  createdAt                    DateTime @default(now())
}
```

- 首次读取时若缺行：固定价能力回落到能力定义里的 `creditCost`，不阻断上线；Token 计费能力不回落到固定价，按「未配置」处理；
- `CreditPriceService` 增加 `resolvePricing(capabilityId, userId)`，一次返回计费方式、四项单价、命中的限时免费活动 id 与最终固定价；
- 现有 `resolve()` 保留给 C 端按钮展示，内部与 `resolvePricing` 共用同一份缓存。

### 3.4 渠道模型补充

```prisma
model ChannelModel {
  // ...现有字段
  /// C 端模型分组键；空串 = 使用 modelKey。
  /// 同一上游模型在多条渠道使用不同上游键时，靠它合并成一个 C 端选项。
  modelGroupKey String @default("")
}
```

`priceConfigured` 语义改为「至少有一个可用的成本档」；不再作为可售前提。没有成本档的商品仍可售，但账单的成本快照为空、毛利不可算，后台在商品台账标「成本未配置」。

### 3.5 任务与账单字段

| 表 | 删除 | 新增 / 保留 |
| --- | --- | --- |
| `GenerationTask` | `logicalModelId`、`logicalModelRevisionId`、`routeId` | 新增 `capabilityId`、`modelKey`（C 端所选分组键快照）、`channelModelId`、`channelId`；保留 `routeRun` 作为重试轮次 |
| `RouteAttempt` | `logicalModelId`、`logicalModelRevisionId`、`routeId` | 新增 `capabilityId`、`modelKey`、`channelModelId`、`channelId`；尝试编号与 `dispatchState` 不变 |
| `BillingOrder` | `routeId`、`pricePolicy`、`logicalModel*` | 新增 `capabilityId`、`modelKey`、`channelModelId`、`channelId`；售价字段改为能力价快照；成本字段记录最终线路的成本档 |

任务快照的权威字段改为 `capabilityId + modelKey + channelModelId + channelId + creditCost`；下游任何一层不得替换供应侧字段（沿用现有约束）。

## 4. 目录投影

### 4.1 快照结构

`route-catalog.service.ts` 重写为 `capability-catalog.service.ts`：

```
capabilityId
  ├── pricing            // CapabilityPricing + 覆盖价 + 限时免费标记
  └── groups: Map<modelGroupKey, ModelGroup>
        ├── modelKey / groupKey
        ├── displayName / icon   // 取 binding.priority 数值最小（最优先）、sortOrder 最小的商品
        └── lines: ChannelModel[] // 已绑定、启用、渠道启用的商品
```

装载时剔除：

- 能力被 `CapabilityControl` 下线；
- 绑定停用、商品停用、渠道停用或软删除；
- 能力合同非法（`capabilityConfigJson` 解析失败）；
- 商品能力与能力定义的产出模态不一致。

TTL 30 秒、最大过期 5 分钟、首次装载失败直接报错；写入后 `CatalogVersionService.invalidate()`。规则与现有目录一致。

### 4.2 能力合同

- C 端表单合同以 `capabilities/definitions/<id>.ts` 为准；不再有 per-model 的 `capabilitySpecJson`。
- 绑定写入时用能力的规范意图逐条 `matchCapability`：一条商品只要有一个规范意图匹配不上，就不允许绑定，返回具体原因。
- 用户选了可选参数而某条线路不支持时，运行时按意图过滤该线路；只要池内还有线路支持就继续，全部不支持则在扣费前返回 `40001`。
- 图片参数预设取能力定义；不再从 revision 合并。

### 4.3 报价

`POST /models/quote`：

```ts
{ capabilityId: string; modelKey?: string; params: Record<string, unknown> }
→ {
  capabilityId: string;
  modelKey: string;          // 解析到的分组键
  available: boolean;
  amount: number;            // 积分，与实际扣费同源
  billingMode: string;
  reason: string;            // 不可用时给可读原因
}
```

报价只校验能力是否启用、池内是否有可承接线路，不选具体线路；金额来自 `CreditPriceService.resolvePricing`，与建任务时的账单同源。

### 4.4 能力可用性

`CapabilityAvailabilityService.remoteOf` 改为检查能力绑定池：

- 至少一条绑定启用；
- 商品与渠道启用、未删除；
- 线路未冷却；
- 能力合同可承接该能力的规范意图；
- 能力有可结算定价（固定价回退或 Token 定价行）。

判定与选路共用同一份快照与同一个过滤函数，不能出现「界面显示可用、提交后无线路」；`generate.service` 在建任务扣费前仍按该结论拦截并返回 `40005`。

## 5. 配置自动化

### 5.1 能力识别

`POST /admin/channels/:id/models/fetch` 返回值追加：

```ts
{
  models: Array<{
    modelKey: string;
    // ...现有字段
    modelGroupKey: string;
    inferredCapability: 'image' | 'text' | 'video' | 'audio' | '';
    compatibleCapabilities: Array<{
      capability: string;
      matched: boolean;
      reason: string;
    }>;
  }>;
}
```

判定顺序：

1. 协议 provider 声明模态（`contributes.providers[].capabilities`）；
2. 上游模型名与协议参数的能力合同（尺寸 / 输入数量 / 操作）；
3. 逐能力构造规范意图，用 `matchCapability` 判定；
4. 无匹配返回空数组，不猜测。

识别结果只作建议，导入时必须由运营勾选确认。

### 5.2 导入即绑定

`POST /admin/channels/:id/models/import` 请求体扩展：

```ts
{
  models: string[];
  config?: unknown;
  /** 商品键 → 能力 id 列表；缺省 = 只建商品，不绑定 */
  capabilitiesByModel?: Record<string, string[]>;
}
```

处理顺序：

1. 按现有逻辑建商品，套用渠道默认商品配置；
2. 为每个能力写 `CapabilityModelBinding`（已存在则跳过，保留原 `priority` / `weight`）；
3. 能力首次获得绑定且无 `CapabilityPricing` 时，固定价能力用能力定义的 `creditCost` 建默认固定价；Token 计费能力不建默认价，标「待定价」且不进入可售目录；
4. 失效目录并返回每个商品的 `boundCapabilities` 与 `skippedReason`。

固定价能力缺少定价行时使用 `creditCost` 默认价；Token 计费能力在配置 `CapabilityPricing` 前不可售，后台标「待定价」，不静默按固定价收款。

### 5.3 商品台账批量绑定

`POST /admin/channel-models/:id/publish`

```ts
{ capabilities: string[] }
```

商品台账增加「可售能力」列与「绑定到能力」动作；已绑定的能力不可重复添加。支持多选商品后批量绑定到同一能力。

## 6. 选路与自动切换

### 6.1 候选池

一次解析的候选池来自 `capability-catalog`：

1. 能力启用且未下线；
2. 绑定启用；
3. 商品与渠道启用、未删除；
4. 本轮未尝试（故障切换的已试集合）；
5. 未冷却（`RouteHealthService` 三键）；
6. 分组可见（`UserGroupChannel`）；
7. `matchCapability` 通过（含用户本次参数）。

不再要求「价格档命中」：售价在能力级，成本档缺失不阻塞执行。

### 6.2 排序

按以下键升序分层，只保留最优一层（`groupRank` 与 `effectivePriority` 都相同），同层按 `weight` 加权随机：

```
1. groupRank：所选 modelKey = 0；同能力其它分组 = 1
2. effectivePriority = healthTier(channelModel) * 1000 + binding.priority
```

- `groupRank` 保证用户选了哪个模型就先走哪个模型的线路；
- 该分组全部线路失败后，才允许跨模型兜底到同能力的其它分组（`groupRank=1`）；
- `healthTier` 让 24h 成功率低的线路自动下沉，且优先级高于手工分层；
- `binding.priority` 只在同一健康层内决定先后，不能把坏线路顶到健康线路之前；
- 商品 `sortOrder` 只用于后台展示与分组展示名的稳定选择，不参与选路分层。

### 6.3 健康分层

| 条件（近 24h 终态样本） | `healthTier` |
| --- | --- |
| 冷却中 | 已在候选池剔除 |
| 样本 < 5（含无样本） | 0 |
| 成功率 ≥ 90% | 0 |
| 50% ≤ 成功率 < 90% | 1 |
| 成功率 < 50% | 2 |

新增 `RouteScoreService`：进程内缓存 `channelModelId → healthTier`，TTL 30 秒，数据来自 `ChannelModelMetricsService` 的 24h 聚合；读取失败返回 0。

### 6.4 自动切换

复用现有 `switchRoute`：

1. `rejected_no_job` 后把已试 `channelModelId` 加入排除集；
2. 重新解析候选池，先在同分组换线路，再跨分组兜底；
3. 新线路仍失败继续，全部失败落 `42204` 并全额退款；
4. 超时、5xx、建连后中断落 `42206`，不切线、不退款；
5. `routeRun` 只在用户手动重试时 `+1`。

因为售价在能力级，切线**不重建账单、不改金额**；只更新任务与账单上的最终供应快照（`channelModelId` / `channelId` / 成本档），并在 `RouteAttempt` 里逐次记录真实线路与成本。

### 6.5 模拟

`POST /admin/capabilities/:id/simulate` 返回：

```ts
{
  capabilityId: string;
  intent: ModelRequestIntent;
  groups: Array<{
    modelKey: string;
    lines: Array<{
      channelModelId: string;
      channelId: string;
      channelName: string;
      healthTier: number;
      effectivePriority: number;
      weight: number;
      eligible: boolean;
      selectedTier: boolean;
      reason: string;
    }>;
  }>;
  selectedChannelModelId: string;
  selectedModelKey: string;
  reason: string;
}
```

`selectedTier=true` 表示该线路进入最终候选层；同层内仍会按权重随机选择，
因此可能出现多条线路同时为 `true`。真正本次命中的唯一线路以顶层
`selectedChannelModelId` 为准，不能用 `selectedTier` 反推「已经选中」。

模拟与真实选路共用同一套过滤与排序函数；测试断言两者选同一条线路。

## 7. 计费

1. 建任务时按 `CapabilityPricing` 计算并快照 `task.creditCost`，与 C 端报价同源。
2. 预留、结算、退款仍走 `CreditWalletService` / `BillingService`，金额口径不变。
3. 固定价模型切换线路不改金额；Token 模型按上游实际 usage × 能力级 Token 单价结算，切换线路不会把不同模型的价格混用。
4. 成本快照：每次 `RouteAttempt` 记录该线路的成本档；`BillingOrder` 记录最终线路的成本，用于毛利分析。成本缺失时 `costConfigured=false`，不按 0 记账。
5. 限时免费、后台覆盖价、分组倍率、货币换算全部在 `CreditPriceService` 内完成，渠道侧不再参与售价计算。
6. 已结算账单不允许自动退款；`uncertain` 仍只能人工 `settle` / `refund`，原因必填。

## 8. 接口变更

### 8.1 公开接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/capabilities` | 保留；每项继续带 `runtime` 与生效积分价 |
| GET | `/models?capability=` | 返回该能力的模型分组：`modelKey / displayName / icon / billingMode / priceLabel / available` |
| POST | `/models/quote` | 能力 + 可选模型 + 参数 → 金额与可用性 |
| POST | `/generate` | 请求体改为 `capability` + `modelKey` + 能力参数 + 输入素材；不再接受 `logicalModelId` |

旧的前台模型字段、`/models/available` 与 `/models/:id/quote` 直接删除，不做兼容；`/models` 路径保留，但响应从「前台模型」改为「能力下的模型分组」。`/generate` 不再接受 `logicalModelId`。

### 8.2 后台接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/PUT | `/admin/capabilities/:id/models` | 读取 / 整体替换能力绑定（`channelModelId`、`enabled`、`priority`、`weight`） |
| POST | `/admin/capabilities/:id/simulate` | 路由模拟 |
| GET/PUT | `/admin/capabilities/:id/pricing` | 能力定价（计费方式与四项单价） |
| GET | `/admin/channel-models/:id/capabilities` | 商品兼容能力预览 |
| POST | `/admin/channel-models/:id/publish` | 商品绑定到能力 |
| POST | `/admin/channels/:id/models/import` | 增加 `capabilitiesByModel` |
| DELETE | `/admin/logical-models/*` | 整组接口删除，不保留重定向 |

### 8.3 权限

- 新增 `capability_model.read` / `capability_model.write`（能力绑定与模拟）；`capability.read/write` 继续管上下线，`capability.price` 管定价。
- 删除 `logical_model.read/write`，同步更新角色种子与后台菜单权限映射。
- 所有写接口在后端二次校验，前端 `can()` 只用于隐藏按钮。

## 9. 后台交互

### 9.1 渠道工作台

- 上游导入弹窗增加：识别模态、可承接能力多选、`modelGroupKey`（默认取 `modelKey`，可改）。
- 导入结果按商品展示「已绑定 N 个能力 / 跳过原因」。
- 商品台账增加「可售能力」列与「绑定到能力」动作；支持批量绑定。
- 商品表单移除售价字段，只保留成本档与成本摘要；毛利展示改为「能力售价 − 成本」。

### 9.2 能力与模型页

页面重构为三块：

1. **能力状态**：上下线、下线原因、当前可用模型数；
2. **模型候选池**：该能力已绑定的商品列表，列为 商品 / 渠道 / 健康分层 / 成本 / 优先级 / 权重 / 启停；支持添加（从兼容商品里选）、移除、调优先级；
3. **定价**：计费方式与单价，展示生效价与限时免费状态。

删除旧的前台模型表单、revision、线路编辑、归档与 `RouteSimulateDrawer` 中依赖 `logicalModelId` 的逻辑。模拟入口改到能力级。

### 9.3 导航

- 后台菜单「能力与模型」保留，路由仍为 `/admin/capabilities`。
- 删除 `pages/admin/logical-models/**` 与旧 `/admin/logical-models` 重定向。

### 9.4 C 端

- 模型选择器按能力请求 `GET /models?capability=`，展示分组（同一模型不因多渠道重复出现）。
- 参数控件改为读能力定义的 `params`（`GET /capabilities`），不再从模型能力合同下发；模型能力合同只用于绑定校验与运行期匹配。
- 记忆键从 `logicalModelId` 改为 `capabilityId + modelKey`。
- 提交携带 `capability` + `modelKey`；报价展示能力价，切换线路不改价。
- 任务详情展示最终线路的模型名；后台才展示渠道与成本。

## 10. 迁移与删除清单

### 10.1 数据迁移

开发阶段不做双写与兼容；若部署环境已有需要在意的历史账单，执行前先补一份回填与只读审计脚本：

1. 新增 `CapabilityModelBinding`、`CapabilityPricing`、`ChannelModel.modelGroupKey`；
2. 任务 / 账单 / 尝试表新增 `capabilityId`、`modelKey`、`channelModelId`、`channelId`；
3. 用现有 `LogicalModel` 的 `capability`、线路与前台模型价格回填历史行（仅用于保留可读性）；
4. 删除 `LogicalModel*` 表与相关列；
5. 重建种子：至少一个渠道 + 一个商品 + 一个能力绑定 + 一条能力定价。

开发环境允许直接 `db:reset` 后重灌种子。

### 10.2 代码删除清单

| 删除 | 说明 |
| --- | --- |
| `src/model/catalog/logical-model.admin.service.ts`、`admin-logical-model.controller.ts` | 后台前台模型管理 |
| `src/model/routing/router.service.ts` 中 logical model 分支 | 重写为能力选路 |
| `src/model/catalog/route-catalog.service.ts` | 由 `capability-catalog.service.ts` 取代 |
| `src/model/catalog/quote.service.ts` 中 logical model 报价 | 改为能力报价 |
| `src/capabilities/capability-availability.service.ts` 的线路判定 | 改为绑定池判定 |
| `frontend/src/pages/admin/logical-models/**` | 页面与组件 |
| `src/model/catalog/models.controller.ts` 中旧 `/models*` | 改为新模型分组接口 |
| `prisma` 中三张表与相关列 | 同步清理 |

## 11. 分期与验收

| 期 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 数据模型、`CapabilityPricing`、`CreditPriceService.resolvePricing`、能力目录投影 | 单测：定价回退、覆盖价与限时免费、目录装载与剔除、快照失效 |
| P1 | `CapabilityModelBinding` 写入、能力绑定接口、商品兼容预览 | 集成：绑定 / 解绑 / 冲突、兼容判定、权限 |
| P2 | 选路重写、健康分层、自动切换、模拟 | 脚本：同能力两渠道，401 切线且金额不变；同分组失败后跨分组；超时 `42206` 不切线；低健康下沉；模拟与解析同选 |
| P3 | 渠道导入绑定、能力与模型页重构、C 端选型与提交流程 | e2e：配渠道 → 选模型 → 绑定能力 → C 端选模型 → 生成 → 人为断线 → 成功且金额正确 |
| P4 | 删除前台模型代码与旧接口、种子与文档同步 | 全仓无 `LogicalModel` 引用；`docs/model-architecture.md` / `api-contract.md` / `testing.md` 更新 |

## 12. 测试

| 层 | 覆盖 |
| --- | --- |
| 单元 | 能力识别矩阵、绑定兼容判定、健康分层边界、排序与分组优先、能力定价回退、成本快照 |
| 集成 | 导入绑定、绑定增删、渠道停用级联、改价即时生效、切换线路金额不变、Token 结算 |
| 契约 | `/models` 分组结构、`/models/quote`、`/generate` 新入参、模拟返回 |
| 脚本 | `verify:capability-routing`：自动池 + 401 切线 + 超时不确定 + 跨分组兜底 + 低健康下沉 |
| e2e | 后台配置动线 + C 端生成 + 任务详情线路展示 |

现有 `verify:billing` 需改写为能力定价口径；`verify:route-catalog` 由新脚本替代；`verify:task-runtime` 保留切线 / 不确定 / 唯一线路 429 三段语义。

## 13. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 删除前台模型导致历史任务 / 账单不可回溯 | 迁移时把 `capabilityId / modelKey / channelModelId` 回填到历史行；开发阶段允许重置 |
| 售价改到能力级，运营失去按模型定价能力 | 明确口径：一个能力一个价；需要分级时新增独立分级价表，不恢复前台模型层 |
| 自动跨分组兜底换到用户没选的模型 | `groupRank` 先同组；跨组只在同组全部失败后发生；任务详情明确展示最终模型 |
| 健康分层误伤新线路 | 无样本与样本不足按 0 层 |
| 两大页面同时重构，回归面大 | P0–P2 先落地后端与脚本，P3 才动 UI；手工模式已删除，不留双路径 |
| 权限点改名影响既有角色 | 迁移脚本同步角色授权；后台登录冒烟 + 权限单测 |
| 能力合同只在代码里，运营无法微调 | 能力定义是唯一合同；确需按模型收窄时在 `ChannelModel.capabilityConfigJson` 表达，并作为绑定校验输入 |

## 14. 未决项

1. `modelGroupKey` 的命名规则与后台可见性：默认取 `modelKey`，是否允许同组展示名不同。
2. 能力级定价是否支持按用户分组设置不同价格档（现由分组倍率覆盖，暂不新增价表）。
3. Token 计费能力的四项单价是否需要按模型区分（当前方案为一套能力价）。
4. 历史账单是否需要在 P4 前保留只读前台模型字段做审计，还是直接重置开发库。
