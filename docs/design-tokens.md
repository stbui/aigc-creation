# 设计令牌标准

全站颜色、圆角、阴影与组件几何值的唯一事实源是 [`frontend/src/styles/tokens.css`](../frontend/src/styles/tokens.css) 的 `:root`。本文件规定令牌怎么分层、怎么命名、加在哪里、谁能引用。

与 [`typography.md`](typography.md) 的分工：本文件管「令牌体系」，`typography.md` 管字体栈、字号与组件微规格。

## 1. 三层结构

`tokens.css` 内按顺序分三层，声明顺序即层级顺序：

| 层 | 放什么 | 谁能引用 | 当前数量 |
| --- | --- | --- | --- |
| **基础层 Primitive** | 与业务语义无关的原子值与几何：五档圆角、胶囊、阴影 | 任意层 | 8 |
| **通用层 Semantic** | 跨页面语义：品牌、文字、边框、表面、状态、遮罩与渐变 | 所有页面与组件 | 97 |
| **组件层 Component** | 页面/组件专属的精确值：外壳、工具页、工作台、多图融合、商品 SKU、素材库、手机上传、认证、首页、网站地图 | 仅同名页面/组件 | 394 |

合计 499 个令牌（2026-11-11）。数量会随页面增减，以 `tokens.css` 为准。

### 1.1 为什么基础层没有色板

参考站 1:1 复刻留下 361 个一次性色值（`--sku-text-1..22`、`--alp-text-1..13` 等），每个只服务一个页面。把它们抽成 `--gray-*` 色阶会得到 300 多个无复用的一次性“原子”，只增加间接层，不产生统一收益。

因此基础层只收真正跨页复用的几何值；颜色统一走语义层与组件层。只有同一个字面值被 **两个以上层级** 复用时，才考虑新增基础色阶并让语义层 `var()` 引用它。

### 1.2 组件层为什么仍在 `:root`

组件令牌没有下沉到 `.multi-image-fusion-page` / `.product-sku-page` 等页面根，原因是弹层：`ToolSettingsPopover`、`AssetLibraryModal`、`SkuRegionEditorModal` 等通过 portal 渲染到 `body`，页面根上的自定义属性不会继承过去，下沉会静默丢色。

隔离靠 **前缀约定**，不靠作用域：

- 页面 CSS 只能引用自己的组件前缀（`pages/workbench/style.css` 用 `--wb-*`）。
- 组件令牌被第二个组件引用时，说明它已不是组件级：提升为通用层，保留原名作为别名或全量替换。
- 新增页面时先申请新前缀，再在 `tokens.css` 的 `3.x` 段落追加；不要在页面 CSS 里新开 `:root`。

## 2. 命名规范

| 层 | 格式 | 示例 |
| --- | --- | --- |
| 基础层 | `--<类别>-<刻度>` | `--radius-control`、`--shadow-card` |
| 通用层 | `--<语义>-<角色>` | `--text-strong`、`--danger-soft-bg`、`--brand-hover` |
| 组件层 | `--<缩写>-<语义>` | `--wb-hero`、`--mif-radius-card`、`--sku-surface-brand-2` |

补充规则：

- 状态色按「填充 / 文字 / 描边 / 淡底」拆名，不靠同值兼任：`--danger-text` 用于文字，`--danger-soft-bg` 用于底色，`--danger-ref` 用于星号等点缀。
- 编号色阶（`--surface-1..6`、`--text-1..10`、`--sku-text-1..22`）是历史裸 hex 的收口产物，按明度编号；新代码优先用语义名，不再新增编号组。
- `--color-*`、`--brand-strong/-active/-accent/-grad-end`、`--radius` 是兼容别名，集中放在 `2.1`。新代码不引用、不新增；改到相关页面时顺手替换为语义名，存量清零后再删除整段。

## 3. 引用规则

1. **页面与组件优先引用通用层**。品牌色、文字、边框、表面、状态一律走 `--brand` / `--text-*` / `--border*` / `--surface*` / `--danger-*` / `--success-*` / `--warn-*`。
2. **基础层可直接引用**。圆角、阴影是布局与层级值，页面直接用 `--radius-control` / `--shadow-card`，不必再包一层语义别名。
3. **组件层不得跨组件引用**。发现跨用即提升到通用层；在两个组件里各写一份同值令牌是错误的。
4. **页面 CSS 不写裸 hex、不新增 `:root`**。色值只出现在 `tokens.css`；实际声明中的裸 hex 必须为 0。
5. **字号不建令牌**。字号与行高按 [`typography.md`](typography.md) 的阶梯直接写，全站最小 12px。
6. **禁止同值同义新令牌**。新增前先按语义搜索，再按值搜索；两处都命中就复用已有令牌。

## 4. 新增令牌流程

1. 先判断用途：跨页面语义 → 通用层；单页面/组件 → 组件层；纯几何原子 → 基础层。
2. 在 `tokens.css` 对应段落追加，带上用途注释与必要的对比度说明（状态色、弱文字需要给出 AA 依据）。
3. 同步检查 `admin.css` / `ui/styles.css` 的 `@theme inline` 是否需要桥接（仅 shadcn 语义变量需要）。
4. 若新增的是组件前缀，在 `docs/frontend-module-conventions.md` 的页面 CSS 归属段落里补一行归属。
5. 跑审计：确认令牌无重复、页面无裸 hex、无 12px 以下字号。

## 5. 审计命令

```bash
cd frontend

# 令牌总数；`═════════` 标出三层与各组件段的边界
grep -cE '^\s+--[a-z0-9-]+:' src/styles/tokens.css
grep -n '═════════' src/styles/tokens.css

# 实际声明中的裸 hex（应为 0；注释里的参考站实拍值不算）
node --input-type=module <<'EOF'
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import postcss from 'postcss';

let n = 0;
const files = execSync('find src -name "*.css"').toString().trim().split('\n');
for (const f of files) {
  if (/tokens\.css$|admin\.css$|ui\/styles\.css$/.test(f)) continue;
  postcss.parse(fs.readFileSync(f, 'utf8')).walkDecls((d) => {
    if (/#[0-9a-f]{3,8}\b/i.test(d.value)) {
      n += 1;
      console.log(f, d.prop, d.value);
    }
  });
}
console.log('raw hex declarations:', n);
EOF
```

## 6. 与代码同步

- 令牌改动只改 `tokens.css`；`global.css` 只负责 `@import` 顺序，不承载声明。
- 页面规格文档与 `tokens.css` 冲突时，以 `tokens.css` 为准。
- 后台 `styles/admin.css` 与前台 `ui/styles.css` 的 `@theme inline` 只做语义桥接，不另定义色值。
