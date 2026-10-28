# 三环境体系（开发 / 测试 / 生产）

> 读哪一档 env、连哪个库、写哪个目录、用哪个前端构建模式、监听哪个端口，全部由 `NODE_ENV` 决定。

## 一句话

**一个 `NODE_ENV` 决定一切**：读哪一档 env 文件、连哪个库、写哪个目录、用哪个前端构建模式、监听哪个端口。

## 为什么需要它

在此之前，「三环境」只存在于 `env.validation.ts` 里一个 `NODE_ENV` 枚举值上。实际后果：

| 问题 | 过去的具体表现 |
|---|---|
| 数据库硬编码 | `prisma.config.ts` 与 `PrismaService` 都写死 `file:./dev.db`，测试往开发演示库里写脏数据，事后无法区分「测试污染」与「真实 bug」 |
| 上传目录硬编码 | `join(process.cwd(), 'uploads', ...)` 散落 6 处，测试删任务会连带删掉开发环境正在用的素材图 |
| 前端无 mode 分档 | `constants.ts` 硬回落到固定开发端口，换环境就得改代码 |
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
| 后端端口 | 4100（固定；占用则停掉占用进程） | 4100（同开发） | `.env.production` 的 `PORT` |
| 前端端口 | 5100（固定；占用则停掉占用进程） | 5100（同开发） | 4173（仅 preview） |
| `HOST` | `127.0.0.1` | `127.0.0.1` | `0.0.0.0`（容器必须） |
| `JWT_SECRET` | 留空（用内置开发密钥） | 独立测试密钥 | **必填**，缺失则拒绝启动 |
| `JWT_TTL` | `7d` | `1h` | 建议 `2h` |
| `CORS_ORIGINS` | 留空走默认本机白名单 | 显式放行 5100 | **必填**线上域名 |
| 界面角标 | 「开发」 | 「测试」 | 不显示 |
| Docker profile | 默认 | `--profile test` | 见下方「生产部署」 |

## 支付通道（`PAYMENT_PROVIDER`）

支付通道是**按环境切换**的：开发/测试固定走沙箱，生产必须配真实商户号。变量定义在
`backend/src/config/env.validation.ts` 的 `ENV_SPECS`（`payment.*` 段）。

| 变量 | 开发 | 测试 | 生产 | 说明 |
|---|---|---|---|---|
| `PAYMENT_PROVIDER` | `sandbox` | `sandbox` | `alipay` / `wechat` | 默认通道；缺省按 `sandbox` |
| `PAYMENT_NOTIFY_BASE` | 空 | 空 | **必填** | 渠道异步通知的公网基址，拼成 `{base}/api/v1/payments/callback/{channel}`。空时退回 `ASSET_PUBLIC_BASE`，再空则无法发起真实支付 |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` | 空 | 空 | 按需 | RSA2。私钥是**应用私钥**，公钥是**支付宝公钥**（不是应用公钥，填反表现为回调一律验签失败） |
| `ALIPAY_GATEWAY` | 空 | 空 | 按需 | 空则用正式网关；沙箱联调用 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` |
| `WECHAT_MCH_ID` / `WECHAT_APP_ID` / `WECHAT_API_V3_KEY` / `WECHAT_SERIAL_NO` / `WECHAT_PRIVATE_KEY` / `WECHAT_PLATFORM_PUBLIC_KEY` | 空 | 空 | 按需 | API v3。`API_V3_KEY` 必须 **32 字节**；`PLATFORM_PUBLIC_KEY` 用于验回调 |

三条必须记住的规则：

1. **凭据缺失返回 503，绝不静默降级为沙箱**。否则「生产漏配」会表现为「支付一直成功但一分钱没收到」。
2. **沙箱回调在生产环境拒收**（`SandboxPaymentProvider` 显式判 `NODE_ENV`），防止伪造支付。
3. **多行 PEM 用字面 `\n` 写进 env**，`normalizePem()` 会还原。粘贴真实换行会让后续几行变成独立键值。

示例：

```bash
PAYMENT_PROVIDER=alipay
PAYMENT_NOTIFY_BASE=https://api.example.com
ALIPAY_APP_ID=2021000000000001
ALIPAY_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----"
ALIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBI...\n-----END PUBLIC KEY-----"
```

支付宝 / 微信的签名与解密实现有离线交叉校验脚本（本地生成 RSA 密钥对，按公开规范独立复算签名串）：
`cd backend && npx ts-node -T scripts/verify-payment-signatures.ts`。它不能替代真实商户号的端到端联调。

## 邮件 / 短信通道（`EMAIL_PROVIDER` / `SMS_PROVIDER`）

同支付一样是「适配器 + 控制台兜底」：默认 `console` **不真实投递**，正文写入
`backend/logs/outbox/{email,sms}-*.log`，冒烟脚本据此校验验证码 / 重置链接。
配置 `http` + 服务商 HTTP API，或 `aliyun` + 阿里云 AccessKey 即真实调用（`backend/src/channels/`）。

| 变量 | 开发 | 测试 | 生产 | 说明 |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | `console` | `console` | `http` / `aliyun` | `console` 打 WARN 表明不会投递；`aliyun` 走 DirectMail `SingleSendMail` |
| `EMAIL_API_URL` / `EMAIL_API_KEY` | 空 | 空 | 按需 | 服务商 HTTP 接口（15s 超时 + 3 次指数退避） |
| `EMAIL_FROM` | `noreply@huojue.local` | 同 | 真实发信地址 | 发件人显示名（`aliyun` 下显示名用 `ALIYUN_DM_FROM_ALIAS`） |
| `SMS_PROVIDER` | `console` | `console` | `http` / `aliyun` | `aliyun` 走短信服务 `SendSms` |
| `SMS_API_URL` / `SMS_API_KEY` | 空 | 空 | 按需 | 短信服务商接口 |
| `SMS_SIGN` | `货觉AI` | 同 | 已备案签名 | 短信签名（`aliyun` 下 `ALIYUN_SMS_SIGN_NAME` 优先） |
| `SMS_TEMPLATE` | 空 | 空 | 模板 ID | 服务商侧模板；留空用默认文案 |

`aliyun` 通道的专用变量（SMS 与邮件共用同一组 AccessKey，建议用只授权 Dysms + Dm 的子账号）：

| 变量 | 说明 |
|---|---|
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 必填；缺失时**告警并回落 console**（`delivers: false`），不阻止启动 |
| `ALIYUN_SMS_SIGN_NAME` | 控制台已审核通过的短信签名；留空回落 `SMS_SIGN` 并告警 |
| `ALIYUN_SMS_TEMPLATE_CODE` | 模板号 `SMS_xxx`；模板变量名必须是 `code` |
| `ALIYUN_SMS_REGION` | 地域 id（如 `ap-southeast-1`）；留空或 `cn-hangzhou` 走中心域名。**只接受地域 id**，不接受任意 URL —— 一个可写的端点等于「把验证码发到别人的服务器」 |
| `ALIYUN_DM_ACCOUNT_NAME` | DirectMail 控制台已配置的发信地址；**不能用 `EMAIL_FROM` 猜** |
| `ALIYUN_DM_FROM_ALIAS` | 发件人显示名 |
| `ALIYUN_DM_ADDRESS_TYPE` | `1` 随机账号（默认）/ `0` 批量发信 |

**回退语义与支付相反**：支付通道凭据缺失一律 503、绝不降级沙箱；邮件/短信不是核心链路（忘记密码仍可走另一条通道或联系客服），因此 `aliyun` 缺凭据时**告警 + 回落 console**，由 `status()` 的 `delivers: false` 与 `/health` 的 channels 分项暴露「其实没在发」。`/admin/notifications` 页顶部的通道状态读同一份 `status()`。

**刻意不手写 SMTP**：TLS 分片与认证流程的自研实现风险高于收益，邮件走服务商 HTTP API。阿里云 RPC 签名（HMAC-SHA1 + 排序 canonical query）有离线复算脚本：`cd backend && npx ts-node -T scripts/verify-channel-signatures.ts`，但它**只验签名与请求形状，不代表已真实投递**。

## 第三方登录（`OAUTH_*`）

标准 OAuth2 / OIDC 登录。内置 `google` / `github`，另有 `generic` 可接任意合规 provider（`backend/src/auth/oauth/oauth.providers.ts`）。

| 变量 | 开发 | 测试 | 生产 | 说明 |
|---|---|---|---|---|
| `OAUTH_ENABLED` | 空 | 空 | 按需 | 逗号分隔白名单。**留空 = 凭据齐全的 provider 自动启用**；填了则只放行列出的 id |
| `OAUTH_CALLBACK_BASE` | 空 | 空 | 对外域名 | 回调基址，默认 `WEB_BASE_URL` + `/api/v1`（再缺省 `http://localhost:5100/api/v1`）。本地经 Vite 反代可用 |
| `OAUTH_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` | 空 | 空 | 必填 | 缺任一项该 provider 不启用，登录页不渲染按钮 |
| `OAUTH_<PROVIDER>_REDIRECT_URI` | 空 | 空 | 按需 | 留空自动拼 `${OAUTH_CALLBACK_BASE}/auth/oauth/<provider>/callback`；**必须与 provider 后台登记的回调完全一致** |
| `OAUTH_<PROVIDER>_AUTHORIZATION_ENDPOINT` / `_TOKEN_ENDPOINT` / `_USERINFO_ENDPOINT` | 空 | 空 | 按需 | 留空用 Google / GitHub 官方端点；`generic` 三项都必填 |
| `OAUTH_<PROVIDER>_SCOPES` | 见默认 | 同 | 按需 | Google 默认 `openid,email,profile`；GitHub 默认 `read:user,user:email` |

**启用判定**：`clientId` + `clientSecret` + `authorizationEndpoint` + `tokenEndpoint` 四项非空（`redirectUri` 有自动拼接的缺省值），且未被 `OAUTH_ENABLED` 排除。未启用时 `GET /auth/oauth/providers` 返回空数组，登录页整块不渲染——**不要在前端维护 provider 名单**。

只有 provider 明确确权（`emailVerified`）的邮箱才会自动绑定同邮箱的既有账号；`accessToken` 不进回调 URL，只下发 60 秒票据由前端 `POST /auth/oauth/complete` 换取。详见 `docs/login-design.md` §3。

## 安全与合规（签名 / 限流 / 追踪）

| 变量 | 开发 | 测试 | 生产 | 说明 |
|---|---|---|---|---|
| `ASSET_SIGNING_SECRET` | 空（`/uploads/*` 公开） | 空 | **必填**（≥ 32 字符） | HMAC-SHA256 签名密钥。生产档：为空只 WARN（提醒素材公开），**长度不足直接拒绝启动** |
| `RATE_LIMIT_ENABLED` | `true` | `true` | **必须 `true`** | 关闭时启动打 WARN。仅本地压测可关 |
| `RATE_LIMIT_TRUST_PROXY` | `false` | `false` | 反代后为 `true` | 是否信任 `X-Forwarded-For`。**默认不信任**，否则伪造一个头就等于没有限流 |
| `RATE_LIMIT_AUTH_PER_MIN` | `10` | `200` | `10` | 登录/注册/短信登录配额（请求期读取，冒烟靠它放宽） |
| `RATE_LIMIT_RESET_TOKEN` | 空 | `test-reset-token` | **留空** | 测试重置入口 `POST /test/rate-limit/reset` 的令牌。非 test 环境该路由**直接 404**，令牌留空则一律拒绝 |
| `ERROR_WEBHOOK_URL` | 空 | 空 | 按需 | 异常上报地址；留空只落本地日志 |

三条必须记住的规则：

1. **限流是单机内存计数**，多实例部署时每个实例各算各的。要做全局配额必须换 Redis（本轮不做）。
2. **签名只增字段不改语义**：`sourceUrl` 保持干净，另发 `signedUrl`；签名关闭时 `signedUrl` 为 `null`，前端 `assetSrc()` 自动回落。
3. **测试重置入口不是后门**：`NODE_ENV !== 'test'` 时返回 404（连路径都不承认），且需要令牌；它只清计数，断言仍打在同一个 guard 上。

```bash
# 生成签名密钥
openssl rand -base64 32
```

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
./start.sh --env test         # 测试（独立库；端口同开发，两档不能同时跑）
./start.sh --env prod         # 生产（需 .env.production 存在）

# 开发与测试**不能**并行（端口相同）：起测试档会自动停掉开发档，反之亦然。
# 两档的隔离是库/上传目录/日志目录/密钥，不是端口。
./start.sh --env test          # 起测试档（会停掉正在跑的开发档）
./start.sh                     # 切回开发档（会停掉测试档）
```

### 建表与种子

```bash
cd backend
npm run db:push:dev           # 建开发库表
npm run db:push:test          # 建测试库表
npm run db:reset:test         # ★ 删库+删目录+重建+重灌种子（带安全门禁）
npm run seed:test             # 只灌测试库种子
npm run start:test            # NODE_ENV=test node dist/main.js
```

种子按需组合（`seed:all` = 开发账号 + 角色 + 后台管理员 + 商品 + 会员 + 营销 + 法务 + 消息模板）：

```bash
npm run seed                  # 开发账号（需 SEED_USER_EMAIL，未设置则什么都不建）
npm run seed:admin            # 后台管理员（默认 admin@huojue.local，密码仅打印一次，重复执行不重置）
npm run seed:roles            # 后台角色与权限点
npm run seed:commerce         # 商品（积分包）
npm run seed:membership       # 会员套餐
npm run seed:marketing        # 优惠券 / 活动 / 邀请签到规则
npm run seed:legal            # 三份法务文档 v1 草稿（不自动发布；已发布的不会被覆盖；不在 seed:all 内）
npm run seed:messages         # 五条站内消息模板（只补缺失，不覆盖已改文案）
```

一次性数据迁移（幂等，存量库专用）：

```bash
npm run db:migrate:provider          # GenerationTask.provider 'mock' → 'pending'（跑前打印影响行数）
npm run db:migrate:tool-idempotency  # 补幂等字段/索引（非破坏、可重复；不要用 accept-data-loss）
```

`db:reset:test` 会逐项校验删除目标路径**必须含 `test` 字样**且**不得越出 `backend/`**，
否则拒绝执行 —— 没有这道门禁时一个手滑的 `NODE_ENV=production` 就能删掉生产库。

### 构建

```bash
cd frontend
npm run dev                # vite --mode development
npm run dev:test           # vite --mode test（5100）
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

每次 `up` 会先运行一次 `backend-migrate` / `backend-migrate-test`
（幂等的 `prisma db push`），成功退出后后端才启动；全新数据卷也能直接启动。
这两个一次性任务显示为 `Exited (0)` 属正常，不是崩溃。

两个 profile 用**不同的具名卷**（`huojue-data` / `huojue-test-data`），
库文件与上传目录都不同。`frontend-test` 的 nginx 反向代理目标通过
`BACKEND_UPSTREAM=backend-test:3001` 注入 —— 写错不报错，只会让测试前端
静默代理到开发后端。

### 生产部署

**不要直接用 `docker-compose.yml`** —— 它是本地编排。生产使用
`docker-compose.production.yml`，默认只把前端绑到 `127.0.0.1:18080`，
由外层 Caddy / Nginx / LB 终结 TLS。

```bash
cp backend/.env.production.example backend/.env.production
chmod 600 backend/.env.production
docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.yml up -d --build

curl -fsS http://127.0.0.1:18080/healthz
curl -fsS http://127.0.0.1:18080/api/v1/health/ready
```

编排会先跑 `migrate`，成功后才启动后端；后端端口不映射到宿主机，
SQLite / 上传图 / 备份 / 日志统一落 `huojue-prod-data` 卷。
`seed` 是显式 profile，不会随普通 `up` 执行。

完整的部署、TLS 反代示例、备份恢复、升级回滚与排障命令见
[`docker-deployment.md`](docker-deployment.md)。

## 相关文件

| 文件 | 职责 |
|---|---|
| `backend/src/config/env-files.ts` | 档位选择 + env 解析的唯一事实源（Nest 侧） |
| `backend/src/config/env.validation.ts` | `ENV_SPECS` 变量事实源 + 生产门禁 |
| `backend/src/config/config.module.ts` | 按 `NODE_ENV` 装配 `envFilePath` |
| `backend/scripts/db-url.js` | 脚本侧同款档位逻辑（seed/smoke 不经过 Nest） |
| `backend/.env.development` / `.env.test` / `.env.production.example` | 三档配置 |
| `frontend/.env.development` / `.env.test` / `.env.production.example` | 三档配置 |
| `backend/prisma.config.ts` | Prisma CLI 侧读同一份档位 |
| `start.sh` | `--env` 串起 NODE_ENV 与 Vite mode |
| `docker-compose.yml` | 本地编排（dev + test profile） |
| `docker-compose.production.yml` | 生产单机编排（自动建表 / 健康探针 / 持久卷 / TLS 边界） |
| `docs/docker-deployment.md` | 容器部署、升级、备份恢复与排障操作手册 |

## 排查清单

| 症状 | 先查 |
|---|---|
| 请求被 CORS 拦 | 启动日志的「CORS origins」行；确认 `CORS_ORIGINS` 没被空串覆盖 |
| 连错库 | 启动日志「运行环境 NODE_ENV=… · 数据库 …」 |
| 前端 404（刷新子页） | nginx 的 `try_files` 回退是否生效 |
| 生产起不来 | 直接看 stderr 的 `[config] 环境变量校验失败` 清单 |
| 测试数据污染了开发库 | `NODE_ENV` 是否传到了每条 npm 子命令（`prisma.config.ts` 靠它选档位） |
