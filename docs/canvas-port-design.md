# 无限画布全量移植方案

规划中（未实施）。最后更新 2026-11-09。

来源：`open-ai-canvas`（MIT，`https://github.com/ddcat-ai/open-ai-canvas`）。本方案的目标是把上游画布及其直接业务域**全量移植**到货觉，功能与业务规则对齐，技术栈按本仓改写。

实现级细节（文件落点、数据结构、协议算法、边界条件、验收闸口）见 [`canvas-detailed-design.md`](canvas-detailed-design.md)；本文只保留范围、架构与工作分解。

## 1. 范围与口径

### 1.1 全量范围

| 域 | 内容 |
| --- | --- |
| 画布文档 | 节点 / 连线 / Frame 分组 / 图层组 / 批量表格 / 分镜 / 脚本 / 绘图 / SVG / HTML / 全景 / 对比 / 图表 |
| 编辑体验 | 视口缩放平移、框选、对齐、快捷键、右键菜单、小地图、节点搜索、撤销重做 |
| 协作 | 编辑租约、WebSocket presence、提交后失效通知、多端重连 |
| 历史 | 自动快照、手动/回滚快照、资源引用保护 |
| 分享 | 公开只读页、token 轮换与过期、媒体资源代理、metadata 清洗 |
| 生成 | 图片 / 视频 / 音频 / 文本四模态，批量、重试、断点恢复、结果回填 |
| Agent | cloud agent run、工具集、审批、事件流、画布变更撤销、记忆 |
| 创作会话 | creation-runs 全流程（claim / propose / submit / execute / canvas-commit） |
| 项目联动 | 短剧项目与单元挂载、TapNow / LibTV 导入 |
| 扩展业务 | 角色库、Live2D、Previs 3D、情绪、艺术评审、媒体转换 |
| 管理端 | 画布外观、绘图引擎、运行策略、配额、存储只读保护 |
| 运维 | 修复 CLI、限流、审计、可观测、备份恢复 |

### 1.2 已定技术口径

1. **数据库与缓存：PostgreSQL + Redis**。不保留 SQLite 双轨。**Redis 是生产硬依赖**：`REDIS_URL` 非空、scheme 合法且连通才允许生产启动，`/health/ready` 纳入 Redis 探针；「单实例内存 Hub + 前端 2 秒轮询」降级仅允许 development / test。多实例下的全局限流、缓存失效广播、定时任务分布式锁一并收敛到 Redis。
2. **前端：shadcn 重画**。不引入 antd，不保留两套 UI 体系。
3. **Agent 与 3D 扩展排在最后实现**，但属于最终交付范围，不做功能裁剪。

### 1.3 不照搬的部分

- 上游 Go/Gin/GORM、cookie session、antd 6、React Query 列表页外壳不照搬，按本仓 NestJS/Prisma/JWT/shadcn 改写。
- 上游遗留的死代码 `internal/model/canvas_extensions.go`、`repository/canvas_extensions.go` 不迁移。
- 上游 `yingce:*` 本地存储键不沿用；本仓是新增功能，无存量草稿，直接使用新命名空间。

## 2. 事实基线

上游实测规模（用于排期与复用判断）：

| 项 | 数量 |
| --- | --- |
| 后端涉及画布的 Go 文件 | 230 个 / 77,051 行（不含测试） |
| 后端画布相关测试 | 220 个文件 / 50,488 行 |
| 前端画布组件 | 198 个 / 59,166 行 |
| 前端画布页面 | 56 个 / 19,835 行 |
| 前端画布引擎 `lib/canvas` | 216 个 / 25,651 行 |
| 前端 services / stores / types | 13,767 + 999 + 774 行 |
| 前端画布测试 | 132 个 / 14,272 行（89 个为纯逻辑测试） |
| 画布专属表 | 7 张 |

可复用部分：`lib/canvas` 纯逻辑约 2.4 万行、核心渲染 8 个文件约 4,800 行、同步/生成服务约 6,000 行、89 个纯逻辑测试。这些都不依赖 antd。

## 3. 目标架构

### 3.1 基础设施

| 组件 | 用途 | 本仓落点 |
| --- | --- | --- |
| PostgreSQL 16 | 主库；行锁、advisory lock、JSON 文本、迁移 | Prisma `provider = "postgresql"` |
| Redis 7 | **生产硬依赖**：实时 pub/sub、presence 设备号、全局限流、缓存失效广播、定时任务分布式锁 | `backend/src/redis/**` + `REDIS_URL`（生产必填） |
| Prisma Migrate | 生产迁移；不再使用 `db push` | `backend/prisma/migrations/**` |
| pg_dump / pg_restore | 备份恢复 | 重写 `backend/src/admin/backup.service.ts` |

### 3.2 后端模块

```
backend/src/canvas/
├── canvas.module.ts
├── canvas-projects.controller.ts      # /canvas-projects
├── canvas-operations.controller.ts    # PATCH /:id/operations
├── canvas-realtime.gateway.ts         # WebSocket
├── canvas-share.controller.ts         # 分享与公开代理
├── canvas-history.controller.ts       # 快照列表/恢复（上游没有，本仓新增）
├── application/
│   ├── operations.service.ts          # 7 种操作 + create_canvas
│   ├── mutation-receipt.service.ts    # 幂等回执
│   ├── document.service.ts            # 读取/校验/媒体引用
│   ├── edit-lease.service.ts
│   ├── snapshot.service.ts
│   ├── share.service.ts
│   └── realtime-hub.service.ts
├── domain/
│   ├── canvas.types.ts
│   ├── operations.contract.ts
│   ├── capability.registry.ts
│   ├── generation.contract.ts
│   └── errors.ts
└── infra/
    ├── canvas.repository.ts           # CAS / 行锁 / 事务
    ├── redis-hub.ts
    └── public-projection.ts
```

### 3.3 前端模块

```
frontend/src/
├── lib/canvas/**                      # 引擎与纯逻辑，整体移植
├── services/canvas/**                 # 同步、实时、生成、分享
├── stores/canvas/**                   # zustand 文档/历史/UI/主题
├── pages/canvas/
│   ├── index.tsx                      # 画布项目库
│   ├── project.tsx                    # 编辑器编排（拆成 5–7 个模块）
│   └── shared.tsx                     # 公开只读页
├── components/canvas/**               # 节点、面板、对话框、工具栏
└── pages/admin/canvas/**              # 后台画布设置
```

### 3.4 生成与模型

- 新增 4 个画布能力：`canvas_image` / `canvas_text` / `canvas_video` / `canvas_audio`，`inWorkbench: false`，`mode: 'real'`，走现有 `/generate` 与 `GenerationTask`。
- 节点类型到能力 id 的映射在 `capability.registry.ts` 单一维护。
- 画布任务复用现有渠道 / 前台模型 / 路由 / 账单 / 退款 / worker，不另建 provider 链路。
- 普通用户生成结果由前端通过 operations 写回；服务端只允许 Agent、创作会话、修复等受信任路径写回。

## 4. 数据模型

PostgreSQL + Prisma。所有表带 `ownerId`，所有查询必须带 `ownerId` 条件。

| 表 | 关键字段 | 约束 |
| --- | --- | --- |
| `CanvasProject` | `id`, `ownerId`, `projectId?`, `title`, `payload`, `revision BigInt`, `createdAt`, `updatedAt` | `payload` 用 `String @db.Text`，不用 `Json`；索引 `(ownerId, updatedAt)`、`(ownerId, projectId, updatedAt)` |
| `CanvasMutationReceipt` | `id`, `ownerId`, `canvasId`, `mutationId`, `payloadDigest`, `resultJson`, `revision`, `createdAt` | `@@unique([ownerId, canvasId, mutationId])`；随画布删除清理 |
| `CanvasEditLease` | `ownerId`, `canvasId`, `nodeId`, `sessionId`, `token`, `expiresAt` | 复合主键；30 秒 TTL |
| `CanvasSnapshot` | `id`, `canvasId`, `ownerId`, `revision`, `title`, `nodeCount`, `connectionCount`, `payloadBytes`, `payload`, `reason`, `createdAt` | `@@unique([canvasId, revision])` |
| `CanvasSnapshotResource` | `snapshotId`, `assetId` | 复合主键；对 `Asset` 设 `onDelete: Restrict` |
| `CanvasShare` | `id`, `ownerId`, `canvasId`, `tokenHash`, `tokenCipher`, `enabled`, `expiresAt` | `@@unique([ownerId, canvasId])`，`tokenHash @unique` |
| `CanvasUnitLink` | `id`, `ownerId`, `projectId`, `canvasId`, `unitId`, `role` | `@@unique([projectId, canvasId, unitId])` |

文档 JSON 顶层白名单：`title` / `projectId` / `chatSessions` / `activeChatId` / `starterMode` / `appearance` / `backgroundMode` / `showImageInfo` / `previsScenes` / `timeline`。节点必须有 `id`、`type`；连线字段是 `id` / `fromNodeId` / `toNodeId`。

行的 `title` / `projectId` / `revision` / 时间戳是权威值，读取时覆盖 payload 内同名字段。

## 5. 接口清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/canvas-projects` | 列表；`page` / `pageSize` / `projectId` / `q` / `sort` |
| GET | `/api/v1/canvas-projects/:id` | 文档；ETag `W/"canvas-<revision>"`，命中返回 304 |
| GET | `/api/v1/canvas-projects/:id/sync-status` | `revision` / `serverTime` / `leases` / `agent` |
| POST | `/api/v1/canvas-projects/:id/edit-lease` | `acquire` / `renew` / `release` |
| PATCH | `/api/v1/canvas-projects/:id/operations` | 唯一写入口 |
| DELETE | `/api/v1/canvas-projects/:id` | 删除；有活跃租约拒绝 |
| GET | `/api/v1/canvas-projects/:id/history` | 快照列表（新增） |
| POST | `/api/v1/canvas-projects/:id/history/:snapshotId/restore` | 回滚（新增） |
| GET | `/api/v1/canvas-projects/:id/share` | 分享状态 |
| POST | `/api/v1/canvas-projects/:id/share` | 开启 / 过期 / 轮换 |
| DELETE | `/api/v1/canvas-projects/:id/share` | 关闭分享 |
| GET | `/api/v1/canvas-projects/:id/realtime-ticket` | 60 秒一次性 WS 票据（新增） |
| WS | `/api/v1/canvas-projects/:id/realtime` | 握手校验票据 |
| GET | `/api/v1/public/canvas-shares/:token` | 公开文档 |
| GET | `/api/v1/public/canvas-shares/:token/resources/:assetId/file` | 资源代理，支持 Range |

错误码新增一段（建议 `423xx`），与现有 `422xx` 区分：字段冲突、对象缺失、并发写、租约冲突、`mutationId` 复用、非法基线、媒体未就绪、资源缺失、存储只读、配额超限。

## 6. 关键协议

### 6.1 Operations

请求信封：

```ts
{
  mutationId: string;            // 1..160
  baseRevision?: number;         // 仅校验与 create_canvas 分支使用
  operations: CanvasOperation[]; // 1..500
  editProofs?: { nodeId, sessionId, token }[];
}
```

操作类型：`create_canvas`（必须是首条，仅画布不存在时允许）、`create_node`、`patch_node`、`remove_node`、`create_connection`、`update_connection`、`remove_connection`、`set_field`。

- `patch_node` 必须有非空 `patch` 与 `before`，按叶子路径比较基线。
- `remove_node` / `update_connection` / `remove_connection` 必须有 `expected`。
- `remove_node` 级联删除相关连线。
- `set_field` 只允许顶层白名单字段。
- `baseRevision` **不是**硬 CAS；冲突靠字段基线 + DB revision CAS。

### 6.2 幂等

- 摘要：`sha256(canonicalJson(request without editProofs))`，算法带版本号。
- 回执按 `(ownerId, canvasId, mutationId)` 唯一；摘要一致回放旧结果，摘要不同返回「mutationId 复用」错误。
- 回执随画布删除清理，另有 TTL 清理任务。

### 6.3 并发（PostgreSQL）

1. 事务内 `SELECT ... FOR UPDATE` 锁定 `CanvasProject` 行，或使用 `pg_advisory_xact_lock(hashtext(canvasId))`。
2. 读取最新文档，应用 operations。
3. 条件更新：`WHERE id = ? AND ownerId = ? AND revision = ?`，`revision = revision + 1`；影响行数不为 1 时返回并发冲突。
4. 进程内再加 per-canvas 互斥锁，减少无效事务。

### 6.4 实时

- WebSocket，服务端事件：`welcome` / `peer` / `leave` / `invalidate` / `heartbeat`。
- 客户端只允许发送 `presence`（光标、拖拽节点），80 条/秒上限，读限制 32KB。
- 15 秒心跳与身份复核；吊销账号或删除画布以 1008 关闭。
- Redis 房间 key：`canvas:realtime:v1:<ownerId>:<canvasId>`；设备号 1..64 用 sorted set + Lua。
- 生产不启用降级：Redis 缺失或不可达由启动门禁 / 健康探针拦截；「单实例内存 Hub + 前端 2 秒轮询」降级仅允许 development / test。
- **文档写入任何环境都不依赖 Redis**，实时链路故障不得阻塞 `PATCH /operations`。

### 6.5 分享

- token 32 随机字节，数据库只存 SHA-256 与密文；`rotate` 后旧链接立即失效。
- 公开文档按 metadata allow-list 清洗，删除 `storageKey` / `taskId` / `taskStatus` / `errorDetails` 等。
- 媒体统一改写为公开资源代理 URL；代理校验 token、过期、资源 allow-list。

### 6.6 生成回填

- 画布任务：`GenerationTask.capability = canvas_image|canvas_text|canvas_video|canvas_audio`，`projectId` 关联画布自动创建的隐藏项目。
- 创建任务时扣费，失败/取消按快照退款；沿用现有账单与 worker。
- 前端轮询 / 订阅任务状态，完成后通过 operations 写回节点 metadata 与新 Asset。
- 服务端受信任写回（Agent/创作）必须带任务围栏，避免覆盖用户已改节点。

## 7. 工作分解

### P0 基础设施迁移（20–35 人日）

- Prisma provider 改为 `postgresql`，删除自研 `node-sqlite-adapter.ts`，接入 Prisma PostgreSQL adapter。
- 建立 baseline migration，改用 `prisma migrate deploy`；更新 `scripts/db-url.js`、seed/smoke/reset 脚本。
- 本地与生产 compose 增加 postgres / redis 服务、健康检查、持久卷。
- 重写备份服务：`pg_dump --format=custom` + `pg_restore --list` 校验；Docker 镜像加入 postgresql-client。
- 集成测试改为独立 Postgres schema；测试数据清理策略更新。
- 环境变量：`DATABASE_URL`、`REDIS_URL` 加入 `ENV_SPECS`、`.env.example`、三档 env；生产门禁拒绝 `file:` 开头的 `DATABASE_URL`，要求 `REDIS_URL` 非空、scheme 合法且连通；`/health/ready` 增加 Redis 探针。
- 多实例状态收敛：全局限流、目录/积分价缓存失效广播、定时任务分布式锁改走 Redis（现为进程内存，多实例下会放大配额与旧价窗口）。
- 现有 SQLite 数据迁移脚本（若已有生产数据）：按外键顺序搬迁、行数与校验和比对；无数据则记录为空迁移。

### B1 后端画布内核（55–80 人日）

- 7 张表、索引、级联规则、迁移。
- 列表 / 读取 / ETag / 删除。
- operations 全协议、幂等回执、字段基线、revision CAS。
- 媒体引用校验与配额。
- 错误码与响应信封。
- 移植上游 operations / user_data 测试，补集成测试。

### B2 协作、历史、分享（45–65 人日）

- 编辑租约与 `editProofs` 校验。
- `sync-status`。
- WS Gateway、票据鉴权、Redis Hub、设备号。
- 快照写入、节流、资源保护、历史列表与恢复接口。
- 分享 CRUD、公开投影、资源代理、限流与安全头。

### B3 生成、能力与 Agent 后端（85–125 人日）

- 4 个画布能力定义与节点映射。
- 画布任务接入、批量、重试、恢复、结果物化。
- Agent：run、工具、审批、SSE、`canvas_updated`、撤销、记忆。
- creation-runs 状态机。
- 短剧链接、TapNow / LibTV 导入。
- 修复 CLI。

### F1 前端引擎与同步（25–35 人日）

- 整体移植 `lib/canvas`，补齐 `zustand` / `localforage` / `@tanstack/react-query` / `json-canonicalize` / `leafer-ui`。
- 移植 89 个纯逻辑测试并先跑绿。
- 保留不变量：`data-canvas-world-layer`、`--canvas-live-scale`、4 个 `canvas:*` CustomEvent、空间索引 cell 1024、渲染预算 720/5000、LOD 0.23/0.27。
- 本地文档、变更日志、三方 rebase、冲突恢复。

### F2 前端编辑器（95–135 人日）

- DOM 世界层 + SVG 连线 + Leafer 覆盖层。
- 选择、连线、节点操作、撤销重做、渲染模型控制器。
- 全部节点类型、36 个属性/编辑弹窗、批量表格、分镜、脚本、资产托盘、工作台面板。
- 拆分上游 3,700 行的 `project.tsx`。
- 9,673 行画布 CSS 迁入本仓令牌体系。
- antd 组件替换：`App.useApp()` 49 处、Button 56、Input 36、Modal 20、InputNumber 11、Popover 10、Dropdown 10、Slider 6、Segmented 6、ColorPicker 5。
- 需新增的 shadcn 件：`command`、`resizable`、`scroll-area`、`toggle-group`；手写 `color-picker`、`number-input` 到 primitives。

### F3 前端业务扩展（80–115 人日）

- 生成执行器、批量、恢复、分享页。
- Agent 面板、会话、审批、提示词优化。
- 短剧、角色库、Live2D、Previs 3D、全景、情绪、艺术评审、媒体工具。
- 绘图引擎切换（tldraw / Excalidraw）。

### A1 管理端与生产化（60–90 人日）

- 后台页面：画布外观、绘图引擎、运行策略、配额、存储只读。
- `permissions.ts`、`adminNav.ts`、`ADMIN_MENU`、审计接入。
- 站点设置：画布开关、短剧开关、配额、快照保留。
- 可观测：WS 连接数、mutation 延迟、冲突率、payload 体积、快照体积。
- 安全：租户隔离、公开分享清洗、HTML/SVG XSS、沙箱 iframe、CSP。
- 性能：渲染预算、空间索引、4MB payload、gzip、慢消费者剔除。
- 部署：Vite `ws: true`、Nginx `Upgrade` / `Connection`、`client_max_body_size`、WS 超时。
- 文档与 NOTICE。

### QA 与发布（30–45 人日）

- 132 个画布测试 + 新增后端集成测试 + 关键 e2e。
- 压测：大文档、多人 presence、批量生成。
- 灰度与回滚预案。

**合计约 495–725 人日**。5–6 人团队约 6–8 个月；单人全职约 24–34 个月。

## 8. 里程碑

Agent 与 3D 扩展按要求排在最后；此前里程碑不减少最终功能。

| 里程碑 | 内容 | 周期 |
| --- | --- | --- |
| M0 基础设施 | Postgres + Redis + 迁移 + 备份 + CI | 3–4 周 |
| M1 文档内核 | 表、operations、媒体校验、后端测试 | 4–6 周 |
| M2 编辑器 | 引擎、渲染、交互、本地持久化、外壳 | 8–10 周 |
| M3 生成 | 4 模态、批量、重试、回填 | 4–5 周 |
| M4 协作 | 租约、WS、invalidate、快照、历史 | 4–5 周 |
| M5 分享与业务 | 分享、短剧、角色库、导入、后台 | 6–8 周 |
| M6 Agent 与 3D | Agent、creation-runs、Previs、Live2D | 8–10 周 |
| M7 生产化 | 性能、安全、e2e、灰度、上线 | 4–6 周 |

## 9. 生产化要求

| 维度 | 要求 |
| --- | --- |
| 鉴权 | 所有私有接口 JWT；WS 用一次性票据；分享接口公开但限流 |
| 多租户 | 每条查询带 `ownerId`；公开分享只暴露 allow-list |
| 限流 | 写入按用户、租约 240 次/分、分享 120 次/分/IP、资源 300 次/分/IP |
| 审计 | 后台画布设置、配额、存储切换写审计 |
| 备份 | PostgreSQL 逻辑备份 + 恢复演练；上传目录单独备份 |
| 高可用 | **生产必须 Redis**（`REDIS_URL` 启动门禁 + `/health/ready` 探针，不启用内存降级）；WS 支持跨实例扇出；文档写入不依赖 Redis |
| 可观测 | 结构化日志、请求追踪、WS/冲突/快照指标 |
| 安全 | HTML/SVG 节点沙箱、CSP、XSS 清洗、分享 token 哈希存储 |
| 性能 | 渲染预算、空间索引、payload 上限、慢消费者断开 |
| 回归 | 四层测试 + 画布专项 e2e + 压测报告 |

## 10. 测试与验收

必须先让上游 89 个纯逻辑测试在本仓跑绿，再补本仓用例：

- operations：首建、幂等重放、摘要冲突、字段级冲突、删除级联、连线端点校验、非法基线。
- 并发：两端改不同字段可合并；同字段后写冲突；revision CAS 失败重试。
- 租约：获取、续期、过期、抢占、无凭据修改 authored 字段被拒。
- 实时：多标签页 presence、断线重连、invalidate 重拉、64 会话上限、80 条/秒上限。
- 历史：5 分钟节流、20 条上限、恢复前后快照、资源引用阻止删除。
- 分享：轮换失效、过期失效、metadata 清洗、Range 请求。
- 生成：`projectId` 绑定、四模态回填、批量并发、失败退款、断点恢复。
- e2e：创建、拖拽、缩放、框选、连线、撤销、协作、离线恢复、分享、生成。

## 11. 文档与许可

实施时同批更新：

- `docs/api-contract.md`：画布接口、错误码、WS 协议。
- `docs/runtime-infrastructure.md`：Redis、WS、限流。
- `docs/environments.md`、`docs/docker-deployment.md`：Postgres / Redis 变量与编排。
- `docs/testing.md`：画布覆盖矩阵与 e2e 清单。
- `README.md`、`CLAUDE.md`：技术栈、目录、数量口径。
- `NOTICE`：画布子系统派生声明（MIT，Copyright (c) 2026 ddcat and Open AI Canvas contributors）。

## 12. 风险

| 风险 | 对策 |
| --- | --- |
| Postgres 迁移影响全仓（备份、测试、脚本） | 独立 M0，先完成并演练，再开始画布 |
| 摘要跨语言不稳定 | canonical JSON + 版本号；迁移窗口不复用旧回执 |
| antd 替换量大且易漏 | 先产出 49 处 `App.useApp()` 清单，CI 禁止 `from 'antd'` |
| 上游无历史 HTTP 接口 | 按新增接口排期，不按「已有历史」估 |
| 生成链路两套模型 | 能力定义单一事实源，禁止画布私建 task |
| Agent / 3D 域体量大 | 独立工作流，排在最后，画布核心不被绑死 |
| Redis 故障影响编辑 | 生产硬依赖：启动期连通门禁 + 运行期探针，不静默降级（降级仅 development / test）；文档写入不依赖 Redis，故编辑写入不受影响 |
| 公开分享泄露 | metadata 白名单 + 资源 allow-list + CSP + 限流 |
| 单人排期失真 | 按工作流并行，M0–M3 至少 2 后端 + 2 前端 |

## 13. 第一批可执行任务

1. 完成 P0：Prisma 切 Postgres、Redis 接入（生产启动门禁 + 健康探针 + 多实例状态收敛）、备份重写、测试库改造。
2. 建 7 张画布表与 baseline migration。
3. 实现 `GET /canvas-projects`、`GET /:id`、`PATCH /:id/operations` 的 `create_canvas` + `create_node` 最小闭环，并补集成测试。
4. 移植 `lib/canvas` 纯逻辑与 89 个测试，跑绿。
5. 打通「一个空画布 + 拖入一个图片节点 + 本地持久化」的前端闭环。
