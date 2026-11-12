# 前端功能目录分层约定

状态：现行（与 `frontend/src/pages/admin/channels/`、`frontend/src/pages/admin/payments/`、
`frontend/src/pages/admin/credits/`、`frontend/src/pages/admin/tasks/`、
`frontend/src/pages/admin/orders/`、`frontend/src/pages/admin/users/`、
`frontend/src/pages/admin/assets/`、`frontend/src/pages/admin/tickets/`、
`frontend/src/pages/admin/logical-models/`、`frontend/src/pages/admin/plugins/`、
`frontend/src/pages/admin/coupons/`、`frontend/src/pages/admin/aigc-label/`、
`frontend/src/pages/admin/billing-orders/`、`frontend/src/pages/admin/campaigns/`、
`frontend/src/pages/admin/user-groups/`、`frontend/src/pages/admin/membership-plans/`、
`frontend/src/pages/admin/products/`、`frontend/src/pages/admin/backups/`、`frontend/src/pages/product-detail/`、`frontend/src/pages/product-kit/`、`frontend/src/pages/viral-clone/`、`frontend/src/pages/creative-image/`、`frontend/src/pages/product-sku/`、`frontend/src/pages/local-redraw/`、`frontend/src/pages/background-remove/`、`frontend/src/pages/watermark-remove/`、`frontend/src/pages/product-retouch/`、`frontend/src/pages/image-translate/`、`frontend/src/pages/image-expand/`、`frontend/src/pages/product-recolor/`、`frontend/src/pages/rotate-angle/`、`frontend/src/pages/multi-image-fusion/`、`frontend/src/pages/landing/`、
`frontend/src/pages/shoppable-carousel/`、`frontend/src/pages/template/`、
`frontend/src/pages/library/`、`frontend/src/pages/works/`、
`frontend/src/pages/invitations/`、`frontend/src/pages/account/`、
`frontend/src/pages/stats/`、`frontend/src/pages/credits/`、
`frontend/src/pages/packages/`、`frontend/src/pages/mobile-upload/`、
`frontend/src/pages/tool/`、
`frontend/src/pages/sitemap/`、`frontend/src/pages/qr-login/`、
`frontend/src/pages/checkout/`、`frontend/src/pages/orders/`、
`frontend/src/pages/tickets/`、`frontend/src/pages/workbench/` 同步维护）。

适用于 `frontend/src/pages/**` 下**多文件**的功能目录。单文件页面不强制套用；
当页面长到需要拆分时，按本约定落位。参考实现见
[`frontend/src/pages/admin/channels/`](../frontend/src/pages/admin/channels/)、
[`frontend/src/pages/admin/payments/`](../frontend/src/pages/admin/payments/)（后台；
后者是**多标签页**形态：`page.tsx` 只做标签切换与 URL 同步，每个标签各自
一个 `<业务组件>.tsx`，状态文案与动作判定放在 `constants.ts`，金额/积分等
展示函数放在 `utils.ts`）
与 [`frontend/src/pages/product-detail/`](../frontend/src/pages/product-detail/)、
[`frontend/src/pages/product-kit/`](../frontend/src/pages/product-kit/)、
[`frontend/src/pages/viral-clone/`](../frontend/src/pages/viral-clone/)、
[`frontend/src/pages/creative-image/`](../frontend/src/pages/creative-image/)、
[`frontend/src/pages/product-sku/`](../frontend/src/pages/product-sku/)、
[`frontend/src/pages/local-redraw/`](../frontend/src/pages/local-redraw/)、
[`frontend/src/pages/background-remove/`](../frontend/src/pages/background-remove/)、
[`frontend/src/pages/watermark-remove/`](../frontend/src/pages/watermark-remove/)、
[`frontend/src/pages/product-retouch/`](../frontend/src/pages/product-retouch/)、
[`frontend/src/pages/image-translate/`](../frontend/src/pages/image-translate/)、
[`frontend/src/pages/image-expand/`](../frontend/src/pages/image-expand/)、
[`frontend/src/pages/product-recolor/`](../frontend/src/pages/product-recolor/)、
[`frontend/src/pages/rotate-angle/`](../frontend/src/pages/rotate-angle/)、
[`frontend/src/pages/multi-image-fusion/`](../frontend/src/pages/multi-image-fusion/)、
[`frontend/src/pages/landing/`](../frontend/src/pages/landing/)、
[`frontend/src/pages/library/`](../frontend/src/pages/library/)、
[`frontend/src/pages/works/`](../frontend/src/pages/works/)、
[`frontend/src/pages/invitations/`](../frontend/src/pages/invitations/)、
[`frontend/src/pages/account/`](../frontend/src/pages/account/)、
[`frontend/src/pages/checkout/`](../frontend/src/pages/checkout/)（C 端）。

## 1. 目录形态

```
pages/admin/channels/
├── index.ts          # 对外唯一出口
├── page.tsx          # 页面编排与写操作
├── components.ts     # 外部 UI 控件入口（唯一）
├── api.ts            # 外部接口入口（唯一）+ 本目录取数组合
├── hooks.ts          # 外部 hook 入口（唯一）+ 本目录 hooks
├── utils.ts          # 外部工具入口（唯一）+ 本目录纯函数
├── constants.ts      # 常量、类型、默认值
├── style.css         # 页面专属样式（仅本页加载）
├── <业务组件>.tsx     # 本目录自己的板块组件
└── __tests__/        # 与实现同目录的 Vitest 用例
```

文件名固定小写的有 8 个：`index.ts` / `page.tsx` / `components.ts` / `api.ts` /
`hooks.ts` / `utils.ts` / `constants.ts` / `style.css`。业务组件用 `PascalCase.tsx`，文件名即组件名。

### 页面 CSS 归属

- **只放本页独占的选择器**（如 `product-sku-*`、`smart-expand-*`、页面根类
  `.my-works-page`）。共享骨架（`.pk-workspace` / `.tool-*` 在
  `styles/tool-workspace.css`，`.ui-*` 兼容层在 `styles/ui-compat.css`）与全局
  设计令牌（`styles/tokens.css`）不搬进页面文件。
- 多文件目录用 `style.css`，由 `index.ts` 以 `import './style.css';` 引入；
  单文件页面用同名 `<PageName>.css`（如 `CreditsPage.tsx` + `CreditsPage.css`），
  在页面文件顶部引入。两者都随路由 chunk 懒加载，不要在组件里另行引入。
- 页面 CSS 在全局 CSS **之后**加载，同优先级规则会覆盖全局规则；迁移时不要
  把需要被全局规则兜底的选择器搬进来。
- `styles/global.css` 只是分层入口（`@layer` 顺序 + `@import`），不写具体规则：
  令牌进 `tokens.css`，基础元素与 chrome 高度进 `base.css`，跨页工具皮肤进
  `tool-workspace.css`，`ui-*` 兼容层进 `ui-compat.css`。新增页面专属规则直接写进
  对应目录的 `style.css` 或同名页面 CSS。
- 共享组件的样式放组件同名 CSS（`components/ImageLightbox.css` 等），由组件文件
  顶部 `import './<Component>.css';` 引入；被多个组件共用的类（如结果画廊的
  `fc-result-*`）放共用 CSS，由使用它的组件各自引入。
- 跨页面共享的域样式放 `styles/<域>.css`（如 `redraw.css` 给局部重绘 / 去水印，
  `product-detail-kit.css` 给商品详情 / 商品主图），由相关页面入口或共享组件引入；
  不要再塞回 `global.css` 入口。

## 2. 每个入口的职责

| 文件 | 放什么 | 不放什么 |
| --- | --- | --- |
| `index.ts` | 目录对外导出 | 业务逻辑；内部文件互链 |
| `page.tsx` | 页面编排、路由级状态、写操作（提交 / 删除 / 启停） | 可复用的取数与纯函数 |
| `components.ts` | 从 `src/admin-ui` / `src/components` / `src/vendor` 转出的共享控件与类型 | 本目录自己的业务组件（会形成循环引用） |
| `api.ts` | 从 `src/lib/api` 转出的接口对象；只服务本目录的分页 / 聚合取数 | 组件、hook、纯函数 |
| `hooks.ts` | 从 `src/admin-ui/providers` / `src/context` / `src/hooks` / `src/components` 转出的 hook；本目录自有的数据 hook | 组件、接口实现 |
| `utils.ts` | 从 `src/lib/*` 转出的工具；本目录纯函数（不依赖 React） | 组件、hook、状态 |
| `constants.ts` | 选项表、默认值、草稿类型、健康汇总等结构类型 | 函数、请求、组件 |
| `<业务组件>.tsx` | 本目录独占的展示与交互 | 外部依赖直连（走入口） |

各入口文件顶部写清职责与「新增引用时在这里补一行 re-export」。

## 3. 导入方向

目录内文件按类别从入口取，不直连外部目录：

```ts
import { Button, SelectBox, Panel } from './components';   // UI 控件
import { adminChannelsApi } from './api';                  // 后端接口
import { useToast, useChannelList } from './hooks';        // hook
import { priceOf, formatRate } from './utils';             // 纯函数 / src/lib 工具
import { EMPTY_CHANNEL_DRAFT, type ChannelDraft } from './constants'; // 常量与类型
```

- 不直接引 `src/admin-ui` / `src/components` / `src/vendor` / `src/context` /
  `src/hooks` / `src/lib`（只有入口文件可以）。
- `src/types/model` 是例外：纯类型模块，不产生运行期依赖，各文件直接
  `import type`，不必再包一层。
- **第三方库（lucide-react / react-router-dom）不经入口转出** —— 它们不是本项目的
  共享控件，直接引即可（`channels/` 与 `product-detail/` 一致）。项目 UI 控件统一从
  `src/admin-ui/primitives` 取件，不从模块入口再包一层。
- 入口之间是单向的：`utils` → `constants`；`hooks` → `api` / `constants`；
  `constants` → `components`（只取选项类型）。业务组件与 `page` 可以依赖全部入口；
  `index` 只依赖 `page`。
- 目录内相对导入一律 `./X`；不使用 `../` 跳出目录（入口文件引外部时除外）。

## 4. 新增文件落位

| 要加的东西 | 放哪 |
| --- | --- |
| 只在本目录用的展示 / 交互 | 新建 `PascalCase.tsx` |
| 需要新的外部 UI 控件 | 先在 `components.ts` 补 re-export |
| 需要新的后端接口 | 先在 `api.ts` 补转出或封装 |
| 需要新的外部 hook / provider | 先在 `hooks.ts` 补 re-export |
| 需要新的 `src/lib/*` 工具 | 先在 `utils.ts` 补 re-export |
| 新的常量、选项表、默认值、结构类型 | `constants.ts` |
| 新的纯函数（无 React） | `utils.ts` |
| 多组件共用的取数逻辑 | `hooks.ts`，或独立 `useXxx.ts` 只在本目录引用 |

## 5. 校验

- `frontend/src/test/namedImportAudit.ts` 是共用的对账实现（读源码核对具名导入，
  缺失名字在 Vite 下只会变成 `undefined`，表现为整块页面白屏，单文件转译与
  Vitest 都发现不了）。两侧用例：
  - `frontend/src/pages/admin/__tests__/admin-modules.test.ts` —— 后台目录
    （`src/admin-ui` / `src/components/admin` / `src/pages/admin`）；
  - `frontend/src/pages/product-detail/__tests__/product-detail-modules.test.ts` ——
    C 端详情图目录（`src/pages/product-detail` / `src/components` / `src/hooks` / `src/lib` /
    `src/context`）；
  - `frontend/src/pages/product-kit/__tests__/product-kit-modules.test.ts` ——
    C 端主图目录（`src/pages/product-kit` / `src/components` / `src/hooks` / `src/lib` /
    `src/context`）；
  - `frontend/src/pages/viral-clone/__tests__/viral-clone-modules.test.ts` ——
    C 端爆款复刻目录（`src/pages/viral-clone` / `src/components` / `src/hooks` / `src/lib` /
    `src/context`）；
  - `frontend/src/pages/creative-image/__tests__/creative-image-modules.test.ts` ——
    C 端创意生图 / 自由创作目录（`src/pages/creative-image` / `src/components` /
    `src/hooks` / `src/lib` / `src/context`；页面按板块拆成 `CreativeImageInputPane` /
    `CreativeImageOutputPane` 两栏，左栏再拆 `CreativeImageUploadSection`（原子缩略图
    `CreativeImageReferenceThumb`）/ `CreativeImagePromptField` / `CreativeImageSubmitBar`，
    提示词放大为 `CreativeImagePromptModal`；状态与上传 / 提交 / 删除等写操作仍留在
    `page.tsx`）；
  - `frontend/src/pages/product-sku/__tests__/product-sku-modules.test.ts` ——
    C 端商品 SKU 图目录（`src/pages/product-sku` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；页面按板块拆成 `ProductSkuWorkspace`（三栏外壳）内的
    `ProductSkuTemplateCard`（空态 `ProductSkuTemplateDropzone` / 已选态
    `ProductSkuTemplatePreview`）/ `ProductSkuStepsCard` / `ProductSkuListSection`，
    清单再拆行 `ProductSkuListItem` → 区域 `ProductSkuVariantRow`（参考图原子件
    `ProductSkuReferenceThumb` / `ProductSkuReferenceUploadButton`）；使用步骤文案落
    `constants.ts` 的 `SKU_STEPS`，历史恢复与变体更新落 `utils.ts`，打包下载落
    `hooks.ts` 的 `useSkuDownload`，状态与上传 / 提交 / 删除等写操作仍留在
    `page.tsx`）；
  - `frontend/src/pages/local-redraw/__tests__/local-redraw-modules.test.ts` ——
    C 端局部重绘目录（`src/pages/local-redraw` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含本页画布组件 `MaskPainter` 与页面的导入；画布舞台
    `LocalRedrawStage` 内含工具栏 `LocalRedrawToolbar` 与底部操作条
    `LocalRedrawCanvasFooter`，标注面板 `LocalRedrawAnnotationPanel` 逐条拆
    `LocalRedrawAnnotationItem`，另有历史栏 `LocalRedrawHistoryPane`、上传预览
    `LocalRedrawUploadPreview` 与空态 `LocalRedrawIntro`；历史取数复用共享
    `useToolHistory`（经 `hooks.ts` 转出），画布 / 提交 / 删除等写操作仍留在
    `page.tsx`）；
  - `frontend/src/pages/background-remove/__tests__/background-remove-modules.test.ts` ——
    C 端一键抠图目录（`src/pages/background-remove` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含本页原图预览组件 `BackgroundSourcePreview` 与页面的导入；
    上传预览 `BackgroundRemoveUploadPreview`、空态 `BackgroundRemoveIntro` 与结果面板
    `BackgroundResultPane` 为独立展示件，颜色状态与提交仍留在 `page.tsx`）；
  - `frontend/src/pages/watermark-remove/__tests__/watermark-remove-modules.test.ts` ——
    C 端去除水印目录（`src/pages/watermark-remove` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含页面对 `WatermarkMaskEditor` 遮罩画布的导入；画布舞台
    `WatermarkRemoveStage` 内含工具栏 `WatermarkRemoveToolbar` 与底部操作条
    `WatermarkRemoveCanvasFooter`，水印标记面板 `WatermarkRemoveAnnotationPanel`
    逐条拆 `WatermarkRemoveAnnotationRow`，另有上传预览
    `WatermarkRemoveUploadPreview` 与空态 `WatermarkRemoveIntro`；遮罩 / 提交 / 删除等
    写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/product-retouch/__tests__/product-retouch-modules.test.ts` ——
    C 端产品精修目录（`src/pages/product-retouch` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`）；
  - `frontend/src/pages/image-translate/__tests__/image-translate-modules.test.ts` ——
    C 端图片翻译目录（`src/pages/image-translate` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含语言清单 `lib/optionSets` 的转出）；
  - `frontend/src/pages/image-expand/__tests__/image-expand-modules.test.ts` ——
    C 端智能扩图目录（`src/pages/image-expand` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含 placement 几何 `lib/expandGeometry` 的转出）；
  - `frontend/src/pages/product-recolor/__tests__/product-recolor-modules.test.ts` ——
    C 端商品换色目录（`src/pages/product-recolor` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`）；
  - `frontend/src/pages/rotate-angle/__tests__/rotate-angle-modules.test.ts` ——
    C 端旋转角度目录（`src/pages/rotate-angle` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；设置卡 `RotateAngleSettingsCard` 内含模式页签
    `RotateAngleModeTabs`、可拖拽预览 `RotateAnglePreview`（主体舞台
    `RotateAngleSubjectStage` / 摄像头舞台 `RotateAngleCameraStage`）；默认角度与
    滑杆区间落 `constants.ts`，角度夹取与轨道投影落 `utils.ts`，角度状态与提交
    仍留在 `page.tsx`）；
  - `frontend/src/pages/multi-image-fusion/__tests__/multi-image-fusion-modules.test.ts` ——
    C 端多图融合目录（`src/pages/multi-image-fusion` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，含变体计费 `lib/multiFusionBilling` 与提示词工具文案
    `lib/promptToolMessages` 的转出；页面按板块拆成 `MultiFusionSceneGateway` /
    `MultiFusionEditorHeader` / `MultiFusionUploadCard` / `MultiFusionAnalysisCard` /
    `MultiFusionParameterCard` / `MultiFusionSubmitBar` / `MultiFusionResultPanel`
    七个展示块，状态与写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/landing/__tests__/landing-modules.test.ts` ——
    C 端营销首页目录（`src/pages/landing` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；静态素材与案例清单落 `constants.ts`，去重与路径映射
    落 `utils.ts`，顶导自实现落 `LandingHeader.tsx`；页面按板块拆成 `LandingHero` /
    `LandingScenes` / `LandingTools` / `LandingFlow` / `LandingCases` /
    `LandingPackages`（三个页签分别 `LandingPlanGrid` / `LandingAddonGrid` /
    `LandingCampaignGrid`）/ `LandingFeatures` / `LandingCta` / `LandingFooter`；
    价目与活动取数落 `hooks.ts` 的 `useLandingCatalog`，可见能力过滤与页签状态
    仍留在 `page.tsx`）；
  - `frontend/src/pages/shoppable-carousel/__tests__/shoppable-carousel-modules.test.ts` ——
    C 端 AI 带货图文目录（`src/pages/shoppable-carousel` / `src/components` /
    `src/hooks` / `src/lib` / `src/context`；左栏 `ShoppableCarouselConfig` 与底栏
    `ShoppableCarouselFooter`（张数步进 `ShoppableCarouselStepper`），右栏
    `ShoppableCarouselShowcase`（模板网格 `TemplateGrid` + 历史
    `ShoppableCarouselHistory`），全部记录抽屉 `ShoppableCarouselResultList`；
    模板取数落 `hooks.ts` 的 `useShoppableCarouselTemplates`，提交 / 删除 / 文案生成
    等写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/template/__tests__/template-modules.test.ts` ——
    C 端婚纱写真模板目录（`src/pages/template` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；左栏 `TemplateInputPane`（已选模板回显
    `TemplateSelectedCard`），右栏 `TemplateShowcase`（一级分类
    `TemplateCategoryNav` / 二级分组 `TemplateGroupNav` / 网格 `TemplateGallery` /
    历史 `TemplateHistory`）；模板取数落 `hooks.ts` 的 `useTemplateCatalog`，
    展平与筛选落 `utils.ts`，提交 / 删除等写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/library/__tests__/library-modules.test.ts` ——
    C 端素材库目录（`src/pages/library` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，日期分组、下载扩展名与空态文案落 `utils.ts`；
    页面按板块拆成 `LibraryToolbar` / `LibraryGroupPanel`（由
    `LibraryGroupByToggle` + `LibraryGroupFilter` + `LibraryGroupOptionLabel`
    组合）/ `LibraryBatchBar` / `LibraryLoadingState` / `LibraryErrorState` /
    `LibraryEmptyState` / `LibraryGrid`（`LibraryLoadMore`）/ `LibraryUploadInput`，
    卡片与弹窗为 `LibraryAssetCard`（操作区 `LibraryAssetActions`、右键菜单
    `LibraryAssetMenu`）/ `LibraryMoveAssetsDialog` / `LibraryProjectManagerDialog`；
    取数落 `useLibraryAssets.ts`、项目列表落 `useLibraryProjects.ts`、分组状态与
    可见集合落 `useLibraryGroups.ts`、滚动哨兵落 `useInfiniteScroll.ts`、卡片
    懒加载落 `useNearViewport.ts`，大图查看器下标复用 `src/hooks/useLightboxIndex`，
    上传 / 删除 / 下载 / 移动等写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/works/__tests__/works-modules.test.ts` ——
    C 端我的作品目录（`src/pages/works` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，切日 / 模态判定 / 下载扩展名 / 脚注时间格式化落
    `utils.ts`，作品卡图片落 `WorkImage.tsx`；页面按板块拆成 `WorksHeader` /
    `WorksToolbar`（由 `WorksFilterMenu` + `WorksCapabilityFilter` /
    `WorksDateFilter` / `WorksStatusFilter` / `WorksTaskFilter` 组合）/
    `WorksSelectionBar` / `WorksCountBar` / `WorksGrid`（`WorkCard`，浮层
    `WorkCardActionBar` / 原子 `WorkCardAction`、占位卡 `WorkCardPlaceholder`）/
    `WorksLoadMore` / `WorksGuestState` / `WorksEmptyState`；取数分页落
    `useWorksTasks.ts`，筛选状态与可见列表落 `useWorksFilters.ts`，大图查看器
    下标复用 `src/hooks/useLightboxIndex`）；
  - `frontend/src/pages/invitations/__tests__/invitations-modules.test.ts` ——
    C 端邀请页目录（`src/pages/invitations` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，邀请海报绘制与二维码配色落 `utils.ts`；页面按板块拆成
    `InviteHero` / `InviteCheckinBlock` / `InviteMetricsBlock` / `InviteStepsBlock` /
    `InviteRelationsBlock` / `InviteRulesBlock` / `InvitePosterModal`，访客与失败态为
    `InviteGuestState` / `InviteErrorState`；主标题与步骤文案由 `utils.ts` 的
    `inviteHeroTitle` / `buildInviteSteps` 按真实规则派生，取数、绑定、签到与海报
    等写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/account/__tests__/account-modules.test.ts` ——
    C 端账户中心目录（`src/pages/account` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，多接口并行取数与金额 / 日期格式化；页面按板块拆成
    `AccountIdentityCard` / `AccountAssetsCard` / `AccountStatsCard` /
    `AccountOrdersCard` / `AccountMessagesCard` / `AccountSecurityCard` 六个展示卡
    与 `AccountPasswordModal` / `AccountDeleteModal` 两个弹窗，状态仍留在 `page.tsx`）；
  - `frontend/src/pages/stats/__tests__/stats-modules.test.ts` ——
    C 端数据中心目录（`src/pages/stats` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；KPI `StatsKpiGrid`、趋势 `StatsTrendPanel`、
    最近创作 `StatsRecentPanel`、常用能力 `StatsCapabilityPanel` 与空态
    `StatsEmptyPanel`；取数与自动刷新落 `hooks.ts` 的 `useStatsOverview`，
    日期 / 汇总 / 柱高换算落 `utils.ts`）；
  - `frontend/src/pages/credits/__tests__/credits-modules.test.ts` ——
    C 端积分明细目录（`src/pages/credits` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；余额 `CreditsHero`、汇总 `CreditsStatsGrid`、
    两个页签 `CreditsLedgerPanel` / `CreditsLotPanel`（窄屏 `CreditsLedgerList` /
    `CreditsLotList`）；账本取数与筛选分页落 `hooks.ts` 的 `useCreditsData`，
    筛选参数与备注口径落 `utils.ts`）；
  - `frontend/src/pages/packages/__tests__/packages-modules.test.ts` ——
    C 端积分商城目录（`src/pages/packages` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；页头 `PackagesHero`、会员 `PackagesPlanSection`、
    积分包 `PackagesProductSection`；价目与会员状态取数落 `hooks.ts` 的
    `usePackagesCatalog`，折合单价 / 最划算判定 / 按钮文案落 `utils.ts`）；
  - `frontend/src/pages/mobile-upload/__tests__/mobile-upload-modules.test.ts` ——
    C 端手机上传落地页目录（`src/pages/mobile-upload` / `src/components` /
    `src/hooks` / `src/lib` / `src/context`；选图态 `MobileUploadEditor` 与单张
    `MobileUploadPreview`；压缩与 objectURL 生命周期落 `utils.ts` /
    `hooks.ts` 的 `useMobileUpload`，成功 / 失败 / 参数缺失三个终态留在
    `page.tsx`）；
  - `frontend/src/pages/tool/__tests__/tool-modules.test.ts` ——
    通用工具页目录（`src/pages/tool` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；页头 `ToolPageHeader`、上传与参数
    `ToolUploadCard`（单项 `ToolParamField`）、结果 `ToolResultCard`；上传 /
    建任务 / 轮询状态落 `hooks.ts` 的 `useToolPageTask`，能力路由兜底与
    运行时拦截仍留在 `page.tsx`）；
  - `frontend/src/pages/sitemap/__tests__/sitemap-modules.test.ts` ——
    网站地图目录（`src/pages/sitemap` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；顶部条 `SitemapTopbar`、页头 `SitemapHero`、
    分组卡 `SitemapSectionCard`、页脚 `SitemapFooter`；静态路由清单落
    `constants.ts`，能力可见性过滤落 `utils.ts`）；
  - `frontend/src/pages/qr-login/__tests__/qr-login-modules.test.ts` ——
    扫码登录确认目录（`src/pages/qr-login` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`；页壳 `QrConfirmCard`，无效 / 待登录 / 待确认 /
    已处理四态分别为 `QrInvalidState` / `QrLoginRequiredState` /
    `QrConfirmState` / `QrResultState`；scan / confirm 与忙碌态落 `hooks.ts`
    的 `useQrLogin`）；
  - `frontend/src/pages/checkout/__tests__/checkout-modules.test.ts` ——
    C 端结算页目录（`src/pages/checkout` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，幂等下单、支付轮询与券码试算下沉到 `utils.ts`；
    页面按板块拆成 `CheckoutOrderCard` / `CheckoutPaymentMethodCard` /
    `CheckoutAmountCard` / `CheckoutResultCard`，支付状态仍留在 `page.tsx`）；
  - `frontend/src/pages/orders/__tests__/orders-modules.test.ts` ——
    C 端我的订单目录（`src/pages/orders` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，筛选档位与可支付判定落 `utils.ts`；
    页面按板块拆成 `OrderCard` / `OrdersFilterBar` / `OrderInvoiceStatus` /
    `OrderInvoiceForm`，列表状态、轮询与写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/tickets/__tests__/tickets-modules.test.ts` ——
    C 端我的工单目录（`src/pages/tickets` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，类型 / 状态 / 优先级文案落 `constants.ts`；
    页面按板块拆成 `TicketFilters` / `TicketCard` / `TicketComposeForm` /
    `TicketThread`，列表分页、URL 同步与写操作仍留在 `page.tsx`）；
  - `frontend/src/pages/workbench/__tests__/workbench-modules.test.ts` ——
    C 端工作台目录（`src/pages/workbench` / `src/components` / `src/hooks` /
    `src/lib` / `src/context`，示例图映射与看板指标表落 `constants.ts`；
    页面按板块拆成 `WorkbenchToolGrid` / `WorkbenchAccountPanel` /
    `WorkbenchRecentPanel` / `WorkbenchDashboard`，统计取数与登录态仍留在 `page.tsx`）。
- 分层改动后跑：

  ```bash
  cd frontend && npx vitest run src/pages/admin/__tests__/admin-modules.test.ts src/pages/product-detail src/pages/product-kit src/pages/viral-clone src/pages/creative-image src/pages/product-sku src/pages/local-redraw src/pages/background-remove src/pages/watermark-remove src/pages/product-retouch src/pages/image-translate src/pages/image-expand src/pages/product-recolor src/pages/rotate-angle src/pages/multi-image-fusion src/pages/landing src/pages/shoppable-carousel src/pages/template src/pages/library src/pages/works src/pages/invitations src/pages/account src/pages/stats src/pages/credits src/pages/packages src/pages/mobile-upload src/pages/tool src/pages/sitemap src/pages/qr-login src/pages/checkout src/pages/orders src/pages/tickets src/pages/workbench src/pages/admin/payments
  ```

- 类型校验以 `npm run typecheck` 为准。

## 6. 变更边界

- 拆分以「移动 + 改导入」为主，不改变行为；金额仍只在微积分边界换算。
- 重命名导出时同步改所有调用点与测试，不留兼容别名。
- 入口文件的注释与本文档是同一份约定；改规则时两处同批更新。
