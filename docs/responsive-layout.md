# 布局与响应式规范

跨页面的骨架规则：断点刻度、页面容器、页头、网格降列、工具页骨架、移动端行为。

本文件与相邻三份规范的分工：

| 文件 | 管什么 |
| --- | --- |
| [`design-tokens.md`](design-tokens.md) | 令牌体系：颜色、圆角、间距、阴影的值与分层 |
| [`typography.md`](typography.md) | 字体栈、字号、字重、行高、过渡与描边微规格 |
| [`admin-ui-design.md`](admin-ui-design.md) §5–6 | 后台外壳断点、后台页头与表格滚动 |
| **本文件** | 断点刻度、容器宽度与内边距、页头三级体系、网格降列、工具页骨架、移动端规则 |

代码优先于本文件，冲突时以 `frontend/src` 为准并顺手改掉本文件的过时描述（[`README.md`](README.md) 原则 1）。

---

## 1. 断点刻度

### 1.1 两个家族，不可互相替代

断点按**作用对象**分成两类。外壳断点是跨组件契约，页面不得自行改；内容断点是页面布局降档的依据。

**外壳断点**（结构性，由外壳 CSS 唯一声明）

| 断点 | 行为 | 唯一声明点 |
| --- | --- | --- |
| `≤900px` | C 端侧栏收进抽屉、顶栏 64 → 54（`--workspace-topbar-height`）、`.app-content` 内边距切换、工具页单列 | `layout/AppLayout.css`、`layout/AppSidebar.css`、`layout/AppHeader.css` |
| `≤1366px` | C 端侧栏由 176px 横排列表收成 100px 垂直轨、`.app-content` 左负边距 −16px | `layout/AppSidebar.css:226`、`layout/AppLayout.css:77` |
| `≤1280px` | 后台侧栏 232px → 60px 折叠 | `styles/admin.css`（见 [`admin-ui-design.md`](admin-ui-design.md) §5.3） |

**内容断点**（页面布局降档，只有四档）

| 断点 | 名称 | 用途 |
| --- | --- | --- |
| `≤480px` | 极窄 | 网格降为 1 列、内边距收到 10px、页头标题再降一档 |
| `≤640px` | 手机 | 全部双栏改单列、页头标题降一档、网格 2 列、gap 8 |
| `≤900px` | 平板 | 横向多栏改单列、工具页左栏 432px 改全宽、网格 3 列、gap 12 |
| `≤1200px` | 小笔记本 | 网格降一档（N → N−1） |

`900px` 同时是外壳断点与内容断点，这是刻意的：视口一窄到 900，外壳先变（侧栏进抽屉），页面必须同步收成单列，两者共用同一个数字才不会出现「外壳已变、页面没跟」的空档。

### 1.2 允许值

- Tailwind：`max-[480px]:` / `max-[640px]:` / `max-[900px]:` / `max-[1200px]:`
- CSS：`@media (max-width: 480px)` / `640px` / `900px` / `1200px`
- 反向写法只在外部契约已给定时使用（如 `min-width: 901px` 配合外壳 900 断点）

**内联 `max-[Npx]` 是开区间，手写 `max-width` 是闭区间，两者差 1px。**

| 写法 | 编译结果 | `900` 整点生效？ |
| --- | --- | --- |
| `max-[900px]:`（Tailwind） | `@media (width < 900px)` | 否 |
| `max-[901px]:`（Tailwind） | `@media (width < 901px)` | 是 |
| `@media (max-width: 900px)`（CSS） | 闭区间 | 是 |

依据：Tailwind 4.3.3 官方 `compile()` API 实测（`max-[900px]:hidden` → `@media (width < 900px)`），以及页面内实测——1280px 视口下把浏览器宽度拖到 640 整点，读到的是上一档的值。`frontend/dist` 里的 `(width<=900px)` 是压缩器对产物重写后的形态，**不能用来判断语义**。

由此得出的规则：

- 需要与外壳断点或手写 CSS **逐像素对齐**的规则，不要写在内联变体里 —— 移到页面 `style.css` 用 `@media (max-width: 900px)`。
- 确实是单元素微调、且允许 1px 误差的，内联写 `max-[900px]:` 即可。
- 两者必须对齐又不能移进 CSS 时，内联写 `max-[901px]:`，并在行尾注释说明这是「≤900 的闭区间写法」。

### 1.3 禁止新增的值

现存页面里还有这些断点，它们是参考站逐像素对拍留下的，**不构成先例**：

```
380 420 520 560 600 700 720 760 860 980 1024 1050 1080 1100 1120 1240 1500
```

新代码一律不允许再出现。改动触及某个文件时，把该文件里**整页**的断点一次迁到四档刻度，不允许只改一半（半迁移会让同一页在不同宽度出现两套互相矛盾的布局）。

### 1.4 写在哪里

| 场景 | 写在哪 |
| --- | --- |
| 整页布局降档（列数、页头、内边距） | 页面 `style.css` 的 `@media` |
| 组件内部的宽度适配 | 组件同名 CSS 的 `@media` |
| 单个元素的一两处微调 | JSX 内联 `max-[640px]:` 变体 |

**同一页不得混用同一断点的两种写法**。整页布局不得写进 JSX 内联变体 —— 内联变体散落在几十个 `className` 里时，无法一眼看出这一页在 900 处发生了什么，也无法被审计脚本覆盖。

---

## 2. 页面容器

### 2.1 C 端页面根容器

C 端页面**铺满** `.app-content`，不使用页面级 `max-width` 居中。页面自带内边距时用负 margin「逃逸」到外壳内边距之外，负值必须与 `.app-content` 的内边距逐值相等（`layout/AppLayout.css:40` 有完整说明：写成 20px 会让 `.app-content` 变成可横向滚动容器）。

内边距按内容断点收：

| 视口 | 水平 | 顶部 | 底部 |
| --- | --- | --- | --- |
| `>900px` | 24 | 24 | 32（长文档页 56） |
| `≤900px` | 16 | 16 | 24 |
| `≤640px` | 12 | 14 | 20 |
| `≤480px` | 10 | 12 | 16 |

参照实现：`pages/works/style.css:48` 的 `.my-works-page`、`pages/workbench/style.css:971` 的 `.workbench-content`、`pages/library/page.tsx:290` 的 `asset-library-page`。

**现状差距**：`.app-content` 在 `≤900px` 现在是 `16px 10px 24px`，即 640–900 区间水平边距也只有 10px。按本表应升到 16px（内容列宽 +12px）。迁移时必须对拍 899 / 640 / 390 三档截图，确认没有溢出。

### 2.2 白名单：窄内容居中

只有两类页面允许设置页面级最大宽度并居中：

| 类型 | 宽度 | 参照实现 |
| --- | --- | --- |
| 结算 / 支付流程 | `max-width: 1120px` | `pages/checkout/style.css:18` |
| 认证类独立页 | 卡片宽度约束，页面本身居中 | `styles/auth.css:50` 的 `.login-page` |

这两类的共同点是**单列阅读动线**：内容再多也是一条竖线，拉宽只会让行长失控。其余页面（列表、网格、工作台、工具页）一律铺满。

### 2.3 后台页面根容器

后台铺满 `.adm-content`，不设页面级最大宽度，窄内容用内部栅格或 `narrow` 面板约束 —— 细则见 [`frontend-module-conventions.md`](frontend-module-conventions.md) 「后台页面宽度」。

---

## 3. 页面头部

### 3.1 三级标题体系

现有页面的 `h1` 实测跨度 16–68px（16 / 18 / 20 / 22 / 23 / 28 / 50 / 68），收成三级：

| 级别 | 场景 | 桌面 | `≤640px` | 字重 | 行高 |
| --- | --- | --- | --- | --- | --- |
| L1 营销首屏 | `/`、`/sitemap` 的 hero | 48–68（按页面规格） | 32 | 700–780 | 1.15–1.2 |
| L2 页面标题 | 列表 / 详情 / 结算 / 素材库 | **28** | **24** | 700 | 36 → 32 |
| L3 工作台标题 | 工具页、工作台内嵌区块、后台页面 | **18** | **16** | 700 | 26 → 24 |
| 后台页头 | `PageHeader` | **22** | 不降档 | 600 | 30 |

- **L1 只属于营销页**，且必须成组声明（桌面 → `≤900` 降一档 → `≤640` 降一档），不允许只给一个中间档。参照 `pages/landing/LandingHero.tsx:32`（50 → 42 → 38 → 32）、`pages/sitemap/SitemapHero.tsx:8`（68 → 40）。
- **L2 是页面唯一 `h1` 的默认值**。参照 `pages/library/LibraryToolbar.tsx:46`（28/700 → 24/700）、`pages/works/WorksHeader.tsx`。
- **L3 不得使用 `h1`**。工具页的页面标题已由顶栏与侧栏承担，区块标题用 `h2`/`strong`。参照 `pages/multi-image-fusion/MultiFusionEditorHeader.tsx:28`。
- 后台页头固定 22px/600 且不随视口降档（后台不做移动端），详见 [`admin-ui-design.md`](admin-ui-design.md) §6.1。

### 3.2 页头结构

```
┌────────────────────────────────────────────────┐
│ 标题 (L2)                     [主操作] [次操作] │
│ 说明 13px / 20 / muted                          │
└────────────────────────────────────────────────┘
```

| 项 | 规则 |
| --- | --- |
| 标题与说明 | 左对齐，纵向堆叠，标题下间距 6–8px |
| 说明 | 13px / 20px / `--text-muted`，一句话说清这一页做什么，不截断 |
| 操作区 | 右对齐，最多一个主按钮；其余用次按钮或菜单 |
| 布局 | 标题区与操作区 `flex` 两端对齐；`≤700px` 改为纵向堆叠、各自占满整行 |
| 动作位置 | 页面级动作必须在页头，不得沉到列表底部或筛选条里 |

参照实现：`.my-works-head`（`pages/works/style.css:58` 起，「标题 + 说明在左，刷新在右」）与 `.personal-page-head` 同一套度量；后台对应 `PageHeader`（`admin-ui-design.md` §6.1）。

### 3.3 每页唯一 `h1`

- 每个页面有且只有一个 `h1`，承载本页主题。
- 工具页的 `h1` 是结果区标题或区块标题中的一个，不是导航面包屑。
- 营销首页的 `h1` 是 hero 主标题。
- 后台页面的 `h1` 是 `PageHeader` 的标题。

**现状（2026-11-22 审计）**：34 个 C 端页面目录中 **21 个没有任何 `h1`**：`account`、`background-remove`、`credits`、`image-expand`、`image-to-video`、`image-translate`、`local-redraw`、`orders`、`product-detail`、`product-kit`、`product-recolor`、`product-retouch`、`product-sku`、`rotate-angle`、`shoppable-carousel`、`stats`、`template`、`tickets`、`tool`、`viral-clone`、`watermark-remove`。`checkout` 与 `admin` 各 2 个，`qr-login` 4 个（状态互斥，可接受）。这是本规范里差距最大的一项：页面主题对读屏用户完全靠导航推断。

---

## 4. 网格降列

### 4.1 标准阶梯

卡片网格按断点统一降列。`N` 是页面在桌面下的基准列数（5 或 6），由页面规格确定：

| 视口 | 列数 | gap |
| --- | --- | --- |
| `>1200px` | N（5–6） | 16 |
| `≤1200px` | N−1，最少 3 | 16 |
| `≤900px` | 3（N≤3 时为 2） | 12 |
| `≤640px` | 2 | 8 |
| `≤480px` | 1 | 8 |

参照实现：

- 素材库 5 → 4 → 3 → 2 → 1（`docs/library-design.md` §10，现用 1200/980/700/640/380，按本表并入四档）。
- 工作台 6 → 4 → 3 → 2（`pages/workbench/style.css` 的 `.wb-tools`，现用 1100/760/520）。

### 4.2 列数只声明一次

`grid-template-columns` 由**一处**规则管辖。后段的覆盖层（主题、状态、hover）只覆盖值，**不得重复声明结构属性**，否则会把前面的断点静默压死（`docs/workbench-design.md` §3.1 记录过这个坑）。

### 4.3 卡片容器的三个必备属性

| 属性 | 为什么 |
| --- | --- |
| `min-width: 0` | 网格子项的默认最小宽度是内容宽度，长标题会把列撑破 |
| `align-items: stretch` | `<button>` 有 UA 的 `align-items: center`，column flex 子项因此按 min-content 定宽 |
| 文本三件套 | 单行截断处必须同时有 `white-space: nowrap` / `overflow: hidden` / `text-overflow: ellipsis` |

这三条来自 [`typography.md`](typography.md) 附录 C 的真实缺陷，换字族时会集中爆发。

### 4.4 图片网格的高度

卡片高度随图片比例变化时，两列下不得被文字或 meta 撑高：meta 行限一行，左段省略号截断，右段 `white-space: nowrap`。

---

## 5. 工具页骨架

工具页共享 `components/ToolShell.tsx`，骨架由 `styles/tool-workspace.css` 的 `.pk-workspace` 定义。

| 项 | 桌面 | `≤900px` |
| --- | --- | --- |
| 布局 | 左栏 432px 固定 + 右栏自适应 | 单列纵向，右栏在下 |
| 左栏 | `width: 432px`（`tool-workspace.css:47`） | `width: 100%` |
| 根高度 | `calc(100vh - var(--workspace-topbar-height))`，`box-sizing: border-box` | `height: auto` |
| 根内边距 | `16 24 16 16`（负 margin 抵消外壳内边距） | 跟随外壳，无负 margin |
| 提交区 | sticky 底部 | sticky 底部 |

硬约束：

- 根高度只走 `--workspace-topbar-height`，页面不另写 `calc(100vh - 64px)`。
- 根必须 `box-sizing: border-box`（本项目没有 preflight 的全局 `border-box`）。
- `≤900px` 时外壳 `.app-layout` 收敛为 `100vh` 且 `overflow: hidden`，滚动交给 `.app-content`；页面不得再产生第二层滚动。

---

## 6. 移动端

「不做移动端专属布局」不等于「在手机上能看」。C 端必须满足：

| 规则 | 判据 |
| --- | --- |
| 无横向滚动 | 390px 视口下 `documentElement.scrollWidth ≤ clientWidth` |
| 无 hover 依赖 | 触屏上卡片操作区常驻显示，不靠 `:hover` 才出现 |
| 触控目标 | 可点元素命中区 ≥ 36×36，主按钮高度 ≥ 40 |
| 键盘可达 | 自绘可点元素必须有 `role` + `tabIndex` + 键盘处理，或改用 `Button` |
| 焦点可见 | focus ring 使用 `0 0 0 3px #5546d81a`（`--color-ring`），不得用浏览器默认蓝 |
| 抽屉 | 侧栏与导航在 `≤900px` 收进 `Sheet`，`Esc` 关闭、焦点归位 |

后台不做移动端适配（`admin-ui-design.md` §5.3），本条只约束 C 端。

**现状差距**（2026-11-22）：

- `focus-visible` 全站仅 29 处，自定义可点 `div`/`span` 73 处无 `role`，`tabIndex` 全站 4 处 —— 键盘可达性未达标。
- 触控目标与 390px 无横向滚动目前只有素材库有明确断言（`docs/library-design.md` §10），其余页面缺自动化覆盖。

---

## 7. 迁移纪律

1. **先定刻度，再改页面**。本文件落地前不要动任何页面的断点值；落地后按页整页迁移。
2. **一次迁移一页**。迁移范围是「该页 `style.css` + 该页 JSX 内联变体」，迁移后删除该页所有 off-scale 断点。
3. **零视觉差异优先**：只把 `980/760/720/...` 迁到最近的刻度档（`980 → 900`、`720 → 640`、`520 → 480`），不改列数与间距；档位本身要变的（如 1100 的 4 列挪到 1200）单独提一个可回滚的提交。
4. **对拍三档**：迁移前后各截 1366 / 900 / 390 三张图，确认无溢出、无折行位移。有差异的必须写进提交说明。
5. **内边距收口单独做**：`.app-content` 的 `≤900px` 10px → 16px 会横向改变所有页面，必须在所有页面迁移完之后一次性改，且单独提交。

---

## 8. 审计

```bash
cd frontend

# 内容断点之外的断点值（输出应逐条清零；外壳断点 900/1366 与后台 1280 除外）
grep -rn --include='*.css' --include='*.tsx' -oE '(max|min)-width:\s*[0-9]+px|(max|min)-\[[0-9]+px\]' src \
  | grep -vE '(max|min)-(width: )?(480|640|900|1200|1366)px' \
  | grep -v 'admin'

# 页面根容器上的 max-width（只允许 checkout 的 1120px 白名单，其余逐条确认）
grep -rn --include='*.css' 'max-width' src/pages/*/style.css | grep -v checkout

# 每个页面目录的 h1 数量（应恒为 1；状态互斥的子组件各自带 h1 可以接受，
# 但要人工确认同一时刻只渲染一个）
for d in src/pages/*/; do
  n=$(grep -rh '<h1' "$d" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
  echo "$n $(basename "$d")"
done | sort -n | awk '$1 != 1'
```

审计结果应记录在提交说明里，不写入本文件（[`README.md`](README.md) 原则 3：不留过程记录）。

---

## 附录 · 现状与目标对照

| 项 | 现状 | 目标 | 状态 |
| --- | --- | --- | --- |
| 内容断点数 | 约 20 种（380–1500） | 4 种（480/640/900/1200） | 规划中 |
| 页面内边距 `≤900px` | `16/10/24` | `16/16/24` | 规划中 |
| 页面标题字号 | 22–68，8 种取值 | L1/L2/L3 三级 + 后台一档 | 规划中 |
| 每页唯一 `h1` | 21 / 34 个页面目录没有 `h1` | 全部补齐 | 规划中 |
| 网格列数声明 | workbench 12 处断点、library 5 处 | 统一阶梯 | 规划中 |
| 最小字号 12px | 已达标，全站 0 违规 | 保持 | 已达标 |
| C 端组件取件边界 | 已达标（无页面直连后台原子件） | 保持 | 已达标 |
| 自定义控件键盘可达 | 73 处无 `role`，`tabIndex` 4 处 | 全部可达 | 规划中 |