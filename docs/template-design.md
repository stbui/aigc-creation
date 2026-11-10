# 写真模板 `/template`

2026-11-10 实施。C 端独立工作台，页面结构对齐 [`shoppable-carousel-design.md`](shoppable-carousel-design.md)。

## 1. 定位

上传 1–5 张人物照片，从模板列表里选一套婚纱写真，生成同款场景 / 服装 / 光影的人像成片。
模板的预览图与提示词一一对应 —— 用户看到的就是提交给模型的风格描述。

## 2. 页面结构

```
左栏 400px
├─ 上传人像照片（1–5 张，拖拽 / 粘贴 / 素材库 / 手机上传）
├─ 已选模板回显（72×96 预览图 + 提示词 + 清除）
└─ 固定底栏（高级设置：比例 / 画质 / 模型 + 渐变提交）

右栏
├─ 分类 tab：全部模板 / 婚纱写真 / 纯色棚拍 / 室内布景 / 户外庭院
├─ 模板网格：竖版预览图 + 模板名 + 提示词（选中品牌紫描边；提示词可展开）
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
| 模板清单 / 分类 | `backend/src/capabilities/definitions/template.templates.ts` |
| 模板清单接口 | `GET /api/v1/template/templates`（公开免登录） |
| 页面 | `frontend/src/pages/template/` |
| 缩略图 | `frontend/public/templates/wedding/`（运行时不请求外部站点） |

## 5. 模板与图片来源

共 10 套龙凤褂中式写真模板，图片与提示词提取自微信公众号文章
`https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw`（《龙凤褂婚纱 AI 写真 10 个提示词》）。
每条提示词与文章中的配图一一对应；原图保留 **1080×1440** 分辨率并转为 WebP（质量 90），
只保留本地文件，运行时不请求外部站点。

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
