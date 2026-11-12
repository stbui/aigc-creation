# 模型渠道能力重构实现方案（配置自动化与模型自动切换）

> 状态：规划中，未实施。
> 日期：2026-11-12
> 决策：保留 `LogicalModel` 作为 C 端售卖单元；把「建渠道 → 建渠道模型 → 手建前台模型 → 手挑线路 / 配 priority / 配 weight」收敛为「配渠道 → 选模型 → 自动售卖与切换」；自动切换限定同能力、跨模型、跨渠道。
> 关联：`docs/model-architecture.md`、`docs/channel-model-design.md`、`docs/api-contract.md`、`docs/testing.md`、`CLAUDE.md`

## 1. 范围

### 1.1 要解决的问题

当前模型层有四层配置：`ModelChannel` → `ChannelModel`（商品）→ `LogicalModel`（按 C 端能力建立的售卖单元）→ `LogicalModelRevision` + `LogicalModelRoute`。前两层是供应事实，后两层是售卖事实。问题集中在后两层：

1. **配置重复**：每个上游模型先建商品，再按能力手建前台模型，再逐条挑线路；同一批模型服务 15 个图像能力时要重复 15 次。
2. **候选池被人为截断**：选路只读取当前前台模型 revision 下的 `LogicalModelRoute`（`route-catalog.service.ts`），没有绑定进来的同能力商品永远不会参与，包括同渠道的备用模型。
3. **静态优先级与运行时健康脱节**：`priority` / `weight` 是手工值，冷却与 24h 成功率只在任务失败后被动生效，不能提前避开坏线路。
4. **两套可售口径**：商品台账已经维护能力、成本、售价与价格档，前台模型又维护能力合同、价格策略与线路；运营容易把「模态」和「能力 id」配混，也容易让展示价与实扣价分叉。
5. **新增渠道无法闭环**：拉取上游模型、导入、定价、上架、绑定能力分散在多个页面，缺少一次完成的动线。

### 1.2 本方案做

- 渠道导入时自动识别模型模态与可承接的 C 端能力，勾选后一次完成「建商品 + 定价 + 上架到能力」。
- 为每个能力维护一个**自动线路池**（`LogicalModelSource`），不再手工维护线路。
- 自动模式下按运行时健康度分层，坏线路自动下沉；同能力池内跨模型、跨渠道自动切换。
- 保留手工模式，作为高级覆盖与回滚路径。
- 保留现有任务快照、账单、失败语义与冷却规则。

### 1.3 本方案不做

- 不删除 `LogicalModel` / `LogicalModelRevision` / `LogicalModelRoute`。
- 不改变失败判定：仍然只有 `rejected_no_job` 切线；超时、5xx、建连后中断判 `42206`，不切线、不自动退款（`docs/model-architecture.md`）。
- 不改变冷却键与时长：401/403 冷却渠道 10 分钟，404 冷却渠道模型 10 分钟，429 按 `Retry-After` 或 30 秒。
- 不改变钱包、预留、结算、退款与 `route_switch` 账单替换规则。
- 不做跨能力、跨模态兜底（图像失败不退到视频）。
- 不引入 Redis：健康分层用进程内缓存 + 30 秒 TTL，多实例各自判定。

## 2. 现状依据

| 事实 | 位置 |
| --- | --- |
| 目录快照只装载 `LogicalModel` 及其 revision 下的启用线路 | `backend/src/model/catalog/route-catalog.service.ts` |
| 候选池按 `priority` 硬分层、同层 `weight` 加权随机 | `backend/src/model/routing/router.service.ts` 的 `eligibleRoutes` / `weightedRoute` |
| 故障切换重新解析并排除本轮已试线路 | `backend/src/model/tasks/task-worker.service.ts` 的 `switchRoute` |
| 渠道模型已支持上游目录拉取、导入、默认商品配置 | `channel-model.service.ts`、`channel-default-model.ts`、`POST /admin/channels/:id/models/fetch` |
| 前台模型保存即新建 revision 并重建线路 | `backend/src/model/catalog/logical-model.admin.service.ts` 的 `save` |
| 渠道价按价格档 × 分组倍率 × 货币结算，换线换账单 | `docs/model-architecture.md` 计费与切线章节 |
| 能力定义声明产出模态、默认参数与输入数量 | `backend/src/capabilities/definitions/<id>.ts` 的 `model` 与 `inputs` |
| 协议清单声明 provider 的能力模态 | `backend/plugins/<plugin>/manifest.json` 的 `contributes.providers[].capabilities` |

## 3. 目标形态

### 3.1 三层收敛为三个动作

```
配渠道（凭证 / 端点 / 代理 / 并发）
   ↓
选模型（拉取上游目录 → 勾选 → 自动识别模态与可承接能力 → 套用定价）
   ↓
自动售卖与切换（自动线路池 → 健康分层 → 失败切线 → 换线换账单）
```

运营心智从「维护四张表」变成「一个渠道能用哪些模型、每个能力由哪些模型承接」。

### 3.2 两个显式模式

`LogicalModel.routeMode`：

| 模式 | 线路来源 | 适用 |
| --- | --- | --- |
| `auto`（新模型默认） | `LogicalModelSource` 自动派生，健康度决定顺序 | 常规售卖、需要自动切换 |
| `manual` | 运营手工维护 `LogicalModelRoute` 的 `priority` / `weight` | 灰度、定向放量、历史模型与回滚 |

两种模式共用同一套选路、计费与切线代码；差异只在候选池来源与优先级来源。

## 4. 数据模型

### 4.1 新增字段

```prisma
model LogicalModel {
  // ...现有字段
  /// 'auto' 线路池由 LogicalModelSource 派生 | 'manual' 手工维护线路
  routeMode String @default("auto")
}
```

新增索引：`@@index([routeMode, capability, enabled])`，供目录装载与迁移盘点使用。

### 4.2 新增表

```prisma
/// 自动线路池：一个前台模型可选用的供应商品集合。
/// 只表达「允许用哪些」，不表达「当前哪条最快」——后者由运行时健康分层决定。
model LogicalModelSource {
  id             String  @id @default(cuid())
  logicalModelId String
  channelModelId String
  enabled        Boolean @default(true)
  /// null = 完全由健康度决定；非 null = 在该值基础上叠加健康分层
  priority       Int?
  /// null = 默认 100；同层加权随机使用
  weight         Int?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([logicalModelId, channelModelId])
  @@index([logicalModelId, enabled])
  @@index([channelModelId])
}
```

不建软删除：来源是配置关系，被任务 / 账单引用的只有派发后的 `LogicalModelRoute` 与任务快照，来源行可以直接删除。删除来源时把对应线路置 `enabled=false`，不物理删除，保证历史 `routeId` 仍可回溯。

### 4.3 不新增的表

- 不新增「能力 → 商品」之外的映射表：一个商品可以同时服务多个能力，`LogicalModelSource` 天然是多对多。
- 不新增健康表：24h / 7d 指标已有 `ChannelModelMetricsService` 与 `channel-models/health`，运行时分层复用聚合结果。
- 不新增定价表：自动模式默认 `pricePolicy='channel'`，售价仍来自 `ChannelModelPriceTier`。

## 5. 自动线路池

### 5.1 派生规则

对 `routeMode='auto'` 的前台模型，活跃 revision 的 `LogicalModelRoute` 由 `RouteAutoSyncService` 从 `LogicalModelSource` 派生：

```
source 存在 + source.enabled + 渠道启用 + 商品启用 + 未删除
  → route.enabled = true
否则
  → route.enabled = false（保留行，不删除）
route.priority = source.priority ?? 0
route.weight   = source.weight ?? 100
```

价格档、能力合同、分组可见性不写进线路：它们是运行时过滤条件，写死会在改价 / 改配置后变成脏快照。

### 5.2 同步触发

`RouteAutoSyncService.sync(logicalModelId)` 为幂等操作：

| 触发 | 调用点 |
| --- | --- |
| 来源新增 / 删除 / 启停 / 改权重 | `LogicalModelSource` 写入接口 |
| 渠道模型启停、价格档变更 | `ChannelModelService.setEnabled` / `save` / `removeMany` / `repriceMany` |
| 渠道启停 / 删除 | `ChannelService.update` / `remove` |
| 前台模型保存（新建 revision 后） | `LogicalModelAdminService.save` |
| 定时对账（兜底） | 新增 `route-source-sync` 定时任务，每 5 分钟扫描不一致 |

同步在事务内 upsert 活跃 revision 的线路，完成后调用 `CatalogVersionService.invalidate()`。**同步不创建 revision、不递增 `revisionSequence`**：线路是运行期可用性，不是发布内容；历史 revision 的线路保持当时状态，供账单与任务排查。

### 5.3 模式切换

- `manual → auto`：把当前活跃 revision 的线路写成来源（`LogicalModelSource`），保留 `priority` / `weight` 作为覆盖值，然后进入自动维护。
- `auto → manual`：直接把当前派生线路留在原地，后续手工编辑；来源行保留但在后台隐藏，切回 auto 时复用。
- 切换是显式动作，必须二次确认；不做静默迁移。

### 5.4 保存语义（自动模式）

`LogicalModelAdminService.save` 按 `routeMode` 分支，不能只靠保存后同步：

- `auto`：忽略请求里的 `routes`，从 `LogicalModelSource` 读取候选，按 §6.4 生成能力合同，用来源规格做 `validateProductSpecWithinRoutes` 与可结算校验；派生线路仍写入新 revision，保证 revision 快照完整；
- `manual`：保持现有逻辑；
- 启用判定从「至少一条启用线路」改为「至少一条来源可结算」；
- 来源为空时允许保存，但强制 `enabled=false`，不让没有线路的自动模型对外可见。

## 6. 配置自动化

### 6.1 自动识别能力

`POST /admin/channels/:id/models/fetch` 的返回值追加：

```ts
{
  models: Array<{
    modelKey: string;
    // ...现有字段
    inferredCapability: 'image' | 'text' | 'video' | 'audio' | '';
    compatibleCapabilities: Array<{
      capability: string;   // C 端能力 id：free_create / main_image / ...
      matched: boolean;
      reason: string;       // 不匹配时给可读原因
    }>;
  }>;
}
```

判定顺序：

1. 渠道模型所选协议的 provider 声明模态（`contributes.providers[].capabilities`）；
2. 上游模型名与协议参数的能力合同（尺寸 / 输入数量 / 操作）；
3. 逐能力构造该能力的规范意图，用 `matchCapability` 判定是否可承接；
4. 无匹配时返回空数组，不猜测。

识别结果只是**建议**，导入时必须由运营勾选确认；不做静默上架。

### 6.2 导入时一次完成上架

`POST /admin/channels/:id/models/import` 请求体扩展：

```ts
{
  models: string[];
  config?: unknown;
  /** 商品键 → 允许承接的能力 id；缺省 = 只建商品，不上架 */
  capabilitiesByModel?: Record<string, string[]>;
}
```

处理顺序：

1. 按现有逻辑建商品，套用渠道默认商品配置；
2. 对每个勾选能力，找该能力未归档且 `routeMode='auto'` 的前台模型：
   - 不存在 → 创建 `auto-<能力 id>`（名称取能力定义），`pricePolicy='channel'`，按能力定义生成能力合同；
   - 存在但为 `manual` → 跳过并返回 `skippedReason='该能力使用手工售卖配置'`，由运营在该能力页切换模式；
   - 存在但已归档 → 不复活，返回 `skippedReason`；
3. 写入 `LogicalModelSource`，若商品未定价则不写入，返回 `skippedReason='待定价'`；
4. 同步线路并失效目录；
5. 返回每个商品的 `linkedCapabilities` 与 `skippedReason`。

自动创建的前台模型只有在**至少一条来源已定价且能力合同可承接**时才 `enabled=true`；否则建成停用，后台显示待完成原因。

### 6.3 商品台账的上架动作

已存在的商品补上架：

`POST /admin/channel-models/:id/publish`

```ts
{ capabilities: string[] }
```

语义与导入一致：补来源、必要时创建自动前台模型、同步线路。返回每个能力的成功 / 跳过原因。商品台账增加「可售能力」列与「上架到能力」动作；未定价商品直接禁用该动作并提示先补售价。

### 6.4 能力合同的生成

服务端新增纯函数 `buildAutoProductSpec(capabilityId, sourceSpecs)`（落在 `backend/src/model/intent/capability-spec.ts`）：

- 起点是能力定义声明的产出模态、操作与默认参数；
- 图片能力从来源规格取**交集**作为可展示参数（复用 `effectiveImageParameterSpec`）；
- 至少有一条来源无法覆盖时，不把该来源放进这个能力的池子，并记录原因；
- 生成结果仍走现有 `validateProductSpecWithinRoutes` 校验，不允许自动路径绕过合同。

## 7. 选路与自动切换

### 7.1 候选池

自动模式与手工模式共用过滤条件：

1. 线路启用、`weight > 0`；
2. 本轮未尝试（故障切换的已试集合）；
3. 未冷却（`RouteHealthService` 三键）；
4. 分组可见；
5. `matchCapability` 通过；
6. `pricePolicy='channel'` 时有命中价格档。

自动模式与手工模式的差异只有优先级：

| 模式 | 有效优先级 |
| --- | --- |
| `manual` | `route.priority`（现有行为，最高一层优先） |
| `auto` | `route.priority + healthTier(route.channelModel)` |

`healthTier`：

| 条件（近 24h 终态样本） | 分层 |
| --- | --- |
| 冷却中 | 已在候选池剔除，不参与分层 |
| 样本 < 5（含无样本） | 0（不惩罚新线路） |
| 成功率 ≥ 90% | 0 |
| 50% ≤ 成功率 < 90% | 1 |
| 成功率 < 50% | 2 |

同层仍按 `weight` 加权随机，权重默认 100；运营可以用来源的 `priority` 把某条线路整体上移或下移，但健康分层会在此基础上继续生效。

### 7.2 健康分层的读取

新增 `RouteScoreService`：

- 进程内缓存 `channelModelId → healthTier`，TTL 30 秒；
- 数据来自 `ChannelModelMetricsService` 的 24h 聚合，不新增表；
- 读取失败一律返回 0（不要把数据库抖动放大成「全部线路降级」）；
- 进程内冷却由现有 `RouteHealthService` 判定，不走这层缓存。

### 7.3 自动切换

复用现有 `switchRoute`：

1. 安全失败（`rejected_no_job`）后，把已试 `routeId` 加入排除集；
2. `router.resolve` 重新选路，自动池里的下一条模型 / 下一条渠道自然成为候选；
3. `pricePolicy='channel'` 时生成替换账单，原账单标记 `refundReason='route_switch'`；
4. 新线路仍失败则继续，全部失败落 `42204` 并退款；
5. 超时、5xx、建连后中断仍落 `42206`，不切线、不退款。

自动模式不改变「一次任务只沿一个方向切换」的语义，也不扩大失败判定。

### 7.4 主动避让

健康分层在**选路时**生效，不写库、不触发目录失效：

- 24h 成功率低的线路自动下沉到低优先级层；
- 冷却中的线路直接剔除；
- 恢复后的线路随下一次 30 秒缓存刷新回到健康层，不需要人工解除冷却。

运营仍可在自动池里手工停用某个来源，立即生效（写来源后同步线路）。

### 7.5 路由模拟

`POST /admin/logical-models/:id/simulate` 的返回追加：

```ts
{
  routeMode: 'auto' | 'manual';
  sources: Array<{
    channelModelId: string;
    enabled: boolean;
    healthTier: number;
    effectivePriority: number;
    weight: number;
    eligible: boolean;
    reason: string;
  }>;
}
```

模拟与真实选路必须共用 `eligibleRoutes` / 分层函数；测试断言 `simulate.selectedRouteId` 与 `resolve` 选择一致。

## 8. 计费与价格

1. 自动创建的前台模型默认 `pricePolicy='channel'`；售价来自渠道价格档，不引入第二套价格。
2. 换线必须换账单（现有规则）。新线路价格不同则按新价格重新预留；余额不足或超授权上限时拒绝切换并退款。
3. C 端报价仍是当前选中线路的报价；自动切换后按实际线路结算。任务详情展示「已自动切换线路」与最终金额。
4. 一个自动前台模型的池子里，价格档规格必须能被同一份能力合同表达；不兼容的来源在配置期就拒绝，不等到运行期报 `40001`。
5. `unified` 策略继续可用：手建前台模型或把自动模型切到 `manual` 后改统一价；自动模式不生成统一价。

## 9. 接口变更

### 9.1 新增 / 扩展

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/channel-models/:id/capabilities` | 兼容能力预览：规范意图逐条判定，返回可承接 / 不可承接与原因 |
| POST | `/admin/channel-models/:id/publish` | 商品上架到能力，写来源并同步线路 |
| GET | `/admin/logical-models/:id/sources` | 自动线路池 |
| PUT | `/admin/logical-models/:id/sources` | 整体替换来源（仅 `routeMode='auto'`） |
| PATCH | `/admin/logical-models/:id` | 请求体增加 `routeMode` |
| POST | `/admin/channels/:id/models/import` | 增加 `capabilitiesByModel`，返回 `linkedCapabilities` / `skippedReason` |
| POST | `/admin/logical-models/:id/simulate` | 返回增加 `routeMode` 与逐来源诊断 |

### 9.2 权限

沿用现有权限点，不新增：

- 商品上架 / 来源写入：`channel.model_write` 与 `logical_model.write` 同时校验；
- 能力兼容预览：`channel.model_read`；
- 模式切换：`logical_model.write`；
- 所有写接口在 handler 内二次校验，不能只靠前端 `can()`。

## 10. 后台交互

### 10.1 渠道工作台

- 上游导入弹窗增加两列：识别模态、可承接能力（多选，默认勾选高置信项）。
- 导入结果按商品展示「已上架到 N 个能力 / 跳过原因」。
- 商品台账增加「可售能力」列；未定价商品显示「待定价」，并提供「上架到能力」动作。
- 供应商详情内的商品清单不再要求先建前台模型才能售卖。

### 10.2 能力与模型页

- 每个能力卡片显示当前模式（自动 / 手工）与池子健康度。
- 自动模式：
  - 展示来源表：商品、渠道、能力合同、健康分层、价格档、启停、优先级覆盖；
  - 不显示自由新增线路；提供「添加来源」「停用来源」「切换为手工」；
  - 价格策略固定 `channel` 并只读，提示去渠道商品定价。
- 手工模式：保留现有表单、线路 priority / weight、能力合同与默认参数编辑。
- 切换模式走 `ConfirmDialog`，说明会影响哪些任务与账单口径。

### 10.3 C 端

- 目录接口不变；自动模型的价格按现有 `computeModelPriceDisplay` 展示。
- 能力页仍按 `logicalModelId` 提交，不感知来源。
- 任务失败自动切换后，详情展示最终线路的模型名与金额；不展示渠道与上游标识。

## 11. 迁移

1. 新增 `LogicalModel.routeMode` 与 `LogicalModelSource`；`prisma:push`。
2. 存量 `LogicalModel` 全部回填 `routeMode='manual'`，行为与当前完全一致。
3. 可选升级：后台对某个手工模型点「切换为自动」，把活跃 revision 的线路写成来源；不批量自动迁移，避免一次上线改变所有能力的流量分布。
4. 历史任务、账单、`RouteAttempt` 不改；`routeId` 保持可回溯。
5. 回滚：把 `routeMode` 改回 `manual`，派生线路已在库中，可直接继续手工编辑；`LogicalModelSource` 保留，不影响运行。

## 12. 分期与验收

| 期 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 数据模型、`RouteAutoSyncService`、来源 CRUD、模式切换、目录装载 `routeMode` | 单测：来源派生幂等、删除来源置停用不删行、模式切换往返、目录版本失效；存量模型保持 `manual` 行为 |
| P1 | 能力识别、导入上架、`publish` 接口、自动前台模型创建、合同生成 | 集成：拉取 → 勾选 → 导入 → 来源与线路生成；未定价 / 手工模型 / 归档模型的跳过原因准确；无来源时不启用 |
| P2 | `RouteScoreService`、自动模式分层、模拟诊断、自动切换验收 | 脚本：同能力两条渠道，401 切线且账单替换；超时落 `42206` 不切线；24h 低成功率线路下沉；`simulate` 与 `resolve` 同选 |
| P3 | 渠道导入 UI、能力页自动池、商品台账上架动作、C 端文案 | e2e：配渠道 → 选模型 → 自动上架 → C 端生成 → 人为切断一条线路 → 任务成功且账单金额正确 |
| P4 | 定时对账、文档同步、旧手工路径收口 | 5 分钟对账无差异；`docs/model-architecture.md` / `api-contract.md` / `testing.md` 更新 |

每期独立可运行；P0/P1 不改变 C 端流量行为。

## 13. 测试

| 层 | 覆盖 |
| --- | --- |
| 单元 | 能力识别矩阵、合同交集、来源派生幂等、模式切换、健康分层边界（无样本 / 50% / 90%）、有效优先级 |
| 集成 | 导入上架、来源增删、渠道停用级联、改价后目录刷新、换线换账单、余额不足拒绝切换 |
| 契约 | `/models` 响应不变；`simulate` 新增字段；导入返回结构 |
| 脚本 | `verify:auto-route`：本机 mock 上游跑「自动池 + 401 切线 + 超时不确定 + 低健康下沉」 |
| e2e | 后台配置动线 + C 端生成；手工模式回归用例保持 |

现有 `verify:route-catalog`、`verify:task-runtime` 必须继续通过，手工模式行为不得回归。

## 14. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 自动池扩大改变流量与成本分布 | 存量模型默认 `manual`；自动模式逐模型显式切换；池子变更可审计 |
| 换线后价格与报价不一致 | 沿用换线换账单与授权上限；任务详情展示最终金额；拒绝超限切换 |
| 能力识别误判导致错误上架 | 识别只给建议，导入必须勾选；配置期跑规范意图匹配，不合就不进池 |
| 健康分层让新线路长期冷启动 | 无样本与样本不足按 0 层处理，不降级 |
| 目录快照与来源不同步 | 所有写路径同步 + 5 分钟定时对账 + `invalidate()` |
| revision 不可变语义被破坏 | 只同步活跃 revision 的线路行，不新建 revision；历史 revision 不动 |
| 多实例健康判定不一致 | 冷却与健康分层都是进程内 30 秒缓存，各自判定；正确性不依赖共享状态 |

## 15. 未决项

1. 自动前台模型的命名 / code 规则是否允许运营改写；本方案取 `auto-<能力 id>`。
2. 同一能力已存在多个手工前台模型时，是否允许一键合并为自动池；本方案先不做，只提供逐模型切换。
3. 自动池是否需要「价格带宽」约束（例如池内售价差超过 2 倍时拒绝加入）；本方案暂不设硬限制，依靠授权上限与换线换账单兜底。
4. 健康分层是否扩展到手工模式；本方案只在 `auto` 生效，避免改变既有灰度策略。
