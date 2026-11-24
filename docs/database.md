# 数据库规范

数据库为 **SQLite**，访问层为 Prisma 7（当前 7.10）+ 官方 `@prisma/adapter-better-sqlite3`。本文件按 Prisma 官方约定与最佳实践编写，约束 schema 写法、Prisma Client 用法与迁移流程；`backend/prisma/schema.prisma` 是表结构唯一事实源。环境与库文件映射见 [`environments.md`](environments.md)，备份与恢复见 [`docker-deployment.md`](docker-deployment.md)，安全约束见 [`security.md`](security.md)。

现状基线（2026-11-24，以 schema 为准）：67 个 model、167 个 `@@index`、29 个字段级 `@unique` + 19 个 `@@unique`；53 个 model 用 `cuid()` 主键，14 个用业务键或复合主键。

## 1. Prisma 配置与连接

- `backend/prisma.config.ts` 是 Prisma CLI 的唯一配置入口：`schema`、`migrations.path`、`datasource.url`、`migrations.seed`。Prisma 7 起 schema 的 `datasource` 只声明 `provider`，连接串由 CLI 配置与运行时 adapter 分别传入。
- 库路径只能由 `DATABASE_URL` 决定。Nest 与 Prisma CLI 共用 `src/config/env-files.ts` 的档位规则，脚本侧用 `scripts/db-url.js`；不得另写一套判断，否则会出现「服务连 test.db、CLI 打 dev.db」。
- 运行时只使用 `PrismaService`（`src/prisma/prisma.service.ts`）单例：继承 `PrismaClient`、经官方 driver adapter 传 URL、在 `onModuleInit` / `onModuleDestroy` 管理连接。业务代码不自行 `new PrismaClient()`。
- 连接行为实测：`foreign_keys=1`、`busy_timeout=5000`、`journal_mode=delete`。外键与写锁依赖这些连接级 PRAGMA；绕过 Prisma 直接用 better-sqlite3 打开库时必须自行 `PRAGMA foreign_keys=ON`。
- generator 是 Prisma 7 的 `prisma-client`，输出到 `src/generated/prisma`（`moduleFormat = "cjs"`、`importFileExtension = ""`）。生成目录已 gitignore，由 `prisma generate` 产出；应用代码统一从 `src/generated/prisma/client` 取 `PrismaClient`、`Prisma` 与模型类型，不再从 `@prisma/client` 取。`.js` 运维脚本经 `scripts/prisma-client.js`（ts-node transpile-only）加载同一份 client。schema 变更后由 `npm run build`（内含 `prisma generate`）刷新 client；不要提交或手工修改生成产物。

## 2. Schema 组织与命名

- 单一 `schema.prisma`，按业务域用 `//` 分区；不拆多文件，不保留兼容字段与死字段。
- 命名沿用 Prisma 官方约定：

| 对象 | 约定 | 示例 |
| --- | --- | --- |
| model | 单数 PascalCase | `GenerationTask` / `CreditLot` |
| 字段 | camelCase | `orderNo` / `createdAt` |
| 表名 | 与 model 同名，不写 `@@map` / `@map` | `model User` → 表 `User` |
| 关系 | to-one 单数、to-many 复数 | `user` / `orders` |
| 多对多 | 显式 join model | `UserGroupChannel` |
| 金额 / 积分 | 单位后缀 | `paidCents` / `amountMicrocredits` |

- `///` 用于会进入 Prisma Client 文档的字段说明；`//` 只用于解释实现原因。状态字段必须用 `///` 列出全部取值与白名单来源；JSON 字段必须写明结构与版本。
- 字段名沿用业务语义，不强加统一后缀；布尔字段用肯定语义（`verified` / `enabled`），避免 `notXxx` 双重否定。

## 3. 主键与时间

- 业务实体主键 `String @id @default(cuid())`，统一 cuid，不混用 uuid / `cuid(2)`；不暴露自增 id 或 SQLite rowid。
- 一对一、配置、游标与关联表用业务键或复合主键，不额外造代理 id：`SystemSetting.key`、`CapabilityPricing.capabilityId`、`CreditAccount.userId`、`@@id([groupId, channelId])`。
- `createdAt DateTime @default(now())` 是默认要求；可变对象必须有 `updatedAt DateTime @updatedAt`；纯追加型日志表可省略。时间按 UTC 存储，展示层换算。
- `@updatedAt` 由 Prisma Client 写入，不是数据库触发器：`$executeRaw`、迁移 SQL 或外部脚本更新行不会自动刷新，必须显式赋值。
- 业务时间（支付、完成、过期、验证）单独建字段，不复用 `createdAt`。
- 软删除按域用状态字段（`User.status='deleted'`、`Product.status='offline'`、`Asset.hidden`），不引入统一 `deletedAt`，也不用 Prisma 中间件 / 扩展做全局软删——全局过滤会与唯一约束、原生查询和迁移脚本冲突。

## 4. 关系与参照动作

- 关系必须显式声明 `fields` / `references`；同一对 model 存在多条关系时用 `@relation("Name")` 区分（如邀请人与被邀请人）。
- 参照动作依赖 Prisma 默认：必填关系 `Restrict`，可选关系 `SetNull`；只有偏离默认时才显式写 `onDelete`。不切 `relationMode="prisma"`，外键交给数据库执行。
- `Cascade` 只用于「父对象拥有、离开父对象即无意义」的数据：OAuth 身份、订单取消事件、工单回复、模板分组与条目。
- 财务与审计记录禁止级联删除：订单、支付、退款、发票、积分流水、生成账单。账号注销时保留并匿名化，不随 `User` 删除。
- 外键标量若参与 `where` / `orderBy` / `count`，必须补 `@@index`；SQLite 不会自动为关系字段建索引。
- 多对多优先显式 join model，便于挂字段、加索引与审计，不用 Prisma 隐式 m-n。

## 5. 类型与取值

- 金额统一 `Int` **分**；积分统一 `BigInt` **微积分**。禁止用 `Float` / `Decimal` 存钱：SQLite connector 接受 `Decimal`，但官方 adapter 会把 decimal 参数按 double 解析，精度不可靠。
- 字段名必须带单位后缀，读写两端按同一单位换算，不在中途转成元或积分小数。
- API 输出 `BigInt` 前必须转 `string`（或安全范围内的 `number`）；直接 `JSON.stringify(BigInt)` 会抛错。
- 状态 / 枚举：以 service 白名单为运行时唯一事实源，字段用 `String`。Prisma 7 允许在 SQLite schema 声明 `enum`，但生成的是 `TEXT` 且无 `CHECK`，数据库层不校验；增删取值还要 `generate` 并改全链路类型。仅当某模型私有的稳定小集合确实需要编译期约束时才用 `enum`，并在 `///` 注释里写明。
- JSON：本仓统一用 `String` 存 JSON 文本，读写两端 `JSON.parse` / `JSON.stringify`，注释写结构。Prisma 的 `Json`（SQLite 上映射 JSONB）不混用，避免 `Prisma.JsonValue` 与字符串解析两套类型来回转换；需要筛选、关联、聚合的数据必须拆列或拆表。
- JSON 不存明文凭证；密钥先经 `SecretCipher` / `PaymentCipher` 加密。读取时用容错解析，损坏按业务默认值或显式失败，不静默当空对象。
- `String? @unique` 在 SQLite 中允许多个 `NULL`，只保证非空值唯一；需要「二选一必填」时在 service 校验，不要指望唯一约束。`@default` 应覆盖布尔、状态等常用字段，保证最基本的 `create` 不需要逐字段拼装。

## 6. 索引与唯一约束

- 索引服务于真实查询：新增或修改查询条件时先看现有索引的最左前缀，再决定是否新增；不允许「先上线再补」。
- 单列索引用于高频等值筛选（`status` / `userId` / `orderNo`）；复合索引把等值条件放前、范围或排序列放后，例如 `@@index([userId, status, createdAt])`。
- 业务唯一键必须落 `@unique` / `@@unique`：邮箱、订单号、邀请码、幂等键、支付回调事件 id、渠道模型组合。`@id` 与 `@unique` 已自带索引，不重复建。
- 不建重复索引：已有复合索引最左前缀能覆盖的单列索引不新增。
- Prisma schema 不支持部分索引与表达式索引；确有需要时用 `prisma migrate dev --create-only` 写 SQL，并注释用途与对应查询。
- 索引只有在迁移真正执行后才生效；变更后用 `EXPLAIN QUERY PLAN` 验证，而不是只看 schema。

## 7. 状态与状态机

- 状态值只在 service 常量中定义：工单 `TRANSITIONS`、账单 `BILLING_STATUSES`、任务 `queued/running/succeeded/failed/cancelled`。
- 写入前按白名单校验；未知值拒绝，不静默落库。数据库没有 `CHECK`，这条链路是唯一防线。
- 流转用条件更新（`updateMany({ where: { id, status: 旧值 } })`）并检查影响行数，避免并发覆盖；0 行按幂等或冲突处理。
- 新增状态必须同时补：白名单、状态机边、展示文案与色调（`STATUS_META`）、迁移 / 回填、测试。

## 8. Prisma Client 使用

- 查询显式 `select` / `include`，只取页面需要的列；不 `findMany()` 取整行再在内存裁剪。
- 避免 N+1：列表里不为每一行单独查关联，用 `include` 或一次批量 `in`；计数用 `count` / `groupBy`，不把全量拉到内存。
- 分页 `take` 必须有上限；深分页用 cursor（`cursor` + `skip: 1`），不用大 offset。排序字段必须稳定且有序。
- 多行不变量放同一个 `$transaction`：建任务 + 建账单 + 预留积分是典型场景。相互独立的写用数组形式 `$transaction([...])`；有读后写依赖才用交互式事务，并显式设置 `timeout` / `maxWait`。
- 事务内只做数据库操作；渠道调用、文件写入、上游请求放在事务外，先落中间态再推进。SQLite 单写者 + 5s busy timeout，长事务会阻塞全站写入。
- 原生 SQL 只用 `$queryRaw` / `$executeRaw` 标签模板（或 `Prisma.sql`），禁止 `$queryRawUnsafe` / `$executeRawUnsafe` 与字符串拼接（见 [`security.md`](security.md) §7）。
- 预期错误按 Prisma 错误码分流：`P2002` 唯一冲突、`P2025` 记录不存在、`P2003` 外键失败；翻译成领域异常，不把 Prisma 原文抛给用户。
- 批量更新 / 删除返回 `count`，调用方必须处理 0 行；不要假定「没抛错 = 改成功」。
- 批量动作不包大事务，逐条返回结果，避免长时间持有写锁。

## 9. 迁移（Prisma Migrate）

标准流程：

1. 修改 `schema.prisma`（含注释与索引），运行 `npx prisma validate` 与 `npx prisma format`。
2. 开发环境：`npx prisma migrate dev --name <verb_noun>`。生成 `prisma/migrations/<timestamp>_<name>/migration.sql`，应用到开发库，并刷新 client。
3. 测试 / 生产：只运行 `npx prisma migrate deploy`。它仅应用未执行的迁移，不做结构 diff、不 reset。
4. 迁移目录必须提交入库；**已应用的迁移不可修改、不可删除**，修正只能追加新迁移。
5. 需要手写 SQL（数据回填、部分索引、SQLite 列重建调整）时先用 `--create-only`，审阅 SQL 后再执行。

约束：

- `prisma db push` 只用于一次性原型，不进入版本化环境。日常开发用 `db:migrate:dev`，测试 / 生产用 `db:migrate:deploy`。
- 破坏性变更（删列、改类型、收紧唯一约束、改名）按 expand → migrate → contract 跨版本完成，不试图用一次迁移删数据。SQLite 的列变更由 Prisma 生成「建新表 + 搬数据 + 删旧表」，必须审阅 SQL。
- 数据迁移与结构迁移分开：短小、纯 SQL 的回填放 `--create-only` 迁移；需要业务判断或调用 service 的放 `scripts/migrate-*.js`，必须幂等、可重复执行、按目标环境校验。
- 执行迁移前先备份（§12）；生产变更先在测试库用生产副本演练。
- 闸口：`npm run verify:prisma` 依次执行 `prisma validate`、临时副本上的 `prisma format` 比对，以及 `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`（不一致退出码 2）。`npx prisma migrate status` 用于检查当前环境是否有未应用迁移。
- 存量库基线：先用当前 schema 生成首个迁移，`npx prisma migrate resolve --applied <baseline>` 标记已应用，再执行 `migrate deploy`；新库直接 deploy。

仓库现状：`prisma/migrations/20261124061501_baseline` 已建立；`dev.db` / `test.db` 用 `migrate resolve --applied` 标记基线，`migrate status` 均为 up to date。本地 `start.sh`、Compose 的 `backend-migrate` 与生产 tools 镜像统一执行 `prisma migrate deploy`，没有流程再走 `db push`。

## 10. 种子

- 目标形态：`prisma.config.ts` 的 `migrations.seed` 指向种子入口，用 `npx prisma db seed` 触发；当前仍是显式 `npm run seed:*` 链条。两条路径只保留一套。
- `seed:all` 顺序：普通账号 → 角色 → 管理员 → 商业 → 会员 → 营销 → 消息模板 → 模板目录。
- 所有 seed 必须幂等：优先 `upsert`，其次「存在则更新 / 不存在则创建」。
- `seed-roles` 按代码回写权限点，会覆盖运营在角色页的调整；生产不要反复执行。
- `seed-admin` 重复执行不重置已有密码；生产密码随机生成且只输出一次。
- 种子与冒烟脚本连库必须走 `scripts/db-url.js`；操作测试库前显式 `NODE_ENV=test`，否则会写开发库。
- 生产禁止固定预设密码；C 端普通账号永远不授予后台角色。

## 11. 测试库与隔离

- 开发库 `backend/dev.db`，测试库 `backend/test.db`；两档端口相同，不能并行。
- `npm run db:reset:test` 只允许操作测试环境：路径必须在 `backend/` 内且含 `test` 字样，否则拒绝执行。
- 后端单测（Vitest）不连库；需要真实库的集成验证走 `verify-*` / `smoke-*` 脚本并使用临时库，不碰 `dev.db` / `test.db`。
- 临时库建表用 `migrate deploy`，保证测试跑的就是迁移后的结构。
- 生产环境禁止执行任何 `db:reset:*` 或删除类脚本。

## 12. 备份与恢复

- 备份使用 `VACUUM INTO` 生成一致性快照，记录 SHA-256；`cp` 可能拿到撕裂文件，禁止使用。
- 恢复前先做 `PRAGMA integrity_check` + 表结构校验，未通过验证的备份不可下载。
- Schema 迁移与数据迁移前必须备份；备份文件本身未加密（见 [`security.md`](security.md) §11）。

## 13. 新增 / 修改 model 自检

- [ ] `prisma validate` 与 `prisma format` 通过？
- [ ] 有 `id`、`createdAt`，可变对象有 `updatedAt`？
- [ ] 状态字段注释列出取值与约束来源？JSON 字段写明结构与版本？
- [ ] 金额是否用 `Cents` / `Microcredits` 整数，字段名带单位？
- [ ] 关系是否声明 `fields` / `references`？级联是否只用于所有者数据？
- [ ] 查询条件是否有索引？唯一键是否落 `@unique` / `@@unique`？外键参与筛选是否有索引？
- [ ] 是否坚守「JSON 只用 String」的约定，没有混入 `Json` 类型？
- [ ] 是否附带 `prisma/migrations/` 下的新迁移或幂等回填脚本？
- [ ] 是否同步更新本文件的数量描述与相关文档？

## 14. 已知缺口与偏离

- **无 WAL 模式**：`journal_mode=delete`，读写并发有限，依赖 5 秒 busy timeout；多进程写入是瓶颈。
- **数据库层不校验状态与金额范围**：非法状态、负数金额只能靠 service 拦截。
- **JSON 无结构校验**：损坏的 JSON 只能在读取时容错，缺少统一 schema。
- **备份未加密**：备份含用户数据，落盘只做完整性校验。