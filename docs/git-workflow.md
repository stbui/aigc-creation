# Git 工作流

本文规定分支、提交、PR 与合并规则。与 `CLAUDE.md`「仓库约定」一致；冲突时以本文为准，并同步改 `CLAUDE.md`。提交 / 推送的授权边界见 [`agent-execution.md`](agent-execution.md) §1，阶段 11 交付与发布见 [`development-workflow.md`](development-workflow.md)。

## 1. 分支

- `main` 是集成分支，始终可构建；**不在 `main` 上直接改代码**。
- 从最新 `main` 切分支：`git switch main && git pull --ff-only && git switch -c <type>/<kebab-主题>`。
- 前缀取提交 type 的常用子集：`feat/` `fix/` `refactor/` `perf/` `test/` `docs/` `chore/`；`hotfix/` 是分支专用前缀，提交 type 仍用 `fix`。
- 主题用英文 kebab-case，2–5 个词，例：`fix/credit-issuance-consumption`、`feat/admin-order-deletion`。
- 一个分支只做一件事；跨主题改动拆分支（对应 [`agent-execution.md`](agent-execution.md) §5「跨阶段夹带」）。
- `hotfix/` 只从 `main` 切，按 [`development-workflow.md`](development-workflow.md) §3.1 紧急修复通道执行。
- 合并后删除远端与本地分支。

## 2. 提交信息

```
<type>(<scope>): <中文 subject>

<body：为什么这样取舍、影响面；必要时列关键改动，不逐文件复述>

<footer：Refs REQ-xxx / BUG-<轮次>-<序号>>
```

- **type 英文**，取值：`feat` / `fix` / `refactor` / `perf` / `test` / `style` / `docs` / `chore` / `build` / `ci` / `revert`。
- **scope 英文小写**，取域而非文件名：`admin` / `credit` / `model` / `billing` / `payments` / `auth` / `tasks` / `frontend` / `docs` / `deps` 等。
- **subject 中文**，一句话说结果不说过程，50 字内，句末不加句号。例：`fix(credit): 修正积分账实核对与到期回填不一致`。
- **body 写取舍理由**：为什么选这个方案、放弃了什么、影响哪些链路；必要时列关键改动，但不逐文件复述 diff。对应缺陷卡 / 需求条目写 `Refs BUG-R3-07` / `Refs REQ-PAY-003`。
- **破坏性变更**：type 后加 `!`（`feat(model)!: ...`），footer 写 `BREAKING CHANGE: <影响与迁移方式>`。
- 由 agent 起草的提交说明，footer 按实际执行 agent 的约定署名；Claude Code 使用 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 禁止：`wip` / `update` / `fix bug` / 无 type 的裸句子；已推送的提交不改写、不 amend。

| 好 | 差 |
| --- | --- |
| `fix(credit): 修正积分账实核对与到期回填不一致` | `wip` / `fix: wip` |
| `feat(admin): 新增订单安全删除` | `更新` / `fix bug` |
| `refactor(model): 收敛路由快照读取入口` | `改了 model` |

## 3. 提交粒度与内容

- 一个提交一个可回滚主题；重构与功能分开提交。
- 用 `git add -p` 逐块审阅，**不用 `git add .`** 把无关文件带进来。
- 提交前 `git diff --staged` 复核：无调试代码、无临时日志、无密钥。
- **不提交**：密钥 / `.env` / `*.db` / `uploads/` / `logs/` / `dist/` / `node_modules`（`.gitignore` 已覆盖，仍需 `git status` 复核）。
- `.env.development` / `.env.test` / `*.example` 是入库配置；改动前确认没有写入真实凭据。

## 4. PR 与合并

1. 推分支：`git push -u origin <branch>`。
2. 开 PR，描述按 `.github/pull_request_template.md`；标题与提交信息同格式。
3. **CI 必须绿**：`quality`（Static checks and tests，根目录 `npm run check`）、`e2e-smoke`（后台 E2E 冒烟）、`docker-build`（生产镜像与 compose 校验）。红灯不得合并；确认为已知缺口时，须附 `docs/testing.md` §5 的定性结论与缺陷卡编号。
4. 自查：改动只落单一事实源、文档同批、证据三件套齐全、未验边界已写、未夹带重构。
5. 合并策略：默认 **squash merge**，一个分支一条提交，`main` 历史线性可读；分支内提交需保留独立语义时用 merge commit。合并信息用 PR 标题 + 正文摘要。
6. 合并后删分支，本地 `git switch main && git pull --ff-only`。
7. 分支保护目标：在 GitHub 对 `main` 开启保护（禁止直接 push、要求 CI 绿、要求走 PR）。未开启前直接 push `main` 属例外，推送前必须补跑 `npm run check`，并在提交说明里写明例外原因。

## 5. 同步与冲突

- 分支落后时：未推送用 `git rebase main`，已推送或有协作者用 `git merge main`。
- 解决冲突后**必须重跑受影响闸口**（按改动域选专项见 [`quality-gates.md`](quality-gates.md) §2）。
- 已推送的个人分支只允许 `git push --force-with-lease`；共享分支不 force。
- 不 rebase、不改写 `main` 历史。

## 6. 回滚

- 已合并的提交用 `git revert <sha>` 生成反向提交，保留变更轨迹。
- 不 `git reset --hard` 已推送的 `main`，不在共享分支上删提交。
- 回滚同样走分支 + PR + CI；线上阻断按 [`development-workflow.md`](development-workflow.md) §3.1 走，备份不可省。
- 数据库结构变更（Prisma Migrate）**不能用 git 回滚**，按 [`development-workflow.md`](development-workflow.md) §2.13 第 3 条备份与副本演练处理。

## 7. Agent 边界

| 操作 | 是否可自主 |
| --- | --- |
| `git status` / `log` / `diff` / `show` / `branch --list`（只读） | 可 |
| 起草提交说明、PR 描述 | 可（阶段 11 交付内容） |
| `git add` / `commit` / `push` / `tag` / `branch -D` / `reset` / `rebase` / `merge` | **需明确授权**，默认不做 |
| 解决冲突 | 需授权；解决后重跑受影响闸口 |
