# 营销首页设计（`/`）

> 现行实现：`frontend/src/pages/landing/`（页面编排 `page.tsx`）+ `frontend/src/pages/landing/style.css`。
> 本文只描述当前页面，不记录改版过程。

## 1. 定位

`/` 是未登录访客的第一屏，也是全站唯一的公开营销页：不挂侧栏、不要求鉴权，把「能做什么」「怎么做」「多少钱」三件事在一屏滚动内讲完，再把流量导向工具页、工作台与积分商城。

页面内**不写死任何价格、积分数与能力数量**：价目读 `GET /products`，套餐读 `GET /membership/plans`，活动读 `GET /marketing/campaigns`，能力清单读 `GET /capabilities`。接口失败时显示诚实的空态，不回落硬编码价目。

## 2. 结构

| 区块 | 组件 | 内容 |
| --- | --- | --- |
| 顶部导航 | `LandingHeader` | 品牌 + 首页 + 能力分组下拉 + 工作台；右侧作品 / 数据 / 登录入口。分组下拉是 `DropdownMenu`，≤900px 收进 `Sheet` 右侧抽屉 |
| 1 首屏 | `LandingHero` | 左侧：能力数徽标（取运行时可见能力数）、两行标题、说明、双 CTA（`Button asChild`，免费开始创作 → 首个场景页；查看套餐价目 → `/packages`）、三条保障；右侧：2×2 真实产出拼贴，每张带场景标签 |
| 2 核心场景 | `LandingScenes` | 商品主图 / 商品详情 / 爆款复刻三张 `Surface` 卡，图片与文案来自 `BIZ_CARDS` |
| 3 修图工具 | `LandingTools` | 8 个常用 `Button asChild` 工具入口，四列一行；右上 `TextAction`「全部工具」进 `/workbench` |
| 4 使用流程 | `LandingFlow` | 上传 → 选择能力与风格 → 下载，三步固定文案 |
| 5 优秀案例 | `LandingCases` | 7 个分类（商品主图 / 商品详情图 / 爆款复刻 / 自由创作 / 产品精修 / 一键抠图 / 旋转角度）按顺序平铺长式陈列，**不切页签**；每类按商品去重后 5 张，`AspectRatio` 3:4 展示；组头「做同款」跳对应工具页，悬停 `Badge` 浮出同一入口 |
| 6 套餐与积分 | `LandingPackages`（`#packages`，`Tabs`） | 订阅套餐 / 加油包 / 限时活动三个页签；订阅 6 卡 3×2，加油包只陈列前 4 款，全量在 `/packages`；角标取 `lib/constants.ts` 的 `PLAN_VISUALS`（与 `/packages` 同源） |
| 7 产品特性 | `LandingFeatures` | 宽卡（文案 + 5 张真实产出拼贴）与两张补充卡 |
| 8 底部行动区 | `LandingCta` | 品牌紫渐变通栏，主 CTA 同首屏 |
| 页脚 | `LandingFooter` | 品牌说明、客户 logo、三组链接、版权 |

组件统一从 `frontend/src/ui` 取件，目录内经由 `components.ts` 单一入口再导出。段落外壳（容器宽度 + 段前间距 + 小标题）由页面本地的 `LandingSection` / `LandingKicker` / `LandingHeading` / `LandingLede` 组合层承担，不是控件外观。

## 3. 数据与可见性

- 场景卡、工具入口、案例页签都按 `isCapabilityVisible()` 过滤：运营下线的能力从首页消失；能力清单未到达时保留全部入口（公开首屏不因一次请求抖动整块消失）。
- 首屏能力数取 `visibleCapabilityIds.size`，清单未到达时兜底 `CAPABILITY_PLUGINS` 的声明数（当前 17）。
- 案例文件名成对产出（`*_1` / `*_2`），`uniqueCaseFiles()` 去配对后缀后按商品去重，避免同一商品在案例墙出现两次。
- 套餐权益文案由后端 `buildPerkLabels()` 生成，页面不另写一套权益说明。
- 首页限时活动页签只在真有活动时出现；活动价与商品过滤由后端完成，前端不做二次判断。

## 4. 视觉与响应式

- 容器 1200，段落上间距 88px；颜色只用 `:root` 令牌（品牌紫 `--brand`、冷灰中性色、`--radius-*`），不写裸色值。
- 断点：≤1080 套餐/加油包降 2 列、特性宽卡改单列；≤900 首屏改单列、场景与流程单列、工具 2 列、案例每行 3 张；≤640 全部单列，案例每行 2 张。
- 案例区 7 个分类全部展开：访客不必逐页签点击才能知道「这个能力能不能做」；每类只放 5 张，避免回到库存式图墙。

## 5. 约束

- 不再有 `lp-` 类名前缀：控件视觉全部由 shadcn 组合件与语义类承担，页面 `style.css` 只剩 `.app-content` 内边距逃逸与 `#packages` 的 `scroll-margin-top`，新增版面不要再写前缀类。旧 `home-v2-*`（参考站逐像素复刻版）已删除，不要复用。
- 首屏 CTA 不直接弹登录框，交给目标工具页的鉴权链处理；未登录访客仍能浏览完整价目。
- 页面不承诺「无水印」「可商用」等授权口径，避免未兑现的商业承诺。
