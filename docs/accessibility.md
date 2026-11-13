# 可访问性规范

目标：**WCAG 2.2 AA**。C 端与后台都适用；后台不做移动端，但键盘、读屏、缩放与对比度要求不降低。本文件规定可检查的语义、焦点、标注与验证方式；状态反馈的时序与文案见 [`feedback-states.md`](feedback-states.md)，颜色令牌见 [`design-tokens.md`](design-tokens.md)。

## 1. 键盘与焦点

- 所有交互元素必须可仅用键盘完成：`Tab` 到达、`Enter` / `Space` 触发、`Esc` 关闭浮层。
- **不使用正数 `tabIndex`**（当前 0 处）；DOM 顺序即焦点顺序，视觉顺序必须与 DOM 顺序一致。
- 焦点必须可见：统一使用 `:focus-visible` 与 `--ring` 令牌，不允许 `outline: none` 后不给替代样式。
- C 端与后台都提供跳转主内容的 skip link：
  - C 端 `AppLayout` 的 `.skip-to-content` → `#main-content`；
  - 后台 `AdminBoardLayout` 的 `.adm-skip-link` → `#adm-main`。
- 主内容容器可获得程序化焦点（`tabIndex={-1}`），路由切换或跳转后可落焦。
- 浮层（Dialog / Drawer / Popover / Dropdown）只使用 radix + shadcn 组合件：焦点陷阱、`Esc` 关闭、关闭后焦点回到触发元素由底座负责，不手写。
- 异步操作完成后焦点留在原处；不要为了提示成功而抢焦点。

## 2. 语义与结构

- 页面使用地标：`header` / `nav` / `main` / `aside`；一个页面只有一个 `main`。
- 每页一个 `h1`，标题层级不跳级；视觉字号与标签层级不一致时用样式调整，不改标签。
- **按钮做动作，链接做跳转**：不要用 `div` / `span` 加 `onClick` 冒充按钮；确需自绘时补 `role`、`tabIndex` 与键盘处理。
- 纯图标按钮必须有 `aria-label`；按钮内只有图标时，图标本身 `aria-hidden`。
- 非提交按钮显式写 `type="button"`，避免在表单内默认触发提交。
- 列表用 `ul` / `ol`，表格用 `table`；不要用一堆 `div` 拼出表格语义。
- 语言：`frontend/index.html` 的 `<html lang="zh-CN">` 是唯一来源，不为局部内容随意改 `lang`（中英混排的长段落按需局部标注）。

## 3. 表单

- 每个输入控件都必须有关联标签：`label htmlFor` 或 `Field` / `FormField` 组合件；`placeholder` 不能替代标签。
- 必填项同时给视觉标识与程序语义（`required` 或 `aria-required`）。
- 校验错误就地显示在字段附近，并通过 `aria-invalid` + `aria-describedby` 关联；不要只用 Toast 报告字段错误。
- 错误文案说明「哪里错 + 怎么改」，不出现字段名与内部约束标识。
- 常见字段使用正确的 `autocomplete`（`email` / `current-password` / `new-password` / `tel` / `one-time-code`），登录与支付页尤其重要。
- 禁用态只用于确实不可操作的情况；仅因校验未通过而禁用的提交按钮，应在旁边说明缺什么。

## 4. 图像、图标与媒体

| 类型 | 规则 |
| --- | --- |
| 信息性图片 | `alt` 描述用途或内容，不写文件名、不堆关键词 |
| 装饰性图片 | `alt=""`，且不承担交互 |
| 图标按钮 | 按钮 `aria-label`；图标 `aria-hidden` |
| 纯装饰图标 | `aria-hidden="true"` |
| 生成结果图 | `alt` 使用「能力名 + 结果序号」一类可理解描述，不暴露任务 id |
| 视频 | 带 `controls`；不自动播放带声音的内容；有语音内容才需要字幕，纯视觉生成结果不强制 |

当前 112 个 `<img>` 全部带 `alt`；新增图片不得再出现无 `alt` 的 `<img>`。

## 5. 动态反馈

- 加载与状态变化区域使用 `aria-live="polite"`；错误使用 `role="alert"`；骨架区域可加 `aria-busy="true"`。
- 状态不能只靠颜色：必须同时有文字；后台状态标签沿用 `STATUS_META` 的「色块 + 中文」双编码。
- 同一次异步结果只播报一次：Toast 已经播报时，不再用 `aria-live` 重复同一句话。
- 轮询期间不逐次播报；只在进入终态时播报。
- 具体状态与文案结构见 [`feedback-states.md`](feedback-states.md)。

## 6. 颜色与对比

WCAG 2.2 AA 要求：

- 正文文字与背景 ≥ **4.5:1**；大字号（≥24px，或 ≥18.66px 加粗）≥ **3:1**。
- 非文字控件与图形（输入框边界、焦点环、图标）≥ **3:1**。
- 不把颜色作为唯一信息通道。

当前令牌在白底上的实测对比度：

| 令牌 | 白底 | `--surface` 底 | 结论 |
| --- | --- | --- | --- |
| `--brand` `#5546d8` | 6.45:1 | 5.86:1 | 正文与按钮可用 |
| `--text-strong` `#171a2b` | 17.23:1 | 15.63:1 | 可用 |
| `--text-body` `#4e5969` | 7.10:1 | 6.45:1 | 可用 |
| `--text-muted` `#667085` | 4.97:1 | 4.51:1 | 正文可用，`surface` 底已接近下限 |
| `--border` `#e5e7ef` | 1.23:1 | 1.12:1 | **不能作为控件边界的唯一识别** |

规则：

- 控件边界不能只靠 `--border`：需要 3:1 时改用更强的中性色或增加底色/内阴影。
- 焦点环使用 `--ring`，不得与背景同色。
- 新增颜色必须按 [`design-tokens.md`](design-tokens.md) 定义令牌并测对比度，不写裸 hex。

## 7. 动效

- 全站与组件级动效必须响应 `prefers-reduced-motion: reduce`；用户开启减弱动效时，取消位移、缩放与循环动画，保留即时状态变化。
- 不播放自动循环且无法暂停的装饰动画。
- 动画不能是传达状态的唯一方式；状态必须有文字。

## 8. 表格与分页

- 使用真实 `table` / `th` / `td`；表头 `th` 标注 `scope="col"` / `scope="row"`。
- 可排序表头使用 `aria-sort`。
- 表格有可读标题（`caption` 或 `aria-label`）。
- 分页使用 `nav aria-label="分页"`（C 端 `ui` 的 `Pagination` 已具备）。
- 后台表格统一走 `AdminDataTable`，不手写 `div` 表格。

当前 `scope` 仅 2 处、`aria-sort` 仅 1 处，属存量缺口。

## 9. 触控与缩放

- C 端交互目标最小 **24×24 CSS px**（WCAG 2.5.8），相邻目标留出间距。
- 不把关键操作只放在 hover / 右键菜单里；必须提供点击或键盘可达的等价入口。
- 页面在 200% 缩放与 320px 宽下不得出现双向滚动或内容截断（C 端）。
- 后台不做移动端，但仍需在 200% 缩放下可操作。

## 10. 组件取用

| 端 | 取件 |
| --- | --- |
| C 端 | `frontend/src/ui` barrel（底层 shadcn/radix 原子件） |
| 后台 | `admin-ui/primitives`（barrel） |
| 浮层 / 菜单 / 对话框 | radix + shadcn 组合件，不手写焦点管理 |

不要覆盖底座的 `role` / `tabIndex` / `aria-*`；确需扩展时在组合层补，不改原子件。

## 11. 验证

交付涉及交互、表单、浮层或状态反馈时，至少完成：

- [ ] 只用键盘走完整流程：`Tab` / `Shift+Tab` / `Enter` / `Space` / `Esc`。
- [ ] 焦点可见，顺序与视觉顺序一致，浮层关闭后回到触发元素。
- [ ] 每个输入都有标签；错误可通过读屏获知。
- [ ] 图标按钮有 `aria-label`；装饰图标 `aria-hidden`。
- [ ] 图片有 `alt`；装饰图片 `alt=""`。
- [ ] 状态不只靠颜色，且有 `aria-live` / `role`。
- [ ] 200% 缩放与 320px 宽下无内容丢失（C 端）。
- [ ] 关键页面用 VoiceOver 抽查一次标题、地标、表单与错误提示。
- [ ] `npm run lint` 未新增 a11y warning。

## 12. 已知缺口

- Biome a11y 规则当前 **136 条 warning / 69 个文件**，主要规则：`noNoninteractiveElementInteractions`（32）、`useSemanticElements`（30）、`useAriaPropsSupportedByRole`（18）、`noLabelWithoutControl`（18）、`useKeyWithClickEvents`（16）、`noStaticElementInteractions`（14）。
- `document.title` 仅 3 处，路由切换大多不更新标题，读屏与浏览器历史缺少页面标识。
- 表格 `scope` 仅 2 处、`aria-sort` 仅 1 处，排序与行列语义未系统覆盖。
- 没有 axe / Playwright 可访问性自动检查，读屏验证依赖人工抽查。
- `--border` 对比度 1.23:1，作为控件边界不满足 3:1；目前依赖底色与布局区分，后续需单独补强。
- `useButtonType` 仅 1 条告警，但大量按钮未显式写 `type`；新增按钮仍要求显式标注。
