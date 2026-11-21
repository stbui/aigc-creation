# 非上游扩展与契约偏差登记

> 本文件登记对既定 PRD / 设计契约的偏离，以及不属于上游语义的新增扩展。
> 每项标注【新增扩展·非上游语义】，说明偏离点、动机、影响面与落点，便于审计时逐项核对。

---

## EXT-2026-11-20-01 【新增扩展·非上游语义】存储凭据改为页面可编辑、加密落库

- **偏离契约**：`docs/admin-prd.md` §3.11 / B-63 原定「凭据走部署期环境变量，界面不可编辑，永不入库」。
- **变更动机**：产品要求 OSS / MinIO 的全部配置（含凭据）在后台页面完成，且保存即时生效免重启。
- **偏离范围**：反转上述只读边界；新增 DB 表 `StorageConfig` 存密文配置，新增写端点与页面编辑入口。
- **对上游语义的影响**：
  - 读取侧（`Asset.storageBackend` / `storageKey`、`getActive` / `get` / `buildKey`）**语义不变**，所有业务调用方零改动。
  - 配置来源改为「仅 DB 页面配置」；DB 无行时保持 local，不读取对象存储环境变量。
  - 云端后端不可用时的「拒绝静默回落本地盘」策略**保持不变**。

### 落点

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 数据 | `backend/prisma/schema.prisma` | 新增 `StorageConfig`（`backend` 主键、`configCipher`、`configDigest`、`updatedBy`） |
| 服务 | `backend/src/storage/storage.service.ts` | 配置中心化；`saveConfig` 加密落库 + 即时重建 provider；`status` 下发字段定义与脱敏视图 |
| 接口 | `backend/src/admin/storage.controller.ts`、`backend/src/admin/dto/storage-admin.dto.ts` | 新增 `PUT /admin/storage/config/:backend`（`setting.write` + `@AdminUser` 审计）；`status.editable` 改 `true` |
| 前端 | `frontend/src/pages/admin/storage/*`、`frontend/src/types/admin-ops.ts`、`frontend/src/lib/api-admin-system.ts` | 编辑抽屉（字段由后端下发驱动）、密钥留空沿用、提示文案更新 |
| 文档 | `docs/media-assets.md` §3 | 启用流程改为仅页面配置 |

### 2026-11-21 增强（参考影策存储页）

- **配置项扩展**：`STORAGE_CONFIG_FIELDS` 按「连接位置 / 读取出口 / 服务端凭据 / 高级」分组，新增 `pathPrefix`、`publicBaseUrl`、`urlExpiresSeconds`、`sessionToken`、`autoCreateBucket`；`local` 也纳入配置（公开访问地址）。
- **先测后存**：`POST /admin/storage/probe` 支持 `body.values`，用页面草稿构造临时 provider 做真实读写，不落库、不切换默认后端。
- **保存前校验**：Endpoint / 公开域名必须是服务根地址（无路径、无认证、无查询）；MinIO 端口范围与「不带协议」的 host 校验；签名有效期区间校验。
- **前缀隔离**：云端新写入 key 加 `pathPrefix`，历史 key 保持原样（按存储的完整 key 读取）；本地盘不加前缀。
- **诊断增强**：写探针区分「写入 / 读回 / 删除」失败步骤；OSS / MinIO 连通失败消息带上 Bucket、Region / Endpoint。

### 安全口径

- 密钥以 AES-256-GCM 密文落库（`SecretCipher`，密钥复用 `MODEL_SECRET_KEY`，未配置时开发态落盘），明文只在保存当次经请求体进入服务端内存。
- 所有读接口（`status` / `configView`）只返回脱敏值与「是否已配置」标记，明文密钥不出服务端。
- 写操作需 `setting.write`，`updatedBy` 记录管理员 id 供审计；未知配置键按字段白名单忽略，不进库。

### 测试

- `backend/src/storage/storage.service.spec.ts`：仅 DB 读取、拒绝环境变量、密钥留空沿用、加密落库、脱敏、必填校验、字段分组、Endpoint / 端口校验、前缀归一、key 前缀、审计信息、草稿测试不落库。
- `backend/src/storage/storage.provider.spec.ts`：字节口径、只读 / 写探针、CDN 直读、STS 透传、自动建桶、失败诊断。
- `backend/src/admin/storage.controller.spec.ts`：`status.editable`、`saveConfig` 审计透传、非法后端拒绝、草稿探测。
