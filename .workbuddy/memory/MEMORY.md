# 项目长期记忆 — aigc-creation / 货觉AI

## 生产基础设施口径（2026-11-09 用户裁定）

- 生产使用 **PostgreSQL + Redis**，不保留 SQLite 双轨。
- **Redis 是生产硬依赖**：`REDIS_URL` 非空且连通作为生产启动门禁；`/health/ready` 纳入 Redis 探针；「单实例内存 Hub + 2 秒轮询」降级仅允许 development / test。多实例下全局限流、缓存失效广播、定时任务分布式锁一并收敛。
- 与 `docs/canvas-port-design.md:30` §1.2、`docs/canvas-detailed-design.md:9` 口径一致；但 `canvas-detailed-design.md:90-95,119` 的「生产单实例可空、连接失败只告警降级」与此裁定冲突，**仍待对齐**。
- 2026-11-09 已按裁定对齐 `docs/canvas-port-design.md`：§1.2 / §3.1 / §6.4 / §7 P0 / §9 / §12 / §13 明确生产硬依赖、启动门禁 + `/health/ready` 探针、降级仅限 development / test、多实例状态收敛进 P0。仅改文档，未动代码，`canvas-detailed-design.md` 未改。
- 代码现状仍为 SQLite：`prisma/schema.prisma:10` provider=sqlite、`docker-compose.production.yml:31` 写死 `file:/app/data/prod.db`、自研 `node-sqlite-adapter.ts`、无 Redis 依赖与 `REDIS_URL`。P0 / M0 基础设施改造尚未动工。
- 切 PG 的高危面：9 处 no-op UPDATE 抢 SQLite 全局写锁、`credit-wallet.service.ts:131` FEFO 先读后写丢更新、约 40 处 `contains` 大小写敏感差异、`VACUUM INTO` 备份链作废、`prisma/migrations/` 不存在且有存量数据。
- `CLAUDE.md` / `docs/environments.md` / `README.md` 仍为 SQLite 口径，应在 P0 落地时同步更新。
