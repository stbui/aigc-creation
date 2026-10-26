# AI 带货图文模板来源与清单

## 抓取事实

- 参考页面：https://www.designkit.cn/shoppable-carousel?from=product_kit_web
- 抓取时间：2026-10-26T07:09:48.232Z（UTC；北京时间 2026-10-26 15:09:48）
- 工具：Playwright Chromium 1134 / extract-shoppable-carousel.mjs
- 抓取口径：Playwright 浏览器 DOM，读取每个模板卡的三张预览图、标题与三拍文案；未读取或推测参考站未公开的模型提示词。
- 模板数量：**49 个唯一模板**（“全部模板”顺序）。
- 预览图：**147 张 WebP**，原始展示尺寸 400×533 或 400×542。
- 本地目录：`frontend/public/templates/shoppable-carousel/`
- 唯一事实源：`backend/src/capabilities/definitions/shoppable-carousel.templates.ts`
- 图片来源 manifest：`frontend/public/templates/shoppable-carousel/manifest.json`
- 复现脚本：`frontend/e2e/audit/extract-shoppable-carousel.mjs`

## 数据结构说明

- 参考站卡片实际包含 **3 张连续预览图**，与三拍文案一一对应，因此数据同时提供：
  - `thumbFile`：首图快捷字段；
  - `thumbFiles`：完整三张预览；
  - `beats[3]`：三拍描述。
- `promptFragment` 由公开的模板名称与三拍文案合成，是本站可执行的结构化提示词；它不是参考站隐藏提示词原文。
- 卡片上的“查看”按钮只展示预览，不暴露额外提示词；本次没有把预览页的交互当成提示词来源。

## 分类统计

共 10 个分类、49 个唯一模板。一个模板可属于多个分类，因此分类命中总数为 54。

| code | 分类 | 模板数 |
| --- | --- | ---: |
| `apparel` | 男装/女装/运动服饰 | 7 |
| `accessories` | 鞋包/配饰 | 4 |
| `outdoor` | 运动器械/户外装备 | 2 |
| `home` | 家具/家装 | 5 |
| `household` | 日用/家纺 | 9 |
| `hardware` | 五金/工具/汽摩 | 3 |
| `digital` | 3C数码/家电 | 8 |
| `beauty` | 美妆/个护 | 7 |
| `health` | 健康/保健 | 3 |
| `toys` | 玩具/盲盒 | 6 |

跨分类模板（5 个）：

- 车内拆箱上手：`apparel` 男装/女装/运动服饰、`accessories` 鞋包/配饰
- 手机直出痛点安利：`household` 日用/家纺、`digital` 3C数码/家电
- 居家四处种草：`home` 家具/家装、`household` 日用/家纺
- 左右对照见效：`household` 日用/家纺、`digital` 3C数码/家电
- 暗光微距质感：`accessories` 鞋包/配饰、`digital` 3C数码/家电

## 模板清单

“全部模板”顺序即下表顺序。预览文件均位于 `frontend/public/templates/shoppable-carousel/`。

| # | id | 名称 | 分类 | 三拍 | 预览文件 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `accessories-01` | 沉浸开箱试穿 | `accessories` | 开箱静物 → 多场景上身 → 细节收尾 | `accessories-01-1.webp`<br>`accessories-01-2.webp`<br>`accessories-01-3.webp` |
| 2 | `apparel-01` | 车内拆箱上手 | `apparel`, `accessories` | 举起特写 → 换角度细节 → 上手收尾 | `apparel-01-1.webp`<br>`apparel-01-2.webp`<br>`apparel-01-3.webp` |
| 3 | `beauty-01` | 粉色标签卖点讲解 | `beauty` | 托举全貌 → 功能标注 → 适合谁 | `beauty-01-1.webp`<br>`beauty-01-2.webp`<br>`beauty-01-3.webp` |
| 4 | `apparel-02` | 复古电影感穿搭 | `apparel` | 造型亮相 → 穿着细节 → 场景收尾 | `apparel-02-1.webp`<br>`apparel-02-2.webp`<br>`apparel-02-3.webp` |
| 5 | `household-01` | 居家角落随手拍 | `household` | 全景融入 → 局部特写 → 退后收尾 | `household-01-1.webp`<br>`household-01-2.webp`<br>`household-01-3.webp` |
| 6 | `beauty-02` | 手背试色测评 | `beauty` | 效果对比 → 逐项标注 → 质地三格 | `beauty-02-1.webp`<br>`beauty-02-2.webp`<br>`beauty-02-3.webp` |
| 7 | `apparel-03` | 街头随身出街 | `apparel` | 回眸抓拍 → 多角度行走 → 正面全身 | `apparel-03-1.webp`<br>`apparel-03-2.webp`<br>`apparel-03-3.webp` |
| 8 | `household-02` | 手机直出痛点安利 | `household`, `digital` | 挡脸钩子 → 场景痛点 → 用后收尾 | `household-02-1.webp`<br>`household-02-2.webp`<br>`household-02-3.webp` |
| 9 | `digital-02` | 桌面棉麻平铺 | `digital` | 缠绕平铺 → 材质细节 → 拆件收尾 | `digital-02-1.webp`<br>`digital-02-2.webp`<br>`digital-02-3.webp` |
| 10 | `home-01` | 居家四处种草 | `home`, `household` | 空间中景 → 换角落 → 材质特写 | `home-01-1.webp`<br>`home-01-2.webp`<br>`home-01-3.webp` |
| 11 | `household-04` | 痛点现场到解决 | `household` | 麻烦现场 → 逐步使用 → 收拾干净 | `household-04-1.webp`<br>`household-04-2.webp`<br>`household-04-3.webp` |
| 12 | `household-05` | 左右对照见效 | `household`, `digital` | 对照钩子 → 逐维对比 → 改善汇总 | `household-05-1.webp`<br>`household-05-2.webp`<br>`household-05-3.webp` |
| 13 | `toys-01` | 一段小故事 | `toys` | 情境独白 → 问题登场 → 情绪收尾 | `toys-01-1.webp`<br>`toys-01-2.webp`<br>`toys-01-3.webp` |
| 14 | `digital-04` | 窗光静物美学 | `digital` | 斜光特写 → 局部做工 → 桌面全景 | `digital-04-1.webp`<br>`digital-04-2.webp`<br>`digital-04-3.webp` |
| 15 | `home-02` | 分区功能图解 | `home` | 全貌标注 → 逐区引线 → 接口特写 | `home-02-1.webp`<br>`home-02-2.webp`<br>`home-02-3.webp` |
| 16 | `household-06` | 收纳实测反转 | `household` | 配件钩子 → 偏见反转 → 前后对比 | `household-06-1.webp`<br>`household-06-2.webp`<br>`household-06-3.webp` |
| 17 | `apparel-04` | 白底平铺解构 | `apparel` | 正反平铺 → 材质微距 → 四格卖点 | `apparel-04-1.webp`<br>`apparel-04-2.webp`<br>`apparel-04-3.webp` |
| 18 | `accessories-03` | 暗光微距质感 | `accessories`, `digital` | 佩戴特写 → 材质微距 → 上手收尾 | `accessories-03-1.webp`<br>`accessories-03-2.webp`<br>`accessories-03-3.webp` |
| 19 | `toys-02` | 软萌摆位种草 | `toys` | 萌物特写 → 双场景引线 → 互动提问 | `toys-02-1.webp`<br>`toys-02-2.webp`<br>`toys-02-3.webp` |
| 20 | `digital-06` | 多功能卖点实测 | `digital` | 桌面钩子 → 功能实测 → 极简陈列 | `digital-06-1.webp`<br>`digital-06-2.webp`<br>`digital-06-3.webp` |
| 21 | `digital-07` | 高颜值陈列 | `digital` | 静物陈列 → 细节全貌 → 大小展示 | `digital-07-1.webp`<br>`digital-07-2.webp`<br>`digital-07-3.webp` |
| 22 | `digital-08` | 卖点图解海报 | `digital` | 核心面板 → 分步图解 → 参数总结 | `digital-08-1.webp`<br>`digital-08-2.webp`<br>`digital-08-3.webp` |
| 23 | `beauty-03` | 便签记录真人测评 | `beauty` | 多件合集 → 逐一展示 → 搭配总结 | `beauty-03-1.webp`<br>`beauty-03-2.webp`<br>`beauty-03-3.webp` |
| 24 | `beauty-04` | 极简好物清单 | `beauty` | 合集钩子 → 单品详解 → 礼貌收尾 | `beauty-04-1.webp`<br>`beauty-04-2.webp`<br>`beauty-04-3.webp` |
| 25 | `beauty-05` | 核心卖点图解 | `beauty` | 全貌展示 → 细节拆解 → 包装收尾 | `beauty-05-1.webp`<br>`beauty-05-2.webp`<br>`beauty-05-3.webp` |
| 26 | `household-07` | 沉浸开箱展示 | `household` | 托举全貌 → 细节展示 → 礼盒收尾 | `household-07-1.webp`<br>`household-07-2.webp`<br>`household-07-3.webp` |
| 27 | `home-03` | 复古家居场景陈列 | `home` | 角落点缀 → 全景陈列 → 换位搭配 | `home-03-1.webp`<br>`home-03-2.webp`<br>`home-03-3.webp` |
| 28 | `home-04` | 场景融入图鉴 | `home` | 空间一 → 多角融入 → 局部收尾 | `home-04-1.webp`<br>`home-04-2.webp`<br>`home-04-3.webp` |
| 29 | `home-05` | 空满状态全解 | `home` | 空置悬念 → 逐步满载 → 多面收尾 | `home-05-1.webp`<br>`home-05-2.webp`<br>`home-05-3.webp` |
| 30 | `apparel-05` | 日常上身穿搭实录 | `apparel` | 单品上身 → 多场变换 → 全身收尾 | `apparel-05-1.webp`<br>`apparel-05-2.webp`<br>`apparel-05-3.webp` |
| 31 | `apparel-06` | 日常随拍展示 | `apparel` | 自然使用 → 多角度细节 → 整体全景 | `apparel-06-1.webp`<br>`apparel-06-2.webp`<br>`apparel-06-3.webp` |
| 32 | `apparel-07` | 上身试穿与细节 | `apparel` | 上身效果 → 细节展示 → 全身版型 | `apparel-07-1.webp`<br>`apparel-07-2.webp`<br>`apparel-07-3.webp` |
| 33 | `accessories-04` | 沉浸式日常随拍 | `accessories` | 随手取用 → 使用细节 → 自然收尾 | `accessories-04-1.webp`<br>`accessories-04-2.webp`<br>`accessories-04-3.webp` |
| 34 | `toys-03` | 多款细节展示 | `toys` | 多款陈列 → 悬挂细节 → 单手特写 | `toys-03-1.webp`<br>`toys-03-2.webp`<br>`toys-03-3.webp` |
| 35 | `toys-04` | 出行安抚种草 | `toys` | 收纳展示 → 途中实操 → 情绪收尾 | `toys-04-1.webp`<br>`toys-04-2.webp`<br>`toys-04-3.webp` |
| 36 | `toys-05` | 沉浸式细节展示 | `toys` | 全貌陈列 → 局部特写 → 细节收尾 | `toys-05-1.webp`<br>`toys-05-2.webp`<br>`toys-05-3.webp` |
| 37 | `outdoor-01` | 硬核卖点讲解 | `outdoor` | 全貌钩子 → 细节卖点 → 场景收尾 | `outdoor-01-1.webp`<br>`outdoor-01-2.webp`<br>`outdoor-01-3.webp` |
| 38 | `outdoor-02` | 细节到户外上身 | `outdoor` | 款式全览 → 尺寸细节 → 场景佩戴 | `outdoor-02-1.webp`<br>`outdoor-02-2.webp`<br>`outdoor-02-3.webp` |
| 39 | `hardware-01` | 清洁实测讲解 | `hardware` | 麻烦现场 → 逐步使用 → 收尾全貌 | `hardware-01-1.webp`<br>`hardware-01-2.webp`<br>`hardware-01-3.webp` |
| 40 | `hardware-02` | 硬核好物展示 | `hardware` | 全貌钩子 → 细节展示 → 互动收尾 | `hardware-02-1.webp`<br>`hardware-02-2.webp`<br>`hardware-02-3.webp` |
| 41 | `health-01` | 阶段见效打卡 | `health` | 阶段打卡 → 见效变化 → 产品细节 | `health-01-1.webp`<br>`health-01-2.webp`<br>`health-01-3.webp` |
| 42 | `health-02` | 日常对照图解 | `health` | 使用情境 → 特点用法 → 实拍收尾 | `health-02-1.webp`<br>`health-02-2.webp`<br>`health-02-3.webp` |
| 43 | `health-03` | 理想到痛点反转 | `health` | 理想期望 → 连环痛点 → 给出解法 | `health-03-1.webp`<br>`health-03-2.webp`<br>`health-03-3.webp` |
| 44 | `beauty-06` | 多肤色真人试色 | `beauty` | 色号定调 → 多色并测 → 色号总览 | `beauty-06-1.webp`<br>`beauty-06-2.webp`<br>`beauty-06-3.webp` |
| 45 | `beauty-07` | 真实蜕变记录 | `beauty` | 痛点特写 → 过程记录 → 揭晓好物 | `beauty-07-1.webp`<br>`beauty-07-2.webp`<br>`beauty-07-3.webp` |
| 46 | `household-08` | 痛点替代展示 | `household` | 普通现状 → 升级替换 → 多场景用 | `household-08-1.webp`<br>`household-08-2.webp`<br>`household-08-3.webp` |
| 47 | `household-09` | 真实情境独白 | `household` | 情绪带入 → 细节感受 → 情绪收尾 | `household-09-1.webp`<br>`household-09-2.webp`<br>`household-09-3.webp` |
| 48 | `toys-06` | 走心情感共鸣 | `toys` | 风景独白 → 情感唤醒 → 抚慰下单 | `toys-06-1.webp`<br>`toys-06-2.webp`<br>`toys-06-3.webp` |
| 49 | `hardware-03` | 硬核图解讲解 | `hardware` | 全景卖点 → 结构剖析 → 适用情境 | `hardware-03-1.webp`<br>`hardware-03-2.webp`<br>`hardware-03-3.webp` |

## 素材来源与完整性

- 每张预览图的原始 CDN URL、下载后文件名、宽高与字节数逐项记录在 `frontend/public/templates/shoppable-carousel/manifest.json`。
- 运行时不热链参考站或 CDN；页面应读取本地 `/templates/shoppable-carousel/*.webp`。
- 本次没有模板缺失，也没有使用占位图。
- 本文件只登记模板素材，不代表 `shoppable_carousel` 能力已完成注册、页面已实现或模型链路已接通。
