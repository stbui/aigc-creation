# 货觉AI · Agent 集成方案（v2）

> 版本：v2.0  
> 日期：2026-10-25  
> 状态：方案设计，未实施  
> 取代：`docs/agent-technical-design.md`（v1.0 的「LLM 从零新增」前提已过期）  
> 关联：`docs/agent-prd.md`、`docs/model-architecture.md`、`CLAUDE.md`

---

## 1. 结论先行

**推荐路线：在货觉 NestJS 后端内新增 `AgentModule`，做成受控的多步骤创作编排器，而不是把 `agent/` 的 Codex Web 直接嵌进用户端。现有工作台、工具页和画布全部保留，Agent 作为并行入口接入同一套能力与任务底座。**

四条不可变的集成原则：

1. **Agent 只做规划，不直接执行任意工具。** LLM 输出声明式计划，服务端校验后由 `StepExecutor` 调用既有服务。
2. **能力清单仍以 `capability.registry.ts` 为唯一事实源。** 新能力自动进入 Agent 可规划范围，不维护第二份能力表。
3. **生成必须复用 `GenerateService.createTask`。** 扣积分、建任务、路由、回落、退款、AIGC 标识、产出入库全部沿用现有链路。
4. **LLM 走现有 `TEXT_PROVIDER`。** 不新增 LangChain、OpenAI SDK 或第二套模型客户端；规划调用写 `ModelCallLog`。

`agent/` 目录中的 Codex Web 是**本机研发工具**：它允许受控沙箱内的文件与命令操作，只有单进程内存会话和可选静态 Token，没有货觉账号、项目、积分、素材归属与审计体系。它可以作为交互与 SSE 的实现参考，但不应部署为面向用户的 Agent 服务。

### 1.1 候选路径对比

| 维度 | A. 嵌入 Codex Web | B. 货觉内建 AgentModule（推荐） | C. 独立 Agent 微服务 |
| --- | --- | --- | --- |
| 用户界面 | 现成聊天与时间线 | 在现有 SPA 内原生实现 | 独立前端或嵌入 |
| 账号与权限 | 需另造 SSO 与租户隔离 | 直接复用 JWT、项目、素材归属 | 需服务间鉴权与 Token 传递 |
| 生成与计费 | 无货觉任务/积分链路 | 直接复用 `GenerateService` | 需跨服务调生成与积分，一致性复杂 |
| 安全边界 | Codex 拥有沙箱内命令/文件能力 | 仅接受声明式计划，无任意执行 | 可隔离，但攻击面仍取决于实现 |
| 交付成本 | 界面最快，产品化最慢 | 中等 | 最高 |
| 适用阶段 | 内部研发演示 | 当前 MVP | 多团队/高并发阶段 |

选择 B 的核心原因：**Agent 的难点不在聊天框，而在账号、素材归属、计费、任务和退款的一致性。**这些能力货觉已经具备，放在同一模块内复用，风险和工作量都最低。

### 1.2 决策上下文

| 问题 | 本方案假设 |
| --- | --- |
| 产品形态 | 现有 Web SPA 内新增 `/agent` |
| 运行环境 | 现有 NestJS 单实例 + SQLite，后续可迁移 |
| 项目规模 | MVP，先验证「自然语言 → 多步生图」价值 |
| 数据方案 | 继续使用 Prisma/SQLite，新增 4 张 Agent 表 |
| 前后端分工 | 现有单体模块化后端 + Vite SPA |
| 扩展预期 | 新能力自动进入目录；多实例与队列明确延后 |

---

## 2. 现状与差距

### 2.1 已经具备的基础

| 基础 | 现状 | 对 Agent 的价值 |
| --- | --- | --- |
| 能力注册表 | `backend/src/capabilities/capability.registry.ts` 聚合 16 项能力，参数、提示词、模态、积分价均自包含 | 直接派生计划目录与校验规则 |
| 文生文通道 | `TEXT_PROVIDER` / `TextCapabilityRouter` 已支持 OpenAI 兼容 `chat/completions`、多渠道调度和文本调用日志 | 规划不需要新建 LLM 基础设施 |
| 生成任务 | `GenerateService.createTask` 已统一校验、扣费、建任务、路由、回落、退款与入库 | Agent 不再造平行任务体系 |
| 异步执行 | `GenerationTask` 有心跳、孤儿恢复、失败退款 | Agent 步骤可围绕任务状态做恢复 |
| 账号与归属 | `JwtAuthGuard`、`Project`、`Asset.ownerId` 均已存在 | 所有查询与写入都可按当前用户强隔离 |
| SSE 参考实现 | `agent/src/app.mjs` 已演示 POST + SSE、事件增量、取消与断线处理 | 可复用协议与前端解析思路，不复用运行时 |

### 2.2 必须纠正的旧前提

旧技术方案 `docs/agent-technical-design.md` 中以下判断已失效：

- 当时没有文本模型通道；现在已有 `TEXT_PROVIDER` 和后台模型配置。
- 当时说「8 项 mock 能力」；现在 `mode` 只有 `real | planned`，占位实现已删除。
- 当时按 15 项图像能力设计；现在注册表包含视频能力，Agent 规划应按 `modality` 而不是写死「只出图」。
- 当时建议新建 LLM Provider；现在应扩展现有 `TextProvider` 的上下文参数与埋点，而不是再造一层。

### 2.3 与现有产品能力的关系

Agent 是**新增入口，不是替代入口**。现有工作台、工具页、素材库、作品页、积分与后台管控全部保留，二者共用同一套底座：

| 维度 | 现有手动路径 | Agent 路径 | 是否共用 |
| --- | --- | --- | --- |
| 能力定义 | `/capabilities` | `CatalogService` 派生 | 是，均来自 `capability.registry.ts` |
| 参数校验 | 页面表单 + DTO + `sanitizeParams` | `PlanValidator` + `sanitizeParams` | 是，服务端最终口径一致 |
| 生成任务 | `POST /generate` | `StepExecutor → GenerateService` | 是，同一 `GenerationTask` |
| 积分与退款 | `GenerateService` | `GenerateService` | 是，同一账本与退款规则 |
| 产出 | `Asset` | `Asset` | 是，同时出现在素材库与我的作品 |
| 上下线/改价 | 后台能力管理与模型配置 | 同一运行时目录 | 是，后台操作对两端同时生效 |

因此不允许出现以下分叉：

- 不允许为 Agent 新建一套「Agent 专用能力」或「Agent 专用作品」。
- 不允许 Agent 绕过 `GenerateService` 直接调用 Provider。
- 不允许在 Agent 页复制一份能力参数表。
- 不允许 Agent 上线后隐藏或改写现有工具页入口。

这一原则同时满足两类用户：愿意用自然语言的人走 Agent，需要精确控制或先在画布上操作的人继续走现有页面；两边产出的任务、作品与积分记录可以互相衔接。

---

## 3. 范围

### 3.1 P0：能形成闭环

- 自然语言 → 结构化计划 → 用户确认 → 串行执行 → 产出进「我的作品」。
- 覆盖注册表中全部可提交的生成能力（当前 16 项，含图片与视频），新能力加入注册表后自动进入目录。
- 需要画布、框选等精确人工输入的能力，可交给现有工具页继续；Agent 携带项目、素材与已填参数，不丢上下文。
- 关键输入缺失或有歧义时先澄清，不猜测。
- 支持选择当前项目素材，以及从已有作品选择参考图。
- 多步骤之间可用前一步产出作为后一步输入。
- 计划阶段展示预估积分，执行阶段逐步真实扣费。
- 步骤失败可单步重试，不重复执行已成功步骤。
- LLM 不可用时降级为手动能力选择，不白屏、不 5xx。
- SSE 展示规划与执行进度；断线后可通过快照重新对齐。

### 3.2 P1：增强

- 只读数据查询（作品、任务、统计、素材）。
- 工作流模板保存与复用。
- LLM token 级流式输出、会话摘要与长期记忆。
- 后台 Agent 运行记录、提示词版本与独立模型路由。

### 3.3 明确不做

- 不向用户暴露 shell、文件系统、任意 HTTP、浏览器或代码执行。
- 不让 LLM 直接调用 `GenerateService` 或数据库。
- 不做跨用户 Agent 市场、多智能体协作、自动发布。
- P0 不实现多实例任务队列；当前 SQLite/单实例架构下保持单执行者语义。

### 3.4 现有能力覆盖矩阵

| 现有产品能力 | Agent P0 关系 | 说明 |
| --- | --- | --- |
| 16 项生成能力（`CAPABILITIES`） | **全部可进入 Agent 计划** | 能直接执行的走 `GenerateService`；需要画布精确输入的走 handoff |
| `local_redraw` 局部重绘 | 可直接规划；精确涂抹时 handoff | 无遮罩时可用声明中的 `region + prompt` 执行；需要遮罩时转交 `/local-redraw` 画布 |
| `sku_image` 商品 SKU 图 | 可直接规划；精确框选时 handoff | 无框选时可用区域枚举执行；需要多区域框选时转交 `/product-sku` |
| `image_to_video` 图生视频 | 可直接规划执行 | 与图片能力使用同一任务、积分、作品体系 |
| AI 润色 / 图片转提示词 | 保留现有入口；P1 可接入对话 | P0 不把文本工具包装成生成步骤，避免任务语义混乱 |
| 上传 / 素材库 / 项目 | Agent 直接复用 | 作为规划输入与素材引用；不另建素材体系 |
| 我的作品 / 数据中心 / 积分 | 保留现有入口；P1 增加只读查询 | P0 产出照常进入我的作品，本轮不做自然语言查数 |
| 购买套餐 / 订单 / 账号 / 工单 | 保留现有入口 | Agent 不做支付、注销等高风险交易动作 |
| 运营后台 | 保留现有入口 | P1 可增加 Agent 运行记录，不让用户端 Agent 操作后台 |

「全部支持」不等于「全部自动完成」。对于本质上需要用户手绘或框选的能力，Agent 的职责是把自然语言能确定的部分准备好，再安全地交给现有页面；这比假装能自动完成任务更可靠。

---

## 4. 总体架构

```text
┌──────────────────────────────┐   ┌────────────────────────────────────┐
│ frontend `/agent`（新增）      │   │ 现有工作台 / 工具页 / 画布（保留）    │
│ 会话 · 计划 · 步骤 · 产出       │   │ 精确参数 · 涂抹 · 框选 · 原有表单     │
└──────────────┬───────────────┘   └─────────────────┬──────────────────┘
               │ REST + POST SSE                     │ 现有 REST
┌──────────────────────────────▼──────────────────┐  │
│ backend/src/agent (NestJS AgentModule)          │  │
│                                                 │  │
│ AgentController   会话 / 消息 / 确认 / 重试       │  │
│ AgentOrchestrator 规划 → 澄清 → 确认 → 执行       │  │
│  ├─ PlannerService  自然语言 → PlanDraft         │  │
│  ├─ PlanValidator   服务端校验                    │  │
│  ├─ StepExecutor    串行执行 / 恢复               │  │
│  ├─ CatalogService  由 registry 派生目录          │  │
│  └─ SessionService  会话 / 消息 / 风格锁           │  │
│                                                 │  │
│ 复用：TEXT_PROVIDER · GenerateService            │  │
└──────────────────────────┬──────────────────────┘  │
                           │ createTask / 任务查询    │ createTask / 上传
                           └──────────────┬───────────┘
                                          ▼
┌──────────────────────────▼───────────────────────────────────┐
│ 既有生成链路                                                  │
│ GenerateService → IMAGE_PROVIDER / VIDEO_PROVIDER            │
│ → GenerationTask → Asset → 我的作品 / 素材库 / 后台调用记录      │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 为什么 Agent 是编排层

Agent 的职责只有三件事：

1. 把自然语言收敛成可验证的步骤。
2. 在用户确认后按顺序调用既有能力。
3. 把进度、失败原因和产出如实反馈给用户。

它不拥有新的模型通道、新的任务表或新的积分体系。这样即使 Agent 功能整体下线，原有工作台与工具页也不受影响。

图中两条前端路径最终都落到同一个 `GenerateService.createTask`：Agent 只是把自然语言翻译成任务，现有页面仍然直接提交任务。任何一边产生的 `GenerationTask`、`Asset`、积分流水，另一边都能看到并继续使用。

---

## 5. 运行流程

### 5.1 规划

```text
用户消息 + 素材引用 + 当前会话风格锁
        │
        ▼
PlannerService
  ├─ 读取最近 N 条消息
  ├─ 读取 CatalogService 的可用能力目录
  ├─ 调 TEXT_PROVIDER.generate('agent_plan', ...)
  └─ 解析为 PlanDraft
        │
        ▼
PlanValidator
  ├─ 不合法：带错误修复重试 1 次
  │          仍不合法 → 返回 clarify / 降级手动模式
  ├─ 信息不足或有假设 → clarify
  ├─ 需要画布/框选等人工输入 → handoff
  └─ 可执行 → 冻结计划，落 AgentRun(status='awaiting_confirm')
```

规划阶段**不扣积分、不建生成任务**。计划确认后，才逐步骤进入执行。每条用户消息对应一条 `AgentRun`：

- 需要澄清时，本次运行落 `awaiting_input`；用户回答后创建下一条运行。
- 形成可执行计划时，本次运行落 `awaiting_confirm`。

### 5.2 PlanDraft 契约

```ts
type PlanDraft =
  | {
      kind: 'clarify';
      questions: Array<{ key: string; text: string; options?: string[] }>;
      partialPlan?: PlanStep[];
    }
  | {
      kind: 'handoff';
      capability: string;
      reason: string;
      assetRefs: string[];
      prefill: Record<string, unknown>;
    }
  | {
      kind: 'plan';
      title: string;
      styleLock?: StyleLockDraft;
      steps: PlanStep[];
      notes?: string[];
    };

interface PlanStep {
  ref: string;                    // s1 / s2，仅用于本计划内引用
  capability: string;             // 必须来自 CatalogService
  title: string;
  inputRefs: string[];            // asset:A1 / step:s1.output
  dependsOn: string[];            // 必须指向前序 step
  params: Record<string, unknown>;
  assumptions: string[];          // 有任何假设就必须确认
}

interface StyleLockDraft {
  promptPrefix: string;
  params: Record<string, string | number | boolean>;
  assetRefs: string[];
}
```

硬限制由服务端执行，不能只依赖提示词：

- 单次计划最多 6 步。
- 每步只能引用已选素材或更早步骤的产出。
- 参数只允许能力声明中非 `hidden` 的 key。
- 能力必须存在、非 `planned`、当前未被后台下线。
- 输入素材数量必须满足 `CapabilityPlugin.inputs`。
- 计划 JSON 最大 32 KB；超出直接判失败，不写入数据库。

`kind='handoff'` 时只生成服务端可信的跳转描述：路由由能力 id 映射（复用 `toolPath`），不允许模型给任意 URL；`prefill` 只包含非 `hidden` 参数，素材仍以服务端解析后的归属为准。

handoff 本身不创建任务、不扣积分、不改变会话项目；用户在现有工具页完成操作时，仍按该页面原有的生成与计费规则执行。

### 5.3 确认与执行

```text
awaiting_confirm
      │ POST /agent/runs/:id/confirm
      ▼
running ──► step 1 running ──► succeeded ──► step 2 running ...
  │              │                  │
  │              └─ failed ─────────┘
  │                         │
  ├─ 用户取消后续步骤 ──► cancelled
  ├─ 某步失败且无后续可执行 ──► partial / failed
  └─ 全部成功 ──► succeeded
```

每个步骤调用一次 `GenerateService.createTask(ownerId, dto)`：

- `projectId` 来自会话，服务端再次校验归属。
- `capability`、`inputAssetIds`、`params` 已由 `PlanValidator` 规范化。
- 真实扣费、任务创建、模型路由、失败退款全部沿用既有实现。
- 拿到 `taskId` 后，Agent 通过 `GenerateService.getTask` 在服务端轮询，直到 `succeeded | failed`。
- 成功后记录 `outputAssetId`，供后续步骤引用；失败后记录 `errorCode`，停止依赖该步骤的后继步骤。

**不要**在 Agent 内直接调用 IMAGE/VIDEO Provider，也不要复制 `GenerateService` 中的扣费与任务创建逻辑。

同一会话同时只允许一个 `planning | running` 运行；同一用户最多 2 个活跃运行。前端必须在发送后禁用重复提交，服务端仍以状态条件更新兜底。

### 5.4 单步重试

重试只允许针对 `failed` 步骤：

- 重新创建一条 `GenerationTask`，`retriedFromId` 指向原任务。
- `AgentStep.attempt` 累加；历史任务的失败现场通过 `GenerationTask.retriedFromId` 链追溯。
- 已成功步骤及其产出保持不变。
- 若后续步骤曾消费该失败步骤的产出，则后续步骤本来就不会成功；重试成功后只继续执行处于 `pending/skipped` 的下游步骤。
- 任何重试都必须再次经过 `GenerateService` 的真实扣费与退款流程，不做「免费重跑」。

重启恢复产生的 `partial` 运行通过 `POST /agent/runs/:id/resume` 继续：执行器只拾取 `pending` 步骤，不重跑 `succeeded` 步骤。

### 5.5 取消与断线

必须区分三种行为：

| 行为 | 语义 |
| --- | --- |
| 关闭 SSE / 刷新页面 | **不取消任务**。生成已付费且在后台运行，用户重新进入会话看快照。 |
| 停止后续步骤 | 设置 `cancelRequested=true`；当前生成任务继续，执行器不再启动下一步。 |
| 管理员终止任务 | 沿用现有后台任务终止与退款能力。 |

P0 不承诺中断正在执行的外部模型调用；如果用户要求强制终止，由后台任务终止路径处理。

### 5.6 进程重启恢复

启动时执行一次轻量恢复：

- `AgentRun.status='planning'` 且超过 2 分钟：标记失败，错误码 `AGENT_PLAN_INTERRUPTED`。
- `AgentStep.status='running'` 且已有 `taskId`：读取对应 `GenerationTask`。
  - 任务成功 → 步骤补记为成功，运行转 `partial`，等待用户点击「继续剩余步骤」。
  - 任务失败 → 步骤补记为失败，运行转 `partial`。
  - 任务仍在运行 → 交给 `GenerateService` 的启动恢复逻辑。
- `AgentRun.status='running'` 但没有任何 running 步骤：标记 `partial`，错误码 `AGENT_EXECUTOR_RESTARTED`，由用户手动重试。

宁可让用户重试，也不要自动重放可能已扣费或已产出文件的步骤。

---

## 6. 能力目录与计划校验

### 6.1 由注册表派生，而不是手写

`CatalogService` 从 `CAPABILITIES` 派生：

```ts
interface AgentCapabilitySpec {
  id: string;
  name: string;
  summary: string;
  modality: 'image' | 'video';
  inputs: number;
  creditCost: number;       // CreditPriceService 的运行时价
  enabled: boolean;         // CapabilityAvailabilityService
  params: Array<{
    key: string;
    type: 'enum' | 'number' | 'text' | 'boolean';
    options?: Array<string | number>;
    default?: unknown;
    min?: number;
    max?: number;
    maxLength?: number;
  }>;
}
```

过滤规则：

- `mode='planned'` 不进入目录。
- `runtime.enabled=false` 不进入目录。
- `param.hidden=true` 默认不进入目录；需要页面代填的技术参数由服务端从上下文补齐。
- `creditCost` 必须使用运行时价，不能读 `def.creditCost` 静态值。
- **不得因为存在 `hidden` 参数就把能力排除出目录。** 若缺少的 `hidden` 参数是可选/有安全默认值，正常规划；若它必须由用户交互产生，则生成 `handoff`，而不是静默删掉该能力。

这样新增能力只需改 `definitions/`，Agent 目录自动更新；能力下线后模型也无法再规划它。`local_redraw` 的遮罩、`sku_image` 的精确框选都按「可执行则执行，不可执行则 handoff」处理。

### 6.2 素材引用不直接暴露真实 ID

用户消息中把当前可用素材映射为短期符号：

```text
A1 → asset_xxx（当前用户、当前项目）
A2 → asset_yyy（当前用户从素材库选择的素材）
```

LLM 只能引用 `asset:A1`。服务端再把符号解析为真实 `assetId`，并再次校验 `ownerId + projectId`。

收益：

- 模型不可能通过编造 ID 读取其他用户素材。
- 模型不需要记住 25 位 cuid。
- 计划可读、可审计，素材引用与真实归属解耦。

### 6.3 参数校验与规范化

`PlanValidator` 依次执行：

1. 能力存在、可提交、当前在线。
2. 步骤引用无环，`dependsOn` 只能指向前序步骤。
3. `inputRefs` 数量满足 `inputs`，来源属于当前用户。
4. 参数 key 属于能力声明，`hidden` 参数禁止模型填写。
5. enum 值必须命中声明选项；number 收敛到 `min/max`；text 按 `maxLength` 截断。
6. 服务端重新计算积分，不接受模型给出的价格。
7. 尝试调用 `sanitizeParams` 做最后一层收敛，并比对是否有静默丢参。

校验失败时允许一次「带错误原因重新规划」，避免一次 JSON 小错就整轮失败；第二次仍失败则返回澄清或降级手动模式。

---

## 7. 风格锁定

### 7.1 数据形状

```ts
interface StyleLock {
  promptPrefix: string;             // 例如「小红书家居风，暖白背景，柔和自然光」
  params: Record<string, string | number | boolean>; // 只允许能力已声明的公共参数
  assetRefs: string[];              // 风格参考图，符号 A1/A2
}
```

风格锁在计划确认时冻结到 `AgentRun.styleLock`，本轮执行中不随会话后续修改而变化。

执行时按能力声明合并：`promptPrefix` 通过 `stylePrompt` 注入；`params` 只合并到该能力实际声明、且不属于 `hidden` 的 key，其余项忽略并在计划卡明示。这样风格锁不会突破能力的参数白名单。

### 7.2 注入方式

为了让风格对所有能力生效，建议给生成入参加一个受控的可选字段：

```ts
// CreateGenerationDto
stylePrompt?: string; // <= 500 字符，仅 Agent 与显式高级入口使用
```

`GenerateService` 在 `sanitizeParams` 之后把它存为任务内部参数 `__stylePrompt`；`buildPromptFor` 统一前置：

```ts
const base = plugin.buildPrompt(sanitizedParams, refCount);
const style = sanitizedParams.__stylePrompt;
return style ? `${style}。${base}` : base;
```

这样不需要为每项能力单独维护「哪个参数是提示词」的映射，也不会出现新增能力忘记接风格锁的问题。

### 7.3 不能保证时的诚实降级

若某项能力没有可注入提示词的通道（例如纯几何旋转），计划卡明确显示「该步骤仅继承比例/画质参数，不继承风格描述」，而不是暗示整组图风格完全一致。

---

## 8. 接口设计

### 8.1 接口清单

| 方法 | 路径 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| GET | `/api/v1/agent/status` | Agent 是否可用、降级原因、默认模型展示名 | 否 |
| POST | `/api/v1/agent/sessions` | 创建会话 | 是 |
| GET | `/api/v1/agent/sessions` | 分页会话列表 | 是 |
| GET | `/api/v1/agent/sessions/:id` | 会话、消息、最近运行快照 | 是 |
| DELETE | `/api/v1/agent/sessions/:id` | 删除会话，产出保留 | 是 |
| POST | `/api/v1/agent/sessions/:id/messages` | 发送消息并规划，返回 POST SSE | 是 |
| POST | `/api/v1/agent/runs/:id/confirm` | 确认并执行，返回 POST SSE | 是 |
| POST | `/api/v1/agent/runs/:id/resume` | 重启恢复后继续剩余 pending 步骤，返回 POST SSE | 是 |
| POST | `/api/v1/agent/runs/:id/cancel` | 停止后续步骤 | 是 |
| POST | `/api/v1/agent/steps/:id/retry` | 重试失败步骤，返回 POST SSE | 是 |
| GET | `/api/v1/agent/runs/:id` | 运行快照，断线恢复/轮询兜底 | 是 |

所有普通 JSON 接口继续使用 `{ code, data, message }` 信封；SSE 接口通过 `@Res()` 直接写响应，不使用信封。

存在 `planning | awaiting_confirm | running` 运行时的会话不允许直接删除，返回 409 并提示先取消；避免前端删掉会话后后台仍在执行。

### 8.2 创建会话

```http
POST /api/v1/agent/sessions
Authorization: Bearer <jwt>
Content-Type: application/json

{ "projectId": "proj_xxx", "title": "夏季桌面风扇整套图" }
```

服务端必须校验 `project.ownerId === currentUser.id`。前端可复用 `useProject().ensureProject()` 获取项目；未登录时在发送动作处唤起登录弹窗。

### 8.3 发送消息

```http
POST /api/v1/agent/sessions/:id/messages
Authorization: Bearer <jwt>
Content-Type: application/json
Idempotency-Key: 4adf...

{
  "clientMessageId": "c-01",
  "text": "用这张商品图做一套小红书风格主图、详情图和 SKU 图",
  "assetIds": ["asset_xxx"]
}
```

返回 `text/event-stream`。`clientMessageId` 在会话内唯一；重复提交从同一运行的当前快照继续推送事件，不重复调用 LLM。

### 8.4 确认运行

```http
POST /api/v1/agent/runs/:runId/confirm
Authorization: Bearer <jwt>
Content-Type: application/json
Idempotency-Key: 9c13...

{
  "selectedStepRefs": ["s1", "s2", "s3"],
  "stepOverrides": {
    "s1": { "params": { "ratio": "3:4" } }
  }
}
```

`stepOverrides` 只允许修改目录中非 `hidden` 的参数；服务端必须重新执行完整 `PlanValidator` 并重新计算预估积分，再把覆盖后的计划写回 `AgentRun.plan`。不允许借覆盖绕过能力、素材或积分校验。

确认动作必须用条件更新抢占：

```ts
updateMany({
  where: { id: runId, ownerId, status: 'awaiting_confirm' },
  data: { status: 'running', confirmedAt: new Date() },
});
```

只有 `count === 1` 的请求可以启动执行器；重复点击不会重复建任务或重复扣费。

### 8.5 SSE 事件

```text
event: planning.started
data: {"runId":"run_x","at":"2026-10-25T..."}

event: plan.ready
data: {"run":{"id":"run_x","status":"awaiting_confirm","estimateCredits":30,...}}

event: step.started
data: {"stepIndex":0,"capability":"main_image","taskId":"task_x"}

event: step.succeeded
data: {"stepIndex":0,"taskId":"task_x","outputAssetId":"asset_y"}

event: run.completed
data: {"status":"succeeded","actualCredits":30}
```

事件集合：

- `planning.started`
- `plan.ready`
- `clarify.required`
- `handoff.ready`
- `run.started`
- `step.started`
- `step.progress`
- `step.succeeded`
- `step.failed`
- `run.completed`
- `degraded`
- `notice`
- `ping`（注释行心跳，每 15 秒）

P0 不做 LLM token 级流式输出。原因：真实产出是中英混合的纯 JSON，逐 token 展示既没有阅读价值，也无法在流式过程中做结构校验。用户首字响应由 `planning.started` 立即满足；真正的“进展感”来自步骤 SSE。

规划流在 `plan.ready | clarify.required | degraded` 后关闭；执行流在 `run.completed` 后关闭。客户端不得把「流结束」当成「任务失败」，必须以最后快照或 `GET /agent/runs/:id` 为准。

### 8.6 SSE 接入细节

- 使用 `fetch + ReadableStream`，不用原生 `EventSource`。原生 EventSource 不能设置 `Authorization` 头，把 JWT 放 query 会进入访问日志。
- 服务端设置 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`。
- Nginx 现有 `/api/` 反代已允许 300 秒长请求；心跳 15 秒足以避免空闲超时。
- 客户端断开只结束流，不终止已确认的后台任务。
- 每个事件带单调递增 `seq`；断线后重新 `GET /agent/runs/:id` 拿快照，不依赖事件重放表。

---

## 9. 数据模型

新增 4 个模型，不建平行任务表；`GenerationTask` / `Asset` 继续作为唯一任务与产出事实源。

```prisma
model AgentSession {
  id          String   @id @default(cuid())
  ownerId     String
  projectId   String
  title       String   @default("新会话")
  styleLock   String   @default("{}") // JSON
  lastMessageAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner    User          @relation(fields: [ownerId], references: [id])
  project  Project       @relation(fields: [projectId], references: [id])
  messages AgentMessage[]
  runs     AgentRun[]

  @@index([ownerId, updatedAt])
  @@index([projectId])
}

model AgentMessage {
  id              String   @id @default(cuid())
  sessionId       String
  role            String   // 'user' | 'assistant' | 'system'
  content         String
  meta            String?  // 计划快照、素材引用、模型名等 JSON
  clientMessageId String?
  createdAt       DateTime @default(now())

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, clientMessageId])
  @@index([sessionId, createdAt])
}

model AgentRun {
  id              String   @id @default(cuid())
  sessionId       String
  ownerId         String
  projectId       String
  utterance       String
  plan            String   @default("{}") // 冻结后的计划 JSON
  styleLock       String   @default("{}") // 本轮冻结的样式锁
  status          String   @default("planning")
  // planning | awaiting_input | awaiting_confirm | running | handoff | succeeded | partial | failed | cancelled
  estimateCredits Int      @default(0)
  actualCredits   Int      @default(0)
  cancelRequested Boolean  @default(false)
  errorCode       String?
  confirmedAt     DateTime?
  expiresAt       DateTime? // 待确认计划的过期时间，默认 24 小时
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  steps   AgentStep[]

  @@index([sessionId, createdAt])
  @@index([ownerId, status])
  @@index([status, updatedAt])
}

model AgentStep {
  id              String   @id @default(cuid())
  runId           String
  stepIndex       Int
  ref             String
  title           String
  capability      String
  inputRefs       String   @default("[]") // JSON
  inputAssetIds   String   @default("[]") // 服务端解析后的真实资产
  dependsOn       String   @default("[]") // JSON
  params          String   @default("{}")
  status          String   @default("pending")
  // pending | running | succeeded | failed | skipped
  taskId          String?
  outputAssetId   String?
  estimateCredits Int      @default(0)
  actualCredits   Int      @default(0)
  attempt         Int      @default(1)
  errorCode       String?
  startedAt       DateTime?
  finishedAt      DateTime?

  run AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, stepIndex])
  @@index([runId, status])
  @@index([taskId])
}
```

同步给 `User`、`Project` 增加反向关系字段即可，不改既有字段含义。

`ModelCallLog` 增加 nullable 字段（历史记录保持 `null`，不回填猜测值）：

```prisma
model ModelCallLog {
  // ...既有字段
  agentRunId        String?
  promptTokens      Int?
  completionTokens  Int?

  @@index([agentRunId])
}
```

---

## 10. 计费、成本与可观测性

### 10.1 用户计费

- 规划阶段不收费、不创建任务。
- 计划卡展示 `estimateCredits = Σ(runtimePrice(capability))`，并展示当前余额。
- 确认后每一步由 `GenerateService.createTask` 真实扣费。
- 失败由既有 `GenerateService` 自动退款，Agent 不二次退款。
- 未执行步骤不扣费。
- LLM token 成本 P0 不向用户计费，仅内部核算。

余额不足属于正常业务结果：执行到该步骤时停止，运行转 `partial`，UI 显示「余额不足，后续 N 步未执行」，提供充值入口。

### 10.2 LLM 调用记录

复用 `ModelCallLog` 与 `TextCapabilityRouter` 的日志能力，并补齐以下信息：

- 写入既有 `ownerId`：用于按用户核算 Agent 成本。当前 `ImageCallLogger` 未写入该列。
- 新增 `agentRunId`、`promptTokens`、`completionTokens`：关联规划运行与成本。

实现方式建议扩展 `TextProvider.generate` 的可选第四参数：

```ts
interface TextCallContext {
  ownerId?: string;
  agentRunId?: string;
}

generate(capability, messages, params, context?: TextCallContext): Promise<TextOutcome>;
```

现有调用方不传即可保持行为不变；`TextCapabilityRouter` 将 context 传给 logger，并写 `capability='agent_plan'`、`modality='text'`。

### 10.3 运行指标

至少记录：

- 规划耗时、修复重试次数、clarify 比例。
- 每个运行的步数、预估/实扣积分、成功率、失败错误码。
- 每步实际 provider（`gateway` / `local`）与耗时。
- LLM token 用量与模型名。

日志必须带 `sessionId`、`runId`、`stepId`、`ownerId`，便于串联请求、模型调用与生成任务。

---

## 11. 前端集成

### 11.1 入口

- 新增懒加载路由 `/agent`，挂在现有 `AppLayout` 内。
- 侧栏在「工作台」上方增加「AI 创作」入口；顶导增加一个高优先级 CTA。
- 未登录可浏览页面，发送消息、上传素材、确认计划时唤起现有登录弹窗。

### 11.2 页面结构

```text
┌───────────────┬──────────────────────────────┬──────────────────┐
│ 会话列表       │ 对话 + 计划卡 + 步骤时间线      │ 项目素材 / 风格锁   │
│ 新建/删除      │ 输入框 + 附件 + 发送/停止        │ 余额 / 预估消耗     │
└───────────────┴──────────────────────────────┴──────────────────┘
```

核心组件：

- `AgentPage.tsx`：页面编排与会话切换。
- `AgentConversation.tsx`：消息与流式状态。
- `PlanCard.tsx`：计划、假设、预估积分、确认/调整/降级。
- `StepTimeline.tsx`：步骤状态、失败原因、单步重试。
- `AgentOutputGallery.tsx`：产出与「查看作品 / 再创作」。
- `ManualCapabilityPicker.tsx`：LLM 不可用或用户拒绝计划时的手动入口。
- `HandoffCard.tsx`：需要画布/框选时展示原因与「继续在原工具页完成」，自动携带项目和素材上下文。
- `hooks/useAgentStream.ts`：`fetch` + SSE 解析、取消、重连快照。

结果卡必须如实展示：

- 实际 `provider`：新任务为真实模型通道；历史任务可能为已停用的本地产出。
- `creditCost`：该步骤真实扣费。
- AIGC 标识信息。
- 失败错误码与可操作建议。

### 11.3 降级

以下三种情况进入手动模式，而不是报错白屏：

1. `/agent/status.available === false`：顶部提示「智能规划暂不可用」，直接展示能力选择器。
2. 规划连续校验失败：展示原始需求、校验原因和「手动选择能力」按钮。
3. 确认时余额不足：展示预估/余额与充值入口，保留计划 24 小时供充值后继续。

---

## 12. 安全设计

| 风险 | 对策 |
| --- | --- |
| 越权读取素材/项目 | `ownerId` 只从 JWT 注入；素材符号在服务端解析并二次校验归属 |
| LLM 编造能力或参数 | 能力目录由注册表派生；计划只接受目录内 id 与声明参数 |
| LLM 发起任意操作 | 模型只产出 JSON，不拥有工具调用权；服务端只暴露白名单动作 |
| 重复确认导致重复扣费 | `clientMessageId` 唯一索引 + 条件更新抢占运行 |
| SSE 泄露 Token | 使用 Bearer 头 + fetch 流，不把 token 放 query |
| Prompt 注入 | 用户文本只作为数据段；系统提示固定；计划必须过结构校验 |
| 超长/恶意输入 | 消息与计划长度上限、步骤上限、素材数量上限、每用户限流 |
| 成本失控 | 每用户规划限流、单会话单运行、步骤上限、积分预检与逐步扣费 |
| 错误泄露内部信息 | 对外统一错误码；通道细节只进后台日志，不原样回显密钥或上游地址 |

建议限流：

- `POST /agent/sessions/:id/messages`：10 次/分钟/用户，20 次/小时/用户。
- `POST /agent/runs/:id/confirm`：5 次/分钟/用户。
- 单个用户同时最多 2 个 `planning` 或 `running` 运行。

---

## 13. 失败与降级矩阵

| 故障 | 用户看到 | 系统行为 |
| --- | --- | --- |
| 文本通道未配置 | 手动模式，不显示 5xx | `/agent/status` 返回不可用原因；不调用 LLM |
| 规划超时/失败 | 「暂时无法生成计划」+ 重试/手动入口 | 运行落 `failed`，不扣积分 |
| 计划 JSON 非法 | 一次自动修复；仍失败则手动入口 | 校验器拒绝落库 |
| 某步生成失败 | 步骤红色 + 错误码 + 重试 | 既有退款；运行 `partial` |
| 余额不足 | 未执行步骤列表 + 充值入口 | 停止后续，不预扣未来步骤 |
| 进程重启 | 会话保留；运行显示可重试 | 恢复器只对齐状态，不重复执行 |
| 前端断线 | 后台继续跑，重新进入可看快照 | SSE 断开不等于取消任务 |
| 视频任务较长 | 持续心跳与步骤进度 | SSE 心跳保活，任务侧轮询等待 |

---

## 14. 测试与验收

### 14.1 必测用例

| 编号 | 场景 | 判定 |
| --- | --- | --- |
| AG-01 | 「做一套主图+详情+SKU」 | 返回结构化计划，步骤引用合法能力 |
| AG-02 | 缺少商品图 | 返回 clarify；不创建生成任务、不扣积分 |
| AG-03 | 模型编造能力 id | 校验拒绝，不产生任务与扣费 |
| AG-04 | 用户确认计划 | 每步创建 `GenerationTask`，产出进「我的作品」 |
| AG-05 | 某步失败 | 该步退款，后续依赖步不执行，运行 `partial` |
| AG-06 | 单步重试 | 只新建一次任务，已成功步骤不重复扣费 |
| AG-07 | 重复点击确认/重复消息 ID | 不重复建任务、不重复扣费 |
| AG-08 | 文本通道停用 | 手动模式可用，不 5xx、不白屏 |
| AG-09 | 越权素材/项目 | 403/404，不泄露存在性 |
| AG-10 | 前端断线后重进 | 快照状态与后台一致 |
| AG-11 | 进程重启 | 不重复执行已完成步骤 |
| AG-12 | 规划调用 | `ModelCallLog` 可按 `agentRunId` 查到模型、耗时、token |
| AG-13 | 能力覆盖矩阵 | 遍历 `SUBMITTABLE_CAPABILITY_IDS`，每项都能生成可校验的最小计划或显式 handoff |
| AG-14 | 局部重绘精确涂抹 | 返回 handoff，路由为 `/local-redraw`，不创建任务、不扣积分 |
| AG-15 | 新增能力 | 只改 `definitions/` 后，目录覆盖测试与 Agent 可规划列表自动更新 |
| AG-16 | 双入口回归 | Agent 上线后现有 `/capabilities`、`/generate`、`/tasks`、`/works` 行为不变 |

### 14.2 测试层

- 单元测试：`PlanValidator`、`CatalogService`、状态机与条件更新。
- 覆盖测试：以 `SUBMITTABLE_CAPABILITY_IDS` 为输入逐个生成最小合法计划；任何能力只能在「可执行」或「可 handoff」中二选一，不允许从 Agent 视野消失。
- 集成测试：假 `TEXT_PROVIDER` + 假生成任务，覆盖规划、确认、失败、重试、恢复。
- HTTP 冒烟：`smoke-agent.js`，验证鉴权、幂等、归属与响应形状。
- 浏览器 E2E：登录 → 建会话 → 发消息 → 确认 → 看到步骤与产出 → 刷新恢复。
- 回归：原有 `/generate`、`/tasks`、`/capabilities`、`/works` 不受影响。

### 14.3 验收边界

- 不允许用单元测试自评代替真实模型会话录制。
- 「风格一致」需人工看 3 张以上同会话产出，不能只看流程跑通。
- 任何一步失败都必须能在数据库看到 `AgentStep.errorCode` 与 `GenerationTask.errorCode` 两层现场。

---

## 15. 分批实施

| 批次 | 内容 | 交付判据 |
| --- | --- | --- |
| A0 | 扩展 TextProvider 调用上下文与 ModelCallLog 字段；补 `agent_plan` 埋点 | 假规划调用可落库；现有提示词工具不回归 |
| A1 | Prisma 四表 + CatalogService + PlanValidator | 单测覆盖非法能力、参数、素材与依赖 |
| A2 | PlannerService + 会话接口 + SSE 基础设施 | 消息可返回 clarify/plan；重复请求幂等 |
| A3 | StepExecutor + 确认执行 + 单步重试 + 恢复 | 单步与多步真实任务闭环；失败退款正确 |
| A4 | `/agent` 前端 + 计划卡 + 时间线 + 手动降级 | 浏览器真实会话可完成一套图 |
| A5 | 观测量、限流、冒烟脚本与文档 | AG-01～AG-12 全过；依赖闸口通过 |

建议按 1 名全栈工程师估算 12–18 个工作日；其中 A2/A3 是风险最高批次，应单独技术评审后再开工。

---

## 16. 关键取舍与待确认项

### 16.1 已做出的取舍

| 取舍 | 原因 |
| --- | --- |
| 不直接集成 Codex SDK | 用户端不需要 shell/文件能力，且多租户隔离成本远高于收益 |
| LLM 不直接调用工具 | 计划可审计、可校验；模型故障不会直接产生资损动作 |
| P0 不做 token 流式 | 结构化 JSON 流式展示价值低；事件流已提供即时反馈 |
| 不做积分预占 | 复用现有逐步扣费最稳；预占需要新的账本语义与失败回滚 |
| 不做事件重放表 | 运行/步骤快照已能恢复 UI；避免多一张高速增长的表 |
| 不自动恢复执行 | 避免进程重启后重复扣费或重复产出 |

### 16.2 需要产品确认

1. P1 是否把 AI 润色/图片转提示词与「查询我的任务/统计」纳入 Agent？P0 仅生成能力，文本工具与查数保留现有入口。
2. 计划预估积分与余额不足时，是允许部分执行，还是必须先充值？
3. 会话是否必须绑定项目；是否允许一个会话跨项目引用素材？
4. Agent 会话与运行记录的留存期是否沿用 90 天？
5. 是否允许用户手动编辑计划中的参数后再确认（建议允许，但只开放非 hidden 参数）？

在以上问题确认前，推荐按本文默认值推进：**P0 覆盖全部 16 项生成能力、Prompt 工具与查数保留现有入口、允许部分执行、会话绑定项目、留存 90 天、允许编辑非 hidden 参数**。
