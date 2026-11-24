# 支付域页面与前端设计

> 状态：后台 `/admin/payments` 与 C 端结算页的实现规格。页面已落地；与代码冲突时以代码为准。
> 设计目标与决策见 [`payment-refactor-design.md`](payment-refactor-design.md)，后端契约见 [`payment-detailed-design.md`](payment-detailed-design.md)。
> 章节号已按本文重排；拆分前的原始编号不再保留。

## 1. 后台页面规格：`/admin/payments`

### 1.1 页面骨架

- 标题与描述随标签切换，文案在 `constants.ts` 的 `PAYMENTS_TAB_COPY`，页签清单在 `PAYMENTS_TABS`。
- **三个标签**：收款设置 / 交易核对 / 异常处理，默认收款设置。
- **URL 是事实源**：`?tab=providers|reconciliation|exceptions`；缺失或非法时 `Navigate` 到 `?tab=providers`。`?tab=reconciliation&runId=<id>` 直接打开明细抽屉，刷新可复原。
- 侧栏在「资金与财务」组下拆三个入口（收款设置 / 交易核对 / 异常处理），都指向同一页面的对应标签；页内标签只负责快速切换。
- 右上角刷新按钮按当前标签重载。
- **本页不提供充值商品表单与支付订单列表**：商品统一由 `/admin/products` 维护，订单与渠道查单 / 关单统一由 `/admin/orders` 维护；两处各有一套字段与动作会让「一边能退款、一边只能查单」分叉。

### 1.2 收款设置（`providers`）

- 渠道卡片展示品牌、`providerId`、支付方式与可运营状态；状态按「能不能收钱」分四档：`usable` / `misconfigured` / `unconfigured` / `disabled`（定义见 `constants.ts`）。
- 渠道实例抽屉：启用开关、关闭分钟、动态配置字段、保存为新版本；`secret` 字段留空表示沿用上一版。
- 可见支付方式卡片：决定 C 端结算页出现哪些支付按钮。
- 接口：`GET /admin/payments/providers`、`POST /admin/payments/providers/:providerId/instances`、`PUT .../instances/:instanceId/config`、`PATCH .../instances/order`、`GET/PUT /admin/payments/settings`。
- 密钥只回显掩码；任何接口都不返回明文，页面不提供明文导出。

### 1.3 交易核对（`reconciliation`）

- 工具栏：渠道、账单日期、执行对账、CSV / ZIP 导入、导出。
- 运行列表：账单日期、渠道、状态、一致、自动补发、异常数、完成时间、明细；点击运行打开明细抽屉。
- 明细：商户单号、渠道交易号、金额、结果（七类）、是否自动补发、本地订单。
- 接口：`POST/GET /admin/payments/reconciliations`、`GET /admin/payments/reconciliations/:id/items`、`POST /admin/payments/reconciliations/import`、`GET .../export.csv`、`GET .../:id/items/export.csv`。
- 超过 10000 行直接报错，不静默截断；日期与 90 天窗口按 Asia/Shanghai 自然日计算。
- 人工处置资金仍走 `/admin/orders`，对账工具只改对账状态与备注。

### 1.4 异常处理（`exceptions`）

- 列表：状态、优先级、渠道、订单号、金额、年龄、最近错误；支持按状态 / 优先级 / 渠道筛选。
- 动作：认领（`claim`）、重试退款（`retry-refund`）、确认退款（`confirm-refund`）、关闭（`close`）；动作后回到原筛选。
- 接口：`GET /admin/payments/exceptions`、`GET /admin/payments/exceptions/:id`、`POST /admin/payments/exceptions/:id/{claim,retry-refund,confirm-refund,close}`。
- 本页不直接改钱：退款仍由订单与退款链路执行，这里只推进异常工单状态。

### 1.5 五态与交互约束

| 状态 | 要求 |
| --- | --- |
| 首次空态 | 各标签给明确空文案；筛选后无结果与从未有数据分开 |
| 加载中 | 骨架或 `SkeletonCards`；刷新保留旧数据 |
| 有数据 | 表格列顺序固定；状态用 `StatusTag`，颜色来自语义映射 |
| 加载失败 | `ListError` + 重试；不清空已展示数据 |
| 无权限 | 侧栏入口隐藏；401 / 403 给可读提示，不渲染半截页面 |

- 不可逆动作（关单、确认退款、关闭异常）必须二次确认并写明影响。
- 订单与商品的完整操作不在本页；页面不出现「退款」按钮，只给 `/admin/orders` 深链。

---

## 2. 前端文件树与模块分层

### 2.1 目录结构

```text
frontend/src/pages/admin/payments/
├── index.ts                        # 唯一出口：export { AdminPaymentsPage }
├── page.tsx                        # 页面壳：标题、三标签、URL 同步、刷新
├── components.ts                   # 目录内控件唯一入口（re-export admin-ui/radar）
├── constants.ts                    # 页签文案、渠道/状态/结果映射
├── types.ts                        # 支付域视图形状
├── api.ts                          # 接口唯一入口（providers / reconciliation / exceptions）
├── hooks.ts                        # useAdminList / useToast / useAdminExport 等再导出
├── utils.ts                        # 派生状态、金额与查询参数工具
├── useDraftList.ts                 # 「草稿 → 应用」两段式列表内核
├── useReconciliationFilters.ts     # 对账筛选 + URL 同步
├── usePaymentExceptionFilters.ts   # 异常筛选 + URL 同步
├── PaymentsProvidersTab.tsx
├── PaymentsProviderCard.tsx
├── PaymentsProviderInstanceEditor.tsx
├── PaymentsProviderInstancesDrawer.tsx
├── PaymentsProviderSummary.tsx
├── PaymentsVisibleMethodsCard.tsx
├── PaymentsReconciliationTab.tsx
├── ReconciliationToolbar.tsx
├── ReconciliationDetailDrawer.tsx
├── PaymentsExceptionPanel.tsx
└── __tests__/
```

### 2.2 模块边界

- 外部只从 `./payments` 取 `AdminPaymentsPage`；目录内文件从 `./components`、`./api`、`./hooks`、`./utils`、`./types`、`./constants` 取共享件，不直连 `~/admin-ui` 或 `src/lib/api`。
- 页面只做标签切换与 URL 同步；业务逻辑在各标签组件里。
- 服务端事实源：`backend/src/admin/payments/payment-admin.controller.ts`（providers / orders / reconciliations / exceptions 四组控制器）。
- 权限：`payment.read` 读；`payment.write` 改渠道配置；`payment.operate` 查单 / 关单；对账沿用 `finance.reconcile`。前端 `can()` 只用于隐藏入口，安全边界在后端。

### 2.3 路由与导航

- `/admin/payments` 挂在 `pages/admin/layout.tsx`，`?tab=` 决定视图。
- 旧 `/admin/payment-channels` → `/admin/payments?tab=providers`；`/admin/reconciliation` → `/admin/payments?tab=reconciliation`，均用 `Navigate` 重定向，不 404。
- 侧栏「资金与财务」组包含收款设置、交易核对、异常处理三个入口，权限均为 `payment.read`。

---


## 3. 状态派生工具与 Prisma where 映射

### 3.1 支付订单展示状态

展示状态不落库。后端在列表/详情投影时计算一次，返回 `status`；前端用同一规则做本地断言，但**不以本地计算覆盖服务端返回值**。

优先级从高到低：

| 顺序 | displayStatus | 判定 | 文案/色调 | 可查单 | 可关单 |
| --- | --- | --- | --- | --- | --- |
| 1 | `closing` | `rawStatus='pending'` 且 `closeStartedAt > now-5min` | 关单中 / warning | ✅ | ✅ |
| 2 | `credited` | `rawStatus='paid'` | 已入账 / success | ❌ | ❌ |
| 3 | `refunded` | `rawStatus='refunded'` | 已退款 / neutral | ❌ | ❌ |
| 4 | `partial_refunded` | `rawStatus='partial_refunded'` | 部分退款 / warning | ❌ | ❌ |
| 5 | `closed` | `rawStatus='cancelled'` | 已关闭 / neutral | ❌ | ❌ |
| 6 | `create_failed` | `rawStatus='pending'` 且 `lastError` 非空，且不在关单租约内 | 下单失败 / danger | ✅ | ✅ |
| 7 | `pending` | `rawStatus='pending'` 且已固定渠道/已生成 checkout，且无 `lastError` | 待支付 / warning | ✅ | ✅ |
| 8 | `created` | 其余 `rawStatus='pending'` | 创建中 / info | ❌ | ✅ |

说明：

- 「已入账」只取 `Order.paidAt`，不新增 `creditedAt`（A5）。
- `refunded` / `partial_refunded` 用 Order 原始状态判断，不用金额二次推断；退款服务已经在同一事务里把状态与 `refundedCents` 对齐。
- `closing` 超过 5 分钟视为租约失效：worker 会回收；前端不应永远显示「关单中」。
- `create_failed` 在用户重新发起成功后必须清除 `lastError`；否则会一直显示失败。
- `canQuery` 还要求存在 `channel` 与可解析配置；`canClose` 还要求订单归属/权限满足。表格中的布尔值是 UI 基线，最终由后端 `actions` 与权限共同裁剪。

伪代码：

```ts
function paymentStatusOf(input: {
  rawStatus: string;
  closeStartedAt: Date | null;
  lastError: string | null;
  providerConfigId: string | null;
  checkoutMode: string | null;
}, now = new Date()): PaymentDisplayStatus {
  if (input.rawStatus === 'paid') return 'credited';
  if (input.rawStatus === 'refunded') return 'refunded';
  if (input.rawStatus === 'partial_refunded') return 'partial_refunded';
  if (input.rawStatus === 'cancelled') return 'closed';
  if (input.rawStatus !== 'pending') return 'created'; // 未知 raw 状态不静默吞掉
  if (input.closeStartedAt && input.closeStartedAt > new Date(now.getTime() - 5 * 60_000)) {
    return 'closing';
  }
  if (input.lastError) return 'create_failed';
  if (input.providerConfigId || input.checkoutMode) return 'pending';
  return 'created';
}
```

### 3.2 展示状态 → Prisma `where`

先定义固定基线。**租约边界必须每次请求重新计算**：`closeLease` 若写成模块顶层常量，会冻结在进程启动时刻，运行几分钟后所有「关单中」都变成历史状态。

```ts
const PRODUCT_ORDER_BASE = { items: { some: {} } } satisfies Prisma.OrderWhereInput;
const CLOSE_LEASE_MS = 5 * 60_000;

export function closeLeaseOf(now: Date): Date {
  return new Date(now.getTime() - CLOSE_LEASE_MS);
}
```

`paymentOrderWhere(status, closeLease)` 返回下面的条件。外层由 `buildAdminPaymentOrderWhere(q, now = new Date())` 把它和商品订单基线一起放进 `AND` 数组，禁止直接 spread 造成键覆盖；列表、`count`、导出共用同一个 `now` 和同一个 builder，避免分页途中状态边界漂移：

```ts
export function paymentOrderWhere(
  status: PaymentDisplayStatus,
  closeLease: Date,
): Prisma.OrderWhereInput {
  switch (status) {
    case 'credited':
      return { status: 'paid' };

    case 'refunded':
      return { status: 'refunded' };

    case 'partial_refunded':
      return { status: 'partial_refunded' };

    case 'closed':
      return { status: 'cancelled' };

    case 'closing':
      return { status: 'pending', closeStartedAt: { gt: closeLease } };

    case 'create_failed':
      return {
        status: 'pending',
        lastError: { not: null },
        OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }],
      };

    case 'created':
      return {
        status: 'pending',
        providerConfigId: null,
        checkoutMode: null,
        lastError: null,
        OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }],
      };

    case 'pending':
      return {
        status: 'pending',
        lastError: null,
        OR: [{ providerConfigId: { not: null } }, { checkoutMode: { not: null } }],
        AND: [{ OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }] }],
      };

    default:
      throw new AppError(40001, '订单状态筛选值非法', 400);
  }
}
```

注意：

- Prisma 同一对象同时出现顶层 `OR` 与 `AND` 是合法且为「AND 合并」；代码评审时优先写 `AND: [...]` 数组，保持可读。
- `lastError: { not: null }` 在 SQLite 仍会命中空串。写入层已把空串归一化为 `null`（见 §3.6），但迁移期旧数据可能残留空串。**必须先跑 [`payment-detailed-design.md`](payment-detailed-design.md) §6.8 第 6 步清洗**；若不能清洗，`create_failed / created / pending` 三个分支都要把 `lastError` 条件改成「null 或空串」，只改 `create_failed` 会让订单从三个状态里同时消失。
- `closing` 与 `create_failed` 的边界用 `gt` / `lte` 严格互补，恰好 5 分钟的订单归入「失败/普通 pending」，不会两边都不命中。

### 3.3 关键字、渠道与时间映射

```ts
const keyword = q.keyword?.trim();
const keywordWhere = keyword ? {
  OR: [
    { orderNo: { contains: keyword } },
    { providerTradeNo: { contains: keyword } },
    { userId: { equals: keyword } },
    { user: { is: { OR: [
      { name: { contains: keyword } },
      { email: { contains: keyword } },
    ] } } },
    { items: { some: { nameSnapshot: { contains: keyword } } } },
  ],
} : {};

const channelWhere = q.providerId ? { channel: q.providerId } : {};

const timeWhere = (() => {
  if (!q.from && !q.to) return {};
  const field = q.timeField === 'paid' ? 'providerPaidAt'
    : q.timeField === 'credited' ? 'paidAt'
    : 'createdAt';
  return { [field]: { gte: startOfShanghaiDay(q.from), lte: endOfShanghaiDay(q.to) } };
})();
```

边界规则：

- `from` 缺省且 `to` 有值：从 `to` 当天 00:00 起算不合理，按「不限制开始」处理；`to` 缺省则「不限制结束」。两者都有时要求 `from <= to`。
- `providerPaidAt` 对历史空值不 fallback 到 `paidAt`；否则「支付时间」与「入账时间」筛选结果相同，失去区分意义。旧数据回填见 [`payment-detailed-design.md`](payment-detailed-design.md) §6.8。
- `keyword` 上限 120；只通过 Prisma `contains` 交给参数化 LIKE，不拼 SQL。用户输入里的 `%` / `_` 仍会被 SQLite LIKE 当通配符解释 —— 不是注入，但会扩大匹配面；要么在 DTO 层拒绝这两个字符，要么在搜索框提示「支持部分匹配」，不要为此手写 `$queryRaw`。SQLite 默认 ASCII 大小写不敏感；中文按原样匹配，Prisma SQLite 也不支持 `mode: 'insensitive'`。
- `sort` 白名单：`createdAt / providerPaidAt / paidAt / amountCents`；方向缺省 `desc`。其它值返回 `40001`，不能把字段名原样拼进 SQL。

> 上面的代码只表达口径；最终实现以 4.2 的单边日期处理和 4.7 的精确+部分匹配版本为准，避免 `gte: undefined` 与重复 OR 分支。

### 3.4 商品销售状态

| saleStatus | 判定 | 文案 | 色调 | canPurchase |
| --- | --- | --- | --- | --- |
| `disabled` | `status!='active'` | 已停用 | neutral | false |
| `upcoming` | `timed` 且 `now < saleStartAt` | 待发售 | info | false |
| `ended` | `timed` 且 `now > saleEndAt` | 已结束 | warning | false |
| `sold_out` | `inventory` 且 `stockRemaining<=0` | 已售罄 | warning | false |
| `on_sale` | 其余 active 商品 | 销售中 | success | 再校验周期次数/币种渠道 |

`canPurchase` 最终还受：

- 商品币种存在可用渠道（USD 尤其）；
- `periodic` 的窗口购买次数未用尽；
- `inventory` 的 `stockRemaining >= quantity`；
- 用户未被禁用；
- 订单金额 > 0（0 元商品继续走原有免费领取入口）。

页面的「销售中」不等于可购买：按钮启用条件以 `canPurchase` 为准，不能只看 `status='active'`。

### 3.5 对账展示状态

运行状态：

| status | 文案 | 色调 | 明细可看 | 明细可导出 |
| --- | --- | --- | --- | --- |
| `running` | 执行中 | info | ✅（当前已写入的行） | ❌ |
| `completed` | 已完成 | success | ✅ | ✅ |
| `failed` | 失败 | danger | ✅（可能为空） | ❌ |

明细结果：`matched / recovered / local_order_not_found / provider_record_missing / amount_mismatch / trade_no_mismatch / duplicate_charge / credit_failed`。同一商户订单号出现第二个不同渠道交易号时必须落 `duplicate_charge`，不能被后一条账单覆盖；完全相同的交易号重复导出行按账单重复行忽略。`result=abnormal` 不是数据库值，只是查询别名。

`resolved` 在自动对账结果里表示「本次运行已自动处理」，不是人工结案；页面主列展示 `result`，`resolved` 只在说明中体现。人工处置仍走 `/admin/orders`，避免对账工具直接改钱。

### 3.6 空值、空串与终态语义

| 字段 | `null` | 空串 `''` | 终态要求 |
| --- | --- | --- | --- |
| `Order.checkoutValue` | 从未生成过支付动作（历史/0 元单） | 曾生成但已失效/清空 | 已到账/已关闭/已退款必须为 `''` |
| `Order.lastError` | 无错误 | 非法；写入前归一化为 `null` | 支付成功后 `null` |
| `Order.providerTradeNo` | 尚未拿到渠道交易号 | 非法；归一化为 `null` | 已支付必须有值（free/manual 也写前缀号） |
| `Order.providerStatus` | 渠道未返回 | 允许；展示时当 `—` | 不参与本地状态机 |
| `Order.closedAt` | 未关闭 | 不适用 | `cancelled` 必须有值 |
| `Order.providerPaidAt` | 渠道未给支付时间 | 不适用 | 已支付尽量有值，缺失时详情显示 `—` |
| `Payment.payTransactionId` | pending 尝试 | 非法；归一化为 `null` | succeeded 必须唯一非空 |
| `Payment.lastError` | 无错误 | 非法；归一化为 `null` | failed 尽量有值 |
| `PaymentNotification.lastError` | 无错误 | 非法；归一化为 `null` | failed 必须有值 |
| `PaymentReconciliationRun.error` | 无错误 | 非法；归一化为 `null` | failed 必须有值 |
| `PaymentReconciliationItem.detail` | 无补充 | 允许；前端显示默认说明 | — |
| `config.values[secret]` | 不存在 | 保存时表示「沿用上一版」 | 不允许删除 secret |

序列化时统一把空串规范成 `null`（除 `checkoutValue` 有明确空串语义外）；后端 DTO 用 `@Transform(({value}) => value === '' ? null : value)`，不要靠前端自觉。

### 3.7 金额与币种不变量

- 一个订单只有一个币种；商品、支付尝试、对账明细的币种必须与订单一致。
- 不做汇率换算；USD 商品只能用支持 USD 的渠道，CNY 商品只能用支持 CNY 的渠道。
- 金额始终为整数最小单位；比较时严格 `===`，不做浮点容差。
- `Order.paidCents` 是实付；`Payment.amountCents` 必须等于实付，不是原价。
- 0 元单只允许 `mode='free'`，不创建 pending Payment，不调渠道。
- 退款不改变 `Payment.amountCents`；以 `Order.refundedCents` 与 Refund 表为准。

## 4. 列表查询落地：投影、排序、分页与导出

3 只定义了「展示状态 → where」。这一节把 where 变成可上线的查询实现，明确列表、计数、导出必须共用同一套条件，避免三处各写一份后筛选结果对不上。

### 4.1 单一 where builder

```ts
// backend/src/admin/payments/payment-query.ts
export interface AdminPaymentOrderQuery {
  status?: PaymentDisplayStatus;
  keyword?: string;
  providerId?: string;
  timeField?: 'created' | 'paid' | 'credited';
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sort?: string;
}

export function buildAdminPaymentOrderWhere(
  q: AdminPaymentOrderQuery,
  now = new Date(),
): Prisma.OrderWhereInput {
  const parts: Prisma.OrderWhereInput[] = [{ items: { some: {} } }];

  if (q.status) parts.push(paymentOrderWhere(q.status, closeLeaseOf(now)));
  if (q.providerId) parts.push({ channel: q.providerId });
  const keyword = normalizeKeyword(q.keyword);
  if (keyword) parts.push(paymentKeywordWhere(keyword));
  const range = shanghaiDayRange(q.from, q.to);
  if (range) parts.push({ [timeFieldColumn(q.timeField)]: range });

  return { AND: parts };
}
```

约束：

- 只返回 `Prisma.OrderWhereInput`，不执行查询；列表、`count`、导出、测试都调用它，禁止复制条件。
- `providerId` 先对照适配器注册表白名单（`sandbox / alipay / wechat`），未知值 `40001`，不要静默返回空列表。
- `status` 先按 8 个展示状态白名单校验，未知值 `40001`。
- `timeField` 缺省 `created`；非法值 `40001`。
- `keyword` 去首尾空格、限 120 字符；空串不加入 `AND`，避免生成无意义的 `contains: ''`。
- 所有子条件都进 `AND` 数组；子条件内部的 `OR` 不会互相覆盖。

### 4.2 时间边界

```ts
export function shanghaiDayRange(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const start = from ? startOfShanghaiDay(from) : undefined;
  const end = to ? endOfShanghaiDay(to) : undefined;
  if (start && end && start > end) {
    throw new AppError(40001, '开始日期不能晚于结束日期', 400);
  }
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}
```

规则：

- `startOfShanghaiDay / endOfShanghaiDay` 接收 `YYYY-MM-DD` 字符串并在内部调用 `parseDateStrict`；后者只接受 `YYYY-MM-DD`，并用「解析后回写字符串是否相同」校验真实日历日；`2026-02-30` 必须 `40001`，不能靠 `new Date()` 自动滚到 3 月。
- 时区固定 `Asia/Shanghai`（当前无夏令时，可按 `+08:00` 计算）：`from` 取当天 `00:00:00.000`，`to` 取当天 `23:59:59.999`。
- 只有 `from` 时只加 `gte`；只有 `to` 时只加 `lte`；同一天允许（`gte 00:00` + `lte 23:59:59.999`）。
- `timeField` 映射固定：`created → createdAt`、`paid → providerPaidAt`、`credited → paidAt`。
- `providerPaidAt` 为空的历史订单不会命中 `paid` 时间筛选，**不 fallback 到 `paidAt`**；否则「支付时间」和「入账时间」两个口径会得到同一批结果，筛选失去意义。

### 4.3 排序与分页稳定性

```ts
const SORT_COLUMNS = {
  createdAt: 'createdAt',
  providerPaidAt: 'providerPaidAt',
  paidAt: 'paidAt',
  amountCents: 'paidCents',
} as const;

export function orderByOf(sort?: string): Prisma.OrderOrderByWithRelationInput[] {
  const parts = (sort ?? 'createdAt:desc').split(':');
  if (parts.length > 2) throw new AppError(40001, '排序字段非法', 400);
  const [field, direction = 'desc'] = parts;
  const column = SORT_COLUMNS[field as keyof typeof SORT_COLUMNS];
  if (!column || (direction !== 'asc' && direction !== 'desc')) {
    throw new AppError(40001, '排序字段非法', 400);
  }
  const dir = direction as Prisma.SortOrder;
  const nullable = column === 'providerPaidAt' || column === 'paidAt';
  return [
    nullable ? { [column]: { sort: dir, nulls: 'last' } } : { [column]: dir },
    { id: 'asc' }, // 同时间戳的稳定次序，避免翻页重复/漏行
  ] as Prisma.OrderOrderByWithRelationInput[];
}
```

规则：

- 默认 `createdAt:desc`；金额排序按 `paidCents`，依赖 [`payment-detailed-design.md`](payment-detailed-design.md) §6.8 的历史回填，否则旧支付单会全部按 0 排在最后。
- `nulls: 'last'` 只对可空列（`providerPaidAt / paidAt`）使用；`createdAt`、`paidCents` 非空，传 `SortOrderInput` 会过不了 Prisma 类型，必须走普通 `SortOrder` 分支。
- 必须带次排序 `id`。仅按 `createdAt` 排序时，同一毫秒创建的多笔订单在 `LIMIT/OFFSET` 下可能跨页重复或漏掉。
- `sort` 只接受 `field:asc|desc`；不接受空方向、额外冒号、SQL 片段。方向缺省按 `desc` 只用于兼容旧链接，新前端始终显式传。

### 4.4 列表投影与 N+1

列表只取页面用到的字段，禁止 `include: { items: { include: { product: true } }, user: true, payments: true }`：

```ts
const ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  userId: true,
  channel: true,
  status: true,
  totalCents: true,
  discountCents: true,
  paidCents: true,
  refundedCents: true,
  currency: true,
  providerConfigId: true,
  providerConfigVersion: true,
  providerTradeNo: true,
  providerStatus: true,
  checkoutMode: true,
  checkoutValue: true,
  checkoutExpiresAt: true,
  providerPaidAt: true,
  paidAt: true,
  closedAt: true,
  lastError: true,
  closeStartedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true } },
  items: {
    select: { nameSnapshot: true, creditsSnapshot: true, quantity: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.OrderSelect;
```

派生字段：

- `productName`：`items[0].nameSnapshot`；多商品订单显示 `{首项} 等 {items.length} 项`，不 join `Product`（历史快照才是事实）。
- `credits`：未支付用 `Σ creditsSnapshot × quantity`；已支付/已退款用 `Order.grantedCredits`（退款回收后可能与快照不同）。
- `amountCents`：`paidCents > 0 ? paidCents : max(totalCents - discountCents, 0)`，兼容未回填的历史单；0 元免费单保持 0。
- `user` 缺失时返回 `null`，前端显示「用户不存在」+ 截断 `userId`，不能因为关联缺失让整行消失。
- 列表不返回 `payments`；详情才返回最近 50 条支付尝试（`orderBy createdAt desc, take 50`），超过时页面注明「仅显示最近 50 次」。
- 任何响应都不返回 `rawPayload / configCipher / payloadCipher / secret`。

`productName` 的 `items` 全量加载只在单订单商品数很大时才有成本；本仓库充值订单通常 1–3 项。若未来出现批量下单，可改为 `_count` + `take: 1`，但仍禁止 join `Product`。

### 4.5 分页与计数

```ts
const page = q.page;              // DTO: @IsInt @Min(1) @Max(10000)
const pageSize = q.pageSize;      // DTO: @IsInt @Min(1) @Max(100)
const where = buildAdminPaymentOrderWhere(q);

const total = await prisma.order.count({ where });
const skip = (page - 1) * pageSize;
if (total === 0 || skip >= total) {
  return { items: [], total, page, pageSize };
}
const rows = await prisma.order.findMany({
  where,
  select: ORDER_LIST_SELECT,
  orderBy: orderByOf(q.sort),
  skip,
  take: pageSize,
});
return { items: rows.map(toAdminPaymentOrderRow), total, page, pageSize };
```

- 先 `count` 再 `findMany`：页码超出总页数时直接返回空页，避免 `OFFSET` 很大时仍扫表；不返回 400，删除数据后刷新不应报错。
- `count` 与 `findMany` 之间新订单插入可能让边界轻微漂移；后台列表接受这一点。若要求严格快照，再包 `$transaction([count, findMany])`，但不要为此加锁。
- `pageSize` 非法（非整数、0、>100）走 DTO 校验 `40001`，不静默截断；页码同理。
- 订单默认 30，运行列表默认 30，对账明细默认 50；对应 DTO 默认值与前端首屏参数必须一致，避免首屏请求 20、刷新后变 30。

### 4.6 索引落地

[`payment-detailed-design.md`](payment-detailed-design.md) §6.2 需要补齐以下索引（已有项不重复加）：

```prisma
  @@index([providerPaidAt])
  @@index([channel, providerPaidAt])
  @@index([channel, paidAt])
  @@index([status, paidAt])
```

对应关系：

| 查询 | 命中索引 |
| --- | --- |
| 默认 `createdAt desc` | `[createdAt]`、`[status, createdAt]` |
| 状态 + 创建时间 | `[status, createdAt]` |
| 渠道 + 创建时间 | `[channel, status, createdAt]`（最左 `channel` 可用） |
| 支付时间筛选/排序 | 新增 `[providerPaidAt]`、`[channel, providerPaidAt]` |
| 入账时间筛选/排序 | `[paidAt]`、`[status, paidAt]`、新增 `[channel, paidAt]` |
| 精确订单号/交易号 | `orderNo`、`providerTradeNo` 唯一索引 |
| 用户 ID 精确搜索 | `[userId, status]` 的最左 `userId` |

`keyword` 的 `contains` 会产生前导通配符，B-tree 索引帮不上；当前规模先接受在状态/时间过滤后的扫描。订单量超过 10 万再评估 SQLite FTS5，不在本轮引入。`create_failed` 的 `lastError` 过滤选择性很低，不单独加索引。

### 4.7 关键字匹配

```ts
function paymentKeywordWhere(keyword: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { orderNo: { equals: keyword } },
      { providerTradeNo: { equals: keyword } },
      { orderNo: { contains: keyword } },
      { providerTradeNo: { contains: keyword } },
      { userId: { equals: keyword } },
      { user: { is: { OR: [
        { name: { contains: keyword } },
        { email: { contains: keyword } },
      ] } } },
      { items: { some: { nameSnapshot: { contains: keyword } } } },
    ],
  };
}
```

- 先放精确匹配，给 SQLite 优化器留出用唯一索引的机会；后面的 `contains` 负责部分匹配。
- 不把用户输入拼进 `$queryRaw`；Prisma 参数化会处理引号与注入。
- `%` / `_` 仍是 LIKE 通配符（见 3.3）；如果产品要求「标点按字面匹配」，必须在 DTO 层拒绝并给出明确文案，不能只在前端替换。
- `normalizeKeyword` 只做 `trim()` 和长度校验；不合并内部空格，不改变大小写。SQLite 对 ASCII 大小写不敏感、对中文按原样匹配；不要写 `mode: 'insensitive'`（SQLite connector 不支持）。
- `keyword` 命中不会绕过权限与固定条件 `items: { some: {} }`；会员订单仍不混入。

### 4.8 导出

```ts
const EXPORT_LIMIT = 10_000;
const rows = await prisma.order.findMany({
  where: buildAdminPaymentOrderWhere(q), // 忽略 page/pageSize
  select: ORDER_EXPORT_SELECT,
  orderBy: orderByOf(q.sort),
  take: EXPORT_LIMIT + 1,
});
const truncated = rows.length > EXPORT_LIMIT;
if (truncated) res.setHeader('X-Export-Truncated', 'true');
sendCsv(res, 'payment-orders', toCsv(PAYMENT_ORDER_CSV_COLUMNS, rows.slice(0, EXPORT_LIMIT)));
```

- 导出与列表共用 `where` 和 `orderBy`，只忽略分页；不允许导出接口单独实现一套筛选。
- 多取 1 行判断截断，响应头 `X-Export-Truncated: true`；前端可在 toast 提示「已导出前 10000 行」。不要往 CSV 里插说明行，否则列数会错。
- `sendCsv` 内部已处理 UTF-8 BOM、公式注入与文件名；不要再手写 `Content-Disposition`。
- 导出列按 [`payment-detailed-design.md`](payment-detailed-design.md) §7.6；金额用 `effectiveAmountCents`，状态用展示状态文案，时间按 `Asia/Shanghai` 格式化。
- 必须挂 `@RequireAllPermissions('payment.read', 'data.export')`；导出日志记录筛选条件摘要，不记录密钥、checkout URL、完整用户邮箱列表。
- 前端在「草稿与应用值不同」时禁用导出，后端仍以实际 query 为准，不能信任前端。

### 4.9 查询层测试清单

| 用例 | 断言 |
| --- | --- |
| 8 个展示状态 ↔ where | 构造每种状态的订单 fixture，`findMany(where)` 的 id 集合与 `paymentStatusOf` 结果一致 |
| 5 分钟边界 | `closeStartedAt = now-5min` 不归 `closing`；`now-5min+1ms` 归 `closing` |
| `lastError` 空串 | 迁移前空串不应显示为「下单失败」，或迁移脚本先清洗为 `null` |
| 日期 | 仅 from / 仅 to / 同一天 / 非法日历日 / from>to |
| 排序 | 非法字段 `40001`；`providerPaidAt` 空值排最后；同时间戳按 id 稳定 |
| 分页 | 页码超出总页数返回空 items；pageSize=101 `40001`；page=0 `40001` |
| 关键字 | 订单号、交易号、姓名、邮箱、商品名、用户 ID 均可命中；空串不产生条件 |
| 导出 | 10001 行只输出 10000 行并带截断头；0 行时前端禁用、后端仍返回表头 |
| 索引 | `PRAGMA index_list('Order')` 包含 4.6 的新索引；`EXPLAIN QUERY PLAN` 抽查状态+时间与渠道+时间 |

### 4.10 实现顺序

1. 先落 `payment-query.ts` 的纯函数与表驱动单测，不接控制器；确保 8 个展示状态与 where 一一对应。
2. 再接 `GET /orders` 与 `count`，用手工 fixture 对比列表 id 与 `paymentStatusOf`；此时不接导出。
3. 详情投影单独实现，确认 `payments` 只取最近 50 条且不含 `rawPayload`。
4. 最后接导出，复用同一 builder；补 10001 行截断测试与导出断言。
5. 上线前跑 `PRAGMA index_list('Order')` 与 `EXPLAIN QUERY PLAN`，确认新索引真实生效；SQLite 不会因为 Prisma schema 写了索引就自动重建，必须实际应用迁移（`npm run db:migrate:deploy`）。

## 5. 与参考页的偏差登记

### 5.1 基线

- 参考文件：`open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx`。
- 本仓库只复刻「收款设置 / 交易核对 / 异常处理」三块的信息架构与可操作项；充值商品与支付订单分别落在 `/admin/products`、`/admin/orders`，不在本页复刻。
- 视觉使用 shadcn + `admin-ui/radar` 原语，不追求像素级一致。

### 5.2 有意偏差

| 偏差 | 本仓库做法 | 原因 |
| --- | --- | --- |
| 标签数量 | 三标签（收款 / 核对 / 异常） | 商品与订单与其它后台页同源，混排会让字段与动作分叉 |
| 通知条 | 「退款请到订单管理」 | 本仓库退款完整存在，照抄「平台不提供退款」会误导运营 |
| 渠道副行 | 去掉插件副行，保留配置完整度副行 | 本仓库没有支付插件运行时 |
| 商品抽屉 | 不在本页 | 商品统一走 `/admin/products` |
| 订单详情 | 跳 `/admin/orders?orderNo=...` | 订单页已有退款、开票与完整动作 |
| 日期控件 | 原生 `input type=date` | 不引入额外日期库 |

### 5.3 不可偏差清单

- 页面不提供退款按钮；任何资金动作都回到订单管理。
- 密钥永不回显明文；配置保存生成新版本。
- 超过导出上限必须报错，不静默截断。
- 旧路由必须重定向，不能让告警深链 404。
