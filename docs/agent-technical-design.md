# 货觉AI · AI 智能体（Agent）技术方案（v1.0，已过期）

> ⚠️ 本文的「LLM 通道从零新增」「15 项图像能力」「mock 能力」等前提已与当前代码不符。
> 现行方案见 [`agent-integration-design.md`](agent-integration-design.md)。

> 版本：v1.0  
> 日期：2026-10-20  
> 状态：待评审（本文档只做设计，未动代码）  
> 关联：`docs/agent-prd.md`、`CLAUDE.md`



---

## 0. 设计约束（先定边界，避免返工）

以下约束直接来自现有代码，任何方案不得违反：

| #  | 约束                                                                      | 代码依据                                  |
| -- | ----------------------------------------------------------------------- | ------------------------------------- |
| C1 | 能力清单**只在** `capabilities/capability.registry.ts` 定义，Agent 的可调工具必须由它派生   | `CLAUDE.md`「能力清单单一事实源」                |
| C2 | 图像产出必须走 `IMAGE_PROVIDER`（`CapabilityRouterProvider`），Agent **不得**自建生成链路 | `generate.service.ts:109`             |
| C3 | 产出一律落 `GenerationTask` + `Asset`，不新建平行任务表                               | `generate.service.ts:131-150`         |
| C4 | 配置优先级链：env > `ModelChannelConfig` 表 > 代码默认，且 env 最高                     | `channel-config.defs.ts:9-16`         |
| C5 | 通道失败一律回落，**用户始终拿得到结果**，绝不因外部服务故障白屏                                      | `capability-router.provider.ts:79-84` |
| C6 | SQLite 无 enum，所有状态字段 String + DTO/service 白名单                           | `prisma/schema.prisma` 文件头注释          |
| C7 | 版本精确锁定、无 `^`/`~`；新增依赖后跑 `verify:deps:critical`                          | `CLAUDE.md` 环境注意事项 4                  |
| C8 | 沿用 `{ code, data, message }` 信封 + `AppError(code, message, httpStatus)` | `common/app.exception.ts`             |
| C9 | 样式一律用 `var(--token)`，不写裸 hex                                            | `CLAUDE.md` 开发约定                      |

### 关键前置事实

```
backend/package.json 依赖清单中：无 openai / langchain / ai / zod / anthropic
backend/src 全仓搜索 "llm|LLM|model-config"：0 命中
```

**结论：LLM 通道在本项目是从零新增，与现有图像 gateway（`GatewayImageProvider`，任务式轮询）是两套契约不同的通道。** 这是本方案最大的不确定点，已列入 §9 待确认项。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 /agent  （会话 + 计划确认 + 步骤进度）                    │
└───────────────────────┬─────────────────────────────────────┘
                        │ REST + SSE
┌───────────────────────▼─────────────────────────────────────┐
│ AgentModule (NestJS)                                         │
│                                                             │
│  agent.controller.ts    会话/消息/计划确认/步骤重跑            │
│         │                                                   │
│  AgentOrchestrator      ★ 内核：规划→澄清→确认→执行→汇总      │
│    ├── PlannerService     自然语言 → 结构化计划               │
│    ├── ToolRegistry       ★ 能力/查询工具（由 C1 派生）       │
│    ├── StepExecutor       步骤状态机 + 单步重跑 + 积分        │
│    └── ContextService     会话上下文 + style lock             │
│         │                                                   │
│  ┌──────┴─────────────┐                                      │
│  │ 复用既有模块（不改）  │                                     │
│  ├── GenerateService  │ 复用 createTask：建任务、扣积分、落库  │
│  ├── CapabilityRouter │ 复用图像路由 + 回落 (C2/C5)          │
│  ├── CreditsService   │ 复用扣费/退款                        │
│  └── ModelCallLog     │ 复用调用日志 (新增 channel 区分)      │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ LlmProvider（新增，对齐 image-provider.interface.ts 风格）     │
│   └── LlmRouter → GatewayLlmProvider | MockLlmProvider        │
│         · 复用 gateway.config 的配置/缓存/回落三件套模式       │
└─────────────────────────────────────────────────────────────┘
```

**核心设计取向**：Agent 是**编排层**，不是新的生成层。它把自然语言翻译成对现有 15 项能力的调用，全部重活交给已验证的 `GenerateService`。这让 Agent 的风险面极小——即使 Agent 下线，平台功能不受影响。

---

## 2. LLM 通道（新增，对齐既有 Provider 抽象）

### 2.1 接口定义

严格对齐 `providers/image-provider.interface.ts` 的写法（同目录、同风格、零外部依赖）。

```ts
// backend/src/llm/llm-provider.interface.ts

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** tool 角色时的调用 id；assistant 发起 tool_call 时回填 */
  toolCallId?: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON Schema，直接由 capability.registry 派生 (C1) */
  parameters: Record<string, unknown>;
}

export interface LlmCompletionResult {
  text: string;
  /** 模型解析出的结构化输出（走 JSON 模式时非空） */
  parsed?: unknown;
  model: string;
  promptTokens: number;
  completionTokens: number;
  source: 'gateway' | 'local';
}

export interface LlmProvider {
  complete(
    messages: LlmMessage[],
    opts: {
      tools?: LlmToolSpec[];
      temperature?: number;
      maxTokens?: number;
      /** 要求输出可解析 JSON —— 规划/工具选择必须开 */
      jsonMode?: boolean;
    },
  ): Promise<LlmCompletionResult>;
}
```

### 2.2 三件套模式（照抄 `CapabilityRouterProvider` 结构）

| 文件                            | 职责                                       | 对标既有文件                          |
| ----------------------------- | ---------------------------------------- | ------------------------------- |
| `llm/llm-router.provider.ts`  | `LLM_PROVIDER` token 的实现；每次调用前刷配置；失败回落   | `capability-router.provider.ts` |
| `llm/gateway-llm.provider.ts` | 真实 LLM 通道；**用 Node 22 内置 `fetch`，零新增依赖** | `gateway-image.provider.ts`     |
| `llm/mock-llm.provider.ts`    | 规则式降级：解析「做主图/详情图」等关键词 → 给出确定性计划          | `mock-image.provider.ts`        |

**为什么不用 openai SDK**：C7 + `npm` 大批量安装会触发 5 分钟硬超时。chat/completions 契约简单，`fetch` 足够，且与 `gateway-image.provider.ts` 的零依赖风格一致。

### 2.3 LLM 配置项（接入既有后台配置页）

在 `channel-config.defs.ts` 的 `CONFIG_DEFS` 追加，`ConfigGroup` 扩一个 `'llm'`：

```ts
// group: 'llm' 新增项
{ key: 'llm.baseUrl',     label: 'LLM 基址',      type: 'string', envName: 'LLM_BASE_URL',   secret: false }
{ key: 'llm.token',       label: 'LLM 令牌',      type: 'secret', envName: 'LLM_TOKEN',       secret: true }
{ key: 'llm.model',       label: '默认模型',      type: 'string', envName: 'LLM_MODEL' }
{ key: 'llm.enabled',     label: '启用 LLM 通道', type: 'boolean',envName: 'LLM_ENABLED',     default: false }
{ key: 'llm.timeoutMs',   label: '单次调用超时',  type: 'number', envName: 'LLM_TIMEOUT_MS',  default: 60000, min: 3000, max: 300000 }
{ key: 'llm.temperature', label: '采样温度',      type: 'number', envName: 'LLM_TEMPERATURE', default: 0.3,  min: 0, max: 2 }
{ key: 'llm.maxTokens',   label: '单次最大 token',type: 'number', envName: 'LLM_MAX_TOKENS',  default: 2048, min: 128, max: 32000 }
{ key: 'llm.fallback',    label: 'LLM 不可用时降级为表单模式', type: 'boolean', default: true }
```

优先级链天然沿用 C4，无需改动 `ModelChannelConfig` 表结构——**零 schema 改动**即可接入后台配置页。

### 2.4 降级矩阵（严格对齐 C5 与 A-06）

| 场景                                 | 行为                                                                   |
| ---------------------------------- | -------------------------------------------------------------------- |
| LLM 未配置（baseUrl/token 空且未 enabled） | `GET /agent/status` 返回 `llmAvailable:false`，前端直接展示表单模式，**不发 LLM 请求** |
| LLM 超时 / 非 2xx / 解析失败              | `MockLlmProvider` 接管：规则匹配出计划；界面标注「规则降级模式」                            |
| 图像 gateway 失败                      | 任务失败并退款，标 `42204/42201/42205`；本地生成算法已删除，不产出任何图             |
| 用户明确要真实模型但只有 mock 能力               | 界面如实标「占位效果」，不伪装                                                      |

---

## 3. 工具注册表（C1 的派生，而非另立一套）

### 3.1 工具生成

```ts
// backend/src/agent/tool-registry.service.ts

@Injectable()
export class ToolRegistryService {
  /** 由 capability.registry.ts 派生图像工具 —— 单一事实源不破 (C1) */
  private buildImageTools(): LlmToolSpec[] {
    return CAPABILITIES
      .filter((c) => c.mode !== 'planned')          // planned 本就不可提交
      .map((c) => ({
        name: `image_${c.id}`,
        description: `${c.name}。${c.summary}`,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            c.params.map((p) => [p.name, paramToJsonSchema(p)]),
          ),
          required: c.params.filter((p) => p.required).map((p) => p.name),
        },
      }));
  }
}
```

**这是本方案最重要的安全设计**：模型能调用的工具集**在构造上**就是当前真实开放的能力集合，`mode='planned'` 的能力根本不进入工具列表 → **幻觉出不存在的能力在结构上不可能**（PRD 风险表第 1 项）。

`paramToJsonSchema` 按 `ParamType = enum|number|text|boolean` 映射，enum 直接带上 registry 里的合法值，与 `sanitizeParams` 形成双重约束（前端收窄 + 服务端收窄）。

### 3.2 查询类工具（任务型对话用，只读）

| 工具名           | 用途                        | 权限             |
| ------------- | ------------------------- | -------------- |
| `query_works` | 我的作品列表/按能力筛选              | 强制注入 `ownerId` |
| `query_tasks` | 生成任务状态与失败原因               | 强制注入 `ownerId` |
| `query_stats` | 数据中心聚合（复用 `StatsService`） | 强制注入 `ownerId` |
| `list_assets` | 素材库检索                     | 强制注入 `ownerId` |

**安全红线**：所有查询工具的 `ownerId` 由服务端从 JWT 注入，**不接受 LLM 传入的用户标识**。LLM 只能传筛选条件，不能指定查谁的数据。写操作类工具（创建/删除）**不暴露给 LLM**，只能由用户显式确认后由服务端发起。

### 3.3 工具执行

```ts
export interface AgentTool {
  name: string;
  /** 计划阶段：LLM 看到什么 */
  spec: LlmToolSpec;
  /** 执行阶段：真正做什么。mustConfirm=true 的工具必须用户确认后才可调用 */
  execute(args: Record<string, any>, ctx: ToolExecContext): Promise<ToolResult>;
  /** 写操作必须置 true（强制用户确认） */
  mustConfirm?: boolean;
}
```

图像工具的 `execute` 内部**转调 `GenerateService.createTask`**，从而白拿：参数收敛、能力校验、项目归属校验、积分扣减、`ModelCallLog` 记录（C2/C3）。

---

## 4. Agent 内核

### 4.1 执行流程

```
用户消息
   │
   ├─(1) 载入会话上下文 + style lock
   │
   ├─(2) PlannerService.plan()  ── LLM 调用 1 ──►  { steps[], clarifications[], estimateCredits }
   │        ├─ 返回 type=clarify ──► 反问用户 ──(用户答)──► 回到 (2)，带上答案
   │        └─ 返回 type=plan    ──► 落库 run（status='awaiting_confirm'）
   │
   ├─(3) 用户确认 / 调整 / 部分执行
   │
   └─(4) StepExecutor 逐步执行（串行）
            ├─ step.succeeded → 记 taskId/outputAssetId，继续
            ├─ step.failed    → 记 errorCode，整 run 转 'partial'，**不继续后续依赖步**
            └─ 全部完成 → run.status='succeeded'
```

### 4.2 步骤状态机（支撑 A-04 单步重跑）

```
pending ──► running ──► succeeded
              │
              └──► failed ──(retry)──► running        ← 只重跑这一步
                                    │
                              succeeded_steps 保持不变，不重复扣费
```

**重跑语义的关键约束**：`retry` 时**不得**重跑已成功的 step，且需校验依赖——若重跑的 step 产出被后续成功 step 消费，需提示「重跑将使后续产出失效」。

### 4.3 澄清机制（支撑 A-03）

Planner 输出 `clarifications` 时，**禁止猜测**。判定规则（在 `PlannerService` 内，非 LLM 侧）：

```ts
// 歧义判定：registry 声明的参数存在默认值/多选项，但用户表述未收敛
function needsClarification(step: Step, userUtterance: string): boolean {
  const cap = getCapability(step.capability);
  // 关键参数缺失且无安全默认 → 必须澄清
  const missingCritical = step.capability
    && cap.params.filter(p => p.required && !p.hasDefault)
                     .filter(p => !(p.name in step.params));
  return missingCritical.length > 0 || step.assumptions.length > 0;
}
```

`step.assumptions` 是 LLM 被要求**显式列出假设**的字段——只要模型做了假设，就必须让用户确认，这比事后猜测可靠。

### 4.4 风格锁定（PRD 核心卖点）

```ts
interface StyleLock {
  /** 风格描述，注入每次调用的提示词前缀 */
  stylePrompt: string;
  /** 硬约束参数（如固定宽高比、统一背景色） */
  params: Record<string, any>;
  /** 参考图 assetIds —— 供 multi_fusion / hot_remake 等多图能力复用 */
  refAssetIds: string[];
}
```

从首轮对话抽取（如「小红书风格」→ `stylePrompt`，「竖版」→ `params.aspect='3:4'`），**显式作为参数注入每一次调用**，而非依赖模型隐式记忆。执行时把 `stylePrompt` 拼到 `buildPromptFor` 产出的提示词前，保证跨图一致。

---

## 5. 数据模型扩展

**新增 4 个 model，全部 String 字段 + 白名单（C6）。不改动任何既有 model**，故不破坏存量数据。

```prisma
// ── AI 智能体 ────────────────────────────────────────────────────

/// Agent 会话。归属 Project (与既有 Project 归属模型一致, 复用 ownerId 鉴权)
model AgentSession {
  id        String   @id @default(cuid())
  ownerId   String
  projectId String
  title     String   @default("新会话")
  /// style: 'creative'(内容创作) | 'assistant'(对话助手) | 'workflow'(编排)
  style     String   @default("creative")
  /// 是否已进入降级模式 (LLM 不可用)
  degraded  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner   User          @relation(fields: [ownerId], references: [id])
  project Project       @relation(fields: [projectId], references: [id])
  messages  AgentMessage[]
  runs      AgentRun[]
  templates AgentTemplate[]

  @@index([ownerId])
  @@index([projectId])
  @@index([updatedAt])
}

/// 会话消息。role: 'user'|'assistant'|'system'; content 存 markdown
model AgentMessage {
  id        String   @id @default(cuid())
  sessionId String
  role      String
  content   String
  /// 附加结构化数据 (计划快照/步骤结果/引用素材), JSON 字符串
  meta      String?
  createdAt DateTime @default(now())

  session AgentSession @relation(fields: [sessionId], references: [id])

  @@index([sessionId])
  @@index([createdAt])
}

/// 一次 Agent 运行 = 一次计划确认后的完整执行
model AgentRun {
  id        String   @id @default(cuid())
  sessionId String
  ownerId   String
  /// 原始用户输入
  utterance String
  /// 计划快照 JSON (LLM 产出, 冻结不改 —— 便于复现与审计)
  plan      String
  /// status: 'awaiting_confirm'|'running'|'succeeded'|'partial'|'failed'|'cancelled'
  status    String   @default("awaiting_confirm")
  /// 预估积分 (确认前展示) / 实扣积分 (完成后回填)
  estimateCredits Int @default(0)
  actualCredits   Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  session AgentSession @relation(fields: [sessionId], references: [id])
  steps   AgentStep[]

  @@index([sessionId])
  @@index([ownerId])
  @@index([status])
}

/// 单个步骤。**stepIndex 是单步重跑与续跑的锚点**
model AgentStep {
  id       String @id @default(cuid())
  runId    String
  stepIndex Int
  title    String
  /// status: 'pending'|'running'|'succeeded'|'failed'|'skipped'
  status   String @default("pending")
  /// 调用的能力 id (对应 capability.registry 的 id, 或工具名)
  capability String?
  /// 入参 JSON
  params   String  @default("{}")
  /// 产出关联 —— **复用既有任务表 (C3)**, 不建平行任务体系
  taskId   String?
  outputAssetId String?
  errorCode String?
  credits  Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  run AgentRun @relation(fields: [runId], references: [id])

  @@index([runId])
  @@index([stepIndex])
  @@index([status])
}

/// 工作流模板 (P1)。存 run.plan 的可复用副本
model AgentTemplate {
  id        String   @id @default(cuid())
  ownerId   String
  projectId String?
  name      String
  /// 模板化的计划 JSON
  plan      String
  styleLock String?  // JSON
  createdAt DateTime @default(now())

  owner   User           @relation(fields: [ownerId], references: [id])
  session AgentSession? @relation(fields: [sessionId], references: [id])  // 可选来源
  sessionId String?

  @@index([ownerId])
}
```


### 5.1 既有 model 的最小改动

| model | 改动 | 理由 |
| --- | --- | --- |
| `ModelCallLog` | **不改 schema**，LLM 调用复用 `capability='agent_llm'` + `source='gateway'\|'local'` | 零 schema 改动即可纳入现有「模型调用记录」后台页 |
| `GenerationTask` | 不改。Agent 步骤通过 `AgentStep.taskId` 指向既有任务 | C3 |
| `Project` | 加反向关系 `agentSessions AgentSession[]` | 仅关系字段，无数据迁移 |

`GenerationTask` 无需新增字段即可承载 Agent 产出（`capability` 存能力 id、`params` 可附 `_agentRunId`），保持既有形状不变。

---

## 6. 接口契约

全部走 `/api/v1` 前缀 + 统一信封（C8）。需登录，除特别标注。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/agent/status` | `{ llmAvailable, degraded, styles }` —— 前端据此决定进对话模式还是表单模式（免鉴权便于首屏探测） |
| POST | `/agent/sessions` | 创建会话 `{ projectId, style }` |
| GET  | `/agent/sessions` | 会话列表 |
| GET  | `/agent/sessions/:id` | 会话详情（含消息与运行历史） |
| DELETE | `/agent/sessions/:id` | 删除会话（产出图保留在作品库） |
| POST | `/agent/sessions/:id/messages` | 发消息，返回 `runId`（规划可能返回 `clarifications`） |
| GET  | `/agent/runs/:id` | 运行详情（步骤状态机全量） |
| POST | `/agent/runs/:id/confirm` | 确认计划 `{ approvedStepIndexes?: number[] }` |
| POST | `/agent/runs/:id/cancel` | 取消运行 |
| POST | `/agent/steps/:id/retry` | **单步重跑**（A-04 核心接口） |
| GET  | `/agent/templates` / POST | 工作流模板（P1） |

### 流式输出

`POST /agent/sessions/:id/messages` 用 **SSE** 返回 token 流：

```
Content-Type: text/event-stream

event: token
data: {"delta":"已理解，"}

event: plan
data: {"runId":"ckx...","steps":[...],"estimateCredits":12}

event: done
data: {}
```

**为什么 SSE 而非 WebSocket**：单向服务端推送，SSE 走 HTTP 原生、无需额外依赖与升级握手，与现有 REST 完全共存。

---

## 7. 前端接入

新增 `/agent` 路由（`App.tsx` 共 25 条 → 26 条），沿用 `Shell` 布局。

| 文件 | 职责 |
| --- | --- |
| `pages/AgentPage.tsx` | 主页面：会话列表 + 对话区 + 计划卡 + 步骤进度 |
| `components/agent/PlanCard.tsx` | 计划确认卡（继续/调整/部分执行） |
| `components/agent/StepTimeline.tsx` | 步骤状态机时间轴（失败步高亮 + 重跑按钮） |
| `components/agent/OutputGallery.tsx` | 产出网格，**必须透传 `mode` 标注占位效果**（A-05） |
| `hooks/useAgentStream.ts` | SSE 消费（参照现有 `usePollAbort` 风格） |
| `lib/api.ts` | 追加 agent 方法 |

**样式纪律（C9）**：全部 `var(--token)`，不新增裸 hex。品牌紫 `--brand` 为主色，复用现有 `--radius-*` 圆角档位。

**降级路径（A-06）**：`useAgentStream` 收到 `degraded:true` 或 `/agent/status` 返回 `llmAvailable:false` 时，页面顶部挂一条 notice「智能体通道未配置，已切换为手动模式」，并直接渲染现有 `ToolShell` 表单 —— **不显示报错，不空白**。

---

## 8. 分批实施计划

每批结束跑闸口；遵守「跑≠改」，未获授权不擅自改码。

| 批次 | 内容 | 产物 | 闸口 |
| --- | --- | --- | --- |
| **B1** | LLM 通道骨架 | `llm/llm-provider.interface.ts`、`gateway-llm.provider.ts`、`mock-llm.provider.ts`、`llm-router.provider.ts` | `tsc` 通过；断网时回落不抛错 |
| **B2** | 配置接入 | `channel-config.defs.ts` 加 `llm` 组；`env.validation.ts` 加 `LLM_*` | 后台配置页可读写；`verify:deps:critical` |
| **B3** | 工具注册表 | `agent/tool-registry.service.ts` + 4 个 schema 冒烟脚本 | 新增能力的 tool 自动出现（不需改注册表代码） |
| **B4** | Prisma 扩展 | 4 个新 model + 关系字段 | `prisma:push` + seed 幂等 |
| **B5** | 内核 | `AgentOrchestrator`、`PlannerService`、`StepExecutor` | 单轮工具调用闭环（无前端） |
| **B6** | 接口层 | `agent.controller.ts` + DTO 白名单 | `smoke-agent.js`：建会话→规划→确认→产出落库 |
| **B7** | 前端 | `/agent` 页 + 组件 + SSE hook | `tsc --noEmit` + 真实会话录制 |
| **B8** | 降级与容错 | 降级 notice、单步重跑、退款 | A-04/A-05/A-06 实测 |

**B1→B4 无用户可见变化**，可并行推进；B5 是唯一有架构风险的一批，建议单独评审。

---

## 9. 待确认与风险

| # | 事项 | 影响 | 建议 |
| --- | --- | --- | --- |
| Q1 | **LLM 通道走哪个服务**？现有 `GATEWAY_BASE_URL`（图像任务式契约 `POST /generation/tasks`）**不具备** chat/completions 能力 | 决定 B1 实现方式 | 二选一：① 网关补 LLM 端点，沿用 `LLM_BASE_URL`；② 直连第三方 chat/completions，密钥走 `ModelChannelConfig`。**推荐 ②**，与图像通道解耦，互不影响 |
| Q2 | 是否允许 SSE（HTTP 长连接） | 部署层反代需支持 | 若 nginx 需 `proxy_buffering off` 配置 |
| Q3 | token 是否向用户计价 | 影响积分策略 | 本期建议不计价，仅成本核算 |
| Q4 | Agent 会话是否入 `Project` | schema 已按「入 Project」设计 | 确认后可简化 |
| Q5 | SQLite 并发写 | 高频会话可能锁竞争 | 消息批量写 + 单会话串行；必要时 WAL |

### 已识别风险

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| LLM 输出计划不稳定（步骤数忽多忽少） | 中 | 提示词强约束 + JSON schema 校验；步骤数上限硬裁剪；计划冻结后不可变 |
| 风格一致性不足以支撑卖点 | 中 | style lock 显式注入，不依赖模型记忆；参考图走 `refAssetIds` |
| 图像 gateway 与 LLM 双通道配置分散 | 低 | 统一在后台「模型配置」页分组展示 |
| `mock` 能力经 Agent 后被当成真实产出 | 中 | `OutputGallery` 强制透传 `mode` 标注（A-05 明确验收） |

---

## 10. 与现有规范的一致性检查

| 规范项 | 本方案的落实 |
| --- | --- |
| 能力清单单一事实源（C1） | ToolRegistry 由 registry 派生，无平行清单 |
| 新能力不改前端 | 新能力 → 自动进 tool 列表 → 自动可被 Agent 调用 |
| 配置 env 优先于 DB（C4） | `llm.*` 配置项同款优先级链 |
| 失败回落不空手（C5） | LLM 与图像双层回落 |
| 响应信封（C8） | 全部接口同款 |
| 样式 token（C9） | 前端组件全部 `var(--token)` |
| 依赖纪律（C7） | LLM 用内置 `fetch`，**零新增运行时依赖** |
| 不代 commit / 不擅自跑闸口 | 遵循，本文只做设计未动代码 |
