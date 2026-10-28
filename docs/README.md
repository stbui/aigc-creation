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
| [`workbench-design.md`](workbench-design.md) | `/workbench`、应用外壳、侧栏与响应式 |
| [`topnav-design.md`](topnav-design.md) | 全站顶部导航与移动端抽屉 |
| [`login-design.md`](login-design.md) | `/login`、登录弹窗、扫码登录入口 |
| [`asset-library-design.md`](asset-library-design.md) | `/library`（别名 `/asset-library`） |

## 3. 技术文档（Technical）

回答「怎么实现、怎么部署、怎么扩展」。

| 文档 | 内容 |
| --- | --- |
| [`environments.md`](environments.md) | 三环境变量矩阵、加载优先级、生产门禁、Docker、排查 |
| [`docker-deployment.md`](docker-deployment.md) | 本地 / 测试 / 生产容器编排、TLS 边界、备份恢复、升级回滚、排障 |
| [`model-architecture.md`](model-architecture.md) | 模型通道分层、协议矩阵、调度与配置、请求时序、扩展 SOP |
| [`development-workflow.md`](development-workflow.md) | Agent 执行手册：阶段执行卡、闸口命令、证据标准、交人边界 |
| [`typography-components-details.md`](typography-components-details.md) | 字体、antd 主题、圆角阴影与组件微规格 |

接口清单、目录结构、错误码等与代码强相关的速查表放在仓库根 `CLAUDE.md`，不在 docs 下重复维护。

## 4. 测试文档（Testing）

| 文档 | 内容 |
| --- | --- |
| [`testing.md`](testing.md) | 四层测试、闸口清单、Vitest / E2E 用例清单、覆盖矩阵、已知红灯、测试数据清理 |

`testing.md` 只维护清单、覆盖矩阵与已知红灯；单次运行的真实结果（通过 / 失败数、定性结论）随提交说明记录。

## 5. 规划文档（未实施）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`agent-prd.md`](agent-prd.md) | AI 智能体产品需求 | 规划中，不在本轮交付范围 |
| [`agent-integration-design.md`](agent-integration-design.md) | AI 智能体集成方案 v2：双入口、API、SSE、数据模型、安全边界 | 规划中，未实施 |

## 6. 新增文档的放置约定

| 文档类型 | 命名与位置 | 要求 |
| --- | --- | --- |
| 需求文档 | 根 `docs/`，`<域>-prd.md` | 写目标、范围、不做什么；实现后补状态 |
| 产品文档 | 页面规格 `<页面>-design.md`；域设计 `<域>-design.md` | 规格写现值与状态，不写与外部站点的对比 |
| 技术文档 | 跨域事实源直接命名（如 `environments.md`） | 与代码同批更新，不做事后补写 |
| 测试文档 | 统一进 `testing.md` | 只写真实存在、可执行的脚本与用例 |
| 规划文档 | 文件名带 `-prd` / `-design` 并在首行标「规划中」 | 实现前不得写成现状 |
