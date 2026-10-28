# 测试文档

本文是测试策略、闸口清单、用例覆盖与已知缺口的唯一说明文件。所有条目都对应仓库里真实存在的脚本或配置；断言数量随脚本演进，以实际运行输出为准。单次运行结果（通过 / 失败数）随提交说明记录，不进本文。

## 1. 测试分层

| 层 | 目的 | 载体 | 需要起服务 |
| --- | --- | --- | --- |
| L1 编译与类型 | 代码能否构建、类型是否自洽 | `backend npm run build`、`frontend npx tsc --noEmit`、`npm run build:prod` | 否 |
| L1.5 前端单元 / 组件 | 纯逻辑、hooks、状态组件的分支与状态语义 | `frontend npm test`（Vitest + jsdom + Testing Library） | 否 |
| L2 架构与纯逻辑断言 | 分层依赖、能力注册表、签名串、环境解析等类型检查发现不了的问题 | `backend/scripts/verify-*`、`probe-environments.ts` | 多数否 |
| L3 HTTP 冒烟 | 接口契约、权限、资金与积分规则、失败与退款语义 | `backend/scripts/smoke-*.js` | 是 |
| L4 浏览器 E2E | 页面渲染、权限链路、提交契约、状态契约 | `frontend/tests/*.spec.ts`（Playwright） | 是（前端 + 后端） |

原则：**先跑红再最小修订**。闸口脚本的断言视为规格，不得为了让测试变绿而修改断言；断言与实现冲突时先定性（脚本错 / 实现错），再改对应一侧，并在交付说明里写清结论。

## 2. 环境与数据隔离

- 测试一律连测试档：`NODE_ENV=test` → `backend/test.db`、`uploads-test/`、`backups-test/`、`logs/test/`。
- 端口与开发档相同（后端 4100 / 前端 5100），两档不能同时跑：起测试档会停掉开发档。
- 冒烟与 seed 脚本按当前 `NODE_ENV` 选库（`backend/scripts/db-url.js`），默认是开发库。跑测试必须显式 `NODE_ENV=test`，否则会写脏 `dev.db`。
- 重建测试环境：`NODE_ENV=test npm run db:reset:test`（删库 + 重建 + 重灌种子，带安全门禁）。
- 启动测试后端：`./start.sh --env test`（端口固定 4100，占用即停）；手工启动用 `NODE_ENV=test node dist/main.js`，不要用 `nest start`。
- 脚本基址：多数支持 `API_BASE`；`smoke-marketing.js` 用 `MARKETING_API_BASE`（含 `/api/v1`）；`smoke-model-channels.js` 用 `SMOKE_BASE`；L2 的 `.js` 验证脚本用 `VERIFY_BASE`。
- SQLite 单写者：脚本直连库时后端同时写库会撞 `database is locked`（P2039），脚本内已做退避重试。

开跑前确认库路径，避免「以为在测、实际连着开发库」：

```bash
cd backend
node -e "console.log(require('./scripts/db-url').resolveDbPath())"
```

## 3. 自动化闸口

### 3.1 构建与类型（L1）

```bash
cd backend && npm run build
cd frontend && npx tsc --noEmit
cd frontend && npm run build:prod
```

### 3.2 前端单元 / 组件（L1.5）

配置在 `frontend/vitest.config.ts`，用例在 `frontend/src/**/__tests__/*.test.{ts,tsx}`，jsdom 环境，不需要起服务、不读 `.env.{mode}`。

```bash
cd frontend
npm test                # 单次，交付前用这个
npm run test:watch      # watch
npm run test:coverage   # v8 覆盖率，产物在 frontend/coverage（已 gitignore）
```

当前 13 个用例文件：

| 用例 | 守住什么 |
| --- | --- |
| `components/ColorSwatchGrid.test.tsx` | 色板选择、自定义色回显、禁用态 |
| `components/ImageLightbox.test.tsx` | 大图查看器开合、缩放/翻页键盘语义 |
| `components/ProviderBadge.test.tsx` | 能力/产出来源徽标文案与状态映射 |
| `components/StateViews.test.tsx` | 加载 / 空 / 失败 / 骨架四态渲染 |
| `hooks/useCreditLabel.test.tsx` | 积分文案与生效价、限时免费的展示 |
| `lib/aigc-label.test.ts` | 角标参数缓存、失败回退默认值、色值还原 |
| `lib/expandGeometry.test.ts` | 扩图占比与原图位置几何换算 |
| `lib/multiFusionBilling.test.ts` | 多图融合变体数 × 积分计费 |
| `lib/optionSets.test.ts` | 平台/语言/比例等选项集合的默认值与排序 |
| `lib/poll.test.ts` | 轮询重试、超时、视频上限放宽、中止语义 |
| `lib/skuBatches.test.ts` | SKU 行批量展开与坐标映射 |
| `lib/unsaved-guard.test.ts` | 离开页面时的未保存拦截 |
| `lib/zip.test.ts` | 浏览器内批量下载打包 |

边界：Vitest 只跑 jsdom，不替代 L3/L4。真实后端、真实浏览器、真实库与磁盘的记录仍以 `smoke-*` / `verify-*` / Playwright 为准。Playwright 只收集 `tests/*.spec.ts`，Vitest 只收集 `src/**/*.test.*`，两边互不重叠。

### 3.3 架构与纯逻辑断言（L2）

`backend/scripts/` 下共 24 个验证脚本：20 个 `verify-*.ts` + 1 个 `probe-environments.ts`，以及 3 个需要后端已启动的 `verify-*.js`。

#### 3.3.1 纯逻辑 / 自起服务

| 脚本 | 断言什么 |
| --- | --- |
| `verify-architecture-layers.ts` | 分层依赖方向：应用层 → unified → vendors → protocols → modality，反向依赖即失败 |
| `verify-capability-bootstrap.ts` | 能力定义能真实加载并通过 `assertCapabilityIntegrity` |
| `verify-capability-extensibility.ts` | 新增能力只需改一处（registry 扩展性） |
| `verify-capability-extraction.ts` | 能力定义拆分前后的逐字段等价性 |
| `verify-credit-deduction.ts` | 生成扣费 / 失败退款 / 余额一致性（同进程起 Nest 打真实 HTTP） |
| `verify-credit-price.ts` | 后台改价 → `/capabilities` 与生成扣费同步生效 |
| `verify-modality-config.ts` | 三模态配置解析与存量键回落方向 |
| `verify-vendor-aggregation.ts` | 厂商目录 → 模态视图的派生等价性 |
| `verify-channel-scheduler.ts` | 多渠道调度：优先级、冷却、失败切换、基址归一化 |
| `verify-channel-test.ts` | 连通性测试路径按模态构造 |
| `verify-failover.ts` | 故障转移时真的换上备用通道的 baseUrl / token / model |
| `verify-model-config-fixes.ts` | model-only 语义：无线路为 `none`、存量 `route=local` 不可用、新写入 local 被拒 |
| `verify-image-pipeline.ts` | 图像链路：无线路 `42204`、存量 local 失败、遮罩无 edits 线路 `42205`、线路失败 `42201`、成功来源只能是 `gateway` |
| `verify-tool-contracts.ts` | 8 个修图工具的能力定义、默认值、hidden 字段兼容、严格参数校验、标注解析、上传头与遮罩尺寸校验 |
| `verify-video-pipeline.ts` | 视频四段式异步契约 |
| `verify-payment-signatures.ts` | 支付宝 RSA2 / 微信 v3 AES-GCM 按公开规范独立复算，防「自己签自己验」 |
| `verify-channel-signatures.ts` | 阿里云短信 / 邮件 RPC 签名（HMAC-SHA1 + sorted canonical query）独立复算；只验签名与请求形状，不代表已真实投递 |
| `verify-admin-tasks.ts` | 后台任务监控（同进程起服务） |
| `verify-free-create-e2e.ts` | 自由创作真实 HTTP → 落库字段核对 |
| `verify-modelverse-live.ts` | 一次性真实通道验证，需要真实 token；不在常规闸口内 |
| `probe-environments.ts` | 三环境解析：档位顺序、不回落 `.env`、空串语义等（不连数据库） |

#### 3.3.2 需先起服务的 HTTP 验证

这三个是 `.js`，用 `node` 直接跑，前置是后端已启动；基址走 `VERIFY_BASE`（默认 `http://localhost:4100/api/v1`）。

| 脚本 | 断言什么 |
| --- | --- |
| `verify-asset-filters.js` | 素材列表 `keyword` / `from` / `to` 三个筛选维度 |
| `verify-prompt-tools.js` | AI 润色 / 图片转提示词 / 手机上传三段真实链路 + 未登录 401 |
| `verify-deps.js` | `node_modules` 版本一致性审计 + `package.json` 内 `npm run <script>` 引用完整性 |

### 3.4 HTTP 冒烟（L3）

共 21 个脚本（`backend/scripts/smoke-*.js`），需后端已启动。按域分组：

| 域 | 脚本 | 覆盖要点 |
| --- | --- | --- |
| 身份安全 | `smoke-auth.js` | 注册昵称必填、忘记密码防枚举、重置一次性、改密后旧 token 失效 |
| 扫码登录 | `smoke-qr-login.js` | 扫码≠授权、一次性兑换 `consumed`、过期、未登录 401、登录审计 `reason=qr` |
| 账户与合规 | `smoke-account.js` | `/me` 只认令牌、资料更正白名单、导出、注销后订单保留 |
| | `smoke-notifications.js` | 消息用户隔离、支付成功产生消息、法务版本化；邮件/短信通道状态只读 |
| | `smoke-aigc.js` | PNG chunk CRC / JPEG XMP / 可见角标像素差 / 角标样式可配 / 角标可关闭 / 公开配置接口 / 真实生成链路落盘核对 |
| | `smoke-signed-url.js` | 另起带密钥实例：无签名 403、带签名 200、篡改 403、过期 410、HEAD 200 |
| | `smoke-rate-limit.js` | 短信 1/分、换号不换配额、伪造 XFF 无效、找回密码 3/时 |
| | `smoke-health-tracing.js` | 健康分项、请求号回显与替换、异常信封 `requestId`、日志 `[rid=]` 串联 |
| 能力 | `smoke-capability-runtime.js` | model-only runtime、无线路不预告产出、上下线 `40005`、限时免费 0 积分 |
| 模型通道 | `smoke-model-channels.js` | 线路 CRUD / token 保持与清除 / 排序 / 测试响应 / 401 |
| 后台 | `smoke-admin.js` | 身份、权限点、审计 |
| | `smoke-backup.js` | 未验证备份不可下载、保留策略、路径穿越拦截 |
| | `smoke-scheduler.js` | 定时任务真的改数据（订单超时、积分到期等） |
| | `smoke-storage.js` | 多存储后端语义、路径穿越、下架不可读 |
| | `smoke-tickets-search.js` | 工单状态机 / 越权 404 / 全局搜索 / 批量 / CSV 导入导出 |
| 交易 | `smoke-commerce.js` | 余额由批次推导、FEFO、幂等、退款回收积分 |
| | `smoke-membership.js` | 免费档兜底、并发上限、加油包折扣、月度积分 |
| | `smoke-membership-order.js` | 会员下单 → 支付 → 激活唯一路径、无订单拒绝、重复激活、退款 |
| | `smoke-payments.js` | 渠道回调入账、幂等、金额不符、CSV 对账、发票；支付渠道状态只读；退款先打渠道再改本地账（全额/部分/二次、渠道未配置 503 零副作用、在途 40908、manual 不调渠道） |
| | `smoke-refund-rules.js` | 时间窗 `40905` / 比例 `40906` / 已消耗积分 `40907` / 会员终止 |
| 营销 | `smoke-marketing.js` | 券门槛与折扣区间、活动叠加取更优、邀请、签到、退款不得超实付 |

需要管理员凭据的脚本通过 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 提供。密码不写进仓库、不写进文档：用 `NODE_ENV=test npm run seed:admin` 在测试档生成，或临时建一次性管理员，跑完清理。

#### 仿真模型网关

零依赖的仿真模型网关在 `test/`：提供 OpenAI 标准协议的文生文 / 文生图 / 文生视频端点与 MiniMax 兼容视频端点，无真实凭据也能跑通「模型配置 → 测试连接 → 生成 → 下载」全链路，并支持 `[[fail]]` / `[[401]]` / `[[429]]` 失败注入。

```bash
cd test && node server.js       # http://127.0.0.1:3900
cd test && npm test             # 网关自测
cd test && npm run smoke:spawn  # 起网关跑联网冒烟
```

后台「模型配置」把线路指到 `http://127.0.0.1:3900`，基址只填根域，不要带 `/v1`。`smoke-aigc` 与 `verify-free-create-e2e` 需要可用的 image 线路；没有通道时它们会如实报 `42204` / 轮询超时，不能当产品缺陷。

### 3.5 浏览器 E2E（L4）

配置在 `frontend/playwright.admin.config.ts` / `playwright.config.ts` / `playwright.local.config.ts`，用例在 `frontend/tests/`，共 14 个 spec：

| 用例 | 守住什么 |
| --- | --- |
| `admin.spec.ts` | 后台权限链路 + 四页渲染 |
| `admin-assets.spec.ts` | 素材管理 + 存储配置 |
| `admin-backup.spec.ts` | 未通过恢复验证的备份不可下载 |
| `admin-layout.spec.ts` | 后台布局回归 |
| `admin-marketing.spec.ts` | 营销中心三条约束 |
| `admin-scheduler.spec.ts` | 定时任务可观测（静默失败可见） |
| `admin-screenshots.spec.ts` | 后台逐页截图取证 |
| `free-creation-submit.spec.ts` | 登录墙 + 必填置灰的提交契约 + guest 不被只读接口弹登录 |
| `product-capabilities.spec.ts` | 8 个工具入口/能力上下文、局部重绘画布与标注上限、失败重试字段、站点地图可见性 |
| `product-parameters.spec.ts` | 8 个工具页面参数渲染、提交态、结果/失败态与移动端无横向溢出 |
| `sidebar.spec.ts` | 侧栏顺序、几何、1366/1367 断点、折叠、工单预填、移动抽屉 |
| `state-contract.spec.ts` | 全站 loading / empty / error 状态契约 |
| `workspace-pages.spec.ts` | 工作台 12 卡顺序、guest 不请求统计、素材库双路径、390 无溢出 |
| `example.spec.ts` | Playwright 脚手架示例（不覆盖本项目功能） |

运行：`cd frontend && npm run e2e`（默认 `playwright.admin.config.ts`，`ADMIN_UI` 可覆盖 baseURL）。

`frontend/e2e/` 下只有脚手架示例与一次性审计脚本，不是本项目用例目录。

### 3.6 依赖一致性

```bash
cd backend
npm run verify:deps:critical   # 日常：只查运行时关键链
npm run verify:deps            # 全量 + 列出已记录无害项
node scripts/verify-deps.js --quiet   # 仅结论，有致命问题 exit 1
```

## 4. 覆盖矩阵

| 功能域 | L2 | L3 | L4 |
| --- | --- | --- | --- |
| 能力注册表 / 生成链路 | capability-*、image/video-pipeline、credit-*、tool-contracts | capability-runtime | product-capabilities、product-parameters、state-contract |
| 模型通道 | modality-config、vendor-aggregation、channel-*、failover、model-config-fixes | model-channels | — |
| 身份与账户 | — | auth、qr-login、account、rate-limit | admin、free-creation-submit |
| 第三方登录（OAuth） | — | 暂无自动化闸口（见 5.3） | — |
| 交易与权益 | credit-deduction、credit-price、payment-signatures | commerce、membership、membership-order、payments、refund-rules | admin、admin-marketing |
| 营销 | — | marketing | admin-marketing |
| 后台与运维 | architecture-layers、admin-tasks | admin、backup、scheduler、storage、tickets-search | admin-*、admin-screenshots、sidebar |
| 合规与基础设施 | probe-environments、channel-signatures | aigc、signed-url、health-tracing、notifications | state-contract |
| 工作台 / 素材库 | — | — | workspace-pages、sidebar |
| 局部重绘遮罩（`42205`） | tool-contracts、image-pipeline | 暂无自动化闸口（见 5.1） | — |

L1.5 不按功能域铺矩阵，覆盖清单见 3.2。新增纯逻辑、共享 hook 或状态组件时优先补 Vitest；需要后端或浏览器的场景归 L3/L4。

## 5. 已知缺口与验证边界

### 5.1 局部重绘遮罩

遮罩路径要求：① 后台存在 `maskSupport: 'edits'`（openai 协议）的图像线路；② 该线路模型支持 `images/edits`；③ 遮罩与原图同尺寸。当前仓库没有满足条件的内置线路，因此只能验到代码层：

- 协议矩阵里 `maskSupport` 的声明；
- 路由器「全部通道不支持遮罩 → `42205`」的分支；
- `generate.service` 对 `maskAssetId` 的归属校验与 `42205` 落码。

补闸口时应覆盖三条拒绝路径：无遮罩素材权限 → `40001`、全部通道 `maskSupport: 'none'` → `42205` 且积分退回、支持遮罩时 multipart 请求体含 `image` 与 `mask` 两个文件段。真实出图必须由配好 openai edits 线路的环境实跑一次才算证据。

### 5.2 渠道退款

退款从「改库」改为「真的调渠道」，`smoke-payments.js` 钉住的是顺序与失败语义：全额/部分/二次退款的订单状态与积分处置、渠道未配置时 `503` 且不留半截退款行、在途退款 `40908`、`channel='manual'` 不调渠道、普通用户 `403`。这些只在沙箱通道下成立。

支付宝 RSA2 与微信 v3 的退款请求体、验签与 `PROCESSING` 分支没有离线证据：`verify-payment-signatures.ts` 覆盖的是支付签名，不是退款接口。真实渠道退款须用商户号实跑一次；在此之前只能说「代码按官方规格实现，失败语义已覆盖」。

### 5.3 需要外部条件的脚本

| 脚本 / 用例 | 外部条件 |
| --- | --- |
| `verify-modelverse-live.ts` | 真实厂商 token；一次性验证，不在常规闸口 |
| `smoke-aigc.js` / `verify-free-create-e2e.ts` | 可用的 image 线路（可用 `test/` 仿真网关） |
| 真实支付宝 / 微信回调与退款 | 商户号与可公网访问的回调地址 |
| 第三方登录（OAuth2 / OIDC） | 真实 provider 的 `clientId` / `clientSecret` 与可公网访问的回调地址；离线只能验「未配置时 `/auth/oauth/providers` 返回空、登录页不渲染按钮」 |

### 5.4 断言假阳性防范

- 断言恒真比红灯更危险：不渲染的弹窗会让 `toBeHidden` 永远通过。E2E 必须先断言元素存在/数量 > 0，再扫溢出与状态。
- 脚本连库取决于是否使用项目自己的 `ConfigModule`，不取决于 `NODE_ENV` 环境变量本身；最小模块装配要跟随真实构造器依赖。
- 溢出扫描要等真实内容就绪（`waitForSelector` + 断言元素数），`networkidle` 不等于内容渲染完成。

## 6. 测试数据与清理

- 冒烟脚本自建账号 / 商品 / 订单，并在 `finally` 或结尾清理；失败中断时可能留残留，需手工按外键顺序清理。
- 清理顺序（SQLite 无级联）：`GenerationTask → Asset → Project → Refund → Invoice → Payment → OrderItem → Membership → Order → CreditLedger → CreditLot → MembershipUsage → CheckinRecord → InviteRelation → Notification → Ticket → OAuthIdentity → AccountToken → LoginSession → LoginLog(置空 userId) → ConsentRecord → User → Product → MembershipPlan`。
- 不得删除非本次测试产生的数据；发现历史残留时先确认归属。
- 测试档账号与开发档账号是两套数据，不要跨库复用凭据。

## 7. 维护约定

1. 新增功能必须同时补一条冒烟（或说明为什么只能人工验证），并在提交说明里登记真实运行结果。
2. 新增权限点、错误码、状态机边时，测试要覆盖拒绝路径，不只覆盖成功路径。
3. 冒烟脚本只追加断言，不删除既有断言；确需废弃时写明原因。
4. 任何「预期通过」都不算验证：交付时只写真实运行输出里的通过 / 失败数。
5. 纯逻辑（几何 / 解析 / 状态机）与共享 hooks、状态组件优先补 Vitest；断言用行为与返回值，不用快照比对样式。新增用例后须同时跑 `npm run typecheck` 与 `npm test`。
6. 本文不记录逐轮修复过程；已知缺口按第 5 节维护，修复后移除对应条目。
