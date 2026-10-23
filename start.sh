#!/usr/bin/env bash
#
# ecom-vision-mvp 一键启动脚本
# =============================
# 按项目既有约定拉起「后端 (NestJS/dist) + 前端 (Vite)」，并处理本机已记录的坑：
#   1. 4100 可能已被其它进程占用 → 自动回退到 4101/4102
#   2. 前端必须落在后端 CORS 放行的来源上 → 前端换端口时自动注入 CORS_ORIGINS
#   3. 不能用 `nest start`（会触发安全守卫拒绝清空 dist）→ 只跑 node dist/main.js
#   4. 首次运行自动建表 (prisma db push) 并 provision 演示账号 (seed，幂等)
#   5. Node 需 >= 22.5（依赖内置 node:sqlite）
#
# 三环境（2026-10-20 起）
# ---------------------
#   ./start.sh               开发：库 dev.db  目录 uploads      前端 5100/后端 4100
#   ./start.sh --env test     测试：库 test.db 目录 uploads-test  前端 5200/后端 4200
#   ./start.sh --env prod     生产：读 .env.production，端口与库全由该文件决定
#
# 各环境的库/目录/密钥差异由 backend/.env.{env} 与 frontend/.env.{env} 承载
# （详见 docs/environments.md），本脚本只负责把 NODE_ENV 与 --mode 串起来，
# 不再自己决定连哪个库 —— 那正是过去「以为在测其实连着开发库」的根源。
#
# 用法:
#   ./start.sh                # 默认：必要时构建后端 → 建表+种子 → 起后端 → 起前端
#   ./start.sh --env test     # 起测试环境（独立库，独立上传目录，独立端口）
#   ./start.sh --env prod     # 起生产环境（需 .env.production 存在）
#   ./start.sh --build        # 强制重新构建后端
#   ./start.sh --skip-db      # 跳过建表与演示账号种子
#   ./start.sh --with-thumbs  # 启动后补种工作台缩略图（走真实 API，幂等）
#   ./start.sh --install      # 依赖缺失时执行 npm install（注意：本机 broker 代理可能超时）
#   ./start.sh --backend-only # 只起后端
#   ./start.sh --frontend-only# 只起前端（要求后端已在运行）
#   ./start.sh --no-follow    # 不实时跟随日志（仅打印日志路径）
#   ./start.sh --daemon       # 后台运行（nohup 脱离终端，PID 记于 .run/start.pids，脚本随即返回）
#   ./start.sh --stop         # 停止 --daemon 起的进程（按 PID 记录 + 端口兜底，只动本仓库的进程）
#   ./start.sh -h | --help    # 查看帮助
#
# 端口可用环境变量覆盖（不设则按环境默认，开发态仍自动挑选空闲端口）:
#   BACKEND_PORT   开发默认 4100→4101→4102 取第一个空闲；test/prod 用 env 文件值
#   FRONTEND_PORT  开发默认 5100→5101→5102；test 默认 5200
#
# 停止: 前台按 Ctrl+C 即会同时关闭前后端；后台用 ./start.sh --stop。

set -euo pipefail

# ────────────────────────────── 基础变量 ──────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="$ROOT/.run"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
# 后台模式的 PID 记录：一行一个 pid（后端、前端）。
# 放 .run/ 是因为它已进 .gitignore，且与日志同处一地，排障时只看一个目录。
PID_FILE="$LOG_DIR/start.pids"

# foreground = 前台（默认，Ctrl+C 全停）；daemon = nohup 脱离；stop = 只停
MODE=foreground

# ── 环境选择 ──
# APP_ENV 同时决定三件事：env 文件档位（backend/.env.{APP_ENV}）、
# 前端 --mode、以及端口候选序列。
# prod 不做端口回退 —— 生产端口被占就该起不来，而不是静默换到没人访问的端口。
APP_ENV=development
NODE_ENV=development
VITE_MODE=development

DO_BUILD=0
SKIP_DB=0
WITH_THUMBS=0
DO_INSTALL=0
RUN_BACKEND=1
RUN_FRONTEND=1
FOLLOW=1

BACK_PID=""
FRONT_PID=""
TAIL_PID=""

# ────────────────────────────── 输出工具 ──────────────────────────────
c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_info() { printf '\033[36m%s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m%s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

usage() {
  # 只截取文件头部连续的注释块（跳过 shebang，遇到首个非注释行即停）
  awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"
  exit 0
}

# ────────────────────────────── 参数解析 ──────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --env)         shift; APP_ENV="${1:-}"; [ -n "$APP_ENV" ] || { c_err '--env 缺参数'; exit 2; }; shift ;;
    --env=*)       APP_ENV="${arg#--env=}" ;;
    --build)       DO_BUILD=1 ;;
    --skip-db)SKIP_DB=1 ;;
    --with-thumbs) WITH_THUMBS=1 ;;
    --install)     DO_INSTALL=1 ;;
    --backend-only)RUN_FRONTEND=0 ;;
    --frontend-only) RUN_BACKEND=0 ;;
    --no-follow)   FOLLOW=0 ;;
    --daemon)      MODE=daemon ;;
    --stop)        MODE=stop ;;
    -h|--help)     usage ;;
    *) c_err "未知参数: $arg（用 --help 查看用法）"; exit 2 ;;
  esac
done

# APP_ENV → NODE_ENV / Vite mode 的映射。
# 只认三个词：写成 production/staging 这类同义词会被拒，
# 因为「这个别名到底映射到哪个档位」在 shell 层说不清就该让人写全。
case "$APP_ENV" in
  development|dev)
    APP_ENV=development; NODE_ENV=development; VITE_MODE=development ;;
  test)
    APP_ENV=test; NODE_ENV=test; VITE_MODE=test ;;
  prod|production)
    APP_ENV=production; NODE_ENV=production; VITE_MODE=production ;;
  *) c_err "--env 只接受 development | test | production（收到: $APP_ENV）"; exit 2 ;;
esac

# ────────────────────────────── 退出清理 ──────────────────────────────
kill_tree() {
  local pid="${1:-}"
  [ -z "$pid" ] && return 0
  local kids
  kids="$(pgrep -P "$pid" 2>/dev/null || true)"
  local k
  for k in $kids; do kill_tree "$k"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null || true
  if [ -n "$FRONT_PID" ] || [ -n "$BACK_PID" ]; then
    printf '\n'
    c_info '正在停止前后端服务…'
    [ -n "$FRONT_PID" ] && kill_tree "$FRONT_PID"
    [ -n "$BACK_PID" ]  && kill_tree "$BACK_PID"
  fi
  rm -f "$PID_FILE"
  wait 2>/dev/null || true
  c_ok '已退出。'
}

# 只回收「工作目录属于本仓库」的监听进程 —— 4100 上可能跑着别人的服务，
# 按端口无条件 kill -9 会误伤，所以必须再确认一次 cwd。
# 注意：macOS 的 lsof -p 不一定能读到 cwd，读不到就一律跳过（宁可留进程，不可杀错）。
kill_repo_listener() {
  local port="$1" pid
  for pid in $(lsof -ti :"$port" 2>/dev/null || true); do
    if lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -q "$ROOT"; then
      kill_tree "$pid" && c_info "  释放端口 $port (PID $pid)"
    fi
  done
}

# ── --stop：停掉上一轮 --daemon（或遗留的）进程，不做别的 ──
if [ "$MODE" = stop ]; then
  step '停止后台服务'
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      [ -n "$pid" ] && kill_tree "$pid"
    done < "$PID_FILE"
    rm -f "$PID_FILE"
    c_ok "已停止 $(basename "$PID_FILE") 记录的进程"
  else
    c_warn "没有 $PID_FILE，改为按端口回收本仓库进程"
  fi
  # 兜底：PID 记录丢失（换终端/manual kill）时，按各环境默认端口清一遍。
  # 后四个旧端口（3001/3101/5173/5273）一并保留，用于回收本次改端口前遗留的实例。
  for p in 4100 4101 4102 4200 5100 5101 5102 5200 3001 3101 5173 5273; do
    kill_repo_listener "$p"
  done
  c_ok '已停止。'
  exit 0
fi

# background 模式不注册 trap：脚本退出即返回，服务由 nohup 守护。
# 若这里照旧 trap EXIT cleanup，脚本一退出就会把刚起的服务杀干净。
if [ "$MODE" = foreground ]; then
  trap cleanup EXIT INT TERM
fi

# 上一轮起的进程还在（常见于 --daemon 忘了停）：先停掉再起。
# 不停的话端口被占，脚本会按候选序列悄悄落到 4101/5101 —— 前端代理也跟着变，
# 看起来「启动了」，但你访问的旧实例还在，改的代码像没生效。
if [ -f "$PID_FILE" ]; then
  c_info '发现上一轮记录的服务，先停止…'
  while read -r pid; do
    [ -n "$pid" ] && kill_tree "$pid"
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# ────────────────────────────── 端口探测 ──────────────────────────────
port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# 在候选端口里挑第一个空闲的
pick_port() {
  local p
  for p in "$@"; do
    if ! port_in_use "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

# ────────────────────────────── 环境检查 ──────────────────────────────
step '检查运行环境'

# 生产档位必须显式配置过：没有 .env.production 就跑生产，等于
# 让兜底默认值（开发库 + 开发密钥）悄悄上线路。
if [ "$APP_ENV" = production ]; then
  if [ ! -f "$BACKEND_DIR/.env.production" ]; then
    c_err '缺少 backend/.env.production'
    c_err "  cp backend/.env.production.example backend/.env.production 后填写 JWT_SECRET / DATABASE_URL / CORS_ORIGINS"
    exit 1
  fi
  c_ok '.env.production 已就位'
fi

if ! command -v node >/dev/null 2>&1; then
  c_err '未找到 node，请先安装 Node.js >= 22.5'; exit 1
fi

NODE_VER="$(node -v)"
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) process.exit(1);
' || {
  c_err "Node 版本过低：需要 >= 22.5（依赖内置 node:sqlite），当前 $NODE_VER"; exit 1;
}
c_ok "Node $NODE_VER ✓"

check_modules() {
  local dir="$1" name="$2"
  if [ ! -d "$dir/node_modules" ]; then
    if [ "$DO_INSTALL" -eq 1 ]; then
      c_warn "$name 缺少 node_modules，执行 npm install（本机 broker 代理可能 5 分钟超时）…"
      ( cd "$dir" && npm install )
    else
      c_err "$name 缺少依赖：$dir/node_modules"
      c_err "请先安装依赖，或加 --install 让脚本尝试；若代理超时请按 README「环境注意事项」用 curl+tar 直装。"
      exit 1
    fi
  fi
}

[ "$RUN_BACKEND" -eq 1 ]  && check_modules "$BACKEND_DIR"  'backend'
[ "$RUN_FRONTEND" -eq 1 ] && check_modules "$FRONTEND_DIR" 'frontend'

mkdir -p "$LOG_DIR"

# ────────────────────────────── 选择端口 ──────────────────────────────
# 各环境的默认端口与候选序列不同：
#   development 4100-4102 / 5100-5102（开发态要能绕开本机端口占用）
#   test        4200 / 5200（固定 —— 与开发并行是常态，且 env 文件里已写死）
#   production  只认 env 文件，不回退（端口被占就该起不来）
BACKEND_CANDIDATES=""
FRONTEND_CANDIDATES=""
case "$APP_ENV" in
  development) BACKEND_CANDIDATES="4100 4101 4102"; FRONTEND_CANDIDATES="5100 5101 5102" ;;
  test)        BACKEND_CANDIDATES="4200";           FRONTEND_CANDIDATES="5200" ;;
  production)  BACKEND_CANDIDATES="";               FRONTEND_CANDIDATES="" ;;
esac

# 从 env 文件读该环境的默认端口（读不到就用上面的候选首项）
read_env_port() {
  local env_file="$BACKEND_DIR/.env.$APP_ENV" var="$1" fallback="$2" val
  if [ "$APP_ENV" = production ]; then
    env_file="$BACKEND_DIR/.env.production"
  fi
  if [ -f "$env_file" ]; then
    val="$(grep -E "^${var}=" "$env_file" | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)"
  fi
  [ -n "$val" ] && printf '%s' "$val" || printf '%s' "$fallback"
}

ENV_BACKEND_PORT="$(read_env_port PORT "$( [ -n "$BACKEND_CANDIDATES" ] && printf '%s' "${BACKEND_CANDIDATES%% *}" || printf '%s' 4100 )")"
ENV_FRONTEND_PORT="$(read_env_port VITE_PORT "$( [ -n "$FRONTEND_CANDIDATES" ] && printf '%s' "${FRONTEND_CANDIDATES%% *}" || printf '%s' 4173 )")"

step '分配端口'

if [ -n "${BACKEND_PORT:-}" ]; then
  if [ "$RUN_BACKEND" -eq 1 ] && port_in_use "$BACKEND_PORT"; then
    c_warn "指定的 BACKEND_PORT=$BACKEND_PORT 已被占用，仍尝试使用（若失败请换端口）"
  fi
else
  if [ "$RUN_BACKEND" -eq 1 ]; then
    # 先试 env 文件里的端口，被占再按候选序列回退（生产无候选 → 直接失败）
    if [ "$APP_ENV" = production ]; then
      if port_in_use "$ENV_BACKEND_PORT"; then
        c_err "生产端口 $ENV_BACKEND_PORT 已被占用。生产不做端口回退 —— 请先释放该端口或改 .env.production 的PORT"
        exit 1
      fi
      BACKEND_PORT="$ENV_BACKEND_PORT"
    elif ! BACKEND_PORT="$(pick_port "$ENV_BACKEND_PORT" $BACKEND_CANDIDATES)"; then
      c_err "$BACKEND_CANDIDATES 均被占用，请用 BACKEND_PORT=<空闲端口> ./start.sh"; exit 1
    fi
    [ "$BACKEND_PORT" != "$ENV_BACKEND_PORT" ] && c_warn "$ENV_BACKEND_PORT 被占用，后端改用 $BACKEND_PORT"
  else
    # --frontend-only：后端由用户自己跑，指向该环境的默认端口，不探测
    BACKEND_PORT="$ENV_BACKEND_PORT"
  fi
fi

if [ "$RUN_FRONTEND" -eq 1 ]; then
  if [ -n "${FRONTEND_PORT:-}" ]; then
    if port_in_use "$FRONTEND_PORT"; then
      c_err "指定的 FRONTEND_PORT=$FRONTEND_PORT 已被占用（Vite 用 --strictPort 会直接失败）"; exit 1
    fi
  elif [ "$APP_ENV" = production ]; then
    if port_in_use "$ENV_FRONTEND_PORT"; then
      c_err "生产前端端口 $ENV_FRONTEND_PORT 已被占用"; exit 1
    fi
    FRONTEND_PORT="$ENV_FRONTEND_PORT"
  elif ! FRONTEND_PORT="$(pick_port "$ENV_FRONTEND_PORT" $FRONTEND_CANDIDATES)"; then
    c_err "$FRONTEND_CANDIDATES 均被占用，请用 FRONTEND_PORT=<空闲端口> ./start.sh"; exit 1
  fi
  [ "$FRONTEND_PORT" != "$ENV_FRONTEND_PORT" ] && c_warn "$ENV_FRONTEND_PORT 被占用，前端改用 $FRONTEND_PORT"
fi

# 后端 CORS：test/production 由各自 env 文件显式给白名单；开发态前端换端口时注入。
# ⚠ 生产**不注入** —— 注入 localhost 白名单等于给线上开了一个本机来源的洞，
#   而线上真实来源应该在 .env.production 的 CORS_ORIGINS 里写死。
CORS_ORIGINS_VAL=""
if [ "$APP_ENV" = development ] && [ "$RUN_FRONTEND" -eq 1 ]; then
  if [ "$FRONTEND_PORT" != "5100" ] && [ "$FRONTEND_PORT" != "4173" ]; then
    CORS_ORIGINS_VAL="http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT"
  fi
fi

c_ok "环境: $APP_ENV  (NODE_ENV=$NODE_ENV · 前端 mode=$VITE_MODE)"
c_ok "后端端口: $BACKEND_PORT"
[ "$RUN_FRONTEND" -eq 1 ] && c_ok "前端端口: $FRONTEND_PORT"
[ -n "$CORS_ORIGINS_VAL" ] && c_info "注入 CORS_ORIGINS=$CORS_ORIGINS_VAL"

# ────────────────────────────── 后端：建表 + 种子 ──────────────────────────────
# ⚠ NODE_ENV 必须随每条 npm 子命令一起传：prisma.config.ts 是靠它选
#   .env.{env} 来决定打哪个库的（见 backend/src/config/env-files.ts）。
#   漏传就会用兜底的 dev.db —— 这正是「以为在测、实际改了开发库」的成因。
if [ "$RUN_BACKEND" -eq 1 ] && [ "$SKIP_DB" -eq 0 ]; then
  step '初始化数据库（建表 + 账号 + 商品/会员/营销，幂等）'
  ( cd "$BACKEND_DIR" && NODE_ENV="$NODE_ENV" npm run --silent prisma:push )
  # 只跑 seed 会得到一个「有账号但没有任何在售商品」的库：积分商城空、首页
  # 套餐空、会员买不到。购买链路的种子是 commerce/membership/marketing 三份。
  # 刻意不跑 seed:admin（会生成随机密码并打印一次），后台账号由用户按需建。
  ( cd "$BACKEND_DIR" && NODE_ENV="$NODE_ENV" npm run --silent seed \
    && NODE_ENV="$NODE_ENV" npm run --silent seed:commerce \
    && NODE_ENV="$NODE_ENV" npm run --silent seed:membership \
    && NODE_ENV="$NODE_ENV" npm run --silent seed:marketing )
  # seed 已改成环境驱动：未设 SEED_USER_EMAIL 时什么都不建，不再有内置演示凭据。
  c_ok "数据库就绪（$APP_ENV 库）"
  c_info '预置 C 端账号：SEED_USER_EMAIL=you@example.com ./start.sh（密码随机并打印一次，或加 SEED_USER_PASSWORD 指定）'
fi

# ────────────────────────────── 后端：构建 ──────────────────────────────
# dist 存在就跳过构建曾经踩过坑：改了 src 但没重建，起的仍是旧代码，
# 表现为「新接口 404 / Cannot POST」，而后端日志一切正常。
# 现在按 mtime 判断：src 或 prisma 里有比 dist/main.js 更新的文件就自动重建。
dist_is_stale() {
  [ -f "$BACKEND_DIR/dist/main.js" ] || return 0
  [ -n "$(find "$BACKEND_DIR/src" "$BACKEND_DIR/prisma" \
            -type f -newer "$BACKEND_DIR/dist/main.js" -print -quit 2>/dev/null)" ]
}

if [ "$RUN_BACKEND" -eq 1 ]; then
  if [ "$DO_BUILD" -eq 1 ]; then
    step '构建后端 (nest build，--build 强制)'
    ( cd "$BACKEND_DIR" && npm run --silent build )
    c_ok '构建完成'
  elif dist_is_stale; then
    step '构建后端 (nest build，源码比 dist 新)'
    ( cd "$BACKEND_DIR" && npm run --silent build )
    c_ok '构建完成'
  else
    c_info 'dist/main.js 已是最新，跳过构建（如需强制重建加 --build）'
  fi
fi

# ────────────────────────────── 启动后端 ──────────────────────────────
if [ "$RUN_BACKEND" -eq 1 ]; then
  step "启动后端 (PID 记录中) → http://localhost:$BACKEND_PORT/api/v1"
  : > "$BACKEND_LOG"
  # 注入数组：只在真有值时才注入对应变量。
  # ⚠ 不能图省事写 CORS_ORIGINS="" —— dotenv 的语义是「已存在的键不覆盖」，
  #   空串同样算「已存在」，于是 .env.test 里的 CORS_ORIGINS 会静默失效，
  #   表现为一进测试环境所有请求都被 CORS 拦掉。
  BACK_ENV=(NODE_ENV="$NODE_ENV" PORT="$BACKEND_PORT")
  [ -n "$CORS_ORIGINS_VAL" ] && BACK_ENV+=("CORS_ORIGINS=$CORS_ORIGINS_VAL")
  [ -n "${CORS_ALLOW_PRIVATE_LAN:-}" ] && BACK_ENV+=("CORS_ALLOW_PRIVATE_LAN=$CORS_ALLOW_PRIVATE_LAN")
  (
    cd "$BACKEND_DIR" && exec env "${BACK_ENV[@]}" node dist/main.js
  ) >>"$BACKEND_LOG" 2>&1 < /dev/null &
  BACK_PID=$!
  # exec 让 $! 就是 node 本身（不是子 shell），kill_tree 才不会漏掉真正的服务进程。
  # daemon 模式再把作业从作业表摘掉：脚本退出时不随 SIGHUP 一起被带走。
  if [ "$MODE" = daemon ]; then
    disown "$BACK_PID" 2>/dev/null || true
  fi
  printf '%s\n' "$BACK_PID" >> "$PID_FILE"

  c_info '等待后端就绪…'
  READY=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$BACK_PID" 2>/dev/null; then
      c_err "后端进程已退出，日志尾部："
      tail -n 20 "$BACKEND_LOG" >&2 || true
      exit 1
    fi
    if curl -fsS "http://localhost:$BACKEND_PORT/api/v1/capabilities" >/dev/null 2>&1; then
      READY=1; break
    fi
    sleep 0.5
  done
  if [ "$READY" -ne 1 ]; then
    c_err '后端 30s 内未就绪，日志尾部：'
    tail -n 20 "$BACKEND_LOG" >&2 || true
    exit 1
  fi
  c_ok "后端就绪 ✓"

  # 可选：补种工作台缩略图（走真实 API）
  if [ "$WITH_THUMBS" -eq 1 ]; then
    step '补种工作台缩略图（幂等）'
    ( cd "$BACKEND_DIR" && API="http://localhost:$BACKEND_PORT" npx ts-node -T scripts/seed-workbench-thumbs.ts ) \
      || c_warn '缩略图种子未完成（不影响启动）'
  fi
fi

# ────────────────────────────── 启动前端 ──────────────────────────────
if [ "$RUN_FRONTEND" -eq 1 ]; then
  step "启动前端 (Vite, mode=$VITE_MODE) → http://localhost:$FRONTEND_PORT"
  : > "$FRONTEND_LOG"
  # VITE_API_BASE 刻意**不注入**：留空时前端走同源 /api，由 Vite 代理转发，
  # 于是全程不产生跨域，端口变化也不必改前端代码。
  # 只有跨域部署（前端挂 CDN）才需要填绝对地址，那是 .env.production 的事。
  (
    cd "$FRONTEND_DIR" && exec env NODE_ENV="$NODE_ENV" \
        VITE_PORT="$FRONTEND_PORT" \
        VITE_API_PROXY="http://localhost:$BACKEND_PORT" \
      npx vite --mode "$VITE_MODE" --port "$FRONTEND_PORT" --strictPort
  ) >>"$FRONTEND_LOG" 2>&1 < /dev/null &
  FRONT_PID=$!
  if [ "$MODE" = daemon ]; then
    disown "$FRONT_PID" 2>/dev/null || true
  fi
  printf '%s\n' "$FRONT_PID" >> "$PID_FILE"

  c_info '等待前端就绪…'
  READY=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$FRONT_PID" 2>/dev/null; then
      c_err "前端进程已退出，日志尾部："
      tail -n 20 "$FRONTEND_LOG" >&2 || true
      exit 1
    fi
    if curl -fsS "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1; then
      READY=1; break
    fi
    sleep 0.5
  done
  if [ "$READY" -ne 1 ]; then
    c_warn '前端 30s 内未就绪，请查看日志：'"$FRONTEND_LOG"
  else
    c_ok "前端就绪 ✓"
  fi
fi

# ────────────────────────────── 汇总 ──────────────────────────────
printf '\n\033[1m═══════════ 启动完成（%s）══════════\033[0m\n' "$APP_ENV"
[ "$RUN_BACKEND" -eq 1 ]  && c_ok   "后端  http://localhost:$BACKEND_PORT/api/v1"
[ "$RUN_FRONTEND" -eq 1 ] && c_ok   "前端  http://localhost:$FRONTEND_PORT"
c_info "环境  NODE_ENV=$NODE_ENV · 前端 mode=$VITE_MODE"
# 库/目录的权威值在 env 文件里，这里只做一次显式回显 ——
# 界面角标可能看漏，后端启动日志第一屏一定有「运行环境 + 数据库路径」。
c_info "数据  见后端启动日志首行的「运行环境 / 数据库 / 上传目录」"
if [ "$APP_ENV" != production ]; then
  c_info 'C 端账号  自行注册，或 SEED_USER_EMAIL=… ./start.sh 预置'
  c_info '后台账号  cd backend && npm run seed:admin（密码随机，仅打印一次）'
fi
c_info "日志  backend: $BACKEND_LOG"
c_info "日志  frontend: $FRONTEND_LOG"
# : > "$BACKEND_LOG" 每次启动清空的只是 stdout 镜像; 应用层的历史日志由
# AppFileLogger 自行管理, 按天分文件 + 保留 LOG_RETENTION_DAYS 天, 重启不丢
c_info "日志  落盘归档: $BACKEND_DIR/logs/（app-<日期>.log + .error.log, 按天轮转）"

# ── 后台模式：就绪即返回，不进入前台等待 ──
if [ "$MODE" = daemon ]; then
  c_info "PID  记录于 $PID_FILE"
  printf '\033[1m\n./start.sh --stop 停止所有服务\033[0m\n\n'
  c_ok '已在后台运行。'
  exit 0
fi

printf '\033[1m\nCtrl+C 停止所有服务\033[0m\n\n'

# ────────────────────────────── 跟随日志 / 等待 ──────────────────────────────
if [ "$FOLLOW" -eq 1 ]; then
  # 只跟随新写入的行，避免刷屏历史日志
  tail -n 0 -f "$BACKEND_LOG" "$FRONTEND_LOG" 2>/dev/null &
  TAIL_PID=$!
fi

wait
