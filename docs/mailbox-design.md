# 邮箱模块设计（`/mailbox`）

> **状态：规划中，未实施。** 本文是评审用设计文档，不是现状描述。获批后方可进入编码。
> 事实源：`backend/src`、`frontend/src`、`backend/prisma/schema.prisma`。文档与代码冲突时以代码为准。
> 本轮只新增本文件，**未改动任何既有文件、未运行任何构建或测试**。

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 需求口径 | 用户要求「新建独立邮箱模块」。但全仓 41 份 md 从未出现「邮箱功能 / 邮件中心 / 收件箱」词组；项目内「邮箱」固定指登录标识 `User.email`，「邮件」指 `EmailService` 发出的交易/验证通知，「消息」指站内 `Notification`，三者被 `backend/prisma/schema.prisma:1435-1438` 的注释明确定义为**并行通道，不是替代**。因此这是一条外部新需求，不是补齐既有 TODO。 |
| 现状 | 发信通道已完整（3 种 provider）、业务场景仅 3 类、站内消息中心已实现；**但生产档 `EMAIL_API_URL/KEY` 为空，`status().delivers=false`，真实投递尚未接通**；`MessageTemplate` 的 `email` 通道是半实现（`notify()` 只查 `inapp`）。 |
| 最大风险 | 「独立邮箱模块」存在两条语义完全不同的路线：**站内邮件中心**（不接外部协议）与**真 Webmail**（接 IMAP/SMTP 或自建邮件服务器）。后者与既有 ADR「刻意不手写 SMTP」（`docs/environments.md:201`）**直接冲突**，并同时踩中合规许可、25 端口封禁、AGPL 传染性、不可信 HTML 渲染、SQLite 存储五重成本。**此项必须由需求方裁定，本文不代为决定。** |
| 推荐落地形态 | **方案 C：站内邮件中心 + 预留只读 `MailSourceAdapter`**。v1 不接任何外部邮件协议、不提供对外发信，只把「平台发出的每封邮件」与「站内消息」在一个独立页面统一呈现。零新增 npm 依赖、零既有接口契约变更、无新增运维面。 |
| 实施前置 | `EMAIL_API_URL` / `EMAIL_API_KEY` 配齐且 `EmailService.status().delivers === true`。否则归档里全是 `local` / `failed`，模块价值打折。 |
| 待裁定项 | 8 项，见 §9。**D1（是否接外部协议）为阻断项**，未裁定不得进入实施。 |

---

## 1. 现状与硬约束

### 1.1 已存在的实现（代码事实）

| 能力 | 位置 | 事实 |
|---|---|---|
| 发信门面 | `backend/src/channels/email/email.service.ts:33-99` | 按 `EMAIL_PROVIDER` 选 `console` / `http` / `aliyun`；`status()` 暴露 `provider / delivers / from / configured` |
| 发信契约 | `backend/src/channels/channel.types.ts:19-45` | `MessageProvider<M>` 只有 `send()`；`DeliveryResult` 含 `ok / provider / delivered / messageId? / error?`；`EmailMessage` 只有 `to / subject / text / html?` |
| 吞异常保证 | `email.service.ts:101-131` | 通道异常绝不上抛，避免「发信失败」变成账号存在性探测信号；生产档 `misconfigured` 时直接返回 `ok:false` |
| 三类真实调用 | `auth.service.ts:238-270`（找密）、`auth.service.ts:334-365`（邮箱验证码）、`invoices.service.ts:408-427`（发票开具） | 全仓 `EmailService` 仅此 3 个业务调用点，无第四类 |
| PII 最小化 | `email.service.ts:133-138` | 明确注释「邮件会在客户端长期留存，任何 PII 都可能在日后被翻出来」；正文只放一次性链接 |
| 站内消息 | `schema.prisma:1435-1456`、`notifications.service.ts:70-95` | `Notification(type/title/body/link/readAt/createdAt)`；`notify()` 查 `channel:'inapp'` 模板、吞异常 |
| 消息模板 | `schema.prisma:1458-1476` | `MessageTemplate.channel` 允许 `inapp｜email｜sms`，但种子 5 条全为 `inapp`，`email` 通道未接线 |
| 通道只读展示 | `admin/notifications.controller.ts:75-97`、`docs/admin-suite-design.md:203` | 后台对邮件/短信通道**只读展示生效实现，无写入端点** |
| C 端接口 | `notifications.controller.ts:28-50` | `GET /notifications`、`POST /:id/read`、`POST /read-all`；全部 `JwtAuthGuard` + service 层 `userId` 过滤 |
| 保留期清理 | `admin/retention.controller.ts:10-53`、`admin/backup.service.ts` | `TARGETS` 白名单 + `defaultDays` 下限 + `CleanupLog` 留痕，`cleanupExpired` 手动与调度共用一条路径 |
| 权限点 | `admin/permissions.ts:131` | 消息域只有 `messageWrite: "message.write"`，**没有** `message.read` |

### 1.2 口径陷阱

`docs/prd.md:152` 把「S-08 邮箱验证码（注册场景）」标为**规划**，而代码已实现（`auth.service.ts:334`）。这是文档滞后。若需求方是照 PRD 提的「邮箱功能」，该项实际已完成。本设计不把它当作待办，仅在实施阶段顺手修正文档状态（见 §9 D8）。

### 1.3 必须遵守的硬约束

| 编号 | 约束 | 依据 |
|---|---|---|
| C1 | **零新增 npm 依赖**，版本精确锁定 | `CLAUDE.md:88,390-397`、`channel.types.ts:6`；新增依赖后须跑 `npm run verify:deps:critical` |
| C2 | 不手写 SMTP，邮件只走服务商 HTTP API | `docs/environments.md:201`（既有 ADR） |
| C3 | 统一响应信封 `{ code: 0, data, message }`，错误码是唯一事实源 | `docs/api-contract.md:5-10` |
| C4 | 分页沿用 `limit / offset + total`，不引入 cursor 新范式 | `orders/order.service.ts:568`、`payment-reconciliation.service.ts:290-320`、`notifications.service.ts:98-107` |
| C5 | C 端接口 `JwtAuthGuard` + service 层按 `userId` 过滤，越权在 SQL 层不可能发生 | `notifications.controller.ts:22-27` |
| C6 | 副作用（通知/归档）失败**不得阻断主流程**，吞异常只记日志 | `notifications.service.ts:11-15,67-95`、`invoices.service.ts:408` |
| C7 | 前端多文件目录严格分层：`index/page/components/api/hooks/utils/constants/style.css` + `PascalCase.tsx`，`./X` 单向导入 | `docs/frontend-module-conventions.md:45-123` |
| C8 | 页面 CSS 不写裸 hex、不新增 `:root`，色值只进 `styles/tokens.css` | `docs/design-tokens.md:33,54,61` |
| C9 | 文档命名 kebab-case + `-design` 后缀；规划文档首行标「规划中」；新建文档须同批更新索引与全仓引用 | `docs/README.md:96-124` |
| C10 | 「跑」= 执行闸口/构建/测试且需授权；「改」须获批；未授权不 build、不跑测试 | `CLAUDE.md:406-410`、`docs/development-workflow.md:22-31` |

---

## 2. 产品定义

### 2.1 用户与问题

| 角色 | 场景 | 现状痛点 |
|---|---|---|
| C 端用户 | 「我三个月前开的发票，邮件找不到了」「密码重置邮件没收到」「平台到底给我发过什么」 | 邮件只存在于用户自己的外部邮箱，平台侧**零留痕**；站内 `Notification` 只覆盖 `inapp` 事件，两类记录分散在账号页小卡片与顶栏铃铛里，无法按时间/类型检索 |
| 客服 / 运营 | 工单「我没收到通知」 | 无法回答「是否发过、走的哪个通道、投递成功还是回落 console、失败原因」；`logs/outbox/*.log` 不是可查询界面 |

核心问题陈述：**平台缺少一份「与用户之间往来记录」的可检索事实源**。

### 2.2 目标

1. 在 `/mailbox` 提供独立页面，按时间倒序统一呈现「平台发出的邮件」与「站内消息」，支持按通道、类别、未读、时间、关键词筛选。
2. 每次发信都留下结构化归档：收件掩码、主题、类别、通道、投递结果、provider、消息号、脱敏失败原因。
3. 客服可在后台按用户检索投递记录（P2），直接解释「没收到」的原因。
4. 为未来接入外部邮件源预留只读适配器接口，但不改变 v1 的合规边界。

### 2.3 不做什么（v1 范围边界）

| 不做 | 理由 |
|---|---|
| 不接收 / 不解析外部邮件，不接 IMAP / POP3 / JMAP / SMTP | 见 §3、§8；与 C2 冲突 |
| **不提供回复、转发、撰写、对外发信** | 一旦可对外发信，可能重新落入《互联网电子邮件服务管理办法》第 2 条适用范围（§8.1） |
| 不建文件夹树、标签体系、拖拽归类 | `Notification` 无此语义；用户心智是「查记录」不是「管邮箱」（§4.4） |
| 不建独立附件表、不做附件上传/预览 | 现有三类邮件均无附件；发票 PDF 走 `/invoices/:id/file`，用 `link` 跳转即可 |
| 不引入 AI 摘要 / 自然语言搜索 / 定时发送 / 稍后处理 | 差异化特性，非及格线；禁止过度施工 |
| 不改 `MessageTemplate` 的 `email` 通道接线 | 那是「后台配模板 → 触发发信」的独立议题，与「归档已发出的邮件」正交；混做会放大 diff |
| 不新增权限点、不新增环境变量 | 复用 `message.write` 与 `retentionDays`；最小 diff |

### 2.4 名词定义

| 词 | 本文含义 |
|---|---|
| 邮件 | 平台通过 `EmailService` 发出的 outbound 消息，归档为 `MailMessage` |
| 站内消息 | 现有 `Notification`，**不迁移、不改造、不改接口** |
| 统一消息 | 后端归并出的只读视图 `UnifiedMessage`，前端唯一的列表数据形态 |
| 邮箱模块 | `/mailbox` 页面 + `/api/v1/mailbox/*` 接口 + `MailMessage` 表；**不是邮件服务器，不是 Webmail 客户端** |

---

## 3. 方案选型与 ADR

### 3.1 三条路线

| 维度 | 方案 A：站内邮件中心 | 方案 B：真 Webmail | 方案 C：A + 只读 adapter（推荐） |
|---|---|---|---|
| 能力 | 归档平台发出的邮件 + 归并站内消息，只读 | 平台内收发任意外部邮件，完整邮箱心智 | 同 A，另外定义 `MailSourceAdapter` 只读接口，v1 只注册 `LocalArchiveAdapter` |
| 新增服务 / 端口 / DNS | 无 | 邮件服务器常驻 + 25/465/587 + MX + SPF/DKIM/DMARC + TLS 证书 | 无 |
| 新增依赖 | 0 | Stalwart/mailcow（独立进程）或 `imapflow`(~22 依赖) + `postal-mime` + `DOMPurify` + `jsdom` | 0 |
| 存储适配 | `MailMessage` 一张 SQLite 表 | SQLite 单文件不适合邮件主存（并发写、FTS、Blob），需第二套存储 | 同 A |
| 不可信 HTML | 不涉及（正文为平台自产模板） | 必须四层防御（§7.3） | v1 不涉及，渲染层收敛到单一组件便于启用 |
| 合规 | PIPL + 隐私政策更新 | 触发办法第 4/6/7/10/13–16 条全套 + 25 端口封禁 + 反垃圾运营体系 | 同 A |
| 与 C2「不手写 SMTP」 | 一致 | **直接冲突** | 一致（adapter 只读，不碰发信链路） |
| 可逆性 | 高 | 低（数据与合规承诺难回收） | 高 |

### 3.2 决策矩阵（关键事实）

| 事实 | 结论 |
|---|---|
| 大陆云默认封禁 TCP 25 出站（阿里云 `help.aliyun.com/document_detail/56130.html`、腾讯云 `tencentcloud.com/zh/document/product/213/34833`），解封仅允许「连接第三方 SMTP 服务器」，禁止本机直发 | 自建 MTA 走 25 基本不可行，这正是 C2 的现实依据 |
| Stalwart 是协议最现代（JMAP/IMAP/SMTP + 内置 DKIM/SPF/DMARC）的候选，但 Community 版为 **AGPL-3.0**（`github.com/stalwartlabs/mail-server`），§13 网络使用条款对 SaaS 有传染风险；官方自家 webmail 仍在开发 | 商业用途需法务评估或购 Enterprise 许可 |
| Roundcube / Cypht / SOGo 均为独立 PHP 应用，**无法嵌入 React 19 SPA**；RainLoop 仓库已归档；JMAP 生态无生产级可嵌入前端 | 「复用开源 Webmail」这条路不成立 |
| **生产档 `EMAIL_API_URL/KEY` 仍为空，仓库无真实 `.env.production`** | 发信都没上线时讨论收信明显超前 |

**结论标签：推荐方案 C，但 D1 需需求方裁定。** 若裁定方案 B，本文 §5–§7 的实施设计整体作废，须另立项目（增量清单见 §3.4）。

### 3.3 ADR：与既有决策的一致性

- 既有决策：`docs/environments.md:201`「刻意不手写 SMTP：TLS 分片与认证流程的自研实现风险高于收益，邮件走服务商 HTTP API」。支撑事实：`ENV_SPECS` 只允许 `console/http/aliyun`、`EmailProvider` 是单向 `send()`、后台通道只读。
- 方案 C 不触碰 `EMAIL_PROVIDER` 发信链路，只在 `send()` 内**旁路记录投递结果**，并预留只读 `MailSourceAdapter`（`listThreads / getMessage / search`）。该接口 v1 不实现任何外部协议实现，与 `backend/src/payments/adapters/types.ts` 的适配器模式同构。
- 需区分：使用 `nodemailer` / `imapflow` 这类成熟库不等于「手写 SMTP 协议」，但仍重新引入「平台自身持有 SMTP/IMAP 长连接与凭据」这一被刻意规避的架构面。若未来必须做，唯一不推翻 ADR 的形态是「外部托管邮件服务 + 其 JMAP/REST API」，且须**显式修订本 ADR**。

### 3.4 若 D1 裁定方案 B：增量清单（不在本文展开）

额外需要：邮件服务器选型与许可评估（Stalwart AGPL vs Enterprise）、域名/MX/SPF/DKIM/DMARC/FCrDNS、465 submission 或第三方 ESP、RFC822 解析与 MIME 深度限制、附件对象存储、文件夹/标签/线程三套模型、全文检索、不可信 HTML 四层防御、账号凭据加密托管、退信/投诉/退订/频控运营体系、办法第 4/6/7/10 条合规动作、第二套存储选型、隐私政策与跨境评估。这是独立项目量级。

---

## 4. 信息架构与 UX

### 4.1 路由与入口

| 项 | 设计 |
|---|---|
| 主路由 | `/mailbox`，走 C 端 `AppLayout` 外壳，需登录（未登录唤起登录弹窗，与全站「需要身份的动作唤起登录」一致，`App.tsx:16-21`） |
| 路由注册 | `App.tsx` 增加 `lazyRoute('/mailbox', ...)` + `<Route>`，并把 `mailbox` 加入 `capabilityIndependent` 正则（`App.tsx:163-166`）——邮箱页不依赖能力清单，清单接口挂了不能让它白屏 |
| 入口 | 顶栏铃铛增加「查看全部」跳 `/mailbox`；`AccountMessagesCard` 增加深链（P1，均为最小改动） |

### 4.2 页面骨架

复用 `frontend/src/pages/tickets/page.tsx` 的**列表 + 详情同页**范式（该页已解决移动端适配、`useSearchParams` URL 同步、`PersonalPage` / `StateEmpty` / `StateError` / `StateSkeleton` 状态组件复用）：

```
┌──────────────────────────────────────────────────────────────┐
│ 我的邮箱    [搜索框]  [全部|邮件|站内消息]  [未读] [时间范围]  │  ← MailboxFilters
├──────────────┬───────────────────────┬───────────────────────┤
│ 视图筛选      │ 消息列表（20/页）       │ 阅读窗格               │
│ 全部 / 邮件   │ [批量选择] [全部已读]    │ 主题 / 时间 / 通道     │
│ 安全 / 账单   │ ┌ 卡片：类别图标        │ 投递状态               │
│ 系统 / 站内   │ │ 主题 · 摘要 · 时间     │ 正文快照（或折叠提示）  │
│ 未读 N        │ │ 未读圆点 / 星标       │ [前往业务页面]          │
│              │ └──────────────────── │                       │
│              │  1-20 of 137  [上一页][下一页]                  │
└──────────────┴───────────────────────┴───────────────────────┘
```

- 桌面：左筛选（200px）+ 中列表（min 360px）+ 右阅读窗格；移动端折叠为「列表 → 点击进详情 → 返回」，与 `tickets/` 同一套布局，不写第二份移动适配。
- 阅读窗格位置不做可配置项（竞品有，但本页更接近「消息记录」而非「邮件客户端」，配置项属过度施工，列为 D6 范围裁定）。

### 4.3 交互清单

| 交互 | v1 | 说明 |
|---|---|---|
| 未读态 + 未读计数 | 做 | 铃铛数字与列表同源；读详情自动标已读（可配，默认开） |
| 批量多选 + 全部已读 | 做 | 写操作按 `source` 分派（§5.4），不做批量删除 |
| 星标 | 仅邮件 | `Notification` 无该字段，**不迁移既有表**；站内消息卡片不显示星标 |
| 归档 / 删除 | 不做 | 归档由保留期任务统一处理，用户不手工删（避免「删了就没法举证」） |
| 搜索 | 做 | 服务端 `q` 匹配 `subject` / `bodyText` 前 2000 字；不支持 Gmail 式运算符 |
| 筛选 | 做 | `channel` / `category` / `unreadOnly` / `starredOnly` / `from` / `to`；**当前生效筛选必须有可见提示**（Outlook 官方把「筛选成只看未读导致回复后消息消失」列为常见困惑，`learn.microsoft.com/en-sg/answers/questions/5785451`） |
| 分页 | 做 | `limit/offset + total`，默认 20，上限 100；显式页码与总数，不做无限滚动 |
| 会话聚合 | 不做列表分组 | `threadKey` 只作为详情里的「相关往来」锚点。理由：平台邮件是事件不是往返会话，按 subject 硬凑 `【货觉AI】发票已开具 …` 会造假线程（Gmail 官方亦确认负向搜索 + 会话视图会按会话误命中） |
| 快捷键 | 不做 | 非高频页面 |
| 空态 / 错误态 / 骨架 | 做 | 复用 `StateEmpty` / `StateError` / `StateSkeleton` |
| 无障碍 | 做 | 列表 `role="list"`，卡片键盘可达，未读/筛选 `aria-live`，图标 `aria-hidden` |

### 4.4 相对竞品通行范式的偏差清单

| 通行范式 | 本设计 | 理由 |
|---|---|---|
| 游标分页（调研建议） | `limit/offset + total` | **C4 项目既有约定优先**；SQLite 单库单用户消息量小，深分页不是瓶颈；引入 cursor 会让「跳到第 N 页」不可实现却增加前端复杂度 |
| 无限滚动 | 显式分页 | Gmail 官方就是分页（默认 50/页，可选 10–100），不支持无限滚动（`support.google.com/mail/answer/9259955`） |
| 文件夹树 / 标签 | 扁平视图 + 筛选 | 用户心智是「查记录」；HEY 用 Imbox/Feed/Paper Trail 分流、Outlook 用 Focused/Other 均证明「筛选替代深层树」可行 |
| 按 subject 聚合会话 | 按业务对象 `threadKey` 聚合，不体现在列表 | 见 §4.3 |
| 阅读窗格位置可配 / AI 摘要 / Snooze | 不做 | 非及格线，禁止过度施工 |

### 4.5 视觉规范

- 只用 `styles/tokens.css` 已有语义令牌；新增页面专属类统一前缀 `mailbox-*`，写入 `pages/mailbox/style.css`（C7/C8）。
- 状态色（未读 / 投递失败 / 已归档）若需新增，按 `docs/design-tokens.md:61` 走「先申请前缀 → 追加到 `tokens.css` 3.x 段 → 附 AA 对比度说明」，不在页面 CSS 写裸 hex。
- 图标沿用 `lucide-react`（C 端已在用，`tickets/page.tsx:3`），不新增图标库。

---

## 5. 技术设计

### 5.1 总体链路

```
业务调用(auth / invoices)
   │  EmailMessage { to, subject, text, html, context? }
   ▼
EmailService.send()  ──►  provider(console | http | aliyun)  ──►  DeliveryResult
   │                                                              │
   └── finally: MailArchiveService.record(message, result)  ◄──────┘
                    │  吞异常、只 WARN、绝不改变 result
                    ▼
              MailMessage（新表，邮件归档事实源）

Notification（既有，不改动） ─────────┐
                                     ▼
              MailboxService.list() 内存归并 → UnifiedMessage
                                     ▼
              GET /api/v1/mailbox/messages → /mailbox 页面
```

关键：**归档是 `send()` 的旁路，不是事务的一部分**（C6）。投递成功与否都要留痕，因为客服最需要的恰恰是 `delivered:false` 的记录。

### 5.2 数据模型

新增一张表；`Notification` 与 `MessageTemplate` **保持原样**。

```prisma
/// 邮件投递归档 —— /mailbox 的事实源。
/// 只记录「平台发出的邮件」，不接收外部邮件；与 Notification 并行，不是替代。
/// 收件地址只存掩码：完整地址可由 userId 关联 User.email 反查。
model MailMessage {
  id                 String    @id @default(cuid())
  userId             String?
  /// maskEmail() 结果，如 ab***@example.com
  toMasked           String
  subject            String
  /// security | invoice | system | marketing
  category           String
  /// 业务对象聚合键，如 invoice:{id} / order:{orderNo} / auth:password_reset
  threadKey          String?
  /// 站内相对路径，如 /orders、/invoices
  link               String?
  /// sent | failed | local（console 回落）| suppressed（生产 misconfigured 拒绝投递）
  deliveryStatus     String
  provider           String
  providerMessageId  String?
  /// 已脱敏失败原因，不含凭据与正文
  error              String?
  /// 正文快照：security 类恒为 null；其余截断 2000 字并剥离一次性 token
  bodyText           String?
  bodyHtml           String?
  /// 正文快照到期后置空（不删整行，保留「发过这封信」的事实）
  bodyExpiresAt      DateTime?
  readAt             DateTime?
  starredAt          DateTime?
  sentAt             DateTime  @default(now())
  createdAt          DateTime  @default(now())

  user User? @relation(fields: [userId], references: [id])

  @@index([userId, sentAt])
  @@index([userId, category, sentAt])
  @@index([userId, readAt])
  @@index([threadKey])
  @@index([sentAt])
}
```

`User` 增加反向关系 `mailMessages MailMessage[]`（`schema.prisma:38-50` 关系区）。SQLite 无 enum，`category` / `deliveryStatus` 取值由 DTO + service 白名单约束，与 `schema.prisma:2-3` 全库约定一致。

**设计取舍说明**

| 决策 | 理由 |
|---|---|
| 不把 `Notification` 迁进 `MailMessage` | 会造成双写一致性风险，且 `/notifications` 三个既有接口契约必须变更，违反最小 diff |
| 不建统一物理表 | 同上；改用后端只读归并视图（§5.4），前端只见一种数据形态 |
| `userId` 可空 | 发票接收邮箱可能 ≠ 账号邮箱（`schema.prisma:1330-1331`）；此时只留掩码，见 D4 |
| 单独 `bodyExpiresAt` | PIPL 第 19 条「保存期限为实现目的所必要的最短时间」；正文（含金额/发票号）比元数据敏感，先失效正文再删整行 |

### 5.3 发信契约扩展（向后兼容）

`backend/src/channels/channel.types.ts` 增加可选字段，**不改变 `send()` 的返回契约**：

```ts
export interface EmailMessageContext {
  userId?: string;
  category: 'security' | 'invoice' | 'system' | 'marketing';
  threadKey?: string;
  link?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** 归档上下文；不传则只投递不归档（保留通道的通用性） */
  context?: EmailMessageContext;
}
```

三个调用点补 `context`：

| 调用点 | category | threadKey | link | 正文快照 |
|---|---|---|---|---|
| `auth.service.ts:238-270` 找密 | `security` | `auth:password_reset` | `/reset-password` | **不落**（含一次性 token） |
| `auth.service.ts:334-365` 验证码 | `security` | `auth:email_verify` | `/account` | **不落**（含 6 位码） |
| `invoices.service.ts:408-427` 发票 | `invoice` | `invoice:{invoice.id}` | `/orders` | 落脱敏快照（剥离 URL token、截断 2000） |

`EmailService.send()` 内新增 `finally` 归档；注入 `MailArchiveService`（依赖 `PrismaService`，无循环依赖）。归档失败只 `logger.warn`，`result` 原样返回。所有未来新增的发信点，只要传 `context` 就自动进入邮箱模块。

> 安全要点：**验证码与重置链接绝不进入归档正文**。否则站内邮箱等于给一次性凭据又开了一份长期可检索副本，会放大账号接管风险。详情页对 `security` 类只展示「已发送 / 投递状态 / 时间」+ 折叠说明。

### 5.4 统一读模型与归并算法

`MailboxService.list()` 返回：

```ts
interface UnifiedMessage {
  id: string;                 // 带前缀 'mail:' | 'inapp:'，用于写操作分派
  source: 'mail' | 'inapp';
  sourceId: string;
  channel: 'email' | 'inapp';
  category: string;
  subject: string;
  preview: string;            // ≤120 字，已脱敏
  link: string | null;
  readAt: string | null;
  starredAt: string | null;   // 仅 mail
  deliveryStatus: string | null; // 仅 mail
  threadKey: string | null;
  sentAt: string;             // ISO
}
```

归并算法（明确写出，避免实现时自由发挥）：

1. 两路分别按 `userId` + 同口径筛选查询，`orderBy sentAt/createdAt desc`，`take = min(offset + limit, CAP)`。
2. 内存归并（稳定排序；同一时间戳按 `id` 降序），`slice(offset, offset + limit)`。
3. `total = count(MailMessage) + count(Notification)`，两路各自 count。
4. `CAP = 1000`；`offset + limit > CAP` 抛 `AppError(40001, '查询范围过大，请缩小时间范围')`。
5. `bodyText` 只在 `GET /:id` 详情返回，列表只给 `preview`，避免整页传输正文。

**已知边界（须写进实现注释）**：这是 SQLite 单库 + 单用户消息量小前提下的取舍；深分页性能随 `offset` 线性下降，故设 CAP 上限。不为它引入新依赖或数据库视图。

### 5.5 接口契约

全部走统一响应信封（C3）；C 端接口 `@Controller('mailbox')` + `@UseGuards(JwtAuthGuard)`，service 层所有查询带 `userId`（C5）；越权返回 **404 而非 403**（与 `/tickets/:id` 一致，`docs/api-contract.md:99`），不泄漏资源存在性。

| 方法 | 路径 | 请求 | 响应 | 备注 |
|---|---|---|---|---|
| GET | `/api/v1/mailbox/messages` | `limit` (1–100, 默认 20)、`offset`、`channel`、`category`、`unreadOnly`、`starredOnly`、`q`、`from`、`to` | `{ items: UnifiedMessage[], total, limit, offset }` | **必须注册在 `/:id` 之前**（参照 `/tasks/page` 的排序坑，`api-contract.md:67`） |
| GET | `/api/v1/mailbox/messages/:id` | — | `UnifiedMessage & { bodyText?, bodyHtml?, canRenderHtml }` | `id` 带前缀；`security` 类恒不返回正文；`bodyExpiresAt` 已过则正文为 `null` |
| GET | `/api/v1/mailbox/unread-count` | — | `{ mail: number, inapp: number, total: number }` | 铃铛复用 |
| POST | `/api/v1/mailbox/messages/:id/read` | — | `{ id, read: true, unread }` | 幂等；`inapp:` 前缀转调 `NotificationsService.markRead` |
| PATCH | `/api/v1/mailbox/messages/:id/star` | `{ starred: boolean }` | `{ id, starred }` | **仅 `mail:` 前缀**；`inapp:` 抛 `40001` |
| POST | `/api/v1/mailbox/read-all` | — | `{ updated, unread }` | 两路分别 `updateMany`，不做跨表事务 |
| GET | `/api/v1/admin/mailbox/deliveries` (治理批次) | `userId` / `email` / `status` / `from` / `to` / `limit` / `offset` | 投递记录列表 | `message.write`（`permissions.ts:131`）；不新增权限点 |

**不新建统一写端点**：写操作按 `source` 分派到新 service 或既有 `/notifications` 逻辑，避免给 `Notification` 引入星标/归档等虚假语义。

错误码：沿用 `40001`（参数/范围）、`40301`（无权）、`40302`（账号不可用）、`42901`（限流）；**不新增业务码**。

### 5.6 保留期与清理

复用既有 `retention` 机制（`retention.controller.ts:10-53` + `BackupService.cleanupExpired`），不另写定时任务：

- `TARGETS` 增加 `{ table: 'MailMessage', label: '邮件投递记录', defaultDays: 180, note: '客服排障窗口 + PIPL 最短必要；订单/积分流水不在可清理之列' }`。
- `BackupService.cleanupExpired` 增加 `MailMessage` 分支，沿用 `CleanupLog` 留痕与 `retentionDays` 下限校验。
- **正文快照单独过期**：`bodyExpiresAt` 默认 `sentAt + 30 天`，由同一调度任务置空 `bodyText/bodyHtml`（不删行）。常量写在 `mailbox/constants.ts`，**刻意不新增环境变量**（C1/最小 diff）。
- `GET /me/deletion-preview`（`api-account.ts:30`）与 `POST /me` 注销的「消息」影响面须包含 `MailMessage`；按 PIPL 第 47 条，目的实现或用户撤回同意时主动删除。

---

## 6. 安全设计

### 6.1 数据与越权

| 风险 | 措施 |
|---|---|
| 越权读他人邮件 | 所有查询 `where: { userId }` 在 service 层强制；不依赖 controller 判 `:id`（C5）；详情越权返回 404 |
| 归档放大敏感信息 | `security` 类不落正文；其余剥离一次性 token、截断 2000 字；收件地址只存 `maskEmail()` 结果（`channel.types.ts:63` 已有工具） |
| 归档失败阻断发信 | `finally` 吞异常只 WARN，`DeliveryResult` 原样返回（C6） |
| 归档成为账号枚举面 | `/mailbox` 全部需登录；错误信息不含完整邮箱；后台排查接口需 `message.write` |
| 正文到期仍可检索 | 到期置空内容而非留明文；清理写入 `CleanupLog` |

### 6.2 正文渲染分级（v1）

v1 归档正文**全部为平台自产模板 HTML**（`email.service.ts:183-196,221-229`），属可信内容：

- 复用 `backend/src/channels/template.ts` 的 `escapeHtml` / `renderTemplate`；前端渲染前再做一次标签白名单。
- 禁止标签：`base` / `meta` / `form` / `input` / `iframe` / `object` / `embed` / `style` / `script` / `svg` / `math`。其中 `base`（改变相对链接基准）与 `meta`（可重定向）是邮件场景特有的坑，必须禁。
- 所有 `<a>` 强制 `target="_blank" rel="noopener noreferrer nofollow"`。
- 图片 `src` 只允许 `data:` / `cid:`；远程 `http(s)://` 默认替换为占位并提示「N 张外部图片被拦截」，**不提供一键放行**（v1 无外部邮件，不需要该能力）。
- 渲染收敛在单一 `MailBody.tsx` 组件，调用方只见 `<MailBody html={...} />`；未来替换内部实现不动调用方。
- **v1 不引入 DOMPurify**（C1）。若 D1 裁定接外部邮件，此组件内部必须升级为四层管线，见下。

### 6.3 外部邮件入口的启用条件（预置规范，v1 不启用）

任何外部内容进入（用户回复、IMAP 收取、转发进来的邮件）时，风险等级立即拉满，必须同时启用：

1. **解析层**：`postal-mime` 等解析 raw RFC822，限制 MIME 部件数、嵌套深度、字节数、附件总数；所有字段按不可信处理，头部用 `textContent`；附件名归一（去路径与控制字符、限长、去重）。
2. **净化层**：DOMPurify 在**渲染时、在 sink 处**净化；`USE_PROFILES: { html: true }`（不与 `ALLOWED_TAGS` 混用）、`FORBID_TAGS` 含 `svg/math/style/meta/base/form`、`FORBID_ATTR` 含 `srcset/formaction/ping/style`；**固定版本并跟进 CVE**（历史 CVE-2019-16728 / CVE-2020-26870 均为 mXSS）；`DOMPurify.removed` 只作诊断，不作安全判定；`SAFE_FOR_TEMPLATES` 不用于生产。
3. **隔离层**：独立 origin 的 iframe `src`（优于同源 `srcdoc`），`sandbox` **不给 `allow-scripts`**；MDN 明确警告同源嵌入时 `allow-scripts + allow-same-origin` 等价于无沙箱；`referrerpolicy="no-referrer"`。
4. **网络层 CSP**（写在 iframe 文档内）：`default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; font-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'`。Open-Xchange 官方文档记录过「净化无法解决」的真实攻击：外部图片响应头 `Link: …; rel=preload; as=font` 可链式触发 401 原生凭据对话框，只能靠严格 CSP 拦截。

---

## 7. 改动清单

> 以下为**获批后**的实施清单，本轮均未执行。

### 7.1 后端新增

| 文件 | 职责 |
|---|---|
| `backend/src/mailbox/mailbox.module.ts` | 模块注册；imports 含 `PrismaModule`，providers `MailboxService` / `MailArchiveService` |
| `backend/src/mailbox/mail-archive.service.ts` | 旁路归档：从 `EmailMessage` + `DeliveryResult` 构造 `MailMessage`，含脱敏、截断、正文过期、吞异常 |
| `backend/src/mailbox/mailbox.service.ts` | 两路归并读、详情、标已读、星标、未读数；`userId` 强制过滤 |
| `backend/src/mailbox/mailbox.controller.ts` | C 端 6 个端点 + 治理批次的后台排查端点 |
| `backend/src/mailbox/dto/mailbox-query.dto.ts` | `class-validator` DTO：`limit/offset` 范围、`category` 白名单、`from/to` ISO、`q` 长度 |
| `backend/src/mailbox/mail.types.ts` | `UnifiedMessage` / `MailSourceAdapter`（只读预留接口）/ `MailCategory` 白名单常量 |
| `backend/src/mailbox/mailbox.service.spec.ts` | 见 §8 |
| `backend/prisma/migrations/<ts>_add_mail_message/migration.sql` | 建表 + 索引 |
| `backend/scripts/seed-mailbox.ts` | 测试档造数（三类邮件 + 失败/local/suppressed 各一条） |

### 7.2 后端修改

| 文件 | 改动 |
|---|---|
| `backend/prisma/schema.prisma` | 新增 `MailMessage`；`User` 增加 `mailMessages` 反向关系 |
| `backend/src/app.module.ts` | 注册 `MailboxModule` |
| `backend/src/channels/channel.types.ts` | `EmailMessage` 增加可选 `context`，新增 `EmailMessageContext` 类型 |
| `backend/src/channels/email/email.service.ts` | 注入 `MailArchiveService`；`send()` 的 `finally` 旁路归档；`sendPasswordReset` / `sendEmailVerification` 模板本身不改 |
| `backend/src/auth/auth.service.ts:238-270,334-365` | 两处调用补 `context`（`security`，不落正文） |
| `backend/src/invoices/invoices.service.ts:408-427` | 一处调用补 `context`（`invoice`，落脱敏快照） |
| `backend/src/admin/retention.controller.ts:32-51` | `TARGETS` 增加 `MailMessage` |
| `backend/src/admin/backup.service.ts` | `cleanupExpired` 增加 `MailMessage` 分支 + 正文快照过期置空 |
| `backend/src/me/*`（注销与导出影响面） | `deletion-preview` 与 `/me/export` 纳入 `MailMessage` |

### 7.3 前端新增（严格按 `frontend-module-conventions.md`）

```
frontend/src/pages/mailbox/
├── index.ts                    # 唯一出口，import './style.css'
├── page.tsx                    # 路由级状态、URL 同步、写操作
├── components.ts               # PersonalPage / Button / StateEmpty / StateError / StateSkeleton 转出
├── api.ts                      # mailboxApi + notificationsApi 转出（写操作按 source 分派）
├── hooks.ts                    # useAuth / useDocumentMeta 转出 + useMailboxMessages
├── utils.ts                    # 归并预览、时间格式化、source 前缀解析、筛选参数序列化
├── constants.ts                # 类别/通道选项、默认值、UnifiedMessage 类型
├── style.css                   # 仅 mailbox-* 前缀选择器，零裸 hex
├── MailboxFilters.tsx
├── MailboxToolbar.tsx
├── MailMessageList.tsx
├── MailMessageDetail.tsx
├── MailBody.tsx                # 唯一正文渲染入口（§6.2/§6.3）
└── __tests__/mailbox-modules.test.ts   # namedImportAudit 具名导入对账
└── __tests__/mailbox-utils.test.ts
```

### 7.4 前端与文档修改

| 文件 | 改动 |
|---|---|
| `frontend/src/App.tsx:45-113,163-166,206-408` | `lazyRoute('/mailbox')`、`<Route>`、`capabilityIndependent` 正则加 `mailbox` |
| `frontend/src/lib/api-mailbox.ts`（或 `api-account.ts`） | `mailboxApi`；类型进 `frontend/src/types/api.ts` |
| `frontend/src/layout/NotificationBell.tsx` | 「查看全部」深链（P1） |
| `frontend/src/pages/account/page.tsx` | `AccountMessagesCard` 增加深链（P1） |
| `frontend/src/test/namedImportAudit.ts` 相关用例 | 新增 `mailbox` 目录对账（§7.3 已含用例文件） |
| `docs/README.md:82-92` | 本文件进「规划文档」分类表（**实施获批后同批**，见 C9） |
| `docs/api-contract.md:97` | §3.1 增加 `/mailbox/*` 接口行 |
| `docs/testing.md` | 覆盖矩阵增加邮箱模块用例 |
| `docs/prd.md:152` | 顺手修正 S-08 状态滞后（D8） |
| `CLAUDE.md:100-114` | 目录树增加 `mailbox-design.md`（实施后） |

**刻意不改**：`docs/environments.md`（不新增环境变量）、`admin/permissions.ts`（不新增权限点）、`MessageTemplate` / `notifications.service.ts`（不接线 email 通道）、任何 `node_modules` 依赖。

---

## 8. 分批实施、测试与门禁

### 8.1 分批

| 批次 | 内容 | 验收 |
|---|---|---|
| **P0（前置，运维）** | 配齐生产 `EMAIL_API_URL` / `EMAIL_API_KEY`（或 `aliyun` 凭据），确认 `EmailService.status().delivers === true` | `/health` channels 分项与 `/admin/notifications/channels` 显示真实投递；发一封真实验证码并收到 |
| **P1（后端归档）** | §7.1/§7.2 中 schema + 归档链路 + 三处 `context` | 三类邮件各触发一次，库中 `MailMessage` 有记录；找密/验证码记录 `bodyText/bodyHtml` 均为 `null`；归档 service 抛异常时 `DeliveryResult` 不变 |
| **P2（C 端页面）** | §7.3/§7.4 前端 + 统一读接口 | `/mailbox` 列表/筛选/详情/未读/分页可用；站内消息与邮件混排按时间倒序正确；未登录唤起登录弹窗 |
| **P3（治理）** | 保留期清理、注销影响面、后台排查端点、文档同批更新 | `retention` 预览与清理留 `CleanupLog`；`/me/deletion-preview` 含邮件记录；接口清单与索引一致 |

每批结束**停下等待确认**，不连续推进（项目工作纪律）。

### 8.2 测试用例清单

| 层 | 用例 |
|---|---|
| 后端单测 | ① 归档写入映射正确（`delivered:true/false`、`provider`、`messageId`、脱敏 `toMasked`）② **归档失败/异常不改变 `DeliveryResult`，且 `send()` 不上抛** ③ `security` 类正文恒为 `null` ④ 归并排序、同时间戳稳定序、`offset/limit` 边界 ⑤ `offset+limit > 1000` 抛 `40001` ⑥ 越权读他人 `mail:` / `inapp:` 均 404 ⑦ 标已读幂等 ⑧ `inapp:` 前缀调 star 抛 `40001` ⑨ `bodyExpiresAt` 过期后详情不返回正文 ⑩ `q` 注入式输入不产生异常 |
| 前端 Vitest | utils 纯函数（前缀解析、筛选序列化、预览截断）；`namedImportAudit` 具名导入对账（缺失名字在 Vite 下会白屏，`frontend-module-conventions.md:140-142`）；`MailBody` 白名单过滤 `base/meta/script` |
| E2E | `/mailbox` 列表 → 筛选「邮件」→ 打开详情 → 自动已读 → 铃铛未读数减 1；未登录访问唤起登录弹窗；分页翻页；空态 |
| 冒烟 | 测试档 `console` 通道下走完整链路，`logs/outbox/email-*.log` 与归档记录一一对应 |

### 8.3 门禁命令（**需授权执行；本轮未执行任何一条**）

```
npm run check                                  # 根目录工程门禁
cd backend && npm run build                    # L1 后端（不用 nest start）
cd frontend && npm run typecheck               # L1 前端
cd frontend && npm run build:prod              # L1 前端构建
cd frontend && npx vitest run src/pages/mailbox   # 新增用例
cd frontend && npm run e2e                     # L4（生产不跑）
cd backend && npm run verify:deps:critical     # 仅当依赖变动；本设计零新增依赖，可跳过
```

依据 `docs/development-workflow.md:348-373`、`CLAUDE.md:406`。仓库**没有** `smoke:all` / `gate:all`，交付摘要不得声称「全量通过」而不附逐组结果。

---

## 9. 待裁定项（阻断实施）

| ID | 决策点 | 选项 | 推荐 | 影响面 |
|---|---|---|---|---|
| **D1** | **是否接外部邮件协议（真 Webmail）** | A 不接，只做站内邮件中心 / B 接 IMAP-SMTP 或自建邮件服务器 | **A** | **阻断项**。B 会使本文 §5–§7 整体作废，须另立项目；且必须显式修订 `docs/environments.md:201` 的 ADR。见 §3 |
| D2 | 统一范围 | 只归档邮件 / 归并站内消息做统一只读视图 | 归并（只读） | 决定 `/mailbox` 产品心智与 `MailboxService` 复杂度 |
| D3 | 是否落正文快照 | 只存元数据 / 元数据 + 脱敏快照（`security` 不落） | 后者 | 客服可追溯性 vs PII 暴露面；影响 PIPL 告知内容 |
| D4 | 收件地址存储 | 完整地址 / 掩码 + `userId` 反查 | 掩码 + `userId` | 发票接收邮箱 ≠ 账号邮箱时无法反查完整地址；需确认是否接受 |
| D5 | 保存期限 | 90 / 180 / 365 天；正文快照 30 天 | 记录 180 天 + 正文 30 天 | PIPL 第 19/47 条；隐私政策须写明期限 |
| D6 | 交互范围 | 只做未读 + 筛选 / 加星标、归档、阅读窗格配置 | 只做未读 + 筛选 + 邮件星标 | 过度施工风险 |
| D7 | 是否允许从消息中心对外发信 | 禁止 / 允许 | **禁止（v1）** | 合规边界：《互联网电子邮件服务管理办法》第 2 条适用范围 |
| D8 | `docs/prd.md:152` 状态滞后 | 实施时顺手修正 / 不动 | 顺手修正 | 文档一致性（C9 原则 1） |

**裁定输出要求**：D1 必须给出明确结论；D2–D8 可批量确认或逐项驳回。裁定后形成偏差清单，再进入 P0。

---

## 10. 风险与合规

| 风险 | 等级 | 处置 |
|---|---|---|
| 生产发信未接通，归档全是 `local`/`failed` | 高 | P0 前置门禁；未达成不进入 P1 |
| 一次性凭证被归档放大 | 高 | `security` 类不落正文（§5.3） |
| 正文快照含个人信息（发票号/金额/邮箱） | 中 | 脱敏 + 截断 + 30 天失效 + 180 天清理 + 隐私政策告知保存期限（PIPL 第 17/19/47 条） |
| 「站内消息中心」是否被认定为「互联网电子邮件服务」 | 中 | 按办法第 2 条文义推论：不设置对外邮件服务器、不接收/转发互联网邮件、不可对外发信 → 大概率不适用第 4/6/7/10/13–16 条。**但未找到监管机关对「站内信」的明确界定文件，此为文义推论，正式立项前应取得法律意见。** 一旦允许回复/对外发信或接入 IMAP，边界立即失效 |
| 选用境外 ESP 的跨境传输 | 中 | PIPL 第 38–40 条：安全评估/认证/标准合同 + 单独同意；第 21 条委托处理须约定目的、期限、保护措施并监督 |
| 商业邮件合规（若未来扩展营销邮件） | 低（v1 无） | 办法第 13/14 条：标题前部标注「广告/AD」、提供 30 日有效的拒收方式；事务/验证类邮件不加退订链接 |
| 交付率运营（若未来扩展批量邮件） | 低（v1 无） | SPF/DKIM 通过、DMARC ≥ `p=none`、From 域对齐、FCrDNS、一键退订（RFC 8058，5000 封/日阈值）、投诉率 < 0.3%；事务与营销用不同子域/DKIM selector 隔离 |
| AGPL 传染性（仅方案 B） | 高 | Stalwart Community 为 AGPL-3.0，商业 SaaS 需法务评估或 Enterprise 许可 |

---

## 附录：调研来源（关键条目）

| 主题 | 来源 |
|---|---|
| Gmail 搜索运算符与会话视图 | `support.google.com/mail/answer/7190?hl=en&co=GENIE.Platform%3DDesktop` |
| Gmail / Outlook 官方对照（分页、阅读窗格） | `support.google.com/mail/answer/9259955?hl=en-GB` |
| Outlook 阅读窗格 / 筛选困惑 | `support.microsoft.com/en-au/topic/c5a22636-6a10-4f96-a9e5-1f1071cde749`、`learn.microsoft.com/en-sg/answers/questions/5785451` |
| 《互联网电子邮件服务管理办法》（工信部令第 38 号） | `miit.gov.cn/zcfg/xxtxl/art/2009/art_d17e4e918c5a458f92ad087bee740a63.html` |
| 《个人信息保护法》全文 | `cac.gov.cn/2021-08/20/c_1631050028355286.htm` |
| 阿里云 / 腾讯云 25 端口封禁 | `help.aliyun.com/zh/document_detail/56130.html`、`tencentcloud.com/zh/document/product/213/34833` |
| 阿里云邮件推送（触发/批量邮件、发信预热、退订） | `help.aliyun.com/document_detail/57780.html` |
| Google/Yahoo 批量发件人要求（M3AAWG 梳理） | `m3aawg.org/blog/SendingBulkMailToGmail_Yahoo` |
| Stalwart 协议与许可 | `github.com/stalwartlabs/mail-server`、`stalw.art` |
| Roundcube / RainLoop / Cypht 维护状态 | `roundcube.net`、`rainloop.net`、`cypht.org/documentation/releases` |
| 不可信 HTML 邮件四层防御与 CSP | `dev.to/silkline/previewing-untrusted-eml-files-in-the-browser-sandboxed-iframe-csp-and-blocked-remote-images-5fjb`、`documentation.open-xchange.com/8/ui/features/email-security.html`、MDN `<iframe>` sandbox |
| DOMPurify 配置 pitfalls 与历史 CVE | `nhimg.org/html-sanitisation-guide`、`mizu.re/post/exploring-the-dompurify-library-hunting-for-misconfigurations` |

**未能核实（不得当作事实引用）**：Mailpile / Aerc / SOGo 的维护状态与许可；RainLoop 许可口径（官方页标 MIT、第三方目录标 AGPL-3.0）；SnappyMail 活跃度存在相反说法；`emailjs-imap-client` 许可；各开源项目精确版本号；《电子商务法》交易信息留存具体条款；送达率数值（预热天数、投诉率阈值）均为业界经验值且口径不一。

---

**本轮交付边界**：仅新增本设计文档。未改动任何既有文件，未运行构建/测试，未创建迁移，未配置生产凭据。等待 §9 裁定。
