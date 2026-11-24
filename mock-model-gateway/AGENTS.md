# test/AGENTS.md

适用于 `test/` 目录树。根 `AGENTS.md` 负责跨线协作；本文件负责仿真模型网关与测试线的落地规则。冲突时本文件优先，但不得覆盖 `CLAUDE.md` 的仓库不变量。

## 1. 这个目录是什么

`test/` 是**零依赖的仿真模型网关**，不是全仓测试目录。它提供 OpenAI 标准协议与 MiniMax 兼容接口，让「渠道配置 → 连通性测试 → 生成 → 下载 → 落库」在没有真实厂商凭据时也能走通正反两条路。

测试线还覆盖：

- `backend/scripts/smoke-*.js`：L3 HTTP 冒烟
- `backend/scripts/verify-*.ts` / `probe-environments.ts`：L2 架构与纯逻辑断言
- `frontend/tests/**`：L4 Playwright
- `docs/testing.md`：测试分层、闸口、覆盖矩阵与已知缺口

这些路径的跨目录规则以根 `AGENTS.md` §2C 为准；本文件补充 `test/` 网关本身。

## 2. 网关结构

| 路径 | 职责 |
| --- | --- |
| `server.js` | 入口；读取配置、监听、打印接入参数 |
| `src/app.js` | HTTP 路由与响应 |
| `src/config.js` | 端口、鉴权、延迟、失败率、模型清单 |
| `src/text/`、`src/image/`、`src/video/` | 三种模态的仿真实现 |
| `src/routes/` | 路由拆分 |
| `test/` | `node:test` 单元 / 集成测试 |
| `scripts/smoke.js` | 对已启动实例或 `--spawn` 临时实例做联网冒烟 |

要求 Node ≥ 22.12，没有任何第三方依赖，不需要 `npm install`。

## 3. 启动与配置

```bash
cd test
node server.js     # 默认 http://127.0.0.1:3900
npm start
```

默认只监听回环地址。需要手机或容器联调时才显式设置 `MOCK_HOST=0.0.0.0`，不要把它当公网服务。

常用变量：

- `MOCK_PORT`：端口，`0` 表示随机
- `MOCK_API_KEY`：设置后 `/v1/*`、`/v2/*` 必须带 Bearer
- `MOCK_MODELS`：逗号分隔的额外模型名
- `MOCK_LATENCY_*`、`MOCK_VIDEO_READY_MS`：人为延迟
- `MOCK_FAIL_RATE`：随机失败概率
- `MOCK_FILE_TTL_MS`、`MOCK_MAX_STORE_MB`：内存产物保留

接入后台时基址只填根域，不要带 `/v1`；多写一层会 404。文本用 `chat-completion`，图像用 `openai-image` / `minimax-image`，视频用 `minimax-video`。

## 4. 协议与仿真边界

- 文本：`POST /v1/chat/completions`，支持流式与 `stream_options.include_usage`
- 图像：`POST /v1/images/generations` 与 MiniMax `POST /v1/image_generation`
- 视频：OpenAI 任务制 `/v1/videos`，以及 MiniMax V2/H3 `/v2/video_generation` + 查询
- 产物是真实字节（PNG / H.264 + MP4），但内容是规则合成，不代表真实模型推理
- 同 `prompt + model + seed` 稳定复现；任务与文件全在内存，重启即清空
- 失败注入：prompt 写 `[[fail]]` / `[[500]]`、`[[401]]`、`[[429]]`；OPTIONS 探活与模型列表不被注入

网关只能证明协议与链路可走通，不能证明真实厂商的行为、配额、计费或签名正确。真实通道相关结论仍要由对应 `verify-*` / `smoke-*` 或人工验证给出。

## 5. 验证

```bash
cd test
npm test              # node:test，自起随机端口
npm run smoke         # 打已启动的 127.0.0.1:3900
npm run smoke:spawn   # 自己起临时实例
```

网关改动至少跑 `npm test` + `npm run smoke:spawn`；涉及后台接入时再按 `docs/testing.md` 跑对应 L3 脚本。

## 6. 测试线规则

- 测试档固定 `NODE_ENV=test` → `backend/test.db`、`uploads-test/`、`backups-test/`、`logs/test/`；不要写 `dev.db`。
- 测试前确认库路径：`cd backend && node -e "console.log(require('./scripts/db-url').resolveDbPath())"`。
- 开发档与测试档端口相同（后端 4100 / 前端 5100），不能同时跑。
- 先跑红再修订；不得为了让用例变绿而修改断言。断言与实现冲突时先定性脚本错还是实现错。
- 每条结论带三件套：命令、关键输出、落库或落盘记录。单次结果随提交说明记录，不写进 `docs/testing.md`。
- 测试轮不改业务代码；发现缺陷登记缺陷卡，修复轮再改。新问题不当场扩修。
- 清理现场：`backend/scripts/clear-ops-data.js` 或按 `docs/testing.md` 的外键顺序，避免种子残留把下一轮伪造成通过。
- 后台 E2E 必须用 `playwright.admin.config.ts`；`frontend/tests/*.spec.ts` 与 `src/**/*.test.*` 互不混用。

## 7. 常见踩坑

- 连错库是最大的假阳性；先看库路径，再看断言。
- SQLite 单写者：脚本直连库与后端同时写会撞 `database is locked`，脚本内已有退避重试。
- `smoke-aigc` 需要可用 image 线路；没有线路时如实报 `42204`，不是产品缺陷。
- 视频「测试连接」显示 `未验模型名` 是 `minimax-video` 协议没有模型列表接口，不是网关缺接口。
- 网关重启后任务与产物清空；不要把跨重启持久化当预期。
- 默认回环监听是安全边界；为联调改 `MOCK_HOST=0.0.0.0` 后要自己承担暴露风险。

## 8. 交接格式

```text
线：测试
范围：
命令：
结果：通过 / 失败 / 未验
证据：状态码 / 错误码 / 金额 / routeId / 库字段
缺陷：BUG-<轮次>-<序号>（如有）
阻塞：需要哪条线先修什么
```

## 9. 线程启动提示词

```text
你是本仓库的「测试线」线程。开始前按顺序读根 AGENTS.md、test/AGENTS.md、CLAUDE.md、docs/testing.md，以及任务对应的契约文档。

目标：<一句话>
范围：可改 test/**、backend/scripts/smoke-*/verify-*、frontend/tests/**、docs/testing.md；不改业务实现。
先做：确认测试档库路径、接口契约、覆盖矩阵与需要的前置数据；先跑红，再给计划与命令。
执行：按改动域选择 L1 / L2 / L3 / L4；L1.5 / L1.6 由业务线补，测试线负责复跑确认；每条结论带命令、关键输出、落库或落盘证据。
禁止：改断言、改业务代码、把单次运行结果写进 docs/testing.md、在没有证据时写「已通过」。
交付：测试报告 + 失败项缺陷卡 + 未验边界。
```
