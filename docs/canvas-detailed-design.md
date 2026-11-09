# 无限画布实现详细设计

规划中（未实施）。最后更新 2026-11-09。

配套文档：`canvas-port-design.md` 定义范围、里程碑与排期；本文回答「每一层具体怎么落地」——文件落点、数据结构、协议算法、边界条件与验收闸口。上游对照仓库为 `open-ai-canvas`（MIT），文中 `backend/internal/canvas/**`、`web/src/lib/canvas/**` 均指上游路径。

## 1. 实施前提：当前仓库与目标形态的差距

`canvas-port-design.md` §1.2 已定口径：**PostgreSQL + Redis，不保留 SQLite 双轨**。这不是可选项，而是整个画布子系统的事务、锁、实时与备份前提。当前仓库仍处于 SQLite 形态，必须先完成 P0，画布功能才有可落地的运行环境。

| 事项 | 当前仓库事实 | 画布所需 | 落点 |
| --- | --- | --- | --- |
| 主库 | `provider = "sqlite"`，自研 `node:sqlite` driver adapter | PostgreSQL 16，行锁 / advisory lock / `@db.Text` | `backend/prisma/schema.prisma`、`backend/src/prisma/prisma.service.ts` |
| 迁移 | 无 `prisma/migrations/`，用 `db push` | `prisma migrate deploy` + baseline | `backend/prisma/migrations/**` |
| 事务锁 | SQLite 单写者，无 `FOR UPDATE` | `SELECT ... FOR UPDATE` 或 `pg_advisory_xact_lock` | `backend/src/canvas/infra/canvas.repository.ts` |
| 实时 | 无 WS 依赖，无 Redis 依赖 | `ws` / `@nestjs/platform-ws` + Redis pub/sub | `backend/src/canvas/canvas-realtime.gateway.ts` |
| 备份 | `VACUUM INTO` + SQLite 文件扫描 | `pg_dump --format=custom` + `pg_restore --list` | `backend/src/admin/backup.service.ts` |
| 测试库 | 临时 SQLite 文件 | 独立 Postgres schema / database | `backend/vitest.config.mts`、测试辅助 |
| 前端依赖 | 无 zustand / localforage / leafer / react-query | 本地文档、离线恢复、覆盖层渲染 | `frontend/package.json` |
| 能力模态 | `Modality = 'text' \| 'image' \| 'video'` | 画布音频能力需要 `audio` | `backend/src/common/modality.ts` |
| 项目隐藏 | `Project` 无来源字段，列表返回全部 | 画布自动项目不出现在工作台列表 | `backend/prisma/schema.prisma`、`backend/src/projects/projects.service.ts` |

**硬约束**：P0 未完成前不开始画布表与接口。不要为了「先跑起来」在 SQLite 上写一套临时实现——画布的 revision CAS、行锁、幂等回执与实时房间都建立在 Postgres/Redis 语义上，SQLite 版只能得出一个必须整体重写的分支。

## 2. 依赖与版本策略

全仓依赖精确锁定，不写 `^` / `~`。新增依赖按 CLAUDE.md「环境注意事项」第 4 条分批安装；npm broker 代理存在 5 分钟硬超时，必要时继续用 `curl` + `tar` 直装 registry。

### 2.1 后端

| 包 | 用途 | 备注 |
| --- | --- | --- |
| `pg` | PostgreSQL 驱动 | Prisma driver adapter 的底座 |
| `@prisma/adapter-pg` | Prisma 7 PostgreSQL adapter | 替换 `node-sqlite-adapter.ts` |
| `ioredis` | Redis 客户端、pub/sub、Lua | 也可用官方 `redis`；本项目选 `ioredis` 是因为 `defineCommand` 与集群/重连语义更直接 |
| `@nestjs/websockets` | Nest WS 生命周期 | 仅在采用 Nest Gateway 包装时需要；当前方案直接用原生 `ws`，可不装 |
| `@nestjs/platform-ws` | 原生 `ws` 适配器 | 同上，可选；不引入 socket.io |
| `ws` | WebSocket 服务端 | 必需：在 `main.ts` 挂原生 `ws`，按 URL 参数解析 `:id` |
| `json-canonicalize` | 稳定 JSON 序列化 | 幂等摘要用；也可自写 60 行 canonicalizer，减少依赖 |

### 2.2 前端

| 包 | 用途 |
| --- | --- |
| `zustand` | 画布文档 / UI / 历史 / 主题 store |
| `localforage` | 本地文档与未提交变更的持久化（IndexedDB） |
| `@tanstack/react-query` | 画布项目列表、任务轮询、分享状态 |
| `json-canonicalize` | 仅当客户端需要本地计算摘要时使用；当前设计摘要只在服务端算，可暂不引入 |
| `leafer-ui` | 连线/选择/覆盖层渲染（按上游用法） |

`antd` 不引入。上游的 `App.useApp()`、`Button`、`Input`、`Modal`、`InputNumber`、`Popover`、`Dropdown`、`Slider`、`Segmented`、`ColorPicker` 全部按 `canvas-port-design.md` §7 F2 的清单替换为 shadcn / 自持 primitives。

## 3. P0 基础设施改造

### 3.1 Prisma 切 PostgreSQL

1. `backend/prisma/schema.prisma`：`datasource db { provider = "postgresql" }`；删除 SQLite 专属注释与 `@db.*` 之外的兼容说明。
2. 删除 `backend/src/prisma/node-sqlite-adapter.ts`，`PrismaService` 改为：

```ts
import { PrismaPg } from '@prisma/adapter-pg';

super({
  adapter: new PrismaPg({ connectionString: config.get<string>('db.url') }),
});
```

3. `backend/prisma.config.ts` 的 `datasource.url` 改为 `process.env.DATABASE_URL`，不再有 `file:` 形态。
4. 生成 baseline：

```bash
cd backend
npx prisma migrate dev --name baseline   # 仅首次，在空库上
npx prisma migrate deploy                # 之后所有环境
```

5. 现有 `db push` 流程全部改为 `migrate deploy`：`backend/Dockerfile`、`docker-compose.yml`、`docker-compose.production.yml`、`start.sh`、`scripts/db-reset*`。

**JSON 字段口径**：现有业务表的 JSON 都是 `String`，画布表继续用 `String @db.Text`，不引入 `Json` 类型。理由是：本仓的读写路径、审计与迁移脚本都按字符串处理；混用 `Json` 会让 `Prisma.JsonValue` 与字符串解析在两套类型间来回转换。

**BigInt**：`CanvasProject.revision` 用 `BigInt`。API 输出前统一 `Number(revision)`；前端类型用 `number`。不要直接把 `BigInt` 交给 `JSON.stringify`——会抛 `Do not know how to serialize a BigInt`。

### 3.2 Redis

新增 `backend/src/redis/`：

```
redis/
├── redis.module.ts        # @Global，导出 RedisService
├── redis.service.ts       # 连接与租约；启动期连通性探测
└── redis.types.ts
```

- **生产硬依赖**：`REDIS_URL` 非空、scheme 合法且连通才允许生产启动；判定在 `validateEnv` 之后、`app.listen()` 之前做一次 `PING`，不通即拒绝启动。
- **`/health/ready` 纳入 Redis 探针**：Redis 掉线时 ready 不通过，由编排层决定摘流量；单实例内存 Hub + 前端 2 秒轮询的降级**仅允许 development / test**。
- **文档写入任何环境都不依赖 Redis**：实时链路故障不得阻塞 `PATCH /operations`（见 §8.6）。
- **多实例状态收敛**：全局限流、目录 / 积分价缓存失效广播、定时任务分布式锁一并走 Redis（现为进程内存，多实例下会放大配额与旧价窗口）。
- 命名空间：
  - 房间 pub/sub：`canvas:realtime:v1:<ownerId>:<canvasId>`
  - 设备号：`canvas:realtime:v1:<ownerId>:<canvasId>:devices`（sorted set + Lua）
  - WS 票据：`canvas:ws-ticket:v1:<sha256>`
  - 全局限流：`rate:canvas:*`
  - 缓存失效广播：`cache:invalidate:v1:*`
  - 定时任务锁：`lock:scheduler:v1:*`
- `ownerId` / `canvasId` 先做 base64url 再拼 key，避免 `:` 注入与超长 key。

### 3.3 环境变量

新增到 `backend/src/config/env.validation.ts` 的 `ENV_SPECS`，并同步 `.env.example`、`.env.development`、`.env.test`、`.env.production.example`：

| 变量 | 类型 | 默认 | 校验 |
| --- | --- | --- | --- |
| `REDIS_URL` | string | `''` | development / test 可空；**production 必填**，非空时必须是 `redis://` / `rediss://` 且启动期连通 |
| `CANVAS_SHARE_SECRET` | string | `''` | 分享 token 加密密钥；生产启用分享时必填，长度 ≥ 32 |
| `CANVAS_WS_TICKET_TTL` | number | `60` | 1..300 秒 |
| `CANVAS_WRITE_BODY_LIMIT` | number | `5242880` | 5 MiB；上限不超过 8 MiB |

运行策略（快照间隔、快照上限、写入限流、配额、分享开关、绘图引擎、存储只读）**放 `SETTING_DEFS`**，不放 env：它们是运营可在后台调整的业务参数，env 只保留启动期与安全边界。

生产门禁增加两条（沿用现有「生产禁止开发默认库」的思路，均为拒绝启动）：

- `DATABASE_URL` 不能是 `file:` 开头，且必须是可连通的 PostgreSQL 连接串。
- `REDIS_URL` 必须非空、scheme 合法且启动期连通；`/health/ready` 纳入 Redis 探针。内存降级仅允许 development / test。

### 3.4 备份与恢复

`backend/src/admin/backup.service.ts` 整体重写：

- 备份：`pg_dump --format=custom --no-owner --no-acl -f <file> "$DATABASE_URL"`。
- 校验：`pg_restore --list <file>` 必须成功，记录表数量、文件大小、sha256。
- 恢复：`pg_restore --clean --if-exists --no-owner --no-acl -d "$DATABASE_URL" <file>`；恢复前写 `BackupRecord`，恢复后跑一次健康检查与行数抽样。
- `BackupRecord` 字段沿用现有表；SQLite 专属的 `sourceSizeBytes`、`verifyWarnings` 语义改为 Postgres 口径。
- `backend/Dockerfile` 运行镜像增加 `postgresql-client`（`apt-get install -y --no-install-recommends postgresql-client`），并保留 `openssl`。
- 备份目录仍由 `BACKUP_DIR` 决定；上传目录单独备份，不与数据库备份混在一起。
- 恢复演练写进 `docs/testing.md` 的闸口清单；没有演练过的备份不算备份。

### 3.5 测试库

- 新增 `TEST_DATABASE_URL`（仅测试档使用）；测试启动时创建独立 schema：

```ts
const schema = `test_${process.pid}_${randomUUID().slice(0, 8)}`;
await admin.query(`CREATE SCHEMA "${schema}"`);
// DATABASE_URL 追加 ?schema=<schema>
await exec('npx prisma migrate deploy');
```

- 每个测试文件独立 schema，或同一 worker 内串行复用、逐用例 `TRUNCATE ... RESTART IDENTITY CASCADE`。
- 禁止连接 `dev.db` / `test.db`；`db-url.js` 在 `NODE_ENV=test` 且 `TEST_DATABASE_URL` 缺失时直接抛错，而不是回落 SQLite。
- 现有 `payments.integration.spec.ts` 一类临时 SQLite 集成测试改为 Postgres schema。
- 真实渠道与部署级链路仍走 `scripts/verify-*` / `smoke-*`，不互相替代。

### 3.6 本地编排与代理

`docker-compose.yml` / `docker-compose.production.yml` 增加：

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_DB: huojue
    POSTGRES_USER: huojue
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-huojue}
  volumes:
    - huojue-pg:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U huojue -d huojue"]
    interval: 10s
    timeout: 5s
    retries: 10

redis:
  image: redis:7-alpine
  command: ["redis-server", "--appendonly", "yes"]
  volumes:
    - huojue-redis:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```

- `backend-migrate` 从 `prisma db push` 改为 `npx prisma migrate deploy`，`depends_on` postgres healthy。
- `frontend/vite.config.ts` 的 `/api` 代理加 `ws: true`。
- `frontend/nginx.conf.template` 的 `/api/` 增加：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;  # 外层 map：$http_upgrade 空则 close
proxy_read_timeout 3600s;                          # WS 长连接
client_max_body_size 8m;                           # 画布 PATCH 上限 + 余量
```

- 生产入口若还有一层 TLS 反代，同样要透传 `Upgrade` / `Connection`，否则握手 400。
- `backend/src/main.ts` 目前所有非中转路径共用 100KB 的 `express.json`。画布 `PATCH /operations` 需要 5 MiB，不能直接抬高全局上限（等于放大所有接口的 body 攻击面）。做法：在 `main.ts` 增加一个与 `isProxyRequestPath` 同级的 `isCanvasOperationsPath(path, prefix)`，命中时改用独立的 `express.json({ limit: '5mb' })`，其余路径维持 100KB；该路径的判定与控制器路由共用同一份常量。

## 4. 数据模型

PostgreSQL + Prisma。所有表带 `ownerId`，所有查询必须带 `ownerId` 条件。以下为直接可落 schema 的定义（与 `canvas-port-design.md` §4 对齐，补充本仓约定）。

```prisma
model CanvasProject {
  id        String   @id @default(cuid())
  ownerId   String
  projectId String?
  title     String   @default("")
  payload   String   @db.Text
  revision  BigInt   @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner User @relation(fields: [ownerId], references: [id])

  @@index([ownerId, updatedAt])
  @@index([ownerId, projectId, updatedAt])
}

model CanvasMutationReceipt {
  id            String   @id @default(cuid())
  ownerId       String
  canvasId      String
  mutationId    String
  payloadDigest String
  resultJson    String   @db.Text
  revision      BigInt
  createdAt     DateTime @default(now())

  @@unique([ownerId, canvasId, mutationId])
  @@index([createdAt])
}

model CanvasEditLease {
  ownerId   String
  canvasId  String
  nodeId    String
  sessionId String
  token     String
  expiresAt DateTime

  @@id([ownerId, canvasId, nodeId])
  @@index([expiresAt])
}

model CanvasSnapshot {
  id               String   @id @default(cuid())
  canvasId         String
  ownerId          String
  revision         BigInt
  title            String   @default("")
  nodeCount        Int      @default(0)
  connectionCount  Int      @default(0)
  payloadBytes     Int      @default(0)
  payload          String   @db.Text
  reason           String   @default("automatic")
  contentUpdatedAt DateTime
  createdAt        DateTime @default(now())

  resources CanvasSnapshotResource[]

  @@unique([canvasId, revision])
  @@index([canvasId, createdAt])
}

model CanvasSnapshotResource {
  snapshotId String
  assetId    String

  @@id([snapshotId, assetId])
  @@index([assetId])

  snapshot CanvasSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  asset    Asset          @relation(fields: [assetId], references: [id], onDelete: Restrict)
}

model CanvasShare {
  id          String    @id @default(cuid())
  ownerId     String
  canvasId    String
  tokenHash   String    @unique
  tokenCipher String    @db.Text
  enabled     Boolean   @default(false)
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([ownerId, canvasId])
  @@index([expiresAt])
}

model CanvasUnitLink {
  id        String   @id @default(cuid())
  ownerId   String
  projectId String
  canvasId  String
  unitId    String
  role      String   @default("")
  createdAt DateTime @default(now())

  @@unique([projectId, canvasId, unitId])
  @@index([ownerId, canvasId])
  @@index([projectId, unitId])
}
```

上述关系字段需要在既有模型上补反向关系，否则 Prisma schema 校验不通过：

```prisma
model User {
  // ...
  canvases CanvasProject[]
}

model Asset {
  // ...
  snapshotResources CanvasSnapshotResource[]
}
```

补充约定：

- `payload` 顶层白名单：`title` / `projectId` / `chatSessions` / `activeChatId` / `starterMode` / `appearance` / `backgroundMode` / `showImageInfo` / `previsScenes` / `timeline`。`id` / `revision` / `createdAt` / `updatedAt` 由服务端写，客户端不可信。
- 节点必须有 `id`、`type`；连线字段是 `id` / `fromNodeId` / `toNodeId`。`payload` ≤ 4 MiB（写入口），请求体上限 5 MiB。
- 行的 `title` / `projectId` / `revision` / 时间戳是权威值；读取时覆盖 `payload` 内同名字段。
- `CanvasSnapshotResource.asset` 必须是 `Asset`。上游是 `Resource`；本仓对应 `Asset`，删除素材前必须检查快照引用。
- 画布删除：删除 `CanvasProject`、`CanvasMutationReceipt`、`CanvasEditLease`、`CanvasSnapshot`、`CanvasSnapshotResource`、`CanvasShare`、`CanvasUnitLink` 中同 `canvasId` 的行；`CanvasSnapshotResource` 随快照级联。
- Agent / creation-runs / 项目联动的表**不在这 7 张内**，M6 单独一批迁移；不要提前把它们的字段塞进 `CanvasProject.payload`。

**本仓缺口：隐藏项目**。`canvas-port-design.md` §6.6 要求画布任务关联「自动创建的隐藏项目」，但当前 `Project` 没有来源字段，`ProjectsService.list()` 会把它列出来。实施时给 `Project` 增加：

```prisma
model Project {
  // ...
  /// 'user' | 'canvas'。canvas 项目由画布按需创建，C 端项目列表不展示。
  origin String @default("user")
}
```

`ProjectsService.list()` 过滤 `origin = 'user'`；`CanvasProject.projectId` 指向这个隐藏项目。不要用名称前缀或「被画布引用」来推断隐藏——两种做法都会在项目改名或引用被清理后失效。

## 5. 后端模块与接口

### 5.1 目录

```
backend/src/canvas/
├── canvas.module.ts
├── canvas-projects.controller.ts      # 列表 / 读取 / 删除
├── canvas-operations.controller.ts    # PATCH /:id/operations
├── canvas-lease.controller.ts         # POST /:id/edit-lease
├── canvas-history.controller.ts       # GET /history, POST /history/:snapshotId/restore
├── canvas-share.controller.ts         # 分享 CRUD + 公开读取/资源代理
├── canvas-realtime.ts                 # 原生 ws 挂载与握手
├── application/
│   ├── operations.service.ts
│   ├── mutation-receipt.service.ts
│   ├── document.service.ts
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
    ├── canvas.repository.ts
    ├── canvas-mutex.ts
    ├── redis-hub.ts
    ├── ws-ticket.service.ts
    └── public-projection.ts
```

模块注册：`CanvasModule` 放到 `AppModule.imports` 中 `GenerateModule` 之后、`ProxyModule` 之前。`ProxyModule` 是 catch-all 中转，必须最后；画布路由不能被它抢走。

### 5.2 接口清单

| 方法 | 路径 | 鉴权 | 限流 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/canvas-projects` | JWT | 120/min/user | `page` / `pageSize` / `projectId` / `q` / `sort` |
| GET | `/api/v1/canvas-projects/:id` | JWT | 240/min/user | ETag `W/"canvas-<revision>"`；命中 304 |
| GET | `/api/v1/canvas-projects/:id/sync-status` | JWT | 240/min/user | `revision` / `serverTime` / `leases` / `agent` |
| POST | `/api/v1/canvas-projects/:id/edit-lease` | JWT | 240/min/user | `acquire` / `renew` / `release` |
| PATCH | `/api/v1/canvas-projects/:id/operations` | JWT | 120/min/user | 唯一写入口；body ≤ 5 MiB |
| DELETE | `/api/v1/canvas-projects/:id` | JWT | 30/min/user | 有活跃租约拒绝 |
| GET | `/api/v1/canvas-projects/:id/history` | JWT | 60/min/user | 快照列表 |
| POST | `/api/v1/canvas-projects/:id/history/:snapshotId/restore` | JWT | 10/min/user | 回滚；必须带 `revision` |
| GET | `/api/v1/canvas-projects/:id/share` | JWT | 60/min/user | 分享状态 |
| POST | `/api/v1/canvas-projects/:id/share` | JWT | 20/min/user | 开启 / 过期 / 轮换 |
| DELETE | `/api/v1/canvas-projects/:id/share` | JWT | 20/min/user | 关闭分享 |
| POST | `/api/v1/canvas-projects/:id/realtime-ticket` | JWT | 60/min/user | 60 秒一次性 WS 票据 |
| WS | `/api/v1/canvas-projects/:id/realtime?ticket=...` | 票据 | - | 握手校验票据 |
| GET | `/api/v1/public/canvas-shares/:token` | 公开 | 120/min/IP | 清洗后的公开文档 |
| GET | `/api/v1/public/canvas-shares/:token/resources/:assetId/file` | 公开 | 300/min/IP | 资源代理，支持 Range |

响应统一走 `ResponseInterceptor` 的 `{ code: 0, data, message: '' }`。**304 是例外**：`GET /:id` 命中 ETag 时直接 `res.status(304).end()`，不套信封；前端 `request()` 必须把 304 当成功且保留本地文档。

### 5.3 错误码

建议占用 `423xx` 段，与 `422xx` 生成错误分开：

| code | HTTP | 语义 | 前端动作 |
| --- | --- | --- | --- |
| `42301` | 409 | 字段基线冲突 | 保留本地草稿，拉最新文档，按字段 rebase |
| `42302` | 404 | 操作对象已删除 | 从本地文档移除该对象，提示「已删除」 |
| `42303` | 409 | revision CAS 并发写 | 同 `mutationId` 自动重放 |
| `42304` | 409 | 编辑租约冲突 | 提示「其他窗口正在编辑」，只读 |
| `42305` | 409 | `mutationId` 复用但摘要不同 | 生成新 `mutationId` 后重试 |
| `42306` | 428 | 缺少 / 非法基线 revision | 先刷新再提交 |
| `42307` | 409 | 媒体未就绪 | 等任务完成或重新生成 |
| `42308` | 404 | 资源不存在或无权访问 | 移除引用 |
| `42309` | 503 | 存储只读 | 提示维护中，禁用写入 |
| `42310` | 409 | 配额超限 | 提示清理或升级 |
| `42311` | 413 | 文档 / 请求体过大 | 清理节点或拆分画布 |
| `42312` | 404 | 分享不存在 / 过期 / 关闭 | 公开页统一 404，不区分原因 |

错误体仍由 `AllExceptionsFilter` 输出 `{ code, data: null, message }`；不要为画布另写一套信封。

## 6. Operations 协议

### 6.1 请求类型

```ts
export interface CanvasOperationsRequest {
  mutationId: string;            // 1..160
  baseRevision?: number;         // 仅 create_canvas 与只读校验使用
  operations: CanvasOperation[]; // 1..500
  editProofs?: CanvasEditProof[]; // ≤ 500，nodeId 不重复
}

export type CanvasOperation =
  | { type: 'create_canvas'; id?: string; patch?: Record<string, unknown> }
  | { type: 'create_node'; node: CanvasNode }
  | { type: 'patch_node'; id: string; patch: Record<string, unknown>; before: Record<string, unknown> }
  | { type: 'remove_node'; id: string; expected: CanvasNode }
  | { type: 'create_connection'; connection: CanvasConnection }
  | { type: 'update_connection'; id: string; connection: CanvasConnection; expected: CanvasConnection }
  | { type: 'remove_connection'; id: string; expected: CanvasConnection }
  | { type: 'set_field'; field: string; value?: unknown; beforeValue?: unknown };
```

`patch` / `before` 的键是**叶子路径**（点号分隔），例如 `metadata.prompt`、`position.x`。不是整对象替换。

### 6.2 校验规则

| 操作 | 必填 | 规则 |
| --- | --- | --- |
| `create_canvas` | 首条 | 仅画布不存在时允许；`id` 若给出必须等于路径 id；`patch` 只允许顶层白名单 |
| `create_node` | `node.id` / `node.type` | id 已存在时内容相同幂等通过，内容不同冲突 |
| `patch_node` | `id` / 非空 `patch` / 非空 `before` | `before` 逐路径比较；`id` 不可改；`updatedAt` 不参与基线 |
| `remove_node` | `id` / `expected` | 整对象基线（忽略 `updatedAt`）；级联删除相关连线 |
| `create_connection` | `connection.id` / 两端节点存在 | id 已存在时内容相同幂等通过 |
| `update_connection` | `id` / `connection.id` 一致 / `expected` | 两端节点存在；基线或目标值任一匹配即允许 |
| `remove_connection` | `id` / `expected` | 不存在时幂等通过 |
| `set_field` | 白名单字段 | `beforeValue` 缺失按 `null`；当前值等于基线或目标值才允许 |

`baseRevision` **不是硬 CAS**：它只用于 `create_canvas` 的基线校验与「新画布不能使用已有版本」判断。真正的并发保护是「字段基线 + DB revision CAS」。

### 6.3 摘要与幂等

```ts
digest = sha256('canvas-mutation:v1:' + canonicalJson({
  mutationId, baseRevision, operations
}))
// editProofs 不参与摘要：租约是瞬时授权，重放时可能已过期
```

- 服务端算摘要，客户端不传摘要。
- `CanvasMutationReceipt` 唯一键 `(ownerId, canvasId, mutationId)`。
- 同 `mutationId` + 同摘要：直接返回 `resultJson`（`{ summary, document }`），不重放操作。
- 同 `mutationId` + 不同摘要：`42305`。
- 回执与画布更新在**同一事务**；回执写入失败则整笔回滚，不会留下「已提交但不可重放」的文档。
- 回执 TTL 7 天，定时清理；删除画布时一并删除。
- canonical JSON 必须：对象键排序、无多余空白、拒绝 `undefined` / `NaN` / `Infinity`、数字按最短表示。算法带 `v1` 前缀，未来变更不复用旧回执。

### 6.4 写入算法

`PATCH /:id/operations` 的完整顺序：

1. **参数校验**（DTO）：`canvasId` 1..80，`mutationId` 1..160，`operations` 1..500，`editProofs` ≤ 500 且 `nodeId` 不重复；`baseRevision` 为 0..`Number.MAX_SAFE_INTEGER-1`。
2. **计算摘要**，进入 per-canvas 进程内互斥锁（`canvas-mutex.ts`），减少无效事务。
3. **开启事务**：
   a. 取行锁：`SELECT id FROM "CanvasProject" WHERE id = $1 AND "ownerId" = $2 FOR UPDATE`；不存在则记录 `existing = null`。
   b. **先建回执**（`INSERT ... ON CONFLICT DO NOTHING`）。冲突则读取旧回执：
      - 摘要不同 → 抛 `42305`；
      - 摘要相同 → 返回旧 `resultJson`。
   c. 判定 `create_canvas`：画布不存在时首条必须是 `create_canvas`；已存在时任何 `create_canvas` 都是冲突。
   d. 读取当前文档：存在则用行字段覆盖 `payload` 同名值；不存在则构造 `{ id, nodes: [], connections: [] }`，应用 `create_canvas.patch` 的白名单字段。
   e. **应用 operations**（纯函数 `applyCanvasOperations`），遇到冲突 / 对象缺失分别抛 `42301` / `42302`。
   f. **文档校验**：`nodes` / `connections` 是数组；节点 `id` / `type` 非空且 id 唯一；连线两端存在；`payload` ≤ 4 MiB；媒体引用属于本人且可见。
   g. **租约校验**：见 §7；把 `authored` 字段的改写与 `editProofs` 对照。
   h. **配额校验**：按 `payload` 增量与 `CANVAS_QUOTA` 判定。
   i. **revision CAS**：
      - 新建：`INSERT INTO "CanvasProject" (id, "ownerId", title, projectId, payload, revision, "createdAt", "updatedAt") VALUES (..., 1, now(), now()) ON CONFLICT (id) DO NOTHING`；`rowCount !== 1` → `42303`（并发创建同一画布）。
      - 更新：`UPDATE "CanvasProject" SET payload = $1, title = $2, projectId = $3, revision = revision + 1, "updatedAt" = now() WHERE id = $4 AND "ownerId" = $5 AND revision = $6`；`rowCount !== 1` → `42303`。
      - 行不存在时不重试、不回落成创建；删除后的画布不能被迟到写入复活。
   j. **回执落结果**：写入 `resultJson`（含 `summary` 与完整 document）与 `revision`。
4. **提交**。提交成功后：
   - 失效该画布的 `sync-status` 缓存（如有）；
   - `RealtimeHub.invalidate(ownerId, canvasId)`；
   - 异步写快照（见 §9），不阻塞响应。
5. **异常映射**：`42301` / `42302` / `42303` / `42304` / `42305` 按上表；其余走 `AppError` / 500。

`create_canvas` 的特殊点：

- 新建时 `revision` 从 0 开始，首次写入后为 1；响应 `revision = 1`。
- `create_canvas.patch` 只允许顶层白名单字段，不允许塞 `nodes` / `connections`（节点走后续 `create_node`）。
- 新画布不能带 `baseRevision > 0`（`42306`）。

### 6.5 文档校验与媒体引用

- 顶层必须是对象；`nodes` / `connections` 是数组。
- 节点：`id` 非空字符串；`type` 非空；`position` 若存在必须是 `{x,y}` 数字；`width` / `height` 若存在必须是正数。
- 连线：`id` / `fromNodeId` / `toNodeId` 非空；两端节点在 `nodes` 中；`fromNodeId !== toNodeId`。
- 媒体引用：扫描节点 `metadata.content` / `metadata.storageKey` / 其他资源 id 字段，收集 `assetId`；按 `ownerId` 查 `Asset`，必须存在、`status = 'visible'`、`project.deletedAt = null`。缺任何一个 → `42308` / `42307`。
- 不把「URL 可访问」当作引用有效：画布存的是 `assetId` 或 `storageKey`，不是外部 URL。外链图片必须先落成 `Asset`。
- `payload` 内不得出现 `apiKey` / `token` / `secret` / `password` 等字段；写入口直接拒绝（防 XSS 与凭据泄露）。

## 7. 编辑租约

### 7.1 协议

`POST /:id/edit-lease`：

```ts
{ action: 'acquire' | 'renew' | 'release', nodeId, sessionId, token }
```

- 首次 `acquire` 不传 `token`；服务端生成 32 字节 token，返回 `{ lease, token, serverTime }`。
- `acquire`：
  - 无活跃租约 → 创建，`expiresAt = now + 30s`；
  - 有活跃租约且 `sessionId` + `token` 匹配 → 续期；
  - 有活跃租约但凭据不匹配 → `42304`。
- `renew`：必须匹配，否则 `42304`；续期 30s。
- `release`：必须匹配；删除行。
- 所有操作在画布行锁内执行；画布不存在 → `40400`。
- 租约按 `(ownerId, canvasId, nodeId)` 唯一；同一节点同一时刻只允许一个编辑者。

### 7.2 `editProofs` 校验

`operations` 请求里的 `editProofs` 是「本次改写这些节点的凭据」。

- 对每个 `proof`：若该节点的 **authored 字段**发生变化，则必须存在活跃租约，且 `lease.token === proof.token && lease.sessionId === proof.sessionId`。
- 对每个活跃租约：若其节点 authored 字段发生变化，则必须在本请求的 `editProofs` 中出现；否则 `42304`。
- authored 字段（与上游一致）：
  - 节点 `title`；
  - `metadata.content` / `metadata.richText`（仅 `text` / `markdown` / `script` 节点）；
  - `metadata.prompt` / `metadata.composerContent`；
  - `metadata.generationSpec.prompt`。
- 非 authored 字段（`metadata.taskId` / `taskStatus` / `taskUpdatedAt` / `content` 结果回填等）不需要租约，允许生成回写与 Agent 写入。
- 节点删除 / 新建不要求租约；`remove_node` 仍受 `expected` 基线保护。

这样区分的目的：**结果回写不应该抢走用户的文本编辑权**。把整个节点都锁住会让「任务完成回填图片」与「用户正在改提示词」互相阻塞。

## 8. 实时通道

### 8.1 票据

浏览器 `WebSocket` 不能设置 `Authorization` 头，因此不能直接复用 Bearer token。采用一次性票据：

1. `POST /:id/realtime-ticket`（JWT 鉴权）生成 32 字节随机票据，返回值只出现一次。
2. 服务端存 `sha256(ticket)`：`SET canvas:ws-ticket:v1:<hash> {ownerId,canvasId} EX 60 NX`。票据存储**不做内存回退**，Redis 不可用时票据接口直接失败（生产已由启动门禁拦截，development / test 亦然）。
3. 握手：`GET /api/v1/canvas-projects/:id/realtime?ticket=...`；服务端 `GETDEL` 消费票据，校验 `ownerId`、`canvasId`、过期时间；票据只能用一次。
4. 失败一律 `close(1008)`，不回显具体原因。

票据放 query string，不放 `Sec-WebSocket-Protocol`：后者在部分代理与库组合下会被改写，排查成本高；query 在 Nginx 访问日志里可能留痕，故票据 TTL 只有 60 秒且一次性。

### 8.2 挂载方式

Nest 的全局前缀不会自动作用于 WS 路径，`@WebSocketGateway({ path })` 也不支持 `:id` 参数。因此采用**原生 `ws` 挂到 HTTP server**：

```ts
// main.ts
const server = await app.listen(port, host);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const match = /^\/api\/v1\/canvas-projects\/([^/]+)\/realtime$/.exec(url.pathname);
  if (!match) return socket.destroy();
  // 校验 Origin（CORS 白名单）→ 消费票据 → wss.handleUpgrade(...)
});
```

- 不使用 socket.io：多一层协议与客户端依赖，收益只有自动重连；画布客户端自己实现退避重连更可控。
- `ws` 的 `maxPayload` 设为 32 KiB；超过直接关闭。
- Origin 必须命中 `buildCorsAllowList()`；不命中 `close(1008)`。

### 8.3 事件协议

服务端 → 客户端：

| type | 载荷 | 说明 |
| --- | --- | --- |
| `welcome` | `{ selfId, peers, serverTime, revision }` | 握手成功；`peers` 是当前 presence 列表 |
| `peer` | `{ peer }` | 新 peer 加入或位置更新 |
| `leave` | `{ peerId }` | peer 离开 |
| `invalidate` | `{ revision }` | 文档已变更，客户端应拉取新文档 |
| `heartbeat` | `{ serverTime }` | 15 秒一次 |

客户端 → 服务端：

```ts
{ type: 'presence', cursor?: {x,y}, drag?: [{id,x,y,width,height}] }
```

- 客户端只允许发 `presence`；其他 type 直接 `close(1008)`。
- 80 条/秒上限（1 秒窗口计数）；超限 `close(1008)`。
- `drag` 最多 20 个节点，每个字段必须是有限数字；否则关闭。
- presence 是瞬时数据，**不落库**。

`invalidate` 不携带文档：慢消费者不传大 payload，客户端收到后按 `revision` 决定是否重新拉取。这样服务端推送体积与文档大小解耦。

### 8.4 设备号与多实例

- 房间：`canvas:realtime:v1:<ownerIdB64>:<canvasIdB64>`。
- 设备号 1..64，Redis sorted set：
  - member：`<number>:<peerId>`，score：`now + 60s`；
  - 抢占 Lua：先 `ZREMRANGEBYSCORE` 清过期，再找 1..64 最小空号；
  - 续期 Lua：校验 score 未过期后重写 score；
  - 释放：`ZREM`。
- Redis 不可用时设备号分配直接失败；**不做进程内 1..64 回退**（生产由启动门禁拦截）。房间上限 64 连接。
- 多实例：每个实例订阅同一房间，`publish` 带 `source` 实例 id，收到自己的消息丢弃；`hello` 用于新实例加入时让其他实例回发 `peer`。
- 慢消费者：发送队列满 128 条直接断开，客户端重连后拿全量 `welcome`。

### 8.5 心跳与身份复核

每 15 秒：

- 复核 `JwtAuthGuard` 等价条件：用户仍存在、`status = 'active'`、`tokenVersion` 未变；否则 `close(1008)`。
- 复核画布仍存在且属于该用户；否则 `close(1008)`。
- 发 `heartbeat`；连续 2 个周期无 pong/任意帧 → 关闭。

### 8.6 实时可用性与降级边界

**生产不启用降级**：Redis 由启动门禁（`REDIS_URL` 非空 + 连通）与 `/health/ready` 探针共同保证，缺失或掉线即拒绝启动 / 不通过就绪，不静默切内存模式。

`development` / `test` 允许降级：

- 实时 Hub 退化为进程内房间；
- 前端 `invalidate` 不可靠时，2 秒轮询 `sync-status` 的 `revision`。

**任何环境**：文档写入完全不依赖 Redis；实时故障不能阻塞 `PATCH /operations`。

## 9. 快照与历史

### 9.1 写入策略

- 每次成功写入后，比较新旧文档内容（忽略 `revision` / `updatedAt` / `createdAt` / `viewport` / `remoteContentHash`）。
- 内容有变化且距上次快照 ≥ 5 分钟 → 自动快照，`reason = 'automatic'`。
- 内容无变化不写快照。
- 回滚前强制快照，`reason = 'before_restore'`；资源修复前强制快照，`reason = 'before_resource_repair'`。
- 每个画布最多 20 条；超过按 `createdAt` 删最旧。删除快照时先删 `CanvasSnapshotResource`，再删 `CanvasSnapshot`。
- 快照存**旧文档**（写入前的 `payload`），`revision` 是旧 revision；这样历史列表里的「回到这一版」语义清晰。

### 9.2 资源引用保护

- 写快照时扫描旧文档的资源引用，写 `CanvasSnapshotResource`。
- `Asset` 删除前检查 `CanvasSnapshotResource` 是否存在；存在则 `409` / 业务错误，提示「该素材仍被画布历史引用」。
- 快照被保留期清理后，引用行随快照删除，素材才可删。
- 素材 `status = 'hidden'` 不阻止历史读取；公开分享会过滤隐藏素材。

### 9.3 历史接口

`GET /:id/history`：

```json
{
  "snapshots": [
    { "id": "...", "revision": 12, "title": "首页改版", "nodeCount": 42,
      "connectionCount": 30, "payloadBytes": 123456, "reason": "automatic",
      "contentUpdatedAt": "...", "createdAt": "..." }
  ],
  "currentRevision": 18
}
```

不返回 `payload`；查看某一版走 `GET /:id?revision=...`（或单独的 `GET /history/:snapshotId`，二者选一，不要两个入口读同一份数据）。

`POST /:id/history/:snapshotId/restore`：

```ts
{ revision: number } // 必填，当前 revision，防覆盖
```

- 缺少 → `42306`；不匹配 → `42303`。
- 事务内：读当前 → 强制快照 → 用快照 `payload` 覆盖，但保留当前 `id` / `projectId` / `createdAt`；`revision + 1`；写回执（`mutationId = restore:<snapshotId>:<revision>`）。
- 提交后 `invalidate`；返回新文档。
- 回滚是**新增一个 revision**，不是把 revision 拨回去。拨回去会让已发出的 ETag 与回执指向错误版本。

## 10. 分享

### 10.1 token 生命周期

- 启用：生成 32 字节随机 token，base64url 编码（43 字符）。
- 存库：`tokenHash = sha256(token)`；`tokenCipher = AES-256-GCM(token, CANVAS_SHARE_SECRET)`。
  - `tokenHash` 用于查找；
  - `tokenCipher` 用于所有者在「分享状态」里再次看到链接（不重新生成）。
- 轮换：`rotate = true` 时生成新 token，覆盖 hash/cipher；旧链接立即失效。
- 关闭：`enabled = false`；不删行，便于再次开启时复用（关闭不要求保留 token 可见性）。
- 过期：`expiresDays` 0..365；0 表示永不过期。
- 公开读取统一返回 `404`（不存在 / 已关闭 / 已过期 / token 格式非法），不区分原因，避免探测。

### 10.2 公开投影

只输出白名单：

- 顶层：`id` / `title` / `createdAt` / `updatedAt` / `backgroundMode` / `showImageInfo` / `viewport` / `connections` / `nodes` / `chatSessions: []` / `activeChatId: null` / `previsScenes: []`。
- 节点：`id` / `type` / `title` / `position` / `width` / `height` / `parentId` / `metadata`。
- 节点 `metadata` 只保留上游 `publicCanvasMetadataKeys` 白名单（内容、生成参数、尺寸、批处理标识、角色、分镜等）。
- 删除所有 `publicCanvasForbiddenKeys`：`apiKey` / `storageKey` / `taskId` / `taskStatus` / `taskProgress` / `taskStage` / `taskCreatedAt` / `taskUpdatedAt` / `errorDetails` / `references`。
- 资源字段统一改写成代理 URL：`/api/v1/public/canvas-shares/<token>/resources/<assetId>/file`。
- `storageKey` 永不出现在公开响应里；`content` 若是外部 http(s) URL，按原样保留（但节点仍会经过 XSS 清洗，见 §14）。

### 10.3 资源代理

- 校验：token hash 命中、`enabled = true`、未过期、`assetId` 在该分享文档的允许集合内、`Asset.ownerId === share.ownerId`、素材 `status = 'visible'`。
- 读取：走 `StorageService` 的当前后端；支持 `Range`：
  - 有 Range 且合法 → `206 Partial Content` + `Content-Range` + `Accept-Ranges: bytes`；
  - 无 Range → `200` + `Content-Length`；
  - 非法 Range → `416`。
- `Content-Type` 取 `Asset.format`，不用 URL 后缀猜。
- 响应头：`X-Content-Type-Options: nosniff`、`Content-Disposition: inline`（音频/视频/图片）；HTML/SVG 资源不允许 `inline`，见 §14。
- 缓存：`Cache-Control: private, max-age=60`；轮换后最多 60 秒旧缓存，可接受。不要在 CDN 上长期缓存分享资源。
- 限流：120/min/IP（文档）、300/min/IP（资源）。

## 11. 生成、能力与回填

### 11.1 能力定义

新增 4 个文件，并加入 `backend/src/capabilities/definitions/index.ts` 的 `CAPABILITY_PLUGINS`：

| id | modality | model.capability | inWorkbench | 建议 creditCost |
| --- | --- | --- | --- | --- |
| `canvas_image` | `image` | `image` | false | 10 |
| `canvas_text` | `text` | `text` | false | 2 |
| `canvas_video` | `video` | `video` | false | 20 |
| `canvas_audio` | `audio` | `audio` | false | 10 |

`creditCost` 只是代码默认值，运行时仍走 `CreditPriceService.resolve()`；后台可覆盖，限时免费活动优先。

**必须处理的声明细节**：

1. `params` 必须声明画布节点会传入的所有键。`sanitizeParams` 只保留声明过的 key，漏声明会静默丢弃——例如画布把 `nodePrompt` 传进去，能力只声明 `prompt`，最终请求里就没有提示词。建议参数：`prompt` / `negativePrompt` / `ratio` / `size` / `duration` / `resolution` / `voice` / `style` / `referenceMode`。
2. `buildPrompt` 必填；画布节点没有提示词时给一个稳定兜底，不要抛错。
3. `model.intent` 必须与 `modality` 一致；图片复用 `generateImageIntent`，视频复用 `imageToVideoIntent`，文本/音频需要新增 `textIntent` / `audioIntent`（在 `capabilities/model-mapping.ts` 中集中实现，不在能力文件里各写一份）。
4. `modality: 'audio'` 需要先把 `backend/src/common/modality.ts` 的 `Modality` 扩展为 `'text' | 'image' | 'video' | 'audio'`；否则 `assertCapabilityIntegrity` 的类型与运行时校验都会拒绝。
5. 画布能力不能出现在 C 端导航。当前 `GET /capabilities` 返回全部能力，`AppLayout` / `SideRail` / `WORKBENCH_CAPABILITIES` 会按 `isCapabilityVisible` 展示；`isCapabilityVisible` 只看 `mode` 与 `runtime.effective`，`inWorkbench: false` 只影响卡片区。因此必须新增一个「展示面」标记，例如：

```ts
export type CapabilitySurface = 'product' | 'canvas';
export interface CapabilityPlugin {
  // ...
  surface?: CapabilitySurface; // 缺省 'product'
}
```

`GET /capabilities` 默认只返回 `surface === 'product'`；画布内部通过 `getCapability()` 取 `canvas_*`。若不这样做，用户会在顶导看到「画布图片」并点进 `/tools/canvas_image` 的通用表单——那不是画布任务的入口。这是 `canvas-port-design.md` 未展开的本仓缺口。

### 11.2 节点类型到能力

映射只在 `backend/src/canvas/domain/capability.registry.ts` 维护：

```ts
export const NODE_CAPABILITY: Record<string, string> = {
  image: 'canvas_image',
  text: 'canvas_text',
  markdown: 'canvas_text',
  script: 'canvas_text',
  video: 'canvas_video',
  audio: 'canvas_audio',
  'batch-table': 'canvas_image',
  'batch-image': 'canvas_image',
  storyboard: 'canvas_image',
};
```

- 节点 `metadata.generationSpec` 决定 `mode`（text/image/video/audio）与参数。
- 不在表里的节点类型不参与生成；前端生成按钮按 registry 隐藏。
- 不允许前端自选能力 id；服务端按节点类型映射，避免「节点是图片、请求却走文本能力」。

### 11.3 隐藏项目与任务创建

- 画布首次生成时创建 `Project{ origin: 'canvas', name: '画布 ' + canvasId }`，写回 `CanvasProject.projectId`。
- 任务创建复用 `TaskAdmissionService.admit()`，不另建 provider 链路：

```ts
admission.admit({
  ownerId,
  dto: {
    projectId: hiddenProjectId,
    capability: NODE_CAPABILITY[node.type],
    logicalModelId: node.metadata.generationSpec.modelId,
    inputAssetIds: collectInputAssets(node),
    params: buildCanvasParams(node),
    idempotencyKey: `canvas:${canvasId}:${node.id}:${taskAttempt}`,
  },
});
```

- `logicalModelId` 必填。画布节点没有选模型时，前端必须在提交前让用户选；服务端返回 `40005`，不要猜默认模型。
- 批量：一次提交 N 个节点 → N 个独立任务、各自账单；`outputPlan` 不适用于画布（画布层已经按节点拆开）。
- 重试：复用现有 `retryTask` 语义，但画布重试要生成新的 `taskAttempt`，且只允许在该节点的 `metadata.taskId` 仍是失败任务时执行。
- 取消 / 失败退款沿用现有账单状态机；画布不直接改积分。

### 11.4 结果回填

- 前端轮询 `GET /tasks/:id` 或订阅任务状态；成功后通过 `PATCH /operations` 写回：

```ts
{
  type: 'patch_node',
  id: node.id,
  patch: {
    'metadata.content': assetUrl,
    'metadata.storageKey': asset.storageKey,
    'metadata.taskStatus': 'succeeded',
    'metadata.taskUpdatedAt': new Date().toISOString(),
  },
  before: { 'metadata.taskId': task.id } // 任务围栏
}
```

- `before` 里的 `metadata.taskId` 是围栏：只有节点仍指向该任务时才允许回填。用户已经换任务 / 删节点时，迟到回写不会覆盖。
- 服务端受信任写入（Agent / creation-runs / 修复）走 `TrustedServerMutation` 分支，跳过客户端媒体校验但仍写审计与任务围栏；不能因为「受信任」就跳过 revision CAS。
- 文本结果：当前 `task-worker` 的 `collectReferences` 只收 `images/videos/audios`，`text` 结果没有落盘路径。实施 `canvas_text` 前必须补：
  - `ProtocolResult.text` → `Buffer.from(text, 'utf8')`，`format = 'text/plain; charset=utf-8'`，扩展名 `.txt`；
  - `TaskMediaService.persist` 对 `text/*` 跳过硬编码图片的 AIGC 角标（或写文本侧隐式标识），不能走 Jimp 分支；
  - `Asset.format` 允许 `text/plain`。
- 音频结果：`persist` 目前只区分 `isVideo`，音频会落进图片 AIGC 标识分支。必须改为 `isVideo || isAudio` 的媒体分支，音频写 `api-only` 元数据，不调用 Jimp。
- 视频 / 音频节点在画布上引用 `Asset.id`，播放走签名 URL；公开分享走资源代理。

## 12. 前端实现

### 12.1 目录

```
frontend/src/
├── lib/canvas/**                 # 纯逻辑引擎，整体移植；不依赖 React / shadcn
├── services/canvas/
│   ├── api.ts                    # 画布项目 / 历史 / 分享 HTTP
│   ├── sync.ts                   # 拉取、ETag、mutation 队列、rebase
│   ├── realtime.ts               # WS 票据、重连、presence
│   ├── generation.ts             # 任务提交、轮询、回填
│   └── local-store.ts            # localforage 命名空间
├── stores/canvas/
│   ├── use-canvas-store.ts       # 文档、revision、脏标记
│   ├── use-canvas-ui-store.ts    # 选择、视口、面板
│   ├── use-canvas-history-store.ts
│   └── use-canvas-theme-store.ts
├── pages/canvas/
│   ├── index.tsx                 # 画布项目库
│   ├── project.tsx               # 编辑器编排（拆成 5–7 个模块）
│   └── shared.tsx                # 公开只读页
├── components/canvas/**          # 节点、面板、对话框、工具栏
└── pages/admin/canvas/**         # 后台画布设置
```

本仓现有前端没有 `services/` 与 `stores/` 顶层目录。画布域体量大，按上游结构落位是可接受的偏差；同批更新 `docs/frontend-module-conventions.md`，说明「画布域使用 lib/services/stores/pages 四层，其余域仍按 `pages/<域>` 分层」。

### 12.2 引擎移植顺序

1. 先移植 `lib/canvas` 中**不依赖 DOM** 的纯逻辑（文档模型、空间索引、连线策略、布局、渲染预算、操作契约），把上游 89 个纯逻辑测试改为本仓 Vitest 并跑绿。
2. 再移植依赖 DOM 的渲染与交互。
3. 最后接页面与生成。

必须保留的不变量（上游测试与宿主代码依赖它们）：

- `data-canvas-world-layer` 属性；
- `--canvas-live-scale` CSS 变量；
- 4 个 `canvas:*` CustomEvent：`canvas:node-panel-layout`、`canvas:viewport-preview`、`canvas:graphics-viewport-preview`、`canvas:selection-preview`（任务事件 `canvas:task-created` / `canvas:task-cancelled` 同样保留）；
- 空间索引 cell 1024；
- 渲染预算 `CANVAS_MAX_RENDERED_NODES = 720`、`CANVAS_MAX_RENDERED_CONNECTIONS = 5000`；
- LOD 阈值 0.23 / 0.27。

这些不是美学选择：宿主用它们做性能降级与覆盖层定位。改名会让移植后的代码「看起来能跑」，但在大文档下悄悄退回全量渲染。

### 12.3 同步引擎

本地优先：

1. 打开画布：读 `localforage` 缓存 → 立即渲染 → 发 `GET /:id`（带 `If-None-Match`）。
2. 304：保留本地文档；200：用服务端文档覆盖，清空本地冲突标记。
3. 用户操作：先改本地 store，追加到 mutation 队列（按节点/字段合并，不逐次发请求）。
4. 队列 flush：
   - 取队首的 `mutationId`（本地生成，稳定）；
   - `PATCH /operations`；
   - 成功：更新本地 `revision`，出队，持久化；
   - `42301` / `42302`：拉最新文档，按字段 rebase（保留本地未冲突字段），重新生成 `mutationId`；
   - `42303`：同 `mutationId` 重放；
   - `42304`：停止自动重试，提示「其他窗口正在编辑」；
   - `42305`：生成新 `mutationId`，重放。
5. `invalidate`：记下服务端 revision；若本地无未提交变更，直接拉取；有未提交变更，先 flush 再拉取。
6. 离线：队列与文档都进 localforage；恢复后按上述流程 flush，冲突保留本地草稿并提示。
7. 多标签页：`BroadcastChannel` 只做「有变更」提示，不共享 mutation 队列；每个标签页自己持租约。

### 12.4 渲染架构

- DOM 世界层：节点卡片、文本、表单、按钮；可访问性与输入法依赖 DOM，不能全部画到 canvas。
- SVG 层：连线、命中区域、选择框。
- Leafer 覆盖层：拖拽预览、框选、对齐辅助线、小地图；只画瞬时图形。
- 视口：`transform: translate(x,y) scale(k)`；只渲染视口内节点（空间索引查询）。
- 大文档降级：节点数 > 720 或连线 > 5000 时，非视口节点渲染为占位块；缩放 < 0.23 隐藏内部细节，< 0.27 隐藏连线文字。

### 12.5 编辑器拆分

上游 `web/src/pages/canvas/project.tsx` 3,700 行，必须拆分。建议：

| 模块 | 职责 |
| --- | --- |
| `use-canvas-document.ts` | 文档加载、同步、revision、脏标记 |
| `use-canvas-viewport.ts` | 缩放、平移、框选、视口持久化 |
| `use-canvas-selection.ts` | 选择、多选、对齐、快捷键 |
| `use-canvas-node-actions.ts` | 创建 / 删除 / 复制 / 粘贴 / 连线 |
| `use-canvas-generation.ts` | 提交任务、轮询、回填 |
| `use-canvas-realtime.ts` | WS、presence、invalidate |
| `CanvasProjectView.tsx` | 仅组合布局与面板 |
| `canvas-project-world-layers.tsx` | 世界层 / SVG / 覆盖层 |

页面文件只做编排，不承载业务规则；规则进 `lib/canvas` 纯函数，便于测试。

### 12.6 节点类型

内建 18 种（与上游 `CanvasNodeType` 一致）：`image` / `text` / `drawing` / `script` / `skill` / `config` / `video` / `audio` / `frame` / `markdown` / `svg` / `html` / `panorama` / `compare` / `chart` / `colorgrade` / `media-conversion` / `batch-table`。另有插件运行时节点类型（持久化在 `type` 字段，前端按注册表渲染）。

节点注册表接口：

```ts
interface CanvasNodeDefinition {
  type: string;
  label: string;
  icon: LucideIcon;
  createDefault(partial?: Partial<CanvasNodeData>): CanvasNodeData;
  renderView(props: NodeViewProps): ReactNode;   // 画布卡片
  renderInspector(props: InspectorProps): ReactNode; // 右侧属性面板
  capabilities?: string[];                       // 可触发的生成能力
}
```

新增节点类型只改注册表，不改 `project.tsx`。

### 12.7 antd → shadcn 替换

| 上游用法 | 次数 | 本仓落点 |
| --- | --- | --- |
| `App.useApp()`（message / modal / notification） | 49 | `sonner` toast + `useConfirm()` + `ConfirmDialog` |
| `Button` | 56 | `admin-ui/components/ui/button`（经 primitives） |
| `Input` / `Input.TextArea` | 36 | `Input` / `Textarea` |
| `Modal` | 20 | `Dialog` / `AlertDialog` |
| `InputNumber` | 11 | 手写 `primitives/fields/number-input` |
| `Popover` | 10 | `Popover` |
| `Dropdown` | 10 | `DropdownMenu` |
| `Slider` | 6 | `Slider` |
| `Segmented` | 6 | `ToggleGroup` |
| `ColorPicker` | 5 | 手写 `primitives/fields/color-picker` |

需新增的 shadcn 件：`command`、`resizable`、`scroll-area`、`toggle-group`。`shadcn add` 后必须跑 `frontend/scripts/post-shadcn.mjs` 改写 `cn` 引用。

C 端画布页面也遵守「后台组件一套 shadcn」：节点卡片、属性面板、工具栏全部复用 `admin-ui/primitives`，不另起一套。C 端 `frontend/src/ui` 兼容层只用于现有页面；画布新代码直接取 primitives，避免再增加一层转发。

### 12.8 样式

- 9,673 行画布 CSS 迁入 `styles/global.css` 的令牌体系；画布专属样式放 `styles/canvas.css`，由 `CanvasShell` 引入。
- 只用 `var(--token)`，不写裸 hex。
- 最小字号 12px；节点缩放后的视觉缩放用 `transform: scale()`，不把 `font-size` 降到 12px 以下。
- 圆角只用五档 + 胶囊；节点卡片用 `--radius-card`，面板用 `--radius-panel`。
- 画布是唯一允许全屏、无页面滚动条的 C 端区域；`overflow: hidden` 只作用于画布容器，不影响其它页面。

### 12.9 路由

`frontend/src/App.tsx`：

- `/canvas`：画布项目库，进 `Shell()` 的 `Routes`（有 `AppLayout`）。
- `/canvas/:id`：编辑器，进**裸外壳**（与 `/mobile-upload` 同组），用自己的顶栏；不要套 `AppLayout` 的顶导与侧栏——画布需要整块视口。
- `/canvas/shared/:token`：公开只读页，裸外壳，不要求登录。

注册顺序：`/admin/*` 与 `/canvas/*` 都必须在 `Shell()` 的 catch-all `path="*"` 之前；编辑器与分享页放在最外层 `<Routes>` 中、`path="*"` 之前。不要把 `/canvas/:id` 放进 `Shell()`，否则 304 / 全屏布局会与能力清单加载互相干扰。

`/canvas` 列表页依赖 `GET /canvas-projects`，不依赖 `useCapabilities`；编辑器也不依赖能力清单（能力映射在服务端）。这延续现有「账户/交易页不因能力清单失败而白屏」的原则。

## 13. 后台管理端

### 13.1 权限点

在 `backend/src/admin/permissions.ts` 增加：

`PERMISSIONS` 目前是扁平对象，按既有命名风格追加键值，不要引入嵌套结构：

```ts
canvasRead: 'canvas.read',
canvasWrite: 'canvas.write',
canvasQuota: 'canvas.quota',
canvasShareRead: 'canvas.share_read',
```

- `canvas.read`：画布列表、项目、快照、分享状态只读。
- `canvas.write`：画布设置、强制下线、清理快照、存储只读开关。
- `canvas.quota`：配额与保留策略。
- `canvas.shareRead`：分享链接与访问审计（不返回 token 明文给非所有者角色，除非同时有 `canvas.write`）。

### 13.2 页面与菜单

`frontend/src/components/admin/adminNav.ts` 新增分组「画布」：

| 路径 | 页面 | 权限 |
| --- | --- | --- |
| `/admin/canvas` | 画布设置：开关、外观、绘图引擎、运行策略 | `canvas.read` 只读；`canvas.write` 可写 |
| `/admin/canvas/projects` | 画布项目列表：所有者、节点数、体积、最近更新 | `canvas.read` |
| `/admin/canvas/quota` | 配额与快照保留 | `canvas.quota` |
| `/admin/canvas/storage` | 存储只读 / 迁移状态 | `canvas.write` |

页面只从 `admin-ui/primitives` 取件；表格用 `primitives/table`，确认用 `ConfirmDialog`，跨页确认用 `useConfirm()`。

### 13.3 设置项

在 `backend/src/common/setting-defs.ts` 增加 `canvas` 分组（同时更新 `SETTING_GROUP_LABELS`，否则会出现同名页签）：

| key | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `canvas.enabled` | boolean | true | 总开关；关闭后写入口 `42309`，读仍可用 |
| `canvas.maxPayloadBytes` | number | 4194304 | 单画布文档上限 |
| `canvas.snapshotIntervalMin` | number | 5 | 自动快照间隔 |
| `canvas.snapshotMax` | number | 20 | 每画布快照上限 |
| `canvas.shareEnabled` | boolean | true | 是否允许创建分享 |
| `canvas.writePerMinute` | number | 120 | 每用户写入限流 |
| `canvas.leasePerMinute` | number | 240 | 租约接口限流 |
| `canvas.quotaBytes` | number | 268435456 | 每用户画布总字节配额，0 = 不限 |
| `canvas.storageReadOnly` | boolean | false | 存储只读；写入口 `42309` |
| `canvas.drawingEngine` | enum | `'native'` | `native` / `tldraw` / `excalidraw` |

设置值运行时通过 `SettingsService` 读取；不要在画布代码里写死默认值。`SETTING_DEFS` 是唯一事实源，`docs/admin-detailed-design.md` 同批更新（若该文档仍写死列表）。

### 13.4 审计

- `canvas.settings_update`：设置变更，写 `detail`（字段级旧值/新值）。
- `canvas.project_delete`：后台删除画布，写影响统计。
- `canvas.snapshot_prune`：清理快照，写数量与释放字节。
- `canvas.storage_readonly`：切换只读，写原因（如有）。
- 审计走现有 `AuditInterceptor` + `@Audit()`；不要为画布另写审计表。

## 14. 安全、限流、可观测与部署

### 14.1 多租户

- 所有画布查询必须带 `ownerId`；`CanvasProject` 的读写按 `(id, ownerId)` 双条件。
- 关联表（snapshot / share / lease / receipt）即使有 `canvasId`，也要带 `ownerId` 或先校验画布归属；不要只按 `canvasId` 查。
- 公开分享只走投影；投影不包含 `ownerId`、`storageKey`、任务字段。
- 后台列表可以跨用户，但必须挂 `canvas.read` 并写审计。

### 14.2 XSS / SVG / HTML

- `html` / `svg` 节点渲染在 sandbox iframe：`sandbox="allow-scripts"`（不配 `allow-same-origin`），或用 DOMPurify 清洗后再渲染。
- 画布文档里的 HTML / SVG 不参与主文档 DOM；不要用 `dangerouslySetInnerHTML` 直接注入。
- 公开分享页对 `html` / `svg` 节点同样沙箱；`Content-Security-Policy` 至少禁止 `unsafe-eval`，HTML/SVG 资源代理返回 `Content-Type: text/html` / `image/svg+xml` 时加 `Content-Disposition: attachment` 或强制 `text/plain`，避免同源脚本执行。
- 图片/音视频资源必须走 `nosniff`；不要根据客户端后缀猜类型。

### 14.3 限流

| 接口 | 规则 |
| --- | --- |
| 画布写入 | 120/min/user（可由 `canvas.writePerMinute` 覆盖） |
| 租约 | 240/min/user |
| 读取 / 历史 | 240/min/user |
| WS 票据 | 60/min/user |
| 公开文档 | 120/min/IP |
| 公开资源 | 300/min/IP |
| WS presence | 80 条/秒/连接 |

限流使用现有 `@RateLimit`；跨实例全局限流走 Redis 计数器（生产硬依赖，见 §3.2），不按实例分别计数。

### 14.4 可观测

结构化日志字段：

- `canvasId` / `ownerId` / `mutationId` / `operationCount` / `payloadBytes` / `revision` / `durationMs` / `conflictReason`。
- 指标：WS 连接数、房间数、mutation 延迟 P50/P95、冲突率、快照体积、分享访问量、资源代理 Range 比例。
- 错误日志不打印 `payload` 全文（可能含用户内容）；只打印摘要、大小、节点数。
- 请求追踪沿用 `requestContextMiddleware` 的 `X-Request-Id`；WS 握手与消息日志带同一个 id。

### 14.5 部署

- Redis：生产硬依赖（启动门禁 + `/health/ready` 探针，不启用内存降级）；WS 跨实例扇出；全局限流 / 缓存失效广播 / 定时任务锁走 Redis；文档写入不依赖 Redis。
- Nginx：`Upgrade` / `Connection` 透传，`proxy_read_timeout 3600s`，`client_max_body_size 8m`。
- Vite：`/api` 代理 `ws: true`。
- 备份：`pg_dump` 逻辑备份 + 上传目录单独备份；恢复演练纳入发布检查。
- 回滚：画布开关（`canvas.enabled`）可单独关闭写入口，不影响现有生成与账户功能；数据库迁移不可逆，回滚版本必须与迁移版本匹配。

## 15. 实施顺序与验收闸口

### 15.1 M0 基础设施（3–4 周）

1. Prisma 切 Postgres、删除 SQLite adapter、baseline migration。
2. Redis 模块、`REDIS_URL` 校验与启动期连通门禁、`/health/ready` 探针；多实例状态（限流 / 缓存失效广播 / 定时任务锁）收敛。
3. 备份服务重写、Docker 镜像加 `postgresql-client`。
4. 测试库切 Postgres schema；现有后端测试全绿。
5. compose / Nginx / Vite 代理更新。

**闸口**：`npm --prefix backend test`、`npm run check`、`npm run verify:deps:critical`、备份恢复演练、`probe-environments.ts`。

### 15.2 M1 文档内核（4–6 周）

1. 7 张表 + 索引 + 级联。
2. 列表 / 读取 / ETag / 删除。
3. `PATCH /operations` 全协议、回执、字段基线、revision CAS、媒体校验。
4. 错误码、DTO、限流。

**闸口**：operations 单测覆盖首建、幂等重放、摘要冲突、字段冲突、删除级联、连线端点、非法基线；集成测试覆盖并发写与 owner 隔离。

### 15.3 M2 编辑器（8–10 周）

1. 移植 `lib/canvas` 纯逻辑 + 89 个测试。
2. DOM 世界层 + SVG + Leafer 覆盖层。
3. 节点注册表、选择/连线/撤销重做、本地持久化。
4. 页面外壳与路由。

**闸口**：纯逻辑测试全绿；`npm --prefix frontend test`；`npm --prefix frontend run typecheck`；大文档渲染预算测试。

### 15.4 M3 生成（4–5 周）

1. 4 个画布能力与 `surface` 过滤。
2. 隐藏项目、任务创建、批量、重试、回填。
3. 文本/音频落盘分支。
4. 前端生成执行器与任务面板。

**闸口**：四模态回填、失败退款、断点恢复、批次聚合、文本/音频资产可读。

### 15.5 M4 协作与历史（4–5 周）

1. 租约与 `editProofs`。
2. WS 票据、房间、presence、invalidate。
3. 快照、历史列表、回滚、资源保护。

**闸口**：多标签页 presence、断线重连、64 会话上限、80 条/秒、5 分钟节流、20 条上限、回滚前后快照。

### 15.6 M5 分享与业务（6–8 周）

1. 分享 CRUD、轮换、过期、公开投影、资源代理。
2. 短剧项目联动、TapNow / LibTV 导入。
3. 后台画布设置、配额、存储只读。

**闸口**：轮换失效、过期失效、metadata 清洗、Range 请求、XSS 用例、后台审计。

### 15.7 M6 Agent 与 3D（8–10 周）

Agent run、工具、审批、SSE、`canvas_updated`、撤销、记忆；creation-runs 状态机；Previs / Live2D。单独一批迁移，不阻塞 M1–M5。

### 15.8 M7 生产化（4–6 周）

性能压测、安全审查、e2e、灰度、回滚演练。

### 15.9 前两周可执行清单

1. 写 baseline migration，现有后端测试在 Postgres 上跑绿。
2. 建 `CanvasProject` + `CanvasMutationReceipt` 两表与最小集成测试。
3. 实现 `GET /canvas-projects`、`GET /:id`、`PATCH /:id/operations` 的 `create_canvas` + `create_node` 闭环。
4. 用测试覆盖：首建、幂等重放、摘要冲突、revision CAS 冲突、owner 隔离。
5. 前端先跑通「列表 → 空画布 → 拖入图片节点 → 本地持久化」的最小闭环，不同步、不生成、不协作。

## 16. 风险与待决事项

| 风险 / 缺口 | 影响 | 对策 |
| --- | --- | --- |
| Postgres 迁移波及全仓 | 备份、测试、脚本、部署全部要改；迁移不彻底会出现「Nest 连 Postgres、脚本连 SQLite」 | M0 独立完成并演练；`db-url.js` 与 `env-files.ts` 同批改；测试库缺配置直接抛错 |
| BigInt revision 序列化 | `JSON.stringify` 抛错或前端精度丢失 | 统一 `Number()` 输出；DTO 类型用 number；DB 仍 BigInt |
| 摘要跨版本不稳定 | 回执重放失败或错误命中 | `v1` 前缀 + canonical JSON；迁移窗口不复用旧回执；摘要只在服务端算 |
| 画布能力出现在 C 端导航 | 用户点进通用工具页，入口语义错误 | 新增 `surface: 'product' \| 'canvas'`；`GET /capabilities` 只返回 product |
| `Modality` 缺 audio | `canvas_audio` 装配期失败 | 扩展 `Modality`；同步 `capability-plugin.type.ts` 的断言与前端类型 |
| 文本 / 音频产出无落盘分支 | `canvas_text` / `canvas_audio` 任务成功但无 Asset | 改 `task-worker` + `task-media` 的媒体分支；补测试 |
| 隐藏项目暴露 | 工作台项目列表出现「画布 xxx」 | `Project.origin` + 列表过滤；不要靠名称前缀 |
| WS 票据 / 设备号存储 | Redis 缺失时票据与设备号无法分配（已取消内存回退） | 生产由启动门禁 + `/health/ready` 探针拦截；dev / test 降级不影响交付 |
| 4 MiB 文档 + 5 MiB 请求 | Nginx / Express 默认 100KB 会 413 | `main.ts` 对该路由单独放宽 body limit；Nginx `client_max_body_size`；WS 不入 HTTP body |
| 上游 9,673 行 CSS 与 antd | 替换遗漏、样式回退 | 先产出 antd 使用清单；CI 禁止 `from 'antd'`；按页面逐步替换 |
| Agent / 3D 体量大 | 拖累核心里程碑 | M6 独立排队；7 张表不提前塞 Agent 字段 |
| 公开分享泄露 | token、storageKey、任务字段外泄 | 白名单投影 + 资源 allow-list + `nosniff` + CSP + 限流 |
| 单人排期失真 | 495–725 人日不可压缩 | M0–M3 至少 2 后端 + 2 前端；按里程碑验收，不按人日承诺 |

**待决事项**（需要仓库所有者确认后才能进入实现）：

1. Postgres 迁移的窗口与生产数据迁移方案（有无存量数据、停机时间）。
2. 是否接受把 `Modality` 扩展到 `audio`，以及文本/音频任务落盘的产品口径（文本是否作为可下载 Asset）。
3. 画布能力是否需要对 C 端完全隐藏（建议是），还是保留一个「画布」入口。
4. 分享资源代理是否允许跨域/缓存，以及公开页是否需要独立域名。
5. Agent / 3D 是否确实在 M6 交付；若只是「未来可能」，应从本轮范围移出，避免 7 张表被提前污染。
