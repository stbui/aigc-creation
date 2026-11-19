# 前端组件语言设计规范

状态：现行（2026-11-18）。

本规范面向 `frontend/src` 的全部页面与组件，统一 C 端和后台的组件角色、公开接口、状态语义、组合方式与评审规则。视觉值不在本文件重复定义：颜色、圆角、阴影以 [`design-tokens.md`](design-tokens.md) 为准，字号与微规格以 [`typography.md`](typography.md) 为准，后台双层视觉边界以 [`admin-ui-design.md`](admin-ui-design.md) 为准。

一句话标准：**同一个用户意图必须对应同一种组件角色、同一种属性语言和同一种状态语义；两端可以换视觉皮肤，不能换交互语法。**

## 1. 适用范围与事实源

| 内容 | 现行事实源 |
| --- | --- |
| C 端公开组件入口 | `frontend/src/ui/index.ts` |
| 后台页面公开入口 | `frontend/src/admin-ui/radar/index.ts` |
| 后台共享实现层 | `frontend/src/admin-ui/primitives/index.ts` |
| shadcn / Radix 原子件 | `frontend/src/admin-ui/components/ui/*`，仅供组合层使用 |
| C 端状态反馈组件 | `frontend/src/components/StateViews.tsx`、`frontend/src/components/ToolEmptyState.tsx` |
| 后台状态反馈组件 | `frontend/src/admin-ui/radar/feedback.tsx`、`frontend/src/admin-ui/radar/blocks.tsx`、`frontend/src/admin-ui/primitives/skeleton.tsx` |
| 后台跨域状态到中文与色调的映射 | `frontend/src/components/admin/statusMeta.ts` 的 `STATUS_META` |
| C 端任务失败状态文案 | `frontend/src/lib/constants.ts` 的 `taskErrorText()` 与 `TASK_ERROR_TEXT` |
| 用户可见文案 | [`copywriting.md`](copywriting.md)、[`error-copy.md`](error-copy.md) |
| 加载、空、失败与结果不明 | [`feedback-states.md`](feedback-states.md) |
| 键盘、焦点、语义与读屏 | [`accessibility.md`](accessibility.md) |

取件边界：

1. C 端页面只从 `~/ui` 取公开组件；共享业务流程可以继续使用 `components/` 下的状态与组合件。
2. 后台业务页面只从 `~/admin-ui/radar` 取件，`radar` 再透传或覆盖 `primitives`。
3. 后台页面禁止直连 `admin-ui/components/ui/*` 或 `admin-ui/primitives/*`。外壳不可用时的 `AdminLoadError`、`AdminLoading`、`NoAdminAccess` 是既有例外，不向业务页扩散。
4. 页面不得为了少写一层包装，直接使用第三方组件库重新实现已有按钮、字段、弹层、表格和反馈状态。

## 2. 组件语言的五个原则

| 原则 | 规则 |
| --- | --- |
| 意图优先 | 先判断“这是导航、动作、输入、选择、状态还是反馈”，再决定用哪个组件。不能从颜色或形状反推语义。 |
| 语义稳定 | 外观可以按 C 端或后台切换，`variant`、`tone`、`size`、状态与事件的含义保持一致。 |
| 单一实现 | 同一种交互在公开取件层只保留一个入口；已有组件不够用时，先扩展公共件，不在页面复制。 |
| 组合优于开关 | 用复合组件、`children` 和 `asChild` 组合结构；不要为每个页面新增 `hasHeader`、`showFooter`、`compactTable` 一类布尔开关。 |
| 状态内置 | 可访问性、禁用、忙碌、错误和焦点行为属于组件契约，不能留给每个调用点重新实现。 |

组件应当只负责一类变化原因。视觉展示组件不直接请求接口，数据获取与写操作由页面、Hook 或功能目录承担；组件通过 `value`、`open`、`loading` 等属性接收状态，通过 `onChange`、`onOpenChange`、`onConfirm` 等回调向外通知意图。

## 3. 分层与导入方向

```text
页面 Page
  └── 业务组合块 Domain Block
        └── 复合模式 Field / Panel / Feedback / Overlay
              └── 语义组件 Button / Input / Badge
                    └── Radix + shadcn 原子件
```

| 层 | 放什么 | 允许依赖 | 禁止 |
| --- | --- | --- | --- |
| 原子层 | Radix / shadcn 的基础角色、焦点管理和原生交互 | Radix、React | 业务字段、接口、页面布局 |
| 语义组件层 | `Button`、`Input`、`Badge`、`Select` 等稳定公开组件 | 原子层、`cn`、令牌 | 页面专属文案与接口 |
| 复合模式层 | `FormField`、`AdminDataTable`、`Notice`、`ModalDialog` | 语义组件层 | 跨业务域取数 |
| 业务组合层 | `<业务组件>.tsx`、状态卡、结果栏、详情区 | 公共组件、本目录 Hook | 反向导出给公共层 |
| 页面层 | 路由状态、查询编排、写操作、URL 同步 | 本目录入口与全部下层 | 重写公共组件 |

导入方向只能自上而下。公共组件不能反向依赖 `pages/**`、某个业务目录的 `constants.ts` 或页面 Store。业务组合块也不能绕过 `components.ts` / `hooks.ts` / `utils.ts` 等目录入口直连外部依赖，目录规则见 [`frontend-module-conventions.md`](frontend-module-conventions.md)。

## 4. 组件角色与选择规则

| 用户意图 | 使用 | 不使用 | 关键约束 |
| --- | --- | --- | --- |
| 打开链接、改变路由 | 原生 `<Link>`；需要按钮外观时使用 `Button asChild` | 用 `Button onClick={() => navigate(...)}` 冒充链接 | 读屏必须识别为链接，支持新标签页与浏览器默认行为 |
| 执行动作 | `Button` / `ActionButton` / `IconButton` | `div`、`span`、图标加 `onClick` | 动作用按钮语义，提交按钮显式写 `type` |
| 输入文本、数字、日期 | `Field` / `FormField` 包裹对应控件 | 只有 placeholder 的裸输入框 | 标签、帮助、错误必须由字段层关联 |
| 二选一即时设置 | `Switch` | 用 `Checkbox` 表示立即启停设置 | 必须有关联标签和当前状态文案 |
| 多选或一组可勾选项 | `Checkbox` | 用 `Switch` 表示提交型多选 | 选中状态可被读屏获知 |
| 从有限集合中选择 | `Select` / `Radio` / `SegmentedGroup` | 用自由文本替代小集合 | 选项来源与禁用原因明确 |
| 切换内容面板或视图 | `Tabs` / `AdminTabs` | 用 Tabs 表示普通筛选值 | Tab 对应内容区，必须保持正确的 tab 语义 |
| 切换同一区域的过滤维度 | `SegmentedGroup` | 用 Tabs 冒充过滤控件 | 立即生效或统一提交，规则见后台设计规范 |
| 展示持续状态 | 后台 `StatusTag` + `STATUS_META`；C 端使用领域状态展示与统一状态文案 | 用任意颜色 `Badge` 表示状态 | 必须是“中文状态 + 语义色”双编码 |
| 展示计数、分类或标签 | `Badge` / `RadarBadge` / 领域徽标 | 把未知状态藏掉或全部标成正常 | 纯展示标签不自动承担业务流程 |
| 展示页面、详情或数据集合 | `Panel` / `Card` / `Descriptions` / `AdminDataTable` | 多层卡片套卡片 | 容器只负责层级，不重复业务状态 |
| 展示完整数据状态 | `StateSkeleton` / `StateEmpty` / `StateError` 或后台对应组件 | 用一行“加载中”“暂无数据”代替 | 状态判定顺序遵循反馈规范 |
| 瞬时操作反馈 | Toast | 用 Toast 承载必须持续阅读的结果 | 成功、警示、失败时长由 Provider 统一 |
| 页面内持续提示 | `Notice` / `InlineAlert` | 用 Toast 代替字段错误或不可恢复风险 | `danger` 使用警告语义，不只换颜色 |
| 确认不可逆动作 | `ConfirmDialog` / `ConfirmAlert` / `modal.confirm` | 点击即删除或退款 | 写明对象、后果、可否撤销与影响数量 |
| 查看详情 | `Drawer` / `AdminDrawer` | 所有详情无条件跳新页面 | 保留列表筛选和返回上下文 |
| 聚焦完成一个短表单或并排详情 | `ModalDialog` / `Modal` | 用多个弹层串联流程 | 每个弹层只承担一个决策 |
| 短暂附加操作 | `DropdownMenu` / `RowMenu` / `Popover` | 把关键操作只藏在 hover 中 | 触发器必须有可读名称与键盘入口 |

### 4.1 按钮语言

按钮层级表达“动作重要性”，不表达品牌装饰：

| 语义 | 用途 |
| --- | --- |
| `default` / primary | 当前区域唯一推荐动作 |
| `secondary` | 常见并列动作 |
| `outline` | 低强调但仍需清晰边界 |
| `ghost` | 高频轻量动作、行内辅助动作 |
| `danger` / `destructive` | 删除、终止、退款等不可逆或高风险动作 |
| `link` | 视觉上像链接的次要导航；不得用于提交 |

规则：

1. 同一决策区域最多一个主按钮；其余动作用次级按钮或菜单。
2. 尺寸只表达密度，不用更大的按钮制造主次。后台密集区使用 `xs` / `sm`，常规操作使用 `md`；C 端兼容档位由 `~/ui` 统一归一。
3. `loading` 表示请求已发出并正在等待结果。按钮必须同时禁用、保留动作语义并切换为“正在做什么…”文案；不能只转圈或改成“确定”。
4. `disabled` 表示前置条件不成立。仅靠禁用隐藏原因不合格，附近必须说明缺什么。
5. 图标按钮必须有 `aria-label`，装饰图标必须 `aria-hidden`。
6. `asChild` 只用于把按钮外观交给具有正确语义的子元素，例如 `<Link>`。不能借 `asChild` 绕过原生按钮行为。
7. C 端 `Button` 现有的 `type` / `htmlType` / `danger` / `block` 是兼容参数，不是新增组件的设计模板。现代后台组件使用 `variant` 表达层级；新组件不得同时引入两套外观轴。

### 4.2 状态与徽标语言

- 后台 `StatusTag` 负责跨域业务状态；C 端由功能目录提供等价的状态展示；`Badge` 负责计数、分类和轻量标签；`RadarBadge` 只负责后台中性视觉容器。它们不可互换。
- 后台状态标签优先传业务 `status`，由 `STATUS_META` 决定默认文案和色调。页面语境不同时通过 `label` 覆盖中文，不复制色调表。C 端任务失败统一使用 `taskErrorText()`，领域状态在所属功能目录集中维护。
- 未登记状态必须显示原值或明确的“未知状态”，不能隐藏，也不能默认映射为成功或正常。
- 状态不能只靠颜色。色块、文字、图标或形状至少同时提供一种非颜色信号。
- 公共语义色调统一使用 `success` / `warn` / `danger` / `brand` / `muted`；需要信息提示时优先使用中性信息样式，不新增近似色。

### 4.3 字段语言

字段是一个完整组合，不是“一个输入框”：

```text
字段标签（required / help）
控件
错误或说明
```

1. `Field` / `FormField` 是标签、必填标识、说明、错误与控件的组合边界。
2. 每个控件都必须有可关联的标签；`placeholder` 只给示例，不能代替标签。
3. 字段错误使用 `aria-invalid` 与 `aria-describedby` 关联到控件，并在字段附近显示“哪里错 + 怎么改”。不要只弹 Toast。
4. 纯展示说明使用辅助文字色；错误使用 `danger` 语义。说明和错误不同时抢占同一位置，错误优先。
5. 提交型表单与即时设置明确区分：需要点击“保存”的控件不因单次切换自动宣称已生效。
6. 控件宽度、分组和换行由页面布局负责，字段组件不新增 `layout="horizontal"` 等业务开关。

### 4.4 数据与容器语言

| 组件 | 只负责 | 不负责 |
| --- | --- | --- |
| `PageHeader` | 页面标题、说明、唯一边界清晰的主操作区 | 数据请求、业务状态判断 |
| `Panel` / `Card` | 一个内容分组与视觉层级 | 嵌套卡片、全局页面宽度 |
| `Descriptions` | 标签 / 值的事实展示 | 状态动作、业务格式化 |
| `AdminDataTable` | 表格投影、排序 / 分页 / 选择的展示接口 | 自己取数、私自保留跨筛选选择 |
| `StatCard` / `MiniStat` | 单个指标和语义色调 | 指标口径计算 |
| `BarChart` / 图表组件 | 已归一数据的可视化 | 原始接口数据清洗 |

表格状态由页面持有，表格只接收列、数据和回调。排序、分页、勾选如由服务端驱动，组件不能偷偷改成纯客户端行为。首次加载、空数据、首屏失败和刷新失败必须使用不同反馈组件，不能用空表格统一兜底。

### 4.5 浮层与确认语言

1. 浮层只使用 Radix + shadcn 组合件，由底座负责焦点陷阱、`Esc`、读屏角色和关闭后焦点归位。
2. `Dialog` / `Modal` 必须有可读标题；有说明时使用描述，不得只靠视觉布局表达警告。
3. 支持受控与默认打开时，统一使用 `open` / `defaultOpen` / `onOpenChange`。
4. 浮层中的主操作与关闭操作要区分；危险确认的操作按钮使用 danger，不使用主按钮样式伪装。
5. 浮层请求进行中时，确认按钮加载并锁定，调用方不得提前关闭；失败后保留上下文并显示可执行原因。
6. 同一条信息只在一个浮层中出现。确认弹窗、Toast 和页面结果卡不能连续重复同一结论。

### 4.6 链接与筛选语言

1. 动作目标是路由时使用链接语义：按钮外观用 `Button asChild`，空态或失败态的主动作用 `StateButton asChild`，子元素传 `<Link>`。不要用 `onClick + navigate` 伪装成链接。
2. 下拉菜单中的路由项传 `DropdownItem.to`，整行渲染为链接，保留右键、新标签页和读屏链接角色；动作项才使用 `onClick`。
3. 作品卡浮层中的路由操作传 `WorkCardAction.to`；预览、下载、删除等当前页动作继续使用 `onActivate`。不要为路由动作再补 `role="button"`。
4. 跨页业务类型入口使用 `<nav>` + `<Link>`，当前项用 `aria-current="page"`；同页面板切换才使用 Tabs。
5. 筛选器使用 `role="group"` + `aria-pressed` 表达选中状态。订单、工单、素材来源等互斥筛选项不是 Tab，读屏不能播报为页签。

## 5. Props 命名与接口契约

### 5.1 命名

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 组件名 | PascalCase，名称表达角色或业务对象 | `FormField`、`StatusTag`、`ProductSkuVariantRow` |
| Props | lowerCamelCase | `ariaLabel`、`onOpenChange`、`defaultValue` |
| 布尔值 | 使用正向、可读的词，不写 `is*` 前缀 | `loading`、`disabled`、`required`、`open` |
| 事件 | `on + 事件`，参数表达“新值”或“意图” | `onChange(value)`、`onConfirm()` |
| 受控值 | `value` / `open` / `selected` 与其变更回调成对出现 | `value` + `onChange` |
| 默认值 | `defaultXxx` | `defaultValue`、`defaultOpen` |
| 样式扩展 | `className` 只用于外层布局、宽度和网格位置 | `className="min-w-0"` |
| 无障碍名称 | 组合层可使用 `ariaLabel` 并映射为 `aria-label`；原生原子件直接使用 `aria-label` | `ariaLabel="关闭详情"` |

避免以下命名与新参数：

- `color`、`styleType`、`theme`、`customColor` 作为颜色入口；应使用语义 `tone` 或进入令牌层。
- `isSmall`、`isPrimary`、`canClick` 等重复表达已有 `size` / `variant` / 状态规则的布尔值。
- `handleClick`、`callback` 一类无对象的事件名。
- 用 `type` 同时表示原生 HTML 类型、视觉层级和业务类型。一个属性只能承担一个轴。

### 5.2 四个正交轴

组件的外观参数按职责拆分：

| 轴 | 回答的问题 | 典型值 |
| --- | --- | --- |
| `variant` | 动作或容器在层级中多重要？ | `default` / `secondary` / `outline` / `ghost` / `destructive` |
| `tone` | 内容表达什么语义？ | `success` / `warn` / `danger` / `brand` / `muted` |
| `size` | 当前界面密度多大？ | `xs` / `sm` / `md` / `lg` / `icon` |
| 状态 Props | 运行时能否交互、是否正在等待？ | `disabled` / `loading` / `invalid` / `readOnly` |

这四个轴不能互相编码。比如“危险”不是大号，“加载中”不是灰色，“重要”不是品牌紫；它们分别是 `variant="destructive"`、`loading` 和动作层级。

### 5.3 受控与组合

1. 可复用交互组件优先支持受控；确有内部临时态时再提供 `defaultXxx` 非受控形式，不能只保留一种难以组合的模式。
2. 回调参数在当前抽象层保持一致。字段包装器返回新值，原生输入原子件才暴露 DOM Event；不能同名的 `onChange` 在不同包装层随意切换参数含义。
3. 结构扩展优先 `children`、复合子组件或渲染插槽。三处以上都需要破坏性的结构开关时，重新设计组合，而不是继续加布尔 Props。
4. 互斥模式使用联合类型表达，避免调用方同时传 `primary`、`danger`、`link` 造成优先级猜测。
5. `className` 可以调整宽度、间距、对齐和布局；不能覆盖组件已有的颜色、边框、字号、圆角和状态色。视觉差异应在公共组件或令牌层解决。
6. `style` 只用于无法由布局类表达的集成边界。禁止用内联样式写颜色、字号、动画和状态。
7. `data-testid` 是测试锚点，不是组件 API。后台关键节点统一使用 `admin-*`，不得把它变成业务逻辑输入。

建议的稳定接口形态：

```tsx
interface ExampleProps {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  className?: string;
  children?: React.ReactNode;
}
```

## 6. 状态语义

组件内部状态和区域数据状态必须分开建模。

### 6.1 交互状态

| 状态 | 含义 | 必须满足 |
| --- | --- | --- |
| 默认 | 可操作，尚未交互 | 语义角色正确 |
| hover | 指针移入 | 不是唯一发现入口 |
| focus-visible | 键盘焦点 | 焦点环可见，顺序与视觉一致 |
| active / pressed | 正在按下或已选中 | 同时有程序语义，不只换色 |
| disabled | 当前不可操作 | 原因可读，必要时提供替代路径 |
| loading / busy | 操作已开始，等待结果 | 防重复提交，保留动作对象与忙碌文案 |
| invalid | 输入不满足规则 | `aria-invalid` 与错误说明关联 |
| readOnly | 可读、可复制、不可修改 | 仍可获得焦点，不能伪装成 disabled |

`disabled`、`loading` 和 `readOnly` 不可互相替代。不可用能力、无权限与请求失败也不能都用 disabled 表示。

### 6.2 区域数据状态

一个数据区域同一时刻只能命中一个状态，判定顺序固定为：

1. 不可用
2. 首次加载
3. 有数据
4. 空
5. 首屏失败
6. 有旧数据但刷新失败

加载占住真实布局；空态解释“为什么空 + 下一步”；失败态说明“发生了什么 + 钱和产出 + 下一步”；陈旧态明确基于上一次成功数据；结果不明禁止诱导重试。完整规则只在 [`feedback-states.md`](feedback-states.md) 维护。

### 6.3 异步契约

- 组件不自行猜测请求是否完成。`loading` 由拥有请求生命周期的页面或 Hook 管理。
- 同一操作只能有一个忙碌源；按钮、菜单项和键盘提交必须共享禁用状态。
- 失败后恢复可操作性，不能把组件永久锁死在 loading。
- 轮询刷新使用静默刷新，不清空旧内容、不每次播报。
- 成功状态应可被用户持续确认；Toast 消失后，页面或结果卡仍要保留最终结论。

## 7. 跨端一致性

C 端与后台共享交互语法，但有明确视觉分工：

| 维度 | C 端 | 后台 |
| --- | --- | --- |
| 产品语气 | 面向创作者，降低术语 | 面向运营，允许业务术语 |
| 主色 | 品牌紫表达产品身份 | 外壳品牌紫；业务内容使用 Radar 中性动作色 |
| 密度 | 兼顾触控与创作流程 | 桌面高密度工具，优先扫读效率 |
| 响应式 | 必须支持窄屏与触控 | 不做移动端专属布局，但 200% 缩放仍可操作 |
| 同一角色 | 同一语义、同一 PropTypes 语言 | 同一语义、同一 PropTypes 语言 |

跨端一致的是组件角色、属性含义、状态判定、可访问性和文案结构，不是像素值。不得因为后台需要中性灰而给 C 端按钮换一套属性名；也不得把后台品牌紫带进业务内容层。

## 8. 视觉引用规则

组件只使用语义参数与设计令牌：

1. 颜色使用 `tone` / `variant` 或语义类，禁止在 JSX 与页面 CSS 中写裸 hex、`rgb()`、`hsl()`。
2. 字号使用全局阶梯，最小 12px。组件不得为了“精致”缩到 10px / 11px。
3. 圆角、阴影、间距引用 [`design-tokens.md`](design-tokens.md) 规定的层级与刻度。
4. 后台内容层使用 Radar 语义；C 端与后台外壳使用 `tokens.css`。浮层 portal 到 `body` 时，由 Provider 保留正确视觉作用域。
5. 默认态、hover、active、focus、selected、disabled、invalid 必须覆盖完整，不能只写默认态。
6. 组件动效响应 `prefers-reduced-motion: reduce`；动效只表达层级或状态变化，不作为唯一反馈。

## 9. 文案与格式化

组件必须把文案作为输入或可替换内容，业务页面不得通过 CSS `content` 注入用户可见文字。

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 动作按钮 | 动词 + 对象，2–6 字 | `生成图片`、`确认退款`、`保存草稿` |
| 加载按钮 | 正在做什么 | `正在保存…`、`正在生成…` |
| 字段标签 | 名词或明确属性 | `退款窗口天数` |
| 状态 | 统一中文词 + 语义色 | `已完成`、`结果不明` |
| 空态 | 原因 + 一个下一步 | `还没有作品。上传图片开始第一次创作。` |
| 错误 | 发生了什么 + 钱和产出 + 下一步 | `生成失败，积分已退回。请调整图片后重试。` |
| 确认 | 动作 + 后果 + 可否撤销 | `删除后素材无法恢复，已生成作品不受影响。` |

金额、积分、日期、时长、文件大小和空值统一使用项目格式化函数。组件不各自调用 `toLocaleString`，后台时间固定按北京时间。C 端不显示错误码、字段名、内部状态枚举和上游原始报错。

C 端日期按展示密度选择 `frontend/src/lib/format.ts`：`formatDate` 只到日期，`formatDateTime` 到分钟，`formatCompactDateTime` 用于同屏比较紧凑时刻（`separator` 只切换日期段分隔符），`formatRelativeTime` 用于消息列表，`formatLongDate` 用于会员到期等长日期，`formatClock` 用于同一会话内的时间戳。后台统一使用 `frontend/src/admin-ui/lib/format.ts` 的北京时间函数。

## 10. 可访问性契约

以下要求属于组件默认行为，不需要调用方额外“记得加上”：

- 原生按钮、链接、输入、表格语义不被无必要覆盖。
- 图标按钮有可读名称；装饰图标对读屏隐藏。
- 浮层有标题、焦点陷阱、`Esc` 关闭与焦点归位。
- 表单错误通过 `aria-invalid` 和 `aria-describedby` 关联。
- 加载、成功、警告使用合适的 live region；危险错误使用 `role="alert"`。
- 状态不只靠颜色，选中不只靠视觉高亮。
- 键盘顺序与视觉顺序一致，不使用正数 `tabIndex`。
- 可点击目标满足 C 端触控尺寸；后台仍支持键盘和 200% 缩放。

自定义组件一旦绕过底座自行组合，就必须自己承担上述全部责任。这不属于允许的“轻量实现”。

## 11. 常用组合示例

### 11.1 导航使用链接语义

```tsx
<Button asChild variant="secondary">
  <Link to="/works">查看作品</Link>
</Button>
```

动作目标是路由时，原生行为、右键菜单、新标签页与读屏角色都保留为链接；视觉上像按钮不改变它是链接。

### 11.2 字段组合

```tsx
<FormField label="退款窗口天数" required error={errors.days}>
  <NumberField
    value={days}
    onChange={setDays}
    ariaLabel="退款窗口天数"
  />
</FormField>
```

字段层负责标签、必填与错误关联；控件只负责取值和输入行为。

### 11.3 后台状态双编码

```tsx
<StatusTag status={order.status} label={labelForStatus(order.status)} />
```

中文标签与色调来自统一状态语义；遇到未登记状态时保留原值，提示运维数据存在缺口。

### 11.4 持续失败与瞬时反馈分工

```tsx
<ListError message="订单加载失败，请重新获取。" onRetry={reload} />
```

页面级失败使用可保留的失败态。保存成功、复制成功等瞬时结果才使用 Toast。

## 12. 禁止模式

| 禁止写法 | 原因 | 正确做法 |
| --- | --- | --- |
| `<div onClick>` 当按钮 | 无键盘与读屏语义 | `Button` |
| 用 Button 执行导航 | 丢失链接行为 | `Button asChild` + `Link` |
| 页面直连 shadcn / primitives | 绕过公共主题与状态契约 | 从 `~/ui` 或 `~/admin-ui/radar` 取件 |
| 复制一套按钮、字段或空态 | 同类交互分裂 | 扩展公共组件 |
| 同一组件新增十几个布尔开关 | API 不可预测 | 复合组件、联合类型、插槽 |
| `className` 覆盖颜色、字号、圆角 | 绕过令牌与视觉边界 | 在语义组件或令牌层解决 |
| 状态只用颜色表达 | 色觉障碍用户不可读 | `StatusTag` 双编码 |
| 未知状态隐藏或默认正常 | 掩盖数据问题 | 显示未知状态并保留原值 |
| loading 只显示转圈 | 用户不知道在做什么 | 按钮文案 + 加载态 + 防重复提交 |
| 提交未完成就关闭弹窗 | 用户无法确认结果 | 成功回调后再关闭 |
| Toast 承载持续错误 | 消失后上下文丢失 | 页面错误态、结果卡或字段错误 |
| 用 Tabs 当筛选器 | 角色语义错误 | `SegmentedGroup` 或 Select |
| 自定义弹层焦点管理 | 容易漏 Esc 与焦点归位 | Radix + shadcn 组合件 |
| 在页面写裸 hex / 10px 字号 | 破坏统一视觉与可读性 | 语义令牌与字号阶梯 |
| hover 是唯一操作入口 | 触屏与键盘不可达 | 可见操作或等价菜单 |

## 13. 新增或修改组件流程

1. **查重**：在对应公开入口搜索同角色组件；确认能否通过组合、`variant`、`tone` 或 `size` 满足。不能仅因文案或一页样式不同新建组件。
2. **定角色**：写出它回答的用户问题，例如“选择一个筛选值”或“展示持续业务状态”。角色无法用一句话说清，说明组件拆错了。
3. **定边界**：明确哪些 Props 是业务输入，哪些状态由调用方持有，组件是否可受控，是否有复合子组件。
4. **定状态**：列出默认、hover、focus-visible、selected、disabled、loading、invalid、empty/error 中适用的状态。没有发生条件的状态不要保留死接口。
5. **定无障碍**：确定 DOM 角色、可读名称、焦点行为、错误关联、live region 与键盘路径。
6. **接入视觉**：只使用语义类和令牌；跨端差异放在公共视觉层，不复制业务实现。
7. **补测试**：至少覆盖主要变体、键盘触发、禁用 / loading、错误关联和公开入口导入；后台关键节点保留 `admin-*` 测试锚点。
8. **更新入口**：C 端更新 `frontend/src/ui/index.ts`；后台更新 `primitives/index.ts` 或 `radar/index.ts`。页面只消费稳定公开入口。
9. **同步文档**：新增组件角色、参数轴或视觉规则时，同步本文件及对应设计文档；只修样式不改语言时至少检查这里是否仍成立。

新增官方 shadcn 组件的流程仍以 `CLAUDE.md` 为准：使用 CLI 添加，运行 `frontend/scripts/post-shadcn.mjs`，再由 primitives / radar 组合成业务可用件。

## 14. 评审清单

- [ ] 组件角色能否用一句用户意图说清，且没有与现有角色重叠？
- [ ] 页面是否只从 C 端 `~/ui` 或后台 `~/admin-ui/radar` 取公开件？
- [ ] 动作、导航、输入、选择、状态和反馈是否使用了正确的语义组件？
- [ ] Props 是否遵守 `value` / `defaultValue` / `onChange`、`open` / `onOpenChange` 等命名规则？
- [ ] `variant`、`tone`、`size` 与运行时状态是否彼此正交？
- [ ] 是否有用布尔 Props 堆叠本应使用联合类型或组合表达的模式？
- [ ] loading 是否防重复提交、保留动作文案并在失败后恢复？
- [ ] disabled 是否说明了原因，readOnly 是否仍可聚焦和复制？
- [ ] 首屏加载、空、失败、陈旧与不可用是否区分？
- [ ] 状态是否有文字，不只靠颜色；未知状态是否保留？
- [ ] 图标按钮、表单、浮层和动态反馈是否满足无障碍规范？
- [ ] 是否只使用布局 `className`，没有覆盖颜色、字号、圆角和状态色？
- [ ] 是否使用项目格式化函数，C 端文案没有内部错误码与实现术语？
- [ ] 跨端语义是否一致，后台内容层是否没有品牌紫泄漏？
- [ ] 新增公共 API 是否有测试和使用说明，没有留下一次性兼容开关？

## 15. 已知缺口

- 旧版组件库的兼容层已清除：C 端 `Button` 只剩 `variant` / `size` 一套外观入口，表单、表格、分页、页签与浮层都直接组合 shadcn 原子件。
- 图标角标使用 `CountBadge`，与表示标签的 `Badge` / `RadarBadge` 区分；跨端新增组件必须使用更明确的名称。
- `className` 与 `style` 仍可在调用点覆盖部分视觉，`verify:conventions` 目前只强制最小字号等少数规则，组件 API 约束主要依赖评审。
- 公开入口尚无统一的 API 契约快照或禁止直连检查；新增组件仍需测试与人工核对。
- 状态映射只覆盖已登记跨域状态，领域内状态仍应在所属目录集中维护，不能在各页面重复写文案。
