# 登录与注册规格

登录不是独立页面独占的功能，而是一张可复用的双栏卡片：顶栏按钮唤起弹窗为主路径，`/login` 独立路由作为深链接与兜底。

| 项 | 值 |
| --- | --- |
| 卡片组件 | `frontend/src/components/AuthCard.tsx` |
| 弹窗宿主 | `frontend/src/components/LoginModal.tsx` |
| 独立页宿主 | `frontend/src/pages/LoginPage.tsx`（`/login`） |
| 第三方回调页 | `frontend/src/pages/OAuthCallbackPage.tsx`（`/auth/oauth/callback`） |
| 全局唤起 | `context/AuthContext.tsx` 的 `loginOpen` + `openLogin()` |
| 扫码面板 | `frontend/src/components/QrLoginPanel.tsx` |
| 样式 | `frontend/src/styles/global.css` 的 `.login-*` 区块 |

同一张卡两个宿主，不存在两套实现。

## 1. 卡片结构

840×478 双栏 split，`grid-template-columns: 420px 420px`，radius 32，`box-shadow: 0 20px 60px rgba(0,0,0,.18)`。

```
.login-split                      840×478，radius 32
├── 左侧礼宾面板 .login-showcase   420×478
│   ├── .login-showcase-bg         品牌紫渐变（#efeaff → #f6f2ff → #e6e0ff）
│   ├── .login-showcase-gift       原创内联 SVG（紫礼盒 + 金币 + 宝石 + 蝴蝶结）
│   ├── 标题「登录即享好礼」
│   └── .login-showcase-benefits   两张玻璃拟态待遇卡（340 宽，gap 16）
└── 右侧表单面板 .login-form-panel  420×478，padding 32px 40px，radius 0 32 32 0
    └── .login-panel-inner         340 宽，flex column gap 8，padding-top 24
        ├── .login-tabs            3 tab：扫码登录 / 短信登录 / 账号登录
        ├── .login-form            输入项 + 提交 + 次级入口
        └── .login-agreement       协议行
```

## 2. 关键规格

| 节点 | 值 |
| --- | --- |
| 卡片 | 840×478，radius 32，`box-shadow: 0 20px 60px rgba(0,0,0,.18)`，白底 |
| 左栏 | 420×478，圆角左侧 32 |
| 待遇卡 | `padding: 16px 24px`，radius 16，`background: radial-gradient(at 46% 36%, rgba(255,255,255,.95), rgba(255,255,255,.48) 62%, rgba(228,219,255,.42))`，`box-shadow: 0 6px 20px rgba(85,70,216,.24), inset 0 0 24px rgba(255,255,255,.7)` |
| 表单面板 | 420×478，`padding: 32px 40px`，圆角右侧 32 |
| 内层宽 | 340 |
| tab | 高 63，16px / 400 / 行高 22 / `#333`；激活态 600 + 底部紫线 |
| 输入框 | 340×48，`padding: 0 20px`，底 `#f2f3f5`，字 `#1d2129` 14px / 400，radius 8，边框 `1px solid #e5e7ef` |
| 提交按钮 | 340×48，`linear-gradient(90deg, #8064f6, #5546d8)`，白字 14px / 600，radius 8 |
| 第三方登录区 | `.login-oauth`：表单下方 `margin-top 14`，竖排 `gap 8`；「或」分隔 12px `#86909c`；按钮 340×44、白底、`1px solid #e5e7ef`、radius 8，hover 转品牌紫 |
| 协议行 | 12px / 400 / 行高 18 / `#86909c` |
| 关闭按钮 | `.login-close`：弹窗内关闭弹窗；独立页改为「返回上一页」 |

## 3. 登录方式

三个 tab 与一组第三方按钮。第三方按钮不属于任何 tab，渲染在表单下方，切 tab 不消失。

| tab / 区域 | 实现 | 说明 |
| --- | --- | --- |
| 扫码登录 | `QrLoginPanel` → `POST /auth/qr/create` + 轮询 `/auth/qr/status` | 自有二维码通道，不依赖第三方开放平台。桌面建码，手机（已登录）扫码确认，桌面轮询换 JWT；票据 120 秒有效、只存 SHA-256、兑换一次性 |
| 短信登录 | `POST /auth/sms/send` + `POST /auth/sms/login` | 验证码倒计时 60 秒，与后端「1 条 / 分钟」限流口径一致 |
| 账号登录 | `POST /auth/login` | 邮箱 + 密码；附「忘记密码」入口到 `/forgot-password` |
| 第三方登录 | `GET /auth/oauth/providers` 列出可用项 → 浏览器跳 `/auth/oauth/:provider/authorize`；回调落到 `/auth/oauth/callback` 用短时票据换会话 | 内置 Google / GitHub，另有 generic 接任意标准 OAuth2 / OIDC。**按钮完全由后端返回的已启用列表决定**：留空即整块不渲染，前端不维护 provider 名单 |

第三方登录的实现约束：

- 凭据「四项齐全 + 未被 `OAUTH_ENABLED` 排除」才启用；缺任一项 `40402`，登录页自然看不到按钮。
- `state` 绑定 provider、10 分钟过期；回调校验失败 `40004`。
- 只有 provider 确权（`emailVerified`）的邮箱才自动绑定同邮箱的已有账号；账号非 `active` 时 `40302` 拒绝；否则新建本地账号（`passwordHash` 为空，不能走密码登录）。
- `accessToken` 不放进回调 URL：后端 302 回前端只带 60 秒票据，`OAuthCallbackPage` 用它换正式会话，失败给可读原因与「返回登录」。
- 回跳目标只接受站内绝对路径，`//evil.com` 这类开放重定向写法一律丢弃，回落到 `/workbench`。

注册态在账号 tab 内以文字链接切换（`register`），字段为邮箱 + 密码 + 昵称（+ 可选手机号与验证码），提交按钮文案「注册并登录」，`POST /auth/register` 直接返回 `accessToken`（注册即登录）。注册必须勾选协议。

**权益文案必须与后端一致**，不得出现未兑现的承诺：

- 注册**不发积分**，文案为「注册即可使用」；
- 签到基础每日 5 积分起；
- 邀请为邀请人 200 / 被邀请人 100，且被邀请人首次付费才触发；
- 生图按能力计费，抠图与去水印为 0。

左栏不引用任何第三方图片资源：底图为 CSS 渐变，礼盒为内联 SVG。

## 4. 唤起与路由

| 触发 | 行为 |
| --- | --- |
| 顶栏「登录 / 注册」 | `openLogin()` 打开 antd `Modal` 承载 `AuthCard`，遮罩 `rgba(24,32,51,.55)`，居中，`maskClosable` + `keyboard` 可关 |
| 未登录访问受限动作 | `lib/api.ts` 收到 401 且**本地无 token** → 广播 `auth:required`，开弹窗，文案「请先登录」 |
| 登录态失效 | 401 且**本地有 token** → 清凭证并广播登出，不弹窗 |
| `/login` 深链接 | 渲染独立页版本的同一张卡 |
| `/auth/oauth/callback` | 第三方回调落地页，不经过 `AppLayout`；带 `ticket` 换会话后跳回发起页，带 `error` 或票据无效时显示失败原因与「返回登录」 |

`401` 的两种语义**不能混**：本来没登录和登录态失效是两条路径，前者弹窗、后者登出。

弹窗打开后聚焦账号输入框（延迟约 60ms），避免 antd 默认聚焦激活 tab 时的蓝色 outline 与品牌紫冲突。

登录成功后弹窗自动关闭并留在原页面，页面随后自行刷新数据（`AuthContext` 的 `token` 变化会驱动依赖它的请求）。

## 5. 游客态的连带约束

- 路由对外公开，未登录可浏览壳内页面；需要身份的动作唤起弹窗。
- `Shell` 层的 `statsApi.overview` 必须带 `if (!token)` 守卫，登录后才发起；否则每个游客页面都会打出注定 401 的请求。
- 数据中心游客态渲染「登录后查看你的创作数据」+ 登录按钮，请求失败要有 `.catch`，不能让未处理的 rejection 冒到全局。

## 6. 移动端

≤900px：左栏 `display:none`，卡片退化为单栏（宽 342），输入与提交钮按 324 宽重排，页面无横向溢出。

## 7. 实现约束

1. 卡片只有 `AuthCard` 一处实现，两个宿主都渲染它；不要在 `/login` 另写一套表单。
2. 表单提交态、错误提示、倒计时都走 antd `Form` / `App.useApp().message`，不自绘。
3. 协议勾选是注册的必要条件，法务链接指向 `/legal/*` 的真实 slug（见 `legal.service.ts` 的 `LEGAL_SLUGS`）。
4. 不要在登录卡里硬编码任何账号密码，也不提供「填充演示账号」入口。

## 8. 验证

| 项 | 覆盖 |
| --- | --- |
| 弹窗唤起 | 顶栏按钮 → 弹窗、遮罩、ESC 关闭 |
| 登录链路 | 账号登录成功后弹窗关闭、顶栏出现算力胶囊与用户菜单 |
| 扫码链路 | `smoke-qr-login.js`：扫码≠授权、一次性兑换、过期、登录审计 |
| 短信链路 | `smoke-rate-limit.js`：1 条 / 分钟 |
| 第三方登录 | 无自动化用例：需要真实 provider 凭据与可公网访问的回调地址（见 `docs/testing.md` §5.3） |
| 游客态 | `free-creation-submit.spec.ts`：登录墙 + 游客不触发只读接口的 401 |
| 注册 | `smoke-auth.js`：昵称必填、注册即登录 |
