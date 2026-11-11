# 测试文档

本文是测试策略、闸口清单、用例覆盖与已知缺口的唯一说明文件。所有条目都对应仓库里真实存在的脚本或配置；断言数量随脚本演进，以实际运行输出为准。单次运行结果（通过 / 失败数）随提交说明记录，不进本文。

## 1. 测试分层

| 层 | 目的 | 载体 | 需要起服务 |
| --- | --- | --- | --- |
| L1 编译与类型 | 代码能否构建、类型是否自洽 | `backend npm run build`、`frontend npx tsc --noEmit`、`npm run build:prod` | 否 |
| L1.5 前端单元 / 组件 | 纯逻辑、hooks、状态组件的分支与状态语义 | `frontend npm test`（Vitest + jsdom + Testing Library） | 否 |
| L1.6 后端单元 | 纯函数与可通过 mock 隔离的 service 逻辑（状态派生、关单/退款语义、入账幂等、账单解析） | `backend npm test`（Vitest + node） | 否 |
| L2 架构与纯逻辑断言 | 分层依赖、能力注册表、签名串、环境解析等类型检查发现不了的问题 | `backend/scripts/verify-*`、`probe-environments.ts` | 多数否 |
| L3 HTTP 冒烟 | 接口契约、权限、资金与积分规则、失败与退款语义 | `backend/scripts/smoke-*.js` | 是 |
| L4 浏览器 E2E | 页面渲染、权限链路、提交契约、状态契约 | `frontend/tests/*.spec.ts`（Playwright） | 是（前端 + 后端） |

原则：**先跑红再最小修订**。闸口脚本的断言视为规格，不得为了让测试变绿而修改断言；断言与实现冲突时先定性（脚本错 / 实现错），再改对应一侧，并在交付说明里写清结论。

## 2. 环境与数据隔离

- 测试一律连测试档：`NODE_ENV=test` → `backend/test.db`、`uploads-test/`、`backups-test/`、`logs/test/`。
- 端口与开发档相同（后端 4100 / 前端 5100），两档不能同时跑：起测试档会停掉开发档。
- 冒烟与 seed 脚本按当前 `NODE_ENV` 选库（`backend/scripts/db-url.js`），默认是开发库。跑测试必须显式 `NODE_ENV=test`，否则会写脏 `dev.db`。
- 重建测试环境：`NODE_ENV=test npm run db:reset:test`（删库 + 重建 + 重灌种子，带安全门禁）。
- 启动测试后端：`./start.sh --env test`（端口固定 4100，占用即停）；手工启动用 `NODE_ENV=test node dist/main.js`，不要用 `nest start`。
- 脚本基址：多数支持 `API_BASE`；`smoke-marketing.js` 用 `MARKETING_API_BASE`（含 `/api/v1`）；L2 的 `.js` 验证脚本用 `VERIFY_BASE`。
- SQLite 单写者：脚本直连库时后端同时写库会撞 `database is locked`（P2039），脚本内已做退避重试。

开跑前确认库路径，避免「以为在测、实际连着开发库」：

```bash
cd backend
node -e "console.log(require('./scripts/db-url').resolveDbPath())"
```

## 3. 自动化闸口

### 3.1 构建与类型（L1）

```bash
cd backend && npm run build
cd frontend && npx tsc --noEmit
cd frontend && npm run build:prod
```

### 3.2 前端单元 / 组件（L1.5）

配置在 `frontend/vitest.config.ts`，用例在 `frontend/src/**/__tests__/*.test.{ts,tsx}`，jsdom 环境，不需要起服务、不读 `.env.{mode}`。

```bash
cd frontend
npm test                # 单次，交付前用这个
npm run test:watch      # watch
npm run test:coverage   # v8 覆盖率，产物在 frontend/coverage（已 gitignore）
```

当前 41 个用例文件：

| 用例 | 守住什么 |
| --- | --- |
| `admin-ui/primitives/table.test.tsx` | 后台数据表格的列显隐：**表头与表体列数始终一致**（默认全可见各 2 列；隐藏一列后表头与每个表体行同时少一列，且不残留该列内容） |
| `components/ErrorBoundary.test.tsx` | 顶层 `ErrorBoundary` 未传 `resetKeys` 时稳定停留兜底页，不反复重置 |
| `components/ColorSwatchGrid.test.tsx` | 色板选择、自定义色回显、禁用态 |
| `components/ImageLightbox.test.tsx` | 大图查看器开合、缩放/翻页键盘语义 |
| `components/StateViews.test.tsx` | 加载 / 空 / 失败 / 骨架四态渲染 |
| `hooks/useCreditLabel.test.tsx` | 积分文案与生效价、限时免费的展示 |
| `lib/admin-links.test.ts` | 跨模块深链的参数编码（邮箱、任务 id 等） |
| `lib/aigc-label.test.ts` | 角标参数缓存、失败回退默认值、色值还原 |
| `lib/safePath.test.ts` | 登录回跳 / 通知 link 的站内路径校验：协议相对、反斜杠、控制字符与外链一律拒绝 |
| `lib/channelCost.test.ts` | 成本 / 售价 / 加价率的展示口径：参与售价的字段随计费方式取子集（与 `channelReprice` 同口径）、成本为 0 时加价率为 `null` 而非无穷大、未配置显示「未配置」而不是 0、规格标签翻译 |
| `lib/channelOrder.test.ts` | 排序纯函数：越界 / 找不到 / 原地不动返回**原数组引用**（React 不多渲染一次）、移动后其余元素相对顺序不变、`orderChanged` 逐项比对 id 序列（只比长度会漏掉换位） |
| `lib/channelReprice.test.ts` | 统一调价的金额换算：售价字段按计费方式取子集、加价率校验、成本加价的 half-up 取整（含 0.0002 积分量级）、售价文本互逆、缺成本价/售价未配置的模型被拦截 |
| `lib/expandGeometry.test.ts` | 扩图占比与原图位置几何换算 |
| `mask-sdk/geometry.test.ts` | 遮罩画布 SDK 的几何：客户端坐标 → 原图像素（含夹取与无效画框）、矩形拖动 / 四边四角缩放（最小边长、源图边界）、白底 + `destination-out` 透明标注区的合成契约 |
| `mask-sdk/marks.test.ts` | 遮罩画布 SDK 的标记识别：单点笔迹不成区域、完全擦除后消失、部分擦除保留原 id、删除其它区域后包围盒稳定 |
| `mask-sdk/session.test.ts` | 遮罩画布 SDK 的会话状态机：涂抹 / 形状的提交与丢弃、区域上限回调、撤销 / 恢复 / 删除、拖动与缩放夹取、连续手势只通知叠层不回调页面状态、换图重置 |
| `lib/multiFusionBilling.test.ts` | 多图融合变体数 × 积分计费 |
| `lib/optionSets.test.ts` | 平台/语言/比例等选项集合的默认值与排序 |
| `lib/poll.test.ts` | 轮询重试、超时、视频上限放宽、中止语义 |
| `lib/routePreload.test.ts` | 路由预加载：精确路由只预热一次、通配路由匹配 |
| `lib/skuBatches.test.ts` | SKU 行批量展开与坐标映射 |
| `lib/unsaved-guard.test.ts` | 离开页面时的未保存拦截 |
| `lib/zip.test.ts` | 浏览器内批量下载打包 |
| `pages/admin/admin-modules.test.ts` | 后台目录具名导入 / 导出对账：相对导入的每个名字都必须在目标模块导出（防 `/admin` 整块白屏）。判据实现与 C 端共用 `src/test/namedImportAudit.ts` |
| `pages/admin/channels/ChannelHeadersEditor.test.tsx` | 自定义请求头编辑器：系统托管的头（鉴权 / 协议 / `x-canvas-*` / `x-forwarded-*`）一律拒绝且文案点名，名称大小写不敏感去重，值里只允许可打印 ASCII 与制表符，名称 / 值 / 总大小上限拦截，**空行不算错误**（点了「添加请求头」还没填不该报错），只有名称的行保留（空值是合法请求头），疑似凭据的值渲染为密码框 |
| `pages/admin/channels/ChannelModelHealthCell.test.tsx` | 「全部模型」视图的稳定性单元格：**无样本时显示「近 24 小时无调用」而不是 0%**、成功率三档（≥95% / ≥80% / 其余）、接近 100% 时不显示小数尾巴且 99.5% 不得进位成 100%、无健康数据时给可读文案 |
| `pages/admin/channels/ChannelModelHealthPanel.test.tsx` | 线路健康面板：成功率语义分档、**无终态样本时显示「无样本」而不是 0%**（「没数据」≠「全失败」）、样本被截断时提示「按最近部分统计」、停用 / 协议未注册 / 冷却三个状态标记、最近样本错误码、空态 |
| `pages/product-detail/product-detail-modules.test.ts` | C 端目录具名导入 / 导出对账（`product-detail/` / `components/` / `hooks/` / `lib/` / `context/`）：相对导入的每个名字都必须在目标模块导出（防功能页整块白屏） |
| `pages/product-detail/detailUtils.test.ts` | 详情图结果归组与展示口径：**一次生成 = 一行**（页签角标按批次计而非任务数）、批内按 `batchIndex` 排序、原图取任务输入素材而非产出素材、生成中标记 `pending`（删除按钮据此置灰）、下载扩展名跟真实格式走（缺格式兜底 png 不猜 jpg）、时间格式化与非法值回落 |
| `pages/product-kit/product-kit-modules.test.ts` | 商品主图目录具名导入 / 导出对账（`product-kit/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/viral-clone/viral-clone-modules.test.ts` | 爆款复刻目录具名导入 / 导出对账（`viral-clone/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/creative-image/creative-image-modules.test.ts` | 创意生图 / 自由创作目录具名导入 / 导出对账（`creative-image/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/product-sku/product-sku-modules.test.ts` | 商品 SKU 图目录具名导入 / 导出对账（`product-sku/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/local-redraw/local-redraw-modules.test.ts` | 局部重绘目录具名导入 / 导出对账（`local-redraw/` / `components/` / `hooks/` / `lib/` / `context/`）：页面与 `MaskPainter` 画布组件之间的每个相对导入都必须真实存在 |
| `pages/background-remove/background-remove-modules.test.ts` | 一键抠图目录具名导入 / 导出对账（`background-remove/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/watermark-remove/watermark-remove-modules.test.ts` | 去除水印目录具名导入 / 导出对账（`watermark-remove/` / `components/` / `hooks/` / `lib/` / `context/`）：页面与 `WatermarkMaskEditor` 遮罩画布之间的每个相对导入都必须真实存在 |
| `pages/product-retouch/product-retouch-modules.test.ts` | 产品精修目录具名导入 / 导出对账（`product-retouch/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/image-translate/image-translate-modules.test.ts` | 图片翻译目录具名导入 / 导出对账（`image-translate/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/image-expand/image-expand-modules.test.ts` | 智能扩图目录具名导入 / 导出对账（`image-expand/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/product-recolor/product-recolor-modules.test.ts` | 商品换色目录具名导入 / 导出对账（`product-recolor/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/rotate-angle/rotate-angle-modules.test.ts` | 旋转角度目录具名导入 / 导出对账（`rotate-angle/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/multi-image-fusion/multi-image-fusion-modules.test.ts` | 多图融合目录具名导入 / 导出对账（`multi-image-fusion/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/account/account-modules.test.ts` | 账户中心目录具名导入 / 导出对账（`account/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |
| `pages/checkout/checkout-modules.test.ts` | 结算页目录具名导入 / 导出对账（`checkout/` / `components/` / `hooks/` / `lib/` / `context/`）：入口文件与分层模块之间的每个具名导入都必须真实存在 |

边界：Vitest 只跑 jsdom，不替代 L3/L4。真实后端、真实浏览器、真实库与磁盘的记录仍以 `smoke-*` / `verify-*` / Playwright 为准。Playwright 只收集 `tests/*.spec.ts`，Vitest 只收集 `src/**/*.test.*`，两边互不重叠。

### 3.2.1 后端单元 / service（L1.6）

配置在 `backend/vitest.config.mts`，用例与实现同目录：`backend/src/**/*.spec.ts`，node 环境。纯逻辑 / mock service 用例不启动 Nest、不连数据库；HTTP 集成用例（`payments.integration.spec.ts`）用临时 SQLite + `@nestjs/testing` + `supertest` 启动一次真实 Nest，跑完删除临时库。`tsconfig.spec.json` 只给 spec 做类型检查，不参与 `nest build`（spec 不会进 dist）。需要真实渠道/已启动服务的断言仍归 `scripts/verify-*` / `smoke-*`，两者不互相替代。

```bash
cd backend
npm test                # tsc -p tsconfig.spec.json + vitest run
npm run test:typecheck  # 只做 spec 类型检查
npm run test:watch      # watch
npm run test:coverage   # v8 覆盖率，产物在 backend/coverage（已 gitignore）
```

当前覆盖：

| 用例 | 守住什么 |
| --- | --- |
| `payments/payment-query.spec.ts` | 8 个展示状态派生与优先级、关单租约 5 分钟边界、Prisma where 映射、上海时区日界、排序白名单与 nulls last |
| `payments/payment-order.service.spec.ts` | 关单前查单抛错 / 关单返回 failed 时**不本地关单**；渠道已支付先入账；已支付但缺金额拒绝；多渠道尝试逐个核对；`providerRef` 持久化并在不同 pending 尝试间分别透传 |
| `payments/payment-notification.service.spec.ts` | 回调带 `providerRef` 时只绑定对应 Payment；找不到时永久失败并记录 `credit_failed`，禁止回落到最新尝试；无 `providerRef` 保留历史兼容路径 |
| `payments/payment-exception.service.spec.ts` | 自动退款中断恢复与同号重试、`unknown` 复用原退款号、`definitive` 新建退款号、成功支付实例传播；自动退款成功不改取消订单/积分；人工核销成功/失败及对象状态校验；人工核销后晚到的渠道结果不得覆盖终态 |
| `orders/order.service.spec.ts` | 普通退款拒绝 `manual` 渠道、`unknown`/历史失败复用原退款号、`definitive` 新建退款号；退款使用实际成功支付流水及其实例 |
| `admin/payments/payment-admin.controller.spec.ts`、`admin/dto/payment-admin.dto.spec.ts` | 异常单读取与资金处置权限分离，认领/重试/核销/结案业务动作；人工核销 DTO 的 outcome、渠道退款单号与原因校验 |
| `payments/adapters/wechat.adapter.spec.ts` | 微信 APIv3 回调 AES-256-GCM 解密与 `Wechatpay-Serial` 公钥验签；缺少序列号、序列号不匹配和签名篡改拒绝；网关响应验签与公钥 ID 不一致拒绝；退款明确关闭与网络异常的资金语义 |
| `payments/adapters/stripe.adapter.spec.ts` | Stripe rawBody HMAC 验签、篡改与 300 秒时间窗拒绝；创建 PaymentIntent 返回 Payment Element 所需 `clientSecret` / `publishableKey`；`payment_intent.succeeded` / `payment_intent.payment_failed` 映射、`amount_received` 优先、PaymentIntent cancel 关单；历史 `checkout.session.*` 查单 / 关单 / 退款兼容；退款 failed/canceled 与网络异常语义 |
| `pages/checkout/__tests__/CheckoutStripePaymentElement.test.tsx` | 前端 Stripe Payment Element：服务端回跳地址优先、确认参数与 `if_required` 跳转策略、成功提交状态与 Stripe 错误提示 |
| `pages/admin/payments/__tests__/PaymentsExceptionPanel.test.tsx` | 支付异常面板：`definitive` 显示新建退款单、`unknown/null` 只能同号重试、自动退款处理中只做人工核销；核销请求体与“不改订单/积分”提示 |
| `payments/adapters/epay.adapter.spec.ts` | 易支付创建/回调 MD5 签名、GET 参数回调、篡改与商户/类型不匹配拒绝、`reallyPrice` 金额口径、查单状态映射（含 state=2 已支付）、ACK 文本、关单/退款明确 unsupported 且退款为 `definitive` |
| `payments/adapters/zpay.adapter.spec.ts` | ZPay ASCII 排序 MD5 签名、multipart `/mapi.php` 下单与 `clientip` 必填、`cid` 可选进签名、UA 到 `device` 的映射、`payurl`/`qrcode`/`img` 三种降级、GET 回调验签 + 短超时主动查单复核、篡改与商户/类型/状态/金额格式不符拒绝、查单未确认 / 金额不一致 / 渠道订单号不一致拒绝、查单状态映射、退款明确拒绝/网络异常语义、ACK 文本、关单明确 unsupported |
| `payments/adapters/alipay.adapter.spec.ts` | 支付宝移动端 UA、手机网站支付、当面付动态二维码与 App Scheme、桌面回退电脑网站支付；退款验签业务拒绝为 `definitive`，HTTP 异常为 `unknown` |
| `payments/adapters/paypal.adapter.spec.ts` | PayPal 下单/查单/回调；退款 `FAILED`/`CANCELLED`/`DENIED` 为 `definitive`，网络异常为 `unknown` |
| `payments/payments.integration.spec.ts` | 临时 SQLite + 真实 Nest HTTP：C 端设置/登录、intent、GET/POST 公开回调、幂等、并发回调只入账一次、金额不符、关单、全额退款、并发退款最多一笔、0 元单、库存并发不超卖、周期限购、订单上限、权限/DTO、CSV 导出 |
| `common/csv.spec.ts` | UTF-8 / GB18030 解码、BOM、引号内逗号与换行、公式注入防护 |
| `common/archive/zip-reader.spec.ts` | stored/deflate、路径穿越、符号链接/不支持压缩、ZIP 内无 CSV、条目数上限 |
| `common/setting-image.service.spec.ts` | 设置帮助图片的稳定存储引用解析、未知后端 / 目录穿越拒绝、本地与云存储预览地址生成、历史外链兼容 |
| `model/proxy/proxy.payload.spec.ts` | 流式 Chat Completions 的 `stream_options.include_usage` 注入：非流式原样返回、缺失时补上、保留已有字段、非法 JSON / 非对象报文 / 非对象 `stream_options` 一律拒绝 |
| `model/infra/outbound.spec.ts` | 自定义中转的 IPv6 保留网段拦截：`100::/64`（discard-only）、`2001:db8::/32`（文档网段）、IPv4-mapped loopback；普通出站不把保留网段当私网拦 |

新增 service / 纯函数逻辑时优先补 L1.6；mock 成本过高或需要事务/真实 SQLite 的并发路径，再落到 L2/L3。

### 3.3 架构与纯逻辑断言（L2）

`backend/scripts/` 下共 19 个验证脚本：15 个 `verify-*.ts` + 1 个 `probe-environments.ts`，以及 3 个需要后端已启动的 `verify-*.js`。

#### 3.3.1 纯逻辑 / 自起服务

| 脚本 | 断言什么 |
| --- | --- |
| `verify-capability-bootstrap.ts` | 能力定义能真实加载并通过 `assertCapabilityIntegrity`，且没有能力再声明本地图像实现；平台 / 语言必须换成展示名进入提示词（`main_image` / `detail_image` / `hot_remake`）；9 个平台都必须声明主图规格（比例 / 画质 / 最短边）与详情图规格（宽度 / 画质），主图与爆款复刻在比例、画质与平台常规一致时补规格、冲突时不硬拗，详情图同理；图片翻译的目标语言同理 |
| `verify-credit-deduction.ts` | 生成扣费 / 失败退款 / 余额一致性（同进程起 Nest 打真实 HTTP）：建任务即预留并落账单、余额不足不产生任务 |
| `verify-credit-price.ts` | 后台改价 → `/capabilities` 与生成扣费同步生效 |
| `verify-tool-contracts.ts` | 8 个修图工具的能力定义、默认值、hidden 字段、严格参数校验、标注解析、上传头与遮罩尺寸校验 |
| `verify-payment-signatures.ts` | 支付宝 RSA2 / 微信 v3 AES-GCM 按公开规范独立复算，防「自己签自己验」 |
| `verify-payment-bills.ts` | 支付宝账单解析：ZIP stored/deflate、直接 CSV、GB18030、表头前说明行、ZIP 路径穿越拒绝、ZIP 内缺少 CSV 的明确失败；离线运行 |
| `verify-channel-signatures.ts` | 阿里云短信 / 邮件 RPC 签名（HMAC-SHA1 + sorted canonical query）独立复算；只验签名与请求形状，不代表已真实投递 |
| `verify-plugin-manifests.ts` | 内置插件清单解析（`plugins/` 107 个可用包 / 115 个 provider；`src-*` 源目录镜像跳过）：id 唯一、能力与后端类型分布 |
| `verify-model-consistency.ts` | 渠道/模型数据层不变量：activeKey 软删除唯一键、selectorKey 规范 JSON、档位不越能力合同、模型摘要与档位汇总一致、`modelsJson` 与启用模型一致 |
| `verify-channel-flow.ts` | 渠道全链路（同进程起 Nest 打真实 HTTP）：建渠道 → 建模型含两档价格 → **图片价格档必须落在协议声明的计价参数内（省略 `capabilityConfig.image.parameters` 时按协议清单归一化后校验，越界拒绝）** → 上游键改名级联 → 复制 → **复制「只有 `modelsJson` 名单、没有模型行」的旧渠道时补停用骨架行并保留兼容名单** → 导出断言无凭证 → 改名导入 → **批量调价（`priceVersion` 过期整批拒绝 / 售价字段与计费方式不匹配拒绝 / 规格提交不完整拒绝，且三次拒绝后售价未被改动；成功调价后档位售价生效、模型与档位 `priceVersion` 各 +1、成本价不变）** → **渠道与渠道模型删除不要求填写原因** → 批量删除 → 删渠道 → **公开渠道连接信息脱敏（匿名视角渠道名 / 归属账号 / provider id / 并发配额 / 凭证标记全不下发、地址改写为中转入口、凭证恒为 `system`；管理员视角给出真实名称与上游地址但仍不回显凭证）** → **线路健康指标（按渠道模型出表、带两个观测窗口、无样本时成功率为 `null`、支持按 `channelId` 过滤）** |
| `verify-protocol-runtime.ts` | 协议运行时：115 个已注册 provider 的 `buildCreate` 冒烟、成功 / 异步 / 失败三类响应归一化；本地假上游走真实接口跑通 `POST /admin/channels/:id/models/test`（image 同步 + video 轮询）与 `POST /admin/channels/:id/models/{fetch,import}`，校验 `ApiCallLog`（`billable=false` / 无明文凭证）、导入默认停用未定价、重复导入不新增；假上游只在回环地址，脚本内临时打开 `MODEL_ALLOW_PRIVATE_UPSTREAMS` |
| `verify-billing.ts` | 计费账本：预留（含幂等）、固定价结算、Token 差额退回 / 超预授权补扣 / 授权上限截断、按秒计费按实际时长重算、失败全额退款（幂等）、已结算拒绝自动退款、`uncertain` 保留冻结后人工核对、余额不足 `40002`、**「待核对」队列口径（uncertain ∪ running 超 40 分钟 ∪ reserved 但任务已失败/取消，普通预留单不入队）**、**批量核对（逐条独立处置、成功与失败条数分别计数、失败条目带原因、核对人与系统生成原因落库、空列表被拒）**、**冻结积分自动退回开关（默认关闭不退、开启后退 uncertain 单、正在补交付的订单排除、退款归类 `auto_sweep`、操作人记 `system:auto-refund`）**；每一步后校验 `CreditAccount.available == Σ CreditLot.remaining` |
| `verify-route-catalog.ts` | 前台模型与选路：priority 硬分层与下沉、同层加权分布、SKU 选择（精确 / 通配 / 1.5K 相邻 / 停用档）、冷却三键与不冷却码、`simulate` 与 `resolve` 选中同一条线路与价格档、目录投影的渠道可见性与「先换货币再乘倍率」；后半段同进程起 Nest 打真实 HTTP 校验 `/models`、`/models/available`、`/models/:id/quote` 与后台模拟接口的接线与守卫。`VERIFY_HTTP=0` 可只跑纯逻辑 |
| `verify-task-runtime.ts` | 任务运行时端到端：起本机 HTTP mock 上游，经真实 `ProtocolExecutor` / 出站层跑四条路径——同步成功（产物落盘、格式按字节嗅探、AIGC 标识、`settled`、按目录价扣费）、上游 401 切线（`rejected_no_job` + `upstream_401`、旧账单退回、新账单按新线路价结算、`task.creditCost` 同步、**旧账单标记 `refundReason='route_switch'` 且不计入财务「已退」**）、轮询超时（`42206` / `uncertain`、**不切线**、备份线路零调用）、唯一线路 429（`42204`、全额退款、余额回正），末尾校验「可用余额 == Σ 批次剩余」；夹具全部自建并按外键序清理（含产物文件） |
| `verify-proxy-runtime.ts` | 中转与运营（P6）：**A 段纯逻辑**（`validateCustomRelayUrl` 的 SSRF 判定 / `resolveOutboundHost` 的 IPv6 与 localhost 拦截 / 路径白名单与密钥查询参数 / 并发槽 / 插件包解析拒绝分支）、**B 段同进程起 Nest + 本机 mock 上游**（`GET /models` 不计费、密钥查询参数剥离、渠道自定义头、服务端凭证注入；`POST` 的 `reserved → settled` 与调用记录；SSE 透传；500 退款；524 `uncertain` 不退款；渠道并发槽 `429`；自定义中转成功 / JSON 与 SSE 脱敏 / 不计费、401 `40101`、SSRF `40301`、上游错误原样透传、用户并发槽 `429`；系统中转限流 `42901`；分组可见性 `40301` 且不建账单；清扫 `reserved → refunded` / `running → uncertain` 且不碰任务账单；钱包恒等式；财务口径与 `BillingOrder` 聚合逐项一致；插件安装 / 重复 `40909` / 被引用拒卸 `40909` / 内置 `40001` / 卸载成功）。`VERIFY_HTTP=0` 只跑 A 段 |
| `probe-environments.ts` | 三环境解析：档位顺序、不回落 `.env`、空串语义等（不连数据库） |

#### 3.3.2 需先起服务的 HTTP 验证

这三个是 `.js`，用 `node` 直接跑，前置是后端已启动；基址走 `VERIFY_BASE`（默认 `http://localhost:4100/api/v1`）。

| 脚本 | 断言什么 |
| --- | --- |
| `verify-asset-filters.js` | 素材列表 `keyword` / `from` / `to` 三个筛选维度 |
| `verify-prompt-tools.js` | AI 润色 / 图片转提示词 / 手机上传三段真实链路 + 未登录 401 |
| `verify-deps.js` | `node_modules` 版本一致性审计 + `package.json` 内 `npm run <script>` 引用完整性 |

### 3.4 HTTP 冒烟（L3）

共 20 个脚本（`backend/scripts/smoke-*.js`），需后端已启动。按域分组：

| 域 | 脚本 | 覆盖要点 |
| --- | --- | --- |
| 身份安全 | `smoke-auth.js` | 注册昵称必填、忘记密码防枚举、重置一次性、改密后旧 token 失效 |
| 扫码登录 | `smoke-qr-login.js` | 扫码≠授权、一次性兑换 `consumed`、过期、未登录 401、登录记录 `reason=qr` |
| 账户与合规 | `smoke-account.js` | `/me` 只认令牌、资料更正白名单、导出、注销后订单保留 |
| | `smoke-notifications.js` | 消息用户隔离、支付成功产生消息；邮件/短信通道状态只读 |
| | `smoke-aigc.js` | PNG chunk CRC / JPEG XMP / 可见角标像素差 / 角标样式可配 / 角标可关闭 / 公开配置接口 / 真实生成链路落盘核对 |
| | `smoke-signed-url.js` | 另起带密钥实例：无签名 403、带签名 200、篡改 403、过期 410、HEAD 200 |
| | `smoke-rate-limit.js` | 短信 1/分、换号不换配额、伪造 XFF 无效、找回密码 3/时 |
| | `smoke-health-tracing.js` | 健康分项、请求号回显与替换、异常信封 `requestId`、日志 `[rid=]` 串联 |
| 能力 | `smoke-capability-runtime.js` | `runtime` 只有 `enabled / remoteAvailable / effective / reason`（不残留 `route` / `localQuality`）、无线路不预告产出、上下线 `40005`、限时免费 0 积分 |
| 后台 | `smoke-admin.js` | 身份、权限点、告警结构、退款状态筛选、五类只读列表 CSV 导出（类型 / BOM / 匿名拒绝 / `data.export` 权限校验；调用记录走 `/admin/api-logs/export`） |
| | `smoke-backup.js` | 未验证备份不可下载、保留策略、路径穿越拦截 |
| | `smoke-scheduler.js` | 定时任务真的改数据（订单超时、积分到期等） |
| | `smoke-storage.js` | 多存储后端语义、路径穿越、下架不可读 |
| | `smoke-tickets-search.js` | 工单状态机 / 越权 404 / 全局搜索 / 批量 / CSV 导入导出 |
| 交易 | `smoke-commerce.js` | 余额由批次推导、FEFO、幂等、退款回收积分 |
| | `smoke-membership.js` | 免费档兜底、并发上限、加油包折扣、月度积分 |
| | `smoke-membership-order.js` | 会员下单 → 支付 → 激活唯一路径、无订单拒绝、重复激活、退款 |
| | `smoke-payments.js` | 支付主链路：渠道列表、C 端支付设置、intent、沙箱回调入账/幂等、金额不符/未知单终态 ack、关单、全额/部分退款、并发回调只入账一次、周期限购、库存并发不超卖、未支付订单上限、商品校验边界、0 元单不可退、后台渠道/商品/订单 API、CSV 导出（含中文文件名头）、对账 CSV 导入/超时运行回收/沙箱自动对账失败 |
| | `smoke-refund-rules.js` | 时间窗 `40905` / 比例 `40906` / 已消耗积分 `40907` / 会员终止 |
| 营销 | `smoke-marketing.js` | 券门槛与折扣区间、活动叠加取更优、邀请、签到、退款不得超实付 |

development / test 的管理员凭据统一为 `admin@admin.com / 123456789`，后台 E2E 与冒烟脚本默认直接使用。需要覆盖时传 `ADMIN_EMAIL` / `ADMIN_PASSWORD`；production 不提供默认密码，必须使用显式环境变量或 `seed:admin` 生成的一次性密码。

#### 仿真模型网关

零依赖的仿真模型网关在 `test/`：提供 OpenAI 标准协议的文生文 / 文生图 / 文生视频端点与 MiniMax 兼容视频端点，无真实凭据也能跑通「渠道工作台 → 连通性测试 → 生成 → 下载」全链路，并支持 `[[fail]]` / `[[401]]` / `[[429]]` 失败注入。

```bash
cd test && node server.js       # http://127.0.0.1:3900
cd test && npm test             # 网关自测
cd test && npm run smoke:spawn  # 起网关跑联网冒烟
```

后台「渠道工作台」新建渠道并把基址指到 `http://127.0.0.1:3900`（只填根域，不要带 `/v1`），协议按能力选 `openai-image` / `chat-completion` / `minimax-video`，再到「能力与模型」为前台模型挂一条线路。`smoke-aigc` 需要可用的 image 线路；没有线路时它会如实报 `42204`，不能当产品缺陷。

### 3.5 浏览器 E2E（L4）

配置在 `frontend/playwright.admin.config.ts` / `playwright.config.ts` / `playwright.local.config.ts`，用例在 `frontend/tests/`，共 17 个 spec：

> ⚠ 后台用例**必须**用 `playwright.admin.config.ts`（带 `storageState` 与
> `admin-auth` setup 依赖）。`playwright.local.config.ts` 没有这两项，后台页会全部
> 跳登录页，表现为 `waitForSelector('[data-testid="admin-sider"]')` 超时 —— 是配置
> 用错，不是回归。

| 用例 | 守住什么 |
| --- | --- |
| `admin.spec.ts` | 后台权限链路 + 四页渲染 |
| `admin-assets.spec.ts` | 素材管理 + 存储配置 |
| `admin-backup.spec.ts` | 未通过恢复验证的备份不可下载 |
| `admin-layout.spec.ts` | 后台布局回归 |
| `admin-marketing.spec.ts` | 营销中心三条约束 |
| `admin-payments.spec.ts` | 支付充值五标签：切换只改 URL 不重载、深链直达指定标签、非法标签回落、旧路由重定向不 404、七渠道适配器渲染、无退款入口、对账执行区与状态深链回显 |
| `admin-model-suite.spec.ts` | 渠道 / 模型 P5 五页与 C 端选型：渠道工作台的主从布局（左列渠道导航 `admin-channel-item`、`aria-pressed` 标记选中、右侧 `#admin-channel-detail` 内联模型清单，不出现抽屉）、**新建渠道的三道必填前置（名称 → Base URL → API Key，留空逐级调用人话原因）与结构化请求头（`authorization` 这类系统托管的头在提交前拦下并指出是哪一行）**、**渠道详情头部的完整动作集（编辑 / 复制 / 导出 / 停用|启用 / 删除），停用先出确认弹窗并说明「退出路由目录但保留在列表」、取消不落库**、**模型清单的检索、筛选与稳定性列（关键字无命中给空态文案；状态筛选后的页脚总数与接口数据一致；重置恢复；清单带「稳定性（24h）」列，与「全部模型」同源）、复制模型（弹窗预填 `-copy` 标识且默认停用，取消不落库）、停用前确认（点击行内「停用」先出影响范围，不直接断电）**、**上游目录导入弹窗（已存在的模型带标记且默认不勾选、导入按钮只数新模型、搜索后「全选匹配的 / 取消选中匹配的」只作用于匹配项）**、**统一调价（勾选模型 → 按成本重算 → 保存 → 回读断言新售价 = 成本 × 1.1，不要求填写变更原因）**、**渠道排序（弹窗可开合；顺序没变时保存按钮禁用，移动后启用）**、**排序的并发保护（`expectedIds` 与库中不一致 → HTTP 409 / `40900`，一致才 `{ ok: true }`）**、**模型详情区的批量删除入口（未勾选时禁用；勾选后可用，删除确认展示影响范围但不要求填写原因）**、**全部模型视图（跨渠道行数与 `GET /admin/channel-models?includeDisabled=1` 一致、渠道列可解析、按模型状态筛选、工具条计数形如「N 个模型 · M 个可用」、排序与参考实现同序（显示名 → 模型标识 → 渠道名，按同一比较器在测试里重算期望首行）、停用先出确认且取消不落库、「编辑」一步切回「按渠道」并弹出该模型的编辑器、点渠道名一步跳回「按渠道」并选中该渠道；行数按 `admin-all-models` 容器取，避免算进同页「线路健康」表格）**、前台模型的路由模拟、用户分组与插件页渲染、生成账单与调用记录的筛选和详情、工具页 `ModelPicker` 选型后报价随之变化；生成段需要可用 image 线路，无线路时该段跳过 |
| `admin-scheduler.spec.ts` | 定时任务可观测（静默失败可见） |
| `admin-screenshots.spec.ts` | 后台逐页截图取证 |
| `admin-ux.spec.ts` | 筛选深链与逐条清除（含工单/商品/对账/能力/告警）、订单/任务/模型线路宽表在 1440px 无横向滚动、页面/编辑抽屉/工单回复/积分调整的未保存保护、角色权限未保存拦截、概览任务直达、任务详情到积分账本及项目筛选的跨模块深链、详情 `?id=` 刷新恢复与关闭移除 |
| `free-creation-submit.spec.ts` | 登录墙 + 必填置灰的提交契约 + guest 不被只读接口弹登录 |
| `product-capabilities.spec.ts` | 8 个工具入口/能力上下文、局部重绘画布与标注上限、失败重试字段、站点地图可见性 |
| `product-parameters.spec.ts` | 8 个工具页面参数渲染、提交态、结果/失败态与移动端无横向溢出 |
| `sidebar.spec.ts` | 侧栏顺序、几何、1366/1367 断点、折叠、工单预填、移动抽屉 |
| `state-contract.spec.ts` | 全站 loading / empty / error 状态契约 |
| `workspace-pages.spec.ts` | 工作台 12 卡顺序、guest 不请求统计、素材库双路径、390 无溢出 |
| `example.spec.ts` | Playwright 脚手架示例（不覆盖本项目功能） |

运行：`cd frontend && npm run e2e`（默认 `playwright.admin.config.ts`，`ADMIN_UI` 可覆盖 baseURL）。后台套件先用 `admin-auth.setup.ts` 登录一次并落盘 `playwright/.auth/admin.json`，其余用例复用 `storageState`；这样不会因每条用例重复登录而撞上认证限流。需要验证访客或普通用户的用例会主动清空会话。

后台用例的选择器契约（2026-11-02 推倒重建后；组件底座 radix `new-york`）：共享控件与页面关键节点挂 `data-testid="admin-*"` —— `admin-filter` / `admin-filter-actions` / `admin-filter-chips` / `admin-filter-chip` / `admin-table` / `admin-table-scroll` / `admin-table-row` / `admin-table-expanded` / `admin-drawer` / `admin-modal` / `admin-confirm-action` / `admin-toast` / `admin-panel` / `admin-page-loading` / `admin-header` / `admin-sider` / `admin-nav-scroll` / `admin-bulk-bar` / `admin-asset-cell` / `admin-storage-card` / `admin-task-row` / `admin-role-save-bar`。表单控件没有 `id` 时用 `aria-label` 配 `getByLabel`；下拉（radix `Select`）要「点 `combobox` 触发器 → 点 `option`」，不能用 `selectOption`。**不要把 Tailwind 工具类或 `adm-*` 类写进断言** —— 前者随视觉调整变动，后者只剩外壳骨架。

`frontend/e2e/` 下只有脚手架示例与一次性巡检脚本，不是本项目用例目录。

### 3.6 依赖一致性

```bash
cd backend
npm run verify:deps:critical   # 日常：只查运行时关键链
npm run verify:deps            # 全量 + 列出已记录无害项
node scripts/verify-deps.js --quiet   # 仅结论，有致命问题 exit 1
```

## 4. 覆盖矩阵

| 功能域 | L2 | L3 | L4 |
| --- | --- | --- | --- |
| 能力注册表 / 生成链路 | capability-bootstrap、credit-*、tool-contracts | capability-runtime | product-capabilities、product-parameters、state-contract |
| 模型层（渠道 / 选路 / 计费 / 任务） | plugin-manifests、model-consistency、channel-flow、protocol-runtime、route-catalog、billing、task-runtime | 暂无（见 5.5） | admin-model-suite |
| 身份与账户 | — | auth、qr-login、account、rate-limit | admin、free-creation-submit |
| 第三方登录（OAuth） | — | 暂无自动化闸口（见 5.3） | — |
| 交易与权益 | credit-deduction、credit-price、payment-signatures | commerce、membership、membership-order、payments、refund-rules | admin、admin-marketing |
| 营销 | — | marketing | admin-marketing |
| 后台与运维 | — | admin、backup、scheduler、storage、tickets-search | admin-*、admin-screenshots、sidebar |
| 中转与运营（P6） | proxy-runtime（含 B 段自起服务） | 暂无 L3 冒烟（见 5.6） | 暂无 |
| 合规与基础设施 | probe-environments、channel-signatures | aigc、signed-url、health-tracing、notifications | state-contract |
| 工作台 / 素材库 | — | — | workspace-pages、sidebar |
| 局部重绘遮罩（`42205`） | tool-contracts | 暂无自动化闸口（见 5.1） | — |
| AI 带货图文（`shoppable_carousel`） | capability-bootstrap、tool-contracts、credit-deduction | `frontend/e2e/audit/verify-shoppable-generation.mjs`（真接口 + 仿真网关：一次提交 → outputPlan 拆 6 张 → 逐张计费 → 余额核对） | `frontend/e2e/audit/{probe-local-shoppable,probe-local-shoppable-interact,verify-local-shoppable-browser}.mjs`（布局实测 / 交互态 / 浏览器内完整生成） |
| 写真模板（`template`） | capability-bootstrap、`template.spec.ts`（模板数据 / 提示词 / 模板 id 校验）、`template-catalog.service.spec.ts`（标签归一） | 暂无自动化闸口（需后台配置图像线路后走真实生成） | 后台 `/admin/templates` 三层 CRUD 已手工验证（分类 / 分组 / 模板 + 图片上传） |

L1.5 / L1.6 不按功能域铺矩阵：前端覆盖清单见 3.2，后端纯逻辑 / service 用例见 3.2.1。新增纯逻辑、共享 hook、状态组件或可 mock 的 service 逻辑时优先补 Vitest；需要真实后端、事务或浏览器的场景归 L3/L4。

## 5. 已知缺口与验证边界

### 5.1 局部重绘遮罩

遮罩路径要求：① 前台模型的 revision 能力合同把图片参考声明为 `maskSupported: true`（派生为意图里的 `inputs.mask`）；② 渠道模型的上游协议真的接受 `images/edits` 形态；③ 遮罩素材是 PNG 且与原图同尺寸。仓库默认没有带遮罩能力的线路，因此只能验到代码层：

- `capability-config.ts` 的 `maskSupported` → `capability-spec.ts` 的 `inputs.mask` 派生；
- 准入阶段「任务带遮罩但线路合同没有 `inputs.mask`」→ `42205`（`task-admission.service.ts`）；
- `maskAssetId` 的归属、格式与尺寸校验 → `40001`。

补闸口时应覆盖两条拒绝路径（无 `inputs.mask` → `42205` 且积分退回；遮罩非同尺寸 → `40001`）以及成功路径（上游收到 `images/edits` 的两个文件段）。真实出图必须由配好 edits 线路的环境实跑一次才算证据。

### 5.2 渠道退款

退款从「改库」改为「真的调渠道」，`smoke-payments.js` 钉住的是顺序与失败语义：全额/部分/二次退款的订单状态与积分处置、全额退款回收积分流水、普通用户 `403`、0 元单退款上限为 0。这些只在沙箱通道下成立。

渠道未配置 `503`、在途退款 `40908`、`manual` 不调渠道等分支仍缺自动化证据，需要真实/半配置渠道或专门的 mock 才能覆盖。

支付宝 RSA2 与微信 v3 的退款请求体、验签与 `PROCESSING` 分支没有离线证据：`verify-payment-signatures.ts` 覆盖的是回调验签、AES-GCM 解密与响应签名，不是退款接口。真实渠道退款须用商户号实跑一次；在此之前只能说「代码按官方规格实现，失败语义已覆盖」。

### 5.3 需要外部条件的脚本

| 脚本 / 用例 | 外部条件 |
| --- | --- |
| `smoke-aigc.js` | 可用的 image 线路（可用 `test/` 仿真网关 + 后台渠道工作台配一条） |
| 真实厂商连通性 | 各家 API key；`POST /admin/channels/:id/models/test` 实跑一次才算证据 |
| `admin-model-suite.spec.ts` 的「生成 → 账单核对」段 | 后台存在一条启用且有价格的 image 线路（`cd test && node server.js` 指到 `http://127.0.0.1:3900`）；无线路时该段跳过，其余断言照常执行 |
| 真实支付宝 / 微信回调与退款 | 商户号与可公网访问的回调地址 |
| 第三方登录（OAuth2 / OIDC） | 真实 provider 的 `clientId` / `clientSecret` 与可公网访问的回调地址；离线只能验「未配置时 `/auth/oauth/providers` 返回空、登录页不渲染按钮」 |
| `product-parameters` / `product-capabilities` / `state-contract` 等 C 端提交类用例 | 前台模型目录里该能力**有一条 `available=true` 的线路**。`resolveModelId()` 在没有可用线路时抛错，提交在 `/generate` 之前就中止 —— 页面上按钮可点，但请求发不出去，用例表现为「提交后等不到结果」 |

### 5.3.1 「提交后等不到结果」怎么定性
C 端提交类用例挂住时，先分清是**环境缺线路**还是**代码回归**：打开该能力在
`GET /api/v1/models` 里的目录项，看有没有 `available: true` 的模型。全为 `false`
（或该能力一条模型都没有）时，提交在模型解析阶段就中止，与页面代码无关。

`dev.db` 默认不带任何 image 线路（`LogicalModel` 表为空或只有 smoke 残留），
因此上述用例在裸开发库上必然红。判据是**与基线对比**：在同一套后端与同一份库上，
先跑重建前的基线前端，再跑当前前端，两边的失败集合必须逐条相同；多出来的才是回归。

> ⚠ 后端重启后要确认 `dist/` 与 `src/` 同步 —— 后端进程启动于上一次构建时，
> `GET /api/v1/tasks/page` 这类新路由就不会注册，前端分页列表会拿到
> 「任务不存在或无权限」的 400，表现为整页列表空掉。

### 5.3.2 两个后台页面的接口路径对不上（已修，2026-11-02）

**现象**：`frontend/e2e/audit/sweep-admin.mjs` 全路由巡检报出 `/admin/payment-channels`
与 `/admin/reconciliation` 两条 403。

**根因**：不是权限问题，是**前端调的路径后端没有**。支付域重构（`505319c`）删掉了后端
`payment-channels.controller.ts` 与 `reconciliation.controller.ts`，前端却还在打旧路径：

| 旧页面 | 旧前端调用 | 后端现状 |
| --- | --- | --- |
| 支付渠道 | `GET /admin/payment-channels` | 控制器已删除，新接口是 `GET /admin/payments/providers` |
| 渠道对账 | `GET /admin/reconciliation/batches` | 新接口是 `GET /admin/payments/reconciliations` |

两条都返回 `40301 该端点未声明权限点, 已拒绝访问` —— 守卫对**未声明权限点的端点**
一律拒绝，所以看起来像权限不足，实际是路由不存在。

**修法**：按 `docs/payment-refactor-design.md` §8 / §10.3 / §21 落地统一页面
`/admin/payments`（支付渠道 / 充值商品 / 支付订单 / 支付对账 / 支付异常五标签），旧路由改为
重定向。落地后 `sweep-admin.mjs` 的 35 条路由全部渲染、控制台零错误，
`tests/admin-payments.spec.ts` 8 条用例覆盖标签切换、深链、旧路由重定向与筛选回显。

**留下的通用判据**：后台 403 报「未声明权限点」时，先怀疑**路由根本不存在**，
再怀疑角色权限 —— 前者返回的也是 403，容易被误判成权限不足。

### 5.3.3 对账用例依赖「开发库恰好没有对账记录」（2026-11-02）

**现象**：`tests/admin-payments.spec.ts` 的「对账标签给出执行区与运行列表」失败，
断言 `还没有对账记录`（空态）不可见 —— 实际渲染出 4 行对账记录。

**根因**：与本次改动无关，是**数据前提失效**。该用例假定开发库没有对账记录，
但后端的 `PaymentWorkerService` 每天 10:15 后会自动跑一次对账
（`payment-worker.service.ts` 的 `autoReconcile`），在 `dev.db` 里落下了
`PaymentReconciliationRun` 记录。断言一旦遇上当天跑过自动对账的库就必失败。

**定性**：把本次改动 stash 后重跑，用例**同样失败** —— 属于环境/数据前提问题，
不是回归。

**两种修法**（择一，尚未实施）：

- 让用例不依赖空态 —— 断言「表格存在」或「空态与表格二者必居其一」，不写死
  「没有记录」；
- 或让该用例连测试档库（`NODE_ENV=test`）跑 —— 测试库不启动 worker，没有
  自动对账记录。

**留下的通用判据**：断言「列表为空」之前先问一句**这个列表会不会被后台自己写入**。
定时任务、worker、自动对账这类东西会把空列表填上，断言就得改成与数据无关的
形式，或者干脆跑在不会触发 worker 的库上。

### 5.4 模型层的覆盖边界

`verify-billing.ts` 钉住**账本本身**（状态机 + 资金变动 + 不变量），`verify-task-runtime.ts` 钉住**任务侧**（准入 → 派发 → 切线 → 轮询 → 收尾的四条路径）。两者合起来覆盖了「钱怎么走」与「任务怎么跑」，但仍有空白：

- **L3 没有模型层的 HTTP 冒烟**：渠道工作台 / 能力与模型 / 用户分组 / 插件 / 生成账单 / 调用记录五个后台页面只有 Playwright 用例（`admin-model-suite.spec.ts`）与 `verify-channel-flow.ts` 的接口级断言，没有 `smoke-*.js`；
- **准入的失败分支**只在 `verify-route-catalog` / `verify-task-runtime` 的部分路径上覆盖，参数白名单与非 JSON 选项的拒绝路径依赖 `verify-tool-contracts`；
- **`models/*` 公开接口的分组可见性**由 `verify-route-catalog` 的纯逻辑部分保证，多分组并存的 HTTP 组合未单独断言；
- **「建任务 + 建单 + 预留」同事务的回滚语义没有故障注入用例**：脚本证明的是「成功路径三步都落库」，没有证明「预留失败时任务也一起回滚」。补闸口时应在 `reserveBatchBilling` 里注入一次余额不足，断言 `GenerationTask` 没有残留行；
- **后台批量核对的 HTTP 层**（`POST /admin/billing-orders/batch-resolve` 的权限点 / DTO 校验）只有 service 级断言，控制器层靠 Playwright 补。

补测时优先补一条 `smoke-model-layer.js`（渠道 → 前台模型 → 选路 → 生成 → 账单 → 调用记录），而不是继续堆纯逻辑断言。

### 5.5 断言假阳性防范

- 断言恒真比红灯更危险：不渲染的弹窗会让 `toBeHidden` 永远通过。E2E 必须先断言元素存在/数量 > 0，再扫溢出与状态。
- 脚本连库取决于是否使用项目自己的 `ConfigModule`，不取决于 `NODE_ENV` 环境变量本身；最小模块装配要跟随真实构造器依赖。
- 溢出扫描要等真实内容就绪（`waitForSelector` + 断言元素数），`networkidle` 不等于内容渲染完成。

### 5.6 中转与运营（P6）

P6 的判据由 `verify-proxy-runtime.ts` 钉住（`npm run verify:proxy-runtime`，自起 Nest + 本机 mock 上游，夹具自建自清）。它**只跑服务层**，不经过后台 HTTP 端点与真实厂商：

- **已覆盖**：三条转发的迁移与安全语义（`GET /models` 不计费并剥离客户端密钥、`POST` 的 `reserved → settled`、SSE 透传、500 退款、524 `uncertain` 不退款、渠道与用户并发槽 `429`、自定义中转 401/403/上游错误透传与 JSON/SSE 双路径脱敏、分组可见性 `40301` 且不建账单、系统中转限流 `42901`）；`validateCustomRelayUrl` / `resolveOutboundHost` 的 SSRF 判定（回环、私网、链路本地、云 metadata、保留网段、IPv6、`localhost`、HTTP 仅可信主机）；插件包解析拒绝分支与安装 / 卸载的 `40001` / `40909` / `40400` 分支；`BillingSweeperService` 的两条迁移（TTL 由参数注入，不改生产常量）与「不碰任务账单」；财务口径与 `BillingOrder` 聚合逐项相等；钱包恒等式。
- **仍未覆盖**：① **后台插件的 HTTP 端点**（脚本直接调 `PluginAdminService`，控制器层的权限点 / 上传字段由 `admin-model-suite.spec.ts` 的插件页用例兜底）；② **财务页面的 HTTP 接口**（脚本调 `FinanceAnalyticsService.summary()`，与页面同样的聚合函数，但少了 DTO 与权限链）；③ **服务商目录**（`MODEL_PROVIDER_CATALOG_URL` 远端 JSON 的拉取与容错）无断言；④ **真实厂商差异**——SSE 分块边界、`Retry-After`、超长响应截断、各家错误体形状只由本机 mock 模拟，接真实线路时须再跑一次；⑤ 冷却、并发槽与目录版本是**进程内存**，多实例下每台各自判定，无法在单进程断言。
- 该脚本会改开发/测试库：`NODE_ENV=test` 时连 `test.db`，否则连 `dev.db`。它只清理自己建的夹具（用户 / 渠道 / 渠道模型 / 分组 / 套餐 / 账单 / 调用记录），插件装在 `mkdtemp` 临时目录并在结束时删除。

## 6. 测试数据与清理

- 冒烟脚本自建账号 / 商品 / 订单，并在 `finally` 或结尾清理；失败中断时可能留残留，需手工按外键顺序清理。
- 清理顺序（SQLite 无级联）：`GenerationTask → Asset → Project → Refund → Invoice → Payment → OrderItem → Membership → Order → ApiCallLog → CreditReservationItem → BillingOrder → CreditLedgerEntry → CreditLot → CreditAccount → MembershipUsage → CheckinRecord → InviteRelation → Notification → Ticket → OAuthIdentity → AccountToken → LoginSession → LoginLog(置空 userId) → User → Product → MembershipPlan`。脚本侧可直接用 `scripts/credit-fixture.js` 的 `clearCredits()` 完成账单 / 预留明细 / 流水 / 批次 / 账户五张表的清理。
- 不得删除非本次测试产生的数据；发现历史残留时先确认归属。
- 测试档账号与开发档账号是两套数据，不要跨库复用凭据。

## 7. 维护约定

1. 新增功能必须同时补一条冒烟（或说明为什么只能人工验证），并在提交说明里登记真实运行结果。
2. 新增权限点、错误码、状态机边时，测试要覆盖拒绝路径，不只覆盖成功路径。
3. 冒烟脚本只追加断言，不删除既有断言；确需废弃时写明原因。
4. 任何「预期通过」都不算验证：交付时只写真实运行输出里的通过 / 失败数。
5. 纯逻辑（几何 / 解析 / 状态机）与共享 hooks、状态组件优先补 Vitest；断言用行为与返回值，不用快照比对样式。新增用例后须同时跑 `npm run typecheck` 与 `npm test`。
6. 本文不记录逐轮修复过程；已知缺口按第 5 节维护，修复后移除对应条目。
