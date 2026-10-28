# 基础镜像可覆盖：受限网络/内网镜像仓库可在构建时传入
#   --build-arg NODE_IMAGE=registry.example.com/library/node:24-slim
ARG NODE_IMAGE=node:24-slim

# ─────────────────────────────────────────────────────────────────────────────
# 后端镜像（NestJS + node:sqlite）
#
# 为什么用 node:24-slim
# ---------------------
# 项目依赖 Node **内置**的 node:sqlite（自研 Prisma driver adapter
# 见 src/prisma/node-sqlite-adapter.ts），Node >= 22.5 才有。
# 选 24 是因为 22.x/23.x 的 node:sqlite 仍带实验性警告，24 起转正。
#
# 为什么不用 alpine
# ---------------
# node:sqlite 是内置模块（不需编译），理论上 alpine 可用；但 alpine 的
# musl 与部分 Prisma/Jimp 传递依赖的 prebuilt 二进制不兼容，
# 排查成本高于省下的几十 MB。本项目**部署优先于体积**，用 slim。
#
# 多阶段构建
# ---------
#   deps  装全量依赖（含 devDependencies，nest CLI/tsc 在此跑）
#   build 生成 dist/ 与 Prisma client
#   prod  只装运行时依赖 —— 镜像体积与攻击面都小得多
# ─────────────────────────────────────────────────────────────────────────────

# ── 阶段 1: 依赖 ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# 只复制依赖清单 → 这一层可被缓存，源码改动不触发重装
COPY package.json package-lock.json .npmrc ./

# 默认沿用 .npmrc 的 registry（国内镜像更稳定）；CI/海外构建可覆盖：
#   docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org .
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry "$NPM_REGISTRY" \
 && npm ci --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=1000 \
      --fetch-retry-maxtimeout=20000 \
      --fetch-timeout=600000

# ── 阶段 2: 构建 ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Prisma CLI 会探测 OpenSSL 以选择 schema engine；node:24-slim 不带该二进制，
# 缺失时会回落到 1.1.x 引擎并在 Debian 12 上产生运行期风险。
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json .npmrc ./
COPY tsconfig.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# ⚠ NODE_ENV=production 会让 npm 只装生产依赖，此时 tsc 不可用。
#   故这里必须显式设成 development，保证 devDependencies（nest/tsc）在。
ENV NODE_ENV=development
RUN npx prisma generate && npm run build

# ── 工具镜像：建表 / 种子 ────────────────────────────────────────────────────
# Prisma CLI、ts-node、seed 脚本只在部署任务里需要，不进入生产运行镜像。
# Compose 用 service_completed_successfully 等建表成功后再启动 backend。
FROM build AS tools
ENV NODE_ENV=production

RUN mkdir -p /app/data/uploads /app/data/backups /app/data/logs \
 && chown -R node:node /app/data

USER node

CMD ["npx", "prisma", "db", "push"]

# ── 阶段 3: 运行时 ───────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS prod
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4100 \
    API_PREFIX=api/v1 \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true

# 运行时依赖：devDependencies（nest CLI / typescript / ts-node）不需要
COPY package.json package-lock.json .npmrc ./
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry "$NPM_REGISTRY" \
 && npm ci --omit=dev --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=1000 \
      --fetch-retry-maxtimeout=20000 \
      --fetch-timeout=600000

# Prisma client 产物在 build 阶段生成，拷过来即可（不含 CLI）
COPY --chown=node:node --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docker ./docker

# 数据目录：库文件/上传图/备份/日志统一落这里，compose 挂卷到此处。
# 用相对路径的 DATABASE_URL=UPLOAD_DIR=... 也行，但**显式建目录**
# 能让「卷没挂对」这类问题在启动时就暴露成写不进去，而不是静默丢数据。
RUN mkdir -p /app/data/uploads/original /app/data/uploads/generated \
             /app/data/backups /app/data/logs \
 && chown -R node:node /app/data

# 非 root 运行：node 镜像自带 uid 1000 的 node 用户
USER node

EXPOSE 4100

# 就绪探针会真实查询数据库；只监听进程存活会把「空库」误判为可用。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "docker/healthcheck.js"]

# 用 exec 形式让 node 成为 PID 1，直接收到 SIGTERM —— 否则 Ctrl+C / docker stop
# 杀不掉进程，SQLite 的写事务会被硬中断。
CMD ["node", "dist/main.js"]
