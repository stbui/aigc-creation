# Task ID: 4

**Title:** 下线旧环境变量、旧 DB 键与 modelverse 别名

**Status:** pending

**Dependencies:** 2, 3

**Priority:** high

**Description:** 删除线路类 CONFIG_DEFS、legacyKey/hidden 回落、旧 GATEWAY_* 变量与 modelverse 运行期别名；新增启动守卫：production 残留旧键拒绝启动，development/test 记录 ERROR。后台模型配置页移除线路项。

**Details:**

落点：channel-config.defs.ts、gateway.config.ts、config/env.validation.ts、backend/.env.example、三档 env、scripts/db-url.js、新增 channel-config.guard.ts、frontend/src/pages/admin/AdminModelConfigPage.tsx。保留 timeoutMs/pollMs/maxPolls/asset.publicBase/gateway.route.*。协议规范名只认 openai。

**Test Strategy:**

设置 GATEWAY_BASE_URL 后 production 启动失败并给出迁移命令；development 可启动且 ERROR 日志含键名；旧 DB 键不再参与读取；后台配置页无线路字段；modelverse 不再被识别。
