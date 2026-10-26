# 测试文档

本文是**测试策略与闸口清单**的唯一说明文件。所有条目都对应仓库里真实存在的脚本或配置；断言数量随脚本演进，**以实际运行输出为准**。本文只维护清单、覆盖矩阵与已知红灯；单次运行的真实结果（通过 / 失败数）随提交说明记录。

## 1. 测试分层

| 层 | 目的 | 载体 | 是否需要起服务 |
| --- | --- | --- | --- |
| L1 编译与类型 | 代码能否构建、类型是否自洽 | `backend npm run build`、`frontend npx tsc --noEmit`、`npm run build:prod` | 否 |
| L2 架构与纯逻辑断言 | 分层依赖、能力注册表、签名串、环境解析等**不靠类型检查能发现**的错误 | `backend/scripts/verify-*.ts`、`probe-environments.ts` | 多数否 |
| L3 HTTP 冒烟 | 接口契约、权限、资金与积分规则、回落与失败语义 | `backend/scripts/smoke-*.js` | 是 |
| L4 浏览器 E2E | 页面渲染、权限链路、提交契约、状态契约 | `frontend/tests/*.spec.ts`（Playwright） | 是（前端 + 后端） |

原则：**先跑红再最小修订**。闸口脚本的断言视为规格，不得为了让测试变绿而修改断言；确有断言与实现冲突时，先定性（脚本错 / 实现错），再改对应的一侧，并在交付说明里写清结论。

## 2. 环境与数据隔离

- 测试一律连**测试档**：`NODE_ENV=test` → `backend/test.db`、`uploads-test/`、`backups-test/`、`logs/test/`。
  端口与开发档相同（后端 4100 / 前端 5100），**两档不能同时跑**：起测试档会停掉开发档。
- 冒烟与 seed 脚本按当前 `NODE_ENV` 选库（`backend/scripts/db-url.js`），**默认是开发库**。跑测试必须显式 `NODE_ENV=test`，否则会写脏 `dev.db`。
- 重建测试环境：`NODE_ENV=test npm run db:reset:test`（删库 + 重建 + 重灌种子，带安全门禁）。
- 启动测试后端：`./start.sh --env test`（端口固定 4100，占用即停；手工启动则 `NODE_ENV=test node dist/main.js`，不要用 `nest start`）。
- 端口被其它进程占用时脚本必须能指向目标实例（开发档默认 4100）：多数支持 `API_BASE`，`smoke-marketing.js` 用 `MARKETING_API_BASE`（含 `/api/v1`），`smoke-model-channels.js` 用 `SMOKE_BASE`（含 `/api/v1`）。
- SQLite 单写者：脚本直连库的同时后端在写库会撞 `database is locked`（P2039），脚本内已做退避重试。

## 3. 自动化闸口清单

### 3.1 构建与类型（L1）

```bash
cd backend && npm run build
cd frontend && npx tsc --noEmit
cd frontend && npm run build:prod
```

### 3.2 架构与纯逻辑断言（L2）

`backend/scripts/` 下共 24 个验证脚本：20 个 `verify-*.ts` + 1 个 `probe-environments.ts`（不连库，见 3.2.1），以及 3 个需要后端已启动的 `verify-*.js`（见 3.2.2）。

#### 3.2.1 纯逻辑 / 自起服务（`npx ts-node -T scripts/<name>.ts`）

| 脚本 | 断言什么 |
| --- | --- |
| `verify-architecture-layers.ts` | 分层依赖方向：应用层 → unified → vendors → protocols → modality，反向依赖即失败 |
| `verify-capability-bootstrap.ts` | 能力定义能真实加载并通过 `assertCapabilityIntegrity`（漏声明字段会启动即崩） |
| `verify-capability-extensibility.ts` | 新增能力是否只需改一处（registry 扩展性） |
| `verify-capability-extraction.ts` | 能力定义拆分前后的逐字段等价性 |
| `verify-credit-deduction.ts` | 生成扣费 / 失败退款 / 余额一致性（同进程起 Nest 打真实 HTTP） |
| `verify-credit-price.ts` | 后台改价 → `/capabilities` 与生成扣费同步生效 |
| `verify-modality-config.ts` | 三模态配置解析与存量键回落方向 |
| `verify-vendor-aggregation.ts` | 厂商目录 → 模态视图的派生等价性 |
| `verify-channel-scheduler.ts` | 多渠道调度：优先级、冷却、失败切换；**基址归一化**（尾部 `/v1` 在调度器与列表视图两条读路径都剥掉，`/api/v3` 与 `/v1/gw` 保留） |
| `verify-channel-test.ts` | 连通性测试路径按模态构造（缺陷回归防护） |
| `verify-failover.ts` | 故障转移时**真的**换上备用通道的 baseUrl / token / model |
| `verify-model-config-fixes.ts` | 模型配置页 model-only 语义：无线路为 `none`、存量 `route=local` 不可用、新写入 local 被拒；**全局设置 `gateway.*.baseUrl` 写入归一化** |
| `verify-image-pipeline.ts` | 图像链路：无线路 `42204`、存量 local 失败、遮罩无 edits 线路 `42205`、上游失败 `42201`、成功来源只能是 `gateway` |
| `verify-tool-contracts.ts` | 8 个修图工具的能力定义、默认值、hidden 字段兼容、严格参数校验、标注解析、上传头与遮罩尺寸校验 |
| `verify-video-pipeline.ts` | 视频四段式异步契约 |
| `verify-payment-signatures.ts` | 支付宝 RSA2 / 微信 v3 AES-GCM 按公开规范**独立复算**（防「自己签自己验」） |
| `verify-channel-signatures.ts` | 阿里云短信 / 邮件 RPC 签名（HMAC-SHA1 + sorted canonical query）固定 nonce/时间戳独立复算；**只验签名与请求形状，不代表已真实投递** |
| `verify-admin-tasks.ts` | 后台任务监控（同进程起服务，避免沙箱后台进程无法存活） |
| `verify-free-create-e2e.ts` | 自由创作真实 HTTP → 落库字段核对 |
| `probe-environments.ts` | 三环境解析：档位顺序、不回落 `.env`、空串语义等（不连数据库） |
| `verify-modelverse-live.ts` | **一次性**真实通道验证，需要真实 token；不在常规闸口内 |

#### 3.2.2 需先起服务的 HTTP 验证（`node scripts/<name>.js`）

这三个是 `.js`，用 `node` 直接跑，**前置是后端已启动**；基址走各自的 `VERIFY_BASE`（默认 `http://localhost:4100/api/v1`），开发档 4100 可能被其它进程占用，跑之前务必确认端口对应的是本项目实例。

| 脚本 | 断言什么 |
| --- | --- |
| `verify-asset-filters.js` | 素材列表 `keyword` / `from` / `to` 三个筛选维度（基线来自接口契约，不从实现反推） |
| `verify-prompt-tools.js` | AI 润色 / 图片转提示词 / 手机上传三段真实链路 + 未登录 401 |
| `verify-deps.js` | `node_modules` 版本一致性审计 + `package.json` 内 `npm run <script>` 引用完整性（`npm run verify:deps` / `verify:deps:critical`），不依赖后端 |

### 3.3 HTTP 冒烟（L3）

共 21 个脚本（`backend/scripts/smoke-*.js`），需后端已启动。按域分组：

| 域 | 脚本 | 覆盖要点 |
| --- | --- | --- |
| 身份安全 | `smoke-auth.js` | 注册昵称必填、忘记密码防枚举、重置一次性、改密后旧 token 失效 |
| 扫码登录 | `smoke-qr-login.js` | 扫码≠授权、一次性兑换 `consumed`、过期、未登录 401、登录审计 `reason=qr` |
| 账户与合规 | `smoke-account.js` | `/me` 只认令牌、资料更正白名单、导出、注销后订单保留 |
|  | `smoke-notifications.js` | 消息用户隔离、支付成功真的产生消息、法务版本化；邮件/短信通道状态只读（如实报 `delivers` / 不含凭据 / 普通用户 403） |
|  | `smoke-aigc.js` | PNG chunk CRC / JPEG XMP / 可见角标像素差 / **角标样式可配**（位置、不透明度、自定义位图、越界夹紧、`specKey`）/ **角标可关闭**（像素不变、隐式标识照写、warning）/ 公开配置接口 / 真实生成链路落盘核对 |
|  | `smoke-signed-url.js` | 另起带密钥实例：无签名 403、带签名 200、篡改 403、过期 410、HEAD 200 |
|  | `smoke-rate-limit.js` | 短信 1/分、换号不换配额、伪造 XFF 无效、找回密码 3/时 |
|  | `smoke-health-tracing.js` | 健康分项、请求号回显与替换、异常信封 `requestId`、日志 `[rid=]` 串联 |
| 能力 | `smoke-capability-runtime.js` | model-only runtime（`localQuality=none`、无 local 实现字段）、无线路不预告产出、上下线 40005、限时免费 0 积分 |
| 模型通道 | `smoke-model-channels.js` | 线路 CRUD / token 保持与清除 / 排序 / 测试响应 / 401 |
| 后台 | `smoke-admin.js` | 身份、权限点、审计 |
|  | `smoke-backup.js` | 未验证备份不可下载、保留策略、路径穿越拦截 |
|  | `smoke-scheduler.js` | 定时任务真的改数据（订单超时、积分到期等） |
|  | `smoke-storage.js` | 多存储后端语义、路径穿越、下架不可读 |
|  | `smoke-tickets-search.js` | 工单状态机 / 越权 404 / 全局搜索 / 批量 / CSV 导入导出 |
| 交易 | `smoke-commerce.js` | 余额由批次推导、FEFO、幂等、退款回收积分 |
|  | `smoke-membership.js` | 免费档兜底、并发上限、加油包折扣、月度积分 |
|  | `smoke-membership-order.js` | 会员下单 → 支付 → 激活唯一路径、无订单拒绝、重复激活、退款 |
|  | `smoke-payments.js` | 渠道回调入账、幂等、金额不符、CSV 对账、发票；支付渠道状态只读（三通道齐全、缺失项只给变量名、沙箱无回调地址、普通用户 403）；**退款先打渠道再改本地账**（全额/部分/二次、渠道未配置 503 且零副作用、在途 40908、manual 不调渠道、普通用户 403） |
|  | `smoke-refund-rules.js` | 时间窗 40905 / 比例 40906 / 已消耗积分 40907 / 会员终止 |
| 营销 | `smoke-marketing.js` | 券门槛与折扣区间、活动叠加取更优、邀请、签到、退款不得超实付 |

> 2026-10-25 变更：本地图像生成算法与 `LocalImageProvider` 已删除，依赖它跑像素的旧烟测（`smoke-capabilities` / 各页面变体烟测 / `smoke-gateway-channel`）一并移除。替代覆盖是 `verify-image-pipeline.ts`（无线路、上游失败、遮罩协议、成功来源）、`verify-tool-contracts.ts`（8 个修图工具参数契约）与 Playwright 页面交互/状态用例。无模型通道时统一验证任务失败 `42204` 且退款，不生成伪结果。

需要管理员凭据的脚本（`smoke-admin` / `smoke-commerce` / `smoke-model-channels` / 部分后台脚本）通过 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 提供。**密码不写进仓库、不写进文档**：用 `NODE_ENV=test npm run seed:admin` 在测试档生成，或临时建一次性管理员，跑完清理。

零依赖的**仿真模型网关**在 `test/`：提供 OpenAI 标准协议的文生文 / 文生图 / 文生视频端点与 MiniMax 兼容视频端点，无真实凭据也能跑通「模型配置 → 测试连接 → 生成 → 下载」全链路，并支持 `[[fail]]` / `[[401]]` / `[[429]]` 失败注入。用法见 `test/README.md`；自测 `cd test && npm test`（47 项）、联网冒烟 `npm run smoke:spawn`。

### 3.4 浏览器 E2E（L4）

配置在 `frontend/playwright.admin.config.ts` / `playwright.config.ts` / `playwright.local.config.ts`，用例在 `frontend/tests/`：

| 用例 | 守住什么 |
| --- | --- |
| `admin.spec.ts` | 后台权限链路 + 四页渲染 |
| `admin-assets.spec.ts` | 素材管理 + 存储配置 |
| `admin-backup.spec.ts` | 未通过恢复验证的备份不可下载 |
| `admin-layout.spec.ts` | 后台布局回归（曾出过的问题） |
| `admin-marketing.spec.ts` | 营销中心三条约束 |
| `admin-scheduler.spec.ts` | 定时任务可观测（静默失败可见） |
| `admin-screenshots.spec.ts` | 逐页截图取证 |
| `free-creation-submit.spec.ts` | 登录墙 + 必填置灰的提交契约 |
| `product-capabilities.spec.ts` | 8 个工具入口/能力上下文、局部重绘画布与标注上限、失败重试字段、站点地图可见性 |
| `product-parameters.spec.ts` | 8 个工具页面参数渲染、提交态、结果/失败态与移动端无横向溢出 |
| `state-contract.spec.ts` | 全站 loading / empty / error 状态契约 |
| `example.spec.ts` | Playwright 脚手架示例（不覆盖本项目功能） |

运行：`cd frontend && npm run e2e`（默认 `playwright.admin.config.ts`，`ADMIN_UI` 可覆盖 baseURL）。

`frontend/e2e/` 下只有一个脚手架示例，**不是**本项目用例目录；浏览器侧另有一批一次性人工执行过的验证，没有固化成用例，不计入闸口。

## 4. 覆盖矩阵（功能域 → 闸口）

| 功能域 | L2 | L3 | L4 |
| --- | --- | --- | --- |
| 能力注册表 / 生成链路 | capability-*、image/video-pipeline、credit-* | capabilities、各页面冒烟、capability-runtime | free-creation-submit、state-contract |
| 模型通道 | modality-config、vendor-aggregation、channel-*、failover | gateway-channel、model-channels | — |
| 身份与账户 | — | auth、qr-login、account、rate-limit | admin |
| 交易与权益 | credit-deduction、credit-price、payment-signatures | commerce、membership、membership-order、payments、refund-rules | admin |
| 营销 | — | marketing | admin-marketing |
| 后台与运维 | architecture-layers、admin-tasks | admin、backup、scheduler、storage | admin-* / admin-screenshots |
| 合规与基础设施 | probe-environments | aigc、signed-url、health-tracing、notifications | state-contract |
| 局部重绘遮罩（42205） | — | **暂无自动化闸口**（见下方说明） | — |

**局部重绘遮罩的验证缺口（2026-10-22）**：遮罩路径要求 ① 后台存在 `maskSupport: 'edits'`（openai 协议）的图像线路，② 该线路的模型支持 `images/edits`，③ 遮罩与原图同尺寸。仓库当前没有任何一条线路满足这三条，故本轮**只能验到代码层**：协议矩阵里 `maskSupport` 的声明、路由器「全部通道不支持遮罩 → 42205」的分支、`generate.service` 对 `maskAssetId` 的归属校验与 42205 落码。补闸口时的最小脚本（未实现）应覆盖三条拒绝路径：无遮罩素材权限 → 40001、全部通道 `maskSupport: 'none'` → 42205 且积分退回、支持遮罩时 multipart 请求体含 `image` 与 `mask` 两个文件段。**不写「已通过」**：真实出图必须由配好 openai 线路的环境实跑一次才算证据。

**渠道退款的可验证边界（2026-10-22）**：退款从「改库」改为「真的调渠道」，`smoke-payments.js` 新增的六组断言钉住的是**顺序与失败语义**——全额/部分/二次退款的订单状态与积分处置、渠道未配置时 503 且不留半截退款行、在途退款 40908、`channel='manual'` 不调渠道、普通用户 403。这些都只在**沙箱通道**下成立（脚本在真实通道实例上整体跳过）。支付宝 RSA2 与微信 v3 的退款请求体、验签与 `PROCESSING` 分支**没有离线证据**：`verify-payment-signatures.ts` 覆盖的是支付签名，不是退款接口。真实渠道退款须用商户号实跑一次才算验证；在此之前只能说「代码按官方规格实现，失败语义已覆盖」，不能说「退款已验证」。

## 5. 已知红灯与定性

`verify-credit-deduction.ts` 曾在 2026-10-21 的复跑中有两处失败，均已修复（当日复跑 52 项全过）：

1. 「失败任务同样先扣费 195 → 195（期望 190）」：失败路径在 POST 往返之内（13～37 ms）已完成「扣费 → 失败 → 退款」，客户端拿到响应时余额已回来。链路本身正确，是脚本的**观测竞态**。现改为断言「本用户 consume 流水条数 +1」+「任务 `creditCost` 快照」，两条持久证据交叉验证先扣后退；余额仅作附注输出。
2. teardown 的 `ForeignKeyConstraintViolation`：脚本清理清单缺 `ConsentRecord` / `LoginLog` / `Notification` 三张以 FK 引用 `User` 的表。已补齐删除。

同日一并修正的**脚本漂移**（都属闸口没跟上实现，不是产品缺陷）：

| 脚本 | 症状 | 修法 |
| --- | --- | --- |
| `verify-capability-bootstrap.ts` | 手抄的 `localImpl` 名单漏了 2026-10-21 新增的 `makeRemoveWatermark`，定义改对了却报红 | 名单改为从 `LocalImageProvider.prototype` 派生，不再维护第二份清单 |
| `verify-capability-extraction.ts` | 基线快照仍写 `remove_watermark.localImpl = makePlaceholder` | 基线更新为 `makeRemoveWatermark` |
| `verify-admin-tasks.ts` / `verify-free-create-e2e.ts` | 最小模块装配缺 `ChannelsModule` / `NotificationsModule` / `CommonModule` / `CreditsModule`，Nest 装配即抛 `UnknownDependencies` | 补齐 import；`verify-free-create-e2e` 改装配真实 `GenerateModule`（原先手抄一份，构造器一加依赖就漂） |
| 同上 | 用裸 `ConfigModule.forRoot`，只找 `.env`，`DATABASE_URL` 回落 `dev.db` —— 「测试档」实际读写开发库，还拿 dev 库里的真实厂商线路发了一次请求 | 改用项目自己的 `ConfigModule`（按 `NODE_ENV` 选档） |
| `verify-free-create-e2e.ts` | `Jimp.read(buffer)`（Jimp 1.x 只吃路径）报 "Could not find MIME for Buffer"；异常分支不退出，进程常驻挂死 | 改 `Jimp.fromBuffer()`；catch 里显式 `process.exit(1)` |
| `verify-prompt-tools.js` | 素材地址硬编码开发档端口，在测试档上跑必 404 | 从 `VERIFY_BASE` 推导同源地址 |

同日 L4 复跑（65 → 70 例）另有两处结论：

| 用例 | 症状 | 定性 |
| --- | --- | --- |
| `admin-scheduler.spec.ts` | `toHaveCount(5)` 失败，页面实际 7 行 | **脚本漂移**：`scheduler.service.ts` 的 `TASK_LABELS` 已增至 7 项（campaign-expire / membership / task-recover）。断言改为按该清单逐项校验行数与文案，新增任务时同步 |
| `free-creation-submit.spec.ts` | 未登录点「登录免费生成」不弹登录框，控制台 `useNavigate() may be used only in the context of a <Router> component` | **产品缺陷**：`LoginModal` 由 `AuthProvider` 渲染，而 `AuthProvider` 在 `BrowserRouter` 之外，`AuthCard` 里的 `useNavigate` 渲染即抛错。宿主改为 Router 内的 `LoginModalHost`（App.tsx） |

登录弹窗修好后暴露出第二层问题：页面加载时的只读 GET 401 也会广播 `auth:required`，guest 一进 `/workbench` 就被 `stats/overview` 自动弹出登录墙（`/credits` 同屏三组接口各弹一次）。`lib/api.ts` 已改为**只有写动作（非 GET）才弹框**；`free-creation-submit.spec.ts` 增加 `/workbench`、`/works`、`/credits`、`/invitations` 四条「guest 不被动弹登录」用例守住。此前该契约在数据页上是空过的——弹窗根本不存在，`toBeHidden` 恒真。

**2026-10-25 工具页闸口补强**：上传前后端统一限制 PNG/JPEG/WebP、单张 10MB，并校验文件头/尺寸/像素/遮罩透明区域；生成请求带 `Idempotency-Key`，扣费与建任务在同一事务内，失败退款按 `refund:task:<id>` 稳定幂等键只记一次。存量库升级用 `npm run db:migrate:tool-idempotency`（nullable 字段 + `IF NOT EXISTS` 索引，可重复、不允许 `--accept-data-loss`），全新建库仍由 `prisma:push` 负责。

**教训**：测试脚本连库靠「有没有走项目自己的 ConfigModule」，不靠 `NODE_ENV` 环境变量本身；最小模块装配则必须跟着真实模块的构造器依赖一起长，否则红灯指向的是脚本而不是产品。**「断言恒真」比红灯更危险**：一个永远不渲染的弹窗能让 `toBeHidden` 一直通过，修好渲染后才看见真正的回归。

## 6. 测试数据与清理

- 冒烟脚本自建账号 / 商品 / 订单，并在 `finally` 或结尾清理；失败中断时可能留残留，需手工按外键顺序清理。
- 清理顺序（SQLite 无级联）：`Refund → Invoice → Payment → OrderItem → Membership → Order → CreditLedger → CreditLot → MembershipUsage → Notification → Ticket → LoginSession → LoginLog(置空 userId) → User → Product → MembershipPlan`。
- 不得删除非本次测试产生的数据；发现历史残留时先确认归属。
- 测试档账号与开发档账号是两套数据，**不要跨库复用凭据**。

## 7. 维护约定

1. 新增功能必须同时补一条冒烟（或说明为什么只能人工验证），并在提交说明里登记真实运行结果。
2. 新增权限点、错误码、状态机边时，测试要覆盖「拒绝路径」，不只覆盖成功路径。
3. 冒烟脚本只追加断言，不删除既有断言；确需废弃时写明原因。
4. 任何「预期通过」都不算验证：交付时只写真实运行输出里的通过 / 失败数。
