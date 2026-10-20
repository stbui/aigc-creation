# aigc-creation 项目长期记忆

> 过程细节见 `.workbuddy/memory/YYYY-MM-DD.md`；本文件只留**跨会话仍成立**的判据。

## 硬边界

- 未经用户授权不得读 `/Users/bright/github/aigc` 源码（VOZEB_PRO 上游，独立工程）；`~/github/` 其他同级仓库默认一律不读。越界结论标「来源不合规，需重新取证」。
- 上游代码是唯一事实源，不信 doc/注释；动手前重读目标代码 + Prisma schema 验字段。

## 验证方法论

- 类型验证必须 `tsc` / `ts-node -P`（`-T` 只转译不校验，会全绿漏错）；后端全量 tsc 2~4 分钟 → `run_in_background`；`nest build` 被安全守卫拦，`npx tsc -p tsconfig.json` 等价替代。
- 沙箱内后台进程一律无法存活 → 「起服务 + 打请求」放同一进程（NestFactory.create → listen → fetch 自查）。
- e2e 失败先分「我的改动」与「环境陈旧」，后者需独立证据（直接对源码求值）；grep 对本仓部分文件会漏匹配，断言「代码里没有」前用 Read 复核。
- zsh：未加引号变量不分词、glob 未命中中止整行、无 timeout；循环用数组，取退出码不加管道。

## 断言纪律

- 红了对齐先问「实现错还是基线错」：基线必须来自独立证据（行号/上游实拍/git 历史），不能与被测对象同源推导。
- 回归防护型基线逐字锁死；总量型基线不锁死，新增条目走白名单显式登记。
- NestJS POST 默认 **201**；状态语义断言 DOM class 不截图比对，且先跑红验证测试有效。
- 破坏性 flag 验证不与功能回归混跑；先 dry-run；计数不符第一嫌疑是并发会话。
- 第三方数据不可信：图片格式按字节魔数判定（`sniffImageFormat`）；base_url 一律存根域、`/v1` 由 provider 补；测试图用 Jimp 生成。
- 配置默认值只能有一处，测试显式声明被测配置；旧键改名/分前缀后必须以 `hidden` 留在声明表供反查（是运行时依赖，非死代码）。
- 「配置不对」类异常必须在 try 内走回落路径并写 `ModelCallLog.reason`；扣费在建任务前、失败退新永久批次（`updateMany.count` 为闸）、建任务失败补偿退还且补偿失败打 ERROR。
- 金额/字段断言写错先怀疑断言：先问「哪些东西会合法地改这个数」（券/限时价/会员折扣），先确认字段真在返回视图里。

## 并发会话

- 另一会话会持续改同一仓库：重复 import、装饰器/整块插错位置、Service 中途加依赖。以文件内容与时间戳为准，不凭记忆推断归属；半成品代码最小绕开不擅改，用户说「修复错误」即显式授权。

## 迁移与批处理纪律

- 源文件在新机制验证通过前不能动；正则批量改码前先在副本验证（`[^,]+` 会吃换行吞括号）；清理生成产物按名单删，不通配删。
- 架构重构必须留转发层；三层分层（统一能力/厂商/协议）用读 import 的断言钉住；非上游修改标【新增扩展·非上游语义】并记录 docs/non-upstream-extensions.md；K3 债务先裁定 → 偏差清单 → 获批再改码。

## 业务约束

- 文本/视频模态无本地兜底，失败如实抛错（不得编模板文案/占位素材）；图片传视觉模型必须 base64 data URL。
- 产出模态与存储扩展名按 mime 推导，不查能力注册表、不按「png 用 png 其余 jpg」猜。
- Asset 表无原始文件名字段，搜索只能匹配 sourceUrl；后台清理刻意不含 Asset/GenerationTask（个人数据走注销匿名化）。
- 新增 npm 依赖精确锁定（无 ^ ~），package.json 与 package-lock.json 两处一起改。
- 长脚本加 fetchRetry：只重试网络层失败（fetch 抛异常），不重试 4xx/5xx。

## 环境与产品裁定

- 本项目用 `prisma db push` 而非 migrations（无 migrations 目录；`migrate dev` 会要求 reset 丢数据）；改 schema 前先备份 dev.db，push 后 `prisma generate`。
- ModelVerse：`gpt-4o-mini`（支持 base64 识图）/ `gpt-5` 可用，其余 400；text 模态必须写 `gateway.text.*`（旧 `gateway.*` 只对 image 生效）。
- seed-admin 账号是 `admin@huojue.local`（非 admin@demo.com）；Vite 必须代理 `/uploads`（否则 200 + text/html 破图）。
- `mode:'real'` 只表示「已接入真实实现」，单次走云端还是本地以 `task.provider` 为准。
- 手机上传 = 二维码会话制（create/status/cancel/receive）。
- 参考站取证：线上 CSS 产物是尺寸最可靠来源；bundle 可反混淆字符串表但 className 动态拼接拼不回；参考站登录墙挡住的态不断言，只登记诚实差异。
- 多选回填契约：onPick 必须显式返回 `void | boolean`，`undefined` 会被当成接受。

## 冒烟脚本必须按模态过滤（2026-10-20 修）

`smoke-capabilities.js` 用 **MockImageProvider（Jimp 本地算法）** 跑能力，产出必须是图片字节。
`modality !== 'image'` 的能力（如 `image_to_video`）**按设计没有 localImpl**
（视频无本地算法兜底，编占位素材会欺骗用户）→ 落到 MockImageProvider 必报
「未声明 localImpl」，**看起来像能力定义坏了，实为脚本与能力模型不同步**。
→ 冒烟按 `def.modality !== 'image'` 跳过并显式打印原因。
（判据：装配期校验早已改为「只有 image 模态要求 localImpl」—— **若运行时兜底与
脚本没跟上，同一个能力会同时"装配通过"却"冒烟失败"**。）

## antd Modal 关闭后 DOM 仍在容器里

判断"弹窗是否关闭"要看 `.ant-modal-wrap` 的 **computed display**（`none`），
不能只看元素是否存在于 DOM —— 否则会误判成"回填后弹窗没关"。

## 参考站 bundle 的路径拼接无法逆向

混淆器把路径拆成「明文片段 + 表项索引伪装」，拼接结果不是真路径；
且参考站对**所有** `/api/design/*` 一律 403（网关层拦截）→ 路径探测法失效。
**做复刻时不需要接口路径细节 —— 线上 CSS 才是布局与尺寸的可靠来源。**
（反混淆只能稳定拿到：文案、DOM 结构语义、方法名、请求头名。）

## 桌面端弹窗与手机端落地页是两套形态

参考站手机上传分两层，**都要复刻**：
- 桌面端 `mobile-upload-modal`：440px 圆角 20 卡片 + 250x250 二维码框 + 等待态 + N 秒后失效
- 手机端 `mobile-upload-page`：渐变背景 + 手机卡片 + **3 列多选网格** + 排序箭头 +
  删除 + 序号角标 + 虚线选择框 + 渐变提交按钮 + 「图片已自动压缩，压缩到 X」

### 断言绿 ≠ 修复有效：必须做「可证伪性检查」

2026-10-20 在模型配置页重设计中踩到：**改完代码断言全绿，但那个"修复"其实没修任何东西**。

经过：`routes` 用 `imageCfg.routeOf()` 看起来像 bug（"视频能力读了图像通道配置"），
改成 `gatewayConfigOf(c.modality)` 后断言 45 项全绿 —— 但复核发现路由键是
`gateway.route.<能力 id>`（**不含模态前缀**，能力 id 全局唯一），
三个通道读同一个键，两种写法行为完全等价。

**两条判据**：
1. **看代码像 bug 不等于 bug** —— 先问「该行为是否**可观测**」。
   若两种写法读出的值必然相同，那它就不是缺陷，改它属于"改了个寂寞"，
   比不改更糟：后人会以为这里曾有坑而反复研究。
2. **写完断言必须故意还原缺陷跑一次**，确认会变红。不红的断言等于没写。
   断言覆盖的对象要与**真正的被测对象**同一层：测 `gatewayConfigOf()` ≠ 测
   `ModelConfigService.readAll()` —— 中间隔一层就会漏掉"service 用错对象"这类缺陷。

> 这与已有的「断言红了先问是实现错还是基线错」互补：
> 那一条管**红**的方向（别改错对象），这一条管**绿**的方向（别假装修了）。

### `setGatewayConfigOverrides` 是**整体替换**不是合并（2026-10-20 踩坑）

```ts
export function setGatewayConfigOverrides(rows: Record<string, string>): void {
  dbOverrides = rows;   // ← 直接赋值, 不是 merge
  invalidateGatewayConfigCache();
}
```
在循环里逐次调用设置多个模态的配置时, **后一次会冲掉前一次**:
表现为「只有最后一个模态生效」, 且**不报错**。
写涉及多模态的测试时: **一次把所有键放进同一个对象**再调一次。

### 转发层只有一层：`src/providers/provider-presets.ts`

架构里的「转发层」指**这个文件**（对既有调用点 re-export 协议层与厂商层）。
`src/providers/vendors/vendor.presets.ts` 是**派生视图**（数据）, 不是转发层 ——
改错了调用方就 import 不到（tsc 报 TS2724「has no exported member」）。

### 连通性探测的三态结论（2026-10-20 确立）

「网络可达」≠「模型可用」≠「无法验证」，三者必须分开报：
- **可用**：模型名在该厂商的模型列表里
- **不可用**：模型名不在 → 报失败**并给出可用模型样例**
- **无法验证**：厂商不提供模型列表 → 明说「未验模型名」，**既不报失败也不谎称可用**

模型列表端点**各家不统一**（DeepSeek `{base}/models` 无 /v1；OpenAI/硅基流动 `{base}/v1/models`），
同一协议服务多家厂商 → 协议层应声明为**候选列表**依次尝试，而非猜一个统一路径
（猜错 = 静默漏检，比不检更坏）。
