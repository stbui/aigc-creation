# Codex Web

一个运行在本机的 Codex SDK 网页工作台。浏览器负责会话与展示，Node 服务端通过
`@openai/codex-sdk` 启动 Codex CLI，并把结构化事件以 SSE 实时转发到页面。

## 功能

- 多会话聊天，支持首个消息自动命名、历史本地缓存和服务重启后按线程 ID 恢复。
- 实时展示 Codex 事件：回复、推理摘要、终端命令与输出、文件变更、MCP 调用、网页搜索、任务清单。
- 消息时间线增量渲染：流式更新只替换变化条目，历史节点保持复用，仅新消息播放入场动效。
- 用户消息、回复、思考过程、终端、文件、搜索和待办采用差异化视觉与状态呈现。
- 每个会话可单独设置工作目录、模型、推理强度、沙箱模式、网页搜索和沙箱联网。
- Markdown 渲染、代码块复制、响应式侧栏、深色/浅色主题。
- 服务端默认只监听 `127.0.0.1`；工作目录强制限制在 `AGENT_WORKSPACE_ROOT` 内。
- 可选 `AGENT_ACCESS_TOKEN`，为 API 增加 Bearer Token 保护。

## 快速开始

要求 Node.js 18+，并且机器上已经能使用 Codex CLI。

```bash
cd agent
npm install
npm start
```

打开 <http://127.0.0.1:4310>。

首次使用前需要完成 Codex 登录：

```bash
codex login
```

也可以只为服务进程提供 API Key：

```bash
CODEX_API_KEY=sk-... npm start
```

SDK 会优先使用 `~/.codex/config.toml` 中的模型与 provider 配置；页面里的模型输入留空即可沿用该配置。

## 配置

复制 `.env.example` 为 `.env` 后修改，服务启动时会自动读取。已有环境变量优先于 `.env`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `4310` | 监听端口 |
| `AGENT_WORKSPACE_ROOT` | 仓库根目录 | 允许 Codex 访问的工作目录根 |
| `AGENT_ACCESS_TOKEN` | 空 | 设置后 API 需要 `Authorization: Bearer <token>` |
| `AGENT_ALLOW_DANGER_FULL_ACCESS` | `0` | 是否在 UI 中开放 `danger-full-access` |
| `AGENT_DEFAULT_MODEL` | 空 | 新会话默认模型，空表示跟随 Codex 配置 |
| `AGENT_MAX_SESSIONS` | `25` | 服务端内存中保留的最大会话数 |
| `CODEX_PATH` | 空 | 自定义 Codex CLI 可执行文件 |
| `CODEX_API_KEY` | 空 | 非交互环境下的 Codex API Key |
| `CODEX_BASE_URL` | 空 | 自定义 Responses API 地址 |

## 安全边界

- 服务默认绑定回环地址，不会自动暴露到局域网。
- 用户提交的工作目录会经过 `realpath` 校验，软链接也不能跳出 `AGENT_WORKSPACE_ROOT`。
- 执行审批固定为 `never`，因为 Web 端没有交互式审批通道；权限完全由沙箱模式控制。
- 默认使用 `workspace-write`。如无必要，不要开启 `danger-full-access`，也不要把无令牌服务暴露到公网。
- API Key、Codex 登录信息只保留在服务端，不会发送给浏览器。

## 结构

```text
agent/
  src/app.mjs          HTTP 路由、会话、SSE 与 Codex SDK 调用
  src/config.mjs       环境变量与服务端配置
  src/lib.mjs          路径校验、JSON 与安全工具
  src/sessions.mjs     内存会话与时间线
  src/server.mjs       进程入口
  public/              无构建步骤的浏览器端
  test/app.test.mjs    基于假 Codex 的接口与流式测试
```

## API

- `GET /api/health`：无需认证的健康检查。
- `GET /api/config`：工作区根、默认设置与能力开关。
- `GET /api/sessions`：当前内存会话列表。
- `POST /api/sessions`：新建或恢复会话。
- `GET /api/sessions/:id`：会话元数据与完整时间线。
- `DELETE /api/sessions/:id`：删除会话。
- `POST /api/sessions/:id/turns`：执行任务，返回 `text/event-stream`。
- `POST /api/sessions/:id/cancel`：停止正在运行的任务。

## 测试

```bash
npm test
```

测试使用假的 Codex 线程，不会调用模型，也不会消耗 token。覆盖静态页面、认证、会话创建、SSE 事件、
时间线持久化、路径越界、危险沙箱拦截、线程恢复和错误处理。

## 已知限制

- 服务端会话保存在内存中；服务重启后，页面可凭 `codexThreadId` 自动恢复 Codex 线程，但本地时间线缓存才是页面历史来源。
- 同一会话同时只允许一个运行中的任务。
- 不支持网页端的命令审批；需要审批的操作应通过沙箱策略禁止或放行。
