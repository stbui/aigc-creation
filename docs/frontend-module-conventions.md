# 前端功能目录分层约定

状态：现行（与 `frontend/src/pages/admin/channels/`、`frontend/src/pages/admin/payments/`、
`frontend/src/pages/admin/credits/`、`frontend/src/pages/admin/tasks/`、
`frontend/src/pages/admin/orders/`、`frontend/src/pages/admin/users/`、
`frontend/src/pages/admin/assets/`、`frontend/src/pages/admin/tickets/`、
`frontend/src/pages/admin/logical-models/`、`frontend/src/pages/admin/plugins/`、
`frontend/src/pages/admin/coupons/`、`frontend/src/pages/admin/aigc-label/`、
`frontend/src/pages/admin/billing-orders/`、`frontend/src/pages/admin/campaigns/`、
`frontend/src/pages/admin/user-groups/`、`frontend/src/pages/admin/membership-plans/`、
`frontend/src/pages/admin/products/`、`frontend/src/pages/admin/backups/`、`frontend/src/pages/product-detail/`、`frontend/src/pages/product-kit/`、`frontend/src/pages/viral-clone/`、`frontend/src/pages/creative-image/`、`frontend/src/pages/product-sku/`、`frontend/src/pages/local-redraw/`、`frontend/src/pages/background-remove/`、`frontend/src/pages/watermark-remove/`、`frontend/src/pages/product-retouch/`、`frontend/src/pages/image-translate/`、`frontend/src/pages/image-expand/`、`frontend/src/pages/product-recolor/`、`frontend/src/pages/rotate-angle/`、`frontend/src/pages/multi-image-fusion/`、`frontend/src/pages/account/`、`frontend/src/pages/checkout/` 同步维护）。

适用于 `frontend/src/pages/**` 下**多文件**的功能目录。单文件页面不强制套用；
当页面长到需要拆分时，按本约定落位。参考实现见
[`frontend/src/pages/admin/channels/`](../frontend/src/pages/admin/channels/)、
[`frontend/src/pages/admin/payments/`](../frontend/src/pages/admin/payments/)（后台；
后者是**多标签页**形态：`page.tsx` 只做标签切换与 URL 同步，四个标签各自
一个 `<业务组件>.tsx`，状态文案与动作判定放在 `constants.ts`，金额/积分等
展示函数放在 `utils.ts`）
与 [`frontend/src/pages/product-detail/`](../frontend/src/pages/product-detail/)、
[`frontend/src/pages/product-kit/`](../frontend/src/pages/product-kit/)、
[`frontend/src/pages/viral-clone/`](../frontend/src/pages/viral-clone/)、
[`frontend/src/pages/creative-image/`](../frontend/src/pages/creative-image/)、
[`frontend/src/pages/product-sku/`](../frontend/src/pages/product-sku/)、
[`frontend/src/pages/local-redraw/`](../frontend/src/pages/local-redraw/)、
[`frontend/src/pages/background-remove/`](../frontend/src/pages/background-remove/)、
[`frontend/src/pages/watermark-remove/`](../frontend/src/pages/watermark-remove/)、
[`frontend/src/pages/product-retouch/`](../frontend/src/pages/product-retouch/)、
[`frontend/src/pages/image-translate/`](../frontend/src/pages/image-translate/)、
[`frontend/src/pages/image-expand/`](../frontend/src/pages/image-expand/)、
[`frontend/src/pages/product-recolor/`](../frontend/src/pages/product-recolor/)、
[`frontend/src/pages/rotate-angle/`](../frontend/src/pages/rotate-angle/)、
[`frontend/src/pages/multi-image-fusion/`](../frontend/src/pages/multi-image-fusion/)、
[`frontend/src/pages/account/`](../frontend/src/pages/account/)、
[`frontend/src/pages/checkout/`](../frontend/src/pages/checkout/)（C 端）。

## 1. 目录形态

```
pages/admin/channels/
├── index.ts          # 对外唯一出口
├── page.tsx          # 页面编排与写操作
├── components.ts     # 外部 UI 控件入口（唯一）
├── api.ts            # 外部接口入口（唯一）+ 本目录取数组合
├── hooks.ts          # 外部 hook 入口（唯一）+ 本目录 hooks
├── utils.ts          # 外部工具入口（唯一）+ 本目录纯函数
├── constants.ts      # 常量、类型、默认值
├── <业务组件>.tsx     # 本目录自己的板块组件
└── __tests__/        # 与实现同目录的 Vitest 用例
```

文件名固定小写的有 7 个：`index.ts` / `page.tsx` / `components.ts` / `api.ts` /
`hooks.ts` / `utils.ts` / `constants.ts`。业务组件用 `PascalCase.tsx`，文件名即组件名。

## 2. 每个入口的职责

| 文件 | 放什么 | 不放什么 |
| --- | --- | --- |
| `index.ts` | 目录对外导出 | 业务逻辑；内部文件互链 |
| `page.tsx` | 页面编排、路由级状态、写操作（提交 / 删除 / 启停） | 可复用的取数与纯函数 |
| `components.ts` | 从 `src/admin-ui` / `src/components` / `src/vendor` 转出的共享控件与类型 | 本目录自己的业务组件（会形成循环引用） |
| `api.ts` | 从 `src/lib/api` 转出的接口对象；只服务本目录的分页 / 聚合取数 | 组件、hook、纯函数 |
| `hooks.ts` | 从 `src/admin-ui/providers` / `src/context` / `src/hooks` / `src/components` 转出的 hook；本目录自有的数据 hook | 组件、接口实现 |
| `utils.ts` | 从 `src/lib/*` 转出的工具；本目录纯函数（不依赖 React） | 组件、hook、状态 |
| `constants.ts` | 选项表、默认值、草稿类型、健康汇总等结构类型 | 函数、请求、组件 |
| `<业务组件>.tsx` | 本目录独占的展示与交互 | 外部依赖直连（走入口） |

各入口文件顶部写清职责与「新增引用时在这里补一行 re-export」。

## 3. 导入方向

目录内文件按类别从入口取，不直连外部目录：

```ts
import { Button, SelectBox, Panel } from './components';   // UI 控件
import { adminChannelsApi } from './api';                  // 后端接口
import { useToast, useChannelList } from './hooks';        // hook
import { priceOf, formatRate } from './utils';             // 纯函数 / src/lib 工具
import { EMPTY_CHANNEL_DRAFT, type ChannelDraft } from './constants'; // 常量与类型
```

- 不直接引 `src/admin-ui` / `src/components` / `src/vendor` / `src/context` /
  `src/hooks` / `src/lib`（只有入口文件可以）。
- `src/types/model` 是例外：纯类型模块，不产生运行期依赖，各文件直接
  `import type`，不必再包一层。
- **第三方库（lucide-react / react-router-dom）不经入口转出** —— 它们不是本项目的
  共享控件，直接引即可（`channels/` 与 `product-detail/` 一致）。项目 UI 控件统一从
  `src/admin-ui/primitives` 取件，不从模块入口再包一层。
- 入口之间是单向的：`utils` → `constants`；`hooks` → `api` / `constants`；
  `constants` → `components`（只取选项类型）。业务组件与 `page` 可以依赖全部入口；
  `index` 只依赖 `page`。
- 目录内相对导入一律 `./X`；不使用 `../` 跳出目录（入口文件引外部时除外）。

## 4. 新增文件落位

| 要加的东西 | 放哪 |
| --- | --- |
| 只在本目录用的展示 / 交互 | 新建 `PascalCase.tsx` |
| 需要新的外部 UI 控件 | 先在 `components.ts` 补 re-export |
| 需要新的后端接口 | 先在 `api.ts` 补转出或封装 |
| 需要新的外部 hook / provider | 先在 `hooks.ts` 补 re-export |
| 需要新的 `src/lib/*` 工具 | 先在 `utils.ts` 补 re-export |
| 新的常量、选项表、默认值、结构类型 | `constants.ts` |
| 新的纯函数（无 React） | `utils.ts` |
| 多组件共用的取数逻辑 | `hooks.ts`，或独立 `useXxx.ts` 只在本目录引用 |

## 5. 校验

- `frontend/src/test/namedImportAudit.ts` 是共用的对账实现（读源码核对具名导入，
  缺失名字在 Vite 下只会变成 `undefined`，表现为整块页面白屏，单文件转译与
  Vitest 都发现不了）。两侧用例：
  - `frontend/src/pages/admin/__tests__/admin-modules.test.ts` —— 后台目录
    （`src/admin-ui` / `src/components/admin` / `src/pages/admin`）；
  - `frontend/src/pages/product-detail/__tests__/product-detail-modules.test.ts` ——
    C 端详情图目录（`src/pages/product-detail` / `src/components` / `src/hooks` / `src/lib` /
    `src/context`）；
  - `frontend/src/pages/product-kit/__tests__/product-kit-modules.test.ts` ——
    C 端主图目录（`src/pages/product-kit` / `src/components` / `src/hooks` / `src/lib` /
    `src/context`）；
  - `frontend/src/pages/viral-clone/__tests__/viral-clone-modules.test.ts` ——
    C 端爆款复刻目录（`src/pages/viral-clone` / `src/components` / `src/hooks` / `src/lib` /
    `src/context`）；
  - `frontend/src/pages/creative-image/__tests__/creative-image-modules.test.ts` ——
    C 端创意生图 / 自由创作目录（`src/pages/creative-image` / `src/components` /
    `src/hooks` / `src/lib` / `src/context`）；
  - `frontend/src/pages/product-sku/__tests__/product-sku-modules.test.ts` ——
    C 端商品 SKU 图目录（`src/pages/product-sku` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`）；
  - `frontend/src/pages/local-redraw/__tests__/local-redraw-modules.test.ts` ——
    C 端局部重绘目录（`src/pages/local-redraw` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含本页画布组件 `MaskPainter` 与页面的导入）；
  - `frontend/src/pages/background-remove/__tests__/background-remove-modules.test.ts` ——
    C 端一键抠图目录（`src/pages/background-remove` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含本页原图预览组件 `BackgroundSourcePreview` 与页面的导入）；
  - `frontend/src/pages/watermark-remove/__tests__/watermark-remove-modules.test.ts` ——
    C 端去除水印目录（`src/pages/watermark-remove` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含页面对 `WatermarkMaskEditor` 遮罩画布的导入）；
  - `frontend/src/pages/product-retouch/__tests__/product-retouch-modules.test.ts` ——
    C 端产品精修目录（`src/pages/product-retouch` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`）；
  - `frontend/src/pages/image-translate/__tests__/image-translate-modules.test.ts` ——
    C 端图片翻译目录（`src/pages/image-translate` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含语言清单 `lib/optionSets` 的转出）；
  - `frontend/src/pages/image-expand/__tests__/image-expand-modules.test.ts` ——
    C 端智能扩图目录（`src/pages/image-expand` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含 placement 几何 `lib/expandGeometry` 的转出）；
  - `frontend/src/pages/product-recolor/__tests__/product-recolor-modules.test.ts` ——
    C 端商品换色目录（`src/pages/product-recolor` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`）；
  - `frontend/src/pages/rotate-angle/__tests__/rotate-angle-modules.test.ts` ——
    C 端旋转角度目录（`src/pages/rotate-angle` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`）；
  - `frontend/src/pages/multi-image-fusion/__tests__/multi-image-fusion-modules.test.ts` ——
    C 端多图融合目录（`src/pages/multi-image-fusion` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含变体计费 `lib/multiFusionBilling` 的转出）；
  - `frontend/src/pages/account/__tests__/account-modules.test.ts` ——
    C 端账户中心目录（`src/pages/account` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，多接口并行取数与金额 / 日期格式化；页面按板块拆成
    `AccountIdentityCard` / `AccountAssetsCard` / `AccountStatsCard` /
    `AccountOrdersCard` / `AccountMessagesCard` / `AccountSecurityCard` 六个展示卡
    与 `AccountPasswordModal` / `AccountDeleteModal` 两个弹窗，状态仍留在 `page.tsx`）；
  - `frontend/src/pages/checkout/__tests__/checkout-modules.test.ts` ——
    C 端结算页目录（`src/pages/checkout` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，幂等下单、支付轮询与券码试算下沉到 `utils.ts`；
    页面按板块拆成 `CheckoutOrderCard` / `CheckoutPaymentMethodCard` /
    `CheckoutAmountCard` / `CheckoutResultCard`，支付状态仍留在 `page.tsx`）。
- 分层改动后跑：

  ```bash
  cd frontend && npx vitest run src/pages/admin/__tests__/admin-modules.test.ts src/pages/product-detail src/pages/product-kit src/pages/viral-clone src/pages/creative-image src/pages/product-sku src/pages/local-redraw src/pages/background-remove src/pages/watermark-remove src/pages/product-retouch src/pages/image-translate src/pages/image-expand src/pages/product-recolor src/pages/rotate-angle src/pages/multi-image-fusion src/pages/account src/pages/checkout src/pages/admin/payments
  ```

- 类型校验以 `npm run typecheck` 为准。

## 6. 变更边界

- 拆分以「移动 + 改导入」为主，不改变行为；金额仍只在微积分边界换算。
- 重命名导出时同步改所有调用点与测试，不留兼容别名。
- 入口文件的注释与本文档是同一份约定；改规则时两处同批更新。
