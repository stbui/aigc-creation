# 模型通道架构

> 范围：生成链路的模型层（`backend/src/providers/` + `generate/` + `admin/model-*`）。
> 记录 2026-10-20 三层重构后的**实际实现**，不是设计意图。文中「现状问题」一节均经脚本或代码取证。

## 1. 设计约束

| 约束 | 含义 | 落点 |
| --- | --- | --- |
| 身份与形状分离 | 厂商 = 谁家 / 谁的 key / 有哪些模型；协议 = 请求体长什么样、响应从哪掏 | `vendors/vendor.catalog.ts` vs `protocols/protocol.spec.ts` |
| 单一事实源 | 协议形状、厂商目录、配置项、能力元信息各只有一处声明 | 四个目录文件，其余层只引用 |
| 依赖单向 | 应用 → 路由 → 调度 → 通道 → 协议 → 模态叶子；协议层不得反向依赖厂商层 | `verify-architecture-layers.ts` 35 项断言 |
| 失败语义按模态 | 图像可回落本地；文本/视频没有本地实现，失败即失败 | 三个路由器各自实现 |
| 观测旁路 | 每次调用写 `ModelCallLog`，写失败只 WARN，不影响出片 | `image-call-logger.ts` |
| 配置热生效 | env > DB > 代码默认；后台保存后立即失效缓存 | `gateway.config.ts` + `model-config.service.ts` |
| 不把本地伪装成模型 | 产出带 `source: gateway/local`，前端如实显示徽标 | `unified.provider.ts` + `generate.service` |

## 2. 分层总览

```
┌─ 应用层 ────────────────────────────────────────────────────────────┐
│ generate.service（图像/视频）        prompt-tools.service（文本）      │
│        │ IMAGE_PROVIDER / VIDEO_PROVIDER        │ TEXT_PROVIDER       │
└────────┼──────────────────────────────────────────┼──────────────────┘
         ▼                                          ▼
┌─ 路由层（三个平级路由器，各自只认本模态的接口）───────────────────────┐
│ CapabilityRouterProvider │ VideoCapabilityRouter │ TextCapabilityRouter│
│  - 读 routeOf(capability) 与 cfg.enabled                              │
│  - 图像：失败回落本地；文本/视频：失败上抛                             │
└────────┬──────────────────────────────────────────────────────────────┘
         ▼
┌─ 调度层 ChannelScheduler.dispatch(modality, run) ─────────────────────┐
│ 1. 读 ModelChannel 表（priority 升序）；表空则用 gateway.<modality>.*  │
│    合成一条内存通道（惰性迁移，不落库）                                 │
│ 2. 跳过冷却中的通道；逐条调用，成功即返回                               │
│ 3. 连续失败 3 次 → 冷却 max(30s, pollMs×5)；成功清零                    │
└────────┬──────────────────────────────────────────────────────────────┘
         ▼
┌─ 通道层（运行期只认这几项，不知道「厂商目录」的存在）──────────────────┐
│ { baseUrl, token, model, protocol, priority, enabled, 健康状态 }       │
│ 路由器调 gateway.withChannel(creds) 注入凭据                           │
└────────┬──────────────────────────────────────────────────────────────┘
         ▼
┌─ 协议层（请求/响应形状的唯一声明处）──────────────────────────────────┐
│ ProtocolSpec（图/文）/ VideoProtocolSpec（视频四段式）                 │
│ 端点 · 尺寸写法 · 参考图上限与传法 · 响应解包 · 错误解包 · 探测路径     │
└────────┬──────────────────────────────────────────────────────────────┘
         ▼
        HTTP：OpenAI 兼容 / 火山方舟 / MiniMax

旁路：
  ModelChannelConfig (DB) ──覆盖──> gateway.config ──每次调用读取──> 路由器
  ImageCallLogger ──写──> ModelCallLog（旁路观测，失败不影响主链路）
```

**关键区分**：`vendor.catalog.ts` 是**配置期目录**（决定后台下拉能选谁、自动填什么），不在调用链上。运行期一条通道只有 `protocol + baseUrl + token + model` 四个身份字段，协议实现由 `provider-factory.ts` 按标识构造。

## 3. 模块地图

| 文件 | 职责 | 层 |
| --- | --- | --- |
| `providers/modality.ts` | `Modality = text \| image \| video` | 叶子（三层都依赖它） |
| `providers/unified/unified.provider.ts` | `ImageProvider` / `TextProvider` / `VideoProvider` 三个接口与三种 Outcome | 统一能力层 |
| `providers/capability-router.provider.ts` | 图像路由：route 决策、协议分派、失败回落、调用埋点 | 路由层 |
| `providers/text-capability-router.provider.ts` | 文本路由：无本地兜底 | 路由层 |
| `providers/video-capability-router.provider.ts` | 视频路由：无本地兜底 | 路由层 |
| `providers/channel-scheduler.ts` | 按 priority 顺序调度、熔断冷却、合成存量通道 | 调度层 |
| `providers/channel-repository.ts` | 线路增删改/排序、快照、固化旧配置（已由 `admin/model-channels` 接线） | 调度层 |
| `providers/gateway.config.ts` | 配置解析：env > DB > default，3s 缓存，存量键回落 | 配置 |
| `providers/channel-config.defs.ts` | `CONFIG_DEFS`：按模态生成基址/凭据/超时/路由配置项 | 配置 |
| `providers/vendors/vendor.catalog.ts` | 厂商目录（一家一条，含各模态通道与模型清单） | 配置期目录 |
| `providers/vendors/vendor.presets.ts` | 派生「模态 × 厂商」视图，供后台下拉 | 配置期目录 |
| `providers/vendors/vendor.integrity.ts` | 装配期校验：协议/厂商标识唯一、引用不悬空、派生 key 不重复 | 装配期 |
| `providers/provider-presets.ts` | 纯转发层（兼容既有 import，不再声明数据） | 转发 |
| `providers/protocols/protocol.spec.ts` | 五种协议形状的唯一声明处（4 条 `PROTOCOL_SPECS` + 1 条 `VIDEO_PROTOCOL_SPECS`） | 协议层 |
| `providers/protocols/provider-factory.ts` | 协议标识 → 图像 provider 实例；未知协议显式抛错 | 协议层 |
| `providers/image-provider-base.ts` | 同步图像通道共用骨架（鉴权/参考图/下载/魔数） | 协议实现基座 |
| `providers/modelverse-image.provider.ts` | `openai` 协议（历史名保留，行为与其它 OpenAI 兼容厂商一致） | 协议实现 |
| `providers/volcengine-image.provider.ts` | `volcengine` 协议（一行构造，形状在协议层） | 协议实现 |
| `providers/minimax-image.provider.ts` | `minimax` 协议（一行构造） | 协议实现 |
| `providers/openai-chat-text.provider.ts` | `openai-chat` 文本协议（支持多模态 content 数组） | 协议实现 |
| `providers/minimax-video.provider.ts` | `minimax-video` 四段式异步协议 | 协议实现 |
| `providers/local-image.provider.ts` | 本地 Jimp：按 `localImpl` 句柄分派，11 个本地真实实现（`LocalImageProvider`，2026-10-22 由历史名 `MockImageProvider` 更名） | 本地兜底 |
| `providers/gateway-prompt.ts` | 从能力定义取 `buildPrompt`，组装请求体 | 应用支撑 |
| `providers/image-call-logger.ts` | 写 `ModelCallLog`，截断 prompt/reason，失败只 WARN | 观测 |
| `providers/providers.module.ts` | 注册三个路由器、调度器、埋点器，绑定三个 DI token | 装配 |

## 4. 三模态与统一接口

| 模态 | 接口 | 产出 | 本地兜底 | 使用方 |
| --- | --- | --- | --- | --- |
| image | `ImageProvider.generate(capability, inputPaths, params)` | `{ kind:'image', buffer, format, source }` | 11 项有（Jimp 真实算法），4 项无（必须云端） | `generate.service` |
| text | `TextProvider.generate(capability, messages, params)` | `{ kind:'text', text, source, usage? }` | 无 | `prompt-tools.service` |
| video | `VideoProvider.generate(capability, inputPaths, params)` | `{ kind:'video', buffer, format, source, durationMs? }` | 无 | `generate.service` |

- 三者都实现 `ProduceSource = 'gateway' | 'local'`，路由器出口必填。
- `generate.service` 只注入 `IMAGE_PROVIDER` 与 `VIDEO_PROVIDER`，按能力的 `modality` 分流：`video → videoProvider`，其余 → `imageProvider`。
- 文本不经过 `generate.service`，由 `prompt-tools` 直接注入 `TEXT_PROVIDER`。

## 5. 路由与调度

### 5.1 图像路由决策

| `route` | 网关状态 | 行为 |
| --- | --- | --- |
| `local` | 任意 | 直接本地 Jimp，不算回落（`fallback=false`） |
| `remote` | 可用 | 强制远程；全部通道失败仍回落本地 |
| `auto` | 未配置 | 直接本地，`reason` 记「网关未配置」 |
| `auto` | 可用 | 远程；全部失败回落本地 |

`route` 键为 `gateway.route.<能力id>`，默认 `auto`，env 名 `GATEWAY_ROUTE_<能力ID大写>`。

⚠️ 上表是**允许本地兜底**的能力（本地实现是真实像素算法）的行为。`allowsLocalFallback(def)`
为 `false` 的能力 —— 创意生图 / 局部重绘 / 图片翻译 / 自由创作，本地**没有实现**（2026-10-22 已删除全部占位算法）—— **不回落**：
通道未配置或全部失败时路由器抛 `NoModelChannelError`，任务落 `failed/42204` 并原额退款，
**绝不交付占位图**；对它们 `route=local` 也视为不可用（配置与能力策略冲突时以不交假图为准）。

2026-10-22 起这种「不可能成立的组合」**在保存时就被拒**：`ModelConfigService.updateAll()` 的
`validate()` 对 `gateway.route.<id>=local` 交叉校验 `allowsLocalFallback()`，本地无实现的
能力返回 `40001`（此前只校验取值是否属于 `auto/local/remote`，于是运营能把它存进去 ——
后台回「保存成功」，C 端却变成 `runtime.effective=unavailable`、`route=local`、
`remoteAvailable=true`，只能靠一条诊断串才发现是配置压死了可用通道）。
后台「逐能力路由」的 `routes[].localAvailable` 与 `allowsLocalFallback()` 同源，
前端据此把 `local` 选项置灰。**env 侧不受该校验约束**（`GATEWAY_ROUTE_<ID>` 由运营直接注入），
此时 `runtime.reason` 会如实说明「已被配置为强制本地（请改为 auto 或 remote）」。

### 5.2 调度算法（`channel-scheduler.ts`）

1. `readChannels(modality)`：`ModelChannel` 表按 `priority` 升序。
2. 表空时：若该模态 `enabled`，用 `gateway.<modality>.*` 合成一条 `synthetic:<modality>` 通道（只在读时存在，不落库）。
3. 逐条尝试：冷却中（`cooldownUntil > now`）跳过；`run(channel)` 抛异常即失败，继续下一条。
4. 成功：`failCount=0`、清冷却、记 `lastSuccessAt`，立即返回。
5. 失败：`failCount+1`；达到 3 次 → 冷却 `max(30s, pollMs×5)`；全部失败返回 `attempts[]` 摘要。
6. 路由器把 `attempts` 折叠成一行写进 `ModelCallLog.reason`（每条通道各自的原因），再决定是否回落。

### 5.3 凭据注入

调度选中通道后，路由器调 `gateway.withChannel({ baseUrl, token, model })`，provider 优先用通道级凭据，其次全局配置。没有这一步，切到第二条通道仍会请求第一家的地址 —— 这是「假多渠道」。

## 6. 协议矩阵

| 模态 | 协议 | 形态 | 端点 | 尺寸写法 | 参考图 | 默认模型 |
| --- | --- | --- | --- | --- | --- | --- |
| image | `openai` | 同步 | `POST {base}/v1/images/generations` | 宽×高 | 最多 3，base64 data URL | `gpt-image-2` |
| image | `volcengine` | 同步 | `POST {base}/images/generations`（base 含 `/api/v3`） | `1K/2K/4K` 档位 | 最多 10，公网 URL | `doubao-seedream-5-0-pro-260628` |
| image | `minimax` | 同步 | `POST {base}/v1/image_generation` | `aspect_ratio` | 最多 1，公网 URL | `image-01` |
| text | `openai-chat` | 同步 | `POST {base}/v1/chat/completions` | 不适用 | 协议层 0 张；多模态由 content 数组传 base64 | `gpt-4o` |
| video | `minimax-video` | 异步四段式 | `POST /v1/video_generation` → `GET /v1/query/video_generation?task_id=` → `GET /v1/files/retrieve?file_id=` → 下载 | 时长/分辨率枚举 | 首帧 `first_frame_image`（公网 URL） | `MiniMax-Hailuo-2.3` |

响应与错误差异（实测）：

| 协议 | 成功字段 | 错误字段 |
| --- | --- | --- |
| `openai` / `volcengine` | `data[0].url` 或 `data[0].b64_json` | `error.message` |
| `minimax`（图） | `data.image_urls[]`（`data` 是对象） | `base_resp.status_code`，**HTTP 200 也可能是失败** |
| `openai-chat` | `choices[0].message.content`（兼容数组分块） | `error.message` |
| `minimax-video` | 轮询 `status`（首字母大写）→ `file_id` → `file.download_url` | `base_resp.status_code` |

**格式一律按字节魔数判定**（`image-format.ts` / `video-format.ts`），不看 URL 后缀 —— 多家返回无扩展名或带签名参数的链接。

**遮罩（局部重绘）按 `maskSupport` 声明**（2026-10-22）。`ProtocolSpec.maskSupport` 是必填字段，取值 `edits` | `none`，没有默认值 —— 强制每个协议显式做一次决定，而不是让「没写」被当成「不支持」或「支持」。

| 协议 | `maskSupport` | 端点 / 说明 |
| --- | --- | --- |
| `openai` | `edits` | `POST {base}/v1/images/edits`，multipart：`image`、`mask`、`prompt`、`size`、`n`；响应 `data[0].b64_json` 优先、`url` 兜底 |
| `volcengine` | `none` | Ark 的 `images/generations` 没有 mask 字段 |
| `minimax` | `none` | 同上 |
| `openai-chat` | `none` | 文本协议没有像素可涂 |

遮罩语义按 OpenAI 文档：**mask 的全透明区域（alpha=0）= 要重绘的位置**，故遮罩是「白底 + 透明洞」，且必须与输入图同尺寸。其它厂商若采用相反约定（黑/白区域表示重绘），需另立取值并显式转换，**不要在协议实现里猜**。

**不支持遮罩的通道不得忽略遮罩**：调度器遇到 `maskSupport !== 'edits'` 的通道直接跳过（抛 `MaskUnsupportedError`，不真发请求 —— 发了可能被对方「接受并忽略」），全部通道都不能接收时判任务失败 `42205` 并退款。理由：忽略遮罩的后果是整图重绘，用户涂了包装盒却看到整张图被改，界面还显示成功。

> 存量通道的 `protocol` 可能是历史别名 `modelverse`，故判断遮罩能力必须走 `protocolSpec()`（内部先解别名），不要直接 `PROTOCOL_SPECS.find(...)`。

## 7. 厂商目录

| 厂商 key | 展示名 | 图像 | 文本 | 视频 | 基址 |
| --- | --- | --- | --- | --- | --- |
| `modelverse` | 优云智算 ModelVerse | `openai` | `openai-chat` | — | `api.modelverse.cn` |
| `siliconflow` | 硅基流动 SiliconFlow | `openai` | `openai-chat` | — | `api.siliconflow.cn` |
| `openai` | OpenAI 官方 | `openai` | `openai-chat` | — | `api.openai.com` |
| `volcengine` | 火山方舟 | `volcengine` | — | — | `ark.cn-beijing.volces.com/api/v3` |
| `minimax` | MiniMax | `minimax` | — | `minimax-video` | `api.minimax.io` |
| `deepseek` | DeepSeek | — | `openai-chat` | — | `api.deepseek.com` |
| `moonshot` | Moonshot 月之暗面 | — | `openai-chat` | — | `api.moonshot.cn` |

- 一家厂商一条 `VendorDef`，跨模态共享基址与凭据；`vendor.presets.ts` 派生「模态 × 厂商」视图供后台下拉。
- DeepSeek / Moonshot **只进文本通道**：其「OpenAI 兼容」仅指 `/v1/chat/completions`，没有图像生成端点。
- 装配期 `assertCatalogIntegrity()` 校验协议/厂商标识唯一、通道引用的协议存在、派生 key 不重复。

## 8. 配置体系

### 8.1 键结构

| 范围 | 键 | env 名 | 默认 |
| --- | --- | --- | --- |
| 每模态 | `gateway.<m>.baseUrl` | `GATEWAY_<M>_BASE_URL` | 空 |
| 每模态 | `.token` / `.model` / `.vendor` | 同上后缀 | 空 |
| 每模态 | `.provider` | `GATEWAY_<M>_PROVIDER` | image/video `openai`；text `openai-chat` |
| 每模态 | `.enabled` | `GATEWAY_<M>_ENABLED` | false |
| 每模态 | `.timeoutMs` / `.pollMs` / `.maxPolls` | 同上 | 图/文 120000/2000/60；视频 600000/2000/300 |
| 每能力 | `gateway.route.<capability>` | `GATEWAY_ROUTE_<CAPABILITY>` | `auto` |
| 全局 | `asset.publicBase` | `ASSET_PUBLIC_BASE` | 空（回落 `http://localhost:<PORT>`） |

### 8.2 优先级与回落

```
env（非空才生效） > ModelChannelConfig（overridden=true） > CONFIG_DEFS.default
```

- **存量键回落**：image 模态的新键全空时，读旧单前缀 `gateway.baseUrl` / `GATEWAY_BASE_URL` 等。旧键只在 image 上存在，且 `hidden=true` 不可写。
- **开启判定**：`ENABLED` 强制开 > 基址或令牌非空即视为开启。零配置 = 全部走本地/未接入。
- **凭据**：读取只给 `hasValue` + 脱敏尾巴；写入空串 = 保持原值，清空需显式 `clears`。
- **基址只存厂商根域**：`/v1` 一律由协议层补（`openai` → `/v1/images/generations`，`openai-chat` → `/v1/chat/completions`），运营照抄厂商文档填 `https://api.x.com/v1` 会拼成 `/v1/v1/...` → 上游 404 `api_route_not_found`，而生成侧只报「通道全部失败」。归一化在 `providers/base-url.ts` 的 `normalizeBaseUrl()`，**每个读写边界都调用**（env 注入、`ModelChannel` 读写、`ModelChannelConfig` 全局设置、草稿测试/模型清单），只剥尾部一整段 `/v1`（`/api/v3` 与路径中段 `/v1/gw` 保留）；格式错误（非 URL / 非 http(s)）仍拒绝。厂商目录内置基址另有装配期 `assertCatalogIntegrity()` 拦截。
- **热生效**：保存后 `reloadRuntime()` 重拉 DB 覆盖并失效缓存；另有 3s TTL 兜底。

### 8.3 后台接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/model-config` | 分组配置 + 三模态通道快照 + 逐能力路由 |
| PATCH | `/api/v1/admin/model-config` | 批量写配置；立即生效；写审计 |
| POST | `/api/v1/admin/model-config/test` | 单模态连通性探测（不发真实生成） |
| POST | `/api/v1/admin/model-config/test-all` | 三模态依次探测 |
| GET | `/api/v1/admin/model-config/vendor/:key/fill-plan` | 选厂商 → 各模态基址/协议/模型的填充方案（不含令牌） |
| GET | `/api/v1/admin/model-calls` | 调用流水 + 聚合统计 |
| GET | `/api/v1/admin/model-calls/:id` | 单条详情（完整提示词） |
| GET | `/api/v1/admin/model-channels` | 三模态线路快照：调度来源 + 健康计数 + 线路列表 |
| POST/PATCH/DELETE | `/api/v1/admin/model-channels*` | 新增/修改/删除线路、`/move` 排序、`/materialize` 固化旧配置（`channel.route`） |
| POST | `/api/v1/admin/model-channels/:id/test` | 测已保存线路（`channel.test`，不写健康状态） |
| POST | `/api/v1/admin/model-channels/models` | 拉取厂商模型清单：内置预设 + 用线路令牌实时请求协议的 `modelListEndpoints`（`channel.test`；令牌不落库、不进审计） |
| POST | `/api/v1/admin/model-channels/test` | 测草稿（未保存也能测，令牌三种语义） |
| POST | `/api/v1/admin/model-channels/test-all` | 全部线路并发探测（上限 4） |

## 9. 请求时序

### 9.1 图像

```
generate.service.create
  → CreditPriceService.resolve(capability) → CreditService.consume
  → GenerationTask(running, creditCost 快照)
  → 异步 execute:
      StorageService 读输入素材 Buffer → 临时目录物化（provider 契约是磁盘路径）
      → getCapability(capability).modality 分流
      → CapabilityRouterProvider.generate
          → refreshConfig()（拉 ModelChannelConfig 覆盖值）
          → route=local / 未配置 → LocalImageProvider
          → 否则 scheduler.dispatch('image', run)
              → factory(protocol) → withChannel(creds) → provider.generate
                  → 协议层拼端点/尺寸/参考图 → HTTP
                  → 响应解包 → 下载 → 魔数判格式
          → 成功：ImageOutcome(gateway)；全失败：回落 Jimp(local, fallback=true)
          → ImageCallLogger.logSuccess/logFailure
      → 终止检查（status 仍为 running？）
      → 按 mime 推导扩展名 → StorageService.put → Asset
      → task(succeeded, outputAssetId, provider=gateway|local)
```

### 9.2 文本

```
prompt-tools.service（polish / image-to-prompt）
  → TEXT_PROVIDER.generate
      → refreshConfig()
      → 未配置：写 ModelCallLog(failure) → 抛错（无本地兜底）
      → scheduler.dispatch('text', run)
          → openai-chat provider：content 数组（纯文本或多模态 base64）
      → 成功：TextOutcome；失败：写 ModelCallLog(failure) → 抛出
  → 控制器转 502 + 可读文案
```

### 9.3 视频

```
generate.service（modality=video）
  → VIDEO_PROVIDER.generate
      → refreshConfig()
      → 未配置：写 ModelCallLog(failure) → 抛 GatewayUnavailableError（无本地兜底）
      → scheduler.dispatch('video', run)
          → minimax-video provider
              ① POST 提交 → task_id
              ② GET 轮询（status 大小写不敏感）→ Success 时取 file_id
              ③ GET 取下载地址 → file.download_url
              ④ 下载字节 → sniffVideoFormat
      → 成功：VideoOutcome(buffer, format, durationMs)
  → generate.service 按 mime 落盘 .mp4、Asset.durationMs、task.provider=gateway
```

## 10. 失败与观测

### 10.1 回落矩阵

| 模态 / 能力 | 通道未配置 | 通道调用失败 | 产出形态 |
| --- | --- | --- | --- |
| image（本地是真实算法） | 本地 Jimp，`reason=网关未配置` | 全部通道失败 → 本地 Jimp，`fallback=true` | 始终有图 |
| image（本地没有实现：创意生图 / 局部重绘 / 图片翻译 / 自由创作） | 抛错 → 任务失败 `42204` | 抛错 → 任务失败 `42204`，附每条通道原因 | 无产出，绝不交付占位图 |
| text | 抛错（502） | 抛错（502），附每条通道原因 | 无产出 |
| video | 抛错（任务失败） | 抛错（任务失败），附每条通道原因 | 无产出 |

失败还会触发**积分原额退还**：按 `GenerationTask.creditCost` 快照退，退到新的永久批次；退还失败打 `★资损` error 日志。

### 10.2 `ModelCallLog`

| 字段 | 含义 |
| --- | --- |
| `capability` / `ownerId` | 能力 / 用户（无外键，注销后保留） |
| `route` / `source` / `fallback` | 路由决策 / 实际来源 / 是否回落 |
| `reason` | 回落或失败原因（截断 300 字） |
| `model` / `modality` | 实际模型 / `image` / `text` / `video`（历史记录为 null） |
| `prompt` | 提示词（截断 500 字） |
| `durationMs` / `success` / `errorCode` | 耗时 / 成败 / 错误码 |
| `outputBytes` / `width` / `height` | 产出大小与尺寸（文本用 UTF-8 字节数近似） |

后台「调用记录」只读、不提供删除；「模型配置」按模态展示 `effective = gateway | local | none` 三态 —— `none` 明确表示**没有本地兜底、会失败**，不允许把视频/文本谎报成「本地算法」。

## 11. 数据模型

| 模型 | 作用 | 关键约束 |
| --- | --- | --- |
| `ModelChannel` | 一条可调度通道：modality/name/protocol/baseUrl/token/model/priority/enabled + 健康状态 | `priority` 模态内唯一 |
| `ModelChannelConfig` | 后台配置覆盖：key/value/hasValue/overridden/updatedBy | key 与 `CONFIG_DEFS` 一一对应 |
| `ModelCallLog` | 每次模型调用明细 | 只 INSERT；`modality` 新写入必填、历史为 null |
| `GenerationTask` | `provider` 记录 gateway/local；`creditCost` 为扣费快照 | 失败/取消按快照退 |
| `Asset` | 产出：`format`、`storageBackend`、`storageKey`、`durationMs` | 视频宽高为 null，时长来自 provider |

## 12. 扩展 SOP

### 新增一项能力

1. `capabilities/definitions/<id>.ts` 导出 `CapabilityPlugin`（含 `modality`、`buildPrompt`、`creditCost`；image 必须有 `localImpl`）。
2. `definitions/index.ts` 注册。
3. 装配期断言自动检查提示词/积分价/本地实现；路由配置项、DTO 白名单、后台列表自动生成（`verify-capability-extensibility.ts` 19 项）。

### 新增一家厂商

1. 在 `VENDOR_CATALOG` 加一条 `VendorDef`，通道只引用已有协议标识。
2. 无需改任何协议实现或路由器；装配期校验引用不悬空。
3. 后台「厂商预设」自动出现；同一家的多模态共享基址。

### 新增一种协议

1. `protocol.spec.ts` 加一条 `ProtocolSpec`（图/文）或 `VideoProtocolSpec`（视频）。
2. 图像同步协议：继承 `BaseImageProvider`，一行构造；异步协议：参照 `GatewayImageProvider` 自管轮询。
3. `provider-factory.ts` 加一行映射（或路由器 switch，文本/视频各有自己的 pickProtocol）。
4. 同步协议选择器/后台协议下拉自动出现；新增后跑 `verify-architecture-layers` 与 `verify-vendor-aggregation`。

## 13. 现状与已知边界（2026-10-20）

### 已在同一轮修复

| 问题 | 修复 |
| --- | --- |
| 视频生成 `cfg is not defined` | `minimax-video.provider.ts` 改用 `creds.baseUrl`；`global.timeoutMs` 改为 `this.cfg.timeoutMs`。`verify-video-pipeline.ts` 38/38 |
| 多渠道未接线 | `ChannelRepository` 注册并导出；新增 `admin/model-channels` CRUD/排序/测试控制器；管理页「线路管理」可直接配置主备线路 |
| 停用线路仍被调度 | `readChannels()` 先查全量行、再在内存过滤 `enabled`；全部停用时返回「均已停用」，**不会回落合成旧配置** |
| 后台文案与事实相反 | 视频协议描述改为 `minimax-video`；能力数量、视频「无实现」等注释同步 |
| 连通性测试把 POST-only 端点误判为不存在 | OPTIONS/GET 都 404 时补一次空 body POST；404 才判不存在，400/401/405/422 视为端点存在。实测 `api.modelverse.cn/v1/images/generations` 由「端点不存在」变为「端点存在 · 模型可用」 |

### 仍需注意

1. **新增文本能力时分流缺口仍在**：`generate.service.ts` 只分 `video` 与「其余走图像」。当前没有文本能力，所以无害；若新增 `modality: 'text'` 的能力，必须补第三分支，或让路由器按能力自身模态统一分派。
2. **线路接管后旧配置不再参与**：某模态一旦有 `ModelChannel` 行，调度只读线路表；旧 `gateway.<modality>.*.baseUrl/token/model/provider` 仅保留在「全局设置」供对照。`TIMEOUT/POLL/MAX_POLLS` 仍按模态生效。页面已在两处常驻提示。
3. **运营测试权需要重跑角色种子**：`ROLE_PERMISSIONS.operator` 已加入 `channel.test`，但已有 `AdminRole` 行不会自动更新；部署后执行 `npm run seed:roles`（或在后台角色权限页勾选）。
4. **合成线路的固化会复制环境变量中的令牌进 DB**：这是旧配置在固化后继续工作的必要条件；后台确认弹窗已明确说明。
5. **测试不等于真实生成**：连通性测试只做 OPTIONS/GET 探测与模型名校验，不更新 `failCount/cooldownUntil/lastSuccessAt`；健康状态只由真实生成调用维护。

## 14. 验证结果（2026-10-20 实测）

| 脚本 | 结果 |
| --- | --- |
| `verify-architecture-layers.ts` | 通过 35 项：依赖方向单向、协议形状单一来源、转发层不声明数据 |
| `verify-capability-extensibility.ts` | 通过 19 项：新增能力只需 definitions + index |
| `verify-modality-config.ts` | 通过 78 项：三模态配置解析 |
| `verify-vendor-aggregation.ts` | 通过 143 项：厂商聚合与重构前 9 条预设逐字段一致 |
| `verify-channel-scheduler.ts` | 通过 58 项：顺序调度、失败转移、熔断、恢复、停用过滤、全停用不复活旧配置、快照计数 |
| `verify-channel-test.ts` | 通过 39 项：草稿 override、令牌三种语义、来源标记、POST-only 端点识别 |
| `verify-failover.ts` | 通过 8 项：主通道 500 → 备用 200，且备用请求真的用了自己的 baseUrl/token/model |
| `verify-video-pipeline.ts` | 通过 38 项：四段式契约、状态归一、格式魔数 |
| `smoke-model-channels.js` | 通过 20 项：线路 CRUD、token 保持/清除、排序、测试形状、sourceAfter、401 |

## 15. 相关文档

- 三环境与变量矩阵：`docs/environments.md`
- 后台设计：`docs/admin-*.md`（模型配置 / 调用记录在产品侧的定义）
- 商业域（积分扣费与退款）：`docs/commerce-design.md`
- 能力契约：`CLAUDE.md` 的「能力清单」与「生成通道」两节
