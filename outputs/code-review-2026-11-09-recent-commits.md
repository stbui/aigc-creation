# 代码审核报告 · 最近提交批次

- **日期**：2026-11-09
- **模式**：只读审核。未修改任何代码、未执行构建 / 测试 / 门禁 / 依赖安装
- **范围**：`420de7b..HEAD`，即 `eb66b82` → `7bd85ba` → `0cd7a70` → `9909c17`
- **判定基准**：`CLAUDE.md` 硬约束与「单一事实源」表、`docs/api-contract.md`、`docs/payment-refactor-design.md`、`docs/testing.md`、`docs/admin-*.md`。事实源优先级 **代码 > 文档 > 注释**
- **证据等级**：★ 主审回读 HEAD 源码核证；☆ 分块审核员核证、主审未逐行复核
- **处置**：本报告仅为偏差清单，**不落盘修复**，等待逐项裁定批准

---

## 一、结论

| 严重级 | 条数 | 性质 |
|---|---|---|
| P0 阻断 | 1 | 本批新增支付门禁与默认值的组合，使空库 / 默认部署下付费链路在「建单」阶段即失败，且集成测试静态不自洽 |
| P1 高 | 3 | 资金 / 升级兼容：历史易支付回调永久拒绝、退款实例错配、USD 条件放行永不可能满足 |
| P2 中 | 15 | 契约漂移、事实源重复、实例维度漏传、前端状态与校验缺口、清理防复发 |
| P3 低 | 13 | 向后兼容、限额口径、测试覆盖、文案、字号、文档数量口径 |

**阻断结论**：`A01` 必须在合并前裁定。本批次把 `payment.enabled` 设为默认 `false`，并在 `OrderService.create()` 与 `PaymentOrderService.createIntent()` 两处新增 503 拦截；后台通用设置接口虽可写该键，但无 seed / 部署引导，而集成测试自建空库（`prisma db push`）只写入 `defaultCurrency / alipaySource / wechatSource`，商品 `priceCents: 1000`，却断言 `POST /orders` 返回 201。按 `SettingsService.get()` 的默认值回落逻辑，该断言静态不成立。

**已核证无偏差的关键项**（详见第四节）：权限点、设置默认值、工单 / 账单状态机、能力清单、积分价解析、107 包 / 115 provider、17 能力、32 页，均符合 `CLAUDE.md` 单一事实源；前端 6 个营销端点与全部支付端点的路径 / 参数 / 响应形状与后端逐项一致；无 `as any`、无绕过 `admin-ui/primitives` 直引 antd；回调验签、去重、`markPaid` 幂等、密文落库、新增端点权限与审计完整；`eb66b82` 的删除与 R100 重命名无悬空引用。

---

## 二、批次界定

| 提交 | 规模 | 性质 |
|---|---|---|
| `eb66b82` | 1197 D / 10 R100 | 清理：后端 `dist-verify` 680、前端 `dist-verify` 470、其它 47（含 CI 配置、临时脚本、快照、`combobox.tsx`）；10 个 `frontend/scripts/*.mjs` → `frontend/e2e/audit/` |
| `7bd85ba` | 59 文件 / +262 −255 | 收尾：`providerMethod` 列、两个来源设置项、可见支付方式解析链路、移除 `@base-ui/react`、`.gitignore` 与脚本路径同步 |
| `0cd7a70` | 76 文件 / +6339 −1812 | **主批次**：后端支付域重构 + admin/checkout 前端 + 契约文档 + 类型 |
| `9909c17` | 24 文件 / +2880 −720 | **主批次**：admin payments / marketing-rules 页面拆分 + 单测 + e2e |

`7bd85ba` 单独看是半成品（缺 DTO / controller / 前端 / 测试），完整功能边界应取 `0cd7a70`。工作区另有 3 处未提交文档改动（无限画布详细设计），不属本次审核对象。

---

## 三、偏差清单

### P0 · 阻断

**[A01] 支付总开关默认关闭 + 双重建单拦截 + 集成测试静态不自洽** ★ `已确证 · 需裁定产品口径`
- **位置**：`backend/src/common/setting-defs.ts:172-179`、`backend/src/orders/order.service.ts:429-431`、`backend/src/payments/payment-order.service.ts:219-222`、`backend/src/common/settings.service.ts:53-61`、`backend/src/payments/payments.integration.spec.ts:65-73 / 257-272 / 375-384`
- **证据**：`0cd7a70` 的 diff 显示 `payment.enabled`（`default: false`）、`paymentRules()` 调用、`if (!paymentRules.enabled) throw new AppError(50301, '支付功能已关闭', 503)` 三处均为本批次新增；`get()` 无记录时回落 `def.default`；集成测试 `beforeAll` 用 `prisma db push` 建空库，只 PUT `/admin/payments/settings` 三个字段（`PaymentSettingsUpdateDto` 无 `enabled` 字段），商品 `priceCents: 1000`，`createOrder()` 断言 `expect(res.status).toBe(201)`。
- **影响**：默认部署 / 全新空库下所有 `paidCents > 0` 的订单连建单都被 503 拒绝，商业域付费链路整体不可用；`docs/api-contract.md` 未记载该开关；集成测试与被测代码静态不自洽，绿灯假设不成立。`backend/src/admin/settings.service.ts:92-115` 的 `updateAll` 按 `SETTING_DEFS` 白名单可写该键，故「无法开启」不成立，但缺 seed / 部署引导。
- **最小修复方向**：裁定该开关是否属有意灰度。若是 → 补部署初始化 / seed、同步契约与集成测试显式开启；若否 → 去掉建单侧门禁，只保留 C 端展示与 intent 侧，并同步修正测试。
- **验证（待批准）**：`npm run test -- payments.integration.spec.ts`、`npm run test -- payment-order.service.spec.ts`

### P1 · 高

**[A02] 存量易支付在途订单的回调被永久拒绝，适配器兼容分支成为死代码** ★ `已确证`
- **位置**：`backend/src/payments/payment-notification.service.ts:78-95 / 318-328`、`backend/prisma/schema.prisma:426`、`backend/src/payments/adapters/epay.adapter.ts:88 / 267-269`
- **证据**：epay 回调在验签前要求 `expectedPaymentMethodFor()` 返回带 `providerMethod` 的历史 `Payment`，否则 `ack({ ok:false, ackSuccess:false })` 且不落收件箱；`7bd85ba` 新增 `providerMethod String?` 列但全仓无回填 / 迁移脚本（全仓 `providerMethod` 命中均为新代码或测试），存量行必为 `NULL`；`epay.adapter.ts` 仍保留 `configType(input.config.values)` 的历史回落并配有用例，但编排层永远走不到。
- **影响**：升级时已付款未入账的订单回调被永久拒绝（渠道重试仍 400），订单停在 `pending`，资金悬空；注释与死代码误导排障。
- **最小修复方向**：对无 `providerMethod` 的历史尝试提供一次性回填或明确的人工补偿入口，并删除 / 对齐适配器中不可达的回落分支。
- **验证（待批准）**：`npm run test -- payment-notification.service.spec.ts`

**[A03] 退款未传 `providerInstanceId`，回落到 default 实例的开关与凭据** ★ `已确证`
- **位置**：`backend/src/orders/order.service.ts:1285-1291`、`backend/src/payments/payment-gateway.ts:48-76`、`backend/src/payments/payment-config.service.ts:196-218`、`backend/prisma/schema.prisma:266 / 452`
- **证据**：`gateway.refund()` 入参新增可选 `providerInstanceId` 并据 `resolveForOrder()` 做 `refundEnabled` 检查；唯一调用方只传 `{ channel, providerConfigId }`；当 `providerConfigId` 为空（历史单 / 手工链路）时 `resolveForOrder` 走 `latestInstance(adapter.descriptor.id, order.providerInstanceId || 'default')`，而 `Payment` 与 `Order` 已有 `providerInstanceId` 字段却未透传。
- **影响**：多实例部署下可能用错实例的密钥导致渠道退款失败，或按错误实例的 `refundEnabled` 误放行 / 误拒绝，与「订单固定版本、绝不跨实例」注释相悖。
- **最小修复方向**：调用处补传 `payment.providerInstanceId ?? order.providerInstanceId`。

**[A04] USD 上架的「条件放行」在当前实现下永不可能满足** ★ `已确证代码行为 · 需裁定是否本轮只开 CNY`
- **位置**：`backend/src/admin/commerce-admin.service.ts:426-438`、`backend/src/payments/payment-config.service.ts:220-247 / 288-299`、`backend/src/payments/adapters/{alipay,wechat,epay,paypal,stripe}.adapter.ts`（`supportedCurrencies`）
- **证据**：`assertCurrencySellable()` 改用 `availableVisible("USD")`；`resolveVisible()` 只把来源映射为 `alipay` / `wechat` / `epay`，三者 `supportedCurrencies` 全是 `['CNY']`，而支持 USD 的 `paypal` / `stripe` 不在可见方式解析链路中 → `availableVisible("USD")` 恒为 `[]`，所有 `active` 的 USD 商品必被 `40001` 拒绝。旧 `available()` 遍历 `allAdapters()`，是能识别 paypal/stripe 的。`docs/payment-refactor-design.md:24 / 31 / 553 / 631 / 1521 / 2144` 的 D6 口径是「存在声明支持 USD 的渠道时允许上架」。
- **影响**：即使管理员配置了完整的 PayPal / Stripe 实例，USD 商品也无法上架、USD 订单无法收款；`payment.defaultCurrency` 与 DTO 仍允许 USD，形成不可达配置。
- **最小修复方向**：裁定本轮是否刻意只开 CNY。若否 → `assertCurrencySellable` 恢复按真实渠道能力判定，或为可见方式补齐 USD 来源；若是 → 收紧 `defaultCurrency` 与文档，避免留下不可达选项。

### P2 · 中

**[A05] 契约文档与冒烟脚本未跟进 DTO 变更，旧调用方直接 400** ★
- `backend/src/admin/dto/payment-admin.dto.ts:123-132 / 189-203 / 233-243`：`PaymentSettingsUpdateDto` 三字段全必填；`ReconciliationRunDto` / `ReconciliationImportDto` 新增必填 `providerInstanceId`。
- `docs/api-contract.md:114-116 / 122 / 124`：仍写「后台默认币种设置」、`{ enabled, closeAfterMinutes, values }`、`{ providerId, billDate, retryFailed? }`、multipart `file + providerId / billDate`。
- `backend/scripts/smoke-payments.js:633 / 644 / 676 / 704`：4 处 import / run 请求体均无 `providerInstanceId`。
- `backend/src/payments/payments.controller.ts:35`：`intent` 的 `providerId` 改受 `VISIBLE_PAYMENT_METHODS` 约束（只 alipay / wechat），文档未记载。
- **修复方向**：同步 `api-contract.md` 与 `smoke-payments.js`；或把新字段改可选并给服务端默认值。**验证**：`node backend/scripts/smoke-payments.js`。

**[A06] 回调差异写入未按实例隔离，非 default 实例的差异记进 default** ★
- `backend/src/payments/payment-notification.service.ts:413-415` 已取得 `providerInstanceId`，但 `recordException()` 的参数（`:510-519`）无该字段，`:522-525` 的 `findFirst.where` 与 `:531-541` 的 `create.data` 均未带，落 `schema.prisma:2347` 默认 `'default'`；对账运行唯一键已是 `[providerId, providerInstanceId, billDate, attempt]`。
- **影响**：后台按实例筛选时看不到金额不符 / 订单不存在等差异。**修复方向**：透传实例 id 并参与 run 的查询与创建。

**[A07] 本批新增的资金分支缺行为级单测** ☆
- `order.service.ts` 新增 `payment.enabled` / 金额与日限额 / `orderTtlMinutes` / `maxPendingOrders`，`order.service.spec.ts` 本轮 diff 只有 4 处 `{} as never` 构造参数；`payment-order.service.spec.ts:24` 把 `enabled` 写死 `true`，`enabled=false` 零覆盖；`payment-gateway.ts` 新增 `refundEnabled` 分支但无对应 spec；`payment-admin.controller.ts` 新增 3 个实例端点而 controller spec 未改；`payment-worker.service.spec.ts` 新断言只核对调用参数。
- **修复方向**：补 `enabled=false`、金额 / 日限额边界、`refundEnabled=false`、实例维度差异的行为级用例。

**[A08] `createIntent()` 在校验与抢租约之前推进轮询游标** ☆ `疑点`
- `payment-order.service.ts:228` 调 `resolveVisibleOptions(currency, paidCents)` 未传 `advanceCursor=false`；`payment-config.service.ts:1083-1088` 默认 `advanceCursor=true` 会 `cursor: { increment: 1 }` 持久化。
- **影响**：「未指定方式 / 方式不可用 / 租约冲突 / 配置不全」等失败请求也推进游标，重试可能换实例，与方法自身注释冲突。**修复方向**：游标推进推迟到渠道下单成功后，或失败路径回退。

**[A09] 同一事实多处定义，违背单一事实源** ☆ `疑点（当前取值一致，无金额错误）`
- `payment-config.service.ts:758-761` 的 `sourceOf()` 硬编码默认 `'unset'`；`PAYMENT_SOURCES` 与 `SETTING_DEFS.options`、`PaymentSettingsUpdateDto` 三处各写一遍；`:1135-1139` 与 `:1149-1153` 两份逐字相同的 `defaultMethods()`；`yuanToCents` 在 `adapters/types.ts:221` 与 `common/settings.service.ts:272-274` 各一份；`startOfShanghaiDay` / `shanghaiDate` 在 `payment-query.ts:112` 与 `order.service.ts` 各一份。
- **修复方向**：枚举 / 默认值 / 金额换算 / 日界各收敛到一处。

**[A10] 保存支付来源失败不回滚，且无 dirty / 未保存保护** ★
- `frontend/src/pages/admin/payments/PaymentsVisibleMethodsCard.tsx:77-104`：`updateSource` 直接改本地 `settings`，`save()` 的 catch 只 `setError` + `toast.error`，未恢复服务端值；按钮 `disabled={!writable || !settings || saving}`，无 dirty 标记、未挂 `useUnsavedGuard`（对比 `PaymentsProviderInstancesDrawer.tsx:133,138`）。
- **影响**：保存失败后界面显示新来源，`sourceAvailability` 基于错误草稿给出「前台会展示」，服务端仍是旧值；改动不保存直接离开无拦截。**修复方向**：引入已保存快照 + dirty，catch 回滚并挂未保存守卫。

**[A11] 签到加成前端 `min={1}` 与后端 `@Min(2)` 冲突，且缺字段级校验** ★
- `frontend/.../marketing-rules/MarketingRulesTab.tsx:216-243`：连续天数 `min={1}`，加成 `NumberField` 只有 `min={0}` 无 `max`；`backend/src/admin/dto/marketing.dto.ts:244 / 250` 为 `@Min(2)` / `@Max(100000)`；`hooks.ts:124` 失败只 `toast.error`。
- **影响**：填「连续 1 天」或超额加成保存时只收到一句后端报错，无法定位档位。**修复方向**：`min` 提到 2、补 `max` 与逐档校验并标出档位。

**[A12] `useRuleDrafts` 的 reload 静默覆盖未保存草稿** ★
- `frontend/.../marketing-rules/hooks.ts:82-88`：`useEffect(..., [data])` 每次 `useAdminResource` 成功返回都无条件 `setInvite/setCheckin/setInviteBase/setCheckinBase`；`reload` 挂在 `ListError` / `StaleError` 的 `onRetry`；`useUnsavedGuard` 只拦路由跳转与刷新。
- **影响**：stale error 且有未保存修改时点「重试」，草稿被覆盖、dirty 归零、离开守卫失效。**修复方向**：同步前判断 dirty，dirty 时只清 error / 提示确认。

**[A13] 邀请关系深链用 `in` 判断状态，原型链属性被当作合法枚举** ★
- `frontend/.../marketing-rules/InviteRelationsTab.tsx:47-49`：`rawStatus in REWARD_STATUS_META`，`constructor` / `toString` 同样为真，随后写入请求参数与 URL；同仓 `useReconciliationFilters.ts:50` 已有正确写法 `Object.prototype.hasOwnProperty.call(...)`；后端 `InviteListQueryDto.rewardStatus` 只 `@IsString() @MaxLength(16)`。
- **修复方向**：改用 `hasOwnProperty` 白名单。

**[A14] 对账深链边界值校验不足，工具栏与 URL 条件可不同形** ☆
- `frontend/.../payments/useReconciliationFilters.ts:31,47-54`：日期只校验 `/^\d{4}-\d{2}-\d{2}$/`（`2026-13-45` 通过），不校验 90 天窗口；`providerInstanceId` 只判非空、不校验是否属于该渠道；`PaymentsReconciliationTab.tsx:81` 的 `providers.list()` 失败时全页无错误提示，只让下拉变空。
- **修复方向**：校验日历有效性与窗口、用 `instanceOptions` 白名单过滤、补 providers 错误态。

**[A15] 重复实现与死代码：草稿转换两份、方法标签三份** ★
- `frontend/.../payments/PaymentsProviderInstanceEditor.tsx:106-120` 导出的 `draftToConfigUpdate` 在 `frontend/src` 内除定义处零调用；`PaymentsProviderInstancesDrawer.tsx:218-235` 内联重写同样 9 字段映射（含 `Math.round(yuan*100)` 与 `yuanToCents` 两份金额换算）；`METHOD_LABELS` 在 `Editor.tsx:31`、`Drawer.tsx:36`、`PaymentsVisibleMethodsCard.tsx:23` 各一份。
- **修复方向**：Drawer 改为调用 `draftToConfigUpdate`，标签收进 `constants.ts` 单点导出。

**[A16] `text-[11px]` 两处违反 12px 全站硬规范** ★
- `frontend/.../payments/PaymentsReconciliationTab.tsx:173`、`PaymentsProviderInstancesDrawer.tsx:411`；`CLAUDE.md:368` 明令禁止；前序提交 `b46406d` 刚做过「统一 12px 最小字号」，本批又引回。同页其它文字均为 `text-[12px]`。
- **修复方向**：两处改 `text-[12px]`。

**[A17] 清理提交缺防复发规则** ☆
- `frontend/.gitignore:4 / 24 / 27` 覆盖了 `dist-verify` 与 `/e2e/audit/out/`，但 `eb66b82` 删除的 `verify-portal*.mjs` / `shot-*.mjs` / `inspect-*.mjs`（20+）、`.tmp-task-detail.playwright.config.ts`、`e2e/local-redraw-audit/*.png` 无规则；根 `.gitignore` 无 `.workbuddy` 规则，而 `0cd7a70` 删除了 `.workbuddy/memory/2026-11-05.md`，HEAD 已无该目录任何文件。
- **影响**：一次性脚本重新生成会再次进入 `git status`；工具私有数据重建后变未跟踪 / 可提交。**修复方向**：补 ignore 规则或统一移入已忽略目录。

**[A18] `docker-compose.yml` 残留 4 个 `GATEWAY_*` 死配置** ★
- `docker-compose.yml:91-94` 仍声明 `GATEWAY_BASE_URL / TOKEN / MODEL / ENABLED`，注释「不配则全走本地 Jimp」；`ENV_SPECS` 不校验、代码不读取；与 `CLAUDE.md:64 / 278`「旧三层已整体删除、不存在并存期、没有 `GATEWAY_*`」及 `:63`「只允许真实模型产出」冲突。
- **影响**：配置 / 文档腐化，不影响运行。**修复方向**：删除 4 行并修正注释口径。

**[A19] `7bd85ba` 单提交为半成品，不可单独 cherry-pick / 回滚** ☆
- 该提交引入 `providerMethod` 列、两个来源设置项与可见方式解析链路，但 DTO / controller / 前端页面 / 单测由 `0cd7a70` 补齐；HEAD 中相关符号全部存续、无覆盖残留。
- **修复方向**：以 `0cd7a70` 为该支付改动的完整功能边界，发布 / 回滚说明中标注。

### P3 · 低（表格）

| 编号 | 位置 | 问题 | 最小修复方向 | 等级 |
|---|---|---|---|---|
| A20 | `payment-admin.dto.ts:123-132`、`payment-admin.controller.ts:174-179` | settings 三字段全必填，`saveSettings` 无条件写两个来源键；旧调用方只改币种会 400，且来源配置被顺带覆盖 | 来源字段改可选、仅在实际提交时写入 | ★☆ |
| A21 | `payment-config.service.ts:397-403`、`payment-admin.dto.ts:70-114` | 新建实例 `enabled` 恒 `false` 且跳过 `validateConfig`，可创建缺密钥实例 | 确认「新建默认停用」是否为产品意图；仍对 `values` 做独立完整性校验 | ☆ |
| A22 | `order.service.ts:1956-1983`、`payment-config.service.ts:1018-1046`、`payment-order.service.ts:1279-1283` | 两级「每日限额」口径不同；同一订单多次 intent 的多条 `Payment` 重复计入实例限额；rolling 窗口字段与计数窗口不一致 | 文档化两级口径、去重统计、对齐窗口字段 | ☆ |
| A23 | `marketing-rules/MarketingRulesTab.tsx:216-260` | 可增删的加成档位用数组索引作 `key`，删除中间档位可能错位 | 为每档生成稳定 id | ★ |
| A24 | `frontend/scripts/check-file-size.mjs:23-24`；`PaymentsProviderInstanceEditor.tsx` 502 行；`types/api.d.ts` 2277 行 | 超 500 行 WARN 阈值触发「建议拆分」；`api.d.ts` 基线仍写 2331，触发 stale 提示 | 拆分 Editor；把基线改为 2277 | ☆ |
| A25 | `PaymentsReconciliationTab.tsx:358`、`PaymentsProviderInstancesDrawer.tsx:464` | 「导入对账单」提示写「超过 10000 行会拒绝导出」；上下布局的 EmptyState 写「选择左侧实例」 | 改「拒绝导入」/「选择上方实例」 | ☆ |
| A26 | `frontend/tests/admin-marketing.spec.ts:268-272` | `if (rowCount > 0)` 条件断言，空库时整块跳过仍通过 | 用 fixture 造一条记录后断言行，或至少断言表格容器与列头 | ☆ |
| A27 | `marketing-rules/__tests__/lists.test.ts:45-49`、`payments/__tests__/paymentMeta.test.ts:57-92`、`InviteRelationsTab.test.tsx:81-156` | 大量断言常量表自身；补发失败、筛选参数、重置、分页、URL 深链未覆盖；无 `it.skip` / 永真断言 | 补失败分支与请求参数用例，常量断言换成消费端行为断言 | ☆ |
| A28 | `CheckinRecordsTab.tsx:98`、`InviteRelationsTab.tsx:129`、`admin-ui/lib/format.ts:9-23` | 营销流水用浏览器时区 `toLocaleString`，对账列用固定东八区；`format.ts` 注释要求统一北京时间。`formatDateTime` 被 20+ 后台页面使用，属全站既有口径 | 明确哪些列允许本地时区，其余统一 | ☆ 疑点 |
| A29 | `frontend/src/lib/api-payments.ts:81-82`、`payments/utils.ts:40-43` | `providers.list()` 响应类型漏写 `total/page/pageSize`（后端 controller 有返回）；`moneyText` 除测试外零调用，是第三份金额格式化 | 补齐类型；删除未使用实现或统一到 primitives | ☆ |
| A30 | `payments/constants.ts:95-103`、`PaymentsReconciliationTab.tsx:106-130` | 静态 `RECONCILIATION_PROVIDER_IDS` 白名单与后端动态 `supportsReconciliation` 清单可能漂移；`runProvider as PaymentProviderId` 无运行时校验 | 共用后端清单，去掉静态白名单 | ☆ 疑点 |
| A31 | `CLAUDE.md:40 / :145`、`frontend/src/App.tsx:209-405` | 文档记「30 条壳内路由」；实测主 `<Routes>` 区间含 33 个 `<Route` 标签行、其中 1 条 catch-all（另两组 Routes 为 3 条裸外壳页 / 6 条独立页，按口径不计入）。计数口径需按代码重新裁定 | 精确复核后顺手修正 `CLAUDE.md` | ★ |
| A32 | `eb66b82` name-status | 删除范围不止编译产物，还含 `frontend/.github/workflows/playwright.yml`、`admin-ui/components/ui/combobox.tsx`、CI / 快照 / 20+ 临时脚本；`combobox.tsx` 删除后全仓无悬空 import（安全） | 提交说明 / 台账按四类重述 | ☆ |

---

## 四、已核证无偏差项

| 核对项 | 结论 | 证据 |
|---|---|---|
| 权限点只在 `admin/permissions.ts` | 符合 | `permissions.ts:36 / 152 / 165 / 245`；新增 3 个实例端点均挂 `payment.write` + 审计 |
| 退款 / 站点设置默认值只在 `SETTING_DEFS` | 符合 | `setting-defs.ts:68 / 336-353 / 360 / 371 / 382`；`settings.service.ts:139-141` 仅读取 |
| 工单 `TRANSITIONS` / 账单 `BILLING_STATUSES` | 符合 | `tickets.service.ts:59`、`model/billing/billing.service.ts:31-32`；`order.service.ts:94` 是订单状态机，非重复 |
| 能力清单 17 项 / 13 工作台 / 16 image + 1 video | 符合 | `capabilities/definitions/index.ts:38-56` 及 17 个定义文件 |
| 运行期积分价走 `CreditPriceService.resolve()` | 符合 | `credits/credit-price.service.ts:77 / 90`；其余 `creditCost` 均为任务快照字段 |
| 模型调用唯一链路 `backend/src/model/**` | 代码符合 | 无 `providers/`、无 `GATEWAY_*` 代码消费者（配置残留见 A18） |
| 107 包 / 115 provider、32 页 / 8 分组 | 符合 | 110 个 manifest（排除 3 个 `src-*`）；`adminNav.ts:59` 起 |
| 前端 API 路径 / 参数 / 响应形状 | 逐项一致 | 营销 6 端点 + payments 全端点与 controller / DTO 对拍；`types/payment.ts` 与 `api.d.ts` 无冲突 |
| 组件规范 | 符合 | 审核目录无 `from 'antd'`、无直连 `components/ui`，均从 `~/admin-ui/primitives` 取件；无 `as any` |
| 资金闭环 | 符合 | epay 验签 `timingSafeEqual` + MD5、通知去重、`markPaid` 条件更新与幂等、`PaymentProviderConfig` 密文落库、`secretConfigured` 只回布尔 |
| `eb66b82` 删除完整性 | 符合 | `dist-verify` 全仓仅 5 处命中（4 处 ignore 规则 + 1 处一次性报告）；10 个 R100 脚本旧路径 0 命中；package.json / CI / mjs 相对 import 无悬空 |
| `7bd85ba` 在 HEAD 的存续 | 符合 | 10 个新增符号全部存在且被引用，后续提交为扩展而非回退 |

---

## 五、覆盖与局限

1. **只读**：全程 `git show / log / diff / grep / ls-tree`、Read / Grep / Glob 与只读统计；未执行 `tsc` / `vitest` / `playwright` / `prisma push` / `npm install`，也未修改任何文件。
2. **静态推断边界**：所有「测试红 / 绿」「运行时取值」结论均为静态推断。A01 的测试失败、A02 的存量数据 `NULL`、A04 的返回值、A21 的实例启用状态，均需运行期证据确认。
3. **证据等级**：★ 为主审回读 HEAD 源码核证（P0 全部、P1 全部、P2 中 A05/A06/A10-A13/A15/A16/A18、P3 中 A11/A13 相关、A23/A31）；☆ 为分块审核员核证，主审未逐行复核。
4. **未纳入**：`backend/src/payments/adapters/{sandbox,zpay,paypal,stripe,wechat}.adapter.ts` 的实现细节、`payment-cipher.ts`、模块 DI 装配全文、`docs/payment-refactor-design.md` §16-§24、C 端 checkout 页面逐行、无限画布设计文档（未提交）。
5. **工作区**：审核针对已提交树 `HEAD=9909c17`；`docs/README.md`、`docs/canvas-port-design.md` 的未提交改动与 `docs/canvas-detailed-design.md` 不在范围内。

---

## 六、待批准修复批次

> 当前状态：**停下等待逐项裁定**。未获批前不改任何代码；每批实施结束后再次停下等待确认。

| 批次 | 覆盖编号 | 内容 | 建议门禁 |
|---|---|---|---|
| A · 资金安全 | A01–A04 | 支付开关与测试自洽、易支付历史回调兼容、退款实例透传、USD 口径裁定 | `payment-*.spec.ts`、`payments.integration.spec.ts`、支付域 smoke |
| B · 契约与事实源 | A05–A09、A17–A19 | 契约文档与脚本同步、实例维度差异、单测补齐、游标、重复事实源、ignore、GATEWAY 清理 | `docs/api-contract.md` 对拍、`smoke-payments.js`、全量 spec |
| C · 前端交互与规范 | A10–A16、A20–A30 | 草稿回滚 / 未保存保护、表单校验、深链白名单、去重、字号、限额口径、测试与文案 | 单测 + `admin-marketing.spec.ts` / `admin-ux.spec.ts` + `check-file-size.mjs` |
| D · 文档与清理 | A31–A32 | `CLAUDE.md` 数量口径修正、清理台账重述 | 文档 diff 复核 |

请逐项或逐批给出批准意见（批准 / 驳回 / 需补充证据 / 调整严重级）。
