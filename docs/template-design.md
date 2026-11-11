# 写真模板 `/template`

2026-11-10 实施。C 端独立工作台，页面结构对齐 [`shoppable-carousel-design.md`](shoppable-carousel-design.md)。

## 1. 定位

上传 1–5 张人物照片，从模板列表里选一套婚纱写真，生成同款场景 / 服装 / 光影的人像成片。
模板的预览图与提示词一一对应 —— 用户看到的就是提交给模型的风格描述。

## 2. 页面结构

```
左栏 400px
├─ 上传人像照片（1–5 张，拖拽 / 粘贴 / 素材库 / 手机上传）
├─ 已选模板回显（72×96 预览图 + 提示词 + 标签 + 清除）
└─ 固定底栏（高级设置：比例 / 画质 / 模型 + 渐变提交）

右栏
├─ 一级分类 tab：全部模板 / 婚纱摄影 / 情侣写真 / 女生写真 / 男生写真 / 职业形象 / 亲子写真 / 宝宝写真 / 精英人生
├─ 二级分类胶囊：选中一级分类后显示「全部分组 + 该分类下的分组」（婚纱摄影 → 龙凤褂 / 花海婚纱；情侣写真 → 草坪操场 / 看台；其余分类待补充二级分类）
├─ 模板网格：竖版预览图 + 模板名 + 提示词 + 标签（选中品牌紫描边；提示词可展开）
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
| 公开接口 | `GET /api/v1/template/templates`（免登录，只下发启用内容） |
| 后台接口 | `GET/POST/PATCH/DELETE /api/v1/admin/templates/*`（`template.read` / `template.write`） |
| 后台页面 | `frontend/src/pages/admin/templates/`（`/admin/templates`） |
| C 端页面 | `frontend/src/pages/template/` |
| 缩略图 | `frontend/public/templates/wedding/`（运行时不请求外部站点） |

## 5. 模板与图片来源

共 30 套模板，分三批从微信公众号文章提取；每条提示词与文章配图一一对应。
原图保留 **1080×1440**（横版为 1080×810）分辨率并转为 WebP（质量 90），
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

## 6. 后台管理

后台页面 `/admin/templates`（内容与合规 → 写真模板）按三级结构维护：

```
一级分类（主题）
└─ 二级分类（来源文章 / 风格）
   └─ 模板（图片 + 提示词 + 标签）
```

- 两栏工作台：左侧分类目录（一级分类 + 选中分类下的二级分类），右侧模板工作区
  （搜索 / 启用状态筛选 / 卡片网格 / 图片与提示词预览）。
- 三层都支持新建 / 编辑 / 删除；一级分类删除级联删除其下分组与模板，
  二级分类删除级联删除其下模板，确认弹窗列出将删除的数量。
- 模板图片可上传到当前存储后端（PNG / JPEG），返回稳定引用
  `storage://<backend>/<key>`；C 端读取时由 `SettingImageService` 重新解析为可访问地址。
- 标签在后台用逗号分隔编辑，后端归一为 JSON 数组（去重、单条 ≤20 字、最多 8 个）。
- 读写权限分离：`template.read` / `template.write`；operator 默认两者都有。

种子脚本 `npm run seed:templates` 在**目录为空时**导入 30 套模板与 8 个一级分类、4 个二级分类；
目录非空则整体跳过，之后完全交给后台维护 —— 后台删除的模板不会被下次启动重新建回来。
