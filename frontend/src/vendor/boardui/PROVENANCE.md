# BoardUI 源码来源

- 上游仓库：https://github.com/BoardUI/boardui
- 固定 commit：`ec5c5eb`（2026-10-02）
- 抓取方式：`codeload.github.com` tarball（`refs/heads/main`），抓取日期 2026-10-30
- 许可：MIT License，Copyright (c) 2026 Mertcan Dundar Esmergul (BoardUI)，原文见同目录 `LICENSE`
- 范围：仅免费层（免费组件与 token），未包含 Pro 内容

## 收录范围

只收录 `admin-ui` 实际消费的组件及其静态依赖（33 个文件），不做整仓拷贝：

- `components/base/`：buttons / input / select / badges / tooltip / pagination / tabs / dropdown / checkbox / switch / segmented-control / divider / kbd / textarea / table / avatar
- `components/application/`：agent-log / agent-thinking / notification-center / data-table
- `components/foundations/`：direction / icons / template-copy
- `utils/`：cx / directional-icon / use-dismiss-on-outside-press
- `styles/`：theme.css / typography.css

## 相对上游的改动

无。文件内容保持上游原样，`@/...` 导入由 Vite 别名（`@` → `src/vendor/boardui`）与
`tsconfig.paths` 解析，避免批量改 import 导致升级时无法直接覆盖。

## 依赖

`react-aria-components`、`@remixicon/react`、`motion`、`@tanstack/react-table` 为这些组件
的源码硬依赖，版本与上游 `package.json` 声明的主版本对齐，精确锁定在根 `package.json`。
Remix 图标只允许出现在 vendor 内部；`admin-ui` 与业务页面统一用 lucide。
