# 运行时基础设施

> 贯穿所有业务的横切能力：AIGC 标识、签名 URL、限流、健康检查、请求追踪、日志落盘。这些都是「每张图 / 每个请求都会经过」的代码，改动的代价高于普通业务模块。
> 相关变量在 `docs/environments.md`「安全与合规」一节维护，本文件只写行为。

## 1. AIGC 标识

| 能力 | 实现 | 关键约束 |
| --- | --- | --- |
| 隐式标识 | `common/aigc-label.ts` | 图像 PNG 插 `tEXt`+`iTXt`(XMP)、JPEG 插 APP1 XMP，**逐 chunk 重算 CRC32**；声明 `DigitalSourceType=trainedAlgorithmicMedia`（GB 45438-2025）。**顺序必须先合成角标再写元数据**，反过来会打乱偏移损坏图 |
| 角标样式 | `common/aigc-label.config.ts` + `aigc-label/aigc-label.service.ts` | 默认值 `AIGC_LABEL_DEFAULTS`（`enabled` 开关 + 文案/字体/字号/字重/字距/字色/底色+不透明度/圆角/内边距/圆点位 `dotColor`/四角位置/缩放百分比/宽高上下限/边距/整体不透明度）。运行期由后台「AI 标识」页覆盖，3s 缓存 + 保存即 `invalidate()`；**读失败回退默认值不抛错**（配置读不到也要能打标识）。`enabled` 不进 `specKey`（不影响位图） |
| 角标位图 | `scripts/gen-aigc-label.mjs` → `common/aigc-label-badge.ts`（内置默认）+ `AigcLabelConfig.pngBase64`（后台自定义） | Jimp 内置字体只有 ASCII，中文角标**必须**是预渲染位图。内置默认由 Playwright + 系统 Chrome 生成（`tsc` 不复制图片，运行时读路径必 ENOENT），改内置文案/配色须重跑脚本；后台改样式则由**浏览器 Canvas** 现场渲染 PNG 存库（零字体依赖），服务端只做缩放/定位/透明度合成。`specKey` 只哈希渲染字段，样式改了但位图未重存会被标 `stale`（仍用它，后台提示重存） |

### 1.1 两条失败策略刻意不对称

别「统一」掉：

- 显式角标失败 → 任务 `failed / 42203` 并退款，未标识产出**不落库**（**fail-closed**）。
- 元数据写入失败 → 告警但仍落库（**fail-open**，不该因元数据丢了用户的图）。

视频没有 ffmpeg，只写 API 字段 `aigc.method='api-only'` + 前端播放器角标。

### 1.2 可见角标可配置、也可整体关闭

- 外观项（文案、字体、字号、字重、字距、字色、底色与不透明度、圆角、内边距、圆点色、位置、缩放、边距、整体不透明度）全部走后台配置；`enabled`（默认 `true`）控制是否在产出图上合成角标。`dotColor` 为空串表示不画圆点（文案仍在）。
- 改配置属高危动作：权限 `setting.write`，必须填原因，写 `AdminAuditLog`（`aigc.label_update`）。
- 关闭只停用**显式**标识：隐式标识照常写入，`meta.visible=false` 并带 `warning`。两条守卫不可去掉：
  1. 关闭时若隐式标识写入失败（含 webp/gif 这类无写入路径的格式），**抛 `AigcVisibleLabelError` 让任务失败并退款** —— 否则等于交付一张完全无标识的 AI 图；
  2. 关闭后产出不重编码（PNG/JPEG 直接插元数据），像素与模型原图逐字节一致。
- 按《人工智能生成合成内容标识办法》，显式标识属法定义务，默认保持开启；关闭入口与风险提示在后台页面显式呈现。

## 2. 签名 URL

`common/signed-url.service.ts` + `signed-asset.middleware.ts`：HMAC-SHA256(`key|exp[|uid]`)，`ASSET_SIGNING_SECRET` 为空 = 保持公开。

- **`sourceUrl` 保持干净，另发 `signedUrl`**；展示字段走 `displayUrl()`，前端统一 `assetSrc()`。
- 签名关闭时 `signedUrl` 为 `null`，前端自动回落。
- 生产档：密钥为空只 WARN（提醒素材公开），**长度不足 32 字符直接拒绝启动**。

## 3. 限流

`common/rate-limit.guard.ts` + `@RateLimit`：单机内存固定窗口，单请求可挂多条规则同时生效；超限返回 `42901` + `Retry-After`。

- **默认不信任 `X-Forwarded-For`**，`RATE_LIMIT_TRUST_PROXY=1` 才信任 —— 否则伪造一个头就等于没有限流。
- 单机计数，多实例各算各的；要做全局配额必须换 Redis（本轮不做）。
- `POST /api/v1/test/rate-limit/reset` 是**测试专用**：`NODE_ENV!=='test'` 返回 404（不承认存在），且需 `x-test-token` == `RATE_LIMIT_RESET_TOKEN`。它只把限流窗口从「进程生命周期」收窄成「脚本作用域」，断言仍打在同一个 guard 上 —— 不是把限流测掉了。

## 4. 健康检查

`health/`：`/health` 分项（db / storage / channels，存储探测缓存 30s）、`/health/ready` 只看 DB，未就绪返回 503。两者均免登录，供容器探针与外部监控使用。

## 5. 请求追踪

`common/request-context.ts`：`AsyncLocalStorage` 贯穿 `requestId`。

- 响应头回写并**回显客户端合法值**；异常信封带 `requestId`。
- 日志统一 `[rid=...]` 前缀 —— **过滤器里不要再加一次**，否则同一条日志出现两个。

## 6. 日志落盘（AppFileLogger）

应用层自己管文件，不依赖 `start.sh` 的 stdout 重定向 —— 后者每次启动会 `: > backend.log` 清空现场。

| 能力 | 实现 |
| --- | --- |
| 落盘 | `<LOG_DIR>/app-<日期>.log`（全量）+ `app-<日期>.error.log`（仅 error/fatal） |
| 轮转 | 跨日换文件；单文件超 `LOG_MAX_FILE_MB`（默认 20）切到 `app-<日期>.<n>.log`，当日分片数上限 `LOG_MAX_FILES_PER_DAY`（默认 5），用尽后复用最后一片 |
| 保留 | `LOG_RETENTION_DAYS`（默认 14）天，启动时 + 每日首次写入时清理；只删符合自家命名的文件 |
| 脱敏 | 写入前打码 `token/secret/password/api_key/authorization/Bearer`，任务 id 一类短标识不误伤 |
| 双写 | `LOG_CONSOLE`（默认 `true`）时同时输出控制台，不破坏 `.run/backend.log` 这条既有排错路径 |
| 降级 | 目录不可用 / 写失败 → 静默降级为纯控制台，绝不因日志故障打挂业务 |

用 `fs.appendFileSync` 而非 `createWriteStream`：stream 缓冲在 `kill -9` 时会丢，而「进程崩了」正是最需要日志的时刻。

**注册方式不可改**：`AllExceptionsFilter` 由 AppModule 的 `APP_FILTER` 注册（需要注入 logger 才能落盘），`main.ts` **不得**再加 `useGlobalFilters`，两者并存会执行两次。`ResponseInterceptor` 无 DI 需求，仍走 `useGlobalInterceptors`。

**未做**：`process.env.X` → `ConfigService` 的全量收敛。当前两者并存且语义等价。

## 7. 相关文档

- 变量矩阵（`ASSET_SIGNING_SECRET` / `RATE_LIMIT_*` / `ERROR_WEBHOOK_URL`）：`docs/environments.md`
- 响应信封与错误码：`docs/api-contract.md`
- 渠道（邮件 / 短信）适配器：`docs/environments.md`「邮件 / 短信通道」
