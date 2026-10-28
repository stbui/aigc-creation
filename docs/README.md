# 文档地图

本目录按**文档类型**分类：需求文档、产品文档、技术文档、测试文档、品牌规范、规划文档。

两条判定原则：

1. **代码 > 现行文档 > 历史快照**。文档与实现冲突时，以 `backend/src` / `frontend/src` 为准，并顺手改掉过时描述。
2. **只写真实存在的内容**。文档里的数字、接口、脚本名必须能在仓库里核对到；尚未实现的内容标「规划中」，不写成现状。

## 1. 需求文档（Requirements）

回答「做什么、为谁做、边界在哪」。

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`prd.md`](prd.md) | 整站产品需求（含 C 端） | 历史快照（2026-10-19）；能力数量与「未实现」结论已被 B0–B8 取代 |
| [`admin-prd.md`](admin-prd.md) | 后台管理系统需求 | 历史快照（2026-10-19）；后台已按 B1–B8 落地 |
| [`gap-analysis.md`](gap-analysis.md) | 功能缺口全量审计（GAP-xx） | 取证索引；缺口已由 B0–B8 补齐，当前实现见 `CLAUDE.md`，已知红灯见 `testing.md` 第 5 节 |
| [`agent-prd.md`](agent-prd.md) | AI 智能体产品需求 | 规划中，**明确不在本轮交付范围**；集成边界见 `agent-integration-design.md` |

## 2. 产品文档（Product）

回答「页面与功能长什么样、怎么交互」。

### 2.1 后台与商业域设计

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`admin-suite-design.md`](admin-suite-design.md) | 后台总体设计：全域地图、RBAC、路线图 | 设计依据已落地（实现现状见 `CLAUDE.md`「后台管理端」） |
| [`admin-console-design.md`](admin-console-design.md) | 后台运营域功能设计 | 同上；能力 `runtime` 字段见 `CLAUDE.md` |
| [`admin-detailed-design.md`](admin-detailed-design.md) | 后台详细设计：页面结构、组件、数据流、接口、边界 | 同上 |
| [`admin-ui-design.md`](admin-ui-design.md) | 后台界面设计 | 自研 `PageHeader/Panel/StatusTag` 体系仍有效；模型配置页已改版为 antd 原生 |
| [`commerce-design.md`](commerce-design.md) | 支付 / 积分 / 订单 / 商品设计 | 已实现；退款规则与错误码见 `CLAUDE.md`「商业域」 |

### 2.2 C 端页面规格（1:1 依据）

记录参考站实拍值（computed styles）与本地实现对拍结果，是复刻页改动的基准。注意 2026-10-17 的设计一致性收口**有意偏离**部分实拍值（暖灰改冷灰、`#6C5CE7` → `#5546D8`），不要按文档「修正」回去。

| 文档 | 对应页面 |
| --- | --- |
| [`workbench-design.md`](workbench-design.md) | `/workbench` |
| [`topnav-design.md`](topnav-design.md) | 全站顶导 |
| [`login-design.md`](login-design.md) | `/login`（含扫码登录页签） |
| [`asset-library-design.md`](asset-library-design.md) | `/library`（别名 `/asset-library`） |
| [`workspace-pages-restoration-prompt.md`](workspace-pages-restoration-prompt.md) | 工作台 / 我的作品 / 素材库复原提示词与验收记录 |
| [`multi-image-fusion-spec.md`](multi-image-fusion-spec.md) | `/multi-image-fusion` |
| [`free-creation-parity-audit.md`](free-creation-parity-audit.md) | `/free-creation` 偏差清单 |
| [`shoppable-carousel-template-sources.md`](shoppable-carousel-template-sources.md) | `/shoppable-carousel` 模板素材与来源（49 个模板、147 张预览图；页面尚未实现） |

## 3. 技术文档（Technical）

回答「怎么实现、怎么部署、怎么扩展」。

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`environments.md`](environments.md) | 三环境变量矩阵、加载优先级、生产门禁、Docker、排查 | **现行事实源**；新增环境变量必须同步 |
| [`model-architecture.md`](model-architecture.md) | 模型通道分层、协议矩阵、调度与配置、请求时序、扩展 SOP | **现行事实源**；改协议 / 通道 / 厂商时同步 |
| [`layout-unification.md`](layout-unification.md) | `AppLayout` 外壳与壳内页面 padding 的审计与实施 | 实施记录，规则仍有效 |
| [`typography-components-details.md`](typography-components-details.md) | 全站字体 / antd 主题 / 圆角阴影微规格 | 实施记录，规则仍有效 |
| [`refactor-dedup.md`](refactor-dedup.md) | 前端重复代码抽取记录 | 实施记录 |
| [`testing.md`](testing.md) | 测试策略、闸口清单、覆盖矩阵、运行手册 | **现行事实源**（测试类见第 4 节） |
| [`development-workflow.md`](development-workflow.md) | **Agent 执行手册**：十三阶段（需求 → 产品 → 评审 → 技术评审 → 文档/用例 → 实现 → 测试 → 缺陷 → 修复 → 回归 → 交付 → 产品确认 → 发布与上线观察）每段一张执行卡，含指令映射、命令、退出检查与交人边界 | **现行事实源**；agent 按本文自动推进，测试轮与修复轮分离，证据三件套 |

接口清单、目录结构、错误码等**与代码强相关**的速查表放在仓库根 `CLAUDE.md`，不在 docs 下重复维护。

## 4. 测试文档（Testing）

| 文档 | 内容 |
| --- | --- |
| [`testing.md`](testing.md) | 四层测试（构建 / 架构断言 / HTTP 冒烟 / 浏览器 E2E）、28 个冒烟与 22 个 verify/probe 脚本清单、覆盖矩阵、已知红灯定性、测试数据清理顺序、维护约定 |

单次运行的真实结果（通过 / 失败数、定性结论）随提交说明记录，不再进仓库文档；`testing.md` 只维护清单、覆盖矩阵与已知红灯。

## 5. 品牌规范

| 文档 | 内容 |
| --- | --- |
| [`brand/brand-basics.md`](brand/brand-basics.md) | 品牌唯一事实源：定位 / 口号 / 色板 / 字体 / logo / 落地清单 |
| [`brand/naming.md`](brand/naming.md) | 取名与商标冲突核查 |

改色 / 改形 / 改口号属品牌级变更：**先改这里，再动代码**。

## 6. 规划文档（未实施）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`agent-integration-design.md`](agent-integration-design.md) | AI 智能体集成方案 v2：Agent 与现有页面双入口，覆盖全部生成能力；复用 TEXT_PROVIDER / registry / GenerateService，含 API、SSE、数据模型、安全与实施批次 | **现行方案，未实施** |
| [`agent-technical-design.md`](agent-technical-design.md) | AI 智能体技术方案 v1.0 | 历史方案；LLM 通道与能力数量前提已过期，被 v2 取代 |

## 7. 变更记录在哪

2026-10-21 起**不再在仓库文档里集中维护变更日志**（`README.md` 的 B0–B8 历史章节已移除）：

- 改了什么、为什么这样取舍、真实验证结果：「已实现未实测」的边界，随**提交说明**记录；
- 功能与接口的**现状**：`CLAUDE.md`（单页速查）与代码本身；
- 测试清单、覆盖矩阵与已知红灯：`testing.md`。

需要回溯某次决定的理由时，用 `git log` + 对应提交说明。

## 8. 取证与附件资源

以下目录只放**图片与一次性调研**，不参与文档分类：
`docs/screenshots/`（后台各页与 C 端功能的实施截图）、`workbench-ref/` `topnav-ref/` `login-ref/` `asset-library-ref/` `layout-ref/` `refactor-ref/` `finetune-ref/`（1:1 对拍与改版前后截图，被同名 `*-design.md` 引用）、`brand/` 内的落地页截图（被 `brand-basics.md` 引用）、`research/model-settings-competitive-2026-10-20.md`（模型配置页改版的竞品调研；落地现状见 `CLAUDE.md`「后台管理端」的「模型配置页」段）。

## 9. 新增文档的放置约定

| 文档类型 | 命名与位置 | 要求 |
| --- | --- | --- |
| 需求文档 | 根 `docs/`，`<域>-prd.md` | 写目标、范围、不做什么；实现后补状态 |
| 产品文档 | 页面规格 `<页面>-design.md`；域设计 `<域>-design.md` | 1:1 页面必须记录实拍值来源 |
| 技术文档 | 跨域事实源直接命名（如 `environments.md`） | 与代码同批更新，不做事后补写 |
| 测试文档 | 统一进 `testing.md`；单次结果随提交说明 | 只写真实运行过的结果 |
| 规划文档 | 文件名带 `-prd` / `-design` 并在首行标「规划中」 | 实现前不得写成现状 |
