# AI 带货图文模板 —— 来源与抓取记录

本文是 `backend/src/capabilities/definitions/shoppable-carousel.templates.ts` 与
`frontend/public/templates/shoppable-carousel/` 的**来源说明**，也是这两处资产的可追溯凭据。

> 结论先行：模板的**分类、名称、三拍文案、缩略图**均已整套搬进本仓库，
> 页面运行时**不请求参考站**，不热链任何外部图片。

---

## 1. 抓取信息

| 项 | 值 |
| --- | --- |
| 来源页面 | `https://www.designkit.cn/shoppable-carousel?from=product_kit_web` |
| 抓取时间 | **2026-10-26T07:09:48.232Z**（首轮，见 `manifest.json` 的 `capturedAt`） |
| 抓取工具 | Playwright + 本机 Chromium 1134（`--no-proxy-server`，locale `zh-CN`） |
| 抓取脚本 | `frontend/e2e/audit/extract-shoppable-carousel.mjs`（本仓库内，可复跑） |
| 布局/交互取证 | 2026-11-03，四支探针（`probe-shoppable-{layout,interact,final,history}.mjs`），结果记入 `docs/shoppable-carousel-design.md` |

抓取脚本做的事（逐条可核）：

1. 打开来源页，等待 `social-media-card-*` 出现，断言模板总数 = 49 且名称唯一；
2. 断言分类按钮数 = 10（不含「全部模板」），逐个点击切换并读取该分类下的卡片；
3. 每张卡断言 **三拍文案**（`text` 按 `→` 切分必须恰为 3 段）与 **三张预览图**；
4. 用 `page.evaluate` 加载每张原图取 `naturalWidth/Height`；
5. 用 `context.request.get` 下载原图落盘到 `frontend/public/templates/shoppable-carousel/`，
   并断言响应体 > 1000 字节（防占位图）；
6. 写出 `manifest.json`（含每张图的 `sourceUrl` / `width` / `height` / `bytes`）。

## 2. 落库资产

| 项 | 数量 | 位置 |
| --- | --- | --- |
| 模板 | **49** | `backend/src/capabilities/definitions/shoppable-carousel.templates.ts` → `SHOPPABLE_CAROUSEL_TEMPLATES` |
| 业务分类 | **10** | 同文件 → `SHOPPABLE_CAROUSEL_CATEGORIES` |
| 缩略图文件 | **147**（49 × 3） | `frontend/public/templates/shoppable-carousel/<id>-<1..3>.webp` |
| 清单元数据 | 1 | `frontend/public/templates/shoppable-carousel/manifest.json` |

核对（2026-11-03 实跑）：

```
manifest templates: 49    manifest images: 147    files on disk: 147    missing files: 0
```

### 图片规格

| 规格 | 张数 | 说明 |
| --- | --- | --- |
| 400 × 542 | 9 | 少数模板的竖图尺寸 |
| 400 × 533 | 138 | 主流规格 |

> 参考站卡片里三张预览是**并排**的竖图（每槽 94×127，`object-fit` 裁切）。本站按同样比例渲染，
> 用 `aspect-ratio` + `object-fit: cover`，不依赖原始像素尺寸。

### 命名规则

`<分类码>-<两位序号>-<1|2|3>.webp`，序号是该分类内的出现顺序，与 manifest 一一对应。
跨分类复用的模板**只存一份图**，归属写在 `categoryIds`（数组）里。

## 3. 分类清单（10 项，与参考站顺序一致）

| 序 | 参考站分类文案 | 本站分类码 |
| --- | --- | --- |
| 1 | 男装/女装/运动服饰 | `apparel` |
| 2 | 鞋包/配饰 | `accessories` |
| 3 | 运动器械/户外装备 | `outdoor` |
| 4 | 家具/家装 | `home` |
| 5 | 日用/家纺 | `household` |
| 6 | 五金/工具/汽摩 | `hardware` |
| 7 | 3C数码/家电 | `digital` |
| 8 | 美妆/个护 | `beauty` |
| 9 | 健康/保健 | `health` |
| 10 | 玩具/盲盒 | `toys` |

页面另有第 0 项「全部模板」，为纯前端筛选态，不落库。

## 4. 跨分类模板（5 个）

参考站同一模板可挂在多个分类下。抓取脚本按模板名去重，`categoryIds` 保留全部归属：

| 模板名 | 归属 |
| --- | --- |
| 车内拆箱上手 | `apparel` + `accessories` |
| 手机直出痛点安利 | `household` + `digital` |
| 居家四处种草 | `home` + `household` |
| 左右对照见效 | `household` + `digital` |
| 暗光微距质感 | `accessories` + `digital` |

## 5. `promptFragment` 的口径（重要）

参考站**未公开**站内提示词原文。`promptFragment` 是本站依据公开可见信息合成的
**可执行结构化提示词**，来源只有两项：

1. 模板的公开标题（如「沉浸开箱试穿」）；
2. 卡片上公开的三拍文案（如「开箱静物 → 多场景上身 → 细节收尾」）。

合成规则统一为：

```
以「<标题>」为三拍叙事结构：<拍1> → <拍2> → <拍3>。
三张画面保持同一商品、包装、颜色与材质一致，突出核心卖点；
不生成品牌 logo、价格标签、平台水印或无关文字。
```

**这不是参考站提示词的复制**，是本站按三拍结构重新表述的可执行版本。
文件头注释对此有明确声明，避免后续被误当成「官方提示词」。

## 6. 缺口清单

抓取完成时 **无缺口**：49 个模板全部取到三张缩略图，无懒加载未渲染、无需登录的条目、
无下载失败（脚本对每次下载都做了非空断言，失败会直接抛错中止，不留半套数据）。

后续维护时若出现下列情况，须回到本节登记，不得静默用占位图顶替：

| 情形 | 处理 |
| --- | --- |
| 某模板新增/下架 | 改 `extract-shoppable-carousel.mjs` 的断言后重跑，同步 TS 与 manifest |
| 某模板取不到缩略图 | 在 TS 中保留条目、缩略图字段指向项目自有占位文件，模板卡标注「待补」，并在本节追加一行缺口记录 |
| 参考站改图 | 本仓库的副本**不受影响**（不热链）；如需跟进，人工重跑脚本并更新 `capturedAt` |

## 7. 使用约束

- **不热链**：页面渲染的 `thumbFiles` 全部指向 `/templates/shoppable-carousel/*.webp`（本站静态资源），
  源站 URL 仅保留在 `manifest.json` 与本文件里作追溯用。
- **不带参考站品牌资产**：未引入其 logo、角标、付费标记（美豆计价等），
  缩略图内容本身是商品场景图，不含站点水印（抓取时按原图落盘，如原图带水印属上游素材问题，
  已在下方「已知限制」登记）。
- **素材可用性属产品确认项**：49 个模板的缩略图仅用于模板卡预览，**不参与生成**。
  生成走真实模型链路，参考图是用户上传的商品图，不是模板缩略图。

## 8. 已知限制

1. **上游素材水印**：缩略图按原图落盘，未做去水印处理。若个别图片含第三方水印，
   属上游素材的授权问题，需产品/法务确认后再对外展示 —— 这是**素材可用性确认项**，不阻塞功能开发。
2. **缩略图非生成产物**：模板卡上的三张图是参考站的历史出图示例，
   本站模板卡只作为「版式参考」，实际产出由用户上传的商品图 + 模板的 `promptFragment` 经真实模型生成。
