# 前端巨型文件瘦身审计

> 审计范围：`frontend/src` 下行数最大的 10 个 TSX 文件
> 审计维度：巨型组件拆分可行性、重复代码收敛度
> 状态：**批 0–5 已执行**（批 1–5 为纯搬移 + 拆解，无行为改动；每批执行结果见第五节），批 6/7 未启动
> 基线：`frontend/src` 约 97,698 行 TS+TSX；`frontend/src/pages` 下 494 个 ts/tsx 文件（含 `__tests__`）

## 一、结论先行

1. **真正的靶心只有 3 个文件**：`AdminDashboardPage.tsx`（三职责混装）、`ToolShell.tsx`（万能桶）、`works/page.tsx`（594 行连续 JSX）。其余 6 个要么已分层只是尾巴长，要么根本不该动。
2. **`admin-ui/primitives/form.tsx` 是伪目标**：766 行、0 个 `useState`、15 个 `export`，是 primitive 的合法聚合文件。拆分只会制造无意义的文件碎片。
3. **后台分层是正例，不要重构**：33 个 admin 域目录 **33/33** 都用了共享 hooks（`useAdminList` / `useAdminResource` / `useAdminUrlFilterSync` / `useAdminDetailParam` / `useDuty`），每个模块统一的 `page.tsx + api.ts + hooks.ts + constants.ts + utils.ts + index.ts` 结构。这层架构是对的。
4. **重复代码的真靶心在工具页的 props 样板**，不在组件本身：7 个工具页各自手写同一套 `sourcePane` / `renderUploadPreview` / `replaceUpload` 实现（`sourcePane={(images) => {` 出现 7 次、`renderUploadPreview={(uploads, controls) => {` 出现 7 次）。抽象点应当是 **ToolShell 的预设实现**，不是继续拆 ToolShell 调用方。

## 二、基线数据

| # | 文件 | 行数 | useState | useEffect | memo/cb | 本地子组件 | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | `pages/admin/AdminDashboardPage.tsx` | 1371 | 2 | 0 | 0 | 30+ lazy 声明 | **P0** |
| 2 | `components/ToolShell.tsx` | 1131 | 10 | 3 | 6 | 2 | **P0** |
| 3 | `pages/works/page.tsx` | 1095 | 21 | 5 | 10 | 0 | **P0** |
| 4 | `pages/admin/tasks/page.tsx` | 916 | 15 | 3 | 7 | 0（已外置 3 个） | P2 |
| 5 | `pages/creative-image/page.tsx` | 819 | 15 | 2 | 4 | 0 | **P1** |
| 6 | `pages/admin/orders/page.tsx` | 815 | 16 | 3 | 2 | 0（已外置 1 个） | P2 |
| 7 | `components/MattingResultEditor.tsx` | 810 | 17 | 6 | 12 | 0 | **P1** |
| 8 | `pages/checkout/page.tsx` | 778 | 21 | 5 | 6 | 0（已外置 4 个） | **P1** |
| 9 | `admin-ui/primitives/form.tsx` | 766 | 0 | 0 | 0 | 0（15 个 export） | **P3 不动** |
| 10 | `pages/admin/payments/PaymentsOrdersTab.tsx` | 760 | 13 | 3 | 3 | 1 | P2 |

## 三、逐文件裁定

### P0-1 `pages/admin/AdminDashboardPage.tsx`（1371 行）

三件事被塞进一个文件：

| 行段 | 内容 | 应该去哪 |
|---|---|---|
| `51–115` | 30+ 条 `lazyAdminPage(() => import('./xxx'))` 路由声明 | `pages/admin/routes.ts` |
| `1116` | `export function AdminDashboardContent()` — 概览页本体 | `pages/admin/dashboard/AdminDashboardContent.tsx` |
| `1132` | `export function AdminShell()` — 外壳、侧栏、面包屑、路由分发 | `pages/admin/AdminShell.tsx` |

**这属于职责错配，不是"文件太长"**。文件名承诺的是一个页面，实际交付的是整个后台的装配层。拆分点天然清晰、零逻辑改写风险：路由表是纯声明，`AdminShell` 与 `AdminDashboardContent` 之间已经是清晰的函数边界。

### P0-2 `components/ToolShell.tsx`（1131 行）

单文件内含 5 类实体：

| 行段 | 内容 | 类别 |
|---|---|---|
| `52–116` | `ToolAsset` / `ToolResult` / `ToolSettings` / `ToolResultCompare` / `UploadPreviewControls` / `ToolTrailingControl` | 类型契约 |
| `116` | `ToolTrailingContext` | Context |
| `279` / `296` | `ProductCardGenerating` / `ProductCardResult` | 展示组件 |
| `343–1090` | `ToolShell` 主组件（约 750 行） | 壳 |
| `1094` | `useTaskPoller` | **Hook（混在组件文件里）** |
| `1100` | `ExpandTextModal` | 弹窗组件 |
| `1091` / `1131` | `ToolEmptyIllustration` / `Maximize2` 再导出 | 纯粹的 barrel 行为 |

难点在于这是 **9 个工具页的公共依赖**（`background-remove`、`watermark-remove`、`image-translate`、`rotate-angle`、`image-expand`、`product-recolor`、`product-retouch`、`local-redraw`、`product-sku/ProductSkuWorkspace`），属于全站改动风险最高的节点。必须最后动、逐页回归。

### P0-3 `pages/works/page.tsx`（1095 行）

结构是标准的"巨型单组件"：

- `72` `WorksPage()` 开始 → `501` 才 `return`，即 **429 行逻辑前置**，其中 21 个 `useState` 全在主组件；
- `501–1095` 是 **594 行连续 JSX**，中间夹着多层内联 `map` 与条件分支；
- 目录里已有 `api.ts` / `hooks.ts` / `utils.ts` / `components.ts` / `WorkImage.tsx`，说明分层骨架已就位，但 **`page.tsx` 没有把 JSX 拆成组件**，于是骨架空转。

可拆点（按 JSX 段落边界，不需要改数据流）：
`WorksFilterBar`（四个筛选器区）、`WorksToolbar`（排序/计数/批量入口）、`WorksGrid`（列表与 `WorkImage`）、`WorksBatchBar`（批量下载）、`WorksEmptyState`（骨架/错误/空态）。

### P1-4 `components/MattingResultEditor.tsx`（810 行）

**状态密度全库最高**：17 个 `useState` + 6 个 `useEffect` + 12 个 `useMemo/useCallback`。`67–105` 是常量与纯函数区（`clamp` / `normalizeHex` / `hexToRgba` / `backdropOf` / `ratioValue` / `loadImage`），这部分可直接外移到 `utils`，零风险。

真正的问题是 17 个 state 里混了四类关注点：笔刷、缩放平移、背景/颜色、导出。建议先做**状态测绘**（state → 关注点归类）再动手，否则容易拆出一个 400 行的 hook 和一个 400 行的组件，总量不减反增。

### P1-5 `pages/checkout/page.tsx`（778 行）

已经拆出 4 张卡片（`CheckoutAmountCard` 241 / `CheckoutOrderCard` 81 / `CheckoutPaymentMethodCard` 128 / `CheckoutResultCard` 85），但主组件仍从 `79` 撑到 `717`，**638 行全是支付流程**：

| 行 | 内容 |
|---|---|
| `160` | `stopPolling` |
| `168` | `completePaidOrder` |
| `201` | `refreshPaymentStatus` |
| `421` | `placeOrder` |
| `453` | `startPolling` |

这是一个完整的状态机（下单 → 轮询 → 支付确认 → 结果），天然该抽成 `useCheckoutPayment()`，页面只负责渲染。抽出后 `page.tsx` 预计落到 200 行以内。

### P1-6 `pages/creative-image/page.tsx`（819 行）· `components/ImageLightbox.tsx`（729 行）

- `creative-image`：15 个 `useState`、**0 个子组件**，与 `works` 同病。目录里已有 `components.ts` barrel，缺的是真组件。
- `ImageLightbox`：10 个 `useEffect`，被多页复用（`ResultMedia` / `works` 等）。交互状态（缩放、拖拽、切换、键盘）四条链交织，建议按"手势/键盘/索引/加载"四类切 hook，**但它是公共组件，优先级排在 P0 之后**。

### P2 `tasks` / `orders` / `PaymentsOrdersTab`

三者都已正确分层（`admin/tasks` 已外置 `TaskDeleteDialog` / `TaskDetailDrawer` / `TaskStats`），`tasks/page.tsx` 是 `66` 起、`565` 才 `return`，剩余 JSX 约 350 行。**继续拆的边际收益低于 P0/P1**，列作可选批次。

### P3 `admin-ui/primitives/form.tsx` —— 不建议动

15 个 `export`、0 状态、全是 `radix-ui` + shadcn 原子的薄封装。766 行是**聚合文件应有的长度**，拆分只会破坏 `primitives` 的统一入口，与 `CLAUDE.md` 的"页面只从 `admin-ui/primitives` 取件"约束直接冲突。

## 四、重复代码收敛

### 4.1 已做对的部分（不要动）

| 正例 | 证据 |
|---|---|
| 工具页统一走 `ToolShell` | 9 个页面引用同一壳 |
| 后台共享 hooks | 33/33 域目录命中至少一个共享 hook |
| 每模块统一文件结构 | `page/api/hooks/constants/utils/index` 全量一致 |
| 页面组件只从 barrel 取件 | `components.ts` 明确约定"不从 `src/components` 直接取" |

### 4.2 真实重复：工具页的 props 样板

对 7 个工具页做跨文件行频统计，**有 58 行不同代码出现在 ≥4 个文件中**：

| 重复片段 | 出现文件数 |
|---|---|
| `setResult(null);` | 8 |
| `sourcePane={(images) => {` | 7 |
| `renderUploadPreview={(uploads, controls) => {` | 7 |
| `replaceUpload` | 7 |
| `const image = uploads[0];` / `const image = images[0];` | 7 / 7 |
| `submitting={submitting}` / `result={result}` | 7 / 7 |
| `setSourceUrl(inputs[0]?.url ?? '');` | 6 |
| `onHistoryReuse={handleHistoryReuse}` | 6 |

单点对比更直观：`background-remove/page.tsx` 全文件 165 行，与 `watermark-remove/page.tsx` 有 **70 行完全相同**，占前者 42%。

**裁定**：这是 `ToolShell` 的 props 契约缺少默认实现导致的。正确解法是在 `ToolShell` 侧提供 **preset**——把"单图入参 + 上传预览 + 结果替换"这套最常见组合封装成开箱即用的默认 `sourcePane` / `renderUploadPreview`，各页只在有差异时覆盖。这样收敛的是 7 份重复样板，而不是再造一层抽象。

### 4.3 未成立的猜测

审计前怀疑"前台列表页各自实现分页"，实测只有 `works` 与 `invitations` 两页有 `loadMore` 模式，**不构成规模问题，不列入批次**。

## 五、批次方案（待确认）

| 批次 | 内容 | 风险 | 预估收益 |
|---|---|---|---|
| **0** ✅ | 加文件体积守卫（`scripts/check-file-size.mjs`，>500 行告警 / >800 行报错 + 存量基线棘轮），接入 `typecheck` 与三条 build | 极低 | 建立长期约束 |
| **1** ✅ | `AdminDashboardPage.tsx` 三分离：`routes.ts` + `AdminShell.tsx` + `dashboard/AdminDashboardContent.tsx` | 低（纯搬移） | −1371 → 单文件均 <300 |
| **2** ✅ | `ToolShell.tsx` 解构：类型 → `toolShellTypes.ts`，`useTaskPoller` → `hooks/`，`ExpandTextModal`/卡片 → 独立组件 | **高**（9 页依赖） | −1131 → 主组件 819 |
| **3** ✅ | `works/page.tsx` 拆 JSX：`useWorksFilters` + Toolbar / Grid / EmptyStates | 中（有 `__tests__`） | −1095 → page 499 + 4 文件 |
| **4** ✅ | 工具页样板收敛：`ProductSourcePreview` 加两个 render prop 工厂 | 低（实际只 4 页同构） | 4 页各减 10–12 行，重复样板归零 |
| **5** ✅ | `checkout` 抽 `useCheckoutPayment`（只抽「怎么付」，不抽「为什么付」） | 中（支付链路，无 e2e） | −778 → page 403 + hooks 453 |
| **6** | P1 剩余：`creative-image` 拆 JSX、`MattingResultEditor` 先做状态测绘、`ImageLightbox` 四类 hook | 中高 | 视测绘结果定 |
| **7** | （可选）`tasks` / `orders` / `PaymentsOrdersTab` 尾部 JSX | 低 | 边际 |

### 批 1 执行结果（已完成）

`AdminDashboardPage.tsx` 1371 行 → 4 个文件：

| 文件 | 行数 | 职责 |
|---|---|---|
| `pages/admin/routes.ts` | 84 | `lazyAdminPage` + 33 个懒加载路由常量 |
| `pages/admin/AdminShell.tsx` | 328 | 路由守卫、错误页、布局、子路由挂载、`admin.css` |
| `pages/admin/dashboard/AdminDashboardContent.tsx` | 1002 | 概览页内容 + 12 个构件 + 6 个工具函数 |
| `pages/admin/AdminDashboardPage.tsx` | 15 | barrel：`App.tsx` 按名取 `AdminShell` 的入口契约 |

顺手修正两处腐坏注释：`App.tsx` 与 `components/ExceptionPage.tsx` 里 `AdminDashboardPage.tsx:288` 的行号引用（该原则已移入 `AdminShell.tsx`，行号引用改为文件引用）。

验证：`tsc --noEmit` 通过；`vitest run src/pages/admin src/test` 48 passed；`vite build` 成功（后台 chunk `AdminDashboardPage-*.js` 111K / CSS 77K）。拆分前后代码行做多重集比对，差异仅为 `const → export const`、组件改名、删除旧中转包装，**无逻辑丢失**。

> 注：`npm run build` 在本机会被 safe-delete 守卫拦截（vite 清空 `dist/assets` 218 个文件超过批量删除阈值），与代码无关。验证构建请用 `npx vite build --outDir dist-verify`。

### 批 2 执行结果（已完成）

`components/ToolShell.tsx` 1131 行 → 5 个文件：

| 文件 | 行数 | 职责 |
|---|---|---|
| `components/ToolShell.tsx` | 819 | 主壳（上传 / 业务卡 / 提交 / 结果栏 / 历史栏 / 素材库 / 手机上传）+ 对外再导出 |
| `components/toolShellTypes.ts` | 233 | 类型契约：`ToolAsset` / `ToolResult` / `ToolSettings` / `ToolResultCompare` / `UploadPreviewControls` / `ToolTrailingControl` / `ToolTrailingContext` / `UploadSpec` / `SettingsSpec` / `Props` |
| `components/ToolResultCards.tsx` | 82 | `ProductCardGenerating` / `ProductCardResult`（仅内部使用，不对外暴露） |
| `components/ExpandTextModal.tsx` | 32 | 放大编辑弹窗 |
| `hooks/useTaskPoller.ts` | 15 | 任务轮询薄封装（此前是唯一混在组件文件里的 hook） |

**删除死代码**：`RATIO_LABEL`（原 `ToolShell.tsx:271`）只定义、全仓零引用。

**导出面零变化**：9 个工具页均经各自 `components.ts` barrel 转发 `import { ToolShell, type ToolAsset, ... } from '../../components/ToolShell'`；`ToolHistoryPane` / `SkuHistoryPane` 取 `ToolTrailingContext`，`ProductSourcePreview` 取 `ToolAsset & UploadPreviewControls`。全部符号由 `ToolShell.tsx` 继续再导出。

验证：`tsc --noEmit` 0；**全量**前端单测 66 文件 / 349 用例通过；`vite build` 成功。代码行多重集比对差异仅为：`interface → export interface`、两个卡片 `function → export function`、删除 `RATIO_LABEL`、新增再导出语句 —— **无逻辑丢失**。

**不做**：`admin-ui/primitives/form.tsx`、后台 `page/api/hooks/constants/utils` 分层、`ToolShell` 的调用方重写。

### 批 3 执行结果（已完成）

`pages/works/page.tsx` 1095 行 → 5 个文件（目录内文件由 9 个增至 13 个，仍符合 `docs/frontend-module-conventions.md`）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `pages/works/page.tsx` | 499 | 取数（`load` / `loadMore`）、写操作（删 / 下载 / 重试 / 批量下载）、页面编排 |
| `pages/works/useWorksFilters.ts` | 218 | 四个筛选器 10 个 state、浮层开合、点击空白 + Esc 关闭、`filtered` / `sorted` / `bizGroups` / `matchedTasks` 推导 |
| `pages/works/WorksToolbar.tsx` | 308 | 工具栏 + 四个筛选浮层 + 清除筛选 + 下载所选 |
| `pages/works/WorksGrid.tsx` | 261 | 卡片网格（已出图 / 生成中 / 失败三态）+ 大图查看器 |
| `pages/works/WorksEmptyStates.tsx` | 68 | 访客态、已登录空态（含筛选无结果） |

关键判断：

- **筛选状态必须整体抽成 hook，而不是摊成 props。** 工具栏要读 10 个 state + 5 个派生值 + 2 个动作，直接抽组件会得到 28 个 prop 的装配样板 —— 正是审计里指出的问题本身。改由 `useWorksFilters` 持有，`WorksToolbar` 收一个 `filters` 整体后在函数体内解构，`page.tsx` 只 `const { sorted, activeFilterCount } = filters`。
- **写操作留在 `page.tsx`。** 约定第 2 条明确 `page.tsx` 承载「提交 / 删除 / 启停」，因此 `removeTask` / `retryTask` / `downloadWork` / `downloadSelected` 未外移，这也是 page 停在 499 行而非 300 行的原因。
- **`utils.ts` 补一个类型出口。** `useWorksFilters` 需要 `CapabilitiesData`，按约定目录内文件不直连 `src/lib/*`，故在 `utils.ts` 增加 `export type { CapabilitiesData }`。

验证：`tsc --noEmit` 0；`vitest run` 66 文件 / 349 用例通过（含 `works-modules.test.ts` 的具名导入对账）；`vite build` 成功（`works-*.js` 20.8K）；`check:shadcn` 通过。代码行多重集比对差异仅为：`useState<'image' | 'video'>` → `WorksTab`、`closeAll`/`toggleIn` 包 `useCallback`、勾选回调整理为 `onToggleSelect(t.id)`、两处空态按钮折叠为单行，**无逻辑丢失**。

### 批 0 执行结果（已完成）

新增 `frontend/scripts/check-file-size.mjs`：

- **阈值**：单文件 > 500 行告警，> 800 行报错。
- **棘轮**：已登记基线的 9 个存量超标文件（`lib/api.ts` 2715、`types/api.d.ts` 2359、`dashboard/AdminDashboardContent.tsx` 1002、`types/model.ts` 926、`tasks/page.tsx` 916、`creative-image/page.tsx` 819、`ToolShell.tsx` 819、`orders/page.tsx` 815、`MattingResultEditor.tsx` 810）**只许变短**：超过基线一行即报错，低于基线会提示下调基线。新增文件一律不得越过 800 行。
- **接入**：`npm run check:file-size`，并链入 `typecheck` 与 `build:dev` / `build:test` / `build:prod`。
- **自证**：塞入 900 行探针文件后脚本 exit 1 并点名该文件；移除后 exit 0。

为什么不做成「超过 800 就一律失败」：现存 9 个文件会立刻让门禁红掉，团队第一反应是把守卫关掉。棘轮把约束加在**增量**上，才守得住。

### 批 4 执行结果（已完成）

审计阶段的预估「7 页各减 40–80 行」**不成立**，实测只有 4 页同构。逐页量化后：

| 页面 | `renderUploadPreview` | `sourcePane` | 是否同构 |
|---|---|---|---|
| `image-translate` | 6 行 | 4 行 | 是 |
| `product-recolor` | 6 行 | 4 行 | 是 |
| `product-retouch` | 6 行 | 4 行 | 是 |
| `rotate-angle` | 6 行 | 6 行 | 是（仅多一个 `className`） |
| `background-remove` | 24 行 | 27 行 | 否，定制预览与画布 |
| `image-expand` | 27 行 | 14 行 | 否 |
| `watermark-remove` | 33 行 | 117 行 | 否，遮罩编辑器 |
| `local-redraw` | 33 行 | 134 行 | 否，画笔画布 |

后 4 页的重复只是「长得像」，实际是各自定制的画布与预览结构；参数化成 preset 会得到一个满是 boolean 开关的组件，比重复更差 —— **不做**。

实际改动：`components/ProductSourcePreview.tsx` 增加 `productSourceUploadPreview(alt)` / `productSourcePane(alt, className?)` 两个工厂（该文件原本已注释「四个页面共用这一份结构」，只是 12 行包装仍各写一遍），4 个页面的样板改为一行调用，4 个 `components.ts` barrel 同步补 re-export。

净收益：4 页各减 10–12 行、重复样板归零；**行数几乎持平**（工厂 22 行 + 4 个 barrel 各 6 行 ≈ 页面省下的 46 行）。真正的收益是「改预览结构只改一处」，不是省行数。

验证：`tsc --noEmit` 0；`vitest run` 66 文件 / 349 用例通过；`vite build` 成功；体积守卫通过。

### 批 5 执行结果（已完成）

**先说前提**：`checkout` 没有 e2e。`tests/` 下 19 个 spec 全是 admin 与工作台，`npm run e2e` 用的是 `playwright.admin.config.ts`，全仓 `grep checkout` 在 e2e 目录零命中。所以这批的行为回归没有自动化锚点，只能靠 tsc + 命名导入对账 + 代码行等价性比对，视觉与流转向人工。这也是把拆分边界刻意划窄的原因。

#### 拆分前的状态测绘

`checkout/page.tsx` 拆前 778 行：**19 个 `useState` / 3 个 `useRef` / 5 个 `useCallback` / 4 个 `useEffect`**，`return` 从第 717 行才开始 —— 也就是说 JSX 只占约 100 行，**问题不在 JSX 长，在状态机厚**。

| 分组 | 状态 | 归属 |
|---|---|---|
| 结算对象 | `product` `plan` `order` `loading` | 页面 |
| 支付执行 | `paying` `error` `phase` `result` `onlineIntent` `qrDataUrl` `refreshingPayment` `paymentStatusNotice` | hook |
| 渠道选择 | `providers` `selectedProviderId` `providersLoading` `providersError` | hook |
| 券码试算 | `couponCode` `quotePreview` `quoteError` | 页面 |

ref 三个各有用意：`pollRef`（轮询句柄）、`idemKeyRef`（幂等键必须用 ref，重渲染换 key 会导致后端当两笔新单各扣一次）、`autoQueriedOrderRef`（渠道回跳的自动查单只跑一次，挡 StrictMode 双执行）。

状态迁移只有两条出口：`confirm` 在「完单收尾」时写 `setResult` + `setPhase('result')` 进 `result`，且**完单收尾有三处**（`completePaidOrder` / `payOnline` 的 0 元分支 / `pay` 的 success 与 timeout），三处各自做「查余额 + `notifyCreditsChanged` + 组装 `ResultView`」。这是本页最明显的一处重复，但也是**最不该在没有 e2e 时动的地方**，故未合并。

#### 边界怎么划

**只抽「怎么付」，不抽「为什么付」。**

- 移入 hook：建单/复用既有订单 → 发起渠道支付（sandbox / redirect / qrcode / free 四态）→ 轮询到账 → 主动查单 → 收尾切结果页。
- 留在页面：商品 / 会员套餐 / 续付订单的加载、券码试算防抖。这两条 effect 决定的是「在为什么付款」，与支付执行正交。

| 文件 | 行数 | 职责 |
|---|---|---|
| `hooks.ts` | 453 | `useCheckoutPayment` 支付状态机 + `notifyCreditsChanged` 转出 |
| `page.tsx` | 403 | 结算对象加载、券码试算、金额口径推导、渲染 |
| `utils.ts` | 72 | 新增 `ORDER_STATUS_TEXT` / `isOrderPayable` / `blockedReasonOf` |

`blockedReasonOf` 上移到 `utils.ts` 是必要的：页面用它渲染「不能支付」提示，状态机在真正发起支付前用它再拦一次，两边必须是同一份判定，否则会出现「按钮放行了但接口 409」。

#### 两个必须记住的约束

1. **`refreshPaymentStatus` 的引用必须稳定。** 它在页面加载 effect 的依赖数组里（`page.tsx:220`，用于渠道回跳时自动查单）。依赖链 `stopPolling([])` → `completePaidOrder([stopPolling])` → `refreshPaymentStatus([completePaidOrder, stopPolling])` 全部落在稳定闭包上。往这个链条里加一个每次重建的依赖，加载 effect 会无限重跑并持续打接口 —— 而 tsc 和单测都不会报。
2. **`order!` 非空断言仍留在页面**（`page.tsx:398`，`onRefreshPayment`）。它成立的前提是 `CheckoutAmountCard` 内部对刷新按钮做了 `{order && ...}` 守卫 —— 子组件一旦去掉守卫就会运行时报错。

#### 切片踩坑（值得复用到批 6）

用行号切片搬函数体时**漏了整个支付渠道加载 effect**，而 `tsc` 完全发现不了 —— `providers` 等 state 仍声明着，只是永远不被填充。是「代码行多重集比对」把它揪出来的。同一轮还漏了 `/** 下单。重复调用复用同一 key */` 这行注释，因为多重集比对默认过滤注释。

结论：**搬移后的比对要做两遍**，一遍过滤注释（看逻辑），一遍保留注释（看文档资产），否则注释会静默蒸发。

#### 门禁

`tsc --noEmit` 0；`vitest run` 66 文件 / 349 用例（含 `checkout-modules.test.ts` 的具名导入对账）；`vite build` 成功（`checkout-*.js` 19K / 473 产物）；体积守卫通过。等价性比对（保留注释）旧代码只少 3 行：2 行 `function → export function` 改名、1 行 `utils.ts` 头部注释改写，**无逻辑与注释丢失**。

#### 本批发现但未修的缺陷

`completePaidOrder` 首行先 `stopPolling()` 再 `ordersApi.detail()`。若 detail 抛错（网络抖动），`startPolling` 的 interval 回调 catch 只处理 401/403，其余静默 → **订单实际已 paid，但页面停在确认页、轮询已停、无任何提示**，用户需手点「我已完成支付，刷新状态」才能恢复。

修法很轻（detail 失败时回退到已有 `order` 并仍进结果页，或至少 `setError`），但它改的是支付完单语义，**在没有 e2e 的前提下不应顺手改**。列入批 6 前置条件：先补一条「沙箱支付成功 → 结果页」的 e2e，再修。

## 六、门禁与风险

每批结束必须全绿后才进下一批：

```
tsc --noEmit  →  vitest run  →  build  →  playwright（受影响页面）
```

具体风险点：

1. **`ToolShell` 是最大单点风险**——9 个工具页共享，批 2/4 必须逐页手动回归，不能只靠单元测试。
2. **`works` 与 `checkout` 有 `__tests__`**，拆分时同步迁移测试，不允许"先删后补"。
3. **`checkout` 没有 e2e**——`tests/` 下 19 个 spec 全是 admin 与工作台，`npm run e2e` 用 `playwright.admin.config.ts`。批 5 已在无 e2e 的前提下完成（纯搬移 + 等价性比对兜底），但**任何改支付语义的改动都必须先补 e2e**，见批 5 小节末尾的已知缺陷。
4. **不引入新依赖**，不改变任何网络契约（`api.ts` 的 573 个方法签名一律不动）。
5. **保持 JSDoc 与现有注释**——本仓库的注释密度是资产，搬移时随代码走，不要顺手删。
6. **搬移后做两遍等价性比对**——一遍过滤注释看逻辑，一遍保留注释看文档资产。批 5 实测：只做过滤注释那一遍，会漏掉整块被遗忘的 effect，也会漏掉静默蒸发的注释。

## 附：审计方法

| 手段 | 用途 |
|---|---|
| `wc -l` 全量排序 | 定位巨型文件 |
| 计数 `useState` / `useEffect` / `memo/cb` | 判断状态复杂度与组件肥大程度 |
| 结构骨架扫描（顶层函数 / `return` 行号） | 区分"逻辑前置"与"JSX 过长" |
| `lazyAdminPage` / 共享 hook 命中统计 | 判定模块是否已分层 |
| 跨文件行频统计（`sort \| uniq -c`） | 量化重复代码，避免凭感觉 |
