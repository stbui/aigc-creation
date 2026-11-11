# 文档地图

本目录按类型分为五类：需求文档、产品文档、技术文档、测试文档、规划文档。

三条判定原则：

1. **代码 > 现行文档**。文档与实现冲突时，以 `backend/src` / `frontend/src` 为准，并顺手改掉过时描述。
2. **只写现状**。文档里的数量、接口、脚本名必须能在仓库里核对到；尚未实现的内容标「规划中」，不写成现状。
3. **不留过程记录**。交付批次、逐轮实施记录、一次性审计与取证日志不进入仓库文档；取舍理由随提交说明记录。

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
| [`admin-ui-design.md`](admin-ui-design.md) | 后台界面设计：布局、组件规格、状态与交互 |
| [`commerce-design.md`](commerce-design.md) | 支付 / 积分 / 订单 / 商品 / 会员 / 营销设计 |

### 2.2 C 端页面规格

| 文档 | 对应页面 |
| --- | --- |
| [`landing-design.md`](landing-design.md) | `/` 营销首页：首屏、场景与工具入口、使用流程、套餐、案例、底部行动区 |
| [`workbench-design.md`](workbench-design.md) | `/workbench`、应用外壳、侧栏与响应式 |
| [`topnav-design.md`](topnav-design.md) | 全站顶部导航与移动端抽屉 |
| [`login-design.md`](login-design.md) | `/login`、登录弹窗、扫码登录入口 |
| [`library-design.md`](library-design.md) | `/library`（别名 `/asset-library`） |
| [`packages-design.md`](packages-design.md) | `/packages` 积分商城：参考站 SeeAny `/vip` 的套餐与积分策略基准 + 本站现状对照（档位与积分包已对齐，充值赠送 / 子账号 / 滚存为待立项功能） |
| [`shoppable-carousel-design.md`](shoppable-carousel-design.md) | `/shoppable-carousel` AI 带货图文：参考站实拍拆解、模板三拍口径、一次生成 6–10 张的拆分与计费、页面结构 |
| [`shoppable-carousel-template-sources.md`](shoppable-carousel-template-sources.md) | 上述模板资产（分类 / 三拍文案 / 缩略图）的来源与抓取记录 |
| [`template-design.md`](template-design.md) | `/template` 写真模板：页面结构、模板提示词、生成规则与图片资产来源 |

### 2.3 品牌规范

| 文档 | 内容 |
| --- | --- |
| [`brand/brand-basics.md`](brand/brand-basics.md) | 品牌名称、技术标识（`huojue`）、技术命名约定与禁用旧称 |

## 3. 技术文档（Technical）

回答「怎么实现、怎么部署、怎么扩展」。

| 文档 | 内容 |
| --- | --- |
| [`environments.md`](environments.md) | 三环境变量矩阵、加载优先级、生产门禁、Docker、排查 |
| [`docker-deployment.md`](docker-deployment.md) | 本地 / 测试 / 生产容器编排、TLS 边界、备份恢复、升级回滚、排障 |
| [`model-architecture.md`](model-architecture.md) | 模型层：渠道 / 前台模型 / 路由与冷却 / 任务执行 / 账单退款 / 代理中转、扩展 SOP |
| [`api-contract.md`](api-contract.md) | 统一响应信封、跨模块错误码、主要接口清单、令牌时长 |
| [`runtime-infrastructure.md`](runtime-infrastructure.md) | AIGC 标识、签名 URL、限流、健康检查、请求追踪、日志落盘 |
| [`development-workflow.md`](development-workflow.md) | Agent 执行手册：阶段执行卡、闸口命令、证据标准、交人边界、Git 工作流（分支 / 提交 / PR / 回滚） |
| [`frontend-module-conventions.md`](frontend-module-conventions.md) | 前端多文件功能目录的分层、入口文件、导入方向与新增文件落位 |
| [`product-detail-generation.md`](product-detail-generation.md) | `/product-detail` 商品详情图：模块拆批、任务与账单、提示词、执行状态机、轮询聚合、删除与失败边界 |
| [`typography.md`](typography.md) | 字体、主题桥接、圆角阴影与组件微规格 |
| [`design-tokens.md`](design-tokens.md) | 设计令牌标准：基础 / 通用 / 组件三层、命名、引用规则、新增流程与审计命令 |

目录结构、能力清单、环境坑等与代码强相关的坐标速查表放在仓库根 `CLAUDE.md`；接口清单与错误码在 [`api-contract.md`](api-contract.md)。

## 4. 测试文档（Testing）

| 文档 | 内容 |
| --- | --- |
| [`testing.md`](testing.md) | 四层测试、闸口清单、Vitest / E2E 用例清单、覆盖矩阵、已知缺口、测试数据清理 |

`testing.md` 只维护清单、覆盖矩阵与已知缺口；单次运行的真实结果（通过 / 失败数、定性结论）随提交说明记录。

## 5. 规划文档（未实施）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`agent-prd.md`](agent-prd.md) | AI 智能体产品需求 | 规划中，不在本轮交付范围 |
| [`agent-integration-design.md`](agent-integration-design.md) | AI 智能体集成方案 v2：双入口、API、SSE、数据模型、安全边界 | 规划中，未实施 |
| [`canvas-port-design.md`](canvas-port-design.md) | 无限画布全量移植方案（对齐 open-ai-canvas）：Postgres + Redis 前置、文档 operations 协议、协作与实时、快照/分享、四模态生成、Agent/3D 末排、工作分解与验收 | 规划中，未实施 |
| [`canvas-detailed-design.md`](canvas-detailed-design.md) | 无限画布实现详细设计：仓库现状差距、P0 基础设施改造、7 张表与 Prisma 定义、operations 写入算法与错误码、租约/实时/快照/分享、四模态生成回填、前端引擎与编辑器拆分、后台管理与验收闸口 | 规划中，未实施 |
| [`channel-model-design.md`](channel-model-design.md) | 渠道与模型子系统整体移植方案（对齐 open-ai-canvas）：渠道/渠道模型/价格档/前台模型/路由/微积分计费/分组/协议插件/代理 —— 现模型层的设计依据与取舍记录 | 已实施（P0–P6） |
| [`payment-refactor-design.md`](payment-refactor-design.md) | 支付域重构方案 v2（对齐 open-ai-canvas）：多渠道配置版本化与加密托管、查单/关单、回调收件箱与 15s worker、T+1 对账自动补发、`/admin/payments` 四标签页完整规格、迁移与验收标准 | 部分实施：后端主链路已落地；前端页面与开放差距见 §25 |
| [`admin-workflow-design.md`](admin-workflow-design.md) | 后台角色化工作流：运营/财务/管理员三种首屏、统一待办、上下文直达、保存视图与命令面板、工单转交、批量动作与分期验收 | P0 已实施（对账保存视图未落地）；P1 / P2 规划中 |

## 6. 文档命名与放置规范

### 6.1 命名格式

- 一律小写 ASCII kebab-case，匹配 `^[a-z0-9]+(-[a-z0-9]+)*\.md$`。禁止中文、下划线、空格、驼峰、大写。
- 文件名 = `前缀（域）` + `粒度/主题` + `类型后缀`，缺哪段省哪段。
- 类型后缀只有两个：`-prd`（需求）、`-design`（产品/设计方案）。技术文档与测试文档不加后缀，直接用领域名词（`environments.md` / `testing.md` / `model-architecture.md` / `docker-deployment.md`）。
- 域前缀：整站文档不带前缀（`prd.md`）；子系统带前缀（`admin-` / `agent-` / `commerce-` / `workbench-` / `login-` …）。
- 一个域内有多份文档时用「域-粒度-类型」，粒度由总到细固定为 `suite` → `console` → `detailed` → `ui`；跨页流程与角色动线用 `workflow`。新增粒度词须先改本节。

### 6.2 禁止事项

- 文件名不带版本号、日期、状态词：`-v2` / `-2026-10-28` / `-final` / `-new` / `-wip` / `-draft` 一律不出现。状态写在正文首行。
- 过程产物不建文件：审计报告、取证日志、逐轮实施记录、单次运行结果随提交说明或仓库外的临时目录，不进 `docs/`（对应本文件开头第 3 条原则）。
- 不按人名、批次号、需求单号命名。

### 6.3 放置约定

| 文档类型 | 位置与命名 | 要求 |
| --- | --- | --- |
| 需求文档 | `docs/<域>-prd.md` | 写目标、范围、不做什么；实现后补状态 |
| 产品文档 | 页面规格 `docs/<页面>-design.md`；域设计 `docs/<域>-design.md` | 页面名取主路由（`library-design.md` 对应 `/library`），别名只写在正文；规格写现值与状态，不写与外部站点的对比 |
| 技术文档 | `docs/<领域>.md`，跨域事实源可直接用领域名 | 与代码同批更新，不做事后补写 |
| 测试文档 | 统一进 `docs/testing.md` | 只写真实存在、可执行的脚本与用例 |
| 规划文档 | 与对应类型同位置 | 正文首行标「规划中」，实现前不得写成现状 |
| 索引 | `docs/README.md` | 只做分类索引，不承载正文 |

### 6.4 新增与改名

- 新建或改名必须同批完成三件事：文件落位、本文件分类表更新、全仓引用更新（`grep -rn '<文件名>'` 除 `docs/` 外还须覆盖 `CLAUDE.md` 与代码注释）。
- 一个文件只写一个主题；内容跨两个域时拆分，不要用「综合」「杂项」这类名字兜底。
