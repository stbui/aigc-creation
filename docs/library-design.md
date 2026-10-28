# 素材库页面规格（`/library`）

用户上传的原图与生成结果统一在这里管理：筛选、分组、预览、批量操作。

| 项 | 值 |
| --- | --- |
| 路由 | `/library`，别名 `/asset-library` |
| 页面组件 | `frontend/src/pages/LibraryPage.tsx` |
| 样式 | `frontend/src/styles/global.css` 的 `.asset-library-*` 区块 |
| 接口 | `GET /assets`（`kind` / `capability` / `limit` / `offset`）、`POST /assets/upload`、`DELETE /assets/:id` |
| 空态资源 | `frontend/public/asset-library/empty.svg`（160×160，本站静态资源） |

两个路由渲染同一组件，侧栏高亮与既有的 `/library` 入口都不受影响。

## 1. 结构

```
.asset-library-page            padding 24px 24px 56px
└── .asset-library-shell
    ├── .asset-library-header   flex space-between align-items flex-end gap 24，margin-bottom 22
    │   ├── 标题区：h1「素材库」+ 副标题（数量与用途说明）
    │   └── .asset-library-header-actions（仅登录态）
    │       来源筛选 / 能力筛选 / 刷新 / 上传素材
    ├── .asset-library-groups-panel（仅登录态且有素材）
    ├── 状态区：加载中 / 加载失败 / 空态 / 网格，四者互斥
    └── .asset-library-load-more
```

## 2. 规格

| 元素 | 值 |
| --- | --- |
| 页面内边距 | `24px 24px 56px`（>980） |
| 标题 | 28px / 700 / 行高 40 / `#171a2b` |
| 副标题 | 13px，数量 + 用途说明 |
| header | flex，`justify-content: space-between`，`align-items: flex-end`，gap 24，`margin-bottom: 22` |
| 网格 | `repeat(5, minmax(0, 1fr))`，gap 16 |
| 卡片 | 白底，`border: 1px solid #e4e7ef`，radius 14，`box-shadow: 0 5px 16px #2a315709` |
| 封面 | `aspect-ratio: 1`，底 `#f1f3f8` |
| 卡片内容 | `padding: 12px 13px 13px` |
| 卡片标题 | 13px / 600 / `#30364a`，单行省略 |
| 卡片 meta | 11px / 行高 17 / `#a0a7b6`，`justify-content: space-between` |
| 选中标记 | 22×22 |
| hover / 选中 | 封面 `scale`，操作区玻璃底浮层 |

卡片宽度由 grid 的 `1fr` 决定（fluid，无固定宽度），窄栏下自然收窄。

## 3. 断点

| 视口 | 列数 | 页面内边距 | gap |
| --- | --- | --- | --- |
| > 1200 | 5 | 24 24 56 | 16 |
| ≤ 1200 | 4 | 24 24 56 | 16 |
| ≤ 980 | 3 | 24 20 44 | 16 |
| ≤ 700 | 3 | 24 20 44 | 16；header 改纵向堆叠，标题降为 24px / 行高 34 |
| ≤ 640 | 2 | 18 12 36 | 10 |
| ≤ 380 | 1 | 18 12 36 | 10 |

两列及以下时，meta 左段（尺寸 / 体积）允许省略号截断，右段（来源类型）保持整词不折行 —— 否则卡高会被撑高约 17px。

≤980 与 ≤640 的页面内边距变体必须与列数写在同一个媒体查询里，避免出现「列数已收窄、内边距还是桌面值」的半档状态。

## 4. 状态分支

四条分支互斥，不能合并成「空 = 没数据」：

| 状态 | 渲染 |
| --- | --- |
| 加载中 | 骨架屏 |
| 加载失败 | 失败提示 + 重试 |
| 空态 | `empty.svg` 160×160 + 「素材库还是空的」+ 说明 + 「上传第一张」按钮 |
| 有数据 | 分组面板 + 网格 + 加载更多 |

## 5. 游客态

路由对外公开，游客可访问页面，但**不发任何素材请求**（`GET /assets` 需要鉴权，游客请求会 401 并被渲染成「素材加载失败」）：

- 隐藏 `.asset-library-header-actions`（筛选 / 刷新 / 上传）；
- 隐藏分组面板；
- 直接渲染空态。

E2E `workspace-pages.spec.ts` 断言游客状态下零 `/assets` 请求。

## 6. 登录态

| 区域 | 内容 |
| --- | --- |
| 操作区 | 来源筛选（全部 / 上传 / 生成）、能力筛选、刷新、上传素材（h42 / 13px / radius 11） |
| 分组面板 | 按项目分组与计数；「新建分组」未接入，点击给出诚实提示 |
| 网格 | 分页 20 条，`load-more` 出现在有更多数据时 |
| 批量 | 勾选后出现批量条，删除走二次确认；翻页或改筛选清空选择 |

## 7. 实现约束

1. `.app-content` 与 `.asset-library-page` 的横向内边距**只能有一层**。两层叠加会让内容列右移 24px、宽度少 48px，且卡片尺寸全部跟着错。素材库采用「页面自带 padding + `.app-content` 逃逸」的方案，改动任何一侧都要复测 1280 下内容列应为 x=108 / 宽 1148（1440 为 x=200 / 宽 1216）。
2. 页面 `min-height` 必须走 `var(--workspace-topbar-height)`（已定义为 `calc(64px + var(--promo-topbar-height))`）。写死 64px 时促销条开启会恒定多出 40px 死滚动。
3. 空态插画复用站内内联 SVG，不引入外部资源。
4. 卡片是 fluid 宽度，不要给固定 `width`；否则窄栏会溢出。

## 8. 验证

| 用例 | 覆盖 |
| --- | --- |
| `workspace-pages.spec.ts` | 双路径直达、游客零 `/assets` 请求、空态资源、操作区隐藏、侧栏高亮、390 无溢出 |
| `state-contract.spec.ts` | 加载 / 空 / 失败三态 |
| `verify-asset-filters.js` | 素材列表 `keyword` / `from` / `to` 筛选 |
| `smoke-admin.js` | 后台素材管理与下架 |
