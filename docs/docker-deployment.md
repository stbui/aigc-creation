# Docker 部署（本地 / 测试 / 生产）

> 本文是容器部署的操作事实源。环境变量语义仍以
> [`environments.md`](environments.md) 为准；变量总表在
> `backend/src/config/env.validation.ts` 的 `ENV_SPECS`。
>
> 前置：Docker Engine 24+、Compose v2.20+（需要
> `service_completed_successfully`），并使用默认启用的 BuildKit。

## 1. 编排文件与边界

| 文件 | 用途 | 默认入口 |
|---|---|---|
| `docker-compose.yml` | 本地开发 / 测试；会对数据卷里的库自动建表 | `4100`（后端）/ `5100`（前端） |
| `docker-compose.yml --profile test` | 测试档；独立库、目录、卷（默认端口与开发相同，不能同时起） | `4100`（后端）/ `5100`（前端） |
| `docker-compose.production.yml` | 生产单机编排；TLS 由外层反代终结 | `127.0.0.1:5100` |

生产编排固定使用 `NODE_ENV=production`、容器内 `PORT=4100`、
`DATABASE_URL=file:/app/data/prod.db`。后端端口不映射到宿主机，
所有公网流量必须经过前端 Nginx。

契约：

- `migrate` 先执行幂等的 `prisma db push`，成功退出后 `backend` 才启动。
- 后端就绪探针请求 `/api/v1/health/ready`，会真实查询数据库；空库或库故障不算健康。
- 前端通过 Docker 内置 DNS 动态解析后端，后端容器重建换 IP 后不需要重启 Nginx。
- SQLite、上传图、备份、日志统一落在具名卷；容器重建不丢数据。
- 后端以 `node` 非 root 用户运行；所有服务启用 `no-new-privileges` 与日志轮转。
- 停止时 `docker stop` / `docker compose stop` 给后端 30 秒优雅退出窗口。

## 2. 本地开发与测试

```bash
# 开发：首次会自动建表
docker compose up -d --build
docker compose ps -a

# 测试档（默认端口与开发相同，需先停开发；并行请覆盖 *_TEST_HOST_PORT）
docker compose --profile test up -d --build

curl -fsS http://127.0.0.1:5100/healthz
curl -fsS http://127.0.0.1:5100/api/v1/health/ready
```

`backend-migrate` / `backend-migrate-test` 是一次性任务，成功后会以退出码 0
停住，这是正常状态，不是容器崩溃。查看原因：

```bash
docker compose logs backend-migrate
docker compose --profile test logs backend-migrate-test
```

停止但保留数据：

```bash
docker compose down
docker compose --profile test down
```

`down -v` 会删除 `huojue-data` / `huojue-test-data` 中的数据库、上传图、备份和日志。
只在确认数据可丢弃时执行。

构建依赖默认走 `https://registry.npmmirror.com`。海外 CI 或私有镜像源可覆盖：

```bash
NPM_REGISTRY=https://registry.npmjs.org docker compose build
```

基础镜像默认是 `node:24-slim` / `nginx:1.27-alpine`，也可指向可信的
镜像仓库（BuildKit 不会自动使用 Docker daemon 的 `registry-mirrors`）：

```bash
NODE_IMAGE=registry.example.com/library/node:24-slim \
NGINX_IMAGE=registry.example.com/library/nginx:1.27-alpine \
  docker compose -f docker-compose.production.yml build
```

若宿主直连 Docker Hub 不稳定，可先拉取基础镜像并导入本机临时仓库，再从
`127.0.0.1:5000` 构建；构建完成后该 registry 容器即可删除。

## 3. 生产部署

### 3.1 准备配置

```bash
cp backend/.env.production.example backend/.env.production
chmod 600 backend/.env.production
```

至少填写并核对：

| 变量 | 要求 |
|---|---|
| `JWT_SECRET` | 强随机，不能为空；否则后端拒绝启动 |
| `ASSET_SIGNING_SECRET` | ≥ 32 字符；为空会让 `/uploads` 退化为公开 |
| `CORS_ORIGINS` | 线上 HTTPS 域名白名单，逗号分隔 |
| `WEB_BASE_URL` | 线上 HTTPS 基址，用于邮件重置链接 |
| `ASSET_PUBLIC_BASE` | 公网可达的静态资源基址；模型网关需要能访问上传图 |
| `PAYMENT_PROVIDER` 及通道凭据 | 使用真实通道时必须齐全；缺失时发起支付返回 503，不会降级沙箱 |
| `EMAIL_PROVIDER` / `SMS_PROVIDER` | 生产使用 `http` 或 `aliyun`；`console` 不会真实投递 |
| `GATEWAY_*` | 真实生图通道；不配则相关能力不可用，不会交付占位图 |

`DATABASE_URL`、`UPLOAD_DIR`、`BACKUP_DIR`、`LOG_DIR`、`PORT` 由生产编排统一覆盖，
不需要在 env 文件中改成宿主机路径。不要把 `backend/.env.production` 提交到 Git。

可用 `BACKEND_ENV_FILE` 指向外部密钥文件（例如挂载到宿主机的受控目录）：

```bash
BACKEND_ENV_FILE=/etc/huojue/production.env \
  docker compose -f docker-compose.production.yml config --quiet
```

若使用外部 env 文件，下文所有生产命令都要带同一个 `BACKEND_ENV_FILE`；
若采用默认的 `backend/.env.production`，可省略。

镜像默认打本地 `huojue-*` tag；推送到私有 registry 时加命名空间前缀即可：

```bash
HUOJUE_IMAGE_PREFIX=registry.example.com/huojue/ \
HUOJUE_IMAGE_TAG=2026-10-28-1 \
  docker compose -f docker-compose.production.yml build
```

低内存宿主（小于 4 GB）建议串行构建，避免后端与前端同时跑 `npm ci` 触发 OOM：

```bash
HUOJUE_IMAGE_TAG=2026-10-28-1 \
  docker compose -f docker-compose.production.yml build migrate backend
HUOJUE_IMAGE_TAG=2026-10-28-1 \
  docker compose -f docker-compose.production.yml build frontend
```

### 3.2 启动与验收

```bash
# 先校验配置能展开
BACKEND_ENV_FILE=./backend/.env.production \
  docker compose -f docker-compose.production.yml config --quiet

# 构建并启动
BACKEND_ENV_FILE=./backend/.env.production \
  docker compose -f docker-compose.production.yml up -d --build

docker compose -f docker-compose.production.yml ps -a
curl -fsS http://127.0.0.1:5100/healthz
curl -fsS http://127.0.0.1:5100/api/v1/health/ready
curl -fsS http://127.0.0.1:5100/api/v1/capabilities
```

预期：`migrate` 退出码为 0，`backend` / `frontend` 为 `healthy`。
访问 `/workbench` 等前端子路由应直接返回 SPA，而不是 404。

可选初始化数据：

```bash
BACKEND_ENV_FILE=./backend/.env.production \
  docker compose -f docker-compose.production.yml --profile seed run --rm seed
```

`seed` 是显式 profile，不会随普通 `up` 执行。管理员初始密码只输出一次，请立即保存。

### 3.3 端口与 TLS

默认只绑定本机回环地址，避免后端或未加密入口直接暴露公网：

```text
127.0.0.1:5100 -> frontend:5100
```

需要换端口或内网地址时：

```bash
FRONTEND_BIND_ADDR=0.0.0.0 FRONTEND_HOST_PORT=8080 \
  docker compose -f docker-compose.production.yml up -d
```

生产应在前面放 Caddy / Nginx / 云负载均衡做 HTTPS 终结，再反代到
`127.0.0.1:5100`。外层代理至少转发：

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port  $server_port;
```

后端已设置 `RATE_LIMIT_TRUST_PROXY=true`，限流按真实客户端 IP 计算。
若把前端直接暴露到公网而不加 TLS，登录凭据与令牌会明文传输；不要这样部署。

## 4. 数据、备份与恢复

生产数据卷默认名为 `huojue-prod-data`，可用 `HUOJUE_DATA_VOLUME` 改名。
备份必须复制到宿主机或对象存储，**只放在同一个卷里无法抵御卷损坏**。

推荐优先使用后台「数据备份」功能；冷备份可在短暂停机窗口执行：

```bash
VOLUME=${HUOJUE_DATA_VOLUME:-huojue-prod-data}
mkdir -p backups

docker compose -f docker-compose.production.yml stop backend frontend
docker run --rm \
  -v "$VOLUME":/data:ro \
  -v "$PWD/backups":/backup \
  alpine sh -c 'tar czf /backup/huojue-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
docker compose -f docker-compose.production.yml start backend frontend
```

恢复前先保留当前卷的另一份备份，然后停止服务并解包：

```bash
docker compose -f docker-compose.production.yml stop backend frontend
docker run --rm -v "$VOLUME":/data alpine \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
docker run --rm \
  -v "$VOLUME":/data \
  -v "$PWD/backups":/backup:ro \
  alpine sh -c 'tar xzf /backup/<备份文件>.tgz -C /data'
docker compose -f docker-compose.production.yml up -d
```

解包后用 `/api/v1/health/ready` 和关键页面验收。数据库文件损坏时不要反复重启，
先保留现场并从上一次已验证备份恢复。

## 5. 升级与回滚

```bash
# 1. 先备份（见上一节）
# 2. 拉取固定 tag 的镜像（镜像需已由 CI 推送到 HUOJUE_IMAGE_PREFIX 指向的 registry）
export HUOJUE_IMAGE_PREFIX=registry.example.com/huojue/
HUOJUE_IMAGE_TAG=2026-10-28-1 \
  docker compose -f docker-compose.production.yml pull

# 3. 启动；migrate 会先跑
HUOJUE_IMAGE_TAG=2026-10-28-1 \
  docker compose -f docker-compose.production.yml up -d --no-build

# 4. 验收健康与核心流程
curl -fsS http://127.0.0.1:5100/api/v1/health/ready
```

回滚镜像只回滚应用代码，**不会回滚已经执行的表结构变更**。SQLite 使用
`prisma db push`，项目没有自动 down migration；涉及不可逆结构变更时必须先备份，
并在维护窗口内验证恢复路径。

## 6. 日常运维

```bash
# 状态与日志
docker compose -f docker-compose.production.yml ps -a
docker compose -f docker-compose.production.yml logs -f --tail=200 backend
docker compose -f docker-compose.production.yml logs -f --tail=200 frontend

# 单独重跑建表（幂等）
docker compose -f docker-compose.production.yml run --rm migrate

# 重启（保留数据）
docker compose -f docker-compose.production.yml restart

# 停止（保留容器与卷）
docker compose -f docker-compose.production.yml stop
```

日志同时落 `LOG_DIR`（卷内）并按 `json-file` 轮转，单文件 10 MB、保留 5 份。
若接入集中日志，可在部署侧覆盖 logging driver。

## 7. 排障清单

| 症状 | 先查 |
|---|---|
| `migrate` 非 0 退出 | `docker compose ... logs migrate`；确认 env 文件存在、DATABASE_URL 未被错误覆盖、卷可写 |
| `backend` 一直 `starting` 后 unhealthy | `logs backend`；看环境变量校验、数据库路径、端口占用、`/health/ready` |
| 前端 502 | 后端是否 healthy；Nginx 日志中的 DNS/upstream 错误；`BACKEND_UPSTREAM` 是否与服务名一致 |
| 子页面刷新 404 | Nginx `try_files` 是否生效，是否误改了模板变量 |
| 构建卡在 npm | 设置 `NPM_REGISTRY` 为可达镜像源；重试会复用 BuildKit 缓存 |
| 上传图 403/404 | `ASSET_SIGNING_SECRET`、`ASSET_PUBLIC_BASE`、`/uploads` 代理与卷权限 |
| 生产支付/邮件不工作 | env 校验通过不等于通道凭据有效；看后台渠道状态与后端日志 |

任何改动前先跑：

```bash
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml --profile test config --quiet
BACKEND_ENV_FILE=./backend/.env.production \
  docker compose -f docker-compose.production.yml config --quiet
```

## 8. 已知边界

- SQLite 是单写者模型，不适合多副本横向扩容；需要多实例时先迁移 PostgreSQL。
- 本地卷不具备跨主机高可用能力；生产需依赖云盘快照或外部数据库。
- 本编排不生成或续期 TLS 证书，证书与域名由外层反代 / LB 管理。
- 密钥默认通过受控 env 文件注入；更高安全等级应改用 K8s Secret、云密钥管理或 Docker secret 挂载方案。
- 当前未配置自动镜像漏洞扫描、SBOM 与签名；应纳入 CI/CD 发布流程。
