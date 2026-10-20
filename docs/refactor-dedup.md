# 重复代码抽取（Dedup Refactor）

> 实施人：小帮｜日期：2026-10-19｜范围：`frontend/src`
> 方法：`difflib` 归一化逐行比对（去注释、压空白）+ 浏览器实测前后对照
> 纪律：**先取证再动手**。每个抽取都保留参考站逐页实拍的 class 名，一个字都没改；改完必须回浏览器核对几何与交互。

---

## 0. 结论

| 指标 | 抽取前 | 抽取后 | 变化 |
|---|---|---|---|
| 跨文件重复行（≥8 行连续块） | 3558 / 9626 = **36%** | 1910 / 9397 = **20%** | **-16 个百分点** |
| ProductKitPage | 584 行 | 442 行 | -142 |
| ProductDetailPage | 564 行 | 422 行 | -142 |
| ViralClonePage | 644 行 | 513 行 | -131 |
| 新增（组件 + hook） | — | 185 + 125 = 310 行 | 净减 **-155 行** |

产出两个复用点：`components/ToolImageDropzone.tsx`（视图）、`hooks/useImageUpload.ts`（输入侧逻辑）。

---

## 1. 抽取前的重复地图

`difflib` 对 6 个大文件两两比对，≥15 行的连续块：

| 行数 | 位置 | 差异 |
|---|---|---|
| **178** | ProductKitPage:259-436 ⇄ ProductDetailPage:248-425 | `diff` 输出 **4 行**（仅一条注释不同） |
| **80** | ProductKitPage:276-355 ⇄ ViralClonePage:281-360 ⇄ ProductDetailPage:265-344 | `diff` 输出 **0 行**（逐字节相同） |
| **80** | ProductKitPage:110-189 ⇄ ProductDetailPage:108-187 | 上传逻辑 + 素材库回填 + AI 分析 |
| 41 | ProductKitPage:110-150 ⇄ ViralClonePage:109-149 | 上传逻辑的前半段 |
| 37 / 34 / 29 / 28 / 24 / 20 | 结果下载区、pk-field 组、pk-thumb 网格等 | 零散 |

按文件的重复行占比（抽取前）：ProductDetail **167%**、ProductKit 143%、ViralClone 117%、FreeCreation 112% —— 四个页面互为副本。

---

## 2. 抽取 ①：`ToolImageDropzone`（视图）

### 为什么值得抽
这些 class（`pk-upload-title-row` / `pk-dropzone` / `pk-thumb-grid` / `pk-thumb-remove` / `pk-thumb-add`）是**参考站逐页实拍值**，`global.css` 里逐条对应，**一个字都不能改**。此前 4 份拷贝意味着任何微调要同步 4 次，漏改即产生页面间漂移 —— 10-19 刚因「1:1 覆盖层静态重述属性」吃过同类的亏（`docs/workbench-design.md` §8.3-3）。

### 组件边界
划在「标题行 + 拖拽框 + 缩略图网格」这一段。上传校验/上传调用/素材库回填**不下沉**（各页文案与上限不同）。`dragging` 状态由组件内部持有 —— 全项目仅上传区消费它。

### 差异化开关（覆盖 3 种形态）

| 开关 | 用途 | 使用方 |
|---|---|---|
| `required` | 标题前红色必填星号（参考站「上传商品图」带、「上传参考图」不带） | FreeCreation 不带 |
| `sectionClassName` / `dropzoneClassName` | 额外挂 class（如 `vc-reference-section` / `pk-dropzone-reference`） | ViralClone 参考图区 |
| `single` | 单图模式：不渲染「+」补位钮、`file input` 不带 `multiple` | ViralClone 参考图区 |
| `showCount` | 标题行是否显示 `n/max` 计数器（参考图区无计数器） | ViralClone 参考图区 |
| `emptyHint` | 自定义空态副文案 | ViralClone 参考图区 |

### 刻意不抽：FreeCreation 的参考图区
它的缩略图是 `fc-thumb-grid` + `fc-thumb-order`（带前移/后移排序按钮），与 `pk-thumb-grid` **结构不同**，是另一条参考站 1:1 复刻路径。要复用只能加 `renderThumbs` 渲染洞子 —— 得不偿失且会模糊 1:1 边界。登记为「已评估、刻意不抽」。

---

## 3. 抽取 ②：`useImageUpload`（输入侧逻辑）

ProductKitPage:112-176 与 ProductDetailPage:110-174 **逐字节相同**，前 41 行在 ViralClone 也有。内容是「类型/数量/体积三重校验 → `ensureProject` → 逐张上传 → 追加 → toast」+「素材库回填」+「粘贴上传」共 79 行。

### 与既有 `useToolTask` 的分工
`hooks/useToolTask.ts` 收口的是「提交 → 轮询 → 结果」，其注释明确写了「多任务/多结果页面仍各自维护提交流程」。本 hook **只管输入侧，不碰提交流程**，两者在 `hooks/` 下并列，不构成职责重叠。

---

## 4. 验证（浏览器实测，非静态检查）

### 4.1 几何与文案：抽取前后逐项对照

| 页 | 拖拽框 | 配置卡 | 区块标题序列 | 标题行操作 | 空态文案 |
|---|---|---|---|---|---|
| product-kit | 400×160 | 432×**506** | 上传商品图/生成设置/商品描述/自定义配置/历史记录 | 从素材库导入·手机上传·0/5 | 点击、拖拽或粘贴商品图片…最多可上传 5 张商品图片，单张不超过 10MB |
| product-detail | 400×160 | 432×**506** | 上传商品图/生成设置/商品描述/包含模块（多选）/历史记录 | 同上 | 同上 |
| viral-clone | 400×160 ×2 | 432×**570** | 上传商品图/上传参考图（爆款图）/生成设置/复刻要求/复刻程度/历史记录 | 4 项（两个区各一组） | 参考图区为「上传或粘贴要复刻风格的参考图，最多 1 张…」 |
| free-creation | 400×160 | 432×**368** | 上传参考图/历史记录 | 从素材库导入·手机上传·0/4 | 参考图片版 |

**抽取前后这些值逐项相同**（含配置卡高度，说明 DOM 结构与内容高度都没变）。

### 4.2 差异化开关确实生效（viral-clone）

```
dropzone class : ["pk-dropzone", "pk-dropzone pk-dropzone-reference"]
file input     : ["multiple", "single"]
vc-reference-section : 存在
空态副文案     : ["最多可上传 5 张商品图片，单张不超过 10MB",
                 "上传或粘贴要复刻风格的参考图，最多 1 张，单张不超过 10MB"]
```

### 4.3 真实上传链路（`setInputFiles` 灌入 8×8 PNG）

| 页 | 计数器 | 缩略图数 | filled 态 | 移除 |
|---|---|---|---|---|
| product-kit | 1/5 | 1 | ✅ | ✅ |
| product-detail | 1/5 | 1 | ✅ | ✅ |
| viral-clone | 1/5 | 1 | ✅ | ✅ |

静态渲染通过不算数 —— 上传逻辑搬进 hook 后必须走真实链路验证，否则「三重校验 + ensureProject + 逐张上传」里任何一处引用错位都会在提交时才炸。

### 4.4 回归
5 个工具页（product-kit / product-detail / viral-clone / free-creation / product-sku）全部：无 ErrorBoundary 触发、无 `pageerror`、`docScrollW == clientW`。

---

## 5. 过程中踩到的坑

| 坑 | 现象 | 修法 |
|---|---|---|
| **ErrorBoundary 吞掉运行时错误** | `/product-kit` 白屏但 `pageerror` 为 `none`、`verify-dz.cjs` 只报 `!no-dropzone` | 补监听 `console.error` 里含 `[ErrorBoundary]` 的行，才拿到真因：`ReferenceError: pickFromLibrary is not defined`（`AssetLibraryModal onPick` 仍指向被删掉的局部函数，应改用 hook 返回的 `pick`） |
| **搬 hook 时误删仍在用的导入** | `useProject` 导入被连带删掉，但页面生成流程仍要 `ensureProject` | 逐符号用 `re.findall(r'\bX\b')` 计数核对，而不是凭印象改导入 |
| **`setInputFiles` 对 `hidden` input 报 not visible** | 选择器 `.pk-dropzone input[type=file]` 超时 | `waitForSelector` 改等父级 `.pk-dropzone`，再用 `setInputFiles`（该 API 不要求可见） |

---

## 6. 还没抽的（按收益排序，留给下一批）

| 候选 | 规模 | 评估 |
|---|---|---|
| 结果操作条（下载/复制） | ProductDetail:440 / FreeCreation:493 / ViralClone:463，29+20+20 行 | 可抽 `ToolResultActions`，三页结构一致 |
| 「生成设置」表单区 | ProductKit:295 ⇄ ViralClone:316 ⇄ ProductDetail:284，34 行 | 字段名随页变（商品名称/品牌/平台/语言 vs 复刻要求），需要配置驱动式 props，中等收益 |
| 提交 + 轮询 | 每页 40–60 行 | **建议不抽**：`useToolTask` 注释已明确「多任务/多结果页面结构不同」，强行统一会破坏各页的结果模型 |
| CSS 重复规则 | `global.css` 8585 行 | 10-19 已清过一轮（删卡片 hover 重复块），剩余多为参考站逐页 1:1 值，**刻意保留** |

---

## 7. 证据

| 文件 | 内容 |
|---|---|
| `docs/refactor-ref/before-product-kit.png` / `before-product-detail.png` / `before-viral-clone.png` | 抽取前三页基线实拍 |
| `docs/refactor-ref/after-product-kit.png` / `after-product-detail.png` / `after-viral-clone.png` | 抽取后回归实拍 |
| `docs/refactor-ref/viral-clone-two-dropzones.png` | 爆款复刻双上传区（差异化开关生效证据） |
| `docs/refactor-ref/upload-product-kit.png` | 真实上传后的缩略图态 |
| `/tmp/ijihua-scrape/verify-dz.cjs` | 几何/文案对照脚本（可复跑） |
| `/tmp/ijihua-scrape/verify-upload.cjs` | 真实上传链路脚本 |