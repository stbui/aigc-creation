# /free-creation 复刻偏差清单（实拍对拍）

- 日期：2026-10-19
- 方法：Playwright + Chromium 1134，1440×900，同 locale=zh-CN，同时刻抓取 `https://ijihua.cn/free-creation` 与 `http://localhost:5100/free-creation`
- 证据目录：`frontend/e2e/audit/out/`（ref/local 各 4 张截图 + inventory/tree JSON）
- 采集脚本：`capture.mjs`（骨架+computed styles）、`diff.mjs`（文案/交互签名）、`workspace.mjs`（主区节点）、`probe-detail.mjs`、`probe-extra.mjs`、`probe-final.mjs`、`probe-shell.mjs`
- 原则：只比对可复现事实（盒模型数值 / computed style / 文案 / DOM 结构），不做像素比对

---

## 一、结论先行

参考站 `free-creation` 的骨架已高度对齐（432px 输入栏 + 1fr 结果栏 + 16 gap、主卡 radius16、textarea 400×80、dropzone 400×160、结果面板 784×764 均一致）。
但有 **9 项可量化偏差**，其中 **P0 三项**（提交按钮文案/禁用视觉、页面整体上移 8px 导致的纵向错位、上传区占位块缺失参考站的一层 thumb-grid 包裹）、**P4 三项**（字号/字重/色值微偏）。

另有 **诚实披露差异**（参考站 4K 可点、档位倍率由服务端下发；本站 4K 仅在模型线路可用时开放，三档恒 1 倍消耗）—— 属主动设计决策，非缺陷。

---

## 二、P0 偏差（影响功能契约或首屏观感）

### P0-1 提交按钮文案不一致

| 项 | 参考站 | 本站 | 位置 |
|---|---|---|---|
| 未登录主文案 | `登录免费生图` | `登录免费生成` | FreeCreationPage.tsx:408 `guestLabel` |

参考站按钮 id `free-creation-submit`，文案硬编码「登录免费生图」。
现有 e2e `tests/free-creation-submit.spec.ts:90,108` 断言的是 `登录免费生成`，改文案须同步改测试。

### P0-2 提交按钮禁用态视觉相反

| 态 | 参考站 | 本站 |
|---|---|---|
| disabled opacity | **1**（不淡出） | **0.55** |
| disabled 背景 | `rgb(197,185,246)` 纯色浅紫 | `linear-gradient(90deg,#6C5CE7,#5546D8)` + opacity 降透明 |
| disabled cursor | `not-allowed` | `not-allowed` ✅ |
| enabled 背景 | `linear-gradient(90deg,#7B61FF 0%,#5546D8 100%)` | `linear-gradient(90deg,#6C5CE7,#5546D8)` |

参考站做法是**换底色**而非降透明度；本站做法是**降透明度**。视觉明度不同：
- ref disabled = `#C5B9F6`（实底、白字）
- local disabled = 渐变叠加 55% 透明 ≈ 浅紫但更透

`global.css:2768 .pk-primary-btn:disabled { opacity: .55 }` + `global.css:3432-3435` 注释记录：曾按参考站改成 `opacity: 1` 后被回滚，理由是「用户看不出禁用」。
**这是显式的产品决策，与 1:1 复刻目标冲突，需用户裁定。**

### P0-3 页面纵向整体错位 8px（首屏观感）

| 节点 | 参考站 y | 本站 y | 差 |
|---|---|---|---|
| 主区容器 | 120 | 128 | +8 |
| 表单主卡 `.free-main-card` / `.pk-config-card` | 120 | 128 | +8 |
| 上传标题 | 132 | 144 | +12 |
| 提示词 label | 343 | 368 | +25 |
| textarea | 375 | 400 | +25 |
| 高级设置条 | 780 | 772 | −8 |
| 提交按钮 | 828 | 820 | −8 |
| 结果面板 | 120 / 764 高 | 128 / 748 高 | +8 / −16 |

成因（已定位到 CSS 行）：
- 参考站 `.workspace-view-root` 用 `padding: 104px 0 0`，主区自然落在 y=120
- 本站 `.pk-workspace`（global.css:2169-2179）用 `margin: -24px -24px -32px; padding: 24px 24px 24px 16px` 逃逸 `.app-content` 的 `padding: 24px 24px 32px`，净内边距算出 y=128
- 上传区 +4px 额外差：`.pk-config-card` gap `24px`（本站）vs `16px`（参考站）
- 上传 section gap `16px`（本站）vs `12px`（参考站）

结果：结果面板高度 748 vs 764（矮 16px），底部对齐但顶部错位。

---

## 三、P1 偏差（结构/局部样式）

### P1-1 表单主卡内边距与栅格间距

| 属性 | 参考站 `.free-main-card` | 本站 `.pk-config-card` |
|---|---|---|
| padding | `12px 16px` | `16px` |
| gap | `16px` | `24px` |

`global.css:2235-2241`

### P1-2 上传 section 间距

| 属性 | 参考站 `.free-upload-section` | 本站 `.pk-section` |
|---|---|---|
| gap | `12px` | `16px` |

`global.css:2242-2245`

### P1-3 上传区缺 thumb-grid 包裹层 + 占位 label 尺寸不同

参考站结构：`dropzone > div.upload-thumb-grid(flex, gap 8) > label.free-upload-add(366×126)`
本站结构：`dropzone > label.fc-upload-prompt(238×126)`（无 thumb-grid 中间层）

| 项 | 参考站 | 本站 |
|---|---|---|
| 占位 label box | 225,184 **366×126** | 289,201 **238×126** |
| label padding | `8px` | `0px` |
| label radius | `8px` | `0px` |
| label font-size | `12px` | `14px` |
| label color | `rgb(29,33,41)` | `rgb(78,89,105)` |
| dropzone display | `block`（gap 14px 不生效） | `grid` + `place-items:center` |

视觉上：参考站占位块铺满 dropzone 内区（留 8px 内边距 + 8px 圆角），本站居中一个 238px 窄块，无圆角。

### P1-4 提交区外层 `.free-actions` 有底色，本站无

| 项 | 参考站 `.free-actions` | 本站 `.fc-actions` |
|---|---|---|
| box | 192,750 **432×134** | 192,758 **432×118** |
| background | `rgb(246,247,251)` | 透明 |
| padding | `16px 0 0` | `0px` |
| 子节点 | 2（提交区 + 空的 `.free-secondary-actions`） | 1 |

参考站在提交卡上方有 16px 灰底过渡带；本站直接贴住。高度差 16px 与 P0-3 叠加。

### P1-5 高级设置浮层高度与组间距

> **2026-10-19 已修**：头部标题 fw 600→700、color `rgb(23,26,43)`→`rgb(41,40,57)`，见下文「修复记录」。
> **2026-10-21 已修**：头部→内容间距 35px→16px、分辨率卡主文改短档位、副文改 `#7c8493`，见下文「修复记录（2026-10-21，弹层批次）」。
> 其余项经裁定保留（4K 仅在模型线路可用时开放）。

| 项 | 参考站 | 本站 |
|---|---|---|
| popover box | 208,473 **400×299** | 208,446 **400×318**（差 19px 来自 P0-3 整体错位，布局批次已随主区一起归位） |
| popover gap | `normal`（靠内层 `.image-output-settings` gap 19px，头部另有 margin-bottom 16） | `0 19px` + 组间 `margin-top 19px` ✅ 已修（此前 grid gap 19 与 head margin 16 叠加成 35px） |
| 分辨率组 | 在同一个 `.image-output-settings` 容器内 | 独立 `.pk-settings-group`（视觉等价：容器本身无内边距/背景） |
| 头部标题 fw | `700` ✅ | `600` ✅ 已修为 700 |
| 头部标题 color | `rgb(41,40,57)` ✅ | `rgb(23,26,43)` ✅ 已修为 rgb(41,40,57) |
| 分辨率组标题 | `分辨率（积分/权益消耗）` | `分辨率（积分/权益消耗）` ✅ 已抄（2026-10-21 复核：该串是参考站**共享组件默认值**，全站只有这一种写法，不存在短标题版本） |
| 分辨率卡副文 | `{multiplier}倍消耗`（JSX: `<span>{multiplier}倍消耗</span>`，文案在 bundle 字符串表 0x4ab4；`multiplier` 由参考站 `billing-config` 按档位下发） | `1倍消耗` ✅ 已抄格式；取值用本站真实倍率 1（`generate.service:125` 扣费只取能力价，与 size 无关）。参考站的 2K/4K 倍率需登录才下发，未取证，不臆造 |
| 分辨率卡 strong | `1K` / `2K` / `4K`（`.image-output-resolution-option strong` 13px/500） | `1K` / `2K` / `4K` ✅ 已修（原为后端 label `1K (1024px)`，在 116px 卡内折行） |
| 4K 可点性 | 未取证（`resolutionSelectionEnabled` 亦由参考站服务端下发） | **disabled**（本地 Jimp 上限 2048px）— **保留**，卡片文案照样是 `4K / 1倍消耗`，原因移到 `title` 悬浮提示 |

`global.css` 的 `.fc-settings-popover`（间距）、`.pk-resolution-option span`（副文色）、ToolSettingsPopover.tsx（卡片主文取 `value` 大写）

### P1-6 关闭按钮尺寸

| 项 | 参考站 | 本站 |
|---|---|---|
| box | 24×24 | 24×24 ✅ |
| font-size（影响 svg 尺寸继承） | `16px` | `14px` |

---

## 四、P2 偏差（数值微偏，影响像素级还原）

| 项 | 参考站 | 本站 | 来源 |
|---|---|---|---|
| 主按钮 font-size | `14px` | `13px` | global.css:2747+ |
| 主按钮 font-weight | `700` | `800` | 同上 |
| 主按钮 strong line-height | `20px` | `22px` | 同上 |
| 主按钮 gap | `6px` | `8px` | 同上 |
| 主按钮 enabled 渐变起点 | `#7B61FF` | `#6C5CE7` | 同上 |
| 高级设置条 border-radius | `7px` ✅ | `8px` ✅ 已修为 7px |
| 高级设置条 padding | `0px 10px` ✅ | `0px 12px` ✅ 已修为 0 10px |
| 高级设置条 color | `rgb(104,113,130)` | `rgb(102,112,133)`（`--text-muted`，差 2 色阶，不单独改） |
| 高级设置 label color | `rgb(69,76,89)` ✅ | `rgb(78,89,105)` ✅ 已修为 #454c59 |
| chip border-radius | `5px` ✅ | `4px` ✅ 已修为 5px |
| chip color | `rgb(72,80,94)` ✅ | `rgb(78,89,105)` ✅ 已修为 #48505e |
| 占位 label font-size | `12px` | `14px` | global.css:2323+ |
| 占位 label color | `rgb(29,33,41)` | `rgb(78,89,105)` | 同上 |
| 占位 span color | `rgb(29,33,41)` | `rgb(23,26,43)` | 同上（`--text-strong`） |
| 比例选项文字 fs | `13px` ✅ | ~~`10.4px`~~ ✅ 已修为 13px（见下） |
| 工具按钮 line-height | `normal`(≈13px) | `18.86px` | global.css:3401+ |
| 结果面板 color 继承 | `rgb(125,133,150)` | `rgb(24,32,51)` | 空态子元素显式设色，实际不可见 |

### ✅ 比例选项字号异常（已修）

**根因**：`ToolSettingsPopover.tsx:96` 用 `<small>{v}</small>` 承载比例文字。
项目 CSS 只在 `.pk-ratio-option`（button）上设了 `font-size: 13px`，未覆盖 `<small>`，
于是吃到浏览器默认样式表的 `font-size: smaller` → 按 0.8 倍算成 **10.4px**。

**关键补充证据**：专项对拍发现**参考站同样用 `<small>` 包裹且实测 13px**，
即参考站 CSS 显式写了 `font-size`；本站漏写。并非标签选择不同。

**修复**：`global.css` 新增

```css
.pk-ratio-option small {
  font-size: 13px;
  line-height: 13px;
}
```

**修复后实测**：8 个比例卡的文字盒与参考站逐个坐标精确吻合
（`1:1` 均 x=257 / `16:9` 均 x=537 / 盒宽 18 与 25 分组一致），fs 均 13px、lh 均 13px。

---

## 四之二、修复记录（2026-10-19，纯 CSS 批次）

| # | 项 | 文件:行 | 改动 | 验证 |
|---|---|---|---|---|
| 1 | 比例文字字号 | `global.css` `.pk-ratio-option small` | 新增 `font-size: 13px; line-height: 13px` | fs 10.4px → 13px，卡内坐标与 ref 逐个吻合 |
| 2 | 高级设置条圆角/内边距 | `global.css` `.pk-settings-summary` | `var(--radius-control)` 8px → `7px`；`padding 0 12px` → `0 10px` | r/p 与 ref 一致，chip x 由 448/515 → 450/517（ref 值） |
| 3 | 高级设置 label 色 | `global.css` `.pk-settings-label` | `var(--text-body)` → `#454c59` | `rgb(78,89,105)` → `rgb(69,76,89)`，与 ref 一致 |
| 4 | chip 圆角/色 | `global.css` `.pk-settings-chip` | `var(--radius-tag)` 4px → `5px`；`--text-body` → `#48505e` | r/c 均与 ref 一致 |
| 5 | 浮层头部标题 | `global.css` `.fc-settings-popover-head h2` | `fw 600` → `700`；`--text-strong` → `#292839` | `rgb(23,26,43)` → `rgb(41,40,57)`，与 ref 一致 |

**未改（按裁定保留）**：第 2/3 项分辨率文案与 4K 禁用；第 5 项全站边框色 token（单独批次）。

**影响面**：改动全部落在 `.pk-*` / `.fc-*` 类上，共用 ToolSettingsPopover 的 5 个页面
（free-creation / product-kit / product-detail / viral-clone / multi-fusion）+ 修图系页面
的高级设置条均同步生效，属预期对齐而非回归。

## 四之三、修复记录（2026-10-21，主区版面数值批次）

重新对拍 `https://ijihua.cn/free-creation`（当日版）后，参考站已改为
`.free-creation-page`（padding 16 + bg #F6F7FB）→ `.free-creation-layout`（432 + 1fr, gap16）
→ `.free-main-card`（padding 12 16 / gap 16）。本批按新实拍值修正主区版面：

| # | 项 | 文件 | 改动 | 修复后实测（local，1440×900 含 40px 推广条） |
| --- | --- | --- | --- | --- |
| 1 | 主区上下内边距 | `global.css` `.pk-workspace` | `padding 24px 24px 24px 16px` → `16px 24px 16px 16px` | 主区/表单/结果栏顶 y=128 → **120**（参考站 80 + 推广条 40） |
| 2 | 自由创作页右内边距 | `global.css` 新增 `.pk-workspace.fc-workspace` | `padding-right: 16px` | 结果栏 x=640 宽 776 → **784**，右缘 1424（其余能力页仍 24 / 776） |
| 3 | 主卡内边距与间距 | `global.css` 新增 `.pk-workspace.fc-workspace .pk-config-card` | `padding 12px 16px; gap 16px`（共用类仍 16/24） | 卡 432×368 → **432×352**（参考站 352） |
| 4 | 上传 section 间距 | JSX 新增 `.fc-upload-section` + CSS `gap: 12px` | 16 → 12 | 标题行 → dropzone 间距与参考站一致 |
| 5 | 上传占位块 | `global.css` `.pk-dropzone.fc-dropzone .fc-upload-prompt` | `width 100% / padding 8 / radius 8 / 12px 20 / #1D2129` | 238×126 居中块 → **366×126**（参考站 366×126, padding8, r8, 12px） |
| 6 | 提交区灰底过渡带 | `global.css` `.fc-actions` | `background: var(--page-bg); padding: 16px 0 0` | **192,750 432×134**（参考站同值），白卡 192,766 432×118 |
| 7 | 提示词编辑器基线间隙 | `global.css` `.fc-prompt-field .pk-desc-editor/.fc-prompt-textarea` | textarea 恢复 `inline-block` | editor 80 → **84**（参考站 84.5），提示词组 112 → 116，卡片高度随之为 352 |

验证：`node e2e/audit/capture.mjs local` + `workspace.mjs`，逐节点与参考站 +40px 推广条偏移对齐。

**本批未动（仍待裁定）**：提交按钮文案/禁用态（P0-1/P0-2）、分辨率文案与 4K 禁用（P1-5）、
按钮字号/字重/渐变起点（P2）、边框色 token。

**新发现的偏差（未修）**：参考站侧栏有可折叠分组标题
（`.workspace-menu-section-toggle` 133×28 / padding 0 4px / 14px / 右侧 chevron，分组
「电商生图」「AI修图」），本站侧栏平铺、无分组标题。改动落在 `SideRail.tsx` + `global.css`，
需单独批次。

### 回归验证结果

`node e2e/audit/probe-regression.mjs`（7 个共用页面，后端存活时执行）：

| 页面 | 表单容器 | 历史卡 | 错误 | summary | 比例字号 | popover |
|---|---|---|---|---|---|---|
| /free-creation | .pk-form-card | 0 | 0 | r7 p0/10 h34 | **13px** | 400×318 r16 |
| /product-kit | .pk-form-card | 0 | 0 | r7 p0/10 h34 | **13px** | 400×259 r16 |
| /product-detail | .pk-form-card | 0 | 0 | r7 p0/10 h34 | n/a（该页无比例组） | 400×124 r16 |
| /viral-clone | .pk-form-card | 0 | 0 | r7 p0/10 h34 | **13px** | 400×259 r16 |
| /multi-image-fusion | .multi-image-fusion-page（独立骨架） | 0 | 0 | n/a | n/a | n/a |
| /local-redraw | .pk-form-card | 0 | 0 | r7 p0/10 h34 | **13px** | 400×259 r16 |
| /background-remove | .pk-form-card | 0 | 0 | r7 p0/10 h34 | **13px** | 400×150 r16 |

**结论：7/7 无回归**，各页比例文字均为 13px，summary 均为 r7/p0 10px/h34。

> ⚠️ 执行注意：本机后端进程在本会话中反复被回收（`.run/backend.log` 末尾出现 `Terminated: 15`），
> 后端一挂所有页面就停在「能力清单加载失败 Failed to fetch」，探针会报大面积 FAIL ——
> 那是**环境问题不是代码回归**。跑探针前先 `lsof -iTCP:4100 -sTCP:LISTEN -P` 确认后端在跑。
> 另：`node dist/main.js | head -N` 会因 SIGPIPE 把后端杀掉，**启动后端不要接管道**。

## 四之四、修复记录（2026-10-21，弹层批次：素材库导入 / 手机上传 / 高级设置-分辨率）

三个弹层的对拍依据：
- **素材库导入 / 手机上传**：参考站该入口未登录态不可达，改用线上样式表
  `https://ijihua.cn/assets/index-lrpwPXNE.css` 的 `.asset-library-picker-*` /
  `.mobile-upload-*` 规则逐条比对（可复现，非推断）。
- **高级设置**：`.image-output-settings-popover` 未登录态只渲染「图片比例」组（分辨率组由
  `billing-config` 下发后才出现），故 CSS 取自线上样式表，文案取自线上 bundle 的**字符串表**：
  JS 里被混淆的字面量（如 `倍消耗`）不在明文里，需按 `_0x1902` 数组顺序（IIFE 旋转 488 位）+ 
  自定义 base64 还原后才能读到，渲染代码如下：

  ```jsx
  <span>{resolution.multiplier}倍消耗</span>   // multiplier 由 billing-config.resolutions[] 下发
  ```

  这条同时推翻上一版「bundle 里『倍』出现 0 次」的记录 —— 那是只 grep 明文的误判。

| # | 项 | 文件 | 改动 | 修复后实测（local，1440×900） |
| --- | --- | --- | --- | --- |
| 1 | **弹窗外壳类名失效（根因）** | `global.css` `.alp-modal` / `.mum-modal` | `.ant-modal-content` → `.ant-modal-container`（antd 6 改名，旧选择器**零命中**） | 容器 `padding 20px 24px → 0`、`radius 10 → 20`、补 `1px #e5e8f0` 描边；素材库 1180×550、手机上传 440×457 |
| 2 | 素材库底部区域位置 | `AssetLibraryModal.tsx` | `.alp-footer` 从 `.alp-main` 内移到 `.alp-body` 下（与 `.alp-layout` 平级） | 参考站 footer 横跨整个弹窗：宽 948 → **1178**，「已选 N」左缘 x=338 → **157** |
| 3 | 弹窗高度模型 | `global.css` `.alp-body` / `.alp-layout` / `.alp-main` / `.ant-modal-container` | 三段 flex（header 固定 / layout 自适应 / footer 固定）+ `max-height: min(760px, 100vh - 40px)` | 与参考站 dialog 一致；内容多时只有 `.alp-content` 滚动 |
| 4 | 工具栏多余分隔线 | `global.css` `.alp-toolbar` | 删除 `border-bottom: 1px #eef0f5` | 参考站 `.asset-library-picker-toolbar` 只有 `#fbfcfe` 底色，无描边 |
| 5 | 眉标字重 | `global.css` `.alp-eyebrow` | 显式 `font-weight: 400` | 原继承 antd `.ant-modal-title` 的 600 |
| 6 | 遮罩层 | 两个 Modal 的 `styles.mask` | 素材库 `#1c1e2d75` + `blur(3px)`；手机上传 `#14122180` | 原为 antd 默认 45% 纯黑，两个站点的遮罩深浅/毛玻璃一眼可分 |
| 7 | 手机上传窄屏宽度 | `global.css` `.ant-modal.mum-modal` | `max-width: calc(100vw - 40px)` | 390 宽下 374 → **350**（`.mum` 350，右侧白带消失） |
| 8 | 高级设置 头部→内容间距 | `global.css` `.fc-settings-popover` | `row-gap: 0` + 组间 `margin-top: 19px` | 35px → **16px**（参考站 head margin-bottom 16，组间仍 19） |
| 9 | 分辨率卡主文 | `ToolSettingsPopover.tsx` | `<strong>` 取 `value` 大写：`1K (1024px)` → `1K` | 与参考站 `.image-output-resolution-option strong` 的短档位一致，卡内不再折行 |
| 10 | 分辨率卡副文色 | `global.css` `.pk-resolution-option span` | `color: #7c8493`（参考站实测 rgb(124,132,147)） | 未选中副文不再与主文同色；选中态仍为品牌紫（`.pk-option-active span` 覆盖） |

**文案已全抄（2026-10-21 二次复核，推翻了上一版「不抄」的结论）**：

上一版写「线上 bundle 里『倍』字出现 0 次，旧稿的 1倍/2倍/3倍消耗无证据」——**这个结论是错的**。
「倍」不在 JS 明文字面量里，而是被 obfuscator 塞进了字符串表，用解码器按索引取：
`_0x586a38(0x4ab4)` → `倍消耗`。按表解码后可见参考站的渲染代码就是

```jsx
<span>{resolution.multiplier}倍消耗</span>   // multiplier 来自 billing-config 的 resolutions[]
```

上一版只 grep 明文就断言「0 次」，把一个「没找对」当成「没有」，是取证方法本身的缺陷。

- 组标题已改为 `分辨率（积分/权益消耗）`（`ToolSettingsPopover` 默认值，参考站也只有一个取值）。
- 卡片副文已改为 `1倍消耗`：**格式抄参考站，取值用本站真实倍率**。`multiplier` 在参考站由
  `billing-config` 按档位下发（1K 缺省为 1），未登录取不到，2K/4K 的真实倍率**仍未取证**；
  本站 `generate.service:125` 扣费只取能力价、与 size 无关，三档恒为 1 倍 —— 写 `2倍消耗` 会变成
  对用户承诺一个不存在的计费规则。要显示 2/3 倍，必须同步改后端计费，属另一个批次。
- 4K 仍 disabled（本地 Jimp 上限 2048px），卡片仍按参考站格式显示 `4K / 1倍消耗`，
  禁用原因移到 `title` 悬浮提示（参考站卡片本身不显示原因）。

**顺带发现（已复核，无需处理）**：`global.css:915` 的 `.login-modal .ant-modal-container`
是生效的，登录弹窗吃的是预期样式；紧随其后的 `.login-modal .ant-modal-content`（919 行）
是同一组声明的旧类名残留，因改名而**完全不命中**。删掉它行为不变，纯清理项。

回归：`node e2e/audit/probe-regress-modals.mjs`（product-kit / product-detail / viral-clone
的高级设置弹层 + 390 宽下的两个弹窗）——四页 popover 均 `gap 19 + head 16`，卡片主文 1K/2K/4K，
`document.scrollWidth == clientWidth`（无横向溢出）；`/multi-image-fusion` 无高级设置入口（本就独立骨架）。

---

## 五、参考站有、本站无（非缺陷，主动决策）

| 项 | 说明 |
|---|---|
| 顶部促销条内容 | 参考站「双节爆单加油 / 限时6重特惠 / 约6毛钱一张 / 倒计时4天」；本站「货觉新人礼 / 限时活动」，按次积分扣费 |
| 导航项 | 参考站有「签到得积分」「购买套餐」；本站顶部为动态积分余额，不提供签到入口 |
| 侧边栏 hover guide popover | 参考站悬停侧栏项弹出 376×236 预览卡（344×172 图 + 说明）；本站无 |
| 4K 档位 | 参考站可点（档位倍率由 `billing-config` 下发，未登录不可见）；本站仅在对应能力有可用模型通道时开放，否则禁用并说明，卡片文案仍是 `4K / 1倍消耗` |
| 空态额外说明 | 2026-10-22 起已删除（原有一行「本地演示：创作结果为参数化占位渲染…」）；现与参考站一致 |
| 侧边栏分组 | 参考站有「AI视频」独立分组含「自由创作」；本站把自由创作排在最后 |

---

## 六、待用户裁定项

| # | 议题 | 状态 |
|---|---|---|
| 1 | 提交按钮文案 | **待裁定** — 1:1 应为「登录免费生图」，但现有 e2e 断言「登录免费生成」，改了要同步改测试 |
| 2 | 禁用态视觉 | **待裁定** — 1:1 应为「换底色不降透明度」（opacity 1），但代码注释记录曾按此改后被回滚，理由是用户看不出禁用 |
| 3 | 分辨率组文案 | ✅ **已修（2026-10-21 二批）** — 组标题抄 `分辨率（积分/权益消耗）`，副文抄 `{multiplier}倍消耗` 格式（本站取值 1 倍，因扣费与 size 无关）；尚未抄的是参考站 2K/4K 的真实倍率，那需要后端按尺寸计费，另议 |
| 4 | 8px 纵向错位 | ✅ **已修**（2026-10-21，主区版面数值批次）— `.pk-workspace` 上下内边距 24 → 16，与参考站 `16px 24px 16px 16px` 一致；共用页面同步上移 8px，已回归 product-kit / product-detail / viral-clone / 修图系 |
| 5 | `<small>` 字号缩放 | ✅ **已修**（纯 CSS，验证通过） |
| 6 | 全站边框色 token | **待裁定单独批次** — 参考站 `#E4E6EF` vs 本站 `--border: #E5E7EF`，属 token 级改动，波及所有页面 |

---

## 七、复现方式

```bash
cd /Users/bright/github/aigc-creation/frontend
# 需后端 4100 在跑、前端 5100 在跑
node e2e/audit/capture.mjs ref      # → out/ref.png + ref-tree.json + ref-inventory.json
node e2e/audit/capture.mjs local    # → out/local.png + ...
node e2e/audit/diff.mjs             # 文案/交互签名差异
node e2e/audit/workspace.mjs        # 主区节点盒模型
node e2e/audit/probe-detail.mjs     # 逐节点精确对拍
node e2e/audit/probe-extra.mjs      # 禁用态 + 浮层
node e2e/audit/probe-shell.mjs      # 外框/actions/chips/分辨率卡
node e2e/audit/probe-settings.mjs   # 高级设置专项 (summary + popover 全量叶子)
node e2e/audit/probe-settings2.mjs  # 高级设置间距链 + 完整卡片
node e2e/audit/probe-regression.mjs # 7 个共用页面回归
```
