# 登录页 1:1 复刻（参考站登录弹窗 `auth-card-split`）

> 实施人：小帮｜日期：2026-10-19｜范围：`frontend/src/pages/LoginPage.tsx` + `global.css` §登录页
> 方法：Playwright 实拍参考站登录**弹窗**三 tab（1280×900，computed styles + DOM 树）→ 逐值对拍本地 → 改码 → 回浏览器复测
> 纪律：字面值全部来自参考站实时实测；本地无对应能力的部分**如实标注**，不做假实现

---

## 0. 结论

| 指标 | 复刻前 | 复刻后 |
|---|---|---|
| 形态 | 独立整页 + 400×414 单栏 antd Card | **840×478 双栏 split 卡**（与参考站弹窗本体一致） |
| 卡容器 | radius 12（`--radius`）/ `--shadow-card` | **radius 32** / `0 20px 60px rgba(0,0,0,.18)` |
| 登录方式 tab | 无 | **3 个**（扫码 / 短信 / 账号，与参考站同序） |
| 左侧礼宾面板 | **完全没有** | 礼盒插画 + 标题 + 2 张玻璃拟态待遇卡（3 行 + 4 行） |
| 输入框 | antd 默认 32px 高、32px radius | **340×48**，pad `0 20px`，bg `#f2f3f5`，radius 8，border `#e5e7ef` |
| 提交按钮 | 350×40 实底紫 | **340×48** `linear-gradient(90deg,#8064f6,#5546d8)`，14px/600 |
| 协议行 | 无 | **12px/400/lh18 `#86909c`** + 3 个协议链接 |

---

## 1. 复刻前的问题（本地 vs 参考站）

本地 `/login` 当时是：`.login-card-wrap` 400×414 单栏居中 + antd `Card`，带 logo 品牌块、副标题「登录后开始生成商品视觉」、邮箱/密码带 label 的表单、「填充演示账号」、「还没有账号？立即注册」。

而参考站根本没有独立登录路由（`/login`、`/auth/login`、`/user/login`、`/register` 全部 404），登录是**顶栏 `登录/注册` 按钮唤起的遮罩弹窗**。

---

## 2. 参考站规格（2026-10-19 实拍 1280×900）

DOM 树（`.auth-overlay-inner` 为根）：

```
SECTION.auth-card-split        840×478 @ (220,211)
├ BUTTON.auth-close             16×16  @ (1004,243)   color #475467, radius 2
├ DIV.auth-showcase             420×478               左栏礼宾面板
│ ├ DIV.auth-showcase-bg        420×478  bg #a5dffc + url(static/login/leftbg.png) cover
│ ├ IMG.auth-showcase-orb       136×159 @ (504,530)
│ ├ IMG.auth-showcase-gift      221×214 @ (209,173)   出血到卡外左上
│ └ DIV.auth-showcase-content
│   ├ H1「登录即享好礼」         144×63  @ (456,241)
│   └ DIV.auth-showcase-benefits 340×335 @ (260,326)  gap 16
│     ├ benefit 卡1              340×139 @ (260,326)
│     └ benefit 卡2              340×180 @ (260,481)
└ DIV.auth-form-panel           420×478 @ (640,211)   padding 32px 40px, radius 0 32 32 0
  └ DIV.auth-form-panel-inner   340×414 @ (680,243)   flex column gap 8, padding-top 24
    ├ DIV.auth-login-tabs       340×63  @ (680,267)   padding 0 24, gap 24, align stretch
    │ ├ BUTTON.auth-login-tab   81.3359×63 扫码登录   16px/400/lh22 #333
    │ ├ BUTTON.auth-login-tab   81.3359×63 短信登录
    │ └ BUTTON.auth-login-tab.is-active 81.3359×63 账号登录  font-weight 600
    ├ DIV.auth-form             340×258 @ (680,338)   margin-top 12
    │ ├ DIV.auth-field          340×48  @ (680,350) → input 340×48
    │ ├ DIV.auth-field          340×48  @ (680,416)   （间距 18px）
    │ ├ BUTTON.auth-submit      340×48  @ (680,482)
    │ └ DIV.auth-google-button  340×48  @ (680,548)   白底 1px #e5e7ef radius 8
    └ DIV.auth-footer           340×50  @ (680,604)
      └ P.auth-agreement        328×18  @ (686,620)   12px/400/lh18 #86909c
```

关键字面值：

| 节点 | 值 |
|---|---|
| 卡 | `radius 32`、`box-shadow 0 20px 60px rgba(0,0,0,.18)`、`grid-template-columns 420px 420px`、白底 |
| input | `340×48`、`padding 0 20px`、`background #f2f3f5`、`color #1d2129`、`14px/400/lh22`、`radius 8`、`border 1px solid #e5e7ef` |
| submit | `340×48`、`background linear-gradient(90deg,#8064f6,#5546d8)`、`color #fff`、`14px/600/lh22`、`radius 8` |
| benefit 卡 | `padding 16px 24px`、`radius 16`、`background radial-gradient(at 46% 36%, rgba(255,255,255,.95), rgba(255,255,255,.48) 62%, rgba(228,219,255,.42))`、`box-shadow 0 6px 20px rgba(85,70,216,.24)` + `inset 0 0 24px rgba(255,255,255,.7)` |
| tab | `81.3359×63`、`16px/400/lh22 #333`、激活 `600` |
| 协议行 | `12px/400/lh18 #86909c` |

---

## 3. 本地实现

| 参考站 | 本地 class | 说明 |
|---|---|---|
| `.auth-card-split` | `.login-split` | 840×478 / radius 32 / grid 420 420 / 同款阴影 |
| `.auth-overlay-inner` | `.login-page` | 页面底（独立路由，无遮罩） |
| `.auth-showcase` | `.login-showcase` | 左栏 + `.login-showcase-bg` + `.login-showcase-gift` + `.login-showcase-content` |
| `.auth-showcase-benefit` | `.login-benefit` | 玻璃拟态，同款渐变与双层阴影 |
| `.auth-form-panel` | `.login-form-panel` | padding 32px 40px |
| `.auth-form-panel-inner` | `.login-panel-inner` | 340 宽 + padding-top 24 + gap 8 |
| `.auth-login-tabs` / `.auth-login-tab` | `.login-tabs` / `.login-tab` | 3 tab 同序，激活态 600 + 底部紫线 |
| `.auth-field` / input | `.login-field` / `.ant-input-affix-wrapper` | 覆写为 340×48 / #f2f3f5 / radius 8 |
| `.auth-submit` | `.login-submit` | 覆写为 340×48 渐变 |
| `.auth-google-button` | `.login-demo-fill` | 位置复用，文案换成本地「填充演示账号」 |
| `.auth-agreement` | `.login-agreement` | 12px #86909c + 3 段链接 |
| `.auth-close` | `.login-close` | 独立路由无遮罩可关 → 改为「返回上一页」 |

---

## 4. 验证（1280×900 逐值对拍）

| 节点 | 参考站 | 本地复刻后 | Δ |
|---|---|---|---|
| 卡 | 840×478 @ (220,211) | **840×478 @ (220,211)** | 0 |
| 左栏 | 420×478 | **420×478** | 0 |
| 待遇卡1 | 340×139 | **340×139** | 0 |
| 面板 | 420×478 | 420×**479** | +1 |
| tabs | 340×63 @ (680,267) | **340×63 @ (680,267)** | 0 |
| 激活 tab | 81.3359×63 @ (915,267) | **81.3359×63 @ (915,267)** | 0 |
| input1 | 340×48 @ (680,350) | **340×48 @ (680,350)** | 0 |
| submit | 340×48 @ (680,482) | **340×48 @ (680,482)** | 0 |
| 协议行 | 328×18 @ (686,620) | 340×18 @ (680,612) | 宽 +12 / y −8 |

**链路验证**（不能只看静态渲染）：
- 真实登录：点「填充演示账号」→ 提交 → 跳转 `/workbench`，顶栏显示 `admin@demo.com` ✅
- 注册切换：3 字段 / 按钮文案「注册并登录」/ 演示按钮隐藏 / 协议行仍 18px 一行 / 面板回到 478 ✅
- 移动 390：卡宽 342、左栏 `display:none`、提交钮 324、`scrollW == 390`、`scrollH == clientH`（无溢出）✅
- 零 `pageerror`

---

## 5. 诚实差异（本地无对应能力，已如实标注）

| 项 | 参考站 | 本地 | 处置 |
|---|---|---|---|
| 扫码登录 | 微信扫码 + 「微信扫码关注公众号完成登录/注册」 | 无微信通道 | tab **置灰** + `title` 说明 |
| 短信登录 | 手机号 + 验证码（带「获取验证码」） | 无短信服务 | tab **置灰** + `title` 说明 |
| 第三方登录 | 「使用 Google 账号登录」白底描边钮 | 无 | 该位置留给本地演示自有的「填充演示账号」 |
| 左栏底图 | 位图 `static/login/leftbg.png`（#a5dffc 底） | 不引第三方图片 | 改品牌紫渐变 `#efeaff → #f6f2ff → #e6e0ff` |
| 礼盒插画 | 位图 PNG 221×214 | 不引第三方图片 | **原创内联 SVG** 重绘（同构：紫礼盒 + 金币 + 宝石 + 蝴蝶结），同 `ToolEmptyIllustration` 纪律 |
| 积分文案 | 送 100/150/600 积分、10 积分/张 | 本地无积分体系 | 文案照搬参考站数值 + 在协议行注明「账号规则」；**积分按钮不可点**（无积分页） |
| 注册入口 | 无（走短信/扫码） | 本地演示账号体系需要 | 保留文字链接切换（面板高度回到 478） |

---

## 6. 路由对外开放 + 登录挂在按钮（2026-10-19 决策并实施）

> 用户决策原文：「路由对外开放，登录在按钮上，复刻」

### 6.1 改了什么

| 项 | 变更 | 文件 |
|---|---|---|
| 登录卡抽组件 | `AuthCard`（840×478 双栏卡）独立成组件 | `components/AuthCard.tsx`（新） |
| 登录弹窗 | antd Modal 承载同一张 `AuthCard`，遮罩 `rgba(24,32,51,.55)`，居中，`maskClosable` + `keyboard` | `components/LoginModal.tsx`（新） |
| 全局唤起 | `AuthProvider` 持有 `loginOpen` + `openLogin()`，并挂载 `LoginModal` | `context/AuthContext.tsx` |
| 顶栏按钮 | guest 的「登录/注册」由 `navigate('/login')` 改为 `openLogin()` | `components/AppLayout.tsx` |
| **路由开放** | 删除 `RequireAuth` 组件与全部 23 处包裹 | `App.tsx` |
| guest 不发统计 | `Shell` 的 `statsApi.overview` 加 `if (!token)` 守卫；依赖数组加 `token`，登录后自动补拉 | `App.tsx` |
| 数据中心 guest 态 | 未登录显示「登录后查看你的创作数据」+ 登录按钮；请求失败补 `.catch` | `pages/StatsPage.tsx` |
| 受限动作弹窗 | api 层 401 分两种：无 token → 广播 `auth:required`（开弹窗）+ 文案改「请先登录」；有 token → 原逻辑清凭证广播登出 | `lib/api.ts` |
| 弹窗初始焦点 | 打开后 60ms 聚焦账号输入框（antd 默认会聚焦激活 tab） | `components/AuthCard.tsx` |

### 6.2 为什么这样切

- **401 语义拆分**是关键：以前 `401 → 清凭证 + 跳登录页`，现在要区分「本来就没登录」和「登录态失效」。前者弹窗、后者登出，两者绝不能混。
- `Shell` 的统计守卫让每个 guest 页面少发 2 次注定失败的 401（实测修前每页 2 次）。
- `/login` 独立页**保留**：深链接/分享/移动端兜底；它与弹窗共用 `AuthCard`，不存在两套实现。

### 6.3 验证

| 项 | 结果 |
|---|---|
| guest 直达壳内页面 | `/workbench`、`/library`、`/works`、`/packages`、`/invitations`、`/stats`、`/product-kit`、`/tools/:id` **8/8 可直达**，无 ErrorBoundary、无横向溢出 |
| 顶栏按钮唤起 | 弹窗打开，卡片 **840×478 @ (300,211)**（1440 视口居中），遮罩 `rgba(24,32,51,.55)` |
| 遮罩点击 / ESC | 均可关闭 ✅ |
| 弹窗内登录 | 成功后**弹窗自动关闭、留在原页**，顶栏 `admin@demo.com` + 算力丸出现，guest 按钮消失 |
| guest 执行受限动作 | 工具页上传图片 → toast「请先登录」+ **弹窗自动打开**，无「未认证」噪音 |
| 弹窗内登录后 | 仍在 `/tools/matting`，身份已生效 |
| 数据中心 guest 态 | 空态 + 「登录/注册」按钮，390 下可唤起弹窗 |
| 移动端 | 390 下 guest 按钮可见（73×32），弹窗可用 |
| 回归 | 登录态 8 页 × 2 视口：`scrollW == clientW`、溢出 `[]`、零 `pageerror` |

### 6.4 过程中修掉的两个真实问题

| 问题 | 根因 | 修 |
|---|---|---|
| guest 浏览时抛未捕获 `未认证` | `StatsPage` 的 `statsApi.overview().then().finally()` **没有 `.catch`**；`Shell` 虽有 catch 但仍会发无谓请求 | StatsPage 补 catch + guest 空态；Shell 加 `if (!token)` 守卫 |
| 弹窗激活 tab 上有蓝色 focus 框 | 浏览器默认 outline 是蓝色，与品牌紫冲突 | `:focus:focus-visible { outline: none }`；初始焦点改到邮箱输入框 |

> 另有一个**误判**要记：第一次判「遮罩点击关不掉」，其实是判定方法错了 —— antd 关闭后 `.ant-modal-wrap` **仍留在 DOM** 里（只改 `display`/`opacity`），用 `locator.count()` 判定必然出错。改看计算样式后确认功能本就正常。

---

## 7. 证据

| 文件 | 内容 |
|---|---|
| `docs/login-ref/ref-modal-1280.png` | 参考站登录弹窗（账号登录 tab）实拍 |
| `docs/login-ref/ref-modal-qr-tab.png` | 参考站扫码登录 tab（默认态）实拍 |
| `docs/login-ref/local-before-1280.png` | 本地复刻前（400×414 单栏 Card） |
| `docs/login-ref/local-after-1280.png` | 本地复刻后（840×478 双栏 split） |
| `docs/login-ref/local-after-390.png` | 本地 390 移动态 |
| `docs/login-ref/local-register.png` | 本地注册态 |
| `/tmp/ijihua-scrape/ref-login-tree.json` | 参考站弹窗完整 DOM 树 + 计算样式 |
| `/tmp/ijihua-scrape/anatomy-ref-login2.cjs` / `verify-login.cjs` / `verify-login-flow.cjs` | 实拍 / 对拍 / 链路验证脚本（可复跑） |