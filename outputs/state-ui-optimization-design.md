# 页面状态 UI 优化设计方案

> **状态：规划中，未实施。**
> 本文件为仓库外交付物（`outputs/`），未落入 `docs/`，未改动任何源码与文档索引。依据 `docs/README.md:100`：审计报告、取证日志与逐轮实施记录不进 `docs/`；若后续裁定归档，需同批更新 `docs/README.md` 分类表。
>
> **裁定口径（2026-11-05）**：只出方案不改码 ｜ 缺省图用内联 SVG + 设计令牌 ｜ 验证仅静态对拍，不跑 `tsc` / `vitest` / `build` / `e2e`。
>
> **事实源**：本轮只读审计 `frontend/src`（826 个 `ts/tsx/css`）。文中所有 `file:line` 为审计时点快照，**实施前必须重读目标代码并复核行号**；与文档描述冲突时以实际代码为准。

---

## 1. 结论与原则

**结论：这轮不是「补一套状态组件」，而是「把已有的统一层铺满 + 补上唯一真实缺口」。**

`components/StateViews.tsx`（2026-10-20 抽取，`StateSkeleton` / `StateLoading` / `StateEmpty` / `StateError` / `StateButton` + 全 token 化 `StateViews.css`）、`components/ExceptionPage.tsx`、`components/ErrorBoundary.tsx`、`App.tsx:112` 的 `RouteFallback`、后台 `admin-ui/primitives/skeleton.tsx`（8 个骨架件）与 `admin-ui/primitives/table.tsx:305-323`（三态内建）均已存在且设计完整。真实问题是三件事：

| # | 问题 | 证据 |
|---|---|---|
| 1 | **统一层只铺了约三成页面**，另有 4 套并行写法并存 | `StateViews.tsx:10-24` 注释自述抽取前 20+ 页各写一遍；现存 ~21 处裸 `<Spin>`、~28 处纯文字加载、7 处手写 spinner、12 种私有空态容器 |
| 2 | **图片兜底几乎为零**（唯一的结构性缺口） | 约 120 处 `<img>` / 73 文件，仅 8 处有失败处理；无统一 fallback 常量；`ResultMedia.tsx:104` 的 1×1 透明像素是唯一「占位」 |
| 3 | **失败态谎报状态** | ≥39 处 `catch` 内仅 `message.error`；`StateViews.tsx:139-143` 注释自己点名「接口没连上被渲染成空态」，但写操作链路仍未修 |

**四条硬原则**（对齐 `CLAUDE.md:41,345,359,393` 与最小 diff 约定）：

1. **复用优先**：不新建组件库、不引入依赖、不新增静态图片资源；收敛到 `StateViews` / `admin-ui/primitives` barrel。
2. **单一事实源**：状态件、插画、错误码、文案各只留一处定义。
3. **零视觉回归**：旧别名不硬删，采用「新增统一件 → 新代码强制走统一件 → 旧调用点分批迁移」，避免一次改 21 处 `<Spin>` 带来的视觉与 e2e 风险。
4. **令牌纪律**：新增 SVG 色值只用现有 `var(--brand-bg)` / `var(--card-bg)` / `var(--border-soft)` / `var(--illus-sun)` / `var(--illus-mountain)` / `var(--brand)` / `var(--brand-light)`（`illustrations.tsx:34-44`）；不写裸 hex；字号不小于 12px。

---

## 2. 目标分层（收敛后）

| 层 | 唯一入口 | 职责 | 现存对应 |
|---|---|---|---|
| L1 插画层 | `components/illustrations.tsx` | 全部内联 SVG 状态插画与缺省图，唯一定义地 | 已有 7 个 + `StateKind` |
| L2 C 端状态层 | `components/StateViews.tsx` | 骨架 / 加载 / 空 / 失败 / 按钮五态 | 已有，保持不变并小幅补强 |
| L3 C 端异常层 | `components/ExceptionPage.tsx` | 整屏与页内异常页、404、403、离线、5xx | 已有 `ExceptionPage` / `NotFoundPage`，需补预设 |
| L4 图片兜底层 | `components/StateImage.tsx`（**新增**） | 全站 `<img>` 加载失败、占位、重试 | 无，当前散在 5 处 |
| L5 C 端取用层 | `ui/index.ts` | 页面唯一取件口，`Empty`/`Spin` 转发到 L2 | `ui/index.ts:22,24` 为 antd 兼容壳 |
| L6 后台状态层 | `admin-ui/primitives/index.ts` | 后台三态、骨架、错误条 | 已有；`table.tsx:305-323` 已内建三态 |
| L7 语义层 | `lib/`（**新增/合并**） | 错误码 → 文案、HTTP 状态 → 文案、空态文案表 | 现 3 套分叉 |

**跨层禁令**：后台页面只从 `admin-ui/primitives` barrel 取件（`CLAUDE.md:295`），不得反向引用 `components/StateImage.tsx`；后台图片兜底在 primitives 内做薄封装。

---

## 3. 组件契约设计

### 3.1 `StateImage`（新增，L4 唯一入口）

行为契约逐条取自现有已验证实现，不重新发明：

| 契约 | 依据 |
|---|---|
| 失败态按 **src 派生**而非布尔值，签名 URL 刷新后自动恢复 | `ResultMedia.tsx:54-60`、`WorkImage.tsx:9,26-31` |
| `img.complete && naturalWidth === 0` 补检，覆盖缓存命中不触发 `onError` | `ResultMedia.tsx:62-66` |
| 失败后换 1×1 合法透明像素并清空 `alt`，避免破图图标撑乱网格 | `ResultMedia.tsx:98-112` |
| `data-broken='1'` 钩子交 CSS 补中性底色 | `global.css:1811` |
| 重试走 `retryNonce` + `key`，同时复位 loaded/failed | `WorkImage.tsx:28,39-43,55` |
| 保留 `loading` / `fetchPriority` / `decoding` 语义，首屏 `priority` | `ResultMedia.tsx:114-116` |
| 默认占位 = `ImageOff` 图标 + 尺寸稳定容器，可传 `fallback?: ReactNode` 覆盖 | `AssetThumb.tsx:20-32`、`WorkImage.tsx:64-69` |

建议签名（**设计稿，非已实现**）：

```ts
interface StateImageProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  fallback?: ReactNode;      // 默认 StateImagePlaceholder
  retryable?: boolean;       // 默认 true
  onLoad?: () => void;
  onFailed?: (src: string) => void;
}
```

`ResultMedia` 保留模态分流与 AIGC 角标（`ResultMedia.tsx:71-95`），仅把**图片分支**委托 `StateImage`；`WorkImage` 保留方形画布、shimmer 与淡入（`WorkImage.tsx:45-70`），仅把内层 `<img>` 委托。两者业务语义不得被通用件吞掉。

### 3.2 缺省图集（内联 SVG + token，L1）

在 `illustrations.tsx` 扩 `StateKind`，新增 6 个语义插画，统一 160×160、`viewBox="0 0 160 160"`、`aria-hidden`，沿用「圆角方框 + 品牌紫圆徽标」母题（`illustrations.tsx:13-18`）：

| kind | 语义 | 典型落点 |
|---|---|---|
| `empty-list` | 列表没数据（可复用 `ToolEmptyIllustration`） | 订单 / 工单 / 流水 / 后台表格 |
| `no-result` | 筛选无结果，引导放宽条件 | 各类筛选态 |
| `image-placeholder` | 通用图片位为空 | 模板卡 / 场景卡 / 商品图 |
| `image-broken` | 图片加载失败 | `StateImage` 默认占位 |
| `offline` | 网络断开 | 全局离线提示 |
| `forbidden` | 无权限 | 403 页 |

**不新增设计令牌**；若确需新色，按 `CLAUDE.md:345` 在 `styles/global.css` 的 `:root` 单点定义并全站替换。`frontend/public/asset-library/empty.svg` 是唯一静态空态插画，P0 保留、P2 再定是否下线（见 D3）。

### 3.3 失败 / 异常语义（L3 + L7）

- **任务失败态**：新增 `TaskFailureState`（或扩 `StateError` 的 `variant`），按错误码分流动作：
  - `42201` / `42202` / `42203` / `42204` / `42205` / `CANCELLED` → 「积分已退回」+ 重新生成（文案取 `lib/constants.ts:138-144`）
  - `42206` → **「结果暂不明确，积分已冻结，等待人工核对」+ 去「我的作品」/ 提交工单，绝不出现「已退款/重试生成」**（`CLAUDE.md:239` 结果不明不切线、不自动退款，账单 `uncertain` 只能人工处置）
  - `POLL_TIMEOUT` → 「任务可能仍在后台生成」+ 去「我的作品」
- **错误码单一事实源**：合并 `lib/constants.ts:134-152`（8 码）与 `lib/admin-error-codes.ts:8-19`（4 码）及 `pages/multi-image-fusion/utils.ts:142-143`；`taskErrorText` / `taskErrorLabel` **保留具名导出**作别名，避免 40+ 调用点批量改 import。
- **新增 HTTP 状态 → 用户文案表**：`lib/api.ts:232-307` 现只有 401/403 特判与 `请求失败（${res.status}）` 兜底；补 0（网络）/ 403 / 429（带 `Retry-After`）/ 5xx（带 `requestId`）的集中映射，抛错语义不变。
- **异常页预设**：`ExceptionPage.tsx` 补 403 / offline / 5xx 三组预设；全局 `offline` 监听当前 0 处，建议在 `App.tsx` 壳层加一处轻量监听（不新增 Provider）。

### 3.4 空态文案（L7，P2）

新增 `lib/state-copy.ts`，按「没有数据 / 筛选无结果 / 还没做过」三类收口（`StateViews.tsx:104-108` 已给出分类口径）。当前 ~158 处文案 / 89 文件，同页多措辞典型：`StatsPage.tsx:154,290,306,358` 四种；同一「订单为空」有 `OrdersPage.tsx:399` / `:427` / `AccountOrdersCard.tsx:37` 三种。**P2 分批迁移，不在 P0 动。**

---

## 4. 逐文件改动清单

> 改动类型：`新增` / `改` / `删` / `替换调用` / `仅登记`。所有行号需在实施前重读复核。

### P0 — 收敛与兜底（建议首批，完成后停下验收）

| # | 文件 | 类型 | 改动 |
|---|---|---|---|
| 1 | `components/StateImage.tsx` | 新增 | §3.1 统一图片兜底件 + `StateImagePlaceholder`（内联 SVG + token） |
| 2 | `components/illustrations.tsx` | 改 | 扩 `StateKind` 6 个语义插画；不新增裸 hex（§3.2） |
| 3 | `components/ResultMedia.tsx:98-119` | 替换调用 | 图片分支委托 `StateImage`；保留视频分流、AIGC 角标、按 src 记失败 |
| 4 | `pages/works/WorkImage.tsx:45-70` | 替换调用 | 内层 `<img>` 委托；保留方形画布、shimmer、淡入、点击重试语义 |
| 5 | `components/ResultGalleryPane.tsx:130-171` | 替换调用 | 现有 `setFailedUrl` 兜底收敛到 `StateImage` |
| 6 | `components/ImageLightbox.tsx:646-662` | 替换调用 | 原图「正在加载 / 加载失败 / 重新加载」收敛；保留 lightbox 业务层 |
| 7 | `admin-ui/primitives/` 新增薄封装 | 新增 | 后台版 `AssetThumb` 兜底，只从 barrel 取件（见 D1） |
| 8 | `pages/admin/assets/AssetThumb.tsx:8-45` | 改 | 改用后台薄封装，保留 `bg-muted` / `role="img"` / `aria-label` |
| 9 | `ui/primitives/avatar.tsx:19` | 改 | `src` 失败回落首字母 / children，补 `onError` |
| 10 | `pages/landing/page.tsx`（14 处 `<img>`） | 替换调用 | 营销图统一兜底；首屏图传 `priority` |
| 11 | `pages/library/page.tsx:600` | 替换调用 | `/asset-library/empty.svg` 自身补兜底 |
| 12 | `pages/shoppable-carousel/TemplateGrid.tsx` | 替换调用 | 模板缩略图兜底，与 `.sc-template-grid-empty` 共存 |
| 13 | `pages/multi-image-fusion/MultiFusionSceneGateway.tsx:27` | 替换调用 | 15 张场景预览图补兜底（现有「图标留底层自然兜底」注释失效，需同步改注释） |
| 14 | `pages/checkout/CheckoutAmountCard.tsx` | 替换调用 | 商品图补兜底 |
| 15 | `components/SkuResultPanel.tsx:247`、`SkuHistoryPane.tsx:104` | 替换调用 | CSS `.product-sku-thumb-placeholder` 换统一占位 |
| 16 | `ui/primitives/empty.tsx:4,11` | 改 | `image?: ReactNode` 声明未使用——补实现或删接口（见 D2） |
| 17 | `ui/index.ts:22,24` | 改 | `Empty` / `Spin` 转发到 `StateViews` 或标注弃用引导；不删导出 |
| 18 | `components/ExceptionPage.tsx:211,225` | 删 / 接入 | `HomeLink` / `LoadFailedPage` 全局 0 引用，删死代码或正式接入 |
| 19 | `components/StateViews.css`、`styles/global.css:5622` | 改 | 补 `StateImagePlaceholder` 与 `.ui-empty` 图标位样式，全 token |
| 20 | 后台 10+ 页外层三态 | 删 | 去掉组件外重复的 `loading → PageSkeleton` / `error → ListError` / `!data → EmptyState`，交 `AdminDataTable`：见 `admin-ui/primitives/table.tsx:305-323` 与 `pages/admin/{membership-plans/page.tsx:137-147, settings/page.tsx:179-201, storage/page.tsx:91-106, payments/PaymentsProductsTab.tsx:277-280, dashboard/AdminDashboardContent.tsx:75, scheduler/page.tsx:75, backups/page.tsx:140, roles/page.tsx:168, aigc-label/page.tsx:130, marketing-rules/page.tsx:104, payments/PaymentsProvidersTab.tsx:212}` |

### P1 — 失败 / 异常语义

| # | 文件 | 类型 | 改动 |
|---|---|---|---|
| 21 | `components/TaskFailureState.tsx` | 新增 | §3.3 按错误码分流，42206 专项 |
| 22 | `lib/constants.ts:134-152`、`lib/admin-error-codes.ts:8-19`、`pages/multi-image-fusion/utils.ts:142-143` | 改 | 合并为单一错误码事实源；保留 `taskErrorText` / `taskErrorLabel` 具名导出 |
| 23 | `lib/http-error-copy.ts` | 新增 | HTTP 状态 → 用户文案；`lib/api.ts:232-307` 接入，抛错语义不变 |
| 24 | `components/ExceptionPage.tsx` | 改 | 补 403 / offline / 5xx 预设 |
| 25 | `App.tsx` 壳层 | 改 | 新增一处 `offline` 监听（当前 0 处），渲染全局离线提示 |
| 26 | 生成任务 toast-only 6 处 | 改 | `pages/creative-image/page.tsx:467`、`pages/viral-clone/page.tsx:431`、`pages/multi-image-fusion/page.tsx:365`、`hooks/useToolTask.ts:84`、`hooks/useGenerateError.ts:30`、`components/ToolShell.tsx:727` → 补页面级失败态 |
| 27 | ≥39 处 `catch` 仅 toast 中的 10 处高价值点 | 改 | 优先 `pages/account/page.tsx`（7 处）、`components/AuthCard.tsx`（3 处）：补内联错误条 + 重试出口 |
| 28 | `docs/api-contract.md` | 仅登记 | 若 42206 前端文案调整，需与该文档错误码语义对齐（本轮不改） |

### P2 — 一致性收尾

| # | 文件 | 类型 | 改动 |
|---|---|---|---|
| 29 | `lib/state-copy.ts` | 新增 | 空态文案单一事实源；89 文件 / ~158 处分批迁移 |
| 30 | 21 处 `<Spin>`、28 处纯文字加载、7 处手写 spinner | 替换调用 | → `StateSkeleton` / `StateLoading`；含 `components/history-pane.css:128` 复刻的 `@keyframes state-spinner-rotate` 清理 |
| 31 | 12 种私有空态容器 | 替换调用 | `.lp-empty` / `.account-empty` / `.wb-*-empty` / `.order-filter-empty` / `.ticket-filter-empty` / `.sc-*-empty` / `EmptyInline`（`AdminDashboardContent.tsx:410`）等 → `StateEmpty` |
| 32 | `styles/global.css:162,173`、`styles/route-fallback.css:84` | 改 | `--wb-visual-empty: #c7c7c7` / `--wb-empty: #686d77` / 裸 `rgba()` → token |
| 33 | `components/StateViews.tsx:44` | 改 | C 端骨架补 `data-testid`，对齐后台 `PageSkeleton` 的 `admin-page-loading` 锚点 |
| 34 | `frontend/public/asset-library/empty.svg` | 仅登记 | P2 决定保留或下线（D3） |

---

## 5. 偏差与待裁定项

| 编号 | 偏差 | 建议 | 需裁定 |
|---|---|---|---|
| D1 | 后台 `AssetThumb` 复用 C 端 `StateImage` 会违反 `CLAUDE.md:295`（后台只从 primitives 取件） | 在 `admin-ui/primitives` 做独立薄封装，不跨层引用 | 是 |
| D2 | `ui/index.ts` 的 `Empty` / `Spin` 仍有 21 处调用，直接改转发会一次性改变视觉 | 新代码强制走 `StateViews`，旧别名标注弃用、P2 分批迁移，**不硬删** | 是 |
| D3 | `public/asset-library/empty.svg` 是唯一静态空态资源，与「内联 SVG」裁定冲突 | P0 保留并补兜底，P2 再定下线；下线需同步 `library/page.tsx:600` | 是 |
| D4 | 39 处 `catch` 仅 toast，全量补页面级态改动面过大 | P1 先补 10 处高价值点，其余登记 | 是 |
| D5 | 42206 涉及退款语义：结果不明时**不切线、不自动退款**，账单 `uncertain` 人工核对（`CLAUDE.md:239,256`） | 前端文案禁止「已退款 / 点击重试生成」，只给「去我的作品 / 提交工单」 | 是（需与 `docs/api-contract.md` 对拍） |
| D6 | `global.css:162,173` 遗留裸 hex 仍被页面私有 CSS 引用 | P2 单独批次，先确认引用点再替换 | 是 |
| D7 | `App.tsx` 新增 `offline` 监听属壳层行为变更，可能影响 e2e | 实施前核对 `frontend/e2e` 断言 | 是 |
| D8 | 本方案为仓库外交付物 | 裁定通过后再决定是否落 `docs/` 并同步 `docs/README.md` 索引 | 是 |
| D9 | 工作区存在在途 git 变更（含 `PaymentsExceptionPanel.tsx` 等） | 实施前重新确认 `git status`，在途文件零触碰 | 是 |

---

## 6. 验收标准（仅静态对拍，不跑门禁）

| 编号 | 对拍项 | 判定 |
|---|---|---|
| A1 | `grep -rn "<img" frontend/src` 结果全部经 `StateImage` / `WorkImage` / `ResultMedia` / `AssetThumb` 或显式登记例外 | 例外逐条列明，无裸奔 |
| A2 | `Empty` / `Spin` 直接 import 计数 | 归零，或全部落在弃用白名单 |
| A3 | `grep -n "#[0-9A-Fa-f]\{3,8\}" components/illustrations.tsx` | 零裸 hex 新增 |
| A4 | 错误码映射 | 只剩一份事实源；`taskErrorText` / `taskErrorLabel` 具名导出对拍无缺失 |
| A5 | 后台页面外层三态重复判定 | 计数归零；`admin-ui/primitives/table.tsx:305-323` 三态分支未被改动 |
| A6 | 导入方向 | 符合 `docs/frontend-module-conventions.md`；页面只从 `ui/` 或 `admin-ui/primitives` barrel 取件 |
| A7 | e2e 锚点 | 既有 `data-testid="admin-*"` / `aria-label` 零改动；新增锚点不覆盖旧值 |
| A8 | 样式纪律 | 零裸 hex 新增、零 `text-[10px]/[11px]` 新增（最小字号 12px，`CLAUDE.md:359`） |
| A9 | 契约不变 | `lib/api.ts` 抛错语义、后端错误码、AIGC 角标、任务状态机零改动 |

**未执行的验证**：`tsc --noEmit`、`vitest`、`build:prod`、`e2e`、`npm run check` —— 按裁定「仅静态对拍」，全部留给后续授权批次。新增组件的类型层正确性、SVG 实际渲染与浏览器 `onError` 行为**尚未获得运行证据**，需用户自验或另行授权。

---

## 7. 明确不做

1. 不新建状态组件库、不引入第三方 UI / 占位图服务 / 新依赖。
2. 不新增静态图片资源（裁定：内联 SVG + token）。
3. 不改后端错误码、不改 `lib/api.ts` 抛错契约、不改任务状态机与退款语义。
4. 不改后台 shadcn 组件体系与 `admin-ui/components/ui` 原子件。
5. 不改在途 git 变更文件；不代为 commit。
6. 不跑任何门禁；不写仓库内过程文档。
7. 不做移动端 / 响应式专项（后台页面按 `CLAUDE.md:46` 不做移动端）。

---

## 8. 分批与停下点

```
P0（兜底 + 收敛）  → 停下：静态对拍 A1/A2/A3/A6/A7/A8 → 用户验收
P1（失败语义）     → 停下：A4/A5/A9 + D5 文案对拍       → 用户验收
P2（一致性）       → 停下：全量 A1–A9                    → 用户验收
```

每批结束停下等待确认，不跨批推进；每批实施前重读目标代码、复核 `git status` 与行号。
