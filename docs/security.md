# 安全与权限规范

本文件规定信任边界、鉴权链、密钥与敏感数据、出站请求、上传、支付回调、输入输出与日志脱敏。细节实现以代码为准：`backend/src/common/**`、`admin/**`、`payments/**`、`model/infra/**`。文案层面的内部信息约束见 [`error-copy.md`](error-copy.md)。

## 1. 信任边界与鉴权链

| 边界 | 入口 | 校验 |
| --- | --- | --- |
| 公开 | 登录 / 注册 / 找回密码 / 扫码状态 / 支付回调 / 健康检查 | 限流 + 签名或票据校验 |
| C 端 | `/api/v1/**` 其余接口 | `JwtAuthGuard` |
| 后台 | `/api/v1/admin/**` | `JwtAuthGuard` → `AdminGuard` → `PermissionGuard` |

硬约束：

- **前端 `AdminContext.can()` 只用于隐藏按钮，不是安全边界**；真正的拒绝必须在后端。
- 后台端点**默认拒绝**：未声明权限点的处理器直接 403 并打 ERROR，不降级为「只校验身份」。需要全员开放的端点显式使用 `@AdminIdentityOnly()` / `@RequireAnyPermission()`。
- 权限点定义唯一在 `backend/src/admin/permissions.ts`，命名 `<模块>.<动作>`，当前 68 个。新增后台路由必须同时补权限点与装饰器。
- 身份与状态**每次请求实时查库**：`status`（禁用 / 注销）、`tokenVersion`、`mustChangePassword` 都不能依赖 token 载荷。
- 后台与 C 端使用同一套 JWT 签发逻辑，但守卫分开；后台守卫只处理 `/admin` 路径，C 端请求不进入后台鉴权链。
- 测试辅助端点（`/test/**`）在非 `NODE_ENV=test` 时返回 404，且要求 `x-test-token` 与 `RATE_LIMIT_RESET_TOKEN` 相等；令牌未配置一律拒绝。

## 2. 令牌与会话

- JWT 使用 **HS256**，`JWT_SECRET` 必须在生产显式配置；缺失时生产**拒绝启动**，开发 / 测试回退内置密钥并告警。
- `JWT_TTL` 默认 `7d` 是演示取值；生产应缩短并配套 refresh 机制（当前未实现，属已知缺口）。
- 令牌通过 `Authorization: Bearer` 传递，**不使用 Cookie**，因此没有 CSRF 面；代价是前端存 `localStorage`，XSS 可直接窃取令牌。
- 改密 / 重置 / 注销会自增 `tokenVersion`，旧令牌下一次请求即失效；后台同样执行该校验。
- 后台重置的临时密码：`mustChangePassword` 期间只放行读 `/me` 与改 `/me/password`，过期返回 `40304`。
- 扫码登录：票据只存 SHA-256，扫码 ≠ 授权，兑换一次性；确认前展示发起端 IP 与 UA。
- 第三方登录：`state` / 兑换票据一次性且只存 HMAC；`accessToken` 不进 URL；`returnTo` 只接受站内绝对路径；只有 `emailVerified` 的邮箱才自动绑定已有账号。

## 3. 密钥与敏感数据

| 数据 | 存储 | 密钥 |
| --- | --- | --- |
| 渠道 API Key / Secret / 自定义请求头 | `enc:v1:*` 密文 | `MODEL_SECRET_KEY`（AES-256-GCM），未配置时生成 `data/.model-secret-key` |
| 支付渠道配置 | `enc:v1:*` 密文 | `PAYMENT_SECRET_KEY`，未配置时生成 `data/.payment-secret-key` |
| 后台设置中的敏感项 | `SETTING_DEFS.sensitive` 标记，落库密文 | 同上 `SecretCipher` |
| 素材链接签名 | HMAC-SHA256（`exp` + `sig` + 可选 `uid`） | `ASSET_SIGNING_SECRET` |

规则：

- 新凭证入库前必须加密；接口返回与界面展示只给掩码（保留后 4 位）。
- **模型与支付密钥生命周期解耦**，不共用一把密钥：模型密钥轮换不能导致支付密文失效。
- 密钥不得写进代码、测试快照、日志、错误消息或提交历史；`.env.production` 不入库。
- 生产必须显式配置 `MODEL_SECRET_KEY` / `PAYMENT_SECRET_KEY`。当前未做启动门禁（见 §13），不得依赖自动生成的开发密钥。

## 4. 出站请求与 SSRF

**所有访问上游模型的 HTTP 必须经过 `backend/src/model/infra/outbound.ts`**，不得直接使用全局 `fetch`。

- 只允许 `http` / `https`；禁止 URL 内嵌凭据。
- 域名解析后**逐个 IP 判定**，拒绝 loopback、私网、链路本地、组播、未指定地址；重定向每跳复验，最多 5 次。
- 自定义中转更严格：禁止 fragment；HTTP 只允许部署者显式放行的可信主机；额外拒绝保留网段（`0.0.0.0/8`、`100.64/10`、`198.18/15`、`240/4` 等）。
- 自定义请求头：≤ 32 项、总计 ≤ 16KB；禁止覆盖鉴权、协议、hop-by-hop、`x-canvas-*`、`x-forwarded-*`；值中不允许控制字符。
- 渠道级 `proxyUrl` 只由管理员配置，允许私网与凭据；用户可控的上游不允许走私网。
- 新增出站调用必须复用该边界，并补 SSRF 拒绝路径的测试。

## 5. 上传与文件

- 上传只接受 **PNG / JPEG / WebP**；格式按**文件头字节**判定，不信 `mimetype` 与扩展名。
- 先读尺寸并在 Jimp 完整解码前拒绝超限图片，防解码炸弹。
- 部署级上限：100MB / 200MP；运行期由设置项收紧（C 端当前提示 10MB）。两处口径必须一致。
- 存储 key 含随机段；用户不得控制最终路径；备份与读取使用安全路径校验。
- `/uploads/*` 默认公开；配置 `ASSET_SIGNING_SECRET` 后要求 `exp` + `sig`，可绑定 `uid`。生产未配置时会告警（见 §13）。
- 压缩包读取必须防 zip-slip：解出的路径不得越出目标目录。
- 备份使用 SQLite `VACUUM INTO` 生成一致性快照并记录 SHA-256；**备份文件本身未加密**。

## 6. 支付与回调

- 支付宝：RSA2 验签，签名串按官方规则构造（去空值、去 `sign` / `sign_type`、字典序）。
- 微信 v3：验证 `wechatpay-signature` / serial / timestamp / nonce，再用 API v3 Key 做 AES-GCM 解密。
- 回调处理必须校验：签名 → 订单存在 → 金额 / 币种 / 商户号一致 → 幂等入账。
- 回调入站有处理记录与尝试次数，重复回调走幂等命中，不重复加钱。
- 退款遵循「先校验、再落 `processing`、再调渠道、成功才动本地账」；渠道失败不得只改库。
- 不得信任未验签的回调字段；不得把回调原文直接写进用户可见文案。

## 7. 输入、输出与注入

- 全局 `ValidationPipe({ whitelist: true, transform: true })`；DTO 未声明字段一律丢弃。
- 状态类字段使用 String + DTO 白名单，不用数据库 enum。
- Prisma 参数化查询是默认；`$queryRaw` / `$executeRaw` 只允许标签模板参数化，**禁止字符串拼接 SQL**。
- CSV 导出统一走 `common/csv.ts`：BOM + RFC4180 + 公式注入前导 `'`。
- React 默认转义；`dangerouslySetInnerHTML` 仅允许在受控图表样式中使用，新增使用必须评审。
- `returnTo` / 跳转参数只接受站内绝对路径，拒绝协议相对、反斜杠、控制字符与外链。
- 请求体 JSON / urlencoded 限制 100KB；上传由 multer 与图片校验双层限制。
- 错误响应不得包含堆栈、文件路径、SQL、上游原始报错；按 [`error-copy.md`](error-copy.md) 转换。

## 8. 网络、限流与传输

- CORS 默认只放行本机 5100；`CORS_ORIGINS` 显式白名单优先且**不叠加隐式放行**；无通配符；私有网段需 `CORS_ALLOW_PRIVATE_LAN=1`。
- `trust proxy` 默认关闭；开启前必须确认反向代理会覆盖 `X-Forwarded-For`，否则限流可按伪造 IP 绕过。
- 限流是固定窗口、进程内内存，按用户或 IP；重点保护登录、注册、找回、短信、生成、上传、扫码、OAuth、工单创建。
- 登录 10 次/分钟、找回 3 次/小时、生成 20 次/分钟、上传 30 次/分钟（以代码常量为准）。
- 生产镜像的 Nginx 已加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: strict-origin-when-cross-origin`。
- 生产只监听本机，TLS 在外层反向代理终止；部署方必须负责证书与 HSTS。

## 9. 日志与审计

- 日志落盘前统一脱敏：`Authorization: Bearer/Basic` 与 `token/secret/password/api_key/authorization/credential` 键值对替换为 `***`。
- 脱敏规则顺序不可交换：Bearer 必须先于键值规则匹配。
- 不得记录请求体原文、完整凭证、支付回调密文、用户密码与验证码。
- 请求追踪 id 写入响应头与日志，用于关联排障；错误文案只对 5xx 暴露请求号。
- 新增敏感字段名必须同步扩展脱敏规则，并补一条脱敏测试。

## 10. 新增功能安全检查

- [ ] 新接口属于公开 / C 端 / 后台哪条边界？守卫是否挂全？
- [ ] 后台端点是否声明权限点？是否默认拒绝？
- [ ] 是否引入新的凭证或敏感配置？加密、掩码、日志脱敏是否覆盖？
- [ ] 出站请求是否走 `outbound.ts`？是否可能访问私网？
- [ ] 上传是否校验真实格式、尺寸与体积？路径是否用户可控？
- [ ] 回调是否验签、校验金额与幂等？
- [ ] 输入是否经 DTO 白名单？SQL 是否参数化？
- [ ] 输出是否可能包含堆栈、路径、上游报错或内部标识？
- [ ] 是否新增限流点？窗口与上限是否合理？
- [ ] 新增敏感字段是否补了脱敏与测试？

## 11. 已知缺口

- **令牌存 `localStorage` 且无 CSP**：一旦出现 XSS，令牌可被直接读取；生产 Nginx 未下发 `Content-Security-Policy`。
- **素材签名默认关闭**：未配置 `ASSET_SIGNING_SECRET` 时 `/uploads/*` 公开，生产只告警不阻断。
- **模型 / 支付密钥未做生产启动门禁**：未配置时自动生成开发密钥文件，密钥丢失会导致全部凭证无法解密。
- **备份未加密**：备份文件含用户数据与加密后的凭证，落盘只做 SHA-256 完整性校验。
- **限流为单机内存**：多实例部署时各算各的，需要 Redis 才能做全局限流。
- **无 HSTS**：TLS 由外层反向代理负责，应用与 Nginx 模板未下发 `Strict-Transport-Security`。
- **无自动化安全扫描**：没有 SAST / DAST / 依赖漏洞扫描门禁；`verify:deps:critical` 只校验已知依赖偏差，不等同于漏洞审计。
- **refresh token 未实现**：演示期 TTL 7 天，生产缩短 TTL 后需要配套刷新机制。
