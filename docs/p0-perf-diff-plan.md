# P0 性能改动 · 可执行 diff 清单（待裁定，未实施）

- 目标：消除压测暴露的鉴权路径瓶颈（鉴权 QPS 天花板 ~374，P50 515ms @ 并发 200）
- 范围：`backend/src`，仅 P0 两项；capabilities 缓存与 workbench 并行化属 P1，本清单不含
- 已裁定取舍：
  1. 缓存失效 = **主动失效 + 2s 兜底 TTL**（写入点显式 del，漏挂时最多 2s 生效，不永久失效）
  2. `/me` 的 5 个 count = **单条聚合 SQL**（5 次查询 → 1 次）
- 复用既有设施：`CacheModule` 全局注册（`cache/cache.module.ts`）、`CACHE_MANAGER` 注入、`settings.service.ts` 的 `get/invalidate` 范式
- 前置事实（代码取证）：
  - `JwtAuthGuard` 每请求 `prisma.user.findUnique`（`common/jwt-auth.guard.ts:44`）
  - `/me` = 1 次 user 查询 + 5 次 count（`account/account.service.ts:22-66`）
  - 影响鉴权的用户写入共 5 处（见下表），全部需要挂失效
  - `@UseGuards(JwtAuthGuard)` 挂在 20+ 模块，守卫由各模块注入器实例化 → 新服务必须放 `@Global()` 的 `CommonModule`
  - 单测当前仅 `account/account-lifecycle.service.spec.ts` 一份，无 jwt/auth guard 单测

---

## 改动 A：新增 AuthUserCacheService（新文件）

**文件**：`backend/src/common/auth-user-cache.service.ts`（新增）

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service';

/** 兜底 TTL：写入点漏挂 invalidate 时，禁用/改密最多延迟 2 秒生效 */
const AUTH_USER_TTL_MS = 2_000;
const keyOf = (userId: string) => `auth:user:${userId}`;

/**
 * 鉴权用户快照缓存。
 *
 * 缓存 JwtAuthGuard 判定所需的全部用户列，把每请求一次 SQLite 查询降为
 * 进程内命中。语义保持「禁用/改密立即生效」：所有改这些列的写入点
 * 必须调用 invalidate() 显式删除；TTL 只是漏挂时的兜底，不是失效主路径。
 *
 * 单实例语义：多实例部署时各进程独立，写入方的 invalidate 只清自己进程。
 * 这与 CacheModule 边界一致；真要多实例需换共享 store（见 cache.module.ts:19-24）。
 */
export interface AuthUserSnapshot {
  id: string;
  email: string;
  status: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: Date | null;
}

@Injectable()
export class AuthUserCacheService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async get(userId: string): Promise<AuthUserSnapshot | null> {
    const key = keyOf(userId);
    const hit = await this.cache.get<AuthUserSnapshot>(key);
    if (hit !== undefined) return hit;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        tokenVersion: true,
        mustChangePassword: true,
        tempPasswordExpiresAt: true,
      },
    });
    const snapshot: AuthUserSnapshot | null = user
      ? { ...user, status: String(user.status), tempPasswordExpiresAt: user.tempPasswordExpiresAt ?? null }
      : null;
    await this.cache.set(key, snapshot, AUTH_USER_TTL_MS);
    return snapshot;
  }

  async invalidate(userId: string): Promise<void> {
    await this.cache.del(keyOf(userId));
  }
}
```

---

## 改动 B：CommonModule 注册并导出（2 行）

**文件**：`backend/src/common/common.module.ts`

```diff
 import { JwtService } from './jwt.service';
+import { AuthUserCacheService } from './auth-user-cache.service';
@@
-  providers: [SignedUrlService, SettingsService, SettingImageService, SecretCipher, JwtService],
-  exports: [SignedUrlService, SettingsService, SettingImageService, SecretCipher, JwtService],
+  providers: [SignedUrlService, SettingsService, SettingImageService, SecretCipher, JwtService, AuthUserCacheService],
+  exports: [SignedUrlService, SettingsService, SettingImageService, SecretCipher, JwtService, AuthUserCacheService],
```

> 必须放进 `@Global()` 的 CommonModule：JwtAuthGuard 由每个使用它的模块各自实例化，普通模块导出会导致部分路由运行时 `Cannot read properties of undefined`（与 `prisma.module.ts:7-13` 的注释同理）。

---

## 改动 C：JwtAuthGuard 改走缓存

**文件**：`backend/src/common/jwt-auth.guard.ts`

```diff
 import { PrismaService } from '../prisma/prisma.service';
+import { AuthUserCacheService } from './auth-user-cache.service';
@@
   constructor(
     private readonly prisma: PrismaService,
     private readonly jwt: JwtService,
+    private readonly authUsers: AuthUserCacheService,
   ) {}
@@
-    const user = await this.prisma.user.findUnique({
-      where: { id: payload.sub },
-      select: {
-        id: true,
-        email: true,
-        status: true,
-        tokenVersion: true,
-        mustChangePassword: true,
-        tempPasswordExpiresAt: true,
-      },
-    });
+    const user = await this.authUsers.get(payload.sub);
```

- `prisma` 私有成员保留但不再被本文件使用；**建议一并从 constructor 移除**（TS 未启用 noUnusedParameters 时可留，最小 diff 可先留）——见"待裁定项 1"。
- 判定逻辑（:55-98）逐字不动：缓存命中与查库返回同形状，null 分支语义一致。

---

## 改动 D：5 个写入点挂失效（关键，漏一个就破坏"立即生效"）

| # | 文件:行 | 场景 | 失效调用位置 |
| --- | --- | --- | --- |
| 1 | `account/account.service.ts:124` | 用户自行改密（tokenVersion++） | `user.update` 之后、`return` 之前 |
| 2 | `account/account-lifecycle.service.ts:108` | 软注销（status=deleted, tokenVersion++） | `$transaction` 之后、`return` 之前 |
| 3 | `admin/users.service.ts:~672` | 后台启用/禁用（status 变更） | `$transaction` 之后、notify 之前 |
| 4 | `admin/users.service.ts:746` | 后台重置密码（tokenVersion++, mustChangePassword） | `user.update` 之后、notify 之前 |
| 5 | `admin/users.service.ts:790` | 强制下线（tokenVersion++） | `$transaction` 之后、`return` 之前 |

**统一模式**（每处一致）：注入 `AuthUserCacheService`，写入成功后 `await this.authUsers.invalidate(userId)`。

示例 diff（改动 1，`account/account.service.ts`）：

```diff
 import { AccountLifecycleService } from './account-lifecycle.service';
+import { AuthUserCacheService } from '../common/auth-user-cache.service';
@@
   constructor(
     private readonly prisma: PrismaService,
     private readonly lifecycle: AccountLifecycleService,
+    private readonly authUsers: AuthUserCacheService,
   ) {}
@@
     await this.prisma.user.update({
       where: { id: userId },
       data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false, tempPasswordExpiresAt: null },
     });
+    await this.authUsers.invalidate(userId);
     return { changed: true };
```

其余 4 处同构。`AuthUserCacheService` 在全局模块导出，这些 service 所在模块无需加 imports。

> `auth.service.ts:351`（邮件令牌重置密码）也改 tokenVersion + mustChangePassword，但它是 **未登录** 链路：重置成功后旧 token 失效由守卫比对 tokenVersion 保证，下一次请求必然重新查库或读到被失效的缓存。为稳妥**建议也挂失效**（列为待裁定项 2）。

---

## 改动 E：`/me` 5 个 count → 单条聚合 SQL

**文件**：`backend/src/account/account.service.ts:45-66`

替换 `Promise.all([...5 个 count...])` 为：

```ts
const [row] = await this.prisma.$queryRaw<Array<{
  projects: bigint; tasks: bigint; assets: bigint; orders: bigint; unread: bigint;
}>>`
  SELECT
    (SELECT COUNT(*) FROM Project
      WHERE ownerId = ${userId} AND deletedAt IS NULL) AS projects,
    (SELECT COUNT(*) FROM GenerationTask t
      JOIN Project p ON p.id = t.projectId
      JOIN Asset a ON a.id = t.outputAssetId
      WHERE t.ownerId = ${userId} AND p.deletedAt IS NULL
        AND a.status = 'visible') AS tasks,
    (SELECT COUNT(*) FROM Asset a
      JOIN Project p ON p.id = a.projectId
      WHERE a.ownerId = ${userId} AND a.status = 'visible'
        AND p.deletedAt IS NULL) AS assets,
    (SELECT COUNT(*) FROM "Order" WHERE userId = ${userId}) AS orders,
    (SELECT COUNT(*) FROM Notification
      WHERE userId = ${userId} AND readAt IS NULL) AS unread
`;
const projects = Number(row.projects);
const tasks = Number(row.tasks);
const assets = Number(row.assets);
const orders = Number(row.orders);
const unread = Number(row.unread);
```

**必须注意的语义保真点**：
1. `Order` 是 SQL 保留字，必须加双引号 `"Order"`（表名已确认无 `@@map`，`schema.prisma:221`）。
2. 原 `count()` 的 where 逐字映射到 SQL：`generationTask` 的 `outputAsset: { is: { status:'visible' } }` → `JOIN Asset a ON a.id = t.outputAssetId AND a.status='visible'`；`project: { deletedAt: null }` → `JOIN Project p ... AND p.deletedAt IS NULL`。JOIN 不会改变 count 语义，因为 `outputAssetId @unique`（1:1），且 project 为必填关系。
3. Prisma 的 `count()` 返回 `number`，`$queryRaw` 的 SQLite `COUNT(*)` 返回 `bigint` → 必须 `Number()` 转换，否则 `JSON.stringify` 抛错（与 `account.service.ts:194-196` 的 BigInt 注释同理）。
4. 保留 `Promise.all` 中 5 个 count 的相对顺序与 `counts`/`unread` 返回形状（`:72-73`），前端契约不变。

---

## 验证清单（改完后按此跑，本轮不跑）

| 层级 | 命令 / 动作 | 通过标准 |
| --- | --- | --- |
| 类型 | `cd backend && npm run build` | 零 TS 错误 |
| 单测 | `cd backend && npm test` | 全绿；新增 guard 缓存失效用例 |
| 契约 | `GET /api/v1/me` 前后响应 diff | `counts`/`unread` 字段与数值完全一致 |
| 失效 | 改密/禁用/注销/重置/强制下线后，用旧 token 调 `/me` | 分别得到 40102 / 40302 / 40101 / 40102 / 40102 |
| 压测 | 同一脚本 `SCENARIO_FILTER=me CONC=50/200` | QPS 显著高于基线 359/374；P50 显著低于 134/515ms |
| 日志 | 压测期间 app error log | 零新增 |

**新增单测要求**（至少 4 例）：
1. 缓存命中时不触发 `prisma.user.findUnique`（mock 计数）
2. `invalidate()` 后下一次 `get()` 重新查库
3. 禁用用户后旧 token 请求返回 40302（走完整 guard）
4. `/me` 聚合 SQL 的返回与逐条 count 在相同 fixture 下数值一致

---

## 风险与回滚

- **风险 1**：某写入点漏挂 `invalidate` → 2s 兜底 TTL 内禁用未生效。缓解：验证清单逐条覆盖 5 个场景。
- **风险 2**：`AuthUserCacheService` 注入失败（某模块未拉到全局 provider）→ 路由 500。缓解：放 `@Global()` CommonModule，build 后跑一遍全路由冒烟。
- **风险 3**：聚合 SQL 的 JOIN 在某些历史脏数据上漏计（如 outputAssetId 指向已删 asset）。缓解：上线前用同一库对拍 5 个 count 与聚合结果；不一致则不合并。
- **回滚**：每项独立可回滚；A+B+C 是一组（guard 缓存），D 是失效补充，E 独立。回滚 E 只需恢复 `Promise.all` 原代码块。

## 待裁定项

1. JwtAuthGuard 的 `prisma` 私有成员是否移除（现在改为走缓存后未使用）。最小 diff 可保留，干净起见应移除。
2. `auth.service.ts:351`（邮件重置密码）是否一并挂失效。建议挂，保持所有 tokenVersion 写入点全覆盖。
3. 本批是否含 P1（capabilities 缓存 + workbench 并行化），还是单独一批。建议单独一批，避免 diff 过大。

---

**状态：待裁定。裁定后按最小 diff 实施，不扩大范围。**

---

## 实施记录（2026-11-26 00:35，已改码，未跑门禁）

按上述清单实施完成。裁定项取推荐值：guard 的 `prisma` 成员保留（最小 diff）；`auth.service.ts:351` 挂失效；P1 不在本批。

**实施中发现清单的范围遗漏并已一并修复**（否则 P0 只解决一半）：
- `OptionalJwtAuthGuard`（`common/optional-jwt-auth.guard.ts`）也每请求查 User 表——压测的 `/capabilities` 正走此守卫。
- `AdminGuard`（`admin/admin.guard.ts`）也每请求查 User 表——后台接口全走此守卫。
- 两者与 JwtAuthGuard 共用 `AuthUserCacheService`；因 AdminGuard 需读 `role`，缓存快照增补 `role` 字段（`admin/users.service.ts:720` 的改角色写入点随之挂失效）。

**实际改动清单（本批，共 14 文件；不含会话前已存在的 `docs/testing.md` / `credits.controller.ts` / `verify-redis.ts` 改动）**：

新增：
- `backend/src/common/auth-user-cache.service.ts`
- `backend/src/common/auth-user-cache.service.spec.ts`（3 例：命中不查库 / invalidate 后重查 / null 缓存）
- `backend/src/account/account.service.spec.ts`（2 例：bigint→number 与形状保真 / 聚合 SQL 覆盖 5 子查询且 `"Order"` 加引号）

修改：
- `common/common.module.ts` — 注册导出 AuthUserCacheService
- `common/jwt-auth.guard.ts` — 走缓存 + 顶部注释重写（原注释论证"不做缓存"，已过时）
- `common/optional-jwt-auth.guard.ts` — 走缓存 + 异常注释同步
- `admin/admin.guard.ts` — 走缓存 + 注释同步
- `admin/users.service.ts` — 4 处失效（改角色 / 启停 / 重置密码 / 强制下线）
- `admin/roles.controller.ts`、`admin/users.controller.ts` — "每次请求查库"措辞同步
- `auth/auth.service.ts` — 邮件重置密码挂失效
- `account/account.service.ts` — 注入 + 改密失效 + 5 count 合并为单条聚合 SQL
- `account/account-lifecycle.service.ts` — 注入 + 软注销失效
- `account/account-lifecycle.service.spec.ts` — 补构造参数 + 2 条失效断言

**覆盖核对**：全仓 tokenVersion 写入 5 处 + status 写入 1 处 + role 写入 1 处 = 7 处，对应 7 个生产代码 `invalidate()` 调用（含 role 变更），一一匹配；三个守卫残留 `prisma.user.findUnique` 为 0。

**未执行**：`npm run build` / `npm test` / 压测复测 —— 按用户「跑≠改」规矩，本轮只改码。待用户授权后按上方验证清单执行。
