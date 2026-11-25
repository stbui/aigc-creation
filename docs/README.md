# 文档地图

本目录按类型分为六类：需求文档、产品文档、前端设计（`docs/design/`）、技术文档、测试文档、规划文档。

三条判定原则：

1. **代码 > 现行文档**。文档与实现冲突时，以 `backend/src` / `frontend/src` 为准，并顺手改掉过时描述。
2. **只写现状**。文档里的数量、接口、脚本名必须能在仓库里核对到；尚未实现的内容标「规划中」，不写成现状。
3. **不留过程记录**。交付批次、逐轮实施记录、一次性审计与取证日志不进入仓库文档；取舍理由随提交说明记录。

## 0. Agent 协作入口

| 文件 | 只写 | 什么时候读 |
| --- | --- | --- |
| 根 `README.md` | 对外产品介绍、能力概览、快速启动 | 首次了解项目或对外分享时 |
| 根 `AGENTS.md` | 线路分工、文件归属、并行与交接 | 任何跨目录改动、开新线程前 |
| `CLAUDE.md` | 仓库不变量、单一事实源、易腐化数量、环境踩坑 | 定位事实源、判断硬约束时 |
| [`development-workflow.md`](development-workflow.md) | 13 阶段总览、阶段执行卡、按变更类型裁剪 | 走从需求到交付的完整流程时 |
| [`agent-execution.md`](agent-execution.md) | 指令映射、默认禁令、自主边界、常见失败模式 | 判断 agent 能自主做什么时 |
| [`testing.md`](testing.md) | 闸口矩阵、按域专项、覆盖矩阵与已知缺口 | 找验证命令时 |
| [`git-workflow.md`](git-workflow.md) | 分支、提交、PR、回滚、git 权限边界 | 提交、开 PR、处理冲突时 |
| 本文件 | 文档索引、命名与放置规则 | 新增、改名、查找文档时 |

后三份构成**开发流程三件套**（阶段 / 边界 / Git），同一事实只在其中一份维护；闸口与证据标准分别由 `testing.md` §3–§4 与根 `AGENTS.md` §7–§8 承担。读法优先级：用户当轮指令 > 根 `AGENTS.md` > `CLAUDE.md` > 开发流程三件套 > 领域文档。

## 1. 需求文档（Requirements）

回答「做什么、为谁做、边界在哪」。

| 文档 | 内容 |
| --- | --- |
| [`prd.md`](prd.md) | 整站产品需求：账号合规、创作与资产、内容合规、交易、安全风控、后台、基础设施 |
| [`admin-prd.md`](admin-prd.md) | 后台管理系统需求：角色权限、功能模块、接口与数据要求 |

## 2. 产品文档（Product）

回答「页面与功能长什么样、怎么交互」。

### 2.1 后台与商业域

| 文档 | 内容 |
| --- | --- |
| [`admin-suite-design.md`](admin-suite-design.md) | 后台总体设计：全域地图、RBAC、信息架构 |
| [`admin-console-design.md`](admin-console-design.md) | 后台运营域功能设计 |
| [`admin-detailed-design.md`](admin-detailed-design.md) | 后台详细设计：页面结构、组件、数据流、接口、边界 |

### 2.2 C 端页面资产

页面规格已按端归入 [`docs/design/web/`](design/web/)，本表只留页面资产来源记录。

| 文档 | 对应页面 |
| --- | --- |
| [`shoppable-carousel-template-sources.md`](shoppable-carousel-template-sources.md) | AI 带货图文模板资产（分类 / 三拍文案 / 缩略图）的来源与抓取记录 |

### 2.3 品牌规范

| 文档 | 内容 |
| --- | --- |
| [`brand/brand-basics.md`](brand/brand-basics.md) | 品牌名称、技术标识（`huojue`）、技术命名约定、上游引擎与历史引用边界 |

## 3. 前端设计（`docs/design/`）

回答「页面长什么样、前端怎么落地」。按端分三个目录：`admin/` 后台前端、`web/` C 端页面、`standards/` 跨端规范。

### 3.1 后台前端

| 文档 | 内容 |
| --- | --- |
| [`admin/admin-ui-design.md`](design/admin/admin-ui-design.md) | 后台前端设计语言：双层视觉边界、令牌、布局、组件、状态与交付检查 |
| [`admin/payment-ui-design.md`](design/admin/payment-ui-design.md) | 支付域页面与前端设计：`/admin/payments` 三标签页、C 端结算支付方式、状态派生、列表查询与导出 |

### 3.2 C 端页面

| 文档 | 对应页面 |
| --- | --- |
| [`web/landing-design.md`](design/web/landing-design.md) | `/` 营销首页：首屏、场景与工具入口、使用流程、套餐、案例、底部行动区 |
| [`web/workbench-design.md`](design/web/workbench-design.md) | `/workbench`、应用外壳、侧栏与响应式 |
| [`web/topnav-design.md`](design/web/topnav-design.md) | 全站顶部导航与移动端抽屉 |
| [`web/login-design.md`](design/web/login-design.md) | `/login`、登录弹窗、扫码登录入口 |
| [`web/library-design.md`](design/web/library-design.md) | `/library`（别名 `/asset-library`） |
| [`web/packages-design.md`](design/web/packages-design.md) | `/packages` 积分商城：参考站 SeeAny `/vip` 的套餐与积分策略基准 + 本站现状对照（档位与积分包已对齐，充值赠送 / 子账号 / 滚存为待立项功能） |
| [`web/shoppable-carousel-design.md`](design/web/shoppable-carousel-design.md) | `/shoppable-carousel` AI 带货图文：参考站实拍拆解、模板三拍口径、一次生成 6–10 张的拆分与计费、页面结构 |
| [`web/template-design.md`](design/web/template-design.md) | `/template` 写真模板：页面结构、模板提示词、生成规则与图片资产来源 |
| [`web/wardrobe-design.md`](design/web/wardrobe-design.md) | 衣帽间 AI 模特试衣：市场、技术选型、产品定义与 MVP 拆分（规划中，策划草案） |

### 3.3 跨端规范

| 文档 | 内容 |
| --- | --- |
| [`standards/frontend-module-conventions.md`](design/standards/frontend-module-conventions.md) | 前端多文件功能目录的分层、入口文件、导入方向与新增文件落位 |
| [`standards/frontend-component-language.md`](design/standards/frontend-component-language.md) | 前端组件语言：跨 C 端 / 后台的组件角色、Props 契约、状态、组合方式与评审规则 |
| [`standards/design-tokens.md`](design/standards/design-tokens.md) | 设计令牌标准：基础 / 通用 / 组件三层、命名、引用规则、新增流程与审计命令 |
| [`standards/typography.md`](design/standards/typography.md) | 字体、主题桥接、圆角阴影与组件微规格 |
| [`standards/responsive-layout.md`](design/standards/responsive-layout.md) | 布局与响应式规范：断点四档刻度、页面容器与内边距、页头三级体系、网格降列、工具页骨架、移动端规则与迁移纪律 |
| [`standards/copywriting.md`](design/standards/copywriting.md) | 用户可见文案规范：任务边界、写作基准、禁止项、分场景写法、语言规范、执行与自检 |
| [`standards/feedback-states.md`](design/standards/feedback-states.md) | 状态与反馈规范：加载 / 空 / 失败 / 进行中 / 成功 / 结果不明的判定顺序、组件取用与文案 |
| [`standards/code-style.md`](design/standards/code-style.md) | 代码风格与静态检查：Biome 工具链、规则基线、CI 门禁、格式化策略与收紧流程 |
| [`standards/accessibility.md`](design/standards/accessibility.md) | 可访问性规范：键盘与焦点、语义结构、表单、图像与媒体、动态反馈、对比度、验证清单与已知缺口 |

## 4. 技术文档（Technical）

回答「怎么实现、怎么部署、怎么扩展」。

| 文档 | 内容 |
| --- | --- |
| [`environments.md`](environments.md) | 三环境变量矩阵、加载优先级、生产门禁、Docker、排查 |
| [`docker-deployment.md`](docker-deployment.md) | 本地 / 测试 / 生产容器编排、TLS 边界、备份恢复、升级回滚、排障 |
| [`model-architecture.md`](model-architecture.md) | 模型层：渠道 / 模型商品 / 能力绑定 / 路由与冷却 / 任务执行 / 账单退款 / 代理中转、扩展 SOP、待实施的追踪闭环 |
| [`api-contract.md`](api-contract.md) | 统一响应信封、跨模块错误码、主要接口清单、令牌时长 |
| [`error-copy.md`](error-copy.md) | 错误文案映射：分层归属、码段、生成任务码表、码复用清单、新增流程与已知缺口 |
| [`payment-detailed-design.md`](payment-detailed-design.md) | 支付域详细设计（后端契约）：数据模型、接口契约、文件职责、类型与服务签名、Prisma 模型 |
| [`development-workflow.md`](development-workflow.md) | 开发流程（阶段篇）：13 阶段总览、阶段执行卡、按变更类型裁剪、紧急修复通道、需求条目与缺陷卡模板 |
| [`agent-execution.md`](agent-execution.md) | Agent 执行边界：指令映射、开工固定三步、默认禁令、自主边界、常见失败模式 |
| [`git-workflow.md`](git-workflow.md) | Git 工作流：分支、提交信息、提交粒度、PR 与合并、同步与冲突、回滚、git 权限边界 |
| [`product-detail-generation.md`](product-detail-generation.md) | `/product-detail` 商品详情图：模块拆批、任务与账单、提示词、执行状态机、轮询聚合、删除与失败边界 |
| [`gen-prompt.md`](gen-prompt.md) | 生图链路与提示词：主图 / 详情图字段映射、变体与模块拆批、提示词结构、并发生图与配额、可见性与效果评估现状 |
| [`backend-nestjs-conventions.md`](backend-nestjs-conventions.md) | 后端 NestJS 结构规范：模块分层、Controller / Service 边界、DTO、异常、鉴权、事务、日志与测试 |
| [`security.md`](security.md) | 安全与权限规范：鉴权链、令牌与密钥、SSRF、上传、支付回调、注入、限流、日志脱敏与检查清单 |
| [`database.md`](database.md) | 数据库规范：Prisma 配置与生成器、命名、主键与时间、关系级联、索引、类型精度、Prisma Client 用法、Prisma Migrate、种子与备份 |
| [`prompt-engineering.md`](prompt-engineering.md) | 生成提示词规范：buildPrompt / outputPlan、事实闭集、参数槽位、文本工具、协议边界、测试与已知缺口 |
| [`observability.md`](observability.md) | 可观测性规范：日志、请求追踪、调用记录、指标、健康检查、告警、定时任务与排障路径 |
| [`release.md`](release.md) | 发布与版本规范：版本号、发布单元、发布记录、兼容性、回滚、热修与 CI/CD 缺口 |
| [`analytics-events.md`](analytics-events.md) | 数据分析事件规范：事件目录、属性、指标口径、归因、采集门槛与已知缺口 |
| [`media-assets.md`](media-assets.md) | 媒体资产规范：上传格式与上限、存储 key、缩略图、签名访问、AIGC 标识、视频与删除保留 |
| [`mask-canvas-sdk.md`](mask-canvas-sdk.md) | 遮罩画布 SDK：标记 / 手势 / 遮罩 / 导出内核、两条通知通道、适配层职责与约束 |
| [`non-upstream-extensions.md`](non-upstream-extensions.md) | 非上游扩展与契约偏差登记：逐项记录偏离点、动机、影响面与落点 |

目录结构、能力清单、环境坑等与代码强相关的坐标速查表放在仓库根 `CLAUDE.md`；接口清单与错误码在 [`api-contract.md`](api-contract.md)。

## 5. 测试文档（Testing）

| 文档 | 内容 |
| --- | --- |
| [`testing.md`](testing.md) | L1–L4 分层测试（含 L1.5 / L1.6）、闸口清单、Vitest / E2E 用例清单、覆盖矩阵、已知缺口、测试数据清理 |

`testing.md` 只维护清单、覆盖矩阵与已知缺口；单次运行的真实结果（通过 / 失败数、定性结论）随提交说明记录。

## 6. 设计与规划

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`agent-prd.md`](agent-prd.md) | AI 智能体产品需求 | 规划中，不在本轮交付范围 |
| [`agent-integration-design.md`](agent-integration-design.md) | AI 智能体集成方案 v2：双入口、API、SSE、数据模型、安全边界 | 规划中，未实施 |
| [`canvas-port-design.md`](canvas-port-design.md) | 无限画布全量移植方案（对齐 open-ai-canvas）：Postgres + Redis 前置、文档 operations 协议、协作与实时、快照/分享、四模态生成、Agent/3D 末排、工作分解与验收 | 规划中，未实施 |
| [`canvas-detailed-design.md`](canvas-detailed-design.md) | 无限画布实现详细设计：仓库现状差距、P0 基础设施改造、7 张表与 Prisma 定义、operations 写入算法与错误码、租约/实时/快照/分享、四模态生成回填、前端引擎与编辑器拆分、后台管理与验收闸口 | 规划中，未实施 |
| [`payment-refactor-design.md`](payment-refactor-design.md) | 支付域重构设计：多渠道配置版本化与加密托管、查单/关单、回调收件箱与 15s worker、T+1 对账自动补发、决策与开放差距 | 主体已实施，见 §13 |
| [`admin-workflow-design.md`](admin-workflow-design.md) | 后台角色化工作流：运营/财务/管理员三种首屏、统一待办、上下文直达、保存视图与命令面板、工单转交、批量动作与分期验收 | P0 已实施（对账保存视图未落地）；P1 / P2 规划中 |
| [`mailbox-design.md`](mailbox-design.md) | 邮箱模块 `/mailbox` 设计：入口、数据、接口与实施边界 | 规划中，未实施 |

## 7. 文档命名与放置规范

### 7.1 命名格式

- 一律小写 ASCII kebab-case，匹配 `^[a-z0-9]+(-[a-z0-9]+)*\.md$`。禁止中文、下划线、空格、驼峰、大写。
- 文件名 = `前缀（域）` + `粒度/主题` + `类型后缀`，缺哪段省哪段。
- 类型后缀只有两个：`-prd`（需求）、`-design`（产品/设计方案）。技术文档与测试文档不加后缀，直接用领域名词（`environments.md` / `testing.md` / `model-architecture.md` / `docker-deployment.md`）。
- 域前缀：整站文档不带前缀（`prd.md`）；子系统带前缀（`admin-` / `agent-` / `commerce-` / `workbench-` / `login-` …）。
- 一个域内有多份文档时用「域-粒度-类型」，粒度由总到细固定为 `suite` → `console` → `detailed` → `ui`；跨页流程与角色动线用 `workflow`。新增粒度词须先改本节。

### 7.2 禁止事项

- 文件名不带版本号、日期、状态词：`-v2` / `-2026-10-28` / `-final` / `-new` / `-wip` / `-draft` 一律不出现。状态写在正文首行。
- 过程产物不建文件：审计报告、取证日志、逐轮实施记录、单次运行结果随提交说明或仓库外的临时目录，不进 `docs/`（对应本文件开头第 3 条原则）。
- 不按人名、批次号、需求单号命名。

### 7.3 放置约定

| 文档类型 | 位置与命名 | 要求 |
| --- | --- | --- |
| 需求文档 | `docs/<域>-prd.md` | 写目标、范围、不做什么；实现后补状态 |
| 产品文档（域设计） | `docs/<域>-design.md` | 域前缀取子系统名；页面级规格不放这里 |
| 前端设计 | 页面规格 `docs/design/<端>/<页面>-design.md`；跨端规范 `docs/design/standards/<领域>.md` | 端只有 `admin`（后台）与 `web`（C 端）；页面名取主路由（`library-design.md` 对应 `/library`），别名只写在正文；规格写现值与状态，不写与外部站点的对比 |
| 技术文档 | `docs/<领域>.md`，跨域事实源可直接用领域名 | 与代码同批更新，不做事后补写 |
| 测试文档 | 统一进 `docs/testing.md` | 只写真实存在、可执行的脚本与用例 |
| 规划文档 | 与对应类型同位置 | 正文首行标「规划中」，实现前不得写成现状 |
| 索引 | `docs/README.md` | 只做分类索引，不承载正文 |

### 7.4 新增与改名

- 新建或改名必须同批完成三件事：文件落位、本文件分类表更新、全仓引用更新（`grep -rn '<文件名>'` 除 `docs/` 外还须覆盖 `CLAUDE.md` 与代码注释）。
- 一个文件只写一个主题；内容跨两个域时拆分，不要用「综合」「杂项」这类名字兜底。
