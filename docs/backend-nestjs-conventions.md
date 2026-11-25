# 后端 NestJS 代码规范

状态：现行。适用于 `backend/src/**` 与 `backend/plugins/**` 的新增和改动代码。
存量实现与本文不一致时，以「本次改动不扩大偏差」为准，不要求为规范单独重构。

本文件只规定 **NestJS 结构、边界与实现方式**。机器可检查的格式与 lint 规则见
[`code-style.md`](design/standards/code-style.md)，仓库不变量见根 `CLAUDE.md`，鉴权 / 支付 / 上传等安全细节见
[`security.md`](security.md)，数据库约束见 [`database.md`](database.md)。

## 1. 分层与目录

- 按业务域建目录，不按 `controllers/`、`services/`、`repositories/` 做全局横切。
- 一个域至少包含 `<domain>.module.ts`；HTTP 入口用 `<domain>.controller.ts`，业务实现用
  `<domain>.service.ts`。后台接口放 `src/admin/**` 或域内 `<domain>-admin.controller.ts`，
  不得与 C 端控制器共用一个类，避免鉴权链和权限装饰器串线。
- 依赖方向只能指向更底层：`controller → service → Prisma / 其他域的导出 service`。
  Controller 不直接注入 `PrismaService`，Service 不接收 `Request` / `Response`。
- 跨域复用走模块 `exports`，不深引对方内部文件；出现循环依赖时拆叶子 `core` 模块，
  参考 `src/payments/payment-core.module.ts`，不要用 `forwardRef()` 掩盖设计问题。
- 不为 `src/**` 建统一 barrel `index.ts`。后端按具体文件导入，barrel 会放大循环依赖与加载顺序问题。
- `@Global()` 只给真正横切且无业务归属的基础设施；新增全局模块必须在模块注释里说明原因。
  当前先例：`PrismaModule`、`CommonModule`、`ChannelsModule`、`NotificationsModule`。
- 运行时能力、权限、价格、环境变量、数据库结构必须写回各自单一事实源，不在业务代码里复制常量表。

## 2. Controller 职责

- Controller 只做 HTTP 适配：路由、守卫、DTO 绑定、当前用户提取、调用 Service、返回领域结果。
- 业务判断、金额计算、状态迁移、幂等、事务、退款全部放 Service；Controller 不出现
  `prisma.*`、渠道 SDK、文件系统或长时间计算。
- 路由只写相对路径，例如 `@Controller('orders')`；全局前缀 `api/v1` 由 `main.ts` 统一加，
  不在控制器里手写 `/api/v1`。
- 成功响应直接返回数据对象。禁止手写 `{ code: 0, data, message }`，统一由
  `ResponseInterceptor` 包装。
- 只有文件流（CSV / 发票 HTML）和支付回调这类必须直写协议响应的入口才使用 `@Res()`；
  使用处必须有注释说明为什么不能走统一信封。
- `@Body()` / `@Query()` 使用 DTO 或明确的原始类型；禁止 `@Body() body: any` 后在 Service 里猜字段。
  上传同理：`@UploadedFile()` / `@UploadedFiles()` 的参数类型只用官方的
  `Express.Multer.File`（类型来自 `@types/multer`），不手写 `{ buffer?: Buffer; originalname?: string }`
  这类影子结构；Service 只需要其中几个字段时用 `Pick<Express.Multer.File, …>` 投影，
  这样 multer 换版或改字段名时编译期就报错，而不是静默漂移。
  临时目录不自己 `mkdirSync`：官方 `diskStorage({ destination })` 构造时已递归创建。
- 上传的 `storage` / `limits` 需要读配置值时，写在**该控制器所在模块**的
  `MulterModule.registerAsync({ useFactory })` 里，不写在 `@UseInterceptors` 的参数上：
  装饰器参数在类定义期求值，只能直读 `process.env`，于是 import 顺序成了隐式前提。
  两个坑必须知道：`register()` 同样是导入期求值（只有 `registerAsync` 的工厂被推迟）；
  注册在**根模块**的 multer 选项对 feature 模块的拦截器无效（实测），而拦截器拿不到
  `storage` 时会静默回落 memoryStorage —— 装配要连同这条一起被用例锁住
  （参考 `assets/assets.module.ts` 与 `assets/assets-upload.spec.ts`）。
- 当前用户统一用 `@CurrentUser()`；不要从 `req.user` 反复取值，也不要把整个 `Request` 传进 Service。

参考实现：[`orders.controller.ts`](../backend/src/orders/orders.controller.ts)、
[`orders.module.ts`](../backend/src/orders/orders.module.ts)。

## 3. DTO 与参数校验

- 所有写接口必须有 DTO 类，字段用 `class-validator` 声明类型、范围、长度、枚举和可选性。
- 全局 `ValidationPipe` 通过 `AppModule` 的 `APP_PIPE` 注册，已开启 `whitelist: true`、
  `transform: true`；未声明字段会被剥离，因此新增可写字段必须同时补 DTO，
  不能依赖请求体透传。
- `forbidNonWhitelisted` 当前为 `false`；如果需要严格拒绝未知字段，只在接口级单独开启并说明原因。
- 校验消息面向用户，使用中文短句；字段名、内部类型、堆栈不得进入用户文案。
- 数字查询参数优先用 DTO + `@Type(() => Number)`；手工 `Number()` 只允许出现在兼容旧接口的最小改动中。
- 分页参数必须有服务端上限：`limit` 默认 20、最大 100；`offset` 不得为负。前端传值不是可信边界。
- 二选一、互斥、跨字段条件必须在服务端校验；不能只靠前端表单或按钮禁用。
- DTO 默认与使用它的 Controller 同文件；被多个控制器复用时移到本域 `dto.ts`。
  禁止从另一个 controller 文件导入 DTO。

## 4. Service 与领域规则

- Service 方法表达业务动作，例如 `create`、`refund`、`markCompleted`；不要用 `handle`、`processData`
  这类无语义名称。
- 入参用明确的对象类型，不接收 HTTP DTO 原样透传；Controller 负责把 DTO 映射成 Service 入参。
- 业务错误抛 `AppError(code, message, httpStatus)`。错误码按
  [`api-contract.md`](api-contract.md) / [`error-copy.md`](error-copy.md) 分配，
  不把内部异常文本直接返回客户端。
- 状态字段使用 `as const` 数组 + 派生联合类型；状态迁移只走集中状态机。
  现有先例：`BILLING_STATUSES`、`TRANSITIONS`。
- 金额、积分、折扣一律用整数分 / 整数积分或 `Decimal`，禁止浮点累加；订单、账单、任务必须保存快照。
- 写操作要考虑幂等：客户端幂等键、唯一索引或状态条件更新至少命中一项。支付回调重复只入账一次。
- 无可用模型线路、渠道失败或结果不明时，按 `model-architecture.md` 的失败 / 退款 / 人工核对语义处理，
  不允许返回占位图、假成功或本地生成结果顶替。

## 5. 鉴权与权限

- 需要登录的 C 端接口用 `@UseGuards(JwtAuthGuard)`；后台路径由 `AdminModule` 注册的全局
  `AdminGuard → PermissionGuard` 覆盖，后台控制器不重复挂这两个守卫。
- 后台端点默认拒绝：每个处理器声明 `@RequirePermission(PERMISSIONS.x)`；确需身份即可访问时显式用
  `@AdminIdentityOnly()` 或 `@RequireAnyPermissions()`。新增后台路由必须位于 `/admin/**` 之下，
  否则全局守卫会直接放行。
- 权限点只在 `src/admin/permissions.ts` 定义，命名 `<模块>.<动作>`。新增后台路由必须同批补权限点、
  装饰器和前端菜单可见性。
- 资源归属在 Service 内按当前用户校验；越权、未登录、资源不存在按 `security.md` 的语义返回，
  不靠前端隐藏按钮，也不把 403 降级成 404 来“简化”。
- 禁用 / 注销 / 临时密码 / `tokenVersion` 每次请求实时查库，不信任 token 载荷。

## 6. 数据访问与事务

- 业务代码只通过 `PrismaService` 访问数据库；禁止另建连接、直连 SQLite 文件或复制 Prisma Client。
- 查询只 `select` 需要的字段；列表接口避免整行 + 关联全量加载。新增过滤 / 排序字段时同步评估索引。
- 多表写入、积分扣减、订单状态与账单状态必须放在同一事务中；事务内不做网络请求、文件上传或长时间计算。
- SQLite 是单写者：事务尽量短；遇到 `database is locked` 使用既有退避策略，不吞错、不无限重试。
- 手写 SQL 只用于 Prisma 无法表达且经过评审的场景；必须参数化，并在同目录测试覆盖注入边界。
- `schema.prisma` 与迁移归数据线；后端改动需要新字段时走交接，不在业务提交里顺手改 schema。
- 生产结构变更必须走 Prisma Migrate，禁止 `db push`；迁移没有自动 down migration，需要备份、副本演练和恢复步骤。

## 7. 配置、日志与外部调用

- 业务代码通过 `ConfigService` 读配置，不直接读 `process.env`；新增环境变量必须补
  `src/config/env.validation.ts` 的 `ENV_SPECS`、`.env.example` 与 `docs/environments.md`。
- 日志用注入的 `AppFileLogger`，并带稳定 context；禁止 `console.log` / `console.error`（`scripts/` 除外）。
- 日志不得打印密码、令牌、支付密钥、完整请求体、用户隐私或上游凭证；需要关联时用 `requestId`。
- 出站请求统一走现有 outbound / 代理基础设施，遵守 SSRF、超时、重试和响应体上限约束。
- 外部渠道适配器必须区分「确定失败」「结果不明」「可重试」；不得把超时一律当失败重发。
- 后台任务、定时任务和异步副作用必须可追踪；禁止无错误处理的 fire-and-forget Promise。
  必须脱离请求生命周期时显式 `void task.catch(...)` 或交给调度器。
- 周期任务统一用 `@nestjs/schedule` 的 `@Interval` / `@Timeout` / `@Cron`，在 `AppModule`
  引入一次 `ScheduleModule.forRoot()`；不再手写 `setInterval` 与 `onModuleInit` /
  `onModuleDestroy` 配对清理。定时器由调度模块在 bootstrap 挂载、关闭时统一清除，
  任务自身只负责重入保护与错误处理。
- 跨请求缓存统一注入 `CACHE_MANAGER`（`src/cache/cache.module.ts` 的 `CacheModule`），
  不再新增手写 TTL Map；key 带域前缀并显式传 TTL，写操作必须 `del` 对应 key。
  缓存只承载可重建、丢失无副作用的读投影；任务 / 账单 / 积分等事实仍以数据库为准。
  例外：带 stale-while-revalidate、同步读或远端拉取语义的快照（`CapabilityCatalogService`、
  `ProtocolCatalogService`、`ProviderCatalogService`）保留自身实现。
- 注入 `ConfigService` 时使用 `ConfigService<AppConfigValues, true>`（`AppConfigValues`
  由 `ENV_SPECS` 的 `as const` 派生，扁平点号键）；键拼错在编译期报错。值类型仍由
  调用处的泛型标注决定，运行时配置树见 `AppConfigTree`。

## 8. 命名与代码风格

- 文件 `kebab-case`：`order.service.ts`、`payment-webhook.controller.ts`。
- 类 `PascalCase`，Service 后缀 `Service`，Guard 后缀 `Guard`，Filter 后缀 `Filter`，DTO 后缀 `Dto`。
- 变量 / 函数 `camelCase`，常量 `UPPER_SNAKE_CASE`，布尔值用 `is` / `has` / `can` 开头。
- 接口和类型不加 `I` 前缀；跨模块类型放 `types.ts` 或领域类型文件，不散落在 controller。
- 格式跟随根 `.editorconfig` 与 Biome：2 空格、LF、行宽 100、单引号、分号、尾逗号。
- 注释解释「为什么」和边界，不逐行复述代码；复杂取舍、兼容原因和安全理由必须写清。
- 新增代码不得增加 lint warning；禁止 `debugger`，禁止 `const` 重赋值，禁止未处理的可达性错误。
- 不为通过 lint 修改 Prisma 生成物、`dist/` 或 `node_modules/`；单行抑制必须写
  `// biome-ignore lint/<group>/<rule>: 原因`。

## 9. 测试与完成定义

- 单元测试与实现同目录，命名 `*.spec.ts`；纯函数、状态机、金额、权限判断优先单测。
- Service 测试用 Prisma mock 或测试库，覆盖成功、边界、失败、回滚 / 补偿路径。
- HTTP 行为用 L2（同进程 Nest + supertest）验证信封、状态码、错误码、鉴权和 DTO 校验；
  真实渠道、支付回调、上传与部署级验证用 L3 / L4，不以单测替代。
- 涉及能力 / 协议 / 选路 / 计费 / 支付 / 后台 / 安全时，按 `backend/AGENTS.md §5` 补对应
  `verify:*` / `smoke:*`，全部使用 `NODE_ENV=test`。
- 最低门禁：

```bash
cd backend
npm run build
npm test
```

提交前在根目录补 `npm run lint:ci`；涉及全仓约定时跑 `npm run check`。

完成定义：

- 改动落在单一事实源，没有第二份实现、临时兜底或复制常量表。
- DTO、权限点、错误码、响应字段与 `docs/api-contract.md` / `docs/error-copy.md` 一致。
- 失败、退款、幂等、事务和越权路径都有实现与测试，不只覆盖成功路径。
- 交付说明包含 `file:line`、验证命令、关键输出、未验边界；没有证据的项不得写成已通过。

## 10. 已知偏差

以下现状与本文不一致，属于存量债务；新增代码不得继续扩散：

- Controller 内联业务判断：结算试算、下单互斥 / 空单校验、支付币种白名单已分别下沉到
  `MarketingService.quoteSettlement`、`OrderService.create`、`PaymentConfigService.normalizeCurrency`；
  其余存量按改动触达继续下沉，新代码不再写入 Controller。
- 查询参数手工 `Number()`：后台账单 / 商业 / 营销 / 渠道 / 留存与 C 端订单 / 任务 / 积分 / 发票 /
  素材列表已改为 DTO + `@Transform` 数字化；存量单标量 `@Query('x')` 按改动触达收敛。
- 分页上限存在存量差异（100 / 200 / 5000 等），以各 service 的实际 clamp 为准；新接口默认
  20、上限 100，确需更大上限时在 DTO 注释中说明场景。
- 部分模块仍显式导入 `PrismaModule`；因它是 `@Global()`，重复导入不报错，但新模块无需再写。
  （2026-11-24 已清理全部冗余导入，仅 AppModule 保留作为注册点。）
- 少量文件使用双引号或超长行；以本次改动文件为目标逐步收敛，不单独制造全仓格式化 diff。
- 中转链路把 `ServerResponse` 传进 Service（`src/model/proxy/system-proxy.service.ts`、
  `src/model/proxy/custom-relay.service.ts`）：上游 SSE / 流式 body 必须边读边写，
  控制器无法先拿到完整响应再返回，这是 §1「Service 不接收 Request / Response」的唯一例外。
  新增非中转代码不得照搬；普通接口仍由 Controller 持有响应对象。
