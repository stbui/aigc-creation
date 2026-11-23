# 货觉AI 品牌基础

> 状态：现行。品牌名称与技术标识的唯一事实源。

## 1. 名称

| 场景 | 规范写法 |
| --- | --- |
| 产品名（中文） | 货觉AI |
| 产品名（英文） | Huojue AI |
| 技术标识 | `huojue`（全小写） |
| 仓库目录 | `aigc-creation`（历史目录名，仅用于指代路径） |

中文名「货觉」与「AI」之间不加空格；英文名 `Huojue` 与 `AI` 之间保留一个空格。

## 2. 技术命名

| 对象 | 规范 |
| --- | --- |
| npm 包 | `huojue`（根 monorepo）/ `huojue-backend` / `huojue-frontend` / `huojue-agent`（agent 智能体子包） |
| Docker 镜像 / 容器 / 卷 | `huojue-*` 前缀；变量 `HUOJUE_*` |
| localStorage | `huojue_token` / `huojue_email` / `huojue_role` |
| 上游请求 User-Agent | `huojue/1.0` |
| MinIO 默认 bucket | `huojue` |
| 开发环境 JWT 兜底密钥 | `dev-huojue-secret-do-not-use-in-prod` |
| 浏览器扩展日志前缀 | `[HuojueCapture]` |
| 品牌资产 | `frontend/public/brand/huojue-*.svg` |

## 3. 禁用旧称

`ecom-vision-mvp`、`ecom-vision`、`ecom_vision` 是历史代号，代码、脚本、文档与注释一律不再使用；重新出现即视为命名回归。

## 4. 上游引擎与历史引用

- 产品标识与上游引擎分开：`@openai/codex-sdk`、`Codex CLI`、`CODEX_PATH`、`~/.codex/sessions` 等是事实性依赖，保留上游名称，不按品牌规范改写。
- `open-ai-canvas` 是 `NOTICE` 中声明的上游移植来源，不是当前产品名。
- 历史会话数据中的旧代号只作为历史数据存在，不作为现行代码、接口或文档的引用依据。
- 一次性审计、取证与逐轮实施记录不落 `docs/`；结论随提交说明记录，长期有效的规则回写到对应领域文档。
