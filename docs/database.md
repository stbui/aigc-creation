# 数据库规范

数据库为 **SQLite**，访问层为 Prisma 7 + 自研 `node:sqlite` driver adapter。`backend/prisma/schema.prisma` 是表结构唯一事实源；环境与库文件映射见 [`environments.md`](environments.md)，备份与恢复见 [`docker-deployment.md`](docker-deployment.md)，安全约束见 [`security.md`](security.md)。

## 1. 基本约束

- **SQLite 不支持 Prisma enum**。所有状态、类型、模式字段一律 `String`，取值范围由 DTO 白名单与 service 层校验。
- 当前 65 个 model。业务实体使用 `String @id @default(cuid())`（56 个）；配置、关联与游标表使用业务键或复合主键（9 个），例如 `SystemSetting.key`、`CapabilityPricing.capabilityId`、`CreditAccount.userId`、`UserGroupChannel @@id([groupId, channelId])`。
- 连接配置在 `backend/prisma.config.ts`；库文件由 `DATABASE_URL` 按 `NODE_ENV` 决定，与 Nest 侧共用 `env-files.ts`，不得另写一套判断。
- driver adapter 使用 `node:sqlite`，连接时设置 `PRAGMA busy_timeout = 5000`；外键约束由 `node:sqlite` 默认开启。
- SQLite 单写者：长事务会阻塞其它写入。事务内不得执行网络请求、文件上传、模型调用等慢操作。

## 2. 命名

| 对象 | 约定 | 示例 |
| --- | --- | --- |
| model | PascalCase、单数 | `GenerationTask` / `CreditLot` |
| 字段 | camelCase | `orderNo` / `createdAt` |
| 表名 | 与 model 同名，不用 `@@map` 另起名字 | `model User` → 表 `User` |
| 关系字段 | 单数引用、复数集合 | `user` / `orders` |
| 金额 | 整数分后缀 `Cents`；积分后缀 `Microcredits` | `paidCents` / `amountCents` |
| 状态 | 名词或 `status` | `status` / `stage` / `result` |

- 状态字段必须在 `///` 注释里列出全部取值，并注明由哪份白名单约束。
- JSON 字段必须在注释里写明结构与版本；字段名沿用业务语义，不强加统一后缀。
- 布尔字段用肯定语义（`verified` / `enabled`），避免 `notXxx` 双重否定。

## 3. 主键与时间

- 业务实体主键默认 `String @id @default(cuid())`，不暴露自增 id。
- 一对一、关联、配置与游标表用业务键或复合主键，不再额外造代理 id（如 `CreditAccount.userId`、`@@id([billingOrderId, lotId])`）。
- `createdAt DateTime @default(now())` 是默认要求。
- 可变业务对象必须有 `updatedAt DateTime @updatedAt`；纯追加型日志表可以省略（当前 65 个 model 中 33 个有 `updatedAt`）。
- 业务时间（支付时间、完成时间、过期时间）单独建字段，不复用 `createdAt`。
- 软删除按域处理：账号用 `User.status='deleted'`，商品用 `Product.status='offline'`，素材用 `Asset.hidden`；**不要引入统一的 `deletedAt`**。

## 4. 关系与级联

- 关系必须显式声明 `fields` / `references`。
- 必填关系默认 `Restrict`，可选关系默认 `SetNull`；需要级联时显式写 `onDelete`。
- **只对「父对象拥有、离开父对象即无意义」的数据使用 `Cascade`**：OAuth 身份、订单取消事件、工单回复、模板条目等。
- **财务与审计记录禁止级联删除**：订单、支付、退款、发票、积分流水、生成账单。账号注销时保留并匿名化，不得随 `User` 删除。
- 外键字段若参与筛选或排序，必须补 `@@index`。

## 5. 索引与唯一约束

- 当前 164 个 `@@index`、19 个 `@@unique`。新增查询必须评估索引，不允许「先上线再补」。
- 单列索引用于高频等值筛选（`status` / `userId` / `orderNo`）。
- 复合索引把**等值条件放前、范围条件放后**；例如 `@@index([userId, status, createdAt])`。
- 业务唯一键必须落 `@@unique`：邮箱、订单号、邀请码、幂等键、支付回调事件 id、渠道模型组合。
- 不重复建索引；已有复合索引最左前缀能覆盖的单列索引不再新增。

## 6. 金额与精度

- 金额统一用 **整数分** `Int`；积分统一用 **微积分** `BigInt`。禁止用 `Float` / `Real` 存钱。
- 字段名必须带单位后缀，读写两端都按同一单位换算，不在中途转成元或积分小数。
- 订单、账单必须保存价格快照（`priceCentsSnapshot` / `creditCost` / `ruleSnapshot`），不能只存外键后实时回查。
- 余额由批次汇总推导（`CreditAccount.availableMicrocredits == Σ CreditLot.remainingMicrocredits`），不单独维护可漂移的冗余余额。
- 金额与积分的加减必须走 service 的领域方法，不在页面或脚本里直接改字段。

## 7. 状态与状态机

- 状态值只在 service 常量中定义：工单 `TRANSITIONS`、账单 `BILLING_STATUSES`、任务 `queued/running/succeeded/failed/cancelled`。
- 写入前必须按白名单校验；未知值拒绝，不静默落库。
- 状态流转用条件更新（`updateMany({ where: { id, status: 旧值 } })`）并检查影响行数，避免并发覆盖。
- 新增状态必须同时补：白名单、状态机边、展示文案与色调（`STATUS_META`）、迁移/回填脚本、测试。

## 8. JSON 字段

- SQLite 中 JSON 以 `String` 存储（当前统一做法），Prisma 不做结构校验。
- 每个 JSON 字段必须有 `///` 注释写明形状；读取时 `JSON.parse` 要用容错函数，损坏时按业务默认值或显式失败，不静默当空对象。
- JSON 只用于**快照、可变配置、上游原始报文**；需要筛选、关联、聚合的数据必须拆列或拆表。
- JSON 中不得存明文凭证；需要存密钥时先经 `SecretCipher` / `PaymentCipher` 加密。
- 新增 JSON 字段时评估是否需要版本字段，避免结构演进后无法识别旧数据。

## 9. 事务与并发

- 多行不变量必须在同一 `$transaction` 内完成，例如「建任务 + 建账单 + 预留积分」。
- 事务内只做数据库操作；渠道调用、文件写入、上游请求放在事务外，先落中间态再推进。
- 状态变更用 CAS（条件更新 + 影响行数判断）；影响行数为 0 表示已被其它请求处理，按幂等或冲突处理。
- 原始 SQL 只用 `$queryRaw` / `$executeRaw` 的标签模板参数化，禁止字符串拼接（见 [`security.md`](security.md) §7）。
- 批量动作不包大事务，逐条返回结果，避免长时间持有写锁。

## 10. 迁移

当前**没有版本化 migration 目录**，表结构通过 `prisma db push` 应用：

- 本地 / 测试：`npm run db:push:dev` / `npm run db:push:test`。
- 生产：`docker-compose.production.yml` 的 `migrate` 服务在 backend 启动前执行 `npx prisma db push`，失败则不启动后端。
- 数据搬迁用 `backend/scripts/migrate-*.js`（如 `migrate-project-lifecycle.js` / `migrate-tool-idempotency.js`），必须幂等、可重复执行、按目标环境校验。

Schema 变更流程：

1. 改 `schema.prisma`，补注释与索引。
2. `npm run prisma:generate` 更新 client。
3. 对应环境执行 `db:push:*`；生产先做备份。
4. 需要回填时写独立脚本，验证幂等后再上线。
5. 同步更新 `CLAUDE.md` 中受影响的数量描述与本文件。

破坏性变更（删列、改类型、收紧唯一约束）必须先备份、先回填、再切换；不得依赖 `db push` 自动猜。

## 11. 种子

- `seed:all` 顺序：普通账号 → 角色 → 管理员 → 商业 → 会员 → 营销 → 消息模板 → 模板目录。
- 所有 seed 必须**幂等**：优先 `upsert`，其次「存在则更新 / 不存在则创建」。
- `seed-roles` 会按代码定义回写权限点，覆盖运营在角色页的调整；生产不要反复执行。
- `seed-admin` 重复执行不重置已有密码；生产密码随机生成且只输出一次。
- 种子与冒烟脚本必须通过 `scripts/db-url.js` 解析库路径；在测试档执行前先 `NODE_ENV=test`，否则会写开发库。
- 生产禁止使用固定预设密码；C 端普通账号永远不授予后台角色。

## 12. 测试库与隔离

- 开发库 `backend/dev.db`，测试库 `backend/test.db`，两档端口相同、不能并行。
- `npm run db:reset:test` 只允许操作测试环境：路径必须在 `backend/` 内且含 `test` 字样，否则拒绝执行。
- 后端 HTTP 集成测试使用临时库，不碰 `dev.db` / `test.db`，也不依赖已启动服务（见 [`testing.md`](testing.md)）。
- 生产环境禁止执行任何 `db:reset:*` 或删除类脚本。

## 13. 备份与恢复

- 备份使用 `VACUUM INTO` 生成一致性快照，记录 SHA-256；`cp` 可能拿到撕裂文件，禁止使用。
- 恢复前先做 `PRAGMA integrity_check` + 表结构校验，未通过验证的备份不可下载。
- Schema 变更与数据迁移前必须备份；备份文件本身未加密（见 [`security.md`](security.md) §11）。

## 14. 新增 / 修改 model 自检

- [ ] 有 `id`、`createdAt`，可变对象有 `updatedAt`？
- [ ] 状态字段注释列出取值与约束来源？
- [ ] 金额是否用 `Cents` / `Microcredits` 整数，字段名带单位？
- [ ] 关系是否声明 `fields` / `references`？级联是否只用于所有者数据？
- [ ] 查询条件是否有索引？唯一键是否落 `@@unique`？
- [ ] JSON 字段是否写明结构并做容错解析？
- [ ] 是否需要在 `schema.prisma` 之外补数据迁移脚本？
- [ ] 是否同步更新数量描述与相关文档？

## 15. 已知缺口

- **没有版本化 migration**：`db push` 直接改库，缺少可审计的变更历史与回滚脚本。
- **无 WAL 模式**：读写并发能力有限，依赖 5 秒 busy timeout；多进程写入仍是瓶颈。
- **数据库层不校验状态与金额范围**：非法状态、负数金额只能靠 service 拦截。
- **JSON 无结构校验**：损坏的 JSON 只能在读取时容错，缺少统一 schema。
- **无独立 schema 检查**：CI 通过 `prisma generate` 间接校验语法；`prisma format`、索引与关系告警不会单独暴露。
- **备份未加密**：备份含用户数据，落盘只做完整性校验（见安全规范）。
