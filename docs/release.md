# 发布与版本规范

本文件规定**版本号、发布单元、发布记录与兼容性边界**。执行动作（备份、发布、回滚判定）以 [`development-workflow.md`](development-workflow.md) §2.13 为准，运维命令以 [`docker-deployment.md`](docker-deployment.md) §5 为准，数据库变更约束见 [`database.md`](database.md) §10。三处不重复描述同一件事。

## 1. 发布单元与版本号

一次发布 = **一个 Git 提交（带 tag）+ 一组固定 tag 的镜像 + 当次数据库状态 + 当次环境变量**。四者必须一起记录，缺一项就无法复现或回滚。

| 标识 | 规则 | 当前状态 |
| --- | --- | --- |
| 产品版本 | 根 `package.json` 的 `version`，语义化版本 | `1.0.0` |
| 子包版本 | `backend` / `frontend` / `agent` 与产品版本同步 | 已同步为 `1.0.0`，由 `verify:conventions` 检查 |
| Git tag | `v<产品版本>`，附注写明镜像 tag 与备份位置 | 仓库当前没有 tag |
| 镜像 tag | `YYYY-MM-DD-N`，一旦发布不得复用 | 默认值 `production`，示例为日期式 |

版本号规则：

- **MAJOR**：破坏性 API 变更、需要停机/恢复备份的数据库变更、鉴权或计费语义变更。
- **MINOR**：向后兼容的新能力、新页面、新接口。
- **PATCH**：向后兼容的修复、文案与样式调整。
- 一次发布只升一次版本；同一天多次发布用镜像 tag 的 `-N` 区分，产品版本按实际变更升位。
- 发布前把根、backend、frontend、agent 的 `version` 同步到同一产品版本。
- 生产镜像 tag 不允许使用 `latest` 或 `production` 这类可变值。

## 2. 发布前置

- [ ] PR 已合并到 `main`，CI 的 `quality` / `e2e-smoke` / `docker-build` 全绿。
- [ ] PR 模板的「风险与回滚」已填写；涉及钱、权限、合规、数据库结构必须写清。
- [ ] 产品确认单已签；回归通过。
- [ ] 生产环境门禁核对：`JWT_SECRET`、`DATABASE_URL`、`CORS_ORIGINS`、`ASSET_SIGNING_SECRET`、`MODEL_SECRET_KEY`、`PAYMENT_SECRET_KEY`。
- [ ] 数据库与上传目录已备份，备份可恢复（SHA-256 与恢复验证通过）。
- [ ] Schema 变更已在测试档用生产库副本演练；写不出演练方案时必须先写回滚判定。
- [ ] 镜像已构建并推送到 registry，tag 固定且已记录。
- [ ] 发布记录草稿已建（版本 / 时间 / 镜像 tag / 备份位置 / 冒烟标准 / 回滚判定）。

## 3. 发布执行

按 [`docker-deployment.md`](docker-deployment.md) §5：

```bash
# 固定 tag 拉取并启动；migrate 先执行 prisma db push
HUOJUE_IMAGE_TAG=<YYYY-MM-DD-N> \
  docker compose -f docker-compose.production.yml pull

HUOJUE_IMAGE_TAG=<YYYY-MM-DD-N> \
  docker compose -f docker-compose.production.yml up -d --no-build
```

- 前后端必须使用**同一个镜像 tag**，不允许只更新一侧。
- `migrate` 服务失败时 backend 不会启动，按启动失败处理，不带病放流量。
- 上线后只做只读冒烟：`/health`、`/health/ready`、`/capabilities` 的 `runtime`、登录、一次只读列表；生产不跑写入用例与 E2E。
- 观察窗口覆盖一个完整生成链路与一次支付回调周期；没有真实流量时盯任务失败率、5xx、`[rid=]` 错误日志、退款与对账差异。

## 4. 发布记录

分两份，职责不同：

| 记录 | 内容 | 位置 |
| --- | --- | --- |
| 变更日志 | 用户可见的新增、变更、修复、破坏性变更 | 仓库 `CHANGELOG.md` |
| 发布记录 | 版本、时间、提交、镜像 tag、备份位置与 SHA、冒烟结果、数据库变更、回滚决定 | 发布单 / 运维记录，不入 `docs/` |

`CHANGELOG.md` 采用 Keep a Changelog 结构，按版本倒序，只写用户可感知的变化，不写内部重构细节。发布记录必须能回答「当时部署的是哪个 commit、哪个镜像、哪份库」。

## 5. 兼容性边界

- **API**：全局前缀 `/api/v1`，当前没有并行版本。破坏性接口变更必须评估客户端发布节奏，不能假设前后端同时上线。
- **数据库**：`prisma db push` 直接改结构，**没有 down migration**；删列、改类型、收紧唯一约束属于不可逆变更，必须先备份、先回填、再切换。
- **环境变量**：新增必填变量必须先注入环境再发镜像；缺失时生产启动门禁会拒绝启动。
- **前端与后端**：同 tag 构建、同 tag 部署；回滚时一起回滚，避免旧前端打新后端。
- **模型与协议**：渠道模型 `protocol` 存 provider id；协议插件升级必须验证历史渠道模型仍能派发。

## 6. 回滚

回滚只回滚应用代码，**不会回滚数据库结构或已写入的数据**。

触发条件（任一即回滚）：

- 登录不可用、核心链路断（建任务 / 支付 / 退款）。
- 资金或数据错误（金额、积分、订单状态）。
- 5xx 或失败率显著高于发布前。

步骤：

1. 切回上一个已验证的镜像 tag，`pull` + `up -d --no-build`。
2. 数据库未变更：直接回滚镜像并复验只读冒烟。
3. 数据库已变更且旧代码不兼容：停止写入，按备份恢复库，再回滚镜像；恢复属于停机操作，必须由运维执行并记录。
4. 回滚后 24 小时内复盘，更新发布记录与告警。

禁止：用 `git revert` 代替数据库恢复；在未备份时执行 `db push`；只回滚前端或后端一侧。

## 7. 热修

- 从 `main` 切 `fix/*`，按 PATCH 升版本，走同一套 CI 与发布检查单，不跳过备份与冒烟。
- 生产紧急修复可先合并、后补产品确认，但必须在 24 小时内补齐。
- 热修同样更新 `CHANGELOG.md` 与发布记录；不允许「只改线上、不回仓库」。

## 8. 版本可见性

- `/health` 返回 backend `package.json` 的 `version`；这是当前唯一的运行期版本暴露。
- 前端没有版本号注入，镜像没有 OCI 版本标签，出问题时无法从页面或镜像元数据确认部署版本（见 §11）。

新增发布相关能力时：

- 镜像构建补 OCI labels：`org.opencontainers.image.version` / `revision` / `created`。
- 前端构建注入版本号，页脚或设置页可查。
- `/health` 同时返回版本与 commit。

## 9. CI/CD 现状

- `quality`：安装依赖、静态检查、构建、单测。
- `e2e-smoke`：测试档起服务跑后台冒烟。
- `docker-build`：验证生产镜像可构建。
- **CI 不推送镜像、不打 Git tag、不生成 CHANGELOG**；发布仍由运维执行。
- 没有 SBOM、镜像签名与漏洞扫描。

## 10. 发布检查清单

- [ ] 版本号已按 MAJOR/MINOR/PATCH 升级，四个 `package.json` 已同步（`npm run verify:conventions` 通过）。
- [ ] `CHANGELOG.md` 已更新，破坏性变更已标注。
- [ ] CI 三项全绿，PR 风险与回滚已填写。
- [ ] 生产环境变量齐全，密钥长度与来源符合要求。
- [ ] 数据库已备份且验证可恢复；schema 变更已演练。
- [ ] 镜像 tag 固定、不可变、已记录；前后端同 tag。
- [ ] 发布记录已建，包含 commit / 镜像 / 备份 / 冒烟标准。
- [ ] 上线后只读冒烟通过，观察窗口内无阻断级异常。
- [ ] 回滚判定已写明，回滚所需镜像与备份可随时取用。

## 11. 已知缺口

- **无统一发布脚本**：版本一致性已由 `verify:conventions` 检查，但升级仍需手工同步四个 `package.json` 与锁文件。
- **无 Git tag、无 CHANGELOG**：发布历史无法从仓库回溯。
- **镜像 tag 默认可变**：未显式设置时使用 `production`，不满足不可变要求。
- **CI 不产出发布物**：不推镜像、不打 tag、不生成变更日志。
- **无 OCI 版本标签与前端版本展示**：线上只能靠部署记录确认版本。
- **无 SBOM / 镜像签名 / 漏洞扫描**。
- **数据库无 down migration**：回滚应用不代表回滚结构，恢复只能靠备份。
- **无特性开关与灰度**：发布即全量，无法按用户或比例放量。
- **无发布记录存放规范**：当前只约定「发布单 / 运维记录」，仓库内没有模板或目录。
