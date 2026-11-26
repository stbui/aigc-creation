# 媒体资产规范

本文件规定上传、生成产出、存储 key、缩略图、签名访问、AIGC 标识与删除保留。安全边界见 [`security.md`](security.md) §5，图片 `alt` 与播放器可访问性见 [`accessibility.md`](design/standards/accessibility.md) §4，AIGC 标识的运行时行为见本文 §6 与 `backend/src/aigc-label/`。

## 1. 资产类型与事实源

`Asset` 是用户素材与生成产出的唯一记录：

| 字段 | 含义 |
| --- | --- |
| `kind` | `original` 用户上传 / `generated` 模型产出 |
| `format` | 完整 MIME，如 `image/png` / `video/mp4` |
| `width` / `height` | 图片尺寸；视频可空 |
| `durationMs` | 视频时长；图片为 `null`，不用 0 冒充 |
| `sizeBytes` | 落盘字节数 |
| `storageBackend` | 写入时的后端：`local` / `oss` / `minio` |
| `storageKey` | 存储内相对路径，**唯一真相** |
| `sourceUrl` | 可访问路径，切换域名/CDN 时由配置派生，不刷库 |
| `status` | `visible` / `hidden`；下架保留文件与记录 |
| `sourceSite` / `sourceTitle` / `sourcePageUrl` | 仅浏览器扩展采集的原图有值，只作溯源展示 |

设置页图片、模板图、发票 HTML 也走存储服务，但不是 `Asset`；它们同样遵守 §3 的 key 与后端规则。

## 2. 允许的格式与上限

| 场景 | 规则 |
| --- | --- |
| 用户上传 | 仅 JPEG / PNG / WebP；按**字节魔数**判定，不信扩展名与客户端 MIME |
| 运行期上限 | `upload.maxSizeMb` 默认 10、`upload.maxPixels` 默认 40,000,000、`upload.allowedTypes` 默认 `jpg,png,webp` |
| 部署硬上限 | 100MB / 200,000,000 像素；运行期配置只能收紧，不能突破 |
| 生成产出 | 按上游字节魔数识别 PNG / JPEG / WebP；视频按 `video/*` 落库 |
| 遮罩 | 必须是 PNG，非 PNG 直接拒绝 |
| GIF | 能识别但不是允许的上传格式；不得当作支持格式对外宣称 |

- 前端提示的 10MB 与后端默认值一致，但**后端始终是权威**；改设置后前端通过 `uploadLimits()` 读取，不写死。
- 新增格式必须同时改：格式白名单、字节识别、前端 accept、上传校验、缩略图、AIGC 标识、文档与测试。

## 3. 存储 key 与后端

key 格式：

```
<prefix>/<category>/<yyyyMM>/<随机>.<ext>          # 云端后端新写入：带可配置前缀
<category>/<yyyyMM>/<随机>.<ext>                  # 本地后端：不带前缀，/uploads 路由即部署契约
generated/task/<taskId>/output-<n>.<ext>          # 生成产出（确定性，重试复用；云端另加前缀）
```

- 类别当前有 `original` / `generated` / `settings` / `templates` / `invoices`。
- `prefix` 取自当前默认后端的 `pathPrefix`（默认 `huojue`）；只影响**新写入**，历史 key 原样保留。
- 生成产出的 key 必须确定性：落盘失败重试时按 `storageBackend + storageKey` 查重，不能每次重写一份。
- key 只允许 `[A-Za-z0-9/_.-]`，禁止 `..`、反斜杠与开头 `/`；解析后的绝对路径必须仍在根目录内。
- 连接参数和凭据只在后台「存储配置」页编辑，**加密落库**（`StorageConfig.configCipher`，AES-256-GCM，密钥复用 `MODEL_SECRET_KEY`），永不回显明文；不读取对象存储环境变量。
- 配置了云端后端但 SDK/凭据缺失时**直接失败，不回落本地**，避免生产数据静默写进容器盘。
- 读取按素材记录的 `storageBackend` 走原后端；切换默认后端不影响历史素材。

### 3.1 云端后端接入（OSS / MinIO）

> 2026-11 变更：凭据由「只读环境变量」改为「页面可编辑 + 加密落库 + 即时生效」。这是对 B-63 既定契约的反转，登记于 `docs/non-upstream-extensions.md`。

`local` 零配置；`oss` / `minio` 走同一套启用流程。后台 `/admin/storage` 卡片点「配置后端 / 编辑配置」打开抽屉，字段由后端 `config.fields` 驱动，密钥留空表示沿用旧值。

**第 1 步 · 装 SDK**。云端 SDK 刻意不进 `package.json` —— 本地开发不该背两个云 SDK 的体积与启动开销。切哪个装哪个（部署期一次，仍需命令行）：

```bash
npm --prefix backend install --no-save ali-oss   # 阿里云 OSS
npm --prefix backend install --no-save minio     # MinIO / S3 兼容
```

`--no-save` 保证不改依赖清单；生产请把对应命令写进镜像构建步骤，否则容器重建后 SDK 又没了。

**第 2 步 · 页面填写配置**。对象存储的连接参数和凭据唯一来源是数据库中的后台页面配置：

- **页面配置（推荐）**：在 `/admin/storage` 对应卡片点「配置后端」，填入连接信息保存，即时生效、无需重启。字段按分组排列（连接位置 → 读取出口 → 服务端凭据 → 高级），由后端字段定义驱动：

  | 后端 | 分组 | 必填 | 可选 / 有默认 |
  | --- | --- | --- | --- |
  | OSS | 连接位置 | `region`、`bucket` | `pathPrefix=huojue`、`endpoint`（服务根地址，留空由 SDK 推导） |
  | OSS | 读取出口 | — | `publicBaseUrl`（CDN / 自定义域名）、`urlExpiresSeconds=3600` |
  | OSS | 服务端凭据 | `accessKeyId`、`accessKeySecret` | `sessionToken`（STS 临时凭证） |
  | OSS | 高级 | — | `autoCreateBucket=false` |
  | MinIO | 连接位置 | `endPoint`、`accessKey`、`secretKey` | `port=9000`、`useSSL=false`、`region=us-east-1`、`bucket=huojue`、`pathPrefix=huojue` |
  | MinIO | 读取出口 | — | `publicBaseUrl`、`urlExpiresSeconds`（留空用 SDK 默认 7 天） |
  | MinIO | 高级 | — | `autoCreateBucket=false` |
  | local | 读取出口 | — | `publicBaseUrl`（服务器访问地址；留空返回 `/uploads` 相对路径） |

  字段语义要点：

  - **`pathPrefix`** 只作用于**新写入**的云端 key，用于同桶多应用隔离。历史素材的 key 原样留在库里，改前缀不会让老图 404；本地盘不加前缀（`/uploads/<key>` 是部署契约）。
  - **`publicBaseUrl`** 是浏览器读取出口：配置后预览走直读、不生成签名参数（CDN 自己处理鉴权）；私有桶不配置时仍走签名 URL。
  - **`endpoint`** 必须是服务根地址，不能包含 Bucket、路径、查询参数或认证信息；不符合时保存直接被拒绝。
  - **`urlExpiresSeconds`** 只影响签发的预览链接，不入库；OSS 默认 1 小时，MinIO 留空沿用 SDK 默认 7 天。
  - **`sessionToken`** 用于 STS 临时凭证；切换厂商时不会沿用另一厂商的 Token。

**先测后存**：抽屉底部「测试连接」用**当前草稿**做真实读写（写 1 字节探针、读回校验、删除），不落库、不切换默认后端；连接字段变化后旧测试结论标记为「配置已变化」，避免拿过期结论背书新配置。

未配置数据库记录时仅启用本地存储。云端后端保存成功后，可在对应卡片点击「设为默认」；默认后端也保存到数据库，重启后保持不变。

**第 3 步 · 验证**：

1. 页面保存配置后即时生效（重建 provider），无需重启；默认后端切换也保存到数据库。
2. 卡片从「未启用」变为已配置，显示脱敏凭据、地址、路径前缀与公开域名；容量分布可核对各后端的实际归属。
3. 卡片「连通性测试」对已保存配置做只读探测 + 写探针读回（OSS `list` / MinIO `bucketExists`，再写 1 字节探针、读回校验并删除），证明 put / get 权限可用。失败消息会带上 Bucket / Region / Endpoint 与失败步骤（写入 / 读回 / 删除）。状态轮询与健康检查**只做只读探测**，不会高频写云。
4. 需要切默认后端时点「设为默认」。切换只影响新上传，历史素材仍按各自的 `storageBackend` 读取。

权限：「编辑配置」「访问地址」「设为默认」需 `setting.write`，「连通性测试」（含草稿测试）需 `channel.test`，查看状态需 `setting.read`。预览链接只用于页面即时预览、不入库 —— OSS 签名按 `urlExpiresSeconds`（默认 1 小时），MinIO 预签名默认 7 天。

**回退**：在页面把默认后端切回「本地磁盘」即可。已写到云端的素材**不会自动迁回本地**；仓库内没有云端 → 本地的自动回迁工具，需要人工迁文件并改 `Asset.storageBackend` / `storageKey`。

## 4. 缩略图

本地 `/uploads/*` 支持按需缩略图：

| 参数 | 行为 |
| --- | --- |
| `?w=640` | 保持纵横比，只限制宽度；极端长图额外限制高度 |
| `?w=640&h=480` | 裁切到指定尺寸（cover） |
| 范围 | 32–1280，默认 640；小于/大于自动夹取 |
| 输出 | JPEG，质量 78；透明图先铺白底 |
| 缓存 | `<UPLOAD_DIR>/.thumbs/<w>x<h|auto>/<key>.jpg`，内容不变，可长期缓存 |
| 并发 | 同时最多解码 2 张；同图同尺寸并发只解码一次 |
| 回落 | 无 `w`、视频、解码失败、云端素材一律返回原文件，不制造 404 |

规则：

- **缩略图默认关闭**（`ASSET_THUMBNAIL_ENABLED=false`，三档 env 均如此）；关闭时前端仍可带 `?w=`，后端忽略并返回原图。素材库首屏性能依赖该开关，生产应按需开启。
- 缩略图只读本地文件；云端后端不经过该中间件，前端对云端 URL 不追加 `w/h`，避免破坏签名。
- 删除素材必须同时清理全部尺寸变体。

### 4.1 写入侧预热（2026-11-14）

按需生成的开销集中在**解码**：用 Jimp 解一张 9MP 手机照片实测 1.0–1.3s，且是同步
占满 Node 主线程（裁切 + 编码再加 0.4–0.7s）。素材库一屏 20 多张、导入选择器首屏取 120 条，
全部按需生成就是「格子一直灰着、图慢慢往外冒」，期间接口一起变慢。

因此缩略图改为**写入侧预热**（`backend/src/assets/thumb-render.ts`）：

| 触发点 | 说明 |
| --- | --- |
| 上传成功（`AssetsService.createOriginal`） | 复用上传校验阶段已解码的位图，只多花裁切 + 编码 |
| AI 产出落库（`task-media.service`） | 产出字节在手里，顺手算出 |
| 手机上传（`mobile-upload.service`） | 手机原图多为 5–12MP，最需要预热 |

- 预热变体固定为前端实际请求的两种：`480×480`（素材库导入弹窗 / 工具页历史）、`640` 保留比例（`/library` 网格）。**改了前端尺寸必须同步 `WARM_THUMB_SPECS`**，否则预热了也用不上。
- 预热是 fire-and-forget：不影响上传 / 落库的成败与响应时间。
- 仅在 `ASSET_THUMBNAIL_ENABLED=true` 且本地存储时执行；开关关闭时缓存没有消费者，不做无谓解码。
- 存量素材一次性回填：`npm --prefix backend run backfill:thumbs`（纯文件系统遍历，`--dir=` 指定目录，`--force` 强制重算）。新素材不再需要它。

前端侧只请求**视口附近**的缩略图（`useNearViewport`，预载 300px）——浏览器原生
`loading="lazy"` 的预载距离达 1250–3000px；导入选择器现在每页只挂载 24 张，仍需收紧预载距离。

## 5. 压缩与元数据

- 用户上传的原图**原样落盘**，不重新编码、不去 EXIF。原图中的 GPS、设备信息会保留（见 §11）。
- 生成图片经 AIGC 标识处理后重新编码：PNG 保持 PNG，JPEG 质量 92。
- 视频不转码、不压缩、不生成封面。
- 缩略图是唯一默认压缩产物。
- 当前没有内容哈希与去重：同一张图重复上传会存多份。

## 6. AIGC 标识

- 图片：写入隐式元数据并叠加可见角标；可见角标样式由后台「AI 标识」页配置。
- 视频：本机没有 ffmpeg，**不写内嵌标识**；`aigcMeta.method='api-only'`，只在接口字段与播放器角标体现。
- 标识失败按运行时策略处理；生成任务不得交付无标识图片而不报错（见本文 §6 与 `backend/src/aigc-label/aigc-label.service.ts`）。
- 标识处理会改变字节与格式，落库的 `format` / `sizeBytes` 必须取处理后的值。

## 7. 视频

- 产出 mime 为 `video/*`（当前为 `video/mp4`），记录 `durationMs`。
- 不生成缩略图、不转码；前端使用原生 `<video controls>`，不自动播放带声音。
- 有语音内容时才需要字幕；纯视觉生成结果不强制。
- 视频文件较大，下载与预览必须走原文件，不套 `?w/h`。

## 8. 删除、下架与保留

- **下架**（`status='hidden'`）：文件与记录保留，用户端列表不可见，可恢复。
- **删除**：删除存储对象与全部缩略图缓存，记录按域策略处理；不可恢复。
- 项目软删除后，其素材不再进入列表与统计；账号注销会清理作品、素材、项目与积分批次，保留订单/支付/退款/发票/流水并匿名化。
- 当前没有孤儿文件清理任务：数据库记录删除失败或手工删库会留下无主文件；也没有重复文件合并。
- 数据库备份不包含上传目录；上传目录必须单独备份，且与数据库备份同一时间窗。

## 9. 上传入口

所有入口必须复用同一套校验与存储服务：

| 入口 | 说明 |
| --- | --- |
| C 端上传 | `assets` 服务，`buildKey('original', ext)` |
| 手机扫码上传 | 与 C 端同一校验，`buildKey('original', ext)` |
| Chrome 扩展采集 | 额外写 `sourceSite` / `sourceTitle` / `sourcePageUrl`，只作展示与溯源 |
| 后台设置图 / 模板图 | 走 `StorageService`，不建 `Asset` |
| 生成产出 | `task-media.service`，确定性 key + AIGC 标识 |

禁止：直接拼磁盘路径写文件、绕过 `assertSafeKey`、在页面里拼存储 URL、把云端签名 URL 入库。

## 10. 新增 / 修改媒体能力检查清单

- [ ] 新格式是否同时更新白名单、魔数识别、前端 accept、测试与文档？
- [ ] 大小与像素上限是否走设置项，且不超过部署硬上限？
- [ ] storage key 是否符合类别/月份/随机或确定性规则？
- [ ] 是否记录 `storageBackend` 与 `storageKey`，而不是只存完整 URL？
- [ ] 删除时是否清理文件与缩略图缓存？
- [ ] 图片是否需要 AIGC 标识？视频是否接受「仅接口标识」的限制？
- [ ] 前端是否对云端 URL 避免追加 `w/h`？
- [ ] 是否补充上传目录备份说明？

## 11. 已知缺口

- **原图不去 EXIF**：上传原样落盘，GPS 与设备信息可能随素材被下载或转发。
- **缩略图默认关闭**：三档 env 均为 `false`，素材库默认加载原图，首屏体积与内存压力大。
- **无去重**：同一文件重复上传存多份，没有内容哈希。
- **无孤儿文件清理**：删库或删除失败会留下无主文件。
- **视频无内嵌标识与封面**：没有 ffmpeg，AIGC 标识只到接口与播放器角标。
- **云端后端不经过缩略图中间件**：OSS / MinIO 素材只能拿原图或依赖云厂商自身处理。
- **上传目录不在数据库备份内**：必须单独备份，容易漏。
- **云端 SDK 不在依赖里**：`ali-oss` / `minio` 需要切换前手工安装。
- **GIF 识别与支持口径不一致**：字节识别包含 GIF，但上传白名单与前端 accept 不包含，文档与提示不得暗示支持。
