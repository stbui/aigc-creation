# 页面布局统一性 · 审计与实施（双重内边距 / 高度变量 / 素材库断点）

> 实施人：小帮｜日期：2026-10-19｜对象：`AppLayout` 外壳（`.app-content`）与壳内 5 个自带 padding 的页面
> 触发：本条目原只存在于 `.workbuddy/memory/2026-10-19.md`（上午布局审计 P1/P2），本次实施时补建正式文档
> 方法：Playwright 逐页实测（rect + computed style），参考站侧取 1280 实拍几何与 `/tmp/ref-app.css` 未混淆 CSS 产物字面值
> 纪律：本文件是布局口径的唯一事实源；改 `.app-content` padding 或任何页面级 padding 前先看这里

---

## 0. 结论

| # | 发现 | 优先级 | 状态 |
|---|---|---|---|
| 1 | `.app-content` 的 24px 与页面级 padding 叠加，内容列右移 24px、窄 48px | P1 | ✅ 已修（仅 library / my-works 需要） |
| 2 | `--workspace-topbar-height` 从未定义，靠 64px fallback 顶着 → promo 开启时恒定 40px 死滚动 | P2 | ✅ 已修 |
| 3 | `--mif-promo-topbar-height` 被引用但从未定义 → `--mif-workspace-topbar-height` 计算值失效，mif 的 5 处 `calc(100vh - …)` 全部作废 | P2 | ✅ 已修（未被审计发现，本轮实测坐实） |
| 4 | 素材库响应式断点与参考站不符（本地缺 980 三列档、640 断点错位、缺 gap 10） | P1 | ✅ 已修（改用参考站产物真实断点） |
| 5 | `.pk-workspace` 的逃逸 margin 在 ≤900px 未复位 → 390 下左右各被切掉 14px | P1 | ✅ 已修（本轮顺带发现） |
| 6 | `.my-works-toolbar` 窄屏不换行 → 390 下 `.app-content` 横向滚动 197px，右半截筛选要横滑才够得到 | P1 | ✅ 已修（本轮顺带发现） |

---

## 1. 口径：参考站只有一层内边距

参考站 `.workspace-route-content` **自身无 padding**，页面自带 padding，内容列从 route 容器边缘起算：

```
main.workspace-route-content   [1196 宽 @x=84]   无 padding，内部滚动
└─ section.asset-library-page  [1196 宽 @x=84]   padding 24 24 56
   └─ div.asset-library-shell  [1148 宽 @x=108]  (= 1196 - 48)
      └─ header.asset-library-header [1148 宽]
```

本地多了一层：`.app-content { padding: 24px 24px 32px }`（外壳自加，服务工作台等无页面壳的页面），页面再自带 padding 就叠成 48。

---

## 2. 实测与修法

### 2.1 逐页对照（1280，参考站目标：内容列 x=108 / 宽 1148）

| 页 | 页面根 class | 自身 padding | 修前内容列 | 修法 | 修后内容列 |
|---|---|---|---|---|---|
| 素材库 | `.asset-library-page` | 24 24 56 | x=132 / 1100 ❌ | 逃逸 | **x=108 / 1148** ✅ |
| 我的作品 | `.my-works-page` | 28 28 72 | x=136 / 1092 ❌ | 逃逸 | **x=112 / 1140** ✅ |
| 邀请有奖 | `.invite-page` | 24 **0** 8 | x=108 / 1148 ✅ | 不动 | x=108 / 1148 |
| 积分商城 | `.pkg-shop-page` | 无 | x=108 / 1148 ✅ | 不动 | x=108 / 1148 |
| 多图融合 | `.multi-image-fusion-page` | 16 16 16 24 | x=108 / 1141 ✅ | 已逃逸 | x=108 / 1141 |

> **上午审计说的「5 页双重内边距」不准确**：实测 invite / pkg-shop 自身横向 padding 为 0，mif 早已用负 margin 逃逸。真正需要处理的只有 library 与 my-works 两页。
> my-works 修后是 x=112 而非 108，因为它的页面级 padding 是 28（来自参考站 CSS 产物），参考站同样是 84+28=112 —— 这是对齐，不是偏差。

### 2.2 修法：沿用 pk / mif 的既有逃逸范式

```css
@media (min-width: 901px) {
  .app-content > .asset-library-page,
  .app-content > .my-works-page {
    margin: 0 -24px -32px;
    width: auto;
  }
}
```

- 页面盒逃到 `.app-content` 的 padding 之外，再由页面自身 padding 定位 —— **页面级 padding 语义不被破坏**（这是选它而不选「把页面 padding 清零」的理由）
- 底部 `-32px` 抵消 `.app-content` 的 32px 下边距，使总下边距等于参考站的页面级值（library 56 / my-works 72）
- **必须限定 `min-width: 901px`**：≤900px 时 `.app-content` padding 变成 `16px 10px 24px`，写死 -24 会反冲 14px

---

## 3. 高度变量：两处都是死的

### 3.1 `--workspace-topbar-height`（素材库 min-height）

```css
/* 修前：变量全库未定义，靠 fallback 64px 顶着 */
min-height: calc(100vh - var(--workspace-topbar-height, 64px));
```

实测：promo 开启（chrome 实为 104）时 min-height 仍按 64 算 → 836px，**恒定 40px 死滚动**。

### 3.2 `--mif-workspace-topbar-height`（mif 五处高度）

```css
/* 修前：引用了一个从未定义的变量 */
--mif-workspace-topbar-height: calc(64px + var(--mif-promo-topbar-height));
```

自定义属性在**计算值阶段**做替换，引用未定义变量且无 fallback → 整条声明失效、该自定义属性计算为空 → 所有 `calc(100vh - var(--mif-workspace-topbar-height))` 全部作废。实测 `min-height` 计算值为 `0px`、`height` 回落 auto。

### 3.3 修法（统一口径 + 促销条契约）

```css
:root {
  --promo-topbar-height: 40px;
  --workspace-topbar-height: calc(64px + var(--promo-topbar-height));
  --mif-promo-topbar-height: var(--promo-topbar-height);
  --mif-workspace-topbar-height: var(--workspace-topbar-height);
}
html[data-promo='off'] { --promo-topbar-height: 0px; }   /* PromoBar JS 置位 */
@media (max-width: 900px) {
  :root { --workspace-topbar-height: 54px; --mif-workspace-topbar-height: 54px; }
}
```

促销条**必须走 JS 置 `html[data-promo]`**，不能用 CSS `display:none` —— 否则这里算出的高度与实际渲染不符（与 pk / mif 高度 calc 的既有契约同源）。

### 3.4 实测

| 状态 | `--workspace-topbar-height` | 素材库 min-height | 文档 scrollHeight |
|---|---|---|---|
| promo on | `calc(64px + 40px)` | **796px**（=900−104） | 1657 |
| promo off | `calc(64px + 0px)` | **836px**（=900−64） | 1617 |

两者相差正好 40px —— 死滚动消除。mif 的 `height` 从「失效回落 auto」变为实打实的 `calc(100vh − chrome)`，1280 实测 836px，页面内容完整无裁切（`docs/layout-ref/` 有实拍）。

---

## 4. 素材库断点：改用参考站产物真实值

上午审计写「参考站 populated 态被登录墙挡住，取不到移动栅格，只能按可用性决策」——**这个前提不成立**：参考站未混淆 CSS 产物里有完整媒体查询。

从 `/tmp/ref-app.css` 提取的参考站字面值：

| 断点 | 参考站 |
|---|---|
| 基础 | `.asset-library-grid { repeat(5, minmax(0,1fr)); gap:16px }`，卡片**无固定宽度**（fluid，只有 `min-width:0`） |
| ≤1200 | 4 列 |
| ≤980 | `.asset-library-page { padding:24px 20px 44px }` + 3 列 |
| ≤640 | `.asset-library-page { padding:18px 12px 36px }` + 2 列 + `gap:10px` |
| ≤380 | 1 列 |

本地已按此重写（此前是「1200→4 / 700→2 / 380→1」的可用性猜测）。

**顺带纠正一个假对齐**：10-17 审计记的「卡 207×273 ✅」不是参考站字面值 —— 参考站卡片是 fluid 的，207 只是 fluid 卡片在本地**双重 padding bug**（内容列 1100）下的测量结果。容器纠正为 1148 后卡片自然是 `216.8px`（实测 217×283），这才是参考站会给出的值。

---

## 5. 实测汇总（逐档）

| 视口 | 列数 | 列宽 | gap | page padding | 内容列 x/宽 | 标题 | 横向溢出 |
|---|---|---|---|---|---|---|---|
| 1280 | 5 | 216.8 | 16 | 24 24 56 | 108 / 1148 | 28/700 | 无 |
| 1200 | 4 | 255 | 16 | 24 24 56 | 108 / 1068 | 28/700 | 无 |
| 980 | 3 | 274.7 | 16 | 24 20 44 | 104 / 856 | 28/700 | 无 |
| 640 | 2 | 293 | 10 | 18 12 36 | 22 / 596 | 24/700 | 无 |
| 390 | 2 | 168 | 10 | 18 12 36 | 22 / 346 | 24/700 | 无 |
| 380 | 1 | 336 | 10 | 18 12 36 | 22 / 336 | 24/700 | 无 |

390 移动态另修：两列卡 meta 两段各自折行（卡高被撑高 17px）→ 左段 ellipsis、右段整词不折。

---

## 6. 顺带发现并修掉的两个移动端破版

| 页 | 现象（实测） | 根因 | 修法 |
|---|---|---|---|
| 商品主图 | 390 下 `.pk-workspace` x=**-14**、宽 418、右缘 **404** —— 左右各被裁掉 14px | 逃逸 margin `-24px -24px -32px` 写死在基座，≤900 时 `.app-content` padding 已变成 `16px 10px 24px`，固定 -24 反冲 | `@media (max-width:900px) { .pk-workspace { margin: 0 } }` |
| 我的作品 | 390 下 `.app-content` scrollWidth **587** vs client 390（横向滚动 197px）；`.my-works-toolbar` scrollWidth 549 vs 宽 314 | 4 个筛选 chip + 右侧操作单行排不下，toolbar 既不换行也不滚动 | `@media (max-width:700px) { .my-works-toolbar { flex-wrap: wrap } }`（弹层锚在 `.my-works-filter-wrap{position:relative}` 上，换行不影响定位） |

---

## 7. 全站回归（8 页 × 2 视口）

每项都先 `waitForSelector` 等真实内容、并断言 `boot === false`（避免上一批踩过的 Suspense 假通过）：

| 页面 | @1280 | @390 |
|---|---|---|
| workbench / works / library / packages / invitations / stats / product-kit / multi-image-fusion | `scrollW == clientW`，溢出元素 `[]` | 同左 |

零 JS 错误。

---

## 8. 刻意未做

| 项 | 原因 |
|---|---|
| invite / pkg-shop 的纵向节奏 | 自身横向 padding 为 0，横向已对齐；纵向 24+8 等值来自参考站产物，未实测参考站对应页，不动 |
| 把 `.app-content` 的 padding 改成 0 | 会同时影响工作台等无页面壳的页面（它们的 24 就来自这里），属于更大范围的壳层改动 |
| 基准字号 14→16 | 控件高度连锁，已否决 |

---

## 9. 证据

| 文件 | 内容 |
|---|---|
| `docs/layout-ref/library-1280-after.png` | 素材库 1280（内容列 x=108，5 列 217 卡） |
| `docs/layout-ref/library-390-after.png` | 素材库 390（2 列 gap 10 + `18 12 36`） |
| `docs/layout-ref/library-900-after.png` | 素材库 900（980 档 3 列） |
| `docs/layout-ref/my-works-1280-after.png` | 我的作品 1280（x=112，页面级 28 padding 语义保留） |
| `docs/layout-ref/mif-1280-after.png` | 多图融合 1280（高度 calc 复活后完整渲染，无裁切） |
| `docs/layout-ref/mif-390-after.png` | 多图融合 390 |
| `docs/layout-ref/pk-390-after.png` | 商品主图 390（逃逸 margin 复位后左右不再被裁） |
| `docs/layout-ref/works-390-after.png` | 我的作品 390（筛选行换行，无横向滚动） |
| `/tmp/ref-app.css` | 参考站未混淆 CSS 产物（断点字面值来源） |