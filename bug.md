# 

https://maolong.da-ai.cc/toolbox/image-generation
https://www.designkit.cn/agent-lib
https://www.pixpix.com/zh-CN/tools/product-set



http://localhost:3000/admin/logs
http://localhost:3000/admin/payments
复刻功能流程

后台页面功能完善
后台页面设计完善


todo：
- 将后端功能迁移到本项目
- 模型能力
- 积分系统
- 支付系统
- 用户系统
- 经营系统
- agent
- 无限画布



systemctl status cloudcli      # 查看状态
  systemctl restart cloudcli     # 重启
  systemctl stop cloudcli        # 停止
  journalctl -u cloudcli -f      # 实时日志

页面不提示不显示 
支付方式由后台通道配置决定：未配置真实商户号时走站内沙箱，不产生真实扣款；配置 PAYMENT_PROVIDER 与商户凭据后由支付宝/微信完成真实扣款。
能力咩有接入
功能开发中
测试方案
mock 数据
模拟


系统升级、数据备份、数据迁移

模型配置页面改版

系统设置



支持：android
tailwind-merge



https://www.pixpix.com/zh-CN/workbench

API 定价目录
https://www.seeany.com/developer/pricing
https://www.seeany.com/tutorials
https://www.seeany.com/vip

复刻页面
分析以下链接，将页面功能和设计完全复刻出来，页面样式适配项目
https://www.designkit.cn/shoppable-carousel?from=product_kit_web


## 任务

参考站：https://www.designkit.cn/shoppable-carousel?from=product_kit_web
（美图设计室「AI带货图文」，SPA，左侧配置栏 + 右侧模板展示 + 底部历史记录）

把它复刻成本站的一个新页面：**功能与交互逐项对齐，视觉与工程实现按本项目体系落地**（不是照搬参考站的配色和组件库）。

## 先读

- `CLAUDE.md`、`docs/development-workflow.md`：能力 / 厂商 / 协议 / 环境变量按「常见改动：从哪下手」逐项走，改源头不改调用点。
- 只交付可运行代码：不写本地占位图、不造伪模型产出；无可用模型线路就如实失败并退款。
- 模板缩略图与成套文案**按指令整套搬进仓库**（不是外链、不是占位），来源与抓取日期记进 `docs/shoppable-carousel-template-sources.md`；素材可用性属产品确认项，不阻塞开发。
- 不代为 commit。

## 阶段 0：取证（先做，不写代码）

1. 用 Playwright + 本机 Chromium（`~/Library/Caches/ms-playwright/chromium-1134`，`--no-proxy-server`，locale zh-CN）打开参考站，1440×900 与 1920×1080 各抓一次。**不许只看截图凭印象**，要 computed styles + DOM 结构。
2. 需要取证的项目（自行判定，不要预设结论）：
   - 布局：左右分栏宽度、间距、滚动归属（是主区内部滚动还是 window 滚动）、窄屏行为
   - 左栏各区块（上传 / 生成设置 / 文案 / 选择模板 / 附加功能）：控件类型、约束（图片张数上限、文案字数上限）、默认值、禁用态
   - 底部数量步进器取值范围、积分消耗、主按钮的禁用条件与文案（未登录 / 余额不足 / 通道不可用三种态分别是什么）
   - 右栏：分类 tab 的完整清单与顺序、模板卡构成（缩略图比例、标题、副标题结构、查看按钮）、hover 与选中态、懒加载与分页
   - 顶部「新建任务」与历史记录区：数据来源、如何切回历史任务
   - 五态：首次空态 / 生成中 / 有结果 / 失败 / 未登录或通道不可用
3. 产出 `docs/shoppable-carousel-design.md`：实测值表（节点 / 属性 / 参考站值）+ 与本站设计令牌的映射。页面样式一律引用 `frontend/src/styles/global.css` 的 `var(--token)`，不写裸 hex；参考站品牌色不沿用。

## 阶段 1：实现映射（先出结论，等确认再动手）

1. **能力落点**：新增 `backend/src/capabilities/definitions/<id>.ts`（建议 `shoppable_carousel`），在 `definitions/index.ts` 注册；声明 `modality / params / buildPrompt / creditCost / inWorkbench / group / help`。说明「多张参考图 × N 条图文」如何展开成生成任务，与 `ProductKitPage` 的变体展开保持同一套做法，不另起一套。
2. **模板数据**：分类、名称、镜头结构、提示词片段、缩略图**全部落进仓库**，唯一事实源为一个显式文件（建议 `backend/src/capabilities/definitions/shoppable-carousel.templates.ts`，与能力定义同域），字段含 `id / category / name / beats[3] / promptFragment / thumbFile / sourceUrl / capturedAt`。
   - 缩略图下载到 `frontend/public/templates/shoppable-carousel/`（或按项目现有素材目录约定），文件名与 `id` 一致，登记尺寸与来源 URL；不运行时外链参考站，避免对方改图或防盗链导致破图。
   - 抓取内容写清「抓自哪个页面 / 什么时间 / 用什么工具」，落 `docs/shoppable-carousel-template-sources.md`；模板卡片展示的是我们自己的文件，不是在页面上热链 B 站。
   - 若某条模板无法取到缩略图（懒加载未渲染、需登录），**如实记进该文档的缺口清单**，卡片用项目自有占位并标注「待补」，不得伪造。
3. **复用清单**：哪些直接用（`ToolImageDropzone` / `ToolSettingsPopover` / `ResultGalleryPane` / `useImageUpload` / `usePollAbort` / `useCapabilityRuntime` / `useCreditLabel` / `AssetLibraryModal`），哪些必须新写。
4. 逐个列出要改的文件 `file:line`：路由（`App.tsx`）、页面、`lib/api.ts`、`types/api.d.ts`、`global.css`、能力定义、文档。

## 阶段 2：实现

- 新页面 `frontend/src/pages/ShoppableCarouselPage.tsx`，路由 `/shoppable-carousel` 注册进 `App.tsx` 的 C 端壳内路由段（注意 `/admin/*` 与 catch-all 的注册顺序）。
- 每个控件接真实后端：上传走 assets API、生成走 generate API、扣费与退款走现有链路；失败如实报错，不用前端兜底掩盖接口缺失。
- 积分价不写死，走 `CreditPriceService.resolve()`；页面展示的消耗数应与实际扣费一致。
- AIGC 标识沿用现有产出链路，不绕过；页面不出现参考站品牌名与 logo。
- 同步更新受影响的现状描述：`README.md` 能力清单与页面结构、`CLAUDE.md` 的能力数量、`docs/testing.md` 覆盖矩阵。

## 验收（逐条给证据，不写"已完成"）

- 五态齐全；未登录 / 通道不可用时按钮禁用并给出原因（`40005` / `42204` 原样呈现）。
- 1440 与 1920 两个视口下逐项对比：节点 / 参考站实测 / 本站实测 / 差值 / 是否主动偏离及理由（表格）。
- 至少一组同视口截图对比。
- 贴真实命令输出：`npx ts-node -T scripts/verify-capability-extensibility.ts`、`verify-architecture-layers.ts`、`verify-credit-deduction.ts`；前端 `npm run typecheck`。build 与 tsc 全量按 `CLAUDE.md` 需授权，未跑就标注「待授权」。
- 交付摘要：`file:line` 改动清单 + 未验边界 + 主动偏离项。

## 不要做

- 不在页面里热链参考站的缩略图 URL（必须落成本仓库内的文件）；不把参考站的品牌名、logo、付费标记（如「90 美豆」）带进来。
- 不新增 mock / planned 能力来"凑页面"，不为让页面像而绕过真实生成链路。
- 不顺手重构无关文件，不扩范围改后台。

---




提示词：
# Visual DNA Extractor

## 角色定义
你是一位精通商业摄影布景与Midjourney/Stable Diffusion提示词工程的专家。你的任务是深度解析参考图片，将其转化为一段可以直接用于AI生成的、能够高度还原场景细节的Prompt。

## 目标
解析用户提供的参考图，目的是**保留场景、光影、构图和道具完全不变**，仅准备将画面主体的“产品”进行替换。

## 分析维度 (必须严格按此逻辑提取)

1.  **环境构建 (Scene Construction)**
    * **背景底色**：提取精确的颜色描述（如：莫兰迪鼠尾草绿、纯白无缝背景、深色大理石纹）。
    * **地面材质**：描述承载物体的平面（如：哑光纸面、倒影亚克力、粗糙水泥）。
    * **空间感**：是平面拍摄(Flat lay)、45度俯拍、还是正视透视？

2.  **道具与陈列 (Props & Staging) —— *这是复刻的关键***
    * **实体道具清单**：罗列画面中所有非产品的装饰物（如：风化的大块浮木、新鲜的侧柏叶枝条、散落的棕色尤加利干果）。
    * **位置关系**：描述道具相对于画面的位置（如：浮木呈对角线贯穿画面左下至右上，枝叶点缀在边缘）。

3.  **光影与氛围 (Lighting & Mood)**
    * **光源类型**：自然窗光、硬光聚焦、柔光箱(Softbox)。
    * **阴影质感**：长阴影、漫射柔和阴影、无影。
    * **整体色调**：低饱和度、高对比度、冷暖倾向。

4.  **构图与镜头 (Composition & Camera)**
    * **景深**：全焦清晰还是背景虚化(Bokeh)？
    * **留白**：画面留白的位置（用于放文案的空间）。

5.  **变量槽位 (The Variable Slot)**
    * **原主体描述**：描述原图中的产品是什么（方便在生成新Prompt时将其剔除）。
    * **替换建议**：指出新产品应该放置的位置和角度（如：中心位置，依附于浮木倾斜放置）。

## 输出格式
请按以下 JSON 格式输出分析结果，并在最后生成一段英文 Prompt (适用于 Midjourney/SD)：

```json
{
  "scene_setup": "...",
  "props_detailed": "...",
  "lighting_style": "...",
  "composition_camera": "...",
  "variable_slot": "原产品为[图像文件名]，建议替换点为[Y位置]"
}



