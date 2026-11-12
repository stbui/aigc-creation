# 写真模板 `/template`

2026-11-10 实施。C 端独立工作台，页面结构对齐 [`shoppable-carousel-design.md`](shoppable-carousel-design.md)。

## 1. 定位

上传 1–5 张人物照片，从模板列表里选一套写真模板（婚纱摄影 / 情侣写真 / 女生写真 / 男生写真 /
职业形象 / 宝宝写真 / 精英人生），生成同款场景 / 服装 / 光影的人像成片。
模板的预览图与提示词一一对应，但**提示词只在服务端**：C 端公开目录不下发、页面也不展示，
用户按预览图选型，提交时只传 `templateId`。

## 2. 页面结构

```
左栏 400px
├─ 上传人像照片（1–5 张，拖拽 / 粘贴 / 素材库 / 手机上传）
├─ 已选模板回显（72×96 预览图 + 模板名 + 清除）
└─ 固定底栏（高级设置：比例 / 画质 / 模型 + 渐变提交）

右栏
├─ 一级分类 tab：全部模板 / 婚纱摄影 / 情侣写真 / 女生写真 / 男生写真 / 职业形象 / 亲子写真 / 宝宝写真 / 精英人生
├─ 二级分类胶囊：选中一级分类后显示「全部分组 + 该分类下的分组」（一篇来源文章 = 一个分组；婚纱摄影 10 组、情侣写真 6 组、女生写真 18 组、男生写真 5 组、职业形象 3 组、宝宝写真 15 组、精英人生 3 组；亲子写真暂为空）
├─ 模板网格：竖版预览图 + 模板名（选中品牌紫描边，不显示标签 / 角标 / 大图入口）
└─ 底部「最近生成」历史条：单张缩略图，「全部记录」打开生成记录抽屉
```

## 3. 生成规则

- **至少上传 1 张照片**：能力 `inputs: 1`、`maxInputs: 5`，准入层在扣费前拒绝 0 张与超额提交。
- 提交参数只有 `templateId` / `ratio` / `size`；服务端按 `templateId` 查回模板提示词，
  与上传照片一起组成模型请求（`buildPrompt` 在 `backend/src/capabilities/definitions/template.ts`）。
- 未知 / 缺失模板 id 在 `validateCapabilityParams` 阶段返回 `40001`，不会落到兜底风格。
- 与站内其它图像能力同链路：无可用线路时任务失败 `42204` 并退款，不交付伪结果。

## 4. 事实源

| 内容 | 位置 |
| --- | --- |
| 能力定义 / 提示词 | `backend/src/capabilities/definitions/template.ts` |
| 模板目录（运行期事实源） | 数据库 `TemplateCategory` → `TemplateGroup` → `TemplateItem` |
| 初始种子数据 | `backend/src/capabilities/definitions/template.templates.ts` + `backend/scripts/seed-template-catalog.ts` |
| 扩充目录（分类 / 分组 / 提示词 / 来源） | `backend/src/capabilities/definitions/portrait-templates.import.ts` |
| 扩充导入脚本 | `backend/scripts/import-portrait-templates.ts`（`npm run import:templates`） |
| 生成侧 id 查找表 | `template.templates.ts` 的 `TEMPLATE_BY_ID`（初始 30 套 + 扩充 520 套） |
| 公开接口 | `GET /api/v1/template/templates`（免登录，只下发启用内容，**不含提示词**） |
| 后台接口 | `GET/POST/PATCH/DELETE /api/v1/admin/templates/*`（`template.read` / `template.write`） |
| 后台页面 | `frontend/src/pages/admin/templates/`（`/admin/templates`） |
| C 端页面 | `frontend/src/pages/template/` |
| 缩略图 | `frontend/public/templates/<分类 slug>/`（运行时不请求外部站点） |

## 5. 模板与图片来源

初始 30 套分三批从微信公众号文章提取（§5.1–§5.3）；2026-11-11 又从 60 篇文章扩充 520 套（§5.4），
现共 **550 套模板 / 8 个一级分类 / 60 个二级分类**。每条提示词与文章配图一一对应。
原图按原始分辨率转为 WebP（质量 90，主流为 **1080×1440**，横版为 1080×810），
只保留本地文件，运行时不请求外部站点。

### 5.1 龙凤褂中式写真（10 套）

来源：`https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw`（《龙凤褂婚纱 AI 写真 10 个提示词》）。

| 模板 | 本地文件 |
| --- | --- |
| 红墙团扇 | `longfeng-01-red-wall-fan.webp` |
| 双喜砖墙 | `longfeng-02-double-happiness-wall.webp` |
| 东方情侣 | `longfeng-03-oriental-couple.webp` |
| 屏风双喜 | `longfeng-04-screen-double-happiness.webp` |
| 温婉团扇 | `longfeng-05-tender-fan.webp` |
| 竹编灯笼 | `longfeng-06-bamboo-lantern.webp` |
| 格栅暖棕 | `longfeng-07-warm-lattice.webp` |
| 秀禾长凳 | `longfeng-08-xiuhe-bench.webp` |
| 酒红影棚 | `longfeng-09-wine-red-studio.webp` |
| 深红近景 | `longfeng-10-crimson-closeup.webp` |

### 5.2 花海婚纱（10 套）

来源：`https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw`（《花海婚纱照 AI 写真 10 个提示词》）。

| 模板 | 本地文件 |
| --- | --- |
| 草坪花海 | `flower-01-lawn-flower-sea.webp` |
| 花门拱窗 | `flower-02-flower-arch-window.webp` |
| 花枝拥吻 | `flower-03-flower-column-kiss.webp` |
| 棕榈草坪 | `flower-04-palm-lawn.webp` |
| 日落花海 | `flower-05-sunset-flower-sea.webp` |
| 绿植花房 | `flower-06-green-flower-room.webp` |
| 蓝纱花柱 | `flower-07-blue-dress-flower-column.webp` |
| 绿墙蝴蝶结 | `flower-08-green-wall-bow.webp` |
| 木屋花境 | `flower-09-wooden-house-flower.webp` |
| 蔷薇花园 | `flower-10-rose-garden.webp` |

### 5.3 校园操场（10 套）

来源：`https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g`（《操场情侣 AI 写真 10 个提示词》）。

| 模板 | 本地文件 |
| --- | --- |
| 草坪并坐 | `campus-01-lawn-sitting.webp` |
| 气球合影 | `campus-02-balloon-photo.webp` |
| 泡泡相机 | `campus-03-bubble-camera.webp` |
| 城堡草坪 | `campus-04-castle-lawn.webp` |
| 看台并坐 | `campus-05-stands-sitting.webp` |
| 黄色看台 | `campus-06-yellow-stands.webp` |
| 看台牵手 | `campus-07-stands-holding-hands.webp` |
| 草坪头纱 | `campus-08-lawn-veil.webp` |
| 操场婚纱 | `campus-09-field-wedding.webp` |
| 球场摸头 | `campus-10-field-head-pat.webp` |

### 5.4 扩充批次（2026-11-11，520 套 / 56 个分组）

来源：用户提供的 60 篇微信公众号文章，按 7 个一级分类组织 —— 女生写真 18 篇、
宝宝写真 17 篇、职业形象 3 篇、男生写真 5 篇、精英人生 3 篇、情侣写真 4 篇、婚纱摄影 10 篇。
**一篇来源文章 = 一个二级分类**，分组名取自文章主题；每条模板的 `sourceUrl` 保留原文链接，
完整目录在 `backend/src/capabilities/definitions/portrait-templates.import.ts`。

提取方式：正文按「指令 N」切分，`figcaption` 文本为提示词、其后第一张 `mmbiz.qpic.cn`
图片为预览图，依次配对。预览图落在 `frontend/public/templates/<分类 slug>/<模板 id>.webp`。

**去重口径**：提示词去掉全部空白与标点后取 SHA1，与数据库现有 30 套及本次已收录项比对，
同一指纹只保留首次出现的条目。60 篇共解析 599 条，剔除 18 条与现有模板完全相同、
61 条跨文章重复，保留 520 条；其中「国风中秋宝宝」「莫奈花园婚纱」两篇为全量重复，
对应分组不落地。去重后仅剩 1 条的两个分组（云朵城堡 → 梦幻童话、漫天花海 → 韩系极简）
并入语义最接近的分组，模板 id 与预览图路径保持不变、原主题名保留在 tags 中，避免出现只有一张图的空荡分类。
图片按 URL 归一后再按下载内容 SHA1（原始字节 + 解码像素双重校验），520 张互不重复。
按分类分布：女生 164 / 宝宝 140 / 婚纱 80 / 男生 42 / 情侣 34 / 职业 30 / 精英 30。

**追加补录（第 60 篇）**：`https://mp.weixin.qq.com/s/V1E9RollgFVNIQcXKPJv2A`
（女生写真「小众耐看的 Ins 高级 AI 写真」，分组 `fp-18 ins 商业大片`）。原文 10 条中
6 条提示词与 `fp-10 ins 松弛感` 完全相同（`fp-10-01/02/03/06/07/09`），按指纹规则剔除，
仅落地 4 条（`fp-18-01/05/06/07`，沿用原文指令序号作为 id 后缀）。10 张配图内容均与
既有 516 张不重复，被剔除条目对应的配图不落地。

**幂等导入**：`npm run import:templates` 按固定 id 写入，已存在即跳过，不覆盖后台改名、
调序、停用与删除；重跑只补齐缺失项。扩充模板同时并入 `template.templates.ts` 的
`TEMPLATE_BY_ID`，因此 `validateCapabilityParams` 与 `Template.buildPrompt` 都能按新 id 查回提示词。

## 6. 后台管理

后台页面 `/admin/templates`（内容与合规 → 写真模板）按三级结构维护：

```
一级分类（主题）
└─ 二级分类（来源文章 / 风格）
   └─ 模板（图片 + 提示词 + 标签）
```

- 两栏工作台：左侧分类目录（一级分类 + 选中分类下的二级分类），右侧模板工作区
  （搜索 / 启用状态筛选 / 卡片网格 / 图片与提示词预览）。
- 模板网格默认每页 50 套；搜索、状态筛选、标签筛选与目录切换都会回到第一页。
- 页头「新建模板」是直达入口：不要求先选中二级分类，抽屉内选择所属分组后即可填写
  图片与提示词；从分组视图进入时预选当前分组。
- 点击模板卡片上的标签可按该标签精确筛选；工具栏显示当前标签，可一键清除；
  切换分类 / 分组时自动清空标签筛选。卡片上的分组名与标签排在同一行，分组名可点，
  直接跳转到左侧对应的二级分类。
- 模板卡片底部平铺「编辑 / 复制 / 删除」三个操作，不再收进 `…` 菜单。
- 左侧分类目录的分类 / 分组操作默认隐藏，鼠标悬停或键盘聚焦该行时显示编辑、删除图标。
- 三层都支持新建 / 编辑 / 删除。
  模板额外支持复制：同分组生成副本（名称追加「（副本）」，沿用图片 / 提示词 / 标签 / 排序），
  副本默认停用，确认后再启用。
  一级分类删除级联删除其下分组与模板，二级分类删除级联删除其下模板，
  确认弹窗列出将删除的数量。
- 模板图片可上传到当前存储后端（PNG / JPEG / WebP），返回稳定引用
  `storage://<backend>/<key>`；C 端读取时由 `SettingImageService` 重新解析为可访问地址。
  WebP 因 Jimp 1.6 无解码器，仅做文件头 / 尺寸 / 像素上限校验后直接落库。
- 标签在后台用逗号分隔编辑，后端归一为 JSON 数组（去重、单条 ≤20 字、最多 8 个）。
- 读写权限分离：`template.read` / `template.write`；operator 默认两者都有。

种子脚本 `npm run seed:templates` 在**目录为空时**导入 30 套模板与 8 个一级分类、4 个二级分类；
目录非空则整体跳过，之后完全交给后台维护 —— 后台删除的模板不会被下次启动重新建回来。

扩充导入脚本 `npm run import:templates` 是显式的一次性补录，按固定 id 增量写入 56 个分组、
520 套模板，重跑只跳过已存在项、不覆盖后台修改；它不参与 `seed:all`，
避免每次全量建库都把已下架的内容重新灌回来。
