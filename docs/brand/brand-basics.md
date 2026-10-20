# 货觉AI · 品牌基本信息（Brand Basics）

> 版本：v1（2026-10-19 定稿）｜品牌名：货觉AI｜本文件是品牌的唯一事实源（Single Source of Truth）
> 取名论证见 `naming.md`；logo 资产在 `frontend/public/brand/`；本文件管**定位/口号/色板/字体/logo 规范/语气/落地清单**。

---

## 1. 品牌标识

| 项 | 内容 |
|---|---|
| 中文名 | **货觉** |
| 完整名 | **货觉AI**（对外默认） |
| 拼音/英文 | HUOJUE AI（次要，仅出海/SEO/邮件签名用） |
| 品类 | AI 电商视觉创作平台 |
| 一句话定位 | 上传商品图，生成能上架的图——主图、详情页、营销视觉，一站生成 |
| 目标用户 | 电商卖家、品牌方、代运营、视觉工作室、独立创作者 |

## 2. 口号（Slogan）

| 用途 | 文案 |
|---|---|
| **主口号** | **好图，好卖** |
| 副口号（产品向） | 商品图 · 详情页 · 营销视觉，一站生成 |
| 备选池 | 每一张图，都为成交／让商品被准确感知／看得清货，才卖得好 |

主口号四字对仗、结果导向（好图是手段，好卖是目的），与「货觉」的感知语义闭环。

## 3. 品牌人格与语气

- **工匠**：谈交付品质，不炫技；参数是底气不是谈资
- **直接**：说「能上架的图」，不说「赋能视觉生态」；禁 AI 腔（" unleash / revolutionize / 重新定义"）
- **结果导向**：一切沟通落到点击率、转化率、上架速度
- 文案规范：动宾结构、短句、具体数字优先（「12 项能力」优于「多项能力」）

## 4. 色板（Color）

| 角色 | 名称 | 值 | 用途 |
|---|---|---|---|
| 品牌主色 | 货觉紫 | `#5546d8` | 实心按钮/链接/强调/选中态/AI 后缀 |
| 渐变辅色 | 觉紫渐变 | `#8064f6` → `#5546d8`（135°） | 主 CTA、logo 容器 |
| 主文字 | 墨青 | `#171a2b` | 标题/正文强调 |
| 次文字 | 石板灰 | `#667085` | 次要信息/导航默认态 |
| 弱文字 | 雾灰 | `#86909c` | 描述/占位 |
| 页面底 | 云白 | `#f6f7fb` | 全局背景 |
| 卡片 | 纯白 | `#ffffff` | 面板/卡片 |
| 边框 | 线灰 | `#e6e8ef` | 分隔线/输入框描边 |
| 成功 | 松绿 | `#18a875` | 成功态 |
| 警告 | 琥珀 | `#f59e0b` | 警告态 |
| 危险 | 朱红 | `#ef4444` | 错误/删除 |

> 红涨绿跌等金融场景不适用本品类；上表即全量语义色。CSS 变量名以 `--brand` / `--color-*` 为准（`global.css:3-24`），antd token 已同步归位（`main.tsx`，2026-10-19）。

## 5. 字体（Typography）

| 场景 | 字体 | 字重 |
|---|---|---|
| 中文主 | Noto Sans SC | 400/500/600/700/800（全字重已加载） |
| 西文/数字 | Inter | 400/500/600/700/800 |
| 回退 | PingFang SC → Microsoft YaHei → Arial | — |

- 字阶（复刻参考站实测）：12/13/14 为主力，11 辅助，16/18 标题，28/32 页面大标题
- 字重纪律：600 用于卡题/菜单项，700 用于导航/强调，800 仅 hero 数字，400 正文

## 6. Logo 规范

### 6.1 资产清单（`frontend/public/brand/`）

| 文件 | 用途 |
|---|---|
| `huojue-mark.svg` | 主标记（渐变方 + 觉眼），favicon/头像/App 图标源 |
| `huojue-logo-horizontal.svg` | 横版组合（标记 + 货觉 + AI），文档/页脚/物料 |
| `huojue-mark-mono.svg` | 单色版（深色容器），印刷/单色场景 |
| `huojue-mark-inverse.svg` | 反白版（无容器白廓），**品牌紫/深色底之上必须用这个**（主标记的紫渐变容器会显出方块边界） |
| `mark-16/32/36/180/192/512.png` | 预渲染位图（favicon/顶栏/Apple touch/**PWA manifest**/分享） |
| `mark-maskable-512.png` | maskable App 图标（满幅 135° 渐变底 + 反白觉眼 380px，落进 512×512 的 80% 安全区，规避圆形裁切出现第二层边界） |
| `og-1200x630.png` | OG/Twitter 分享卡（反白标记 + 「好图，好卖」+ 副口号 + 页脚双联） |

### 6.2 构造（96×96 viewBox，等比缩放）

- 容器：圆角方形，radius **22%**（rx 22/96），渐变 135° `#8064f6`→`#5546d8`
- 眼廓：杏仁形（M23,48 Q48,28 73,48 Q48,68 23,48 Z），白描边 6.5，圆线帽
- 瞳孔：四角星（外径 11，腰 2），纯白实心
- 寓意：**觉眼**——AI 感知商品之眼；星瞳 = 生成之「灵光」

### 6.3 使用纪律

| 规则 | 值 |
|---|---|
| 最小尺寸 | 数字 **16px** / 印刷 **6mm** |
| 净空 | 不小于标记高度的 **25%** |
| 横版组合 | 标记与文字基线对齐，间距 = 标记宽度的 20% |
| 禁止 | 改色、加描边/外阴影/发光、旋转、非等比拉伸、置于花背景/图片上（用反白版）、容器内改圆角 |
| 深色底 | 用反白版（无容器）或单色版 |

## 7. 落地清单（Rollout）

| 面 | 状态 |
|---|---|
| 顶栏品牌（36px 标记 + 货觉 + 紫色 AI） | ✅ 2026-10-19（`AppLayout.tsx` + `.app-brand-*`） |
| 登录页品牌（34px） | ✅ 已接入（`LoginPage.tsx` + `.login-logo-img`） |
| 页面标题 | ✅ 「货觉AI · 电商视觉创作平台」（`index.html`） |
| favicon / apple-touch-icon | ✅ `/brand/*` |
| antd 主题紫色归位 | ✅ 2026-10-19（`main.tsx`，登录主按钮等蓝泄漏已修） |
| 落地页顶栏（36px 标记，替换原「EV」文字块） | ✅ 2026-10-19（`LandingPage.tsx` + `.landing-brand-*`） |
| 落地页页脚品牌位 + 主口号 | ✅ 2026-10-19（`货觉AI · 电商视觉创作平台` / `好图，好卖 —— …`） |
| 落地页 hero 品牌名 | ✅ 2026-10-19（原为参考站商标「极画AI」，见下方 §7.1 注） |
| 站点索引页（顶栏 24px 标记 + eyebrow + 页脚） | ✅ 2026-10-19（`SitemapPage.tsx`，eyebrow `HUOJUE AI / SITE INDEX`） |
| 邀请页 / 法务页文案 | ✅ 2026-10-19（`InvitationsPage.tsx` / `LegalPage.tsx`） |
| PromoBar 文案（「新人礼」） | ✅ 2026-10-19（`PromoBar.tsx`：货觉新人礼） |
| README / CLAUDE.md 项目名 | ✅ 2026-10-19（并指向本文件为品牌唯一事实源） |
| OG 分享图（1200×630） | ✅ `public/brand/og-1200x630.png`；og/twitter meta 已进 `index.html` |
| PWA manifest + App 图标 | ✅ `public/manifest.webmanifest`；`mark-192/512.png` + `mark-maskable-512.png`（满幅渐变底 + 反白觉眼，落进 80% 安全区） |
| iOS/Android 原生商店图标 | ⏸ 待做（需 1024 母版 + 各密度导出，上线前处理） |
| 商标检索（第 9/35/42 类）+ 域名注册 | ⏸ 商用前必做（见 `naming.md` §3 注） |

### 7.1 落地期修掉的两个真实缺陷（不是新增功能）

| 缺陷 | 根因 | 处置 |
|---|---|---|
| hero 标题带参考站商标「极画AI」 | 2026-10-17「营销文案完全照搬」决策时把品牌名一并复制，与 README「保留本项目自有品牌标识，不替换为参考站商标」直接冲突 | 品牌名改 `货觉AI`，营销数字（上新快 10 倍 / 成本直降 90%）照搬不动 |
| 顶栏右胶囊溢出 64px 顶栏 | 根因**不是**样式写错：antd `<Header>` 默认 `line-height:64px` 被 `.app-quota`/`.app-user` 继承，行盒 64px + padding 4×2 = **实测 72px**，上下各溢 4px | `.app-header { line-height: normal }`；实测回落至 25px（`.app-quota`）/ 34px（`.app-header-right`），全站唯一超高元素消失 |

> 顺带把 `.app-quota` 的 `--color-slate-100`（#f1f5f9，Tailwind 遗留色，不在本文件 §4 色板内）换成 `var(--color-bg)` 云白。

### 7.2 已知未修（等裁定，不在品牌轮内动）

| 项 | 现象 | 状态 |
|---|---|---|
| 落地页 390 顶栏换行 | `LandingHeader` 是落地页自有顶栏（非应用外壳），390 下品牌 + 5 个导航项 + 算力胶囊 + 登录挤成 4 行 | ✅ 2026-10-19 已修：≤900 单行 54px「品牌 + 汉堡」，导航进抽屉（`docs/topnav-ref/impl-landing-390-*.png`） |

## 8. 视觉证据

| 文件 | 内容 |
|---|---|
| `docs/brand/brand-login.png` | 登录页品牌（logo + 货觉 + 紫色 AI） |
| `docs/brand/brand-workbench.png` | 工作台顶栏品牌（改名落地首版） |
| `docs/brand/brand-landing-1280.png` | 落地页 1280：顶栏标记 + hero 品牌名 + PromoBar「货觉新人礼」 |
| `docs/brand/brand-landing-390.png` | 落地页 390：品牌标记 36px、文本 48px、无横向溢出；**同时暴露 §7.2 顶栏换行问题** |
| `docs/brand/brand-sitemap-1280.png` | 站点索引页：24px 标记 + `HUOJUE AI / SITE INDEX` + 页脚 |
| `docs/brand/brand-header-64.png` | 顶栏修复后实拍（胶囊高 25px，居中于 64px 顶栏） |
| `frontend/public/brand/og-1200x630.png` | OG 分享图（反白标记 + 主口号，紫渐变底） |
| `frontend/public/brand/mark-maskable-512.png` | maskable App 图标 |

HTML 元信息实测（2026-10-19，`verify-brand2.cjs`）：description/theme-color/og:title/og:image(1200×630)/twitter:summary_large_image/manifest/apple-touch 全部命中；`manifest.webmanifest` 200，`name`/`short_name`/4 icons/`start_url=/workbench`/`theme_color=#5546d8`；落地页、站点索引、工作台、邀请页、法务页文案全部为新品牌名；**零 JS 报错**。

## 9. 变更纪律

- 改色/改形/改口号 = 品牌级变更，须先改本文件再动代码，禁止只改一边
- 本文件与代码冲突时，以**本文件 + 实拍**为准（文档次之）
- 每次品牌变更在 `naming.md`/本文件记版本号与日期
