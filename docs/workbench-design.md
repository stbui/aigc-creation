# 工作台页面（Workbench）设计规格与实拍审计

> 抓取人：小帮｜抓取日期：2026-10-19｜页面路由：`/workbench`
> 参考站：<https://ijihua.cn/workbench>（极画AI，SPA，`/assets/index-*.js` 客户端渲染）
> 抓取方式：Playwright（chromium，`--no-proxy-server` 直连；本机 HTTP_PROXY 端口为死端口，直连 200/0.35s）
> 本地实现现状：`frontend/src/pages/WorkbenchPage.tsx`（370 行）+ `frontend/src/styles/global.css` §工作台（869 行起）
> 本文件是**设计规格 + 差距审计 + 实施记录**。审计与改码按「裁定在前 → 出偏差清单 → 获批 → 改码」纪律执行：
> 2026-10-19 上午完成审计（§0–§7），同日下午经用户指令「改」完成实施与验证（§8）。
> 视觉证据：`docs/workbench-ref/`（参考站与本地同视口对比截图 9 张，含修复前后对照）

---

## 0. 结论摘要（先看这个）

| # | 发现 | 优先级 | 一句话结论 |
|---|---|---|---|
| 1 | 应用外壳无移动端适配 | **P0** | `.app-sider-wrap` 176px 写死不隐藏、全仓无汉堡/抽屉，390px 下壳内页面横向溢出 780px、工具卡被压成 14px 宽，页面不可用 → **已修复**（§8） |
| 2 | 侧栏无响应式塌缩，与参考站窄屏 100px 轨不符 | **P1** | 参考站侧栏是双态响应式（1366→100px 轨 / 1367→176px 横排）；本地 `SIDEBAR_WIDTH=176` 写死，1280 视口下内容右移 76px、hero 文案补偿失效 → **已修复**（§8、§11） |
| 3 | 内容宽度上限 1142 vs 参考站无上限全宽 | **P1** | 参考站内容宽 = 视口 − 侧栏 − 48（1920 时 1696 全宽）；本地 `.workbench` max-width 1142 截断，1440 时窄 74px → **已裁定 B（删上限全宽）并实施**（§6 P1-2 / §8） |
| 4 | hero / 工具卡 / 数据区规格与参考站逐值一致 | ✅ 已对齐 | 32px/500 标题、14px/600 卡题、2:1 visual、40×40 跨界图标、2:1 面板 + 通栏、圆角 12/16 不一致均按 10-17 实拍复刻 |
| 5 | guest 态数据面板 | ✅ 已登记诚实差异 | 参考站未登录显示登录引导（含 100 积分营销弹窗）；本地以真实 stats 填充，产品语义更完整，不回退 |

**总体判定**：工作台页面本身的视觉规格（hero/网格/数据区）与参考站 1:1 对齐度高的；真正的问题在**外壳两层**——响应式塌缩缺失（P1）与移动端外壳破损（P0）。两项均已实施并通过全视口实测（§8.2：1280/1360/1400/1440/1920/390 全部与参考站实测值相等）。

---

## 1. 证据基线与抓取方法

| 项 | 值 |
|---|---|
| 工具 | Playwright 1.64.1 + chromium-1134（本机缓存二进制，免下载；`executablePath` 直指） |
| 代理 | `--no-proxy-server`；环境 `HTTP_PROXY=127.0.0.1:63716` 为死端口（curl 经代理 exit 7），直连 200 |
| 视口 | 1280×800（主）、390×844（移动）、1440×900 / 1920×900 / 1300–1420 步进 20（断点探测） |
| 状态 | **guest 态**（未登录；参考站 `/workbench` 公开可访问，数据面板显示登录引导） |
| 干扰项 | 首访「新用户免费送100积分」弹窗（`.guest-promo-overlay`），已点 `.guest-promo-close` 关闭后抓取 |
| 抓取内容 | DOM 解剖（398 节点 + 计算样式 32 属性/节点）、:root token、分段截图、懒加载全滚动 |
| 本地对照 | `localhost:5100`（vite dev，IPv6 ::1）+ 演示账号 `admin@demo.com`（「填充演示账号」按钮）登录后实测 |
| 置信度 | 桌面/移动几何与计算样式 = **实测**；参考站登录后数据面板内部结构 = **未取到**（无账号），沿用 2026-10-17 实拍记录（`global.css:97-125` 注释块） |

---

## 2. 应用外壳解剖（参考站，1280×800）

页面为四层固定结构 + 一个内部滚动主区：

```
body.promo-topbar-open
└─ #root > .workspace-view-root
   ├─ .promo-topbar                    固定 40px，粉渐变，白字 16px
   ├─ header.landing-topbar            固定 y=40，64px，grid 266px│796px│170px
   │  ├─ .workspace-brand              品牌区 266px（logo 36×36 + 「极画 · AI 电商图」）
   │  ├─ nav.workspace-auth-nav        导航 796px：首页/电商生图▾/AI修图▾/AI视频▾/我的作品/购买套餐
   │  └─ .landing-top-actions          用户区 170px：邀友/签到得积分/工作台/登录注册
   ├─ aside.workspace-side-menu-v2     固定 100px（≤1366）/ 176px（≥1367）——响应式双态，见 §4/§11
   └─ main.workspace-route-content     内部滚动区（scrollHeight 1294 / clientHeight 696），bg #f6f7fb
      └─ 内容列                        x=108 宽 1148（= 84 + 24，即侧栏外延 16px + padding 24）
```

| 层 | 实测值 | 备注 |
|---|---|---|
| 促销顶栏 | h=40，`linear-gradient(90deg,#f76087,…)`，白字 16px，pad 0 56 0 32，右侧「立即抢购」93×28 + 关闭 24×24 | 倒计时 + 权益口播；本地 `PromoBar` 已复刻 40px |
| 顶导 | h=64，白底，下边框 `#f2f3f5` 1px；grid 三栏 266/796/170 | 本地 `.app-header` 64px 同构 |
| 导航项 | 13px/700 `#667085`，radius 8，pad 0 14，高 32 | 下拉菜单 `.workspace-nav-menu` 119–137px 宽、条目 36px 高 |
| 签到按钮 | 13px/700 `#5546d8` on `#f1efff`，radius 999，pad 7 12，border 1px `#d8d2ff`，112×32 | 顶导右侧固定入口 |
| 侧栏（≤1366） | 100px 垂直轨：sections 83px / 列表 77px，条目 77×60，flex column，图标 24×24、标签 10px/14；分组标题 77×24、12px/18；底部入口 83×60 | 分组标题 `.workspace-menu-section-toggle` 可折叠；无 head/collapse 按钮 |
| 侧栏（≥1367） | 176px 横排：sections 139px / 列表 133px，条目 133×45，flex row，13px/20 标签；容器 padding 16 12 24 24，border-right 1px `#f2f3f5` | 分组标题 133×28、14px/20；底部入口 139×44；无 head/collapse 按钮 |
| 主区滚动 | `.workspace-route-content` **内部滚动**，非 window 滚动 | 本地已登记为诚实差异（`WorkbenchPage.tsx:52-54`）：本地 window 滚动 |

---

## 3. 工作台内容区实测（参考站，guest 态）

### 3.1 hero（`.wb-workflow-banner`）

| 属性 | 实测值 |
|---|---|
| 尺寸 | 1148×212 @(108,128)，radius 16，margin-bottom 16 |
| 背景 | `#dcecff` + `url(https://ijihua.cn/static/work/bannerbg.png)`（右侧插画在图内） |
| padding | 0 100px |
| 标题 | 「把电商运营，组织成一条工作流」32px/500 `#000` lh20，margin 0 |
| 副标题 | 「继续你的商品内容创作，查看账号状态、任务进度和创作数据。」17px/400 `#667085` lh31，margin-top 24 |
| 文案块总高 | 75 = 20 + 24 + 31（参考站 10-17 记录，本次实拍复验一致） |

### 3.2 工具网格（`.wb-tool-grid`）

| 属性 | 实测值 |
|---|---|
| 网格 | 6 列 × 178px，gap 16，容器 1148×410 |
| 卡片 | `.wb-tool-card` 178×197，白底，radius 16，position relative |
| 缩略图 | `.wb-tool-visual` 178×89（2:1），占位底 `#c9c9c9` |
| 图标块 | `.wb-tool-icon` 40×40，白底 radius 8，`box-shadow: 0 2px 6px rgba(107,114,128,.3)`，**绝对定位跨界**于缩略图与文字区分界线（left 15 / bottom 88） |
| 文字区 | `.wb-tool-copy` padding 40 16 24，固定高 108 |
| 标题 | 14px/600 `#171a2b` lh16（flex row gap 6，角标 `em` = `#fff` on `#f00024`） |
| 描述 | 12px `#86909c` lh20，margin-top 8 |

12 张卡（顺序即参考站网格顺序）：商品主图 / 商品详情图 / 爆款复刻 / 创意生图 / 局部重绘 / 智能扩图 / 一键抠图（免费）/ 去除水印（免费）/ 图片翻译 / 产品精修 / 商品换色 / 旋转角度。

### 3.3 数据区（`.wb-data-layout` + 通栏）

| 区块 | 实测值 |
|---|---|---|
| 布局 | grid `754.664px 377.336px`（2:1），gap 16，margin 16 0 |
| 账号面板 | `.wb-panel.wb-account` 755×268，radius **12**，padding 24 |
| 最近任务 | `.wb-panel.wb-recent` 377×268，radius **16**，padding 24（参考站自身圆角不一致，按实拍保留） |
| 创作数据 | `.wb-panel.wb-dashboard` 1148×268，radius 12，padding 24 |
| guest 态 | 三面板均为 `.wb-login-prompt`（grid gap 16 居中）：「登录后查看可用积分和创作消费」+ CTA「登录查看」 |
| CTA 样式 | 16px/400 白字 on `#6254ED`，radius 6，padding 8 16，高 39 |

登录后面板内部结构（`.wb-account-metrics` 三块 1fr 1fr 1.35fr / 流水表 / `.wb-jobs-list` / `.wb-dashboard-stats` 六格 / `.wb-trend-chart`）本次未取到实时 DOM，字面值沿用 10-17 实拍（已固化在 `global.css:97-125` 注释块与 1175-1210 注释块）。

### 3.4 参考站 `:root` 设计 token（13 个，本次实拍导出）

```
--bg: #f6f7fb        --panel: #ffffffe6    --line: #e6e8ef     --text: #182033
--muted: #7d8596     --primary: #625df5    --primary-2: #9358ef
--success: #18a875   --warning: #f59e0b    --danger: #ef4444
--shadow: 0 24px 70px #232a461f           --radius: 22px
--font: "Noto Sans SC","Inter","PingFang SC","Microsoft YaHei",Arial,sans-serif
```

### 3.5 新客营销弹窗（guest 首访，`.guest-promo-overlay`）

参考站为 500×427 居中对话框：倒计时 `01:59:51` + 「新用户免费送100积分」+ 四项权益 + CTA「立即领取」160×51 + 右上关闭 28×28。

2026-10-28 已按「复制 + 改」落地：保留 500×427、遮罩、1.2s 首访延迟、关闭热区、CTA 热区、入场动画与服务端时间倒计时；文案改为真实的一键抠图免费 / 一键去水印免费 / 作品云端保存 / 素材统一管理。注册不发积分，因此不展示 100 积分或 50 次权益。无 DB 活动时不显示倒计时，CTA 落到真实 `/background-remove`；有活动时取 `/marketing/popup` 的标题、CTA 与有效期。关闭写 `ecom-guest-promo-dismissed-v1`，登录用户不渲染。实现见 `frontend/src/components/GuestPromoDialog.tsx`。

---

## 4. 响应式双态与断点（本次核心发现）

参考站侧栏 `aside.workspace-side-menu-v2` 是**视口响应式双态**，2026-10-28 精确定点为 1366 / 1367：

| 视口 | 侧栏 | 条目 | 标签 | 内容列 | hero 标题 x |
|---|---|---|---|---|---|
| 1280 | 100px 垂直轨 | 77×60 column | 10px | x=108 宽 1148 | **208** |
| 1300 | 100px 轨 | 77×60 | 10px | — | — |
| **1366** | **100px 轨** | 77×60 | 10px | — | — |
| **1367** | **176px 横排** | 133×45 row | 13px | x=200 宽 1216 | 300 |
| 1400 | 176px 横排 | 133×45 row | 13px | x=200 宽 1216 | 300 |
| 1440 | 176px 横排 | 133×45 | 13px | x=200 宽 1216 | 300 |
| 1920 | 176px 横排 | 133×45 | 13px | x=200 宽 **1696**（无 max-width 截断） | 300 |

移动端 390×844：侧栏 `display:none`；顶栏压缩为 54px（grid 198│154，pad 0 14，logo + 签到 + 汉堡）；hero 370×160（pad 18 20，radius 16）；工具网格 2 列 × 181px，gap 8，卡 181×199；无底部 tabbar（导航进汉堡抽屉）。

---

## 5. 本地实现对拍（登录态 admin@demo.com，实测）

| 维度 | 参考站 | 本地 | 判定 |
|---|---|---|---|
| 侧栏 @1280 | 100px 垂直轨（≤1366 自动塌缩） | 100px 垂直轨；条目 77×60、标签 10px/14、分组标题 77×24 | ✅ 已对齐（2026-10-28，§11） |
| 侧栏 @1440 | 176px 横排 | 176px 横排 | ✅ |
| 侧栏 @390 | display:none | **display:block**（176px 挤占屏幕） | ❌ P0 |
| 内容列 @1280 | x=108 宽 1148 | x=200 宽 1056 | ❌ 右移 92 / 窄 92 |
| 内容列 @1440 | x=200 宽 1216 | x=237 宽 1142（max-width 截断） | ⚠️ 窄 74 |
| hero 尺寸 | 1148×212 | 1056×212（高度一致） | ⚠️ 宽度随容器 |
| hero 标题 x @1280 | 208 | **284**（`padding: 0 84px` 补偿按 ~100px 侧栏设计，`global.css:886`） | ❌ +76 |
| hero 标题 x @1440 | 300 | 321（84 vs 100 padding 差） | ⚠️ +21 |
| hero 排版 | 32/500/#000/lh20 + 17/400/#667085/lh31 mt24 | 逐值一致（`global.css:898-911`） | ✅ |
| hero 背景 | `#dcecff` + bannerbg.png 插画 | 渐变 + 真实产出拼贴（不引第三方图，无产出回退原创 SVG） | ✅ 已登记诚实差异 |
| 工具网格 | 6×178 | 6×162.66（1056 容器挤压；断点 1100→4 列 / 760→3 列 / 520→2 列本地已有） | ⚠️ 容器窄导致 |
| 卡片规格 | 178×197 / radius16 / 2:1 visual / icon 40×40 跨界 / title 14-600 / desc 12 | 163×189，规格逐值一致（`global.css:1064-1170`） | ✅ 规格一致 |
| 卡片 hover | shadow `0 7px 20px #21234114`，无上浮；visual img scale(1.06) | 同（`global.css:1078,1107`，10-18 对拍修正） | ✅ |
| 数据区结构 | 2:1 双面板 + 通栏；account radius12 / recent radius16 | 同（`global.css:1177-1199`） | ✅ |
| 数据区内容 | guest = 登录引导 | 真实 stats：19/26/19/19/100%/26，三面板标题「账号和作品数据/最近任务/创作数据」 | ✅ 已登记诚实差异 |
| 面板高 | 268（login prompt 态） | 502/508（真实数据 + 图表撑高） | ✅ 合理差异 |
| 移动端 390 | 侧栏隐藏 / 顶栏 54 / 2×181 网格 / 无横向溢出 | **侧栏 176px 显示 / 顶栏 64 / 卡 14px / overflowX=780 / docH 2382** | ❌ **P0 破损** |

---

## 6. 设计发现与修复建议（按优先级，均未动码，待裁定）

### P0-1 应用外壳无移动端适配（影响全部壳内页面，非工作台独有）

**证据**：
- `AppLayout.tsx:133` `.app-sider-wrap` 无条件渲染，inline `width: SIDEBAR_WIDTH`(176)
- 全仓 grep `hamburger|mobile-menu|drawer` 零命中；`.app-sider-wrap` 唯一规则 `global.css:642` 无任何媒体查询
- 390 实测：侧栏占 176px 不隐藏 → hero 166px、工具卡 14px、`documentElement.scrollWidth` 溢出 780px
- 参考站同视口：侧栏 `display:none` + 54px 顶栏 + 汉堡抽屉 + 2×181 网格，零溢出

**建议修法**：
1. `@media (max-width: 900px)` 隐藏 `.app-sider-wrap`（display:none），顶栏换汉堡按钮
2. 汉堡展开 antd `Drawer` 承载 `<SideRail>`（复用现有组件，`collapsed` 态传入）
3. 顶栏 64→54px、导航收进抽屉（参考站顶栏 grid 198│154 的口径：品牌 + 签到 + 汉堡）
4. 本地 `.wb-tools` 断点（520→2 列）在侧栏隐藏后自然生效，需复测卡片尺寸（目标 181px 量级）

### P1-1 侧栏无响应式塌缩 + hero 补偿自相矛盾

**证据**：§4 断点表；`global.css:886` 注释自述「hero padding 用 84px 补偿，使文案与参考站落在同一绝对 x=208」——该数学成立的前提是侧栏 ≈100px，但本地默认态侧栏 176px，1280 下标题实测 x=284（参考站 208）。

**建议修法**：
1. 自动应用塌缩态（2026-10-28 精确定点为 `≤1366px`；旧 `.side-menu-collapsed` 三列实现已由 §11 的分组菜单取代）
2. hero padding 84px → **100px**（参考站字面值）：删除补偿逻辑后双态自然对齐——100px 侧栏时 108+100=208 ✓；176px 侧栏时 200+100=300 ✓（参考站 1440 实测 300）
3. `WorkbenchPage.tsx:52-54` 注释同步更新（84px 补偿的缘由作废）

### P1-2 内容宽度上限 1142 vs 参考站无上限（已裁定：B，2026-10-19 实施）

**证据**：参考站内容宽 = 视口 − 侧栏 − 48，1920 实测 1696 无 max-width；本地 `.workbench` max-width 1142（原 `global.css:871`），1440 时 1142 vs 参考 1216。

**原两个选项**：
- A（初版推荐）保留 1142 上限，登记为「宽屏可读性上限」诚实差异
- B 删除 max-width 完全跟随参考站全宽——1:1 纯度最高

**实际执行 B，理由（实施期新证据）**：A 方案下 hero 居中产生 37px 偏移——1440 实测本地标题 x=337 vs 参考站 300，比修复前（321）**更糟**；且 `global.css` 工作台区块注释明确记录本页有「不偏移、没有差异」的硬要求。B 实施后全档精确（见 §8 验证表）。1920 全宽 1696 下卡宽 269px 系参考站自身行为，1:1 优先。

### P2-1 guest 态数据面板（无需动作，已登记）

参考站 guest 显示登录引导 + 100 积分弹窗；本地以真实 stats 填充。产品语义本地更完整，维持现状。若未来要做「未登录引导态」，样式证据已在 §3.3（CTA 16px 白 on `#6254ED` radius 6）。

### P2-2 token 体系校准参照（无需动作）

参考站 13 个 `:root` token 与本地 `--wb-*` 私有体系（10-17「不走全局收拢 token、按参考站字面值锁定」决策）并存。参考站 `--primary #625df5` 与本地 `--wb-flow-income-fg #6254ed`（`global.css:141`）近似一致，无冲突；`--radius: 22px` 参考站未见用于工作台区块（本页最大圆角 16），不引入。

---

## 7. 待裁定项清单

| # | 事项 | 建议 | 状态 |
|---|---|---|---|
| 1 | P0-1 移动端外壳适配（隐藏侧栏 + 汉堡 + Drawer + 54px 顶栏） | 按 §6 修法实施，需 390/768 两档复测 | ✅ 已实施（2026-10-19，见 §8） |
| 2 | P1-1 侧栏自动塌缩 + hero padding 回归 100px | 实施后需 1280/1366/1367/1440 四档复测 | ✅ 已实施（2026-10-19；断点于 2026-10-28 校正为 1366，见 §11） |
| 3 | P1-2 内容宽度上限（A 保留 1142 / B 跟随全宽） | 初倾向 A，实施期证据翻转 → **B** | ✅ 已裁定 B 并实施（见 §6 P1-2） |
| 4 | 参考站侧栏断点精确定点 | 实施 P1-1 时逐像素复测 | ✅ 2026-10-28 复测：1366=轨 / 1367=横排，已按 1366 落地（§11） |

---

## 8. 实施记录（2026-10-19，用户指令「改」）

### 8.1 改动清单（5 个文件，未新增依赖）

| 文件 | 改动 |
|---|---|
| `frontend/src/components/AppLayout.tsx` | 删 inline `width: SIDEBAR_WIDTH`（inline 会压过媒体查询）；新增汉堡按钮 `.app-mobile-toggle` + antd `Drawer` 承载 SideRail（点菜单即导航并关抽屉） |
| `frontend/src/components/PromoBar.tsx` | 窄屏（≤900px）经 matchMedia 隐藏促销条，并同步 `html[data-promo='off']`——保住 pk-workspace / 多图融合页的高度 calc 契约（`global.css` 原 1648/5509 行） |
| `frontend/src/components/SideRail.tsx` | 删除 `SIDEBAR_WIDTH` 导出（宽度改由 CSS 托管）；注释补记窄屏垂直轨态（2026-10-28 更新为 ≤1366） |
| `frontend/src/styles/global.css` | ① `.app-sider-wrap` 宽度改 CSS 托管（176 桌面 / 100 轨 / 900 隐藏）；② 新增「响应式外壳」双媒体查询块（2026-10-28 校正为 1366 轨态 + 900 移动态）；③ hero padding 84→100px；④ `.workbench` 删 max-width 全宽；⑤ 拆除「1:1 覆盖层」里 4 处静态 `grid-template-columns`（`.wb-tools`/`.wb-panels`/`.wb-account-metrics`/`.wb-dashboard-stats`，它们把第一套的响应式断点全压死）；⑥ `.wb-panels` 列宽并入参考站字面值 `minmax(0,2fr) minmax(300px,1fr)`；⑦ 数据区移动栅格（六格 2 列 / 账号堆叠 / 工具网格 520px gap 8） |
| `frontend/src/pages/WorkbenchPage.tsx` | 注释块同步（内容宽全宽、hero padding 100、卡片 178） |

### 8.2 验证结果（Playwright 实测，演示账号登录态）

| 视口 | 侧栏 | hero 尺寸 | hero 标题 x | 卡宽 | 参考站对应实测 | 判定 |
|---|---|---|---|---|---|---|
| 1920 | 176 | 1696 | 300 | 269 | 176 / 1696 / 300 / 269 | ✅ 全等 |
| 1440 | 176 | 1216 | 300 | 189 | 176 / 1216 / 300 / 189.3 | ✅ 全等 |
| 1400 | 176 | 1176 | 300 | 183 | 176（断点切换态） | ✅ |
| 1360 | 100 轨 | 1228 | 208 | 191 | 100 轨 | ✅ |
| 1280 | 100 轨 | 1148 | 208 | 178 | 100 轨 / 1148 / 208 / 178 | ✅ 全等 |
| 1100 | 100 轨 | 968 | 156 | 230（4 列） | — | ✅ 合理 |
| 390 | 隐藏 | 370 | — | 181（2 列） | 隐藏 / 370 / 181 | ✅ 全等 |

附加验证：390 横向溢出 0（修复前 780）；汉堡抽屉可开、19 个菜单项、点「我的作品」导航并自动关抽屉；`/works`、`/stats` 壳内回归无溢出；全视口零 JS 错误；390 下促销条隐藏且 `data-promo=off` 契约正确。

修复后截图：`docs/workbench-ref/local-fixed-1280.png`（对比 `local-1280.png`）、`local-fixed-390.png`（对比 `local-390.png`）、`local-fixed-390-drawer.png`。

### 8.3 踩坑记录（下次直接用）

1. **媒体查询不增特异性**：`@media` 里的规则与外部静态规则冲突时按源顺序决胜。`.workbench { max-width:none }`（0,1,0）被后方 `.workbench { max-width:1142px }` 反压 → 必须加前缀提特异性或删静态规则；`.wb-*` 移动栅格规则必须放在全部 base 规则之后。
2. **inline style 压媒体查询**：侧栏宽度原由 JSX `style={{ width }}` 注入，任何 `@media` 都无效——宽度类响应式必须 CSS 托管。
3. **「1:1 覆盖层」是双刃剑**：置于区块后覆盖 token 值的静态规则，会把同区块前面的响应式断点静默压死（`.wb-tools` 6 列从 1280 压到 390）。覆盖层只应覆盖「值」，不应重复「结构属性」（grid-template-columns 等）。
4. **`html[data-promo]` 是跨组件契约**：隐藏促销条必须同步置 `off`，纯 CSS `display:none` 会让 pk/mif 页高度算错 40px。
5. **登录限流**：本地后端登录有 ip 维度限流，多 context 连登第 5 次起 429——跑多视口验证用单 context + `setViewportSize` 切换，别反复登录。
6. **`<button>` 的 UA `align-items: center`（2026-10-19 字体批踩到）**：工具卡是 `<button class="wb-card">` + `display:flex; flex-direction:column`，Chrome UA 给 `button` 设了 `align-items:center`，导致 `.wb-card-body` 不 stretch、按 min-content（= nowrap 描述整句宽 224px）定宽，冲出 178px 栅格轨、ellipsis 失效。修法是显式 `align-items: stretch` + `min-width: 0`（grid item 的自动最小尺寸同样按 min-content 解析）。**换字族只会放大它、不会引入它** —— PingFang 下也溢出，只是不显眼。
7. **「零溢出」扫描要先等真实内容**：改完全局字体后跑溢出扫描，`overflow: []` 全绿，但同刻截图显示页面还停在 Suspense 骨架（一张卡都没渲染）。`networkidle` 不等于内容就绪，要 `waitForSelector` + 断言元素数 > 0 再扫。

---

## 9. 卡片溢出修复（2026-10-19 字体批连带）

| 项 | 值 |
|---|---|
| 现象 | `.wb-card-body` 实测宽 224px、`.wb-card-title/desc` 192px，而栅格轨只有 178px；末列卡片右缘 1302 > 视口 1280 |
| 根因 1 | 「工作台 1:1 覆盖层」静态重述 `.wb-card-desc`（与基座逐值同值），把基座的 `white-space/overflow/text-overflow: ellipsis` 三件套丢了 —— 与 §8.3-3 是同一类「覆盖层重复结构属性」错误 |
| 根因 2 | Chrome UA `button { align-items: center }` 使 column flex 子项不 stretch |
| 修法 | 删除覆盖层冗余重述；`.wb-card { align-items: stretch; min-width: 0 }`；`.wb-card-body { min-width: 0 }` |
| 实测 | 12 张卡片全部 178px、右缘 ≤ 1256；描述恢复省略号；1280/390 工作台与其余 6 页溢出扫描全为 `[]` |
| 证据 | `docs/workbench-ref/impl-card-ellipsis-1280.png`、`impl-workbench-390.png` |

---

## 附录 A · 抓取产物清单

| 文件 | 内容 |
|---|---|
| `docs/workbench-ref/viewport-1280.png` | 参考站工作台桌面态（hero + 工具网格） |
| `docs/workbench-ref/sec-700.png` | 参考站数据区（内部滚动至 700px：三面板 login prompt 态） |
| `docs/workbench-ref/viewport-390.png` | 参考站移动端（侧栏隐藏 + 2 列网格） |
| `docs/workbench-ref/local-1280.png` | 本地工作台 @1280 登录态（侧栏 176px 展开） |
| `docs/workbench-ref/local-1440.png` | 本地工作台 @1440 登录态 |
| `docs/workbench-ref/local-390.png` | 本地工作台 @390（P0 破损态实证） |
| `/tmp/ijihua-scrape/anatomy-final.json` | 参考站 DOM 解剖 398 节点（rect + 32 项计算样式） |
| `/tmp/ijihua-scrape/page.html` | 参考站渲染后 HTML |
| `/tmp/ijihua-scrape/scrape*.cjs` | 抓取脚本（5 个，可复跑） |

## 附录 B · 与 2026-10-17 实拍记录的差异说明

本次为 guest 态重抓，与 10-17 记录（已固化于 `global.css` 注释）逐条复验：hero 排版、卡片规格、数据区几何、面板圆角 12/16 **全部一致**，无漂移。两处 10-17 记录之外的新事实：① 参考站侧栏为双态响应式（2026-10-28 精确复测为 1366 / 1367，详见 §11）；② 参考站 guest 态数据面板为登录引导（10-17 记录的面板内部结构来自登录态或更早版本，本次无法复取，沿用）。

---

## 10. 2026-10-28 新产物复原复核

参考站构建产物更新为 `index-B4lo6Cz6.js` + `index-DDOEXtwn.css`。本轮按新产物重新复原工作台、我的作品、素材库三页，完整提示词与三页验收记录见 `docs/workspace-pages-restoration-prompt.md`。

### 10.1 工作台变化

- DOM 改为 `.workbench-content` → `.wb-workflow-banner` → `.wb-tool-grid` → `.wb-data-layout`。
- 固定 12 张电商生图/修图卡，顺序与 `workbenchIds` 一致；卡图与菜单图标下载到 `frontend/public/workbench/`。
- Hero 使用本地 `bannerbg.png`，不请求参考站资源。
- 游客态三面板显示登录引导，且不请求 `/stats/overview`；登录后才加载真实统计。
- AI 视频设为 `inWorkbench: false`，仍保留侧栏与工具页入口。

### 10.2 1440 实测

| 元素 | 参考站 | 本地 |
|---|---|---|
| 主内容区 | `x=176, y=104, w=1264` | 同左 |
| Hero | `200,128,1216×212` | 同左 |
| 工具网格 | 6 列 `189.33px`，gap 16 | 同左 |
| 卡片 | `189.33×202.67` | `189.33×202.67` |
| 数据区 | `800 / 400 / 1216` | 同左 |
| 游客登录按钮 | `96×39` | `96×39` |

### 10.3 响应式与验证

- 1440：6 列；1280：6 列；1024：4 列；760：4 列；390：2 列。
- 四档均无横向溢出、无页面错误、12 卡渲染完整。
- 390 页面总高 `2263`；三个数据面板均为 `252` 高（移动 padding 16 + 登录引导 220），此前桌面 `min-height: 268` 未覆盖，整体高出 48px，已修。
- 真实登录账号验证：积分、累计生成、素材库存、最近任务、6 格数据中心与 7 日趋势均能加载；素材为空时显示真实空态。
- 类型检查、Vitest、前端生产构建、后端构建通过。
- 新增 `frontend/tests/workspace-pages.spec.ts`：固定 12 卡顺序、游客不请求 `/stats/overview`、首卡进入 `/product-kit`、登录态 6 格看板、390 两列且无溢出。
- 1440 主内容区视觉对拍 SSIM `0.950`；参考站的外壳不纳入主内容比较。游客营销弹层已按布局复制、权益改写落地，详见 §3.5 与 `docs/workspace-pages-restoration-prompt.md` §3.4。

---

## 11. 2026-10-28 左侧菜单复原

参考站新产物为 `index-B4lo6Cz6.js` + `index-DDOEXtwn.css`。本轮只复原左侧菜单，不改工作台主内容。实拍视口为 1440×1000 与 1280×1000；促销条开启时参考站侧栏从 `y=104` 开始，高度 `896`。

### 11.1 结构与顺序

菜单为 `nav.workspace-side-menu-v2` 内的 `.workspace-side-menu-sections` 加上底部 `.workspace-customer-service`。默认全部展开：

1. 根区域：工作台、我的作品
2. AI视频：自由创作、图生视频*
3. 电商生图：商品主图、商品详情、爆款复刻、创意生图、多图融合、商品SKU图
4. AI修图：局部重绘、一键抠图、去除水印、产品精修、图片翻译、智能扩图、商品换色、旋转角度
5. 数据中心：数据看板*、素材库
6. 底部：产品建议、联系客服

`*` 为本地真实 IA 增强，参考站当前没有图生视频和数据看板入口；不伪造路由，分别落在 `/tools/image_to_video` 与 `/stats`。商品详情能力名保持注册表不变，侧栏按参考站显示“商品详情”。

### 11.2 几何与样式

| 元素 | 1440 横排 | 1280 竖轨 |
|---|---|---|
| 侧栏 | 176px，pad 16 12 24 24 | 100px，pad 8 8 20 |
| sections | 139px，gap 16，padding-top 8 | 83px，gap 14，padding-top 6 |
| 列表 | 133px，gap 4，padding-top 4 | 77px，gap 4，padding-top 4 |
| 条目 | 133×45，row，pad 8 4，gap 12 | 77×60，column，pad 5 2，gap 2 |
| 标签 | 13px/20 | 10px/14 |
| 分组标题 | 133×28，14px/20 | 77×24，12px/18 |
| 底部入口 | 139×44 | 83×60 |

- 条目 radius 8；active 为 `#f1efff` 底 + `#5546d8` 字，hover 为 `#f7f6ff`。
- 分组标题右侧 14px `ChevronUp`，收起后旋转 180°；`aria-expanded` 与 `aria-controls` 同步。抽屉与桌面侧栏同时挂载时，面板 id 用 React `useId()` 加前缀，避免重复 DOM id。
- 菜单图标使用参考站 `/static/menu/*.svg` 的本地副本 `frontend/public/menu/`，运行时只请求 `/menu/*`。默认 `grayscale + opacity(.62)`，active/hover 使用参考站紫色 filter。
- 分组标题与底部入口没有 `head` / collapse 按钮；旧版手动折叠与三列小格逻辑已删除。

### 11.3 Hover 预览

`.rail-preview` 对齐参考站 `workspace-menu-guide-popover`：376px 宽、padding 14 16 16、gap 12、radius 16、渐变 `linear-gradient(110deg,#fff 0% 38%,#eeedff 100%)`、`0 10px 24px #23274a29`，左侧 12px 三角箭头，图片 344×172 / radius 10 / cover。右侧空间不足时翻到左侧，箭头同步换向。图片优先取用户该能力最近一次真实产出；没有产出时回退本地化的参考站演示图。

### 11.4 底部入口与高度修复

- “产品建议”落到真实 `/tickets?type=other&compose=1&subject=产品建议`，工单页读取 `subject` 预填标题并清除 URL 参数。
- “联系客服”落到真实 `/tickets?type=consultation&compose=1`，预选“咨询”类型。
- `.app-sider-wrap` 的 `top` / `height` 改为 `var(--workspace-topbar-height)`。此前固定按 64px 计算，促销条开启时顶栏实际 104px，侧栏底部会超出视口 40px，客服入口不可见。

### 11.5 断点与保留差异

- 精确断点：`≤1366px` 为 100px 竖轨，`≥1367px` 为 176px 横排。旧 CSS 的 `max-width:1399px` 已纠正。
- 参考站 900px 仍显示侧栏，≤768px 才隐藏；本地为保护既有移动页面，继续在 `≤900px` 使用隐藏侧栏 + 汉堡 Drawer。Drawer 内恢复 280px 宽的完整横排菜单，不继承 77×60 竖轨。
- 本地保留图生视频与数据看板两个真实入口，并在本条记录为差异。

### 11.6 验证

- `frontend/tests/sidebar.spec.ts` 6 条通过：1440 几何/顺序/本地图标/底部入口、1280 竖轨、1366/1367 断点、折叠与唯一面板 id、真实工单预填、390 抽屉与无溢出。
- 原有 `frontend/tests/workspace-pages.spec.ts` 11 条通过，游客弹层、工作台、作品与素材库未回退。
