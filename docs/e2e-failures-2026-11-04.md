# 完整 Admin E2E 失败分析报告

> 生成日期：2026-11-04
> 触发：用户「继续」推进门禁，运行 `npm --prefix frontend run e2e`（playwright.admin.config.ts，全量 admin spec）
> 结果：**128 passed / 35 failed / 1 skipped，耗时 18.5m**
> 处置原则：跑≠改，本报告仅诊断与归类，**未修改任何业务代码**。修复需逐条裁定授权。

---

## 1. 总览

- 环境连通性已验证：5100 dev server 的 `/api`、`/uploads` 代理正确命中运行中的 backend（实际监听 3900），admin 登录态与「概览页加载真实统计」在 smoke 中已 2/2 通过。因此 35 失败**不是「环境起不来」**，而是用例级断言失败。
- 本轮未改动任何 frontend 业务代码（仅改 `test/test/server.test.js` 的 gateway 断言，与 frontend e2e 无关），单测 / typecheck / build / smoke 全绿 → **35 失败为既有状态，非本次改动引入的回归**。
- 在 VOZEB-PRO→AIGC 迁移语境下，失败面覆盖游客态复原、sidebar 复原、工具页参数、admin 后台功能，本质是当前 AIGC 实现与参考站之间的系统性差距，或测试自身契约漂移。

---

## 2. 根因分类框架

逐条裁定前，先建立三类判定口径（报告中标注「推测」的需在修复前二次确认）：

| 类别 | 含义 | 修复方向 | 典型信号 |
| --- | --- | --- | --- |
| **A · 测试漂移** | 功能/UI 已实现，测试断言、时序、mock 或 session 前置与实现契约不匹配 | **改测试**，不动实现 | 类名/接口已实现且匹配；失败源于等待时长、去重键、mock 路径 |
| **B · 复原差距** | 实现存在但与参考站（VOZEB-PRO）几何/文本/参数/结构未 1:1 对齐（K3/K4 债务） | 补实现或对齐参考站契约 | 像素级/顺序/枚举断言不符；复原类 spec |
| **C · 数据/依赖** | 用例依赖特定后端数据、线路、活动或权限状态 | 补种子数据 / 对齐后端契约 | 端到端跨服务、对账、权限、登录墙等 |

---

## 3. 35 失败逐条归类

| # | spec:行 | 描述 | 分类(推测) | 影响模块 |
| --- | --- | --- | --- | --- |
| 1 | admin-assets:82 | 网格勾选后出现批量操作条 | C | admin 素材 |
| 2 | admin-assets:237 | 删除素材直接执行，不再弹窗/确认词 | C | admin 素材 |
| 3 | admin-layout:163 | 全局搜索 Ctrl+K 唤起 + Esc 关闭 | C/B | admin 布局 |
| 4 | admin-model-suite:394 | 端到端：选型→报价→生成→账单核对 | C | 模型/计费 |
| 5 | admin-model-suite:786 | 全部模型视图：跨渠道列出线路并按状态筛选 | C | 模型 |
| 6 | admin-payments:97 | 对账标签给出执行区与运行列表 | C | 支付对账 |
| 7 | admin-ux:266 | 营销规则修改后离开先确认，可放弃变更 | C/B | admin UX |
| 8 | admin-ux:399 | 角色权限修改后出现保存条，离开前二次确认 | C/B | admin UX |
| 9 | admin.spec:118 | C 端用户访问后台显示无权限页并说明原因 | C | 权限 |
| 10 | free-creation-submit:113 | 未登录+提示词已填→按钮可点，点击弹登录框且不发请求 | C/B | 自由创作 |
| 11 | free-creation-submit:135 | 已登录→「立即生成」+「本次消耗 10 积分」，空提示词置灰 | C/B | 自由创作 |
| 12 | product-capabilities:84 | 下线能力全站隐藏；暂无通道能力保留入口并标注 | B | 能力可见性 |
| 13 | product-capabilities:125 | 创意生图独立路由，提交 capability=creative_image | B | 路由 |
| 14 | product-capabilities:282 | GIF 与 >10MB 文件在选择阶段被拒，不发起上传 | B | 上传约束 |
| 15 | product-capabilities:307 | 失败任务重试沿用原 capability/inputAssetIds/params 并显示进度 | B/C | 任务重试 |
| 16 | product-capabilities:452 | 局部重绘画布限制 3 标注，参考图上传中禁用提交，遮罩+逐标注参考图 | B | 局部重绘 |
| 17 | product-parameters:342 | 去水印：MANUAL 遮罩与 PNG 输出 | B | 工具页参数 |
| 18 | product-parameters:402 | 产品精修：模板码、补充要求与参考比例 | B | 工具页参数 |
| 19 | product-parameters:423 | 图片翻译：目标语言、主体保护，且不发送 ratio | B | 工具页参数 |
| 20 | product-parameters:518 | 商品换色：提交解析后 targetColor 并兼容 customColor | B | 工具页参数 |
| 21 | product-parameters:680 | 旋转角度：拖拽预览有效并提交参考站角度字段 | B | 工具页参数 |
| 22 | product-parameters:748 | 去水印失败后可回到标注画布重新调整遮罩 | B | 工具页参数 |
| 23 | sidebar:31 | 1440 横排：几何/顺序/本地图标/底部入口与参考站一致 | B | sidebar |
| 24 | sidebar:114 | 1280 竖轨：100px 轨迹、77×60 条目、10px 标签且无横向溢出 | B | sidebar |
| 25 | sidebar:176 | 底部入口进入真实工单表单，预填产品建议/咨询类型 | B/C | sidebar |
| 26 | sidebar:198 | 390 移动抽屉保留完整分组与真实入口，无横向溢出 | B | sidebar |
| 27 | state-contract:207 | 状态契约·生成中不得显示空态：提交后结果栏显示骨架，不显示空态 | C/B | 状态契约 |
| 28 | workspace-pages:107 | 工作台复原：游客态固定 12 卡、顺序正确、不请求统计接口 | B | 工作台 |
| 29 | workspace-pages:137 | 我的作品复原：游客态直接显示筛选器与空态，不请求任务接口 | B | 我的作品 |
| 30 | workspace-pages:172 | 素材库复原：游客态 /asset-library 直达、官方空态、隐藏私有操作区 | B | 素材库 |
| 31 | workspace-pages:172 | 素材库复原：游客态 /library 直达、官方空态、隐藏私有操作区 | B | 素材库 |
| 32 | workspace-pages:196 | 三页移动端复原：390 下无横向溢出，工作台 2 列，间距与参考站一致 | B | 移动端 |
| 33 | workspace-pages:254 | 游客新人福利弹层：复制参考站 500×427 构图，展示 DB 活动倒计时与真实权益 | **A(已确认)** | 游客福利 |
| 34 | workspace-pages:288 | 游客新人福利弹层：关闭后持久化，刷新不再出现 | **A(已确认)** | 游客福利 |
| 35 | workspace-pages:312 | 游客新人福利弹层：无 DB 活动时用真实免费能力入口，390 不溢出 | **A(已确认)** | 游客福利 |

**分类汇总（推测）**：A 类 3（已确认）、B 类约 22、C 类约 10。确切分布需逐条裁定（见 §6）。

---

## 4. 代表性根因抽样

### 4.1 guest-promo（A 类 · 已确认测试漂移）

- **事实**：`frontend/src/components/GuestPromoDialog.tsx` 已实现，类名 `.guest-promo-overlay` / `.guest-promo-dialog` / `.guest-promo-title` / `.guest-promo-countdown` / `.guest-promo-benefits` / `.guest-promo-claim` 与测试断言**完全匹配**。
- **触发条件**（line 95）：`open = !token && !dismissed && autoOpen && !loginOpen && !expired`。
- **autoOpen 机制**（line 43-75）：仅当用户**停留 6 秒且无任何 `pointerdown`/`keydown`/`wheel`/`touchstart` 交互**时，定时器（`SHOW_DELAY_MS=6000`）才置 `autoOpen=true`；一旦有交互立即 `cleanup` 取消。
- **会话去重**（line 48）：`sessionStorage` 键 `ecom-guest-promo-shown-v1` 标记为本会话已展示，看过一次后**永不再弹**。
- **测试缺口**：`mockPopup()` 后仅 `await expect(overlay).toBeVisible({ timeout: 9000 })`。既未保证「6 秒纯空闲」前置，又未清理 `sessionStorage`——同 worker 内前序 visitor 测试一旦触发过 autoOpen 即写入 sessionStorage，导致后续 visitor 测试永远不显示 → 超时失败。
- **结论**：功能正确，失败源于测试时序/去重键前置缺失。修复方向是让测试先清 `sessionStorage` 并等待 6 秒空闲（或组件提供测试强开开关），**不应改实现**。

### 4.2 sidebar 复原（B 类 · 推测复原差距）

- spec 断言极具体的几何：`1440` 下侧栏 `width:176`/`height:896`、条目 `133×45`、菜单项精确顺序（工作台→…→素材库，共 20 项）、图标 `src` 以 `/menu/` 开头、且**不得请求参考站 `ijihua.cn`**。
- 组件以 `.workspace-side-menu-v2` 渲染（断言 `toBeVisible` 通过），说明结构存在但尺寸/文本/图标与参考站不符 → 典型 1:1 复原差距。

### 4.3 工具页参数（B 类 · 推测复原差距）

- `product-parameters` 6 条均为「8 个工具页参数与结果态」子项（去水印遮罩/PNG、精修模板码、翻译不发送 ratio、换色 targetColor、旋转角度字段、失败回标注）。
- 与参考站工具页参数契约未对齐，属 B 类实现/契约差距。

---

## 5. 影响模块

- **前端**：sidebar、WorkbenchPage（.wb-tool-grid）、游客福利（GuestPromoDialog）、工具页参数/结果态、能力可见性、素材库、我的作品、移动端三页、状态契约、admin 后台（素材/布局/模型/支付/UX/权限）、自由创作登录墙。
- **后端（间接）**：`admin-model-suite` 端到端与 `admin-payments` 对账依赖后端模型线路、计费与对账数据；其失败可能部分源于后端契约/种子数据，需在裁定时一并核查。

---

## 6. 修复优先级与建议

| 优先级 | 范围 | 建议动作 | 是否改码 |
| --- | --- | --- | --- |
| **P0** | guest-promo 3 条（A 类·已确认） | 修 e2e 前置：清 `sessionStorage` + 等待 6s 空闲/强开开关；实现零改动 | 仅测试 |
| **P1** | sidebar 4 + workspace 复原 5 + product-parameters 6 + product-capabilities 部分（B 类） | 逐条对照参考站契约补实现或更新断言；属于 K3/K4 迁移债务主战场 | 实现+测试 |
| **P2** | admin-* / free-creation / state-contract / model-suite / payments（C 类，推测） | 先确认是否依赖后端数据/线路/权限；补种子或对齐后端契约，再决定前端改动 | 视裁定 |

> 注意：A 与 B/C 的处置路径相反——A 改测试不动实现，B/C 改实现（或对齐参考站契约）。**务必先逐条裁定类别，避免把「测试漂移」误当成「功能缺失」去改实现，或反之**。

---

## 7. 下一步与待裁定项

1. **guest-promo**：可直接进入测试修复（P0），实现无需改动。
2. **B/C 类**：需逐条打开 spec 断言 + 对应前端实现 +（必要时）后端契约，确认是补实现还是更新参考站契约。建议按模块分批（sidebar → workspace 复原 → 工具页参数 → admin 功能）。
3. **门禁基线**：在当前迁移阶段，建议将本报告的 35 条登记为「已知 e2e 差距基线」，每修复一批即从列表划除，避免门禁噪声掩盖新回归。
4. 完整 e2e 仍需约 18 分钟，建议 CI 中以「smoke 必过 + 全量 e2e 标记已知失败」方式接入，待差距收敛后再严格要求 0 失败。
