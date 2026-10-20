# /free-creation 复刻偏差清单（实拍对拍）

- 日期：2026-10-19
- 方法：Playwright + Chromium 1134，1440×900，同 locale=zh-CN，同时刻抓取 `https://ijihua.cn/free-creation` 与 `http://localhost:5173/free-creation`
- 证据目录：`frontend/e2e/audit/out/`（ref/local 各 4 张截图 + inventory/tree JSON）
- 采集脚本：`capture.mjs`（骨架+computed styles）、`diff.mjs`（文案/交互签名）、`workspace.mjs`（主区节点）、`probe-detail.mjs`、`probe-extra.mjs`、`probe-final.mjs`、`probe-shell.mjs`
- 原则：只比对可复现事实（盒模型数值 / computed style / 文案 / DOM 结构），不做像素比对

---

## 一、结论先行

参考站 `free-creation` 的骨架已高度对齐（432px 输入栏 + 1fr 结果栏 + 16 gap、主卡 radius16、textarea 400×80、dropzone 400×160、结果面板 784×764 均一致）。
但有 **9 项可量化偏差**，其中 **P0 三项**（提交按钮文案/禁用视觉、页面整体上移 8px 导致的纵向错位、上传区占位块缺失参考站的一层 thumb-grid 包裹）、**P4 三项**（字号/字重/色值微偏）。

另有 **诚实披露差异**（参考站 4K 可选「3倍消耗」，本站 4K 因本地算法上限禁用）—— 属主动设计决策，非缺陷。

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
> 其余项经裁定保留（无积分体系 / 4K 本地算法上限 / popover 高度差源自 P0-3 页面错位）。

| 项 | 参考站 | 本站 |
|---|---|---|
| popover box | 208,473 **400×299** | 208,446 **400×318**（差 19px 来自 P0-3 整体错位） |
| popover gap | `normal`（靠内层 `.image-output-settings` gap 19px） | `19px`（在 popover 上） |
| 分辨率组 | 在同一个 `.image-output-settings` 容器内 | 独立 `.pk-settings-group` |
| 头部标题 fw | `700` ✅ | `600` ✅ 已修为 700 |
| 头部标题 color | `rgb(41,40,57)` ✅ | `rgb(23,26,43)` ✅ 已修为 rgb(41,40,57) |
| 分辨率组标题 | `分辨率（积分/权益消耗）` | `分辨率` — **保留**（本站无积分账户，照抄是无意义提示） |
| 分辨率卡副文 | `1倍消耗` / `2倍消耗` / `3倍消耗` | `1024px` / `2048px` / `本地算法暂不支持` — **保留** |
| 分辨率卡 strong | `1K` / `2K` / `4K` | `1K (1024px)` / `2K (2048px)` / `4K` — **保留** |
| 4K 可点性 | 可点（3倍消耗） | **disabled**（本地 Jimp 上限 2048px）— **保留**，诚实披露 |

`global.css:3447-3453`（头部字重/色）、ToolSettingsPopover.tsx:52（`resolutionTitle` 默认值）

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
> 那是**环境问题不是代码回归**。跑探针前先 `lsof -iTCP:3001 -sTCP:LISTEN -P` 确认后端在跑。
> 另：`node dist/main.js | head -N` 会因 SIGPIPE 把后端杀掉，**启动后端不要接管道**。

---

## 五、参考站有、本站无（非缺陷，主动决策）

| 项 | 说明 |
|---|---|
| 顶部促销条内容 | 参考站「双节爆单加油 / 限时6重特惠 / 约6毛钱一张 / 倒计时4天」；本站「货觉新人 / 本地算法不限次数」 |
| 导航项 | 参考站有「签到得积分」「购买套餐」；本站顶部为「本地算力·不限次数」 |
| 侧边栏 hover guide popover | 参考站悬停侧栏项弹出 376×236 预览卡（344×172 图 + 说明）；本站无 |
| 4K 档位 | 参考站可选（3倍消耗）；本站禁用（本地 Jimp 算法上限） |
| 空态额外说明 | 本站多一行「本地演示：创作结果为参数化占位渲染…」 |
| 侧边栏分组 | 参考站有「AI视频」独立分组含「自由创作」；本站把自由创作排在最后 |

---

## 六、待用户裁定项

| # | 议题 | 状态 |
|---|---|---|
| 1 | 提交按钮文案 | **待裁定** — 1:1 应为「登录免费生图」，但现有 e2e 断言「登录免费生成」，改了要同步改测试 |
| 2 | 禁用态视觉 | **待裁定** — 1:1 应为「换底色不降透明度」（opacity 1），但代码注释记录曾按此改后被回滚，理由是用户看不出禁用 |
| 3 | 分辨率组文案 | **已裁定保留现状** — 本站无积分账户，4K 因算法上限禁用 |
| 4 | 8px 纵向错位 | **待裁定** — 修 `.pk-workspace` 的 margin/padding 会影响 product-kit / product-detail / viral-clone / multi-fusion 等共用该布局的页面，需确认是否整批对齐 |
| 5 | `<small>` 字号缩放 | ✅ **已修**（纯 CSS，验证通过） |
| 6 | 全站边框色 token | **待裁定单独批次** — 参考站 `#E4E6EF` vs 本站 `--border: #E5E7EF`，属 token 级改动，波及所有页面 |

---

## 七、复现方式

```bash
cd /Users/bright/github/aigc-creation/frontend
# 需后端 3001 在跑、前端 5173 在跑
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