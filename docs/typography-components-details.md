# 字体 · 组件 · 细节规格

全站跨页共享的微规格：字体加载与字体栈、antd 主题 token、字号字重、圆角、阴影、过渡与边框。这是"每个页面都要遵守"的那一层，页面级规格文档只写与该页有关的偏离。

| 项 | 值 |
| --- | --- |
| 字体导入 | `frontend/index.html` |
| antd 主题 | `frontend/src/main.tsx` 的 `ANTD_THEME_TOKEN` |
| 设计令牌 | `frontend/src/styles/global.css` 的 `:root` |

## 1. 字体

### 1.1 加载

`frontend/index.html` 引入 Google Fonts：

```
Inter          400;500;600;700;800
Noto Sans SC   400;500;600;700;800
display=swap
```

600 与 800 两个字重是必需的：全站大量使用 600 作强调、800 作数字与主按钮。缺失时浏览器会走合成伪粗体，字缘发糊，且字宽与真实字重不同，会连带影响布局。

`display=swap` 下 `document.fonts` 里显示 `unloaded` 是正常态（按需加载）。验证字重是否可用，看 face 是否**注册**，不看 `status`。

### 1.2 字体栈

```css
'Noto Sans SC', Inter, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif
```

Noto Sans SC 优先：Windows 没有 PingFang，把 webfont 放在首位才能跨平台一致。

**字体栈必须在 antd token 里再声明一次**（`ANTD_THEME_TOKEN.fontFamily`），不能只靠 `global.css` 的 `body` 规则。antd 的 `<App>` 会渲染一个带 `css-dev-only-do-not-override-*` 类名的 wrapper，该 wrapper 自带系统字体栈且**不从 `body` 继承**，因此只写 body 时全站实际渲染的是系统字体，而 `body` 上的声明只对 body 自己生效。排查方法与证据见附录 A。

## 2. 字号与字重

全站主导字号 12 / 13 / 14，主导字重 600 / 700。

| 场景 | 字号 / 字重 |
| --- | --- |
| 正文与表单 | 14px / 400 |
| 卡片标题、菜单条目、导航项 | 13px / 600–700 |
| 辅助说明、meta | 11–12px / 400 |
| 页面标题 | 24–32px / 500–700（按页面规格） |
| 数字强调 | 600–800 |

antd 基准字号维持 14px。改成 16px 会连锁改变 Button / Input / Table / Select 等全部控件高度，收益与风险不成比例。

## 3. antd 主题 token

```ts
colorPrimary:      '#5546d8'   // 品牌紫
colorPrimaryHover: '#4838c6'
colorError:        '#ef4444'
colorSuccess:      '#18a875'
colorBgLayout:     '#f6f7fb'
colorBorder:       '#e6e8ef'
colorText:         '#182033'
colorTextSecondary:'#667085'
borderRadius:      8
fontSize:          14
fontFamily:        "'Noto Sans SC', Inter, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
```

**antd token 与 CSS 变量是两套系统**。只改 `global.css` 的 `--brand` 不会影响 antd 组件 —— 主按钮、Spin、Input focus ring、Table / Tag / Modal / Drawer 的默认色都由 token 派生。品牌色审计必须两边都扫，且只能用计算样式扫描（grep CSS 查不到 antd 运行时注入的样式）。

受影响的 antd 面：Spin、App(message)、Modal、Button、Empty、Card、Typography、Tag、Table、Row/Col、Result、Popconfirm、Layout、Input、Form、Dropdown、Drawer、Avatar。

## 4. 圆角

只用这五档 + 胶囊：

| token | 值 |
| --- | --- |
| `--radius-tag` | 4px |
| `--radius-control` | 8px |
| `--radius-card` | 12px |
| `--radius-panel` | 16px |
| `--radius-hero` | 24px |
| `--radius-pill` | 999px |

单个组件需要中间值时按面写字面值，但不得因此新增同义 token 簇。

## 5. 阴影与 focus ring

| 用途 | 值 |
| --- | --- |
| 抽屉 | `-8px 0 24px #1f232924` |
| 悬浮按钮 | `0 4px 12px #1f232933` |
| 弹层 | `0 14px 40px #22294314` |
| focus ring | `0 0 0 3px #5546d81a` |

antd 的 focus ring 与激活色由 `colorPrimary` 派生，token 归位后自动变紫。自绘组件要手写 focus ring 时使用上表的紫色值，不要用浏览器默认蓝。

## 6. 过渡时长

| 场景 | 值 |
| --- | --- |
| 颜色 / 背景 | `.18s` |
| 位移 / 缩放 | `.18s` |
| 透明度 | `.2s` |

允许 `.15s` 与 `.2s` 的混用，差异在 30ms 级别，不构成可感知问题，不要为此做全站替换。

## 7. 边框

| 用途 | 变量 / 值 |
| --- | --- |
| 常规描边 | `--border` `#e5e7ef` |
| 外壳浅描边 | `--color-border-soft` `#f2f3f5`（顶栏下边框） |
| antd 默认边框 | `colorBorder` `#e6e8ef` |

新增描边前先确认这三档能不能覆盖；不要引入第四种近似的灰色。

## 8. 硬编码禁令

页面一律引用 `var(--token)`，不写裸 hex。`--color-primary` 历史上一度是蓝色 `#2563eb`，与紫系页面混用导致 hover 时蓝紫跳变 —— 这类同义色簇是最容易复发的样式缺陷。

新增颜色前先查 `global.css` 是否已有语义合适的 token；确需新增则定义 token 并全站替换。

## 附录 A · 字体生效的排查方法

判断"哪个字体声明真正生效"不能只读 CSS 文本，要读浏览器**实际绘字**的字体：

1. 用 CDP 的 `CSS.getPlatformFontsForNode` 取节点真实使用的 platform font（`isCustomFont: true` 表示是 webfont）。
2. 沿祖先链逐级取计算样式，找到字体栈的切换点。如果切换点出现在带 `css-dev-only-do-not-override-*` 类名的 `div` 上，就是 antd 的 `<App>` wrapper。
3. 修复入口是 antd token 的 `fontFamily`，不要去 hack 带 hash 的 wrapper 类名 —— 该 hash 每次构建都变。

## 附录 B · 视觉断言的复核纪律

1. **溢出扫描必须先等真实内容**。`networkidle` 不等于渲染完成；骨架屏阶段做 `scrollWidth` 扫描必然全绿但无意义。先 `waitForSelector` 目标元素、断言元素数 > 0，再扫。
2. **截图误读要用 DOM 复核**。肉眼看截图得到的结论（"多了一项导航"之类）必须回到 DOM 确认。
3. **计算样式扫描是查品牌色残留的唯一可靠手段**。`grep` 只能查到静态 CSS，查不到 antd 运行时注入。

## 附录 C · 换字族暴露的布局缺陷

字体一旦换成更宽的字族，会放大此前被窄字族掩盖的布局缺陷。两类典型：

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| 卡片描述冲出卡片 | ① 覆盖层静态重述描述块样式，丢了 `white-space` / `overflow` / `text-overflow` 三件套；② 浏览器 UA 给 `<button>` 设了 `align-items: center`，column flex 子项因此不 stretch，按 min-content 定宽 | 删除覆盖层里与基座同值的重述；容器加 `align-items: stretch` + `min-width: 0` |
| 两列卡片 meta 折行把卡高撑高 | 两段 meta 各自换行 | 左段省略号截断，右段 `white-space: nowrap` |

这两类都不是字体问题本身，换回窄字族也照样溢出，只是不明显。

## 附录 D · 字体栈的声明与生效位置

字体栈有且只有两个声明点，两处必须一致：

| 位置 | 内容 | 覆盖范围 |
| --- | --- | --- |
| `global.css` 的 `body` | 同上字体栈 | body 自身 |
| `main.tsx` 的 `ANTD_THEME_TOKEN.fontFamily` | 同上字体栈 | antd 组件子树（全站 UI 的实际文本） |

只改其中一处会出现"部分区域字体不同"的诡异现象。改动字体栈时两处同改，并用附录 A 的方法复测实际渲染字体。
