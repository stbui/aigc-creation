# 代码风格与静态检查

静态检查的唯一说明：工具链、规则基线、CI 门禁与后续收紧路径。命名、目录分层、导入方向等结构约定分别见 [`frontend-module-conventions.md`](frontend-module-conventions.md) 与仓库根 `CLAUDE.md`；本文件只讲**机器能检查的部分**。

## 1. 工具链

全仓使用 **Biome 2.6.7**，以根目录 `devDependencies` 精确锁定，配置在 `biome.json`。

选择 Biome 而不是 ESLint + Prettier 的原因：

- 前端锁定 TypeScript 7.0.2，而 `typescript-eslint` 的 peer 要求 `typescript <6.1.0`；直接接入会形成不受支持的组合。
- Biome 自带解析器，不依赖项目 TypeScript 版本，同一份配置覆盖 `backend` / `frontend` / `agent` / `scripts` / `extension`。
- lint 与 format 共用一个二进制，避免两套配置的规则冲突。

格式基准与 `.editorconfig` 一致：2 空格、LF、行宽 100、单引号、分号、尾逗号。`.editorconfig` 仍是编辑器层的事实源，Biome 配置不得与之冲突。

## 2. 命令

| 命令 | 作用 | 是否会失败 |
| --- | --- | --- |
| `npm run lint` | 全量 lint，显示 error 与 warning | 仅 error 非零 |
| `npm run lint:ci` | 只显示 error，CI 与 `npm run check` 使用 | error 非零 |
| `npm run lint:fix` | 应用**安全**修复 | — |
| `npx biome lint --write --unsafe <files>` | 应用不安全修复（如改 `const` 为 `let`），必须逐项复核 | — |
| `npx biome format --write <files>` | 格式化指定文件（推荐：只格式化本次改动） | — |
| `npm run format` | 格式化全仓（仅用于专门的全仓格式化提交） | — |
| `npm run format:check` | 只检查不写入 | 需要格式化的文件存在时非零 |

根目录首次使用或锁文件变更后先执行 `npm ci`；`npm run check` 已包含 `lint:ci`。

## 3. 检查范围

`biome.json` 的 `files.includes`：

```
backend/src/**/*.ts
frontend/src/**/*.ts
frontend/src/**/*.tsx
agent/src/**/*.mjs
scripts/**/*.mjs
extension/**/*.js
```

`.gitignore` 生效，`dist` / `node_modules` / Prisma 生成物 / 覆盖率与测试产物不会进入检查；`docs` 与构建配置不在范围内。

## 4. 规则基线

### 4.1 Error（门禁，当前 0 违规）

| 规则 | 守住什么 |
| --- | --- |
| `correctness/noConstAssign` | 不给 `const` 重新赋值 |
| `correctness/noInvalidUseBeforeDeclaration` | 声明前使用 |
| `correctness/noSelfAssign` | 自己赋值给自己 |
| `correctness/noUnreachable` | 不可达代码 |
| `correctness/useValidTypeof` | `typeof` 只与合法字符串比较 |
| `correctness/useIsNan` | 用 `Number.isNaN` 而不是 `x === NaN` |
| `suspicious/noAsyncPromiseExecutor` | `new Promise(async ...)` |
| `suspicious/noCompareNegZero` | 与 `-0` 比较 |
| `suspicious/noDebugger` | 提交调试器语句 |
| `suspicious/noDuplicateCase` | `switch` 重复分支 |
| `suspicious/noDuplicateObjectKeys` | 对象重复键 |
| `suspicious/noFallthroughSwitchClause` | `switch` 意外穿透 |
| `suspicious/noSelfCompare` | `x === x` |
| `suspicious/noShadowRestrictedNames` | 覆盖 `undefined` / `NaN` 等 |
| `suspicious/noSparseArray` | 稀疏数组 |
| `suspicious/noUnsafeNegation` | `!x in y` 一类优先级错误 |

新增规则必须先满足「当前 0 违规」再加入 error；否则先按 §6 走 warn 收敛。

### 4.2 Warn（存量债务，不阻塞门禁）

当前 549 条，按数量排序的主要来源：

| 规则 | 数量 | 收敛方向 |
| --- | --- | --- |
| `complexity/useOptionalChain` | 78 | 逐文件改为 `?.` |
| `correctness/useExhaustiveDependencies` | 58 | 补依赖或改用稳定引用，改动需逐项验证 |
| `suspicious/noDoubleEquals` | 53 | 改为 `===`；`== null` 的意图需显式写清 |
| `correctness/noUnusedImports` | 45 | 删除 |
| `correctness/noComponentHookFactories` | 41 | 组件内不要条件式创建 hook |
| `suspicious/noArrayIndexKey` | 40 | 静态骨架可保留，数据列表改用稳定 id |
| `correctness/noUnusedVariables` | 38 | 删除或前缀 `_` |
| `a11y/*` | 94 | 语义元素、label 关联、键盘可达 |
| 其余 | 102 | 见 `npm run lint` |

warnings 不计入门禁，但**新增代码不应增加 warn 数量**。批量清理后把对应规则提升为 error。

### 4.3 Off（明确关闭，附原因）

| 规则 | 原因 |
| --- | --- |
| `suspicious/noAssignInExpressions` | 正则 `while ((m = re.exec(s)))` 是既有惯用法，改写收益低于风险 |
| `complexity/noCommaOperator` | `for` 循环声明与少量紧凑表达式，属可读性取舍 |
| `correctness/noInnerDeclarations` | 存量函数内声明模式，需逐处重构，暂不阻塞 |
| `suspicious/noExplicitAny` | 动态接口载荷与第三方适配层大量使用，先收敛类型边界再开启 |
| `style/useImportType` | 全仓改写会产生大面积无行为差异的 diff |
| `suspicious/noConsole` | `scripts/` 与运维脚本需要控制台输出 |
| `suspicious/noControlCharactersInRegex` | CSV / 控制字符校验是有意匹配 |

关闭项必须在此登记原因；新增 off 项同样要写。

## 5. 格式化策略

Biome formatter 已配置，但**暂不进入门禁**：

- 全仓 `npm run format:check` 当前有 878 个文件需要格式化。
- 直接全仓格式化会产生巨大 diff，掩盖真实改动；应与业务改动分开提交。
- 日常开发只对**本次改动的文件**执行 `npx biome format --write <files>`。
- 完成一次专门的全仓格式化提交后，再把 `format:check` 加入 `npm run check`。

在此之前，格式一致性由 `.editorconfig`、代码评审与本文件约束。

## 6. 新增与收紧规则

1. 新规则先设为 `warn`，跑 `npm run lint --reporter=json` 统计违规量与分布。
2. 违规集中在少数文件时，先清理再提升为 `error`；分散且改动风险高时保持 `warn` 并记入 §4.2。
3. 提升为 `error` 后，在 §4.1 登记「守住什么」。
4. 关闭规则必须在 §4.3 写明原因，不能只留配置。
5. 任何规则调整都要同批更新本文件，避免配置与说明分叉。

## 7. 例外与抑制

- 单行例外用 `// biome-ignore lint/<group>/<rule>: 原因`，原因必须可读；不允许只写 `biome-ignore`。
- 文件级禁用需在本文件登记，并在代码注释里说明为什么整个文件不适用。
- 不为通过检查而修改生成文件（Prisma Client、构建产物、`node_modules`）。
- 不安全修复（`--unsafe`）必须逐项复核，尤其是 `const` → `let`、删除未使用代码这类可能改变行为的改动。

## 8. CI 门禁

`quality` job：

1. 根目录 `npm ci` 安装 Biome；
2. `npm run check` → `check:node` → `verify:deps` → **`lint:ci`** → `build` → `test`。

`e2e-smoke` 与 `docker-build` 不依赖 Biome。本地提交前至少跑 `npm run lint:ci`；改动涉及类型或运行时行为时按 [`testing.md`](testing.md) 的闸口清单执行。

## 9. 版本与升级

- 版本精确锁定，不使用 `^` / `~`；升级单独提交，附 `biome migrate` 结果与规则差异。
- 升级后重跑 `npm run lint:ci` 与 `npm run test`，确认没有因解析器或规则默认值变化引入的新错误。
- 规则默认值随大版本变化，升级前先读迁移说明，不盲目接受自动迁移。

## 10. 已知缺口

- 549 条 warning 未收敛，尚不能作为失败门禁。
- 878 个文件未按 Biome formatter 格式化，格式门禁未接入。
- Biome 只覆盖语法与通用正确性；以下仓库硬规则仍需评审与既有测试守住：
  - 最小字号 12px、禁止裸 hex、只用设计令牌（见 `CLAUDE.md` 与 [`typography.md`](typography.md)）；
  - 后台页面不得新增 `adm-*` 类、只从 `admin-ui/primitives` 取件；
  - 能力清单只在 `capabilities/definitions/` 定义、模型调用只走 `src/model/**`。
- 没有 pre-commit hook；门禁依赖 CI 与本地自觉执行。
