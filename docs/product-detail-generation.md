# 商品详情图生图技术规范（`/product-detail`）

状态：已实现。

本文描述 `/product-detail` 页面从表单提交到多模块图片产出、计费、退款和结果聚合的技术契约。代码与本文冲突时以代码为准，并在同一次变更中修正本文。

## 1. 范围与核心语义

`/product-detail` 使用能力 `detail_image`。一次提交不是生成一张详情长图，而是**按已选模块拆成 N 个独立生成任务，每个任务产出一张模块图**。

核心语义：

- N 等于去重、过滤且截断后的模块数，范围为 1–10。
- 每个模块独立计费、独立生成、独立结算或退款。
- 每个批次只有一个父任务；父任务不是纯协调节点，它同时承担 `batchIndex=1` 的模块生成。
- 一次提交对应一条批次结果记录；结果列表按 `batchId` 聚合。
- 所有图片必须来自真实模型线路。无可用线路、上游失败或产出不合规时不得回落本地占位图或伪结果。

## 2. 组件与事实源

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 页面 | `frontend/src/pages/product-detail/page.tsx` | 表单、校验、提交、结果页签、批次删除 |
| 页面 API | `frontend/src/pages/product-detail/api.ts` | 固定能力 id、请求参数组装、删除父任务 |
| 页面常量 | `frontend/src/pages/product-detail/constants.ts` | 上传上限、字段长度、16 个模块、默认模块、单模块提示词默认值 |
| 页面 hooks | `frontend/src/pages/product-detail/hooks.ts` | 模块选择、模块提示词保留、价签、页签落位 |
| 能力定义 | `backend/src/capabilities/definitions/detail_image.ts` | 参数、提示词、`outputPlan`、模型意图、默认积分价 |
| 通用准入 | `backend/src/model/tasks/task-admission.service.ts` | 权限、素材、模型、线路、价格、拆批、建任务与预留积分 |
| 请求构建 | `backend/src/model/tasks/task-request.service.ts` | 按任务参数调用能力 `buildPrompt` 并构造上游请求 |
| 任务调度 | `backend/src/model/tasks/task-worker.service.ts` | 领取任务、派发、轮询、线路切换、产出落盘 |
| 任务生命周期 | `backend/src/model/tasks/task-lifecycle.service.ts` | 成功结算、失败退款、取消、待人工核对、通知 |
| 结果轮询 | `frontend/src/hooks/useResultGallery.ts` | 拉取 `detail_image` 任务并按生成中状态轮询 |
| 批次归组 | `frontend/src/components/batchResult.ts` | 按 `batchId` 聚合、按 `batchIndex` 排序、批次状态 |
| 删除 | `backend/src/generate/generate.service.ts` | 删除父任务及其子任务、产出素材和存储文件 |

能力元数据只允许在 `backend/src/capabilities/definitions/detail_image.ts` 维护；页面不得复制能力价格、模块后端映射或计费规则。

## 3. 输入契约

### 3.1 页面输入限制

| 字段 | 规则 |
| --- | --- |
| 商品图 | 至少 1 张，页面最多 5 张，单张最大 10MB |
| 商品名称 | 必填，最多 100 字符 |
| 品牌 | 选填，最多 100 字符 |
| 商品描述 | 必填，最多 5000 字符 |
| 模块 | 至少 1 个，最多 10 个；页面默认选择前 6 个 |
| 模块提示词 | 每个已选模块必填；单模块最多 1000 字符 |
| 画面比例 | 由能力参数枚举约束 |
| 画质 | `1k` / `2k` / `4k`；实际可选值还要受前台模型能力限制 |

后端通用准入允许最多 10 张输入素材，但页面契约是 5 张；最终仍会叠加所选前台模型 `productSpec.inputs.image` 的数量限制。

### 3.2 模块定义

当前模块固定为 16 项：

```text
hero
selling_points
usage_scene
multi_angle
scene_atmosphere
product_detail
brand_story
size_spec
effect_compare
spec_table
craft_process
accessories
series_display
ingredients
after_sale
usage_tips
```

前端：

- 默认选择前 6 项。
- 选择顺序归一化为固定模块顺序，不按点击先后排列。
- 取消勾选后仍保留该模块提示词，重新勾选时恢复原内容。

后端：

- 解析逗号分隔的 `sections`。
- 过滤未知模块、去重、最多保留 10 项。
- 保留调用方传入顺序。
- 没有合法模块时回落到默认前 6 项。

### 3.3 模块提示词

页面把每个已选模块的提示词序列化为 JSON 字符串：

```json
[
  { "section": "hero", "prompt": "突出首屏主视觉与品牌名" },
  { "section": "selling_points", "prompt": "提炼三条核心卖点" }
]
```

后端 `parseSectionPrompts()` 同时兼容数组和对象写法：

- 数组：`[{ "section": "...", "prompt": "..." }]`
- 对象：`{ "hero": "...", "selling_points": "..." }`
- 非法模块、空提示词、解析失败项会被跳过。
- 单模块提示词截断到 1000 字符。

## 4. 提交与幂等契约

### 4.1 前端提交条件

只有以下条件全部满足时才允许提交：

- 已有登录态或提交动作可先唤起登录。
- 能力运行时未处于不可提交状态。
- 商品图、商品名称、商品描述、模块及各模块提示词均通过校验。
- 当前结果列表中没有 `queued` 或 `running` 的详情图任务。

提交时页面切换到“创作结果”页签，再依次执行：

1. `ensureProject()` 确保任务落入有效项目。
2. `resolveModelId('detail_image')` 获取用户当前选择的前台模型。
3. 组装请求参数并计算完整输入指纹。
4. 同一指纹的网络重试复用同一个幂等键；输入变化后生成新幂等键。
5. 调用 `POST /api/v1/generate`。
6. 成功后重新拉取结果列表，以后端返回的 `batchSize` 和 `creditCost` 为准提示用户。

### 4.2 请求示例

```http
POST /api/v1/generate
Idempotency-Key: 3a2f3d2e-...
Content-Type: application/json
```

```json
{
  "projectId": "project-id",
  "capability": "detail_image",
  "logicalModelId": "logical-model-id",
  "inputAssetIds": ["asset-1"],
  "idempotencyKey": "3a2f3d2e-...",
  "params": {
    "productName": "桌面循环扇",
    "brand": "示例品牌",
    "platform": "taobao",
    "language": "zh-CN",
    "description": "三档风速，低噪运行，USB 供电",
    "sections": "hero,selling_points,usage_scene,multi_angle,scene_atmosphere,product_detail",
    "sectionPrompts": "[{\"section\":\"hero\",\"prompt\":\"突出首屏主视觉\"}]",
    "ratio": "3:4",
    "size": "1k"
  }
}
```

### 4.3 响应契约

多模块提交返回：

```json
{
  "taskId": "父任务 id",
  "status": "queued",
  "creditCost": 60,
  "batchId": "batch-uuid",
  "batchSize": 6
}
```

- `taskId`：父任务 id，同时也是第一个模块任务。
- `creditCost`：本次 N 张图的合计积分。
- `batchId`：仅在 N > 1 时生成。
- `batchSize`：仅在 N > 1 时随响应返回。
- N = 1 时没有 `batchId` / `batchSize`，前端按单任务结果行展示。

幂等命中时返回赢家任务及其批次信息，不重新建任务、不重新扣费。

## 5. 后端准入流程

`TaskAdmissionService.admit()` 的顺序是不可随意调整的：

1. 规范化幂等键；已有幂等结果时直接返回。
2. 读取能力定义，拒绝不存在或 `planned` 的能力。
3. 按能力参数白名单校验并清洗参数。
4. 校验能力上下线状态；下架原因必须在扣费前返回。
5. 校验输入素材数量、空 id、重复 id 和最低输入数。
6. 校验会员并发限制。
7. 校验项目和素材归属。
8. 校验遮罩、标注等能力特有输入。
9. 校验所选前台模型存在、未归档、启用且支持当前能力。
10. 校验模型输入图片范围。
11. 解析生成意图并解析路由；无可用线路时在扣费前失败。
12. 解析后台覆盖价、线路价和限时免费活动。
13. 调用能力 `outputPlan` 生成模块输出计划。
14. 同一事务内创建任务、创建每张图的账单并预留积分。

任何一步失败都不得留下“已建任务但无账单”或“已扣费但无任务”的半成品。

## 6. 批次与任务模型

### 6.1 输出计划

`detail_image.outputPlan()` 对每个合法模块生成一项：

```ts
{
  key: 'hero',
  label: '首屏主视觉',
  params: {
    section: 'hero',
    sectionLabel: '首屏主视觉',
    sectionPrompt: '用户填写的模块提示词' // 有值时写入
  }
}
```

`outputPlan` 的结果数量决定本批次任务数量。

### 6.2 任务结构

选择 N 个模块时创建 N 个 `GenerationTask`：

| 字段 | 父任务 | 子任务 |
| --- | --- | --- |
| `id` | 独立任务 id | 独立任务 id |
| `parentTaskId` | `null` | 父任务 id |
| `batchId` | N > 1 时写入 | 与父任务相同 |
| `batchIndex` | N > 1 时为 1 | N > 1 时为 2..N |
| `batchSize` | N > 1 时为 N | N > 1 时为 N |
| `section` | 第一个模块 | 对应模块 |
| `sectionLabel` | 第一个模块标签 | 对应模块标签 |
| `sectionPrompt` | 第一个模块提示词 | 对应模块提示词 |
| `creditCost` | 单张价格快照 | 单张价格快照 |
| `billingOrderId` | 独立账单 | 独立账单 |

所有任务共享：

- `projectId`
- `ownerId`
- `capability`
- `inputAssetIds`
- `logicalModelId`
- `logicalModelRevisionId`
- `routeId`
- `channelModelId`
- `routeRun`
- 批次创建时间

父任务和子任务都通过同一套 Worker 流程执行，不存在只负责汇总、不生成图片的协调任务。

### 6.3 事务边界

创建任务、创建 N 条账单、预留 N 份积分在同一个 Prisma 事务中完成：

- 余额不足：整批失败，任务和账单全部回滚。
- 建单异常：整批失败，不留半个批次。
- 幂等键并发冲突：唯一约束只允许一个请求成功，失败方回查赢家任务。
- 事务提交后：所有任务初始状态为 `queued`。

注意：**建单时整批同生共死，不代表运行期也必须整批同生共死**。运行期各任务有独立账单和独立终态。

## 7. 提示词规范

`detail_image.buildPrompt(params)` 为每个任务构造一张模块图的提示词，必须包含：

1. 当前模块名称和专用版式说明。
2. 用户填写的该模块提示词。
3. 商品名称、品牌和商品事实。
4. 参考图只用于商品外观一致的约束。
5. 不得复制参考图背景、人物、文字、水印等要求。
6. 商品结构、颜色、材质、logo、包装和配件必须与参考图一致的约束。
7. 本图允许使用的文案来源。
8. 禁止编造型号、材质、尺寸、参数、认证、销量、价格、优惠和售后承诺。
9. 输出语言、画面比例、画质和目标平台规格。
10. “只生成当前模块的一张独立版块图，不生成整张详情长图”的明确指令。

缺失模块时允许走历史兼容提示词，但新页面提交的每个任务必须带合法 `section`。

## 8. 执行状态机

任务状态：

```text
queued ──CAS 领取──> running ──成功──> succeeded
                         │
                         ├──可确认失败──> failed
                         ├──后台终止────> cancelled
                         └──结果不明────> failed + errorCode=42206 + 账单 uncertain
```

Worker 行为：

- 调度节拍 1 秒。
- 单进程最多同时执行 8 个任务。
- 按创建时间升序领取 `queued` 任务。
- 通过 CAS 从 `queued` 转为 `running`，避免重复执行。
- 运行租约 45 秒，执行期间续租。
- 请求派发、结果轮询、线路切换和产出落盘都在任务内完成。
- 已派发请求结果不明时不得盲目重发，账单转 `uncertain` 等待人工核对。
- 产出图片必须完成存储和 AIGC 标识后才能交付；标识失败按 fail-closed 处理。

## 9. 计费与退款规范

### 9.1 计费

- 价目表中的 `detail_image` 单价按**一张模块图**计。
- N 个模块预留 `N × 单价`。
- 每个任务一条账单。
- 前端展示的预估积分只用于提示，最终以建单响应中的 `creditCost` 为准。
- 后台覆盖价优先于默认价；进行中的限时免费活动可将实际金额置 0。
- 线路切换时新账单必须复用首次建单的定价规则，且不得超过用户原始授权上限。

### 9.2 成功

任务产出图片落盘并完成合规标识后：

1. 任务转 `succeeded`。
2. 绑定输出素材。
3. 对应账单结算。
4. 结算失败不回滚已交付图片，账单转 `uncertain` 等待人工核对。

### 9.3 失败与退款

- 明确失败且上游未产生有效调用时，按该任务账单退款。
- 超时、5xx、连接中断、结果落盘前丢失等“上游可能已产出”的情况，任务失败但账单转 `uncertain`，不自动退款。
- 后台终止已派发任务时不自动退款，转人工核对。
- 零价且无账单的重试任务不产生退款。
- 批次失败通知应聚合，避免 N 个模块刷出 N 条重复站内信。

## 10. 结果拉取与展示

### 10.1 拉取

页面使用：

```http
GET /api/v1/tasks/page?capability=detail_image&limit=100&offset=0
```

`limit` 后端最大值为 100。列表按 `createdAt` 倒序返回，并携带：

- 任务状态
- 任务参数
- 输入素材
- `parentTaskId`
- 输出素材
- `creditCost`
- 创建和更新时间

### 10.2 轮询

- 前端轮询间隔为 1.2 秒。
- 仅当结果列表中存在 `queued` 或 `running` 任务时轮询。
- 所有任务进入 `succeeded` / `failed` / `cancelled` 后停止轮询。
- 请求期间发生登出、切号或新一轮加载时，旧响应必须丢弃，不能写入新会话。
- 轮询失败保留上一次成功结果，不清空已展示图片。

### 10.3 批次聚合

- 有 `batchId`：同一 `batchId` 的任务归为一行。
- 无 `batchId`：每个任务各自成一行，兼容历史单图任务。
- 批内按 `batchIndex` 升序排列。
- 有图片的格子状态为 `ready`。
- `failed` / `cancelled` 格子状态为 `failed`。
- `queued` / `running` 格子状态为 `pending`。
- 批次状态：
  - 任一 `pending`：生成中
  - 同时存在成功和失败：部分失败
  - 全部失败：生成失败
  - 全部成功：已完成
- 原图取任务输入素材；模块标签优先取 `sectionLabel`。

### 10.4 前端提交互斥

当前 `generating` 是页面级状态：只要最近拉取的结果中存在任何 `detail_image` 的 `queued` 或 `running` 任务，提交按钮就保持禁用。

这不是批次级互斥，而是页面级互斥。调整该行为时必须同时考虑：

- 新批次能否与服务端并发限制兼容。
- 旧批次异常挂起时是否应继续阻塞新提交。
- 结果列表是否仍能稳定区分多个进行中的批次。

## 11. 删除规范

前端删除一条批次时：

1. 从批次行中找到 `batchIndex=1` 的任务；找不到时回退第一项。
2. 只调用 `DELETE /api/v1/tasks/:id` 删除父任务。
3. 批次内仍有 `pending` 格子时，删除入口禁用。

后端删除父任务时：

- 删除父任务自身。
- 删除 `parentTaskId` 指向该父任务的全部子任务。
- 删除这些任务的输出素材记录。
- 删除对应存储后端中的文件；文件删除失败不阻塞数据库删除。

如果直接调用 API 删除某个子任务，后端只删除该子任务，不删除整批。

## 12. 安全与可观测性

- 所有项目、素材和任务操作必须校验 `ownerId`。
- 幂等键作用域为用户维度。
- 每次上游请求写入线路尝试和调用日志。
- 任务快照固定 `logicalModelId`、`routeId` 和 `channelModelId`，下游不得静默替换。
- 仅在明确未派发或可切换的失败上切线；结果不明不得切线。
- 产出图片必须通过 AIGC 标识；标识失败不得交付。
- 退款失败属于资损事件，必须显式记录错误日志并告警。

## 13. 规范性不变量

以下条件必须始终成立：

1. 一次提交只携带一个幂等键。
2. 一个合法模块对应一个任务和一条账单。
3. 父任务本身执行一个模块，不是空任务。
4. 同一批任务共享输入素材、模型和线路快照。
5. 任务、账单和积分预留的创建在同一事务内完成。
6. 每个任务只能从非终态通过 CAS 进入一次终态。
7. 已交付图片不能因结算失败被删除。
8. 结果行按 `batchId` 聚合，并按 `batchIndex` 排序。
9. 删除父任务必须连带删除子任务和输出文件。
10. 前端不得自行推算最终扣费金额。

## 14. 当前实现偏差

以下行为与部分注释或产品文案不一致，修改相关代码前必须先确认目标语义。

### 14.1 父任务失败会取消同批子任务

`TaskLifecycleService.fail()` 在任意任务失败后都会调用 `cancelQueuedChildren(taskId)`：

- 父任务失败时，尚未结束的子任务会被取消。
- 普通子任务失败时，其自身没有子任务，因此不会取消兄弟任务。

由于父任务同时是第一个模块，且 Worker 按创建时间领取任务，当前批次可能出现：

- 第一个模块失败：其余模块被连带取消。
- 后续模块失败：其余模块继续生成，最终显示部分失败。

这与 `detail_image` 能力定义及准入层“任一模块失败不影响同批其它模块”的注释不一致。若产品要求模块完全隔离，应仅在管理员终止或显式整批取消时执行连带取消。

### 14.2 示例文案仍描述单张长图

`DetailExamplePanel` 当前文案仍使用“输出一张可上架的详情长图”，与实际 N 张模块图不符。页面文案应描述“生成一套模块详情图”。

### 14.3 能力定义中的旧计费注释

`detail_image.creditCost` 附近仍残留“整次生成统一按价目表扣一次”的旧注释。现行为是单张单价 × 模块数，以 `TaskAdmissionService` 和前端价签为准。

## 15. 变更检查清单

修改详情图生成链路时至少检查：

- 前端模块清单、后端 `DETAIL_SECTIONS` 和模块版式说明是否同步。
- `outputPlan` 产出的数量是否仍受 10 个模块上限约束。
- 每个任务是否仍拥有独立账单。
- 建任务、建账单、预留积分是否仍在同一事务。
- 幂等重试是否返回同一父任务和同一批次。
- 失败路径是否会错误取消兄弟任务。
- 结果列表是否仍按 `batchId` 聚合、按 `batchIndex` 排序。
- 删除父任务是否仍能清理全部子任务和输出文件。
- 文案是否仍错误描述为单张长图。

相关代码测试入口：

- `frontend/src/pages/product-detail/__tests__/`
- `backend/src/capabilities/definitions/detail_image.spec.ts`
- `backend/src/model/tasks/task-admission.service.spec.ts`
- `backend/src/model/tasks/task-lifecycle.service.spec.ts`
- `backend/src/model/tasks/task-worker.service.spec.ts`

测试策略、闸口命令和覆盖矩阵统一维护在 [`testing.md`](testing.md)。
