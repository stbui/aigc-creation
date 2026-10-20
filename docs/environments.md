# 三环境体系（开发 / 测试 / 生产）

> 建立于 2026-10-20。此前项目只有 `NODE_ENV` 这一个枚举值，其余全是单环境硬编码。

## 一句话

**一个 `NODE_ENV` 决定一切**：读哪一档 env 文件、连哪个库、写哪个目录、用哪个前端构建模式、监听哪个端口。

## 为什么需要它

在此之前，「三环境」只存在于 `env.validation.ts` 里一个 `NODE_ENV` 枚举值上。实际后果：

| 问题 | 过去的具体表现 |
|---|---|
| 数据库硬编码 | `prisma.config.ts` 与 `PrismaService` 都写死 `file:./dev.db`，测试往开发演示库里写脏数据，事后无法区分「测试污染」与「真实 bug」 |
| 上传目录硬编码 | `join(process.cwd(), 'uploads', ...)` 散落 6 处，测试删任务会连带删掉开发环境正在用的素材图 |
| 前端无 mode 分档 | `constants.ts` 硬回落 `localhost:3001`，换环境就得改代码 |
| 无生产构建 | `package.json` 只有 `build`，没有分环境命令 |
| 无启动门禁 | `JWT_SECRET` 未设置时生产能照常起来，内置开发密钥上线路 |

## 环境矩阵

| 项 | 开发 development | 测试 test | 生产 production |
|---|---|---|---|
| 后端 env 文件 | `backend/.env.development` | `backend/.env.test` | `backend/.env.production`（**不入库**，由 `.example` 复制） |
| 前端 env 文件 | `frontend/.env.development` | `frontend/.env.test` | `frontend/.env.production`（**不入库**） |
| 数据库 | `file:./dev.db` | `file:./test.db` | `file:./data/prod.db`（必须 ≠ dev.db） |
| 上传目录 | `uploads` | `uploads-test` | `/app/data/uploads`（绝对路径 + 卷） |
| 备份目录 | `backups` | `backups-test` | `/app/data/backups` |
| 日志目录 | `logs` | `logs/test` | `/app/data/logs` |
| 后端端口 | 3001（占用则 3002/3003） | 3101 | `.env.production` 的 `PORT` |
| 前端端口 | 5173（占用则 5174/5175） | 5273 | 4173（仅 preview） |
| `HOST` | `127.0.0.1` | `127.0.0.1` | `0.0.0.0`（容器必须） |
| `JWT_SECRET` | 留空（用内置开发密钥） | 独立测试密钥 | **必填**，缺失则拒绝启动 |
| `JWT_TTL` | `7d` | `1h` | 建议 `2h` |
| `CORS_ORIGINS` | 留空走默认本机白名单 | 显式放行 5273 | **必填**线上域名 |
| 界面角标 | 「开发」 | 「测试」 | 不显示 |
| Docker profile | 默认 | `--profile test` | 见下方「生产部署」 |

## 加载优先级

### 后端（`src/config/env-files.ts`）

```
development: .env.development.local > .env.development > .env.local > .env
test       : .env.test.local        > .env.test
production : .env.production.local  > .env.production
```

**外部环境变量（容器 / CI 注入）优先级最高**，文件只补空缺。

> ⚠ **test / production 刻意不回落 `.env` 与 `.env.local`**。
> 共享 `.env` 里写着 `DATABASE_URL=file:./dev.db`，一旦被 test 继承，
> 隔离就形同虚设 —— 而且这种错位没有任何报错，只表现为「测试跑挂了开发数据」。
> 宁可「文件缺失 → 用代码默认值」，也不要「安静地连错库」。

### 前端（Vite 内建）

```
--mode development → .env.development.local > .env.development > .env
--mode test        → .env.test.local        > .env.test
--mode production  → .env.production.local  > .env.production
```

> ⚠ 两端规则**方向相反**：后端是「靠前优先」，Vite 是「靠后覆盖靠前」。
> 各自内部一致即可，跨端不要互相推断。

### 一个容易踩的坑

`CORS_ORIGINS=""`（空串）**不等于**未设置 —— 空串同样算「已存在」，
`loadEnvFiles` 会跳过覆盖，于是 `.env.test` 里的值静默失效。
`start.sh` 因此改用数组按需注入：只有真有值时才注入该变量。

## 常用命令

### 启动

```bash
./start.sh                    # 开发
./start.sh --env test         # 测试（独立库，独立端口）
./start.sh --env prod         # 生产（需 .env.production 存在）

# 开发与测试可并行，互不抢端口：
./start.sh &
./start.sh --env test &
```

### 建表与种子

```bash
cd backend
npm run db:push:dev           # 建开发库表
npm run db:push:test          # 建测试库表
npm run db:reset:test         # ★ 删库+删目录+重建+重灌种子（带安全门禁）
npm run seed:test             # 只灌测试库种子
```

`db:reset:test` 会逐项校验删除目标路径**必须含 `test` 字样**且**不得越出 `backend/`**，
否则拒绝执行 —— 没有这道门禁时一个手滑的 `NODE_ENV=production` 就能删掉生产库。

### 构建

```bash
cd frontend
npm run dev                # vite --mode development
npm run dev:test           # vite --mode test（5273）
npm run build:prod         # tsc --noEmit && vite build --mode production
npm run build:test         # 测试环境的静态产物
```

> ⚠ Vite 的 `--mode` 决定产物里烧进哪些配置，**不可逆**：同一份 `dist`
> 只能服务于构建时选定的那套环境。

### 验证环境配置本身

```bash
cd backend
npx ts-node -T scripts/probe-environments.ts
```

74 项断言，覆盖档位顺序、解析语义、生产门禁、告警队列副作用纪律、
以及「脚本侧与 Nest 侧给出同一套档位」。

## 生产启动门禁

以下两条会让 `validateEnv` **直接抛错拒绝启动**，不是告警：

1. `JWT_SECRET` 未设置 —— 内置开发密钥一旦上线路，任何人都能自签 token
2. `DATABASE_URL` 仍是 `file:./dev.db` —— 生产连开发库等于污染演示数据，且线上数据落在本地文件上无法备份

启动日志会**回显生效的环境名、库路径、上传目录**（第一屏），
因为「以为在测、实际连着开发库」是这套体系最需要防的乌龙。

## Docker

### 本地（开发 + 测试）

```bash
docker compose up -d --build                      # 开发
docker compose --profile test up -d --build      # 开发 + 测试并行

docker compose logs -f backend
docker compose down          # 保留数据卷
docker compose down -v       # 连数据卷一起删（库/上传图/备份/日志全没）
```

端口避开本机常用值：开发 `13001` / `15173`，测试 `13101` / `15273`。

两个 profile 用**不同的具名卷**（`huojue-data` / `huojue-test-data`），
库文件与上传目录都不同。`frontend-test` 的 nginx 上游通过
`BACKEND_UPSTREAM=backend-test:3001` 注入 —— 写错不报错，只会让测试前端
静默代理到开发后端。

### 生产部署

**不要直接用 `docker-compose.yml`** —— 它是本地编排（无 TLS、无域名、无密钥管理、无滚动更新）。

生产要做的事：

1. **镜像**：CI 里 `docker build` 两个镜像，推到私有 registry，打不可变 tag（不要用 `latest`）
2. **密钥**：`JWT_SECRET` / 网关 token / OSS 凭据走 K8s Secret 或云厂商密钥管理，
   **绝不要 `ENV` 进 Dockerfile** —— 烤进镜像层的凭据即使后续删文件也仍在历史里
3. **数据卷**：SQLite 单文件必须挂持久卷并纳入备份策略。
   多副本部署时 SQLite 撑不住（写锁是全局的），需换 PostgreSQL
4. **入口**：前面加 TLS 终结层（ALB / Nginx / Caddy），
   前端容器只监听容器内 80
5. **迁移**：SQLite 无 online DDL，表结构变更需要停机窗口或改走「新旧文件 + 切换」
6. **回滚**：镜像 tag 可回滚，但**数据库迁移不可回滚** —— 提前想清楚

## 相关文件

| 文件 | 职责 |
|---|---|
| `backend/src/config/env-files.ts` | 档位选择 + env 解析的唯一事实源（Nest 侧） |
| `backend/src/config/env.validation.ts` | `ENV_SPECS` 变量事实源 + 生产门禁 |
| `backend/src/config/config.module.ts` | 按 `NODE_ENV` 装配 `envFilePath` |
| `backend/scripts/db-url.js` | 脚本侧同款档位逻辑（seed/smoke 不经过 Nest） |
| `backend/.env.development` / `.env.test` / `.env.production.example` | 三档配置 |
| `frontend/.env.development` / `.env.test` / `.env.production.example` | 三档配置 |
| `backend/proisma.config.ts` | Prisma CLI 侧读同一份档位 |
| `start.sh` | `--env` 串起 NODE_ENV 与 Vite mode |
| `docker-compose.yml` | 本地编排（dev + test profile） |

## 排查清单

| 症状 | 先查 |
|---|---|
| 请求被 CORS 拦 | 启动日志的「CORS origins」行；确认 `CORS_ORIGINS` 没被空串覆盖 |
| 连错库 | 启动日志「运行环境 NODE_ENV=… · 数据库 …」 |
| 前端 404（刷新子页） | nginx 的 `try_files` 回退是否生效 |
| 生产起不来 | 直接看 stderr 的 `[config] 环境变量校验失败` 清单 |
| 测试数据污染了开发库 | `NODE_ENV` 是否传到了每条 npm 子命令（`prisma.config.ts` 靠它选档位） |