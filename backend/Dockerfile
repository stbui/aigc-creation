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
FROM node:24-slim AS deps
WORKDIR /app

# 只复制依赖清单 → 这一层可被缓存，源码改动不触发重装
COPY package.json package-lock.json* .npmrc ./

# 本机 npm 走 broker 代理会超时；容器内用官方源即可。
# 若在离线环境构建，把 registry 换成内网镜像地址。
RUN sed -i 's|^registry=.*|registry=https://registry.npmjs.org/|' .npmrc \
 && npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

# ── 阶段 2: 构建 ─────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* .npmrc ./
COPY tsconfig.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# ⚠ NODE_ENV=production 会让 npm 只装生产依赖，此时 tsc 不可用。
#   故这里必须显式设成 development，保证 devDependencies（nest/tsc）在。
ENV NODE_ENV=development
RUN npx prisma generate && npm run build

# ── 阶段 3: 运行时 ───────────────────────────────────────────────────────────
FROM node:24-slim AS prod
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    API_PREFIX=api/v1 \
    NODE_TLS_REJECT_UNAUTHORIZED=0

# curl 供 compose 的 healthcheck 用；不装 openssl（node:slim 已带所需库）
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# 运行时依赖：devDependencies（nest CLI / typescript / ts-node）不需要
COPY package.json package-lock.json* .npmrc ./
RUN sed -i 's|^registry=.*|registry=https://registry.npmjs.org/|' .npmrc \
 && npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

# Prisma client 产物在 build 阶段生成，拷过来即可（不含 CLI）
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY scripts ./scripts
COPY .env.production.example ./.env.production.example

# 数据目录：库文件/上传图/备份/日志统一落这里，compose 挂卷到此处。
# 用相对路径的 DATABASE_URL=UPLOAD_DIR=... 也行，但**显式建目录**
# 能让「卷没挂对」这类问题在启动时就暴露成写不进去，而不是静默丢数据。
RUN mkdir -p /app/data/uploads/original /app/data/uploads/generated \
             /app/data/backups /app/data/logs

# 非 root 运行：node 镜像自带 uid 1000 的 node 用户
RUN chown -R node:node /app
USER node

EXPOSE 3001

# 健康检查打的是能力清单接口 —— 它不需鉴权且极轻量，
# 比 /api/v1/auth/login 更适合做存活探针。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/capabilities" >/dev/null || exit 1

# 用 exec 形式让 node 成为 PID 1，直接收到 SIGTERM —— 否则 Ctrl+C / docker stop
# 杀不掉进程，SQLite 的写事务会被硬中断。
CMD ["node", "dist/main.js"]