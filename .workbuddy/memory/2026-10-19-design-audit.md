# 2026-10-19（下午）整体设计升级 · 第一轮：审计与裁定

## 环境修复（先决条件，非功能改动）

发现本项目后端**根本没在跑**：3001 端口被另一项目 aigc 网关占（`GET /api/v1/capabilities` → 404，
登录会静默失败），3002 无响应。已拉起：

- 后端 `PORT=3002 node dist/main.js`（background task aJ2CQo），13 条路由全部 mapped，接口 200
- 前端 `VITE_API_PROXY=http://localhost:3002 npx vite --port 5173 --strictPort`（background task EkI9Fl）

**踩坑复现（CLAUDE.md 已记录，此处补实测细节）**：
1. 前端试过 5174 → **CORS 拦截**。后端默认只放行 5173/4173，且前端用 `VITE_API_BASE` 直连
   绝对地址时 preflight 直接被拒（不是代理问题）。必须用 5173。
2. vite v8 绑 **IPv6 ::1**，`127.0.0.1:5174` 不通，curl/playwright 必须用 `localhost`。
3. 本机 `HTTP_PROXY=127.0.0.1:49705`，curl 必须 `--noproxy '*'`。
4. token 的 localStorage key 是 **`ecom_vision_token`**（`lib/auth.ts:1`），不是 `ecom_token`。
   我第一版探测脚本用错 key 导致误判"登录失败"，实际登录是成功的。
5. 巡检必须**同一 context 内顺序 goto**（`browser.newPage()` 每次新 context，localStorage 不共享）。

## 审计方法

- 静态：2 个 Explore/general 子代理并行审计（设计 token 覆盖率 / 页面结构一致性）
- 动态：自写 playwright 巡检（`/tmp/design-audit.cjs`），24 页全量采集元素级 computed style
  + 截图到 `/tmp/design-audit/`，报告 `/tmp/design-audit/report.json`
- 纪律：**不盲信子代理报告**，P0 项逐条 grep/read 复核

## 视觉实测结果（24/24 页）

- 全部渲染成功，**零横向溢出**（24 页 overflowX 均为 0）
- 页面底色**完全统一** `rgb(246,247,251)` = `--page-bg`
- 圆角实际渲染收敛良好：8px(23页) / 999px(22页) / 16px(19页) / 4px(14页) / 12px(10页)
- 元素级彩色值 TOP：`#0f172a`(6895) `#667085`(2218) `#5b4bd7`(1596) `#5546d8`(897)
  `#171a2b`(882) `#4e5969`(568) `#86909c`(551)

## 子代理误报（已复核推翻，重要）

| 误报 | 复核结论 |
| --- | --- |
| 「`--fusion-ratio-width/height` 被引用但从未定义，P0」 | **误报**。`MultiFusionPage.tsx:245-246` 用内联 style `{'--fusion-ratio-width': ratioW}` 注入，CSS 注释 L4885 也写明了。设计正确 |
| 「`:root` 只有 77 个 token」 | **误报**。实测 283 个（单行多声明写法导致朴素正则漏采） |
| 「6 档圆角阶梯 token 零引用 = P0」 | **事实成立但定性错误**。193 条裸字面里 174 条本就在阶梯内（8/999/16/12/4 各占大头），是"没走 token 但值统一"，非视觉缺陷。降级为 P1 技术债 |

## 真实缺陷（浏览器实测坐实）

### P0-1 · sitemap 页 46 个链接是 antd 默认蓝，与全站紫系冲突

- 现象：`/sitemap.html` 实测 46 个元素 `color/borderColor = rgb(22,119,255)` = `#1677ff`
- 根因：`global.css:6394` `.sitemap-item` 设了 `text-decoration:none` **但漏 `color`**，
  `SitemapPage.tsx:125` 用 react-router `<Link>` → 继承 antd 6 默认主题链接色
- CSS 全文 grep `1677ff` **零命中**，证明这不是硬编码，是 antd 运行时注入
- 同类：`login` 页「填充演示账号」`ant-btn-link` 3 个元素同蓝
- **这是 10-18「清除蓝紫混用」的漏网之鱼**：那轮只扫 `global.css` 里的 hex 字面值，
  没扫 antd 运行时主题色，所以只修了 9 处硬编码，漏了所有"未设 color 的 Link"

### P1-1 · works 页筛选器展开态边框是青蓝 `#399de8`

`global.css:7682` `.my-works-filter-trigger.is-open { border-color: #399de8 }`，
hue=205.7 真蓝。同属 10-18 漏网（这处是硬编码，但不在那轮 9 处清单内）。

### P1-2 · 死 token 42 个 / 283 个（14.8%）

`--radius-tag` 到 `--radius-pill` 全 6 阶梯 var() 引用均为 **0**（实测 `var(--radius-tag)` 计数 = 0），
`--color-primary` 全族亦零引用（`var(--color-primary)` 仅 1 次且非独立使用）。
根因：2026-10-17 收拢时定义了 token 阶梯，但 216 条 `border-radius` 里 193 条写的是裸字面值，
token 被绕过 → "定义了阶梯但全站不用"。

### P1-3 · ToolShell 覆盖率 9/14，5 个大页自建 JSX

`ProductKitPage`(780行) `ProductDetailPage`(739) `ViralClonePage`(823) `FreeCreationPage`(671)
`MultiFusionPage`(651) 各自实现上传区/设置浮层/提交/结果区，且**都没有历史记录区**
（ToolShell 有，真实拉 `generateApi.list()`）—— 功能性缺失不只是代码重复。
`MultiFusionPage.tsx:8` 只 import 了 `ToolShell` 的**类型**没 import 组件本体 → 抽象泄漏坐实。

### P1-4 · 「新增能力零改前端」未达成

后端 `registry.ts` 已下发 `CapabilityGroup.name`，但前端仍硬编码：
`WorkbenchPage.tsx:97-102` `groupOf` 重写一遍分组中文名，且 `return 'AI视频'` 兜底；
`AppLayout.tsx:37` `groups.slice(0, 2)` 写死 2 组；`LandingPage.tsx:200` / `WorksPage.tsx:181`
同样写死"只展示前两组"。新增第 4 组会全部落到「AI视频」。

### P2 · 其他

- `ToolPage.tsx:10` import 了 `Select` 但全文件无 `<Select>`，是死 import；文件头注释 `:37`
  写「enum→Select」与实现（`Radio.Group`）不符
- `ToolPage.tsx:316` `text` 类型 maxLength 硬编码 500，而 hot_remake 要 1000 / free_create 要 4000
- 空态 SVG 160×160 逐字节重复 5 份（ToolShell + 4 个自建页）
- 拖拽/粘贴全局监听重复 5 份、素材库弹窗 5 份、高级设置浮层 5 份
- `PLATFORMS` 5 份 / `LANGUAGES` 5 份 / `RATIOS` 6 份 / `RESOLUTION_OPTIONS` 6 份（后端 registry 是源）

## 待用户裁定（本轮未改任何产品代码）

按"裁定在前 → 出偏差清单 → 获批 → 改码"纪律，本轮只出清单。

---

## 裁定结果与执行（用户批准 P0 + 全部 4 项 P1）

### 批次 1（P0）antd 运行时主题色泄漏 — 已完成

用户批准后执行，3 处修复 + 浏览器验证 7/7 PASS：

| 位置 | 修法 |
| --- | --- |
| `global.css` `.sitemap-item` | 补 `color: var(--text-strong)`（原先只设 text-decoration） |
| `LoginPage.tsx:109` | 加 `className="login-demo-fill"` + CSS 覆盖 hover/active/focus |
| `global.css` `.landing-brand` | 补 `color: inherit` |

实测：修复前 50 处 `rgb(22,119,255)`（sitemap 46 / login 3 / landing 1），修复后 7 路由 **0 残留**。
顺带把 `.login-switch a` 的硬编码 `#5546d8` 改为 `var(--brand)`。

### 批次 2 能力清单去硬编码 — 已完成

- `WorkbenchPage.tsx` `groupOf` 改读 `groups.find(x => x.id === g)?.name ?? ''`，
  `App.tsx:158` 补传 `groups={data.groups}`，props 类型加 `CapabilityGroup`
- **复核发现 3 处"硬编码"其实是有意裁剪，未改行为，只加注释**：
  `AppLayout.tsx:37` `slice(0,2)`（参考站顶导就 2 项）、`LandingPage.tsx:200` /
  `WorksPage.tsx:181` 过滤前两组（与顶导同口径；`ai_video` 是倒序第三组，slice 会误纳）
- 验证：工作台分组名正确、0 空白单元、顶导仍两项、零 JS 错误

### 批次 3 圆角 token 收拢 — 已完成

- 165 条裸字面 → `var(--radius-*)`；6 档 token 从 `var()` 引用 **0 → 165**（tag 16 / control 64 /
  card 22 / panel 24 / hero 3 / pill 36）
- 只替换与全局阶梯**值完全一致**的裸字面；不动简写（`4px 4px 0 0`）与 `--mif-*` 私有阶梯
- 结构验证：把两侧 `border-radius:[^;]+;` 全部归一后 diff **完全一致** → 证明只改了圆角值
- 浏览器回归 10/10 页圆角集合无新增、零溢出

### 批次 4 死 token 清理 — 已完成

- 删 30 个（27 行独立定义 + 3 个单行多声明里的 `--mif-body-lh` / `--mif-label-lh` / `--mif-small-lh`）
- token 定义 **284 → 252**；行尾规格注释保留为 `/* [已清理 2026-10-19] xxx: 值 未被引用 */`
- 7 个"未定义被引用"变量全部核实安全：6 个有 fallback（`--range-progress:50%` `--wb-card:#ffffff`
  `--line-angle:0deg` `--pk-aspect:1/1` `--workspace-topbar-height:64px`），
  `--fusion-ratio-*` 是 JS 内联注入

### 刻意未做（需单独裁定）

`--mif-radius-*` 私有阶梯（18/15/14/13/11/9/7/6px，28 条裸字面）是多图融合页按参考站实拍建立的
**专属规格**。归位到全局 6 档会破坏该页 1:1 —— 与 10-17「统一优先于逐页 1:1」是**相反方向的取舍**，
不能默认执行，需用户裁定。

### 未完成（用户批准但本轮未做，改动量大）

- **ToolShell 收拢到 14/14**：5 个大页（ProductKit 780行 / ProductDetail 739 / ViralClone 823 /
  FreeCreation 671 / MultiFusion 651）自建 JSX，且**都缺历史记录区**（ToolShell 有，真实拉
  `generateApi.list()`）—— 这是功能性缺失不只是代码重复。预估 5 页 × 200 行，需多批次。
- **重复代码抽取**：空态 SVG ×5、拖拽/粘贴监听 ×5、素材库弹窗 ×5、高级设置浮层 ×5、
  常量表（PLATFORMS×5 / LANGUAGES×5 / RATIOS×6 / RESOLUTION_OPTIONS×6，后端 registry 是源）

### 方法论补记（重要）

1. **清蓝必须渲染层扫 computed style**：静态 grep CSS 查不到 antd 运行时注入的主题色。
   10-18 那轮只 grep hex 字面值，因此漏掉所有"未设 color 的 `<Link>`"。
2. **子代理 P0 报告必须逐条复核**：本轮 3 个 P0 里 2 个是误报（`--fusion-ratio-*` 未定义、
   `:root` 仅 77 token）。误报若直接执行会破坏 JS 注入的设计。
3. **区分"遗漏"与"复刻决策"**：`#399de8` 是参考站实拍值（README 有据），不能当 bug 改；
   而 sitemap 漏 `color` 是真 bug。两者都叫"蓝"，性质相反。
4. 登录按钮验证脚本有时序坑：登录成功后按钮已卸载，断言要在**登录前**取色。

---

## 第二批：重复代码抽取（用户指令「改」，已完成）

前一批遗留的两项里，「重复代码抽取」先做（零风险），「ToolShell 收拢」涉及 5 页外壳重构，
需单独一批。

### 4 项抽取全部完成

| 项 | 原状 | 归并到 |
| --- | --- | --- |
| 空态插画 SVG | 5 份逐字节相同 | `ToolShell.ToolEmptyIllustration`（本就已导出，4 份是重复实现） |
| 流程步骤图标 | CircleCheck/Activity/ImagePlus **各 3 份手写 SVG** | lucide-react 同名组件（`size={14}`） |
| 粘贴上传监听 | 5 份相同 useEffect | 新 hook `hooks/usePasteUpload.ts` |
| 参数选项集 | PLATFORMS×4 / LANGUAGES×2 / RATIOS×5 / RESOLUTION×6 | 新模块 `lib/optionSets.ts` |

### 关键判断

1. **图标直接换 lucide 而非抽公共组件**：那 9 个手写 SVG 的 path 与 lucide 1.57.0 的
   `circle-check`/`activity`/`image-plus` **完全相同**，属重复造轮子，按「优先成熟开源库」纪律换库。
2. **选项集从后端 `params` 读回**：实测 `main_image` 下发 `platform` 9 / `language` 10 /
   `ratio` 8 / `size` 2。前端重复 17 张表本身是漂移源 —— `size` 后端只声明 1K/2K，
   前端多写 4K。**4K 禁用态保留为本地诚实差异**（Jimp 上限 2048，界面禁用而非隐藏）。
3. **`usePasteUpload` 顺带修隐性缺陷**：原 5 处把剪贴板文件直接透传给上传接口，混入文本/路径时
   会送非图片 MIME。新 hook 过滤 `type.startsWith('image/')` + `preventDefault()`。

### 坑（重要，下次直接用）

- **param key 是 `size` 不是 `resolution`** —— registry 里画质档位的 key 叫 `size`。
- **类型不兼容**：`RATIO_OPTIONS` 原是 `string[]`，`ratioOptions()` 返回 `ParamOption[]` →
  38 个 TS 错。修法：`String(o.value)` 包裹 + `.map((o) => ...)` 形参改名。
  `resolutionOptions()` 返回类型显式带 `sub` / `disabled` 字段。
- **BSD grep 的 `\b` 不可靠**（第 10-18 轮已记，本轮再犯）：`grep -n "RATIO_OPTIONS"` 返 0 结果，
  实际有引用。**改用 python 正则或以 tsc 报错行号为唯一事实来源**。
- 多行注释文案各页不同，按整块字符串 replace 只能命中 1/7 文件；结构化删除
  （定位 `const X = [` → 括号配平 → 连注释与空行一起删）才全命中。

### 闸口

`tsc --noEmit` exit 0（中途 38 错逐类修正清零）；`vite build` 2.62s 通过；
浏览器实测比例 8 / 画质 3 含 4K disabled / 平台 9 / 语言 10 **与重构前一致**，
12 工具页零溢出零 JS 错误，10/10 页圆角回归通过。

5 大页行数 3642 → 3384（**-258 行**）：ProductKit 780→696、ProductDetail 739→660、
ViralClone 823→740、FreeCreation 671→641、MultiFusion 651→647。

### 仍未做（下一批）

**ToolShell 收拢到 14/14**：5 个大页自建 JSX，且**都缺历史记录区**（ToolShell 有，真实拉
`generateApi.list()`）—— 功能性缺失不只是代码重复。需 5 页 × 200 行，多批次推进。
另有素材库弹窗 ×5、高级设置浮层 ×5 待抽取（本轮未动，因涉及浮层交互态差异需逐页比对）。

---

## 第三批：素材库弹窗 + 高级设置浮层抽取（用户指令「继续」，已完成）

ToolShell 收拢涉及 5 页外壳重构，风险最高，单独留一批。本批先做浮层/弹窗。

### 2 项抽取完成

| 项 | 原状 | 归并到 |
| --- | --- | --- |
| 素材库弹窗 | 5 份（ToolShell + 4 页） | `components/AssetLibraryModal.tsx`（含 `useAssetLibrary` hook，116 行） |
| 高级设置浮层 | 5 份（ToolShell + 4 页） | `components/ToolSettingsPopover.tsx`（127 行） |

### 关键设计决策

1. **`onPick` 返回 `false` = 拒绝，弹窗保持打开** —— 从 ViralClone 原逻辑提炼：它点参考图时
   直接 `setLibraryOpen(false)`，而商品图超限时只 `return` 不关闭。原先 5 份行为不一致，
   统一为「拒绝则不关闭」。
2. **ToolShell 素材库用 `readOnly` prop** —— 参考站该入口是禁用态，保留只读展示。
3. **free-creation 的 `fc-settings-popover` 头部不并入通用实现** —— 那是 1:1 实拍值（含
   `role="dialog"`），故做成 `header` / `popoverClassName` / `popoverRole` 三个 prop 传入。
4. **product-detail 只传画质** —— 参考站该页无比例档，`showRatio={false}`。这要求组件的
   `ratio` / `onRatioChange` 改成**可选**，否则该页无 `ratio` state 会编译失败。

### 坑（重要）

- **类名不是直觉的那个**：容器是 `pk-settings-shell`、按钮是 `pk-settings-summary` +
  `.pk-settings-summary-open`，**不是** `pk-settings` / `pk-settings-trigger`。
  写组件时若按直觉命名，CSS 全部失配且不报错（只是样式丢）。
- **定位 JSX 块要用标签配平**：`re.search(r'<div className="pk-settings">')` 匹配不到，
  必须先找到起始标签再从其后做 `<div` / `</div>` 计数配平，才能正确切出整块。
- **`tsc` 不报未使用 import**（前端 `noUnusedLocals: false`）。抽完组件后
  `ChevronDown` / `ratioOptions` / `resolutionOptions` / `useMemo` / `Minus` 全部变成死 import，
  需自己按「正文引用计数」核查。
- **`type ReactNode` 前缀形式**：检测未使用 import 时若只统计标识符会误删 `type ReactNode`
  （它用在类型注解位置）。删完必须回跑 tsc 确认。

### 闸口

`tsc --noEmit` exit 0；`vite build` 3.52s；浏览器 7/7：6 个工具页浮层项数正确、
free-creation 的 `fc-settings-popover-head` + `role="dialog"` 保留、素材库真实拉到 7 项网格；
10/10 页圆角回归通过、零 JS 错误。

行数：ProductKit 696→604、ProductDetail 660→584、ViralClone 740→664、FreeCreation 641→553、
ToolShell 576→516（合计再减 392 行；新增组件 243 行，净减约 149）。

### 验证脚本的时序坑（第三次踩）

ProductKit 浮层首轮报「浮层=false」，单独调试却是正常的 —— 该页素材库 Modal 的加载动画
吃掉了 700ms 等待。**判定「功能坏了」前必须单独调试一次**，别直接改代码。
同理 `100%` 圆角是 antd 组件过渡态的瞬时值，复跑即消失，不是回归。

### 仍未做（最后一批）

**ToolShell 收拢到 14/14** —— 5 个大页自建 JSX（上传区 / 设置浮层 / 提交 / 结果区），
且**都缺历史记录区**（ToolShell 有，真实拉 `generateApi.list()`，属功能性缺失不只是代码重复）。
需 5 页 × 200 行，且要保持各页 1:1 复刻的 DOM 差异，建议逐页一批。

---

## 第四批：ToolShell 收拢（用户指令「全部一批改完」，已完成）

### 核心决策：没有硬塞，按可复用边界切

逐页对比后发现硬套 ToolShell 会**破坏 1:1 复刻**，三个硬证据：

1. **上传卡与业务卡合并在一张卡** —— ProductKit 的「生成设置/商品描述」与上传区同属一张
   `pk-config-card`；ToolShell 是「上传卡 + children 各占一张」。硬套 → DOM 变化 → 视觉偏移。
2. **结果网格 class 逐页不同** —— ProductKit 是 `pk-result-grid`，其余四页各有自己的类
   （`pk-result-detail-scroll` 等），都是参考站 1:1 实拍值。
3. **MultiFusion 是独立两步流** —— `multi-image-fusion-*` 体系（场景网关 → 工作区），
   连骨架都不是 `pk-*`，完全无法套用。

因此抽出「外壳里真正可复用的三块」：

| 抽出 | 原状 | 组件 |
| --- | --- | --- |
| 历史记录区 | 只长在 ToolShell 里，**5 个自建页全都没有**（功能缺失） | `ToolHistoryPanel.tsx`(61) |
| 提交区 | ToolShell + 4 页各一份 | `ToolSubmitBar.tsx`(65) |
| 结果栏空态 | ToolShell + 4 页各一份 | `ToolEmptyState.tsx`(49) + `ToolWorkflowSteps` |

### 真正收益是功能补齐

5 个自建页此前**完全没有历史记录**。现全部接入，实测真实项数：product-kit 4 / product-detail 2 /
viral-clone 1 / free-creation 2；MultiFusion 在工作区阶段也接上（0 项 + 空态，该能力确无历史产出）。

### 回退记录（重要）

曾写 `ToolResultPane.tsx`（连结果网格一起抽），发现各页网格 class 是 1:1 实拍值，统一即破版，
**已删除该文件**，只保留空态抽取。**教训：抽象层级要按「差异是否 1:1 实拍值」划线，
不是按「代码长得像」划线。**

### 坑

- **JSX 标签配平切块**：找 `<div className="X">` 后要从其后做 `<div`/`</div>` 计数配平才能切出整块；
  切完 ViralClone 多留了一个 `</div>` 导致 16 个语法错误（tsc 报 TS17008/TS10095 等级联错误）。
  **配平后必须立刻回跑 tsc**，别攒着。
- **MultiFusion 验证要走两步流**：默认停在「场景网关」阶段，该阶段本就没有历史区。
  直接查会误报功能缺失。**验证前先确认页面当前处于哪个阶段。**

### 闸口

`tsc --noEmit` exit 0；`vite build` 2.22s；浏览器 5/5 页历史区+提交区+空态全通、零溢出；
MultiFusion 两阶段符合预期；前 3 批功能复验通过；10/10 圆角回归、零 JS 错误。

**重复归零**：`pk-submit-actions` / `pk-primary-btn` / `tool-history-card` /
`pk-preview-placeholder` / `pk-workflow-steps` 五个 class 各自只剩组件定义处 1 处。

### 四批累计

5 个大页 3642 → 3015 行（**-627 / -17%**），且**首次具备历史记录功能**。

### 全部完成（2026-10-19 四批收尾）

原审计清单 8 项全部处理：P0 × 1（antd 蓝泄漏）、P1 × 4（能力清单去硬编码 / 圆角 token /
死 token / ToolShell 收拢）、P2 重复代码（空态 SVG / 手写图标 / 粘贴监听 / 选项集 / 素材库弹窗 /
高级设置浮层 / 历史记录 / 提交区 / 空态）。

**唯一刻意未做**：`--mif-radius-*` 私有圆角阶梯（18/15/14/13/11/9/7/6px，28 条裸字面）归位到
全局 6 档 —— 需单独裁定，方向与 10-17「统一优先于逐页 1:1」相反。

### 服务中断与恢复（14:00前后）

前端 dev server（task EkI9Fl）运行 2h59m 后退出（非崩溃，日志末尾无异常栈，是被外部终止）。
日志里两条历史报错均为**编辑中途的瞬时状态**，事后已修复：
- `Failed to resolve import "./lib/optionSets"` —— 第二批抽取时的路径笔误，当时即改回 `../lib/optionSets`
- `ViralClonePage.tsx 571 Adjacent JSX elements must be wrapped` —— 第四批配平切块多留一个 `</div>`，当时已修

重启后实测：tsc 0 错误、前端 200、代理→3002 为 200、四批功能复验全过（历史记录 5 页真实项数
4/2/1/2、浮层 6 页、素材库 7 项）、10/10 圆角回归、零 JS 错误。

**注意**：13:52–13:57 有 5 个文件被改动（`PromoBar` / `AppLayout` / `SideRail` / `global.css` /
`WorkbenchPage`），**不在本轮工作范围内**，是用户同期自己改的（其中 SideRail 移除了
`SIDEBAR_WIDTH` 导出，触发 fast-refresh invalidate）。复验确认这些改动未破坏本轮成果。

### 验证脚本的已知抖动（勿误判为回归）

`verify-radius.cjs` 偶发报某页「新增圆角值 `100%`」，来源是 **`ant-spin-dot-item`**（antd Spin
加载动画的圆点，加载态瞬时元素）。判定方法：直查 `getComputedStyle(...).borderRadius === '100%'`
的元素类名，若为 `ant-spin-dot-item` 即噪声，**复跑一次通常即恢复**。同一脚本偶发 8/10 或 9/10，
同样源于此。