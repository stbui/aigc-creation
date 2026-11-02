# 模型域逐文件对标清单（open-ai-canvas → aigc-creation）

> 性质：只读静态审计，不改代码。结论均指到上游/本仓的文件、函数或字段，运行时行为仍需脚本/真机复核。
> 上游基线：`/Users/bright/github/open-ai-canvas`，commit `f83c35b`（2026-10-29）。
> 本仓基线：`/Users/bright/github/aigc-creation`，`77c574c` + 当前未提交 WIP。
> 范围：模型域（渠道 / 渠道模型 / 价格档 / 前台模型 / 路由 / 计费 / 任务 / 用户分组 / 协议插件 / 服务商目录 / 观测 / 代理中转 / 后台页面 / C 端选型）。
> 排除：支付、短信、画布、短剧、Agent 应用层、工作流、素材库等非模型域；支付/短信插件仅在插件生命周期对照中提及。
> 「上游文件」按功能归并；一个上游文件可对应多个本仓文件；纯测试文件不逐条列，只在各域末尾汇总。

## 状态图例

| 标记 | 含义 |
| --- | --- |
| ✅ | 对齐：语义与关键分支一致 |
| 🔀 | 合并/重构：实现位置或技术栈不同，语义基本等价 |
| ⚠️ | 有意差异或轻微语义偏差：需要产品/架构确认，不一定是缺陷 |
| ❌ | 未移植：本仓没有对应能力，或行为有实质差异 |
| ➕ | 仅本仓有：上游不存在的能力/保护 |

---

## 0. 执行摘要

### 0.1 结论

1. **协议清单层高度一致，宿主执行层是主要差距。** 本仓 110 个 `manifest.json` 与上游同名包逐字节一致（SHA-256 全等），但 `buildUpload` / `buildResult` / `buildCancel` / `buildAgent` 等可选能力在宿主没有调用点，导致 1 个 upload、5 个 result、7 个 cancel、23 个 agent 声明失效。
2. **核心资金状态机与上游同级，任务侧兜底更薄。** 预留/结算/退款/uncertain/Token/chargeLimit/FEFO 原路退款/钱包恒等式基本对齐；缺口集中在建单与预留不再同事务、换线换单造成财务口径失真、自动退款/待核对队列/巡检缺失、媒体落盘失败仍退款。
3. **渠道与前台模型的“写入校验”弱于上游。** 图片参数合同校验可绕过、任务准入的能力/素材/提示词校验未移植、公开目录缺产品合同匹配与价格档合法性过滤、分组定价缺全局积分策略倍率。
4. **前端把结构化配置降级成 JSON/自由文本。** 能力合同、价格档选择器、图标/展示名/协议说明都是原始输入，视频 Token 计费被直接禁止；前台模型允许选停用/跨能力线路、重复线路、无线路仍启用。
5. **服务商目录是“不同域替换”，不是同一功能的不同实现。** 上游是“厂商推广 + Key 校验 + 推荐模型 + 人民币成本/加价 + 一键建渠道”；本仓是“远端插件包索引 + 安装插件”。按当前产品口径可视为有意替代，但不能按上游文档找“厂商目录”。
6. **测试网远薄于上游。** 上游模型域有大量 `_test.go`；本仓 `src/model/**` 下没有 `.spec.ts`，主要靠 4 个 verify 脚本 + 1 个 Playwright 用例兜底。

### 0.2 分域对齐度

| 子域 | 对齐度 | 主要结论 |
| --- | --- | --- |
| 渠道 / 渠道模型 / 价格档 | 较高 | CRUD、排序、导入导出、批量、价格档、健康指标均有；缺口在复制渠道、图片合同校验、健康契约、服务商目录。
| 前台模型 / 目录 / 路由 / 分组 | 较高 | priority 硬分层、同层加权、SKU 选择、1.5K 相邻档、冷却三键、simulate/resolve 一致性已核对对齐；缺口在目录可用性、价格档过滤、任务准入校验、全局倍率、归档重试。
| 协议 / 插件 | 清单对齐、宿主缺失 | manifest 字节一致；upload/result/cancel/agent/流式/公网素材/role/分离轮询/幂等重试未接。
| 任务 / 计费 / 财务 | 核心对齐、运维面缺失 | 资金状态机基本对齐；建单-预留原子性、换线财务口径、自动退款、媒体恢复、重试/取消语义、视频 Token、运营分析缺失。
| 代理 / 出站 / 数据模型 | 较高 | SSRF、白名单、密钥剥离、GET/POST 计费、SSE、524 语义对齐；缺总超时、自定义路径规范化、IPv6 保留网段、功能开关、响应拦截、密钥原子发布。
| 后台前端 / C 端选型 | 结构对齐、编辑能力退化 | 主从布局、全部模型、调价、排序、健康面板完整；能力合同/价格档/调用详情/账单批量/前台模型线路校验/C 端兼容过滤缺失。

### 0.3 优先级最高的真实缺口

| 优先级 | 域 | 缺口 | 证据 | 影响 |
| --- | --- | --- | --- | --- |
| P0 | 渠道 | 复制渠道时源渠道无模型行则直接复制 0 行，并把 `modelsJson` 覆写成 `[]` | 上游 `admin_channels.go:126-130`；本仓 `channel-model.repository.ts:64-74` | 复制体“一个模型都没有”，无法据此重新定价/启用 |
| P0 | 渠道 | 图片参数合同校验读原始 `capabilityConfig.image.parameters`，省略时跳过 | 上游 `channel_models.go:179-186`；本仓 `channel-model.service.ts:568-569` | 可保存与协议不匹配的定价选择器 |
| P0 | 计费 | 建任务与批量预留分属两个事务 | 上游 `repository/finance.go:118-144`；本仓 `task-admission.service.ts:226-299` | 崩溃窗口留下“排队但无账单”任务，靠 60s/10min 补偿 |
| P0 | 计费 | 切线“退旧单 + 建新单”，旧单退款额被财务页计入“已退” | 上游 `logical_models.go:281-388`；本仓 `task-worker.service.ts:488-570`、`finance-analytics.service.ts` | 一次 9 分换 4 分的成功任务净收入显示 −5 |
| P0 | 任务 | 结果落盘重试用尽后走普通失败退款，而不是 uncertain | 上游 `task_terminal.go:195-221`；本仓 `task-worker.service.ts:985-993` | 上游可能已成功并计费，平台退款双损 |
| P0 | 任务 | 后台重试新建 `creditCost=0`、无账单任务，不检查 uncertain/已提交上游 | 上游 `task_lifecycle.go:33-106`；本仓 `generate.service.ts:71-104` | 免费生成；对可能已计费任务重试会二次计费 |
| P0 | 任务 | 取消只改本地状态，不请求上游 | 上游 `task_lifecycle.go:176-208`；本仓 `task-lifecycle.service.ts:173-202` | 上游继续生成并计费 |
| P0 | 代理 | 流式 Chat Completions 未注入 `stream_options.include_usage=true` | 上游 `app/text_stream_usage.go`；本仓 `system-proxy.service.ts:318` | 上游不返回最终 usage，Token 结算转 uncertain |
| P0 | 代理 | 自定义中转路径未先解码/`path.Clean` 再判定，IPv6 `100::/64`、`2001:db8::/32` 未拦 | 上游 `security.go:47-50,127-140`、`outbound.go:40-51`；本仓 `custom-relay.service.ts:99-105`、`outbound.ts:235-244` | 安全语义退化；百分号编码合法端点被误拒 |
| P0 | 基础设施 | 密钥文件并发首启无原子发布/等待 | 上游 `app/settings.go:415-469`；本仓 `secret-cipher.ts:93-110` | 多进程首启可能各生成一把密钥，凭证互相解不开 |
| P1 | 渠道 | 健康指标响应契约与上游不兼容，且按 `channelModelId` 聚合 | 上游 `admin_channel_model_health.go`、`repository/analytics.go:130-142`；本仓 `channel-model-metrics.service.ts` | 按上游契约写的脚本读不到平铺字段/`recentResults`；删模型后历史消失 |
| P1 | 渠道 | `fetch/import` 返回对象数组，上游是 `string[]` | 上游 `channel_models_catalog.go`；本仓 `model-catalog.service.ts:34-43,119` | 按上游契约写的前端直接读错 |
| P1 | 目录 | `POST /models/available` 未先做产品合同匹配 | 上游 `logical_models_catalog.go:35-38`；本仓 `catalog.service.ts:151-165` | 返回“下单必被拒”的模型 |
| P1 | 目录 | 公开价格档未做图片选择器/价格合法性过滤 | 上游 `logical_models_catalog.go:154-169`；本仓 `catalog.service.ts:210-243`、`public-model-catalog.service.ts:365-417` | 展示价 ≠ 可成交价 |
| P1 | 路由 | 快照未按“启用且已定价”档裁剪视频能力 | 上游 `logical_models.go:646-703`；本仓 `route-catalog.service.ts:179` | 目录展示无法定价的分辨率/时长档 |
| P1 | 准入 | 任务侧能力校验（提示词长度、素材字节/时长、蒙版、比例/时长/分辨率、GPT-Image-2 尺寸、缺像素表 fail-closed）未移植 | 上游 `model_capability_validate.go:276-1014`；本仓仅 `matchCapability` + mask 检查 | 坏请求拖到上游失败再退款，而不是扣费前 400 |
| P1 | 分组 | 缺 `DefaultMultiplierBPS` / `ModelMultiplierBPS` 全局积分策略倍率 | 上游 `finance.go:714-745`、`credit_policy.go`；本仓 `billing.service.ts:206-222` | 系统级加价/按模型费率不可用，价格口径整体偏低 |
| P1 | 计费 | 视频 Token 计费直接拒绝，`video_formula` 分支不可达 | 上游 `video_token_billing.go`；本仓 `billing.service.ts:320-325` | 按输出 Token 计价的视频线路无法接入 |
| P1 | 任务 | 无任务账单自动退款开关、无 `review` 待核对队列、无巡检、无批量核对 | 上游 `billing_auto_refund.go`、`billing_review.go`、`finance.go:346-388` | 冻结积分只能人工逐单处理 |
| P1 | 任务 | 媒体落盘不幂等、无实测音视频时长、无本地兜底/补传、无管理员恢复 | 上游 `task_media_recovery.go`、`task_media_fallback.go`、`task_media_assets.go` | 重复素材/孤儿文件；按秒结算用请求值；存储故障即失败 |
| P1 | 协议 | upload/result/cancel/agent 声明存在但宿主不调用 | 上游 `provider_protocol_async.go` 等；本仓 grep 只在 `protocol/**` 定义 | 对应 provider 实际不可用/长任务失败 |
| P1 | 协议 | 输入素材永远内联 `dataUrl` 且不写 `role` | 上游 `provider_media_hydration.go`、`provider_protocol_request.go`；本仓 `task-media.service.ts:77-91` | 35 个 `requiresPublicMediaUrls` provider 与首尾帧/参考图语义失真 |
| P1 | 代理 | 出站只有 socket 空闲超时，没有总超时/连接超时 | 上游 `outbound.go:124-136`；本仓 `outbound.ts:450-457` | 慢速滴流可长期占用渠道槽与预授权积分 |
| P1 | 代理 | 缺 `FeatureCustomChannels` 功能开关与响应拦截 | 上游 `custom_proxy.go`、`response_interception.go`；本仓无 | 无法按套餐/环境关闭自定义中转；无法统一改写上游错误 |
| P1 | 前端 | 价格档是自由文本 `selector`，禁止视频 Token | 上游 `channel-model-price-tier-fields.tsx`；本仓 `ChannelModelForm.tsx:209-274`、`utils.ts:218` | 拼错 key 生成永不命中的档；视频 Token 供应商不可配置 |
| P1 | 前端 | 前台模型允许停用/跨能力/重复线路、无线路仍启用、不校验/重置能力合同 | 上游 `logical-models-page.tsx:173-184,579-616`；本仓 `AdminLogicalModelsPage.tsx` | 保存成功但线上 42204，路由结果不可预测 |
| P1 | 前端 | 调用详情只能读当前页行，无报文/按 id 拉取/上游任务查询/媒体恢复 | 上游 `api-log-detail-drawer.tsx`；本仓 `AdminModelCallsPage.tsx` | 失败工单无法取证/救单 |
| P1 | 前端 | C 端 `ModelPicker` 不按当前输入过滤兼容模型，默认按 `sortOrder` | 上游 `model-selection.ts:278-297`；本仓 `ModelPicker.tsx`、`lib/models.ts:100-128` | 用户可选到不兼容模型，默认可能更贵 |
| P2 | 前端 | 用户分组倍率上限 100%（1 倍），上游支持 0.0001–100（最高 100 倍） | 上游 `user-group-editor.tsx:136-137`；本仓 `AdminUserGroupsPage.tsx:197-201` | 无法配置溢价倍率 |
| P2 | 前端 | 渠道/模型列表筛选不写 URL，未选中渠道不回退首条 | 上游 `channels-page.tsx`、`channel-workspace-state.ts:11`；本仓 `page.tsx:101-148` | 排障视图无法分享；首屏右侧空白 |
| P2 | 插件 | 缺插件包 registry/SHA256/状态/下载/覆盖升级/不可用占位/用户级启停 | 上游 `protocol_plugins.go`、`handler/plugin.go`；本仓目录扫描 + DB 启停 | 无法审计运行包；升级需先卸载；排障信息少 |
| P2 | 数据模型 | 无迁移版本账本与旧数据回填；部分索引缺失 | 上游 `database/migrations.go`；本仓 `prisma db push` | 携带旧数据升级时价格档 selector/线路外键/成本列不会自动补齐 |

### 0.4 有意差异（不应按缺陷计）

1. Go → TypeScript、Gin → NestJS、GORM → Prisma/SQLite、可读前缀 ID → `cuid()`。
2. 单实例部署：冷却、并发槽、目录快照为进程内存 + DB 版本号，无 Redis 跨实例协调。
3. 服务商目录口径：本仓是插件包索引，不是“厂商推广 + 人民币成本/加价 + 一键建渠道”。
4. 权限与审计更严：细粒度权限点、删除/调价/批量操作强制原因、`@AuditAction`（但审计失败不阻断业务）。
5. 匿名可浏览 `/models` 与 `/model-catalog`；上游要求登录后按分组投影。
6. 渠道模型 `activeKey` 小写归一 + 软删唯一键；上游用 `WHERE deleted_at IS NULL` 部分唯一索引。
7. 本仓多图产出按张建子任务、按张计费；上游一次任务一个结果。
8. 本仓 C 端只暴露前台模型，不展示渠道/个人渠道；上游是“产品模型 → 渠道模型”两级选择。
9. 本仓删除/调价强制审计原因；上游无原因。
10. 本仓把线路健康、财务分析做成独立面板/独立页；上游在单元格/分析面板内展示。

---

## 0.5 本轮已修复（在报告快照之后）

> 下列条目已落地，报告其余部分仍按修复前快照描述；复核时以代码为准。

| # | 修复 | 文件 | 验证 |
| --- | --- | --- | --- |
| 1 | 复制渠道在源渠道只有 `modelsJson` 时补停用骨架行，并保留兼容清单 | `backend/src/model/channels/channel.service.ts` | `verify-channel-flow` 新增 3 条断言 |
| 2 | 图片参数合同从协议清单注入，并用归一化后的合同校验价格档 | `channel-model.service.ts`、`protocol-catalog.service.ts` | `verify-channel-flow` 新增 1 条拒绝断言 |
| 3 | 流式 Chat Completions 强制 `stream_options.include_usage=true` | `backend/src/model/proxy/proxy.payload.ts`、`system-proxy.service.ts` | `proxy.payload.spec.ts` 5 条 |
| 4 | 自定义中转路径先解码/`path.Clean`/长度上限再判定 | `backend/src/model/proxy/custom-relay.service.ts` | `verify-proxy-runtime` A 段 |
| 5 | 自定义中转补 IPv6 `100::/64`、`2001:db8::/32` 拦截 | `backend/src/model/infra/outbound.ts` | `outbound.spec.ts` 4 条 |
| 6 | 密钥文件用临时文件 + `link` 原子发布，避免并发首启生成两把密钥 | `backend/src/model/infra/secret-cipher.ts` | 类型检查 / 构建 |
| 7 | `markRunning` 失败即停止派发并转 uncertain | `backend/src/model/tasks/task-worker.service.ts` | `verify-task-runtime` 39 项 |
| 8 | 落盘重试用尽、大结果无法暂存、暂存损坏、找不到 attempt 一律转 uncertain，不再自动退款 | `backend/src/model/tasks/task-worker.service.ts` | `verify-task-runtime` 39 项 |
| 9 | `uncertain` 任务禁止直接重试，避免二次计费 | `backend/src/generate/generate.service.ts` | 类型检查 / 构建 |
| 10 | 模型启停不再递增 `priceVersion`，值未变化直接返回 | `backend/src/model/channels/channel-model.service.ts` | `verify-channel-flow` 65 项 |
| 11 | `/models/available` 增加产品合同匹配；公开目录过滤非法价格档 | `backend/src/model/catalog/catalog.service.ts`、`public-model-catalog.service.ts` | `verify-route-catalog` 48 项 |
| 12 | **建任务 + 建账单 + 预留积分合并进同一个 Prisma 事务** | `backend/src/model/tasks/task-admission.service.ts`、`billing.service.ts` | `verify-task-runtime` 43 项 |
| 13 | 退款按归类记账：换线重预留（`route_switch`）**不计入「已退」**，财务净收入不再失真 | `billing.service.ts`、`finance-analytics.service.ts`、`schema.prisma`（新增 `BillingOrder.refundReason`） | `verify-task-runtime` 4 条 + `verify-proxy-runtime` 口径断言 |
| 14 | 「待核对」队列口径（`status=review`）+ 批量核对接口与页面 | `billing-admin.service.ts` / `.controller.ts`、`AdminBillingOrdersPage.tsx` | `verify-billing` 11 条 |
| 15 | 失败通知不再把换线退款算成「已退回」 | `task-lifecycle.service.ts` | `verify-task-runtime` |
| 16 | 后台表格注册 `columnVisibilityFeature`，表头与表体共用可见列集 | `frontend/src/admin-ui/primitives/table.tsx` | `table.test.tsx` 2 条 |

### 本轮仍需产品确认的项

| 项 | 现状 | 待确认 |
| --- | --- | --- |
| 换线改为「同账单差额调整」 | 仍走「退旧单 + 建新单」，但**财务口径已修正**（不再计入「已退」），资金流与上游一致 | 是否要改成上游的单账单差额调整（改动面大，需重写切线事务） |
| 冻结积分自动退回开关 | 未做 | 开关默认开还是关；哪些状态自动退；已出作品的任务是否排除 |
| 视频 Token 计费 | `billingMode=token` + video 直接拒绝 | 是否接 Seedance 公式；与按秒计费的边界 |
| 前台模型线路合法性 | 仍可保存停用 / 跨能力 / 重复线路、无线路仍启用 | 是否强制「启用前至少一条可路由线路」 |

---

## 1. 渠道域逐文件对照

- 上游：`/Users/bright/github/open-ai-canvas/backend/internal`（Go / Gin / GORM）
- 本仓：`/Users/bright/github/aigc-creation/backend`（NestJS / Prisma / SQLite）
- 方法：逐文件阅读两端实现，按函数、字段、SQL/Prisma 查询与路由契约比对；本仓响应统一被 `ResponseInterceptor` 包成 `{code,data,message}`（`src/common/response.interceptor.ts`），上游为 `{code,data,msg}`（`internal/handler/response.go:17-19`），该封套差异属全仓约定，下文不再重复。
- 状态口径：✅ 对齐；🔀 合并/重构后语义基本等价；⚠️ 有意差异或轻微语义偏差；❌ 未移植；➕ 仅本仓有。

### 表A 逐文件对照

| 上游文件 | 本仓对应文件 | 状态 | 具体功能差异与证据 |
|---|---|---|---|
| `app/admin_channels.go` | `src/model/channels/channel.service.ts`、`channel.presentation.ts` | 🔀 | 分页/创建/更新/软删/复制均在，但：① 创建时上游写 `UserID: actor.ID`（`admin_channels.go:92`），本仓固定 `userId: ''`（`channel.service.ts:194`），创建人归属丢失；② 复制时上游在源渠道无渠道模型时按 `modelsJson` 生成停用骨架行（`admin_channels.go:126-130`），本仓直接复制 0 行，随后 `refreshChannelModelNames` 把 `modelsJson` 覆写成 `[]`（`channel-model.repository.ts:64-74`），兼容清单被清空；③ 删除时上游只清 `api_key/secret_key/enabled` 并软删渠道/模型（`repository_channels_settings.go:94-113`），本仓额外清 `headersJson` 并软删价格档（`channel.service.ts:230-250`），更彻底；④ 列表搜索上游 `lower(name) LIKE ... OR lower(base_url) LIKE ...`（`repository_channels_settings.go:54-57`），本仓 `contains` 未 lower（`channel.service.ts:124`），SQLite 下等价、迁 Postgres 会丢失大小写不敏感；⑤ 响应分页字段上游 JSON 为 `pageSize`（`app/admin.go:73`），本仓为 `limit`（`channel.service.ts:83-88`）；⑥ 本仓 `adminSystemChannels()` 只取启用渠道（`channel.service.ts:167-175`），供 `/channels/system` 管理员视图使用。 |
| `app/channel_models.go` | `src/model/channels/channel-model.service.ts` | 🔀 | 保存顺序（标签/描述→协议能力→同渠道重复→能力归一→档位校验→原子落库）一致。差异：① 重复模型检查上游按 `model_key` 精确匹配（`channel_models.go:172`、`finance_channel_models.go:107-116`），本仓按 `activeKey = lower(modelKey)`（`channel-model.service.ts:138-142`、`channel.presentation.ts:56-58`），大小写不同的两个 SKU 不能共存；② 协议校验上游要求 `adapter.Metadata().Enabled` 且 `UnavailableReason == ""`（`channel_models.go:296-303`），本仓 `ProtocolCatalogService.require()` 只校验存在/非处理类/能力匹配（`protocol-catalog.service.ts:78-88`），缺少“插件已停用/不可用”判断；③ 即梦协议上游要求 API Key 与 Secret Key 均非空（`channel_models.go:304-306`），本仓只按 `requiresSecretKey` 校验 secretKey（`channel-model.service.ts:550-553`），API Key 为空也可保存；④ 列表接口上游逐行做能力配置归一化（`channel_models.go:103-120`），本仓直接投影库内 JSON（`channel-model.service.ts:83-94`）；⑤ `setEnabled` 本仓每次写 `priceVersion+1` 且无“值未变则跳过”（`channel-model.service.ts:268-273`），上游明确只改启停、值相同直接返回、不动价格版本（`admin_channel_model_health.go:204-225`）；⑥ 删除/批量删除的整批校验、100 条上限、线路/任务占用保护一致；`SystemChannelModel`/`SystemChannelHasProtocol` 等价逻辑移到 `proxy/proxy-channel.service.ts:88-130`。 |
| `app/channel_models_catalog.go` | `src/model/catalog/model-catalog.service.ts` | 🔀 | 只读预览 + 勾选导入 + 500 条上限 + retiredModelsJson 跳过均已移植。差异：① 导入去重键上游是 `firstNonEmpty(item.ProviderModelKey, item.ModelKey)`（`channel_models_catalog.go:120-124`），本仓是 `activeKey || lower(modelKey)`（`model-catalog.service.ts:82-85`），当 `providerModelKey` 与 `modelKey` 不同时会重复导入同一上游 SKU；② `FetchAdminChannelModels`（一次拉取并写入全部缺失）未移植（`channel_models_catalog.go:12-61`，上游无路由调用，仅测试引用）；③ 本仓拉目录会带渠道代理（`model-catalog.service.ts:41`），上游 `FetchChannelModels` 请求体不含 proxy、走全局客户端（`channel_models_catalog.go:25`）；④ 导入返回体差异见 D 表。 |
| `app/channel_models_pricing.go` | `src/model/channels/channel-model.service.ts`、`src/model/domain/selector.ts` | 🔀 | 选择器规范化（`resoluton` 拼写兼容、`auto/any→*`、vquality 归一）、同规格去重、图片/视频档位能力校验、计价校验、摘要回填均已逐条移植且提示语一致。差异：① 上游在 `SaveAdminChannelModel` 中先把 `req.CapabilityConfig` 替换为归一化结果（`channel_models.go:179-186`）再调用 `normalizeChannelModelPriceTiers`，本仓 `normalizePriceTiers` 读的是**原始** `req.capabilityConfig.image.parameters`（`channel-model.service.ts:175,568-569`），调用方不提交 parameters 时图片参数合同校验会被跳过；② 数字解析上游 `strconv.Atoi`，本仓 `Number()`（`selector.ts:193-210`），`"1e3"`/`"0x10"` 会被接受；③ 摘要“最后通配档优先”一致；④ 旧接口无 `priceTiers` 时合成一个通配档一致。 |
| `app/channel_models_test_call.go` | `src/model/protocol/protocol-test.service.ts` | 🔀 | 核心语义（真实协议/凭证/出站，不建任务不计费）一致。差异：① 上游发送前调用 `NormalizeModelCapabilityConfigForModel` 校验能力配置（`channel_models_test_call.go:27-31`），本仓只 `decodeCapabilityConfig`（`protocol-test.service.ts:126-130`），非法能力配置可通过校验后直接发上游；② 上游超时 10 分钟（`channel_models_test_call.go:120`），本仓默认 5 分钟、可由 `timeoutMs` 调到 10 分钟（`protocol-test.service.ts:74-75,133`）；③ 上游返回仅 `{durationMs}`，本仓返回 status/errorCode/request/responsePreview/logId 等并写 `ApiCallLog`（`protocol-test.service.ts:218-274`），属超集。 |
| `app/channel_model_catalog.go` | `src/model/catalog/model-catalog.client.ts`、`model-catalog.types.ts` | ✅ | `GET {base}/models`、openai/gemini 两种形态、`/v1beta` 补全、401/403/404/429 错误映射、按 ID 去重排序、`model_type`/`options`/`supports_images` 归一均对齐。细节：上游显式 `ValidateOutboundURL(target)`（`channel_model_catalog.go:135`），本仓由 `outboundRequest` 统一校验；排序上游 `sort.Strings`（字节序），本仓 `localeCompare`（`model-catalog.client.ts:102`）；本仓额外补 `Accept: application/json`。 |
| `app/channel_model_catalog_plugin.go` | `src/model/catalog/model-catalog.discovery.ts`、`discovery/bailian.ts` | ⚠️ | 百炼补充模型清单与主机匹配规则一致；上游扩展受 `ENABLE_PROVIDER_PLUGINS=true/1` 开关控制（`channel_model_catalog_plugin.go:114-117`、`channel_model_catalog.go:200-202`），本仓 `DISCOVERIES` 固定包含百炼且无环境开关（`model-catalog.discovery.ts:12,15-23`），补充模型始终生效；上游还计算 `Region` 但百炼插件未使用，本仓无此字段。 |
| `app/channel_model_pricing.go` | `src/model/channels/channel-model.service.ts`（`repriceMany`） | 🔀 | 乐观并发（模型/档位 priceVersion）、整批失败、只提交当前计费方式全部售价字段、并发批量按 ID 排序加锁均对齐。差异：① 无启用档位时本仓报“没有已启用的价格档，无法调价”（`channel-model.service.ts:356`），上游报“规格提交不完整…”（`channel_model_pricing.go:79-81`）；② 上游 `UpdateChannelModelSalePrices` 的 CAS 同时校验 `updated_at`（`repository/channel_model_pricing.go:19,38`），本仓只校验 `priceVersion + deletedAt`（`channel-model.service.ts:412-444`）；③ 上游仓库只写售价列与 price_version，本仓同时回写模型级摘要字段（billingMode/priceConfigured/四个价格，`channel-model.service.ts:416-424`），结果等价但与上游写入面不同。 |
| `app/channel_model_tags.go` | `src/model/channels/channel.presentation.ts`（`normalizeChannelModelTags`） | ✅ | 最多 5 个、1–12 字、去重、六种颜色白名单及提示语完全一致（`channel.presentation.ts:25-44`）。 |
| `app/channel_order.go` | `src/model/channels/channel.service.ts`（`order`/`saveOrder`）、`channel-model.repository.ts` | ✅ | 渠道级/模型级两种排序、`expectedIds` CAS、`ids.length>10000` 拒绝、冲突返回 409（上游 `NewAppError(409)`，本仓 `AppError(40900,…,409)`）、排序后刷新渠道模型名清单均对齐；本仓不做 PG `FOR UPDATE`（SQLite 单写者，注释见 `channel-model.repository.ts:9-10`）。 |
| `app/channel_outbound.go` | `src/model/infra/outbound.ts` | ✅ | `validateOutboundUrl`（SSRF 出站策略）、`validateProxyUrl`（socks5/socks5h/http/https）、`outboundRequest` 渠道级代理均存在（`outbound.ts:93,142,375-429`）；上游 `OutboundHTTPClientForChannel` 的 proxy 语义一致。 |
| `app/channel_presentation.go` | `src/model/channels/channel.service.ts`（`update` 内 sortOrder）、`channel-model.service.ts`（`updateSort`） | 🔀 | 排序值 0–999999 校验、模型级排序只改展示字段均已实现。上游“presentationOnly 快路径”（`channel_presentation.go:9-33`）被本仓通用 `update()` 合并（先 merge 再校验），行为等价但会多走一次完整字段构建；上游 `UpdateSystemChannelCatalogProvider` 无本仓调用方（服务商目录功能不同，见 B12）。 |
| `app/channel_transfer.go` | `src/model/channels/channel.service.ts`（`exportChannels`/`importChannels`） | 🔀 | 导出格式 `yingce.system-channels` / version 1、200 渠道/500 模型上限、按名称合并、已有渠道保留凭证与启停、新渠道停用、单模型失败不阻断其余均已对齐。真实差异：① 上游导入新渠道后会回填 `CatalogProviderID`（`channel_transfer.go:219-221`），本仓 `importChannel` 只传 name/baseUrl/sortOrder/concurrency（`channel.service.ts:513-535`），导出文件里的 `catalogProviderId` 被丢弃；② 上游导入请求体上限 8MB（`handler/admin_channel_routes.go:123`），本仓全局 JSON 上限 100KB（`main.ts:68`），导出文件稍大就无法回导；③ 批量调价/导入等大请求同样受 100KB 限制。 |
| `app/admin_channel_model_health.go` | `src/model/channels/channel-model-metrics.service.ts`、`channel-health.service.ts` | 🔀 | 24h/7d 窗口、P95（最近邻）、最近 10 条样本、30s 缓存均已实现。差异：① 响应契约完全不同：上游平铺 `requests24h/succeeded24h/failed24h/successRate24h/requests7d/successRate7d/p95DurationMs24h/recentResults(boolean[])/lastErrorCode/lastFailedAt/lastCalledAt` 且报告带 `computedAt/truncated`（`admin_channel_model_health.go:26-47`），本仓每行是 `windows.day/windows.week`（samples/success/failed/successRate/p95DurationMs/avgDurationMs/sampled）+ `recent[]` 对象，无 computedAt/truncated（`channel-model-metrics.service.ts:62-95,126-197`）；② 数据源上游按 `(channel_id, model)` 且只取 `status in (succeeded,failed)` 的 create 日志（`repository/analytics.go:130-142`），本仓按 `channelModelId` 关联，取所有 create 日志后在内存过滤终态（`channel-model-metrics.service.ts:142-168,200-230`），因此 `channelModelId` 为空或渠道模型已删除的日志不会计入；③ 上游有 `lastFailedAt/lastCalledAt`，本仓没有；④ `invalidate()` 已定义但全仓无调用（grep `metrics.invalidate` 无结果），启停/改价后最多 30s 旧数据。 |
| `repository/channel_model_pricing.go` | `src/model/channels/channel-model.service.ts`（事务内联） | 🔀 | 整批原子、CAS 冲突回滚均已移植；本仓缺少 `updated_at` 维度的 CAS（见上），且把模型摘要字段一并更新。 |
| `repository/channel_order.go` | `src/model/channels/channel-model.repository.ts`（`saveChannelOrder`） | ✅ | 事务内取当前顺序、与 expectedIds 全量比较、逐条写 sort_order、模型级刷新 modelsJson 均对齐；上游 PG 分支 `SELECT ... FOR UPDATE` 后重读（`channel_order.go:27-36`）本仓以单写事务替代。 |
| `repository/channel_presentation.go` | `src/model/channels/channel-model.repository.ts`、`channel.service.ts` | ⚠️ | `UpdateChannelModelSort`（校验存在、只写 sortOrder、刷新模型名）对齐；上游 `UpdateSystemChannelPresentation` 的“仅排序渠道”专用路径与 `UpdateSystemChannelCatalogProvider` 在本仓无独立实现（分别被通用 update 和服务商目录差异取代），无功能回归但缺少渠道行 `updated_at` 的显式 presentation 语义。 |
| `repository/repository_channels_settings.go` | `src/model/channels/channel.service.ts` + `prisma/schema.prisma` | 🔀 | `SystemChannels/AdminSystemChannels/SystemChannel/AdminSystemChannel/DeleteSystemChannel` 均有等价实现。未移植：`HistoricalSystemChannelReferences`（历史日志按 id 回填已删除渠道名，`repository_channels_settings.go:24-28`）、`AdminSystemChannelReferences`（`channel_models.go` 之外的后台引用下拉，`:72-76`）、`CatalogProviderChannelCounts`（服务商目录已接入数，`:30-48`）。删除语义差异见 `admin_channels.go` 行。 |
| `handler/admin_channel_routes.go` | `src/model/channels/channel.controller.ts` | 🔀 | 路由主体齐全；本仓新增 `GET :id`、`GET protocols`、`GET health`，并把 service 的 `RequireAdmin` 换成 JWT + 细粒度权限；删除/批量删除/调价强制 `reason`；响应包裹差异见 D 表；`/admin/provider-catalog/*` 同名但语义不同（见 B12）。 |
| `handler/channel_models.go` | `src/model/proxy/custom-relay.controller.ts`、`custom-relay.service.ts`（`POST /ai/models`） | ✅ | 用用户提供的 BaseURL/APIKey 拉目录、30 次/分限流（`custom-relay.controller.ts:30-33`）、返回 `{models: 目录项}` 与上游 `FetchChannelModelCatalog` 一致；本仓走同一 `ModelCatalogClient`，额外支持代理与统一出站。 |
| `handler/channel_order.go` | `src/model/channels/channel.controller.ts`（`order`/`saveOrder`/`modelOrder`/`saveModelOrder`） | ✅ | 两条路径（渠道级、模型级）GET/PUT 均存在，GET 返回 `{items}` 一致；PUT 返回 `{saved:true}` → 本仓 `{ok:true}`（D 表）。 |
| `handler/admin_channel_model_response.go` | `src/model/channels/channel.presentation.ts`（`channelModelView`） | ✅ | 后台模型投影都会带 `costPricing`（`channel.presentation.ts:193-214`），与上游包装类型一致；本仓投影缺 `catalogModelKey` 字段（Go 实体 JSON 含该字段，`model/models_channel.go:70`）。 |
| `model/models_channel.go` | `prisma/schema.prisma:1495-1635`（`ModelChannel`/`ChannelModel`/`ChannelModelPriceTier`） | 🔀 | 字段基本一一对应；有意差异：ID 由 GORM 前缀 ID（`CHANNEL_/MODEL_/PTIER_`）改为 Prisma `cuid()`；`activeKey` 承担 GORM 的“部分唯一索引”（SQLite 无部分索引）；`ChannelModel` 唯一键由 `(channel_id, model_key)` 变为 `(channelId, activeKey=lower(modelKey))`，即大小写不敏感唯一；成本价由 GORM `embedded` 改为扁平 `cost*` 列；`PriceVersion` 由 int64 改 Int；删去历史列 `public_alias`；本仓价格档多 `activeKey` 以支持软删后重建。 |
| 补充：`app/admin.go`（`ChannelRequest`/`publicChannel`） | `src/model/channels/channel.presentation.ts`（`publicChannel`） | ⚠️ | 前台投影上游只改写 `apiKey='system'` 与 `baseUrl=/api/ai/system/:id`，仍下发真实 `name`、`concurrencyLimit`、`hasApiKey/hasSecretKey`（`admin.go:239-295`）；本仓额外把非管理员的 `name`（固定空串）、`userId`、`concurrencyLimit`、`hasApiKey/hasSecretKey`、`catalogProviderId` 全部脱敏（`channel.presentation.ts:299-318`），属有意收紧。另：上游 `modelCosts.capabilityConfig` 会做一次 `NormalizeModelCapabilityConfigForModel`（`admin.go:250`），本仓只 `decodeCapabilityConfig`（`channel.presentation.ts:278`），旧能力配置对外形态可能不同。 |
| 补充：`app/model_capability.go` | `src/model/domain/capability-config.ts` | ⚠️ | 基础 text/image/video 归一与校验一致；未移植：① 协议声明 `ImageParameters` 时的自动解析/注入（上游 `model_capability.go:241-248`；本仓 `channel-model.service.ts:165-171` 未传 `imageParameterDefinitions`，因此该分支不生效）；② `fillMissingImageSizePresets` 旧图片尺寸预设补齐与 `imageSizePresetReadyError` 写路径/运行期完整度校验（`model_capability_validate.go:852-894`，本仓 grep 无对应实现）；③ `applyModelSpecificVideoCapability`（`model_capability.go:353-390`，agnes-video-2.5/flash 的参考素材/时长/比例/分辨率默认）；④ Gemini 图片 `ResolutionUsesQuality=true`（上游 `model_capability.go:256`，本仓 `capability-config.ts` 只写 false，`595`）。 |
| 补充：`repository/finance_channel_models.go` | `src/model/channels/channel-model.repository.ts` | 🔀 | 价格档按 selectorKey 幂等更新、移除档位软删、删除前校验线路/任务占用、刷新 modelsJson 均对齐。未移植：① `channelModelPriceTierKey` 对空 selectorKey 用 resolution/videoSeconds 推导旧键（`finance_channel_models.go:165-177`），本仓只用 selectorKey（`channel-model.repository.ts:105-150`），旧档位会被当成新档重建；② `attachChannelModelPriceTiers` 在 `priceConfigured=true` 但无档位时合成一个默认档（`finance_channel_models.go:203-211`），本仓无此兜底，列表会显示空 priceTiers、调价会因无启用档被拒。 |
| 补充：`app/provider_catalog.go` | `src/model/plugins/provider-catalog.service.ts`、`provider-catalog.controller.ts` | ❌/⚠️ | 同名路由但功能不同：上游是“服务商推荐目录 + 用 API Key 校验 + 按加价率生成渠道/模型/价格档一键接入”，返回创建出的渠道（`provider_catalog.go:234-317`，含 `buildCatalogChannelModel` 的成本/售价换算与 `CatalogProviderID`）；本仓是“插件包目录”，条目只有 packageUrl/protocols，install 走 `PluginAdminService.install` 返回 PluginView（`provider-catalog.service.ts:30-56,146-159`），不创建渠道、不生成模型/价格档。 |
| 补充：`handler/auth.go`（`GET /channels/system`） | `src/model/channels/public-channels.controller.ts` | ⚠️ | 上游要求管理员且始终返回 `PublicSystemChannels()`（非管理员投影，`handler/auth.go:201-217`）；本仓允许匿名，管理员额外拿真实渠道名/地址/并发（`public-channels.controller.ts:33-42`），属有意扩张。 |

### 表B 上游有、本仓无的功能点

| # | 功能点 | 上游证据 | 影响 |
|---|---|---|---|
| B1 | 复制渠道时，源渠道没有渠道模型行则按 `modelsJson` 生成停用骨架模型 | `admin_channels.go:122-130` | **高**：本仓复制后既没有模型行，`modelsJson` 又被刷新成 `[]`，复制体看起来“一个模型都没有”，无法据此重新定价/启用。 |
| B2 | 导入新渠道后回填 `catalogProviderId` | `channel_transfer.go:219-221` | 中：导出→导入后来源标记丢失，服务商维度的展示/统计断链；导出文件字段白存。 |
| B3 | 渠道模型健康指标的上游响应契约：24h/7d 平铺计数与成功率、`recentResults: boolean[]`、`lastFailedAt/lastCalledAt`、`computedAt/truncated` | `admin_channel_model_health.go:26-47,167-184` | **高**：按上游契约写的后台/脚本读不到 `requests24h`、`successRate24h`、`recentResults` 等字段；`truncated` 缺失还会把截断后的 7d 成功率当全量。 |
| B4 | 健康指标按 `(channel_id, log.model)` 聚合，包含渠道模型已删除、`channelModelId` 为空的 create 日志 | `repository/analytics.go:130-142` | 中：本仓按 `channelModelId` 关联，删模型后历史表现从健康页消失；中转/未回填 `channelModelId` 的调用不计入，排障出现盲区。 |
| B5 | 读取后台渠道模型列表时对存量能力配置做一次归一化 | `channel_models.go:103-120` | 中：旧格式（legacy quality→resolution、缺省字段）在前端仍是旧形态，价格档规格展示与实际校验口径可能不一致。 |
| B6 | 保存图片模型时把协议声明的 `ImageParameters` 注入能力合同，并用**归一化后**的合同校验价格档选择器 | `model_capability.go:241-248`、`channel_models.go:179-186` | **高**：调用方省略 `capabilityConfig.image.parameters` 时，本仓跳过图片参数合同校验（`channel-model.service.ts:568-569`），可保存出与协议不匹配的定价选择器。 |
| B7 | 图片尺寸预设的旧数据补齐与“必须有换算表”的写路径/运行期校验 | `model_capability_validate.go:852-894` | 中高：旧图片线路可被保存为“按比例提交但没有像素预设”，运行期无法把档位换算成上游像素尺寸。 |
| B8 | 模型特定视频能力默认（agnes-video-2.5 / 2.5-flash 的素材数量、时长、比例、分辨率、操作集） | `model_capability.go:353-390` | 中：这两个模型保存后的能力合同与上游不一致，路由能力/价格档校验会偏差。 |
| B9 | Gemini 图片 `resolutionUsesQuality=true` | `model_capability.go:256` | 中：Gemini 图片的 quality 值本应表达分辨率档，本仓恒 false（`capability-config.ts:595`），价格档 tier/校验判断会走错分支。 |
| B10 | 行内启停不修改 `priceVersion`，且值未变化时不写库 | `admin_channel_model_health.go:204-225` | 中：本仓每次启停（含无变化）都 `priceVersion+1`（`channel-model.service.ts:268-273`），会让并发批量调价的乐观锁误报“价格已变化”。 |
| B11 | 旧数据价格档兜底：无档位但有标量价时合成默认档；空 `selectorKey` 用 resolution/videoSeconds 推导旧键 | `finance_channel_models.go:165-177,203-211` | 中：迁移期数据在后台显示 `priceTiers: []`，批量调价直接因“没有已启用档位”拒绝，而上游仍可展示/继续工作。 |
| B12 | 服务商目录一键接入：`AdminProviderCatalog`（服务商、模型、价格档、KeyGuide、已接入数）、`VerifyProviderCatalogKey`（用 API Key 实拉上游校验模型覆盖）、`InstallProviderCatalog`（按加价率把成本换算成售价并原子创建渠道/模型/档位，写 `CatalogProviderID`） | `app/provider_catalog.go:108-317` | **高**：本仓同名 `/admin/provider-catalog` 只有插件包安装（`plugins/provider-catalog.service.ts`），无法从目录直接生成带定价的渠道；“上游目录接入”这一整条业务链缺失。 |
| B13 | 一次拉取并导入所有缺失模型（`FetchAdminChannelModels`） | `channel_models_catalog.go:12-61` | 低：上游路由未调用，仅测试/内部能力；本仓只能“预览→勾选导入”。 |
| B14 | 协议可用性（`Metadata().Enabled` / `UnavailableReason`）在保存/测试时拒绝 | `channel_models.go:296-303` | 低：插件被禁用后仍可保存/测试该协议的模型，失败推迟到运行期。 |
| B15 | 导入模型时以 `providerModelKey` 作为“已存在”键 | `channel_models_catalog.go:120-124` | 中：本仓按 `modelKey/activeKey` 去重，运营为展示改过 `modelKey` 的模型会被重复导入，产生两条指向同一上游 SKU 的线路。 |
| B16 | 导入请求体 8MB、批量调价 2MB 的独立上限 | `handler/admin_channel_routes.go:123`、`handler/finance.go:388` | 中：本仓全局 100KB（`main.ts:68`），大导出文件无法回导，100 个模型×多档位的调价请求也可能被 413。 |
| B17 | 启动时补齐所有空渠道模型（`EnsureSystemChannelModels`） | `channel_models.go:73-90` | 低：上游也未找到调用点，属预留能力。 |
| B18 | `HistoricalSystemChannelReferences` / `AdminSystemChannelReferences` / `CatalogProviderChannelCounts` 仓库能力 | `repository_channels_settings.go:24-48,72-76` | 低：分别影响历史日志渠道名回填、后台引用下拉、服务商“已接入数”；本仓相关页面若需要需另写查询。 |

### 表C 本仓有、上游无的功能点

| # | 功能点 | 本仓证据 | 说明 |
|---|---|---|---|
| C1 | `GET /admin/channels/:id` 单渠道详情 | `channel.controller.ts:307-311` | 上游只有列表与内部 `SystemChannel(id)`，无后台单查路由。 |
| C2 | `GET /admin/channels/protocols?capability=` 协议目录 | `channel.controller.ts:260-264` | 供渠道模型表单选协议并按能力过滤。 |
| C3 | `GET /admin/channels/health` 运行态健康（启停、协议是否注册、渠道/模型冷却解封时间） | `channel.controller.ts:272-276`、`channel-health.service.ts:27-105` | 与历史成功率互补；上游无此后台端点。 |
| C4 | 跨渠道模型列表支持 `channelId` / `includeDisabled=1` 查询 | `channel.controller.ts:485-499`、`channel-model.service.ts:108-135` | 上游 `/admin/channel-models` 无参数且总是含停用（`admin_channel_model_health.go:57-75`）。 |
| C5 | 细粒度权限（channelRead/channelWrite/channelModelRead/channelModelWrite/channelTest）+ 写操作审计 + 删除/批量删除/调价强制填写 `reason` | `channel.controller.ts:130-163,231-467` | 上游仅 `RequireAdmin`，审计仅启停显式记录（`admin_channel_model_health.go:237`）。 |
| C6 | 连通性测试可带 `modelId`（以库内配置补全）、`waitForResult`、`timeoutMs`，返回状态/错误码/请求摘要/响应预览/logId，并写 `ApiCallLog(billable=false)` | `channel.controller.ts:98-111`、`protocol-test.service.ts:90-275` | 上游只返回 `{durationMs}`，日志依赖内部 analytics 上下文。 |
| C7 | 上游目录拉取使用渠道级代理 | `model-catalog.service.ts:41` | 上游 `FetchChannelModels` 无 proxy 入参（`channel_models_catalog.go:25`）。 |
| C8 | 批量删除同时接受 `ids` 与 `modelIds` 两种字段名 | `channel.controller.ts:130-146` | 兼容上游脚本与本仓前端。 |
| C9 | 删除渠道时同时清空 `headersJson` 并软删价格档 | `channel.service.ts:230-250` | 比上游只清 API/Secret Key、只软删模型更彻底，历史订单仍可回溯。 |
| C10 | 模型健康增加 `avgDurationMs` 与每窗口 `sampled` 标记 | `channel-model-metrics.service.ts:62-75,216-227` | 上游无平均耗时与截断标记（只有整报告 `truncated`）。 |
| C11 | 匿名可访问 `/channels/system`；管理员额外拿真实渠道名/上游地址/并发 | `public-channels.controller.ts:33-42` | 上游该端点仅管理员且仍是公开投影（`handler/auth.go:201-217`）。 |
| C12 | 复制渠道写入执行管理员 `userId` | `channel.controller.ts:329-335`、`channel.service.ts:255-272` | 与上游一致的是复制，但本仓创建路径固定空串，形成“创建无归属、复制有归属”的不一致。 |
| C13 | `ChannelModel.activeKey` 小写归一 + 部分唯一索引替代方案（软删后可用同键重建，且大小写不敏感唯一） | `prisma/schema.prisma:1541-1591`、`channel.presentation.ts:55-58` | 上游唯一键区分大小写，软删依赖 `WHERE deleted_at IS NULL` 的部分索引。 |

### 表D 接口差异（上游 handler vs 本仓 controller）

> 上游路径前缀为 `/api`，本仓为 `/api/v1`；下文省略前缀。除注明外，两边成功封套均为 `{code,data,...}`。

| 上游 | 本仓 | 差异 |
|---|---|---|
| `GET /admin/channels` | 同 | `data` 分页对象字段 `pageSize`（`app/admin.go:73`）→ `limit`（`channel.service.ts:83-88`）；筛选/分页逻辑等价。 |
| `POST /admin/channels` | 同 | 上游 `data = {channel}`（`admin_channel_routes.go:48`），本仓 `data = PublicModelChannel` 本体（`channel.controller.ts:303-305`）。 |
| `PATCH /admin/channels/:id` | 同 | 同上，`{channel}` → 渠道本体。 |
| `POST /admin/channels/:id/duplicate` | 同 | `{channel}` → 渠道本体。 |
| `DELETE /admin/channels/:id` | 同 | 上游无请求体；本仓要求 `{reason}`（`ChannelDeleteBodyDto`），缺省 400。 |
| `POST /admin/channels/export` | 同 | 请求 `{ids?}`、响应导出对象一致。 |
| `POST /admin/channels/import` | 同 | 请求/响应一致，但本仓受 100KB 全局 body 限制（见 B16）。 |
| 无 | `GET /admin/channels/:id` | 仅本仓有。 |
| 无 | `GET /admin/channels/protocols` | 仅本仓有。 |
| 无 | `GET /admin/channels/health` | 仅本仓有（运行态冷却）。 |
| `GET /admin/channels/:id/models` | 同 | 均返回 `{models:[...]}`；模型项本仓缺 `catalogModelKey`，价格档顺序为 `createdAt`（上游按 `selector_key` 升序，`finance_channel_models.go:189`）。 |
| `POST /admin/channels/:id/models` | 同 | 上游 `{model}`（`handler/finance.go:612`），本仓返回模型视图本体（`channel.controller.ts:364-366`）。 |
| `PATCH /admin/channels/:id/models/:modelId` | 同 | 同上，`{model}` → 模型视图本体。 |
| `DELETE /admin/channels/:id/models/:modelId` | 同 | 上游 `{ok:true}`；本仓 `{ok:true,deleted}` 且强制 `{reason}`。 |
| `POST /admin/channels/:id/models/batch-delete` | 同 | 上游入参 `{modelIds}`、响应 `{deleted}`；本仓接受 `ids` 或 `modelIds`、响应 `{ok,deleted}`、强制 `reason`。 |
| `POST /admin/channels/:id/models/batch-reprice` | 同 | 上游入参 `{models}`、响应 `{updated}`；本仓同结构但强制 `reason`。 |
| `PATCH /admin/channels/:id/models/:modelId/enabled` | 同 | 上游返回 `{model}`；本仓返回 `{ok:true}`，前端无法直接拿到更新后的模型。 |
| `PATCH /admin/channels/:id/models/:modelId/sort` | 同 | 上游 `{updated:true}`；本仓 `{ok:true}`。 |
| `POST /admin/channels/:id/models/fetch` | 同 | **契约不同**：上游 `data.models` 是 `string[]`（`PreviewAdminChannelModels` 返回 `[]string`，`channel_models_catalog.go:64-69`、`handler/finance.go:307-312`）；本仓是 `ChannelModelCatalogItem[]` 对象数组（`model-catalog.service.ts:34-43`、`channel.controller.ts:377`）。 |
| `POST /admin/channels/:id/models/import` | 同 | 上游 `{models: 管理员勾选的 string[], added}`（`channel_models_catalog.go:146`）；本仓 `{models: 整个上游目录对象数组, added}`（`model-catalog.service.ts:119`），字段语义与类型都变了。 |
| `POST /admin/channels/:id/models/test` | 同 | 上游入参 `ChannelModelRequest`、响应 `{durationMs}`（`channel_models_test_call.go:145`）；本仓入参 `ChannelModelTestBodyDto`（modelId/waitForResult/timeoutMs）、响应 15+ 字段的 `ProtocolTestResult`（`protocol-test.service.ts:47-65`）。 |
| `GET /admin/channel-models` | 同 | 上游无参、总是含停用模型；本仓默认 `includeDisabled=false`（`channel.controller.ts:496`），不传参时停用模型不返回。 |
| `GET /admin/channel-models/health` | 同 | 上游 `data = {items, computedAt, truncated}` 且 item 为平铺 24h/7d 字段 + `recentResults: boolean[]`；本仓 `data = {items}`，item 为 `windows.day/week + recent[] + lastErrorCode`（`channel.controller.ts:509-513`）。 |
| `GET/PUT /admin/channels/order` | 同 | PUT 上游 `{saved:true}`；本仓 `{ok:true}`。 |
| `GET/PUT /admin/channels/:id/models/order` | 同 | 同上。 |
| `GET /channels/system` | 同 | 上游必须管理员 + 公开投影（`handler/auth.go:201-217`）；本仓可选登录，管理员拿后台投影。 |
| `GET/POST /admin/provider-catalog*` | 同 | 路径相同、语义不同：上游是服务商目录+校验 Key+一键建渠道（`provider_catalog.go:108-317`）；本仓是插件包目录+安装插件（`plugins/provider-catalog.controller.ts:19-48`）。 |
| `POST /ai/models` | 同 | 均返回 `{models: 目录项[]}`；本仓限流/出站/代理更完整。 |

### 测试文件汇总

上游渠道域有约 15 个测试文件（`admin_channel_test.go`、`channel_models_test.go`、`channel_models_pricing_test.go`、`channel_model_pricing_test.go`、`channel_model_tags_test.go`、`channel_model_label_test.go`、`channel_model_upstream_rename_test.go`、`channel_models_admin_test_defaults_test.go`、`channel_model_directory_test.go`、`channel_order_test.go`、`channel_presentation_test.go`、`channel_transfer_test.go`、`admin_channel_model_health_test.go`、`handler/credit_cost_routes_test.go`、`handler/finance_routes_test.go`）；本仓渠道域 **0 个测试文件**（全仓仅 5 个 `.spec.ts`，均与渠道无关），保存顺序、批量原子性、重复导入、复制、排序 CAS、导入导出、健康聚合等关键不变量无自动化保护。

### 结论优先级（便于排期）

1. **B1 / B6 / B12 / B3**：会直接造成数据丢失或整条业务链不可用（复制清空模型清单、图片合同校验被绕过、服务商目录一键接入缺失、健康契约不兼容）。
2. **B2 / B10 / B15 / B11**：数据一致性/并发正确性问题，症状隐蔽（导入丢来源、启停误伤调价、重复 SKU、旧档位不可见）。
3. **B4/B5/B7/B8/B9/B16**：迁移兼容与边界能力，影响旧数据与特定协议模型。
4. 契约类差异（D 表）建议在联调层统一：`fetch/import` 返回对象数组是当前最容易被前端误用的破坏性变化。


## 2. 前台模型 / 目录 / 路由 / 用户分组逐文件对照

- 上游：`/Users/bright/github/open-ai-canvas/backend/internal/{app,repository,handler,model}`
- 本仓：`/Users/bright/github/aigc-creation/backend/src/model/**`、`prisma/schema.prisma`
- 方法：逐文件实读源码（含 `image_parameters.go`、`finance.go groupTierPrices`、`credit_policy.go`、`channel_models_pricing.go` 等同域补充文件），只读，未改任何仓库文件。
- 状态图例：✅对齐 / 🔀合并或重构 / ⚠️有意差异 / ❌未移植 / ➕仅本仓有。

---

### 表A 逐文件对照

| 上游文件 | 本仓对应文件 | 状态 | 具体功能差异与证据 |
|---|---|---|---|
| `app/logical_models.go`（836 行：Admin CRUD / bundle 校验 / simulate / 价格展示） | `catalog/logical-model.admin.service.ts`、`catalog/admin-logical-model.controller.ts`、`catalog/catalog.service.ts`、`catalog/quote.service.ts` | 🔀 | ① 保存流程对齐：`buildBundle()` = 上游 `logicalModelBundle()`，同样 code 正则、name ≤120、pricePolicy∈{channel,unified}、channel 策略强制 `billing_mode=fixed_request` 且四价归零、routes 去重/权重/系统渠道/能力一致；`save()` 事务内 `revisionSequence` 原子递增（Prisma `increment`）并建 revision+routes，对齐上游 `SaveLogicalModelBundle`。② **能力语义是有意差异**：上游 `LogicalModel.Capability` 是模态（image/video/text），本仓存 C 端能力 id（`free_create` 等），用 `getCapability(capability).model.capability` 校验模态（`logical-model.admin.service.ts:307-313`，文件头 14-17 行注明）。③ **审计语义相反**：上游 `SaveAdminLogicalModel` 在事务内写审计、审计失败返回错误（`logical_models.go:311-314`）；本仓用 `@AuditAction` 拦截器且"审计失败不阻断业务"（`admin/audit.interceptor.ts:47-51`）。④ 列表投影：上游 `AdminLogicalModels` 遇到渠道模型缺失直接报错；本仓 `missingRoute=true` → `configurationError` 字符串（`logical-model.admin.service.ts:609-612,665-669`），且 `decodeLogicalDefaults` 失败被吞成 `{}`（656-664）而上游 fail-closed。⑤ 本仓 `adminPriceTiers()` 去重键只看 `JSON.stringify(selector)`（792-794），上游 `publicLogicalModelPriceTiers` 的键含 billingMode+四项价格（`logical_models_catalog.go:165`），同一 selector 不同计费/价格会被本仓折叠；且本仓未做 `validateImageParameterPriceSelector` 过滤。⑥ 路由排序：上游 `LogicalModelRoutes` `priority desc`，本仓 `buildViews` `priority asc`（514）。 |
| `app/logical_models_catalog.go`（公开目录投影 / 分组线路 / 价格档 / 能力画像） | `catalog/catalog.service.ts` | 🔀 | ① 分组过滤 + 价格换算结构对齐：`projectForGroup()` ≈ `groupLogicalModel()`，不可见渠道剔除、无可见线路返回 null、unified 只对行标量价打折、channel 逐档换算。② **换算顺序对齐但键不同**：两边都是"货币 → 微积分 → 分组倍率"（`catalog.service.ts:115-133` 注释"顺序反过来会把倍率乘进货币口径"），但本仓 `access.pricing(currency,[cached.code, channelModel.modelKey])` 且倍率恒用 `pricing('credits',[cached.code])`（102、110），上游 channel 档用 `channelModel.ModelKey`（`logical_models_catalog.go:69`、`finance.go:719`）。③ **本仓缺 product match 前置**：上游带 intent 时先 `MatchCapability(cached.ProductSpec, resolvedIntent)`，不匹配 `continue`（`logical_models_catalog.go:35-38`）；本仓 `computeAvailable()` 只判 `logicalModelCapabilityCovered` + `hasCompatibleRoute`（`catalog.service.ts:151-165`），产品合同更窄时会"列出可用、下单被拒"。④ **本仓缺图片价格档合法性过滤**：上游对 `route.CapabilitySpec.ImageParameters` 逐档 `validateImageParameterPriceSelector` 并跳过非法档、用 `model.CanonicalSKUSelector` 归一（`logical_models_catalog.go:154-169`）；本仓 `publicPriceTiers()` 只判 `enabled && priceConfigured`（218），非法档会出现在目录里，但选路 `pickPriceTier()` 会跳过 → 展示价与可成交价分叉。⑤ 旧档 selector 回退：上游用 `skuSelectorForTier(tier)`（空选择器回落到 `vquality/videoSeconds`），本仓非图参数档直接用 `tier.selector`（219）→ 旧式只填 `resolution` 列的档在目录里显示 `{}`。⑥ 缺货币比例时上游"跳过该线路"（`groupLogicalModel` 中 `skip=true; continue`），本仓 `access.pricing()` 直接 `badRequest` 抛错（`user-group.service.ts:116-119`）→ 单个分组缺 USD/CNY 比例会让整份 `/models` 失败。 |
| `app/logical_models_coverage.go` | `intent/capability-spec.ts`（`validateProductSpecWithinRoutes` / `inputConstraintCovered` / `optionConstraintCovered` / `continuousOptionRangeCovered`） | ✅ | 逻辑逐行等价：operations 的 OR 覆盖（空 operations 表示不限制）、inputs 区间并集覆盖、options 值枚举/区间/步长、>10000 步长的"连续区间或步长整除"降级，错误文案一致（`capability-spec.ts:512-645`）。 |
| `app/logical_model_quote.go` | `catalog/quote.service.ts` | 🔀 | ① 前台模型报价都走 `resolve` + 价格档 + 同一换算，`fixed_request/per_second` 金额公式一致。② **视频 Token 报价是有意差异**：上游按 `estimateTaskBillingTokens` 给出金额并带 `VideoTokenEstimate`（`logical_model_quote.go:105-116,167-169`）；本仓 `tokenQuote()` 对 video 返回 `amountMicrocredits:null, quantity:0` + note（`quote.service.ts:271-286`，文件头 P3 说明）。③ 渠道模型报价：上游走 `newBillingOrderWithPriceTier` 真建单（幂等键 `quote`）再 `quoteFromOrder`（`logical_model_quote.go:28-53`）；本仓 `quoteChannelModel` 纯计算、不建单（`quote.service.ts:179-202`）。④ 本仓响应多 `code/priceTierId/priceSelector/note`，少 `videoTokenEstimate`。⑤ 统一价 token：上游校验 `routed.ChannelModel.Capability==capability && supportsTokenBilling(...)` 且拒绝视频非 0 输入/缓存价；本仓 `tokenQuote` 只按 capability 判定（`capability!=='text'` 即拒，视频单独 pending），没有协议/线路校验。 |
| `app/model_availability.go` | `channels/channel-model-metrics.service.ts`（算数据）+ `catalog/public-model-catalog.service.ts:430-443 availabilityOf`（投影） | 🔀 | ① 都有 24h/7d 成功率 + 30s 缓存 + `dataState`；本仓数据源 `ApiCallLog.requestKind=create` 且按 `channelModelId` 聚合（`channel-model-metrics.service.ts:142-168`），上游按 `(channelID, modelKey)` 聚合（`model_availability.go:12-15,71`）。② **缺功能**：上游有 `trend7d`（7 个日桶）、`recentResults`（最近 10 次布尔序列）、`computedAt`、`dataThrough`、最少 10 样本门槛（不足时 `rate=null` + `dataState=insufficient`，`model_availability.go:10,99-143,181-190`）；本仓 `availabilityOf` 只出 `rate24h/sampleCount24h/rate7d/dataState(ok|no_data)`（`public-model-catalog.service.ts:430-443`），无 trend/recent/门槛。③ 上游 `attachPublicModelAvailability` 挂到每个渠道模型，本仓在 `projectModel()` 内直接挂（241）。 |
| `app/model_capability.go`（能力配置结构 / 归一 / → CapabilitySpec） | `domain/capability-config.ts`、`intent/capability-spec.ts`、`intent/image-contract.ts` | 🔀 | ① 数据结构、文本/图片/视频字段、`normalizeModelCapabilityConfig()` 的默认值（context 128000 / maxOutput 16384）与校验基本对齐。② `capabilitySpecFromModelCapabilityConfig()` 与上游同构（text inputs、image size/resolution/quality/transparent/count、video duration/ratios/resolutions/audio/watermark/processing fpsBand）。③ **差异**：上游 `channelModelCapabilitySpec()` 用 `capabilitySpecWithPriceTiers()` 把视频 `vquality/videoSeconds` 裁剪到"启用且已定价"档（`logical_models.go:646-703`）；本仓 `route-catalog.service.ts:179` 的 `projectCachedChannelModel()` **不调用** `capabilitySpecWithPriceTiers`（仅 `logical-model.admin.service.ts:464,615` 调），公开目录/选路会用未定价档去匹配。④ 图片 `size` 选项：上游 size.Parameter≠none 时无条件写 `spec.Options["size"]`；本仓仅在 `values.length>0` 时写（`capability-spec.ts:208-214`）以免归一报错。⑤ 本仓在派生末尾 `normalizeCapabilitySpec(spec)`（223/255），上游不归一。⑥ 上游 `applyModelSpecificVideoCapability`（agnes-video-2.5 特例）在 `capability-config.ts` 无对应实现。 |
| `app/model_capability_argument.go`（modelCapabilityMismatchError / 字段级错误） | `intent/capability-match.ts` + 路由层 `badRequest(productMismatchMessage)` | ❌（部分） | 上游把匹配结果包装成 `ModelError(ErrCodeModelCapabilityNotSupported)`，带 `capabilityIssues[]` 与 `field/issue/message`（`model_capability_argument.go:28-44`），Agent/前端可按字段纠错；本仓 `matchCapability()` 产出 `issues`（含 kind/name/reason），但 `router.service.ts:113,314-317` 只取 `reasons[0]` 拼字符串，`field/issue` 与错误码丢失。 |
| `app/model_capability_defaults.go`（按协议的默认能力模板 + OpenAI 像素表 + 平台特例） | 无 | ❌ | 本仓无 `DefaultModelCapabilityConfig/DefaultImageCapabilityConfig`、无 `openAIImageDefaultSizeTable`（10 比例×1K/2K/4K）、无 kemei/Grok/Gemini/Ark/即梦/Novita/MiniMax/Veo/MediaKit 的视频/图片默认档，也没有 `legacyImageSizeValues` 之外的旧数据修复。后果：渠道模型保存必须显式提交完整 `capabilityConfig`（`channel-model.service.ts:165-173`），缺省即 400，无法"新建即带合理默认"。 |
| `app/model_capability_kemei.go` | 无（仅 `capability-config.ts:561-565` 协议白名单含 `km-kemei-seedream`） | ❌ | `kemeiSeedreamImagePresets()`（25 尺寸，1K/1.5K/2K 三档 × 8 比例）未移植，1.5K 独立档只能靠管理员手填 presets；`legacyImageResolutionConfig` 的 1.5k 白名单在（564），但预设表不在。 |
| `app/model_capability_screen_spec.go` | 无（`capability-config.ts:106-111,141` 只有 `fixedScreenSpec` 类型） | ❌ | `normalizeAutoDLVideoScreenSpec()`（从官方插件 manifest 读 workflow 分辨率预设、32 值/40 字符上限、默认值必须在预设内）与 `applyAutoDLVideoScreenSpec()`（执行期把 Size 清空、解析/回填 VQuality）均未移植；本仓 AutoDL 线路既不能自动校验预设，也没有执行期分辨率归一。 |
| `app/model_capability_validate.go`（1091 行：配置校验 + 任务准入校验） | `domain/capability-config.ts`（validate*）+ `domain/selector.ts`（价格档能力校验） | 🔀（配置侧对齐，任务侧缺失） | ① 配置侧对齐：`validateTextCapabilityConfig / validateImageCapabilityConfig / validateVideoCapabilityConfig / validateVideoDuration / validateVideoProcessingConfig / validateImagePresetSelection` 文案与边界值一致（`capability-config.ts:278-557`）；`validateChannelModelTierCapabilities / validateTokenPrices / validateChannelModelTierPricing / validateChannelModelPrice` 在 `selector.ts:288-480`。② **任务准入侧未移植**：`ValidateTaskCapability` / `validateImageTask` / `validateVideoTask`（提示词 `promptMaxChars`、参考图/视频/音频数量与 `Bytes/DurationMs`、蒙版、比例/时长/分辨率枚举、`DefaultOperation`、火山"纯音频不支持"特例、`validateGPTImage2CustomSize`）在本仓 `src/model/**` 中无对应实现（grep `validateVideoTask|promptMaxChars 比较|validateGPTImage2` 无命中），只有 `matchCapability` 的数量/枚举匹配 + `task-admission.service.ts:174-176` 的 mask 线路检查。③ `fillMissingImageSizePresets/imageSizePresetReadyError/validateImageSizePresetRequirement`（缺像素换算表时 fail-closed）未移植。 |
| `app/model_catalog.go`（`/model-catalog` 渠道模型读模型 + 可用性） | `catalog/public-model-catalog.service.ts` | 🔀 | ① 结构对齐：`source/models(空)/channels[].models[]`、渠道 name/displayName 置空、`available = 价格档数>0`、intent 过滤（能力类型 + `matchCapability`）。② 渠道模型脱敏字段：上游 `sanitizeChannelModel` 会剔除 `!ValidatePriceTierPrice` 的档、并用 `validateImageParameterPriceSelector` 过滤图片档（`model_catalog.go:206-217`）；本仓 `publicTiers()` 只判 `enabled/priceConfigured`（`public-model-catalog.service.ts:378-380`），无计价合法性/图片选择器校验。③ 上游 `defaultOptions` 来自 `channelModelDefaultOptions()`（渠道默认参数 + 首个可结算视频档回退）；本仓固定 `decodeLogicalDefaults('{}', spec)`（235），只有合同默认值，没有"默认规格无价时回退到第一个可结算档"。④ 可用性形状见 `model_availability.go` 行。⑤ 报价入口 `quote()` 额外校验 `capabilitySpec` 匹配（上游在 resolveSystemChannelModelSelection 内）。 |
| `app/model_router.go`（602 行：快照装载/缓存/失效、resolve、硬分层、SKU 选择、加权、诊断） | `catalog/route-catalog.service.ts`、`routing/router.service.ts`、`routing/price-tier.service.ts`、`intent/model-intent.ts` | 🔀 | **核心算子逐条核对结果**：<br>• priority 硬分层：两边都在遍历中"发现更高 priority 就清空候选"，只保留最高层（`router.service.ts:161-173` ↔ `model_router.go:228-253`）✅<br>• 同层加权：`weightedRoute()` 均用 `crypto/randomBytes` + 拒绝采样（`threshold = 2^64 mod total`），≤0 回落首条，16 次退化为首条（`router.service.ts:291-311` ↔ `model_router.go:551-584`）✅<br>• SKU 选择器：`skuSelectorForIntent` 视频（video>image 归 video_to_video / imageCount/vquality/videoSeconds/videoGenerateAudio/fpsBand）、图片（原参数 + quality/resolution/size 旧键、像素→1k/1.5k/2k/4k）逐行等价（`model-intent.ts:316-373` ↔ `model_router.go:335-402`）✅；`skuSelectorForTier`（quality∈分辨率档时迁移为 resolution、空值回落 resolution/videoSeconds）等价（`selector.ts:539-554`）✅<br>• 1.5K 相邻档：`matchSkuSelector` 仅在 tier 期望 `1k/2k` 且请求 `1.5k` 时放行、且不计分（`selector.ts:560-577` ↔ `model_router.go:484-501`）；`imageResolutionTierForSize` 的 Seedream 1.5K 尺寸表与 2M/5M/8.29M 阈值也一致（`model-intent.ts:39-58`）✅<br>• 目录装载剔除规则等价：渠道/模型停用、unified+token 不支持、channel 无有效档、能力非法（`route-catalog.service.ts:176-209` ↔ `model_router.go:143-176`）✅<br>• **差异**：上游 `loadRouteCatalog` 只取 `enabled && weight>0` 的线路（repo 过滤），本仓 `where enabled:true` 后把 `weight` 可为 0 的线路也装入快照（153），仅在使用处过滤；`simulate` 会显示这些"快照里本不该存在"的线路。<br>• **差异**：本仓 `snapshotOrThrow()` 命中时只看 TTL（`route-catalog.service.ts:100-103`），版本号只在回源时读；上游每次取快照都比对 `currentRouteCatalogVersion()`（Redis，256ms 读缓存，`model_router.go:38-47,87-111`），跨进程改价可近实时生效，本仓最多滞后 30s TTL。<br>• **差异**：上游 `routeCatalogRefreshError/RetryAt/routeCatalogMaxStale` 与 Redis 协调器（`invalidateRouteCatalog` 里 `BumpRouteCatalogVersion`）在本仓改为 DB `RouteCatalogVersion` 表 + `CatalogVersionService`（`catalog-version.service.ts`），无 Redis 广播，属于单实例/DB 化的有意替换。<br>• **差异**：本仓渠道查询 `modelChannel.findMany({enabled,deletedAt:null})` 未加 `scope:'system'`（`route-catalog.service.ts:168-171`），上游 `SystemChannelsByIDs` 强带 `scope=system`（`repository/logical_models.go:97-107`）。 |
| `app/model_router_attempts.go`（514 行：尝试状态机/切线/冷却/归档重试） | `tasks/task-attempt.service.ts`、`tasks/task-worker.service.ts`、`routing/route-health.service.ts` | 🔀 | ① 四态 dispatchState 与 CAS 语义对齐：`begin()` 的 not_sent→submission_unknown 条件更新、accepted→poll、rejected_no_job→switch、submission_unknown→uncertain（`task-attempt.service.ts:107-144` ↔ `model_router_attempts.go:38-104`）；`safeRouteRejection` 白名单一致（401/403/404/429 + 本仓 `channel_unavailable`）。② 冷却三键一致：`channel:<id>`(401/403=10min,429=30s)、`channel-model:<id>`(404=10min)、`route:<id>`（`route-health.service.ts:34-53,107-109` ↔ `model_router_attempts.go:328-360,503-538`）+ 冷却中线路从候选池剔除（`router.service.ts:162`）✅。③ **冷却差异**：本仓无 Redis/跨实例冷却（`route-health.service.ts:14-17`），429 固定 30s（`task-worker.service.ts:823`），上游优先用上游 `Retry-After`（`model_router_attempts.go:338-343`）。④ **归档重试缺口**：上游 `prepareLogicalTaskRetry` 对归档模型走 `resolveArchivedTaskRoute()`，用任务保存的 revision/route/channelModel 快照重试（`model_router_attempts.go:362-457`）；本仓 `task-worker.resolveRoute()` 遇到 `model.archivedAt!==null` 直接返回 null（`task-worker.service.ts:392-393`），归档模型的历史任务重试必然失败。⑤ 换线账单：上游 `SwitchTaskLogicalRoute` 同事务更新 task+账单并做"不扩大原授权上限"校验（`repository/logical_models.go:281-388`）；本仓 `replaceBilling()` 先退旧单再预留新单（`task-worker.service.ts:488-570`），效果等价但非单事务，中途失败依赖 `lifecycle.fail`。 |
| `app/model_router_capability.go`（CapabilitySpec 解码/归一/匹配） | `intent/capability-spec.ts`、`intent/capability-match.ts`、`intent/model-intent.ts`、`intent/option-values.ts` | 🔀 | ① `NormalizeCapabilitySpec` 字段级等价：version=1、operations 去重小写、inputs min/max 校验、options 别名归一去重、values/range 互斥、step>0、图片参数校验（`capability-spec.ts:73-155`）。② `MatchCapability` 顺序与规则等价：图片参数（size 预设命中时从参数表剔除 size）→ 能力类型 → operation（spec 为空则不限）→ inputs 双向（缺声明且 count>0 报不支持；未传但 min>0 报最少）→ options（`inactiveCapabilityOptionValue` 跳过 auto/any/空/false/0）→ vquality 别名比较（`capability-match.ts:45-104`、`option-values.ts:82-152`）。③ **本仓新增** `restrictIntentToSpec()`（`model-intent.ts:211-235`）：准入前把意图里"合同未声明"的参数/输入**静默裁剪**，上游没有该步骤（上游会报"不支持参数"）。④ 本仓 `buildModelRequestIntent()` 严格校验 capability/inputs 白名单/0-128/options 必须是对象（`model-intent.ts:261-303`），上游 handler 直接 bind JSON。⑤ 错误结构：上游 `CapabilityIssue{Kind,Name,Reason}` + `ModelError` 字段级；本仓 issue 结构相同但上层只取 `reasons[0]`（见 `model_capability_argument.go` 行）。⑥ `normalizeImageSizeIntent` / `capabilityImageSizePresetMatches` 语义一致（`model-intent.ts:100-196`）。 |
| `app/user_groups.go`（673 行：分组解析/可见性/定价/管理） | `user-groups/user-group.service.ts`、`user-groups/user-group.admin.service.ts`、`user-groups/user-group.controller.ts` | 🔀 | ① 可见性/定价算子对齐：`allowsChannel/requireChannel/pricing/combineMultiplierBPS` 语义一致（`user-group.service.ts:76-121` ↔ `user_groups.go:270-383`），倍率=分组×模型覆盖、货币 rate 取覆盖优先，`RateMicrocredits<=0`/`Multiplier<=0` 都拒绝。② **映射方式有意不同**：上游 `users.user_group` 列；本仓 `User → Membership(status active/grace) → MembershipPlan.userGroupCode`，无会员落 default（`user-group.service.ts:212-224`，文件头说明）。③ **缺全局积分策略倍率**：上游 `groupTierPrices()` 先 `combineMultiplierBPS(policy.DefaultMultiplierBPS, policy.ModelMultiplierBPS[modelKey], pricing.MultiplierBPS)`（`finance.go:714-745` + `credit_policy.go`），本仓全链路只有分组×覆盖（`billing.service.ts:206-222,237`），没有系统级/按模型倍率这一层。④ 覆写键：上游 channel 策略只看 `channelModel.ModelKey`，本仓 `[logicalModel.code, channelModel.modelKey]`（`billing.service.ts:206-209`、`catalog.service.ts:110`）。⑤ 默认分组：两边都启动补齐（`ensureDefaultGroup` vs `EnsureDefaultUserGroup`），倍率 10000、USD=7e6、CNY=1e6、allChannels=true 一致。⑥ 匿名访问差异：上游 `PublicLogicalModels/ModelCatalog` 必须登录（`currentUser`），本仓 `accessForUser(null)` → `systemAccess()`（bypassVisibility=true，`user-group.service.ts:199-209`），匿名可见全部渠道。⑦ 管理侧：上游 `RequireAdmin` + `appendAdminAudit` + 删除前 `UserGroupUserCounts/ErrUserGroupInUse`；本仓 `@RequirePermission(userGroupRead/Write)` + `@AuditAction`，删除改软删并检查 `MembershipPlan.userGroupCode` 引用（`user-group.admin.service.ts:173-191`），用户数按有效会员统计（315-341）。⑧ 覆写解码：本仓容忍 `pointsPerUsd`/`pointsPerUsdMicrocredits` 两种键，非法条目丢弃而不整表失败（`user-group.service.ts:272-294`）；上游任一条非法即整份快照报错（`user_groups.go:192-204`）。 |
| `repository/logical_models.go` | `catalog/logical-model.admin.service.ts`（save/archive 事务）、`catalog/route-catalog.service.ts`（装载）、`channels/channel-model.repository.ts`（引用保护） | 🔀 | ① `SaveLogicalModelBundle` 事务（建/更新模型 → 原子递增 revision_sequence → 建 revision → 建 routes → 回写 active_revision_id）由本仓 `save()` 的 `$transaction` 等价实现（229-262）。② `ArchiveLogicalModel` 的"存在排队/执行任务则拒绝 + 归档写审计 + enabled=false"：本仓 `archive()` 校验 `generationTask.count(status in queued/running)` 后 `archivedAt/enabled=false/activeKey=null`（277-295），**无行锁**（上游 PostgreSQL `FOR UPDATE`，459-495），也**无同事务审计**。③ **缺** `requireActiveLogicalModelForTask`（任务写入时锁定模型行并校验 `enabled && archived_at is null && active_revision_id=task.revision`，`logical_models.go:497-519`）；本仓建任务只读内存快照 + 写前 `archivedAt/enabled` 检查（`task-admission.service.ts:157-163`），快照 30s 窗口内归档可与建单竞态。④ `LogicalModelsBySourceChannelModelID / LogicalModelsByOnlyActiveChannelModelID / DeleteLogicalModelRoute` 在上游无调用方（grep 仅定义处），本仓未实现属等价。⑤ 本仓新增渠道模型删除保护：仍有未归档前台 revision 引用或排队/执行任务时拒绝（`channel-model.repository.ts:178-198`）。 |
| `repository/repository_user_groups.go` | `user-groups/user-group.service.ts`（快照）+ `user-group.admin.service.ts`（写） | 🔀 | ① 分组+渠道绑定同事务整体替换：`replaceChannels()` 对齐 `SaveUserGroupWithChannels`（删旧再建）。② 删除保护：上游按 `users.user_group` 计数；本仓按 `MembershipPlan.userGroupCode`（175-182）+ 软删 `deletedAt/activeKey=null`。③ 快照加载：上游 `UserGroups()+UserGroupChannels()` 后按 ID 绑渠道；本仓 `groups()` 同样一次取两表（`user-group.service.ts:242-268`），非法 overrides 上游整份报错、本仓逐条丢弃。 |
| `handler/logical_models.go` | `catalog/models.controller.ts` + `catalog/admin-logical-model.controller.ts` | 🔀 | 路由集合基本一一对应；差异见**表D**（匿名可访问、响应包裹形状、新增 GET :id / includeArchived）。 |
| `handler/model_catalog.go` | `catalog/model-catalog.controller.ts` | ✅ | 3 个端点、渠道+modelKey 报价语义一致；本仓额外接受嵌套 `intent` 对象（`ChannelModelQuoteBodyDto`），意图归一后行为一致。 |
| `handler/admin_user_group_routes.go` | `user-groups/user-group.controller.ts` | ✅ | CRUD 全对齐，权限由 `@RequirePermission` 承担（上游 service 层 `RequireAdmin`），本仓多 `GET :id`。 |
| `model/models_logical_model.go` | `prisma/schema.prisma` `LogicalModel`(1639)/`LogicalModelRevision`(1683)/`LogicalModelRoute`(1699)/`RouteAttempt`(1715) | ✅ | 字段一一对应；差异是 Prisma 世界：`LegacyModelIDsJSON→legacyModelIdsJson`、`ArchivedAt`、`RevisionSequence`、`ProviderRequestID`、`DispatchState` 全保留；`@@unique([logicalModelRevisionId,channelModelId])` 对齐 `idx_logical_route_member`；`@@unique([taskId,routeRun,attemptNumber])` 对齐。code 唯一性用 `activeKey @unique`（上游为 `where archived_at IS NULL` 部分唯一索引）。**`LogicalModelPriceSKU` 上游仅在 `models_logical_model.go:84-105` 定义、全仓零引用（grep 只有定义处），本仓不建表属等价，不是缺口。** |
| `model/models_user_group.go` | `prisma/schema.prisma` `UserGroup`(1753)/`UserGroupChannel`(1787) + `user-group.service.ts` 类型 | ✅ | 字段、徽章枚举、`RatioBasisPoints` 语义、`PriceCurrency` 常量均等价；本仓多 `deletedAt/activeKey`（软删）。 |
| `model/models.go`（模型域定义） | — | N/A | 该文件 170 行内不含 LogicalModel/UserGroup/Route 定义（域定义在 `models_logical_model.go` / `models_user_group.go`），无对应内容可对照。 |
| `model/model_sku.go` | `domain/selector.ts`（`canonicalSkuSelector` / `decodeSkuSelector`） | ✅ | 都是"trim + 去空键值 + 以有序 JSON 作唯一键"；本仓显式 `Object.keys().sort()`，Go `json.Marshal(map)` 亦按键排序，落库唯一键一致。 |
| （补充）`app/image_parameters.go` | `domain/image-parameters.ts` + `intent/image-contract.ts` | ✅ | `resolveImageParameterValues`（默认值合并、未启用参数拒绝、required 校验）、`imageParameterConstraints`（values/boolean/string/number 分支、`*` 通配）、`validateImageParameterPriceSelector`（只允许 enabled&pricing、operation 白名单）、`activeImageSizePresets`、`imageSizeOptionConstraint`、`effectiveImageParameterSpec`（跨线路并集/冲突剔除/宽度取并/区间取交）均逐段对齐（`image-contract.ts:24-193`、`capability-spec.ts:391-476`）。差异：本仓 `capabilityFingerprint` 额外排序 `imageParameters`（`capability-spec.ts:503-505`），上游未排序（`logical_models_catalog.go:297-314`）→ 画像去重更稳定，属改进。 |
| （补充）`app/finance.go groupTierPrices` / `app/credit_policy.go` | `billing/billing.service.ts buildDraft` | ⚠️ | 换算式对齐（`convertCurrencyPrice` 先按 rate 折算、再用 `creditAmount` 叠倍率并向上取整），但少了 `creditPolicy` 的 `DefaultMultiplierBPS`/`ModelMultiplierBPS` 合乘（见 `user_groups.go` 行③）。 |
| （补充）`app/channel_models_pricing.go supportsTokenBilling` | `domain/selector.ts supportsTokenBilling` | ✅ | 上游第二参数 `_ model.ChannelInterfaceType` 未使用（`channel_models_pricing.go:99-101`），本仓单参数签名等价；"只有 text/video 支持 token"一致。 |

---

### 表B 上游有、本仓无的功能点（逐条 + 影响）

> 分类：**缺口**=真实能力缺失；**有意替代**=架构/部署形态导致，功能效果等价或可接受；**语义差异**=两边都能跑但结果不同。

| # | 上游能力（证据） | 本仓现状 | 分类 | 影响 |
|---|---|---|---|---|
| B1 | `/models available` 带 intent 时先做产品合同匹配，不匹配直接不返回（`logical_models_catalog.go:35-38`） | `computeAvailable()` 只判覆盖 + 线路兼容（`catalog.service.ts:151-165`） | 缺口 | 前端"可用模型"里可能出现下单必被拒的模型（产品合同比线路窄时），用户点进去才报 400。 |
| B2 | 线路能力合同按"启用且已定价"的价格档裁剪视频分辨率/时长（`logical_models.go:646-703`，被 `channelModelCapabilitySpec` 全局使用） | 仅在后台管理与保存校验时裁剪（`logical-model.admin.service.ts:464,615`），载入快照的线路合同不裁剪（`route-catalog.service.ts:179`） | 语义差异 | 公开目录的 `capabilitySpec/priceTiers` 会展示无法定价的规格；后台"能力覆盖"判定与运行期判定可能不一致。 |
| B3 | 公开价格档逐档校验图片 `pricing` 参数选择器，非法档不发布（`logical_models_catalog.go:154-169`；渠道目录 `model_catalog.go:213-217`） | `catalog.service.ts:210-243` 与 `public-model-catalog.service.ts:365-417` 都不调用 `validateImageParameterPriceSelector` | 缺口 | 目录可展示一个"永远选不中"的价格档（选档侧会跳过），出现展示价≠可成交价。 |
| B4 | 分组缺某计价货币兑换比例时"跳过该线路/该模型"（`logical_models_catalog.go:63-88`） | `UserGroupAccess.pricing()` 缺比例直接抛 400（`user-group.service.ts:116-119`），`projectForGroup` 无 try/catch（`catalog.service.ts:110`） | 缺口 | 一个分组漏配 USD/CNY 比例会让该分组整份 `/models`、`/model-catalog`、报价全部 500/400，而不是只隐藏相关档。 |
| B5 | 全局积分策略倍率：`DefaultMultiplierBPS` + `ModelMultiplierBPS[modelKey]` 与分组倍率连乘（`credit_policy.go`、`finance.go:723-727`） | 无该配置层（grep `creditPolicy/defaultMultiplierBps` 无命中；`billing.service.ts`、`catalog.service.ts` 只用 `pricing.multiplierBasisPoints`） | 缺口 | 失去"系统级加价/按模型费率调节"能力；若运营依赖该策略，迁移后价格口径会整体偏低。 |
| B6 | channel 策略定价与挂账统一用 `channelModel.ModelKey` 匹配分组覆写（`finance.go:719`、`logical_models_catalog.go:69`） | `[logicalModel.code, channelModel.modelKey]`，且倍率只用 `logicalModel.code`（`billing.service.ts:206-209`、`catalog.service.ts:102,110`） | 语义差异 | 同一渠道模型投影成多个前台模型时，按渠道模型 key 配的覆写不再生效/被前台 code 覆写抢先；目录与账单两边都改了口径（一致，但与原数据不兼容）。 |
| B7 | 可用性含 `trend7d` 日桶、`recentResults`、`computedAt/dataThrough`、最少 10 样本门槛与 `insufficient` 状态（`model_availability.go:99-143,181-190`） | 只有 `rate24h/sampleCount24h/rate7d/dataState(ok\|no_data)`（`public-model-catalog.service.ts:430-443`） | 缺口 | C 端无法画 7 天趋势/最近 N 次信号；1~9 个样本时会把"证据不足"显示成 `ok`。聚合键也从 (channel,modelKey) 变为 channelModelId。 |
| B8 | 视频 Token 报价给出估算金额与 `VideoTokenEstimate`（`logical_model_quote.go:105-116,167-169`） | 视频 Token 返回 `amountMicrocredits:null, quantity:0` + note（`quote.service.ts:271-286`） | 语义差异（有意，P3） | 前端无法在确认页展示视频 Token 预估；依赖 `amount` 的客户端会显示"待定"。 |
| B9 | 归档模型的历史任务可凭 revision/route/channelModel 快照重试（`model_router_attempts.go:362-457 resolveArchivedTaskRoute`） | `task-worker.resolveRoute()` 要求 `!model.enabled`/`archivedAt==null`，否则 null（`task-worker.service.ts:392-393`） | 缺口 | 模型归档后，之前失败任务的"重试"必然失败/退款，用户只能换模型。 |
| B10 | 保存 unified+token 时 `validateTokenPrices` 强制视频 input/cached 必须为 0（`logical_models.go:439-443` → `selector.go` 的 `validateTokenPrices`） | 保存只校验"text/video 支持 token + 至少一项价格>0"（`logical-model.admin.service.ts:344-349`），视频 input/cached 非 0 可落库 | 缺口 | 能保存一个"报价/下单必失败"的前台模型（`quote.service.ts:272-274` 才拒绝）。 |
| B11 | 任务准入按模型合同校验提示词长度、参考素材字节/时长、蒙版、比例/时长/分辨率枚举、默认 operation、GPT-Image-2 自定义尺寸（`model_capability_validate.go:276-1014`） | 仅有 `matchCapability` 的数量/枚举匹配 + mask 线路检查（`task-admission.service.ts:171-177`） | 缺口 | 超长提示词、超大/超时长素材、单档位分辨率、`DefaultOperation` 约束等不再在扣费前拦截，会把上游 4xx 变成"任务失败+退款"而不是建单前 400。 |
| B12 | 缺像素换算表时 fail-closed（`fillMissingImageSizePresets` / `imageSizePresetReadyError` / `validateImageSizePresetRequirement`，`model_capability_validate.go:847-936`） | 无对应实现 | 缺口 | 旧 OpenAI Images 线路若缺 presets，实际出图尺寸可能与所选档位不符且不报错。 |
| B13 | 按协议的默认能力模板（`model_capability_defaults.go` 全文件）、Seedream 1.5K 预设表（`model_capability_kemei.go`）、AutoDL 固定屏幕规格归一（`model_capability_screen_spec.go`）、`applyModelSpecificVideoCapability`（agnes-video-2.5 特例，`model_capability.go:353-390`） | 全部缺失；渠道模型保存必须显式传完整 `capabilityConfig`（`channel-model.service.ts:165-173`） | 缺口 | 新建渠道模型无默认值/无旧数据修复；1.5K 档、AutoDL 分辨率、Agnes 参考上限只能手工维护，易配错。 |
| B14 | 跨进程目录失效：Redis 版本号 + 每次快照请求比对（`model_router.go:18-111`） | DB 版本号 + 仅回源时读；命中只判 TTL（`route-catalog.service.ts:100-103`、`catalog-version.service.ts`） | 有意替代（单实例/无 Redis） | 多实例下"后台改价→前台生效"最长滞后 30s；同一实例内 `onChange` 立即失效。 |
| B15 | 跨实例线路冷却（Redis `BlockRoute/RouteBlockedUntil`，`model_router.go:522-537`、`model_router_attempts.go:353-359`）与上游 `Retry-After` 自适应（`model_router_attempts.go:338-343`） | 进程内 Map（`route-health.service.ts:56-58`），429 固定 30s（`task-worker.service.ts:823`） | 有意替代（单实例） | 多实例各进程独立冷却，故障感知不同步；429 冷却时长可能与上游要求不符。 |
| B16 | 建任务时对模型主体加行锁并校验 `enabled && archived_at is null && active_revision_id == task.revision`（`repository/logical_models.go:497-519`） | 无等价校验（`task-admission.service.ts:157-163` 只查内存快照字段） | 缺口 | 归档/发布新 revision 与建单竞态：快照 30s 内可能把新任务挂到刚归档/刚被替换的 revision 上。 |
| B17 | 保存/归档审计与业务同事务，审计失败即失败（`logical_models.go:311-314,351-363`、`repository/logical_models.go:488-492`） | `@AuditAction` 拦截器"审计失败不阻断业务"（`admin/audit.interceptor.ts:47-51`） | 有意差异（已注明取舍） | 极端情况下出现"配置已改、无审计记录"；合规追溯弱于上游。 |
| B18 | 后台列表对"线路引用的渠道模型/渠道已删除"直接返回错误（`logical_models.go:188-191`） | 转成 `configurationError` 文案继续返回（`logical-model.admin.service.ts:609-612,665-669`） | 语义差异 | 后台不再因脏数据整页 500（更好运维），但管理员可能忽略 `configurationError` 继续用坏模型。 |
| B19 | 后台价格档去重键含计费方式与四项价格（`logical_models_catalog.go:165`） | 只按 selector 去重（`logical-model.admin.service.ts:792-794`） | 缺口（后台展示） | 同 selector 的多计费/多价档在后台详情里被折叠，管理员看不到完整价格。 |
| B20 | 目录装载只包含 `enabled && weight>0` 线路（`repository/logical_models.go:69-76,177-180`） | 快照只按 `enabled` 过滤（`route-catalog.service.ts:152-155`），weight 在使用处过滤 | 语义差异 | `simulate` 会把 weight=0 的线路也列出来（不该出现在运行目录里），诊断噪音。 |
| B21 | `containsCapabilityString` 用 `EqualFold + TrimSpace`（`model_capability_validate.go:1068-1075`） | 精确字符串比较（`capability-config.ts:178-180`） | 语义差异（低） | operation/比例/默认值带空格或大小写差异时，本仓会判"不支持"，上游会放行。 |
| B22 | 后台/公开目录发布价格档前做 `ValidatePriceTierPrice`（`model_catalog.go:210`） | 公开渠道目录只判 `enabled && priceConfigured`（`public-model-catalog.service.ts:378-380`） | 缺口（数据兜底） | 历史脏档（按秒非视频、token 非 text/video 等）会被发布成"可用"，选路时可能选到不可结算档。 |
| B23 | 上游公开接口要求登录后按用户分组投影（`handler/logical_models.go:13-43`、`model_catalog.go:32-63`） | `OptionalJwtAuthGuard` + 匿名 `systemAccess()`（`models.controller.ts:43-46`、`user-group.service.ts:199-209`） | 有意差异（本仓设计） | 匿名调用不受分组渠道限制，会看到全部系统渠道；若分组是"代理/企业专属"的商业边界，匿名泄露了渠道集合（渠道名已脱敏）。 |

---

### 表C 本仓有、上游无的功能点

| # | 本仓功能（证据） | 说明 / 价值 |
|---|---|---|
| C1 | `GET /admin/logical-models/:id`、列表 `?includeArchived=1`、`AdminLogicalModel.archivedAt`（`admin-logical-model.controller.ts:76-92`、`logical-model.admin.service.ts:166-179`） | 单条读取 + 归档历史可查；上游只能全量列表且自动排除归档。 |
| C2 | 后台路由模拟诊断模型更细：`RouteDiagnostics` 含 `groupVisible/blocked/capabilityMatched/matchReasons/priceTierId/priceSelector/priceTierMissing/eligible/selectedTier`，另有 `selectedRouteId/selectedPriceTierId/candidates/reason`（`router.service.ts:33-74,209-282`） | 上游只有 `RouteSimulationCandidate{matched,blocked,inPool,reasons}`；本仓可直接定位"分组不可见 / 缺价格档 / 冷却中"。 |
| C3 | 报价响应扩展 `code/priceTierId/priceSelector/note`（`quote.service.ts:25-36`） | 前端可显示命中的具体价格档与说明；上游仅金额/是否估算。 |
| C4 | 意图入参严格化：`buildModelRequestIntent()` 校验 capability 必填、inputs 键白名单、0-128 整数、options 必须是对象（`model-intent.ts:261-303`）；`validateQuoteIntent` 再校验能力白名单（`quote.service.ts:42-52`） | 上游 handler 直接 JSON bind，非法键会一路传到匹配阶段才报错。 |
| C5 | `restrictIntentToSpec()`：准入前按产品合同裁剪未声明参数/素材类型（`model-intent.ts:211-235`，用于 `task-admission.service.ts:164-168`、`task-worker.service.ts:396-399`） | 让"平台参数口径"与"模型合同口径"解耦；代价见 B/表A（掩盖配置不匹配）。 |
| C6 | `CatalogService.publicModel(access,id)` 单模型投影（`catalog.service.ts:88-95`） | 目前无 controller 调用，供内部/后续详情页复用。 |
| C7 | `RouteCatalogService.findRoute(routeId)`（`route-catalog.service.ts:82-92`）与 `buildCachedChannelModel()` 验收辅助（286-311） | 执行期按 routeId 回到同一份合同重建请求（`task-request.service.ts:69`）；上游改为直接查 DB revision/route。 |
| C8 | `RouteHealthService.block()/snapshot()/clear()`（`route-health.service.ts:86-105`） | 后台"临时禁用线路"与验收脚本可注入/观测冷却；上游依赖 Redis 协调器 + 无本地观测接口。 |
| C9 | 分组与会员套餐映射：`groupCodeForUser()` 按有效会员（active/grace）套餐取 code，带 30s 用户级缓存（`user-group.service.ts:212-224`）；后台用户数按有效会员统计（`user-group.admin.service.ts:315-341`） | 替代上游 `users.user_group` 列；多会员时按 `expiresAt desc` 取最新。 |
| C10 | 分组/前台模型软删：`UserGroup.deletedAt/activeKey`、`LogicalModel.activeKey`（schema 1642-1643、1756-1757、1779-1781） | 编码可复用、历史外键不悬空；上游分组为硬删。 |
| C11 | 分组覆写 JSON 容错解析：非法条目丢弃、同时接受 `pointsPerUsd` 与 `pointsPerUsdMicrocredits` 键（`user-group.service.ts:272-294`） | 单条脏数据不会让全站分组失效；上游整份快照报错。 |
| C12 | 渠道模型删除保护：仍被未归档前台 revision 引用、或排队/执行任务占用时拒绝（`channel-model.repository.ts:178-198`） | 上游对应文件里没有该检查（属于本仓新增的一致性保护）。 |
| C13 | 价格档携带成本价快照 `costConfigured/costUnitPrice.../costBillingMode`（`routing.types.ts:29-41`、`billing.service.ts:224-231`） | 毛利核算；上游 `CreditCostPricing` 在价格档请求里也有（`selector.ts:391-415` 移植），但本仓把成本列随快照一路带到账单。 |
| C14 | `CatalogVersionService` 用 DB `RouteCatalogVersion` 表 + 进程内监听器（`infra/catalog-version.service.ts`） | 无可选 Redis 时的跨进程失效方案（效果见 B14）。 |
| C15 | 公开目录 `CapabilityAvailabilityService` / 能力级可用性（`src/capabilities/capability-availability.service.ts`，任务准入使用） | 产品能力层的可用性开关，上游只有模型/渠道级。 |
| C16 | 匿名可浏览目录（`OptionalJwtAuthGuard`，`models.controller.ts`、`model-catalog.controller.ts`） | 落地页/工作台首屏无登录也能出模型（安全影响见 B23）。 |

---

### 表D 接口差异（上游 handler 路由 vs 本仓 controller 路由）

上游统一挂在 `/api`（`handler/api.go:22-36`），无版本段；本仓全局前缀 `/api/v1`（`src/main.ts:54,111`）。上游成功体 `{code,data,msg}`（`handler/response.go:17-19`），本仓全局拦截器 `{code:0,data,message}`（`common/response.interceptor.ts:7-16`）。

| 语义 | 上游 | 本仓 | 差异 |
|---|---|---|---|
| 前台模型目录 | `GET /api/models`（必须登录 `currentUser`） | `GET /api/v1/models`（`OptionalJwtAuthGuard`） | 本仓匿名可用；匿名= bypassVisibility（见 B23） |
| 按意图筛模型 | `POST /api/models/available`，body=`ModelRequestIntent` | `POST /api/v1/models/available`，body=`ModelIntentBodyDto` | 本仓 capability 必填并做 inputs/options 白名单（C4）；上游允许空 capability（结果全不匹配） |
| 前台模型报价 | `POST /api/models/:id/quote` | `POST /api/v1/models/:id/quote` | 响应字段不同（C3 / B8） |
| 后台模型列表 | `GET /api/admin/logical-models` → `{models:[...]}` | `GET /api/v1/admin/logical-models?includeArchived=` → 裸数组 | 形状不同（`data:{models}` vs `data:[]`）+ 本仓支持归档 |
| 后台模型详情 | 无 | `GET /api/v1/admin/logical-models/:id` | ➕本仓 |
| 新建模型 | `POST /api/admin/logical-models` → `{model}` | `POST /api/v1/admin/logical-models` → 裸对象（`data.model` 变 `data`） | 形状不同 |
| 保存模型 | `PATCH /api/admin/logical-models/:id` → `{model}` | `PATCH /api/v1/admin/logical-models/:id` | 同上；本仓 DTO 额外限制 priority/weight/sortOrder 上限、`reason` 字段 |
| 归档模型 | `DELETE /api/admin/logical-models/:id` → `{ok:true}` | `DELETE /api/v1/admin/logical-models/:id` → `{ok:true}` | 一致 |
| 路由模拟 | `POST /api/admin/logical-models/:id/simulate`，body=`ModelRequestIntent`，返回 `{productMatch,candidates}` | `POST /api/v1/admin/logical-models/:id/simulate`，body=`ModelIntentBodyDto+reason`，返回 `SimulateResult` | 响应结构重写（C2）；本仓 `capability` 缺省时取模型合同模态（`admin-logical-model.controller.ts:106-116`） |
| 渠道目录 | `GET /api/model-catalog` | `GET /api/v1/model-catalog` | 一致（都返回 `{source,models:[],channels}`）；可用性字段缩水（B7） |
| 渠道目录按意图 | `POST /api/model-catalog/available` | `POST /api/v1/model-catalog/available` | 一致 |
| 渠道报价 | `POST /api/model-catalog/quote`，body=`{channelId,modelKey,intent:{...}}` | `POST /api/v1/model-catalog/quote`，同时接受平铺字段与嵌套 `intent`（`model-catalog.controller.ts:37-46`） | 本仓向后兼容两种载荷 |
| 分组列表 | `GET /api/admin/user-groups` → `{groups}` | `GET /api/v1/admin/user-groups` → 裸数组 | 形状不同 |
| 分组详情 | 无 | `GET /api/v1/admin/user-groups/:id` | ➕本仓 |
| 分组增改删 | `POST /api/admin/user-groups`、`PATCH/DELETE /:id` | `POST /api/v1/admin/user-groups`、`PATCH/DELETE /:id` | 语义一致；本仓用权限点 + 审计拦截器，body 多 `reason` |
| 鉴权模型 | 会话 Cookie `currentUser`；后台 service 层 `RequireAdmin` | JWT（`OptionalJwtAuthGuard`）+ `@RequirePermission(PERMISSIONS.logicalModelRead/Write, userGroupRead/Write)` | 机制不同，权限粒度本仓更细 |

---

### 测试文件汇总（一句话）

上游该域测试覆盖很密：`app/logical_models_test.go`、`app/model_router_test.go`、`app/model_router_resolution_test.go`、`app/model_catalog_test.go`、`app/model_capability_test.go`、`app/model_capability_kemei_test.go`、`app/model_capability_screen_spec_test.go`、`app/model_availability_test.go`、`app/user_groups_test.go(+testhelpers)`、`app/image_parameters_test.go`、`app/video_logical_billing_test.go`、`repository/logical_models_test.go`；本仓 `src/model/{catalog,routing,intent,user-groups}` 下**没有任何 spec/test 文件**（全仓仅 5 个 `*.spec.ts`，均在 payments/common），上述行为差异目前无自动化回归网。

---

### 最重要的 5 条差异

1. **带意图的目录可用性少了一次产品合同匹配**：`catalog.service.ts:151-165` 未像上游 `logical_models_catalog.go:35-38` 先 `MatchCapability(productSpec,intent)`，`POST /models/available` 可能返回"下单必被拒"的模型。
2. **路由快照未按价格档裁剪视频能力**：`route-catalog.service.ts:179` 没有调用 `capabilitySpecWithPriceTiers`（上游 `logical_models.go:646-703` 在 `channelModelCapabilitySpec` 内统一裁剪），公开目录会展示无法定价的分辨率/时长档，且后台覆盖判定与运行期不一致。
3. **公开价格档缺少"图片计价参数 + 价格合法性"过滤**：`catalog.service.ts:210-243`、`public-model-catalog.service.ts:365-417` 未做上游 `logical_models_catalog.go:154-169` 的 `validateImageParameterPriceSelector`/`CanonicalSKUSelector`/`ValidatePriceTierPrice`，目录可出现选路永远命中不到的价格档（展示价≠可成交价）。
4. **任务准入的模型能力校验基本未移植**：上游 `model_capability_validate.go` 的 `ValidateTaskCapability/validateImageTask/validateVideoTask`（提示词长度、素材字节/时长、蒙版、比例/时长/分辨率枚举、GPT-Image-2 自定义尺寸、缺换算表 fail-closed）在本仓无对应实现，坏请求会拖到上游失败再退款，而不是扣费前 400。
5. **分组定价缺全局积分策略倍率、且归档模型重试路径缺失**：本仓全链路只有"分组×模型覆盖"倍率（`billing.service.ts:206-222`），上游 `groupTierPrices` 还合乘 `DefaultMultiplierBPS/ModelMultiplierBPS`（`finance.go:714-745`）；同时 `task-worker.service.ts:392-393` 拒绝归档模型，上游 `resolveArchivedTaskRoute` 支持按任务快照重试（`model_router_attempts.go:362-457`）。


## 3. 协议 / 插件 / 厂商适配器逐文件对照

- 上游（Go）：`/Users/bright/github/open-ai-canvas/backend`
- 本仓（NestJS/Prisma）：`/Users/bright/github/aigc-creation/backend`
- 审计方式：逐文件阅读 + 对 110 个 manifest 做脚本化统计/哈希比对（只读，未修改任何仓库文件）。
- 范围：`internal/protocol`、`internal/providercatalog`、`internal/app` 的 plugin/provider/protocol/workflow 相关非测试文件、`handler/plugin.go`、`repository/plugin_states.go`、`model/models_plugin.go`、`plugin-packages/`；本仓 `src/model/protocol/**`、`src/model/plugins/**`、`src/model/catalog/**`、`backend/plugins/**`、任务执行宿主、`model.module.ts`、两个控制器。

### 0. 结论摘要（最重要 5 条）

1. **清单层不是差距，执行宿主才是差距**：本仓 110 个 `manifest.json` 与上游 `plugin-packages/<同名目录>/manifest.json` **逐字节一致**（SHA-256 全部相等），但上游 `buildUpload` / `buildResult` / `buildCancel` / `buildAgent` 等宿主调用点在本仓**全部不存在**，23 个 agent provider、7 个 cancel、5 个 result、1 个 upload 的声明成了“死声明”。
2. **输入素材形态退化**：本仓 `TaskMediaService.inputReferences()` 永远把素材内联成 `dataUrl`，且从不写 `role`；上游按 `requiresPublicMediaUrls`/协议偏好签发 URL，并按 `first_frame`/`last_frame`/`reference_image`/`edit_source` 赋 role。35 个声明 `requiresPublicMediaUrls` 的 provider 以及 Agnes/xAI 的关键帧语义因此失真。
3. **流式、Agent、取消、分离式轮询、幂等重试、结果端点全部缺失**：本仓只有“同步 create + 固定间隔 poll”，没有 SSE、没有工具调用循环、没有 `detachedPolling`/`idempotentCreate`/`Retry-After`/404 容忍/下载重试，长排队或瞬时抖动会直接失败或误判。
4. **服务商目录是“不同域替换”**：上游 `providercatalog` 是“厂商推广 + 推荐模型 + 人民币成本/加价/积分换算 + Key 校验 + 一键建渠道”，本仓 `plugins/provider-catalog.service.ts` 是“远端插件包清单 + 安装”，厂商/模型/定价/验 Key 全链路没有对应物。
5. **插件生命周期能力弱化**：本仓只做目录扫描 + DB 启停，缺上游的插件包 registry/SHA256/状态/包下载/覆盖升级/不可用占位适配器/用户级启停；且 `processing` 类型协议在保存渠道模型时被直接拒绝，`volcengine-mediakit` 无法使用。

### 1. 关键统计

| 项目 | 上游 | 本仓 |
|---|---|---|
| 插件源目录 | 110（含 `src-a6api`/`src-antigravity-proxy`/`src-metaso-h3` 三个源码镜像） | 110（同目录名，manifest 字节一致） |
| 官方插件包 | 108 个 `.yingce-plugin`（107 个同名目录 + 仅包无源码的 `autodl-comfyui`）；103 v2 + 5 v1 | 0（直接扫描目录；102 个模型插件 v2 + 5 个支付 v1） |
| 可加载插件 | 108 个包（103 模型 + 5 支付）；3 个 `src-*` 镜像不参与打包 | 107 个目录（102 模型 + 5 支付；`plugin-manifest.store.ts` 显式跳过 `src-*`） |
| manifest 版本 | 源目录 v2 ×105、v1 ×5；打包后 v2 ×103、v1 ×5 | 源目录同左；本仓实际加载模型域 102 个全 v2 |
| provider 贡献 | 116（115 个目录 + `autodl-comfyui`；源目录含镜像时 119） | 唯一 115（镜像被跳过，且无 `autodl-comfyui`） |
| 能力分布（唯一 provider） | text 33 / image 34 / video 46 / audio 3 | text 33 / image 34 / **video 45** / audio 3（少 autodl 的 video） |
| kind | generation 115 / processing 1 | generation 114 / processing 1 |
| 声明 agent 操作的 provider | 23 | 23（宿主不调用） |
| 声明 cancel / result / upload | 7 / 5 / 1 | 同左（宿主不调用 cancel/result/upload） |
| 声明 detachedPolling / idempotentCreate | 1 / 1（均为 `coolhs-wan3-relay`） | 同左（宿主不实现） |
| `requiresPublicMediaUrls` | 35 | 35（宿主不读取） |
| 官方 `.yingce-plugin` 包 | 108（107 个目录 + 仅包无源码的 `autodl-comfyui`） | 0（直接扫描目录，不保存 zip） |
| 协议文档 | `internal/protocol/docs/*.md` 23 篇，`documentation.go` 运行时注入 | 无 docs 目录；文档内嵌在 110 个 manifest 的 `documentation` 字段 |

---

### 表A 逐文件对照

| 上游文件/文件组 | 本仓对应 | 状态 | 具体功能差异与证据 |
|---|---|---|---|
| `protocol/adapter.go` | `src/model/protocol/runtime.ts`、`manifest-adapter.ts` | 基本一致 | 适配器契约（create/parse/poll/cancel）一致；`AgentAdapter`/`ResultAdapter`/`MediaUploadAdapter` 及能力探测接口被压成 TS 可选方法，无 `AgentAvailable()`/`ResultAvailable()`/`UploadKinds()` 对应物；宿主因此无法判断“声明了但未实现”。 |
| `protocol/types.go` | `src/model/protocol/types.ts`、`runtime.ts` | 基本一致 | Capability/Surface/Status/OutputOptions/GenerationRequest/RequestSpec/Result 字段齐全，`stage`/`queueAhead`/`detachedPolling`/`idempotentCreate`/`kind` 都在；差异：TS `PluginMetadata` 没有 `categories/scopes/parameters/imageParameters/create/poll/contentType/legacyAliases/execution/unavailableReason` 这层运行期投影（由 `ManifestProvider` 直接承担），`LegacyAliases` 完全没有表达。 |
| `protocol/builtin.go` | **无内置适配器目录**；由 `backend/plugins/*` 的 13 个 manifest 承接 | 部分覆盖 | 13 个内置适配器（chat-completion、openai-response、claude-api、newapi、newapi-channel-1/2、xai-video、volcengine-ark-video、volcengine-jimeng-video、gemini-veo、novita-video、minimax-video、agnes-video）都有对应 provider id 的 manifest；但上游 `Builtins()` 的 `LegacyAliases`（`anthropic-messages`、`claude-messages`、`openai-video(s)`、`newapi-video-generations`）在本仓无注册，`registry.ts:registerAlias()` **全仓无调用**。 |
| `protocol/builtin_agnes.go` | `plugins/agnes-video-25`、`plugins/agnes-video-v20` | 部分覆盖 | 请求/轮询/解析已声明化；差异：①上游由 `request.Extra.mode` 与 `request.Operation` 覆盖模式，manifest 只按 role/videos/audios 推断，忽略 `extra.mode`/`operation`；②上游“图片 >2 且无 role → reference”，manifest 只要“有图”就 keyframe；③上游 keyframe 必须 1–2 图，manifest 无该校验；④本仓无 videos/audios 输入，2.5 的 reference 视频/音频路径不可达。 |
| `protocol/documentation.go` | manifest 的 `documentation` 字段（110 个均非空） | 基本一致（换实现） | 上游按 `docs/<id>.md` + `{{NAME}}/{{OPERATIONS}}/{{PARAMETERS}}/{{CONTRACT}}` 模板渲染；本仓由插件作者把完整文档写进 manifest。覆盖面：上游 23 篇内置文档含 `autodl-comfyui.md`，本仓缺该插件。 |
| `protocol/errors.go` | `protocol/manifest.ts:ManifestError`、`PluginPackageError` | 部分覆盖 | 上游有 `UnavailableAdapter{Info}` + `UnavailableError`，注册失败时仍以“不可用协议”占位；本仓 `plugin-protocols.service.ts:82-94` 对任何注册失败直接抛错，运行期表现为“未知协议”，不是“当前不可用”。 |
| `protocol/expression.go` | `src/model/protocol/expression.ts` | 基本一致 | 操作符集合逐项对齐（`$ref/$literal/$coalesce/$concat/$concatArrays/$map/$filter/$indexObject/$first/$last/$at/$len/$split/$if/$switch/$omitEmpty/$lower/$upper/$trim/$toString/$toInt/$toFloat/$toBool/$dataMime/$dataPayload/$json/$merge/$sortByOrder/$add/$multiply/$divide/$min/$max/$ceilStep/$eq/$ne/$gt/$gte/$lt/$lte/$in/$and/$or/$not`）。差异见 §2 表达式专项。 |
| `protocol/image_parameters.go` | `domain/image-parameters.ts` + `intent/image-contract.ts` | 部分覆盖 | `ValidateImageParameters`/`ApplyImageParameters` 基本逐条对齐；差异：①TS `resolveImageParameters()` 只合并 `enabled/values`，**忽略配置侧 `min/max/step/default`**，也不报“配置了插件未声明的参数”；②TS `imageParameterNumber()` 接受数字字符串，Go 只接受数值类型；③TS `ApplyImageParameters` 用 `manifestString()`，Go 用 `fmt.Sprint()`，布尔/数字边界基本一致。 |
| `protocol/manifest.go` | `src/model/protocol/manifest.ts` | 基本一致 | apiVersion 白名单、id/label/能力/scope/kind、operation 方法/相对路径/content-type/files、agent→agentResponse、detached→poll、upload kinds/id、payment 贡献校验均逐条存在。差异：TS 缺少 `Metadata` 的 categories/scopes/parameters 投影和 `normalizeManifest()` 的“无 provider”分支；`projectProviders()` 只做 provider 级投影，kind/async/upload 另算。 |
| `protocol/manifest_adapter.go` | `manifest-adapter.ts` + `request.ts` + `response.ts` | 基本一致 | create/poll/cancel/result/upload/agent 的构建与解析、binaryPayload、streamedJsonAudio、Markdown/HTML 媒体提取、裸 b64→data URL、agent 工具调用合成 id 都实现了。差异：①`manifestError()` 对布尔 `false` 的处理不同（Go 视为“有错误”，TS 视为“无错误”）；②Go 的 create 解析有 `parse(payload, PollContext{Model: request.Model,...})`，TS 同；③TS `buildProtocolRequestBody` 在 `files` 非空但 contentType 被模板求值成非 multipart 时会静默丢文件，Go 在 `RequestSpec.Validate()` 报错。 |
| `protocol/manifest_request.go` | `src/model/protocol/request.ts` | 基本一致 | `request.*` 投影（messages/inputs/images/videos/audios/output/providerOptions/extra/uploadId/source）、query/header/file 求值、legacy `fields` 变换、`normalizeManifestValue` 顺序对象→数组、`{{taskId}}`/`{{model}}` 替换与相对路径兜底全部对齐。差异：TS `extra` 缺省 `{}`、Go 为 nil；TS 不对 message.role 做小写归一（上游请求构建时归一小写）；`setMapPath` TS 会过滤空段。 |
| `protocol/package.go` | `src/model/protocol/package.ts` | 部分覆盖 | 容器格式、48MB/256 文件/16MB 单文件/512KB manifest、路径白名单、符号链接、entry/backendEntry 校验都在。差异：①自写 zip 解析器**不校验 CRC**、不支持 zip64（上游 `archive/zip` 读取时校验 CRC）；②rpc 后端只检查 `files.has(entry)`，没有 `payment_rpc.go` 的“本平台可执行产物”校验；③无 `InspectPluginPackage`/`ParsePluginPackageFiles` 的按需解压语义（安装直接全解压到目录）。 |
| `protocol/payment_rpc.go` | 无 | 缺失（支付域排除） | 仅影响 rpc/wasm 支付插件的包校验与运行产物选择；模型域无 provider 使用 rpc。 |
| `protocol/registry.go` | `src/model/protocol/registry.ts` | 部分覆盖 | `register/resolve/removeByPlugin/fingerprint` 有；差异：①Go 注册要求 id+version，TS 只要求 id；②Go `List(surface, capability, includeUnavailable)` 会过滤 `Enabled/UnavailableReason`，TS `list()` 不提供 surface 过滤，且没有“不可用”维度；③Go `IsCapability()` 会校验 enabled，TS 无；④别名只能手工 `registerAlias`，没有 manifest 声明来源。 |
| `protocol/image_tools.go` | 不存在（上游也只有 `image_tools_test.go`） | 不适用 | 上游该文件实际缺失；本仓 `image-tools` 插件（processing/图像处理）用 manifest 表达。 |
| `providercatalog/catalog.go` | `plugins/provider-catalog.service.ts` | 不同域 | 上游是 `schemaVersion:1` 的“厂商推广目录”：tags/tone、provider 的 rank/startsAt/endsAt/permanent/logo/website/keyGuide/models[≤5]/priceTiers（人民币）；本仓接受 `[...]` 或 `{items:[...]}` 的“插件包索引”：id/name/vendor/apiFormat/baseUrl/protocols/packageUrl。字段、语义、校验、排序、时间窗全部不同。 |
| `providercatalog/pricing.go` | 无 | 缺失 | `YuanToMicrocredits`（1 元=1 积分=1e6 microcredits）、`MarkupBasisPoints`（0–1000%，两位小数）、`ApplyMarkup`（向上取整）、`PriceFor`（token 模式、视频只计输出）在本仓没有对应实现；本仓价格档由后台手工配置并按分组倍率换算，无“目录成本→加价售价”链路。 |
| `providercatalog/source.go` | `plugins/provider-catalog.service.ts` 的 `cache` | 缺失大部分 | 上游有磁盘落盘、ETag/If-None-Match、5 分钟 stale、30 秒失败退避、并发刷新合并、live/cache/unavailable/disabled 四态、`CANVAS_PROVIDER_CATALOG_DISABLED`、2MB 上限；本仓只有进程内一个 `{fetchedAt, entries}`，无持久化/条件请求/状态机/禁用开关。 |
| `app/plugin_management.go` | `plugins/plugin.admin.service.ts` | 部分覆盖（非模型部分排除） | 上游按 `officialApplicationPolicies`/`systemPaymentPolicies`/`systemSMSPolicies` 计算 Origin/Kind/ActivationScope/ConfigurationScope，并有平台可用 + 用户启停两套状态；本仓只有平台级 `enabled` + `verifyJson`，`pluginAvailability()` 靠 backend 字符串推断原因；Prisma 的 `UserPluginState` 模型存在但**全仓无任何引用**。 |
| `app/protocol_plugins.go` | `plugins/plugin-manifest.store.ts` + `plugin.admin.service.ts` | 部分覆盖 | 上游有 `plugin_registry.json`、官方包扫描、SHA256、`PluginView{source,fileName,package,sha256,installedAt,status,error}`、invalid 状态、内置/系统/上传来源、支付 rpc/wasm 物化、包缓存硬链接；本仓只扫描两个目录并解析 manifest，没有 registry/hash/status/包缓存/来源细分。 |
| `app/protocol_registry.go`（同域补充） | `plugin.admin.service.ts` + `plugin-manifest.store.ts` + `protocol-catalog.service.ts` | 部分覆盖 | 上游 `PluginProviderCatalog` 返回 id/version/name/vendor/categories/scopes/kind/create/poll/contentType/baseUrl/enabled/unavailableReason/parameters/imageParameters/workflows；本仓 `ProtocolCatalogEntry` 只有 id/label/capabilities/kind/async/requiresSecretKey/source/pluginId/selectable/surfaces。上游还有插件包下载 `PluginPackage(id)`、保留 ID 检查、支付订单依赖检查；本仓无下载端点、无保留 ID。 |
| `app/provider_catalog.go` | `plugins/provider-catalog.service.ts` + `provider-catalog.controller.ts` | 不同域 | 上游 `AdminProviderCatalog/VerifyProviderCatalogKey/InstallProviderCatalog` 是“读取厂商推广目录 → 校验管理员 Key 能访问哪些推荐模型 → 按加价率建系统渠道 + 渠道模型 + 价格档，同一事务落库”；本仓是“列插件包 → 字段完整性 verify → 下载 zip 安装插件”，没有模型、价格、Key 验证、渠道创建。 |
| `app/provider.go` | `tasks/task-worker.service.ts`、`task-request.service.ts`、`task-admission.service.ts`、`text/text-tool.service.ts` | 部分覆盖 | 编排主链路存在（建任务→选路→create/poll→落盘→结算）；差异：①`GenerationRequest` 只填 images，`videos/audios` 恒空；②不填 `providerOptions`（客户端/元数据下发无法到达模板）；③不填 `extra.audioVoice/audioFormat/audioSpeed/audioInstructions/audioLanguage/audioDialect`、`extra.max_tokens`、`extra.videoSeconds`、`extra.idempotencyKey`；④不应用风格档案、方舟私有素材、上游进度；⑤`request.output` 完全未设置（width/height/format 丢失）。 |
| `app/provider_protocol.go` | `tasks/task-executor.service.ts`、`task-worker.service.ts` | 部分覆盖 | create→poll→finalize 存在；差异：①无 `extractProviderTaskID()` 兜底（manifest 未映射 taskId 但响应顶层有 id 时，本仓拿不到任务号）；②无 `detached` 分支与 48h 上限；③无 `uploadProtocolMedia`；④无 `recordingProviderTask` 语义（本仓 `providerRequestId` 落账但恢复能力弱）；⑤`idempotentCreate` 未参与。 |
| `app/provider_protocol_async.go` | **无对应实现**（只有 manifest 元数据） | 缺失 | `uploadProtocolMedia`（按 kind 上传、按 URL/dataUrl 去重、写 `metadata.uploadId`）、`executeIdempotentProtocolCreate`（3 次、429/5xx/传输错误、`Retry-After`）、`detachedProtocolPending`/`detachedPollDelay`（15s/30s/1min/2min 按 queueAhead）都没有。 |
| `app/provider_protocol_auth.go` | `src/model/protocol/auth.ts` | 部分覆盖 | 驱动集合一致（none/bearer/header/api-key/query/basic/anthropic/google-api-key/volcengine-v4/aws-sigv4/tc3）；差异：①火山 V4 上游用 `volc-sdk-golang/base.Credentials.Sign`（`provider_protocol_auth.go:80-89`），本仓自写签名；②AWS/TC3 规范查询串：Go 用 `url.Values.Encode()`（空格 `+`、键值排序），TS 用 RFC3986（`%20`、`localeCompare` 排序），含空格/多值/特殊字符时签名会不同；③TS 把多值头压成单值，Go 会 `join(",")`；④TS 空 auth 固定 Bearer，Go 回落到 `applyProviderAuth(config)`（按 apiFormat 决定 Claude/Gemini 专用头）。 |
| `app/provider_protocol_request.go` | `protocol/executor.ts` + `protocol/request.ts` | 部分覆盖 | JSON/表单/multipart/二进制四种体、文件名清洗、data URL 解包、URL 校验都在；差异：①无 `executeProtocolBinaryRequestWithConsumer`（SSE `Accept:text/event-stream` 与 chunk 回调）；②无 `spec.Validate()` 的方法/文件/content-type 发送期校验；③响应体上限固定 64MB，上游按运行时 `GeneratedFileMB` 策略；④媒体下载上限固定 256MB；⑤没有上游的 `protocolRequestFromInput` 等价物，输入字段映射大量缺失（见 provider.go 行）。 |
| `app/provider_protocol_result.go` | `task-worker.service.ts:finalize/download` | 部分覆盖 | 内联 dataUrl / URL 下载 / 空结果失败 / MIME 归一都有；差异：①`buildResult()` 声明存在但**宿主从不调用**（5 个 result provider 失效）；②媒体下载无 3 次重试/瞬时错误识别；③无独立结果端点下载；④`usage` 只在日志/结算读，视频 usage 不写入结果。 |
| `app/provider_error.go` | `tasks/task-executor.service.ts:upstreamErrorText` | 部分覆盖 | 能从 `error.message/message/msg/detail` 提取短错误并截断 500；差异：没有“业务 code + message”双提取、没有敏感词/内容审核专用 code、没有多帧 JSON 业务失败识别。 |
| `app/provider_error_message.go` | 无 | 缺失 | 上游过滤 URL、余额/额度/密钥/token/堆栈/内部诊断等敏感片段后再返回用户；本仓直接截断上游原文，可能把 `api key`/`balance`/内部地址回显给用户或写入日志。 |
| `app/provider_errors.go` | `task-executor.ts:failureCodeOf/safeFailure`、`task-lifecycle.ts:TASK_ERROR` | 部分覆盖 | 有 401/403/404/429/5xx/超时/连接中断归一与“只在上游明确未接时切线”；差异：没有 `providerPayloadErrorCategory`（真人肖像/安全审核/额度/模型权限/tool_choice 兼容）分类，没有 `Retry-After` 解析，用户文案仍是上游原文。 |
| `app/provider_http_client.go` | `protocol/executor.ts` + `infra/outbound.ts` | 部分覆盖 | SSRF/DNS 固定/私网拦截/代理/超时/大小上限/重定向/自定义头/审计链路都有，能力不弱；差异：①上游在协议传输层做渠道熔断 + 并发槽 + `Retry-After`，本仓协议层无；②无流式消费回调；③无 `providerConnectionError` 的“连接提前关闭”专用文案；④无按运行时策略动态调整响应上限。 |
| `app/provider_request_types.go` | 无（类型自然内联） | 等价 | 只是 `requestAsMap` 类型断言 helper，模型域无独立语义。 |
| `app/provider_submission.go` | `tasks/task-admission.service.ts`（任务级幂等） | 部分覆盖 | 本仓有任务级 `ownerId+idempotencyKey` 去重；但**没有把 key 注入 `request.extra.idempotencyKey`**，也没有 `withProviderSubmissionKey` 的宿主上下文；`coolhs-wan3-relay` 的 create body `id: $ref request.extra.idempotencyKey` 永远为空。 |
| `app/provider_progress.go` | 无 | 缺失 | 上游从 `progress/percent/completion` 等键（含 `data/result/task/output/operation/response/meta/metadata` 容器）同步任务进度，仅观测不影响结果；本仓 `task-worker` 固定写 5/10/50，用户看不到上游真实进度。 |
| `app/provider_media_hydration.go` | `tasks/task-media.service.ts:inputReferences/toReference` | 部分覆盖 | 有“从资源读字节→data URL”；差异：①无签名 URL 分支（`providerResourceURL`）、无 `requireURL`/`preferURL`/`imageOnly`/`maxBytes` 策略；②`requiresPublicMediaUrls` 只作为元数据存在，无调用点（grep 仅 protocol/runtime 与注释）；③输入素材无 `role`（`inputReferences` 未传 role）。 |
| `app/provider_style.go` | 无 | 缺失 | 上游按项目/画布风格档案合成/替换提示词、解析 `styleExecutionPlan`、校验风格素材对模型可用；本仓全仓搜不到 `styleProfile` 相关实现。 |
| `app/provider_jimeng.go` | `plugins/volcengine-jimeng-image`、`volcengine-jimeng-video` + `auth.ts:volcengine-v4` | 部分覆盖 | 请求字段（req_key/prompt/image_urls/duration/ratio/resolution/req_json、`Action/Version` 查询）和响应（image_urls/binary_data_base64/video_urls）都已声明化；差异：上游用 volc-sdk 签名且 host 侧有 `validateJiMengResponse`/尺寸解析，本仓走自写 V4 签名（同 auth 行），签名失败风险高。 |
| `app/provider_gemini_cache.go` | 无 | 缺失 | 上游对 `gemini-generate-content` agent 的稳定 system/tools 前缀创建/复用/失效 Google `CachedContent`（TTL、锁、最小 token、404 重建、best-effort 删除）；本仓无缓存管理，Agent 本身也不执行。 |
| `app/provider_ark_private_assets.go` | 无 | 缺失 | 上游方舟视频把用户资源同步为 Ark 私有素材组（AIGC），用 `asset://` 引用，含创建/轮询/失败绑定/控制面区域校验；本仓只发 data URL，依赖 Ark 接受内联素材。 |
| `app/provider_agent_protocol.go` | 无 | 缺失 | 上游把统一 canonical agent 会话展开为 Responses/Chat/Claude/Gemini 四种请求体，校验 tool_call_id 配对、去重工具、图片 data URL；本仓无 canonical agent 概念，23 个 agent manifest 无法调用。 |
| `app/provider_text.go` | `text/text-tool.service.ts`（同步文本工具） | 部分覆盖 | 本仓能做一次 create→parse 的文生文（提示词润色/图转提示词），有切线/调用日志；差异：无文本生成任务、无 Responses/Chat/Claude 历史与工具兼容降级、无 `max_output_tokens`、无 `providerOptions` 注入的完整通道。 |
| `app/provider_text_stream.go` | 无 | 缺失 | 上游 SSE 解析（Responses/Chat/Claude 三种事件）、增量 delta 推送、断流视为失败、首尾空白保留；本仓无流式文本。 |
| `app/provider_text_agent.go` | 无 | 缺失 | 上游 agent 多步循环、工具选择兼容降级（required→auto）、Gemini 缓存接入、Claude 工具消息转换；本仓无。 |
| `app/provider_text_agent_stream.go` | 无 | 缺失 | 上游 agent SSE 增量拼接文本/推理/工具参数（按 index/ID 聚合，flush 才产出）；本仓无。 |
| `app/provider_image.go` | 各 image manifest + `task-request.ts`/`executor.ts` | 部分覆盖 | OpenAI/Grok/Ark/Jimeng/Gemini 的请求字段基本由 manifest 承接；差异：①OpenAI 参考图编辑上游用 multipart `/images/edits`，`openai-images` manifest 用 JSON `/v1/images/edits` + `images[].image_url`；②上游 `normalizePixelSize`/`response_format`/`background`/`output_format` 的 host 默认逻辑未完整复刻（靠 manifest 与 imageParameters）；③本仓无 `validateOpenAIImageInput` 的尺寸上限校验。 |
| `app/provider_audio.go` | `openai-audio`、`doubao-streaming-tts`、`async-audio` manifest + `response.ts` | 部分覆盖 | binaryPayload 与 chunked JSON 音频解析在协议层可用；差异：①无音频生成任务入口（capabilities 无 audio），仅后台协议测试/代理可触达；②`extra.audioVoice/audioFormat/audioSpeed/audioInstructions` 不注入，manifest 只能落到默认 `alloy`/`mp3`；③async-audio 的 `result` 端点宿主不调用；④无 `validateGeneratedAudio` 的格式/魔数校验。 |
| `app/provider_video.go` | 各 video manifest + `task-request.ts` | 部分覆盖 | 上游手写的 legacy 路径（newapi/seedance/ark/grok）大多已有同名 manifest；差异：①无 role 赋值，Agnes/xAI/Minimax/Seedance 的首尾帧/参考图语义退化；②无 `videoImageRole` 的节点元数据推导；③无 `videoCapabilitySupportsAudio/Watermark` 的请求裁剪（由 manifest 直接发布尔）。 |
| `app/provider_video_options.go` | `intent/option-values.ts`、`intent/model-intent.ts:normalizeImageSizeIntent` | 部分覆盖 | 图片比例/尺寸按预设映射已实现；差异：视频 `normalizeVideoSize/Resolution`、Seedance duration/ratio/resolution 归一、public URL 判定缺失；`isPublicMediaURL` 无对应（本仓不判公网 URL）。 |
| `app/provider_video_polling.go` | `task-worker.service.ts:schedulePoll/pollOnce` | 部分覆盖 | 有轮询、总时限（视频 60 分钟）、租约释放；差异：①固定间隔（图片 3s/视频 5s/音频 2s），上游视频默认 30s 且按队列自适应；②无 `MaxNotFoundMisses`（404 容忍）；③无瞬时传输/解码错误重试；④无 `Retry-After`；⑤无视频下载重试（上游 `MaxDownloadTries`）。 |
| `app/provider_task_cancellation.go`（同域补充） | `task-lifecycle.service.ts:cancel` | 缺失 | 上游 `requestProviderCancellation` 通过协议 `BuildCancel` 向已受理任务发取消，并有 5s 对账循环、最多 41 次、失败转 uncertain；本仓 `cancel()` 只改本地状态/账单，注释明确“已派发任务不自动退款”，**从不调用 `adapter.buildCancel`**。 |
| `app/provider_task_recovery.go`（同域补充） | `task-worker.service.ts:recoverExpiredLeases` | 部分覆盖 | 有租约过期回收与 `uncertain`；差异：无人工“按上游任务号查询失败任务/批量恢复”的 admin 能力，无对 provider 的只读回查入口。 |
| `app/video_processing.go`（同域补充） | 无 | 缺失 | 上游处理类 provider（`kind=processing`）以源视频为主体，校验时长/尺寸/帧率档、重算处理参数、按源时长预扣；本仓 `protocol-catalog.service.ts:81-83` 直接拒绝 processing 协议绑定渠道模型，`volcengine-mediakit` 不可用。 |
| `app/channel_model_catalog_plugin.go`（同域补充） | `catalog/discovery/bailian.ts` + `model-catalog.discovery.ts` | 基本一致 | 百炼 `*.dashscope.aliyuncs.com`/`*.maas.aliyuncs.com` 补充 20 个视频/图像模型，仅补目录不定价；与上游 provider 插件机制等价（本仓用静态模块）。 |
| `handler/plugin.go` | `plugins/plugin.controller.ts`、`provider-catalog.controller.ts` | 部分覆盖 | 本仓只有 admin：list/get/PATCH/toggle/verify/install/uninstall + 目录 list/refresh/verify/install；上游还有用户侧 `/plugins/status`、`/plugins`（含 per-user states）、`/plugins/:id/package` 下载、`/plugins/:id/activation` 用户启停、`/plugins/catalog`（scope+capability）、`/admin/plugins/:id/availability`。 |
| `repository/plugin_states.go` + `model/models_plugin.go` | Prisma `PluginPlatformState`（+ 未被引用的 `UserPluginState`） | 部分覆盖 | 上游两张表：平台 `Available`（管理员）+ 用户 `Enabled`（用户激活）；本仓 `PluginPlatformState` 只有 `source/enabled/verifyJson/updatedBy`，把“是否安装/是否可用”合并成一个 `enabled`；`UserPluginState` 有 schema 无 service/controller。 |
| `app/workflow_plugins.go`、`workflow_provider*.go` | 无（工作流域排除） | 排除 | 非模型域，见“排除项”。 |

---

### 表B 上游厂商适配器 → 本仓 manifest 覆盖

状态说明：**协议映射**指 create/poll/response 的 manifest 等价；**宿主**指本仓是否真正消费该能力（upload/result/cancel/agent/流式/公网素材等）。

| 厂商 / 上游适配器 | 能力 | 上游文件 | 本仓 manifest（provider id） | 覆盖状态 |
|---|---|---|---|---|
| OpenAI Chat Completions | text | `builtin.go:openAIChatAdapter` | `openai-chat-completions`（chat-completion） | 协议映射 ✅；宿主：同步文生文 ✅，agent/stream ❌（`agent` 已声明但无调用） |
| OpenAI Responses | text | `builtin.go:openAIResponsesAdapter` | `openai-responses`（openai-response） | 协议映射 ✅；宿主 agent/stream ❌ |
| Anthropic Claude | text | `builtin.go:claudeAdapter` | `anthropic-messages`（claude-api） | 协议映射 ✅；`anthropic` 鉴权 ✅；agent/stream ❌；旧别名 `anthropic-messages`/`claude-messages` 未注册 |
| OpenAI Videos（NewAPI multipart） | video | `builtin.go:openAIVideosAdapter` | `openai-videos`（newapi） | create（multipart 文件）/poll/解析 ✅；cancel/result 声明但宿主不调用 ❌；参考视频/音频不支持 |
| NewAPI Video Generations | video | `builtin.go:newAPIVideosAdapter` | `newapi-video-generations-v1`（newapi-channel-2） | 协议映射 ✅；轮询/取消/队列自适应 ❌ |
| NewAPI 媒体任务 | video | `builtin.go:newAPIChannel1Adapter` | `newapi-media-task-v1`（newapi-channel-1） | 协议映射 ✅；role 依赖模板，本仓 role 为空但模板 coalesce 到 reference ✅ |
| xAI 官方视频 | video | `builtin.go:xAIVideosAdapter` | `xai-video`（xai-video） | 请求字段/校验 ✅；**首帧/参考图语义** ❌：无 role 时只取第一张，多图被静默丢弃；`operation` 不参与 |
| 火山方舟视频 | video | `builtin.go:arkVideosAdapter` | `volcengine-ark-seedance`（volcengine-ark-video） | create/poll/内容数组/限制 ✅；cancel 声明但宿主不调用 ❌；私有素材 `asset://` ❌ |
| 火山方舟 AgentPlan 视频 | video | `builtin.go` + `provider_ark_*` | `volcengine-ark-agent-plan-seedance` | 协议映射 ✅；cancel/私有素材 ❌ |
| 火山即梦视频 | video | `builtin.go:jimengVideosAdapter` + `provider_jimeng.go` | `volcengine-jimeng-video` | 请求/响应 ✅；AK/SK V4 签名实现不同（风险）；poll 无 `req_json:{"return_url":true}`（manifest 依赖 video_urls） |
| Gemini Veo | video | `builtin.go:geminiVeoAdapter` | `google-gemini-veo`（gemini-veo） | 请求/轮询/结果 ✅；任务号→`operations/` 路径处理不同（manifest `GET /v1beta/{{taskId}}` vs Go 强制 `operations/` 前缀）；文件 URI 支持比上游更宽 |
| Novita 视频 | video | `builtin.go:novitaVideosAdapter` | `novita-video` | 协议映射 ✅（query 形式一致） |
| MiniMax 视频 | video | `builtin.go:miniMaxVideosAdapter` | `minimax-hailuo-video-v2`（minimax-video） | 协议映射 ✅；默认值不同（manifest 默认 768P/adaptive，上游不写默认 resolution/ratio）；多模态参考在宿主不可达 |
| Agnes 视频 V2.5/Flash | video | `builtin.go` + `builtin_agnes.go` | `agnes-video-25`（agnes-video） | 请求字段/限制 ✅；**mode 推断/keyframe-reference 判定/operation 覆盖** ❌；无参考视频/音频输入 |
| Agnes 视频 V2.0 | video | `builtin_agnes.go:buildAgnesV20Body` | `agnes-video-v20`（agnes-video-v20） | 请求字段/extra_body 关键帧 ✅；`frame_rate/num_frames` 换算等由 manifest 简化，语义差异存在 |
| OpenAI Images | image | `provider_image.go:runImageTask` | `openai-images`（openai-image） | 字段/参数 ✅；参考图编辑 JSON vs multipart；尺寸像素转换依赖 presets；后台默认 response_format/background 兼容逻辑部分缺失 |
| xAI Grok Image | image | `provider_image.go:runGrokImageTask` | `xai-grok-images`（grok-image） | 请求/比例归一/response_format ✅；模型能力裁剪依赖 imageParameters |
| 火山方舟图像 | image | `provider_image.go:runVolcengineArkImageTask` | `volcengine-ark-seedream`（volcengine-ark-image） | 尺寸映射/参考图/base64 ✅ |
| 火山 AgentPlan 图像 | image | 同上 | `volcengine-ark-agent-plan-seedream` | ✅ |
| 火山即梦图像 | image | `provider_jimeng.go:runVolcengineJiMengImageTask` | `volcengine-jimeng-image` | 请求/响应 ✅；V4 签名风险；上游 AK/SK 专用路径未复刻 |
| Gemini Image | image | `provider_image.go:runGeminiImageTask` | `google-gemini-image`（gemini-image） | 请求/比例/分辨率/响应 ✅；比上游多支持 `fileData.fileUri` |
| OpenAI Audio / TTS | audio | `provider_audio.go` | `openai-audio` | 协议映射 ✅（binaryPayload）；**无音频任务入口**，voice/format/speed 等 extra 不注入 |
| 豆包流式 TTS | audio | `provider_audio.go` + `provider_protocol` streamedJsonAudio | `doubao-streaming-tts` | 解析 ✅（缓冲后解 JSON 帧）；**无实时流式**，多帧失败识别在协议层有；extra 音频参数不注入 |
| 异步音频 | audio | `provider_audio.go:runAsyncAudioTask` | `async-audio` | create/poll 映射 ✅；`result` 端点宿主不调用 ❌；无音频任务入口 |
| 视频处理（MediaKit 画质增强） | video（processing） | `video_processing.go` | `volcengine-mediakit`（volcengine-mediakit-enhance-video） | **不可用**：`ProtocolCatalogService.require()` 拒绝 kind=processing 绑定渠道模型；无处理任务准入/参数重算 |
| AutoDL ComfyUI（仅官方包，无源码目录） | video | `plugin-packages/autodl-comfyui.yingce-plugin` | **无** | 缺失：本仓 plugins 目录没有该包，少 1 个 provider（`autodl-comfyui`） |

---

### 表C 上游有、本仓无的功能点（按影响排序）

| # | 功能点 | 上游证据 | 本仓现状 | 影响 |
|---|---|---|---|---|
| C1 | 素材前置上传（upload → 上游素材 ID → create 引用） | `provider_protocol_async.go:uploadProtocolMedia`；`manifest_adapter.go:BuildUpload/ParseUpload` | `ManifestAdapter.buildUpload/parseUpload` 有实现但**无调用点**（grep 仅 protocol 目录） | **高**：`coolhs-wan3-relay` 的 `media[].id` 恒空、`uploadId` 恒空，插件实际不可用；需要“先传后引”的厂商无法接入 |
| C2 | 独立结果下载端点（result） | `provider_protocol_result.go:finishProtocolAdapterResult` + `ResultAdapter` | `buildResult` 有实现但无调用；`task-worker.finalize` 只消费 create/poll 的内联 URL | **高**：5 个声明 `result` 的 provider（async-audio、coolhs、dola-pool、openai-videos、rolldek）在“轮询只回状态不回地址”时必失败 |
| C3 | 上游取消（cancel + 对账） | `provider_task_cancellation.go`；`manifest_adapter.go:BuildCancel` | `task-lifecycle.cancel()` 只改本地状态；`buildCancel` 无调用 | **高**：7 个声明 cancel 的 provider 无法真正停止上游，后台终止后仍可能计费，只能人工核对 |
| C4 | 分离式长排队轮询（detachedPolling） | `provider_protocol_async.go:detachedProtocolPending/detachedPollDelay`，48h 上限、15s–2min 自适应 | 无 detached 代码路径；`task-worker` 最长视频 60 分钟 | **高**：`coolhs-wan3-relay`（拼车/班次类）在队列中必超时判失败 |
| C5 | 幂等 create 重试 + 宿主幂等键注入 | `provider_protocol_async.go:executeIdempotentProtocolCreate`、`provider_protocol.go:request.Extra["idempotencyKey"]` | 无重试；`GenerationRequest.extra` 不含 `idempotencyKey` | **高**：`coolhs` create body 的 `id` 为空；超时重试会产生第二个计费任务（本仓当前直接失败，损失可用性） |
| C6 | 公网素材 URL 水合（requiresPublicMediaUrls） | `provider_media_hydration.go` 的 requireURL/preferURL + 签名 URL | `task-media.inputReferences()` 永远 dataUrl；metadata 字段无消费点 | **高**：35 个 provider 可能拒收 data URL 或请求体过大；视频/图像上游抓不到内网/内联素材 |
| C7 | 图片/视频素材 role 语义（first_frame/last_frame/reference_image/edit_source/mask） | `provider_protocol_request.go:protocolImageReferences/protocolVideoImageReferences`、`provider_video.go:videoImageRole` | `inputReferences()` 不写 role；仅 mask 写 `role:'mask'` | **高**：Agnes 2.5 永远按 keyframe 走（有图即 keyframe）、xAI 多图只发第一张、Minimax/Seedance 首尾帧无法区分 |
| C8 | 参考视频 / 参考音频输入 | `provider.go` 的 `ReferenceVideos/ReferenceAudios`；`provider_protocol_request.go` | 任务 DTO 只有 `inputAssetIds`（图片），`request.videos/audios` 恒空 | **高**：Seedance/Minimax/Agnes/H3 的 reference video/audio、音频生成任务不可用 |
| C9 | Agent 工具调用宿主（buildAgent/parseAgent/循环/流式） | `provider_text_agent.go`、`provider_text_agent_stream.go`、`provider_agent_protocol.go` | 无调用点；23 个 manifest 的 `agent` 永远不执行 | **高**：23 个文本 provider 的 Agent 能力全部失效；画布 Agent 只能走别的实现或不可用 |
| C10 | 文本流式（SSE 增量/推理增量） | `provider_text_stream.go`、`provider_text_agent_stream.go` | 无 SSE 解析；只有一次性 `parseCreate` | **中高**：无打字机效果/长文本保活；上游 `stream` 参数即使声明也不发 |
| C11 | 错误分类与脱敏（敏感词/额度/模型权限/工具调用/tool_choice） | `provider_error.go`、`provider_error_message.go`、`provider_errors.go` | `upstreamErrorText()` 直接截断上游原文；无敏感片段过滤 | **中高**：可能向用户/日志回显密钥、余额、内部地址；同类错误文案不可行动 |
| C12 | 轮询瞬时错误重试 / 404 容忍 / Retry-After / 下载重试 | `provider_video_polling.go`、`provider_http_client.go` | 单次失败即按结果不明处理；固定间隔 | **中高**：长任务偶发网络抖动/上游 404 即失败，成功率低于上游 |
| C13 | 上游任务号兜底提取 | `provider_protocol.go:extractProviderTaskID` | 只信 `create.taskId` | **中**：清单未声明 taskId 但响应顶层有 `id/name` 时无法轮询 |
| C14 | 上游进度同步 | `provider_progress.go` | 固定 5/10/50 | **中**：进度条不真实，长任务体验差 |
| C15 | 风格档案（项目/画布风格提示词 + 素材校验） | `provider_style.go` | 无实现 | **中**：图片生成的风格一致性能力缺失 |
| C16 | 方舟私有素材（asset://） | `provider_ark_private_assets.go` | 无实现 | **中**：Ark 视频参考图可能因 data URL/公网限制被拒；已有资源不能复用为私有素材 |
| C17 | Gemini Agent 显式缓存 | `provider_gemini_cache.go` | 无实现 | **中**：Agent 成本/首 token 延迟更高（Agent 本身也未接） |
| C18 | 处理类 provider（kind=processing）完整链路 | `video_processing.go`；`protocol-catalog.service.ts` 上游对应逻辑在 `validateGenerationInterface`/`catalogModelProtocol` | `require()` 直接拒绝 processing | **中**：`volcengine-mediakit` 无法绑定渠道模型；画质增强/插帧类能力为零 |
| C19 | 旧协议别名迁移 | `builtin.go` 的 `LegacyAliases` + `registry.Resolve` | `registerAlias()` 无调用 | **中**：存量渠道模型若用 `openai-video`/`claude-messages` 等旧 id，升级后“未知协议” |
| C20 | 插件包完整性/状态/下载/升级 | `protocol_plugins.go`（registry/hash/status/package）、`handler/plugin.go:GET /plugins/:id/package`、install overwrite | 目录扫描 + DB 启停；`install()` 拒绝覆盖；无下载端点 | **中**：无法审计“运行的是哪份包”，插件升级只能先卸载再装（会短暂无协议）；无法给用户/前端下发原始包 |
| C21 | 插件不可用占位（UnavailableAdapter） | `protocol_plugins.go:reload` 注册 `UnavailableAdapter` | 注册失败直接抛错/不注册 | **中**：运行期从“当前不可用（原因）”退化为“未知协议”，排障信息丢失 |
| C22 | 插件平台可用 vs 用户启停双状态 | `plugin_management.go`、`PluginPlatformState`/`UserPluginState` | 只有平台 `enabled`；`UserPluginState` 未使用 | **中**：无法做“管理员下架/用户自行启用”的插件中心；自定义渠道的协议可见性无法按用户控制 |
| C23 | 厂商推广目录 + Key 校验 + 推荐模型 + 人民币成本/加价 | `providercatalog/*` + `provider_catalog.go` | 完全无对应域 | **中高（业务）**：无法“选厂商→验 Key→勾模型→按加价一键接入”；运营成本核算链路缺失 |
| C24 | 目录源缓存/状态机（ETag/磁盘/退避/禁用） | `providercatalog/source.go` | 仅内存 cache | **低中**：远端目录故障时页面立即空，不能离线展示旧目录 |
| C25 | 插件 provider 目录详情（version/baseUrl/parameters/create/poll/workflows） | `protocol_registry.go:PluginProviderCatalog` | `ProtocolCatalogEntry` 字段少一半 | **低中**：后台渠道工作台无法展示协议的完整映射/参数，运营需看文档 |
| C26 | 仅包无源码的 `autodl-comfyui` | `plugin-packages/autodl-comfyui.yingce-plugin` | `backend/plugins` 无该目录 | **低**：少 1 个官方视频 provider |
| C27 | 内置协议文档注入 | `documentation.go` + `docs/*.md` | manifest 内嵌文档 | **低**：已基本等价；仅 `autodl-comfyui` 文档缺失 |
| C28 | 视频选项归一（size/resolution/seedance duration/ratio） | `provider_video_options.go` | 图片比例有 `normalizeImageSizeIntent`；视频无 | **中**：Seedance 等对分辨率/时长枚举敏感的上游可能收到非声明值 |

---

### 表D 本仓有、上游无的功能点

| # | 功能点 | 证据 | 价值/说明 |
|---|---|---|---|
| D1 | 远端“插件包目录” + 下载安装 | `provider-catalog.service.ts`、`provider-catalog.controller.ts` | 上游是本地 `plugin-packages` 随镜像发布；本仓可由运维 URL 下发新插件包并一键安装，扩展性更好 |
| D2 | 协议契约校验结果持久化到 `PluginPlatformState.verifyJson` | `plugin.admin.service.ts:268-284` | 上游无等价的“按 provider 记录 verify 结果”页面字段 |
| D3 | 内置/上传双目录分离（`plugins/` 只读、`plugins-installed/` 可写） | `plugin-manifest.store.ts:63-71` | 避免上传包污染源码目录；上游用单一 `plugin_registry.json` + 包目录 |
| D4 | 卸载前检查渠道模型引用 | `plugin.admin.service.ts:245-255` | 上游 `uninstall` 无该检查；本仓避免“删插件后部分路由静默失效” |
| D5 | 禁止覆盖安装（先卸载再安装） | `plugin.admin.service.ts:199-201` | 审计更清晰（两次审计动作），代价是无热升级 |
| D6 | 协议目录合并 manifest + registry 能力 | `protocol-catalog.service.ts:90-135` | 未注册/停用插件也能在后台看到其声明；上游 catalog 只读运行时 registry |
| D7 | 插件可用性“人话原因” | `plugin.admin.service.ts:364-399` | 对 `host:`/无 provider/rpc 类插件显式说明“本环境不生效”，上游用 UnavailableReason 但无统一策略文案 |
| D8 | 后台协议连通性测试（真实协议 + 真实凭证 + 轮询 + 调用日志） | `protocol-test.service.ts` | 上游有 `TestAdminChannelModel`，但本仓实现独立且带 `waitForResult`/`request` 摘要；属于本仓更完整的运维面 |
| D9 | 插件贡献统计（providers/capabilityStats/backendStats/contributions） | `plugin-manifest.store.ts`、`plugin.admin.service.ts:128-139` | 上游有 PluginView 但无按能力/后端的聚合统计 |
| D10 | `UserPluginState` Prisma 模型已预留 | `prisma/schema.prisma:2031-2038` | 目前无 service/controller，属于“预留未落地”，不计为已实现能力 |
| D11 | 文本工具服务（润色/图转提示词）复用协议 + 切线 + 调用日志 | `text/text-tool.service.ts` | 上游文本能力走画布任务/Agent，本仓把它做成独立工具接口，形态不同 |
| D12 | 协议层 `ProtocolMetadata.requiresSecretKey` 聚合 | `manifest-adapter.ts:285`、`channel-model.service.ts:551` | 保存渠道模型时直接校验 Secret Key，上游分散在接口类型判断中 |

---

### 表E 接口 / 清单格式差异

| # | 维度 | 上游 | 本仓 | 兼容性判断 |
|---|---|---|---|---|
| E1 | manifest 线上格式 | `yingce.plugin/v1`/`v2`，`id/name/version/author/...` 平铺 + `contributes.providers[]` | 完全相同的字段名与结构（110 个 manifest SHA-256 全部相等） | ✅ 包可直接互换；本仓 `decodeManifest` 同时接受 v1/v2 |
| E2 | 包容器 | `yingce.plugin/package-v1`，48MB/256 文件/16MB/512KB，`archive/zip` | 同常量、同路径白名单；自写 zip 解析（stored/deflate） | ⚠️ 无 CRC/zip64；损坏包可能被接受；不支持 zip64 大包 |
| E3 | manifest 校验顺序/规则 | id 格式、name≤160、vendor≤120、provider id/label、kind、capability、scope、operation、agent→agentResponse、detached→poll、upload kinds/id、payment | 逐条对齐（`manifest.ts:88-260`） | ✅ 基本一致；缺 `Metadata` 投影字段与 `normalizeManifest` 无 provider 分支 |
| E4 | 提供者元数据 | `Metadata{ID,Version,Name,Vendor,Categories,Scopes,Parameters,ImageParameters,Create,Poll,Cancel,ContentType,LegacyAliases,Enabled,Installable,Execution,RequiresPublicMediaURLs,DetachedPolling,IdempotentCreate,UnavailableReason,Kind}` | `ProtocolMetadata` 无 `Enabled/UnavailableReason/Installable/Execution/LegacyAliases/Parameters`；enabled 由注册表移除代替 | ⚠️ 运行期判断（列表过滤、不可用、别名）语义丢失 |
| E5 | 操作对象 | `ManifestOperation{method,path,pathTemplate,originPath,contentType,contentTypeTemplate,headers,query,body,fields,files}` | 同字段 | ✅ |
| E6 | 响应映射 | `taskId/status/message/stage/queueAhead/text/reasoning/images/videos/audios/usage/errorPaths/.../binaryPayload/streamedJsonAudio` | 同字段（TS `response` 必需但可为空） | ✅；`manifestError` 对 bool false 语义不同 |
| E7 | 表达式语言 | `$` 操作符集合（见 §2） | 同集合 | ✅ 大部分；数值转字符串/错误包装有差异 |
| E8 | 鉴权声明 | `ManifestAuth{type,field,secretField,header,prefix,query,username,service,region}` | 同字段 | ✅ 字段一致；火山 V4/AWS/TC3 签名实现不同（风险） |
| E9 | provider 目录接口 | `/plugins/catalog?scope=&capability=` 返回 `PluginProviderCatalogItem`（含 version/baseUrl/parameters/workflows） | `GET /admin/channels/protocols?capability=` 返回 `ProtocolCatalogEntry`（字段较少） | ⚠️ 路径、权限点（channelModelRead vs 插件中心）和返回字段都不同 |
| E10 | 插件管理接口 | 用户 `/plugins/status`、`/plugins`、`/plugins/:id/package`、`/plugins/:id/activation`；管理员 `/admin/plugins`、`/availability`、安装/启停/卸载 | 仅 `/admin/plugins` list/get/PATCH/verify/install/uninstall；目录 `/admin/provider-catalog` | ⚠️ 无用户侧插件中心、无包下载、无用户激活 |
| E11 | 插件状态模型 | 平台可用（管理员）+ 用户启用；`source` official/system/uploaded；`kind` protocol/application/payment/sms；`activationScope` system/user | 单表 `enabled` + `verifyJson` + `source` builtin/uploaded；无 kind/activation/config scope | ⚠️ 模型域够用，但插件中心语义弱化 |
| E12 | 插件包生命周期 | registry JSON + SHA256 + status invalid + UnavailableAdapter + 覆盖升级 + 包缓存 | 目录扫描 + DB 启停 + 禁止覆盖 + 无 hash/status/包缓存 | ⚠️ 运维/审计差异 |
| E13 | 服务商目录格式 | `schemaVersion:1`、tags、providers[rank/时间窗/connection/models/priceTiers] | 任意 `array` 或 `{items:[]}`：id/name/vendor/apiFormat/baseUrl/protocols/packageUrl | ❌ 不可互读，业务模型不同 |
| E14 | 价格口径 | 人民币元 → microcredits（1 元=1 积分），加价率 basis points 向上取整，token 模式按每百万 token | 后台价格档按分组倍率/货币换算，无目录成本/加价链路 | ❌ 无对应 |
| E15 | 宿主执行边界 | `Adapter` 接口 + `RequestAwareCreateParser`/`AgentAdapter`/`ResultAdapter`/`MediaUploadAdapter` 能力接口 | `ProtocolAdapter` 可选方法；无能力探测 | ⚠️ TS 无法区分“未声明”和“声明但空实现” |
| E16 | 插件来源/保留 ID | `officialApplicationPolicies`、`systemPaymentPolicies`、保留 ID 拒绝、支付订单依赖 | 仅安装去重；无保留 ID、无支付订单检查 | ⚠️ 非模型域影响为主 |
| E17 | admin 审计 | `appendAdminAudit` 多处（安装/卸载/可用性/Key 查询） | `@AuditAction` 装饰器覆盖 plugin.toggle/verify/install/uninstall、catalog refresh/install | ✅ 基本等价 |
| E18 | 文档 | `docs/*.md` + 模板注入 | manifest.documentation 内嵌 | ✅ 等价（除 autodl） |

---

### 2. 表达式 DSL 语义专项（逐操作符核对）

逐条比对 `internal/protocol/expression.go` 与 `src/model/protocol/expression.ts`：

| 语义点 | 上游 Go | 本仓 TS | 结论 |
|---|---|---|---|
| `${path}` 整串取值 | trim 后必须整串 `${...}` | 同 | ✅ |
| 数组/对象丢弃 null | 仅丢 `nil` | 丢 `null` 和 `undefined` | ✅ 实际等价 |
| 单键 `$` 对象才当操作符 | `len==1 && HasPrefix("$")` | 同 | ✅ |
| `$coalesce/$default` 空判定 | null/空白串/空数组/空 map | 同 | ✅ |
| `$concat` | 跳过 nil，`manifestString` | 跳过 null/undefined，`manifestString` | ✅ |
| `$map/$filter` alias 默认 `item`，子环境注入 `aliasIndex` | 是 | 是 | ✅ |
| `$indexObject` | `max` 只接受更小值，空值丢弃，键 `prefix+index` | 同 | ✅ |
| `$first/$last/$at/$len/$split` | 数组/对象/字符串 rune 长度 | 同（字符串按码点） | ✅ |
| `$if/$switch` 真值 | `"false"/"0"/"no"/"null"` 为假 | 同（大小写不敏感） | ✅ |
| `$omitEmpty` | 空→nil | 空→null | ✅ |
| `$lower/$upper/$trim/$toString/$toInt/$toFloat/$toBool` | `manifestString` + `strconv` | `manifestString` + `Number` | ⚠️ 数字字符串解析：Go `ParseFloat` 接受 `"1,2"`? 否；TS `Number("1,2")` NaN，基本一致；差异在科学计数法格式化 |
| `$dataMime/$dataPayload` | 5 字符前缀、`;`/`,` 分割 | 同 | ✅ |
| `$json` | `json.Marshal`（map 键排序） | `stableJson`（键排序） | ✅ |
| `$merge` | 逐项覆盖，later wins | `Object.assign` | ✅ |
| `$sortByOrder` | 稳定排序，仅按 `order` | 按 `order`，同序回退原下标 | ✅ |
| `$add/$multiply/$divide/$min/$max/$ceilStep` | float64 + `normalizeManifestNumber` 整数值转 int | number；除数为 0 抛错，step≤0 抛错 | ✅ 语义等价；`Number` 与 int 溢出边界不同 |
| `$eq/$ne` | `json.Marshal` 后字符串比较 | `stableJson` 比较 | ✅（键排序一致） |
| `$in` | 右侧数组逐项 JSON 比较 | 同 | ✅ |
| `$and/$or/$not` | 返回 bool | 同 | ✅ |
| 数字转字符串 | `strconv.FormatFloat(v,'f',-1,64)`（无指数） | `String(v)`（大/小值用指数） | ❌ **差异**：`$toString`/`$concat`/header/query 中 `1e-7`、`1e21` 等会产生不同文本 |
| 错误语义 | 返回 error 并加 `evaluate %s:`/`evaluate request body:` 上下文 | 抛 `ManifestExpressionError`，无字段上下文 | ⚠️ 用户/日志可读性不同 |
| 不支持类型 | 先 JSON 往返归一 | 标量/数组/对象之外直接抛错 | ⚠️ 极端值（Date/Map/BigInt）行为不同 |
| `manifestError()` 对 bool | `false` 落入 default → **视为错误** | `false` → 不算错误 | ❌ **语义相反**：`errorPaths` 指向布尔字段时上游会误判失败、本仓不会 |

---

### 3. 插件包解析 / 安装 / 卸载 / 启停 / 依赖保护专项

| 环节 | 上游 | 本仓 | 差异/风险 |
|---|---|---|---|
| 解析 | `ParsePluginPackage` 全量解压；`InspectPluginPackage` 只读 manifest；`ParsePluginPackageFiles` 按需解压 | `parsePluginPackage`/`inspectPluginPackage`/`parsePluginPackageFiles` 三个入口，自写 zip | 缺 CRC 校验、zip64；无支付 rpc 产物布局校验 |
| 校验 | manifest 校验 + runtime 入口 + 支付 rpc 产物 + 支付/SMS 贡献 | manifest 校验 + runtime 入口 | 缺支付 rpc 产物；`processing` 没有被拒绝但后续绑定被拒 |
| 安装 | 写 registry JSON；允许覆盖已装上传插件（保留 InstalledAt）；拒绝覆盖内置（支付插件例外）；缓存 zip 按 hash；失败回滚 registry | 解压到 `plugins-installed/<id>`；已存在 id 一律 409；失败删除临时目录 | 无热升级；无 zip 缓存/哈希；内置和上传都按 id 去重 |
| 卸载 | 删除 registry 记录 + 包文件；内置拒绝；支付插件检查未完成订单；无渠道模型引用检查 | 删除目录 + DB state；内置拒绝；**检查 `channelModel.protocol in provider ids`** | 本仓依赖保护更强；但无支付订单检查（支付域排除） |
| 启停 | 改 manifest `Metadata.Enabled` 写 registry，reload 后不注册/注册 Unavailable | DB `PluginPlatformState.enabled`，`registerAll` 读库并 `removeByPlugin` | 结果等价；本仓缺“不可用占位”和 per-user |
| 状态 | `PluginView{source,status,error,sha256,package,installedAt}` | `PluginView{origin,removable,enabled,activeProtocols,availability,...}`，无 hash/status/error | 审计与排障信息少 |
| 依赖引用保护 | 支付订单依赖；渠道模型引用无保护 | 渠道模型引用有保护；支付订单无 | 模型域本仓更安全 |
| 失败策略 | 内置包/registry 损坏启动失败；单个 provider 注册失败标 invalid + Unavailable | 内置 manifest 坏 → 启动失败；上传坏 → 跳过；provider 注册失败 → 抛错 | 本仓“一个坏 provider 拖垮整次注册/启动”的风险更高 |
| 来源/保留 ID | official/system/uploaded + 保留 ID 列表 | builtin/installed | 本仓无“官方应用/系统支付 ID 保留”概念（非模型域影响为主） |

---

### 4. 服务商目录口径差异（重点说明）

上游 `providercatalog` + `app/provider_catalog.go` 的完整链路：

1. 远端 `https://ai.yingce.tv/v1/catalog.json`（schemaVersion=1，≤2MB）；
2. 校验 tags/tone、provider 的 rank/时间窗/permanent/logo/website/keyGuide、每个 provider ≤5 个推荐模型；
3. 每个模型声明 capability/protocol/modelKey/providerModelKey/priceTiers（人民币 `cost` 或 `inputPerMillion/outputPerMillion/cachedPerMillion`）；
4. 后台列表只展示推广期内（`Active`）的 provider，并标记协议是否被当前版本支持；
5. `VerifyProviderCatalogKey` 用管理员 Key 调 `GET {baseUrl}/models`，返回 available/missing 推荐模型；
6. `InstallProviderCatalog` 要求选择模型 + 加价率（0–1000%，两位小数），把人民币成本换算成 microcredits，按 `ApplyMarkup` 向上取整生成售价，事务内创建系统渠道 + 渠道模型 + 价格档；
7. 目录源有 live/cache/unavailable/disabled 四态、ETag、磁盘快照、5 分钟 stale、30 秒失败退避。

本仓：

1. `MODEL_PROVIDER_CATALOG_URL` 指向“插件包索引”（`[{id,name,vendor,apiFormat,baseUrl,protocols,packageUrl}]` 或 `{items:[]}`）；
2. 没有 schemaVersion/tags/rank/时间窗/logo/website/keyGuide；
3. 没有推荐模型、没有价格、没有人民币/加价换算；
4. `verify` 只检查 id/name/apiFormat/protocols/packageUrl 是否齐全，不发上游请求；
5. `install` 下载 zip 并调用 `PluginAdminService.install`，**不创建渠道/模型/价格档**；
6. 只有内存 cache，无 ETag/磁盘/状态机。

结论：这不是“同一功能的不同实现”，而是**两个不同产品能力**。若产品目标是“服务商接入向导”，本仓需要补一整条链路（模型目录、Key 验证、定价/加价、渠道与价格档事务创建）；若目标只是“插件包分发”，则上游该模块可视为被替代，但需在文档/后台明确口径，避免运营按旧文档找“厂商目录”。

---

### 5. 排除项（非模型域）

以下上游/本仓文件或贡献**未纳入模型域功能判断**，但已确认其存在并在表A相应位置标注为“排除”：

- 支付：`protocol/payment_rpc.go`、`app/payment_plugins.go`、`app/payment_providers.go`、5 个 `official-payment-*` manifest、`providercatalog/pricing.go` 中“售价”部分（价格换算本身在服务商目录章节仍提及，因为它与模型接入强相关）。
- 短信：`app/sms_plugins.go`、`ManifestSMSProvider`、`systemSMSPolicies`。
- 工作流/应用：`app/workflow_plugins.go`、`workflow_provider*.go`、`project_workflow.go`、RunningHub/Eagle/Editor 等 `officialApplicationPolicies`。
- Agent 应用层：`isWorkflowProviderInterface` 的 workflow provider；但 **模型域 Agent 协议**（`provider_text_agent*.go`、`provider_agent_protocol.go`）已纳入表A/C，因为它直接服务 23 个文本 provider 的 `agent` 声明。
- 支付/WASM/RPC 运行时的目录物化：`protocol_plugins.go:materializePaymentBackend*`、`payment_runtime*`，仅作为插件生命周期对照提及。

---

### 6. 测试文件汇总（一句话）

上游 `internal/protocol` 有 30 个 `_test.go`（expression/manifest/package/builtin/agnes/cangyuan/dashscope/dola/doubao/kacang/km-kemei/lxmone/minimax/metaso/official_catalog/payment/autodl 等），`internal/providercatalog` 另有 4 个测试文件；**本仓 `backend/src` 只有 5 个 spec（支付 3 个 + 通用 zip/csv 各 1 个），`protocol`/`plugins`/`catalog` 目录下没有任何单元测试**，与 `expression.ts` 头注释“改动前先看单测”不一致，是本次审计中最容易被忽视的回归风险。

---

### 7. 附：证据索引（便于复核）

- 宿主未调用可选能力：`grep -rn "buildUpload|parseUpload|buildResult|buildAgent|parseAgent" backend/src` 结果只出现在 `src/model/protocol/**`。
- 不读 `requiresPublicMediaUrls`：`grep -rn "requiresPublicMediaUrls" backend/src` 结果只有 `runtime.ts`/`types.ts`/`manifest-adapter.ts` 的赋值与 `task-media.service.ts` 注释，无调用点。
- 不注入 `providerOptions`：`grep -rn "providerOptions" backend/src/model` 结果只有协议层与 `text-tool.service.ts`。
- 无 role：`task-media.service.ts:77-91` 只传 `id/order/name/absoluteBaseUrl/sourceUrl`，`toReference()` 不设置 `role`。
- 无 cancel：`task-lifecycle.service.ts:173-206` 只更新任务/账单，未引用 adapter。
- 无用户插件状态：`grep -rn "userPluginState" backend/src` 无结果，但 `prisma/schema.prisma:2031` 有模型。
- 无 alias 注册：`grep -rn "registerAlias" backend/src` 只有定义，无调用。
- manifest 字节一致：脚本对 110 个目录的 `manifest.json` 做 SHA-256 比对，差异数 0。
- 上游包统计：`plugin-packages/` 110 个源目录 + 108 个 `.yingce-plugin`，其中 `autodl-comfyui` 仅包无源码；`src-a6api`/`src-antigravity-proxy`/`src-metaso-h3` 无包。


## 4. 任务 / 计费 / 财务 / 调用日志逐文件对照

- 上游：`/Users/bright/github/open-ai-canvas/backend`（Go 1.x + GORM，单/多实例 + Redis 协调）
- 本仓：`/Users/bright/github/aigc-creation/backend`（NestJS + Prisma/SQLite，单实例、进程内协调、微积分 BigInt）
- 审计方式：只读阅读源码；结论均指向函数 / 字段 / 状态机分支（`文件:行`）。
- 结论口径：✅ 对齐｜🔀 合并或重构（语义等价，位置/实现不同）｜⚠️ 有意差异（技术栈/产品设计导致）｜❌ 未移植（真实缺口或有影响的行为差异）｜➕ 仅本仓有。

---

### 0. 一句话结论

核心资金状态机（预留 → 运行 → 结算/退款/uncertain、Token 结算、chargeLimit、失败转人工、FEFO 原路退款、钱包恒等式）**实现质量与上游同级，且部分更强**；真正的缺口集中在三处：**①任务侧账单的兜底运维（自动退款 / 待核对队列 / 巡检）；②媒体产物落盘与恢复（幂等、实测时长、本地兜底、管理员恢复）；③运营分析与调用日志的运维面（明细/媒体预览/查上游/恢复/合并轮询/批量核对）**。

---

### 表 A · 逐文件对照

| 上游文件 | 本仓对应 | 状态 | 具体功能差异与证据 |
|---|---|---|---|
| `app/task_creation.go` (784) | `src/model/tasks/task-admission.service.ts` + `task-request.service.ts` | 🔀 | 上游是“输入标准化→工具解析→逻辑模型路由→能力/价格/额度/容量校验→建单+预留同事务”；本仓改为“能力注册表 → 后台上下线 → 会员并发 → 项目/素材归属 → 遮罩/标注 → 路由 → 计价 → 建任务 → 批量预留”，并用能力注册表取代 model/workflow/custom-channel 分支（`task-admission.service.ts:80-309`）。缺口：无 Agent 准入（`taskAdmission.MaxCharge/NonBillable`）、无账号文件容量前置校验、无内嵌媒体拒绝、无文本回放任务、无工具 mention 解析、无 `ActiveTaskLimit` 全局额度（改用会员 `checkConcurrency`，`membership.service.ts:158-185`）。 |
| `app/task_billing.go` (140) | `src/model/billing/billing.service.ts` | ✅ | 一一对应：`markRunning`（CAS）、`settle`、`refund`、`markUncertain`、`failureRequiresReview`（失败标记列表完全一致）以及 `CheckRetryEligibility` 的等价物（本仓在 `retryTask` 中**没有**调用，见 `generate.service.ts:71-104`）。 |
| `app/task_diagnostic.go` (105) | 无 | ❌ | 上游把 `phase/code/submissionOutcome/retryClass/safeMessage` 落 `execution_diagnostic_json`，供任务中心与 Agent 判断“是否已提交上游”（`task_diagnostic.go:35-46,97-105`）。本仓只有 `errorCode` + `mediaRecoveryError`，没有 `submissionOutcome` 概念。影响：无法区分“没发出去”与“结果不明”，运营只能读 attempt 表。 |
| `app/task_execution.go` (69) | `task-worker.service.ts` + `task-request.service.ts` | 🔀 | 上游按 `task.Type` 分派 canvas_text/image/video/audio + `video_*`；本仓按能力注册表统一投影，只有 15 图 + 1 视频（`capabilities/definitions/*`），没有文本/音频执行分支（`task-worker.service.ts:577-692`）。 |
| `app/task_lifecycle.go` (230) | `task-lifecycle.service.ts` + `generate.service.ts` + `admin/tasks-admin.service.ts` | 🔀 | 取消/重试收敛方式不同：上游 `cancelTaskWithIntent` 支持用户/父任务/worker 三种来源，先 hydrate `providerRequestId`，再**请求上游取消**并进入持久化对账（`task_lifecycle.go:112-211`）；本仓只有后台终止（`generate.service.ts:112-116`），**不请求上游取消**。重试：上游重解析模型 + 新建账单 + 预留 + `RetryTaskWithBilling`（`task_lifecycle.go:33-106`）；本仓新建 `creditCost=0`、无账单的免费任务（`generate.service.ts:71-104`，见表 B-14）。 |
| `app/task_media_assets.go` (154) | `task-media.service.ts` + `generate.service.ts:getTask` | ❌ | 上游有 `AudioOutputDurationMs`（实测时长，缺失即报错→转人工，`task_media_assets.go:46-62`）、项目/画布存在性与归档校验、按确定性 key 重建素材（`generationMediaAssetID`，`task_media_assets.go:64-71`）。本仓无实测时长、无恢复素材登记。 |
| `app/task_media_fallback.go` (206) | 无 | ❌ | 对象存储失败 → 本地兜底 + `ResourceOffloadJob` 补传 + 熔断（5 分钟 3 次 → 5 分钟开路）。本仓 `task-media.persist` 直接把失败抛给 worker（`task-media.service.ts:195-216`）。影响：存储故障时上游已计费但产物丢失，只能退款/转人工。 |
| `app/task_media_recovery.go` (590) | `task-worker.service.ts:deferMedia/persistPending` | 🔀 | 同一意图（不重发上游、先存结果再重试落盘），本仓实现更薄：整段 `ProtocolResult` JSON 进 `pendingResult`，固定 30s×5 次（`task-worker.service.ts:59-60,894-1005`）；上游是**分阶段 checkpoint**（download/upload/register），可跨重启续跑、20 分钟窗口、指数退避 + 429 Retry-After、并发槽、手工恢复上限 3 次、管理员按 `charge/waive` 处理已退款订单（`task_media_recovery.go:164-379,412+`）。 |
| `app/task_media_storage.go` (431) | `task-media.service.ts` + `src/storage/**` | ⚠️ | 技术与实现不同：上游自管临时文件、下载预算、mime/大小护栏、本地写入；本仓复用 StorageService（backend/key）。语义大体对齐，但本仓 `persist` **不按 `taskId+index` 复用已写对象**，重试会生成新对象 + 新 Asset（`task-media.service.ts:194-217`）。 |
| `app/task_output.go` (529) | `generate.service.ts:getTask/list*` + `admin/tasks-admin.service.ts:detail` | ⚠️ | 上游对外只投影白名单输入（`publicTaskInputJSON`）、生成预览/封面、`clientContext`，并清空内部路由字段（`task_output.go:292-332`）；本仓直接返回完整 `params` JSON（`generate.service.ts:163`）与素材列表。功能上更直白，但会暴露 `__memberFastChannel`、`batchId` 等内部参数；无 preview/poster 统一投影。 |
| `app/task_render.go` (211) | 无 | ❌ | 时间线渲染（ffmpeg 合成、音轨探测、素材落地）。本仓产品无时间线，属**范围外未移植**。 |
| `app/task_route_executor.go` (83) | `task-worker.service.ts:advance` + `task-attempt.service.ts` | ✅ | 同样的“循环执行当前 attempt → 失败按 dispatchState 决定换线/停止”。本仓把状态机拆进 `TaskAttemptService.begin`（`task-attempt.service.ts:118-144`），语义一致（含 `submission_unknown` 禁止重发）。 |
| `app/task_storage_admission.go` (54) | 无 | ❌ | 上游在**扣费与调用上游之前**校验账号文件容量（`requireStoredFileCapacityForTask`）。本仓全仓检索无容量准入（`grep 容量/storageLimit` 仅命中无关文案）。影响：容量满 → 上游成功 → 落盘失败 → 退款/不确定，平台白付。 |
| `app/task_terminal.go` (324) | `task-lifecycle.service.ts` | 🔀 | 主流程对齐（CAS 认领 → 终态 → 结算/退款/uncertain）。差异：上游按 `providerSucceeded / channelSlotFailedBeforeRequest / BillingFailureRequiresReview` 决定退款还是转人工，且“结果保存失败”**一律 uncertain**（`task_terminal.go:114-221`）；本仓在落盘重试用尽后走 `lifecycle.fail`（默认退款，`task-worker.service.ts:985-993`）。上游另有文本回放归并、资源租约释放、产物登记（`task_terminal.go:230-318`），本仓无。 |
| `app/task_text_stream.go` (91) | 无 | ❌ | 文本增量 2KB/500ms 批量落库、失败不致命、`Close` 冲刷。本仓无文本任务、无增量通道（`/tasks/:id/text-deltas` 也不存在）。 |
| `app/task_timeline.go` (294) | 无 | ❌ | 本地 whisper 转写任务（独立执行器、独立超时 20min）。范围外未移植。 |
| `app/task_worker.go` (513) | `task-worker.service.ts` (1115) | 🔀 | 本仓是“1s tick + 进程内 active 集合 + 45s/15s 租约 + 单进程 8 并发”（`task-worker.service.ts:49-57,119-173`）；上游是“Redis 全局 worker 槽 + `ClaimNextTask` + 每任务独立 owner + 15s 续租 + 续租失败取消 context”（`task_worker.go:49-119,140-170`）。本仓缺：全局并发租约、续租失败即停手、断连 defer 轮询（`shouldDeferProviderTask`）、上游取消对账、文本回放清理。 |
| `app/billing_auto_refund.go` (138) | 无 | ❌ | “冻结积分自动退回”开关（SystemSetting `billing_auto_refund`）+ 每分钟批量退回 + 排除“已有作品检查点/结果保存失败”的订单 + 写 `RecordBillingResolution`（`billing_auto_refund.go:106-137`）。本仓无任何任务账单自动退款。 |
| `app/billing_review.go` (48) | 无 | ❌ | 每小时只读巡检 `StaleBillingReviewStats`（reserved/running/uncertain 超 15 分钟），打日志提醒（`billing_review.go:13-47`）。本仓无。 |
| `app/finance.go` (914) | `billing.service.ts` + `credit.service.ts` + `admin/commerce-admin.service.ts` | 🔀 | 账单构造/Token 估算/分组价/成本快照基本等价（`billing.service.ts:164-370`）；差异见下表：无兑换码体系、无 `ModelPricing`、账单幂等键策略不同、视频 Token 明确不支持、无 `RestoreRefundedBilling` 入口。 |
| `app/analytics.go` (253) | `analytics.controller.ts` + `finance-analytics.service.ts` | ❌ | 上游是运营总览：KPI（DAU/WAU/MAU、任务/请求量、成功率、P95、排队数、总余额）、趋势、模型榜、用户榜、失败榜 + `ModelPricing` CRUD（`analytics.go:20-253`）。本仓只有财务汇总一个接口。 |
| `app/analytics_api_logs.go` (307) | `billing-admin.service.ts:listApiLogs/exportApiLogsCsv` | 🔀 | 列表/CSV 有；缺：详情（原始请求/响应体）、媒体预览路由（`/admin/api-logs/:id/media`）、`query-task`、`recover-url`、`recover-media`（charge/waive）、批量查询、按选中 id 导出（`analytics_api_logs.go:19-307`）。另外上游会给轮询/下载日志做渠道名/用户/任务/账单/媒体预览装饰，本仓用一次 `apiLogRelations` 关联投影（不含媒体）。 |
| `app/analytics_build.go` (453) | 无 | ❌ | 纯函数式 KPI/趋势/榜单构建（含 rolling 30 天活跃、P50/P95、可空成功率）。本仓无等价实现。 |
| `app/analytics_enrich.go` (275) | 无 | ❌ | 任务↔请求日志 enrichment、渠道维度过滤、失败分类。本仓无。 |
| `app/analytics_finance.go` (98) | `finance-analytics.service.ts` | 🔀 | 上游按 **订单首条可计费调用** 归因收入，只统计 `settled` 且日志/订单渠道一致；成本缺一项时利润返回 **null**（`analytics_finance.go:22-97`）。本仓按 `BillingOrder` 直接聚合，成本“有多少加多少”，`margin = charged - cost` 会**高估**缺成本订单的毛利（`finance-analytics.service.ts:165-168,180-199`）。 |
| `app/admin_api_call_log.go` (138) | `task-executor.service.ts:logCall` + `proxy/proxy-call-log.service.ts` | 🔀 | 本仓一行一次调用（每次 poll 新建）；上游把视频/图片的 poll 合并进 create 根日志（`pollCount++`、上游状态/用量/错误覆盖，`admin_api_call_log.go:79-131`），并按日志体积做存储配额、顺带回写任务 `providerRequestId/poll_stage/next_poll_at`（`:14-77`）。本仓日志写入失败只 warn，且不回写任务状态。 |
| `app/video_token_billing.go` (241) | 无 | ❌ | Seedance 视频 Token 公式（尺寸×帧率×时长+参考视频时长 /1024 + 10% 预授权余量、公式快照可结算）。本仓 `withAmount` 对 `token && video` **直接拒绝**（`billing.service.ts:320-325`），`USAGE_SOURCE_VIDEO_FORMULA` 分支实际不可达。 |
| `repository/analytics.go` (429) | `billing-admin.service.ts` 查询 + `channels/channel-model-metrics.service.ts` | 🔀 | 本仓覆盖调用日志分页/导出与渠道指标；缺 `HasVisibleFailedAPICallLogForTask`、`APICallLogUsageForTask`、`AsyncMediaAPICallRoot`、`LatestProviderRequestID*` 等任务/日志对账查询。 |
| `repository/billing_authorization.go` (14) | `billing.service.ts:101-115` | ✅ | `chargeLimitApplies = set || limit>0`、越限拒绝，逐字对应。 |
| `repository/billing_review.go` (68) | 无 | ❌ | 未闭合订单统计（含 oldest）。本仓无。 |
| `repository/finance.go` (240) | `billing.service.ts` + `credit-wallet.service.ts` + `task-admission.service.ts` | 🔀 | 关键差异：上游 `CreateTaskWithCreditReservation` 在**一个事务**里“活动额度 → 预留 → 建任务”（`finance.go:118-144`）；本仓是“建任务（独立事务）→ 批量预留（另一个事务）”，失败再删任务（`task-admission.service.ts:226-299`）。上游 `RetryTaskWithBilling` 在事务里预留+重置任务（`finance.go:171-217`），本仓重试不建账单。 |
| `repository/finance_billing.go` (730) | `billing.service.ts` + `credit-wallet.service.ts` | 🔀 | 状态迁移/Token 计价/按秒计价/chargeLimit 截断逐条对齐（`billing.service.ts:566-843`）。差异：①本仓增加 CreditLot/FEFO/预留明细（上游只有账户余额，无批次，无到期）；②上游有 `RestoreRefundedBillingOrder`（退款订单人工确认上游成功后从可用余额补扣，`finance_billing.go:528-642`），本仓无；③本仓按秒结算不更新 `costQuantity`（上游 `finance_billing.go:413-417` 会更新）。 |
| `repository/finance_channel_models.go` (350) | `src/model/channels/**`、`catalog/**` | ⚠️ | 同名但职责已迁到渠道/目录模块；价格档读写、渠道模型启停、批量删除、名称同步在上游此文件，本仓分散在 channels/catalog。不属本次任务/计费缺陷。 |
| `repository/finance_redeem.go` (185) | `credit.service.ts:adminAdjust`；兑换码无 | ❌/⚠️ | 人工调账等价（`AdjustCredits` ↔ `adminAdjust`，强制原因、拒绝 0、余额不足拒绝）。**兑换码子系统整体缺失**：无 `RedeemBatch/RedeemCode`、无批次创建/列表/禁用/单码禁用、无明文回看、无 `RedeemCode` 原子兑换。 |
| `repository/repository_tasks.go` (424) | `task-worker/attempt/lifecycle` + `generate.service.ts` | 🔀 | 领取/续租/终态 CAS 对齐；本仓终态写入**不带 leaseOwner 条件**（`task-lifecycle.service.ts:68-86,112-124,181-191`），上游 `taskLeaseWriter` 全局带 owner（`repository_tasks.go:191-196,246-267`）。本仓也无 `UpdateTaskProviderState`（日志回写）、`ClaimFailedTaskProviderRecovery`、`CancelTaskIfStatus` 来源/诊断字段。 |
| `repository/workbench_tasks.go` (36) | `admin/tasks-admin.service.ts:list` + `generate.service.ts:listTasksPage` | ⚠️ | 上游是 cursor（`id < cursor`）分页 + workbenchKind 过滤；本仓是 offset 分页 + capability/project 过滤。产品形态不同。 |
| `repository/task_media_recovery.go` (47) | 无 | ❌ | 媒体恢复 checkpoint 持久化。本仓把整包结果放 `GenerationTask.pendingResult`，无独立 checkpoint。 |
| `kernel/token_billing.go` (41) | `src/model/infra/microcredits.ts:109-123` | ✅ | `ceil(Σ tokens×price × bps / 1e10)`，BigInt 计算、越界报错，公式一致。 |
| `kernel/error_codes.go` (82) / `kernel/errors.go` (69) | `src/common/app.exception.ts` + 各域错误码 | ⚠️ | 上游错误信封 = HTTP 状态 + `reason` 机器码；本仓自定义 5 位业务码（40001/40005/40201/40909/42201-42206）。任务错误码 42204/42205/42206 语义对齐；其余按域重编。 |
| `model/models_task.go` (114) | `prisma/schema.prisma:GenerationTask` | 🔀 | 本仓新增 `parentTaskId/idempotencyKey/heartbeatAt/leaseOwner/leaseUntil/nextPollAt/pendingResult/authorizedChargeMicrocredits/attempts/stage/progress`；缺 `TraceID/RequestID/Prompt/WorkflowKind` 语义（有 capability）、`MediaRecoveryJSON/MediaStage`（有 pendingResult/mediaRecoveryError）、`ProviderCancel*`、`CancellationSource/Actor/RequestedAt`、`ExecutionDiagnosticJSON`、`TextDraft`、`AgentRunID/GenerationID/ApprovalID`、`CreationSubmissionID`。 |
| `model/task_execution.go` (34) | 无 | ❌ | 诊断模型（SubmissionOutcome/RetryClass/SafeMessage/Writeback*）。本仓无。 |
| `model/credit_cost.go` (19) | `BillingOrder.cost*` + `cost-amount.ts` | ✅ | 成本快照独立于售价、换线更新、`costConfigured=false` 表示未配置；`billingCreditCost` 返回 null 而不写 0（`cost-amount.ts:36-63`）。 |
| `model/models_finance.go` (137) | `prisma/schema.prisma:1798-1936` | 🔀 | BillingOrder 字段基本一一对应（含 `usageSource/videoFormulaTokens/chargeLimit*`），并新增 8 个成本列；CreditAccount 增加批次维度；BillingOrder 增加 `promotionId`。无 `ModelPricing`、`RedeemBatch/RedeemCode`。 |
| `handler/finance.go` (613) | `credits.controller.ts` + `admin/commerce.controller.ts` + `billing-admin.controller.ts` | 🔀 | 见接口表 E。 |
| `handler/admin_analytics.go` (124) | `analytics.controller.ts` | ❌ | 只有 `/admin/analytics/finance`；缺 overview/models/users/export.csv + model-pricings CRUD。 |
| `handler/admin_api_log_routes.go` (169) | `billing-admin.controller.ts:87-109` | ❌ | 只有列表 + CSV；缺详情、媒体、query-task、recover-url、recover-media、批量恢复。 |

---

### 表 B · 上游有、本仓无的功能点（逐条 + 影响）

| # | 功能点（上游证据） | 本仓现状 | 影响 |
|---|---|---|---|
| B-1 | **建单与预留同一事务**：`CreateTaskWithCreditReservation` 一个事务内 `reserveBillingOrder` + `tx.Create(task)`（`repository/finance.go:118-144`） | 先建任务（独立事务），再 `reserveBatchBilling`（另一个事务），失败 `deleteBatch` 补偿（`task-admission.service.ts:226-299`；注释自认“先建后预留”） | 进程在两步之间崩溃 → “排队但无账单”任务；靠 `recoverUnbilledQueued` 60s 补挂 / 10min 判死（`task-worker.service.ts:250-281`）。补偿存在，但不再是原子保证；期间任务不可执行、用户已扣费/未扣费状态不明确。 |
| B-2 | `markRunning` 失败 = 停止派发：`MarkBillingRunning` 错误 → `markPreparationFailure`（`task_worker.go:248-250`；`finance_billing.go:229-251`） | `billing.markRunning(...).catch(warn)` 后继续 `advance`（`task-worker.service.ts:293-298`） | 账单已被人工结算/退款时仍会调用上游 → 平台白付一次调用；随后结算失败转 uncertain。 |
| B-3 | 终态写入绑定租约：`taskLeaseWriter` 全局限定 owner（`repository_tasks.go:191-267`） | `succeed/fail/uncertain/cancel` 只按 `id + status` CAS，不校验 `leaseOwner`（`task-lifecycle.service.ts:68-86,112-124,149-161,181-191`） | 租约过期被新执行者接管后，旧执行者迟到写入仍可能成功结算/覆盖产出（`finalize` 的前置检查有竞态窗口）。 |
| B-4 | 任务账单**自动退款**开关 + 队列（`billing_auto_refund.go`） | 无；sweeper 只处理 `taskId=''` 的中转单（`billing-sweeper.service.ts:91-125`） | reserved/running/uncertain 的任务预授权只能人工核对；无人值守时冻结积分永久挂账。 |
| B-5 | 待核对队列口径 `status='review'`（uncertain ∪ running>40min ∪ reserved+任务 failed/cancelled，排除已出作品/保存失败）（`finance_billing.go:112-156`） | `orderWhere` 只做精确状态过滤（`billing-admin.service.ts:436-449`），传 `review` 得 0 行 | 后台无法一眼看到“该核对哪些单”，运营只能逐状态翻。 |
| B-6 | 订单巡检（每小时，15 分钟阈值，输出 stale 计数/最老时间）（`billing_review.go`） | 无 | 挂账无监控指标，只能靠用户投诉发现。 |
| B-7 | 批量人工核对 `POST /admin/billing-orders/batch-resolve`（逐单失败明细，≤100 条）（`finance.go:346-388`） | 只有单条 `POST :id/resolve`（`billing-admin.controller.ts:75-84`） | 大批 uncertain 单处理效率低。 |
| B-8 | 调用日志详情（含请求/响应体）+ 媒体预览 + 查询上游任务 + 按 URL 恢复 + 按日志恢复媒体（charge/waive）+ 批量查询（`analytics_api_logs.go:150-213`；`handler/admin_api_log_routes.go:52-150`） | 只有列表 + CSV（`billing-admin.controller.ts:87-109`） | 失败工单无法在后台直接取证/补交付，必须查库或手工脚本；已退款订单的“补交付并补扣”路径完全缺失（对应 `RestoreRefundedBillingOrder`）。 |
| B-9 | 轮询/下载日志合并进 create 根日志（`pollCount++`，状态与 usage 回填）（`admin_api_call_log.go:79-131`） | 每次 poll 新建一行（`task-executor.service.ts:279-317`） | 长视频任务日志行数膨胀（一次任务几十~上百行），后台“一次调用”失真；CSV 体积放大。 |
| B-10 | 调用日志写入的存储配额 + 任务 provider 状态回写（`admin_api_call_log.go:14-77`） | 日志失败只 warn；任务状态由 worker 单独维护（`task-executor.service.ts:318-320`） | 大请求/响应体可无限增长；日志与任务状态可能不一致（日志有请求 id、任务没有）。 |
| B-11 | 视频 Token 计费（Seedance 公式 + 10% 余量 + 公式快照可结算）（`video_token_billing.go`；`finance.go:540-575`） | `token && video` 直接 400“视频 Token 计费暂未开放”（`billing.service.ts:320-325`）；`video_formula` 分支不可达 | 任何“按输出 Token 计价”的视频线路无法接入；`videoFormulaTokens/usageSource` 成为死字段。 |
| B-12 | 文本任务（canvas_text）+ Token 计费 + 流式增量（`task_text_stream.go`；`task_creation.go:407-438`） | 能力注册表无 text（15 图 + 1 视频）；无 `text_replay/text_deltas` 端点 | 文本生成不可用；Token 结算在任务链路实际不可达（仅中转可能）。 |
| B-13 | 音频能力与按秒实测结算：`AudioOutputDurationMs` 探针，缺失即失败转人工（`task_media_assets.go:46-62`；`finance_billing.go:371-443`） | 无 audio 能力；`durationOf` 直接取请求参数（`task-worker.service.ts:1103-1107`），无 ffprobe | 若接入音频：结算用的是“请求秒数”而非实测，预授权=实收，多退少补失效；无时长则成功后转 uncertain。视频处理类按秒同样无法按实测。 |
| B-14 | 重试必须重新授权/计费并校验账单状态：`CheckRetryEligibility`（uncertain 拒绝）、`prepareLogicalTaskRetry`（重解析 revision/route）、`RetryTaskWithBilling`（新建账单+预留）（`task_lifecycle.go:33-106`） | `retryTask` 新建 `creditCost=0`、无账单任务，不做 uncertain/已提交上游检查、不重解析线路（`generate.service.ts:71-104`） | ①本次生成**免费**（收入损失）；②对“uncertain/可能已计费”的失败任务重试 → 上游二次计费风险；③模型/线路已变更时用旧快照执行。 |
| B-15 | 上游取消：`requestProviderCancellation` + 持久化对账（`task_lifecycle.go:176-208`；`ClaimNextTaskProviderCancellation`） | `cancel` 只改本地状态并退/冻结账单（`task-lifecycle.service.ts:173-202`） | 上游继续生成并计费；用户已取消但平台持续付费。 |
| B-16 | 取消来源/诊断字段（user/parent/worker，`CancellationSource/Actor/RequestedAt`）（`models_task.go:19-21`） | 无字段、无来源 | 事后无法回答“谁在什么时候取消的”，审计缺口。 |
| B-17 | 结果保存失败 → `uncertain`（绝不自动退款）（`task_terminal.go:195-221`） | 落盘重试 5 次后 `lifecycle.fail` → **退款**（`task-worker.service.ts:985-993`；`892-903` 大结果同样退款） | 上游已成功并计费，用户拿不到图但平台退款 → 双损；也可能出现“作品其实已生成、用户已退款”。 |
| B-18 | 媒体 checkpoint 幂等 + 确定性对象 key + 分段续跑 + 管理员恢复（`task_media_recovery.go`） | `persist` 每次新建对象与 Asset（`task-media.service.ts:194-217`），无管理员恢复入口 | 重试产生重复素材/孤儿文件；存储成本与后台数据质量下降；用户无法“重试保存”。 |
| B-19 | 对象存储本地兜底 + 补传任务 + 熔断（`task_media_fallback.go`） | 无 | 存储短暂故障即任务失败/退款，产物丢失。 |
| B-20 | 账号文件容量准入（扣费前）（`task_storage_admission.go`） | 无 | 容量满时仍调用上游并计费，最终落盘失败 → 资损/投诉。 |
| B-21 | 全局任务并发上限 `RuntimePolicy.Task.ActiveTaskLimit`（`task_creation.go:125-131`） | 仅会员 `maxConcurrent`（0=不限），无全站/全用户兜底（`membership.service.ts:158-174`） | 非会员或高套餐用户可无限并发，压垮 worker/上游。 |
| B-22 | 兑换码体系（批次/单码/禁用/明文回看/原子兑换）（`finance.go:165-275,416-448`；`finance_redeem.go`） | 完全没有（`grep redeem` 仅优惠券） | 无法线下发码/活动发码；只能走支付。 |
| B-23 | 运营分析总览 + CSV（KPI/DAU/WAU/MAU/模型/用户/失败/P95/排队数/总余额）（`analytics.go`；`analytics_build.go`；`handler/admin_analytics.go`） | 只有财务汇总一个接口 | 运营缺少容量/质量/用户维度观测，无法定位“哪个模型在掉成功率”。 |
| B-24 | `ModelPricing`（美元口径上游成本）CRUD（`analytics.go:190-243`） | 无；改用价格档 cost 快照（微积分） | ⚠️ 设计替代，非缺陷；但历史美元成本维度不可回溯。 |
| B-25 | 管理员媒体恢复（含已退款订单 `charge/waive`）（`task_media_recovery.go:412+`） | 无 | 需要人工补交付时只能手工改库。 |
| B-26 | 文本/画布 timeline 转写 + 渲染（`task_timeline.go`、`task_render.go`） | 无 | 产品范围外。若后续做短剧/字幕，需要重新移植。 |
| B-27 | 上游进度回写（`UpdateTaskProviderProgress`，单调不回退）（`repository_tasks.go:198-207`） | 轮询固定 `progress=50`（`task-worker.service.ts:792-807`） | 进度条不真实；用户等待体验差。 |
| B-28 | `HasVisibleFailedAPICallLogForTask` 兜底失败日志（preflight 失败也要在请求明细里可见）（`task_api_call_log.go:16-95`） | 无；派发前失败只写 RouteAttempt + 任务错误（`task-worker.service.ts:598-617`） | 后台请求明细缺“为什么没发出去”，排障成本高。 |
| B-29 | 账号/批次每日对账（本仓 schema 文档自称有）（`schema.prisma:407-409`） | 无对账任务（仅到期回收 `scheduler.service.ts:263`） | “available == Σ lots”只在 verify 脚本里被断言，线上漂移无人发现（与上游无关，属本仓设计承诺未兑现）。 |
| B-30 | 换线财务口径：上游换线**不产生退款**（同单差额调整，`logical_models.go:322-375`） | 换线“退旧单 + 建新单”，旧单 `refundedAmountMicrocredits=旧价`（`billing.service.ts:692-700`），而 `FinanceAnalyticsService` 的“已退=全部订单 refunded 之和、净收入=settled 实收−已退”（`finance-analytics.service.ts:9-13,154-155,180`） | 一次 9 分换 4 分的成功任务在财务页显示净收入 **−5**（实收 4 − 已退 9），净收入/退款率/毛利全部失真；`TaskLifecycleService.refundedCreditsOf` 也会把旧单退款计入通知金额（`task-lifecycle.service.ts:302-319`）。 |

---

### 表 C · 本仓有、上游无的功能点

| # | 功能点（证据） | 说明 / 价值 |
|---|---|---|
| C-1 | **任务幂等键**：`(ownerId, idempotencyKey)` 唯一 + `Idempotency-Key` 头一致性 + P2002 返回赢家任务（`task-admission.service.ts:82-90,239-247,472-484`；`schema.prisma:867`） | 上游 `Task` 无幂等键，重试/双击可能重复建单（仅靠 `CreationSubmissionID` 部分覆盖）。 |
| C-2 | **多图产出按张建子任务、按张计费**：`parentTaskId` + 每张独立账单 + 整批一个事务预留 + 父任务汇总通知/连坐取消（`task-admission.service.ts:193-308`；`task-lifecycle.service.ts:213-235,296-320`） | 上游一次任务一个结果；本仓“一次提交 N 张图”各自退款、各自结算。 |
| C-3 | **CreditLot / CreditReservationItem（FEFO + 到期 + 原路回填）**（`credit-wallet.service.ts:371-435`；`schema.prisma:411-433,1928-1936`） | 上游账户无批次、无过期；本仓支持积分有效期并按预留明细退款回原批次（`restoreToLots` 按 lotId 排序回填）。 |
| C-4 | **成本快照 + 毛利口径单一实现**（`cost-amount.ts`；`BillingOrder.cost*`）：未配置/未结算返回 null，不写 0 | 上游成本在 `ModelPricing` 美元表、按日志估算；本仓成本跟随价格档，账单级快照，换线同步。 |
| C-5 | **限时免费活动**：命中活动金额 0、账单 `promotionId` 留痕（`credit-price.service.ts:49-54`；`task-admission.service.ts:184-185,282`；`schema.prisma:1859`） | 上游无活动计费。 |
| C-6 | **会员并发 + 快速通道参数**：`__memberFastChannel` 写入任务参数（`task-admission.service.ts:204`；`membership.service.ts:158-185`） | 会员权益落地到路由层。 |
| C-7 | **中转账单清扫**：`reserved` 超 30min 原额退、`running` 超 60min 转 uncertain，只处理 `taskId=''`（`billing-sweeper.service.ts:79-134`） | 上游自动退款是全量队列；本仓把“代理路径”单独兜底，避免与任务恢复重复退款。 |
| C-8 | **财务分析多维聚合**：按日/模型/渠道/能力/场景 + `outstanding` 挂账 + `settleRate`（`finance-analytics.service.ts:100-209`） | 上游只有按模型/日维度的收入/成本；本仓维度更全。 |
| C-9 | **调用日志 CSV 导出 + 关联投影**（用户/任务状态/账单状态与金额）+ 概览（总数/成功/失败/平均耗时）（`billing-admin.service.ts:198-336`） | 上游 CSV 字段不同（含上游美元成本/币种/预授权），且无“概览”聚合。 |
| C-10 | **无账单存量任务退款回退旧积分服务**（`task-lifecycle.service.ts:272-284`） | 兼容迁移期任务。 |
| C-11 | **切线授权上限（更严）**：换线前 `draft.amount > authorizedLimit` 直接失败，并把上限写到替换账单（`task-worker.service.ts:507-544,562-573`） | 上游只在 Agent 订单（`ChargeLimitSet`）上限制；本仓对所有任务限制，防止“换线即重新授权”。副作用见 D-9。 |
| C-12 | **AIGC 标识 fail-closed**：可见角标合成失败 → 任务失败（`task-media.service.ts:154-191`；`task-worker.service.ts:880-888`） | 上游也有标识，但本仓把“失败即不交付”写进终态路径。 |
| C-13 | **进程内渠道并发槽 + 进程内线路冷却**（`channel-slot.service.ts`；`route-health.service.ts`） | 上游渠道槽为全局/Redis 协调；本仓单实例。 |
| C-14 | **自增 `routeRun` + `retriedFromId` 的新任务重试**（`generate.service.ts:79-99`） | 上游是原地重置同一任务（`RetryTaskWithBilling`）。本仓规避 `outputAssetId @unique` 冲突，但重试不收费（见 B-14）。 |

---

### 表 D · 状态机 / 失败语义对照

| 维度 | 上游（Go） | 本仓（TS） | 判定 |
|---|---|---|---|
| **准入** | 输入标准化 → 工具/工作流/自定义渠道 → 逻辑模型路由 → 能力/价格档校验 → 内嵌媒体拒绝 → `RuntimePolicy.ActiveTaskLimit` → **账号文件容量** → 建单+预留同事务；Agent 走 `MaxCharge/NonBillable` 分支（`task_creation.go:30-243`） | 幂等命中 → 能力参数 → 后台上下线 → 素材数量/归属 → 遮罩/标注 → 会员并发 → 模型/线路 → 计价 → 建任务 → 批量预留（`task-admission.service.ts:80-309`） | ⚠️ 产品化重构；**缺容量准入、全局额度、Agent 预算**；**建单/预留不同事务**（B-1） |
| **dispatchState** | 4 态：`not_sent → submission_unknown → accepted | rejected_no_job`；`begin` 用 CAS 抢 `not_sent`，失败即 uncertain；`rejected_no_job` 才允许换线（`model_router_attempts.go:95-110,459-514`） | 同 4 态，同 CAS；`submission_unknown`/非 accepted 一律 uncertain（`task-attempt.service.ts:107-144,177-194`） | ✅ 对齐 |
| **切线** | 仅 `rejected_no_job`（channel slot / 401 / 403 / 404 / 429）且非 Cancel/Deadline；换线在**同一张账单上做差额调整**（`SwitchTaskLogicalRoute`：delta 补/退预授权、改写单价/数量/金额/价格档、保留 chargeLimit；channel 策略才改写价格，unified 只更新成本快照，`logical_models.go:281-388`） | 同一安全集合；但 `upstream_rejected`（HTTP 200 但上游明确 failed）也被视为可切线（`task-executor.service.ts:362-374`）；**换账单**=先退旧单（独立事务）→ 再预留新单（独立事务），unified 也换单，任务上产生两张账单（`task-worker.service.ts:472-553`；`verify-task-runtime.ts:419-432` 断言“共 2 单”） | ⚠️/❌ **有意差异（本仓按“切线必须换账单”设计）但有三处副作用**：①200-failed 换线比上游激进（可能为两次上游付费）；②换单非原子，退款后崩溃会留下“已退款旧单 + 未建新单”的执行窗口；③旧单的 `refundedAmountMicrocredits` 会被财务页计入“已退”，导致换线任务的净收入被重复扣减（见 B-30） |
| **退款** | 未结算单按 `AmountMicrocredits` 原额退回；已结算拒绝自动退款；无批次概念（`finance_billing.go:651-702`） | 未结算单按 `amountMicrocredits` 退回；`CreditWalletService.refund` 同时回填预留批次；已结算抛 409（`billing.service.ts:676-702`；`credit-wallet.service.ts:298-330`） | ✅ + 本仓 FEFO 原路更强（C-3） |
| **uncertain** | 超时/524/连接重置/5xx/已有成功可计费调用 → 不退款、转 uncertain、保留冻结；结算失败也转 uncertain（`task_billing.go:114-140`；`task_terminal.go:162-167,288-295`） | 同一标记集合 + 同一判定（`billing.service.ts:118-131,761-773`）；dispatch/poll 非安全失败、租约 `submission_unknown`、结算异常 → uncertain（`task-lifecycle.service.ts:146-165`、`task-worker.service.ts:224,687-690,784-787`） | ✅ 对齐；仅“结果落盘失败”被本仓当普通失败退款（B-17） |
| **自动退款** | 系统开关 + 每分钟扫描 `uncertain / running>40min / reserved+任务failed|cancelled`，排除已出作品/保存失败；写 resolution note（`billing_auto_refund.go`） | **无任务账单自动退款**；仅中转单 `reserved>30min` 退款、`running>60min` 转 uncertain（`billing-sweeper.service.ts`） | ❌ 真实缺口 |
| **Token 计量** | 文本：输入(减缓存)+缓存+输出；视频：仅输出，`usage` 缺失可退公式快照；用量缺失 → 结算失败转人工；`chargeLimit` 截断（`finance_billing.go:196-364,704-730`） | 文本同公式；视频 token 被前置拒绝（死分支）；用量缺失 → 40909 转人工；`chargeLimit` 截断 + 留痕（`billing.service.ts:589-604,778-843`） | ⚠️ 文本/结算口径 ✅；**视频 Token ❌**（B-11） |
| **按秒计量** | 音频始终按**实测输出时长**；视频处理由调用方传实测时长；`quantity=ceil(ms/1000)`；超授权 → 人工核对；`cost_quantity` 同步（`finance_billing.go:371-443`；`task_media_assets.go:46-62`） | 传 `audioDurationMs` 才按秒重算，否则拒绝；但**任务链路传的是请求参数换算值**，不是实测（`task-worker.service.ts:1103-1107`）；不更新 `costQuantity` | ❌ 语义缺口（B-13） |
| **chargeLimit** | `set || limit>0` 生效；预留越限直接拒绝；Token 事后计量按上限截断；按秒超限拒绝；仅 Agent 订单设置（`billing_authorization.go`；`task_creation.go:190-201`） | 同生效/拒绝/截断/按秒拒绝（`billing.service.ts:101-115,596-622`）；**所有任务在换线时设置**上限=首单授权额（`task-worker.service.ts:507-544`） | ✅ 机制对齐；⚠️ 设置范围更宽（C-11） |
| **幂等** | 任务无幂等键；账单键 `task:<id>:<newID>` 每次唯一（`finance.go:568`）；代理 `proxy:<key>` 幂等（`:603`） | 任务 `(owner,key)` 唯一；账单 `task:<taskId>` / `task:<id>:runN:attemptN` 稳定幂等，P2002 复用（`billing.service.ts:378-415`） | ➕ 本仓更强 |
| **租约 / 恢复** | 45s 租约、15s 续租、续租失败 `cancel()` 停手、`submission_unknown` → uncertain、其余按 attempt 续跑；全局 worker 槽租约（`task_worker.go:140-170`；`repository_tasks.go:53-114`） | 45s/15s、进程内 active、`submission_unknown` → uncertain、其余清租约重跑（`task-worker.service.ts:206-241,313-320`）；**续租失败被忽略**，终态写入不校验 owner | ⚠️/❌ 机制对齐，**并发安全弱于上游**（B-3） |
| **结算并发** | 账户条件更新 `reserved >= ?`，失败即回滚；订单已 settled 幂等返回；refunded 拒绝（`finance_billing.go:268-504`） | 同（`billing.service.ts:566-670`；`credit-wallet.service.ts:257-271`），失败抛 40909 转人工 | ✅ 对齐 |

---

### 表 E · 接口差异

| 能力 | 上游 | 本仓 | 判定 |
|---|---|---|---|
| 钱包 | `GET /wallet`（账户+流水+`policy`）、`POST /wallet/redeem`、`POST /wallet/checkin`（`handler/finance.go:14-72`） | `GET /credits/balance|lots|ledger`（`credits.controller.ts`）；签到在 `marketing`；**无兑换** | ⚠️ 查询更细（批次），兑换 ❌ |
| 任务读 | `GET /tasks/:id`（用户公开投影） | `GET /tasks/:id`、`/tasks/page`、`GET /tasks`、`DELETE /tasks/:id` | ✅ |
| 任务控制 | `POST /tasks/:id/retry|cancel|recover-media|query-provider|text-replay-complete`、`GET /tasks/:id/logs`（`handler/routes.go:192-268`） | 用户侧无 retry/cancel；仅后台 `POST /admin/tasks/:id/retry|cancel`；无 recover/query/logs | ⚠️/❌ 用户自助能力缺失（B-14/15/18） |
| 文本流 | `POST/GET /tasks/:id/text-deltas`、`GET /tasks/:id/text-events` | 无 | ❌ |
| 账单后台 | `GET /admin/billing-orders`（支持 `status=review`）、`POST /admin/billing-orders/batch-resolve`、`POST /:id/resolve` | `GET /admin/billing-orders`、`GET /:id`、`POST /:id/resolve`；无 review 口径、无批量 | ❌ 部分（B-5/7） |
| 自动退款开关 | `GET/PATCH /admin/settings/billing-auto-refund` | 无 | ❌（B-4） |
| 调用日志 | `GET /admin/api-logs`、`GET /:id`、`GET /:id/media`、`POST /:id/query-task`、`/:id/recover-url`、`/:id/recover-media`、`POST /admin/api-logs/recover-batch`、`GET /admin/api-logs-export.csv`（支持 ids/recordType/keyword） | `GET /admin/api-logs`（status/requestKind/channelId/taskId/userId/model/billable/from/to/page）、`GET /admin/api-logs/export` | ❌ 部分（B-8） |
| 财务分析 | `GET /admin/analytics/overview|models|users|export.csv` + `/admin/model-pricings` CRUD | `GET /admin/analytics/finance?from&to` | ❌ 部分（B-23/24） |
| 兑换码 | `GET/POST /admin/redeem-batches`、`GET /:id/codes`、`POST /:id/disable`、`POST /:id/codes/:codeId/disable` | 无 | ❌（B-22） |
| 调账 | `POST /admin/users/:id/credits/adjust` | `POST /admin/credits/adjust`、`/batch-adjust`、`/import`、`GET /admin/credits[/export|/:userId/lots|ledger]` | ✅/➕ 本仓更全（批量/导入） |
| 渠道模型 | `GET/PATCH/POST/DELETE /admin/channels/:id/models/**`、`/admin/channel-models[/health]`（`handler/finance.go:229-433`） | `src/model/channels/**` 控制器（本仓另有 `/admin/channels` 体系） | ⚠️ 平移 |

---

### 重点核对项逐条结论

1. **建单与预留同事务** —— ❌ 未达成。账单与预留本身同事务（`billing.service.ts:392-403`），但任务建单在事务外（`task-admission.service.ts:229-247` 与 `276-292` 两个事务），仅靠 `deleteBatch` 与 `recoverUnbilledQueued` 补偿。
2. **切线必须换账单** —— ✅ 达成（本仓设计）。旧单退款 + 新单预留 + 任务 `billingOrderId/authorizedChargeMicrocredits/creditCost` 同步（`task-worker.service.ts:488-553`）；verify 脚本断言“旧单 refunded / 新单按新价 settled”（`scripts/verify-task-runtime.ts:419-432`）。与上游不同：Go 是在同一张账单上做差额调整（`logical_models.go:281-388`），本仓换单导致 ①换单非单事务、②unified 模型也无谓换单、③旧单退款额被财务页计入“已退”造成净收入失真（B-30）。
3. **5xx/超时判 uncertain 不切线** —— ✅ 达成。`safeFailure` 白名单不含 5xx/timeout（`task-executor.service.ts:362-374`），dispatch 非白名单 → `lifecycle.uncertain`（`task-worker.service.ts:677-691`），poll 任何失败 → uncertain（`:778-788`）。唯一偏差：HTTP 200 但上游 `status=failed` 被当“未建单”允许切线（`:147-151,177`），上游 Go 视为 `submission_unknown`。
4. **Token 用量缺失转人工** —— ✅ 达成（文本/中转）。`tokenSettlementUsage` 返回 null → 40909（`billing.service.ts:589-591`），`succeed` 捕获后 `markUncertain`（`task-lifecycle.service.ts:93-102`）。**视频 Token 根本不建单**，所以“视频缺 usage 退公式快照”在本仓不可达。
5. **钱包恒等式** `available == Σ lot.remaining` —— ✅ 结构上成立（账户与批次在同一事务内成对增减，`credit-wallet.service.ts:192-232,240-295,298-330,333-355`；verify 脚本每步断言 `scripts/verify-billing.ts:100-117`）。⚠️ 两个运营性隐患：①过期未回收的批次会让可用余额“看得见但扣不动”（`takeFromLots` 过滤 `expireAt>now`，`credit-wallet.service.ts:377-386`），扣减失败报 50001 而非余额不足；②schema 文档承诺的每日对账任务不存在（表 B-29）。
6. **FEFO 退款原路** —— ✅ 达成。预留写 `CreditReservationItem`（`:400-404`），退款/结算差额按明细回填原批次且保留原到期时间（`:419-435`）；verify 断言“退款按预留明细原路回填”（`scripts/verify-credit-deduction.ts:457`）。
7. **chargeLimit** —— ✅ 机制完成（预留越限拒绝、Token 截断、按秒超限转人工、替换账单写上限）。⚠️ 本仓把上限扩大到所有任务（C-11），且换线时把 `authorizedChargeMicrocredits` 覆写为新单预留额（`task-worker.service.ts:540`），第二次换线的上限会被第一次换线“收紧”。

---

### 文档 / 注释与实现漂移（易误导后续维护）

| 位置 | 写的 | 实际 |
|---|---|---|
| `task-admission.service.ts:13-15` | “计价先于预留，预留先于建任务” | 实现是“先建任务，后批量预留”（`:226` 与 `:269` 注释自认） |
| `task-admission.service.ts:4-5` | “任何一条在扣费之前失败都不能留下账单” | 建单-预留间隙会留下“无账单任务”，靠 worker 补偿 |
| `schema.prisma:770-773` | 子任务 `creditCost=0`、无账单、只有首张计费 | `admission` 为每张子任务建独立账单并写各自 `creditCost`（`task-admission.service.ts:250-299`） |
| `schema.prisma:407-409` | “由每日对账任务校验相等” | 仓库内无账户/批次对账任务 |
| `billing.service.ts:8-14` | 规则 1 “建单与预留同一事务” | 仅对本方法内的账单成立，不含任务建单 |
| `billing.service.ts:11-12` | “视频回退到提交时公式快照” | 视频 Token 在 `withAmount` 已拒绝，`video_formula` 不可达 |
| `task-lifecycle.service.ts:9-15` | “任务状态与账单状态必须同时落定” | 任务 CAS 与账单更新不在同一事务（`succeed` 先改任务再 settle；settle 失败只转 uncertain） |
| `task-worker.service.ts:16-22` | “切线要换账单 / 落盘失败不重发” | 落盘重试用尽后仍会退款失败（B-17），与“不重发”一致但收尾语义不同 |
| `task-worker.service.ts:508-519` | “参考实现（open-ai-canvas）在原账单上做差额调整……这里按同一口径” | 实际实现是 “退款旧单 + 建立新单”，与所述上游口径相反，且带来 B-30 的财务口径问题 |

---

### 纯测试文件一句话汇总

上游在本域约有 30 个 `app/*task*_test.go` / `*billing*_test.go` / `analytics*_test.go` 与 33 个 `repository/*_test.go`，覆盖状态机、并发、Token/按秒、成本、分析聚合；本仓 `src/model/tasks/**`、`src/model/billing/**`、`src/credits/**` **没有任何 `.spec.ts`**，同域验证完全依赖 4 个脚本（`scripts/verify-billing.ts` 445 行、`verify-task-runtime.ts` 645 行、`verify-credit-deduction.ts` 680 行、`verify-credit-price.ts` 233 行），覆盖了核心资金路径，但**未覆盖**后台账单/日志/分析、兑换码、自动退款、媒体恢复、管理员补交付与并发租约。

---

### 最重要的 5 条差异

1. **建单与预留不再同事务**：本仓先建任务、再在另一个事务里批量预留（失败靠删任务 + 60s 补挂/10min 判死），上游是单事务原子完成，进程崩溃窗口会留下“排队但无账单”的任务。
2. **切线换单使财务口径失真**：上游在同一账单上做差额调整，本仓“退旧单 + 建新单”，旧单的 `refundedAmountMicrocredits` 被财务页计入“已退”，一次 9 分换 4 分的成功任务净收入显示为 −5（退款率、毛利同步失真）。
3. **任务账单缺少运维兜底**：没有自动退款开关、没有 `review` 待核对队列、没有巡检、没有批量核对、没有“已退款订单补交付并补扣”，冻结积分只能人工逐单处理。
4. **媒体产物链路更脆**：落盘重试不幂等（每次新建对象/素材）、无实测音视频时长（按秒结算用的是请求秒数）、无本地兜底/补传、无管理员恢复，且重试用尽后直接退款而不是转 uncertain——上游成功却退款。
5. **重试与取消语义弱于上游**：后台重试新建 `creditCost=0` 的免费任务、不检查 uncertain/是否已提交上游、不重解析线路；取消不请求上游；加上 `markRunning` 失败被忽略、终态写入不校验租约 owner，存在白付上游、重复计费与旧执行者覆盖新结果的风险。


## 5. 代理中转 / 出站安全 / 数据模型逐文件对照

- 上游（Go）：`/Users/bright/github/open-ai-canvas/backend`（包路径实际为 `internal/...`，下文的 `handler/`、`outbound/` 均指 `internal/` 下）
- 本仓（NestJS/Prisma）：`/Users/bright/github/aigc-creation/backend`
- 方式：只读逐文件核对；结论均可落到函数、字段或配置项。
- 口径：`✅对齐` / `🔀合并或重构` / `⚠️有意差异` / `❌未移植` / `➕仅本仓有`。
- 「有意差异」按任务约定指：单实例无 Redis、Go→TS、GORM→Prisma、ID 格式、无 MySQL 迁移体系、品牌/路径版本前缀等；其余列为「真实缺口」。

---

### 表 A · 逐文件功能对照

| 上游文件 | 本仓对应 | 状态 | 具体功能差异与证据 |
|---|---|---|---|
| `handler/system_proxy_stream.go` | `src/model/proxy/proxy.http.ts`（`isEventStream`/`beginEventStream`/`copyUpstreamStream`） | ✅对齐 | 上游 `copySystemProxyResponseHeaders` 只复制 `Content-Type/Cache-Control/Content-Disposition` 并加 `nosniff`（system_proxy_stream.go:21-28），本仓 `copyProxyResponseHeaders` 同样是三头白名单 + `nosniff`（proxy.http.ts:111-120）。上游 SSE 写 `no-cache, no-store, no-transform`、`X-Accel-Buffering: no`、先 `WriteHeaderNow`+`Flush`（:30-37），本仓 `beginEventStream` 等价（proxy.http.ts:133-140）；上游按 `responseLimit` 捕获并返回“超限”错误（:39-68），本仓 `copyUpstreamStream` 超限销毁源并返回 `exceeded`（proxy.http.ts:148-181）。**唯一差异**：本仓没有“总请求超时”，见 `infra/outbound.ts` 行（表 E-T7）。 |
| `handler/custom_proxy.go` | `src/model/proxy/custom-relay.controller.ts` + `custom-relay.service.ts` + `proxy.http.ts` | 🔀重构，含 2 个真实缺口 | 上游路由 `ANY /ai/custom` 先 `RequireFeature(FeatureCustomChannels)` 再限流（custom_proxy.go:23-36）；本仓仅 `JwtAuthGuard` + `@RateLimit`（custom-relay.controller.ts:48-63），**功能开关缺失**。上游用 `Authorization: Bearer` 承载用户上游密钥（:71-75,252-259），本仓改用 `X-Canvas-Upstream-Key`（proxy.constants.ts:22），属有意（本系统 JWT 占用 Authorization）。上游附加头名为 `X-Canvas-Upstream-Headers`（outbound.go:28），本仓为 `X-Canvas-Headers`（proxy.constants.ts:24），**对旧 SDK 不兼容**。上游错误正文会走 `InterceptResponseText`（:182-185），本仓无响应拦截（见下）。其余：体积上限、GET 禁 body、并发槽、二进制/JSON/SSE 分流、密钥回显脱敏均对齐（custom-relay.service.ts:125-164,189-267；proxy.http.ts:275-309）。 |
| `handler/security.go` | `src/model/proxy/proxy.paths.ts` | 🔀重构，含 1 个真实缺口 | `normalizeProxyPath`、`stripSecretQuery`、`authorizeCustomRelay`、`authorizeSystemProxy` 均已移植（proxy.paths.ts:151-167,341-348,361-453,260-316）。**缺口**：上游 `authorizeCustomRelay` 第一步就 `normalizedCustomRelayPath(target.EscapedPath())`（security.go:47-50,127-140），本仓调用方直接传 `target.pathname`（custom-relay.service.ts:99-105），没有解码/`\`+NUL 检查/2048 上限/`path.Clean` 不变形判定——本仓的 `normalizeProxyPath` 只被系统入口使用。另：系统入口端点判定上游是**精确匹配** `openAIPostEndpoints[requestPath]`（security.go:224-226），本仓用 `path===endpoint || path.endsWith(endpoint)`（proxy.paths.ts:312），更宽松（允许 `/任意/chat/completions`）。 |
| `handler/routes.go`（任务路由文件；代理/模型注册实际在 `api.go`、`auth.go`、`cmd/server/main.go`） | `src/model/proxy/proxy.module.ts`、`system-proxy.controller.ts`、`app.module.ts`、`main.ts` | ⚠️有意差异 | 上游 `/api` 无版本段：显式入口 `RegisterSystemProxyRoutes` 注册 `r.Any("/ai/system/:channelId/*path")`（auth.go:264-278），短路径 `/api/{channelId}/{providerPath}` 放在 `NoRoute`（auth.go:280-301, cmd/server/main.go:130），保留前缀清单在 `isReservedAPIPathPrefix`（auth.go:325-332）。本仓全局前缀 `api/v1`（main.ts:139），短路径是**真实注册**的 catch-all `@All(':channelId/*path')`（system-proxy.controller.ts:71），靠 `ProxyModule` 最后导入（app.module.ts:88-93）+ 模块内控制器顺序（proxy.module.ts:32）保证业务路由优先。保留前缀清单已按本仓控制器重写（proxy.paths.ts:17-51），覆盖本仓全部顶级控制器；`isProxyRequestPath` 让中转路径跳过全局 100KB body-parser（main.ts:58-101）。风险：新增业务顶级路由若忘记加保留前缀，会被短路径 catch-all 接走；上游 `NoRoute` 不会抢已有路由。 |
| `handler/response_interception.go`（+ `app/response_interception.go`） | 无 | ❌未移植 | 上游提供 `GET/PATCH /admin/settings/response-interception`（response_interception.go:11-45）、规则校验/持久化/审计（app/response_interception.go:36-173），并在自定义中转错误正文上生效（custom_proxy.go:182-185）。本仓全仓 grep `InterceptResponseText|response-interception` 无结果，**管理端配置与运行时替换都不存在**。影响：后台无法统一屏蔽/改写上游原始报错，自定义中转会把上游文案原样透给用户。 |
| `outbound/outbound.go` | `src/model/infra/outbound.ts` | 🔀重构，含 4 个真实缺口 | 已对齐：http/https 限定、禁 URL 凭据（outbound.go:54-69 ↔ outbound.ts:93-109）；自定义地址 4096 上限/禁 fragment/HTTP 仅可信主机（:73-98 ↔ :112-139）；代理仅 socks5/socks5h/http/https（:102-122 ↔ :142-161）；5 次重定向且每跳复验（:124-160 ↔ :389-408，但本仓多放 1 跳，见 E-T8）；自定义不重定向（:168-176 ↔ :399-402）；32 头/16KB/保留头（:188-306 ↔ :257-326）；私网/回环/链路本地/组播判定与 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` 语义（:415-507 ↔ :164-194,74-86）。**缺口**：①无 `HTTP(S)_PROXY` 环境代理与 `configuredProxyHost` 直连例外（:308-341,387-403）；②自定义渠道 IPv6 保留网段 `100::/64`、`2001:db8::/32` 未拦（:40-51,472-487 ↔ outbound.ts:235-244）；③`request.setTimeout` 只是 socket 空闲超时，不是上游 `http.Client.Timeout` 的总时限（outbound.ts:450-457 ↔ outbound.go:124-136）；④`agent:false` 无连接复用、无 H2（outbound.ts:427）。 |
| `outbound/errors.go` | `src/model/infra/outbound.ts` `OutboundError` | ✅对齐 | 上游用稳定 `BadRequestError` 类型区分“出站校验失败”（errors.go:3-18）；本仓 `OutboundError.code`（invalid_url/blocked_host/dns_failed/proxy_invalid/timeout/network）承担同一职责，并在 `system-proxy.service.ts:503-513` 映射为 403/502 与日志原因。 |
| `app/channel_outbound.go` | `proxy-channel.service.ts` + `channel-runtime.service.ts` + `infra/outbound.ts` | ✅对齐 | 上游两个薄封装：所有渠道 URL 走出站策略、渠道代理客户端（channel_outbound.go:9-19）。本仓系统中转先 `validateOutboundUrl`（system-proxy.service.ts:138-147），任务侧由 `outboundRequest` 内部复验（outbound.ts:389-392），代理从 `ModelChannel.proxyUrl` 读取并透传（proxy-channel.service.ts:75, system-proxy.service.ts:323）。本仓把“渠道装配”拆成中转/任务两套（有意，见 proxy-channel.service.ts:1-11 注释）。 |
| `app/provider_http_client.go`（仅出站/超时/代理） | `src/model/protocol/executor.ts` + `tasks/task-worker.service.ts` + `infra/outbound.ts` | 🔀合并或重构 | 上游在统一 `doBinaryWithConsumer` 里做熔断检查、渠道槽、SSRF、超时、响应上限、状态码与审计（provider_http_client.go:242-368），响应上限取运行策略 `policy.Resource.GeneratedFileMB`（:266-272）。本仓把这些拆开：任务 worker 先查路由健康/拿渠道槽（task-worker.service.ts:619,729），再由 `ProtocolExecutor.send` 走 `outboundRequest`，响应上限是常量 64MB（executor.ts:20,296-299），没有上游那种“出站函数内读运行策略 + 熔断前置”的单一收口。属重构，但运行期可调上限与前置熔断能力弱于上游。 |
| `kernel/error_codes.go` | `src/common/app.exception.ts` + `src/model/proxy/*` 字面量错误码 | ⚠️有意差异 | 上游 code 默认等于 HTTP 状态，需要细分时用 `status*100+n`、`42901` 限流（error_codes.go:5-24）；本仓全站是 5 位业务码（`AppError(code,message,status)`，app.exception.ts:3-9），中转发 `40001/40301/40401/42901/50201/50303`（system-proxy.service.ts:91-98,145,169,343）。语义等价、协议不兼容，属本仓 API 约定。 |
| `model/models_channel.go`（凭证字段） | `prisma/schema.prisma` `ModelChannel/ChannelModel/ApiCallLog` | 🔀重构 | 凭证字段 `apiKey`/`secretKey`/`headersJson` 均在（schema.prisma:1507-1524）；上游只加密 `APIKey/SecretKey`（admin_channels.go:252-275），本仓额外把 `headersJson` 加密（channel.service.ts:689-716），更强。上游保留历史列 `PublicAlias`（models_channel.go:15-16），本仓无。上游 `ApiCallLog` 无 `ChannelModelID`，本仓新增并建索引（schema.prisma:1948-1950）；上游有 `CreatedAtEpoch`（SQLite 性能列），本仓无。详见 D 表。 |
| `database/schema.go`（模型域） | `prisma/schema.prisma` | ⚠️有意差异（GORM→Prisma），含索引/唯一键缺口 | 表集合基本一致：ModelChannel/ChannelModel/ChannelModelPriceTier/LogicalModel(+Revision/Route/RouteAttempt)/UserGroup(+Channel)/BillingOrder/CreditAccount/CreditLedgerEntry/ApiCallLog 均有（schema.go:35-62 ↔ schema.prisma:1495-2017）。差异集中在索引、唯一约束与历史列，见 D 表。 |
| `database/migrations.go` + `schema.go` 的数据迁移函数（模型域） | `prisma db push`（package.json:23-25），无 migrations 目录 | ⚠️有意差异 + 真实升级缺口 | 上游有版本账本、迁移锁与显式数据回填：`migrateChannelCreditCost`（migrations.go:432-456）、`migrateChannelModelProtocolLength`（:389-395）、`migrateSchemaV56` 回填 `api_call_logs.created_at_epoch`（:766-779）、`migrateChannelModelPriceTierSelectors`/`backfillChannelModelPriceTiers`/`migrateLogicalRoutesToChannelModels`（schema.go:156-171,239-333）。本仓以 `prisma db push` 同步最终结构，**没有等价的数据回填/重放保护**；携带旧数据的库升级时，价格档 selector、逻辑线路外键、成本列等不会自动补齐。 |
| 密钥加密：`app/settings.go`（`encryptSettingSecret`/`decryptSettingSecret`/`settingsEncryptionKey`）+ `app/admin_channels.go` + `app/auth_bridge.go` | `src/model/infra/secret-cipher.ts` + `channels/channel.service.ts` + `channels/channel-runtime.service.ts` | 🔀重构 | 算法一致：AES-256-GCM、`enc:v1:` 前缀、nonce||ciphertext||tag、无前缀视为历史明文（settings.go:361-413 ↔ secret-cipher.ts:35-63）。差异：上游 base64 RawStd（settings.go:382），本仓 base64url 无填充（secret-cipher.ts:44），能解上游密文、上游不能解本仓密文（跨语言不互通但本仓自洽）。密钥来源：上游固定 `<dataDir>/.settings-key` 且用 `os.Link` 原子发布 + 等待并发写入（settings.go:415-469）；本仓优先 `MODEL_SECRET_KEY`，否则写 `<uploads>/../data/.model-secret-key`（secret-cipher.ts:78-110），**并发首启没有原子发布/等待**：两个进程同时首启可能各生成一把钥匙并各自缓存，导致对方写的凭证解不开。 |
| 微积分算术：`app/credit_policy.go:168-184`、`app/user_groups.go:347-383`、`kernel/token_billing.go:19-40`、`repository/finance_billing.go:506-516,704-737` | `src/model/infra/microcredits.ts` | ✅对齐（含少量增强） | `creditAmount = ceil(unit×qty×bps/10000)`（credit_policy.go:168-184 ↔ microcredits.ts:78-90）；`tokenAmount = ceil(Σtokens×price×bps/1e10)`（token_billing.go:19-40 ↔ :109-123）；货币换算 `ceil(price×rate/1e6)`（user_groups.go:347-362 ↔ :144-151）；倍率连乘逐级 ceil、下限 1、上限 1<<40（user_groups.go:365-383 ↔ :126-136）。结算口径也一致：输入 token 先减缓存再分别计价（finance_billing.go:704-737 ↔ billing.service.ts:831-841）。本仓额外提供 `toSafeNumber/formatCredits/parseCredits`（microcredits.ts:57-62,154-175）。唯一差异：上游对 int64 溢出显式报错，本仓用 BigInt 计算后再由 Prisma BigInt 落库兜底（microcredits.ts:56-62），错误信息更晚。 |

---

### 表 B · 上游有、本仓无（逐条，含影响）

| # | 功能点（上游证据） | 本仓现状 | 影响 |
|---|---|---|---|
| B1 | 自定义渠道功能开关 `FeatureCustomChannels`：`/ai/custom` 与 `/ai/models` 都先 `RequireFeature`（custom_proxy.go:30-33, channel_models.go:20-23） | 无任何 feature gate（custom-relay.controller.ts:48-63 只有 JWT+限流） | **真实缺口/产品风控**：所有登录用户始终可用自定义中转，无法按套餐/环境关闭；上游可关。 |
| B2 | 响应拦截管理：GET/PATCH 设置 + 规则（response_interception.go:11-45, app/response_interception.go:36-173），自定义中转错误正文替换（custom_proxy.go:182-185） | 无 | **真实缺口**：后台无法屏蔽上游原始报错/统一文案；错误页会直接出现上游域名、模型名、内部提示。 |
| B3 | Token 计费流式 Chat Completions 自动注入 `stream_options.include_usage=true`（app/text_stream_usage.go:8-37，调用点 auth.go:394-400） | 无该函数，也不改请求体（system-proxy.service.ts:318 原样发送） | **真实缺口/计费**：OpenAI 兼容流式文本默认不返回最终 usage，Token 结算会 `上游用量不可用` 失败 → 系统中转把账单转 `uncertain`（billing.service.ts:589-591, system-proxy.service.ts:417-433），需人工处理。 |
| B4 | 标准出站代理：`HTTP_PROXY/HTTPS_PROXY/NO_PROXY`（outbound.go:336-341），且代理主机本身跳过 DNS 私网拦截（:387-403） | 只支持渠道级 `proxyUrl`（outbound.ts:347-360）；忽略环境代理 | **真实缺口/部署**：需要统一 egress proxy 的部署无法出网；也无法让代理主机绕过 SSRF 私网判定。 |
| B5 | 自定义中转路径先解码再判定，且限制 2048 字节（security.go:47-50,127-140） | 直接把 `URL.pathname` 交给授权（custom-relay.service.ts:99-105） | **真实缺口（安全语义）**：不满足“先规范化再判定”；百分号编码的合法端点会被误拒（fail-closed），且缺少显式长度/反斜杠/NUL 检查。 |
| B6 | 自定义渠道 IPv6 保留网段拦截 `100::/64`、`2001:db8::/32`（outbound.go:40-51,472-487） | 仅 `::`、`::1`、`fc00::/7`、`fe80::/10`、`ff00::/8`、IPv4-mapped（outbound.ts:235-244） | **真实缺口/SSRF**：自定义中转可访问这两个保留/文档网段（若环境路由可达）。 |
| B7 | 总请求超时（`http.Client.Timeout`，含读完 body）+ 15s 连接/TLS 超时（outbound.go:124-136,308-333） | `request.setTimeout` 是 socket 空闲超时；连接阶段无独立超时（outbound.ts:450-457） | **真实缺口/资源**：上游慢速滴流可无限占用渠道槽与预授权积分；DNS/连接挂起也不受 10min 限制。 |
| B8 | HTTP 代理对 `http://` 目标用 absolute-form；仅 https 走 CONNECT（Go Transport 默认，outbound.go:377-379） | 对所有 http/https 目标都先 CONNECT（outbound.ts:435-440,486-515） | 真实差异：部分只允许 absolute-form 的 HTTP 代理不可用；功能可用性缺口。 |
| B9 | 连接池与 HTTP/2：`MaxIdleConns*`、`IdleConnTimeout`、`ForceAttemptHTTP2`（outbound.go:327-333,356-363） | `agent:false` 每请求新建连接，无 keep-alive/H2（outbound.ts:427） | 性能/上游兼容差异：高并发下握手成本高；强制 h2 的上游可能失败。 |
| B10 | 自定义中转并发槽带 TTL 租约（custom_proxy.go:38-39；`AcquireCustomRelaySlot` 见 platform/coordination.go:459） | 进程内 `Map`，无 TTL（custom-relay-slot.service.ts:19-44） | 属“单实例无 Redis”的有意差异；但**进程异常/泄漏时槽位不自动过期**，只能重启恢复。上游 TTL=超时+1min。 |
| B11 | 限流/并发/超时/请求响应 MB 来自**运行期策略**（`RuntimeRequestPolicy`，custom_proxy.go:34-39, auth.go:345,431；provider_http_client.go:266-272） | 全部来自启动期 `MODEL_PROXY_*` 环境变量（env.validation.ts:245-255；proxy.config.ts:15-33） | 有意差异（本仓单实例/环境配置），但运营无法后台热调上限，改配置必须重启。 |
| B12 | 代理调用日志区分 `request_kind=create/poll/download`（auth.go:553-563） | 全部固定 `requestKind='proxy'`（proxy-call-log.service.ts:83） | 真实差异/可观测性：后台“按请求类型”统计会把轮询、下载都算成 proxy，无法复现上游的 create/poll/download 口径。 |
| B13 | 自定义中转可直接复用旧客户端：密钥走 `Authorization: Bearer`（custom_proxy.go:71-75），附加头名 `X-Canvas-Upstream-Headers`（outbound.go:28） | 密钥必须走 `X-Canvas-Upstream-Key`，附加头名 `X-Canvas-Headers`（proxy.constants.ts:22-24） | 有意安全差异（Authorization 被本系统 JWT 占用），但**对上游既有第三方 SDK 是破坏性协议变更**，需要调用方改代码。 |
| B14 | 自定义中转所有响应（含错误）先写 `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`（custom_proxy.go:135-137） | `writeProxyError` 只写 no-store，不写 nosniff（proxy.http.ts:97-108） | 低危安全差异：中转自身错误响应缺少 `nosniff`；上游响应正常路径有 nosniff。 |
| B15 | 渠道加密密钥原子发布/并发首启等待（app/settings.go:415-469） | `writeFileSync` 覆盖式创建，无原子 link/等待（secret-cipher.ts:93-110） | **真实缺口/可用性**：多进程同时首启可能生成不同密钥，先写者加密的凭证在另一进程解不开（表现为渠道全部鉴权失败）。 |

---

### 表 C · 本仓有、上游无

| # | 本仓功能点（证据） | 说明 / 价值 |
|---|---|---|
| C1 | 渠道 `headersJson` 也做 AES-GCM 加密（channel.service.ts:689-716；channel-runtime.service.ts:111-119；proxy-channel.service.ts:142-150） | 上游 `HeadersJSON` 明文入库（models_channel.go:29）。本仓避免自定义头里的鉴权值明文落库。 |
| C2 | `MODEL_SECRET_KEY` 显式密钥 + 开发文件密钥兜底（secret-cipher.ts:78-110；env.validation 由 model.secretKey 注入） | 上游只能用 `<dataDir>/.settings-key`。生产可注入 KMS/Secret，且启动期告警（model.module.ts:79-81）。 |
| C3 | 全局中转开关 `MODEL_PROXY_ENABLED`（env.validation.ts:247；system-proxy.service.ts:90-93；custom-relay.service.ts:77-80） | 上游未见总开关，只能靠渠道/功能开关。便于应急停服。 |
| C4 | 中转路径跳过全局 body-parser 的显式判定 `isProxyRequestPath`（proxy.paths.ts:230-242；main.ts:58-101） | 上游 Gin 本身无 100KB 默认解析限制，本仓必须显式绕过；与保留前缀共用清单，避免“解析器认为是业务、路由认为是中转”。 |
| C5 | 系统中转渠道槽与任务派发共享同一个 `ChannelSlotService`（proxy.module.ts:10-14；system-proxy.service.ts:151-171） | 上游也共享 `AcquireChannelSlot`，但本仓把它做成可注入服务并导出（model-task.module.ts:59-61）。实现不同，目标一致。 |
| C6 | 中转账单幂等键统一加 `proxy:` 前缀（proxy-billing.service.ts:81） | 与任务账单隔离，避免用户传入的幂等键与任务键空间碰撞（上游未见前缀约定）。 |
| C7 | `ApiCallLog.channelModelId` 列与索引，用于线路级健康统计（schema.prisma:1948-1950,2010） | 上游 `ApiCallLog` 无该列（models_channel.go:107-162）。 |
| C8 | 微积分工具 `toSafeNumber`/`formatCredits`/`parseCredits`/`MicrocreditError`（microcredits.ts:33-62,154-175） | 上游对应逻辑分散在 handler/app；本仓统一 API 出参防 `MAX_SAFE_INTEGER` 静默失真。 |
| C9 | 自定义中转允许图片二进制（`allowsBinaryResponse` 含 `image/`，proxy.http.ts:251-260），但仅限 video content/audio speech 路径（custom-relay.service.ts:299-301） | 上游只允许 `video/*`、`audio/*`、`octet-stream`（custom_proxy.go:151）。实际图片路径不会被 `allowsBinary` 命中，属边缘增强。 |
| C10 | `parseShortProxyPath` 纯函数与 `ShortProxyPath` 类型（proxy.paths.ts:190-212） | 生产控制器未使用（只有 verify 脚本用），属测试/文档辅助；若后续改用 NoRoute 风格可复用。 |
| C11 | 系统渠道模型解析同时匹配 `modelKey`（activeKey）与 `providerModelKey`（proxy-channel.service.ts:81-104） | 上游 `channelAllowsModel` 只读渠道 `ModelsJSON` 名单（security.go:270-280）；本仓更适配“上游名≠展示名”。属增强。 |

---

### 表 D · 数据模型差异（只列差异）

> 上游为 GORM `AutoMigrate`，本仓为 Prisma `db push`（SQLite）；下列“索引差异”只影响查询性能/约束强度，不改变列语义。

| 域 | 上游表/字段/索引 | Prisma 表/字段/索引 | 差异与影响 |
|---|---|---|---|
| 渠道 | `model_channels`：`public_alias`（历史列，models_channel.go:15-16）；索引 `user_id`、`scope`、`enabled`、`catalog_provider_id`、`deleted_at`（:10-34） | `ModelChannel`（schema.prisma:1495-1537）：无 `publicAlias`；`@@index([scope,enabled])`、`[deletedAt]`、`[catalogProviderId]`、`[sortOrder]` | 无 `user_id` 索引（本仓以系统渠道为主，`userId` 默认空）；`scope/enabled` 合成索引可覆盖前缀 `scope`，但 `enabled` 单独过滤不如上游；`publicAlias` 为上游历史兼容列，未移植属有意。 |
| 渠道模型 | `channel_models`：唯一索引 `(channel_id, model_key) WHERE deleted_at IS NULL`（models_channel.go:44-45）；单列索引 `capability`、`protocol`、`price_configured`、`enabled`、`deleted_at`（:53-76） | `ChannelModel`（schema.prisma:1541-1591）：`activeKey` 代替 `modelKey` 做唯一键；`@@unique([channelId,activeKey])`、`@@index([channelId,enabled])`、`@@index([capability,protocol])`、`@@index([deletedAt])` | 唯一语义等价（SQLite NULL 不参与唯一）。缺 `priceConfigured`、`enabled` 单列索引；`capability+protocol` 合成索引可覆盖 `capability` 前缀。`activeKey` 是本仓新增的软删复用机制（上游靠 partial index）。 |
| 价格档 | `channel_model_price_tiers`：唯一 `(channel_model_id, selector_key) WHERE deleted_at IS NULL`（models_channel.go:87-88）；索引 `channel_model_id`、`price_configured`、`enabled`、`deleted_at`（:87-104）；成本列 `cost_*` + `cost_billing_mode/cost_quantity/cost_video_formula_tokens`（credit_cost.go:14-19） | `ChannelModelPriceTier`（schema.prisma:1596-1635）：唯一 `(channelModelId, activeKey)`；索引 `[channelModelId,enabled]`、`[deletedAt]`；成本列同名（`costConfigured/costUnitPriceMicrocredits/...`） | 唯一语义等价；缺 `priceConfigured` 单列索引。成本列齐全，账单成本快照口径一致。 |
| 前台模型 | `logical_models`：唯一 partial `(code) WHERE archived_at IS NULL`（models_logical_model.go:15）；`source_channel_model_id` 索引 + 启动期唯一索引 `idx_logical_model_source_active WHERE source_channel_model_id <> '' AND archived_at IS NULL`（database/schema.go:185-187）；无 `deletedAt`（只有 archivedAt） | `LogicalModel`（schema.prisma:1639-1680）：`@@unique([activeKey])`；`@@index([sourceChannelModelId])`；`archivedAt` + `updatedAt`，无 `deletedAt` | **约束缺口**：上游 DB 强制“一个渠道模型最多一个未归档前台模型”，本仓只有应用层校验（schema.prisma:1678-1679 注释），并发保存可能产生重复投影。 |
| 分组 | `user_groups`：`code` 全局唯一（models_user_group.go:28），无软删字段 | `UserGroup`（schema.prisma:1753-1784）：`activeKey` 唯一 + `deletedAt` | 有意差异：本仓允许删除后复用 code；上游不允许（历史 code 永久占用）。 |
| 账单 | `billing_orders`：索引 `user_id`、`task_id`、`channel_id`、`channel_model_id`、`price_tier_id`、`model`、`capability`、`scene`、`status`、`provider_request_id`、`created_at`、`resolved_by`（models_finance.go:35-91）；`promotion_id` | `BillingOrder`（schema.prisma:1798-1880）：唯一 `(userId,idempotencyKey)`；索引 `[userId,status]`、`taskId`、`channelId`、`channelModelId`、`[status,createdAt]`、`model`、`capability`、`scene` | **索引缺口**：`priceTierId`、`providerRequestId`、`resolvedBy` 无索引；上游单列 `userId` 由本仓 `[userId,status]` 前缀覆盖。金额/成本/用量列齐全（BigInt 对应 int64）。 |
| 积分账户/流水 | `credit_accounts`（models_finance.go:5-12）；`credit_ledger_entries` 有 `redeem_code_id/payment_order_id/actor_user_id/model/channel/scene`，索引 `user+created`、`user+type`、`billing_order_id`、`payment_order_id`、`redeem_code_id`、`actor_user_id`、`model`、`channel_id`、`scene`（:14-33） | `CreditAccount`（schema.prisma:1883-1891）；`CreditLedgerEntry`（:1894-1925）有 `lotId/paymentOrderId/taskId/actorUserId/model/channelId/scene`，索引仅 `[userId,createdAt]`、`[userId,type]`、`[billingOrderId]`；另新增 `CreditLot`、`CreditReservationItem`（:411-487,1928-1936） | 本仓是“批次（lot）+ 预留明细”模型，上游是单账户模型——**架构重构**（有意）。差异：缺 `paymentOrderId/lotId/taskId/actorUserId/model/channelId/scene` 索引；上游 `redeem_code_id` 在本仓无对应列（兑换批次走 CreditLot）。 |
| 调用日志 | `api_call_logs`：`created_at_epoch`（SQLite 索引，models_channel.go:161）；索引 `trace_id`、`request_id`、`task_id`、`billing_order_id`、`source`、`capability`、`model+created`、`status+created`、`kind+status+created`、`error_code`、`billable`、`providerRequestId`（:107-162） | `ApiCallLog`（schema.prisma:1940-2017）：无 `createdAtEpoch`；索引 `[userId,createdAt]`、`[channelId,createdAt]`、`[channelModelId,createdAt]`、`[model,createdAt]`、`taskId`、`[status,createdAt]`、`[createdAt]`、`[requestKind,status,createdAt]` | **索引缺口**：`traceId`、`requestId`、`billingOrderId`、`errorCode`、`billable`、`source`、`capability`、`providerRequestId` 无索引；本仓多出 `channelModelId` 索引（C7）。上游的 `created_at_epoch` 是 SQLite 排序优化，本仓直接用 `createdAt`（可接受但大数据量分页更慢）。 |
| 上游独有表 | `model_pricing`（美元口径上游成本，models_finance.go:123-137，`ApiCallLog.EstimatedCostMicros` 由它 enrich）；`id_sequence`（可读前缀 ID）；`logical_model_price_skus`（已定义未纳入 `Models()`，models_logical_model.go:84-105） | 无对应 | `model_pricing` 是上游历史成本估算表；本仓成本来自价格档 `cost*` 快照，`ApiCallLog.estimatedCost*` 三列保留但恒 0（schema.prisma:1979-1995 注释），属有意替代。`id_sequence` 被 `cuid()` 取代（ID 格式差异）。`logical_model_price_skus` 上游本身未启用，不算缺口。 |
| 本仓独有表 | 无 `route_catalog_version`、`credit_lots`、`credit_reservation_items` 等（本仓 schema.prisma:411-487,1928-1936,2041-2047） | — | 目录版本、批次积分、支付对账等由本仓自建；不属于代理/出站安全缺口，但会影响“从上游数据库直接迁移”的可行性。 |
| 迁移体系 | 版本账本 + 锁 + 逐版本数据回填（database/migrations.go:766-800+；schema.go:156-171） | `prisma db push`，无 migrations 目录 | 有意差异（无 MySQL 迁移体系）。真实风险：旧库升级没有等价回填脚本（价格档 selector、逻辑线路外键、`created_at_epoch`、成本列），只能重建/手工修数。 |

---

### 表 E · 安全语义对照

| # | 语义 | 上游 | 本仓 | 判定 |
|---|---|---|---|---|
| E1 | SSRF（系统渠道） | 请求前 `ValidateOutboundURL` 解析全部 IP，任一 loopback/私网/链路本地/组播/未指定即拒绝；dial 时再用已解析 IP（outbound.go:415-470,308-334） | `validateOutboundUrl` 同样解析并逐 IP 判定；`guardedLookup` 在 connect 前再过滤（outbound.ts:93-109,164-194,464-483） | ✅对齐；本仓 dial 层是“过滤非法地址后连合法地址”，上游是“预检已拒绝混合结果”，在 DNS rebinding 窗口内本仓更宽松但不至于连内网。 |
| E2 | SSRF（自定义中转） | 更严：禁 fragment、禁 URL 凭据、HTTP 仅 `AllowedPrivateUpstreamHost`；额外保留网段 IPv4 8 段 + IPv6 `100::/64`、`2001:db8::/32`；禁重定向（outbound.go:73-98,40-51,168-176,420-435） | 同样禁 fragment/凭据/HTTP；IPv4 8 段齐全；**IPv6 少 2 段**；禁重定向（outbound.ts:112-139,49-58,399-402） | ⚠️基本对齐，B6 为真实缺口。 |
| E3 | 路径先规范化再判定 | 系统/自定义都先 `PathUnescape` + `path.Clean` 不变形 + 禁 `\`/NUL；自定义另有 2048 上限（security.go:47-50,127-140,258-268） | 系统入口 `normalizeProxyPath` 完整（proxy.paths.ts:151-167，system-proxy.service.ts:111-117）；**自定义入口未调用**，直接用 `target.pathname`（custom-relay.service.ts:99-105） | ❌自定义侧未满足；系统侧 ✅。 |
| E4 | 路径白名单 | 系统：`openAIPostEndpoints` **精确匹配** + 接口类型二次收窄；自定义：按格式/方法/Content-Type/后缀白名单，查询参数严格限制（security.go:171-256,47-125） | 系统：协议规则 + `path===endpoint \|\| endsWith(endpoint)`（proxy.paths.ts:260-316，**宽松**）；自定义：与上游逐条对齐（:361-453） | ⚠️自定义对齐；系统端点判定比上游宽松，可能放行 `/任意/chat/completions` 类路径。 |
| E5 | 短路径让出保留前缀 | 短路径在 `NoRoute`，业务路由不存在才尝试；再用 `isReservedAPIPathPrefix` 拒绝业务顶级段（auth.go:280-332） | 真实 catch-all 路由，先按本仓控制器清单拒绝保留前缀（proxy.paths.ts:17-51,201-217；system-proxy.controller.ts:83-87）；`ProxyModule` 最后导入（app.module.ts:88-93） | ✅语义对齐（清单已本地化）；⚠️依赖“新增业务前缀必须登记”，否则会被 catch-all 接走。 |
| E6 | 密钥剥离 | 系统：删除 `key/api_key/access_token/token` 后转发其余查询（auth.go:402-409）；自定义：查询串出现这些键直接拒绝（security.go:56-61）；日志 `SanitizeAPICallPayload` | 系统：`stripSecretQuery` 大小写不敏感（比上游更严，proxy.paths.ts:341-348；system-proxy.service.ts:129-132）；自定义：同样拒绝（proxy.paths.ts:371-375）；日志 `sanitizeCallPayload`（proxy.payload.ts:33-51,131-174） | ✅对齐（本仓系统侧更严）。 |
| E7 | 并发槽 | 渠道槽 `AcquireChannelSlot` 与任务共享、带 TTL；自定义槽 `AcquireCustomRelaySlot` 带 TTL（custom_proxy.go:38-39；auth.go:420-429） | 渠道槽 `ChannelSlotService` 与任务共享、带等待/退避但**无 TTL**（channel-slot.service.ts:53-80）；自定义槽进程内 `Map` 无 TTL（custom-relay-slot.service.ts:28-44） | ⚠️单实例有意；真实风险：泄漏槽位不自动回收（B10），且多实例不协调。 |
| E8 | 限流 | 运行期策略按用户每分钟（system/custom），超限 429 + `Retry-After`（security.go:142-160） | `@RateLimit(scope:'user')` 固定窗口，默认系统 120/min、自定义 60/min、目录 30/min，env 可覆盖；42901 + `Retry-After`/`X-RateLimit-*`（system-proxy.controller.ts:28-46；custom-relay.controller.ts:30-34,58-63；rate-limit.guard.ts:119-150） | ✅语义对齐；差异是配置来源（B11）与固定窗口 vs 上游协调器实现。 |
| E9 | 体积上限 | 系统请求尺寸 `SystemRelayRequestMB`、响应 `SystemRelayResponseMB`；自定义同理；错误正文 64KB（auth.go:353,485；custom_proxy.go:81-96,19） | 请求/响应 MB 由 `MODEL_PROXY_*`（默认系统 32/64MB、自定义 32/64MB，env.validation.ts:248-252）；错误正文 64KB（custom-relay.service.ts:46,239-267）；自定义头 32 项/16KB（outbound.ts:41-43,257-296） | ✅数值对齐；⚠️运行期不可调（B11）。 |
| E10 | 超时上限 | 系统 35min、自定义 `CustomRelayTimeoutMinutes`（auth.go:471；custom_proxy.go:125），且 `http.Client.Timeout` 是总时限 | 系统/自定义默认 10min，但只是 socket 空闲超时（env.validation.ts:250,253；outbound.ts:450-457） | ❌真实缺口（B7）：慢滴流不会触发超时。 |
| E11 | 流式透传 | SSE：正确 Content-Type、no-buffer、逐块 Flush、按上限截断并返回错误；自定义流实时密钥脱敏（system_proxy_stream.go:30-70；custom_proxy.go:143-149,211-239,268-308） | 同样 SSE 头/Flush/上限；`RelayStreamRedactor` 保留跨块密钥前缀（proxy.http.ts:133-181,275-309；custom-relay.service.ts:204-209） | ✅对齐。差异：本仓 `copyRedactedStream` 在超限时先 flush 尾部再 destroy（proxy.http.ts:200-208），上游直接中断；对用户可见数据量略有差异，不影响安全。 |
| E12 | GET 不计费 | `Billable: method == POST`；只有 POST 调 `ReserveProxyBillingWithBody`（auth.go:430-444,572） | 只有 POST 调 `billing.reserve`；`billable` 仅 POST（system-proxy.service.ts:174-206；proxy-call-log.service.ts:84） | ✅对齐。本仓验证脚本也断言 GET 不建账单（verify-proxy-runtime.ts:792-799）。 |
| E13 | POST 预留/结算 | `ReserveProxyBillingWithBody` → `MarkBillingRunning` → 成功且日志已落库才 `SettleBilling`；日志失败/结算失败 → `uncertain`；524 → `uncertain`；其余非 2xx → 退款（auth.go:430-444,514-525,533-551） | `reserve` 内 `reserveTaskBilling` + `markRunning`（proxy-billing.service.ts:69-90）；`settleBilling` 同分支：成功需 `logged`，524 uncertain，其它 refund，异常 uncertain（system-proxy.service.ts:409-434） | ✅对齐。 |
| E14 | 5xx/524 语义 | 非 2xx 记为 failed；524 不退款转人工；读流失败不退款转人工；SSE 已发头后直接断流（auth.go:482-525） | `success` 仅 2xx 且无读错误；524 uncertain；读错误 uncertain；SSE 已发头不再写错误体（system-proxy.service.ts:347-407） | ✅对齐。 |
| E15 | 密钥不能落日志 | 请求/响应过 `SanitizeAPICallPayload`，自定义错误/流脱敏（auth.go:584-590；custom_proxy.go:170-193,211-239） | `sanitizeCallPayload` 脱敏字段/URL/base64/内嵌媒体（proxy.payload.ts:33-51,131-174）；自定义 JSON/错误/SSE 三种路径脱敏（custom-relay.service.ts:234-255；proxy.http.ts:275-309） | ✅对齐，且本仓对流式跨块密钥处理有专门实现。 |
| E16 | 响应头白名单 | 只复制 `Content-Type/Cache-Control/Content-Disposition`，不转发 `Set-Cookie`（system_proxy_stream.go:21-28；自定义同样白名单） | `copyProxyResponseHeaders` 三头白名单（proxy.http.ts:111-120）；自定义 `writeProxyResponse` 只写指定头（:73-89） | ✅对齐。 |

---

### 纯测试文件一句话汇总

上游针对本域有 `outbound/outbound_test.go`、`outbound/dns_test.go`、`handler/custom_proxy_test.go`、`handler/security_test.go`、`handler/system_proxy_path_test.go`、`handler/system_proxy_stream_test.go` 六组单测（覆盖 SSRF 保留网段、自定义中转鉴权/流式/超限、系统路径授权、SSE 逐块 flush/上限）；本仓 `src/**/*.spec.ts` 仅 5 个且无一涉及 proxy/infra，代理域全部依赖 `scripts/verify-proxy-runtime.ts`（1344 行集成校验：SSRF、密钥剥离、GET/POST 计费、SSE 脱敏、524、并发槽），**没有可独立运行的单元测试**。

---

### 结论速览（供主代理汇总）

1. **必须补**：Token 计费流式 Chat 请求未注入 `stream_options.include_usage`，会导致 OpenRouter/OpenAI 兼容流式文本结算失败转 `uncertain`。
2. **必须补**：自定义中转未做路径规范化（直接用 `URL.pathname`），且 IPv6 保留网段 `100::/64`、`2001:db8::/32` 未拦截。
3. **必须补**：`FeatureCustomChannels` 功能开关与响应拦截（管理设置 + 自定义中转错误文案替换）完全未移植。
4. **必须补**：出站只有 socket 空闲超时、没有总超时/连接超时；慢滴流会长期占用渠道槽和预授权积分。
5. **结构性差异**：运行期策略（限流/并发/超时/体积）被固化为环境变量；渠道并发槽无 TTL、密钥文件无原子发布；旧库升级没有等价数据回填。


## 6. 后台前端 / C 端选型逐文件对照

审计范围：上游 `open-ai-canvas/web/src` 对照本仓 `aigc-creation/frontend/src`。只读分析，未修改任何仓库文件。

本仓渠道页入口先读 `frontend/src/pages/admin/channels/index.ts`（仅导出 `AdminChannelsPage`），实际编排在 `channels/page.tsx`，因此下文把上游单文件 `channels-page.tsx` 对照到本仓 `page.tsx` + `ChannelListPanel` + `ChannelDetailPanel` + `ChannelFormDrawer` 的组合。

状态口径：✅对齐 / 🔀合并或重构 / ⚠️有意差异 / ❌未移植 / ➕仅本仓有。

---

### 结论摘要

1. 渠道主从工作台整体移植完整，且本仓在审计原因、删除原因、健康面板、连通性测试、未定价队列上更强；主要缺口在「模型编辑器的结构化能力/价格档」和「分享链接状态」。
2. 本仓模型价格档用自由文本 `selector` + 原始 JSON `capabilityConfig`，上游是结构化生成方式/分辨率/帧率/图片参数匹配与可视化能力合同编辑器；本仓还禁止视频 Token 计费，属于真实功能缺口。
3. 前台模型（logical models）本仓允许选停用/跨能力线路、重复线路、启用但无线路，且不校验/重置能力合同；上游有来源能力合并、`capabilitySourceError`、启用前必须至少一条线路等硬校验。
4. 调用记录详情缺请求/响应报文、按 id 深链、上游任务查询、视频转存、媒体恢复与计费拆解；账单处置缺批量结算/退款和自动退回开关（本地 API 也未封装）。
5. C 端 `ModelPicker` 缺按当前输入的能力兼容过滤、每档价格/可用性健康、两级分组与键盘导航；默认模型按 `sortOrder` 而不是「可用且最便宜」。

---

### 表A 逐文件对照

| 上游文件 | 本仓对应 | 状态 | 具体功能/交互差异与证据 |
|---|---|---|---|
| `pages/admin/channels/channels-page.tsx` | `pages/admin/channels/page.tsx` + `ChannelListPanel.tsx` + `ChannelDetailPanel.tsx` + `ChannelFormDrawer.tsx` | 🔀 重构 | 主从布局、搜索/状态筛选、创建/复制/导出/导入/启停/删除均具备。差异：① 上游筛选、选中渠道、视图全在 URL（`filter/status/channel/view`，channels-page:54-57、81-95），本仓只同步 `view` 与详情 `id`（page.tsx:101-105、120），搜索词/状态切换后分享链接会丢；② 上游 `selectChannelWorkspace` 在未选中时回退到第一个可见渠道（channel-workspace-state.ts:11），本仓 `rows.find(id) ?? null`（page.tsx:148），进入页面右侧为空；③ 上游「新增渠道」先开服务商目录向导（channels-page:369、568-581），本仓直接开手填抽屉（page.tsx:168-173）——向导属任务约定的有意不移植；④ 上游删除/停用是无原因 Popconfirm（channels-page:322-336），本仓删除强制原因并列出影响（page.tsx:263-283、524-539，DeleteReasonConfirm.tsx:45-64），停用也有影响清单（page.tsx:497-522）；⑤ 本仓渠道表单多「排序值」「变更原因」字段（ChannelFormDrawer.tsx:63-71、166-174），上游无；⑥ 上游写后调用 `syncChannels` 刷新引用与 C 端配置（channels-page:127-135），本仓只 `reload()`，无客户端目录同步动作。 |
| `pages/admin/channels/all-channel-models-panel.tsx` | `pages/admin/channels/AllChannelModelsPanel.tsx` | 🔀 重构 | 跨渠道表、按显示名/模型键/渠道排序、健康单元格、成本售价摘要、启停确认、渠道跳转均具备。差异：① 本仓状态筛选多「未定价」并在状态列显示（AllChannelModelsPanel.tsx:177-185、319-328、constants.ts:89-97），上游只有 all/enabled/disabled/unhealthy；② 本仓「编辑」跳回渠道视图并打开该模型（page.tsx:140-146、AllChannelModelsPanel.tsx:338-348），上游在同一视图内嵌 `ChannelModelEditor`（all-channel-models-panel.tsx:291-305）；③ 本仓 URL 参数为 `keyword/capability/status/channel`，上游为 `q/capability/modelStatus/modelChannel`；④ 本仓分页固定 50（constants.ts:100），上游有 pageSize 选择（all-channel-models-panel.tsx:57、278-289）；⑤ 上游模型列有 `ModelIcon`（all-channel-models-panel.tsx:170-172），本仓只显示 emoji 图标；⑥ 上游能力为空显示「待配置」，本仓直接回退原始值。 |
| `pages/admin/channels/channel-workspace-state.ts` | `channels/hooks.ts` 的 `useChannelFilters` + `page.tsx` 选中逻辑 | 🔀 合并 | 关键字同时匹配名称/Base URL，两边一致；核心差异是「未选中回退首条」缺失（见上）。本仓另有 `useAdminDetailParam` 深链 `?id=`，上游用 `?channel=`。 |
| `pages/admin/channels/provider-catalog-pricing.ts` | 无对应；本仓仅有 `lib/channelCost.ts` 的展示函数 | ❌ 有意不移植 | 上游 `applyMarkup`/`validMarkup`/`tierPriceLines`/`promotionExpiry`（provider-catalog-pricing.ts:4-66）用于向导中「成本 × 加价率」实时预览与推广期展示；本仓无该套逻辑。影响：渠道只能手工建，无法从服务商目录带价导入。 |
| `pages/admin/channels/provider-catalog-wizard.tsx` | 无对应；`ChannelFormDrawer.tsx` 手填，`AdminPluginsPage` 只有插件包目录 | ❌ 有意不移植 | 上游三步向导（选服务商→填 Key/校验→选模型与统一/单独加价→一键接入，wizard:20-27、80-148、362-459）本仓完全没有。按任务约定「服务商目录向导不做」记为有意差异，但它是上游「新增渠道」默认入口，本仓动线退化为手工填 Base URL/Key/逐个建模型。 |
| `pages/admin/components/channel-model-editor.tsx` | `channels/ChannelModelForm.tsx` + `ChannelModelFormDialog.tsx` | 🔀 重构 | 本仓是单页长表单弹窗，上游是 1120px 三 Tab（基本信息/能力与参数/积分定价，editor:258-483）。缺失：① 结构化 `ModelCapabilityEditor` 引用与参数编辑（editor:376-415），本仓只有原始 JSON 文本框（ChannelModelForm.tsx:330-341）；② `ModelIconPicker`（editor:317-319），本仓图标是自由文本（:151-157）；③ 展示名 `AutoComplete` 复用已有分组（editor:54、291-302），本仓自由文本；④ 协议浏览器与详情（editor:348-350），本仓普通下拉 `label（id）`（useChannelModels.ts:88-91）；⑤ 上游测试用**当前未保存表单值**（editor:169-193），本仓新建必须先保存（ChannelModelManager.tsx:404-410）且测试用库内配置；⑥ 上游关闭前确认未保存（editor:77-84），本仓 `ChannelModelFormDialog` 直接 `onClose`，无脏检查（ChannelModelFormDialog.tsx:43-47）；⑦ 上游按字段校验自动切 Tab/滚动（editor:109-124），本仓无。 |
| `pages/admin/components/channel-model-editor-form.ts` | `channels/utils.ts` + `ChannelModelManager.submit` + `constants.ts` | 🔀 重构 | 上游切换能力会重置协议、能力合同、图片参数/工作流并按来源能力合并（editor-form:86-167），本仓切换能力只把 `protocol` 置空（ChannelModelForm.tsx:113-119），旧价格档 selector 与 `capabilityConfig` 原样保留；上游复制模型清空 `modelKey/providerModelKey` 并保留价格（editor-form:74-83），本仓自动加 `-copy` 后缀、设为停用并清空档位级上游键（ChannelModelManager.tsx:162-185）。本仓 `providerModelKey` 提交时回退到 `modelKey`，但 `displayName`/`channelLabel` 不做兜底（ChannelModelManager.tsx:225-241），上游分别兜底「未分类」和上游键（editor:140-141），列表中会出现空展示名/空渠道展示名。 |
| `pages/admin/components/channel-model-manager.tsx` | `channels/ChannelModelManager.tsx` + `ChannelModelTable.tsx` + `ChannelUpstreamDialog.tsx` | 🔀 重构 | 清单、本地筛选、批量选择、调价、批量删除、排序、拉取上游、复制/编辑/启停均具备。差异：① 本仓每行多「连通性测试」并保留测试结果面板（ChannelModelTable.tsx:239-248、473-509；Manager:278-296），上游只有编辑器内测试；② 本仓批量删除/单删都强制原因（Manager:335-389、471-502），上游无原因（manager:202-227、282-284）；③ 本仓模型清单状态筛选是 enabled/disabled/unpriced（constants.ts:80-84），上游是 enabled/disabled/unhealthy（manager:417-430）；④ 本仓分页固定 20（constants.ts:86），上游可选 pageSize（manager:470-479）；⑤ 上游协议列显示协议名+create 路径与独立「版本」列（manager:250-266），本仓协议只显示原始 id、版本并入模型单元格（ChannelModelTable.tsx:151-153、193-198）；⑥ 本仓表格不显示 `channelLabel`（ChannelModelTable.tsx:155-161），上游显示「渠道展示名」（manager:242），无法在列表核对 C 端二级名称；⑦ 上游选择上限 100 并提示（manager:455-462），本仓无上限；且本仓 `load()` 后不裁剪已失效的 `selectedIds`（ChannelModelManager.tsx 只在切换渠道时清空 :99-111），删除单条后旧勾选仍可能计数。 |
| `pages/admin/components/channel-model-price-tier-fields.tsx` | `channels/ChannelModelForm.tsx` 价格档区 | ⚠️ 有意简化/部分缺失 | 上游每档有 default/advanced 两种匹配模式、生成方式、分辨率、帧率档、图片参数/画质/尺寸、命中后上游模型 ID（fields:96-163），并按协议决定 Token 能否计费（fields:179、fields:49）。本仓是「规格条件（key=value 逗号分隔）+ 分辨率 + 视频秒数 + 8 个价格框」（ChannelModelForm.tsx:209-274），没有字段级校验/取值约束，拼错 key 会保存成永不命中的档位。本仓「可供用户使用」被拆成档位启用、价格已确认、记录成本价三个开关（:192-196、275-288），上游单开关同时写 `priceConfigured`+`enabled`（fields:70-82），更不容易出现「启用但未确认价格」。上游档位级过期上游提示内联并一键清除（fields:221-240），本仓是表单底部全局提示+清除（ChannelModelForm.tsx:343-360），意图对齐。 |
| `pages/admin/components/channel-model-price-tier-form.ts` | `channels/utils.ts` 的 `tierToDraft`/`buildPriceTiers`/`parseSelector` + `lib/channelReprice.ts` | 🔀 重构 | 上游把表单值映射为 selector/分辨率/视频秒数/成本对象，默认档不带上游键（tier-form:112-125、167-188）；本仓 `parseSelector` 拆 `key=value`（utils:355-370），`buildPriceTiers` 提交 `costPricing: null` 或完整对象（utils:278-286），价格档上游键回退到模型上游键（utils:270）。本仓校验比上游弱：只做「至少一个启用档、最多一个通配档、按秒仅视频/音频、Token 仅文本」（utils:199-226），上游还校验协议是否支持 Token、能力与生成方式匹配、高级档至少一个条件、金额上限 1,000,000（editor-form:175-210）。本仓因此**无法配置视频 Token 计费**（`mode === 'token'` 且 capability !== 'text' 直接报错，utils:218），与上游支持视频 Token（price-tier-fields:179、185-187）形成真实能力缺口。 |
| `pages/admin/components/channel-model-pricing.ts` | `lib/channelReprice.ts` + `lib/channelCost.ts` | 🔀 重构 | 两边都用 BigInt/精确取整、0–1000%、0–6 位小数、最多 100 个模型、成本/售价缺失阻断。本仓把「加价率预览」和「调价提交」集中在 channelReprice.ts:60-105、198-260，且要求原因；上游 pricing.ts:26-57、82-122 同样按成本重算但无原因。本仓对金额上限 1,000,000 积分有校验（channelReprice:32、118-122），上游 token 售价上限 1,000,000 积分（pricing:115），大体一致。 |
| `pages/admin/components/channel-model-reprice-dialog.tsx` | `channels/ChannelModelRepriceDialog.tsx` | ✅ 对齐（本仓更严） | 加价率/小数位/重算/逐项手改/已修改计数/按模型分组/成本与加价展示一致。本仓额外要求「变更原因」并在缺失时禁用保存（:110、174-177、242-256），上游只提交价格（reprice:48、77）。本仓保存按钮还要求 `changed > 0`，上游同样禁用（reprice:77）。本仓按模型分组展示规格，上游按 Table 一行一模型再嵌套规格（reprice:150-225），信息等价。 |
| `pages/admin/components/channel-model-tags-editor.tsx` | `channels/ChannelModelTagsEditor.tsx` | ✅ 对齐 | 结构化文字+颜色、最多 5 个、每个 1–12 字、文字去重、展示预览均一致（上游 7-34；本仓 19-105）。本仓在提交前再次 `validateModelTags`（ChannelModelManager.tsx:220-224），上游用 Form 校验。 |
| `pages/admin/components/channel-model-cost-summary.tsx` | `channels/ChannelModelHealthCell.tsx` 的 `ChannelModelCostSummary` | 🔀 重构 | 都只列启用档、最多 3 条、其余折叠、成本→售价、加价率。本仓额外处理 `priceCurrency` 非积分时标注「积分 → USD/CNY」且不推算加价率（HealthCell:159-180）；上游用 `priceCurrencyUnit` 直接拼单位（cost-summary:29-41）。本仓空态是灰色「无已启用规格」，上游是 warning 徽章（cost-summary:9）。 |
| `pages/admin/components/channel-model-health.tsx` | `channels/ChannelModelHealthCell.tsx` + `useChannelModels.ts` + `hooks.ts` | 🔀 重构 | 都展示 24h 成功率+最近 10 次色块，tooltip 含 7d/P95/最近错误。差异：① 上游 7 天无调用才显示「近 7 天无调用」，24h 无调用显示「24h 无调用」（health:55、84），本仓只要 `windows.day.samples === 0` 就显示「无调用」（HealthCell:53-59），即使 7 天有样本也看不到；② 本仓 `formatRate` 修正了上游 99.5% 显示成 100% 的问题（utils:419-429），属有意改进；③ 本仓页面上另有完整健康表（ChannelModelHealthPanel.tsx:41-166），上游只在各单元格/渠道徽章展示；④ 本仓同页两套阈值不一致：健康表 `<50% 危险/<90% 警告`（Panel:22-28），单元格 `≥95% 成功/≥80% 警告`（utils:412-416），同一模型在两处颜色可能不同。 |
| `pages/admin/components/channel-model-import-selection.ts` | `channels/ChannelUpstreamDialog.tsx` | 🔀 重构 | 关键字收窄、全选/取消当前可见、已存在计数、不重复导入均具备。关键差异：上游**默认勾选已存在的模型、新模型不勾选**（import-selection:22-26、manager:506），本仓默认勾选本地还不存在的新模型并显示「已存在」徽章（ChannelUpstreamDialog.tsx:40-45、150-152）；本仓更符合「导入新模型」语义，属有意改进。本仓搜索同时匹配 id 与 displayName（:47-52），上游只匹配 id（import-selection:5-9）。 |
| `pages/admin/components/channel-order-dialog.tsx` | `channels/ChannelOrderDialog.tsx` | ✅ 对齐 | 拖拽、上下移、输入目标位置、未变更禁用、保存带 `expectedIds` CAS 全一致（上游 9-170；本仓 84-152）。本仓把弹窗做成受控 `open`，渠道页/模型页各有一个入口；上游是自带按钮的组件（order:74-76）。两边都不允许在筛选子集排序，说明文案一致。 |
| `pages/admin/components/api-log-detail-drawer.tsx` | `pages/admin/AdminModelCallsPage.tsx` 详情 Drawer | ❌ 关键能力未移植 | 上游详情按 id 拉取（drawer:19-45），含请求概览、任务/媒体状态、计费预授权/实收/状态、请求/响应原始报文与复制（:171-183、264-307）、供应商任务查询、视频 URL 转存、媒体重新保存及补扣/免扣选择（:194-262）。本仓详情只读当前页行（:154、485-489），字段只有状态/类型/渠道/模型/耗时/用量/任务/账单 id 等（:455-483）；**无请求/响应报文、无按 id 深链、无上游任务查询/视频转存/媒体恢复、无预授权/实收拆解**（`ApiLogView` 已有 `billingReservedMicrocredits`/`billingSettledMicrocredits`/`billingStatus` 却未展示，types/model.ts:717-721）。列表筛选也只暴露 create/poll/task（:371-380），上游有 download/upload/local_save/local_fallback/offload/register/repair 等阶段标签（drawer:324-326、logs-page:478-479）。 |
| `pages/admin/components/analytics-finance.ts` | `pages/admin/AdminFinancePage.tsx` + `AdminDashboardPage` 财务区 | 🔀 重构 | 本仓有独立财务页：实收/已退/净收入/挂账/订单数/成本、日趋势、按模型/渠道/能力/场景拆解（FinancePage:190-238）。上游只有分析面板中的 KPI 与模型表财务列（analytics-finance:17-21）。差异：本仓 `FinanceBreakdownRow` 只有订单数/实收/已退/净收入，**没有按模型的成本、利润、利润率**（types/model.ts:820-829）；上游模型表每个模型都有收入/成本/利润/利润率（analytics-finance:17-21）。本仓总额有成本/毛利，但无法定位「哪个模型在亏」。 |
| `pages/admin/components/billing-auto-refund-toggle.tsx` | 无对应，`lib/api.ts` 也无接口 | ❌ 未移植 | 上游有「冻结积分自动退回」开关、二次确认与分钟级自动退回说明（toggle:12-84），接口 `/admin/settings/billing-auto-refund`（wallet.ts:276-280）。本仓全仓 grep 无 `autoRefund/自动退回` 设置，账单页只能人工逐单处理。 |
| `pages/admin/logical-models/logical-models-page.tsx` | `pages/admin/AdminLogicalModelsPage.tsx` | 🔀 重构（含多处缺口） | 列表、创建/编辑、归档、模拟、线路优先级/权重/启停均具备。差异：① 上游线路候选**按当前能力过滤并禁用停用渠道/模型**（logical:119、579-594、614-616），本仓 `channelModelOptions` 取全部渠道模型且只把停用写进 label、不 disabled（AdminLogicalModelsPage:198-205、787-793）；② 上游禁止重复选择同一渠道模型（:601-616），本仓可重复添加；③ 上游启用前强制至少一条线路并校验能力来源（:173-184），本仓只提示「没有线路会 42204」，仍可保存启用（:779-782，提交 :311-323 未拦截空线路）；④ 上游切换能力会清空线路/能力合同/默认参数（:481-485），本仓不改（:657-685）；⑤ 上游用结构化 `CapabilityScopeEditor`/`DefaultOptionsEditor`（:455-470），本仓是原始 JSON 文本域（:745-765）；⑥ 上游强制 `pricePolicy: channel` 并清零四个价格（:681-694、723-742），本仓提供「统一价/跟随渠道」并允许四个价格输入（:50-53、687-743），形成第二套价格源；⑦ 模拟：上游用 `CapabilityRequestEditor` 传 operation+inputs+options 并展示 productMatch 与候选池/冷却/低优先级原因（:512-542、749-767），本仓只有 operation+options JSON、无 inputs（:855-866），结果表有价格档与 eligible/reasons（:884-913），缺能力匹配结论。⑧ 本仓编码创建后禁用（:622），上游可提交修改；⑨ 本仓多「显示已归档」与 revision 列（:550-557、496-500），上游无。 |
| `pages/admin/logical-models/model-routing-capabilities.tsx` | 无对应文件，仅原始 JSON | ❌ 未移植 | 上游 818 行实现能力范围编辑器、默认参数编辑器、请求模拟编辑器、能力摘要、从渠道模型推导能力合同、来源合并与覆盖校验（capability:86-260、280-537）。本仓 `AdminLogicalModelsPage` 只用两个 `TextAreaField` 承接 JSON（:745-765），无字段约束、无来源合并、无覆盖提示。直接后果：能力合同写错也能保存，线路匹配失败只能到线上暴露。 |
| `pages/admin/plugins/plugins-page.tsx` | `pages/admin/AdminPluginsPage.tsx` | 🔀 重构 | 插件清单、启停、上传安装、卸载、内置不可卸载、启动状态均具备。本仓更强：契约校验、插件详情抽屉（Provider/配置项/界面位置/权限/最近校验）、当前环境可用性原因、协议生效数、服务商插件目录安装/校验/刷新、操作原因审计（AdminPluginsPage:96-207、585-708）。缺口：① 上游按 application/protocol/payment/uploaded 分类过滤、按可用性过滤、搜索、分页（plugins:39-73、269-324），本仓无任何筛选/搜索/分页（页面仅表格 :523-545）；② 上游有「作用范围：用户自主启用/全局生效」和已启用用户数（:174-193），本仓 `PluginView` 无 `kind/activationScope/enabledUserCount` 字段（types/model.ts:549-595），无法管理用户级应用插件；③ 上游合并前端插件注册表（含官方应用插件，:369-386），本仓只展示后端插件清单；④ 上游上传有独立文档弹窗（:326），本仓是隐藏 file input + 确认框（:464-489）。 |
| `pages/admin/user-groups/user-groups-page.tsx` | `pages/admin/AdminUserGroupsPage.tsx` | 🔀 重构 | 分组列表、倍率/汇率/可见渠道/模型覆盖/用户数/默认分组均具备。差异：① 上游删除在 `isDefault` 或 `userCount > 0` 时禁用（user-groups:157），本仓只禁用默认分组（AdminUserGroupsPage:379），有会员的分组仍可点删除并在确认框展示「该分组当前有 N 名有效会员」（:636-648）；② 上游倍率是小数 0.0001–100（即最高 100 倍，editor:136-137），本仓用百分比且上限 100%（:197-201），无法配置 1 倍以上倍率；③ 上游模型覆盖是从当前可用渠道模型的可搜索下拉选择（editor:47-55、164-166），本仓是自由文本模型编码（:582-605），拼错不会提示；④ 上游徽章有实时预览（editor:120-128），本仓无；⑤ 上游有刷新按钮（user-groups:175-177），本仓无；⑥ 本仓多审计原因、默认分组提示、渠道复选框（:505-633）。 |
| `pages/admin/user-groups/user-group-editor.tsx` | `AdminUserGroupsPage.tsx` 的编辑 Drawer | 🔀 合并 | 基本信息/徽章/倍率/汇率/可见渠道/模型覆盖/排序均具备。缺失：徽章预览、渠道多选搜索、模型覆盖下拉校验（见上）。本仓编辑抽屉 700px 单页滚动，上游 640px 抽屉；两者都有未保存关闭确认（上游 editor:57-71；本仓 useDiscardConfirm :145）。 |
| `pages/admin/user-groups/user-group-form.ts` | `AdminUserGroupsPage.tsx` 的 `toDraft`/`submit` | 🔀 合并 | 两边都把人类单位换算为 bps/微积分（上游 form:29-81；本仓 :93-115、187-252）。差异：本仓倍率按百分比输入并 `×100`，上游按小数输入并 `×10000`；默认值不同（本仓 100%/1/0.14，上游 1/7/1，constants/EMPTY_DRAFT），属产品口径差异；本仓名称限 40 字、描述 200 字（:463、482），上游 80/500（editor:113、117）。 |
| `components/model-picker.tsx` | `components/ModelPicker.tsx` | 🔀 重构（多处真实缺口） | 上游两级选择（产品模型→渠道模型）、个人渠道、分组健康、按当前输入做能力兼容过滤、每项可用性徽章/最近 10 次/7 天趋势、每档价格与选中后精确报价、键盘方向键/Home/End/Escape（model-picker:75-182、246-289、628-724）。本仓是扁平前台模型按钮列表：只按服务端 `available` 置灰（ModelPicker:168-193），无兼容性判断、无不可用原因、无健康/可用性、无分组、无键盘漫游、每项只显示 `displayPrice/priceLabel`（:44-48），选中后 400ms 防抖报价（:114-149）。本仓有按能力 localStorage 记忆并跨组件事件同步（modelSelection.ts:27-51、ModelPicker:84-105），上游用全局配置 store。 |
| `components/model-picker.tsx` + `lib/model-picker-groups.ts` + `lib/model-selection.ts` | `lib/models.ts` + `lib/modelSelection.ts` | 🔀 重构 | 上游 `resolveCompatibleModel` 在「同显示名分组」内按当前输入挑兼容模型，默认再按价格排序（model-selection:278-297）；本仓 `resolveModelId` 只认精确 id 否则回退 `defaultModelFor`，并按 `sortOrder` 取第一个可用（models.ts:100-128），不判断输入兼容性、也不优先便宜模型。上游 `groupModelsForPicker` 按 displayName 聚合、区分系统/个人渠道（picker-groups:23-52），本仓 `modelsForCapability` 只按能力过滤并排序（models.ts:131-137）。 |
| `pages/admin/components/credit-cost-fields.tsx`（同域补充） | `ChannelModelForm.tsx` 成本字段 | ⚠️ 部分缺失 | 上游按计费方式只显示对应成本字段（token 视频只显示输出 Token 成本，credit-cost-fields:6-15），本仓「记录成本价」后固定展示成本单价/输入/输出/缓存四项（ChannelModelForm.tsx:289-324），视频 Token 也会出现无意义的输入/缓存成本；且本仓成本字段无必填校验，空值会被 `priceOf` 报格式错误而非字段级提示。 |
| `pages/admin/components/credit-operations-panel.tsx`（同域补充） | `AdminBillingOrdersPage.tsx` | ⚠️ 部分缺失 | 两边都有单笔「按现有用量结算/全额退款」并要求核对原因。上游还有待核对队列筛选（review）、勾选批量结算/批量退回并逐条返回失败、用户账号、上游请求号、视频 Token 公式结算明细、自动退回开关、积分策略与人工调账（credit-ops:234-466、497-583）。本仓有状态统计卡、成本/毛利、按 id 拉详情、深链与未保存保护（BillingOrders:100-117、327-336、442-493），但 API 只有单笔 resolve（lib/api.ts:2240-2244），无批量、无自动退回、无积分策略/调账。 |
| `pages/admin/logs/logs-page.tsx`（同域补充） | `AdminModelCallsPage.tsx` 列表 | ⚠️ 部分缺失 | 上游支持 result/status、recordType、capability、用户/模型/渠道/日期筛选、媒体预览、批量恢复、导出当前筛选/已选（logs-page:118-204、238-320）。本仓支持状态/类型/计费/模型/渠道/任务/用户/日期筛选、CSV 导出、统计卡（AdminModelCalls:349-431），但无媒体预览、无批量恢复、无导出已选、无能力筛选，详情见上。 |
| `pages/admin/components/analytics-panel.tsx`（同域补充） | `AdminDashboardPage.tsx` | ⚠️ 部分缺失 | 上游分析面板按模型列收入/成本/利润/利润率与任务/请求/成功率/P50/P95/Token/媒体（analytics-panel:140-155），本仓 Dashboard 无这些按模型财务/性能列（grep 无成本/利润字段）；财务只落到独立 FinancePage，且按模型拆解不含成本。 |

---

### 表B 上游有、本仓无的页面/交互/字段

| # | 上游能力/字段 | 本仓现状 | 影响 | 判定 |
|---|---|---|---|---|
| B1 | 服务商目录三步向导：选服务商、Key 格式校验+真实验证、跳过验证则渠道停用、模型勾选、统一/单独加价、一键接入（wizard:20-27、80-148、362-459） | 无；新增渠道只能手填（page.tsx:168-173） | 接入新供应商需手工查 Base URL、逐个建模型/定价；易配错 | 有意差异（任务约定不做） |
| B2 | 渠道/模型列表筛选写 URL（filter/status/channel；q/modelStatus/modelChannel） | 只有 `view` 与详情 `id` 同步 URL（page.tsx:101-105、120） | 把「不健康/某渠道」排障视图发给同事会丢筛选 | 真实缺口（轻微） |
| B3 | 未选中渠道自动回退第一个可见渠道（channel-workspace-state:11） | `find(id) ?? null`（page.tsx:148） | 首次进入右侧空白，多一次点击；窄屏更明显 | 真实缺口（轻微） |
| B4 | 模型编辑器结构化能力合同：引用数量/大小/时长、协议参数、图片参数、工作流画面规格（editor:376-415；routing-capabilities:280-537） | 原始 JSON 文本域（ChannelModelForm.tsx:330-341；AdminLogicalModelsPage:745-765） | 运营无法发现字段约束，JSON 写错可保存并在线上路由失败 | 真实缺口（高） |
| B5 | 模型图标选择器、展示名自动补全、协议浏览器（含 create 路径）（editor:291-350） | 图标/展示名自由文本、协议普通下拉（ChannelModelForm.tsx:94-157；useChannelModels:88-91） | 图标不一致、分组名拼写分裂、协议选择缺少说明 | 真实缺口（中） |
| B6 | 价格档按生成方式/分辨率/帧率/图片参数/画质/尺寸结构化匹配（price-tier-fields:96-163） | `selector` 自由文本 key=value（ChannelModelForm.tsx:209-217） | 错 key/错值生成永不命中的档位；无法匹配图片参数与帧率 | 真实缺口（高） |
| B7 | 视频 Token 计费（price-tier-fields:179-217；editor-form:191） | 校验只允许文本 Token，视频 Token 直接报错（utils:216-223） | 视频按 Token 结算的供应商无法在本仓配置 | 真实缺口（高） |
| B8 | 模型编辑「测试当前未保存配置」；关闭前未保存确认（editor:77-84、169-193） | 新建必须先保存才能测；关闭直接丢弃（Manager:404-410；FormDialog:43-47） | 试错成本高，误关丢配置 | 真实缺口（中） |
| B9 | 单渠道模型清单「不健康」筛选（manager:417-430） | 只有 enabled/disabled/unpriced（constants:80-84） | 在单渠道内无法筛出 24h 低成功率线路 | 真实缺口（低） |
| B10 | 模型/账单列表 pageSize 选择（manager:470-479；all-models:278-289） | 固定 20/50（constants:86、100） | 大渠道翻页多 | 真实缺口（低） |
| B11 | 批量选择上限 100 并提示；刷新后裁剪失效勾选（manager:455-462、67-70） | 无上限；`useChannelModels.load` 不裁剪 selection（Manager:99-111） | 大表可一次选中数百条；删除后旧勾选残留 | 真实缺口（中） |
| B12 | 调用详情按 id 拉取、深链、请求/响应报文、复制（api-log-detail:19-45、264-307） | 详情只能来自当前页行（AdminModelCalls:154、485-489），无报文 | 无法从任务/账单跳到一次具体调用；无法查看上游返回 | 真实缺口（高） |
| B13 | 上游任务查询、视频 URL 转存、媒体重新保存（补扣/免扣）（api-log-detail:68-117、228-262） | 无对应接口与 UI | 失败/丢回调订单无法救回作品，只能退款 | 真实缺口（高） |
| B14 | 调用详情计费拆解（预授权/实收/账务状态）与任务/媒体状态（api-log-detail:310-322） | 只显示 billingOrderId；数据字段已有但未渲染（types/model.ts:717-721；AdminModelCalls:470） | 无法判断「钱扣了没有、作品存了没有」 | 真实缺口（中） |
| B15 | 调用阶段 download/upload/local_save/local_fallback/offload/register/repair 标签（logs-page:478-479） | 只有 create/poll/task，未知直接显示 raw key（AdminModelCalls:42-47） | 排障时阶段不可读 | 真实缺口（低） |
| B16 | 账单批量结算/批量退款、待核对队列、用户账号、上游请求号（credit-ops:288-466） | 只有单笔、无 review 队列（AdminBillingOrders:149-170、411-439） | 批量异常只能逐单点，事故恢复慢 | 真实缺口（高） |
| B17 | 冻结积分自动退回开关与接口（billing-auto-refund:12-84；wallet.ts:276-280） | 无 UI 无 API | 待核对冻结资金必须人工逐单释放 | 真实缺口（高） |
| B18 | 按模型的收入/成本/利润/利润率（analytics-finance:17-21） | 按模型只有订单/实收/已退/净收入（types/model.ts:820-829；FinancePage:100-156） | 无法识别亏损模型 | 真实缺口（中） |
| B19 | 前台模型线路按能力过滤、停用不可选、禁止重复、启用必须至少一条线路、来源能力校验（logical:119、173-184、579-616） | 可选全部模型/停用模型，可重复，可启用无线路（AdminLogicalModelsPage:198-205、311-323、787-793） | 保存成功但线上 42204「无可用线路」；跨能力线路匹配失败 | 真实缺口（高） |
| B20 | 切换前台模型能力时清空线路/能力合同/默认参数（logical:481-485） | 只改 `capability`，旧线路与旧合同保留（AdminLogicalModelsPage:657-663） | 能力与线路/合同不一致，路由结果不可预测 | 真实缺口（高） |
| B21 | 前台模型结构化能力范围/默认参数/请求模拟编辑器（routing-capabilities:280-537） | 原始 JSON；模拟只有 operation+options（AdminLogicalModelsPage:745-765、855-866） | 无字段约束、无 inputs 模拟（参考图/视频数量） | 真实缺口（高） |
| B22 | 前台模型模拟的 productMatch 与候选池/冷却/低优先级原因（logical:532-542、749-767） | 只有候选数/选中线路/逐线 eligible+reason+价格档（:868-913） | 看不出「请求能力本身不匹配」还是「线路不可用」 | 真实缺口（中） |
| B23 | 插件按类型/可用性筛选、搜索、分页、应用插件作用范围与启用用户数（plugins:39-73、174-193、269-324） | 无筛选/搜索/分页；类型只有 builtin/installed（AdminPluginsPage:209-362；types:549-595） | 插件多时难找；无法管理用户级应用插件 | 真实缺口（中，受后端模型限制） |
| B24 | 用户分组有会员时禁止删除（user-groups:157） | 只禁默认分组（AdminUserGroupsPage:379） | 可能删掉仍有会员映射的分组，产生孤儿会员 | 真实缺口（中） |
| B25 | 分组倍率支持 0.0001–100（最高 100 倍）（editor:136-137） | 百分比上限 100%（1 倍）（AdminUserGroupsPage:197-201） | 无法配置溢价倍率 | 真实缺口（中） |
| B26 | 模型覆盖从真实渠道模型下拉选择（editor:47-55、164-166） | 自由文本模型编码（:582-605） | 拼错即静默不生效 | 真实缺口（中） |
| B27 | 用户组徽章实时预览（editor:120-128） | 无 | 配错样式只能保存后到 C 端看 | 真实缺口（低） |
| B28 | C 端按当前输入过滤兼容模型并给出不可选原因（model-selection:112-171、246-253） | 只按服务端 available 置灰，无原因（ModelPicker:168-193） | 用户可选到「参考图过多/时长不支持」的模型，提交才失败 | 真实缺口（高） |
| B29 | C 端每档价格/当前规格精确报价/可用性健康/7 天趋势（model-picker:506-527、628-724） | 只有基础 `displayPrice/priceLabel` + 选中后报价（ModelPicker:44-48、196-203） | 选项价格不透明，故障线路无提示 | 真实缺口（中） |
| B30 | C 端两级分组（产品模型→渠道）、个人渠道（picker-groups:23-52；model-picker:200-289） | 扁平前台模型列表（ModelPicker:167-195） | 同名多线路无法横向比较；个人渠道不可见（渠道隐藏属本仓架构） | 部分有意（渠道隐藏），分组展示为缺口 |
| B31 | C 端键盘方向键/Home/End/Escape 漫游（model-picker:149-182） | 原生 Tab/Enter 按钮（ModelPicker:171-186） | 键盘/无障碍体验下降 | 真实缺口（低） |
| B32 | 默认模型在同显示名组内按兼容性+价格选择（model-selection:278-297） | 按 `sortOrder` 取第一个可用（models.ts:100-128） | 默认可能选到更贵模型 | 真实缺口（中） |

---

### 表C 本仓有、上游无的页面/交互/字段

| # | 本仓能力/字段 | 证据 | 价值/备注 |
|---|---|---|---|
| C1 | 删除/调价强制填写审计原因，并在缺失时禁用确认 | 渠道 page.tsx:263-283；模型 Manager:335-389；批量 :364-389；调价 :110、174-177；DeleteReasonConfirm:45-64 | 比上游更符合高危写操作审计；属有意增强 |
| C2 | 渠道表单「排序值」「变更原因」 | ChannelFormDrawer.tsx:63-71、166-174；page.tsx:193-197、220 | 上游排序走独立弹窗、无原因 |
| C3 | 独立「线路健康」面板：24h/7d/P95/均值/最近样本/协议未注册/冷却中 | ChannelModelHealthPanel.tsx:41-166；page.tsx:464-475 | 上游只在单元格 tooltip/渠道徽章展示 |
| C4 | 渠道模型行级连通性测试 + 最近测试结果面板（含 logId、HTTP path、产出、responsePreview） | ChannelModelTable.tsx:241-248、473-509；Manager:278-296 | 上游测试只在编辑器内且不保留结果 |
| C5 | 批量删除/统一调价的计数按钮与原因输入 | ChannelModelTable.tsx:374-391；Manager:486-502 | 上游批量操作无原因 |
| C6 | 「未定价」状态筛选与标签，作为补价队列 | constants.ts:80-84、89-97；AllChannelModelsPanel.tsx:319-328；ChannelModelTable.tsx:219-224 | 上游无此状态 |
| C7 | 全部模型「编辑」跳回渠道并定位模型（focusModelId） | page.tsx:140-146；Manager:120-134；AllChannelModelsPanel.tsx:338-348 | 上游是原地内嵌编辑器 |
| C8 | 渠道左列「未配置 Key」红字提醒、详情显示代理地址 | ChannelListPanel.tsx:226；ChannelDetailPanel.tsx:82 | 上游密钥状态只在详情 |
| C9 | 渠道启停影响清单（模型数、前台线路不可用、42204） | page.tsx:504-516 | 上游只有一句描述 |
| C10 | 用户分组审计原因、默认分组说明、渠道复选框、百分比倍率输入 | AdminUserGroupsPage:505-633 | 上游为小数倍率、搜索多选、徽章预览 |
| C11 | 前台模型「显示已归档」、Revision 列、编码创建后不可改、统一价策略与四个价格字段 | AdminLogicalModelsPage:158、496-500、616-624、687-743 | 上游无归档筛选/版本列，且强制跟随渠道价 |
| C12 | 插件契约校验、详情抽屉（Provider/配置/界面/权限/最近校验）、当前环境不可用原因、协议生效数、操作原因 | AdminPluginsPage:96-207、585-708 | 上游无这些排查维度 |
| C13 | 插件页「服务商目录」安装/校验/刷新（插件包维度） | AdminPluginsPage:364-451、547-583 | 上游目录是渠道向导，二者不是同一功能 |
| C14 | 调用记录 CSV 导出、统计卡、URL 筛选同步、按 id 拉账单详情 | AdminModelCalls:130-151、349-356；AdminBillingOrders:100-117 | 上游日志页也导出，但本仓账单深链更强 |
| C15 | 账单状态统计卡、成本/毛利、用户邮箱、计费倍率、按现有用量结算 | AdminBillingOrders:327-336、442-479 | 上游信用运营面板有队列/批量但无这些字段 |
| C16 | 独立财务页：净收入/已退/挂账/结算成功率/成本毛利，按模型/渠道/能力/场景拆解 | AdminFinancePage:190-238 | 上游财务在分析面板内，无独立页 |
| C17 | 后台 RBAC 门禁（channel.write/model_write/test、logical_model.write、plugin.write、user_group.write、billing_order.resolve、data.export） | page.tsx:86-87、399、444-445；Logical:155；Plugins:74-75；Groups:120；Billing:70；Calls:331 | 上游这些页面未按权限点收口 |
| C18 | 统一未保存守卫（页面级 `useUnsavedGuard`/`useDiscardConfirm`） | 渠道 page.tsx:152-162；Logical:220-228；Groups:137-145；Billing:111-117 | 上游多为表单 `isFieldsTouched` 局部实现 |
| C19 | C 端模型选择按能力 localStorage 记忆 + 跨组件事件同步，报价回传提交按钮 | modelSelection.ts:27-51；ModelPicker:84-149 | 上游用全局配置 store；本仓保证同页价签一致 |
| C20 | C 端不可用模型仍列出并置灰「暂不可用」 | ModelPicker:168-191 | 让用户知道有更高档产品；上游也可列出但分组内处理 |

---

### 表D 关键交互对照

| 交互 | 上游 | 本仓 | 结论 |
|---|---|---|---|
| 渠道主从布局 | 左侧常驻渠道导航（搜索/状态/健康徽章/未配置 Key），右侧选中渠道详情 + 模型管理；未选中回退首条；筛选在 URL | 同样左列+右详情；未选中空白；筛选为组件 state；选中走 `?id=` | 🔀 结构对齐，URL 状态与默认选中退化 |
| 全部模型视图 | 与「按渠道」并列，跨渠道表，健康/成本/渠道跳转，原地编辑，含停用项 | 同样并列，增加未定价队列与状态，编辑跳回渠道；分页固定 | 🔀 对齐且部分增强，编辑动线不同 |
| 模型编辑弹窗 | 1120px 三 Tab，结构化协议/能力/价格，图标选择、展示名补全、未保存确认、可测未保存值 | 980px 单页长表单，原始 JSON 能力合同、自由文本图标/展示名/规格，保存后才能测，关闭不确认 | ⚠️/❌ 结构性能力与安全交互缺失 |
| 价格档 | default/advanced，生成方式/分辨率/帧率/图片参数/画质/尺寸，结构化校验，视频 Token | 自由文本 selector、分辨率、视频秒数、8 个价格框，弱校验，禁止视频 Token，货币单位未反映到标签 | ❌ 真实能力缺口 |
| 统一调价 | 按成本×（1+加价率），小数位、逐项手改、按模型分组、CAS 整批拒绝 | 同样算法（BigInt half-up）+ 必填原因 + 模型缺失成本/售价阻断 | ✅ 对齐，本仓更严 |
| 上游导入 | 拉取上游→预览弹窗→搜索/全选匹配/取消匹配→默认勾选已存在、新模型不勾选→导入 | 拉取上游→对象化预览（含 displayName/已存在徽章）→默认勾选新模型→导入 | ✅ 对齐，默认选择策略本仓更合理 |
| 排序 | 拖拽/上下移/输入位置；保存带 original ids CAS；全部条目不受筛选影响 | 同左，拆成渠道排序与模型排序两个 API 入口 | ✅ 对齐 |
| 删除原因 | 删除只需确认，无原因；后端可能不要求 | 渠道/模型/批量删除均强制原因并禁用确认；批量全有或全无 | ⚠️ 有意差异（本仓更严） |
| 健康指标 | 24h 成功率+最近 10 次色块，tooltip 7d/P95/最近失败；渠道左列聚合徽章 | 同左，另有完整健康表；但 24h 无样本显示「无调用」会掩盖 7d 数据，同页两套阈值/格式不一致 | 🔀 大部分对齐，展示口径有瑕疵 |
| 路由模拟 | 结构化 operation+inputs+options，展示能力匹配结论与候选线路 inPool/blocked/matched/低优先级及原因 | operation 文本+options JSON，无 inputs；结果显示候选数、选中线路、逐线 eligible/reason/价格档 | ⚠️ 可用但无法模拟输入约束，缺能力匹配结论 |
| 分组编辑 | 编码/名称/说明/徽章+预览/小数倍率/汇率/全部渠道开关/渠道多选/模型覆盖下拉/排序；有会员禁删 | 编码/名称/说明/徽标（无预览）/百分比倍率（上限 1 倍）/汇率/渠道复选框/模型覆盖自由文本/排序；只禁默认分组删除 | 🔀 字段对齐，校验与上限退化 |
| 插件安装 | 上传插件弹窗；按类型/可用性筛选；平台开关；用户级应用插件与启用用户数；内置不可卸载 | 隐藏 file input + 确认；有契约校验/详情/服务商目录/协议数/不可用原因；无筛选/分页/用户级插件 | 🔀 本仓排障更强，管理维度更窄 |
| 调用详情 | 按 id 拉取，概览/任务媒体/计费/请求响应报文/复制/上游任务查询/视频转存/媒体恢复 | 仅当前页行，基础字段；无报文、无恢复、计费只显示账单 id | ❌ 排障与救单能力缺失 |
| 账单处置 | 待核对队列/单笔+批量结算或退款/原因/失败逐条/用户账号/上游请求号/自动退回开关 | 单笔结算或退款/原因/深链详情/成本毛利/状态卡；无批量、无 auto-refund、无 review 队列 | ⚠️ 单笔对齐，批量与自动化缺失 |
| 财务分析 | 分析面板 KPI + 按模型收入/成本/利润/利润率 | 独立财务页，实收/已退/净收入/挂账/成本毛利/日趋势/四维拆解；按模型无成本利润 | 🔀 页面更强，模型级盈利分析缺失 |
| C 端选型与报价 | 两级分组、按当前输入兼容过滤、每档价格、可用性健康/趋势、选中精确报价、键盘导航、默认选兼容且便宜 | 扁平列表、按服务端 available 置灰、基础价+选中防抖报价、localStorage 记忆；无兼容/健康/分组/键盘 | ⚠️ 架构有意简化（只暴露前台模型），但输入兼容与健康提示是真实缺口 |

---

### 前端测试文件一句话汇总

- 上游本域只有 1 个测试：`pages/admin/components/channel-model-price-tier-form.test.ts`，3 个用例锁「旧模型空价格档不得把顶层上游键固化进统一档、已存档位键回显、默认档不带上游键」，没有页面级/交互级测试。
- 本仓渠道域有 `ChannelHeadersEditor.test.tsx`（请求头黑名单/大小写去重/空行不算错）、`ChannelModelHealthCell.test.tsx`（无样本不算 0%、成功率分档、100% 不带小数）、`ChannelModelHealthPanel.test.tsx`（无样本/截断样本/停用/协议未注册/冷却标记）3 个组件测试，共 28 个断言点；另有 `lib/__tests__/channelCost.test.ts`、`channelOrder.test.ts`、`channelReprice.test.ts`、`unsaved-guard.test.ts` 4 个纯函数测试，覆盖展示口径、排序、BigInt 调价与未保存守卫。
- 本仓 `pages/admin/__tests__/admin-modules.test.ts` 只做后台具名导入/导出对账（防 barrel 漏导出白屏），不覆盖业务行为。
- 两边都**没有**渠道主页面、全部模型、模型编辑/价格档表单、前台模型、插件、用户分组、账单处置、调用详情、C 端 ModelPicker 的端到端或交互测试；本仓的 3 个渠道组件测试也不能替代这些页面的回归保障。

---

### 有意差异 vs 真实缺口（汇总）

**有意差异（不应当按缺陷计）**

1. 全部后台页面使用本仓 `admin-ui/primitives` + Tailwind，而不是上游 antd/自研 overlay；布局、表单控件、Modal/Drawer 外观不同但语义大多等价。
2. 服务商目录三步向导（`provider-catalog-wizard.tsx`）与 `provider-catalog-pricing.ts` 不做；新增渠道走手填表单。代价是失去「目录带价一键接入」。
3. 本仓删除/调价强制审计原因，属更严格的产品/后端契约，不是缺失。
4. 本仓把「线路健康」做成独立面板、把「财务分析」做成独立页，属于信息架构重构，不是功能缺失。
5. 本仓 C 端只暴露「前台模型」，不展示渠道/个人渠道，这是本仓产品架构（渠道信息不出 C 端），与上游「产品模型→渠道模型」两级选择不同；但分组展示、输入兼容与健康提示仍可按前台模型维度补齐。
6. 本仓插件模型只有 builtin/installed 两种来源，没有 application/payment 分类与用户级启用；如果后端确实没有该概念，这是架构差异；若后端有而前端未接，则升级为真实缺口。
7. 移动端适配不在要求内，两边均按桌面后台设计。

**真实缺口（建议排优先级）**

1. 模型价格档结构化匹配 + 视频 Token 计费 + 能力合同/参数编辑器（B4、B6、B7、B21）。
2. 前台模型线路合法性：能力过滤/停用禁用/去重/启用必须有线路/能力合同校验与重置（B19、B20）。
3. 调用详情报文、按 id 深链、上游任务查询/视频转存/媒体恢复、计费拆解（B12-B15）。
4. 账单批量处置与自动退回开关（B16、B17）；财务按模型成本/利润（B18）。
5. C 端按当前输入兼容过滤、不可选原因、每档价格与可用性健康、默认选便宜可用（B28、B29、B32）。
6. 用户分组有会员禁删、倍率上限、模型覆盖受控选择（B24-B26）。
7. 渠道/模型列表 URL 状态与默认选中、模型编辑未保存确认与未保存测试（B2、B3、B8）。

---

## 7. 验证覆盖差异

| 域 | 上游测试 | 本仓测试 | 风险 |
| --- | --- | --- | --- |
| 渠道 / 渠道模型 / 价格档 | 约 15 个 `_test.go`（复制、导入导出、排序 CAS、批量调价、价格档表单、标签、健康） | `backend/src/model/channels/**` 0 个 `.spec.ts`；`verify-channel-flow.ts` 覆盖主链路 | 复制清空清单、图片合同绕过、健康契约等无回归网 |
| 前台模型 / 目录 / 路由 / 分组 | 约 12 个 `_test.go`（路由、能力、可用性、SKU、分组、图片参数） | `src/model/{catalog,routing,intent,user-groups}` 0 个 `.spec.ts`；`verify-route-catalog.ts` 覆盖核心算子 | 目录过滤、价格档合法性、全局倍率无单测 |
| 协议 / 插件 | 约 30 个 `_test.go` + `providercatalog` 4 个 | `protocol` / `plugins` 0 个 `.spec.ts`；`verify-plugin-manifests.ts`、`verify-protocol-runtime.ts` | 表达式/清单/包解析缺单测，`expression.ts` 注释与事实不符 |
| 任务 / 计费 / 财务 | 约 30 个 `app/*task*_test.go` + 33 个 `repository/*_test.go` | `src/model/tasks/**`、`billing/**`、`src/credits/**` 0 个 `.spec.ts`；`verify-billing.ts`、`verify-task-runtime.ts`、`verify-credit-deduction.ts`、`verify-credit-price.ts` | 资金核心有脚本，后台账单/日志/自动退款/媒体恢复/兑换无覆盖 |
| 代理 / 出站 | 6 组单测（SSRF、路径、流式、限流） | `verify-proxy-runtime.ts`（1344 行） | 单测缺失，回归定位慢 |
| 前端 | 1 个价格档纯函数测试 | 3 个渠道组件测试 + 4 个纯函数测试 + 1 个 Playwright 套件 | 页面级/交互级覆盖不足 |

> 本仓全仓 `backend/src/**/*.spec.ts` 仅 5 个（支付 3 个 + 通用 zip/csv 各 1 个），模型域为 0。上游模型域测试文件合计约 100+ 个。这是本次对标中最大的“非功能差距”。

## 8. 建议的复核顺序

1. **先复核 P0 的 10 条**：它们直接对应数据丢失、资金口径、二次计费、安全边界。每条都给出上游/本仓文件与行号，可逐条复现。
2. **再复核契约类差异**：`fetch/import` 返回类型、健康指标字段、`GET /admin/channel-models` 默认是否含停用、`/models` 匿名可见性。这些会直接破坏按上游契约写的客户端。
3. **最后复核“有意差异”**：服务商目录、单实例协调、匿名目录、多图产出、审计策略。需要产品确认是否接受，而不是当作 bug 修。
4. **补测试的优先级**：渠道复制/导入、图片合同校验、价格档选择器、建单-预留原子性、换线财务口径、媒体落盘失败语义、代理路径规范化。建议先用上游同名测试的用例表做对照，再决定是本仓补 `.spec.ts` 还是继续扩 verify 脚本。

## 9. 审计边界

- 本次是**静态代码对比**，没有启动服务、没有连数据库、没有调用真实厂商。运行时结论（尤其是并发、崩溃窗口、上游错误体差异）仍需脚本或真机验证。
- 上游有少量“定义但无调用”的能力（如 `FetchAdminChannelModels`、`EnsureSystemChannelModels`、`LogicalModelPriceSKU`），本清单已标注，不按缺口计。
- 本仓当前工作树有未提交 WIP（116 个文件，含模型域和渠道页），本清单基于该工作树；与 `HEAD` 可能存在差异。
