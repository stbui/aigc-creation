# 货觉AI 品牌 / 命名 / 产品定义 统一审查报告

> 审查日期：2026-11-15
> 事实源：`docs/brand/brand-basics.md`（品牌名称与技术标识唯一事实源）
> 结论：主品牌已统一为「货觉AI / huojue」，核心 surface 一致；复核后确认的真实缺陷仅 2 项（F1 agent 上游标识泄漏、F4 衣帽间文档命名口径），均已处置或待裁定。

---

## 修订说明（重要）

初版（v1）曾将 F2/F3/F5 列为缺陷，经逐行复核，这些文本在**现行文件中均不存在**，已撤回：

- **F2（原"CLAUDE.md 内部代号 ecom-vision-mvp"）**：CLAUDE.md:71 实际为
  `**货觉AI**（技术标识 `huojue`，仓库目录 `aigc-creation`）—— 面向电商团队与个人卖家的智能视觉创作平台。`
  无 `ecom-vision-mvp`、无"内部代号"表述。
- **F3（原"README 死链 docs/brand/naming.md"）**：README.md 标题实际为 `# 货觉AI`，全文未引用 `docs/brand/naming.md`。
- **F5（原"README/CLAUDE 标题带 · MVP"）**：现行 README 与 CLAUDE.md 均以"货觉AI"为产品名，无"· MVP"后缀。

> 教训记录：初版结论来自对会话历史数据（`agent/data/sessions.json` 中早期 `ecom-vision-mvp` 时期的产物快照）与文档的混淆读取，未逐行核对现行文件即下结论。本次以 `grep` 全仓复核为准。

---

## 规范基线（来自 `brand-basics.md`）

| 维度 | 规范写法 |
| --- | --- |
| 产品名（中文） | 货觉AI（「货觉」与「AI」间无空格） |
| 产品名（英文） | Huojue AI（Huojue 与 AI 间留一空格） |
| 技术标识 | `huojue`（全小写） |
| npm 包 | `huojue`（根）/ `huojue-backend` / `huojue-frontend` |
| Docker | 镜像/容器/卷 `huojue-*` 前缀；变量 `HUOJUE_*` |
| localStorage | `huojue_token` / `huojue_email` / `huojue_role` |
| User-Agent | `huojue/1.0` |
| MinIO bucket | `huojue` |
| 扩展日志前缀 | `[HuojueCapture]` |
| 品牌资产 | `frontend/public/brand/huojue-*.svg` |
| **禁用旧称** | `ecom-vision-mvp` / `ecom-vision` / `ecom_vision`（重新出现即视为命名回归） |
| 仓库目录 | `aigc-creation`（历史目录名，仅用于指代路径） |

---

## 真实发现（复核后）

| ID | 严重度 | 类别 | 位置 | 问题 | 处置 |
| --- | --- | --- | --- | --- | --- |
| F1 | 高 | 品牌泄漏 | `agent/package.json`、`agent/README.md`、`agent/public/index.html`、`agent/public/manifest.webmanifest`、`agent/public/app.js`、`agent/test/app.test.mjs` | `agent/` 模块在产品文档中已定位为「货觉AI · AI 智能体」（`docs/agent-prd.md`、`docs/agent-integration-design.md`），但代码/UI 仍是上游 `Codex Web` 标识：包名 `codex-web`、描述 "A local web workspace for the OpenAI Codex SDK"、页面标题 "Codex Web"、manifest 名 "Codex Web"、localStorage 键 `codex-web.*`、console 前缀 `[codex-web]`；与品牌规范 `huojue` 冲突，且 `brand-basics.md` 的 npm 包清单未涵盖 agent | **已修订（2026-11-15）**：按裁定统一重命名为货觉AI。包名 `codex-web`→`huojue-agent`、标题/名称 "Codex Web"→"货觉AI 智能体"、README 标题同步、localStorage 键 `codex-web.*`→`huojue.*`、console 前缀 `[codex-web]`→`[HuojueAgent]`、数据字段 `codexThreadId`→`agentThreadId`、测试断言与临时目录前缀同步。底层 Codex SDK 引擎引用（`@openai/codex-sdk`、`Codex CLI`、`CODEX_PATH`、`codexPathOverride`、`makeFakeCodex`、`~/.codex/sessions`）属事实性依赖，按"区分产品标识与引擎名"原则**保留** |
| F4 | 中 | 产品定义分歧 | `docs/衣帽间功能策划.md:1,4,213` | 通篇用"电商视觉工坊 MVP / 电商视觉工坊"作产品名，与 `brand-basics.md` 的"货觉AI"不一致；文档自身对归属存疑（B 端 vs C 端 vs manga-drama） | **已修订**：按本仓即货觉AI 对齐命名（"电商视觉工坊"→"货觉AI"），并保留"B 端/C 端/manga-drama 归属"作为独立开放问题，不混用产品名 |

---

## 一致性核验通过项（正面清单，均已复核）

- npm 包：`huojue` / `huojue-backend` / `huojue-frontend` ✓（agent 除外，见 F1）
- Docker：`huojue-*` 镜像/容器/卷、`HUOJUE_*` 变量 ✓（docker-compose.yml）
- 浏览器扩展：`__MSG_extensionName__` → "货觉AI 图片采集"、`huojue-logo-*` 图标、`[HuojueCapture]` 日志前缀 ✓
- 前台标识：`AppHeader` 渲染「货觉」+「AI」、`huojue-mark.svg`、theme-color `#5546d8` ✓
- 产品定义：CLAUDE.md:71、README.md 均以"货觉AI"为产品名，口径一致 ✓
- 品牌资产：`public/brand/` 下 4 个 SVG + 全套 PNG（16/32/36/180/192/512/maskable-512）+ OG 图 `og-1200x630.png` 齐全 ✓
- 主站 localStorage：`huojue_token` / `huojue_email` / `huojue_role` ✓
- AIGC 角标：监管合规术语（AI 生成内容标识），可见角标默认文案 "AI 生成"，圆点用品牌紫 `#5546d8`，属正确用法 ✓

---

## 非本仓产品 / 历史引用（知悉即可，非当前产品名）

- **VOZEB / VOZEB-PRO**：仅出现在 `agent/data/sessions.json`（历史 agent 会话数据，含早期 `ecom-vision-mvp` 时期的产物快照），非当前产品代码/文档。
- **manga-drama**：仅 `docs/衣帽间功能策划.md` 作为"替代归属假设"提及，非当前产品名。
- **open-ai-canvas**：`NOTICE` 中声明的上游移植来源（模型/渠道子系统），属合规声明，非产品品牌。
- **ecom-vision-mvp / ecom-vision / ecom_vision**：仅存于 `agent/data/sessions.json`（历史数据）与 `brand-basics.md` 的禁用声明定义；现行产品代码/文档中无残留。

---

## 处置建议

- **F1（agent 品牌）**：已按裁定统一重命名为货觉AI（见上）。底层 Codex SDK 引擎引用保留为事实性依赖。
- **F4（衣帽间）**：已按品牌对齐修订文档；B 端/C 端/manga-drama 归属仍按原文档开放问题处理。
- **agent 模块 npm 清单补充**：`brand-basics.md` 的 npm 包清单未涵盖 agent，建议在其"npm 包"行补入 `huojue-agent`（或注明 agent 为独立子包），使品牌规范与实现一致。
