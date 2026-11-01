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
- 脚本基址：多数支持 `API_BASE`；`smoke-marketing.js` 用 `MARKETING_API_BASE`（含 `/api/v1`）；L2 的 `.js` 验证脚本用 `VERIFY_BASE`。
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

当前 19 个用例文件：

| 用例 | 守住什么 |
| --- | --- |
| `admin-ui/primitives/DataTable.density.test.tsx` | 表格密度：`DensityContext` 生效、显式 `density` prop 优先 |
| `components/ColorSwatchGrid.test.tsx` | 色板选择、自定义色回显、禁用态 |
| `components/ImageLightbox.test.tsx` | 大图查看器开合、缩放/翻页键盘语义 |
| `components/ProviderBadge.test.tsx` | 能力/产出来源徽标文案与状态映射 |
| `components/StateViews.test.tsx` | 加载 / 空 / 失败 / 骨架四态渲染 |
| `components/admin/AdminWidgets.test.tsx` | 列表筛选 → 地址栏同步：写回、重置清旧值、保留非筛选参数 |
| `hooks/useCreditLabel.test.tsx` | 积分文案与生效价、限时免费的展示 |
| `lib/admin-links.test.ts` | 跨模块深链的参数编码（邮箱、任务 id 等） |
| `lib/aigc-label.test.ts` | 角标参数缓存、失败回退默认值、色值还原 |
| `lib/channelReprice.test.ts` | 统一调价的金额换算：售价字段按计费方式取子集、加价率校验、成本加价的 half-up 取整（含 0.0002 积分量级）、售价文本互逆、缺成本价/售价未配置的模型被拦截 |
| `lib/expandGeometry.test.ts` | 扩图占比与原图位置几何换算 |
| `lib/multiFusionBilling.test.ts` | 多图融合变体数 × 积分计费 |
| `lib/optionSets.test.ts` | 平台/语言/比例等选项集合的默认值与排序 |
| `lib/poll.test.ts` | 轮询重试、超时、视频上限放宽、中止语义 |
| `lib/routePreload.test.ts` | 路由预加载：精确路由只预热一次、通配路由匹配 |
| `lib/skuBatches.test.ts` | SKU 行批量展开与坐标映射 |
| `lib/unsaved-guard.test.ts` | 离开页面时的未保存拦截 |
| `lib/zip.test.ts` | 浏览器内批量下载打包 |
| `pages/admin/admin-modules.test.ts` | 后台目录具名导入 / 导出对账：相对导入的每个名字都必须在目标模块导出（防 `/admin` 整块白屏） |
| `pages/admin/channels/ChannelModelHealthPanel.test.tsx` | 线路健康面板：成功率语义分档、**无终态样本时显示「无样本」而不是 0%**（「没数据」≠「全失败」）、样本被截断时提示「按最近部分统计」、停用 / 协议未注册 / 冷却三个状态标记、最近样本错误码、空态 |

边界：Vitest 只跑 jsdom，不替代 L3/L4。真实后端、真实浏览器、真实库与磁盘的记录仍以 `smoke-*` / `verify-*` / Playwright 为准。Playwright 只收集 `tests/*.spec.ts`，Vitest 只收集 `src/**/*.test.*`，两边互不重叠。

### 3.3 架构与纯逻辑断言（L2）

`backend/scripts/` 下共 18 个验证脚本：14 个 `verify-*.ts` + 1 个 `probe-environments.ts`，以及 3 个需要后端已启动的 `verify-*.js`。

#### 3.3.1 纯逻辑 / 自起服务

| 脚本 | 断言什么 |
| --- | --- |
| `verify-capability-bootstrap.ts` | 能力定义能真实加载并通过 `assertCapabilityIntegrity`，且没有能力再声明本地图像实现 |
| `verify-credit-deduction.ts` | 生成扣费 / 失败退款 / 余额一致性（同进程起 Nest 打真实 HTTP）：建任务即预留并落账单、余额不足不产生任务 |
| `verify-credit-price.ts` | 后台改价 → `/capabilities` 与生成扣费同步生效 |
| `verify-tool-contracts.ts` | 8 个修图工具的能力定义、默认值、hidden 字段、严格参数校验、标注解析、上传头与遮罩尺寸校验 |
| `verify-payment-signatures.ts` | 支付宝 RSA2 / 微信 v3 AES-GCM 按公开规范独立复算，防「自己签自己验」 |
| `verify-channel-signatures.ts` | 阿里云短信 / 邮件 RPC 签名（HMAC-SHA1 + sorted canonical query）独立复算；只验签名与请求形状，不代表已真实投递 |
| `verify-plugin-manifests.ts` | 内置插件清单解析（`plugins/` 107 个可用包 / 115 个 provider；`src-*` 源目录镜像跳过）：id 唯一、能力与后端类型分布 |
| `verify-model-consistency.ts` | 渠道/模型数据层不变量：activeKey 软删除唯一键、selectorKey 规范 JSON、档位不越能力合同、模型摘要与档位汇总一致、`modelsJson` 与启用模型一致 |
| `verify-channel-flow.ts` | 渠道全链路（同进程起 Nest 打真实 HTTP）：建渠道 → 建模型含两档价格 → 上游键改名级联 → 复制 → 导出断言无凭证 → 改名导入 → **批量调价（缺少变更原因拒绝 / `priceVersion` 过期整批拒绝 / 售价字段与计费方式不匹配拒绝 / 规格提交不完整拒绝，且四次拒绝后售价未被改动；成功调价后档位售价生效、模型与档位 `priceVersion` 各 +1、成本价不变）** → 批量删除 → 删渠道 → **公开渠道连接信息脱敏（匿名视角渠道名 / 归属账号 / provider id / 并发配额 / 凭证标记全不下发、地址改写为中转入口、凭证恒为 `system`；管理员视角给出真实名称与上游地址但仍不回显凭证）** → **线路健康指标（按渠道模型出表、带两个观测窗口、无样本时成功率为 `null`、支持按 `channelId` 过滤）** |
| `verify-protocol-runtime.ts` | 协议运行时：115 个已注册 provider 的 `buildCreate` 冒烟、成功 / 异步 / 失败三类响应归一化；本地假上游走真实接口跑通 `POST /admin/channels/:id/models/test`（image 同步 + video 轮询）与 `POST /admin/channels/:id/models/{fetch,import}`，校验 `ApiCallLog`（`billable=false` / 无明文凭证）、导入默认停用未定价、重复导入不新增、审计动作落库；假上游只在回环地址，脚本内临时打开 `MODEL_ALLOW_PRIVATE_UPSTREAMS` |
| `verify-billing.ts` | 计费账本：预留（含幂等）、固定价结算、Token 差额退回 / 超预授权补扣 / 授权上限截断、按秒计费按实际时长重算、失败全额退款（幂等）、已结算拒绝自动退款、`uncertain` 保留冻结后人工核对、余额不足 `40002`；每一步后校验 `CreditAccount.available == Σ CreditLot.remaining` |
| `verify-route-catalog.ts` | 前台模型与选路：priority 硬分层与下沉、同层加权分布、SKU 选择（精确 / 通配 / 1.5K 相邻 / 停用档）、冷却三键与不冷却码、`simulate` 与 `resolve` 选中同一条线路与价格档、目录投影的渠道可见性与「先换货币再乘倍率」；后半段同进程起 Nest 打真实 HTTP 校验 `/models`、`/models/available`、`/models/:id/quote` 与后台模拟接口的接线与守卫。`VERIFY_HTTP=0` 可只跑纯逻辑 |
| `verify-task-runtime.ts` | 任务运行时端到端：起本机 HTTP mock 上游，经真实 `ProtocolExecutor` / 出站层跑四条路径——同步成功（产物落盘、格式按字节嗅探、AIGC 标识、`settled`、按目录价扣费）、上游 401 切线（`rejected_no_job` + `upstream_401`、旧账单退回、新账单按新线路价结算、`task.creditCost` 同步）、轮询超时（`42206` / `uncertain`、**不切线**、备份线路零调用）、唯一线路 429（`42204`、全额退款、余额回正），末尾校验「可用余额 == Σ 批次剩余」；夹具全部自建并按外键序清理（含产物文件） |
| `verify-proxy-runtime.ts` | 中转与运营（P6）：**A 段纯逻辑**（`validateCustomRelayUrl` 的 SSRF 判定 / `resolveOutboundHost` 的 IPv6 与 localhost 拦截 / 路径白名单与密钥查询参数 / 并发槽 / 插件包解析拒绝分支）、**B 段同进程起 Nest + 本机 mock 上游**（`GET /models` 不计费、密钥查询参数剥离、渠道自定义头、服务端凭证注入；`POST` 的 `reserved → settled` 与调用记录；SSE 透传；500 退款；524 `uncertain` 不退款；渠道并发槽 `429`；自定义中转成功 / JSON 与 SSE 脱敏 / 不计费、401 `40101`、SSRF `40301`、上游错误原样透传、用户并发槽 `429`；系统中转限流 `42901`；分组可见性 `40301` 且不建账单；清扫 `reserved → refunded` / `running → uncertain` 且不碰任务账单；钱包恒等式；财务口径与 `BillingOrder` 聚合逐项一致；插件安装 / 重复 `40909` / 被引用拒卸 `40909` / 内置 `40001` / 卸载成功）。`VERIFY_HTTP=0` 只跑 A 段 |
| `probe-environments.ts` | 三环境解析：档位顺序、不回落 `.env`、空串语义等（不连数据库） |

#### 3.3.2 需先起服务的 HTTP 验证

这三个是 `.js`，用 `node` 直接跑，前置是后端已启动；基址走 `VERIFY_BASE`（默认 `http://localhost:4100/api/v1`）。

| 脚本 | 断言什么 |
| --- | --- |
| `verify-asset-filters.js` | 素材列表 `keyword` / `from` / `to` 三个筛选维度 |
| `verify-prompt-tools.js` | AI 润色 / 图片转提示词 / 手机上传三段真实链路 + 未登录 401 |
| `verify-deps.js` | `node_modules` 版本一致性审计 + `package.json` 内 `npm run <script>` 引用完整性 |

### 3.4 HTTP 冒烟（L3）

共 20 个脚本（`backend/scripts/smoke-*.js`），需后端已启动。按域分组：

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
| 能力 | `smoke-capability-runtime.js` | `runtime` 只有 `enabled / remoteAvailable / effective / reason`（不残留 `route` / `localQuality`）、无线路不预告产出、上下线 `40005`、限时免费 0 积分 |
| 后台 | `smoke-admin.js` | 身份、权限点、审计、告警结构、退款状态筛选、五类只读列表 CSV 导出（类型 / BOM / 匿名拒绝 / `data.export` 审计留痕；调用记录走 `/admin/api-logs/export`） |
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

development / test 的管理员凭据统一为 `admin@admin.com / 123456789`，后台 E2E 与冒烟脚本默认直接使用。需要覆盖时传 `ADMIN_EMAIL` / `ADMIN_PASSWORD`；production 不提供默认密码，必须使用显式环境变量或 `seed:admin` 生成的一次性密码。

#### 仿真模型网关

零依赖的仿真模型网关在 `test/`：提供 OpenAI 标准协议的文生文 / 文生图 / 文生视频端点与 MiniMax 兼容视频端点，无真实凭据也能跑通「渠道工作台 → 连通性测试 → 生成 → 下载」全链路，并支持 `[[fail]]` / `[[401]]` / `[[429]]` 失败注入。

```bash
cd test && node server.js       # http://127.0.0.1:3900
cd test && npm test             # 网关自测
cd test && npm run smoke:spawn  # 起网关跑联网冒烟
```

后台「渠道工作台」新建渠道并把基址指到 `http://127.0.0.1:3900`（只填根域，不要带 `/v1`），协议按能力选 `openai-image` / `chat-completion` / `minimax-video`，再到「前台模型」挂一条线路。`smoke-aigc` 需要可用的 image 线路；没有线路时它会如实报 `42204`，不能当产品缺陷。

### 3.5 浏览器 E2E（L4）

配置在 `frontend/playwright.admin.config.ts` / `playwright.config.ts` / `playwright.local.config.ts`，用例在 `frontend/tests/`，共 16 个 spec：

| 用例 | 守住什么 |
| --- | --- |
| `admin.spec.ts` | 后台权限链路 + 四页渲染 |
| `admin-assets.spec.ts` | 素材管理 + 存储配置 |
| `admin-backup.spec.ts` | 未通过恢复验证的备份不可下载 |
| `admin-layout.spec.ts` | 后台布局回归 |
| `admin-marketing.spec.ts` | 营销中心三条约束 |
| `admin-model-suite.spec.ts` | 渠道 / 模型 P5 五页与 C 端选型：渠道工作台列表与模型抽屉、**统一调价（勾选模型 → 按成本重算 → 填变更原因 → 保存 → 回读断言新售价 = 成本 × 1.1）**、前台模型的路由模拟、用户分组与插件页渲染、生成账单与调用记录的筛选和详情、工具页 `ModelPicker` 选型后报价随之变化；生成段需要可用 image 线路，无线路时该段跳过 |
| `admin-scheduler.spec.ts` | 定时任务可观测（静默失败可见） |
| `admin-screenshots.spec.ts` | 后台逐页截图取证 |
| `admin-ux.spec.ts` | 筛选深链与逐条清除（含工单/商品/对账/能力/告警）、订单/任务/模型线路宽表在 1440px 无横向滚动、页面/编辑抽屉/工单回复/积分调整的未保存保护、角色权限未保存拦截、概览任务直达、任务详情到积分账本及项目筛选的跨模块深链、详情 `?id=` 刷新恢复与关闭移除 |
| `free-creation-submit.spec.ts` | 登录墙 + 必填置灰的提交契约 + guest 不被只读接口弹登录 |
| `product-capabilities.spec.ts` | 8 个工具入口/能力上下文、局部重绘画布与标注上限、失败重试字段、站点地图可见性 |
| `product-parameters.spec.ts` | 8 个工具页面参数渲染、提交态、结果/失败态与移动端无横向溢出 |
| `sidebar.spec.ts` | 侧栏顺序、几何、1366/1367 断点、折叠、工单预填、移动抽屉 |
| `state-contract.spec.ts` | 全站 loading / empty / error 状态契约 |
| `workspace-pages.spec.ts` | 工作台 12 卡顺序、guest 不请求统计、素材库双路径、390 无溢出 |
| `example.spec.ts` | Playwright 脚手架示例（不覆盖本项目功能） |

运行：`cd frontend && npm run e2e`（默认 `playwright.admin.config.ts`，`ADMIN_UI` 可覆盖 baseURL）。后台套件先用 `admin-auth.setup.ts` 登录一次并落盘 `playwright/.auth/admin.json`，其余用例复用 `storageState`；这样不会因每条用例重复登录而撞上认证限流。需要验证访客或普通用户的用例会主动清空会话。

后台用例的选择器契约（2026-10-30 换 BoardUI 后）：共享控件与页面关键节点挂 `data-testid="admin-*"` —— `admin-filter` / `admin-filter-actions` / `admin-filter-chips` / `admin-filter-chip` / `admin-table` / `admin-table-scroll` / `admin-table-row` / `admin-table-expanded` / `admin-drawer` / `admin-modal` / `admin-confirm-action` / `admin-toast` / `admin-panel` / `admin-page-loading` / `admin-sider` / `admin-sider-head` / `admin-nav-scroll` / `admin-bulk-bar` / `admin-asset-cell` / `admin-storage-card` / `admin-task-row` / `admin-role-save-bar`。表单控件没有 `id`，用 `aria-label` 配 `getByLabel`；React Aria 的下拉要「点触发器 → 点 `option`」，不能用 `selectOption`。**不要把 Tailwind 工具类或 `adm-*` 类写进断言** —— 前者随视觉调整变动，后者已随旧设计系统删除。

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
| 能力注册表 / 生成链路 | capability-bootstrap、credit-*、tool-contracts | capability-runtime | product-capabilities、product-parameters、state-contract |
| 模型层（渠道 / 选路 / 计费 / 任务） | plugin-manifests、model-consistency、channel-flow、protocol-runtime、route-catalog、billing、task-runtime | 暂无（见 5.5） | admin-model-suite |
| 身份与账户 | — | auth、qr-login、account、rate-limit | admin、free-creation-submit |
| 第三方登录（OAuth） | — | 暂无自动化闸口（见 5.3） | — |
| 交易与权益 | credit-deduction、credit-price、payment-signatures | commerce、membership、membership-order、payments、refund-rules | admin、admin-marketing |
| 营销 | — | marketing | admin-marketing |
| 后台与运维 | — | admin、backup、scheduler、storage、tickets-search | admin-*、admin-screenshots、sidebar |
| 中转与运营（P6） | proxy-runtime（含 B 段自起服务） | 暂无 L3 冒烟（见 5.6） | 暂无 |
| 合规与基础设施 | probe-environments、channel-signatures | aigc、signed-url、health-tracing、notifications | state-contract |
| 工作台 / 素材库 | — | — | workspace-pages、sidebar |
| 局部重绘遮罩（`42205`） | tool-contracts | 暂无自动化闸口（见 5.1） | — |

L1.5 不按功能域铺矩阵，覆盖清单见 3.2。新增纯逻辑、共享 hook 或状态组件时优先补 Vitest；需要后端或浏览器的场景归 L3/L4。

## 5. 已知缺口与验证边界

### 5.1 局部重绘遮罩

遮罩路径要求：① 前台模型的 revision 能力合同把图片参考声明为 `maskSupported: true`（派生为意图里的 `inputs.mask`）；② 渠道模型的上游协议真的接受 `images/edits` 形态；③ 遮罩素材是 PNG 且与原图同尺寸。仓库默认没有带遮罩能力的线路，因此只能验到代码层：

- `capability-config.ts` 的 `maskSupported` → `capability-spec.ts` 的 `inputs.mask` 派生；
- 准入阶段「任务带遮罩但线路合同没有 `inputs.mask`」→ `42205`（`task-admission.service.ts`）；
- `maskAssetId` 的归属、格式与尺寸校验 → `40001`。

补闸口时应覆盖两条拒绝路径（无 `inputs.mask` → `42205` 且积分退回；遮罩非同尺寸 → `40001`）以及成功路径（上游收到 `images/edits` 的两个文件段）。真实出图必须由配好 edits 线路的环境实跑一次才算证据。

### 5.2 渠道退款

退款从「改库」改为「真的调渠道」，`smoke-payments.js` 钉住的是顺序与失败语义：全额/部分/二次退款的订单状态与积分处置、渠道未配置时 `503` 且不留半截退款行、在途退款 `40908`、`channel='manual'` 不调渠道、普通用户 `403`。这些只在沙箱通道下成立。

支付宝 RSA2 与微信 v3 的退款请求体、验签与 `PROCESSING` 分支没有离线证据：`verify-payment-signatures.ts` 覆盖的是支付签名，不是退款接口。真实渠道退款须用商户号实跑一次；在此之前只能说「代码按官方规格实现，失败语义已覆盖」。

### 5.3 需要外部条件的脚本

| 脚本 / 用例 | 外部条件 |
| --- | --- |
| `smoke-aigc.js` | 可用的 image 线路（可用 `test/` 仿真网关 + 后台渠道工作台配一条） |
| 真实厂商连通性 | 各家 API key；`POST /admin/channels/:id/models/test` 实跑一次才算证据 |
| `admin-model-suite.spec.ts` 的「生成 → 账单核对」段 | 后台存在一条启用且有价格的 image 线路（`cd test && node server.js` 指到 `http://127.0.0.1:3900`）；无线路时该段跳过，其余断言照常执行 |
| 真实支付宝 / 微信回调与退款 | 商户号与可公网访问的回调地址 |
| 第三方登录（OAuth2 / OIDC） | 真实 provider 的 `clientId` / `clientSecret` 与可公网访问的回调地址；离线只能验「未配置时 `/auth/oauth/providers` 返回空、登录页不渲染按钮」 |

### 5.4 模型层的覆盖边界

`verify-billing.ts` 钉住**账本本身**（状态机 + 资金变动 + 不变量），`verify-task-runtime.ts` 钉住**任务侧**（准入 → 派发 → 切线 → 轮询 → 收尾的四条路径）。两者合起来覆盖了「钱怎么走」与「任务怎么跑」，但仍有空白：

- **L3 没有模型层的 HTTP 冒烟**：渠道工作台 / 前台模型 / 用户分组 / 插件 / 生成账单 / 调用记录六个后台页面只有 Playwright 用例（`admin-model-suite.spec.ts`）与 `verify-channel-flow.ts` 的接口级断言，没有 `smoke-*.js`；
- **准入的失败分支**只在 `verify-route-catalog` / `verify-task-runtime` 的部分路径上覆盖，参数白名单与非 JSON 选项的拒绝路径依赖 `verify-tool-contracts`；
- **`models/*` 公开接口的分组可见性**由 `verify-route-catalog` 的纯逻辑部分保证，多分组并存的 HTTP 组合未单独断言。

补测时优先补一条 `smoke-model-layer.js`（渠道 → 前台模型 → 选路 → 生成 → 账单 → 调用记录），而不是继续堆纯逻辑断言。

### 5.5 断言假阳性防范

- 断言恒真比红灯更危险：不渲染的弹窗会让 `toBeHidden` 永远通过。E2E 必须先断言元素存在/数量 > 0，再扫溢出与状态。
- 脚本连库取决于是否使用项目自己的 `ConfigModule`，不取决于 `NODE_ENV` 环境变量本身；最小模块装配要跟随真实构造器依赖。
- 溢出扫描要等真实内容就绪（`waitForSelector` + 断言元素数），`networkidle` 不等于内容渲染完成。

### 5.6 中转与运营（P6）

P6 的判据由 `verify-proxy-runtime.ts` 钉住（`npm run verify:proxy-runtime`，自起 Nest + 本机 mock 上游，夹具自建自清）。它**只跑服务层**，不经过后台 HTTP 端点与真实厂商：

- **已覆盖**：三条转发的迁移与安全语义（`GET /models` 不计费并剥离客户端密钥、`POST` 的 `reserved → settled`、SSE 透传、500 退款、524 `uncertain` 不退款、渠道与用户并发槽 `429`、自定义中转 401/403/上游错误透传与 JSON/SSE 双路径脱敏、分组可见性 `40301` 且不建账单、系统中转限流 `42901`）；`validateCustomRelayUrl` / `resolveOutboundHost` 的 SSRF 判定（回环、私网、链路本地、云 metadata、保留网段、IPv6、`localhost`、HTTP 仅可信主机）；插件包解析拒绝分支与安装 / 卸载的 `40001` / `40909` / `40400` 分支；`BillingSweeperService` 的两条迁移（TTL 由参数注入，不改生产常量）与「不碰任务账单」；财务口径与 `BillingOrder` 聚合逐项相等；钱包恒等式。
- **仍未覆盖**：① **后台插件的 HTTP 端点与审计**（脚本直接调 `PluginAdminService`，控制器层的权限点 / 审计 / 上传字段由 `admin-model-suite.spec.ts` 的插件页用例兜底）；② **财务页面的 HTTP 接口**（脚本调 `FinanceAnalyticsService.summary()`，与页面同样的聚合函数，但少了 DTO 与权限链）；③ **服务商目录**（`MODEL_PROVIDER_CATALOG_URL` 远端 JSON 的拉取与容错）无断言；④ **真实厂商差异**——SSE 分块边界、`Retry-After`、超长响应截断、各家错误体形状只由本机 mock 模拟，接真实线路时须再跑一次；⑤ 冷却、并发槽与目录版本是**进程内存**，多实例下每台各自判定，无法在单进程断言。
- 该脚本会改开发/测试库：`NODE_ENV=test` 时连 `test.db`，否则连 `dev.db`。它只清理自己建的夹具（用户 / 渠道 / 渠道模型 / 分组 / 套餐 / 账单 / 调用记录），插件装在 `mkdtemp` 临时目录并在结束时删除。

## 6. 测试数据与清理

- 冒烟脚本自建账号 / 商品 / 订单，并在 `finally` 或结尾清理；失败中断时可能留残留，需手工按外键顺序清理。
- 清理顺序（SQLite 无级联）：`GenerationTask → Asset → Project → Refund → Invoice → Payment → OrderItem → Membership → Order → ApiCallLog → CreditReservationItem → BillingOrder → CreditLedgerEntry → CreditLot → CreditAccount → MembershipUsage → CheckinRecord → InviteRelation → Notification → Ticket → OAuthIdentity → AccountToken → LoginSession → LoginLog(置空 userId) → ConsentRecord → User → Product → MembershipPlan`。脚本侧可直接用 `scripts/credit-fixture.js` 的 `clearCredits()` 完成账单 / 预留明细 / 流水 / 批次 / 账户五张表的清理。
- 不得删除非本次测试产生的数据；发现历史残留时先确认归属。
- 测试档账号与开发档账号是两套数据，不要跨库复用凭据。

## 7. 维护约定

1. 新增功能必须同时补一条冒烟（或说明为什么只能人工验证），并在提交说明里登记真实运行结果。
2. 新增权限点、错误码、状态机边时，测试要覆盖拒绝路径，不只覆盖成功路径。
3. 冒烟脚本只追加断言，不删除既有断言；确需废弃时写明原因。
4. 任何「预期通过」都不算验证：交付时只写真实运行输出里的通过 / 失败数。
5. 纯逻辑（几何 / 解析 / 状态机）与共享 hooks、状态组件优先补 Vitest；断言用行为与返回值，不用快照比对样式。新增用例后须同时跑 `npm run typecheck` 与 `npm test`。
6. 本文不记录逐轮修复过程；已知缺口按第 5 节维护，修复后移除对应条目。
