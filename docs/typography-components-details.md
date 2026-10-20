# 页面字体 · 组件 · 细节 精调（Typography / Components / Details）

> 精调人：小帮｜日期：2026-10-19｜对象：全站跨页共享微规格（字体 / antd 组件主题 / 圆角阴影过渡等细节）
> 方法：参考站未混淆 CSS 产物（`/tmp/ref-app.css`，719 353 字节，6 390 条规则，2026-10-17 提取）
>   + 参考站实时实拍（登录弹窗态 / 404 页 / 顶导等）+ 本地 CSS/antd 主题审计 + 登录态浏览器实测
> 本地实现现状：`frontend/index.html`（字体导入）、`frontend/src/main.tsx`（antd 主题）、`frontend/src/styles/global.css`（8 303 行）
> 本文件记录**已实施项（附验证）+ 待裁定项（附证据）**。已实施 2 项均为参考站字面值归位，无产品决策。

---

## 0. 结论摘要

| # | 项 | 状态 | 一句话结论 |
|---|---|---|---|
| 1 | antd 主题 token 归位参考站色板 | ✅ **已实施** | `colorPrimary` 从默认蓝 `#2563EB` 改为品牌紫 `#5546d8`，另 6 个 token 同步归位；修复登录主按钮 / Spin / focus ring 等全站 antd 蓝泄漏 |
| 2 | 字体导入补齐参考站字重 | ✅ **已实施** | 参考站加载 Noto Sans SC **600/800** + Inter 800，本地缺失 → 全站 600 字重一直 faux-bold；已补齐并验证字面注册 |
| 3 | 字体栈顺序 | ⏸ 待裁定 | 参考站**实际生效**栈是 PingFang SC 优先（系统字体），本地是 Noto Sans SC 优先（webfont）——Mac 上两边渲染字体不同 |
| 4 | `.field` 输入框体系 | ⏸ 待裁定 | 参考站现行输入框 radius 12 / pad 10 14 / 紫 focus ring；本地无对应体系（登录页自定义 + antd 默认混用） |
| 5 | antd 基准字号 14 → 16 | ⏸ 不做 | 会连锁改变全部 antd 控件高度，风险大于收益；参考站 16px 是 header 等局部的值 |

---

## 1. 字体（Typography）

### 1.1 字体加载（✅ 已实施）

**参考站实际导入**（`/tmp/ref-app.css` 首行 @import）：
```
@import "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800
         &family=Noto+Sans+SC:wght@400;500;600;700;800&display=swap"
```

**本地原状**（`index.html`）：`Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700`——**缺 Noto Sans SC 600/800 与 Inter 800**。

**影响**：参考站 600 字重出现 118 次、800 出现 31 次（如 `.wb-tool-title` 600、菜单条目 600、hero 数字 800）；本地 body 字体是 Noto Sans SC，这些 600 字重全部走**浏览器合成伪粗体**（faux bold，字缘发糊），与参考站真实字重面渲染不同。本地 `.pk-primary-btn` 用 800，同样合成。

**修法**：导入串补齐为与参考站完全一致（`...600;700;800` / `...500;600;700;800`）。
**验证**：`document.fonts` 中 Noto Sans SC 600/800、Inter 800 面已注册（Google Fonts `display=swap` 按需加载，注册即可用）。

### 1.2 字体栈顺序（⏸ 待裁定）

| 侧 | 生效栈 | Mac 实际渲染 |
|---|---|---|
| 参考站规则层 | `PingFang SC, Noto Sans SC, sans-serif`（6+3+3+2 条规则） | **PingFang SC**（系统字体） |
| 参考站 :root token | `--font: "Noto Sans SC","Inter","PingFang SC",…` | 仅 1 处引用，基本不生效 |
| 本地 body | `'Noto Sans SC','Inter','PingFang SC',…` | **Noto Sans SC**（webfont） |

本地 `global.css` body 注释「字体栈与参考站一致」依据的是参考站的 **:root token**，而 token 并非实际生效栈——按「实码 > 注释/token」纪律，两边 Mac 渲染字体其实不同（Noto vs PingFang，字面宽与字重视觉均有差）。

**选项 A（维持）**：Noto 优先——跨平台一致（Windows 无 PingFang），本地已付 webfont 流量。
**选项 B（对齐参考站）**：PingFang 优先——Mac 渲染与参考站一致，webfont 退化为 Windows 回退（与参考站行为相同）。
建议 B（1:1 复刻纪律优先），但影响全站文字渲染气质，需用户拍板。

### 1.3 参考站字阶（证据存档）

| 字号 | 使用次数 | | 字重 | 使用次数 |
|---|---|---|---|---|
| 12px | 339 | | 700 | 132 |
| 14px | 253 | | 600 | 118 |
| 13px | 217 | | 400 | 75 |
| 11px | 123 | | 500 | 70 |
| 10px | 64 | | 800 | 31 |
| 16px | 43 | | | |
| 18/15/20/24/22/17/28/32/21/38px | 37/34/19/18/18/12/9/6/5/2 | | | |

主导字号 12/13/14，主导字重 600/700——**与本地既有 `.wb-*`/`.pk-*` 自定义规格一致**（本地微规格复刻无系统性问题）。antd `fontSize: 14` 维持（见 §0-5）。

---

## 2. 组件（Components）

### 2.1 antd 主题 token（✅ 已实施）

**问题**：`main.tsx` 的 antd token 是 Tailwind slate/blue 通用色板——`colorPrimary: '#2563EB'`（默认蓝）与全站品牌紫系冲突。2026-10-18「归位品牌紫」只修了 CSS 变量，**没修 antd token**，导致 antd 默认面持续漏蓝：登录页主按钮（最醒目 CTA）、Spin（12 处使用）、Input focus ring、Table/Tag/Modal/Drawer 的默认配色。

**证据**：修复前登录主按钮实测 `bg = rgb(37, 99, 235)`（#2563EB，`finetune-ref/login-btn-before-blue.png`）；参考站同位置 CTA 为紫（404 页「返回首页」紫色渐变按钮、`package-purchase-immediate-button` #5546d8）。

**修法**（token 前后对照，参考站 :root token + 组件字面值）：

| token | 原值（Tailwind 系） | 新值（参考站系） | 依据 |
|---|---|---|---|
| colorPrimary | #2563EB | **#5546d8** | 参考站 CTA/active 字面值 |
| colorPrimaryHover | （自动派生） | **#4838c6** | 参考站 hover 加深模式（immediate-button:hover） |
| colorError | #DC2626 | #ef4444 | 参考站 --danger |
| colorSuccess | #16A34A | #18a875 | 参考站 --success |
| colorBgLayout | #F8FAFC | #f6f7fb | 参考站 --bg |
| colorBorder | #E2E8F0 | #e6e8ef | 参考站 --line |
| colorText | #0F172A | #182033 | 参考站 --text |
| colorTextSecondary | #475569 | #667085 | 参考站导航/次级文字主力色 |
| borderRadius / fontSize | 8 / 14 | 维持 | 控件基准，改字号连锁改变控件高度 |

**验证**（登录态浏览器实测）：
- 登录主按钮 `bg = rgb(85, 70, 216)` = #5546d8 ✓（`finetune-ref/login-btn-after-purple.png`）
- 6 页（workbench/works/library/stats/invitations/packages）计算样式扫描 `#2563eb`/`#1677ff`：**零残留** ✓
- 零 JS 错误、零横向溢出；works（Table+Tag 重面容）/ workbench 视觉无回归 ✓

**影响面清单**（全仓 antd 使用）：Spin×12、App(message)、Modal×6、Button×4、Empty×2、Card×2、Typography、Tag、Table、Row/Col、Result、Popconfirm、Layout、Input、Form、Dropdown、Drawer、Avatar。

### 2.2 参考站组件规格库（证据存档，供后续精调）

| 组件 | 参考站规格（CSS 产物字面值） |
|---|---|
| 主 CTA 按钮 | bg #5546d8（或渐变 `linear-gradient(90deg,#8064f6,#5546d8)`），radius 7-8，13-14px/700 白字，hover 加深 #4838c6 |
| 次级/描边按钮 | 白底，border 1px #dfe3ed/#e4e7ec，radius 7-11，13px #4f5970 |
| 药丸 tab | radius 999，inactive 14px #667085，active 白底 + `0 1px 3px #171a2b0d` |
| `.field` 输入框（现行） | border 1px var(--line) #e6e8ef，bg #fff，**radius 12**，padding **10 14**，14px；focus → border var(--primary) #625df5 + `box-shadow: 0 0 0 3px #625df51a` |
| `.field` 紧凑态（工具 pane 内） | h 32，radius 4，padding 5 12，12px（input-pane）/ 14px（pk/detail/viral pane） |
| 登录弹窗 tab | `.auth-login-tab` 16px #333，active 600 + 下划线 `var(--primary)` 32×4 radius 4 |
| 空态插图 | 160×160 SVG（`yqempty-*.svg`） |

本地组件现状：`.pk-*`/`.wb-*`/`.app-*`/`.tool-*` 已按页复刻；**antd 默认皮肤残留面** = Input/Form（登录页部分自定义）、Table（works 筛选条）、Tag、Modal、Result、Card——下一批组件精调可对照上表逐面收拢。

---

## 3. 细节（Details）

### 3.1 圆角阶梯 —— ✅ 已对齐

| 参考站用量 | 值 | | 本地 token | 值 |
|---|---|---|---|---|
| 228 次 | 8px | | --radius-control | 8px ✓ |
| 100 次 | 16px | | --radius-panel | 16px ✓ |
| 57 次 | 12px | | --radius-card | 12px ✓ |
| 71 次 | 999px | | --radius-pill | 999px ✓ |
| 62/51/41/40/36/32 次 | 10/4/6/14/7/9px | | （按面字面值使用） | 同构 |

参考站是 4-16 全阶梯 + 50%/999；本地四档 token 覆盖高频值，长尾按面字面值——结构与参考站同构，无需调整。

### 3.2 阴影与 focus ring —— ✅ 随 token 归位

参考站高频阴影模式（存档）：`-8px 0 24px #1f232924`（抽屉）、`0 4px 12px #1f232933`（悬浮钮）、`0 14px 40px #22294314`（弹层）、`0 0 0 3px #625df51a` / `0 0 0 2px #6f5cff1a`（**紫色 focus ring**）。antd 的 focus ring/激活色由 colorPrimary 派生，token 归位后已变紫系。

### 3.3 过渡时长 —— ✅ 基本一致

参考站：`all .2s`×10、`transform .18s`×8、`transform .2s`×7、`transform .16s`×7、`opacity,transform .18s`×6。本地：`.18s`/`.15s`/`.2s` 混用（卡片 hover .18s、部分 .15s）。差异在 .15s vs .18s 的 30ms，属不可感知量级，不调。

### 3.4 边框色 —— ✅ 已归位

antd `colorBorder` #E2E8F0 → #e6e8ef（参考站 --line）；本地自定义面边框本就用的 #e5e7ef/#e6e8ef 系，全站边框色统一。

---

## 4. 待裁定项清单

| # | 事项 | 建议 | 状态 |
|---|---|---|---|
| 1 | 字体栈顺序（Noto 优先 / PingFang 优先） | ~~B：PingFang 优先~~ | ✅ **2026-10-19 已实施，且原结论被推翻** —— 见 §5/附录 D：参考站实渲染就是 Noto Sans SC，**不需要改顺序**，要修的是 antd `<App>` wrapper 覆盖 |
| 2 | `.field` 输入框体系落地（radius 12 / pad 10 14 / 紫 focus ring） | 登录页 + antd Input 面先行，工具 pane 紧凑态随后 | 待批准（涉及 Input/Form 重构面） |
| 3 | antd 默认皮肤残留面收拢（Table/Tag/Modal/Result/Card） | 对照 §2.2 规格库逐面精调 | 待批准 |
| 4 | 基准字号 14 → 16 | 不做（控件高度连锁） | 已否决 |

---

## 5. 字体栈：原结论被 CDP 推翻（2026-10-19）

### 5.1 原结论错在哪

§4-1 与附录 C-2 都写了「参考站实际规则是 `PingFang SC, Noto Sans SC, sans-serif`（PingFang 优先），本地 body 的 Noto 优先声明与参考站不一致，建议改成 PingFang 优先」。

**这个结论只看了 CSS 文本，没看实际渲染。** 用 CDP `CSS.getPlatformFontsForNode` 取浏览器真正用来绘字的 platform font：

| 节点 | 参考站 ijihua.cn | 本地（修前） |
|---|---|---|
| hero h1 的 CSS `font-family` | `"Noto Sans SC", Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif` | **同一串** |
| hero h1 的**实际渲染字体** | `Noto Sans SC Thin`（webfont，`isCustomFont: true`） | `PingFang SC`（系统字体）+ `.SF NS` |

参考站与本地的**声明本来就一致**（都是 Noto 优先）；差的是本地**根本没生效**。

### 5.2 为什么不生效（根因）

沿祖先链逐级取计算样式，切换点一目了然：

```
html                 sans-serif
body                 "Noto Sans SC", Inter, "PingFang SC", …   ← 声明正确
div.css-dev-only-do-not-override-*   -apple-system, "system-ui", …  ← 切换点
  └─ 全站所有 UI
```

antd v6 的 `<App>` 会渲染一个带 `css-dev-only-do-not-override-*` class 的 wrapper，**wrapper 自身带 antd 的系统字体栈**，它不从 `body` 继承。于是 `global.css:381` 那行 Noto 优先声明除了 `body` 自己之外无处生效——**全站实际渲染的一直是 PingFang**。

### 5.3 修法与验证

修法：把字体栈写进 antd token（受支持的入口，不去 hack 带 hash 的 wrapper 类名）：

```ts
// main.tsx · ANTD_THEME_TOKEN
fontFamily: "'Noto Sans SC', Inter, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
```

修后 CDP 复测（同一节点）：

| 节点 | 参考站 | 本地（修后） |
|---|---|---|
| `.home-v2-hero h1` | `Noto Sans SC Thin`(web) / 40px / 500 | **`Noto Sans SC Thin`(web) / 40px / 500** ✅ |
| `.landing-brand-text` | — | `Noto Sans SC Thin`(web) / 16px / 700 ✅ |
| antd wrapper | — | CSS 声明已变为 `"Noto Sans SC", Inter, …` ✅ |

### 5.4 连带修掉的两个真实缺陷

字体一换成更宽的 Noto，暴露出两个此前被 PingFang 掩盖的布局缺陷：

| 缺陷 | 根因 | 修法 |
|---|---|---|
| 工作台卡片描述冲出卡片（1280 下 `.wb-card-body` 实测 224px vs 卡片 178px，右缘 1302 > 视口 1280） | ①「工作台 1:1 覆盖层」静态重述 `.wb-card-desc`，把基座里的 `white-space/overflow/text-overflow: ellipsis` 三件套丢了；② **Chrome UA 给 `<button>` 设了 `align-items: center`**，column flex 子项因此不 stretch，按 min-content（= nowrap 整句描述宽）定宽 | 删除覆盖层里与基座逐值同值的重述；`.wb-card { align-items: stretch; min-width: 0 }` + `.wb-card-body { min-width: 0 }` |
| 素材库 ≤700 两列卡 meta 折行（卡高 248 → 231） | 两列 165px 卡下描述段与 kind 段各自换行 | 左段 ellipsis、右段 `white-space: nowrap` |

> 这两个都不是字体问题本身，而是**被更宽的字重/字族放大的既有缺陷**——换回 PingFang 也照样溢出，只是不显眼。

---

## 附录 A · 改动文件

| 文件 | 改动 |
|---|---|
| `frontend/index.html` | 字体导入补齐 Noto Sans SC 600/800 + Inter 800（与参考站 @import 一致） |
| `frontend/src/main.tsx` | antd token 8 项归位参考站色板（附证据注释）；token 提取为 `ANTD_THEME_TOKEN` 常量；**新增 `fontFamily`**（见 §5.3） |
| `frontend/src/styles/global.css` | 删工作台覆盖层冗余重述；`.wb-card` / `.wb-card-body` 补 flex 最小尺寸与 stretch；素材库 ≤700 meta 折行处理 |

## 附录 B · 验证记录（2026-10-19，Playwright 登录态）

- 登录主按钮：#2563EB → **#5546d8**（计算样式实测）
- `document.fonts`：Noto Sans SC 600/800、Inter 800 面注册成功
- 蓝色扫描（`#2563eb`/`#1677ff`）：workbench / works / library / stats / invitations / packages **6 页零残留**
- JS 错误：零；横向溢出：零；works（Table+Tag）/ workbench 视觉对比无回归
- 截图：`finetune-ref/login-btn-before-blue.png` vs `login-btn-after-purple.png`、`works-after.png`、`workbench-after.png`

## 附录 C · 方法论补记

1. **antd token 与 CSS 变量是两套系统**：10-18「归位品牌紫」只改了 CSS 变量，antd `ConfigProvider` token 仍是默认蓝——品牌色审计必须两个面都扫（计算样式扫描蓝色残留是唯一可靠手段，grep CSS 查不到 antd 运行时注入）。
2. ~~**参考站的「生效规格」不在 :root token 里**：token（Noto first）只被引用 1 次，实际规则是 PingFang first~~ → **2026-10-19 推翻**：CDP 证明参考站实渲染就是 Noto Sans SC webfont，`:root` token 恰好是对的；错的不是 token，是本地被 antd wrapper 覆盖（见 §5）。**教训升级：判断「哪个声明生效」不能只读 CSS 文本，要读浏览器真正用于绘字的字体（`CSS.getPlatformFontsForNode`）。**
3. **Google Fonts `display=swap` 按需加载**：`document.fonts` 显示 "unloaded" 是正常态，字面注册即可用；验证字重是否真实加载要看 face 是否存在而非 status。
4. **截图误读警告**：本轮曾把 works 页顶导截图误读为「多了 AI视频项」，DOM 复测证明是 5 项未变——视觉断言必须经 DOM 复测确认。
5. **「零溢出」也可能是假通过（2026-10-19 亲历）**：改完字体跑溢出扫描，`workbench overflow:[]` 全绿，但同刻截图显示页面还停在 Suspense 的「加载页面…」骨架——`.wb-card` 一个都没渲染，自然没有溢出元素。**扫描类断言必须先等真实内容（`waitForSelector('.wb-card')` + 断言 `loading===false` + 元素数 > 0），`networkidle` 不算数**。这是本项目第四次栽在「视觉断言必须复测」。
