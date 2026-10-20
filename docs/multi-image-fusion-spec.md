# 多图融合页（Multi Image Fusion）严格 1:1 设计规格

> 产出人：颜好看（UI/UX 设计师）｜产出日期：2026-10-17｜页面路由：`/multi-image-fusion`
> 本文件是**规格文档**，不含任何代码实施。实施由前端工程师完成。
> 参考站：<https://ijihua.cn/multi-image-fusion>
> 样式证据：`/tmp/ref-app.css`（719 353 字节，未混淆产物，类名可直读）
> 本地实现现状：`frontend/src/pages/MultiFusionPage.tsx`（579 行）+ `frontend/src/styles/global.css`（6 363 行）

---

## 0. 必读知识库与门禁自检

| 知识库 | 路径 | 本次读取情况 |
|---|---|---|
| 四层 Design Token 体系标准 | `references/design-systems/token-standard.md` | 已读（366 行）。本文件 §6 的 `--mif-*` token 组按其 A1/A2/B/C 四层与「Master + Overrides」模式组织 |
| 行业规范 — AI 原生产品 | `references/industries/ai-native.md` | 已读（71 行）。本页为 AI 图像生成工具，直接适用 |
| 行业规范 — 电商 / 消费 | `references/industries/ecommerce.md` | 已读（57 行）。项目定位为电商视觉生成，适用其「转化优先 / 信任前置」取向 |

**采用 ai-native.md 作为主规范**（本页是 AI 图像生成工作区，不是商品列表页），`ecommerce.md` 作为次要约束。二者共同生效的反模式条款在本页的适用性判定见 §7。

### P0 绝对规则自检

| 规则 | 自检结论 |
|---|---|
| 无 emoji 作为功能图标 | 通过。本文件所有图标均以文字描述（如「上传图标」「返回箭头图标」「下载图标」）。参考站实测图标为内联 SVG（`<svg>` + `<path>`），非 emoji |
| 无紫色→粉色渐变 | 通过。参考站主 CTA 渐变为 `linear-gradient(135deg,#6658dc,#8472ee)`——同色系深紫→浅紫，非紫→粉。已原样记录为证据；**实施时必须原样复制，不得替换** |
| 无 AI 模板味 | 通过。参考站空态文案为「等待你的第一组融合创意」「上传图片并提交生成，预览会出现在这里」，为具体动作描述，无 "Welcome to" 类空洞占位 |
| 无硬编码 hex 进我们的 CSS | 通过。本文件 §5 出现的 hex 全部是**参考站证据**；实施用的 CSS 一律走 §6 的 `--mif-*` token |

---

## 1. 证据基线与置信度声明

### 1.1 证据来源

| 证据 | 内容 | 置信度 |
|---|---|---|
| E1 | `/tmp/ref-app.css` 中 203 条选择器含 `multi-image-fusion` 的规则（含媒体查询上下文），由 `python3` 递归下降解析器按源码顺序导出 | 确定 |
| E2 | 参考站**已渲染 DOM 树**（两步均已实测打开，见 §4） | 确定 |
| E3 | 参考站**浏览器 computed style 实测值**（视口 1280×577，DPR 1） | 确定 |
| E4 | 本地实现源码读取（`MultiFusionPage.tsx` + `global.css`） | 确定 |
| E5 | 本地浏览器 computed style 实测值 | **无证据** — 见下方说明 |

> **E5 为何缺失（诚实披露）**：任务交办时要求「可在浏览器里用 computed style 取实测值」。实测 `curl http://localhost:5174/` 返回 **HTTP 502**，本地 dev 服务当前不可用，因此本地侧数值全部改为**源码声明值**（从 `global.css` / `.tsx` 直接读取），而非浏览器实测值。这两类数值的可信度不同，实施时如需本地实测请在 dev 服务恢复后补测。

### 1.2 媒体查询分布（E1）

共 203 条 `multi-image-fusion-*` 规则，媒体上下文分布：

| 媒体上下文 | 规则数 |
|---|---|
| 无媒体查询（基础规则） | 128 |
| `@media (max-width:600px)` | 37 |
| `@media (max-width:900px)` | 17 |
| `@media (min-width:901px) and (max-width:1366px)` | 6 |
| `@media (max-width:520px)` | 4 |
| `@media (prefers-reduced-motion:reduce)` | 3 |
| `@media (max-width:1200px)` | 1 |
| `@media (max-width:1180px)` | 1 |
| `@media (max-width:899px)` | 1 |
| `@media (max-width:767px)` | 1 |
| `@media (max-width:360px)` | 2 |

### 1.3 参考站 CSS 变量

| 变量 | 参考站取值 | 定义处 | 说明 |
|---|---|---|---|
| `--workspace-topbar-height` | `calc(64px + var(--promo-topbar-height,0px))` | `.workspace-view-root` | E3 实测展开为 `calc(64px + 40px)`（推广条开启时）。另有 `.top-navigation--standalone.workspace-app-header` 定义 `64px` |
| `--promo-topbar-height` | `40px` | 推广条开启时 | E3 实测 |
| `--fusion-ratio-width` | **参考站 CSS 产物中无定义** | 仅在 `.multi-image-fusion-preview-stage` 规则中被 `var()` 引用 | 由 JS 按所选比例内联写入。E1 检索全文件仅见引用、不见定义 → 记为**运行时注入变量** |
| `--fusion-ratio-height` | **参考站 CSS 产物中无定义** | 同上 | 同上 |

---

## 2. 页面状态机与区块地图

参考站是**同一 URL 的两步流**，无路由变化（E2 实测：点击场景卡后 `location.href` 仍为 `/multi-image-fusion`）。

```
multi-image-fusion-page
├── [状态 1] .is-scene-selection   ← 首屏默认态（E2 实测）
│   └── section.multi-image-fusion-scene-selection
│       ├── section.multi-image-fusion-scene-group × 2   ← h2 分别为 "表面附着" / "空间摆放"
│       │   └── div.multi-image-fusion-scene-grid
│       │       └── button.multi-image-fusion-scene-card × 15
│       │           ├── span.multi-image-fusion-scene-visual > img   ← WebP 场景预览图
│       │           └── span.multi-image-fusion-scene-copy
│       │               ├── strong  场景名（如「印花/图案」）
│       │               └── small   场景描述（如「手机壳、服装、杯具等表面的图案融合」）
│       └── （无 header / back 按钮）
│
└── [状态 2] .is-editor            ← 点击场景卡后（E2 实测）
    ├── header.multi-image-fusion-editor-head
    │   └── div.multi-image-fusion-editor-title
    │       ├── button.multi-image-fusion-scene-back > svg   ← 返回箭头图标（纯图标，无文字）
    │       └── div > h1(场景名) + p(上传主体图和搭配图，AI 将多张图片融合为一张新图)
    ├── div.multi-image-fusion-layout                       ← grid: 控制列 | 结果面板
    │   ├── section.multi-image-fusion-control-column
    │   │   ├── div.multi-image-fusion-card.multi-image-fusion-upload-card
    │   │   │   ├── div.multi-image-fusion-card-heading > div > h2「上传图片」
    │   │   │   ├── span.multi-image-fusion-count「0 / 6」
    │   │   │   └── div.multi-image-fusion-upload-section × 2
    │   │   │       ├── div.multi-image-fusion-field-label
    │   │   │       │   ├── span「主体图」/「搭配图」
    │   │   │       │   ├── small「必传 · 1 张」/「必传 · 1-5 张」
    │   │   │       │   └── span.multi-image-fusion-field-actions   ← 素材库导入 / 手机上传文字链
    │   │   │       ├── button.multi-image-fusion-upload-empty      ← 主体图槽位（空态）
    │   │   │       │   └── span.multi-image-fusion-upload-icon > svg
    │   │   │       └── div.multi-image-fusion-accessory-grid        ← 搭配图 3 列网格
    │   │   │           └── button.multi-image-fusion-upload-empty
    │   │   ├── div.multi-image-fusion-card.multi-image-fusion-analysis-card
    │   │   │   ├── div.multi-image-fusion-card-heading.compact > h2「AI 分析」
    │   │   │   └── button.multi-image-fusion-analyze-button > svg + span「AI 分析」
    │   │   └── div.multi-image-fusion-card.multi-image-fusion-parameter-card
    │   │       ├── div.multi-image-fusion-card-heading.compact > h2「输出参数」
    │   │       └── div.multi-image-fusion-parameter-group
    │   │           ├── div.multi-image-fusion-field-label > span「变体张数」
    │   │           └── div.multi-image-fusion-variant-options > button × 4（4/3/2/1 张）
    │   └── div.image-tool-submit-area.multi-image-fusion-submit-area
    │       ├── div.image-output-settings-shell                ← 「高级设置」折叠壳（共享组件）
    │       │   └── button.image-output-settings-summary
    │       │       ├── span.image-output-settings-summary-label「高级设置」
    │       │       ├── span.image-output-settings-chip「比例 1:1」/「画质 1K」
    │       │       └── svg  展开箭头图标
    │       └── button.multi-image-fusion-submit-button [disabled]
    │           ├── span「立即生成」
    │           └── small「本次消耗40积分」
    └── section.multi-image-fusion-result-panel
        ├── div.multi-image-fusion-result-heading
        │   ├── div > h2「生成结果」+ p「完成设置后，生成结果会显示在这里」
        │   └── div.multi-image-fusion-result-actions > button × 2 [disabled]
        │       └── （重新生成图标+文字 / 下载图标+文字，文字部分 E2 未渲染，类名无文本节点）
        └── div.multi-image-fusion-result-empty
            ├── div.multi-image-fusion-empty-art > span × 3（各含一个内联 SVG 图标）
            ├── strong「等待你的第一组融合创意」
            └── p「上传图片并提交生成，预览会出现在这里」
```

### 2.1 参考站默认态的一个重要事实

任务交办称「登录墙内部分看不到默认态」。**实测纠正**：参考站默认态（场景网关，`is-scene-selection`）**无需登录即可完整渲染**，且点击场景卡后工作区（`is-editor`）亦可完整渲染。因此 §4 的 DOM 与 §3 的 computed style 均为**实测证据**，而非推断。唯一未渲染的是上传后的 `.multi-image-fusion-image-card`、`.multi-image-fusion-preview-stage`、`.multi-image-fusion-thumbnails`、`.multi-image-fusion-generating-state`、`.multi-image-fusion-message`、`.multi-image-fusion-description-editor` —— 这些是**登录/上传后才出现**的态，其样式值**由 E1 的 CSS 产物直接给出（仍是确定证据）**，但**DOM 结构为推断**。

---

## 3. 参考站 computed style 实测值（E3，视口 1280×577，DPR 1，推广条开启）

> 说明：本节用于交叉验证 E1 的 CSS 字面值。浏览器会把 `#fffffff0` 之类的 8 位hex 展开为 `rgba()`，把 `750` 字重保留（可变字重），把 `-0.02em` 换算为 px。**实施时以 §5 的 CSS 字面值为准**，本节仅作验证。

### 3.1 状态 1 · 场景网关实测

| 选择器 | 实测值（节选） | 渲染尺寸 |
|---|---|---|
| `.multi-image-fusion-page` | padding `16px 16px 16px 24px`｜color `rgb(36,36,59)`｜overflow `hidden auto`｜scrollbar-gutter `stable` | 1196×473 |
| `.multi-image-fusion-scene-selection` | width `1150px` | 1150×814 |
| `.multi-image-fusion-scene-group h2` | color `rgb(45,46,66)`｜14px/700｜line-height `20px`｜margin `0 0 10px 2px` | 1148×20 |
| `.multi-image-fusion-scene-grid` | grid-template-columns `repeat(6, minmax(0,1fr))` → 实算 6 列各 181.66px｜gap `12px` | 1150×366 |
| `.multi-image-fusion-scene-card` | background `rgb(255,255,255)`｜border `1px solid rgb(226,227,235)`｜radius `14px`｜padding `11px`｜color `rgb(41,42,62)`｜box-shadow `rgba(45,47,80,0.035) 0 5px 16px`｜transition `border-color .18s, box-shadow .18s, transform .18s` | 182×177 |
| `.multi-image-fusion-scene-visual` | background `rgb(241,242,246)`｜radius `9px`｜min-height `86px`｜font 13px/700｜color `#fff`｜text-shadow `rgba(39,43,79,0.12) 0 1px 3px`｜overflow `hidden` | 158×105 |
| `.multi-image-fusion-scene-visual img` | object-fit `contain`｜transition `transform .24s` | 158×105 |
| `.multi-image-fusion-scene-copy` | display `grid`｜gap `3px`｜padding `9px 2px 1px` | 158×48 |
| `.multi-image-fusion-scene-copy strong` | color `rgb(41,42,62)`｜13px/700｜line-height `18px` | 154×18 |
| `.multi-image-fusion-scene-copy small` | color `rgb(133,134,156)`｜11px｜line-height `17px`｜min-height `17px`｜white-space `nowrap`｜text-overflow `ellipsis`｜overflow `hidden` | 154×17 |

**关键交叉验证**：CSS 字面 `#2d2f5009` → 实测 `rgba(45,47,80,0.035)`（`2d2f50`=rgb(45,47,80)，`09`=0.035）。一致。

### 3.2 状态 2 · 工作区实测

| 选择器 | 实测值（节选） | 渲染尺寸 |
|---|---|---|
| `.multi-image-fusion-page` | padding `16px 16px 16px 24px`｜overflow `hidden` | 1196×473 |
| `.multi-image-fusion-editor-head` | display `flex`｜justify-content `space-between`｜align-items `center`｜gap `16px`｜height `38px`｜margin-bottom `12px` | 1156×38 |
| `.multi-image-fusion-editor-title h1` | color `rgb(38,37,61)`｜18px/750｜line-height `24px`｜letter-spacing `-0.36px`（＝`-0.02em`×18） | 278×24 |
| `.multi-image-fusion-editor-title p` | color `rgb(133,134,156)`｜12px｜line-height `18px`｜margin-top `1px` | 278×18 |
| `.multi-image-fusion-scene-back` | width/height `30px`｜border `1px solid rgb(224,225,233)`｜radius `8px`｜background `rgba(255,255,255,0.72)`｜color `rgb(62,64,85)`｜font-size `12px` | 30×30 |
| `.multi-image-fusion-layout` | **grid-template-columns `216px 924px`**｜gap `16px`｜align-items `stretch` | 1156×391 |
| `.multi-image-fusion-control-column` | display `flex` column｜gap `10px`｜overflow `hidden auto`｜scrollbar-gutter `stable`｜max-width `216px` | 216×391 |
| `.multi-image-fusion-card` | background `rgba(255,255,255,0.94)`｜border `1px solid rgb(235,234,243)`｜radius `18px`｜padding `18px`｜box-shadow `rgba(55,51,100,0.043) 0 10px 30px` | 210×524 |
| `.multi-image-fusion-card-heading` | display `flex`｜justify-content `space-between`｜align-items `flex-start`｜gap `12px`｜margin-bottom `18px` | 172×22 |
| `.multi-image-fusion-card-heading h2` | color `rgb(38,37,61)`｜15px/700｜line-height `22px` | 60×22 |
| `.multi-image-fusion-card-heading.compact` | margin-bottom `14px` | 172×22 |
| `.multi-image-fusion-count` | color `rgb(174,172,189)`｜11px｜line-height `18px`｜padding-top `3px`｜text-align `right`｜min-width `39px` | 39×21 |
| `.multi-image-fusion-field-label` | display `flex`｜justify-content `space-between`｜align-items `center`｜gap `12px`｜min-height `22px`｜margin-bottom `8px`｜12px/700｜color `rgb(70,69,93)` | 172×80 |
| `.multi-image-fusion-field-label small` | color `rgb(170,169,186)`｜11px/400 | 11×80 |
| `.multi-image-fusion-field-actions` | display `flex`｜gap `8px`｜margin-left `auto` | 128×13 |
| `.multi-image-fusion-upload-empty` | background `rgb(251,250,255)`｜border `1px dashed rgb(216,212,238)`｜radius `13px`｜padding `15px`｜min-height `138px`｜gap `5px`｜color `rgb(170,167,188)`｜flex column center | 172×138 |
| `.multi-image-fusion-upload-empty strong` | color `rgb(97,87,167)`｜12px/600｜line-height `18px` | 60×18 |
| `.multi-image-fusion-upload-empty>span:last-child` | color `rgb(181,178,194)`｜10px｜line-height `16px` | 140×32 |
| `.multi-image-fusion-upload-icon` | 36×36｜radius `11px`｜background `rgb(238,235,255)`｜color `rgb(115,102,209)`｜margin-bottom `2px` | 36×36 |
| `.multi-image-fusion-accessory-grid` | display `grid`｜**grid-template-columns 实算 2 列 81px**｜gap `8px`｜radius `14px`｜border `1px solid transparent` | 172×98 |
| `.multi-image-fusion-accessory-grid .multi-image-fusion-upload-empty` | min-height `96px`｜padding `8px`｜radius `11px` | 81×96 |
| `.multi-image-fusion-accessory-grid .multi-image-fusion-upload-icon` | 29×29｜radius `9px` | 29×29 |
| `.multi-image-fusion-analysis-card` / `-parameter-card` | padding `16px 18px`（仅上下 18→16） | 210×106 / 210×134 |
| `.multi-image-fusion-analyze-button` | **background-image `linear-gradient(135deg, rgb(102,88,220), rgb(132,114,238))`**｜radius `9px`｜width `100%`｜height `36px`｜12px/600｜gap `7px`｜color `#fff`｜box-shadow `rgba(102,88,220,0.18) 0 8px 18px` | 172×36 |
| `.multi-image-fusion-parameter-group` | 无独立盒模型（block） | 172×64 |
| `.multi-image-fusion-variant-options` | display `grid`｜grid-template-columns 实算 4 列各 37.75px｜gap `7px` | 172×34 |
| `.multi-image-fusion-variant-options button` | height `34px`｜11px｜radius `8px`｜border `1px solid transparent` | 38×34 |
| `.multi-image-fusion-variant-options button.selected` | background `rgb(241,239,255)`｜color `rgb(93,80,197)`｜border-color `transparent` | 38×34 |
| `.multi-image-fusion-submit-area` | **实测被 `.image-tool-submit-area` 覆盖** → padding `14px 16px 16px`｜background `#fff`｜radius `16px`｜gap `14px`｜z-index `10`｜position `sticky`（详见 §5.9 覆盖冲突） | 210×121 |
| `.multi-image-fusion-submit-button` | **background-image `linear-gradient(135deg, rgb(102,88,220), rgb(132,114,238))`**｜radius `11px`｜width `100%`｜height `43px`｜13px/700｜box-shadow `rgba(102,88,220,0.18) 0 8px 18px`｜cursor `not-allowed`（disabled） | 178×43 |
| `.multi-image-fusion-submit-button small` | color `rgba(255,255,255,0.82)`｜11px/400｜white-space `nowrap` | 78×16 |
| `.multi-image-fusion-result-panel` | **background-image `linear-gradient(145deg, rgba(255,255,255,0.97), rgba(249,248,255,0.94))`**｜border `1px solid rgb(235,234,243)`｜radius `18px`｜padding `22px`｜min-height 未触发｜max-height `100%`｜overflow `hidden`｜display `flex` column | 924×391 |
| `.multi-image-fusion-result-heading` | display `flex`｜justify-content `space-between`｜align-items `flex-start`｜gap `18px`｜margin-bottom `17px` | 872×50 |
| `.multi-image-fusion-result-heading h2` | color `rgb(38,37,61)`｜18px/700｜line-height `25px`｜margin-top `2px` | 192×25 |
| `.multi-image-fusion-result-heading p` | color `rgb(152,151,170)`｜12px｜line-height `19px`｜margin-top `4px` | 192×19 |
| `.multi-image-fusion-result-actions` | display `flex`｜gap `7px` | 179×32 |
| `.multi-image-fusion-result-actions button` | height `32px`｜padding `0 10px`｜11px｜radius `8px`｜border `1px solid rgb(229,227,239)`｜background `rgba(255,255,255,0.8)`｜color `rgb(113,111,134)`｜gap `5px` | 86×32 |
| `.multi-image-fusion-result-empty` | background-color `rgb(251,250,255)` + 4 层棋盘格 linear-gradient（`16px 16px`｜`#f3f1fa` 25%）｜border `1px solid rgb(231,229,241)`｜radius `15px`｜gap `9px`｜flex column center｜min-height 未触发（视口不足） | 193×193 |
| `.multi-image-fusion-empty-art` | width `96px`｜height `78px`｜margin-bottom `8px`｜position `relative` | 96×78 |
| `.multi-image-fusion-empty-art>span` | border `1px solid rgb(221,217,241)`｜radius `12px`｜background `rgba(255,255,255,0.84)`｜color `rgb(140,128,215)`｜box-shadow `rgba(93,79,169,0.08) 0 8px 16px`｜position `absolute` | 50×50 |
| `.multi-image-fusion-empty-art>span:nth-child(2)` | background `rgb(241,239,255)`｜color `rgb(104,91,208)`｜46×46｜z-index `1` | 46×46 |
| `.multi-image-fusion-result-empty strong` | color `rgb(103,100,123)`｜13px/600 | 143×19 |
| `.multi-image-fusion-result-empty p` | color `rgb(170,167,184)`｜11px | 191×32 |

### 3.3 实测发现的两个「意外」

**(a) `.multi-image-fusion-layout` 实测为 `216px 924px`，而非 CSS 基础规则的 `minmax(360px,410px)`。**
原因：视口 1280 落在 `@media (min-width:901px) and (max-width:1366px)` 区间，命中 E1 规则 #189：
`.product-sku-page,.product-sku-page.history-collapsed,.multi-image-fusion-layout { grid-template-columns:216px minmax(0,1fr) }`
**这是参考站真实行为，不是缺陷**。侧栏在 1280 宽度下被压到 216px。实施时必须一并落这条媒体查询，否则在 1280 宽度下必然与参考站不符。

**(b) `.multi-image-fusion-field-label` 实测高度 80px（CSS 只写了 `min-height:22px`），其子 `small` 与 `span` 也被撑到 80px。**
原因：`.multi-image-fusion-field-actions` 在 216px 窄列内与标题文字抢空间，`align-items:center` 下 flex 子项被拉伸。同理 `.multi-image-fusion-field-label>span` 实测宽度仅 12px（「主体图」三字竖排换行）。这是 216px 窄列的连带后果，**实施时不要「修正」它**，否则反而偏离参考站。

---

## 4. DOM 结构：证据确认 vs 推断

### 4.1 CSS 证据 + 浏览器实测双确认（可放心实施）

§2 区块地图中，以下部分同时有 E2（实测 DOM）与 E3（实测样式）确认，**结构与样式均可直接照做**：

- 状态 1 全部结构（`.is-scene-selection` 完整子树，15 张场景卡、2 个分组、h2 文本「表面附着」/「空间摆放」）
- 状态 2 的 `.is-editor` → `.editor-head` / `.layout` → `.control-column` + `.result-panel` 三层骨架
- 上传区两个 `.upload-section`、`.field-label`（span + small + `.field-actions`）、`.upload-empty`、`.upload-icon`、`.accessory-grid`
- `.analysis-card` + `.analyze-button`、`.parameter-card` + `.parameter-group` + `.variant-options`
- `.submit-area` → `.image-output-settings-shell` + `.submit-button`（span + small 两级文字）
- `.result-panel` → `.result-heading`（h2 + p + `.result-actions` 2 button）+ `.result-empty`（`.empty-art` 3 span + strong + p）

**文案证据（E2 实测原文，逐字照录）**：

| 位置 | 文本 |
|---|---|
| 场景分组 1 标题 | `表面附着` |
| 场景分组 2 标题 | `空间摆放` |
| 场景卡标题（7 张） | 印花/图案、刺绣/绣花、纹理/材质、贴纸/贴花、烫金/烫印、雕刻/蚀刻、彩绘/涂装 |
| 场景卡描述（7 张，E2 实测原文） | 手机壳、服装、杯具等表面的图案融合｜服装、帽子等织物表面的刺绣融合｜木纹、大理石、碳纤维等表面材质融合｜笔记本、滑板、行李箱等表面的贴纸融合｜包装、皮具等表面的烫金与压印效果｜金属、玻璃等表面的雕刻与磨砂图案｜头盔、陶瓷等表面的喷绘与手绘融合 |
| 场景卡标题+描述（8 张） | 桌面陈列、穿搭/佩戴、场景搭配、手持展示、组合套装、食品摆盘、收纳展示、货架陈列 |
| 场景卡描述（8 张） | 办公用品、化妆品等桌面组合陈列｜模特、手模与服装配饰融合｜家具进房间、产品进展台、陈设入空间｜手模或人物自然手持商品与道具｜礼盒、多件商品与套装组合展示｜餐盘、托盘与菜品茶具组合｜收纳盒、化妆包与内部物件展示｜货架、书架与多件商品陈列 |
| 工作区副标题 | `上传主体图和搭配图，AI 将多张融合为一张新图`（原文：`上传主体图和搭配图，AI 将多张图片融合为一张新图`） |
| 上传卡标题 | `上传图片` |
| 计数器 | `0 / 6` |
| 字段标签 | `主体图` + `必传 · 1 张`；`搭配图` + `必传 · 1-5 张` |
| 上传空态主文案 | `上传主体图` |
| 上传空态副文案 | `支持 JPG、PNG，单张不超过 10MB，可直接粘贴` |
| 分析卡 | `AI 分析`（标题与按钮同文） |
| 参数卡 | `输出参数` / `变体张数` / `4 张` `3 张` `2 张` `1 张`（`4 张` 默认 selected） |
| 高级设置摘要 | `高级设置` + `比例 1:1` + `画质 1K` + 展开箭头图标 |
| 提交按钮 | `立即生成` + `本次消耗40积分`（未上传时 disabled） |
| 结果卡标题 | `生成结果` |
| 结果卡副标题 | `完成设置后，生成结果会显示在这里` |
| 结果空态主文案 | `等待你的第一组融合创意` |
| 结果空态副文案 | `上传图片并提交生成，预览会出现在这里` |

> **文案差异提示**：本地实现 `MultiFusionPage.tsx` 第 41 行把「刺绣/绣花」描述写作「搭配图以绣线质感附着主体表面」、第 43 行「纹理/材质」写作「木纹、金属、织物等材质纹理融合」，与参考站实测原文（§4.1 表）**不一致**。参考站原文更具体，且是「物体+表面」句式。详见 §7 差异 D-31。

### 4.2 推断（仅 CSS 证据，无实测 DOM —— 上传/生成后才出现的态）

以下选择器**样式值是确定的**（E1 直接给出），但**DOM 结构与文案为推断**，实施前建议在有账号状态下实测：

| 类 | 推断结构 | 依据 |
|---|---|---|
| `.multi-image-fusion-image-card` | 包裹已上传图片的容器，> `img` + `button.multi-image-fusion-remove` | CSS 有 `>img` 与 `>span.multi-image-funing-uploading` 绝对定位覆盖层 |
| `.multi-image-fusion-uploading` | `position:absolute; inset:0` 的加载遮罩，色 `#ffffffad`，文字「上传中」类 | CSS 绝对定位 + `gap:5px` + 12px/700 |
| `.multi-image-fusion-remove` | 图片右上角 22×22 圆形移除按钮，> 叉号 SVG | CSS `position:absolute; top:7px; right:7px` |
| `.multi-image-fusion-preview-stage` | 生成结果的图片舞台，> `img.multi-image-fusion-preview-image` + `span.multi-image-fusion-preview-size` | CSS 有棋盘格背景 + `> .result-feedback-trigger` |
| `.multi-image-fusion-preview-size` | 舞台右下角尺寸胶囊，`backdrop-filter:blur(8px)` | CSS `position:absolute; bottom:12px; right:12px` |
| `.multi-image-fusion-thumbnails` | 结果缩略图网格 `repeat(4, max-content)`，每项 `button>img+span` | CSS `grid-template-columns:repeat(4,max-content)` |
| `.multi-image-fusion-generating-state` | 生成中状态：> `img`(52×52 动图) + `strong` 文案 | CSS `flex-direction:column` + `>img` + `>strong` |
| `.multi-image-fusion-message` | 提交区上方的消息条，`.success`/`.info`/`.error` 三态 | CSS 有三个修饰类各配一个 color |
| `.multi-image-fusion-description-editor` | `textarea[contenteditable]` + `:empty:before{content:attr(data-placeholder)}` | CSS 用 `:empty:before` + `attr(data-placeholder)` → 必是 `contenteditable` 的 div，非 textarea |
| `.multi-image-fusion-description-token-subject` / `-companion` | 描述编辑器内的语义高亮 span（主体色 / 搭配色） | CSS 只有 color + font-weight，无盒模型 |
| `.multi-image-fusion-ratio-options` / `.ratio-preview` | 比例选择网格 `repeat(4,minmax(0,1fr))`，每项 `button > .ratio-preview` + 文字 | CSS 有 `button.selected .ratio-preview` 联动 |
| `.multi-image-fusion-scene-state` | 场景分析状态（`min-height:180px`，`.is-error` 变体含 button） | CSS 有 `.is-error` 与 `>button` |
| `.multi-image-fusion-step` | 卡片标题里的步骤号圆牌（26×26，`flex:0 0 26px`） | CSS 有独立 `flex:0 0 26px` 尺寸 → 是 flex 子项 |

**注意**：`.multi-image-fusion-step`、`.multi-image-fusion-description*`、`.multi-image-fusion-ratio-options`、`.multi-image-fusion-scene-state` 这四组在参考站**默认两步流里都没有渲染**（E2 实测 `querySelectorAll` 未出现）。它们属于**其他场景分支**（如带步骤条的旧版布局、AI 描述增强模式、带比例选择的变体）。本地实现若无对应功能，**不应为了「还原」而加入这些元素** —— 这条列入 §7 差异 D-32。

---

## 5. 参考站 `multi-*` 全部规则导出（按区块归类，203 条完整无删减）

> 由 `python3` 递归下降解析器（`/tmp/extract_multi.py`）按源码顺序导出，媒体查询上下文完整保留。
> 「#」为该规则在 `multi-*` 规则序列中的序号，可回溯 `/tmp/multi-rules.json`。

### 5.1 区块 A — 页面容器 / 两步流根

页面容器 / 两步流根（基础规则 4 条 + 媒体查询内 12 条 = 16 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 1 | — | `.multi-image-fusion-page.is-scene-selection` | `height` | `calc(100vh - var(--workspace-topbar-height))` |
| 1 | — | `↳` | `height` | `calc(100vh - var(--workspace-topbar-height))` |
| 1 | — | `↳` | `scrollbar-gutter` | `stable` |
| 1 | — | `↳` | `min-height` | `0` |
| 1 | — | `↳` | `padding` | `16px` |
| 1 | — | `↳` | `overflow` | `hidden auto` |
| 23 | — | `.multi-image-fusion-page.is-editor .multi-image-fusion-layout` | `height` | `calc(100% - 50px)` |
| 24 | @media (max-width:900px) | `.multi-image-fusion-page.is-scene-selection` | `height` | `auto` |
| 24 | @media (max-width:900px) | `↳` | `min-height` | `calc(100vh - var(--workspace-topbar-height))` |
| 24 | @media (max-width:900px) | `↳` | `min-height` | `calc(100vh - var(--workspace-topbar-height))` |
| 24 | @media (max-width:900px) | `↳` | `padding` | `16px 16px 24px` |
| 27 | @media (max-width:900px) | `.multi-image-fusion-page.is-editor .multi-image-fusion-layout` | `height` | `auto` |
| 32 | — | `.multi-image-fusion-page` | `width` | `min(100%,1480px)` |
| 32 | — | `↳` | `min-height` | `calc(100vh - var(--workspace-topbar-height))` |
| 32 | — | `↳` | `box-sizing` | `border-box` |
| 32 | — | `↳` | `color` | `#24243b` |
| 32 | — | `↳` | `margin` | `0 auto` |
| 32 | — | `↳` | `padding` | `26px 32px 42px` |
| 132 | @media (max-width:1180px) | `.multi-image-fusion-page` | `padding-inline` | `22px` |
| 135 | @media (max-width:900px) | `.multi-image-fusion-page` | `min-height` | `0` |
| 135 | @media (max-width:900px) | `↳` | `padding` | `18px 20px 32px` |
| 142 | @media (max-width:600px) | `.multi-image-fusion-page` | `padding-inline` | `14px` |
| 151 | — | `.multi-image-fusion-page` | `width` | `100%` |
| 151 | — | `↳` | `height` | `calc(100vh - var(--workspace-topbar-height))` |
| 151 | — | `↳` | `height` | `calc(100vh - var(--workspace-topbar-height))` |
| 151 | — | `↳` | `min-height` | `0` |
| 151 | — | `↳` | `margin` | `0` |
| 151 | — | `↳` | `padding` | `16px` |
| 151 | — | `↳` | `overflow` | `hidden` |
| 157 | @media (max-width:900px) | `.multi-image-fusion-page` | `height` | `auto` |
| 157 | @media (max-width:900px) | `↳` | `min-height` | `calc(100vh - var(--workspace-topbar-height))` |
| 157 | @media (max-width:900px) | `↳` | `min-height` | `calc(100vh - var(--workspace-topbar-height))` |
| 157 | @media (max-width:900px) | `↳` | `padding-bottom` | `24px` |
| 157 | @media (max-width:900px) | `↳` | `overflow` | `visible` |
| 161 | @media (max-width:600px) | `.multi-image-fusion-page,.multi-image-fusion-page.is-scene-selection` | `box-sizing` | `border-box` |
| 161 | @media (max-width:600px) | `↳` | `width` | `100%` |
| 161 | @media (max-width:600px) | `↳` | `max-width` | `100%` |
| 161 | @media (max-width:600px) | `↳` | `padding` | `12px 12px 24px` |
| 187 | @media (max-width:360px) | `.multi-image-fusion-page,.multi-image-fusion-page.is-scene-selection,.multi-image-fusion-card,.multi-image-fusion-result-panel` | `padding-inline` | `10px` |
| 197 | @media (max-width:900px) | `.multi-image-fusion-page,.multi-image-fusion-page.is-scene-selection` | `box-sizing` | `border-box` |
| 197 | @media (max-width:900px) | `↳` | `width` | `100%` |
| 197 | @media (max-width:900px) | `↳` | `min-width` | `0` |
| 197 | @media (max-width:900px) | `↳` | `max-width` | `none` |
| 197 | @media (max-width:900px) | `↳` | `margin` | `0` |
| 197 | @media (max-width:900px) | `↳` | `padding` | `12px 0 24px` |
| 198 | @media (max-width:900px) | `.multi-image-fusion-layout,.multi-image-fusion-page.is-editor .multi-image-fusion-layout` | `grid-template-columns` | `minmax(0,1fr)` |
| 198 | @media (max-width:900px) | `↳` | `gap` | `10px` |
| 198 | @media (max-width:900px) | `↳` | `width` | `100%` |
| 198 | @media (max-width:900px) | `↳` | `height` | `auto` |
| 198 | @media (max-width:900px) | `↳` | `min-height` | `0` |
| 198 | @media (max-width:900px) | `↳` | `display` | `grid` |
| 201 | @media (max-width:900px) | `.multi-image-fusion-page.is-scene-selection` | `padding-left` | `16px` |
| 201 | @media (max-width:900px) | `↳` | `padding-right` | `16px` |
| 202 | @media (min-width:901px) and (max-width:1366px) | `.workspace-route-content>.multi-image-fusion-page,.workspace-route-content>.workspace-main-content.commerce-generation-workspace,.workspace-route-content>.smart-expand-page,.workspace-route-content>.free-creation-page,.workspace-view-root .workspace.visible.side-menu-collapsed .smart-expand-page,.workspace-view-root .workspace.visible.side-menu-collapsed .workspace-route-content>.free-creation-page` | `padding-left` | `24px` |

### 5.2 区块 B — 场景网关（第一步）

场景网关（第一步）（基础规则 22 条 + 媒体查询内 18 条 = 40 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 2 | — | `.multi-image-fusion-scene-selection` | `width` | `100%` |
| 2 | — | `↳` | `margin` | `0 auto 0 0` |
| 3 | — | `.multi-image-fusion-editor-title h1` | `color` | `#26253d` |
| 3 | — | `↳` | `letter-spacing` | `-.02em` |
| 3 | — | `↳` | `margin` | `0` |
| 3 | — | `↳` | `font-size` | `18px` |
| 3 | — | `↳` | `font-weight` | `750` |
| 3 | — | `↳` | `line-height` | `24px` |
| 4 | — | `.multi-image-fusion-editor-title p` | `color` | `#85869c` |
| 4 | — | `↳` | `margin` | `1px 0 0` |
| 4 | — | `↳` | `font-size` | `12px` |
| 4 | — | `↳` | `line-height` | `18px` |
| 5 | — | `.multi-image-fusion-scene-group+.multi-image-fusion-scene-group` | `margin-top` | `22px` |
| 6 | — | `.multi-image-fusion-scene-group h2` | `color` | `#2d2e42` |
| 6 | — | `↳` | `margin` | `0 0 10px 2px` |
| 6 | — | `↳` | `font-size` | `14px` |
| 6 | — | `↳` | `font-weight` | `700` |
| 6 | — | `↳` | `line-height` | `20px` |
| 7 | — | `.multi-image-fusion-scene-grid` | `grid-template-columns` | `repeat(6,minmax(0,1fr))` |
| 7 | — | `↳` | `gap` | `12px` |
| 7 | — | `↳` | `display` | `grid` |
| 8 | — | `.multi-image-fusion-scene-card` | `color` | `#292a3e` |
| 8 | — | `↳` | `text-align` | `left` |
| 8 | — | `↳` | `cursor` | `pointer` |
| 8 | — | `↳` | `background` | `#fff` |
| 8 | — | `↳` | `border` | `1px solid #e2e3eb` |
| 8 | — | `↳` | `border-radius` | `14px` |
| 8 | — | `↳` | `min-width` | `0` |
| 8 | — | `↳` | `padding` | `11px` |
| 8 | — | `↳` | `transition` | `border-color .18s,box-shadow .18s,transform .18s` |
| 8 | — | `↳` | `display` | `block` |
| 8 | — | `↳` | `box-shadow` | `0 5px 16px #2d2f5009` |
| 9 | — | `.multi-image-fusion-scene-card:hover,.multi-image-fusion-scene-card:focus-visible` | `outline` | `none` |
| 9 | — | `↳` | `transform` | `translateY(-2px)` |
| 9 | — | `↳` | `box-shadow` | `0 10px 22px #594bbf21` |
| 10 | — | `.multi-image-fusion-scene-card:focus-visible` | `outline-offset` | `2px` |
| 10 | — | `↳` | `outline` | `2px solid #5b4cda52` |
| 11 | — | `.multi-image-fusion-scene-visual` | `color` | `#fff` |
| 11 | — | `↳` | `text-shadow` | `0 1px 3px #272b4f1f` |
| 11 | — | `↳` | `background` | `#f1f2f6` |
| 11 | — | `↳` | `border-radius` | `9px` |
| 11 | — | `↳` | `justify-content` | `center` |
| 11 | — | `↳` | `align-items` | `center` |
| 11 | — | `↳` | `min-height` | `86px` |
| 11 | — | `↳` | `font-size` | `13px` |
| 11 | — | `↳` | `font-weight` | `700` |
| 11 | — | `↳` | `display` | `flex` |
| 11 | — | `↳` | `position` | `relative` |
| 11 | — | `↳` | `overflow` | `hidden` |
| 12 | — | `.multi-image-fusion-scene-visual img` | `object-fit` | `contain` |
| 12 | — | `↳` | `width` | `100%` |
| 12 | — | `↳` | `height` | `100%` |
| 12 | — | `↳` | `transition` | `transform .24s` |
| 12 | — | `↳` | `display` | `block` |
| 13 | — | `.multi-image-fusion-scene-card:hover .multi-image-fusion-scene-visual img,.multi-image-fusion-scene-card:focus-visible .multi-image-fusion-scene-visual img` | `transform` | `scale(1.06)` |
| 14 | @media (prefers-reduced-motion:reduce) | `.multi-image-fusion-scene-visual img` | `transition` | `none` |
| 15 | @media (prefers-reduced-motion:reduce) | `.multi-image-fusion-scene-card:hover .multi-image-fusion-scene-visual img,.multi-image-fusion-scene-card:focus-visible .multi-image-fusion-scene-visual img` | `transform` | `none` |
| 16 | — | `.multi-image-fusion-scene-copy` | `gap` | `3px` |
| 16 | — | `↳` | `padding` | `9px 2px 1px` |
| 16 | — | `↳` | `display` | `grid` |
| 17 | — | `.multi-image-fusion-scene-copy strong` | `color` | `#292a3e` |
| 17 | — | `↳` | `font-size` | `13px` |
| 17 | — | `↳` | `font-weight` | `700` |
| 17 | — | `↳` | `line-height` | `18px` |
| 18 | — | `.multi-image-fusion-scene-copy small` | `color` | `#85869c` |
| 18 | — | `↳` | `text-overflow` | `ellipsis` |
| 18 | — | `↳` | `white-space` | `nowrap` |
| 18 | — | `↳` | `min-height` | `17px` |
| 18 | — | `↳` | `font-size` | `11px` |
| 18 | — | `↳` | `line-height` | `17px` |
| 18 | — | `↳` | `overflow` | `hidden` |
| 19 | — | `.multi-image-fusion-editor-head` | `justify-content` | `space-between` |
| 19 | — | `↳` | `align-items` | `center` |
| 19 | — | `↳` | `gap` | `16px` |
| 19 | — | `↳` | `height` | `38px` |
| 19 | — | `↳` | `margin-bottom` | `12px` |
| 19 | — | `↳` | `display` | `flex` |
| 20 | — | `.multi-image-fusion-editor-title` | `align-items` | `center` |
| 20 | — | `↳` | `gap` | `9px` |
| 20 | — | `↳` | `min-width` | `0` |
| 20 | — | `↳` | `display` | `flex` |
| 21 | — | `.multi-image-fusion-scene-back` | `color` | `#3e4055` |
| 21 | — | `↳` | `cursor` | `pointer` |
| 21 | — | `↳` | `background` | `#ffffffb8` |
| 21 | — | `↳` | `border` | `1px solid #e0e1e9` |
| 21 | — | `↳` | `border-radius` | `8px` |
| 21 | — | `↳` | `flex` | `none` |
| 21 | — | `↳` | `justify-content` | `center` |
| 21 | — | `↳` | `align-items` | `center` |
| 21 | — | `↳` | `width` | `30px` |
| 21 | — | `↳` | `height` | `30px` |
| 21 | — | `↳` | `padding` | `0` |
| 21 | — | `↳` | `font-size` | `12px` |
| 21 | — | `↳` | `transition` | `border-color .18s,color .18s,background .18s` |
| 21 | — | `↳` | `display` | `inline-flex` |
| 22 | — | `.multi-image-fusion-scene-back:hover,.multi-image-fusion-scene-back:focus-visible` | `color` | `#5848c7` |
| 22 | — | `↳` | `background` | `#f7f5ff` |
| 22 | — | `↳` | `border-color` | `#8e83e8` |
| 22 | — | `↳` | `outline` | `none` |
| 25 | @media (max-width:900px) | `.multi-image-fusion-scene-selection` | `width` | `100%` |
| 26 | @media (max-width:900px) | `.multi-image-fusion-scene-grid` | `grid-template-columns` | `repeat(2,minmax(0,1fr))` |
| 28 | @media (max-width:520px) | `.multi-image-fusion-scene-grid` | `grid-template-columns` | `minmax(0,1fr)` |
| 29 | @media (max-width:520px) | `.multi-image-fusion-scene-visual` | `min-height` | `72px` |
| 30 | @media (max-width:520px) | `.multi-image-fusion-editor-head` | `align-items` | `flex-start` |
| 30 | @media (max-width:520px) | `↳` | `height` | `auto` |
| 31 | @media (max-width:520px) | `.multi-image-fusion-editor-title p` | `max-width` | `220px` |
| 67 | — | `.multi-image-fusion-scene-state` | `color` | `#77758b` |
| 67 | — | `↳` | `justify-content` | `center` |
| 67 | — | `↳` | `align-items` | `center` |
| 67 | — | `↳` | `gap` | `8px` |
| 67 | — | `↳` | `min-height` | `180px` |
| 67 | — | `↳` | `font-size` | `13px` |
| 67 | — | `↳` | `display` | `flex` |
| 68 | — | `.multi-image-fusion-scene-state.is-error` | `color` | `#b64a5b` |
| 68 | — | `↳` | `flex-direction` | `column` |
| 68 | — | `↳` | `gap` | `12px` |
| 69 | — | `.multi-image-fusion-scene-state button` | `color` | `#5546d8` |
| 69 | — | `↳` | `cursor` | `pointer` |
| 69 | — | `↳` | `background` | `#f5f4ff` |
| 69 | — | `↳` | `border` | `1px solid #5546d847` |
| 69 | — | `↳` | `border-radius` | `8px` |
| 69 | — | `↳` | `padding` | `7px 14px` |
| 69 | — | `↳` | `font-size` | `12px` |
| 69 | — | `↳` | `font-weight` | `700` |
| 162 | @media (max-width:600px) | `.multi-image-fusion-scene-selection` | `width` | `100%` |
| 162 | @media (max-width:600px) | `↳` | `max-width` | `100%` |
| 163 | @media (max-width:600px) | `.multi-image-fusion-editor-head` | `grid-template-columns` | `minmax(0,1fr) auto` |
| 163 | @media (max-width:600px) | `↳` | `align-items` | `start` |
| 163 | @media (max-width:600px) | `↳` | `gap` | `8px` |
| 163 | @media (max-width:600px) | `↳` | `height` | `auto` |
| 163 | @media (max-width:600px) | `↳` | `margin-bottom` | `10px` |
| 163 | @media (max-width:600px) | `↳` | `display` | `grid` |
| 164 | @media (max-width:600px) | `.multi-image-fusion-editor-title,.multi-image-fusion-editor-title>div` | `min-width` | `0` |
| 165 | @media (max-width:600px) | `.multi-image-fusion-editor-title h1` | `font-size` | `18px` |
| 165 | @media (max-width:600px) | `↳` | `line-height` | `24px` |
| 166 | @media (max-width:600px) | `.multi-image-fusion-editor-title p` | `max-width` | `none` |
| 166 | @media (max-width:600px) | `↳` | `margin-top` | `2px` |
| 166 | @media (max-width:600px) | `↳` | `font-size` | `11px` |
| 166 | @media (max-width:600px) | `↳` | `line-height` | `16px` |
| 167 | @media (max-width:600px) | `.multi-image-fusion-scene-back` | `width` | `32px` |
| 167 | @media (max-width:600px) | `↳` | `height` | `32px` |
| 188 | @media (max-width:360px) | `.multi-image-fusion-editor-title p` | `font-size` | `10px` |
| 194 | @media (max-width:1200px) | `.multi-image-fusion-scene-grid` | `grid-template-columns` | `repeat(5,minmax(0,1fr))` |
| 195 | @media (max-width:899px) | `.multi-image-fusion-scene-grid` | `grid-template-columns` | `repeat(3,minmax(0,1fr))` |
| 196 | @media (max-width:767px) | `.multi-image-fusion-scene-grid` | `grid-template-columns` | `repeat(2,minmax(0,1fr))` |

### 5.3 区块 C — 工作区布局骨架

工作区布局骨架（基础规则 13 条 + 媒体查询内 13 条 = 26 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 33 | — | `.multi-image-fusion-header` | `justify-content` | `space-between` |
| 33 | — | `↳` | `align-items` | `flex-start` |
| 33 | — | `↳` | `gap` | `24px` |
| 33 | — | `↳` | `min-height` | `78px` |
| 33 | — | `↳` | `margin-bottom` | `20px` |
| 33 | — | `↳` | `display` | `flex` |
| 34 | — | `.multi-image-fusion-back` | `color` | `#74748d` |
| 34 | — | `↳` | `cursor` | `pointer` |
| 34 | — | `↳` | `background` | `0 0` |
| 34 | — | `↳` | `border` | `0` |
| 34 | — | `↳` | `border-radius` | `8px` |
| 34 | — | `↳` | `align-items` | `center` |
| 34 | — | `↳` | `gap` | `3px` |
| 34 | — | `↳` | `min-height` | `34px` |
| 34 | — | `↳` | `padding` | `6px 10px 6px 4px` |
| 34 | — | `↳` | `font-size` | `13px` |
| 34 | — | `↳` | `transition` | `color .18s,background .18s` |
| 34 | — | `↳` | `display` | `inline-flex` |
| 35 | — | `.multi-image-fusion-back:hover,.multi-image-fusion-back:focus-visible` | `color` | `#5546d8` |
| 35 | — | `↳` | `background` | `#efedff` |
| 36 | — | `.multi-image-fusion-back:focus-visible,.multi-image-fusion-result-actions button:focus-visible,.multi-image-fusion-ratio-options button:focus-visible,.multi-image-fusion-variant-options button:focus-visible,.multi-image-fusion-upload-empty:focus-visible,.multi-image-fusion-remove:focus-visible,.multi-image-fusion-thumbnails button:focus-visible,.multi-image-fusion-analyze-button:focus-visible,.multi-image-fusion-submit-button:focus-visible` | `outline-offset` | `2px` |
| 36 | — | `↳` | `outline` | `2px solid #5d4ddb6b` |
| 37 | — | `.multi-image-fusion-heading` | `text-align` | `center` |
| 37 | — | `↳` | `flex` | `auto` |
| 37 | — | `↳` | `min-width` | `0` |
| 38 | — | `.multi-image-fusion-heading h1,.multi-image-fusion-result-heading h2,.multi-image-fusion-card-heading h2` | `color` | `#26253d` |
| 38 | — | `↳` | `margin` | `0` |
| 39 | — | `.multi-image-fusion-heading h1` | `letter-spacing` | `-.03em` |
| 39 | — | `↳` | `margin-top` | `2px` |
| 39 | — | `↳` | `font-size` | `24px` |
| 39 | — | `↳` | `font-weight` | `700` |
| 39 | — | `↳` | `line-height` | `32px` |
| 40 | — | `.multi-image-fusion-heading p,.multi-image-fusion-result-heading p,.multi-image-fusion-card-heading p` | `color` | `#9897aa` |
| 40 | — | `↳` | `margin` | `4px 0 0` |
| 40 | — | `↳` | `font-size` | `12px` |
| 40 | — | `↳` | `line-height` | `19px` |
| 41 | — | `.multi-image-fusion-header-mark` | `color` | `#7265c9` |
| 41 | — | `↳` | `white-space` | `nowrap` |
| 41 | — | `↳` | `background` | `#f7f5ff` |
| 41 | — | `↳` | `border` | `1px solid #e6e1ff` |
| 41 | — | `↳` | `border-radius` | `999px` |
| 41 | — | `↳` | `align-items` | `center` |
| 41 | — | `↳` | `gap` | `5px` |
| 41 | — | `↳` | `min-height` | `30px` |
| 41 | — | `↳` | `padding` | `0 10px` |
| 41 | — | `↳` | `font-size` | `12px` |
| 41 | — | `↳` | `display` | `inline-flex` |
| 42 | — | `.multi-image-fusion-layout` | `grid-template-columns` | `minmax(360px,410px) minmax(0,1fr)` |
| 42 | — | `↳` | `align-items` | `start` |
| 42 | — | `↳` | `gap` | `20px` |
| 42 | — | `↳` | `display` | `grid` |
| 43 | — | `.multi-image-fusion-control-column` | `gap` | `14px` |
| 43 | — | `↳` | `min-width` | `0` |
| 43 | — | `↳` | `display` | `grid` |
| 133 | @media (max-width:1180px) | `.multi-image-fusion-layout` | `grid-template-columns` | `minmax(330px,380px) minmax(0,1fr)` |
| 133 | @media (max-width:1180px) | `↳` | `gap` | `15px` |
| 136 | @media (max-width:900px) | `.multi-image-fusion-layout` | `grid-template-columns` | `1fr` |
| 139 | @media (max-width:600px) | `.multi-image-fusion-header` | `flex-direction` | `column` |
| 139 | @media (max-width:600px) | `↳` | `align-items` | `stretch` |
| 139 | @media (max-width:600px) | `↳` | `gap` | `10px` |
| 139 | @media (max-width:600px) | `↳` | `min-height` | `0` |
| 140 | @media (max-width:600px) | `.multi-image-fusion-heading` | `text-align` | `left` |
| 140 | @media (max-width:600px) | `↳` | `order` | `-1` |
| 141 | @media (max-width:600px) | `.multi-image-fusion-header-mark` | `align-self` | `flex-start` |
| 152 | — | `.multi-image-fusion-layout` | `grid-template-columns` | `minmax(360px,432px) minmax(0,1fr)` |
| 152 | — | `↳` | `align-items` | `stretch` |
| 152 | — | `↳` | `gap` | `16px` |
| 152 | — | `↳` | `height` | `100%` |
| 152 | — | `↳` | `min-height` | `0` |
| 153 | — | `.multi-image-fusion-control-column` | `scrollbar-gutter` | `stable` |
| 153 | — | `↳` | `flex-direction` | `column` |
| 153 | — | `↳` | `gap` | `10px` |
| 153 | — | `↳` | `height` | `100%` |
| 153 | — | `↳` | `min-height` | `0` |
| 153 | — | `↳` | `display` | `flex` |
| 153 | — | `↳` | `overflow` | `hidden auto` |
| 158 | @media (max-width:900px) | `.multi-image-fusion-layout` | `height` | `auto` |
| 159 | @media (max-width:900px) | `.multi-image-fusion-control-column,.multi-image-fusion-result-panel` | `height` | `auto` |
| 159 | @media (max-width:900px) | `↳` | `max-height` | `none` |
| 159 | @media (max-width:900px) | `↳` | `overflow` | `visible` |
| 168 | @media (max-width:600px) | `.multi-image-fusion-layout` | `grid-template-columns` | `minmax(0,1fr)` |
| 168 | @media (max-width:600px) | `↳` | `gap` | `10px` |
| 169 | @media (max-width:600px) | `.multi-image-fusion-control-column,.multi-image-fusion-upload-section,.multi-image-fusion-accessory-grid` | `box-sizing` | `border-box` |
| 169 | @media (max-width:600px) | `↳` | `width` | `100%` |
| 169 | @media (max-width:600px) | `↳` | `min-width` | `0` |
| 169 | @media (max-width:600px) | `↳` | `max-width` | `100%` |
| 189 | @media (min-width:901px) and (max-width:1366px) | `.product-sku-page,.product-sku-page.history-collapsed,.multi-image-fusion-layout` | `grid-template-columns` | `216px minmax(0,1fr)` |
| 190 | @media (min-width:901px) and (max-width:1366px) | `.multi-image-fusion-control-column` | `width` | `216px` |
| 190 | @media (min-width:901px) and (max-width:1366px) | `↳` | `max-width` | `216px` |
| 199 | @media (max-width:900px) | `.multi-image-fusion-control-column,.multi-image-fusion-result-panel,.multi-image-fusion-card` | `box-sizing` | `border-box` |
| 199 | @media (max-width:900px) | `↳` | `width` | `100%` |
| 199 | @media (max-width:900px) | `↳` | `min-width` | `0` |
| 199 | @media (max-width:900px) | `↳` | `max-width` | `none` |
| 200 | @media (max-width:900px) | `.multi-image-fusion-control-column,.multi-image-fusion-result-panel` | `height` | `auto` |
| 200 | @media (max-width:900px) | `↳` | `max-height` | `none` |
| 200 | @media (max-width:900px) | `↳` | `overflow` | `visible` |

### 5.4 区块 D — 卡片 / 卡片标题 / 步骤号 / 计数器

卡片 / 卡片标题 / 步骤号 / 计数器（基础规则 8 条 + 媒体查询内 4 条 = 12 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 44 | — | `.multi-image-fusion-card,.multi-image-fusion-result-panel` | `background` | `#fffffff0` |
| 44 | — | `↳` | `border` | `1px solid #ebeaf3` |
| 44 | — | `↳` | `border-radius` | `18px` |
| 44 | — | `↳` | `box-shadow` | `0 10px 30px #3733640b` |
| 45 | — | `.multi-image-fusion-card` | `padding` | `18px` |
| 46 | — | `.multi-image-fusion-card-heading` | `justify-content` | `space-between` |
| 46 | — | `↳` | `align-items` | `flex-start` |
| 46 | — | `↳` | `gap` | `12px` |
| 46 | — | `↳` | `margin-bottom` | `18px` |
| 46 | — | `↳` | `display` | `flex` |
| 47 | — | `.multi-image-fusion-card-heading>div` | `align-items` | `flex-start` |
| 47 | — | `↳` | `gap` | `10px` |
| 47 | — | `↳` | `min-width` | `0` |
| 47 | — | `↳` | `display` | `flex` |
| 48 | — | `.multi-image-fusion-card-heading.compact` | `margin-bottom` | `14px` |
| 49 | — | `.multi-image-fusion-card-heading h2` | `font-size` | `15px` |
| 49 | — | `↳` | `font-weight` | `700` |
| 49 | — | `↳` | `line-height` | `22px` |
| 50 | — | `.multi-image-fusion-step` | `color` | `#6659d0` |
| 50 | — | `↳` | `letter-spacing` | `.04em` |
| 50 | — | `↳` | `background` | `#f0eeff` |
| 50 | — | `↳` | `border-radius` | `9px` |
| 50 | — | `↳` | `flex` | `0 0 26px` |
| 50 | — | `↳` | `justify-content` | `center` |
| 50 | — | `↳` | `align-items` | `center` |
| 50 | — | `↳` | `width` | `26px` |
| 50 | — | `↳` | `height` | `26px` |
| 50 | — | `↳` | `font-size` | `10px` |
| 50 | — | `↳` | `font-weight` | `800` |
| 50 | — | `↳` | `display` | `inline-flex` |
| 51 | — | `.multi-image-fusion-count` | `color` | `#aeacbd` |
| 51 | — | `↳` | `text-align` | `right` |
| 51 | — | `↳` | `min-width` | `39px` |
| 51 | — | `↳` | `padding-top` | `3px` |
| 51 | — | `↳` | `font-size` | `11px` |
| 51 | — | `↳` | `line-height` | `18px` |
| 134 | @media (max-width:1180px) | `.multi-image-fusion-card,.multi-image-fusion-result-panel` | `border-radius` | `15px` |
| 143 | @media (max-width:600px) | `.multi-image-fusion-card,.multi-image-fusion-result-panel` | `padding` | `14px` |
| 170 | @media (max-width:600px) | `.multi-image-fusion-card,.multi-image-fusion-result-panel` | `box-sizing` | `border-box` |
| 170 | @media (max-width:600px) | `↳` | `border-radius` | `14px` |
| 170 | @media (max-width:600px) | `↳` | `width` | `100%` |
| 170 | @media (max-width:600px) | `↳` | `max-width` | `100%` |
| 170 | @media (max-width:600px) | `↳` | `padding` | `12px` |
| 171 | @media (max-width:600px) | `.multi-image-fusion-card-heading` | `margin-bottom` | `12px` |

### 5.5 区块 E — 上传区（主体图 / 搭配图）

上传区（主体图 / 搭配图）（基础规则 19 条 + 媒体查询内 12 条 = 31 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 52 | — | `.multi-image-fusion-upload-section+.multi-image-fusion-upload-section` | `margin-top` | `18px` |
| 53 | — | `.multi-image-fusion-field-label` | `color` | `#46455d` |
| 53 | — | `↳` | `justify-content` | `space-between` |
| 53 | — | `↳` | `align-items` | `center` |
| 53 | — | `↳` | `gap` | `12px` |
| 53 | — | `↳` | `min-height` | `22px` |
| 53 | — | `↳` | `margin-bottom` | `8px` |
| 53 | — | `↳` | `font-size` | `12px` |
| 53 | — | `↳` | `font-weight` | `700` |
| 53 | — | `↳` | `display` | `flex` |
| 54 | — | `.multi-image-fusion-field-label small` | `color` | `#aaa9ba` |
| 54 | — | `↳` | `font-size` | `11px` |
| 54 | — | `↳` | `font-weight` | `400` |
| 55 | — | `.multi-image-fusion-field-actions` | `flex` | `none` |
| 55 | — | `↳` | `align-items` | `center` |
| 55 | — | `↳` | `gap` | `8px` |
| 55 | — | `↳` | `margin-left` | `auto` |
| 55 | — | `↳` | `display` | `inline-flex` |
| 56 | — | `.multi-image-fusion-upload-empty` | `color` | `#aaa7bc` |
| 56 | — | `↳` | `cursor` | `pointer` |
| 56 | — | `↳` | `background` | `#fbfaff` |
| 56 | — | `↳` | `border` | `1px dashed #d8d4ee` |
| 56 | — | `↳` | `border-radius` | `13px` |
| 56 | — | `↳` | `flex-direction` | `column` |
| 56 | — | `↳` | `justify-content` | `center` |
| 56 | — | `↳` | `align-items` | `center` |
| 56 | — | `↳` | `gap` | `5px` |
| 56 | — | `↳` | `width` | `100%` |
| 56 | — | `↳` | `min-height` | `138px` |
| 56 | — | `↳` | `padding` | `15px` |
| 56 | — | `↳` | `transition` | `border-color .18s,background .18s,transform .18s` |
| 56 | — | `↳` | `display` | `flex` |
| 57 | — | `.multi-image-fusion-upload-empty:hover,.multi-image-fusion-upload-empty.is-dragging,.multi-image-fusion-accessory-grid.is-dragging` | `background` | `#f8f6ff` |
| 57 | — | `↳` | `border-color` | `#887be0` |
| 58 | — | `.multi-image-fusion-upload-empty:hover` | `transform` | `translateY(-1px)` |
| 59 | — | `.multi-image-fusion-upload-empty strong` | `color` | `#6157a7` |
| 59 | — | `↳` | `font-size` | `12px` |
| 59 | — | `↳` | `font-weight` | `600` |
| 59 | — | `↳` | `line-height` | `18px` |
| 60 | — | `.multi-image-fusion-upload-empty>span:last-child` | `color` | `#b5b2c2` |
| 60 | — | `↳` | `font-size` | `10px` |
| 60 | — | `↳` | `line-height` | `16px` |
| 61 | — | `.multi-image-fusion-upload-icon` | `color` | `#7366d1` |
| 61 | — | `↳` | `background` | `#eeebff` |
| 61 | — | `↳` | `border-radius` | `11px` |
| 61 | — | `↳` | `justify-content` | `center` |
| 61 | — | `↳` | `align-items` | `center` |
| 61 | — | `↳` | `width` | `36px` |
| 61 | — | `↳` | `height` | `36px` |
| 61 | — | `↳` | `margin-bottom` | `2px` |
| 61 | — | `↳` | `display` | `inline-flex` |
| 62 | — | `.multi-image-fusion-image-card` | `background` | `#f5f4fa` |
| 62 | — | `↳` | `border` | `1px solid #e7e5f0` |
| 62 | — | `↳` | `border-radius` | `13px` |
| 62 | — | `↳` | `min-width` | `0` |
| 62 | — | `↳` | `position` | `relative` |
| 62 | — | `↳` | `overflow` | `hidden` |
| 63 | — | `.multi-image-fusion-uploading` | `color` | `#5546d8` |
| 63 | — | `↳` | `background` | `#ffffffad` |
| 63 | — | `↳` | `justify-content` | `center` |
| 63 | — | `↳` | `align-items` | `center` |
| 63 | — | `↳` | `gap` | `5px` |
| 63 | — | `↳` | `font-size` | `12px` |
| 63 | — | `↳` | `font-weight` | `700` |
| 63 | — | `↳` | `display` | `inline-flex` |
| 63 | — | `↳` | `position` | `absolute` |
| 63 | — | `↳` | `inset` | `0` |
| 64 | — | `.multi-image-fusion-image-card>img` | `object-fit` | `contain` |
| 64 | — | `↳` | `cursor` | `zoom-in` |
| 64 | — | `↳` | `width` | `100%` |
| 64 | — | `↳` | `height` | `138px` |
| 64 | — | `↳` | `display` | `block` |
| 65 | — | `.multi-image-fusion-remove` | `color` | `#fff` |
| 65 | — | `↳` | `cursor` | `pointer` |
| 65 | — | `↳` | `background` | `#27243e9e` |
| 65 | — | `↳` | `border` | `0` |
| 65 | — | `↳` | `border-radius` | `7px` |
| 65 | — | `↳` | `justify-content` | `center` |
| 65 | — | `↳` | `align-items` | `center` |
| 65 | — | `↳` | `width` | `22px` |
| 65 | — | `↳` | `height` | `22px` |
| 65 | — | `↳` | `padding` | `0` |
| 65 | — | `↳` | `transition` | `background .18s` |
| 65 | — | `↳` | `display` | `inline-flex` |
| 65 | — | `↳` | `position` | `absolute` |
| 65 | — | `↳` | `top` | `7px` |
| 65 | — | `↳` | `right` | `7px` |
| 66 | — | `.multi-image-fusion-remove:hover` | `background` | `#ee6b83` |
| 70 | — | `.multi-image-fusion-accessory-grid` | `border` | `1px solid #0000` |
| 70 | — | `↳` | `border-radius` | `14px` |
| 70 | — | `↳` | `grid-template-columns` | `repeat(3,minmax(0,1fr))` |
| 70 | — | `↳` | `gap` | `8px` |
| 70 | — | `↳` | `padding` | `3px` |
| 70 | — | `↳` | `transition` | `border-color .18s,background .18s` |
| 70 | — | `↳` | `display` | `grid` |
| 71 | — | `.multi-image-fusion-accessory-grid .multi-image-fusion-upload-empty` | `border-radius` | `11px` |
| 71 | — | `↳` | `min-height` | `108px` |
| 71 | — | `↳` | `padding` | `8px` |
| 72 | — | `.multi-image-fusion-accessory-grid .multi-image-fusion-upload-icon` | `border-radius` | `9px` |
| 72 | — | `↳` | `width` | `29px` |
| 72 | — | `↳` | `height` | `29px` |
| 73 | — | `.multi-image-fusion-accessory-grid .multi-image-fusion-image-card>img` | `height` | `108px` |
| 150 | @media (prefers-reduced-motion:reduce) | `.multi-image-fusion-upload-empty,.multi-image-fusion-analyze-button,.multi-image-fusion-submit-button,.multi-image-fusion-thumbnails button,.multi-image-fusion-preview-image` | `transition` | `none` |
| 172 | @media (max-width:600px) | `.multi-image-fusion-upload-section+.multi-image-fusion-upload-section` | `margin-top` | `14px` |
| 173 | @media (max-width:600px) | `.multi-image-fusion-field-label` | `gap` | `8px` |
| 173 | @media (max-width:600px) | `↳` | `margin-bottom` | `6px` |
| 174 | @media (max-width:600px) | `.multi-image-fusion-field-label small` | `flex` | `none` |
| 174 | @media (max-width:600px) | `↳` | `font-size` | `10px` |
| 175 | @media (max-width:600px) | `.multi-image-fusion-upload-empty` | `box-sizing` | `border-box` |
| 175 | @media (max-width:600px) | `↳` | `max-width` | `100%` |
| 175 | @media (max-width:600px) | `↳` | `min-height` | `120px` |
| 175 | @media (max-width:600px) | `↳` | `padding` | `12px` |
| 176 | @media (max-width:600px) | `.multi-image-fusion-image-card>img` | `height` | `120px` |
| 177 | @media (max-width:600px) | `.multi-image-fusion-accessory-grid` | `grid-template-columns` | `repeat(2,minmax(0,1fr))` |
| 177 | @media (max-width:600px) | `↳` | `gap` | `8px` |
| 177 | @media (max-width:600px) | `↳` | `padding` | `0` |
| 178 | @media (max-width:600px) | `.multi-image-fusion-accessory-grid .multi-image-fusion-upload-empty` | `min-height` | `96px` |
| 179 | @media (max-width:600px) | `.multi-image-fusion-accessory-grid .multi-image-fusion-image-card>img` | `height` | `96px` |
| 191 | @media (min-width:901px) and (max-width:1366px) | `.multi-image-fusion-accessory-grid` | `grid-template-columns` | `repeat(2,minmax(0,1fr))` |
| 191 | @media (min-width:901px) and (max-width:1366px) | `↳` | `gap` | `8px` |
| 191 | @media (min-width:901px) and (max-width:1366px) | `↳` | `padding` | `0` |
| 192 | @media (min-width:901px) and (max-width:1366px) | `.multi-image-fusion-accessory-grid .multi-image-fusion-upload-empty` | `box-sizing` | `border-box` |
| 192 | @media (min-width:901px) and (max-width:1366px) | `↳` | `min-height` | `96px` |
| 192 | @media (min-width:901px) and (max-width:1366px) | `↳` | `padding` | `8px` |
| 193 | @media (min-width:901px) and (max-width:1366px) | `.multi-image-fusion-accessory-grid .multi-image-fusion-image-card>img` | `height` | `96px` |

### 5.6 区块 F — AI 分析按钮

AI 分析按钮（基础规则 5 条 + 媒体查询内 0 条 = 5 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 75 | — | `.multi-image-fusion-analyzed` | `color` | `#20a777` |
| 75 | — | `↳` | `white-space` | `nowrap` |
| 75 | — | `↳` | `align-items` | `center` |
| 75 | — | `↳` | `gap` | `3px` |
| 75 | — | `↳` | `padding-top` | `4px` |
| 75 | — | `↳` | `font-size` | `11px` |
| 75 | — | `↳` | `display` | `inline-flex` |
| 76 | — | `.multi-image-fusion-analyze-button,.multi-image-fusion-submit-button` | `color` | `#fff` |
| 76 | — | `↳` | `cursor` | `pointer` |
| 76 | — | `↳` | `background` | `linear-gradient(135deg,#6658dc,#8472ee)` |
| 76 | — | `↳` | `border` | `0` |
| 76 | — | `↳` | `justify-content` | `center` |
| 76 | — | `↳` | `align-items` | `center` |
| 76 | — | `↳` | `gap` | `7px` |
| 76 | — | `↳` | `transition` | `transform .18s,box-shadow .18s,opacity .18s` |
| 76 | — | `↳` | `display` | `inline-flex` |
| 76 | — | `↳` | `box-shadow` | `0 8px 18px #6658dc2e` |
| 77 | — | `.multi-image-fusion-analyze-button` | `border-radius` | `9px` |
| 77 | — | `↳` | `width` | `100%` |
| 77 | — | `↳` | `height` | `36px` |
| 77 | — | `↳` | `font-size` | `12px` |
| 77 | — | `↳` | `font-weight` | `600` |
| 78 | — | `.multi-image-fusion-analyze-button:hover:not(:disabled),.multi-image-fusion-submit-button:hover:not(:disabled)` | `transform` | `translateY(-1px)` |
| 78 | — | `↳` | `box-shadow` | `0 11px 22px #6658dc42` |
| 79 | — | `.multi-image-fusion-analyze-button:disabled,.multi-image-fusion-submit-button:disabled,.multi-image-fusion-result-actions button:disabled` | `opacity` | `.55` |
| 79 | — | `↳` | `cursor` | `not-allowed` |

### 5.7 区块 G — 描述编辑器（参考站当前流程未渲染）

描述编辑器（基础规则 6 条 + 媒体查询内 2 条 = 8 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 80 | — | `.multi-image-fusion-description` | `color` | `#6c6a82` |
| 80 | — | `↳` | `gap` | `6px` |
| 80 | — | `↳` | `margin-top` | `12px` |
| 80 | — | `↳` | `font-size` | `11px` |
| 80 | — | `↳` | `font-weight` | `600` |
| 80 | — | `↳` | `display` | `grid` |
| 81 | — | `.multi-image-fusion-description-editor` | `color` | `#45435b` |
| 81 | — | `↳` | `white-space` | `pre-wrap` |
| 81 | — | `↳` | `word-break` | `break-word` |
| 81 | — | `↳` | `background` | `#fbfaff` |
| 81 | — | `↳` | `border` | `1px solid #e6e4ee` |
| 81 | — | `↳` | `border-radius` | `9px` |
| 81 | — | `↳` | `outline` | `0` |
| 81 | — | `↳` | `width` | `100%` |
| 81 | — | `↳` | `min-height` | `160px` |
| 81 | — | `↳` | `max-height` | `320px` |
| 81 | — | `↳` | `padding` | `11px 12px` |
| 81 | — | `↳` | `font-size` | `12px` |
| 81 | — | `↳` | `font-weight` | `400` |
| 81 | — | `↳` | `line-height` | `21px` |
| 81 | — | `↳` | `position` | `relative` |
| 81 | — | `↳` | `overflow-y` | `auto` |
| 82 | — | `.multi-image-fusion-description-editor:empty:before` | `content` | `attr(data-placeholder)` |
| 82 | — | `↳` | `color` | `#aaa8ba` |
| 82 | — | `↳` | `pointer-events` | `none` |
| 83 | — | `.multi-image-fusion-description-editor:focus` | `border-color` | `#887be0` |
| 83 | — | `↳` | `box-shadow` | `0 0 0 3px #887be01c` |
| 84 | — | `.multi-image-fusion-description-token-companion` | `color` | `#ef9b12` |
| 84 | — | `↳` | `font-weight` | `700` |
| 85 | — | `.multi-image-fusion-description-token-subject` | `color` | `#6557d6` |
| 85 | — | `↳` | `font-weight` | `700` |
| 181 | @media (max-width:600px) | `.multi-image-fusion-description` | `gap` | `5px` |
| 181 | @media (max-width:600px) | `↳` | `margin-top` | `10px` |
| 182 | @media (max-width:600px) | `.multi-image-fusion-description-editor` | `min-height` | `120px` |
| 182 | @media (max-width:600px) | `↳` | `max-height` | `260px` |
| 182 | @media (max-width:600px) | `↳` | `padding` | `10px` |

### 5.8 区块 H — 输出参数（比例 / 变体）

输出参数（比例 / 变体）（基础规则 12 条 + 媒体查询内 6 条 = 18 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 74 | — | `.multi-image-fusion-analysis-card,.multi-image-fusion-parameter-card` | `padding-top` | `16px` |
| 74 | — | `↳` | `padding-bottom` | `16px` |
| 86 | — | `.multi-image-fusion-parameter-group+.multi-image-fusion-parameter-group` | `margin-top` | `16px` |
| 87 | — | `.multi-image-fusion-ratio-options,.multi-image-fusion-variant-options` | `gap` | `7px` |
| 87 | — | `↳` | `display` | `grid` |
| 88 | — | `.multi-image-fusion-ratio-options` | `grid-template-columns` | `repeat(4,minmax(0,1fr))` |
| 88 | — | `↳` | `gap` | `10px` |
| 89 | — | `.multi-image-fusion-ratio-options button,.multi-image-fusion-variant-options button` | `color` | `#77758c` |
| 89 | — | `↳` | `cursor` | `pointer` |
| 89 | — | `↳` | `background` | `#fff` |
| 89 | — | `↳` | `border` | `1px solid #e8e6ef` |
| 89 | — | `↳` | `border-radius` | `8px` |
| 89 | — | `↳` | `justify-content` | `center` |
| 89 | — | `↳` | `align-items` | `center` |
| 89 | — | `↳` | `transition` | `border-color .18s,color .18s,background .18s` |
| 89 | — | `↳` | `display` | `flex` |
| 90 | — | `.multi-image-fusion-ratio-options button` | `flex-direction` | `column` |
| 90 | — | `↳` | `gap` | `4px` |
| 90 | — | `↳` | `min-height` | `49px` |
| 90 | — | `↳` | `padding` | `8px` |
| 90 | — | `↳` | `font-size` | `13px` |
| 91 | — | `.multi-image-fusion-ratio-options button:hover,.multi-image-fusion-variant-options button:hover` | `color` | `#6255c5` |
| 91 | — | `↳` | `border-color` | `#aaa0ef` |
| 92 | — | `.multi-image-fusion-ratio-options button.selected,.multi-image-fusion-variant-options button.selected` | `color` | `#5d50c5` |
| 92 | — | `↳` | `box-shadow` | `none` |
| 92 | — | `↳` | `background` | `#f1efff` |
| 92 | — | `↳` | `border-color` | `#0000` |
| 93 | — | `.multi-image-fusion-ratio-preview` | `background` | `#f1efff` |
| 93 | — | `↳` | `border-radius` | `1px` |
| 93 | — | `↳` | `width` | `18px` |
| 93 | — | `↳` | `max-height` | `18px` |
| 93 | — | `↳` | `display` | `block` |
| 94 | — | `.multi-image-fusion-ratio-options button.selected .multi-image-fusion-ratio-preview` | `background` | `#5546d8` |
| 95 | — | `.multi-image-fusion-variant-options` | `grid-template-columns` | `repeat(4,minmax(0,1fr))` |
| 96 | — | `.multi-image-fusion-variant-options button` | `height` | `34px` |
| 96 | — | `↳` | `font-size` | `11px` |
| 147 | @media (max-width:600px) | `.multi-image-fusion-ratio-options` | `grid-template-columns` | `repeat(2,minmax(0,1fr))` |
| 147 | @media (max-width:600px) | `↳` | `gap` | `5px` |
| 149 | @media (max-width:600px) | `.multi-image-fusion-ratio-options button` | `min-height` | `48px` |
| 180 | @media (max-width:600px) | `.multi-image-fusion-analysis-card,.multi-image-fusion-parameter-card` | `padding-top` | `12px` |
| 180 | @media (max-width:600px) | `↳` | `padding-bottom` | `12px` |
| 183 | @media (max-width:600px) | `.multi-image-fusion-parameter-group+.multi-image-fusion-parameter-group` | `margin-top` | `12px` |
| 184 | @media (max-width:600px) | `.multi-image-fusion-ratio-options` | `gap` | `6px` |
| 185 | @media (max-width:600px) | `.multi-image-fusion-ratio-options button` | `min-height` | `46px` |
| 185 | @media (max-width:600px) | `↳` | `padding` | `6px` |

### 5.9 区块 I — 提交区 / 消息条

提交区 / 消息条（基础规则 8 条 + 媒体查询内 1 条 = 9 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 97 | — | `.multi-image-fusion-submit-area` | `z-index` | `5` |
| 97 | — | `↳` | `background` | `#f6f7fb` |
| 97 | — | `↳` | `flex` | `none` |
| 97 | — | `↳` | `margin-top` | `auto` |
| 97 | — | `↳` | `padding` | `16px 2px 2px` |
| 97 | — | `↳` | `position` | `sticky` |
| 97 | — | `↳` | `bottom` | `0` |
| 98 | — | `.multi-image-fusion-submit-button` | `border-radius` | `11px` |
| 98 | — | `↳` | `width` | `100%` |
| 98 | — | `↳` | `height` | `43px` |
| 98 | — | `↳` | `font-size` | `13px` |
| 98 | — | `↳` | `font-weight` | `700` |
| 99 | — | `.multi-image-fusion-submit-button small` | `color` | `#ffffffd1` |
| 99 | — | `↳` | `white-space` | `nowrap` |
| 99 | — | `↳` | `font-size` | `11px` |
| 99 | — | `↳` | `font-weight` | `400` |
| 100 | — | `.multi-image-fusion-message` | `min-height` | `18px` |
| 100 | — | `↳` | `margin` | `8px 2px 10px` |
| 100 | — | `↳` | `font-size` | `11px` |
| 100 | — | `↳` | `line-height` | `18px` |
| 101 | — | `.multi-image-fusion-message.success` | `color` | `#19936c` |
| 102 | — | `.multi-image-fusion-message.info` | `color` | `#7c6fbb` |
| 103 | — | `.multi-image-fusion-message.error` | `color` | `#d75a70` |
| 186 | @media (max-width:600px) | `.multi-image-fusion-submit-area` | `padding` | `12px 0 0` |
| 203 | — | `.image-tool-submit-area>.submit-row .primary-btn,.image-tool-submit-area>.product-retouch-submit-wrap .product-retouch-submit,.image-tool-submit-area>.product-retouch-submit-wrap .redraw-submit,.image-tool-submit-area>.multi-image-fusion-submit-button,.image-tool-submit-area>.product-sku-submit,.image-tool-submit-area>.primary-btn` | `box-sizing` | `border-box` |
| 203 | — | `↳` | `width` | `100%` |
| 203 | — | `↳` | `min-width` | `0` |

### 5.10 区块 J — 结果面板 / 预览舞台 / 缩略图

结果面板 / 预览舞台 / 缩略图（基础规则 26 条 + 媒体查询内 7 条 = 33 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 104 | — | `.multi-image-fusion-result-panel` | `background` | `linear-gradient(145deg,#fffffff7,#f9f8fff0)` |
| 104 | — | `↳` | `min-width` | `0` |
| 104 | — | `↳` | `min-height` | `660px` |
| 104 | — | `↳` | `padding` | `22px` |
| 105 | — | `.multi-image-fusion-result-heading` | `justify-content` | `space-between` |
| 105 | — | `↳` | `align-items` | `flex-start` |
| 105 | — | `↳` | `gap` | `18px` |
| 105 | — | `↳` | `margin-bottom` | `17px` |
| 105 | — | `↳` | `display` | `flex` |
| 106 | — | `.multi-image-fusion-result-heading h2` | `margin-top` | `2px` |
| 106 | — | `↳` | `font-size` | `18px` |
| 106 | — | `↳` | `font-weight` | `700` |
| 106 | — | `↳` | `line-height` | `25px` |
| 107 | — | `.multi-image-fusion-result-actions` | `align-items` | `center` |
| 107 | — | `↳` | `gap` | `7px` |
| 107 | — | `↳` | `display` | `flex` |
| 108 | — | `.multi-image-fusion-result-actions button` | `color` | `#716f86` |
| 108 | — | `↳` | `cursor` | `pointer` |
| 108 | — | `↳` | `background` | `#fffc` |
| 108 | — | `↳` | `border` | `1px solid #e5e3ef` |
| 108 | — | `↳` | `border-radius` | `8px` |
| 108 | — | `↳` | `align-items` | `center` |
| 108 | — | `↳` | `gap` | `5px` |
| 108 | — | `↳` | `height` | `32px` |
| 108 | — | `↳` | `padding` | `0 10px` |
| 108 | — | `↳` | `font-size` | `11px` |
| 108 | — | `↳` | `transition` | `border-color .18s,color .18s,background .18s` |
| 108 | — | `↳` | `display` | `inline-flex` |
| 109 | — | `.multi-image-fusion-result-actions button:hover:not(:disabled)` | `color` | `#5f51c6` |
| 109 | — | `↳` | `background` | `#f7f5ff` |
| 109 | — | `↳` | `border-color` | `#a69be9` |
| 110 | — | `.multi-image-fusion-preview-stage,.multi-image-fusion-result-empty` | `background-color` | `#fbfaff` |
| 110 | — | `↳` | `background-image` | `linear-gradient(45deg,#f3f1fa 25%,#0000 25%),linear-gradient(-45deg,#f3f1fa 25%,#0000 25%),linear-gradient(45deg,#0000 75%,#f3f1fa 75%),linear-gradient(-45deg,#0000 75%,#f3f1fa 75%),none` |
| 110 | — | `↳` | `background-position` | `0 0,0 8px,8px -8px,-8px 0` |
| 110 | — | `↳` | `background-repeat` | `repeat,repeat,repeat,repeat,repeat` |
| 110 | — | `↳` | `background-size` | `16px 16px` |
| 110 | — | `↳` | `background-attachment` | `scroll,scroll,scroll,scroll,scroll` |
| 110 | — | `↳` | `background-origin` | `padding-box,padding-box,padding-box,padding-box,padding-box` |
| 110 | — | `↳` | `background-clip` | `border-box,border-box,border-box,border-box,border-box` |
| 110 | — | `↳` | `border` | `1px solid #e7e5f1` |
| 110 | — | `↳` | `border-radius` | `15px` |
| 110 | — | `↳` | `justify-content` | `center` |
| 110 | — | `↳` | `align-items` | `center` |
| 110 | — | `↳` | `width` | `100%` |
| 110 | — | `↳` | `min-height` | `400px` |
| 110 | — | `↳` | `max-height` | `calc(100vh - 260px)` |
| 110 | — | `↳` | `display` | `flex` |
| 110 | — | `↳` | `position` | `relative` |
| 110 | — | `↳` | `overflow` | `hidden` |
| 111 | — | `.multi-image-fusion-preview-image` | `object-fit` | `contain` |
| 111 | — | `↳` | `cursor` | `zoom-in` |
| 111 | — | `↳` | `width` | `100%` |
| 111 | — | `↳` | `height` | `100%` |
| 111 | — | `↳` | `display` | `block` |
| 112 | — | `.multi-image-fusion-preview-stage .result-feedback-trigger` | `opacity` | `0` |
| 112 | — | `↳` | `visibility` | `hidden` |
| 112 | — | `↳` | `pointer-events` | `none` |
| 113 | — | `.multi-image-fusion-preview-stage:hover .result-feedback-trigger,.multi-image-fusion-preview-stage:focus-within .result-feedback-trigger` | `opacity` | `1` |
| 113 | — | `↳` | `visibility` | `visible` |
| 113 | — | `↳` | `pointer-events` | `auto` |
| 114 | — | `.multi-image-fusion-generating-state` | `color` | `#67647b` |
| 114 | — | `↳` | `flex-direction` | `column` |
| 114 | — | `↳` | `justify-content` | `center` |
| 114 | — | `↳` | `align-items` | `center` |
| 114 | — | `↳` | `gap` | `10px` |
| 114 | — | `↳` | `display` | `flex` |
| 115 | — | `.multi-image-fusion-generating-state>img` | `object-fit` | `contain` |
| 115 | — | `↳` | `width` | `52px` |
| 115 | — | `↳` | `height` | `52px` |
| 116 | — | `.multi-image-fusion-generating-state>strong` | `font-size` | `13px` |
| 116 | — | `↳` | `font-weight` | `600` |
| 117 | — | `.multi-image-fusion-preview-size` | `color` | `#fff` |
| 117 | — | `↳` | `backdrop-filter` | `blur(8px)` |
| 117 | — | `↳` | `background` | `#25223e8f` |
| 117 | — | `↳` | `border-radius` | `999px` |
| 117 | — | `↳` | `align-items` | `center` |
| 117 | — | `↳` | `gap` | `4px` |
| 117 | — | `↳` | `min-height` | `25px` |
| 117 | — | `↳` | `padding` | `0 8px` |
| 117 | — | `↳` | `font-size` | `10px` |
| 117 | — | `↳` | `display` | `inline-flex` |
| 117 | — | `↳` | `position` | `absolute` |
| 117 | — | `↳` | `bottom` | `12px` |
| 117 | — | `↳` | `right` | `12px` |
| 118 | — | `.multi-image-fusion-thumbnails` | `grid-template-columns` | `repeat(4,max-content)` |
| 118 | — | `↳` | `justify-content` | `center` |
| 118 | — | `↳` | `gap` | `9px` |
| 118 | — | `↳` | `margin-top` | `12px` |
| 118 | — | `↳` | `display` | `grid` |
| 119 | — | `.multi-image-fusion-thumbnails button` | `cursor` | `pointer` |
| 119 | — | `↳` | `background` | `#f1eff8` |
| 119 | — | `↳` | `border` | `2px solid #0000` |
| 119 | — | `↳` | `border-radius` | `10px` |
| 119 | — | `↳` | `min-width` | `0` |
| 119 | — | `↳` | `height` | `auto` |
| 119 | — | `↳` | `min-height` | `0` |
| 119 | — | `↳` | `padding` | `0` |
| 119 | — | `↳` | `transition` | `border-color .18s,transform .18s` |
| 119 | — | `↳` | `position` | `relative` |
| 119 | — | `↳` | `overflow` | `hidden` |
| 120 | — | `.multi-image-fusion-thumbnails button:hover` | `transform` | `translateY(-1px)` |
| 121 | — | `.multi-image-fusion-thumbnails button.selected` | `border-color` | `#7465dc` |
| 122 | — | `.multi-image-fusion-thumbnails img` | `object-fit` | `contain` |
| 122 | — | `↳` | `width` | `100%` |
| 122 | — | `↳` | `height` | `100%` |
| 122 | — | `↳` | `display` | `block` |
| 123 | — | `.multi-image-fusion-thumbnails button>span` | `color` | `#fff` |
| 123 | — | `↳` | `background` | `#24223b9e` |
| 123 | — | `↳` | `border-radius` | `6px` |
| 123 | — | `↳` | `justify-content` | `center` |
| 123 | — | `↳` | `align-items` | `center` |
| 123 | — | `↳` | `width` | `17px` |
| 123 | — | `↳` | `height` | `17px` |
| 123 | — | `↳` | `font-size` | `10px` |
| 123 | — | `↳` | `display` | `inline-flex` |
| 123 | — | `↳` | `position` | `absolute` |
| 123 | — | `↳` | `bottom` | `5px` |
| 123 | — | `↳` | `right` | `5px` |
| 124 | — | `.multi-image-fusion-result-empty` | `color` | `#aaa7ba` |
| 124 | — | `↳` | `text-align` | `center` |
| 124 | — | `↳` | `flex-direction` | `column` |
| 124 | — | `↳` | `gap` | `9px` |
| 124 | — | `↳` | `min-height` | `510px` |
| 130 | — | `.multi-image-fusion-result-empty strong` | `color` | `#67647b` |
| 130 | — | `↳` | `font-size` | `13px` |
| 130 | — | `↳` | `font-weight` | `600` |
| 131 | — | `.multi-image-fusion-result-empty p` | `color` | `#aaa7b8` |
| 131 | — | `↳` | `margin` | `0` |
| 131 | — | `↳` | `font-size` | `11px` |
| 137 | @media (max-width:900px) | `.multi-image-fusion-result-panel` | `min-height` | `0` |
| 138 | @media (max-width:900px) | `.multi-image-fusion-preview-stage,.multi-image-fusion-result-empty` | `min-height` | `min(58vh,510px)` |
| 144 | @media (max-width:600px) | `.multi-image-fusion-result-heading` | `flex-direction` | `column` |
| 144 | @media (max-width:600px) | `↳` | `align-items` | `stretch` |
| 145 | @media (max-width:600px) | `.multi-image-fusion-result-actions` | `width` | `100%` |
| 146 | @media (max-width:600px) | `.multi-image-fusion-result-actions button` | `flex` | `1 1 0` |
| 146 | @media (max-width:600px) | `↳` | `justify-content` | `center` |
| 148 | @media (max-width:600px) | `.multi-image-fusion-thumbnails` | `grid-template-columns` | `repeat(2,max-content)` |
| 154 | — | `.multi-image-fusion-result-panel` | `scrollbar-gutter` | `stable` |
| 154 | — | `↳` | `flex-direction` | `column` |
| 154 | — | `↳` | `height` | `100%` |
| 154 | — | `↳` | `min-height` | `0` |
| 154 | — | `↳` | `max-height` | `100%` |
| 154 | — | `↳` | `display` | `flex` |
| 154 | — | `↳` | `overflow` | `hidden` |
| 155 | — | `.multi-image-fusion-preview-stage,.multi-image-fusion-result-empty` | `width` | `min(100%, calc((100vh - var(--workspace-topbar-height) - 280px) * var(--fusion-ratio-width) / var(--fusion-ratio-height)))` |
| 155 | — | `↳` | `flex` | `none` |
| 155 | — | `↳` | `min-height` | `0` |
| 155 | — | `↳` | `max-height` | `none` |
| 155 | — | `↳` | `margin-inline` | `auto` |
| 156 | — | `.multi-image-fusion-thumbnails button` | `aspect-ratio` | `auto` |
| 156 | — | `↳` | `height` | `74px` |
| 156 | — | `↳` | `min-height` | `0` |
| 160 | @media (max-width:900px) | `.multi-image-fusion-preview-stage,.multi-image-fusion-result-empty` | `width` | `100%` |
| 160 | @media (max-width:900px) | `↳` | `max-height` | `none` |

### 5.11 区块 K — 结果空态插画

结果空态插画（基础规则 5 条 + 媒体查询内 0 条 = 5 条）

| # | 媒体上下文 | 选择器 | 属性 | 参考站字面值 |
|---|---|---|---|---|
| 125 | — | `.multi-image-fusion-empty-art` | `width` | `96px` |
| 125 | — | `↳` | `height` | `78px` |
| 125 | — | `↳` | `margin-bottom` | `8px` |
| 125 | — | `↳` | `position` | `relative` |
| 126 | — | `.multi-image-fusion-empty-art>span` | `color` | `#8c80d7` |
| 126 | — | `↳` | `background` | `#ffffffd6` |
| 126 | — | `↳` | `border` | `1px solid #ddd9f1` |
| 126 | — | `↳` | `border-radius` | `12px` |
| 126 | — | `↳` | `justify-content` | `center` |
| 126 | — | `↳` | `align-items` | `center` |
| 126 | — | `↳` | `display` | `inline-flex` |
| 126 | — | `↳` | `position` | `absolute` |
| 126 | — | `↳` | `box-shadow` | `0 8px 16px #5d4fa914` |
| 127 | — | `.multi-image-fusion-empty-art>span:first-child` | `width` | `50px` |
| 127 | — | `↳` | `height` | `50px` |
| 127 | — | `↳` | `top` | `12px` |
| 127 | — | `↳` | `left` | `3px` |
| 127 | — | `↳` | `transform` | `rotate(-9deg)` |
| 128 | — | `.multi-image-fusion-empty-art>span:nth-child(2)` | `z-index` | `1` |
| 128 | — | `↳` | `color` | `#685bd0` |
| 128 | — | `↳` | `background` | `#f1efff` |
| 128 | — | `↳` | `width` | `46px` |
| 128 | — | `↳` | `height` | `46px` |
| 128 | — | `↳` | `top` | `0` |
| 128 | — | `↳` | `left` | `32px` |
| 129 | — | `.multi-image-fusion-empty-art>span:nth-child(3)` | `width` | `50px` |
| 129 | — | `↳` | `height` | `50px` |
| 129 | — | `↳` | `top` | `16px` |
| 129 | — | `↳` | `right` | `1px` |
| 129 | — | `↳` | `transform` | `rotate(9deg)` |

### 5.12 附：非 `multi-*` 但本页必需的共享规则（必须一并实施）

以下规则选择器不含 `multi-`，但**本页 DOM 依赖它们**，漏掉会立刻走形。均取自 E1 同一份 CSS 产物。

| 选择器 | 属性 | 参考站字面值 | 本页用途 |
|---|---|---|---|
| `.image-tool-submit-area` | `z-index` | `10` | 提交区容器 |
| `.image-tool-submit-area` | `box-sizing` | `border-box` | 同上 |
| `.image-tool-submit-area` | `background` | `#fff` | 同上 |
| `.image-tool-submit-area` | `border-radius` | `16px` | 同上 |
| `.image-tool-submit-area` | `gap` | `14px` | 同上 |
| `.image-tool-submit-area` | `width` | `100%` | 同上 |
| `.image-tool-submit-area` | `min-width` | `0` | 同上 |
| `.image-tool-submit-area` | `margin-top` | `auto` | 同上 |
| `.image-tool-submit-area` | `padding` | `14px 16px 16px` | 同上 |
| `.image-tool-submit-area` | `display` | `grid` | 同上 |
| `.image-tool-submit-area` | `position` | `sticky` | 同上 |
| `.image-tool-submit-area` | `bottom` | `0` | 同上 |
| `.image-output-settings-shell` | `position` | `relative` | 高级设置折叠壳 |
| `.image-output-settings-shell` | `container` | `image-output-settings/inline-size` | 容器查询上下文 |
| `.image-output-settings-summary` | `color` | `#687182` | 高级设置摘要按钮 |
| `.image-output-settings-summary` | `background` | `#fff` | 同上 |
| `.image-output-settings-summary` | `border` | `0` | 同上 |
| `.image-output-settings-summary` | `border-radius` | `9px 9px 6px 6px` | 同上（上圆下尖） |
| `.image-output-settings-summary` | `gap` | `8px` | 同上 |
| `.image-output-settings-summary` | `width` | `100%` | 同上 |
| `.image-output-settings-summary` | `min-height` | `46px` | 同上 |
| `.image-output-settings-summary` | `padding` | `0 12px` | 同上 |
| `.image-output-settings-summary` | `font-size` | `11px` | 同上 |
| `.image-output-settings-summary` | `display` | `flex` | 同上 |
| `.image-output-settings-summary-label` | `color` | `#454c59` | 「高级设置」文字 |
| `.image-output-settings-summary-label` | `margin-right` | `auto` | 同上 |
| `.image-output-settings-summary-label` | `font-size` | `12px` | 同上 |
| `.image-output-settings-summary-label` | `font-weight` | `600` | 同上 |
| `.image-output-settings-chip` | `color` | `#48505e` | 「比例 1:1」/「画质 1K」胶囊 |
| `.image-output-settings-chip` | `background` | `#fff` | 同上 |
| `.image-output-settings-chip` | `border` | `1px solid #e4e7ef` | 同上 |
| `.image-output-settings-chip` | `border-radius` | `5px` | 同上 |
| `.image-output-settings-chip` | `min-height` | `28px` | 同上 |
| `.image-output-settings-chip` | `padding` | `0 9px` | 同上 |
| `.image-output-settings-chip` | `font-size` | `11px` | 同上 |
| `.image-output-settings-chip` | `display` | `inline-flex` | 同上 |
| `.image-output-settings-popover` | `z-index` | `12` | 高级设置展开面板 |
| `.image-output-settings-popover` | `transform-origin` | `0 100%` | 同上 |
| `.image-output-settings-popover` | `background` | `#fff` | 同上 |
| `.image-output-settings-popover` | `border-radius` | `16px` | 同上 |
| `.image-output-settings-popover` | `width` | `100%` | 同上 |
| `.image-output-settings-popover` | `padding` | `17px 16px` | 同上 |
| `.image-output-settings-popover` | `animation` | `.2s ease-out both image-output-settings-rise` | 同上 |
| `.image-output-settings-popover` | `position` | `absolute` | 同上 |
| `.image-output-settings-popover` | `bottom` | `calc(100% + 8px)` | 同上（向上弹出） |
| `.image-output-settings-popover` | `left` | `0` | 同上 |
| `.image-output-settings-popover` | `box-shadow` | `0 8px 24px #3d425633` | 同上 |

### 5.13 关键覆盖冲突（必须知道，否则会照抄错值）

`.multi-image-fusion-submit-area` 与 `.image-tool-submit-area` **同时挂在同一个元素上**（E2 实测 `class="image-tool-submit-area multi-image-fusion-submit-area"`）。两者定义：

| 来源 | 源码偏移 | `background` | `padding` | `z-index` | `border-radius` | `gap` |
|---|---|---|---|---|---|---|
| `.multi-image-fusion-submit-area`（规则 #97） | 390 593 | `#f6f7fb` | `16px 2px 2px` | `5` | 无 | 无 |
| `.image-tool-submit-area`（共享） | 627 958 | `#fff` | `14px 16px 16px` | `10` | `16px` | `14px` |

**两者特异度相同（各 1 个 class），后定义者胜 → `.image-tool-submit-area` 全胜。**
E3 实测证实：`background rgb(255,255,255)`、`padding 14px 16px 16px`、`z-index 10`、`border-radius 16px`、`gap 14px`。
`.multi-image-fusion-submit-area` 的 `position:sticky; bottom:0; margin-top:auto; flex:none` 因共享类未声明这三个属性而**仍然生效**（E3 实测 `position: sticky` 确认）。

> **实施指令**：`.multi-image-fusion-submit-area` 这 5 个被覆盖的声明（`background`/`padding`/`z-index`）**照抄 E1 即可**，最终渲染结果一致；但如需减少维护困惑，可只实现共享类的 12 条 + sticky 三条，并在注释里标明「原 multi-* 声明已被共享类覆盖」。**不得**只实现 `.multi-image-fusion-submit-area` 而漏掉 `.image-tool-submit-area` —— 那会得到 `#f6f7fb` 灰底 + `z-index 5`，与参考站不符。

---

## 6. 本页专属 token 组建议（`--mif-*`）

### 6.1 为什么必须建专属 token 组

项目已有 `--wb-*`（工作台）先例，见 `global.css:101-156`。今天（2026-10-17）全局做过一次「品牌紫 / 中性色 / 圆角 / 字号收拢」：

| 全局收拢 token | 值 | 参考站多图融合页实际需要 |
|---|---|---|
| `--brand` | `#5546d8` | 一致 —（参考站 `#5546d8` 确实出现在 hover 态） |
| `--brand-light` | `#6c5ce7` | 不一致 — 参考站渐变浅端是 `#8472ee`，不是 `#6c5ce7` |
| `--brand-bg` | `#f1efff` | 部分一致 —（选中态底色） |
| `--text-strong` | `#171a2b` | 不一致 — 参考站标题是 `#26253d` |
| `--text-body` | `#4e5969` | 不一致 — 参考站是 `#46455d` / `#6c6a82` / `#45435b` |
| `--text-muted` | `#667085` | 不一致 — 参考站是 `#85869c` / `#9897aa` / `#aaa7ba` |
| `--text-desc` | `#86909c` | 不一致 — 参考站是 `#aaa9ba` / `#aaa8ba` |
| `--border` | `#e5e7ef` | 不一致 — 参考站是 `#e2e3eb` / `#ebeaf3` / `#e6e4ee` / `#e8e6ef` |
| `--surface` | `#f2f4f7` | 不一致 — 参考站是 `#f5f4fa` / `#fbfaff` / `#f1f2f6` |
| `--radius-card` | `12px` | 不一致 — 参考站卡片是 `18px`（面板）/ `14px`（场景卡）/ `13px`（上传槽） |
| `--radius-control` | `8px` | 部分一致 —（选项按钮 8px 对上了，但上传槽 13px、卡片 18px 全不同） |

**结论**：全局收拢 token 与参考站本页字面值**大面积冲突**。若继续引用全局 token，本页必然偏移。因此必须建 `--mif-*` 专属组，值**等于参考站字面值**。

### 6.2 Token 组定义（建议追加到 `global.css` 的 `:root`，紧随 `--wb-*` 区块之后）

```css
/* ────────────────────────────────────────────────────────────────
   多图融合专属精确值（参考站 multi-image-fusion-* 规则字面值, 2026-10-17 严格 1:1）
   用户要求多图融合「不偏移、没有差异」, 故此页不走全局收拢后的 token,
   单独以参考站产物 CSS 的字面值锁定, 逐条可追溯:
     .multi-image-fusion-page                    → width min(100%,1480px) padding 26px 32px 42px #24243b
     .multi-image-fusion-scene-card             → 1px #E2E3EB radius14 padding11 #2D2F5009 阴影
     .multi-image-fusion-scene-visual           → #F1F2F6 radius9 min-height86 13px/700
     .multi-image-fusion-layout                 → minmax(360px,410px) minmax(0,1fr) gap20
     .multi-image-fusion-card                   → #FFFFFFF0 1px #EBEAF3 radius18 阴影 0 10 30 #3733640B
     .multi-image-fusion-upload-empty           → #FBFAFF 虚线 1px #D8D4EE radius13 min-height138
     .multi-image-fusion-analyze-button         → 渐变 135deg #6658DC→#8472EE radius9 h36
     .multi-image-fusion-submit-button          → 渐变 135deg #6658DC→#8472EE radius11 h43
     .multi-image-fusion-result-panel           → 渐变 145deg #FFFFFFF7→#F9F8FFF0 radius18 padding22
     .multi-image-fusion-result-empty           → 棋盘格 #F3F1FA 16px 底 #FBFAFF radius15
     .multi-image-fusion-variant-options button → h34 11px radius8 选中 #F1EFFF/#5D50C5
   ──────────────────────────────────────────────────────────────── */

/* 文本色阶（参考站本页自有冷灰紫族，与全局中性色族不同） */
--mif-text-page: #24243b;         /* .multi-image-fusion-page 正文基色 */
--mif-text-title: #26253d;        /* h1 / h2 标题 */
--mif-text-title-2: #2d2e42;      /* 场景分组 h2 */
--mif-text-card: #292a3e;         /* 场景卡文字 / 场景名 strong */
--mif-text-label: #46455d;        /* 字段标签 */
--mif-text-body: #45435b;         /* 描述编辑器正文 */
--mif-text-body-2: #6c6a82;       /* 描述区引导文案 */
--mif-text-sub: #85869c;          /* 场景卡描述 / 工作区副标题 */
--mif-text-dim: #9897aa;          /* 结果卡副标题 */
--mif-text-dim-2: #aaa7ba;        /* 结果空态正文 */
--mif-text-dim-3: #aaa9ba;        /* 字段标签右侧 small */
--mif-text-dim-4: #b5b2c2;        /* 上传空态最弱提示 */
--mif-text-on-accent: #6157a7;    /* 上传空态主文案 */
--mif-text-accent: #7366d1;       /* 上传图标 */
--mif-text-accent-2: #6659d0;     /* 步骤号 */
--mif-text-accent-3: #5d50c5;     /* 选中项文字 */
--mif-text-accent-4: #5546d8;     /* hover / focus 强调 */
--mif-text-muted-btn: #77758c;    /* 未选中选项按钮 */
--mif-text-muted-btn-2: #716f86;  /* 结果区次按钮 */
--mif-text-back: #3e4055;         /* 返回按钮 */
--mif-text-on-dark: #67647b;      /* 预览区文字 */
--mif-text-on-dark-2: #aaa7b8;    /* 生成中文案弱化 */
--mif-text-art: #8c80d7;          /* 空态插画图标 */
--mif-text-art-2: #685bd0;        /* 空态插画中间层 */
--mif-text-count: #aeacbd;        /* 计数器 */
--mif-text-count-2: #aaa7bc;      /* 上传空态容器色 */

/* 表面 / 背景 */
--mif-surface-card: #fffffff0;      /* .multi-image-fusion-card 底 */
--mif-surface-panel: #ffffff;       /* 结果区按钮底 */
--mif-surface-panel-80: #ffffffb8;   /* 返回按钮底 */
--mif-surface-checker: #fbfaff;     /* 棋盘格底 / 上传空态底 */
--mif-surface-image: #f5f4fa;       /* 已上传图容器底 */
--mif-surface-scene-visual: #f1f2f6;/* 场景卡图区底 */
--mif-surface-step: #f0eeff;        /* 步骤号底 */
--mif-surface-selected: #f1efff;    /* 选中项底 */
--mif-surface-icon: #eeebff;        /* 上传图标底 */
--mif-surface-art: #ffffffd6;       /* 空态插画卡片底 */
--mif-surface-art-2: #f1efff;       /* 空态插画中间层底 */
--mif-surface-submit: #ffffff;      /* 提交区底（共享类覆盖后） */
--mif-surface-drag: #f8f6ff;        /* 拖拽悬停底 */
--mif-surface-back-hover: #f7f5ff;  /* 返回按钮 hover 底 */
--mif-surface-thumb: #f1eff8;       /* 缩略图底 */
--mif-surface-success: #19936c;      /* 消息 success 文字 */
--mif-surface-info: #7c6fbb;        /* 消息 info 文字 */
--mif-surface-error: #d75a70;       /* 消息 error 文字 */
--mif-surface-scene-error: #b64a5b; /* 场景错误态文字 */
--mif-surface-analyzed: #20a777;    /* 分析完成标记 */
--mif-surface-token-subject: #6557d6;
--mif-surface-token-companion: #ef9b12;
--mif-surface-remove-hover: #ee6b83;

/* 描边 */
--mif-border-card: #ebeaf3;         /* 卡片描边 */
--mif-border-scene: #e2e3eb;        /* 场景卡描边 */
--mif-border-back: #e0e1e9;         /* 返回按钮描边 */
--mif-border-dashed: #d8d4ee;       /* 上传槽虚线 */
--mif-border-option: #e8e6ef;       /* 选项按钮 */
--mif-border-option-hover: #aaa0ef; /* 选项 hover */
--mif-border-editor: #e6e4ee;       /* 描述编辑器 */
--mif-border-stage: #e7e5f1;        /* 预览舞台 */
--mif-border-art: #ddd9f1;          /* 空态插画 */
--mif-border-result-btn: #e5e3ef;   /* 结果区按钮 */
--mif-border-result-btn-hover: #a69be9;
--mif-border-checker: #e7e5f0;      /* 已上传图容器 */
--mif-border-transparent: #0000;
--mif-border-drag: #887be0;         /* 拖拽态 / focus 态 */
--mif-border-analyze: #5546d847;    /* 场景错误态按钮 */
--mif-border-scene-back-hover: #8e83e8;
--mif-border-thumb-selected: #7465dc;
--mif-focus-ring: #5d4ddb6b;        /* 全页统一 focus-visible */
--mif-focus-ring-strong: #5b4cda52; /* 场景卡 focus-visible */

/* 渐变（同色系深紫→浅紫，非紫→粉，不触 P0-2） */
--mif-gradient-cta: linear-gradient(135deg, #6658dc, #8472ee);
--mif-gradient-panel: linear-gradient(145deg, #fffffff7, #f9f8fff0);

/* 棋盘格（透明底占位纹理，四层 45deg 渐变） */
--mif-checker:
  linear-gradient(45deg, #f3f1fa 25%, #0000 25%),
  linear-gradient(-45deg, #f3f1fa 25%, #0000 25%),
  linear-gradient(45deg, #0000 75%, #f3f1fa 75%),
  linear-gradient(-45deg, #0000 75%, #f3f1fa 75%),
  none;
--mif-checker-size: 16px 16px;
--mif-checker-pos: 0 0, 0 8px, 8px -8px, -8px 0;

/* 阴影 */
--mif-shadow-card: 0 10px 30px #3733640b;
--mif-shadow-scene: 0 5px 16px #2d2f5009;
--mif-shadow-scene-hover: 0 10px 22px #594bbf21;
--mif-shadow-cta: 0 8px 18px #6658dc2e;
--mif-shadow-cta-hover: 0 11px 22px #6658dc42;
--mif-shadow-art: 0 8px 16px #5d4fa914;

/* 圆角（参考站本页共 9 档，超出全局 5 档） */
--mif-radius-card: 18px;      /* 卡片 / 结果面板 */
--mif-radius-scene: 14px;     /* 场景卡 / 搭配图网格 */
--mif-radius-stage: 15px;     /* 预览舞台 / 结果空态 */
--mif-radius-upload: 13px;    /* 上传槽 / 已上传图容器 */
--mif-radius-option: 8px;     /* 选项按钮 / 移除按钮 / 返回按钮 */
--mif-radius-cta: 11px;       /* 主 CTA */
--mif-radius-upload-sm: 11px; /* 搭配图槽内上传槽 */
--mif-radius-scene-visual: 9px; /* 场景卡图区 */
--mif-radius-icon: 11px;      /* 上传图标底 */
--mif-radius-icon-sm: 9px;    /* 搭配图槽内上传图标底 */
--mif-radius-art: 12px;       /* 空态插画卡片 */
--mif-radius-badge: 6px;      /* 缩略图序号 */
--mif-radius-remove: 7px;     /* 移除按钮 */
--mif-radius-pill: 999px;     /* 尺寸胶囊 / header-mark */

/* 间距（按区块归组，避免散写） */
--mif-gap-layout: 20px;        /* 桌面端两列间距 */
--mif-gap-column: 14px;       /* 控制列卡片间距 */
--mif-gap-control: 10px;      /* 901-1366px 控制列间距 */
--mif-gap-section: 18px;      /* 上传分区间距 */
--mif-gap-heading: 12px;      /* 卡片标题内部间距 */
--mif-gap-option: 7px;        /* 选项网格间距 */
--mif-gap-option-wide: 10px;  /* 比例网格间距 */
--mif-gap-field: 12px;        /* 字段标签内部间距 */
--mif-gap-tight: 5px;         /* 上传空态图文间距 / 描述区 */
--mif-gap-result: 18px;       /* 结果标题内部间距 */
--mif-gap-actions: 7px;       /* 结果按钮间距 */

/* 字号 / 行高 / 字重（参考站本页自有阶梯） */
--mif-text-page-size: 16px;
--mif-h1-size: 24px;   --mif-h1-lh: 32px;  --mif-h1-tracking: -.03em; --mif-h1-weight: 700;
--mif-h2-size: 18px;   --mif-h2-lh: 25px;  --mif-h2-weight: 700;   /* 结果卡标题 */
--mif-h2b-size: 18px;  --mif-h2b-lh: 24px; --mif-h2b-weight: 750;  --mif-h2b-tracking: -.02em; /* 工作区标题 */
--mif-h3-size: 15px;   --mif-h3-lh: 22px;  --mif-h3-weight: 700;   /* 卡片标题 */
--mif-h4-size: 14px;   --mif-h4-lh: 20px;  --mif-h4-weight: 700;   /* 场景分组 h2 */
--mif-body-size: 13px; --mif-body-lh: 18px;
--mif-body-strong-size: 13px; --mif-body-strong-weight: 600; /* 空态 strong */
--mif-label-size: 12px; --mif-label-weight: 700; --mif-label-lh: 22px;
--mif-sub-size: 12px;  --mif-sub-lh: 19px;
--mif-sub-lh-2: 18px;  /* 工作区副标题 */
--mif-small-size: 11px; --mif-small-lh: 17px;
--mif-tiny-size: 10px;  --mif-tiny-lh: 16px;
--mif-mono-size: 11px;  --mif-editor-lh: 21px; /* 描述编辑器 */
--mif-step-size: 10px;  --mif-step-weight: 800; --mif-step-tracking: .04em;

/* 布局尺寸 */
--mif-col-min: 360px;
--mif-col-max: 410px;
--mif-col-narrow: 216px;      /* 901-1366px 侧栏压缩宽度 */
--mif-col-narrow-max: 432px; /* ≥1367px 控制列上限 */
--mif-page-max: 1480px;
--mif-panel-min-height: 660px;
--mif-stage-min-height: 400px;
--mif-empty-min-height: 510px;
--mif-upload-min-height: 138px;
--mif-upload-min-height-sm: 108px; /* 搭配图槽 */
--mif-image-h: 138px;             /* 已上传主体图高 */
--mif-image-h-sm: 108px;          /* 已上传搭配图高 */
--mif-cta-h: 43px;                /* 主 CTA 高 */
--mif-analyze-h: 36px;            /* AI 分析按钮高 */
--mif-option-h: 34px;             /* 变体按钮高 */
--mif-result-btn-h: 32px;         /* 结果区按钮高 */
--mif-back-size: 30px;            /* 返回按钮 */
--mif-step-size-box: 26px;        /* 步骤号方块 */
--mif-icon-size: 36px;            /* 上传图标 */
--mif-icon-size-sm: 29px;         /* 搭配图槽图标 */
--mif-remove-size: 22px;          /* 移除按钮 */
--mif-thumb-badge: 17px;          /* 缩略图序号 */
--mif-editor-min-h: 160px;
--mif-editor-max-h: 320px;

/* 动效（参考站统一 .18s / .24s，本页专属，不受全局动效 token 收拢影响） */
--mif-motion-fast: .18s;
--mif-motion-img: .24s;
--mif-motion-pop: .2s;
```

### 6.3 Token 使用纪律

1. **本页所有颜色 / 圆角 / 阴影 / 间距 / 字号必须引用 `--mif-*`**，禁止在 `multi-*` 规则里直接写 hex（对齐 P0「禁止硬编码颜色值」）。
2. `--mif-gradient-cta` 是**同色系深紫→浅紫**（`#6658dc` → `#8472ee`），不属 P0-2 禁止的「紫→粉」组合，**必须原样保留**，不得替换为品牌单色。
3. 若全局日后再次收拢，`--mif-*` 优先，`--wb-*` 次之，全局 token 最后。

---

## 7. 当前实现 vs 参考站逐项差异清单

> 「当前值」列全部来自源码读取（E4）。本地 dev 服务 HTTP 502，**无浏览器实测值**（见 §1.1 E5）。
> 「判定」列：`必须改` = 影响观感或 1:1 目标；`可不改` = 附理由。

### 7.1 结构级差异（先看这个 —— 差异比数值大得多）

| # | 项 | 当前实现 | 参考站 | 判定 |
|---|---|---|---|---|
| S-1 | 步骤条 | **完全没有**。`MultiFusionPage.tsx` 无任何步骤指示元素 | 参考站**当前两步流也没有**步骤条。`.multi-image-fusion-step` 仅存在于 CSS，本流程不渲染（E2 实测未出现） | **可不改**。本地不渲染步骤条与参考站一致 |
| S-2 | 类名体系 | `mf-*` + 复用 `pk-*`（ProductKit 页的样式） | `multi-image-fusion-*` 全独立命名空间 | **可不改**（结构等价）。但若追求可追溯性，建议改名；改名会牵动 `pk-*` 复用，需权衡 |
| S-3 | 场景卡视觉区 | `.mf-scene-icon` 32×32 图标块（lucide `Sparkles`，**每张卡同一个图标**） | `.multi-image-fusion-scene-visual` 158×105 **真实 WebP 场景预览图**，15 张各不相同 | **必须改**（若要 1:1）。参考站 15 张卡各有独立场景图，本地全部同图标是明显 AI 味 + 与参考站不符 |
| S-4 | 场景卡数量 | 15 张（7 + 8） | 15 张（7 + 8），分组数一致 | 不改 |
| S-5 | 场景卡描述文案 | 7 张为自撰（如「搭配图以绣线质感附着主体表面」） | 7 张为参考站原文（§4.1 表） | **必须改**（文案属 1:1 范围，且本地版本句式与参考站体系不一致） |
| S-6 | 工作区标题区 | `.mf-section-header` 是**独立卡片**（白底 radius16 padding16） | `.multi-image-fusion-editor-head` 是**无底色透明行**（height 38px，紧贴页面顶部） | **必须改**。当前实现多了一个白卡片，参考站没有 |
| S-7 | 卡片数量 | 1 个 `.pk-config-card`（上传+AI分析+输出参数+提交 全塞进一张卡） | **4 张独立卡片**：upload-card / analysis-card / parameter-card / submit-area | **必须改**。这是本页最显眼的结构差异 |
| S-8 | 上传区 | 主体图与搭配图各一个全宽 `.mf-upload-btn`（min-height 96px / 72px） | 主体图全宽槽（min-height 138px）+ 搭配图 **3 列网格**内的小槽（min-height 96px） | **必须改**。搭配图参考站是多格网格（可放 5 张），本地是单按钮 |
| S-9 | 输出参数 | 「变体张数」4 个按钮 + 「高级设置」折叠壳（比例/画质） | 「变体张数」4 按钮 + `.image-output-settings-shell`（比例/画质） | 结构一致，**可不改** |
| S-10 | 比例/画质选项数 | 比例 8 项（`RATIO_OPTIONS`）、画质 3 项 | 比例 `.ratio-options` 为 `repeat(4,...)` 即 4 列（项数无证据，推断 8 项排 2 行）；画质项数无证据 | **可不改**（项数无参考站证据，不编造）。但比例网格列数 `4` 与本地 8 项 flex 布局观感不同，见 D-24 |
| S-11 | 结果区 | `.mf-result-panel` → `.pk-result-toolbar` + `.pk-result-body` | `.multi-image-fusion-result-panel` → `.result-heading` + `.result-empty` | 结构相近，**可不改**。但空态缺棋盘格底，见 D-19 |
| S-12 | 空态插画 | `.pk-preview-inner` + `<ToolEmptyIllustration />`（共用组件） | `.multi-image-fusion-empty-art` 96×78，**3 个绝对定位卡片各含一个内联 SVG**，旋转 -9°/0°/+9° | **必须改**（若要 1:1）。共用组件的插画与参考站的三卡片斜叠插画形态不同 |
| S-13 | 返回按钮 | `.mf-back-btn` 纯文字「返回场景列表」+ `ChevronLeft` 图标，无边框 | `.multi-image-fusion-scene-back` **30×30 方块**，只有箭头图标**无文字**，有边框+底色 | **必须改**。参考站是纯图标方块 |
| S-14 | 「立即生成」按钮 | `.pk-primary-btn`，height **40px**，圆角 8px，字重 **800** | `.multi-image-fusion-submit-button`，height **43px**，圆角 **11px**，字重 **700** | **必须改**（见 D-14/D-15/D-16） |
| S-15 | 提交区容器 | 无独立容器（提交按钮直接在卡片流内） | `.image-tool-submit-area` sticky 底部，白底 radius16，padding `14px 16px 16px` | **必须改**（sticky 是重要交互行为，见 D-13） |
| S-16 | 计数器 | `.pk-upload-count` **16px/24px #171a2b**（大号强调） | `.multi-image-fusion-count` **11px/18px #aeacbd**（弱化） | **必须改**（见 D-19，视觉权重完全相反） |
| S-17 | 字段标签结构 | `.mf-upload-block-head` > `strong` + `em`（「必传 · 1 张」用 `<em>` 标红）+ 文字链 | `.multi-image-fusion-field-label` > `span` + `small`（弱化灰）+ `.field-actions` | **必须改**（`<em>` 当前是 `--danger-ref` #eb5757 红色，参考站是灰色 small） |

### 7.2 数值级差异（逐属性）

#### 页面容器

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-1 | `.page` `padding` | `.mf-gateway` / `.pk-workspace` 负 margin `-24px -24px -32px` + `padding 24px 24px 24px 16px` | `26px 32px 42px`（基础）；901-1366px 时 `padding-left:24px` | **可不改**。实测参考站最终 `padding: 16px 16px 16px 24px`（基础 16px 被覆盖 + 1366px 媒体查询补 left 24px），本地负 margin 方案在**自有壳层**下等效。**前提**：本地壳层（顶栏+推广条）高度与参考站一致，否则 `calc(100vh - 104px)` 会偏 |
| D-2 | `.page` `color` | 继承 `--color-text` `#0f172a` | `#24243b` | **必须改**（页面基调色，#0f172a 偏冷黑，#24243b 偏紫灰） |
| D-3 | `.page` `width` | `.mf-gateway` `max-width:1200px` | `min(100%,1480px)` | **必须改**（参考站上限 1480px，本地 1200px 差 280px） |
| D-4 | `.page` `min-height` | `calc(100vh - 104px)`（硬编码 104） | `calc(100vh - var(--workspace-topbar-height))` | **可不改**（若本地顶栏+推广条确实 104px）。建议改用变量以便推广条开关联动 |

#### 场景网关

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-5 | 场景卡 `border-radius` | `12px` | `14px` | **必须改** |
| D-6 | 场景卡 `padding` | `14px` | `11px` | **必须改** |
| D-7 | 场景卡 `border` | `1px solid var(--surface)` → 解析为 `#f2f4f7` | `1px solid #e2e3eb` | **必须改**（当前色太浅，几乎看不出描边） |
| D-8 | 场景卡 `box-shadow` | 无（仅 hover 时 `0 4px 16px rgba(61,66,86,.08)`） | `0 5px 16px #2d2f5009`（常态就有） | **必须改** |
| D-9 | 场景卡 `color` | 无（继承 `#0f172a`） | `#292a3e` | **必须改** |
| D-10 | 场景卡 `gap` | `6px` | `3px`（`.scene-copy` 内） | **必须改** |
| D-11 | 场景卡 `transition` | `border-color .15s, box-shadow .15s` | `border-color .18s, box-shadow .18s, transform .18s` | **必须改**（缺 `transform`，无法实现参考站的 `translateY(-2px)` 悬浮） |
| D-12 | 场景卡 hover | 仅 `border-color` + `box-shadow` | `transform:translateY(-2px)` + `box-shadow:0 10px 22px #594bbf21` | **必须改** |
| D-13 | 场景分组 h2 | `.mf-scene-group-head` 是 flex 行（h2 + span 并排） | `.multi-image-fusion-scene-group h2` 是**独立块**，只有标题，无描述；`margin:0 0 10px 2px` | **必须改**。当前多了自撰的分组描述文字 |
| D-14 | 场景网格列数 | `repeat(auto-fill, minmax(180px,1fr))` | `repeat(6, minmax(0,1fr))`（实测 6 列） | **必须改**（auto-fill 在 1150px 下约 6 列，观感接近但不等价；≤1180px 变 5 列、≤900px 变 3/2/1 列，有明确断点） |

#### 卡片 / 卡片标题

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-15 | 卡片 `background` | `#fff` | `#fffffff0`（半透明白） | **必须改**（半透明会让底色透出，与纯白观感不同） |
| D-16 | 卡片 `border` | 无 | `1px solid #ebeaf3` | **必须改** |
| D-17 | 卡片 `border-radius` | `16px`（`.pk-config-card`） | `18px` | **必须改** |
| D-18 | 卡片 `box-shadow` | 无 | `0 10px 30px #3733640b` | **必须改** |
| D-19 | 卡片 `padding` | `16px` | `18px` | **必须改** |
| D-20 | 卡片标题 `margin-bottom` | 无（靠 `.pk-section` gap 24px） | `18px`（`.compact` 为 `14px`） | **必须改** |
| D-21 | 卡片标题字号 | `.pk-section-title` `14px/700`，`line-height:13px` | `15px/700`，`line-height:22px` | **必须改**（`line-height:13px` 小于字号，是明显 bug） |
| D-22 | 计数器字号/色 | `16px` / `var(--text-strong)` #171a2b | `11px` / `#aeacbd` | **必须改**（视觉权重完全相反） |
| D-23 | 分区间距 | `.pk-section { gap:16px }` + `.pk-config-card { gap:24px }` | 上传分区间 `margin-top:18px`；参数组间 `margin-top:16px` | **可不改**。16/18/24 三档混用 vs 参考站固定 18，观感接近。**建议**统一为 18 以对齐 |

#### 上传区

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-24 | 上传槽 `background` | `var(--surface)` → `#f2f4f7` | `#fbfaff`（极淡紫白） | **必须改** |
| D-25 | 上传槽 `border` | `1px dashed var(--border)` → `#e5e7ef` | `1px dashed #d8d4ee` | **必须改** |
| D-26 | 上传槽 `border-radius` | `8px` | `13px` | **必须改** |
| D-27 | 上传槽 `min-height` | `96px`（主体）/ `72px`（搭配） | `138px`（主体）/ `108px`（搭配网格内） | **必须改** |
| D-28 | 上传槽 `padding` | `16px` | `15px`（主体）/ `8px`（搭配网格内） | **必须改** |
| D-29 | 上传槽文案 | `.mf-upload-btn strong` `14px/400` | `12px/600`，色 `#6157a7` | **必须改** |
| D-30 | 上传槽副文案 | `.mf-upload-btn small` `12px` | `10px/16px`，色 `#b5b2c2` | **必须改** |
| D-31 | 上传图标 | lucide `ImagePlus` size 20，**无底色块** | `.multi-image-fusion-upload-icon` **36×36**，底 `#eeebff`，圆角 11px，色 `#7366d1` | **必须改**（参考站有圆角色块，本地没有） |
| D-32 | 「必传 · 1 张」 | `<em>` 色 `--danger-ref` **#eb5757 红** | `<small>` 色 `#aaa9ba` **灰**，11px/400 | **必须改**（红→灰，视觉权重差异大） |
| D-33 | 已上传图容器 | `.pk-thumb` `aspect-ratio:1`，`radius 8px`，`border 1px solid var(--border)` | `.multi-image-fusion-image-card` `radius 13px`，`background #f5f4fa`，`border 1px solid #e7e5f0`，**img 高 138px** | **必须改** |
| D-34 | 已上传图 `object-fit` | `.mf-upload-thumb img` `cover` | `contain` | **必须改**（cover 会裁图，contain 完整显示） |
| D-35 | 移除按钮 | `.mf-upload-thumb i` **18×18 圆形** `radius 999px`，`background rgba(17,24,39,.66)` | `.multi-image-fusion-remove` **22×22 方形** `radius 7px`，`background #27243e9e`，`top/right:7px` | **必须改**（形状/尺寸/位置均不同） |
| D-36 | 移除按钮 hover | `rgba(17,24,39,.85)` | `#ee6b83`（**变红**） | **必须改**（交互语义不同） |

#### AI 分析按钮

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-37 | 分析按钮 `width` | `justify-self:start` + `padding 0 14px`（**内容宽**） | `width:100%` | **必须改**（参考站是整行满宽按钮） |
| D-38 | 分析按钮 `height` | `32px` | `36px` | **必须改** |
| D-39 | 分析按钮 `border` | `1px solid var(--border)`（有边框） | `border:0`（**无边框**，纯渐变填充） | **必须改** |
| D-40 | 分析按钮 `border-radius` | `8px` | `9px` | **必须改** |
| D-41 | 分析按钮 `background` | `#fff` 白底 | `linear-gradient(135deg,#6658dc,#8472ee)` | **必须改**（白底描边 → 渐变实心，是主次 CTA 的层级关系） |
| D-42 | 分析按钮 `color` | `var(--brand)` #5546d8 | `#fff` | **必须改** |
| D-43 | 分析按钮 `box-shadow` | 无 | `0 8px 18px #6658dc2e` | **必须改** |
| D-44 | 分析按钮 `font-size` | `13px` | `12px` | **必须改** |

#### 输出参数

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-45 | 变体按钮容器 | `.mf-variant-row` `display:flex; gap:10px` | `.multi-image-fusion-variant-options` `display:grid; repeat(4,minmax(0,1fr)); gap:7px` | **必须改**（flex 自然宽 vs grid 等分，宽度分布不同） |
| D-46 | 变体按钮 `min-width` | `64px` | 无 min-width（grid 等分，实测 37.75px） | **必须改** |
| D-47 | 变体按钮 `height` | `36px` | `34px` | **必须改**（差 2px，**可不改**级别；但既然 1:1 就改） |
| D-48 | 变体按钮 `font-size` | `13px` | `11px` | **必须改** |
| D-49 | 变体按钮 `padding` | `0 12px` | 无（grid 等分） | **必须改** |
| D-50 | 变体选中态 `background` | `var(--brand-bg)` → `#f1efff` | `#f1efff` | 巧合一致，**可不改** |
| D-51 | 变体选中态 `border` | `1px solid var(--brand-active)` → `#5b4bd7` | `border-color:#0000`（**透明**，选中态去掉边框） | **必须改**（参考站选中时边框消失，不是变紫） |
| D-52 | 变体选中态 `color` | `var(--brand-active)` → `#5b4bd7` | `#5d50c5` | **必须改**（差值极小，**可不改**级别；为 1:1 建议改） |
| D-53 | 变体按钮 `gap` | `10px` | `7px` | **必须改** |

#### 提交区

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-54 | 提交区 sticky | **无**（`.pk-submit-row` 仅 `display:grid`） | `.image-tool-submit-area` `position:sticky; bottom:0; margin-top:auto` | **必须改**（滚动时提交按钮常驻可见，是重要交互行为） |
| D-55 | 提交区底色/圆角/padding | 无容器 | `#fff` / `16px` / `14px 16px 16px` | **必须改** |
| D-56 | 主 CTA `height` | `.pk-primary-btn` `40px` | `43px` | **必须改** |
| D-57 | 主 CTA `border-radius` | `8px` | `11px` | **必须改** |
| D-58 | 主 CTA `font-weight` | `800` | `700` | **必须改** |
| D-59 | 主 CTA `background` | `linear-gradient(90deg, var(--brand-light), var(--brand))` → `#6c5ce7→#5546d8`，**90deg** | `linear-gradient(135deg,#6658dc,#8472ee)`，**135deg**，**深→浅** | **必须改**。当前是浅→深且方向不同，视觉重心相反 |
| D-60 | 主 CTA `box-shadow` | 无 | `0 8px 18px #6658dc2e`；hover `0 11px 22px #6658dc42` | **必须改** |
| D-61 | 主 CTA hover | `filter: brightness(1.06)` | `transform:translateY(-1px)` + 阴影加深 | **必须改**（交互反馈方式不同：滤镜 vs 位移） |
| D-62 | 主 CTA 副文案 | `.pk-primary-credit` 无独立样式（继承 13px） | `.submit-button small` `11px/400`，色 `#ffffffd1` | **必须改**（当前「本次消耗40积分」与主文案同字号同色，层级缺失） |
| D-63 | 主 CTA `gap` | `8px` | `7px` | **可不改**（1px 差异，不影响观感） |
| D-64 | 主 CTA disabled | `opacity:0.55; cursor:not-allowed` | 完全一致 | 巧合一致，**可不改** |

#### 结果区

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-65 | 结果面板 `background` | `.mf-result-panel` `#fff` | `linear-gradient(145deg,#fffffff7,#f9f8fff0)` | **必须改** |
| D-66 | 结果面板 `border` | 无 | `1px solid #ebeaf3` | **必须改** |
| D-67 | 结果面板 `border-radius` | `16px` | `18px` | **必须改** |
| D-68 | 结果面板 `box-shadow` | 无 | `0 10px 30px #3733640b` | **必须改** |
| D-69 | 结果面板 `padding` | `.mf-result-body` `16px` | `22px` | **必须改** |
| D-70 | 结果面板 `min-height` | 无 | `660px` | **必须改**（防止空态面板过矮） |
| D-71 | 结果标题字号 | `.pk-result-title` `14px/600`，色 `#333` | `18px/700`，色 `#26253d` | **必须改** |
| D-72 | 结果副标题 | **无副标题** | `p` 12px/19px，`#9897aa`，`margin-top:4px`，文案「完成设置后，生成结果会显示在这里」 | **必须改**（缺元素，非仅样式） |
| D-73 | 结果按钮 `height` | `.pk-result-regen` `28px` | `32px` | **必须改** |
| D-74 | 结果按钮 `font-size` | `12px` | `11px` | **必须改** |
| D-75 | 结果按钮 `padding` | `0 12px` | `0 10px` | **必须改** |
| D-76 | 结果按钮 `border` | `1px solid var(--border-soft)` → `#e4e7ef` | `1px solid #e5e3ef` | **可不改**（色差极小，#e4e7ef vs #e5e3ef 肉眼不可辨） |
| D-77 | 结果按钮 `background` | `#fff` | `#fffc`（半透明白 80%） | **可不改**（在白底面板上两者不可辨） |
| D-78 | 结果按钮 `gap` | `6px` | `5px` | **可不改**（1px） |
| D-79 | 结果按钮间距 | `.tool-result-actions` 由共用组件定义 | `gap:7px` | **可不改**（共用组件已定，本页不另设） |
| D-80 | 空态背景 | `.mf-result-body .pk-preview-placeholder { background:transparent }` | 棋盘格 4 层 `linear-gradient` + 底 `#fbfaff`，`border 1px solid #e7e5f1`，`radius 15px` | **必须改**（棋盘格是本页标志性视觉，必须实现） |
| D-81 | 空态 `min-height` | `.pk-preview-inner` `min-height:260px` | `510px` | **必须改** |
| D-82 | 空态主文案 | `.pk-preview-inner h3` `14px/700` `#333` | `strong` `13px/600`，色 `#67647b` | **必须改** |
| D-83 | 空态副文案 | `.pk-preview-inner p` `12px`，色 `var(--text-desc)` #86909c | `p` `11px`，色 `#aaa7b8` | **必须改** |
| D-84 | 空态插画 | `<ToolEmptyIllustration />` 共用组件 | `.multi-image-fusion-empty-art` 96×78，3 个绝对定位卡片（50×50 / 46×46 / 50×50），旋转 -9°/0°/+9°，`radius 12px`，`box-shadow 0 8px 16px #5d4fa914` | **必须改** |
| D-85 | 空态额外文案 | `.tool-mock-note`「本地演示：融合结果为场景版式 + 真实图片层叠的参数化合成…」 | 参考站**无此元素** | **必须改**（应移除或移至页脚/说明位）。参考站空态只有 strong + p 两行 |
| D-86 | 结果详情卡 | `.pk-result-card` 存在（成功态渲染路径） | 参考站成功态为 `.multi-image-fusion-preview-stage` + `.multi-image-fusion-thumbnails`（棋盘格舞台 + 4 列缩略图网格） | **必须改**（结构不同，非样式差异） |
| D-87 | 结果参数 chip | `.pk-result-params`（`variantCount 张变体 · ratio · resolution`） | 参考站无此元素；有 `.multi-image-fusion-preview-size`（右下角尺寸胶囊，`backdrop-filter:blur(8px)`，`bg #25223e8f`） | **必须改** |

#### 工作区标题区

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-88 | 工作区标题字号/字重 | `.mf-section-header h1` `16px/700` | `18px/750`，`line-height:24px`，`letter-spacing:-.02em`，色 `#26253d` | **必须改** |
| D-89 | 工作区副标题 | `.mf-section-header p` `12px`，色 `var(--text-desc)` #86909c，无 margin | `12px/18px`，色 `#85869c`，`margin-top:1px` | **必须改**（色差 + 缺 margin） |
| D-90 | 返回按钮 | `.mf-back-btn` 纯文字，`padding:0`，无边框无底色，`font-size:12px` | `.multi-image-fusion-scene-back` **30×30 方块**，`border 1px solid #e0e1e9`，`radius 8px`，`bg #ffffffb8`，`padding:0`，**无文字** | **必须改**（形态完全不同） |
| D-91 | 标题区容器 | `.mf-section-header` 白底卡片 | `.multi-image-fusion-editor-head` `display:flex; justify-content:space-between; align-items:center; gap:16px; height:38px; margin-bottom:12px` | **必须改** |
| D-92 | 编辑器整体布局 | `.pk-workspace` grid `432px minmax(0,1fr)`，`align-items:start` | 基础 `minmax(360px,410px) minmax(0,1fr)` + `align-items:start`；901-1366px `216px minmax(0,1fr)`；≥1367px `minmax(360px,432px)` + `align-items:stretch` + `height:100%` | **必须改**（三档断点缺失，仅一档且值不同） |
| D-93 | 控制列滚动 | `.pk-input-pane` 无 `overflow` | `.multi-image-fusion-control-column` `overflow:hidden auto` + `scrollbar-gutter:stable` + `flex-direction:column` + `height:100%` | **必须改**（长内容滚动行为不同） |

#### 焦点态 / 无障碍

| # | 属性 | 当前值 | 参考站字面值 | 判定 |
|---|---|---|---|---|
| D-94 | focus-visible | 全局有 outline，但本页元素**未统一** | 参考站统一 `outline:2px solid #5d4ddb6b; outline-offset:2px`，覆盖 9 类可交互元素（back / result-actions / ratio-options / variant-options / upload-empty / remove / thumbnails / analyze / submit）；场景卡用 `2px solid #5b4cda52` | **必须改**（对齐 P0 规则 7「必须有可访问交互」） |
| D-95 | 触摸目标 | 变体按钮高 36px，结果按钮 28px，移除按钮 18px | 变体 34px，结果 32px，移除 22px | **部分必须改**：结果按钮 28px 与移除 18px 低于 WCAG 2.5.5 的 44px（参考站亦然）。**记录为已知偏差**，1:1 优先；如需合规可加 `::after` 扩大热区（不改变视觉） |
| D-96 | prefers-reduced-motion | 全局有 | `@media (prefers-reduced-motion:reduce)` 内 3 条 multi-* 规则（上传空态 / 分析按钮 / 提交按钮 `transition:none`） | **必须改** |

### 7.3 差异统计

| 判定 | 条数 |
|---|---|
| **必须改** | 82 |
| **可不改** | 12 |
| 结构级差异（另计，S-1 ~ S-17） | 17（其中 13 项必须处理） |

**核心结论**：当前实现与参考站是**两套不同的视觉语言**——本地是「白底 + 细描边 + 小圆角 + 主色描边按钮」，参考站是「半透明卡片 + 紫调中性色 + 大圆角 + 渐变实心按钮 + 棋盘格纹理」。且**结构层面**就存在 4 张卡片 vs 1 张卡片、搭配图网格 vs 单按钮等硬差异。因此本页**不能只调数值**，需要按 §2 区块地图重构 DOM 结构后再套 §6 的 `--mif-*` token。

---

## 8. 组件状态矩阵（对齐 token-standard.md §9 五态 + 我的 9 态）

| 组件 | Default | Hover | Focus | Active | Disabled | Loading | Error | Empty | Success |
|---|---|---|---|---|---|---|---|---|---|
| 场景卡 `.scene-card` | `border #e2e3eb` / `shadow 0 5 16 #2d2f5009` | `translateY(-2px)` + `shadow 0 10 22 #594bbf21` | `outline 2px #5b4cda52` offset 2 | 无参考站证据 | 无 | 无 | 无 | 选中态无参考站证据 |
| 上传空态 `.upload-empty` | 虚线 `#d8d4ee` / 底 `#fbfaff` | 底 `#f8f6ff` + 边框 `#887be0` + `translateY(-1px)` | `outline 2px #5d4ddb6b` | `.is-dragging` 同 hover | 无 | `.image-card` 内 `.uploading` 遮罩 `#ffffffad` | 无 | **本体即空态** | 上传后变 `.image-card` |
| 移除按钮 `.remove` | `bg #27243e9e` | `bg #ee6b83` | `outline 2px #5d4ddb6b` | 无 | 无 | 无 | 无 | 无 | 无 |
| 变体按钮 `.variant-options button` | `bg #fff` / `border #e8e6ef` / 色 `#77758c` | 色 `#6255c5` + 边框 `#aaa0ef` | `outline 2px #5d4ddb6b` | 无 | 无 | 无 | 无 | 未选中态 | `.selected`：`bg #f1efff` + 色 `#5d50c5` + 边框透明 |
| 比例按钮 `.ratio-options button` | 同变体 | 同变体 | 同变体 | 无 | 无 | 无 | 无 | 未选中 | `.selected` 同上 |
| AI 分析按钮 | 渐变 `#6658dc→#8472ee` | `translateY(-1px)` + `shadow 0 11 22 #6658dc42` | `outline 2px #5d4ddb6b` | 无 | `opacity:.55` + `not-allowed` | 无参考站证据 | 无 | 无 | `.analyzed` 标记 `#20a777` |
| 主 CTA `.submit-button` | 渐变 + `shadow 0 8 18 #6658dc2e` | `translateY(-1px)` + `shadow 0 11 22 #6658dc42` | `outline 2px #5d4ddb6b` | 无 | `opacity:.55` + `not-allowed` | 无参考站证据（推断为按钮内换文案） | `.message.error` `#d75a70` | 无 | `.message.success` `#19936c` |
| 结果区按钮 | `bg #fffc` / `border #e5e3ef` / 色 `#716f86` | 色 `#5f51c6` + 底 `#f7f5ff` + 边框 `#a69be9` | `outline 2px #5d4ddb6b` | 无 | `opacity:.55` + `not-allowed` | 无 | 无 | 空态时 disabled（实测确认） | 生成成功后启用 |
| 结果面板 | 渐变底 + 棋盘格舞台 | — | — | — | — | `.generating-state`（52×52 动图 + strong） | 生成失败态（无参考站样式证据） | `.result-empty` 棋盘格 + 三卡片插画 + strong + p | `.preview-stage` + `.thumbnails` |
| 消息条 `.message` | `min-height:18px` / `margin:8px 2px 10px` / 11px/18px | — | — | — | — | `.info` `#7c6fbb` | `.error` `#d75a70` | 空（无消息时不占位，因有 min-height） | `.success` `#19936c` |

---

## 9. 响应式断点（参考站实测，完整照抄）

| 断点 | 参考站行为（E1） |
|---|---|
| **≥1367px** | `.page` `width:100%; height:calc(100vh - var(--workspace-topbar-height)); min-height:0; margin:0; padding:16px; overflow:hidden`。`.layout` `grid-template-columns:minmax(360px,432px) minmax(0,1fr); align-items:stretch; gap:16px; height:100%; min-height:0`。`.control-column` flex column + `overflow:hidden auto` + `scrollbar-gutter:stable` + `gap:10px` + `height:100%`。`.result-panel` flex column + `height:100%` + `max-height:100%` + `overflow:hidden` + `scrollbar-gutter:stable`。`.preview-stage/.result-empty` `width:min(100%, calc((100vh - var(--workspace-topbar-height) - 280px) * var(--fusion-ratio-width) / var(--fusion-ratio-height)))`（**按比例自适应宽度**，`--fusion-ratio-*` 为运行时注入）。`.thumbnails button` `height:74px`。场景网格 `repeat(6,...)` |
| **901–1366px** | `.layout` `grid-template-columns:216px minmax(0,1fr)`；`.control-column` `width:216px; max-width:216px`；`.page` `padding-left:24px`；`.accessory-grid` `repeat(2,...)` + `gap:8px` + `padding:0`；搭配槽 `min-height:96px` + `padding:8px`；`.thumbnails button` `height:74px`；场景网格 `repeat(5,...)` |
| **≤1180px** | `.page` `padding-inline:22px`；`.layout` `grid-template-columns:minmax(330px,380px) minmax(0,1fr); gap:15px`；`.card/.result-panel` `border-radius:15px` |
| **≤900px** | `.page.is-scene-selection` `height:auto; min-height:calc(100vh - var(--workspace-topbar-height)); padding:16px 16px 24px`。`.page` `min-height:0; padding:18px 20px 32px`。`.layout` `grid-template-columns:1fr`。`.page.is-editor .layout` `height:auto`。`.result-panel` `min-height:0`。`.preview-stage/.result-empty` `min-height:min(58vh,510px)`。`.header` `flex-direction:column; align-items:stretch; gap:10px; min-height:0`。`.heading` `text-align:left; order:-1`。`.header-mark` `align-self:flex-start`。`.scene-grid` `repeat(3,...)`。`.scene-visual` `min-height:72px`。`.editor-head` `align-items:flex-start; height:auto`。`.editor-title p` `max-width:220px` |
| **≤899px** | `.accessory-grid` `repeat(2,...)`；场景网格 `repeat(2,...)` |
| **≤767px** | `.page,.page.is-scene-selection` `width:100%; max-width:100%; padding:12px 12px 24px`。`.editor-head` `display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:8px; height:auto; margin-bottom:10px`。`.editor-title h1` `18px/24px`。`.editor-title p` `max-width:none; margin-top:2px; font-size:11px; line-height:16px`。`.scene-back` `32×32`。`.layout` `grid-template-columns:minmax(0,1fr); gap:10px`。`.card,.result-panel` `border-radius:14px; width:100%; padding:12px`。`.card-heading` `margin-bottom:12px`。`.upload-section+` `margin-top:14px`。`.field-label` `gap:8px; margin-bottom:6px`；`small` `flex:none; font-size:10px`。`.upload-empty` `min-height:120px; padding:12px`。`.image-card>img` `height:120px`。`.accessory-grid` `repeat(2,...); gap:8px; padding:0`；槽 `min-height:96px`；`.image-card>img` `height:96px`。`.analysis-card,.parameter-card` `padding-top/bottom:12px`。`.description` `gap:5px; margin-top:10px`。`.description-editor` `min-height:120px; max-height:260px; padding:10px`。`.parameter-group+` `margin-top:12px`。`.ratio-options` `gap:6px`；`button` `min-height:46px; padding:6px`。`.submit-area` `padding:12px 0 0`。`.page` `padding:12px 0 24px` |
| **≤600px** | `.page` `padding-inline:14px`。`.card,.result-panel` `padding:14px`。`.result-heading` `flex-direction:column; align-items:stretch`。`.result-actions` `width:100%`；`button` `flex:1 1 0; justify-content:center`。`.ratio-options` `repeat(2,...); gap:5px`；`button` `min-height:48px`。`.thumbnails` `repeat(2,max-content)`。`.editor-title p` `font-size:10px`。`.page,.page.is-scene-selection,.card,.result-panel` `padding-inline:10px` |
| **≤560px** | `.image-output-settings-summary` `gap:5px; padding-inline:9px`；`.image-output-settings-chip` `min-height:26px; padding-inline:6px; font-size:10px`；`.image-tool-submit-area` `padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px)); position:static` |
| **≤520px** | `.page.is-editor .layout` `grid-template-columns:minmax(0,1fr); gap:10px; width:100%; height:auto; min-height:0`；`.control-column,.result-panel` `height:auto; max-height:none; overflow:visible`；`.control-column,.result-panel,.card` `width:100%; max-width:none` |
| **≤360px** | `.page.is-scene-selection` `padding-left:16px; padding-right:16px`；`.scene-grid` `repeat(2,...)` |
| **prefers-reduced-motion** | `.upload-empty,.analyze-button,.submit-button,.thumbnails button,.preview-image` `transition:none` |

---

## 10. 给前端工程师的实施提示

1. **先改结构，再改数值**。§7.1 的 13 项结构差异是硬差异，只调 CSS 无法收敛。建议顺序：① 按 §2 区块地图重写 `MultiFusionPage.tsx` 的 DOM（4 张卡片 / 搭配图网格 / 图标方块返回按钮 / 棋盘格空态）→ ② 追加 `--mif-*` token 到 `global.css` 的 `:root` → ③ 新增 `.multi-image-fusion-*` 规则（可沿用参考站原类名以便逐条对照）→ ④ 移除 `mf-*` 与本页对 `pk-*` 的复用。
2. **`--mif-*` 必须写进 CSS，颜色一律 `var(--mif-*)`**。这是 P0「禁止硬编码颜色值」在本页的落地方式。
3. **不要动 `--wb-*` 区块和 `global.css` 末尾的「工作台严格 1:1 覆盖层」**。`--mif-*` 追加在 `--wb-*` 之后即可。
4. **渐变原样保留**：`--mif-gradient-cta: linear-gradient(135deg, #6658dc, #8472ee)`。这是同色系深→浅紫，不是 P0-2 禁止的紫→粉。
5. **1366px 断点务必实现**（`.layout` → `216px minmax(0,1fr)`）。这是本次实测最容易漏的一条，且在 1280px 这类常见笔记本宽度下立刻可见。
6. **`.image-tool-submit-area` 系列 9 条共享规则必须一并落**，否则提交区底色/z-index 会错（§5.13）。
7. **`--fusion-ratio-width/height` 需由 JS 注入**，参考站 CSS 产物中无定义（§1.3）。本地若不做比例自适应预览，可省略 `.preview-stage` 的 `width:min(...)` 规则并在注释标明。
8. **focus-visible 统一**：`outline:2px solid var(--mif-focus-ring); outline-offset:2px`，覆盖 §8 矩阵中所有可交互元素（对齐 P0 规则 7）。
9. **prefers-reduced-motion** 必须实现（§9 末行）。
10. **诚实披露保留**：`MultiFusionPage.tsx` 现有的 mock 说明文案（`.tool-mock-note`）建议移出空态区（参考站空态只有 2 行文案），放在页面底部或折叠说明中——这是诚实披露，不是 AI 模板味，两者不冲突。
11. **文案按 §4.1 表逐字替换**，特别是 15 张场景卡的描述（本地 7 张为自撰，需换成参考站原文）。

---

## 11. 无证据项清单（禁止编造，实施前需实测补齐）

| 项 | 状态 |
|---|---|
| 本地浏览器 computed style 实测值 | **无证据** — dev 服务 HTTP 502 |
| `.image-card` / `.uploading` / `.remove` 的 DOM 结构与文案 | **推断** — 样式值确定（E1），结构需登录后实测 |
| `.preview-stage` / `.preview-size` 的 DOM 结构与文案 | **推断** — 同上 |
| `.thumbnails` 的 DOM 结构、每项 `span` 内文案（实测有 `font-size:10px`，疑为序号数字） | **推断** — 同上 |
| `.generating-state` 的 `strong` 文案 | **推断** — 同上 |
| `.message` 三态的实际触发文案 | **推断** — 只有颜色确定 |
| `.description-editor` 的 `data-placeholder` 实际文案 | **推断** — CSS 证明用 `attr(data-placeholder)`，内容无证据 |
| `.description-token-subject/-companion` 的触发逻辑 | **推断** — 只有颜色确定 |
| `.ratio-options` 的比例项数与顺序 | **无证据** — 只知 4 列布局；本地 8 项（1:1/4:3/3:4/16:9/9:16/2:3/3:2/21:9）无参考站对照 |
| 画质（`.image-output-settings-chip` 显示「画质 1K」）的**选项列表** | **无证据** — 只有 chip 显示值 |
| `.step`（步骤号）的使用场景 | **无证据** — 当前两步流不渲染 |
| `.scene-state` 的使用场景 | **无证据** — 当前两步流不渲染 |
| `.image-tool-submit-area` 在 ≤560px 的移动端覆盖值 | **有证据但需注意**：实测 `@media (max-width:900px)` 下有 `padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px)); position:static` |
| 参考站场景图的 15 张 WebP 素材 URL | **无证据** — 仅实测到末段 hash `cacb5e9303394dccbe16a58c109b60a6.webp`，完整路径需实测 |

---

## 12. 证据文件索引

| 文件 | 内容 |
|---|---|
| `/tmp/ref-app.css` | 参考站样式产物原件（719 353 字节） |
| `/tmp/extract_multi.py` | 递归下降 CSS 解析器（按源码顺序导出，保留 at-rule 上下文） |
| `/tmp/multi-rules.json` | 203 条 `multi-*` 规则的机器可读结构化导出 |
| `/tmp/gen_tables.py` | §5 表格生成脚本 |
| `/tmp/mif/tables.md` | §5 表格中间产物 |
| `frontend/src/pages/MultiFusionPage.tsx` | 当前实现（579 行） |
| `frontend/src/styles/global.css` | 当前样式（6 363 行；`--wb-*` 组在 130-156 行；`mf-*` 组在 3673-3963 行；`pk-*` 组在 1352-2270 行） |
