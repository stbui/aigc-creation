# ─────────────────────────────────────────────────────────────────────────────
# 前端镜像（Vite 构建 + Nginx 托管）
#
# 三阶段: deps → build → runtime(nginx)
#   runtime 只有 nginx + 静态产物，没有 node，攻击面与体积都最小。
#
# ⚠ Vite 的 --mode 决定了产物里烧进哪些配置，**这是不可逆的**：
#   同一份 dist 只能服务于构建时选定的那套环境。所以生产镜像固定
#   `--mode production`，需要测试环境的静态产物请另build 一个 target。
# ─────────────────────────────────────────────────────────────────────────────

# ── 阶段 1: 依赖 ─────────────────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /app

COPY package.json package-lock.json* .npmrc ./
RUN sed -i 's|^registry=.*|registry=https://registry.npmjs.org/|' .npmrc \
 && npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

# ── 阶段 2: 构建 ─────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# build 环境变量：**只有 VITE_* 会被烧进产物**。
# VITE_API_BASE 留空 = 走同源 /api，由 nginx 反代到 backend。
# 若改用跨域部署（前端挂 CDN），在这里改成绝对地址，
# 同时必须把该域名加进 backend 的 CORS_ORIGINS。
ARG VITE_API_BASE=""
ARG VITE_ENV_LABEL=""
ENV VITE_API_BASE=$VITE_API_BASE VITE_ENV_LABEL=$VITE_ENV_LABEL

# tsc --noEmit 是 build 脚本的一部分：类型不过就不出产物（刻意的门禁）
RUN npx tsc --noEmit && npx vite build --mode production

# ── 阶段 3: 运行时（Nginx）───────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# ⚠ NGINX_ENVSUBST_FILTER 必须设，且必须**只列出自己要替换的变量名**。
#   nginx 官方镜像的 envsubst 脚本默认替换**环境里的全部变量** ——
#   于是配置里的 $host / $remote_addr / $scheme / $uri 这些 nginx 运行时
#   变量，一旦环境里恰好有同名变量（HOSTNAME→$host 等），就会被替换成空串，
#   表现为反代静默失效或 nginx 直接启动失败。
#   官方文档给的做法就是这个 filter，它是唯一能保证「只替换该替换的」开关。
ENV NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM

# 默认值让 `docker run` 单跑镜像也能用（compose 会覆盖成对应环境的服务名）。
# 未设置时 ${BACKEND_UPSTREAM} 会原样留在配置里 → nginx 启动失败（快速失败，好过静默错配）
ENV BACKEND_UPSTREAM=backend:3001

# 项目自带的 nginx 配置（模板）：SPA 回退 + /api 反代 + /uploads 静态直出。
# 必须放 /etc/nginx/templates/ —— 官方镜像启动时会对该目录下的 *.template
# 跑 envsubst，把 ${BACKEND_UPSTREAM} 替换成实际的后端服务名。
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]