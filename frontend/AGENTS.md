# frontend/AGENTS.md

适用于 `frontend/` 目录树。根 `AGENTS.md` 负责跨线协作，本文件负责前端落地；冲突时本文件优先，但不得覆盖 `CLAUDE.md` 的仓库不变量与单一事实源。

## 1. 责任与边界

主责：C 端页面、后台页面、组件层、设计令牌、交互状态、接口消费与路由。

- 本线拥有：`src/**`、`scripts/**`、`src/**/__tests__/**`
- 本线不主动改：`tests/**`（E2E 归测试线）、`backend/**`、`test/**`
- 组件边界：后台页面只从 `admin-ui/radar` 取件；C 端页面只从 `src/ui` 取件；原子件只在组件层内部使用
- 数据边界：接口失败就展示失败态，不用本地假数据、占位图或 mock 成功兜底

## 2. 先读

1. `docs/design/standards/frontend-module-conventions.md`：多文件功能目录、8 个入口、导入方向、CSS 归属
2. `docs/design/standards/frontend-component-language.md`：组件角色、Props、状态、跨端一致性与禁止模式
3. `docs/design/standards/design-tokens.md`：令牌三层结构、命名与引用
4. `docs/design/standards/feedback-states.md`：五态判定、加载 / 空 / 失败 / 成功 / 确认
5. `docs/design/standards/accessibility.md`：键盘、焦点、表单、图像、动态反馈、对比度
6. `docs/testing.md`：L1.5 与 L4 的用例边界

## 3. 目录与分层

| 目录 | 职责 |
| --- | --- |
| `src/pages/admin/` | 后台页面；多文件目录按 8 入口分层 |
| `src/pages/<域>/` | C 端功能目录：`index/page/components/api/hooks/utils/constants/style` |
| `src/admin-ui/components/ui/` | 后台 shadcn 原子件；不承载业务 |
| `src/admin-ui/radar/` | 后台组合层；页面从这里取表格、抽屉、表单、状态件 |
| `src/ui/` | C 端组件层与 `primitives/` 语义组件 |
| `src/components/`、`src/hooks/`、`src/lib/`、`src/context/` | 跨页共享组件、hook、纯函数、上下文 |
| `src/styles/` | `tokens.css`、`base.css`、`tool-workspace.css`、`ui.css` 与域样式 |
| `src/mask-sdk/` | 遮罩画布内核，保持与页面解耦 |
| `src/test/` | 测试工具与具名导入对账判据 |
| `scripts/` | shadcn、文件体积等静态守卫 |
| `tests/` | Playwright E2E，归测试线 |

多文件功能目录的固定入口：`index.ts`、`page.tsx`、`components.ts`、`api.ts`、`hooks.ts`、`utils.ts`、`constants.ts`、`style.css`；有跨模块类型时再加 `types.ts`。非入口文件不得被外部直连。

## 4. 硬约束

- 后台页面不得直连 `admin-ui/components/ui`；C 端页面不得直连后台组件。需要新角色时先在对应组件层封装语义组件。
- 颜色只引 `var(--token)`，不写裸 hex；新增令牌走 `docs/design/standards/design-tokens.md` 的流程。最小字号 12px。
- 页面 CSS 只放本页独占选择器；共享骨架与全局令牌不搬进页面；全局工具类必须带 `u-` 前缀。
- 单文件 500 行告警、800 行报错；`scripts/check-file-size.mjs` 的基线只许变短，不能当豁免。
- shadcn 原子件不得使用官方默认 `cn`，不得保留 `dark:` 变体；`SelectItem` / `DropdownMenuItem` / `CommandItem` 必须分别放在对应的 `Group` 内。
- 五态必须齐备：首次空态、loading、有数据、加载失败、未登录或无权限。C 端 `StateError` 不得传 `detail`，原始错误只进日志。
- 新增多文件功能目录时补具名导入 / 导出对账测试，防 ESM 链接失败导致整页白屏。
- 后台 E2E 选择器使用 `data-testid="admin-*"` 或 `aria-label`；不要把 Tailwind 工具类或 `adm-*` 类写进断言。
- `tests/*.spec.ts` 只归 Playwright；`src/**/*.test.{ts,tsx}` 只归 Vitest。两边不要互相放用例。

## 5. 验证

```bash
cd frontend
npm run typecheck      # check:shadcn + check:file-size + tsc --noEmit
npm test               # Vitest / jsdom
npm run build:prod     # 生产构建，含上述静态守卫
npm run e2e            # Playwright 后台套件
npm run e2e:smoke      # 后台概览冒烟
```

只跑 `npx tsc --noEmit` 不等于完成类型检查；`npm run typecheck` 还包含 shadcn 组合与文件体积守卫。

后台 E2E 必须用 `playwright.admin.config.ts`（`npm run e2e` 已默认）。用 `playwright.local.config.ts` 会因缺少 `storageState` 与 `admin-auth` 依赖全部跳登录页。

## 6. 完成定义

- 改动只落组件层与页面层，没有绕过 `radar` / `ui` 的直连。
- 五态、空态文案、失败反馈、权限态与移动端无横向溢出都验过。
- 新增或修改交互有同目录 Vitest；涉及页面链路时补 Playwright。
- 文档与代码同批更新；设计与令牌变更同步 `docs/`。
- 交付说明包含命令、关键输出、截图或 E2E 结果、未验边界。

## 7. 常见踩坑

- 后台页面直连原子件、C 端页面直连后台组件，短期能跑，后续主题与可访问性会分叉。
- 把页面样式写成全局选择器，会污染其他页面；共享骨架只放 `src/styles/`。
- 新增 500+ 行文件再登记基线，等于把守卫变成豁免；先按目录约定拆。
- 断言里写 Tailwind 类或 `adm-*` 类，视觉一调就假红；用 `data-testid` 与语义查询。
- `frontend/e2e/audit/**` 是临时审计脚本，不进 Playwright 默认收集，不要当回归套件。
- 接口没通就写本地兜底，会把后端缺陷藏到上线；失败态必须真实可见。

## 8. 线程启动提示词

```text
你是本仓库的「前端线」线程。开始前按顺序读根 AGENTS.md、frontend/AGENTS.md、CLAUDE.md，以及任务对应的 docs/ 文档。

目标：<一句话>
范围：只改 frontend/src/** 与 frontend/scripts/**；frontend/tests/** 归测试线；需要同步的 docs/ 同批更新。
先做：确认接口契约、组件取件层（后台 admin-ui/radar、C 端 src/ui）、五态、令牌与验证命令；等我确认后再实施。
实现：按目录约定分层；补同目录 Vitest；失败态真实可见，不用假数据兜底。
验证：npm run typecheck && npm test && npm run build:prod；涉及页面链路时跑 npm run e2e。
禁止：直连原子件、裸 hex、小于 12px、修改 tests/**、为了让用例变绿而放宽断言。
交付：改动清单 + 命令 + 关键输出 + 截图或 E2E 结果 + 未验边界。
```
